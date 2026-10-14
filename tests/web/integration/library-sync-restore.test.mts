import {IndexedSyncFixture} from '../support/indexedSyncFixture.mts';
/** Shipped sync over SQLite/Wasm, with SQL faults and controlled transport.
 * This proves restore atomicity, not OPFS durability or large-account capacity. */
import {createHash,randomBytes} from 'node:crypto';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {openLibrary,readLibrary,writeLibraryState,restoreLibraryTransaction,readLocalLibraryRevision,type LibraryIdentity} from '../../../apps/web/src/data/library/store';
import {encodeBackupValue,decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {replicaCandidateAppendRecordLimit,replicaCandidateAppendReferenceLimit} from '../../../apps/web/src/data/library/replicaCandidateProtocol';
import {saveDraft} from '../../../apps/web/src/data/library/drafts';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {librarySyncBlockFetch,librarySyncBlockFetchHashes,librarySyncBlockFetchBytes,librarySyncBlockMissing,librarySyncBlockStore,librarySyncCommit} from '@sensa/contracts/sensa';
import {encodeLibrarySyncBlock,splitLibrarySyncText,decodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
import type {SyncRequest} from '../../../apps/web/src/data/library/cloudSync';
import * as replicaValidation from '../../../apps/web/src/data/library/replication/libraryReplicaValidation';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://restore-atomicity.fixture.invalid/')});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const {synchronizeLibrary,readCloudSync,readCloudReconnectRequired}=await import('../../../apps/web/src/data/library/cloudSync');
let database:Awaited<ReturnType<typeof useNodeLearningCapacityStorage>>,sql:{exec:(statement:string)=>unknown},localIdentity:LibraryIdentity,remoteIdentity:LibraryIdentity;
beforeEach(async()=>{
 database=await useNodeLearningCapacityStorage();sql=Reflect.get(database,'database');
 localIdentity=await openLibrary();remoteIdentity={...localIdentity,id:crypto.randomUUID(),learnerId:crypto.randomUUID()};remoteIdentity.deviceId=remoteIdentity.id;
 await writeLibraryState(async tx=>tx.put('meta','service-owner',{subject:crypto.randomUUID(),accountId:crypto.randomUUID()}));
 blocks.clear();index.clear();revision=0;manifest=[];onFetch=undefined;
});
afterEach(()=>database.close());
const first={id:crypto.randomUUID(),revision:1,text:'A complete cloud draft.',createdAt:'2026-10-08T00:00:00.000Z',updatedAt:'2026-10-08T00:00:00.000Z'};
const second={...first,id:crypto.randomUUID(),text:'Another remote draft.'};
const blocks=new Map<string,string>(),index=new IndexedSyncFixture(blocks);let revision=0,manifest:string[]=[];
function block(text:string){const data=encodeLibrarySyncBlock(text),id=createHash('sha256').update(data).digest('hex');blocks.set(id,data);return id;}
function publish(drafts:typeof first[]){
 const entries=[{table:'meta',key:'identity',value:remoteIdentity},...drafts.map(value=>({table:'drafts',key:value.id,value}))];
 publishEntries(entries);
}
function publishEntries(entries:Array<{table:string;key:string;value:unknown}>){
 const rows=entries.map(row=>({table:row.table,key:row.key,blocks:[block(JSON.stringify(encodeBackupValue(row.value)))]}));
 manifest=splitLibrarySyncText(JSON.stringify({version:8,libraryId:remoteIdentity.id,learnerId:remoteIdentity.learnerId,rows})).map(block);revision++;index.observe(revision,manifest);
}
let onFetch:(()=>Promise<void>)|undefined;
const request:SyncRequest=async(path,body)=>{
 const page=index.page(path,body,revision,manifest);if(page!==undefined)return page;
 if(path==='/blocks/fetch'){
  await onFetch?.();
  const input=librarySyncBlockFetch.parse(body);
  const selected:Array<{hash:string;data:string}>=[],missing:string[]=[],deferred:string[]=[];let bytes=0;
  for(const hash of input.hashes){const data=blocks.get(hash);if(data===undefined){missing.push(hash);continue;}const size=Buffer.byteLength(data);if(selected.length&&bytes+size>librarySyncBlockFetchBytes){deferred.push(hash);continue;}selected.push({hash,data});bytes+=size;}
  return {blocks:selected,missing,deferred};
 }
 throw new Error(`unexpected_restore_request:${path}`);
};
const facts=()=>readLibrary(async tx=>({identity:await tx.get('meta','identity'),creation:await tx.get<{result:LibraryIdentity}>('operations','00000000-0000-4000-8000-000000000001'),drafts:await tx.entries('drafts'),base:await tx.syncBaseEntries(),localRevision:await readLocalLibraryRevision(tx)}));

for(const existing of [false,true])test(`account display metadata is not part of the replica ownership fence (existing checkpoint: ${existing})`,async()=>{
 if(existing){publish([first]);await synchronizeLibrary(request);}
 const account=await readLibrary(tx=>tx.get<{subject:string;accountId:string}>('meta','service-owner'));
 const displayedOwner={...account!,email:'learner@fixture.invalid'};
 await writeLibraryState(async tx=>tx.put('meta','service-owner',displayedOwner));
 publish(existing?[first,second]:[first]);await synchronizeLibrary(request);
 expect((await facts()).drafts.map(row=>row.value)).toEqual(expect.arrayContaining(existing?[first,second]:[first]));
 expect(await readLibrary(tx=>tx.get('meta','service-owner'))).toEqual(displayedOwner);
 expect((await readCloudSync())?.status).toBe('synced');
});

test('remote-only updates reuse unchanged blocks and apply only changed rows without whole body capture',async()=>{
 const drafts=Array.from({length:256},(_,index)=>({...first,id:crypto.randomUUID(),text:`Confirmed draft ${index}: `+'x'.repeat(4000)}));
 publish(drafts);await synchronizeLibrary(request);const before=await facts();
 const unchanged=before.base.filter(row=>row.table==='drafts'&&row.key!==drafts[0]!.id&&row.key!==drafts[1]!.id).flatMap(row=>row.blocks);
 const changed={...drafts[0]!,revision:2,text:'Changed on another device.'},added={...second,id:crypto.randomUUID()};
 publish([changed,...drafts.slice(2),added]);
 sql.exec(`CREATE TEMP TRIGGER unchanged_source BEFORE UPDATE ON sensa_records WHEN OLD.table_name='drafts' AND OLD.record_key<>'${changed.id}' BEGIN SELECT RAISE(ABORT,'unchanged source rewritten'); END`);
 sql.exec(`CREATE TEMP TRIGGER unchanged_base BEFORE UPDATE ON sensa_sync_base WHEN OLD.table_name='drafts' AND OLD.record_key<>'${changed.id}' BEGIN SELECT RAISE(ABORT,'unchanged baseline rewritten'); END`);
 const adapter=await sqliteRecordAdapter(),baseline=database.syncBaseEntries.bind(database),commit=adapter.commit.bind(adapter);
 const sourceRead=vi.spyOn(adapter,'entries').mockImplementation(async()=>{throw Error('whole source capture');});
 const baseRead=vi.spyOn(database,'syncBaseEntries').mockImplementation(keys=>{if(!keys)throw Error('whole baseline capture');return baseline(keys);});
 let update=false;const write=vi.spyOn(adapter,'commit').mockImplementation(async mutation=>{
  if(mutation.replicaCandidateRestore?.update){update=true;expect(mutation.puts.every(row=>row.table==='meta')).toBe(true);expect(mutation.syncBaseReplacement).toBeUndefined();}
  await commit(mutation);
 });
 const fetched:string[]=[];
 try{await synchronizeLibrary(async(path,body)=>{if(path==='/blocks/fetch')fetched.push(...librarySyncBlockFetch.parse(body).hashes);return request(path,body);});}
 finally{sourceRead.mockRestore();baseRead.mockRestore();write.mockRestore();}
 expect(update).toBe(true);expect(fetched.some(hash=>unchanged.includes(hash))).toBe(false);
 const after=await facts();expect(after.localRevision).toBe(before.localRevision+1);expect(after.identity).toEqual(before.identity);
 expect(after.drafts).toHaveLength(256);expect(after.drafts.map(row=>row.value)).toEqual(expect.arrayContaining([changed,added,...drafts.slice(2)]));
 expect(after.base.some(row=>row.key===drafts[1]!.id)).toBe(false);expect((await readCloudSync())?.status).toBe('synced');
});

test('repacked remote facts patch references without a content revision and recover a lost update ACK',async()=>{
 publish([first]);await synchronizeLibrary(request);const before=await facts();
 const entries=[{table:'meta',key:'identity',value:remoteIdentity},{table:'drafts',key:first.id,value:first}];
 const rows=entries.map(row=>({table:row.table,key:row.key,blocks:[block(' '+JSON.stringify(encodeBackupValue(row.value))+' ')]}));
 manifest=splitLibrarySyncText(JSON.stringify({version:8,libraryId:remoteIdentity.id,learnerId:remoteIdentity.learnerId,rows})).map(block);revision++;index.observe(revision,manifest);
 sql.exec(`CREATE TEMP TRIGGER repack_no_source_write BEFORE INSERT ON sensa_records WHEN NEW.table_name='drafts' BEGIN SELECT RAISE(ABORT,'repack rewrote source'); END`);
 const adapter=await sqliteRecordAdapter(),commit=adapter.commit.bind(adapter);let lost=false;
 adapter.commit=async mutation=>{await commit(mutation);if(mutation.replicaCandidateRestore?.update){expect(mutation.contentRevision).toBeUndefined();lost=true;throw Error('sqlite_coordination_timeout');}};
 try{await synchronizeLibrary(request);}finally{adapter.commit=commit;}
 expect(lost).toBe(true);const after=await facts();expect(after.drafts).toEqual(before.drafts);expect(after.localRevision).toBe(before.localRevision);
 expect(after.base.find(row=>row.table==='drafts')?.blocks).toEqual(rows[1]!.blocks);expect((await readCloudSync())?.status).toBe('synced');
});

for(const target of ['source','baseline'] as const)test(`a failed remote-only ${target} write rolls back the whole update and retries`,async()=>{
 publish([first]);await synchronizeLibrary(request);const before=await facts(),changed={...first,revision:2,text:'A remote replacement.'};publish([changed,second]);
 const table=target==='source'?'sensa_records':'sensa_sync_base';
 sql.exec(`CREATE TEMP TRIGGER reject_update BEFORE INSERT ON ${table} WHEN NEW.table_name='drafts' AND NEW.record_key='${second.id}' BEGIN SELECT RAISE(ABORT,'controlled update failure'); END`);
 await expect(synchronizeLibrary(request)).rejects.toThrow();expect(await facts()).toEqual(before);expect((await readCloudSync())?.status).not.toBe('synced');
 sql.exec('DROP TRIGGER reject_update');await synchronizeLibrary(request);
 expect((await facts()).drafts.map(row=>row.value)).toEqual(expect.arrayContaining([changed,second]));expect((await readCloudSync())?.status).toBe('synced');
});

test('a genuine local write after Worker preparation retires the remote-only update',async()=>{
 publish([first]);await synchronizeLibrary(request);const before=await facts();publish([{...first,revision:2,text:'Remote edit.'}]);
 const adapter=await sqliteRecordAdapter(),candidate=adapter.replicaCandidate.bind(adapter);let wrote=false;
 adapter.replicaCandidate=async message=>{
  const result=await candidate(message);
  if(result.kind==='updatePrepared'&&result.update&&!wrote){wrote=true;await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:1,text:'New local edit during synchronization.'});}
  return result;
 };
 try{await expect(synchronizeLibrary(request)).rejects.toThrow('library_sync_local_changed');}finally{adapter.replicaCandidate=candidate;}
 expect(wrote).toBe(true);const after=await facts();expect(after.base).toEqual(before.base);expect(after.drafts[0]!.value.text).toBe('New local edit during synchronization.');expect((await readCloudSync())?.status).toBe('pending');
});

test('remote-only Meaning updates preserve pinned versions and never import rewritten immutable history',async()=>{
 const [{MemoryJourneyRepository},{createJourneyModules},{createSeededClock},{semanticLookupPayload,syntheticSemanticWorld,advanceSemanticHeads},{semanticRecords}]=await Promise.all([
  import('../../../apps/web/src/experience/personalMeaningJourney/repository'),import('../../../apps/web/src/experience/personalMeaningJourney/gateway'),import('../../../apps/web/src/experience/personalMeaningJourney/ports'),import('../support/semanticLookupFixtures'),import('../support/semanticWorldRecordFixture.mts'),
 ]);
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository,clock:createSeededClock('2026-10-03T00:00:00Z')}).semanticIntake.submit(semanticLookupPayload());
 const original=syntheticSemanticWorld(await repository.load(),4),advanced=advanceSemanticHeads(original);
 const publishWorld=(world:typeof original)=>publishEntries([{table:'meta',key:'identity',value:remoteIdentity},...[...semanticRecords(world)]]);
 publishWorld(original);await synchronizeLibrary(request);const before=await facts();
 const adapter=await sqliteRecordAdapter(),candidate=adapter.replicaCandidate.bind(adapter);const prepared:boolean[]=[];
 adapter.replicaCandidate=async message=>{const result=await candidate(message);if(result.kind==='updatePrepared')prepared.push(result.update!==null);return result;};
 try{
  publishWorld(advanced);await synchronizeLibrary(request);expect(prepared).toEqual([true]);
  const oldVersion=original.registry.senseVersions[0]!,oldKey=`senseVersions:${oldVersion.senseVersionId}`;
  expect(decodeBackupValue(JSON.parse(database.get('semanticRegistry',oldKey)!)).value).toEqual(oldVersion);
  expect(database.lookupMeanings('借用编号0').meanings).toHaveLength(1);
  expect((await facts()).localRevision).toBe(before.localRevision+1);
  const broken=structuredClone(advanced);broken.registry.senseVersions[0]!.semanticSpec.coreMeaningFocus='Rewritten immutable version.';
  // The remote graph is structurally valid; it is the transition against the
  // confirmed baseline that must reject this rewrite, not snapshot validation.
  await replicaValidation.validateLibraryReplicaCooperatively([{table:'meta',key:'identity',value:encodeBackupValue(remoteIdentity)},...[...semanticRecords(broken)].map(row=>({...row,value:encodeBackupValue(row.value)}))]);
  publishWorld(broken);await synchronizeLibrary(request);
  expect(prepared).toEqual([true,false]);expect((await readCloudSync())?.status).toBe('conflict');
  expect(decodeBackupValue(JSON.parse(database.get('semanticRegistry',oldKey)!)).value).toEqual(oldVersion);
 }finally{adapter.replicaCandidate=candidate;}
});

for(const concurrentWrite of [false,true])test(`failed conflict validation fences its captured local revision (concurrent write: ${concurrentWrite})`,async()=>{
 remoteIdentity={...localIdentity,deviceId:localIdentity.id};publish([first]);await synchronizeLibrary(request);
 const ours=await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:1,text:'Local conflicting edit.'});
 publish([{...first,revision:2,text:'Remote conflicting edit.'}]);
 const before=await facts();let later:Awaited<ReturnType<typeof saveDraft>>|undefined;
 const validate=replicaValidation.validateLibraryReplicaCooperatively;
 const validation=vi.spyOn(replicaValidation,'validateLibraryReplicaCooperatively').mockImplementationOnce(validate).mockImplementationOnce(async()=>{
  if(concurrentWrite)later=await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Saved while conflict validation yielded.'});
  throw Error('controlled_conflicting_graph_failure');
 });
 try{
  if(concurrentWrite)await expect(synchronizeLibrary(request)).rejects.toThrow('library_sync_local_changed');
  else await synchronizeLibrary(request);
 }
 finally{validation.mockRestore();}
 const after=await facts();expect(after.base).toEqual(before.base);
 const state=await readCloudSync();
 if(concurrentWrite){
  expect(later).toBeDefined();expect(after.drafts.map(row=>row.value)).toEqual(expect.arrayContaining([ours,later]));
  expect(after.localRevision).toBe(before.localRevision+1);
  expect(state?.status).toBe('pending');expect(state?.conflict).toBeUndefined();
 }else{
  expect(after.drafts.map(row=>row.value)).toEqual([ours]);expect(after.localRevision).toBe(before.localRevision);
  expect(state?.status).toBe('conflict');expect(state?.conflict).toBeDefined();
 }
});

test('publishing unrelated facts persists the comparison head before final status confirmation',async()=>{
 remoteIdentity={...localIdentity,deviceId:localIdentity.id};publish([first]);await synchronizeLibrary(request);
 await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:1,text:'Local conflicting edit.'});
 await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Independent new context.'});
 publish([{...first,revision:2,text:'Remote conflicting edit.'}]);
 const transport:SyncRequest=async(path,body)=>{
  if(path==='/blocks/missing')return {missing:librarySyncBlockMissing.parse(body).hashes.filter(hash=>!blocks.has(hash))};
  if(path==='/blocks/store'){for(const row of librarySyncBlockStore.parse(body).blocks)blocks.set(row.hash,row.data);return {stored:true};}
  if(path==='/commit'){const result=index.commit(body,revision,manifest);manifest=result.manifest!;revision=result.revision;return result.head;}
  return request(path,body);
 };
 const adapter=await sqliteRecordAdapter(),commit=adapter.commit.bind(adapter);let failed=false;
 const spy=vi.spyOn(adapter,'commit').mockImplementation(async mutation=>{
  const row=mutation.puts.find(row=>row.table==='meta'&&row.key==='cloud-sync');
  const state=row?decodeBackupValue(JSON.parse(row.encodedValue)):null;
  if(!failed&&state?.status==='conflict'&&!state.syncStartedAt&&!mutation.syncBaseReplacement){failed=true;throw Error('final_status_write_failed');}
  return commit(mutation);
 });
 try{await expect(synchronizeLibrary(transport)).rejects.toThrow('localFlow.storageWrite');}finally{spy.mockRestore();}
 expect(failed).toBe(true);const state=(await readCloudSync())!;
 expect(state.revision).toBe(revision);expect(state.conflict?.remoteRevision).toBe(revision);expect(state.conflict?.remoteManifest).toEqual(index.head(revision,manifest).manifest);
 expect((await facts()).drafts.map(row=>(row.value as any).text)).toEqual(expect.arrayContaining(['Local conflicting edit.','Independent new context.']));
 await synchronizeLibrary(transport);expect((await readCloudSync())?.status).toBe('conflict');
});

for(const pageLimit of [librarySyncBlockFetchBytes,2048])test(`fresh restoration consumes API byte pages without a fixed 64-block roundtrip limit (${pageLimit})`,async()=>{
 const drafts=Array.from({length:1024},(_,index)=>({...first,id:crypto.randomUUID(),text:`Small remote draft ${index}`}));publish(drafts);
 const requested:number[]=[];let deferredReplies=0;const delivered=new Map<string,number>();
 const transport:SyncRequest=async(path,body)=>{
  if(path!=='/blocks/fetch')return request(path,body);
  const {hashes}=librarySyncBlockFetch.parse(body);requested.push(hashes.length);
  let bytes=0;const selected:string[]=[],deferred:string[]=[];
  for(const hash of hashes){const size=Buffer.byteLength(blocks.get(hash)!);if(selected.length&&bytes+size>pageLimit){deferred.push(hash);continue;}selected.push(hash);bytes+=size;}
  if(deferred.length)deferredReplies++;
  for(const hash of selected)delivered.set(hash,(delivered.get(hash)??0)+1);
  return {blocks:selected.map(hash=>({hash,data:blocks.get(hash)!})),missing:[],deferred};
 };
 await synchronizeLibrary(transport);
 expect(Math.max(...requested)).toBe(librarySyncBlockFetchHashes);
 if(pageLimit===librarySyncBlockFetchBytes){expect(requested).toHaveLength(3);expect(deferredReplies).toBe(0);}
 else expect(deferredReplies).toBeGreaterThan(0);
 expect([...delivered.values()].every(count=>count===1)).toBe(true);
 expect(await readLibrary(tx=>tx.count('drafts'))).toBe(drafts.length);expect(await readLibrary(tx=>tx.get('drafts',drafts.at(-1)!.id))).toEqual(drafts.at(-1));
 expect((await readCloudSync())?.status).toBe('synced');
});

test('byte-deferred shared bodies preserve future prefetch hashes until their final reference',async()=>{
 const shared='data:audio/wav;base64,'+randomBytes(4096).toString('base64');
 const drafts=Array.from({length:40},()=>({...first,id:crypto.randomUUID(),text:shared}));
 const rows=[{table:'meta',key:'identity',value:remoteIdentity},...drafts.map(value=>({table:'drafts',key:value.id,value}))].map(row=>{
  const text=JSON.stringify(encodeBackupValue(row.value)),at=text.indexOf(shared);
  const parts=at<0?[text]:[text.slice(0,at),shared,text.slice(at+shared.length)];
  return {table:row.table,key:row.key,blocks:parts.flatMap(part=>splitLibrarySyncText(part).map(block))};
 });
 manifest=splitLibrarySyncText(JSON.stringify({version:8,libraryId:remoteIdentity.id,learnerId:remoteIdentity.learnerId,rows})).map(block);revision++;index.observe(revision,manifest);
 const delivered=new Map<string,number>();let deferredPages=0;
 await synchronizeLibrary(async(path,body)=>{
  if(path!=='/blocks/fetch')return request(path,body);
  const {hashes}=librarySyncBlockFetch.parse(body),selected:Array<{hash:string;data:string}>=[],deferred:string[]=[];let bytes=0;
  for(const hash of hashes){const data=blocks.get(hash)!,size=Buffer.byteLength(data);if(selected.length&&bytes+size>2048){deferred.push(hash);continue;}selected.push({hash,data});bytes+=size;delivered.set(hash,(delivered.get(hash)??0)+1);}
  if(deferred.length)deferredPages++;
  return {blocks:selected,missing:[],deferred};
 });
 expect(deferredPages).toBeGreaterThan(0);expect([...delivered.values()].every(count=>count===1)).toBe(true);
 expect((await facts()).drafts.map(row=>row.value)).toEqual(expect.arrayContaining(drafts));expect((await readCloudSync())?.status).toBe('synced');
});

test('an oversized prefetch response is rejected without adopting any remote identity or facts',async()=>{
 const drafts=Array.from({length:400},()=>({...first,id:crypto.randomUUID(),text:randomBytes(13500).toString('base64')}));publish(drafts);
 const before=await facts();
 const oversized:SyncRequest=async(path,body)=>{
  if(path!=='/blocks/fetch')return request(path,body);
  const {hashes}=librarySyncBlockFetch.parse(body);return {blocks:hashes.map(hash=>({hash,data:blocks.get(hash)!})),missing:[],deferred:[]};
 };
 await expect(synchronizeLibrary(oversized)).rejects.toThrow('library_sync_format');
 expect(await facts()).toEqual(before);expect((await readCloudSync())?.status).not.toBe('synced');
});

for(const path of ['staged','fallback'] as const)test(`a cleared device waits for explicit reconnect through ${path} restoration`,async()=>{
 // Persisted post-clear state; the actual clear + page reload is exercised by
 // the Chromium/Postgres UI test rather than simulated by resetting JS globals.
 await writeLibraryState(async tx=>tx.put('meta','local-reset','local-clear'));
 publish([first]);const before=await facts();let requests=0;
 const transport:SyncRequest=async(...args)=>{requests++;return request(...args);};
 const adapter=await sqliteRecordAdapter(),candidate=adapter.replicaCandidate.bind(adapter);
 if(path==='fallback')adapter.replicaCandidate=async()=>{throw Error('sqlite_replica_candidate_unavailable');};
 try{
  await synchronizeLibrary(transport);expect(requests).toBe(0);expect(await facts()).toEqual(before);expect(await readCloudSync()).toBeUndefined();
  expect(await readCloudReconnectRequired()).toBe(true);
  await synchronizeLibrary(transport,{restoreAfterLocalClear:true});
  expect(requests).toBeGreaterThan(0);expect((await facts()).identity).toEqual({...remoteIdentity,deviceId:localIdentity.deviceId});
  expect((await facts()).drafts.map(row=>row.value)).toEqual([first]);expect((await readCloudSync())?.status).toBe('synced');
  expect(await readCloudReconnectRequired()).toBe(false);
 }finally{adapter.replicaCandidate=candidate;}
});

test('a failed explicit promotion keeps the reconnect intent and automatic retry cannot restore its old Cloud facts',async()=>{
 await writeLibraryState(async tx=>tx.put('meta','local-reset','local-clear'));publish([first]);const before=await facts();
 sql.exec(`CREATE TEMP TRIGGER deny_cleared_fact BEFORE INSERT ON sensa_records WHEN NEW.table_name='drafts' BEGIN SELECT RAISE(ABORT,'fixture reconnect fact rejected'); END`);
 try{await expect(synchronizeLibrary(request,{restoreAfterLocalClear:true})).rejects.toThrow();}finally{sql.exec('DROP TRIGGER deny_cleared_fact');}
 expect(await facts()).toEqual(before);expect(await readCloudReconnectRequired()).toBe(true);
 let requests=0;await synchronizeLibrary(async(...args)=>{requests++;return request(...args);});expect(requests).toBe(0);expect(await facts()).toEqual(before);
 await synchronizeLibrary(request,{restoreAfterLocalClear:true});expect(await readCloudReconnectRequired()).toBe(false);expect((await facts()).drafts.map(row=>row.value)).toEqual([first]);
});

test('explicit reconnect to an empty account consumes the pause without inventing facts or a content revision',async()=>{
 await writeLibraryState(async tx=>tx.put('meta','local-reset','local-clear'));const before=await facts();
 await synchronizeLibrary(async path=>{expect(path).toBe('/head');return {revision:0,manifest:null};},{restoreAfterLocalClear:true});
 expect(await readCloudReconnectRequired()).toBe(false);expect((await readCloudSync())?.status).toBe('synced');expect(await facts()).toEqual(before);
});

test('explicit reconnect cannot overwrite new local content created after a device clear',async()=>{
 await writeLibraryState(async tx=>tx.put('meta','local-reset','local-clear'));
 await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'New work in the cleared local world.'});publish([first]);const before=await facts();
 await expect(synchronizeLibrary(request,{restoreAfterLocalClear:true})).rejects.toThrow('library_sync_identity');
 expect(await facts()).toEqual(before);expect(await readCloudReconnectRequired()).toBe(true);expect((await readCloudSync())?.status).toBe('conflict');
});

test('a failed baseline write cannot partially restore cloud identity or learner facts',async()=>{
 publish([first]);const before=await facts();
 sql.exec(`CREATE TEMP TRIGGER deny_restore_baseline BEFORE INSERT ON sensa_sync_base WHEN NEW.record_key='${first.id}' BEGIN SELECT RAISE(ABORT,'controlled restore baseline failure'); END`);
 try{await expect(synchronizeLibrary(request)).rejects.toThrow();}finally{sql.exec('DROP TRIGGER deny_restore_baseline');}
 expect(await facts()).toEqual(before);
 expect((await readCloudSync())?.revision??0).toBe(0);expect((await readCloudSync())?.status).not.toBe('synced');
 await synchronizeLibrary(request);
 const restored=await facts();expect(restored.identity).toEqual({...remoteIdentity,deviceId:localIdentity.deviceId});
 expect(restored.creation?.result).toEqual(restored.identity);expect(restored.drafts.map(row=>row.value)).toEqual([first]);
 expect(restored.base).toHaveLength(2);expect((await readCloudSync())?.revision).toBe(1);expect((await readCloudSync())?.status).toBe('synced');
});

test('a failed learner-fact write rolls back the replacement baseline and remote revision too',async()=>{
 publish([first]);await synchronizeLibrary(request);
 publish([first,second]);const before=await facts();
 sql.exec(`CREATE TEMP TRIGGER deny_restore_fact BEFORE INSERT ON sensa_records WHEN NEW.table_name='drafts' AND NEW.record_key='${second.id}' BEGIN SELECT RAISE(ABORT,'controlled restore fact failure'); END`);
 try{await expect(synchronizeLibrary(request)).rejects.toThrow();}finally{sql.exec('DROP TRIGGER deny_restore_fact');}
 expect(await facts()).toEqual(before);expect((await readCloudSync())?.revision).toBe(1);
 await synchronizeLibrary(request);expect((await facts()).drafts).toHaveLength(2);expect((await readCloudSync())?.revision).toBe(2);expect((await readCloudSync())?.status).toBe('synced');
});

test('a local write during remote download preserves the old baseline and rejects the stale restore',async()=>{
 publish([first,second]);await synchronizeLibrary(request);
 const third={...first,id:crypto.randomUUID(),text:'Must not appear before a current restore.'};publish([first,second,third]);
 const before=await facts(),confirmedRevision=(await readCloudSync())?.revision;let wrote=false;
 onFetch=async()=>{if(wrote)return;wrote=true;await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:1,text:'Kept while the remote download was in flight.'});};
 try{await expect(synchronizeLibrary(request)).rejects.toThrow('library_sync_local_changed');}finally{onFetch=undefined;}
 const after=await facts();expect(wrote).toBe(true);expect(after.identity).toEqual(before.identity);expect(after.base).toEqual(before.base);
 expect(after.drafts).toHaveLength(2);expect(after.drafts.find(row=>row.key===first.id)?.value.text).toBe('Kept while the remote download was in flight.');
 expect((await readCloudSync())?.revision).toBe(confirmedRevision);expect((await readCloudSync())?.status).toBe('pending');
});

test('an unchanged fallback checkpoint does not reread baseline bodies while applying or confirming it',async()=>{
 // Force the complete validation fallback. Integrity checks remain;
 // redundant captures and manufactured content changes do not.
 publish([first]);await synchronizeLibrary(request);
 const state=(await readCloudSync())!;await writeLibraryState(async tx=>tx.put('meta','cloud-sync',{...state,restoreValidationVersion:undefined}));
 const adapter=await sqliteRecordAdapter(),original=adapter.syncBaseEntries.bind(adapter);let fullReads=0;
 adapter.syncBaseEntries=async keys=>{if(keys===undefined)fullReads++;return original(keys);};
 const before=await readLibrary(readLocalLibraryRevision);
 try{await synchronizeLibrary(request);}finally{adapter.syncBaseEntries=original;}
 expect(fullReads).toBe(1);expect(await readLibrary(readLocalLibraryRevision)).toBe(before);expect((await readCloudSync())?.status).toBe('synced');
});

test('a learner write after the atomic restore stays local and pending when sync finishes',async()=>{
 publish([first]);let later:ReturnType<typeof saveDraft>|undefined;
 const write=(event:Event)=>{
  if(!(event as CustomEvent).detail?.tables?.includes('drafts'))return;
  window.removeEventListener('sensa-library-changed',write);
  later=saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:1,text:'New input after the restore committed.'});
 };
 window.addEventListener('sensa-library-changed',write);
 try{await synchronizeLibrary(request);await later;}finally{window.removeEventListener('sensa-library-changed',write);}
 expect(later).toBeTruthy();const after=await facts();expect(after.drafts[0]?.value.text).toBe('New input after the restore committed.');
 const original=after.base.find(row=>row.table==='drafts');expect(original?.value).toEqual(encodeBackupValue(first));
 expect((await readCloudSync())?.status).toBe('pending');expect((await readCloudSync())?.syncedLocalRevision).not.toBe(after.localRevision);
});

test('fresh staged restore above 64 MiB never captures whole source or baseline bodies',async()=>{
 const drafts=Array.from({length:5000},(_,index)=>({...first,id:crypto.randomUUID(),text:`Synthetic remote draft ${index}: `+'x'.repeat(15000)}));publish(drafts);
 const adapter=await sqliteRecordAdapter(),entries=adapter.entries.bind(adapter),base=adapter.syncBaseEntries.bind(adapter),candidate=adapter.replicaCandidate.bind(adapter);
 let appends=0,logicalBytes=0,maxBatchBytes=0,maxRecords=0;
 adapter.entries=async()=>{throw Error('Unexpected complete source capture');};
 adapter.syncBaseEntries=async keys=>{if(keys===undefined)throw Error('Unexpected complete baseline capture');return base(keys);};
 adapter.replicaCandidate=async message=>{
  if(message.kind==='append'){
   const bytes=message.records.reduce((sum,row)=>sum+Buffer.byteLength(row.valueJson,'utf8'),0);
   appends++;logicalBytes+=bytes;maxBatchBytes=Math.max(maxBatchBytes,bytes);maxRecords=Math.max(maxRecords,message.records.length);
  }
  return candidate(message);
 };
 try{await synchronizeLibrary(request);}finally{adapter.entries=entries;adapter.syncBaseEntries=base;adapter.replicaCandidate=candidate;}
 expect(logicalBytes).toBeGreaterThan(64*1024*1024);expect(maxBatchBytes).toBeLessThanOrEqual(4*1024*1024);expect(maxRecords).toBeLessThanOrEqual(replicaCandidateAppendRecordLimit);expect(appends).toBeGreaterThan(1);
 expect(await readLibrary(tx=>tx.count('drafts'))).toBe(drafts.length);
 expect(await readLibrary(tx=>tx.get('drafts',drafts[0]!.id))).toEqual(drafts[0]);
 expect(await readLibrary(tx=>tx.get('drafts',drafts.at(-1)!.id))).toEqual(drafts.at(-1));
 expect(await readLibrary(tx=>tx.get('meta','identity'))).toEqual({...remoteIdentity,deviceId:localIdentity.deviceId});
 expect((await readCloudSync())?.status).toBe('synced');
});

test('a fresh staged source write failure rolls back identity, baseline and creation receipt',async()=>{
 publish([first,second]);const before=await facts();
 sql.exec(`CREATE TEMP TRIGGER deny_fresh_fact BEFORE INSERT ON sensa_records WHEN NEW.table_name='drafts' AND NEW.record_key='${second.id}' BEGIN SELECT RAISE(ABORT,'controlled fresh fact failure'); END`);
 try{await expect(synchronizeLibrary(request)).rejects.toThrow();}finally{sql.exec('DROP TRIGGER deny_fresh_fact');}
 expect(await facts()).toEqual(before);expect((await readCloudSync())?.status).not.toBe('synced');
 await synchronizeLibrary(request);expect((await facts()).drafts).toHaveLength(2);expect((await readCloudSync())?.status).toBe('synced');
});

test('an unchanged identity-only checkpoint does not manufacture a content revision',async()=>{
 remoteIdentity={...localIdentity,deviceId:localIdentity.id};publish([]);
 const before=await readLibrary(readLocalLibraryRevision);await synchronizeLibrary(request);
 expect(await readLibrary(readLocalLibraryRevision)).toBe(before);expect((await readCloudSync())?.status).toBe('synced');
});

test('a same-library identity fork still requires explicit conflict handling',async()=>{
 remoteIdentity={...localIdentity,learnerId:crypto.randomUUID(),deviceId:localIdentity.id};publish([first]);
 await synchronizeLibrary(request);
 expect(await readLibrary(tx=>tx.get('meta','identity'))).toEqual(localIdentity);expect((await readCloudSync())?.status).toBe('conflict');
});

for(const existing of [false,true])test(`a missing body after head replacement discards the old generation (existing checkpoint: ${existing})`,async()=>{
 if(existing){publish([first]);await synchronizeLibrary(request);}
 publish(existing?[first,second]:[first]);let fetches=0;const latest={...second,text:'New head after retiring the old body.'};
 onFetch=async()=>{if(++fetches===1){blocks.clear();index.compact(revision+1);publish([latest]);}};
 try{await synchronizeLibrary(request);}finally{onFetch=undefined;}
 const after=await facts();expect(after.drafts.map(row=>row.value)).toEqual([latest]);expect((await readCloudSync())?.revision).toBe(existing?3:2);expect((await readCloudSync())?.status).toBe('synced');
});

test('a lost local promotion ACK uses the durable transaction receipt and still announces restored facts',async()=>{
 publish([first]);const adapter=await sqliteRecordAdapter(),commit=adapter.commit.bind(adapter);let replayed=false,announced=false;
 const changed=(event:Event)=>{if((event as CustomEvent).detail?.tables?.includes('drafts'))announced=true;};window.addEventListener('sensa-library-changed',changed);
 adapter.commit=async mutation=>{
  await commit(mutation);
  if(mutation.replicaCandidateRestore&&!replayed){replayed=true;await expect(commit(mutation)).rejects.toThrow('library_sync_candidate_invalid');throw Error('sqlite_coordination_timeout');}
 };
 try{await synchronizeLibrary(request);}finally{adapter.commit=commit;window.removeEventListener('sensa-library-changed',changed);}
 expect(replayed).toBe(true);expect(announced).toBe(true);expect((await facts()).drafts.map(row=>row.value)).toEqual([first]);expect((await readCloudSync())?.status).toBe('synced');
});

test('a legal row with over 512 unique fragments proves in batches before its body is appended',async()=>{
 const setting=Array.from({length:1000},(_,index)=>`fragment:${String(index).padStart(4,'0')};`).join(''),wire=JSON.stringify(encodeBackupValue(setting)),refs:string[]=[];
 for(let at=0;at<wire.length;at+=16)refs.push(block(wire.slice(at,at+16)));
 expect(new Set(refs).size).toBeGreaterThan(512);expect(refs.length).toBeLessThanOrEqual(2048);
 const rows=[{table:'meta',key:'identity',blocks:[block(JSON.stringify(encodeBackupValue(remoteIdentity)))]},{table:'settings',key:'fragmented-opaque',blocks:refs}];
 manifest=splitLibrarySyncText(JSON.stringify({version:8,libraryId:remoteIdentity.id,learnerId:remoteIdentity.learnerId,rows})).map(block);revision++;index.observe(revision,manifest);
 const adapter=await sqliteRecordAdapter(),original=adapter.replicaCandidate.bind(adapter);let proofs=0;
 adapter.replicaCandidate=async message=>{if(message.kind==='prove')proofs++;return original(message);};
 try{await synchronizeLibrary(request);}finally{adapter.replicaCandidate=original;}
 expect(proofs).toBeGreaterThanOrEqual(2);expect(await readLibrary(tx=>tx.get('settings','fragmented-opaque'))).toBe(setting);expect((await readCloudSync())?.status).toBe('synced');
});

test('dense repeated fragments split by total reference work without changing their order or values',async()=>{
 const settings=Array.from({length:3},(_,index)=>({key:`dense-fragments-${index}`,value:`Exact private value ${index}.`}));
 const refsByKey=new Map<string,string[]>();
 const rows=[{table:'meta',key:'identity',blocks:[block(JSON.stringify(encodeBackupValue(remoteIdentity)))]},...settings.map(setting=>{
  const wire=JSON.stringify(encodeBackupValue(setting.value)),refs=[block('['),...Array.from({length:2046},()=>block(' ')),block(wire.slice(1))];refsByKey.set(setting.key,refs);return {table:'settings',key:setting.key,blocks:refs};
 })];
 manifest=splitLibrarySyncText(JSON.stringify({version:8,libraryId:remoteIdentity.id,learnerId:remoteIdentity.learnerId,rows})).map(block);revision++;index.observe(revision,manifest);
 const adapter=await sqliteRecordAdapter(),original=adapter.replicaCandidate.bind(adapter);let appends=0,maximumReferences=0;
 adapter.replicaCandidate=async message=>{if(message.kind==='append'){appends++;maximumReferences=Math.max(maximumReferences,message.records.reduce((sum,row)=>sum+row.blockRefs.length,0));}return original(message);};
 try{await synchronizeLibrary(request);}finally{adapter.replicaCandidate=original;}
 expect(appends).toBeGreaterThan(1);expect(maximumReferences).toBeLessThanOrEqual(replicaCandidateAppendReferenceLimit);
 const references=await readLibrary(tx=>tx.syncBaseReferences());
 for(const setting of settings){expect(await readLibrary(tx=>tx.get('settings',setting.key))).toBe(setting.value);expect(references.find(row=>row.table==='settings'&&row.key===setting.key)?.blockRefs).toEqual(refsByKey.get(setting.key));}
 expect((await readCloudSync())?.status).toBe('synced');
});

for(const kind of ['compressed','high-entropy'] as const)test(`large ${kind} single-row proofs stay within raw and decoded batch budgets`,async()=>{
 let setting:string;
 if(kind==='compressed')setting=Array.from({length:21},(_,index)=>String.fromCharCode(65+index).repeat(262144)).join('');
 else{
  const bytes=Buffer.alloc(6*1024*1024),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let word=123456789;
  for(let index=0;index<bytes.length;index++){word^=word<<13;word^=word>>>17;word^=word<<5;bytes[index]=alphabet.charCodeAt(word>>>26);}setting=bytes.toString('ascii');
 }
 const refs=splitLibrarySyncText(JSON.stringify(encodeBackupValue(setting))).map(block);
 const rows=[{table:'meta',key:'identity',blocks:[block(JSON.stringify(encodeBackupValue(remoteIdentity)))]},{table:'settings',key:'large-opaque',blocks:refs}];
 manifest=splitLibrarySyncText(JSON.stringify({version:8,libraryId:remoteIdentity.id,learnerId:remoteIdentity.learnerId,rows})).map(block);revision++;index.observe(revision,manifest);
 const adapter=await sqliteRecordAdapter(),original=adapter.replicaCandidate.bind(adapter);let proofs=0;
 adapter.replicaCandidate=async message=>{
  if(message.kind==='prove'){
   proofs++;expect(message.blocks.length).toBeLessThanOrEqual(512);
   expect(message.blocks.reduce((sum,row)=>sum+Buffer.byteLength(row.data,'utf8'),0)).toBeLessThanOrEqual(4*1024*1024);
   expect(message.blocks.reduce((sum,row)=>sum+Buffer.byteLength(decodeLibrarySyncBlock(row.data),'utf8'),0)).toBeLessThanOrEqual(4*1024*1024);
  }
  return original(message);
 };
 try{await synchronizeLibrary(request);}finally{adapter.replicaCandidate=original;}
 expect(proofs).toBeGreaterThanOrEqual(2);expect(await readLibrary(tx=>tx.get('settings','large-opaque'))).toBe(setting);expect((await readCloudSync())?.status).toBe('synced');
});

test('a pre-checkpoint local deletion is not resurrected by fresh promotion or a conflicted fallback retry',async()=>{
 const {clearLocalLibrary,inspectLocalClear}=await import('../../../apps/web/src/data/library/dataControl');
 await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:0,text:'Locally discarded material.'});
 await restoreLibraryTransaction(async tx=>tx.delete('drafts',first.id));publish([first]);const before=await facts();
 for(let attempt=0;attempt<2;attempt++){
  // Attempt two takes the existing-world fallback because the first operation
  // is now conflicted; neither application seam may erase the deletion witness.
  await expect(synchronizeLibrary(request)).rejects.toThrow();expect(await facts()).toEqual(before);expect((await readCloudSync())?.status).toBe('conflict');expect((await readCloudSync())?.error).toBe('library_sync_history');
 }
 const preview=await inspectLocalClear();await clearLocalLibrary(preview);
 expect(database.syncBaseEntries()).toEqual([]);expect(database.changesSince(0,['drafts'])).toEqual([]);expect(database.count('drafts')).toBe(0);
 // The product asks the old page to reopen after an explicit new incarnation.
 await expect(synchronizeLibrary(request)).rejects.toThrow('localFlow.libraryReplaced');
});

test('copied accepted Meanings retain every fact and Registry lookup through compressed-source cold index rebuild',async()=>{
 const [{MemoryJourneyRepository},{createJourneyModules},{createSeededClock},{semanticLookupPayload,syntheticSemanticWorld},{semanticRecords},{default:sqlite3InitModule},{SqliteRecordDatabase},{sqliteLibrarySchema}]=await Promise.all([
  import('../../../apps/web/src/experience/personalMeaningJourney/repository'),import('../../../apps/web/src/experience/personalMeaningJourney/gateway'),import('../../../apps/web/src/experience/personalMeaningJourney/ports'),import('../support/semanticLookupFixtures'),import('../support/semanticWorldRecordFixture.mts'),import('@sqlite.org/sqlite-wasm'),import('../../../apps/web/src/data/library/sqliteDatabase'),import('../../../apps/web/src/data/library/sqliteProtocol'),
 ]);
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository,clock:createSeededClock('2026-10-03T00:00:00Z')}).semanticIntake.submit(semanticLookupPayload());
 const world=syntheticSemanticWorld(await repository.load(),16);remoteIdentity={...localIdentity,deviceId:localIdentity.id};
 publishEntries([{table:'meta',key:'identity',value:remoteIdentity},...[...semanticRecords(world)]]);await synchronizeLibrary(request);
 const firstMeaning=world.meanings[0]!,sense=world.registry.senses[0]!,expectedKey=`senses:${sense.senseId}`,wire=JSON.stringify(encodeBackupValue([...semanticRecords(world)].find(row=>row.table==='semanticMeanings'&&row.key===firstMeaning.personalMeaning.personalMeaningId)!.value));
 expect(database.get('semanticMeanings',firstMeaning.personalMeaning.personalMeaningId)).toBe(wire);expect(database.count('semanticMeanings')).toBe(16);
 expect(database.registrySelection({kind:'senseKey',senseKey:sense.senseKey}).keys).toEqual([expectedKey]);expect(database.lookupMeanings('借用编号0').meanings).toHaveLength(1);
 const source=Reflect.get(database,'database') as import('@sqlite.org/sqlite-wasm').Database;
 const stored=source.exec({sql:'SELECT * FROM sensa_records ORDER BY table_name,record_key',rowMode:'object',returnValue:'resultRows'}) as Array<{table_name:string;record_key:string;value_json:string;content_revision:number}>;
 expect(stored.find(row=>row.record_key===firstMeaning.personalMeaning.personalMeaningId)!.value_json.length).toBeLessThan(wire.length);
 const baseline=source.exec({sql:'SELECT * FROM sensa_sync_base ORDER BY table_name,record_key',rowMode:'object',returnValue:'resultRows'}) as Array<{table_name:string;record_key:string;value_json:string;block_refs_json:string}>;
 const sqlite=await sqlite3InitModule(),raw=new sqlite.oo1.DB(':memory:','c'),cold=new SqliteRecordDatabase(sqlite,raw,'memory');
 try{
  // The new kernel begins with no derived cache. Seed exact physical bytes,
  // not decoded facts, so direct Registry/identity rebuild paths are exercised.
  raw.exec(sqliteLibrarySchema);
  for(const row of stored)raw.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json,content_revision) VALUES(?,?,?,?)',bind:[row.table_name,row.record_key,row.value_json,row.content_revision]});
  for(const row of baseline)raw.exec({sql:'INSERT INTO sensa_sync_base VALUES(?,?,?,?)',bind:[row.table_name,row.record_key,row.value_json,row.block_refs_json]});
  cold.initialize();expect(cold.get('semanticMeanings',firstMeaning.personalMeaning.personalMeaningId)).toBe(wire);
  expect(cold.registrySelection({kind:'senseKey',senseKey:sense.senseKey}).keys).toEqual([expectedKey]);expect(cold.lookupMeanings('借用编号0').meanings).toHaveLength(1);
  expect(cold.existingJourneyIdentities([firstMeaning.personalMeaning.personalMeaningId])).toEqual([firstMeaning.personalMeaning.personalMeaningId]);expect(cold.diagnostics({verifyIntegrity:true}).journeyIdentityCheck?.status).toBe('ok');
  expect(raw.exec({sql:'SELECT * FROM sensa_records ORDER BY table_name,record_key',rowMode:'object',returnValue:'resultRows'})).toEqual(stored);
  expect(cold.syncBaseEntries().find(row=>row.table==='semanticMeanings'&&row.key===firstMeaning.personalMeaning.personalMeaningId)?.valueJson).toBe(wire);
 }finally{cold.close(false);}
});

for(const fault of ['duplicate-page','skipped-position','wrong-upper-bound','partial-final'] as const)test(`cursor overlay rejects ${fault} without advancing facts or baseline`,async()=>{
 remoteIdentity={...localIdentity,deviceId:localIdentity.id};publish([first]);await synchronizeLibrary(request);const before=await facts(),checkpoint=await readCloudSync();
 publish([first,second]);publish([first,second,{...second,id:crypto.randomUUID(),text:'Third committed tail fact.'}]);
 let previous:any;
 const transport:SyncRequest=async(path,body)=>{const page=await request(path,body);if(path!=='/pull')return page;
  if(fault==='duplicate-page'){if(previous)return previous;previous=page;return page;}
  if(fault==='skipped-position')return {...page,from:{revision:page.from.revision+1,offset:0}};
  if(fault==='wrong-upper-bound')return {...page,toRevision:page.toRevision+1};
  return {...page,done:!page.done};
 };
 await expect(synchronizeLibrary(transport)).rejects.toThrow('library_sync_format');expect(await facts()).toEqual(before);expect((await readCloudSync())?.revision).toBe(checkpoint?.revision);
 await synchronizeLibrary(request);expect((await facts()).drafts).toHaveLength(3);expect((await readCloudSync())?.revision).toBe(revision);
});

test('tail replacements count the final candidate body once instead of exhausting a cumulative copy budget',async()=>{
 remoteIdentity={...localIdentity,deviceId:localIdentity.id};publish([first]);await synchronizeLibrary(request);
 publish([{...first,text:'An intermediate committed body.'}]);const final={...first,text:'The final committed body, retained once.'};publish([final]);
 const adapter=await sqliteRecordAdapter(),replica=adapter.replicaCandidate.bind(adapter);let logicalBytes:number|undefined;
 const spy=vi.spyOn(adapter,'replicaCandidate').mockImplementation(async input=>{const response=await replica(input);if(response.kind==='validated')logicalBytes=response.candidate.logicalBytes;return response;});
 try{await synchronizeLibrary(request);}finally{spy.mockRestore();}
 expect(logicalBytes).toBe(Buffer.byteLength(JSON.stringify(encodeBackupValue(remoteIdentity)))+Buffer.byteLength(JSON.stringify(encodeBackupValue(final))));expect((await facts()).drafts.map(row=>row.value)).toEqual([final]);
});

// Force the existing time budget to yield at each preparation step. The
// timer runs only after a real macrotask boundary, without an open source or
// scratch transaction. These are small correctness fixtures, not load tests.
for(const interrupt of ['read','edit','discard','owner','signout','incarnation','source-tamper','encoding-tamper'] as const)test(`cooperative candidate encoding fences ${interrupt} outside write transactions`,async()=>{
 const drafts=Array.from({length:12},(_,i)=>({...first,id:crypto.randomUUID(),text:`Small preparation ${i}: `+'x'.repeat(1400)}));
 publish(drafts);await synchronizeLibrary(request);const before=await facts();publish(drafts.map(row=>({...row,revision:2,text:row.text+' received'})));
 const raw=Reflect.get(database,'database'),exec=raw.exec.bind(raw);let scheduled=false,ran=false,inTransaction=false,ticks=0;
 let action:Promise<void>|undefined;
 const clock=vi.spyOn(performance,'now').mockImplementation(()=>++ticks*10);
 const schedule=(id:string)=>{if(scheduled)return;scheduled=true;
  action=new Promise<void>((resolve,reject)=>setTimeout(()=>{void(async()=>{
   expect(inTransaction).toBe(false);exec('BEGIN IMMEDIATE');exec('COMMIT');ran=true;
   expect((await facts()).drafts).toEqual(before.drafts);
   if(interrupt==='edit')await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:0,text:'Preserved concurrent edit.'});
   else if(interrupt==='discard')await database.replicaCandidate({kind:'discard',id});
   else if(interrupt==='source-tamper')exec({sql:'UPDATE sensa_replica_candidate_records_v1 SET value_json=value_json WHERE candidate_id=?',bind:[id]});
   else if(interrupt==='encoding-tamper')exec({sql:'UPDATE sensa_replica_candidate_encoded_v1 SET value_json=\'["null"]\' WHERE candidate_id=?',bind:[id]});
   else if(interrupt!=='read')await writeLibraryState(async tx=>{tx.put('meta',interrupt==='owner'?'service-owner':interrupt==='signout'?'signed-out':'local-incarnation',interrupt==='owner'?{subject:crypto.randomUUID(),accountId:crypto.randomUUID()}:interrupt==='signout'?true:crypto.randomUUID());});
  })().then(resolve,reject);},0));
 };
 const spy=vi.spyOn(raw,'exec').mockImplementation((...args:any[])=>{
  const statement=typeof args[0]==='string'?args[0]:args[0]?.sql;
  if(statement==='BEGIN IMMEDIATE')inTransaction=true;const result=exec(...args);
  if(statement==='COMMIT'||statement==='ROLLBACK')inTransaction=false;return result;
 });
 const originalPrepare=raw.prepare,restore:Array<()=>void>=[];
 const wrap=(statement:any)=>{let candidateId:string;const bind=statement.bind,step=statement.step;
  statement.bind=function(values:any){candidateId=values[0];return bind.call(this,values);};
  statement.step=function(){const result=step.call(this);schedule(candidateId);return result;};
  restore.push(()=>{statement.bind=bind;statement.step=step;});return statement;
 };
 const sql='INSERT INTO sensa_replica_candidate_encoded_v1 VALUES(?,?,?,?,?,?,?)',handler=Reflect.get(database,'replicaCandidateStore');
 for(const [query,statement]of Reflect.get(handler,'statements'))if(query===sql)wrap(statement);
 raw.prepare=function(query:string){const statement=originalPrepare.call(this,query);return query===sql?wrap(statement):statement;};
 try{
  const syncing=synchronizeLibrary(request);
  if(interrupt==='read')await syncing;else await expect(syncing).rejects.toThrow();
  await action;expect(scheduled&&ran).toBe(true);
 }finally{raw.prepare=originalPrepare;for(const release of restore)release();spy.mockRestore();clock.mockRestore();}
 const after=await facts();
 if(interrupt==='read'){expect(after.drafts.map(row=>row.value)).toEqual(drafts.map(row=>({...row,revision:2,text:row.text+' received'})).sort((a,b)=>a.id.localeCompare(b.id)));expect((await readCloudSync())?.status).toBe('synced');}
 else{expect(after.base).toEqual(before.base);expect(after.drafts).toEqual(interrupt==='edit'?expect.arrayContaining(before.drafts):before.drafts);}
});

for(const damage of ['receipt','expired','source','encoding','encoding-replace'] as const)test(`final atomic activation rejects ${damage} prepared candidate`,async()=>{
 publish([first]);await synchronizeLibrary(request);const before=await facts();publish([{...first,revision:2,text:'Prepared replacement.'}]);
 const adapter=await sqliteRecordAdapter(),candidate=adapter.replicaCandidate.bind(adapter),raw=Reflect.get(database,'database');let damaged=false;
 adapter.replicaCandidate=async message=>{
  const result=await candidate(message);if(result.kind!=='updatePrepared'||!result.update)return result;damaged=true;
  if(damage==='receipt'){const copy=structuredClone(result);copy.update!.localRevision++;return copy;}
  if(damage==='expired')await candidate({kind:'discard',id:result.update.id});
  else if(damage==='encoding-replace')raw.exec({sql:`INSERT OR REPLACE INTO sensa_replica_candidate_encoded_v1 SELECT candidate_id,owner_kind,table_name,record_key,encoded_json,'["null"]',digests_json FROM sensa_replica_candidate_encoded_v1 WHERE candidate_id=?`,bind:[result.update.id]});
  else raw.exec({sql:`UPDATE sensa_replica_candidate_${damage==='source'?'records':'encoded'}_v1 SET value_json='["null"]' WHERE candidate_id=?`,bind:[result.update.id]});
  return result;
 };
 try{await expect(synchronizeLibrary(request)).rejects.toThrow();}finally{adapter.replicaCandidate=candidate;}
 expect(damaged).toBe(true);expect(await facts()).toEqual(before);
});
