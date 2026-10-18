/** Real SQLite/Wasm with controlled indexed transport. The ordinary whole
 * merger is an independent result oracle; no large-account timing is implied. */
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {openLibrary,readLibrary,writeLibraryState,restoreLibraryTransaction,readLocalLibraryRevision,libraryTables} from '../../../apps/web/src/data/library/store';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {saveDraft} from '../../../apps/web/src/data/library/drafts';
import {encodeBackupValue,decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {synchronizeLibrary,readCloudSync,resolveCloudSyncConflicts,type SyncRequest} from '../../../apps/web/src/data/library/cloudSync';
import {mergeLibraryReplicas,normalizeLibraryReplicaEntry,partitionLibraryReplicaConflicts,replicaEntryId,isReplicatedLibraryEntry,type LibraryReplicaEntry} from '../../../apps/web/src/data/library/replication/libraryReplica';
import {encodeLibrarySyncBlock,decodeLibrarySyncBlock,splitLibrarySyncText} from '@sensa/contracts/sensa/library-sync-blocks';
import {librarySyncBlockFetch,librarySyncBlockStore,librarySyncBlockMissing,librarySyncManifest} from '@sensa/contracts/sensa';
import {IndexedSyncFixture} from '../support/indexedSyncFixture.mts';
import {packStoredRecord} from '../../../apps/web/src/data/library/sharedRecordContent';
import {MemoryJourneyRepository,LibraryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {semanticLookupPayload,syntheticSemanticWorld} from '../support/semanticLookupFixtures';
import {semanticRecords} from '../support/semanticWorldRecordFixture.mts';
import {observeReplicaWork} from '../../../apps/web/src/data/library/replicaWork';
import {SqliteRecordValidation} from '../../../apps/web/src/data/library/sqliteRecordValidation';
import {admitDirtyRebaseOverlay} from '../../../apps/web/src/data/library/dirtyRebaseAdmission';
import {contextDeltaFixture,contextReader} from '../support/contextDeltaFixture.mts';
import {DeltaReceiveFallback} from '../../../apps/web/src/data/library/learningDeltaAdmission';
import {SqliteSyncDependencies} from '../../../apps/web/src/data/library/sqliteSyncDependencies';
import {replicaCandidateSchema} from '../../../apps/web/src/data/library/replicaCandidateProtocol';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://dirty-rebase.fixture.invalid/')});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
let database:Awaited<ReturnType<typeof useNodeLearningCapacityStorage>>,identity:Awaited<ReturnType<typeof openLibrary>>;
let revision=0,manifest:string[]|null=null,hook:((path:string,body:any)=>Promise<void>)|undefined;
const blocks=new Map<string,string>(),index=new IndexedSyncFixture(blocks),calls:string[]=[];
beforeEach(async()=>{database=await useNodeLearningCapacityStorage();identity=await openLibrary();await writeLibraryState(async tx=>tx.put('meta','service-owner',{subject:crypto.randomUUID(),accountId:crypto.randomUUID()}));revision=0;manifest=null;hook=undefined;blocks.clear();index.clear();calls.length=0;});
afterEach(()=>{observeReplicaWork(undefined);database.close();});
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
const allLocal=()=>readLibrary(async tx=>{const out:LibraryReplicaEntry[]=[];for(const table of libraryTables)for(const row of await tx.entries(table))if(isReplicatedLibraryEntry(table,row.key))out.push(wire(table as LibraryReplicaEntry['table'],row.key,row.value));return out;});

test('multiple Meaning cohorts and coalesced Context versions use differential admission and equal the complete merger',async()=>{
 const seed=new MemoryJourneyRepository();await createJourneyModules({repository:seed}).semanticIntake.submit(semanticLookupPayload());const world=syntheticSemanticWorld(await seed.load(),3);
 await restoreLibraryTransaction(async tx=>{for(const row of semanticRecords(world))tx.put(row.table,row.key,row.value);});await synchronizeLibrary(request);const before=await base();
 const remoteRepository=new MemoryJourneyRepository();await remoteRepository.commit({before:await remoteRepository.load(),after:structuredClone(world)});
 const remoteModules=createJourneyModules({repository:remoteRepository,clock:createSeededClock('2026-10-16T08:00:00Z')}),localModules=createJourneyModules({repository:new LibraryJourneyRepository(),clock:createSeededClock('2026-10-16T08:01:00Z')});
 for(const index of [0,1,1]){const meaning=(await remoteRepository.load()).meanings[index]!;await remoteModules.personalMeaningJourney.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:meaning.personalMeaning.personalMeaningId,expectedRevision:meaning.personalMeaning.currentRevision,blocks:[{kind:'text',bodyText:'Remote retained revision '+crypto.randomUUID()}]});}
 await localModules.personalMeaningJourney.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:world.meanings[2]!.personalMeaning.personalMeaningId,expectedRevision:1,blocks:[{kind:'text',bodyText:'Unpublished local Context'}]});
 const theirs=new Map(before.map(row=>[replicaEntryId(row),row]));for(const row of semanticRecords(await remoteRepository.load()))theirs.set(replicaEntryId(row),wire(row.table,row.key,row.value));const remoteRows=[...theirs.values()],ours=await allLocal(),expected=mergeLibraryReplicas({base:before,local:ours,remote:remoteRows});expect(expected.conflicts).toEqual([]);publish(remoteRows);index.compact(revision);
 const work:Record<string,number>={},sql=Reflect.get(database,'database'),prepare=sql.prepare.bind(sql),plans:string[][]=[];
 const queryPlan=vi.spyOn(sql,'prepare').mockImplementation((query:any,...rest:any[])=>{if(typeof query==='string'&&query.startsWith('SELECT DISTINCT peer.table_name'))plans.push(sql.exec({sql:'EXPLAIN QUERY PLAN '+query,bind:['candidate','semanticMeanings','one-owner'],rowMode:'object',returnValue:'resultRows'}).map((row:any)=>row.detail));return Reflect.apply(prepare,sql,[query,...rest]);});
 observeReplicaWork((kind,n)=>work[kind]=(work[kind]??0)+n);try{await synchronizeLibrary(request);}finally{queryPlan.mockRestore();observeReplicaWork(undefined);}
 expect(plans.length).toBeGreaterThan(0);for(const plan of plans){expect(plan[0]).toMatch(/SEARCH own .*candidate_id=\? AND table_name=\? AND record_key=\?/);expect(plan.some(step=>/SEARCH peer .*candidate_id=\? AND token=\?/.test(step))).toBe(true);}
 expect(work['rebase.baselineMetadataRecords']).toBe(before.length);expect(work['rebase.completeDomainScansAvoided']).toBe(1);expect(work['rebase.differentialFallback']??0).toBe(0);expect(work['rebase.differentialAdmissions']).toBeGreaterThanOrEqual(3);
 expect(bodies(await allLocal())).toEqual(bodies(expected.entries));expect(bodies(remote())).toEqual(bodies(expected.entries));expect(bodies(await base())).toEqual(bodies(expected.entries));expect((await readCloudSync())?.status).toBe('synced');
});

test('the private validation index excludes replaced owners and retains all complement collision witnesses',async()=>{
 const sql=Reflect.get(database,'database'),id=crypto.randomUUID(),registry='senses:'+crypto.randomUUID(),meaning=crypto.randomUUID(),scene=crypto.randomUUID();sql.exec(replicaCandidateSchema);sql.exec({sql:"INSERT INTO sensa_replica_candidates_v1(id,fence_json,expected_json,state) VALUES(?,'{}','{}','filling')",bind:[id]});
 const tokens=[{table:'semanticRegistry',key:registry,token:JSON.stringify(['validation-key','sense-key','retained-sense'])},{table:'semanticRegistry',key:registry,token:JSON.stringify(['validation-key','registry-slot','retained-slot'])},{table:'semanticMeanings',key:meaning,token:JSON.stringify(['validation-scene',scene,meaning])}];for(const row of tokens)sql.exec({sql:'INSERT INTO sensa_replica_candidate_merge_edges_v1 VALUES(?,?,?,?)',bind:[id,row.token,row.table,row.key]});
 for(const excluded of [false,true]){const index=new SqliteRecordValidation(sql,()=>{});try{index.seedComplement(id,excluded?[{table:'semanticRegistry',key:registry},{table:'semanticMeanings',key:meaning}]:[]);expect(index.unique('sense-key','retained-sense')).toBe(excluded);expect(index.unique('registry-slot','retained-slot')).toBe(excluded);expect(index.sceneOwner(scene,'new-owner')).toBe(excluded);}finally{index.close();}}
 sql.exec({sql:'DELETE FROM sensa_replica_candidates_v1 WHERE id=?',bind:[id]});
});

for(const choice of ['local','remote'] as const)test(`a differential Context conflict falls back to the complete graph before ${choice} choice`,async()=>{
 const seed=new MemoryJourneyRepository();await createJourneyModules({repository:seed}).semanticIntake.submit(semanticLookupPayload());const world=syntheticSemanticWorld(await seed.load(),2);
 await restoreLibraryTransaction(async tx=>{for(const row of semanticRecords(world))tx.put(row.table,row.key,row.value);});await synchronizeLibrary(request);const before=await base();
 const remoteRepository=new MemoryJourneyRepository();await remoteRepository.commit({before:await remoteRepository.load(),after:structuredClone(world)});
 const remoteModules=createJourneyModules({repository:remoteRepository,clock:createSeededClock('2026-10-16T08:00:00Z')}),localModules=createJourneyModules({repository:new LibraryJourneyRepository(),clock:createSeededClock('2026-10-16T08:01:00Z')});
 const revise=(modules:ReturnType<typeof createJourneyModules>,index:number,text:string)=>modules.personalMeaningJourney.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:world.meanings[index]!.personalMeaning.personalMeaningId,expectedRevision:1,blocks:[{kind:'text',bodyText:text}]});
 await revise(remoteModules,0,'Remote conflicting Context');await revise(localModules,0,'Local conflicting Context');await revise(localModules,1,'Independent pending Context');
 const theirs=new Map(before.map(row=>[replicaEntryId(row),row]));for(const row of semanticRecords(await remoteRepository.load()))theirs.set(replicaEntryId(row),wire(row.table,row.key,row.value));const remoteRows=[...theirs.values()],ours=await allLocal(),merged=mergeLibraryReplicas({base:before,local:ours,remote:remoteRows}),partition=partitionLibraryReplicaConflicts({base:before,local:ours,remote:remoteRows,merged:merged.entries,conflicts:merged.conflicts});expect(merged.conflicts.length).toBeGreaterThan(0);publish(remoteRows);index.compact(revision);
 const work:Record<string,number>={};observeReplicaWork((kind,n)=>work[kind]=(work[kind]??0)+n);await synchronizeLibrary(request);observeReplicaWork(undefined);
 const state=(await readCloudSync())!;expect(state.status).toBe('conflict');expect(work['rebase.differentialFallback']).toBe(1);expect(work['rebase.completeDomainScansAvoided']??0).toBe(0);
 expect(bodies(await allLocal())).toEqual(bodies(partition.local));expect(bodies(remote())).toEqual(bodies(partition.upload));expect(bodies(await base())).toEqual(bodies(partition.base(partition.upload)));
 await resolveCloudSyncConflicts(choice,state.conflict!);
 let lost=false;await expect(synchronizeLibrary(async(path,body)=>{const reply=await request(path,body);if(path==='/commit'&&!lost){lost=true;throw Error('lost_choice_ack');}return reply;})).rejects.toThrow('lost_choice_ack');
 expect((await readLibrary(tx=>tx.get<any>('meta','cloud-sync'))).dirtyRebaseReceipt).toBeUndefined();
 await synchronizeLibrary(request);expect((await readCloudSync())?.status).toBe('synced');expect(bodies(await allLocal())).toEqual(bodies(remote()));expect(bodies(await base())).toEqual(bodies(remote()));
});

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

test('a no-choice dirty upload receipt atomically confirms its exact baseline without another candidate',async()=>{
 await setup();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Receipt retained Context'});const theirs=await base();theirs.push(wire('settings','remote',1));publish(theirs);index.compact(revision);
 await expect(synchronizeLibrary(async(path,body)=>{const reply=await request(path,body);if(path==='/commit')throw Error('lost_ack');return reply;})).rejects.toThrow('lost_ack');
 const pending=await readLibrary(tx=>tx.get<any>('meta','cloud-sync'));expect(pending.dirtyRebaseReceipt.operationId).toBe(pending.pending.operationId);const committed=revision;
 const clock=Reflect.get(database,'database').exec({sql:'SELECT generation,epoch FROM sensa_sync_dependency_state_v1 WHERE id=1',rowMode:'object',returnValue:'resultRows'})[0];expect(pending.dirtyRebaseReceipt.baseline).toEqual(clock);
 const adapter=await sqliteRecordAdapter(),candidate=vi.spyOn(adapter,'replicaCandidate').mockImplementation(async()=>{throw Error('receipt must not download another candidate');});
 try{await synchronizeLibrary(request);}finally{candidate.mockRestore();}
 expect(revision).toBe(committed);expect(bodies(await base())).toEqual(bodies(remote()));const state=await readLibrary(tx=>tx.get<any>('meta','cloud-sync'));expect(state.status).toBe('synced');expect(state.dirtyRebaseReceipt).toBeUndefined();expect(state.dirtyRebaseOperationId).toBeUndefined();expect(state.syncedLocalRevision).toBe(pending.dirtyRebaseReceipt.appliedLocalRevision);
 expect(Reflect.get(database,'database').selectValue('SELECT certificate_json FROM sensa_sync_dependency_state_v1 WHERE id=1')).toBeNull();
});

for(const timing of ['normal-ack','receipt','ordinary-normal-ack','ordinary-receipt'] as const)for(const fault of ['body','refs','witness','trigger-change','trigger-missing'] as const)test(`dirty ${timing} rejects an independently mutated baseline ${fault}`,async()=>{
 const drafts=await setup();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Exact pending upload'});const theirs=await base();theirs.push(wire('settings','remote',1));publish(theirs);index.compact(revision);const sql=Reflect.get(database,'database');
 const tamper=()=>{if(fault.startsWith('trigger-')){sql.exec('DROP TRIGGER sensa_sync_base_generation_update_v1');if(fault==='trigger-change')sql.exec('CREATE TRIGGER sensa_sync_base_generation_update_v1 AFTER UPDATE ON sensa_sync_base BEGIN SELECT 1; END');}if(fault==='body'||fault.startsWith('trigger-'))sql.exec({sql:'UPDATE sensa_sync_base SET value_json=? WHERE table_name=? AND record_key=?',bind:[packStoredRecord(JSON.stringify(encodeBackupValue({...drafts[0],text:'Unvalidated SQL body'}))),'drafts',drafts[0]!.id]});if(fault==='refs')sql.exec({sql:'UPDATE sensa_sync_base SET block_refs_json=? WHERE table_name=? AND record_key=?',bind:[JSON.stringify(['a'.repeat(64)]),'drafts',drafts[0]!.id]});if(fault==='witness')sql.exec({sql:'DELETE FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',bind:['drafts',drafts[0]!.id]});};
 const adapter=await sqliteRecordAdapter(),commit=adapter.commit.bind(adapter),errors:string[]=[],commits=vi.spyOn(adapter,'commit').mockImplementation(async mutation=>{try{return await commit(mutation);}catch(cause){errors.push((cause as Error).message);throw cause;}});
 try{if(timing.startsWith('ordinary-'))await expect(synchronizeLibrary(async(path,body)=>{if(path==='/blocks/missing')throw Error('interrupted_upload');return request(path,body);})).rejects.toThrow('interrupted_upload');
 if(timing.endsWith('receipt')){await expect(synchronizeLibrary(async(path,body)=>{const reply=await request(path,body);if(path==='/commit')throw Error('lost_ack');return reply;})).rejects.toThrow('lost_ack');tamper();await expect(synchronizeLibrary(request)).rejects.toThrow('localFlow.storageWrite');}
 else await expect(synchronizeLibrary(async(path,body)=>{const reply=await request(path,body);if(path==='/commit')tamper();return reply;})).rejects.toThrow('localFlow.storageWrite');
 expect(errors).toContain('library_sync_dependency_corrupt');}finally{commits.mockRestore();}
 expect((await readCloudSync())?.status).not.toBe('synced');expect((await readCloudSync())?.pending).toBeTruthy();
 if(fault==='refs')expect(sql.selectValue("SELECT block_refs_json FROM sensa_sync_base WHERE table_name='drafts' AND record_key='"+drafts[0]!.id+"'")).toBe(JSON.stringify(['a'.repeat(64)]));
 if(fault==='witness')expect(sql.selectValue("SELECT count(*) FROM sensa_sync_dependency_rows_v1 WHERE table_name='drafts' AND record_key='"+drafts[0]!.id+"'")).toBe(0);
 if(fault.startsWith('trigger-')){const marker=(await readLibrary(tx=>tx.get<any>('meta','cloud-sync'))).dirtyRebaseReceipt.baseline,fresh=new SqliteSyncDependencies(sql);try{expect(()=>fresh.assertClock(marker)).toThrow('library_sync_dependency_corrupt');}finally{fresh.close();}}
});

for(const emptyDelta of [false,true])test(`an orphan activation marker is retired by an ordinary ${emptyDelta?'empty delta':'upload ACK'} and permits later edits`,async()=>{
 await setup();const theirs=await base();theirs.push(wire('settings','remote',1));
 if(emptyDelta)await restoreLibraryTransaction(tx=>tx.put('settings','remote',1));else await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Interrupted before pending save'});
 publish(theirs);index.compact(revision);
 if(emptyDelta){const adapter=await sqliteRecordAdapter(),commit=adapter.commit.bind(adapter);let failed=false;const stop=vi.spyOn(adapter,'commit').mockImplementation(async mutation=>{const state=mutation.puts.find(row=>row.table==='meta'&&row.key==='cloud-sync');if(!failed&&state&&decodeBackupValue(JSON.parse(state.encodedValue)).status==='synced'){failed=true;throw Error('interrupted_finalize');}return commit(mutation);});try{await expect(synchronizeLibrary(request)).rejects.toThrow();expect(failed).toBe(true);}finally{stop.mockRestore();}}
 else await expect(synchronizeLibrary(async(path,body)=>{if(path==='/blocks/missing')throw Error('interrupted_upload');return request(path,body);})).rejects.toThrow('interrupted_upload');
 const orphan=await readLibrary(tx=>tx.get<any>('meta','cloud-sync'));expect(orphan.dirtyRebaseReceipt.baseline).toBeTruthy();expect(orphan.pending).toBeUndefined();
 await synchronizeLibrary(request);const state=await readLibrary(tx=>tx.get<any>('meta','cloud-sync'));expect(state.status).toBe('synced');expect(state.dirtyRebaseReceipt).toBeUndefined();expect(state.dirtyRebaseOperationId).toBeUndefined();
 await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Later ordinary upload'});await synchronizeLibrary(request);expect((await readCloudSync())?.status).toBe('synced');expect(bodies(await base())).toEqual(bodies(remote()));
});

for(const laterEdit of ['none','before-capture','after-capture'] as const)test(`an ordinary orphan upload binds its exact receipt after a lost ACK (${laterEdit})`,async()=>{
 await setup();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Interrupted before pending save'});const theirs=await base();theirs.push(wire('settings','remote',1));publish(theirs);index.compact(revision);
 await expect(synchronizeLibrary(async(path,body)=>{if(path==='/blocks/missing')throw Error('interrupted_upload');return request(path,body);})).rejects.toThrow('interrupted_upload');
 const orphan=await readLibrary(tx=>tx.get<any>('meta','cloud-sync'));expect(orphan.pending).toBeUndefined();
 if(laterEdit==='before-capture')await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Included in captured ordinary delta'});
 const capturedRevision=await readLibrary(readLocalLibraryRevision);let edited=false;
 hook=async path=>{if(path==='/blocks/missing'&&laterEdit==='after-capture'&&!edited){edited=true;await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Retained after captured ordinary delta'});}};
 try{await expect(synchronizeLibrary(async(path,body)=>{const reply=await request(path,body);if(path==='/commit')throw Error('lost_ack');return reply;})).rejects.toThrow('lost_ack');}finally{hook=undefined;}
 const pending=await readLibrary(tx=>tx.get<any>('meta','cloud-sync')),committed=revision;
 expect(pending.dirtyRebaseReceipt).toEqual({...orphan.dirtyRebaseReceipt,operationId:pending.pending.operationId,appliedLocalRevision:capturedRevision});
 const adapter=await sqliteRecordAdapter(),candidate=vi.spyOn(adapter,'replicaCandidate').mockImplementation(async()=>{throw Error('receipt must not download another candidate');});
 try{await synchronizeLibrary(request);}finally{candidate.mockRestore();}
 expect(revision).toBe(committed+(laterEdit==='after-capture'?1:0));expect(bodies(await local())).toEqual(bodies(remote()));expect(bodies(await base())).toEqual(bodies(remote()));
 const state=await readLibrary(tx=>tx.get<any>('meta','cloud-sync'));expect(state.status).toBe('synced');expect(state.syncedLocalRevision).toBe(await readLibrary(readLocalLibraryRevision));expect(state.pending).toBeUndefined();expect(state.dirtyRebaseReceipt).toBeUndefined();expect(state.dirtyRebaseOperationId).toBeUndefined();
});

for(const replaced of ['operation','receipt'] as const)test(`an ordinary orphan upload rejects a replaced ${replaced} before saving pending`,async()=>{
 await setup();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Interrupted before pending save'});const theirs=await base();theirs.push(wire('settings','remote',1));publish(theirs);index.compact(revision);
 await expect(synchronizeLibrary(async(path,body)=>{if(path==='/blocks/missing')throw Error('interrupted_upload');return request(path,body);})).rejects.toThrow('interrupted_upload');
 const retained=await base(),remoteRevision=revision;let replacedMarker=false;
 hook=async path=>{if(path!=='/blocks/missing'||replacedMarker)return;replacedMarker=true;await writeLibraryState(async tx=>{const state=await tx.get<any>('meta','cloud-sync');tx.put('meta','cloud-sync',replaced==='operation'?{...state,dirtyRebaseOperationId:crypto.randomUUID()}:{...state,dirtyRebaseReceipt:{...state.dirtyRebaseReceipt,appliedLocalRevision:state.dirtyRebaseReceipt.appliedLocalRevision-1}});});};
 try{await expect(synchronizeLibrary(request)).rejects.toThrow('library_sync_local_changed');}finally{hook=undefined;}
 expect(replacedMarker).toBe(true);expect(revision).toBe(remoteRevision);expect(await base()).toEqual(retained);expect((await readCloudSync())?.pending).toBeUndefined();
});

test('repreparing an orphan activation cannot renew a changed baseline and matching witness',async()=>{
 const drafts=await setup();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Unpublished retained value'});const theirs=await base();theirs.push(wire('settings','remote',1));publish(theirs);index.compact(revision);
 await expect(synchronizeLibrary(async(path,body)=>{if(path==='/blocks/missing')throw Error('interrupted_upload');return request(path,body);})).rejects.toThrow('interrupted_upload');
 const orphan=await readLibrary(tx=>tx.get<any>('meta','cloud-sync')),sql=Reflect.get(database,'database'),text=JSON.stringify(encodeBackupValue({...drafts[0],text:'Changed SQL baseline'})),refs=pack(text),digest=createHash('sha256').update(text).digest('hex');
 sql.exec({sql:'UPDATE sensa_sync_base SET value_json=?,block_refs_json=? WHERE table_name=? AND record_key=?',bind:[packStoredRecord(text),JSON.stringify(refs),'drafts',drafts[0]!.id]});sql.exec({sql:'UPDATE sensa_sync_dependency_rows_v1 SET digest=?,logical_bytes=? WHERE table_name=? AND record_key=?',bind:[digest,new TextEncoder().encode(text).length,'drafts',drafts[0]!.id]});publish(remote());
 const adapter=await sqliteRecordAdapter(),candidate=adapter.replicaCandidate.bind(adapter),commit=adapter.commit.bind(adapter),errors:string[]=[];let prepared=false;
 const preparing=vi.spyOn(adapter,'replicaCandidate').mockImplementation(async(input,progress)=>{const reply=await candidate(input,progress);if(reply.kind==='rebasePrepared')prepared=true;return reply;}),committing=vi.spyOn(adapter,'commit').mockImplementation(async mutation=>{try{return await commit(mutation);}catch(cause){errors.push((cause as Error).message);throw cause;}});
 try{await expect(synchronizeLibrary(request)).rejects.toThrow('localFlow.storageWrite');expect(prepared).toBe(true);expect(errors).toContain('library_sync_dependency_corrupt');}finally{preparing.mockRestore();committing.mockRestore();}
 const state=await readLibrary(tx=>tx.get<any>('meta','cloud-sync'));expect(state.status).not.toBe('synced');expect(state.dirtyRebaseReceipt.baseline).toEqual(orphan.dirtyRebaseReceipt.baseline);expect(state.dirtyRebaseOperationId).toBe(orphan.dirtyRebaseOperationId);
});

for(const resumed of [false,true])for(const fault of ['owner','identity','incarnation','epoch','local','revision','baseline','cancel','rollback'] as const)test(`${resumed?'ordinary resumed':'dirty'} receipt confirmation rejects ${fault} without a partial baseline patch`,async()=>{
 await setup();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Exact uploaded value'});const theirs=await base();theirs.push(wire('settings','remote',1));publish(theirs);index.compact(revision);
 if(resumed)await expect(synchronizeLibrary(async(path,body)=>{if(path==='/blocks/missing')throw Error('interrupted_upload');return request(path,body);})).rejects.toThrow('interrupted_upload');
 await expect(synchronizeLibrary(async(path,body)=>{const reply=await request(path,body);if(path==='/commit')throw Error('lost_ack');return reply;})).rejects.toThrow('lost_ack');
 const retained=await base(),pending=(await readCloudSync())!.pending!,controller=new AbortController(),sql=Reflect.get(database,'database');let injected=false;
 if(fault==='rollback')sql.exec("CREATE TEMP TRIGGER reject_receipt BEFORE INSERT ON sensa_sync_base WHEN NEW.table_name='drafts' BEGIN SELECT RAISE(ABORT,'receipt_rollback'); END");
 hook=async path=>{if(path!=='/blocks/fetch'||injected)return;injected=true;if(fault==='cancel')controller.abort();else if(fault==='local')await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Changed during receipt fetch'});else if(fault!=='rollback')await writeLibraryState(async tx=>{const state=await tx.get<any>('meta','cloud-sync');if(fault==='owner')tx.put('meta','service-owner',{...state.owner,subject:crypto.randomUUID()});if(fault==='identity')tx.put('meta','identity',{...identity,id:crypto.randomUUID()});if(fault==='incarnation')tx.put('meta','local-incarnation',crypto.randomUUID());if(fault==='epoch')tx.put('meta','service-signout-epoch',crypto.randomUUID());if(fault==='revision')tx.put('meta','cloud-sync',{...state,revision:state.revision+1});if(fault==='baseline')tx.put('meta','cloud-sync',{...state,syncedLocalRevision:state.syncedLocalRevision+1});});};
 try{await expect(synchronizeLibrary(request,{signal:controller.signal})).rejects.toThrow();}finally{hook=undefined;if(fault==='rollback')sql.exec('DROP TRIGGER reject_receipt');}
 expect(injected).toBe(true);expect(await base()).toEqual(retained);expect((await readCloudSync())?.pending?.operationId).toBe(pending.operationId);
 if(fault==='rollback'){await synchronizeLibrary(request);expect((await readCloudSync())?.status).toBe('synced');expect(bodies(await base())).toEqual(bodies(remote()));}
});

for(const failure of ['library_sync_missing_block','library_sync_hash','library_sync_format'])test(`an unavailable dirty receipt patch falls back after ${failure} without trusting its bodies`,async()=>{
 await setup();await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Exact retained upload'});const theirs=await base();theirs.push(wire('settings','remote',1));publish(theirs);index.compact(revision);
 await expect(synchronizeLibrary(async(path,body)=>{const reply=await request(path,body);if(path==='/commit')throw Error('lost_ack');return reply;})).rejects.toThrow('lost_ack');
 let failed=false;await synchronizeLibrary(async(path,body)=>{if(path==='/blocks/fetch'&&!failed){failed=true;throw Error(failure);}return request(path,body);});
 expect(failed).toBe(true);expect((await readCloudSync())?.status).toBe('synced');expect(bodies(await base())).toEqual(bodies(remote()));
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

for(const fault of ['stamp-source','stamp-carried-field','receipt-result','rewrite-receipt','unaccounted-head','registry-source','old-context-body'] as const)test(`batched Context proof safely falls back for ${fault}`,async()=>{
 const fixture=await contextDeltaFixture(2),after=structuredClone(fixture.after),meaning=after.find(row=>row.table==='semanticMeanings')!.value as any,head=after.find(row=>row.table==='semanticContexts'&&row.key.startsWith('anchors:'))!.value as any,stamp=meaning.personalMeaningRevisions.at(-1),receipt=after.find(row=>row.table==='semanticReceipts'&&row.key===stamp.provenance.createdByOperationId)!.value as any;
 if(fault==='stamp-source')stamp.provenance.sourceReferenceIds=[crypto.randomUUID()];else if(fault==='stamp-carried-field')stamp.learnerIntentNote='An independent edit';else if(fault==='receipt-result')receipt.result.revision++;else if(fault==='rewrite-receipt')(after.find(row=>row.table==='semanticReceipts'&&fixture.before.some(prior=>prior.table===row.table&&prior.key===row.key))!.value as any).requestDigest='b'.repeat(64);else if(fault==='unaccounted-head')Object.assign(head,structuredClone(fixture.before.find(row=>row.table==='semanticContexts'&&row.key.startsWith('anchors:'))!.value));else if(fault==='registry-source')(after.find(row=>row.table==='semanticRegistry')!.value as any).ordinal++;else (after.find(row=>row.table==='semanticContexts'&&row.key.startsWith('anchorRevisions:')&&fixture.before.some(prior=>prior.table===row.table&&prior.key===row.key))!.value as any).value.bodyText='Rewritten history';
 const dependencies=new SqliteSyncDependencies(Reflect.get(database,'database')),index=new SqliteRecordValidation(Reflect.get(database,'database'),()=>{}),wireRows=(rows:typeof after)=>rows.map(row=>({...row,value:encodeBackupValue(row.value)})) as LibraryReplicaEntry[];
 try{await expect(admitDirtyRebaseOverlay({base:wireRows(fixture.before),entries:wireRows(after),before:contextReader(fixture.before),after:contextReader(after),dependencies,certificate:dependencies.certificate()!,validationIndex:index,alive(){}})).rejects.toBeInstanceOf(DeltaReceiveFallback);}finally{index.close();dependencies.close();}
});

test('an unmarked generic patch cannot renew an otherwise valid certificate with unproved refs',async()=>{
 const drafts=await setup(),sql=Reflect.get(database,'database'),dependencies=new SqliteSyncDependencies(sql),prior=dependencies.certificate();expect(prior).toBeTruthy();const row=(await base()).find(row=>row.table==='drafts'&&row.key===drafts[0]!.id)!;
 await (await sqliteRecordAdapter()).commit({clears:[],deletes:[],puts:[],syncBasePatch:{puts:[{table:row.table,key:row.key,valueJson:JSON.stringify(row.value),blockRefs:['c'.repeat(64)]}],deletes:[]}});
 expect(dependencies.certificate()).toBeUndefined();dependencies.close();
});
