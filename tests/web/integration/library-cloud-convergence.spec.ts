import assert from 'node:assert/strict';
import { test } from '@playwright/test';

import {
  createLibraryCloudBrowserFixture,
  type LibraryCloudBrowserFixture,
} from '../support/libraryCloudBrowserFixture.mts';
import { createRealLibraryConvergenceWorld } from '../support/realLibraryConvergenceWorld.mts';

let fixture: LibraryCloudBrowserFixture;
const worlds = new Set<Awaited<ReturnType<typeof createRealLibraryConvergenceWorld>>>();
test.setTimeout(180_000);

test.beforeAll(async ({browser}) => {
  fixture = await createLibraryCloudBrowserFixture(browser);
});

test.afterEach(async () => {
  await Promise.all([...worlds].map((world) => world.close()));
  worlds.clear();
});

test.afterAll(async () => {
  await fixture?.close();
});

const draftTexts = (drafts: readonly Readonly<{ text: string }>[]): string[] => (
  drafts.map(({ text }) => text).sort((left, right) => left.localeCompare(right))
);

test('[integration][durability][convergence] real cloud retry after a lost acknowledgement is idempotent', async () => {
  const world = await createRealLibraryConvergenceWorld(fixture, ['device-a', 'device-b']);
  worlds.add(world);

  const draft = await world.add('device-a', 'My raincoat');
  await assert.rejects(world.sync('device-a', { fault: 'lost-ack' }), /lost_ack/u);
  assert.equal(await world.cloudRevision(), 1, 'the server commits before its acknowledgement is lost');

  await world.sync('device-a');
  assert.equal(await world.cloudRevision(), 1, 'retrying the same publication does not create a second revision');
  await world.sync('device-b');

  const [deviceA, deviceB] = await Promise.all([
    world.snapshot('device-a'),
    world.snapshot('device-b'),
  ]);
  assert.deepEqual(deviceB.drafts, [draft]);
  assert.equal(deviceA.identity.id, deviceB.identity.id, 'account replicas share one library identity');
  assert.notEqual(deviceA.identity.deviceId, deviceB.identity.deviceId, 'each browser keeps its own device identity');
});

test('[integration][durability][convergence] real offline independent writes eventually converge', async () => {
  const world = await createRealLibraryConvergenceWorld(fixture, ['device-a', 'device-b']);
  worlds.add(world);

  await world.add('device-a', 'shared base');
  await world.sync('device-a');
  await world.sync('device-b');
  await world.add('device-a', 'A offline');
  await world.add('device-b', 'B offline');
  await assert.rejects(world.sync('device-a', { fault: 'offline' }), /offline/u);

  await world.sync('device-a');
  await world.sync('device-b');
  await world.sync('device-a');
  const [deviceA, deviceB] = await Promise.all([
    world.snapshot('device-a'),
    world.snapshot('device-b'),
  ]);
  assert.deepEqual(draftTexts(deviceA.drafts), ['A offline', 'B offline', 'shared base']);
  assert.deepEqual(deviceB.drafts, deviceA.drafts);
  assert.equal(deviceA.sync.status, 'synced');
  assert.equal(deviceB.sync.status, 'synced');
});

test('[integration][durability][convergence] a confirmed device receives a Worker-prepared update and reopens exact facts',async()=>{
 const account=await fixture.createAccount(),left=await fixture.createClient(account),right=await fixture.createClient(account);
 try{
  const saved=await left.evaluate(async()=>{
   const core=(window as any).core,rows=[];
   for(let index=0;index<32;index++)rows.push(await core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:`Shared context ${index}`}));
   await (window as any).sync();return rows;
  });
  await right.evaluate(()=>(window as any).sync());
  const before=await right.evaluate(async()=>{const core=(window as any).core;return {state:await core.readCloudSync(),revision:await core.readLibrary(core.readLocalLibraryRevision)};});
  const edited=await left.evaluate(async(id)=>{const core=(window as any).core,value=await core.saveDraft(crypto.randomUUID(),{id,expectedRevision:1,text:'Changed on the first device.'});await (window as any).sync();return value;},saved[0].id);
  await right.evaluate(()=>{(window as any).changes=[];window.addEventListener('sensa-library-changed',event=>(window as any).changes.push((event as CustomEvent).detail));});
  await right.evaluate(()=>(window as any).sync());
  const applied=await right.evaluate(async()=>{const core=(window as any).core;return {state:await core.readCloudSync(),revision:await core.readLibrary(core.readLocalLibraryRevision),changes:(window as any).changes};});
  assert.equal(applied.state.status,'synced');assert.notEqual(applied.state.restoreOperationId,before.state.restoreOperationId,'the new head uses a new Worker-prepared application receipt');
  assert.equal(applied.revision,before.revision+1);
  assert(applied.changes.some((change:any)=>change.records.some((row:any)=>row.table==='drafts'&&row.key===edited.id)),'the exact changed record is announced');
  assert(applied.changes.every((change:any)=>!change.clears.includes('drafts')),'an incremental update does not announce a whole-table clear');
  await right.reload();
  const reopened=await right.evaluate(async()=>{const path='/core.js',core=await import(/* @vite-ignore */ path);await core.openLibrary();return {drafts:await core.listDrafts(),state:await core.readCloudSync()};});
  assert.deepEqual(reopened.drafts.find((row:any)=>row.id===edited.id),edited);
  for(const original of saved.slice(1))assert.deepEqual(reopened.drafts.find((row:any)=>row.id===original.id),original);
  assert.equal(reopened.state.status,'synced');assert.equal(reopened.state.restoreOperationId,applied.state.restoreOperationId);
 }finally{await left.context().close();await right.context().close();}
});

test('[integration][local-correctness][convergence] real conflicts preserve both branches until an explicit decision', async () => {
  const world = await createRealLibraryConvergenceWorld(fixture, ['device-a', 'device-b', 'observer']);
  worlds.add(world);

  const shared = await world.add('device-a', 'base');
  await world.sync('device-a');
  await world.sync('device-b');
  await world.sync('observer');

  await world.edit('device-a', shared.id, 'A edit');
  await world.edit('device-b', shared.id, 'B edit');
  await world.add('device-b', 'Independent while conflicted');
  await world.sync('device-a');
  await world.sync('device-b');

  const firstConflict = await world.snapshot('device-b');
  assert.equal(firstConflict.sync.status, 'conflict');
  assert.equal(firstConflict.sync.conflictRecords, 1);
  assert(firstConflict.sync.completeConflictRecords, 'persistent conflicts keep base, local and remote branches');
  assert.equal(firstConflict.drafts.find(({ id }) => id === shared.id)?.text, 'B edit');
  await world.sync('observer');
  const observer = await world.snapshot('observer');
  assert.equal(observer.drafts.find(({ id }) => id === shared.id)?.text, 'A edit');
  assert(draftTexts(observer.drafts).includes('Independent while conflicted'));

  await world.resolve('device-b', 'local');
  await world.edit('device-a', shared.id, 'A newer edit');
  await world.sync('device-a');
  await world.sync('device-b');
  const revalidated = await world.snapshot('device-b');
  assert.equal(revalidated.sync.status, 'conflict');
  assert(
    revalidated.sync.remoteRevision !== null
      && firstConflict.sync.remoteRevision !== null
      && revalidated.sync.remoteRevision > firstConflict.sync.remoteRevision,
    'a changed remote head requires a new decision',
  );
  assert.equal(revalidated.drafts.find(({ id }) => id === shared.id)?.text, 'B edit');

  await world.resolve('device-b', 'local');
  await world.sync('device-b');
  await world.sync('observer');
  assert.equal((await world.snapshot('observer')).drafts.find(({ id }) => id === shared.id)?.text, 'B edit');
  assert.equal((await world.snapshot('device-b')).sync.status, 'synced');

  await world.sync('device-a');
  await world.edit('device-a', shared.id, 'A final');
  await world.edit('device-b', shared.id, 'B final');
  await world.sync('device-a');
  await world.sync('device-b');
  assert.equal((await world.snapshot('device-b')).sync.status, 'conflict');
  await world.resolve('device-b', 'remote');
  await world.sync('device-b');
  const resolved = await world.snapshot('device-b');
  assert.equal(resolved.drafts.find(({ id }) => id === shared.id)?.text, 'A final');
  assert.equal(resolved.sync.status, 'synced');
});
