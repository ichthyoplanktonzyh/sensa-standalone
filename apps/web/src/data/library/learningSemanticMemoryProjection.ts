import type {Database} from '@sqlite.org/sqlite-wasm';
import {learningSupportMeaning} from '@sensa/contracts/sensa';
import type {LearningSemanticMemoryProjection,LearningPersonalEnrollmentIndex} from '../../learning/system/learningReadModels';
import type {LocalLearningTarget} from '../../learning/runtime/localProtocol';
import {materialSourcePin} from '../../learning/runtime/learningIdentity';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';
import {decodeBackupValue,encodeBackupValue} from './backupCodec';
import {learningManagementListRecord,learningManagementListItem} from './learningManagementList';
import type {LearningManagementSummaryQuery} from './runtimeLearningCandidates';

type Item=LearningSemanticMemoryProjection['targets'][number];
class InvalidLearningSummary extends Error{}

/** Presentation and saved memory only: no material, media, Run or fake Example. */
export function learningSemanticMemoryTarget(target:LocalLearningTarget,full=false):Item{
 const memberships=target?.curriculumMemberships;
 if(!target?.id||!target?.identity?.senseId||typeof target.expression!=='string'||!Array.isArray(memberships)||!memberships.length||!Array.isArray(target.planningOverrides))throw new InvalidLearningSummary();
 const member=memberships.find(row=>row.status!=='superseded'&&row.languageContext.languageRouteId===target.introducedLanguageRouteId)
  ??memberships.find(row=>row.status!=='superseded')??memberships[0]!;
 const resources=member.material?.content?.resources;
 if(!Array.isArray(resources)||!member.languageContext?.supportLanguageTag)throw new InvalidLearningSummary();
 const scene=resources.find(row=>row.materialRoleKey==='experience_recall_cue')?.contentPayload.scene;
 const meaning=learningSupportMeaning(resources,member.languageContext.supportLanguageTag);
 const preview=(value:string)=>full||value.length<=240?value:value.slice(0,240)+'…';
 return {
  targetId:target.id,senseId:target.identity.senseId,declaredMastery:hasDeclaredMasteryOverride(target),
  presentation:{expression:String(resources.find(row=>row.materialRoleKey==='target_expression')?.contentPayload.surface??''),meaning:preview(meaning),scene:typeof scene==='string'?preview(scene):'',targetLanguageTag:target.targetLanguageTag,supportLanguageTag:member.languageContext.supportLanguageTag,
   personalMeaningId:member.sourceKind==='personal_meaning_alignment'&&typeof member.provenance.personalMeaningId==='string'?member.provenance.personalMeaningId:null},
  memory:target.memory?{dueAt:target.memory.dueAt,fsrsCardState:target.memory.fsrsCardState,fsrsLastReviewedAt:target.memory.fsrsLastReviewedAt,fsrsStability:target.memory.fsrsStability,reps:target.memory.reps}:null,
 };
}

/** Enrollment existence is a fact projection, not a readiness claim. */
export function personalEnrollmentTarget(target:LocalLearningTarget):LearningPersonalEnrollmentIndex['targets'][number]{
 return {targetId:target.id,identity:{senseId:target.identity.senseId,expressionId:target.identity.expressionId},
  memberships:target.curriculumMemberships.map(member=>({id:member.id!,status:member.status??'active',bindingVersionId:materialSourcePin(member.material).bindingVersionId,languageContext:member.languageContext}))};
}

/** Rebuildable metadata, maintained in the same transaction as Target facts. */
export class SqliteLearningSemanticMemoryProjection{
 constructor(private readonly database:Database,private readonly decodeTarget:(encoded:string)=>LocalLearningTarget,private readonly readTarget:(id:string)=>LocalLearningTarget|null){}
 initialize(){
  const exists=this.database.selectValue("SELECT count(*) FROM sqlite_schema WHERE type='table' AND name='sensa_learning_semantic_memory'");
  this.database.exec(`CREATE TABLE IF NOT EXISTS sensa_learning_semantic_memory(target_key TEXT PRIMARY KEY NOT NULL,sense_id TEXT,summary_json TEXT NOT NULL CHECK(json_valid(summary_json)),valid INTEGER NOT NULL) WITHOUT ROWID;
   CREATE INDEX IF NOT EXISTS sensa_learning_semantic_memory_sense ON sensa_learning_semantic_memory(sense_id,target_key);`);
  const actual=Number(this.database.selectValue("SELECT count(*) FROM sensa_records WHERE table_name='learningTargets'"));
  const columns=this.database.exec({sql:'PRAGMA table_info(sensa_learning_semantic_memory)',rowMode:'object',returnValue:'resultRows'}) as {name:string}[];
  const hasList=columns.some(column=>column.name==='list_json'),hasEnrollment=columns.some(column=>column.name==='enrollment_json'),hasEnrollmentVersion=columns.some(column=>column.name==='enrollment_version');
  if(!hasEnrollmentVersion)this.database.exec('ALTER TABLE sensa_learning_semantic_memory ADD COLUMN enrollment_version INTEGER');
  if(!hasEnrollment)this.database.exec('ALTER TABLE sensa_learning_semantic_memory ADD COLUMN enrollment_json TEXT');
  if(!hasList)this.database.exec('ALTER TABLE sensa_learning_semantic_memory ADD COLUMN list_json TEXT');
  if(exists&&hasList&&hasEnrollment&&hasEnrollmentVersion&&Number(this.database.selectValue('SELECT count(*) FROM sensa_learning_semantic_memory'))===actual)return;
  this.clear();let after='';
  for(;;){
   const rows=this.database.exec({sql:"SELECT record_key,value_json FROM sensa_records WHERE table_name='learningTargets' AND record_key>? ORDER BY record_key LIMIT 64",bind:[after],rowMode:'object',returnValue:'resultRows'}) as {record_key:string;value_json:string}[];
   for(const row of rows)this.upsert(row.record_key,this.decodeTarget(row.value_json));
   if(rows.length<64)break;after=rows.at(-1)!.record_key;
  }
 }
 clear(){this.database.exec('DELETE FROM sensa_learning_semantic_memory');}
 delete(id:string){this.database.exec({sql:'DELETE FROM sensa_learning_semantic_memory WHERE target_key=?',bind:[id]});}
 upsert(id:string,target:LocalLearningTarget){
  let item:Item|null=null;
  try{item=learningSemanticMemoryTarget(target);if(item.targetId!==id)throw new InvalidLearningSummary();}catch(error){if(!(error instanceof InvalidLearningSummary))throw error;item=null;}
  const list=item?learningManagementListRecord(target):null,enrollment=item?personalEnrollmentTarget(target):null;
  this.database.exec({sql:'INSERT INTO sensa_learning_semantic_memory(target_key,sense_id,summary_json,valid,list_json,enrollment_json,enrollment_version) VALUES(?,?,?,?,?,?,1) ON CONFLICT(target_key) DO UPDATE SET sense_id=excluded.sense_id,summary_json=excluded.summary_json,valid=excluded.valid,list_json=excluded.list_json,enrollment_json=excluded.enrollment_json,enrollment_version=excluded.enrollment_version',bind:[id,item?.senseId??null,JSON.stringify(encodeBackupValue(item)),item?1:0,JSON.stringify(list),JSON.stringify(enrollment)]});
 }
 list(query:LearningManagementSummaryQuery,eligibility:Readonly<Record<string,{introduce:boolean;ongoing:boolean}>>,enrollments:ReadonlyMap<string,{title:string|null;paused:boolean}>){
  const rows=this.database.exec({sql:'SELECT list_json,valid FROM sensa_learning_semantic_memory ORDER BY target_key',rowMode:'object',returnValue:'resultRows'}) as {list_json:string|null;valid:number}[];
  if(rows.some(row=>!row.valid||!row.list_json)||rows.length!==Number(this.database.selectValue("SELECT count(*) FROM sensa_records WHERE table_name='learningTargets'")))throw Error('localFlow.progressReadFailed');
  const available=new Set(this.database.exec({sql:"SELECT record_key FROM sensa_records WHERE table_name='packageCache'",rowMode:0,returnValue:'resultRows'}) as string[]);
  return rows.flatMap(row=>{const item=learningManagementListItem(JSON.parse(row.list_json!),query.languageContext,query.clock,eligibility,enrollments,available,query.supportedPolicies);return item?[item]:[];});
 }
 enrollmentIndex():LearningPersonalEnrollmentIndex{
  const rows=this.database.exec({sql:'SELECT enrollment_json,valid FROM sensa_learning_semantic_memory ORDER BY target_key',rowMode:'object',returnValue:'resultRows'}) as {enrollment_json:string|null;valid:number}[];
  if(rows.some(row=>!row.valid||!row.enrollment_json)||rows.length!==Number(this.database.selectValue("SELECT count(*) FROM sensa_records WHERE table_name='learningTargets'")))throw Error('localFlow.progressReadFailed');
  return {targets:rows.map(row=>JSON.parse(row.enrollment_json!))};
 }
 read(targetId?:string):LearningSemanticMemoryProjection{
  if(targetId!==undefined&&(typeof targetId!=='string'||!targetId||targetId.length>2000))throw Error('localFlow.invalidTarget');
  const rows=this.database.exec({sql:`SELECT summary_json,valid FROM sensa_learning_semantic_memory ${targetId===undefined?'':'WHERE target_key=?'} ORDER BY target_key`,bind:targetId===undefined?[]:[targetId],rowMode:'object',returnValue:'resultRows'}) as {summary_json:string;valid:number}[];
  if(rows.some(row=>!row.valid))throw Error('localFlow.progressReadFailed');
  if(targetId===undefined&&rows.length!==Number(this.database.selectValue("SELECT count(*) FROM sensa_records WHERE table_name='learningTargets'")))throw Error('localFlow.progressReadFailed');
  if(targetId!==undefined&&!rows.length&&Number(this.database.selectValue("SELECT count(*) FROM sensa_records WHERE table_name='learningTargets' AND record_key=?",[targetId])))throw Error('localFlow.progressReadFailed');
  if(targetId!==undefined&&rows.length){const target=this.readTarget(targetId);if(!target||target.id!==targetId)throw Error('localFlow.progressReadFailed');return {targets:[learningSemanticMemoryTarget(target,true)]};}
  return {targets:rows.map(row=>decodeBackupValue(JSON.parse(row.summary_json)) as Item)};
 }
}
