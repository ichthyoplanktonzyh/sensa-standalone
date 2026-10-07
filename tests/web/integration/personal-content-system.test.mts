import {test} from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { IDBFactory } from 'fake-indexeddb';

test("personal-content-system", async () => {

const root = await mkdtemp(join(tmpdir(), 'sensa-personal-content-'));
const outfile = join(root, 'bundle.mjs');
Object.assign(globalThis, {
  indexedDB: new IDBFactory(),
  window: new EventTarget(),
  BroadcastChannel: undefined,
});

try {
  const result = await build({
    stdin: {
      contents: [
        "export * from './apps/web/src/data/library/store';",
        "export * from './apps/web/src/personalContent/system';",
        "export * from './apps/web/src/personalContent/system/personalContentAuthority';",
        "export * from './apps/web/src/data/library/sqliteAdapter';",
      ].join('\n'),
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  await writeFile(outfile, result.outputFiles[0]!.contents);
  const api = await import(pathToFileURL(outfile).href);
  assert.equal(api.personalContentSystem.read({kind:'snapshot'}).status,'loading','an unread cache is not an empty successful library');
  await api.openLibrary();

  const personalContent = api.personalContentSystem;
  const coldAdapter=await api.sqliteRecordAdapter(),coldEntries=coldAdapter.entries.bind(coldAdapter);
  try{
    coldAdapter.entries=async(table:string)=>{if(table==='annotations')throw Error('controlled_initial_annotation_read_failure');return coldEntries(table);};
    await assert.rejects(personalContent.refresh(),/storageWrite/);
    assert.equal(personalContent.read({kind:'snapshot'}).status,'error','a cold first scan failure cannot become a ready empty library');
    assert.equal(personalContent.read({kind:'sense',senseId:'sense:river'}).status,'error');
  }finally{coldAdapter.entries=coldEntries;}
  await personalContent.refresh();
  assert.equal(personalContent.read({kind:'snapshot'}).status,'ready','only a successful first retry can confirm emptiness');
  assert.deepEqual(await personalContent.readSenseNote('sense:river'), {body:'',revision:0});
  await personalContent.execute({
    kind: 'set_sense_note',
    operationId: crypto.randomUUID(),
    senseId: 'sense:river',
    body: 'movement across water',
    expected: {body:'',revision:0},
  });
  assert.equal(
    personalContent.read({ kind: 'sense', senseId: 'sense:river' }).note,
    'movement across water',
  );
  await personalContent.execute({
    kind: 'set_sense_note',
    operationId: crypto.randomUUID(),
    senseId: 'sense:river',
    body: 'movement across water',
    expected: {body:'movement across water',revision:1},
  });
  const unchangedNote = await api.readLibrary((tx: any) => tx.get('annotations', 'sense_note:sense%3Ariver'));
  assert.equal(unchangedNote.revision, 1, 'identical note saves do not invent revisions');
  await personalContent.execute({
    kind: 'set_sense_note',
    operationId: crypto.randomUUID(),
    senseId: 'sense:river',
    body: 'movement across the river',
    expected: {body:'movement across water',revision:1},
  });
  const revisedNote = await api.readLibrary((tx: any) => tx.get('annotations', 'sense_note:sense%3Ariver'));
  assert.equal(revisedNote.revision, 2);

  const staleOperationId=crypto.randomUUID();
  await assert.rejects(personalContent.execute({kind:'set_sense_note',operationId:staleOperationId,senseId:'sense:river',body:'stale draft',expected:{body:'movement across water',revision:1}}), (error:any)=>{
    assert(error instanceof api.SenseNoteConflictError);
    assert.deepEqual(error.current,{body:'movement across the river',revision:2});
    return true;
  });
  assert.equal(await api.readLibrary((tx:any)=>tx.get('operations',staleOperationId)),undefined,'rejection cannot leave a successful receipt');
  assert.deepEqual(await personalContent.readSenseNote('sense:river'),{body:'movement across the river',revision:2});

  const competing=['first editor','second editor'].map(body=>({kind:'set_sense_note',operationId:crypto.randomUUID(),senseId:'sense:river',body,expected:{body:'movement across the river',revision:2}}));
  const race=await Promise.allSettled(competing.map(input=>personalContent.execute(input)));
  assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(race.filter(result=>result.status==='rejected').length,1);
  const winningIndex=race.findIndex(result=>result.status==='fulfilled'),winning=competing[winningIndex]!;
  assert.deepEqual(await personalContent.readSenseNote('sense:river'),{body:winning.body,revision:3});
  const clear={kind:'set_sense_note',operationId:crypto.randomUUID(),senseId:'sense:river',body:'  ',expected:{body:winning.body,revision:3}};
  const cleared=await personalContent.execute(clear);
  assert.deepEqual(cleared.note,{body:'',revision:4});
  assert.deepEqual(await personalContent.readSenseNote('sense:river'),{body:'',revision:4});
  assert.equal(Object.hasOwn(personalContent.read({kind:'snapshot'}).senseNotes,'sense:river'),false,'cleared notes do not inflate the list/count');
  await assert.rejects(personalContent.execute({...winning,operationId:crypto.randomUUID(),expected:{body:'',revision:0}}),/noteChanged/,'clear must not reopen revision zero for an old blank editor');
  await assert.rejects(personalContent.execute({...winning,operationId:crypto.randomUUID(),expected:{body:winning.body,revision:3}}),/noteChanged/,'clear must also fence an old populated editor');
  const replay=await personalContent.execute(winning);
  assert.deepEqual(replay.note,{body:winning.body,revision:3},'lost-response retry returns its own committed receipt');
  assert.deepEqual(await personalContent.readSenseNote('sense:river'),{body:'',revision:4},'receipt replay must not undo an intervening clear');
  await assert.rejects(personalContent.execute({...winning,body:'changed retry'}),/operationConflict/,'same operation cannot carry a different draft');
  await personalContent.execute({...winning,operationId:crypto.randomUUID(),expected:{body:'',revision:4},body:'explicitly reviewed replacement'});
  assert.equal((await personalContent.readSenseNote('sense:river')).revision,5);

  const adapter=await api.sqliteRecordAdapter(),originalEntries=adapter.entries.bind(adapter),originalCommit=adapter.commit.bind(adapter);
  const refreshFailure={...winning,operationId:crypto.randomUUID(),expected:{body:'explicitly reviewed replacement',revision:5},body:'saved despite failed list read'};
  try {
    adapter.entries=async(table:string)=>{if(table==='annotations')throw Error('controlled_note_list_read_failure');return originalEntries(table);};
    const saved=await personalContent.execute(refreshFailure);
    assert.deepEqual(saved,{note:{body:refreshFailure.body,revision:6},projectionUpdated:false},'post-commit read failure must not masquerade as a failed save');
    assert.equal(personalContent.read({kind:'snapshot'}).status,'error','the failed presentation read must not look like a ready empty snapshot');
    assert.equal(personalContent.read({kind:'sense',senseId:'sense:river'}).status,'error');
    assert.deepEqual(await personalContent.readSenseNote('sense:river'),saved.note,'exact editor reads do not scan annotations/media');
  } finally {adapter.entries=originalEntries;}
  assert.equal((await personalContent.execute(refreshFailure)).projectionUpdated,true,'same receipt can safely refresh the list');
  assert.equal(personalContent.read({kind:'snapshot'}).status,'ready');

  const lostResponse={...winning,operationId:crypto.randomUUID(),expected:{body:refreshFailure.body,revision:6},body:'committed with lost response'};
  try {
    adapter.commit=async(mutation:unknown)=>{await originalCommit(mutation);throw Error('controlled_note_commit_response_loss');};
    await assert.rejects(personalContent.execute(lostResponse),/storageWrite/);
  } finally {adapter.commit=originalCommit;}
  assert.deepEqual(await personalContent.readSenseNote('sense:river'),{body:lostResponse.body,revision:7});
  await personalContent.execute({...winning,operationId:crypto.randomUUID(),expected:{body:lostResponse.body,revision:7},body:'later device update'});
  assert.deepEqual((await personalContent.execute(lostResponse)).note,{body:lostResponse.body,revision:7});
  assert.deepEqual(await personalContent.readSenseNote('sense:river'),{body:'later device update',revision:8},'lost receipt retries cannot overwrite later device edits');

  const rejectedCommit={...winning,operationId:crypto.randomUUID(),expected:{body:'later device update',revision:8},body:'not committed'};
  try {
    adapter.commit=async()=>{throw Error('controlled_note_commit_failure');};
    await assert.rejects(personalContent.execute(rejectedCommit),/storageWrite/);
  } finally {adapter.commit=originalCommit;}
  assert.deepEqual(await personalContent.readSenseNote('sense:river'),{body:'later device update',revision:8});
  assert.equal(await api.readLibrary((tx:any)=>tx.get('operations',rejectedCommit.operationId)),undefined);
  // Model the existing Cloud resolution admission: two legitimate offline
  // branches can both be revision 8; choosing remote does not renumber the row.
  await api.restoreLibraryTransaction(async(tx:any)=>{
    const current=await tx.get('annotations','sense_note:sense%3Ariver');
    tx.put('annotations',current.id,{...current,body:'explicitly selected remote fork'});
  });
  await assert.rejects(personalContent.execute(rejectedCommit), (error:any)=>{
    assert(error instanceof api.SenseNoteConflictError);
    assert.deepEqual(error.current,{body:'explicitly selected remote fork',revision:8});return true;
  },'same-version different-body fork resolution must fence a stale editor');
  assert.deepEqual(await personalContent.readSenseNote('sense:river'),{body:'explicitly selected remote fork',revision:8});
  let release!:()=>void,entered!:()=>void;
  const enteredRead=new Promise<void>(resolve=>{entered=resolve;});
  const heldRead=api.readLibrary(async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});});
  await enteredRead;
  const mutableRequest={...rejectedCommit,operationId:crypto.randomUUID(),expected:{body:'later device update',revision:8}};
  const queued=personalContent.execute(mutableRequest);
  mutableRequest.expected.body='explicitly selected remote fork';release();await heldRead;
  await assert.rejects(queued,/noteChanged/,'queued CAS and receipt must use one captured edit base, not a mutable caller alias');
  assert.deepEqual(await personalContent.readSenseNote('sense:river'),{body:'explicitly selected remote fork',revision:8});
  await assert.rejects(api.command({id:crypto.randomUUID(),kind:'personal_content.test_delete_note',input:{}},async(tx:any)=>{
    tx.delete('annotations','sense_note:sense%3Ariver');await api.assertPersonalContentChanges(tx);
  }),/annotationInvalid/,'note clears retain their monotonic edit base');

  assert.equal(await personalContent.execute({
    kind: 'set_saved_sense',
    operationId: crypto.randomUUID(),
    senseId: 'sense:river',
    saved: true,
  }), true);
  assert.equal(personalContent.read({ kind: 'sense', senseId: 'sense:river' }).saved, true);
  assert.equal(await personalContent.execute({
    kind: 'set_saved_sense',
    operationId: crypto.randomUUID(),
    senseId: 'sense:river',
    saved: false,
  }), false);
  assert.equal(personalContent.read({ kind: 'sense', senseId: 'sense:river' }).saved, false);
  assert.equal(await personalContent.execute({
    kind: 'set_saved_example',
    operationId: crypto.randomUUID(),
    exampleId: 'example:river',
    saved: true,
  }), true);

  const contextId = crypto.randomUUID();
  await personalContent.execute({
    kind: 'save_sense_context',
    operationId: crypto.randomUUID(),
    contextId,
    senseId: 'sense:river',
    body: 'The river beside my childhood home.',
    media: [],
  });
  assert.equal(
    personalContent.read({ kind: 'sense_context', contextId })?.senseId,
    'sense:river',
  );
  const sceneBefore=await personalContent.readScene({kind:'sense_context',contextId});
  assert.equal(sceneBefore.body,'The river beside my childhood home.');
  try{
    adapter.entries=async(table:string)=>{if(table==='annotations')throw Error('controlled_scene_list_read_failure');return originalEntries(table);};
    await assert.rejects(personalContent.refresh(),/storageWrite/);
    assert.deepEqual(await personalContent.readScene({kind:'sense_context',contextId}),sceneBefore,'the editor exact read preserves stored Context even when the global cache is unavailable');
  }finally{adapter.entries=originalEntries;}
  const originalGet=adapter.get.bind(adapter);
  try{
    adapter.get=async(table:string,key:string)=>{if(table==='annotations')throw Error('controlled_exact_scene_read_failure');return originalGet(table,key);};
    await assert.rejects(personalContent.readScene({kind:'sense_context',contextId}),/storageWrite/,'a failed exact read must reject, not look like a new empty Context');
  }finally{adapter.get=originalGet;}
  await personalContent.refresh();
  assert.equal(await personalContent.readScene({kind:'sense_context',contextId:crypto.randomUUID()}),null,'a successful exact missing-row read can confirm absence');
  await assert.rejects(
    api.command({id:crypto.randomUUID(),kind:'personal_content.test_invalid',input:{}},async(tx:any)=>{
      const key=`sense_context:${encodeURIComponent(contextId)}`;
      const current=await tx.get('annotations',key);
      tx.put('annotations',key,{...current,senseId:'sense:rewritten',revision:current.revision+1});
      await api.assertPersonalContentChanges(tx);
    }),
    /annotationInvalid/,
    'authority rejects changing a Sense Context identity',
  );

  const rows = await api.readLibrary((tx: any) => tx.all('annotations'));
  assert.equal(rows.length, 3);
  assert(rows.every((row: any) => row.kind !== 'saved_sense'));
  assert(rows.every((row: any) => row.kind !== 'semantic_anchor'));
  console.log('PASS: Personal Content commands own saved references, notes and Sense Context Notes behind one interface.');
} finally {
  await rm(root, { recursive: true, force: true });
}

});
