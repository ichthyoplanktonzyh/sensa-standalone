import {test,expect,afterAll,vi} from 'vitest';
import type {Database} from '@sqlite.org/sqlite-wasm';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {sha256} from '@sensa/learning-kernel';
import {gzipSync,gunzipSync,strToU8,strFromU8} from 'fflate';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {openLibrary,readLibrary,libraryTables,restoreLibraryTransaction} from '../../../apps/web/src/data/library/store';
import {encodeBackupValue,decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {externalizeSharedRecordContent,expandSharedRecordContent,compactArchiveWire,expandArchiveWire} from '../../../apps/web/src/data/library/sharedRecordContent';
import {encodeBackupArchive,decodeBackupArchive} from '../../../apps/web/src/data/library/backupArchive';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {sqliteLibrarySchema} from '../../../apps/web/src/data/library/sqliteProtocol';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://shared-storage.fixture.invalid/')});
const database=await useNodeLearningCapacityStorage(),raw=Reflect.get(database,'database') as Database;
afterAll(()=>database.close());await openLibrary();
const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute),id=()=>crypto.randomUUID(),packageId=id();
const snapshot=()=>readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)])))) as Promise<BackupRows>;
const count=(sql:string,bind:(string|number)[]=[])=>Number((raw.exec({sql,bind,rowMode:0,returnValue:'resultRows'}) as unknown[])[0]);
let targetId:string,contentDigest:string,archive:Awaited<ReturnType<typeof encodeBackupArchive>>;

test('actual Initial and due Review facts share one exact content body across Target and Runs, retain their own snapshots and roundtrip cachelessly',async()=>{
 // Synthetic low-media package, not audio quality or real provider evidence.
 const base=Date.now();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(base);
 try{
  const fixture=portablePackageFixture({packageId,expression:'retain',audioByteLength:8192});
  const pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
  targetId=(await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext:context}))[0]!;
  await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:20});
  const complete=async()=>{
   await learningSystem.execute({kind:'start',operationId:id(),targetId,languageContext:context,dailyLimit:20});
   for(const action of [{kind:'reveal'},{kind:'rate',rating:'good'}] as const){const runtime=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;await learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action});}
   const runtime=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;await learningSystem.execute({kind:'finish',operationId:id(),runId:runtime.runId});
  };
  await complete();const initial=await snapshot();vi.setSystemTime(new Date(initial.learningTargets[0]!.value.memory.dueAt));await complete();
  const rows=await snapshot(),material=rows.learningTargets[0]!.value.curriculumMemberships[0].material;
  expect(rows.learningRuns).toHaveLength(2);expect(rows.learningEvents).toHaveLength(4);expect(rows.learningTargets[0]!.value.memoryRevision).toBe(2);
  contentDigest=sha256(JSON.stringify(encodeBackupValue(material.content)));
  expect(count('SELECT COUNT(*) FROM sensa_shared_record_content WHERE digest=?',[contentDigest])).toBe(1);
  expect(count("SELECT COUNT(*) FROM sensa_shared_record_content_owners WHERE owner_kind='record' AND table_name IN ('learningTargets','learningRuns') AND digest=?",[contentDigest])).toBe(3);
  expect(database.changesSince(0,['learningRuns']).map(row=>decodeBackupValue(JSON.parse(row.encodedValue!))).sort((a,b)=>a.id.localeCompare(b.id))).toEqual(rows.learningRuns.map(row=>row.value).sort((a,b)=>a.id.localeCompare(b.id)));
  const logical=rows.learningTargets.concat(rows.learningRuns,rows.learningEvents).reduce((sum,row)=>sum+strToU8(JSON.stringify(encodeBackupValue(row.value))).length,0);
  expect(database.estimateRecordBytes(['learningTargets','learningRuns','learningEvents'])).toBeLessThan(logical);
  rows.packageCache=[];archive=await encodeBackupArchive(rows,null);const decoded=await decodeBackupArchive(archive.bytes);validateBackupRows(decoded.rows);
  expect(decoded.rows).toEqual(rows);expect(decoded.header.sharedBodies).toBeGreaterThan(0);
  const restoredMaterial=decoded.rows.learningTargets[0]!.value.curriculumMemberships[0].material;
  expect(restoredMaterial.content).toBe(restoredMaterial.snapshot.contentPayload);
  expect(decoded.rows.learningRuns[0]!.value.participants[targetId].materializations[decoded.rows.learningRuns[0]!.value.participants[targetId].material].content).toBe(restoredMaterial.content);
 }finally{vi.useRealTimers();}
});

test('an actual compatible publication rollback preserves every fact, derived projection, receipt and shared body ownership',async()=>{
 const fixture=portablePackageFixture({packageId,version:2,expression:'retain',scene:'A new compatible scene for keeping the same object.',audioByteLength:8192});
 const pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
 const before=await snapshot(),history=database.learningHistoryProjection(),owners=raw.exec({sql:'SELECT * FROM sensa_shared_record_content_owners ORDER BY owner_kind,table_name,record_key,digest',rowMode:'object',returnValue:'resultRows'}),bodies=raw.exec({sql:'SELECT * FROM sensa_shared_record_content ORDER BY digest',rowMode:'object',returnValue:'resultRows'}),exec=raw.exec.bind(raw);let injected=false;
 raw.exec=((input:any)=>{const sql=typeof input==='string'?input:input.sql;if(!injected&&sql.startsWith('INSERT INTO sensa_shared_record_content_owners')&&input.bind?.[1]==='learningTargets'){injected=true;throw Error('fixture content-owner write failed');}return exec(input);}) as typeof raw.exec;
 try{await expect(learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext:context})).rejects.toThrow();}finally{raw.exec=exec;}
 expect(injected).toBe(true);expect(await snapshot()).toEqual(before);expect(database.learningHistoryProjection()).toEqual(history);
 expect(raw.exec({sql:'SELECT * FROM sensa_shared_record_content_owners ORDER BY owner_kind,table_name,record_key,digest',rowMode:'object',returnValue:'resultRows'})).toEqual(owners);
 expect(raw.exec({sql:'SELECT * FROM sensa_shared_record_content ORDER BY digest',rowMode:'object',returnValue:'resultRows'})).toEqual(bodies);
});

test('sync baseline ownership survives source clearing and releases bodies only after the last actual owner is gone',async()=>{
 const sqlite=await sqlite3InitModule(),copy=new SqliteRecordDatabase(sqlite,new sqlite.oo1.DB(':memory:','c'),'memory');
 try{
  copy.initialize();const run=database.entries('learningRuns')[0]!;
  copy.commit({clears:[],deletes:[],puts:[{table:'learningTargets',...database.entries('learningTargets')[0]!},{table:'learningRuns',...run}],syncBaseReplacement:[{table:'learningRuns',key:run.key,valueJson:run.encodedValue,blockRefs:['0'.repeat(64)]}]});
  copy.commit({clears:['learningTargets','learningRuns'],deletes:[],puts:[]});
  expect(copy.syncBaseEntries()[0]!.valueJson).toBe(run.encodedValue);
  const storage=Reflect.get(copy,'database') as Database;
  expect((storage.exec({sql:'SELECT COUNT(*) FROM sensa_shared_record_content',rowMode:0,returnValue:'resultRows'}) as number[])[0]).toBeGreaterThan(0);
  copy.commit({clears:[],deletes:[],puts:[],syncBaseReplacement:[]});
  expect(storage.exec({sql:'SELECT COUNT(*) FROM sensa_shared_record_content',rowMode:0,returnValue:'resultRows'})).toEqual([0]);
 }finally{copy.close();}
});

test('corrupt stored content fails exact reads without cached substitution, and invalid archive dictionaries/frames fail before any writes',async()=>{
 const body=String((raw.exec({sql:'SELECT value_json FROM sensa_shared_record_content WHERE digest=?',bind:[contentDigest],rowMode:0,returnValue:'resultRows'}) as string[])[0]);
 raw.exec({sql:'UPDATE sensa_shared_record_content SET value_json=? WHERE digest=?',bind:[JSON.stringify(encodeBackupValue({bad:'different content'})),contentDigest]});
 try{expect(()=>database.get('learningTargets',targetId)).toThrow('sqlite_shared_content_invalid');}finally{raw.exec({sql:'UPDATE sensa_shared_record_content SET value_json=? WHERE digest=?',bind:[body,contentDigest]});}
 expect(database.get('learningTargets',targetId)).not.toBeNull();
 const frames=strFromU8(gunzipSync(archive.bytes)).trim().split('\n').map(line=>JSON.parse(line)),before=await snapshot();
 for(const mode of ['missing','corrupt','orphan','duplicate','truncated','row_limit'] as const){
  const changed=structuredClone(frames),firstBody=changed.findIndex(frame=>frame.kind==='body');
  if(mode==='missing'){changed.splice(firstBody,1);changed[0].sharedBodies--;}
  if(mode==='corrupt')changed[firstBody].value={bad:'different body'};
  if(mode==='orphan'){const value=encodeBackupValue({unused:'body'});changed.splice(firstBody,0,{kind:'body',digest:sha256(JSON.stringify(value)),value:compactArchiveWire(value)});changed[0].sharedBodies++;}
  if(mode==='duplicate'){const row=changed.find(frame=>frame.kind==='row');changed.splice(changed.length-1,0,row);changed[0].counts[row.table]++;}
  if(mode==='truncated')changed.pop();
  if(mode==='row_limit')changed[0].counts.learningRuns=200001;
  await expect(decodeBackupArchive(gzipSync(strToU8(changed.map(frame=>JSON.stringify(frame)).join('\n')+'\n'))),mode).rejects.toThrow('libraryBackup.errors.invalidFile');
 }
 expect(await snapshot()).toEqual(before);
 const user={value:undefined,when:new Date('2026-10-05T08:00:00Z'),$sensa:'date',nested:{$sensa:'shared',value:'0'.repeat(64)},numericKeys:{'2':'two','10':'ten'}};
 expect(decodeBackupValue(expandArchiveWire(compactArchiveWire(encodeBackupValue(user))))).toEqual(user);
 const shared=externalizeSharedRecordContent(encodeBackupValue({content:{text:'same'.repeat(512)}}));
 expect(()=>expandSharedRecordContent(shared.value,()=>undefined)).toThrow();
});

test('encrypted backup preview and actual empty-destination restore retain the complete genuine cacheless learning history',async()=>{
 const {exportLibraryBackup,inspectLibraryBackup,restoreLibraryBackup}=await import('../../../apps/web/src/data/library/backup');
 const before=await snapshot(),backup=await exportLibraryBackup('shared-storage-test-password');
 expect((await inspectLibraryBackup(backup.file,'shared-storage-test-password')).runs).toBe(2);
 await restoreLibraryTransaction(async tx=>{for(const table of libraryTables)tx.clear(table);});await openLibrary();
 const execute=contentSupplySystem.execute.bind(contentSupplySystem);
 const refresh=vi.spyOn(contentSupplySystem,'execute').mockImplementation((async(command:any)=>command.kind==='rehydrate'?{ready:[],blocked:['fixture'],failed:[]}:execute(command)) as typeof contentSupplySystem.execute);
 try{
  const restored=await restoreLibraryBackup(backup.file,'shared-storage-test-password');expect(restored.summary.runs).toBe(2);expect(restored.resourceRefresh).toBe('deferred');
  const after=await snapshot();expect(after.learningTargets).toEqual(before.learningTargets);expect(after.learningRuns).toEqual(before.learningRuns);expect(after.learningEvents).toEqual(before.learningEvents);expect(after.packageCache).toEqual([]);validateBackupRows(after);
 }finally{refresh.mockRestore();}
});

test('schema 13 upgrade creates only representation storage and does not rewrite existing source rows',async()=>{
 const sqlite=await sqlite3InitModule(),legacyRaw=new sqlite.oo1.DB(':memory:','c'),legacy=new SqliteRecordDatabase(sqlite,legacyRaw,'memory');
 try{
  legacyRaw.exec(sqliteLibrarySchema);legacyRaw.exec('DROP TABLE sensa_shared_record_content_owners; DROP TABLE sensa_shared_record_content; PRAGMA user_version=13');
  const sources=[...database.entries('learningTargets').map(row=>({table:'learningTargets',...row})),...database.entries('learningRuns').map(row=>({table:'learningRuns',...row}))];
  for(const row of sources)legacyRaw.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json) VALUES(?,?,?)',bind:[row.table,row.key,row.encodedValue]});
  const before=legacyRaw.exec({sql:'SELECT * FROM sensa_records ORDER BY table_name,record_key',rowMode:'object',returnValue:'resultRows'});
  expect(legacy.initialize().schemaVersion).toBe(14);
  expect(legacyRaw.exec({sql:'SELECT * FROM sensa_records ORDER BY table_name,record_key',rowMode:'object',returnValue:'resultRows'})).toEqual(before);
  expect(legacyRaw.exec({sql:'SELECT COUNT(*) FROM sensa_shared_record_content',rowMode:0,returnValue:'resultRows'})).toEqual([0]);
  expect(legacy.learningHistoryProjection()).toEqual(database.learningHistoryProjection());
 }finally{legacy.close();}
});
