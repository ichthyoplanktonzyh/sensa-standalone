/** Preserve all projection, rollback and no-source-read assertions at both sizes. */
import {expect} from 'vitest';
import init from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import type {LocalLearningTarget} from '../../../apps/web/src/learning/runtime/localProtocol';

export async function checkLearnerProjectionScale(seed:LocalLearningTarget,count:64|10000){
 const sqlite=await init(),raw=new sqlite.oo1.DB(':memory:'),db=new SqliteRecordDatabase(sqlite,raw,'memory');db.initialize();
 try{
  // Projection stress only: these direct clones are not a validated learner
  // collection or evidence of 10k completed learning journeys.
  const targets=Array.from({length:count},(_,index)=>{const target={...structuredClone(seed),id:crypto.randomUUID(),identity:{...seed.identity,senseId:crypto.randomUUID()},expression:`borrow-${index}`};for(const member of target.curriculumMemberships)member.material.content.resources.find(resource=>resource.materialRoleKey==='target_expression')!.contentPayload.surface=target.expression;return target;});
  const puts=targets.map(target=>({table:'learningTargets' as const,key:target.id,encodedValue:JSON.stringify(encodeBackupValue(target))}));
  db.commit({clears:[],deletes:[],puts,contentRevision:1});
  const sourceFacts=()=>raw.exec({sql:"SELECT record_key,value_json FROM sensa_records WHERE table_name='learningTargets' ORDER BY record_key",rowMode:'object',returnValue:'resultRows'});
  const facts=sourceFacts(),enrolled=db.personalEnrollmentIndex(),read=db.get.bind(db);let reads=0;
  db.get=(table,key)=>{if(table==='learningTargets')reads++;return read(table,key);};
  const started=performance.now(),headers=db.learningSemanticMemory(),elapsedMs=performance.now()-started;
  expect(headers.targets).toHaveLength(count);expect(db.personalEnrollmentIndex()).toEqual(enrolled);expect(enrolled.targets).toHaveLength(count);expect(JSON.stringify(enrolled)).not.toMatch(/resources|materialization|protocolState/);expect(reads).toBe(0);
  expect(headers.targets.every(item=>item.presentation.scene.length<=241&&item.presentation.meaning.length<=241)).toBe(true);
  const bytes=Buffer.byteLength(JSON.stringify(headers));expect(bytes).toBeLessThan(12*1024*1024);
  expect(JSON.stringify(headers)).not.toMatch(/data:audio|data:image|materialization|protocolState/);
  const detailStart=performance.now();expect(db.learningSemanticMemory(targets[count-1]!.id).targets[0]!.presentation.expression).toBe(`borrow-${count-1}`);const detailMs=performance.now()-detailStart;
  expect(reads).toBe(1);expect(elapsedMs).toBeLessThan(500);expect(detailMs).toBeLessThan(100);
  console.log('Actual SQLite/Wasm / synthetic projection rows / warm 1x Node / no media transport:',JSON.stringify({count:count,listMs:elapsedMs,exactDetailMs:detailMs,bytes}));
  db.get=read;
  raw.exec({sql:'DELETE FROM sensa_learning_semantic_memory WHERE target_key=?',bind:[targets[0]!.id]});
  expect(()=>db.learningSemanticMemory()).toThrow('localFlow.progressReadFailed');
  expect(()=>db.learningSemanticMemory(targets[0]!.id)).toThrow('localFlow.progressReadFailed');
  raw.exec('DROP TABLE sensa_learning_semantic_memory');
  new SqliteRecordDatabase(sqlite,raw,'memory').initialize();
  expect(sourceFacts()).toEqual(facts);expect(db.learningSemanticMemory()).toEqual(headers);expect(db.personalEnrollmentIndex()).toEqual(enrolled);
  raw.exec("CREATE TEMP TRIGGER reject_semantic_header BEFORE UPDATE ON sensa_learning_semantic_memory BEGIN SELECT RAISE(ABORT,'controlled-semantic-header-failure'); END;");
  expect(()=>db.commit({clears:[],deletes:[],puts:[{...puts[0]!,encodedValue:JSON.stringify(encodeBackupValue({...targets[0]!,expression:'must roll back'}))}],contentRevision:2})).toThrow('controlled-semantic-header-failure');
  expect(sourceFacts()).toEqual(facts);expect(db.learningSemanticMemory()).toEqual(headers);expect(db.personalEnrollmentIndex()).toEqual(enrolled);
 }finally{db.close();}
}
