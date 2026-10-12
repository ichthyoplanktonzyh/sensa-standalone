/** Actual Sensa schema over SQLite/Wasm's memory filesystem. These focused
 * admission checks do not establish OPFS, generation activation or capacity. */
import {afterAll,expect,test,vi} from 'vitest';
import init from '@sqlite.org/sqlite-wasm';
import type {SAHPoolUtil} from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {decodeBackupValue,encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {decodeSharedArchiveWire,unpackStoredRecord} from '../../../apps/web/src/data/library/sharedRecordContent';
import {gzipSync,strToU8} from 'fflate';
import {createLocalPortableSnapshot,importLocalPortableSnapshot} from '../../../apps/web/src/data/library/sqlitePortableSnapshot';
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

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://snapshot.fixture.invalid/')});
const sqlite=await init(),raw=new sqlite.oo1.DB('/snapshot-focused-source.sqlite3','c');
const source=new SqliteRecordDatabase(sqlite,raw,'memory');source.initialize();afterAll(()=>source.close());
const identity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:'2026-10-12T08:00:00.000Z',schemaVersion:2};
source.commit({clears:[],deletes:[],puts:[{table:'meta',key:'identity',encodedValue:JSON.stringify(encodeBackupValue(identity))}]});
const canary='SYNTHETIC-DEVICE-PRIVATE-CANARY';
for(const [table,key]of [['meta','service-owner'],['settings','providers'],['providers',crypto.randomUUID()],['operations',crypto.randomUUID()],['packageCache','synthetic-cache']] as const)raw.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json) VALUES(?,?,?)',bind:[table,key,JSON.stringify(encodeBackupValue({canary}))]});

/** Adapter for the installed SQLite memory VFS, not a fake SQL engine or an
 * assertion of actual SAHPool/OPFS support. */
function memoryFilePool(){
 const files=new Set<string>();
 return {
  OpfsSAHPoolDb:class extends sqlite.oo1.DB{constructor(file:string){super(file,'c');files.add(file);}},
  getFileCount:()=>files.size,
  reserveMinimumCapacity:async()=>0,
  unlink:(file:string)=>files.delete(file),
  exportFile:(file:string)=>{const db=new sqlite.oo1.DB(file,'r');try{return sqlite.capi.sqlite3_js_db_export(db.pointer);}finally{db.close();}},
  importDb:async(file:string,read:()=>Uint8Array|undefined)=>{const chunks:Uint8Array[]=[];let length=0;for(;;){const chunk=await read();if(chunk===undefined)break;chunks.push(chunk);length+=chunk.length;}const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}sqlite.capi.sqlite3_js_posix_create_file(file,bytes);files.add(file);return length;},
 } as unknown as SAHPoolUtil;
}
const snapshot=await createLocalPortableSnapshot(sqlite,memoryFilePool(),source,0);
test('trusted producer excludes device rows and pages without mutating its source',()=>{
 expect(snapshot.schemaVersion).toBe(19);expect(snapshot.bytes.length).toBeGreaterThan(512);
 expect(new TextDecoder().decode(snapshot.bytes)).not.toContain(canary);
 expect(source.count('providers')).toBe(1);expect(source.count('operations')).toBe(1);
 expect(source.get('meta','identity')).toBe(JSON.stringify(encodeBackupValue(identity)));
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
 try{expect(imported.stats.decodedRecords).toBe(1);expect(imported.identity.id).toBe(identity.id);expect(imported.identity.deviceId).not.toBe(identity.deviceId);expect(imported.library.count('providers')).toBe(0);}finally{imported.library.close();}
});
test('fabricated semantic-memory cache cannot become a query result',async()=>{
 const file='/focused-projection-source-'+crypto.randomUUID();sqlite.capi.sqlite3_js_posix_create_file(file,snapshot.bytes);
 const bad=new sqlite.oo1.DB(file,'c');bad.exec("INSERT INTO sensa_learning_semantic_memory VALUES('fabricated',NULL,'{}',1,'{}')");
 const bytes=sqlite.capi.sqlite3_js_db_export(bad.pointer);bad.close();
 await expect(importLocalPortableSnapshot(sqlite,memoryFilePool(),'/focused-projection-import-'+crypto.randomUUID(),{...snapshot,bytes,sha256:sha256(bytes)})).rejects.toThrow('sqlite_snapshot_projection_values');
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
  run=await actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'reveal'},at);
  run=await actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'rate',rating:'good'},at);
  await finishLearning(crypto.randomUUID(),run.id);
  const modules=createJourneyModules({repository:new LibraryJourneyRepository(),clock:createSeededClock(at),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
  const accepted=await modules.semanticIntake.submit(manualMeaningPayload({...newManualMeaningDraft(),context:'May asked to borrow an umbrella.',occurrence:'borrow',canonicalForm:'borrow',languageTag:'en',meaning:'暂时借用物品，之后归还。',usage:'借用朋友的雨伞，之后归还。'}));
  expect(accepted.route).toBe('fast_track');
  const expected=await readLibrary(tx=>tx.get('learningTargets',targetId!)),revision=await readLibrary(readLocalLibraryRevision);
  const exported=await createLocalPortableSnapshot(sqlite,memoryFilePool(),learning,revision);
  const imported=await importLocalPortableSnapshot(sqlite,memoryFilePool(),'/focused-learning-'+crypto.randomUUID(),exported);
  try{
   expect(imported.stats.decodedBodies).toBeGreaterThan(0);
   expect(imported.library.count('learningTargets')).toBe(1);expect(imported.library.count('learningRuns')).toBe(1);expect(imported.library.count('learningEvents')).toBe(2);
   expect(imported.library.count('packageCache')).toBe(0);expect(imported.library.count('operations')).toBe(0);
   expect(imported.library.get('learningTargets',targetId!)).toBe(JSON.stringify(encodeBackupValue(expected)));
   expect(imported.library.learningSemanticMemory(targetId!).targets[0]?.targetId).toBe(targetId);
   expect(imported.library.count('semanticMeanings')).toBe(1);expect(imported.library.count('semanticReceipts')).toBeGreaterThan(0);
   expect(imported.library.lookupMeanings('borrow')).toEqual(learning.lookupMeanings('borrow'));
   expect(imported.library.worldBrowse({query:'',filter:'all',offset:0,limit:20})).toEqual(learning.worldBrowse({query:'',filter:'all',offset:0,limit:20}));
  }finally{imported.library.close();}
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
