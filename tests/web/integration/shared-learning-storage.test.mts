import {observeReplicaWork} from '../../../apps/web/src/data/library/replicaWork';
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
import {externalizeSharedRecordContent,expandSharedRecordContent,compactArchiveWire,expandArchiveWire,packStoredRecord} from '../../../apps/web/src/data/library/sharedRecordContent';
import {encodeBackupArchive,decodeBackupArchive} from '../../../apps/web/src/data/library/backupArchive';
import {candidateExpected,candidateBlocksFor} from '../support/replicaCandidateFixture.mts';
import {isReplicatedLibraryEntry,normalizeLibraryReplicaEntry,restoreLibraryReplicaValue,type LibraryReplicaEntry} from '../../../apps/web/src/data/library/replication/libraryReplica';
import type {ReplicaCandidateRecord} from '../../../apps/web/src/data/library/replicaCandidateProtocol';
import type {LibraryIdentity} from '../../../apps/web/src/data/library/store';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {sqliteLibrarySchema,sqliteLibrarySchemaVersion,sqliteSyncBaseSchema} from '../../../apps/web/src/data/library/sqliteProtocol';
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

async function stageLearningReplica(options:{noncanonical?:boolean;injectSharedTag?:boolean;savedMemoryDrift?:boolean}={}){
 const sqlite=await sqlite3InitModule(),storage=new sqlite.oo1.DB(':memory:','c'),receiver=new SqliteRecordDatabase(sqlite,storage,'memory');receiver.initialize();
 const privateReplicaRows=await snapshot();privateReplicaRows.packageCache=[];
 if(options.savedMemoryDrift)privateReplicaRows.learningTargets[0]!.value.memory.fsrsStability+=0.125;
 const sourceIdentity=privateReplicaRows.meta.find(row=>row.key==='identity')!.value as LibraryIdentity;
 const localIdentity={...sourceIdentity,id:id(),learnerId:id(),deviceId:id()},owner={subject:id(),accountId:id()};
 receiver.commit({clears:[],deletes:[],puts:[{table:'meta',key:'identity',encodedValue:JSON.stringify(encodeBackupValue(localIdentity))},{table:'meta',key:'service-owner',encodedValue:JSON.stringify(encodeBackupValue(owner))}]});
 const records:ReplicaCandidateRecord[]=libraryTables.flatMap(table=>privateReplicaRows[table].filter(row=>isReplicatedLibraryEntry(table,row.key)).map(row=>({table,key:row.key,valueJson:JSON.stringify(encodeBackupValue(normalizeLibraryReplicaEntry({table:table as LibraryReplicaEntry['table'],key:row.key,value:row.value},sourceIdentity).value)),blockRefs:[]})));
 const target=records.find(row=>row.table==='learningTargets')!;
 if(options.noncanonical)target.valueJson=JSON.stringify(JSON.parse(target.valueJson),null,2);
 if(options.injectSharedTag){
  const wire=JSON.parse(target.valueJson);let replaced=false;
  const visit=(node:any)=>{if(!Array.isArray(node)||replaced)return;if(node[0]==='object')for(const pair of node[1]){if(pair[0]==='content'){pair[1]=['sensa-shared-content-v1',contentDigest];replaced=true;break;}visit(pair[1]);}else if(node[0]==='array')node[1].forEach(visit);};visit(wire);expect(replaced).toBe(true);target.valueJson=JSON.stringify(wire);
 }
 const expected=candidateExpected(records,sourceIdentity),begun=await receiver.replicaCandidate({kind:'begin',fence:{owner,identity:localIdentity,incarnation:'initial',localRevision:0},expected});
 if(begun.kind!=='begun')throw Error('Expected generation');
 for(let at=0;at<records.length;at+=128){const page=records.slice(at,at+128);await receiver.replicaCandidate({kind:'append',id:begun.id,records:page,blocks:candidateBlocksFor(page)});}
 const mutation={clears:[],deletes:[],contentRevision:1,replicaCandidateRestore:{id:begun.id,tables:[...new Set(records.map(row=>row.table))]},puts:[
  {table:'meta' as const,key:'cloud-sync',encodedValue:JSON.stringify(encodeBackupValue({restoreOperationId:begun.id,owner,incarnation:'initial',revision:expected.head.revision,syncedLocalRevision:1,status:'synced'}))},
  {table:'meta' as const,key:'local-content-revision',encodedValue:JSON.stringify(encodeBackupValue(1))},
 ]};
 const validate=()=>receiver.replicaCandidate({kind:'validate',id:begun.id});
 const assertFacts=(copy=receiver)=>{for(const row of records)expect(decodeBackupValue(JSON.parse(copy.get(row.table,row.key)!))).toEqual(restoreLibraryReplicaValue({...row,table:row.table as LibraryReplicaEntry['table'],value:undefined},decodeBackupValue(JSON.parse(row.valueJson)),localIdentity));expect(decodeBackupValue(JSON.parse(copy.get('operations','00000000-0000-4000-8000-000000000001')!)).result).toEqual({...sourceIdentity,deviceId:localIdentity.deviceId});};
 const stored=()=>({tables:(storage.exec({sql:"SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",rowMode:0,returnValue:'resultRows'}) as string[]).map(table=>({table,rows:(storage.exec({sql:`SELECT * FROM ${table}`,rowMode:'object',returnValue:'resultRows'}) as object[]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}))});
 return {sqlite,storage,receiver,records,mutation,validate,assertFacts,stored,generation:begun.id};
}

test('fresh activation reuses exact shared baseline bytes once, with genuine history and cold projection rebuild',async()=>{
 const fixture=await stageLearningReplica({noncanonical:true});
 try{
  await fixture.validate();const encode=Reflect.get(fixture.receiver,'storedEncoded').bind(fixture.receiver),calls:{kind:string;table:string;key:string}[]=[];
  const exec=fixture.storage.exec.bind(fixture.storage);let repeatedDetach=0,fullTargetReads=0,runCandidateReads=0;
  const get=fixture.receiver.get.bind(fixture.receiver);Reflect.set(fixture.receiver,'get',(table:string,key:string)=>{if(table==='learningTargets')fullTargetReads++;return get(table as any,key);});
  const handler=Reflect.get(fixture.receiver,'replicaCandidateStore'),read=Reflect.get(handler,'rows').bind(handler);
  Reflect.set(handler,'rows',(sql:string,bind:any[]=[])=>{if(sql.startsWith('SELECT record_key,value_json,representation FROM sensa_replica_candidate_records_v1')&&bind[1]==='learningRuns'&&typeof bind[2]==='string')runCandidateReads++;return read(sql,bind);});
  fixture.storage.exec=((input:any)=>{const sql=typeof input==='string'?input:input.sql;if(sql.includes('sensa_shared_record_content_owners')&&sql.includes('WHERE owner_kind=? AND table_name=? AND record_key=?')&&input.bind?.[0]==='sync')repeatedDetach++;return exec(input);}) as typeof fixture.storage.exec;
  Reflect.set(fixture.receiver,'storedEncoded',(kind:string,table:string,key:string,...args:any[])=>{calls.push({kind,table,key});return encode(kind,table,key,...args);});
  fixture.receiver.commit(fixture.mutation);fixture.storage.exec=exec;Reflect.set(fixture.receiver,'get',get);
  expect(fullTargetReads).toBe(0);expect(runCandidateReads).toBe(fixture.records.filter(row=>row.table==='learningRuns').length*2);
  fixture.assertFacts();expect(fixture.receiver.learningHistoryProjection()).toEqual(database.learningHistoryProjection());expect(repeatedDetach).toBe(0);expect(Reflect.get(fixture.receiver,'activationMemo')).toBeUndefined();expect(Reflect.get(fixture.receiver,'activationTargetLanguages')).toBeUndefined();
  for(const table of ['learningTargets','learningRuns','learningEvents','studyScopes']){
   expect(calls.filter(row=>row.kind==='record'&&row.table===table)).toEqual([]);
   expect(calls.filter(row=>row.kind==='sync'&&row.table===table)).toHaveLength(fixture.records.filter(row=>row.table===table).length);
   for(const row of fixture.records.filter(row=>row.table===table))expect(fixture.storage.exec({sql:'SELECT record.value_json=base.value_json AS exact,base.block_refs_json AS refs FROM sensa_records AS record JOIN sensa_sync_base AS base USING(table_name,record_key) WHERE record.table_name=? AND record.record_key=?',bind:[table,row.key],rowMode:'object',returnValue:'resultRows'})).toEqual([{exact:1,refs:JSON.stringify(row.blockRefs)}]);
  }
  const owners=fixture.storage.exec({sql:'SELECT owner_kind,count(*) AS count FROM sensa_shared_record_content_owners WHERE digest=? GROUP BY owner_kind ORDER BY owner_kind',bind:[contentDigest],rowMode:'object',returnValue:'resultRows'});expect(owners).toEqual([{owner_kind:'record',count:3},{owner_kind:'sync',count:3}]);
  const ownerSet=(kind:string)=>fixture.storage.exec({sql:'SELECT table_name,record_key,digest FROM sensa_shared_record_content_owners WHERE owner_kind=? ORDER BY table_name,record_key,digest',bind:[kind],rowMode:'object',returnValue:'resultRows'});
  expect(ownerSet('record')).toEqual(ownerSet('sync'));expect((ownerSet('record') as unknown[]).length).toBeGreaterThan(0);
  const tables=['sensa_shared_record_content','sensa_records','sensa_sync_base','sensa_shared_record_content_owners'],physical=tables.map(table=>fixture.storage.exec({sql:`SELECT * FROM ${table}`,rowMode:'array',returnValue:'resultRows'}) as (string|number)[][]),raw=new fixture.sqlite.oo1.DB(':memory:','c'),cold=new SqliteRecordDatabase(fixture.sqlite,raw,'memory');
  try{
   raw.exec(sqliteLibrarySchema);for(let at=0;at<tables.length;at++)for(const row of physical[at]!)raw.exec({sql:`INSERT INTO ${tables[at]} VALUES(${row.map(()=>'?').join(',')})`,bind:row});
   cold.initialize();fixture.assertFacts(cold);expect(cold.learningHistoryProjection()).toEqual(database.learningHistoryProjection());expect(cold.diagnostics({verifyIntegrity:true}).integrityCheck?.status).toBe('ok');
   const restored=Object.fromEntries(libraryTables.map(table=>[table,cold.entries(table).map(row=>({key:row.key,value:decodeBackupValue(JSON.parse(row.encodedValue))}))])) as BackupRows;validateBackupRows(restored);
   expect(tables.map(table=>raw.exec({sql:`SELECT * FROM ${table}`,rowMode:'array',returnValue:'resultRows'}))).toEqual(physical);
  }finally{cold.close(false);}
  fixture.receiver.commit({clears:['learningTargets','learningRuns','studyScopes'],deletes:[],puts:[]});expect(fixture.receiver.syncBaseEntries().filter(row=>row.table==='learningRuns')).toHaveLength(2);
  expect(fixture.storage.exec({sql:'SELECT count(*) FROM sensa_shared_record_content WHERE digest=?',bind:[contentDigest],rowMode:0,returnValue:'resultRows'})).toEqual([1]);
  fixture.receiver.commit({clears:[],deletes:[],puts:[],syncBaseReplacement:[]});expect(fixture.storage.exec({sql:'SELECT count(*) FROM sensa_shared_record_content WHERE digest=?',bind:[contentDigest],rowMode:0,returnValue:'resultRows'})).toEqual([0]);
 }finally{fixture.receiver.close(false);}
});

for(const fault of ['baseline-body-insert','baseline-owner-insert','source-owners','source-copy','projection','purge'] as const)test(`fresh baseline reuse ${fault} failure rolls every fact, owner and index back before retry`,async()=>{
 const fixture=await stageLearningReplica();
 try{
  await fixture.validate();const before=fixture.stored(),exec=fixture.storage.exec.bind(fixture.storage);let injected=false;
  fixture.storage.exec=((input:any)=>{const sql=typeof input==='string'?input:input.sql;
   if(!injected&&(fault==='baseline-body-insert'&&sql.startsWith('INSERT INTO sensa_shared_record_content SELECT')||fault==='baseline-owner-insert'&&sql.startsWith('INSERT INTO sensa_shared_record_content_owners')&&sql.includes('SELECT ?,?,?,value')||fault==='source-owners'&&sql.startsWith('INSERT INTO sensa_shared_record_content_owners')&&sql.includes("SELECT 'record'")||fault==='source-copy'&&sql.startsWith('INSERT INTO sensa_records')&&sql.includes('sensa_sync_base AS base')||fault==='projection'&&sql.startsWith('INSERT INTO sensa_learning_targets')||fault==='purge'&&sql==='DELETE FROM sensa_replica_candidates_v1')){injected=true;throw Error('fixture baseline reuse interrupted');}return exec(input);
  }) as typeof fixture.storage.exec;
  try{expect(()=>fixture.receiver.commit(fixture.mutation)).toThrow('fixture baseline reuse interrupted');}finally{fixture.storage.exec=exec;}
  expect(injected).toBe(true);expect(Reflect.get(fixture.receiver,'activationMemo')).toBeUndefined();expect(Reflect.get(fixture.receiver,'activationTargetLanguages')).toBeUndefined();expect(fixture.stored()).toEqual(before);fixture.receiver.commit(fixture.mutation);fixture.assertFacts();expect(Reflect.get(fixture.receiver,'activationMemo')).toBeUndefined();expect(Reflect.get(fixture.receiver,'activationTargetLanguages')).toBeUndefined();
 }finally{fixture.receiver.close(false);}
});

test('batched shared baseline refuses an existing different body at the same digest and preserves all bytes',async()=>{
 const fixture=await stageLearningReplica();
 try{
  const altered=packStoredRecord(JSON.stringify(encodeBackupValue({text:'altered retained body'.repeat(1024)})));
  fixture.storage.exec({sql:'INSERT INTO sensa_shared_record_content VALUES(?,?)',bind:[contentDigest,altered]});
  await fixture.validate();const before=fixture.stored();
  expect(()=>fixture.receiver.commit(fixture.mutation)).toThrow('sqlite_shared_content_invalid');
  expect(fixture.stored()).toEqual(before);expect(Reflect.get(fixture.receiver,'activationMemo')).toBeUndefined();
 }finally{fixture.receiver.close(false);}
});

test('history language-cache pressure uses exact narrow route rows without expanding Target material',async()=>{
 const fixture=await stageLearningReplica();
 try{
  await fixture.validate();const project=Reflect.get(fixture.receiver,'upsertLearningTargetProjection').bind(fixture.receiver),get=fixture.receiver.get.bind(fixture.receiver);let reads=0;
  Reflect.set(fixture.receiver,'upsertLearningTargetProjection',(...args:any[])=>{Reflect.set(fixture.receiver,'activationTargetLanguageBytes',8*1024*1024);return project(...args);});
  Reflect.set(fixture.receiver,'get',(table:string,key:string)=>{if(table==='learningTargets')reads++;return get(table as any,key);});
  fixture.receiver.commit(fixture.mutation);Reflect.set(fixture.receiver,'get',get);expect(reads).toBe(0);fixture.assertFacts();expect(fixture.receiver.learningHistoryProjection()).toEqual(database.learningHistoryProjection());expect(Reflect.get(fixture.receiver,'activationTargetLanguages')).toBeUndefined();
 }finally{fixture.receiver.close(false);}
});

test('external shared tag cannot borrow a retained body through complete candidate validation',async()=>{
 const fixture=await stageLearningReplica({injectSharedTag:true});
 try{
  const body=String((raw.exec({sql:'SELECT value_json FROM sensa_shared_record_content WHERE digest=?',bind:[contentDigest],rowMode:0,returnValue:'resultRows'}) as string[])[0]);
  fixture.storage.exec({sql:'INSERT INTO sensa_shared_record_content VALUES(?,?)',bind:[contentDigest,body]});
  await expect(fixture.validate()).rejects.toThrow('libraryBackup.errors.format');expect(fixture.receiver.count('learningTargets')).toBe(0);expect(fixture.receiver.syncBaseEntries()).toEqual([]);
  expect(fixture.storage.exec({sql:'SELECT value_json FROM sensa_shared_record_content WHERE digest=?',bind:[contentDigest],rowMode:0,returnValue:'resultRows'})).toEqual([body]);
 }finally{fixture.receiver.close(false);}
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
  const before=()=>['sensa_sync_base','sensa_shared_record_content','sensa_shared_record_content_owners'].map(table=>storage.exec({sql:`SELECT * FROM ${table} ORDER BY 1,2`,rowMode:'object',returnValue:'resultRows'}));
  const retained=before(),exec=storage.exec.bind(storage);let injected=false;
  storage.exec=((input:any)=>{const sql=typeof input==='string'?input:input.sql;if(!injected&&sql.startsWith('INSERT INTO sensa_shared_record_content_owners')){injected=true;throw new Error('interrupted baseline body owner');}return exec(input);}) as typeof storage.exec;
  try{expect(()=>copy.commit({clears:[],deletes:[],puts:[],syncBasePatch:{deletes:[],puts:[{table:'learningRuns',key:run.key,valueJson:run.encodedValue,blockRefs:['1'.repeat(64)]}]}})).toThrow('interrupted baseline body owner');}finally{storage.exec=exec;}
  expect(injected).toBe(true);expect(before()).toEqual(retained);
  copy.commit({clears:[],deletes:[],puts:[],syncBasePatch:{deletes:[],puts:[{table:'learningRuns',key:run.key,valueJson:run.encodedValue,blockRefs:['1'.repeat(64)]}]}});
  expect(copy.syncBaseEntries()[0]!.valueJson).toBe(run.encodedValue);
  expect(copy.syncBaseReferences()[0]!.blockRefs).toEqual(['1'.repeat(64)]);
  copy.commit({clears:[],deletes:[],puts:[],syncBasePatch:{deletes:[{table:'learningRuns',key:run.key}],puts:[]}});
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
 await restoreLibraryTransaction(async tx=>{for(const table of libraryTables)tx.clear(table);});
 // A missing previously used identity must not create a placeholder learner.
 // Explicit validated backup restore itself supplies the original identity.
 await expect(openLibrary()).rejects.toThrow('localFlow.libraryMissing');
 const execute=contentSupplySystem.execute.bind(contentSupplySystem);
 const refresh=vi.spyOn(contentSupplySystem,'execute').mockImplementation((async(command:any)=>command.kind==='rehydrate'?{ready:[],blocked:['fixture'],failed:[]}:execute(command)) as typeof contentSupplySystem.execute);
 try{
  const restored=await restoreLibraryBackup(backup.file,'shared-storage-test-password');expect(restored.summary.runs).toBe(2);expect(restored.resourceRefresh).toBe('deferred');
  const after=await snapshot();expect(after.learningTargets).toEqual(before.learningTargets);expect(after.learningRuns).toEqual(before.learningRuns);expect(after.learningEvents).toEqual(before.learningEvents);expect(after.packageCache).toEqual([]);validateBackupRows(after);
 }finally{refresh.mockRestore();}
});

for(const version of [10,12,13,14,15,16,17,18])test(`unsupported schema ${version} retains exact source, baseline, recovery and shared owner bytes`,async()=>{
 const sqlite=await sqlite3InitModule(),storage=new sqlite.oo1.DB(':memory:','c'),copy=new SqliteRecordDatabase(sqlite,storage,'memory');
 try{
  storage.exec(sqliteLibrarySchema);storage.exec(`PRAGMA user_version=${version}`);
  for(const table of ['sensa_records','sensa_shared_record_content','sensa_shared_record_content_owners','sensa_record_tombstones','sensa_sync_base']){
   const rows=raw.exec({sql:`SELECT ${table==='sensa_records'?'rowid,*':'*'} FROM ${table}`,rowMode:'array',returnValue:'resultRows'}) as (string|number|null)[][];
   for(const row of rows)storage.exec({sql:`INSERT INTO ${table} VALUES(${row.map(()=>'?').join(',')})`.replace('INSERT INTO sensa_records VALUES','INSERT INTO sensa_records(rowid,table_name,record_key,value_json,content_revision) VALUES'),bind:row});
  }
  storage.exec("CREATE TABLE retained_recovery(value TEXT); INSERT INTO retained_recovery VALUES('owner-recovery-proof')");
  const snapshot=()=>storage.exec({sql:'SELECT name,sql FROM sqlite_schema ORDER BY name',rowMode:'array',returnValue:'resultRows'});
  const before=snapshot(),bytes=sqlite.capi.sqlite3_js_db_export(storage);
  expect(()=>copy.initialize()).toThrow(`sqlite_schema_legacy:${version}`);
  expect(snapshot()).toEqual(before);expect(storage.selectValue('PRAGMA user_version')).toBe(version);
  expect(sqlite.capi.sqlite3_js_db_export(storage)).toEqual(bytes);
  expect(()=>copy.commit({clears:[],deletes:[],puts:[]})).toThrow(`sqlite_schema_legacy:${version}`);
  expect(sqlite.capi.sqlite3_js_db_export(storage)).toEqual(bytes);
 }finally{copy.close(false);}
});

test('an activated saved Memory continues one genuine review while all restored history and pins remain exact',async()=>{
 const fixture=await stageLearningReplica({savedMemoryDrift:true});
 const {sqliteRecordAdapter}=await import('../../../apps/web/src/data/library/sqliteAdapter');
 const adapter=await sqliteRecordAdapter(),originals=new Map<string,unknown>();
 try{
  await fixture.validate();fixture.receiver.commit(fixture.mutation);fixture.assertFacts();
  const beforeRuns=fixture.receiver.entries('learningRuns'),beforeEvents=fixture.receiver.entries('learningEvents');
  for(const name of Object.getOwnPropertyNames(SqliteRecordDatabase.prototype)){
   if(name==='constructor'||typeof Reflect.get(adapter,name)!=='function')continue;
   const method=Reflect.get(fixture.receiver,name);if(typeof method!=='function')continue;
   originals.set(name,Reflect.get(adapter,name));Reflect.set(adapter,name,async(...args:unknown[])=>Reflect.apply(method,fixture.receiver,args));
  }
  vi.useFakeTimers({toFake:['Date']});
  const target=await readLibrary(tx=>tx.get<any>('learningTargets',targetId));vi.setSystemTime(target.memory.dueAt);
  await learningSystem.execute({kind:'start',operationId:id(),targetId,languageContext:context,dailyLimit:20,sessionIntent:'review_only'});
  for(const action of [{kind:'reveal'},{kind:'rate',rating:'good'}] as const){
   vi.setSystemTime(Date.now()+1000);const runtime=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
   await learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action});
  }
  const after=await readLibrary(tx=>tx.get<any>('learningTargets',targetId));expect(after.memoryRevision).toBe(target.memoryRevision+1);
  for(const row of beforeRuns)expect(fixture.receiver.get('learningRuns',row.key)).toBe(row.encodedValue);
  for(const row of beforeEvents)expect(fixture.receiver.get('learningEvents',row.key)).toBe(row.encodedValue);
  expect(fixture.receiver.diagnostics({verifyIntegrity:true}).integrityCheck?.status).toBe('ok');
 }finally{vi.useRealTimers();for(const [name,method] of originals)Reflect.set(adapter,name,method);fixture.receiver.close(false);}
});

test('preencoding rejects a forged shared-body INSERT before its digest is reused',async()=>{
 const fixture=await stageLearningReplica();try{
  await fixture.validate();const handler=Reflect.get(fixture.receiver,'replicaCandidateStore'),target=fixture.records.find(row=>row.table==='learningTargets')!;
  const [digest]=externalizeSharedRecordContent(JSON.parse(target.valueJson)).bodies.keys();expect(digest).toBeTruthy();
  // This models a damaged private scratch row at an outside-transaction
  // boundary, before a later source row first prepares the same digest.
  fixture.storage.exec({sql:'INSERT INTO sensa_replica_candidate_encoded_bodies_v1 VALUES(?,?,?,?)',bind:[fixture.generation,digest!,packStoredRecord('["string","forged body"]'),null]});
  const fence=JSON.parse((fixture.storage.exec({sql:'SELECT fence_json FROM sensa_replica_candidates_v1 WHERE id=?',bind:[fixture.generation],rowMode:0,returnValue:'resultRows'}) as string[])[0]!);
  const plan={receipt:{id:fixture.generation},puts:fixture.records.map(({table,key})=>({table,key})),basePuts:[],deletes:[]};
  await expect(Reflect.get(handler,'prepareEncoding').call(handler,plan,fence,()=>Reflect.get(handler,'check').call(handler,Reflect.get(handler,'header').call(handler,fixture.generation)))).rejects.toThrow(/sqlite_shared_content_invalid|library_sync_candidate_invalid/);
  expect(fixture.receiver.count('learningTargets')).toBe(0);expect(fixture.receiver.syncBaseReferences()).toEqual([]);
 }finally{fixture.receiver.close(false);}
});


test('copyable admitted rows share one transform across two independently charged owners',async()=>{
 const fixture=await stageLearningReplica(),work:Record<string,number>={};
 try{
  await fixture.validate();const handler=Reflect.get(fixture.receiver,'replicaCandidateStore'),header=()=>Reflect.get(handler,'header').call(handler,fixture.generation),fence=JSON.parse(header().fence_json);
  const plan={receipt:{id:fixture.generation},puts:fixture.records.map(({table,key})=>({table,key})),basePuts:fixture.records.map(({table,key})=>({table,key,blockRefs:[]})),deletes:[]};
  observeReplicaWork((kind,n)=>{work[kind]=(work[kind]??0)+n;});
  await Reflect.get(handler,'prepareEncoding').call(handler,plan,fence,()=>Reflect.get(handler,'check').call(handler,header()));
  const {canCopyLibraryReplicaValue}=await import('../../../apps/web/src/data/library/replication/libraryReplica');
  const reusable=fixture.records.filter(row=>canCopyLibraryReplicaValue({...row,table:row.table as LibraryReplicaEntry['table']})).length;
  expect(work['encoding.source']).toBe(fixture.records.length);expect(work['encoding.ownerReuse']).toBe(reusable);expect(work['encoding.transform']).toBe(fixture.records.length*2-reusable);
  const encoded=fixture.storage.exec({sql:'SELECT owner_kind,count(*) AS n FROM sensa_replica_candidate_encoded_v1 GROUP BY owner_kind ORDER BY owner_kind',rowMode:'object',returnValue:'resultRows'});
  expect(encoded).toEqual([{owner_kind:'record',n:fixture.records.length},{owner_kind:'sync',n:fixture.records.length}]);
  expect(fixture.receiver.count('learningRuns')).toBe(0);expect(fixture.receiver.syncBaseReferences()).toEqual([]);
 }finally{observeReplicaWork(undefined);fixture.receiver.close(false);}
});

test('extra DML inside our encoded INSERT cannot be absorbed by the own-write fence',async()=>{
 const fixture=await stageLearningReplica();
 try{
  await fixture.validate();const handler=Reflect.get(fixture.receiver,'replicaCandidateStore'),header=()=>Reflect.get(handler,'header').call(handler,fixture.generation),fence=JSON.parse(header().fence_json),exec=fixture.storage.exec.bind(fixture.storage),prepare=fixture.storage.prepare.bind(fixture.storage);let injected=false;
  fixture.storage.prepare=((sql:any)=>{const statement=prepare(sql);if(sql==='INSERT INTO sensa_replica_candidate_encoded_v1 VALUES(?,?,?,?,?,?,?)'){const step=statement.step.bind(statement);statement.step=()=>{const result=step();if(!injected){injected=true;exec({sql:'UPDATE sensa_replica_candidate_records_v1 SET value_json=value_json WHERE candidate_id=?',bind:[fixture.generation]});}return result;};}return statement;}) as typeof fixture.storage.prepare;
  try{await expect(Reflect.get(handler,'prepareEncoding').call(handler,{receipt:{id:fixture.generation},puts:fixture.records.map(({table,key})=>({table,key})),basePuts:[],deletes:[]},fence,()=>Reflect.get(handler,'check').call(handler,header()))).rejects.toThrow('library_sync_candidate_invalid');}
  finally{fixture.storage.prepare=prepare;}
  expect(injected).toBe(true);expect(fixture.receiver.count('learningRuns')).toBe(0);expect(fixture.receiver.syncBaseReferences()).toEqual([]);
 }finally{fixture.receiver.close(false);}
});

test('publication activation retains captured shared owners after concurrent live Run detach and rejects conflicting body bytes',async()=>{
 const sqlite=await sqlite3InitModule(),storage=new sqlite.oo1.DB(':memory:','c'),copy=new SqliteRecordDatabase(sqlite,storage,'memory');copy.initialize();
 try{
  const puts=libraryTables.flatMap(table=>database.entries(table).map(row=>({table,key:row.key,encodedValue:row.encodedValue}))),encode=(value:unknown)=>JSON.stringify(encodeBackupValue(value)),owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()},incarnation='shared-publication';
  copy.commit({clears:[],deletes:[],puts:[...puts,{table:'meta',key:'service-owner',encodedValue:encode(owner)},{table:'meta',key:'local-incarnation',encodedValue:encode(incarnation)},{table:'meta',key:'local-content-revision',encodedValue:encode(7)}]});
  const identity=decodeBackupValue(JSON.parse(copy.get('meta','identity')!)),run=copy.entries('learningRuns')[0]!;expect(run).toBeTruthy();
  const begun=await copy.replicaCandidate({kind:'beginPublication',fence:{identity,owner,incarnation,localRevision:7}});if(begun.kind!=='begun')throw Error('fixture_begin');let after:any=null;for(;;){const page=await copy.replicaCandidate({kind:'publicationPage',id:begun.id,after});if(page.kind!=='publicationPage')throw Error('fixture_page');after=page.next;if(page.done)break;}
  await copy.replicaCandidate({kind:'admitOwnPublication',id:begun.id,confirmed:true});let detached=false;
  await copy.replicaCandidate({kind:'preparePublication',id:begun.id},()=>{if(detached)return;detached=true;copy.commit({clears:[],contentRevision:8,deletes:[{table:'learningRuns',key:run.key}],puts:[{table:'meta',key:'local-content-revision',encodedValue:encode(8)}]});});
  const frozen=storage.exec({sql:'SELECT frozen.digest,frozen.value_json FROM sensa_initial_publication_content frozen JOIN sensa_shared_record_content live ON live.digest=frozen.digest ORDER BY frozen.digest LIMIT 1',rowMode:'object',returnValue:'resultRows'}) as any[];expect(frozen).toHaveLength(1);
  const row=frozen[0],before=(storage.exec({sql:'SELECT value_json FROM sensa_shared_record_content WHERE digest=?',bind:[row.digest],rowMode:0,returnValue:'resultRows'}) as string[])[0];
  const state={owner,incarnation,revision:1,checkpointVersion:7,restoreValidationVersion:9,syncedLocalRevision:7,status:'pending',publicationOperationId:begun.id},mutation={initialPublication:begun.id,clears:[],deletes:[],puts:[{table:'meta' as const,key:'cloud-sync',encodedValue:encode(state)}]};
  // Damage before preparation is a separate source fence; this checks the
  // immutable same-digest collision at confirmation, then restores exact bytes.
  storage.exec({sql:'UPDATE sensa_shared_record_content SET value_json=? WHERE digest=?',bind:[packStoredRecord('["string","conflicting immutable bytes"]'),row.digest]});
  expect(()=>copy.commit(mutation)).toThrow();expect(copy.syncBaseReferences()).toHaveLength(0);expect(copy.get('learningRuns',run.key)).toBeNull();
  storage.exec({sql:'UPDATE sensa_shared_record_content SET value_json=? WHERE digest=?',bind:[before!,row.digest]});
  // Shared-body UPDATE invalidates the dependency epoch, so rebuild preparation
  // through a fresh handler; never refresh the old cached final fence.
  Reflect.get(copy,'initialPublication').close();Reflect.set(copy,'initialPublication',undefined);await copy.replicaCandidate({kind:'admitOwnPublication',id:begun.id,confirmed:true});await copy.replicaCandidate({kind:'preparePublication',id:begun.id});copy.commit(mutation);
  expect(copy.syncBaseEntries([{table:'learningRuns',key:run.key}])[0].valueJson).toBe(run.encodedValue);expect(copy.get('learningRuns',run.key)).toBeNull();
  expect(Number((storage.exec({sql:"SELECT count(*) FROM sensa_shared_record_content_owners WHERE owner_kind='sync' AND table_name='learningRuns' AND record_key=?",bind:[run.key],rowMode:0,returnValue:'resultRows'}) as number[])[0])).toBeGreaterThan(0);
 }finally{copy.close(false);}
});
