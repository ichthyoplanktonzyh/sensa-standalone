/** Actual Sensa schema over SQLite/Wasm's memory filesystem. These focused
 * admission checks do not establish OPFS, generation activation or capacity. */
import {afterAll,expect,test,vi} from 'vitest';
import init from '@sqlite.org/sqlite-wasm';
import type {Database,SAHPoolUtil} from '@sqlite.org/sqlite-wasm';
import {SqliteSyncDependencies} from '../../../apps/web/src/data/library/sqliteSyncDependencies';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {decodeBackupValue,encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {decodeSharedArchiveWire,unpackStoredRecord} from '../../../apps/web/src/data/library/sharedRecordContent';
import {gzipSync,strToU8} from 'fflate';
import {createLocalPortableSnapshot,importLocalPortableSnapshot,createOwnCloudPortableSnapshot,importOwnCloudPortableSnapshot} from '../../../apps/web/src/data/library/sqlitePortableSnapshot';
import {sha256} from '@sensa/learning-kernel';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system/index';
import {openLibrary,readLibrary,readLocalLibraryRevision} from '../../../apps/web/src/data/library/store';
import {enrollPackage,confirmLearningQuantity,finishLearning} from '../../../apps/web/src/data/library/learning';
import {startLearning,actLearning} from '../support/learningRunFixture';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {LibraryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {manualMeaningPayload,newManualMeaningDraft} from '../../../apps/web/src/experience/intake/manualMeaning';
import {libraryRowsReader} from '../../../apps/web/src/data/library/libraryRecordReader';
import {sqliteLibraryTables} from '../../../apps/web/src/data/library/sqliteProtocol';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';
import {canCopyNormalizedLibraryReplicaValue,normalizeLibraryReplicaEntry,isReplicatedLibraryEntry} from '../../../apps/web/src/data/library/replication/libraryReplica';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://snapshot.fixture.invalid/')});
const sqlite=await init(),raw=new sqlite.oo1.DB('/snapshot-focused-source.sqlite3','c');
const source=new SqliteRecordDatabase(sqlite,raw,'memory');source.initialize();afterAll(()=>source.close());
const identity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:'2026-10-12T08:00:00.000Z',schemaVersion:2};
source.commit({clears:[],deletes:[],puts:[{table:'meta',key:'identity',encodedValue:JSON.stringify(encodeBackupValue(identity))}]});
const canary='SYNTHETIC-DEVICE-PRIVATE-CANARY';
for(const [table,key]of [['meta','service-owner'],['settings','providers'],['providers',crypto.randomUUID()],['operations',crypto.randomUUID()],['packageCache','synthetic-cache']] as const)raw.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json) VALUES(?,?,?)',bind:[table,key,JSON.stringify(encodeBackupValue({canary}))]});
const privateBody=JSON.stringify(encodeBackupValue({canary})),privateDigest=sha256(privateBody);
raw.exec({sql:'INSERT INTO sensa_shared_record_content VALUES(?,?)',bind:[privateDigest,privateBody]});
raw.exec({sql:"INSERT INTO sensa_shared_record_content_owners VALUES('record','packageCache','synthetic-cache',?),('sync','meta','identity',?)",bind:[privateDigest,privateDigest]});

/** Adapter for the installed SQLite memory VFS, not a fake SQL engine or an
 * assertion of actual SAHPool/OPFS support. */
function memoryFilePool(){
 const files=new Set<string>(),handles=new Map<string,Database>();
 return {
  handles,
  OpfsSAHPoolDb:class extends sqlite.oo1.DB{constructor(file:string){super(file,'c');files.add(file);handles.set(file,this);}},
  getFileCount:()=>files.size,
  reserveMinimumCapacity:async()=>0,
  unlink:(file:string)=>files.delete(file),
  exportFile:(file:string)=>{const db=new sqlite.oo1.DB(file,'r');try{return sqlite.capi.sqlite3_js_db_export(db.pointer);}finally{db.close();}},
  importDb:async(file:string,read:()=>Uint8Array|undefined)=>{const chunks:Uint8Array[]=[];let length=0;for(;;){const chunk=await read();if(chunk===undefined)break;chunks.push(chunk);length+=chunk.length;}const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}sqlite.capi.sqlite3_js_posix_create_file(file,bytes);files.add(file);return length;},
 } as unknown as SAHPoolUtil&{handles:Map<string,Database>};
}
const snapshot=await createLocalPortableSnapshot(sqlite,memoryFilePool(),source,0);
test('trusted producer excludes device rows and pages without mutating its source',()=>{
 expect(snapshot.schemaVersion).toBe(19);expect(snapshot.bytes.length).toBeGreaterThan(512);
 expect(new TextDecoder().decode(snapshot.bytes)).not.toContain(canary);
 expect(source.count('providers')).toBe(1);expect(source.count('operations')).toBe(1);
 expect(source.get('meta','identity')).toBe(JSON.stringify(encodeBackupValue(identity)));
});
test('storage copying follows producer normalization rather than restore transforms',()=>{
 for(const table of ['learningTargets','learningRuns','learningEvents','semanticMeanings','packageInstallations','settings'] as const)expect(canCopyNormalizedLibraryReplicaValue({table,key:'synthetic'})).toBe(true);
 for(const table of ['sessions','personalLearning','contentAttempts'] as const)expect(canCopyNormalizedLibraryReplicaValue({table,key:'synthetic'})).toBe(false);
 expect(canCopyNormalizedLibraryReplicaValue({table:'meta',key:'identity'})).toBe(false);
 expect(()=>canCopyNormalizedLibraryReplicaValue({table:'settings',key:'providers'})).toThrow('library_sync_format');
 expect(normalizeLibraryReplicaEntry({table:'meta',key:'identity',value:identity},identity).value).toEqual({...identity,deviceId:identity.id});
 expect(normalizeLibraryReplicaEntry({table:'sessions',key:'synthetic',value:{status:'inflight',lease:{owner:'synthetic'},revision:3}},identity).value).toEqual({status:'stopped',lease:null,revision:4});
 expect(normalizeLibraryReplicaEntry({table:'personalLearning',key:'synthetic',value:{status:'generating',leaseUntil:123}},identity).value).toEqual({status:'failed',leaseUntil:0,notice:'localFlow.restoredPreparation'});
 expect(normalizeLibraryReplicaEntry({table:'contentAttempts',key:'synthetic',value:{status:'reviewing'}},identity).value).toEqual({status:'failed'});
});
test('storage copy rejects private or transform-required selections before reading the owner',()=>{
 const buildRaw=new sqlite.oo1.DB(':memory:','c'),build=new SqliteRecordDatabase(sqlite,buildRaw,'memory',(table,key)=>isReplicatedLibraryEntry(table,key)&&canCopyNormalizedLibraryReplicaValue({table:table as Parameters<typeof canCopyNormalizedLibraryReplicaValue>[0]['table'],key}));build.initialize();buildRaw.exec('BEGIN IMMEDIATE');
 const read=vi.spyOn(raw,'exec');
 try{
  for(const [table,key]of [['providers','synthetic'],['settings','providers'],['meta','service-owner'],['meta','identity'],['sessions','synthetic'],['packageCache','synthetic-cache']] as const)expect(()=>build.copyStoredPortableFacts(source,table,[key])).toThrow('sqlite_snapshot_copy_boundary');
  expect(read).not.toHaveBeenCalled();expect(build.count('providers')).toBe(0);expect(build.count('packageCache')).toBe(0);
 }finally{read.mockRestore();buildRaw.exec('ROLLBACK');build.close();}
});
test('excluded private cache bodies are not read or decoded by production export',async()=>{
 raw.exec({sql:"UPDATE sensa_records SET value_json=? WHERE table_name='packageCache'",bind:['["sensa-record-gzip-v1","'+ 'a'.repeat(64)+'","invalid-gzip"]']});
 const exported=await createLocalPortableSnapshot(sqlite,memoryFilePool(),source,0);
 expect(new TextDecoder().decode(exported.bytes)).not.toContain('invalid-gzip');
});
test('source identity is fenced across asynchronous capacity acquisition',async()=>{
 const pool=memoryFilePool(),next={...identity,id:crypto.randomUUID()};
 pool.reserveMinimumCapacity=async()=>{source.commit({clears:[],deletes:[],puts:[{table:'meta',key:'identity',encodedValue:JSON.stringify(encodeBackupValue(next))}]});return 0;};
 try{await expect(createLocalPortableSnapshot(sqlite,pool,source,0)).rejects.toThrow('sqlite_snapshot_source_changed');}
 finally{source.commit({clears:[],deletes:[],puts:[{table:'meta',key:'identity',encodedValue:JSON.stringify(encodeBackupValue(identity))}]});}
});
test('real-schema import admits consistent projections and regenerates device identity',async()=>{
 const imported=await importLocalPortableSnapshot(sqlite,memoryFilePool(),'/focused-import-'+crypto.randomUUID(),snapshot);
 try{expect(imported.stats.decodedRecords).toBe(1);expect(imported.stats.decodedBodies).toBe(0);expect(imported.identity.id).toBe(identity.id);expect(imported.identity.deviceId).not.toBe(identity.deviceId);expect(imported.library.count('providers')).toBe(0);const dependencies=new SqliteSyncDependencies(Reflect.get(imported.library,'database'));expect(dependencies.certificate()).toBeUndefined();expect(dependencies.count()).toBe(0);}finally{imported.library.close();}
});
test('own-cloud admission is distinct from external import and keeps checkpoint, schema and byte gates',async()=>{
 const db=new sqlite.oo1.DB(':memory:','c'),own=new SqliteRecordDatabase(sqlite,db,'memory');own.initialize();const owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()},incarnation=crypto.randomUUID();
 own.commit({clears:[],deletes:[],puts:[{table:'meta',key:'identity',encodedValue:JSON.stringify(encodeBackupValue(identity))},{table:'meta',key:'service-owner',encodedValue:JSON.stringify(encodeBackupValue(owner))},{table:'meta',key:'local-incarnation',encodedValue:JSON.stringify(encodeBackupValue(incarnation))}]});
 try{
  const exported=await createOwnCloudPortableSnapshot(sqlite,memoryFilePool(),own,{owner,incarnation,identity:identity as any,localRevision:0}),binding={accountId:owner.accountId,libraryId:identity.id,learnerId:identity.learnerId,revision:1,sourceRevision:0,records:1,sha256:exported.sha256,byteLength:exported.bytes.length,schemaVersion:exported.schemaVersion};
  const imported=await importOwnCloudPortableSnapshot(sqlite,memoryFilePool(),'/own-'+crypto.randomUUID(),exported,binding,owner.accountId);expect(imported.library.count('meta')).toBe(3);expect(imported.library.initialize().schemaVersion).toBe(exported.schemaVersion);
  expect(imported.library.count('operations')).toBe(1);expect(decodeBackupValue(JSON.parse(imported.library.get('operations','00000000-0000-4000-8000-000000000001')!)).result).toEqual(imported.identity);
  const restoredRaw=Reflect.get(imported.library,'database'),generation=Number(restoredRaw.selectValue('SELECT generation FROM sensa_sync_dependency_state_v1'));imported.library.commit({clears:[],deletes:[],puts:[],syncBasePatch:{puts:[{table:'meta',key:'identity',valueJson:JSON.stringify(encodeBackupValue(identity)),blockRefs:['a'.repeat(64)]}],deletes:[]}});expect(Number(restoredRaw.selectValue('SELECT generation FROM sensa_sync_dependency_state_v1'))).toBe(generation+1);imported.library.close();
  const reconnectDeviceId=crypto.randomUUID(),reconnected=await importOwnCloudPortableSnapshot(sqlite,memoryFilePool(),'/reconnect-'+crypto.randomUUID(),exported,binding,owner.accountId,reconnectDeviceId);
  try{expect(reconnected.identity.deviceId).toBe(reconnectDeviceId);expect(decodeBackupValue(JSON.parse(reconnected.library.get('operations','00000000-0000-4000-8000-000000000001')!)).result).toEqual(reconnected.identity);}finally{reconnected.library.close();}
  for(const invalidDeviceId of ['not-a-device-id',identity.id])await expect(importOwnCloudPortableSnapshot(sqlite,memoryFilePool(),'/reconnect-refused-'+crypto.randomUUID(),exported,binding,owner.accountId,invalidDeviceId)).rejects.toThrow('sqlite_snapshot_identity');
  for(const changed of [{...binding,accountId:crypto.randomUUID()},{...binding,libraryId:crypto.randomUUID()},{...binding,schemaVersion:20},{...binding,byteLength:binding.byteLength+1},{...binding,revision:0}])await expect(importOwnCloudPortableSnapshot(sqlite,memoryFilePool(),'/refuse-'+crypto.randomUUID(),exported,changed,owner.accountId)).rejects.toThrow('sqlite_snapshot_');
  const file='/own-corrupt-'+crypto.randomUUID();sqlite.capi.sqlite3_js_posix_create_file(file,exported.bytes);const changed=new sqlite.oo1.DB(file,'c'),changedLibrary=new SqliteRecordDatabase(sqlite,changed,'memory');
  // Same structural bytes can contain a controlled writer's semantic bug.
  // Only the normal account route accepts that tradeoff; external import does not.
  changed.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('settings','language-learning-routes',?)",bind:[JSON.stringify(encodeBackupValue(false))]});const bytes=sqlite.capi.sqlite3_js_db_export(changed.pointer);changedLibrary.close();const altered={...exported,bytes,sha256:sha256(bytes)},alteredBinding={...binding,sha256:altered.sha256,byteLength:bytes.length,records:2};
  const accepted=await importOwnCloudPortableSnapshot(sqlite,memoryFilePool(),'/controlled-'+crypto.randomUUID(),altered,alteredBinding,owner.accountId);accepted.library.close();await expect(importLocalPortableSnapshot(sqlite,memoryFilePool(),'/external-'+crypto.randomUUID(),altered)).rejects.toThrow();
  const unsafe=new sqlite.oo1.DB(file,'c');unsafe.exec('CREATE TRIGGER arbitrary_trigger AFTER INSERT ON sensa_records BEGIN DELETE FROM sensa_records; END');const danger=sqlite.capi.sqlite3_js_db_export(unsafe.pointer);unsafe.close();const dangerous={...exported,bytes:danger,sha256:sha256(danger)};
  await expect(importOwnCloudPortableSnapshot(sqlite,memoryFilePool(),'/unsafe-'+crypto.randomUUID(),dangerous,{...binding,records:2,byteLength:danger.length,sha256:dangerous.sha256},owner.accountId)).rejects.toThrow('sqlite_snapshot_schema_allowlist');
  const staleFile='/own-stale-projection-'+crypto.randomUUID();sqlite.capi.sqlite3_js_posix_create_file(staleFile,exported.bytes);const staleDb=new sqlite.oo1.DB(staleFile,'c');staleDb.exec('UPDATE sensa_world_browse_meta SET version=0');const staleBytes=sqlite.capi.sqlite3_js_db_export(staleDb.pointer);staleDb.close();const stale={...exported,bytes:staleBytes,sha256:sha256(staleBytes)};await expect(importOwnCloudPortableSnapshot(sqlite,memoryFilePool(),'/stale-'+crypto.randomUUID(),stale,{...binding,byteLength:staleBytes.length,sha256:stale.sha256},owner.accountId)).rejects.toThrow('sqlite_snapshot_projection_version');
  await expect(createOwnCloudPortableSnapshot(sqlite,memoryFilePool(),own,{owner:{...owner,accountId:crypto.randomUUID()},incarnation,identity:identity as any,localRevision:0})).rejects.toThrow('sqlite_snapshot_owner');
 }finally{own.close();}
});
test('fabricated semantic-memory cache cannot become a query result',async()=>{
 const file='/focused-projection-source-'+crypto.randomUUID();sqlite.capi.sqlite3_js_posix_create_file(file,snapshot.bytes);
 const bad=new sqlite.oo1.DB(file,'c');bad.exec("INSERT INTO sensa_learning_semantic_memory(target_key,sense_id,summary_json,valid,list_json) VALUES('fabricated',NULL,'{}',1,'{}')");
 const bytes=sqlite.capi.sqlite3_js_db_export(bad.pointer);bad.close();
 await expect(importLocalPortableSnapshot(sqlite,memoryFilePool(),'/focused-projection-import-'+crypto.randomUUID(),{...snapshot,bytes,sha256:sha256(bytes)})).rejects.toThrow('sqlite_snapshot_projection_values');
});
test('asynchronous import consumes a private hash-checked buffer',async()=>{
 const mutable={...snapshot,bytes:snapshot.bytes.slice()},pool=memoryFilePool(),consume=pool.importDb.bind(pool);
 pool.importDb=async(file,read)=>{mutable.bytes.fill(0);return consume(file,read);};
 const imported=await importLocalPortableSnapshot(sqlite,pool,'/private-copy-'+crypto.randomUUID(),mutable);
 try{expect(sha256(mutable.bytes)).not.toBe(snapshot.sha256);expect(imported.identity.id).toBe(identity.id);}finally{imported.library.close();}
});
test('real Learning and Meaning commands roundtrip with shared content and query projections',async()=>{
 const learning=await useNodeLearningCapacityStorage(),context=sensaPinnedLanguageContext(defaultSensaLanguageRoute),at='2026-10-12T08:00:00.000Z';
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);
 try{
  await openLibrary();const fixture=portablePackageFixture({packageId:crypto.randomUUID()});
  const preview=await contentSupplySystem.execute({kind:'preview_portable_package',bytes:fixture.bytes});
  const pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:preview.archiveDigest});
  const [targetId]=await enrollPackage(crypto.randomUUID(),pack.key,context);
  await confirmLearningQuantity(crypto.randomUUID(),context,20);
  let run=await startLearning(crypto.randomUUID(),targetId!,context,20,at);
  // One genuine Run crosses the producer's 64-key Event page boundary, while
  // sharing its immutable material and protocol bodies with other records.
  for(let attempt=0;attempt<32;attempt++){
   run=await actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'reveal'},at);
   run=await actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'rate',rating:'again'},at);
  }
  run=await actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'reveal'},at);
  run=await actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'rate',rating:'good'},at);
  await finishLearning(crypto.randomUUID(),run.id);
  const modules=createJourneyModules({repository:new LibraryJourneyRepository(),clock:createSeededClock(at),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
  const accepted=await modules.semanticIntake.submit(manualMeaningPayload({...newManualMeaningDraft(),context:'May asked to borrow an umbrella.',occurrence:'borrow',canonicalForm:'borrow',languageTag:'en',meaning:'暂时借用物品，之后归还。',usage:'借用朋友的雨伞，之后归还。'}));
  expect(accepted.route).toBe('fast_track');
  const expected=await readLibrary(tx=>tx.get('learningTargets',targetId!)),revision=await readLibrary(readLocalLibraryRevision);
  const get=vi.spyOn(learning,'get');
  const exported=await createLocalPortableSnapshot(sqlite,memoryFilePool(),learning,revision);
  expect(get.mock.calls.some(([table])=>['learningTargets','learningRuns','learningEvents','studyScopes','semanticMeanings','semanticContexts'].includes(table))).toBe(false);get.mockRestore();
  const imported=await importLocalPortableSnapshot(sqlite,memoryFilePool(),'/focused-learning-'+crypto.randomUUID(),exported);
  try{
   expect(imported.stats.decodedBodies).toBeGreaterThan(0);
   expect(imported.library.count('learningTargets')).toBe(1);expect(imported.library.count('learningRuns')).toBe(1);expect(imported.library.count('learningEvents')).toBe(66);
   expect(imported.library.count('packageCache')).toBe(0);expect(imported.library.count('operations')).toBe(0);
   expect(imported.library.get('learningTargets',targetId!)).toBe(JSON.stringify(encodeBackupValue(expected)));
   expect(imported.library.learningSemanticMemory(targetId!).targets[0]?.targetId).toBe(targetId);
   expect(imported.library.count('semanticMeanings')).toBe(1);expect(imported.library.count('semanticReceipts')).toBeGreaterThan(0);
   expect(imported.library.lookupMeanings('borrow')).toEqual(learning.lookupMeanings('borrow'));
   expect(imported.library.worldBrowse({query:'',filter:'all',offset:0,limit:20})).toEqual(learning.worldBrowse({query:'',filter:'all',offset:0,limit:20}));
  }finally{imported.library.close();}
  const storedTables=['sensa_records','sensa_shared_record_content','sensa_shared_record_content_owners'];
  const firstFile='/focused-stored-source-'+crypto.randomUUID();sqlite.capi.sqlite3_js_posix_create_file(firstFile,exported.bytes);
  const firstRaw=new sqlite.oo1.DB(firstFile,'c'),first=new SqliteRecordDatabase(sqlite,firstRaw,'memory');first.initialize();
  try{
   const next=await createLocalPortableSnapshot(sqlite,memoryFilePool(),first,0),nextFile='/focused-stored-copy-'+crypto.randomUUID();sqlite.capi.sqlite3_js_posix_create_file(nextFile,next.bytes);
   const nextRaw=new sqlite.oo1.DB(nextFile,'r');
   try{for(const table of storedTables)expect(nextRaw.exec({sql:`SELECT * FROM ${table} ORDER BY 1,2`,rowMode:'array',returnValue:'resultRows'})).toEqual(firstRaw.exec({sql:`SELECT * FROM ${table} ORDER BY 1,2`,rowMode:'array',returnValue:'resultRows'}));}finally{nextRaw.close();}
   expect(()=>first.copyStoredPortableFacts(first,'providers',[])).toThrow('sqlite_snapshot_build_boundary');
  }finally{first.close();}
  for(const corruption of ['digest','missing-body','missing-owner','extra-owner'] as const){
   const file='/focused-corrupt-stored-'+crypto.randomUUID();sqlite.capi.sqlite3_js_posix_create_file(file,exported.bytes);
   const corruptRaw=new sqlite.oo1.DB(file,'c'),corruptSource=new SqliteRecordDatabase(sqlite,corruptRaw,'memory');corruptSource.initialize();
   const owner=corruptRaw.exec({sql:"SELECT table_name,record_key,digest FROM sensa_shared_record_content_owners WHERE owner_kind='record' LIMIT 1",rowMode:'object',returnValue:'resultRows'})[0] as {table_name:string;record_key:string;digest:string};
   if(corruption==='digest')corruptRaw.exec({sql:'UPDATE sensa_shared_record_content SET value_json=? WHERE digest=?',bind:[JSON.stringify(encodeBackupValue({corrupt:true})),owner.digest]});
   else if(corruption==='missing-body'){corruptRaw.exec('PRAGMA foreign_keys=OFF');corruptRaw.exec({sql:'DELETE FROM sensa_shared_record_content WHERE digest=?',bind:[owner.digest]});}
   else if(corruption==='missing-owner')corruptRaw.exec({sql:"DELETE FROM sensa_shared_record_content_owners WHERE owner_kind='record' AND table_name=? AND record_key=? AND digest=?",bind:[owner.table_name,owner.record_key,owner.digest]});
   else corruptRaw.exec({sql:"INSERT INTO sensa_shared_record_content_owners SELECT 'record','semanticMeanings',record_key,? FROM sensa_records WHERE table_name='semanticMeanings' LIMIT 1",bind:[owner.digest]});
   const before=sha256(sqlite.capi.sqlite3_js_db_export(corruptRaw.pointer)),pool=memoryFilePool();
   try{const outcome=await createLocalPortableSnapshot(sqlite,pool,corruptSource,0).then(()=>'accepted',error=>'rejected: '+String(error));expect(outcome,corruption).toMatch(/^rejected:/u);expect(pool.getFileCount()).toBe(0);expect(sha256(sqlite.capi.sqlite3_js_db_export(corruptRaw.pointer))).toBe(before);}finally{corruptSource.close();}
  }
  const failedFile='/focused-atomic-'+crypto.randomUUID(),failedPool=memoryFilePool();
  const failed=await importLocalPortableSnapshot(sqlite,failedPool,failedFile,exported),failedRaw=failedPool.handles.get(failedFile)!;
  const beforeBytes=sha256(sqlite.capi.sqlite3_js_db_export(failedRaw.pointer)),sourceBefore=JSON.stringify(sqliteLibraryTables.map(table=>learning.entries(table)));
  const admittedRows=Object.fromEntries(sqliteLibraryTables.map(table=>[table,failed.library.entries(table).map(row=>({key:row.key,value:decodeBackupValue(JSON.parse(row.encodedValue))}))])) as BackupRows;
  const reader=libraryRowsReader(admittedRows);let faultInsideTransaction=false;
  try{
   expect(()=>failed.library.rebuildPortableProjections({...reader,entries:function*(table){
    if(table==='learningRuns'){faultInsideTransaction=sqlite.capi.sqlite3_get_autocommit(failedRaw.pointer!)===0;throw Error('synthetic_projection_mid_transaction');}
    yield*reader.entries(table);
   }})).toThrow('synthetic_projection_mid_transaction');
   expect(faultInsideTransaction).toBe(true);expect(sqlite.capi.sqlite3_get_autocommit(failedRaw.pointer!)).toBe(1);
   expect(sha256(sqlite.capi.sqlite3_js_db_export(failedRaw.pointer))).toBe(beforeBytes);
   expect(failed.library.connectionFailed).toBe(true);expect(()=>failed.library.initialize()).toThrow('synthetic_projection_mid_transaction');
   expect(JSON.stringify(sqliteLibraryTables.map(table=>learning.entries(table)))).toBe(sourceBefore);
   expect(learning.lookupMeanings('borrow').meanings).toHaveLength(1);
  }finally{failed.library.close(false);}
  const checkpointFile='/focused-checkpoint-'+crypto.randomUUID(),checkpointPool=memoryFilePool();
  const checkpoint=await importLocalPortableSnapshot(sqlite,checkpointPool,checkpointFile,exported),checkpointRaw=checkpointPool.handles.get(checkpointFile)!;
  const execute=checkpointRaw.exec.bind(checkpointRaw),fault=Object.assign(new Error('synthetic_checkpoint_io_failure'),{resultCode:10});
  const spy=vi.spyOn(checkpointRaw,'exec').mockImplementation((...args)=>{
   const input=args[0];if((typeof input==='string'?input:input.sql)==='PRAGMA wal_checkpoint(TRUNCATE)')throw fault;
   return execute(...args);
  });
  try{
   expect(()=>checkpoint.library.rebuildPortableProjections(reader)).toThrow('synthetic_checkpoint_io_failure');
   expect(checkpoint.library.connectionFailed).toBe(true);
   expect(JSON.stringify(sqliteLibraryTables.map(table=>learning.entries(table)))).toBe(sourceBefore);
  }finally{spy.mockRestore();checkpoint.library.close(false);}
  for(const mutation of ['missing-json-reference','wrong-source-pin'] as const){
   const file='/focused-invalid-learning-source-'+crypto.randomUUID();sqlite.capi.sqlite3_js_posix_create_file(file,exported.bytes);
   const badRaw=new sqlite.oo1.DB(file,'c'),bad=new SqliteRecordDatabase(sqlite,badRaw,'memory');
   const target=decodeBackupValue(JSON.parse(bad.get('learningTargets',targetId!)!));
   if(mutation==='missing-json-reference')target.curriculumMemberships[0].provenance.curriculumEnrollmentId=crypto.randomUUID();
   else target.curriculumMemberships[0].sourcePin.senseVersionId=crypto.randomUUID();
   bad.commit({clears:[],deletes:[],puts:[{table:'learningTargets',key:targetId!,encodedValue:JSON.stringify(encodeBackupValue(target))}]});
   expect(badRaw.selectValue('PRAGMA integrity_check')).toBe('ok');
   expect(badRaw.exec({sql:'PRAGMA foreign_key_check',returnValue:'resultRows'})).toEqual([]);
   const bytes=sqlite.capi.sqlite3_js_db_export(badRaw.pointer);bad.close();
   const pool=memoryFilePool();
   await expect(importLocalPortableSnapshot(sqlite,pool,'/focused-invalid-learning-import-'+crypto.randomUUID(),{...exported,bytes,sha256:sha256(bytes)})).rejects.toThrow();
   expect(pool.getFileCount()).toBe(0);
  }
 }finally{vi.useRealTimers();learning.close();}
});
test('transport tampering fails before destination creation',async()=>{
 const pool=memoryFilePool(),bytes=snapshot.bytes.slice();bytes[100]^=1;
 await expect(importLocalPortableSnapshot(sqlite,pool,'/focused-invalid-'+crypto.randomUUID(),{...snapshot,bytes})).rejects.toThrow('sqlite_snapshot_envelope');expect(pool.getFileCount()).toBe(0);
});
test('invalid source revision cannot become accepted snapshot metadata',async()=>{
 await expect(importLocalPortableSnapshot(sqlite,memoryFilePool(),'/focused-invalid-revision-'+crypto.randomUUID(),{...snapshot,sourceRevision:-1})).rejects.toThrow('sqlite_snapshot_envelope');
});
test('partial import failure removes only its new destination file',async()=>{
 const pool=memoryFilePool();
 pool.importDb=async(file,read)=>{await read();const opened=new pool.OpfsSAHPoolDb(file);opened.close();throw Error('synthetic_interrupted_import');};
 await expect(importLocalPortableSnapshot(sqlite,pool,'/focused-partial-'+crypto.randomUUID(),snapshot)).rejects.toThrow('synthetic_interrupted_import');
 expect(pool.getFileCount()).toBe(0);expect(source.count('operations')).toBe(1);
});
test('schema objects from the imported file are never accepted by name alone',async()=>{
 const file='/focused-hostile-source-'+crypto.randomUUID();sqlite.capi.sqlite3_js_posix_create_file(file,snapshot.bytes);
 const hostile=new sqlite.oo1.DB(file,'c');hostile.exec('CREATE TABLE injected(value TEXT);CREATE TRIGGER injected_trigger AFTER INSERT ON injected BEGIN SELECT 1;END');
 const bytes=sqlite.capi.sqlite3_js_db_export(hostile.pointer);hostile.close();
 await expect(importLocalPortableSnapshot(sqlite,memoryFilePool(),'/focused-hostile-import-'+crypto.randomUUID(),{...snapshot,bytes,sha256:sha256(bytes)})).rejects.toThrow('sqlite_snapshot_schema_allowlist');
});
test('shared decoding preserves strict tags and object fields',()=>{
 const digest='a'.repeat(64),body={resources:['synthetic']},bodies=new Map([[digest,body]]),used=new Set<string>();
 const row=decodeSharedArchiveWire(['object',[['content',['sensa-shared-content-v1',digest]]]],bodies,used);expect(row.content).toBe(body);expect(used.has(digest)).toBe(true);
 for(const wire of [['array',[],false],['object',[['field',['string','x'],'extra']]],['unknown','x'],['sensa-shared-content-v1','b'.repeat(64)]])expect(()=>decodeSharedArchiveWire(wire,bodies,new Set())).toThrow();
});
test('a forged gzip size cannot turn an expanded suffix into an accepted JSON prefix',()=>{
 const prefix='["string","synthetic"]',gzip=gzipSync(strToU8(prefix+' '.repeat(100000)));
 new DataView(gzip.buffer,gzip.byteOffset,gzip.byteLength).setUint32(gzip.length-4,prefix.length,true);
 const forged=JSON.stringify(['sensa-record-gzip-v1',sha256(prefix),Buffer.from(gzip).toString('base64')]);
 expect(()=>unpackStoredRecord(forged)).toThrow('sqlite_shared_content_invalid');
});
