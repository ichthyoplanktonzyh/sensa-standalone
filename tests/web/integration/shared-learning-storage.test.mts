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

test('retiring the full-inventory admission cache preserves exact source rows and shared-body ownership',async()=>{
 const sqlite=await sqlite3InitModule(),storage=new sqlite.oo1.DB(':memory:','c');let copy=new SqliteRecordDatabase(sqlite,storage,'memory');
 try{
  copy.initialize();copy.commit({clears:[],deletes:[],puts:[{table:'learningTargets',...database.entries('learningTargets')[0]!}]});
  const facts=()=>['sensa_records','sensa_shared_record_content','sensa_shared_record_content_owners'].map(table=>storage.exec({sql:`SELECT * FROM ${table} ORDER BY 1,2`,rowMode:'object',returnValue:'resultRows'}));
  const before=facts();storage.exec('CREATE TABLE sensa_study_scope_target_snapshots(retired_derived_value TEXT)');
  copy=new SqliteRecordDatabase(sqlite,storage,'memory');copy.initialize();
  expect(storage.exec({sql:"SELECT name FROM sqlite_schema WHERE name='sensa_study_scope_target_snapshots'",rowMode:0,returnValue:'resultRows'})).toEqual([]);
  expect(facts()).toEqual(before);expect(copy.get('learningTargets',targetId)).toBe(database.get('learningTargets',targetId));
 }finally{copy.close();}
});

test('Scope member pointers read only their owned immutable body, fail drift, and rebuild without rewriting source facts',async()=>{
 const original=database.entries('studyScopes')[0]!;
 const scope=decodeBackupValue(JSON.parse(original.encodedValue)) as import('../../../apps/web/src/data/library/studyScopes').LocalStudyScope;
 const member=scope.members.find(member=>member.targetId===targetId)!;
 const digest=sha256(JSON.stringify(encodeBackupValue(member)));
 expect(database.studyScopeMember(scope.id,targetId)).toEqual(member);
 const columns=raw.exec({sql:'PRAGMA table_info(sensa_study_scope_members)',rowMode:'object',returnValue:'resultRows'}) as {name:string}[];
 expect(columns.map(column=>column.name)).toEqual(['scope_key','target_key','body_digest']);
 const stored=String((raw.exec({sql:'SELECT value_json FROM sensa_shared_record_content WHERE digest=?',bind:[digest],rowMode:0,returnValue:'resultRows'}) as string[])[0]);
 raw.exec({sql:'UPDATE sensa_shared_record_content SET value_json=? WHERE digest=?',bind:['["string","wrong Scope member"]',digest]});
 try{expect(()=>database.studyScopeMember(scope.id,targetId)).toThrow('localFlow.progressReadFailed');}
 finally{raw.exec({sql:'UPDATE sensa_shared_record_content SET value_json=? WHERE digest=?',bind:[stored,digest]});}
 raw.exec({sql:"DELETE FROM sensa_shared_record_content_owners WHERE owner_kind='record' AND table_name='studyScopes' AND record_key=? AND digest=?",bind:[scope.id,digest]});
 try{expect(()=>database.studyScopeMember(scope.id,targetId)).toThrow('localFlow.progressReadFailed');}
 finally{raw.exec({sql:'INSERT INTO sensa_shared_record_content_owners VALUES(?,?,?,?)',bind:['record','studyScopes',scope.id,digest]});}
 expect(database.studyScopeMember(scope.id,targetId)).toEqual(member);expect(database.get('studyScopes',scope.id)).toBe(original.encodedValue);
 raw.exec({sql:'DELETE FROM sensa_study_scope_members WHERE scope_key=? AND target_key=?',bind:[scope.id,targetId]});
 expect(database.studyScopeMember(scope.id,targetId)).toEqual(member);
 expect(database.studyScopeMember(scope.id,id())).toBeNull();
 expect(()=>database.studyScopeMember(id(),targetId)).toThrow('localFlow.progressReadFailed');
 expect(database.get('studyScopes',scope.id)).toBe(original.encodedValue);

 // A failed repair must not leave an apparently valid member pointer with
 // only part of its frozen qualification rows, even inside a transaction.
 raw.exec({sql:'DELETE FROM sensa_study_scope_members WHERE scope_key=? AND target_key=?',bind:[scope.id,targetId]});
 const repairState=()=>['sensa_records','sensa_shared_record_content','sensa_shared_record_content_owners','sensa_study_scope_members','sensa_study_scope_sources'].map(table=>raw.exec({sql:`SELECT * FROM ${table} ORDER BY 1,2`,rowMode:'object',returnValue:'resultRows'}));
 const beforeRepair=repairState(),exec=raw.exec.bind(raw);let injected=false;
 raw.exec=((input:any)=>{
  const sql=typeof input==='string'?input:input.sql;
  if(!injected&&sql.startsWith('INSERT INTO sensa_study_scope_sources')){injected=true;throw Error('fixture Scope repair interrupted');}
  return exec(input);
 }) as typeof raw.exec;
 raw.exec('BEGIN');
 try{
  expect(()=>database.studyScopeMember(scope.id,targetId)).toThrow('fixture Scope repair interrupted');
  expect(injected).toBe(true);expect(repairState()).toEqual(beforeRepair);
  expect(database.studyScopeMember(scope.id,targetId)).toEqual(member);
  expect(database.get('studyScopes',scope.id)).toBe(original.encodedValue);
 }finally{raw.exec=exec;raw.exec('ROLLBACK');}
 expect(repairState()).toEqual(beforeRepair);
 expect(database.studyScopeMember(scope.id,targetId)).toEqual(member);

 // Copy an exact command-generated Scope into an isolated storage kernel.
 // This exercises rebuildable indexes, not product backup/restore validity.
 const sqlite=await sqlite3InitModule(),storage=new sqlite.oo1.DB(':memory:','c');
 let copy=new SqliteRecordDatabase(sqlite,storage,'memory');
 try{
  copy.initialize();copy.commit({clears:[],deletes:[],puts:[{table:'studyScopes',key:scope.id,encodedValue:original.encodedValue}]});
  const factsBefore=storage.exec({sql:'SELECT * FROM sensa_records ORDER BY table_name,record_key',rowMode:'object',returnValue:'resultRows'});
  const bodiesBefore=storage.exec({sql:'SELECT * FROM sensa_shared_record_content ORDER BY digest',rowMode:'object',returnValue:'resultRows'});
  const ownersBefore=storage.exec({sql:'SELECT * FROM sensa_shared_record_content_owners ORDER BY owner_kind,table_name,record_key,digest',rowMode:'object',returnValue:'resultRows'});
  storage.exec('DROP TABLE sensa_study_scope_members');
  storage.exec("UPDATE sensa_runtime_learning_meta SET value='invalid-derived-format' WHERE key='format'");
  copy=new SqliteRecordDatabase(sqlite,storage,'memory');copy.initialize();
  expect(copy.studyScopeMember(scope.id,targetId)).toEqual(member);expect(copy.get('studyScopes',scope.id)).toBe(original.encodedValue);
  expect(storage.exec({sql:'SELECT * FROM sensa_records ORDER BY table_name,record_key',rowMode:'object',returnValue:'resultRows'})).toEqual(factsBefore);
  expect(storage.exec({sql:'SELECT * FROM sensa_shared_record_content ORDER BY digest',rowMode:'object',returnValue:'resultRows'})).toEqual(bodiesBefore);
  expect(storage.exec({sql:'SELECT * FROM sensa_shared_record_content_owners ORDER BY owner_kind,table_name,record_key,digest',rowMode:'object',returnValue:'resultRows'})).toEqual(ownersBefore);
 }finally{copy.close();}
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

test('v14 upgrades all fact, tombstone and sync-base constraints atomically without changing encoded bytes or body ownership',async()=>{
 const sqlite=await sqlite3InitModule();
 for(const version of [14,15])for(const interrupt of [false,true]){
  const storage=new sqlite.oo1.DB(':memory:','c'),copy=new SqliteRecordDatabase(sqlite,storage,'memory');
  try{
   storage.exec((version===14?sqliteLibrarySchema.replaceAll("'studyScopes',",'').replaceAll("'learningSessions',",''):sqliteLibrarySchema).replaceAll("'supplementalMembershipStates',",''));
   storage.exec(`PRAGMA user_version=${version}`);
   const records=raw.exec({sql:"SELECT rowid,* FROM sensa_records WHERE table_name NOT IN ('studyScopes','learningSessions') ORDER BY rowid",rowMode:'object',returnValue:'resultRows'}) as {rowid:number;table_name:string;record_key:string;value_json:string;content_revision:number}[];
   for(const row of records)storage.exec({sql:'INSERT INTO sensa_records(rowid,table_name,record_key,value_json,content_revision) VALUES(?,?,?,?,?)',bind:[row.rowid,row.table_name,row.record_key,row.value_json,row.content_revision]});
   const bodies=raw.exec({sql:'SELECT * FROM sensa_shared_record_content',rowMode:'object',returnValue:'resultRows'}) as {digest:string;value_json:string}[];
   for(const row of bodies)storage.exec({sql:'INSERT INTO sensa_shared_record_content VALUES(?,?)',bind:[row.digest,row.value_json]});
   const owners=raw.exec({sql:"SELECT * FROM sensa_shared_record_content_owners WHERE table_name NOT IN ('studyScopes','learningSessions')",rowMode:'object',returnValue:'resultRows'}) as {owner_kind:string;table_name:string;record_key:string;digest:string}[];
   for(const row of owners)storage.exec({sql:'INSERT INTO sensa_shared_record_content_owners VALUES(?,?,?,?)',bind:[row.owner_kind,row.table_name,row.record_key,row.digest]});
   storage.exec("INSERT INTO sensa_record_tombstones VALUES('drafts','old-deleted',7)");
   storage.exec("INSERT INTO sensa_sync_base VALUES('drafts','old-base','{\"text\":\"exact\"}','[]')");
   const snapshot=()=>['sensa_records','sensa_record_tombstones','sensa_sync_base','sensa_shared_record_content','sensa_shared_record_content_owners'].map(table=>storage.exec({sql:`SELECT ${table==='sensa_records'?'rowid,*':'*'} FROM ${table} ORDER BY 1,2`,rowMode:'object',returnValue:'resultRows'}));
   const before=snapshot(),indexes=storage.exec({sql:"SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name IN ('sensa_records','sensa_record_tombstones','sensa_sync_base') ORDER BY name",rowMode:'object',returnValue:'resultRows'});
   if(interrupt){
    const exec=storage.exec.bind(storage);storage.exec=((input:any)=>{if((typeof input==='string'?input:input.sql).startsWith('CREATE TABLE sensa_sync_base_v15_upgrade'))throw Error('fixture upgrade interrupted');return exec(input);}) as typeof storage.exec;
    try{expect(()=>copy.initialize()).toThrow('fixture upgrade interrupted');}finally{storage.exec=exec;}
    expect(snapshot()).toEqual(before);expect(storage.exec({sql:'PRAGMA user_version',rowMode:0,returnValue:'resultRows'})).toEqual([version]);
   }
   expect(copy.initialize().schemaVersion).toBe(16);expect(snapshot()).toEqual(before);
   expect(storage.exec({sql:"SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name IN ('sensa_records','sensa_record_tombstones','sensa_sync_base') ORDER BY name",rowMode:'object',returnValue:'resultRows'})).toEqual(indexes);
   const scope=database.entries('studyScopes')[0]!,session=database.entries('learningSessions')[0]!;
   copy.commit({clears:[],deletes:[],puts:[{table:'studyScopes',...scope},{table:'learningSessions',...session}],syncBaseReplacement:[{table:'studyScopes',key:scope.key,valueJson:scope.encodedValue,blockRefs:[]},{table:'learningSessions',key:session.key,valueJson:session.encodedValue,blockRefs:[]}]});
   expect(copy.syncBaseEntries().map(row=>row.table).sort()).toEqual(['learningSessions','studyScopes']);
   copy.commit({clears:[],puts:[],deletes:[{table:'learningSessions',key:session.key}],contentRevision:10000});
   expect(storage.exec({sql:"SELECT COUNT(*) FROM sensa_record_tombstones WHERE table_name='learningSessions' AND record_key=?",bind:[session.key],rowMode:0,returnValue:'resultRows'})).toEqual([1]);
  }finally{copy.close();}
 }
});

test('schema 13 upgrade creates only representation storage and does not rewrite existing source rows',async()=>{
 const sqlite=await sqlite3InitModule(),legacyRaw=new sqlite.oo1.DB(':memory:','c'),legacy=new SqliteRecordDatabase(sqlite,legacyRaw,'memory');
 try{
  legacyRaw.exec(sqliteLibrarySchema);legacyRaw.exec('DROP TABLE sensa_shared_record_content_owners; DROP TABLE sensa_shared_record_content; PRAGMA user_version=13');
  const sources=[...database.entries('learningTargets').map(row=>({table:'learningTargets',...row})),...database.entries('learningRuns').map(row=>({table:'learningRuns',...row}))];
  for(const row of sources)legacyRaw.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json) VALUES(?,?,?)',bind:[row.table,row.key,row.encodedValue]});
  const before=legacyRaw.exec({sql:'SELECT * FROM sensa_records ORDER BY table_name,record_key',rowMode:'object',returnValue:'resultRows'});
  expect(legacy.initialize().schemaVersion).toBe(16);
  expect(legacyRaw.exec({sql:'SELECT * FROM sensa_records ORDER BY table_name,record_key',rowMode:'object',returnValue:'resultRows'})).toEqual(before);
  expect(legacyRaw.exec({sql:'SELECT COUNT(*) FROM sensa_shared_record_content',rowMode:0,returnValue:'resultRows'})).toEqual([0]);
  expect(legacy.learningHistoryProjection()).toEqual(database.learningHistoryProjection());
 }finally{legacy.close();}
});
