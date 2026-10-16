/** Real SQLite/Wasm with controlled indexed transport. The ordinary whole
 * merger is an independent result oracle; no large-account timing is implied. */
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {openLibrary,readLibrary,writeLibraryState,restoreLibraryTransaction,readLocalLibraryRevision} from '../../../apps/web/src/data/library/store';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {saveDraft} from '../../../apps/web/src/data/library/drafts';
import {encodeBackupValue,decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {synchronizeLibrary,readCloudSync,resolveCloudSyncConflicts,type SyncRequest} from '../../../apps/web/src/data/library/cloudSync';
import {mergeLibraryReplicas,normalizeLibraryReplicaEntry,partitionLibraryReplicaConflicts,replicaEntryId,type LibraryReplicaEntry} from '../../../apps/web/src/data/library/replication/libraryReplica';
import {encodeLibrarySyncBlock,decodeLibrarySyncBlock,splitLibrarySyncText} from '@sensa/contracts/sensa/library-sync-blocks';
import {librarySyncBlockFetch,librarySyncBlockStore,librarySyncBlockMissing,librarySyncManifest} from '@sensa/contracts/sensa';
import {IndexedSyncFixture} from '../support/indexedSyncFixture.mts';
import {packStoredRecord} from '../../../apps/web/src/data/library/sharedRecordContent';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://dirty-rebase.fixture.invalid/')});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
let database:Awaited<ReturnType<typeof useNodeLearningCapacityStorage>>,identity:Awaited<ReturnType<typeof openLibrary>>;
let revision=0,manifest:string[]|null=null,hook:((path:string,body:any)=>Promise<void>)|undefined;
const blocks=new Map<string,string>(),index=new IndexedSyncFixture(blocks),calls:string[]=[];
beforeEach(async()=>{database=await useNodeLearningCapacityStorage();identity=await openLibrary();await writeLibraryState(async tx=>tx.put('meta','service-owner',{subject:crypto.randomUUID(),accountId:crypto.randomUUID()}));revision=0;manifest=null;hook=undefined;blocks.clear();index.clear();calls.length=0;});
afterEach(()=>database.close());
function pack(text:string){return splitLibrarySyncText(text).map(part=>{const data=encodeLibrarySyncBlock(part),hash=createHash('sha256').update(data).digest('hex');blocks.set(hash,data);return hash;});}
function publish(entries:LibraryReplicaEntry[]){manifest=pack(JSON.stringify({version:8,libraryId:identity.id,learnerId:identity.learnerId,rows:entries.map(row=>({table:row.table,key:row.key,blocks:pack(JSON.stringify(row.value))}))}));index.observe(++revision,manifest);}
const wire=(table:LibraryReplicaEntry['table'],key:string,value:unknown):LibraryReplicaEntry=>({...normalizeLibraryReplicaEntry({table,key,value},identity),value:encodeBackupValue(normalizeLibraryReplicaEntry({table,key,value},identity).value)});
const request:SyncRequest=async(path,body)=>{calls.push(path);await hook?.(path,body);const page=index.page(path,body,revision,manifest);if(page!==undefined)return page;
 if(path==='/blocks/fetch'){const hashes=librarySyncBlockFetch.parse(body).hashes;return {blocks:hashes.filter(hash=>blocks.has(hash)).map(hash=>({hash,data:blocks.get(hash)})),missing:hashes.filter(hash=>!blocks.has(hash)),deferred:[]};}
 if(path==='/blocks/missing')return {missing:librarySyncBlockMissing.parse(body).hashes.filter(hash=>!blocks.has(hash))};
 if(path==='/blocks/store'){for(const b of librarySyncBlockStore.parse(body).blocks)blocks.set(b.hash,b.data);return {stored:true};}
 if(path==='/commit'){const committed=index.commit(body,revision,manifest);revision=committed.revision;manifest=committed.manifest;return committed.head;}
 throw Error('unexpected_rebase_request:'+path);
};
const local=()=>readLibrary(async tx=>{const out:LibraryReplicaEntry[]=[];for(const table of ['meta','drafts','settings'] as const)for(const row of await tx.entries(table))if(table!=='meta'||row.key==='identity')out.push(wire(table,row.key,row.value));return out;});
const base=()=>readLibrary(tx=>tx.syncBaseEntries());
const bodies=(entries:readonly {table:string;key:string;value:unknown}[])=>entries.map(({table,key,value})=>({table,key,value})).sort((a,b)=>replicaEntryId(a as any).localeCompare(replicaEntryId(b as any)));
const remote=()=>{const text=(refs:string[])=>refs.map(hash=>decodeLibrarySyncBlock(blocks.get(hash)!)).join('');return librarySyncManifest.parse(JSON.parse(text(manifest!))).rows.map(row=>({...row,value:JSON.parse(text(row.blocks))}));};
async function setup(){const drafts=[];for(let n=0;n<3;n++)drafts.push(await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Baseline '+n}));await synchronizeLibrary(request);return drafts;}

test('below-floor dirty deletion/addition rebases through bounded candidate and matches the whole merger',async()=>{
 const drafts=await setup(),before=await base();
 await restoreLibraryTransaction(async tx=>tx.delete('drafts',drafts[0]!.id));await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Unpublished local context'});
 const ours=await local(),theirs=bodies(before).filter(row=>row.key!==drafts[1]!.id) as LibraryReplicaEntry[];
 theirs.push(wire('settings','remote-setting',{source:'remote'}));publish(theirs);index.compact(revision);
 const expected=mergeLibraryReplicas({base:before,local:ours,remote:theirs});expect(expected.conflicts).toEqual([]);
 const adapter=await sqliteRecordAdapter(),read=adapter.syncBaseEntries.bind(adapter),candidate=adapter.replicaCandidate.bind(adapter);let rebase=false;
 const bounded=vi.spyOn(adapter,'syncBaseEntries').mockImplementation(async keys=>{if(!keys)throw Error('unbounded baseline capture');return read(keys);});
 const stages=vi.spyOn(adapter,'replicaCandidate').mockImplementation(async(input,progress)=>{if(input.kind==='prepareRebase')rebase=true;return candidate(input,progress);});
 try{await synchronizeLibrary(request);}finally{bounded.mockRestore();stages.mockRestore();}
 expect(rebase).toBe(true);expect(bodies(await local())).toEqual(bodies(expected.entries));expect(bodies(remote())).toEqual(bodies(expected.entries));expect(bodies(await base())).toEqual(bodies(expected.entries));expect((await readCloudSync())?.status).toBe('synced');
});

for(const choice of ['local','remote'] as const)test(`conflict ${choice} choice preserves the unrelated merged complement and old blocked baseline`,async()=>{
 const drafts=await setup(),before=await base();await saveDraft(crypto.randomUUID(),{id:drafts[0]!.id,expectedRevision:1,text:'Local conflicting text'});await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Independent pending'});
 const ours=await local(),theirs=before.map(row=>row.key===drafts[0]!.id?wire('drafts',row.key,{...drafts[0],revision:2,text:'Remote conflicting text'}):row);publish(theirs);index.compact(revision);
 const merged=mergeLibraryReplicas({base:before,local:ours,remote:theirs}),partition=partitionLibraryReplicaConflicts({base:before,local:ours,remote:theirs,merged:merged.entries,conflicts:merged.conflicts});
 await synchronizeLibrary(request);const state=(await readCloudSync())!;expect(state.status).toBe('conflict');expect(bodies(await local())).toEqual(bodies(partition.local));expect(bodies(remote())).toEqual(bodies(partition.upload));expect(bodies(await base())).toEqual(bodies(partition.base(partition.upload)));
 await resolveCloudSyncConflicts(choice,state.conflict!);await synchronizeLibrary(request);
 expect((await readCloudSync())?.status).toBe('synced');expect(bodies(await local())).toEqual(bodies(remote()));expect(bodies(await base())).toEqual(bodies(remote()));expect(decodeBackupValue((await local()).find(row=>row.key===drafts[0]!.id)!.value).text).toBe(choice==='local'?'Local conflicting text':'Remote conflicting text');expect((await local()).some(row=>decodeBackupValue(row.value)?.text==='Independent pending')).toBe(true);
});

test('lost publication ACK retries its receipt and retains edits made after the rebase',async()=>{
 await setup();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Pending before ACK'});const theirs=await base();theirs.push(wire('settings','remote',1));publish(theirs);index.compact(revision);
 let lost=false;const fail:SyncRequest=async(path,body)=>{const response=await request(path,body);if(path==='/commit'&&!lost){lost=true;throw Error('lost_ack');}return response;};
 await expect(synchronizeLibrary(fail)).rejects.toThrow('lost_ack');const committed=revision;expect((await readCloudSync())?.pending).toBeTruthy();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Later pending'});
 await synchronizeLibrary(request);expect(revision).toBe(committed+1);expect((await readCloudSync())?.status).toBe('synced');expect(bodies(await local())).toEqual(bodies(remote()));expect((await local()).filter(row=>row.table==='drafts')).toHaveLength(5);
});

for(const target of ['sensa_records','sensa_sync_base'])test(`failed atomic ${target} patch rolls back facts and baseline`,async()=>{
 await setup();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Kept pending'});const theirs=await base();theirs.push(wire('settings','remote',1));publish(theirs);index.compact(revision);const before={local:await local(),base:await base(),revision:await readLibrary(readLocalLibraryRevision)};
 const sql=Reflect.get(database,'database');sql.exec(`CREATE TEMP TRIGGER reject_dirty_rebase BEFORE INSERT ON ${target} WHEN NEW.table_name='settings' BEGIN SELECT RAISE(ABORT,'injected_rebase_failure'); END`);
 try{await expect(synchronizeLibrary(request)).rejects.toThrow();expect(await local()).toEqual(before.local);expect(await base()).toEqual(before.base);expect(await readLibrary(readLocalLibraryRevision)).toBe(before.revision);}finally{sql.exec('DROP TRIGGER reject_dirty_rebase');}
 await synchronizeLibrary(request);expect((await readCloudSync())?.status).toBe('synced');
});

for(const fault of ['local','revision','baseline','owner','identity','incarnation','epoch','cancel'] as const)test(`the prepared dirty rebase rejects a changed ${fault} fence`,async()=>{
 await setup();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Retained pending'});const theirs=await base();theirs.push(wire('settings','remote',1));publish(theirs);index.compact(revision);
 const before=await base(),adapter=await sqliteRecordAdapter(),candidate=adapter.replicaCandidate.bind(adapter),controller=new AbortController();let injected=false;
 const inject=vi.spyOn(adapter,'replicaCandidate').mockImplementation(async(input,progress)=>{const result=await candidate(input,progress);if(result.kind==='rebasePrepared'&&!injected){injected=true;
  if(fault==='cancel')controller.abort();else if(fault==='local')await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'During preparation'});
  else await writeLibraryState(async tx=>{const state=await tx.get<any>('meta','cloud-sync');if(fault==='revision')tx.put('meta','cloud-sync',{...state,revision:state.revision+1});if(fault==='baseline')tx.put('meta','cloud-sync',{...state,syncedLocalRevision:state.syncedLocalRevision+1});if(fault==='owner')tx.put('meta','service-owner',{...state.owner,subject:crypto.randomUUID()});if(fault==='identity')tx.put('meta','identity',{...identity,id:crypto.randomUUID()});if(fault==='incarnation')tx.put('meta','local-incarnation',crypto.randomUUID());if(fault==='epoch')tx.put('meta','service-signout-epoch',crypto.randomUUID());});
 }return result;});
 try{await expect(synchronizeLibrary(request,{signal:controller.signal})).rejects.toThrow();}finally{inject.mockRestore();}
 expect(injected).toBe(true);expect(await base()).toEqual(before);expect((await local()).filter(row=>row.table==='drafts')).toHaveLength(fault==='local'?5:4);expect((await local()).some(row=>row.table==='settings'&&row.key==='remote')).toBe(false);
 if(fault==='cancel'){await synchronizeLibrary(request);expect((await readCloudSync())?.status).toBe('synced');}
});

test('a lost local rebase COMMIT acknowledgement is confirmed only by its dedicated durable receipt',async()=>{
 await setup();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Retained pending'});const theirs=await base();theirs.push(wire('settings','remote',1));publish(theirs);index.compact(revision);
 const adapter=await sqliteRecordAdapter(),commit=adapter.commit.bind(adapter);let lost=false;
 const ack=vi.spyOn(adapter,'commit').mockImplementation(async mutation=>{await commit(mutation);if(mutation.replicaCandidateRestore?.update&&'kind' in mutation.replicaCandidateRestore.update&&!lost){lost=true;throw Error('sqlite_coordination_timeout');}});
 try{await synchronizeLibrary(request);}finally{ack.mockRestore();}
 expect(lost).toBe(true);expect((await readCloudSync())?.status).toBe('synced');expect(bodies(await base())).toEqual(bodies(remote()));
});

test('changesSince crosses more than two keyset pages with tombstones and exact revision ties',async()=>{
 const at=await readLibrary(readLocalLibraryRevision);await restoreLibraryTransaction(async tx=>{for(let i=0;i<300;i++)tx.put('settings','page-'+String(i).padStart(3,'0'),i);});
 await restoreLibraryTransaction(async tx=>{for(let i=0;i<129;i++)tx.delete('settings','page-'+String(i).padStart(3,'0'));});
 const adapter=await sqliteRecordAdapter(),spy=vi.spyOn(adapter,'changesSince');try{const changes=await readLibrary(tx=>tx.changesSince(at,['settings']));expect(changes).toHaveLength(300);expect(changes.filter(row=>row.value===null)).toHaveLength(129);expect(new Set(changes.map(replicaEntryId)).size).toBe(300);expect(spy.mock.calls.every(([, ,page])=>page?.limit===128)).toBe(true);expect(spy.mock.calls).toHaveLength(3);}finally{spy.mockRestore();}
});

test('unavailable dirty candidate support fails closed without whole-library capture',async()=>{
 await setup();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Retained pending'});const theirs=await base();theirs.push(wire('settings','remote',1));publish(theirs);index.compact(revision);
 const before=await base(),ours=await local(),localRevision=await readLibrary(readLocalLibraryRevision),adapter=await sqliteRecordAdapter(),candidate=adapter.replicaCandidate.bind(adapter),baseRead=adapter.syncBaseEntries.bind(adapter);
 const unavailable=vi.spyOn(adapter,'replicaCandidate').mockImplementation(async(input,progress)=>{if(input.kind==='beginIndex')throw Error('sqlite_replica_candidate_unavailable');return candidate(input,progress);});
 const fullCapture=vi.spyOn(adapter,'syncBaseEntries').mockImplementation(async keys=>{if(keys===undefined)throw Error('unexpected_whole_library_capture');return baseRead(keys);});
 calls.length=0;
 try{await expect(synchronizeLibrary(request)).rejects.toThrow('sqlite_replica_candidate_unavailable');}finally{unavailable.mockRestore();fullCapture.mockRestore();}
 expect(await base()).toEqual(before);expect(await local()).toEqual(ours);expect(await readLibrary(readLocalLibraryRevision)).toBe(localRevision);expect((await readCloudSync())?.status).not.toBe('synced');expect(calls).not.toContain('/blocks/store');expect(calls).not.toContain('/commit');
});

for(const missing of [false,true])test(`a pre-existing ${missing?'missing baseline digest':'baseline body/ref mismatch'} cannot impersonate remote facts`,async()=>{
 const drafts=await setup();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Retained pending'});const theirs=await base();theirs.push(wire('settings','remote',1));publish(theirs);index.compact(revision);
 const before=await local(),sql=Reflect.get(database,'database');
 if(missing)sql.exec({sql:'DELETE FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',bind:['drafts',drafts[0]!.id]});
 else sql.exec({sql:'UPDATE sensa_sync_base SET value_json=? WHERE table_name=? AND record_key=?',bind:[packStoredRecord(JSON.stringify(encodeBackupValue({...drafts[0],text:'Well-shaped corrupted baseline'}))),'drafts',drafts[0]!.id]});
 calls.length=0;await expect(synchronizeLibrary(request)).rejects.toThrow('library_sync_dependency_corrupt');expect(await local()).toEqual(before);expect(calls).not.toContain('/commit');expect((await readCloudSync())?.status).not.toBe('synced');
});

for(const mode of ['replacement','patch'] as const)test(`a generic baseline ${mode} cannot mint a dirty-rebase digest witness`,async()=>{
 const drafts=await setup(),prior=await base(),sql=Reflect.get(database,'database');
 sql.exec({sql:'DELETE FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',bind:['drafts',drafts[0]!.id]});
 const adapter=await sqliteRecordAdapter(),rows=prior.map(row=>({table:row.table,key:row.key,valueJson:JSON.stringify(row.value),blockRefs:row.blocks!}));
 await adapter.commit({clears:[],deletes:[],puts:[],...(mode==='replacement'?{syncBaseReplacement:rows}:{syncBasePatch:{puts:rows,deletes:[]}})});
 expect(sql.exec({sql:'SELECT 1 FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',bind:['drafts',drafts[0]!.id],rowMode:0,returnValue:'resultRows'})).toEqual([]);
 await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Pending remains local'});publish([...prior,wire('settings','remote',1)]);index.compact(revision);
 await expect(synchronizeLibrary(request)).rejects.toThrow('library_sync_dependency_corrupt');
});
