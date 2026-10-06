import {afterAll,expect,test} from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {sha256} from '@sensa/learning-kernel';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {openLibrary,readLibrary} from '../../../apps/web/src/data/library/store';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {decodeBackupValue,encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import type {LocalLearningSession,LocalStudyScope} from '../../../apps/web/src/data/library/studyScopes';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://scope-storage.fixture.invalid/')});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());await openLibrary();
const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute),id=()=>crypto.randomUUID();

test('a selected-Run Scope preserves its exact owned member and rolls back an interrupted ownership write',async()=>{
 const fixture=portableBookDeliveryFixture({packageId:id(),memberExpressions:Array.from({length:64},(_,index)=>`batch-scope-${index}`),audioByteLength:512});
 const fetch=globalThis.fetch;globalThis.fetch=async()=>new Response(new Uint8Array(fixture.bookBytes).buffer);
 try{await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:fixture.descriptor,signal:new AbortController().signal});}
 finally{globalThis.fetch=fetch;}
 // Inventory and actual selection are different: 64 genuine admitted Targets
 // remain stored, but a one-participant Run captures only its selected source.
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:64});
 const enrolled=await learningSystem.execute({kind:'enroll_book',operationId:id(),languageContext:context,publicationArchiveSha256:fixture.descriptor.sha256});
 expect(enrolled).toHaveLength(64);
 await learningSystem.execute({kind:'start',operationId:id(),targetId:enrolled[0]!,languageContext:context,dailyLimit:64});
 const scopeId=await readLibrary(async tx=>{
  const sessionId=await tx.get<string>('meta','learning-session-active');
  return (await tx.get<LocalLearningSession>('learningSessions',sessionId!))!.scopeRevisionId;
 });
 const encoded=database.get('studyScopes',scopeId)!,scope=decodeBackupValue(JSON.parse(encoded)) as LocalStudyScope;
 expect(database.count('learningTargets')).toBe(64);expect(scope.members.map(member=>member.targetId)).toEqual([enrolled[0]]);
 const sqlite=await sqlite3InitModule(),storage=new sqlite.oo1.DB(':memory:','c'),copy=new SqliteRecordDatabase(sqlite,storage,'memory');
 try{
  copy.initialize();
  const unchanged=()=>['sensa_records','sensa_shared_record_content','sensa_shared_record_content_owners','sensa_study_scope_members','sensa_study_scope_sources'].map(table=>storage.exec({sql:`SELECT * FROM ${table} ORDER BY 1,2`,rowMode:'object',returnValue:'resultRows'}));
  const before=unchanged(),exec=storage.exec.bind(storage);let injected=false;
  storage.exec=((input:any)=>{
   const sql=typeof input==='string'?input:input.sql;
   if(!injected&&sql.startsWith('INSERT INTO sensa_shared_record_content_owners')){injected=true;throw Error('fixture ownership batch interrupted');}
   return exec(input);
  }) as typeof storage.exec;
  // Exact command-produced bytes in an isolated kernel test; not an asserted
  // product restore of a Scope without its complete domain dependencies.
  const mutation={clears:[],deletes:[],puts:[{table:'studyScopes' as const,key:scopeId,encodedValue:encoded}]};
  try{expect(()=>copy.commit(mutation)).toThrow('fixture ownership batch interrupted');}
  finally{storage.exec=exec;}
  expect(injected).toBe(true);expect(unchanged()).toEqual(before);
  copy.commit(mutation);expect(copy.get('studyScopes',scopeId)).toBe(encoded);
  expect(copy.studyScopeMember(scopeId,enrolled[0]!)).toEqual(scope.members.find(member=>member.targetId===enrolled[0]));
  const digest=sha256(JSON.stringify(encodeBackupValue(scope.members[0])));
  storage.exec({sql:'UPDATE sensa_shared_record_content SET value_json=? WHERE digest=?',bind:['["string","corrupted body"]',digest]});
  const corruptBefore=unchanged();
  expect(()=>copy.commit(mutation)).toThrow('sqlite_shared_content_invalid');
  expect(unchanged()).toEqual(corruptBefore);
 }finally{copy.close();}
});

test('an ownership failure after a complete first body batch rolls back every earlier batch',async()=>{
 const sqlite=await sqlite3InitModule(),storage=new sqlite.oo1.DB(':memory:','c'),copy=new SqliteRecordDatabase(sqlite,storage,'memory');
 try{
  copy.initialize();
  // Raw typed storage representation only: not a replayable product receipt,
  // accepted content, learner action, evidence or learning outcome.
  const payload={fixture:'shared-body representation',slots:Array.from({length:130},(_,index)=>({content:{index,text:'synthetic storage bytes only '.repeat(32)}}))};
  const encoded=JSON.stringify(encodeBackupValue(payload)),key=id(),mutation={clears:[],deletes:[],puts:[{table:'operations' as const,key,encodedValue:encoded}]};
  const state=()=>['sensa_records','sensa_shared_record_content','sensa_shared_record_content_owners'].map(table=>storage.exec({sql:`SELECT * FROM ${table} ORDER BY 1,2`,rowMode:'object',returnValue:'resultRows'}));
  const before=state(),exec=storage.exec.bind(storage);let batches=0,firstOwners=0;
  storage.exec=((input:any)=>{
   const sql=typeof input==='string'?input:input.sql;
   if(sql.startsWith('INSERT INTO sensa_shared_record_content_owners')&&sql.includes('json_each')&&++batches===2){
    firstOwners=Number((exec({sql:'SELECT COUNT(*) FROM sensa_shared_record_content_owners',rowMode:0,returnValue:'resultRows'}) as number[])[0]);
    throw Error('fixture second ownership batch interrupted');
   }
   return exec(input);
  }) as typeof storage.exec;
  try{expect(()=>copy.commit(mutation)).toThrow('fixture second ownership batch interrupted');}
  finally{storage.exec=exec;}
  expect(batches).toBe(2);expect(firstOwners).toBe(128);expect(state()).toEqual(before);
  copy.commit(mutation);expect(copy.get('operations',key)).toBe(encoded);
  expect(storage.exec({sql:'SELECT COUNT(*) FROM sensa_shared_record_content_owners',rowMode:0,returnValue:'resultRows'})).toEqual([130]);
 }finally{copy.close();}
});
