import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import {
  createLibraryCloudBrowserFixture,
  type LibraryCloudBrowserFixture,
} from '../support/libraryCloudBrowserFixture.mts';
import { createRealLibraryConvergenceWorld } from '../support/realLibraryConvergenceWorld.mts';

let fixture: LibraryCloudBrowserFixture;

before(async () => {
  fixture = await createLibraryCloudBrowserFixture();
});

after(async () => {
  await fixture?.close();
});

const draftTexts = (drafts: readonly Readonly<{ text: string }>[]): string[] => (
  drafts.map(({ text }) => text).sort((left, right) => left.localeCompare(right))
);

test('[integration][durability][convergence] real cloud retry after a lost acknowledgement is idempotent', async (context) => {
  const world = await createRealLibraryConvergenceWorld(fixture, ['device-a', 'device-b']);
  context.after(() => world.close());

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

test('[integration][durability][convergence] real offline independent writes eventually converge', async (context) => {
  const world = await createRealLibraryConvergenceWorld(fixture, ['device-a', 'device-b']);
  context.after(() => world.close());

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

test('[integration][local-correctness][convergence] real conflicts preserve both branches until an explicit decision', async (context) => {
  const world = await createRealLibraryConvergenceWorld(fixture, ['device-a', 'device-b', 'observer']);
  context.after(() => world.close());

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
