/** Shipped sync over SQLite/Wasm, with SQL faults and controlled transport.
 * This proves restore atomicity, not OPFS durability or large-account capacity. */
import {createHash} from 'node:crypto';
import {afterEach,beforeEach,expect,test} from 'vitest';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {openLibrary,readLibrary,writeLibraryState,restoreLibraryTransaction,readLocalLibraryRevision,type LibraryIdentity} from '../../../apps/web/src/data/library/store';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {saveDraft} from '../../../apps/web/src/data/library/drafts';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {librarySyncBlockFetch} from '@sensa/contracts/sensa';
import {encodeLibrarySyncBlock,splitLibrarySyncText,decodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
import type {SyncRequest} from '../../../apps/web/src/data/library/cloudSync';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://restore-atomicity.fixture.invalid/')});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const {synchronizeLibrary,readCloudSync,readCloudReconnectRequired}=await import('../../../apps/web/src/data/library/cloudSync');
let database:Awaited<ReturnType<typeof useNodeLearningCapacityStorage>>,sql:{exec:(statement:string)=>unknown},localIdentity:LibraryIdentity,remoteIdentity:LibraryIdentity;
beforeEach(async()=>{
 database=await useNodeLearningCapacityStorage();sql=Reflect.get(database,'database');
 localIdentity=await openLibrary();remoteIdentity={...localIdentity,id:crypto.randomUUID(),learnerId:crypto.randomUUID()};remoteIdentity.deviceId=remoteIdentity.id;
 await writeLibraryState(async tx=>tx.put('meta','service-owner',{subject:crypto.randomUUID(),accountId:crypto.randomUUID()}));
 blocks.clear();revision=0;manifest=[];onFetch=undefined;
});
afterEach(()=>database.close());
const first={id:crypto.randomUUID(),revision:1,text:'A complete cloud draft.',createdAt:'2026-10-08T00:00:00.000Z',updatedAt:'2026-10-08T00:00:00.000Z'};
const second={...first,id:crypto.randomUUID(),text:'Another remote draft.'};
const blocks=new Map<string,string>();let revision=0,manifest:string[]=[];
function block(text:string){const data=encodeLibrarySyncBlock(text),id=createHash('sha256').update(data).digest('hex');blocks.set(id,data);return id;}
function publish(drafts:typeof first[]){
 const entries=[{table:'meta',key:'identity',value:remoteIdentity},...drafts.map(value=>({table:'drafts',key:value.id,value}))];
 publishEntries(entries);
}
function publishEntries(entries:Array<{table:string;key:string;value:unknown}>){
 const rows=entries.map(row=>({table:row.table,key:row.key,blocks:[block(JSON.stringify(encodeBackupValue(row.value)))]}));
 manifest=splitLibrarySyncText(JSON.stringify({version:6,libraryId:remoteIdentity.id,learnerId:remoteIdentity.learnerId,rows})).map(block);revision++;
}
let onFetch:(()=>Promise<void>)|undefined;
const request:SyncRequest=async(path,body)=>{
 if(path==='/head')return {revision,manifest};
 if(path==='/blocks/fetch'){
  await onFetch?.();
  const input=librarySyncBlockFetch.parse(body);
  return {blocks:input.hashes.filter(id=>blocks.has(id)).map(hash=>({hash,data:blocks.get(hash)!})),missing:input.hashes.filter(id=>!blocks.has(id)),deferred:[]};
 }
 throw new Error(`unexpected_restore_request:${path}`);
};
const facts=()=>readLibrary(async tx=>({identity:await tx.get('meta','identity'),creation:await tx.get<{result:LibraryIdentity}>('operations','00000000-0000-4000-8000-000000000001'),drafts:await tx.entries('drafts'),base:await tx.syncBaseEntries(),localRevision:await readLocalLibraryRevision(tx)}));

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
 const state=(await readCloudSync())!;await writeLibraryState(async tx=>tx.put('meta','cloud-sync',{...state,validationVersion:undefined}));
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
 expect(logicalBytes).toBeGreaterThan(64*1024*1024);expect(maxBatchBytes).toBeLessThanOrEqual(4*1024*1024);expect(maxRecords).toBeLessThanOrEqual(128);expect(appends).toBeGreaterThan(1);
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

test('a missing body after head replacement discards the old generation and restores only the new head',async()=>{
 publish([first]);let fetches=0;
 onFetch=async()=>{if(++fetches===2){blocks.clear();publish([second]);}};
 try{await synchronizeLibrary(request);}finally{onFetch=undefined;}
 const after=await facts();expect(after.drafts.map(row=>row.value)).toEqual([second]);expect((await readCloudSync())?.revision).toBe(2);expect((await readCloudSync())?.status).toBe('synced');
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
 manifest=splitLibrarySyncText(JSON.stringify({version:6,libraryId:remoteIdentity.id,learnerId:remoteIdentity.learnerId,rows})).map(block);revision++;
 const adapter=await sqliteRecordAdapter(),original=adapter.replicaCandidate.bind(adapter);let proofs=0;
 adapter.replicaCandidate=async message=>{if(message.kind==='prove')proofs++;return original(message);};
 try{await synchronizeLibrary(request);}finally{adapter.replicaCandidate=original;}
 expect(proofs).toBeGreaterThanOrEqual(2);expect(await readLibrary(tx=>tx.get('settings','fragmented-opaque'))).toBe(setting);expect((await readCloudSync())?.status).toBe('synced');
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
 manifest=splitLibrarySyncText(JSON.stringify({version:6,libraryId:remoteIdentity.id,learnerId:remoteIdentity.learnerId,rows})).map(block);revision++;
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
 const firstMeaning=world.meanings[0]!,sense=world.registry.senses[0]!,expectedKey=`senses:${sense.senseId}`,wire=JSON.stringify(encodeBackupValue(firstMeaning));
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
