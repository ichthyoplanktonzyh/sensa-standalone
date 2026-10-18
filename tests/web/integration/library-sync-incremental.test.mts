import {IndexedSyncFixture} from '../support/indexedSyncFixture.mts';
/** Actual Library/SQLite/Wasm and owner commands; controlled sync transport.
 * Read/write assertions cover real baseline work, not just uploaded bytes. */
import {test,expect,afterAll,vi} from 'vitest';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {openLibrary,readLibrary,writeLibraryState,readLocalLibraryRevision,assertCurrentLibrary} from '../../../apps/web/src/data/library/store';
import {saveDraft,listDrafts} from '../../../apps/web/src/data/library/drafts';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import type {SyncRequest} from '../../../apps/web/src/data/library/cloudSync';
import {librarySyncManifest,librarySyncBlockMissing,librarySyncBlockStore,librarySyncBlockFetch,librarySyncCommit,librarySyncLegacyManifestRecordLimit} from '@sensa/contracts/sensa';
import {decodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
import {decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://incremental-sync.fixture.invalid/')});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());
const {synchronizeLibrary,readCloudSync,inspectPendingCloudSync}=await import('../../../apps/web/src/data/library/cloudSync');
const {libraryRestoreValidationVersion}=await import('../../../apps/web/src/data/library/replication/libraryReplicaValidation');
const blocks=new Map<string,string>(),calls:string[]=[];
let revision=0,manifest:string[]|null=null,hook:((path:string,body:any)=>Promise<void>)|undefined;
const index=new IndexedSyncFixture(blocks);
const request:SyncRequest=async(path,body)=>{
 calls.push(path);await hook?.(path,body);
 const page=index.page(path,body,revision,manifest);if(page!==undefined)return page;
 if(path==='/blocks/missing'){const input=librarySyncBlockMissing.parse(body);return {missing:input.hashes.filter(hash=>!blocks.has(hash))};}
 if(path==='/blocks/store'){for(const row of librarySyncBlockStore.parse(body).blocks)blocks.set(row.hash,row.data);return {stored:true};}
 if(path==='/blocks/fetch'){const input=librarySyncBlockFetch.parse(body);return {blocks:input.hashes.filter(hash=>blocks.has(hash)).map(hash=>({hash,data:blocks.get(hash)})),missing:input.hashes.filter(hash=>!blocks.has(hash)),deferred:[]};}
 if(path==='/commit'){const committed=index.commit(body,revision,manifest);revision=committed.revision;manifest=committed.manifest;return committed.head;}
 throw new Error('Unexpected fixture transport request');
};
const published=()=>{
 const schema=librarySyncManifest.parse(JSON.parse(manifest!.map(hash=>decodeLibrarySyncBlock(blocks.get(hash)!)).join('')));
 return schema.rows.map(row=>({...row,value:decodeBackupValue(JSON.parse(row.blocks.map(hash=>decodeLibrarySyncBlock(blocks.get(hash)!)).join('')))}));
};

// Keep real SQLite facts and baseline bodies, but put legacy capture beyond its
// metadata ceiling. No large duplicate library is needed to exercise this gate.
async function forbidLegacyCapture(){
 const adapter=await sqliteRecordAdapter(),count=adapter.count.bind(adapter),base=adapter.syncBaseEntries.bind(adapter);
 const counts=vi.spyOn(adapter,'count').mockImplementation(table=>table==='drafts'?Promise.resolve(librarySyncLegacyManifestRecordLimit+1):count(table));
 const bodies=vi.spyOn(adapter,'entries').mockImplementation(async()=>{throw Error('recovery read a complete fact table');});
 const baseline=vi.spyOn(adapter,'syncBaseEntries').mockImplementation(keys=>{if(!keys)throw Error('recovery read the complete baseline');return base(keys);});
 return ()=>{counts.mockRestore();bodies.mockRestore();baseline.mockRestore();};
}

test('a validated checkpoint checks only metadata when unchanged and publishes only changed fact bodies',async()=>{
 await openLibrary();const owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()};
 await writeLibraryState(async tx=>tx.put('meta','service-owner',owner));
 const drafts:Awaited<ReturnType<typeof saveDraft>>[]=[];for(let index=0;index<256;index++)drafts.push(await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:`Private draft ${index}: `+'a'.repeat(8000)}));
 const firstAdapter=await sqliteRecordAdapter(),pointRead=firstAdapter.get.bind(firstAdapter);
 const allBodies=vi.spyOn(firstAdapter,'entries').mockImplementation(async()=>{throw Error('first checkpoint preview hydrated source bodies');});
 const pointBodies=vi.spyOn(firstAdapter,'get').mockImplementation(async(table,key)=>{if(table!=='meta')throw Error('first checkpoint preview read a fact body');return pointRead(table,key);});
 const pages=vi.spyOn(firstAdapter,'recordKeysPage');
 try{
  const pending=await readLibrary(inspectPendingCloudSync);
  expect(pending).toMatchObject({accountLinked:true,canSync:true});
  expect(pending.records.filter(row=>row.table==='drafts').map(row=>row.key).sort()).toEqual(drafts.map(row=>row.id).sort());
  expect(pending.records.some(row=>row.table==='meta'&&row.key==='identity')).toBe(false);
  expect(pages.mock.calls.filter(([table])=>table==='drafts')).toHaveLength(3);
  expect(pages.mock.calls.every(([, ,limit])=>limit===128)).toBe(true);
  await writeLibraryState(async tx=>tx.put('meta','signed-out',true));
  try{const offline=await readLibrary(inspectPendingCloudSync);expect(offline.canSync).toBe(false);expect(offline.records).toEqual(pending.records);}
  finally{await writeLibraryState(async tx=>tx.delete('meta','signed-out'));}
 }finally{allBodies.mockRestore();pointBodies.mockRestore();pages.mockRestore();}
 const initialAdapter=await sqliteRecordAdapter(),candidate=initialAdapter.replicaCandidate.bind(initialAdapter);let entered=false,failed=false,rejectCleanup!:(error:Error)=>void;
 const gate=new Promise<never>((_,reject)=>{rejectCleanup=reject;}),retirement=vi.spyOn(initialAdapter,'replicaCandidate').mockImplementation(async(input,onProgress)=>{if(input.kind==='retirePublication'){entered=true;try{await gate;}finally{failed=true;}}return candidate(input,onProgress);});
 try{await synchronizeLibrary(request);expect((await readCloudSync())?.restoreValidationVersion).toBe(libraryRestoreValidationVersion);await vi.waitFor(()=>expect(entered).toBe(true));expect((await readCloudSync())?.status).toBe('synced');rejectCleanup(Error('injected post-confirm cleanup failure'));await vi.waitFor(()=>expect(failed).toBe(true));}
 finally{retirement.mockRestore();}
 calls.length=0;await synchronizeLibrary(request);expect(calls).toEqual(['/head']);await vi.waitFor(()=>expect(Reflect.get(database,'database').selectValue('SELECT count(*) FROM sensa_initial_publication')).toBe(0));
 const adapter=await sqliteRecordAdapter(),base=adapter.syncBaseEntries.bind(adapter),commit=adapter.commit.bind(adapter);
 const metadata=vi.spyOn(adapter,'syncBaseReferences').mockImplementation(async()=>{throw Error('incremental sync read the entire reference directory');});
 const read=vi.spyOn(adapter,'entries').mockImplementation(async()=>{throw new Error('incremental sync read a whole source table');});
 const baseline=vi.spyOn(adapter,'syncBaseEntries').mockImplementation(async keys=>{if(keys===undefined)throw new Error('incremental sync read all baseline bodies');return base(keys);});
 const mutations:Parameters<typeof adapter.commit>[0][]=[],writes=vi.spyOn(adapter,'commit').mockImplementation(async mutation=>{if(mutation.syncBaseReplacement!==undefined)throw new Error('incremental sync replaced the whole baseline');mutations.push(mutation);await commit(mutation);});
 try{
  calls.length=0;const before=revision;await synchronizeLibrary(request);
  expect(calls).toEqual(['/head']);expect(revision).toBe(before);expect(baseline).not.toHaveBeenCalled();expect(mutations.some(row=>row.syncBasePatch)).toBe(false);
  const changed=await saveDraft(crypto.randomUUID(),{id:drafts[0]!.id,expectedRevision:1,text:'A changed confirmed draft.'});
  mutations.length=0;calls.length=0;await synchronizeLibrary(request);
  expect(calls).not.toContain('/blocks/fetch');expect(calls.filter(path=>path==='/commit')).toHaveLength(1);
  const patches=mutations.flatMap(row=>row.syncBasePatch?[row.syncBasePatch]:[]);
  expect(patches).toHaveLength(1);expect(patches[0]!.puts.map(row=>row.key)).toEqual([changed.id]);expect(patches[0]!.deletes).toEqual([]);
  expect(baseline.mock.calls.every(([keys])=>keys?.length===1)).toBe(true);
  const remote=published();expect(remote.filter(row=>row.table==='drafts')).toHaveLength(256);
  expect(remote.find(row=>row.key===changed.id)?.value).toEqual(changed);
  expect(remote.find(row=>row.key===drafts[1]!.id)?.value).toEqual(drafts[1]);
  read.mockRestore();expect(await listDrafts()).toHaveLength(256);expect((await readCloudSync())?.status).toBe('synced');
 }finally{read.mockRestore();baseline.mockRestore();writes.mockRestore();metadata.mockRestore();}
});

test('native preparation waits for the selected publication retirement before opening its source',async()=>{
 const adapter=await sqliteRecordAdapter(),candidate=adapter.replicaCandidate.bind(adapter);let entered=false,retired=false,release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const retirement=vi.spyOn(adapter,'replicaCandidate').mockImplementation(async(input,onProgress)=>{if(input.kind==='retirePublication'){entered=true;await gate;}const result=await candidate(input,onProgress);if(input.kind==='retirePublication'&&result.kind==='publicationRetired'&&result.done)retired=true;return result;});
 const producer=vi.spyOn(await import('../../../apps/web/src/data/library/cloudNativeSnapshot'),'publishNativeCloudSnapshot').mockImplementation(async()=>{expect(retired).toBe(true);return {} as any;});
 try{calls.length=0;const preparing=synchronizeLibrary(request,{publishSnapshot:true});await vi.waitFor(()=>expect(entered).toBe(true));expect(producer).not.toHaveBeenCalled();expect(calls).toEqual(['/head']);release();await preparing;expect(producer).toHaveBeenCalledOnce();expect((await readCloudSync())?.status).toBe('synced');}
 finally{release();retirement.mockRestore();producer.mockRestore();}
});

test('automatic preparation skips a small publication without waiting for background retirement',async()=>{
 const adapter=await sqliteRecordAdapter(),candidate=adapter.replicaCandidate.bind(adapter);let entered=false,retired=false,release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),before=await readCloudSync();
 const retirement=vi.spyOn(adapter,'replicaCandidate').mockImplementation(async(input,onProgress)=>{if(input.kind==='retirePublication'){entered=true;await gate;}const result=await candidate(input,onProgress);if(input.kind==='retirePublication'&&result.kind==='publicationRetired'&&result.done)retired=true;return result;});
 const producer=vi.spyOn(await import('../../../apps/web/src/data/library/cloudNativeSnapshot'),'publishNativeCloudSnapshot');
 try{calls.length=0;await synchronizeLibrary(request,{publishSnapshot:'if-large'});await vi.waitFor(()=>expect(entered).toBe(true));expect(retired).toBe(false);expect(calls).toEqual(['/head']);expect(producer).not.toHaveBeenCalled();expect(await readCloudSync()).toEqual(before);}
 finally{release();await vi.waitFor(()=>expect(retired).toBe(true));retirement.mockRestore();producer.mockRestore();}
});

test('cancellation while waiting for retirement leaves the confirmed facts checkpoint intact',async()=>{
 const adapter=await sqliteRecordAdapter(),candidate=adapter.replicaCandidate.bind(adapter);let entered=false,retired=false,release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),controller=new AbortController(),before=await readCloudSync();
 const retirement=vi.spyOn(adapter,'replicaCandidate').mockImplementation(async(input,onProgress)=>{if(input.kind==='retirePublication'){entered=true;await gate;}const result=await candidate(input,onProgress);if(input.kind==='retirePublication'&&result.kind==='publicationRetired'&&result.done)retired=true;return result;});
 const producer=vi.spyOn(await import('../../../apps/web/src/data/library/cloudNativeSnapshot'),'publishNativeCloudSnapshot');
 try{const preparing=synchronizeLibrary(request,{publishSnapshot:true,signal:controller.signal});await vi.waitFor(()=>expect(entered).toBe(true));controller.abort();await expect(preparing).rejects.toThrow('library_sync_cancelled');expect(producer).not.toHaveBeenCalled();expect(await readCloudSync()).toEqual(before);}
 finally{release();await vi.waitFor(()=>expect(retired).toBe(true));retirement.mockRestore();producer.mockRestore();}
});

test('failed retirement cannot report a native artifact while facts remain durably synced',async()=>{
 const adapter=await sqliteRecordAdapter(),candidate=adapter.replicaCandidate.bind(adapter),before=await readCloudSync();
 const retirement=vi.spyOn(adapter,'replicaCandidate').mockImplementation(async(input,onProgress)=>{if(input.kind==='retirePublication')throw Error('injected_retirement_failure');return candidate(input,onProgress);});
 const producer=vi.spyOn(await import('../../../apps/web/src/data/library/cloudNativeSnapshot'),'publishNativeCloudSnapshot');
 try{await expect(synchronizeLibrary(request,{publishSnapshot:true})).rejects.toThrow('sqlite_snapshot_source_busy');expect(producer).not.toHaveBeenCalled();expect(await readCloudSync()).toEqual(before);}
 finally{retirement.mockRestore();producer.mockRestore();}
});

test('a local write during an unchanged-head check stays pending rather than becoming falsely synced',async()=>{
 const first=(await listDrafts())[0]!,before=revision;let changed=false;
 hook=async path=>{if(path==='/head'&&!changed){changed=true;await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:first.revision,text:'Written while checking the head.'});}};
 try{await expect(synchronizeLibrary(request)).rejects.toThrow('library_sync_local_changed');}finally{hook=undefined;}
 expect(revision).toBe(before);expect((await readCloudSync())?.status).toBe('pending');
 await synchronizeLibrary(request);expect(published().find(row=>row.key===first.id)?.value.text).toBe('Written while checking the head.');
});

test('writes after the captured publication are preserved for the next delta',async()=>{
 const first=(await listDrafts())[0]!,captured=await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:first.revision,text:'Captured publication.'});let changed=false;
 hook=async path=>{if(path==='/blocks/store'&&!changed){changed=true;await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:captured.revision,text:'Later local write.'});}};
 try{await synchronizeLibrary(request);}finally{hook=undefined;}
 expect(changed).toBe(true);expect(published().find(row=>row.key===first.id)?.value.text).toBe('Captured publication.');
 expect((await listDrafts()).find(row=>row.id===first.id)?.text).toBe('Later local write.');expect((await readCloudSync())?.status).toBe('pending');
 await synchronizeLibrary(request);expect(published().find(row=>row.key===first.id)?.value.text).toBe('Later local write.');expect((await readCloudSync())?.status).toBe('synced');
});

test('a large-checkpoint interrupted incremental acknowledgement avoids legacy capture and another publication',async()=>{
 const first=(await listDrafts())[0]!;await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:first.revision,text:'Before the lost acknowledgement.'});
 const lost:SyncRequest=async(path,body)=>{const result=await request(path,body);if(path==='/commit')throw new Error('network offline lost acknowledgement');return result;};
 await expect(synchronizeLibrary(lost)).rejects.toThrow('lost acknowledgement');const committed=revision,state=await readCloudSync();expect(state?.pending).toBeTruthy();
 const restore=await forbidLegacyCapture();
 try{calls.length=0;await synchronizeLibrary(request);expect(revision).toBe(committed);expect(calls[0]).toBe('/commit');expect((await readCloudSync())?.status).toBe('synced');}
 finally{restore();}
});

test('receipt recovery preserves a later local edit and publishes it separately from the acknowledged patch',async()=>{
 const first=(await listDrafts())[0]!,captured=await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:first.revision,text:'Published before the lost ACK.'});
 const lost:SyncRequest=async(path,body)=>{const result=await request(path,body);if(path==='/commit')throw Error('lost ACK before later edit');return result;};
 await expect(synchronizeLibrary(lost)).rejects.toThrow('lost ACK');const committed=revision,pending=(await readCloudSync())!.pending!;
 const later=await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:captured.revision,text:first.text});
 const restore=await forbidLegacyCapture();
 try{
  calls.length=0;await synchronizeLibrary(request);
  expect(calls.filter(path=>path==='/commit')).toHaveLength(2);expect(calls[0]).toBe('/commit');expect(revision).toBe(committed+1);
  expect(index.receipts.has(pending.operationId)).toBe(true);expect(published().find(row=>row.key===first.id)?.value).toEqual(later);
  expect(await readLibrary(tx=>tx.get('drafts',first.id))).toEqual(later);expect((await readCloudSync())?.status).toBe('synced');
 }finally{restore();}
});

test('an untrusted recovery ACK or missing patch body cannot advance the baseline or consume pending',async()=>{
 const first=(await listDrafts())[0]!;await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:first.revision,text:'Retained uncertain publication.'});
 const lost:SyncRequest=async(path,body)=>{const result=await request(path,body);if(path==='/commit')throw Error('lost ACK for negative recovery');return result;};
 await expect(synchronizeLibrary(lost)).rejects.toThrow('lost ACK');const before=(await readCloudSync())!,base=await readLibrary(tx=>tx.syncBaseEntries());
 const restore=await forbidLegacyCapture();
 try{
  for(const fault of ['digest','missing'] as const){
   const invalid:SyncRequest=async(path,body)=>{
    if(fault==='missing'&&path==='/blocks/fetch')throw Error('library_sync_missing_block');
    const result=await request(path,body);return fault==='digest'&&path==='/commit'?{...result,receipt:{...result.receipt,requestDigest:'f'.repeat(64)}}:result;
   };
   await expect(synchronizeLibrary(invalid)).rejects.toThrow(fault==='digest'?'library_sync_format':'library_sync_missing_block');
   const state=(await readCloudSync())!;expect(state.pending).toEqual(before.pending);expect(state.revision).toBe(before.revision);expect(state.syncedLocalRevision).toBe(before.syncedLocalRevision);
  }
 }finally{restore();}
 expect(await readLibrary(tx=>tx.syncBaseEntries())).toEqual(base);await synchronizeLibrary(request);
});

test('receipt recovery rechecks identity, signout epoch and owner before changing the baseline',async()=>{
 const first=(await listDrafts())[0]!;await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:first.revision,text:'Fenced receipt recovery.'});
 const lost:SyncRequest=async(path,body)=>{const result=await request(path,body);if(path==='/commit')throw Error('lost fenced ACK');return result;};
 await expect(synchronizeLibrary(lost)).rejects.toThrow('lost fenced ACK');
 const state=(await readCloudSync())!,base=await readLibrary(tx=>tx.syncBaseEntries()),identity=await readLibrary(tx=>tx.get('meta','identity')),epoch=await readLibrary(tx=>tx.get('meta','service-signout-epoch'));
 for(const fault of ['owner','identity','epoch'] as const){
  let injected=false;hook=async path=>{if(path==='/blocks/fetch'&&!injected){injected=true;await writeLibraryState(async tx=>{if(fault==='owner')tx.put('meta','service-owner',{...state.owner,subject:crypto.randomUUID()});else if(fault==='identity')tx.put('meta','identity',{...identity as any,id:crypto.randomUUID()});else tx.put('meta','service-signout-epoch',crypto.randomUUID());});}};
  const restore=await forbidLegacyCapture();
  try{await expect(synchronizeLibrary(request)).rejects.toThrow('account_changed');expect(injected).toBe(true);}
  finally{restore();hook=undefined;await writeLibraryState(async tx=>{tx.put('meta','service-owner',state.owner);tx.put('meta','identity',identity);if(epoch===undefined)tx.delete('meta','service-signout-epoch');else tx.put('meta','service-signout-epoch',epoch);});}
  const current=(await readCloudSync())!;expect(current.pending).toEqual(state.pending);expect(current.revision).toBe(state.revision);expect(await readLibrary(tx=>tx.syncBaseEntries())).toEqual(base);
 }
 await synchronizeLibrary(request);
});

test('a historical operation receipt does not replace a fresh head check or advance the local cursor',async()=>{
 const first=(await listDrafts())[0]!;await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:first.revision,text:'Historical receipt.'});
 const lost:SyncRequest=async(path,body)=>{const result=await request(path,body);if(path==='/commit')throw Error('lost historical ACK');return result;};
 await expect(synchronizeLibrary(lost)).rejects.toThrow('lost historical ACK');const state=(await readCloudSync())!,ackRevision=revision,pending=state.pending!;
 expect('patch' in pending).toBe(true);const other=index.commit({...pending,operationId:crypto.randomUUID(),baseRevision:revision},revision,manifest);revision=other.revision;manifest=other.manifest;
 const stop:SyncRequest=async(path,body)=>{if(path==='/head')throw Error('network stop before latest head');return request(path,body);},restore=await forbidLegacyCapture();
 try{await expect(synchronizeLibrary(stop)).rejects.toThrow('network stop before latest head');}
 finally{restore();}
 const confirmed=(await readCloudSync())!;expect(confirmed.revision).toBe(ackRevision);expect(confirmed.pending).toBeUndefined();expect(confirmed.syncedLocalRevision).toBe(state.syncedLocalRevision);expect(confirmed.status).not.toBe('synced');
 await synchronizeLibrary(request);expect((await readCloudSync())?.revision).toBe(revision);expect((await readCloudSync())?.status).toBe('synced');
});

test('another operation winning the CAS cannot acknowledge the retained pending operation',async()=>{
 const first=(await listDrafts())[0]!,base=await readLibrary(tx=>tx.syncBaseEntries([{table:'drafts',key:first.id}])),before=revision;
 await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:first.revision,text:'Same bytes, a different winning operation.'});
 const lost:SyncRequest=async(path,body)=>{if(path==='/commit'){await request(path,{...body as any,operationId:crypto.randomUUID()});throw Error('lost before original CAS');}return request(path,body);};
 await expect(synchronizeLibrary(lost)).rejects.toThrow('lost before original CAS');const pending=(await readCloudSync())!.pending!;expect(revision).toBe(before+1);expect(index.receipts.has(pending.operationId)).toBe(false);
 let checked=false;hook=async path=>{if(path==='/head'&&!checked){checked=true;expect((await readCloudSync())!.revision).toBe(before);expect(await readLibrary(tx=>tx.syncBaseEntries([{table:'drafts',key:first.id}]))).toEqual(base);}};
 const restore=await forbidLegacyCapture();
 try{await synchronizeLibrary(request);}finally{restore();hook=undefined;}
 expect(checked).toBe(true);expect(index.receipts.has(pending.operationId)).toBe(false);expect(revision).toBe(before+1);expect((await readCloudSync())?.status).toBe('synced');
});

test('a local removal after a lost ACK survives receipt recovery as a separate tombstone',async()=>{
 const {personalContentSystem}=await import('../../../apps/web/src/personalContent/system'),exampleId=crypto.randomUUID();
 await personalContentSystem.execute({kind:'set_saved_example',operationId:crypto.randomUUID(),exampleId,saved:true});
 const lost:SyncRequest=async(path,body)=>{const result=await request(path,body);if(path==='/commit')throw Error('lost before local removal');return result;};
 await expect(synchronizeLibrary(lost)).rejects.toThrow('lost before local removal');const committed=revision;expect(published().filter(row=>row.table==='annotations')).toHaveLength(1);
 await personalContentSystem.execute({kind:'set_saved_example',operationId:crypto.randomUUID(),exampleId,saved:false});
 const restore=await forbidLegacyCapture();
 try{calls.length=0;await synchronizeLibrary(request);expect(calls.filter(path=>path==='/commit')).toHaveLength(2);expect(revision).toBe(committed+1);expect(published().filter(row=>row.table==='annotations')).toHaveLength(0);expect((await readCloudSync())?.status).toBe('synced');}
 finally{restore();}
});

test('an owner-approved removal patches one tombstone without removing unrelated remote facts',async()=>{
 const {personalContentSystem}=await import('../../../apps/web/src/personalContent/system');
 const exampleId=crypto.randomUUID();await personalContentSystem.execute({kind:'set_saved_example',operationId:crypto.randomUUID(),exampleId,saved:true});await synchronizeLibrary(request);
 expect(published().filter(row=>row.table==='annotations')).toHaveLength(1);
 await personalContentSystem.execute({kind:'set_saved_example',operationId:crypto.randomUUID(),exampleId,saved:false});
 const adapter=await sqliteRecordAdapter(),commit=adapter.commit.bind(adapter),patches:NonNullable<Parameters<typeof adapter.commit>[0]['syncBasePatch']>[]=[],spy=vi.spyOn(adapter,'commit').mockImplementation(async mutation=>{if(mutation.syncBaseReplacement!==undefined)throw new Error('removal replaced all baselines');if(mutation.syncBasePatch)patches.push(mutation.syncBasePatch);await commit(mutation);});
 try{await synchronizeLibrary(request);}finally{spy.mockRestore();}
 expect(patches).toHaveLength(1);expect(patches[0]!.puts).toEqual([]);expect(patches[0]!.deletes).toHaveLength(1);
 expect(published().filter(row=>row.table==='annotations')).toHaveLength(0);expect(published().filter(row=>row.table==='drafts')).toHaveLength(256);
});

test('a definite pre-commit history rejection releases its failed receipt without discarding local facts or the baseline',async()=>{
 const first=(await listDrafts())[0]!,before=revision,changed=await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:first.revision,text:'Retained after a definitive rejection.'});
 const base=await readLibrary(tx=>tx.syncBaseEntries()),rejectedIds:string[]=[];
 const rejected:SyncRequest=async(path,body)=>{if(path==='/commit'){rejectedIds.push(librarySyncCommit.parse(body).operationId);throw new Error('library_sync_history');}return request(path,body);};
 await expect(synchronizeLibrary(rejected)).rejects.toThrow('library_sync_history');
 expect(revision).toBe(before);expect((await readCloudSync())?.pending).toBeUndefined();expect((await readCloudSync())?.status).toBe('conflict');
 expect(await readLibrary(tx=>tx.syncBaseEntries())).toEqual(base);expect((await listDrafts()).find(row=>row.id===first.id)).toEqual(changed);
 await synchronizeLibrary(request);expect(revision).toBe(before+1);expect(index.receipts.has(rejectedIds[0]!)).toBe(false);expect((await readCloudSync())?.status).toBe('synced');
});

test('a malformed acknowledgement retains its operation for an idempotent confirmation retry',async()=>{
 const first=(await listDrafts())[0]!;await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:first.revision,text:'A committed but untrusted acknowledgement.'});
 const malformed:SyncRequest=async(path,body)=>{const result=await request(path,body);return path==='/commit'?{...result,receipt:{operationId:(body as any).operationId,requestDigest:'f'.repeat(64)}}:result;};
 await expect(synchronizeLibrary(malformed)).rejects.toThrow('library_sync_format');const committed=revision,pending=(await readCloudSync())?.pending;
 expect(pending).toBeTruthy();calls.length=0;await synchronizeLibrary(request);expect(calls[0]).toBe('/commit');expect(revision).toBe(committed);expect((await readCloudSync())?.pending).toBeUndefined();
});

test('conflict markers and an unknown validation version cannot use an unchanged-head shortcut',async()=>{
 for(const patch of [{status:'conflict' as const},{conflict:{detectedAt:new Date().toISOString(),remoteRevision:revision,remoteManifest:manifest,records:[],affectedRecordIds:[]}},{resolution:{choice:'local' as const,expectedRemoteRevision:revision}},{restoreValidationVersion:undefined},{restoreValidationVersion:libraryRestoreValidationVersion-1}]){
  const state=await readCloudSync();await writeLibraryState(async tx=>tx.put('meta','cloud-sync',{...state,...patch}));
  calls.length=0;const adapter=await sqliteRecordAdapter(),reads=vi.spyOn(adapter,'syncBaseEntries');
  try{await synchronizeLibrary(request);expect(reads.mock.calls.some(([keys])=>keys===undefined)).toBe('restoreValidationVersion' in patch);}finally{reads.mockRestore();}
  if('status'in patch||'conflict'in patch||'resolution'in patch)expect(calls).toContain('/snapshot');
 }
});

test('an old validation marker must pass the complete authority before publication or confirmation',async()=>{
 const validation=await import('../../../apps/web/src/data/library/replication/libraryReplicaValidation');
 for(const restoreValidationVersion of [undefined,libraryRestoreValidationVersion-1]){
  const state=(await readCloudSync())!;await writeLibraryState(async tx=>tx.put('meta','cloud-sync',{...state,restoreValidationVersion}));
  calls.length=0;const beforeRevision=revision;
  const reject=vi.spyOn(validation,'validateLibraryReplicaCooperatively').mockRejectedValue(new Error('libraryBackup.errors.inconsistent'));
  try{await expect(synchronizeLibrary(request)).rejects.toThrow('libraryBackup.errors.inconsistent');expect(reject).toHaveBeenCalled();}finally{reject.mockRestore();}
  expect(calls).not.toContain('/commit');expect(revision).toBe(beforeRevision);
  const rejected=(await readCloudSync())!;expect(rejected.status).not.toBe('synced');expect(rejected.restoreValidationVersion).not.toBe(libraryRestoreValidationVersion);
  await synchronizeLibrary(request);expect((await readCloudSync())?.restoreValidationVersion).toBe(libraryRestoreValidationVersion);
 }
});

test('signout and changed owner or incarnation during a head check cannot confirm convergence',async()=>{
 const state=(await readCloudSync())!,incarnation=await readLibrary(assertCurrentLibrary);
 for(const fault of ['signout','owner','incarnation'] as const){
  hook=async path=>{if(path==='/head')await writeLibraryState(async tx=>{if(fault==='signout')tx.put('meta','signed-out',true);else if(fault==='owner')tx.put('meta','service-owner',{...state.owner,subject:crypto.randomUUID()});else tx.put('meta','local-incarnation',crypto.randomUUID());});};
  try{await expect(synchronizeLibrary(request)).rejects.toThrow();expect((await readCloudSync())?.status).not.toBe('synced');}
  finally{hook=undefined;await writeLibraryState(async tx=>{tx.put('meta','service-owner',state.owner);tx.put('meta','signed-out',false);tx.put('meta','local-incarnation',incarnation);tx.put('meta','cloud-sync',state);});}
 }
 expect(await readLibrary(readLocalLibraryRevision)).toBe(state.syncedLocalRevision);
});
