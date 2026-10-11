import {learningScheduleWindow,learningSchedulePageFromTargets,type LearningScheduleQuery,type LearningSchedulePage} from '../../learning/system/learningScheduleModel';
import {localLearningHistoryDay} from '../../learning/system/learningHistoryModel';
import type {Database} from '@sqlite.org/sqlite-wasm';
import type {SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {canonicalJsonDigest,sha256,stableUuid} from '@sensa/learning-kernel';
import {decodeBackupValue,encodeBackupValue} from './backupCodec';
import {unpackStoredRecord} from './sharedRecordContent';
import {sqliteRollbackFailure} from './sqliteConnectionFailure';
import type {HomeLearningStorageProjection} from './homeLearningRecords';
import {planningMembershipForContext,curriculumSourceEligibility} from '../../learning/runtime/curriculumEligibility';
import type {LocalCurriculumEnrollment} from './curriculumEnrollments';
import type {LocalLearningTarget} from '../../learning/runtime/localProtocol';
import type {LocalStudyScope} from './studyScopes';
import {learningPolicyProfileRegistry} from '../../learning/runtime/policyProfiles';
import {resolveLearningQueue,nextLearningQueueChangeAt} from '../../learning/system/learningPlanning';
import {ensureSqliteSchemaIndexes} from './sqliteSchemaIndexes';
import type {SupplementalMembershipState} from './supplementalMemberships';

export interface RuntimeLearningCandidateQuery {
 readonly languageContext:SensaFormalPinnedLanguageContext;
 readonly clock:number;
 readonly dailyLimit:number|undefined;
 readonly supportedPolicies:readonly string[];
 readonly currentTargetIds:readonly string[];
 readonly retryTargetIds:readonly string[];
 /** Candidates rejected by the current protocol/resource check in this read. */
 readonly excludedTargetIds?:readonly string[];
 readonly scopeRevisionId?:string;
}
export interface RuntimeLearningCandidate {readonly id:string;readonly relearnAt:string|null;}
export interface RuntimeLearningCandidates {
 readonly due:readonly RuntimeLearningCandidate[];
 readonly initialReady:readonly RuntimeLearningCandidate[];
 readonly nextChangeAt:number|null;
}
export type LearningManagementSummaryQuery=Pick<RuntimeLearningCandidateQuery,'languageContext'|'clock'|'dailyLimit'|'supportedPolicies'>&{readonly includeLibraryItems?:boolean;readonly includeTargetIds?:boolean;readonly includeInventory?:boolean;readonly currentTargetIds?:readonly string[]};
export interface LearningManagementStorageSummary{readonly items?:readonly import('../../learning/system/learningReadModels').LearningManagementListItem[];readonly targetIds:readonly string[];readonly policies:readonly string[];readonly readyInitialCount:number;readonly reviewDueCount:number;readonly currentCandidateCount:number;readonly routeTargetCount:number|null;readonly libraryTargetCount:number|null;readonly nextReviewAt:number|null;}
const bounds=(query:RuntimeLearningCandidateQuery)=>{
 if(!Number.isFinite(query.clock))throw new Error('localFlow.clockChanged');
 const start=new Date(query.clock);start.setHours(0,0,0,0);
 const end=new Date(start);end.setDate(end.getDate()+1);
 return {start:start.getTime(),end:end.getTime(),limit:1+new Set([...query.currentTargetIds,...query.retryTargetIds]).size};
};
/** In-memory test adapter uses the same queue oracle. Production returns only
 * a bounded prefix plus exact retry candidates across the Worker boundary. */
function planningQueueFromRecords(stored:HomeLearningStorageProjection,query:LearningManagementSummaryQuery&Pick<RuntimeLearningCandidateQuery,'excludedTargetIds'>,scope?:LocalStudyScope){
 const available=new Set(stored.availablePackageKeys);
 const excluded=new Set(query.excludedTargetIds);
 const enrollments=new Map((stored.enrollments??[]).map(enrollment=>[enrollment.id,enrollment]));
 const eligibility:Record<string,{introduce:boolean;ongoing:boolean}>={};
 const frozen=new Map(scope?.members.flatMap(member=>member.sources.map(source=>[source.membershipId,{member,source}] as const))??[]);
 const readiness=Object.fromEntries(stored.targets.map(target=>{
  const policy=target.committedPolicy?.profileId??target.policyAssignment.profileId;
  const compiled=scope?Object.fromEntries(target.curriculumMemberships.map(member=>{const pin=member.id?frozen.get(member.id):undefined,purpose=target.relearnAt?'relearning':target.completedAt?'retention_review':'initial_learning';const usable=!!pin&&pin.member.policy.profileId===policy&&(!target.committedPolicy?.profileVersion||target.committedPolicy.profileVersion===pin.member.policy.profileVersion)&&pin.source.plans.some(plan=>plan.purpose===purpose&&plan.readiness==='ready');return [member.id??'',{introduce:usable&&!!pin?.source.introduce,ongoing:usable&&!!pin?.source.ongoing}];})):stored.sourceEligibility;
  const membership=excluded.has(target.id)?undefined:planningMembershipForContext(target,query.languageContext,enrollments,member=>member.material.snapshot.validationStatus==='validated'&&query.supportedPolicies.includes(policy)&&(policy==='lightweight'||!!member.packageKey&&available.has(member.packageKey)&&!!member.assurancePackageKey),compiled);
  const id=membership?.provenance?.curriculumEnrollmentId;
  eligibility[target.id]=membership?(membership.id&&compiled?.[membership.id]||curriculumSourceEligibility(membership,typeof id==='string'?enrollments.get(id):undefined,!!target.startedAt)):{introduce:false,ongoing:false};
  return [target.id,membership?'ready':'blocked'];
 })) as Record<string,'ready'|'blocked'>;
 const input={targets:[...stored.targets].sort((a,b)=>a.id.localeCompare(b.id)),languageRouteId:query.languageContext.languageRouteId,readiness,eligibility,clock:query.clock,dailyLimit:query.dailyLimit};
 return {input,queue:resolveLearningQueue(input)};
}
export function learningManagementSummaryFromRecords(stored:HomeLearningStorageProjection,query:LearningManagementSummaryQuery):LearningManagementStorageSummary{
 const {queue,input}=planningQueueFromRecords(stored,query);
 const context=query.languageContext,targets=stored.targets.filter(target=>target.curriculumMemberships.some(member=>member.languageContext.languageRouteId===context.languageRouteId&&member.languageContext.targetLanguageTag===context.targetLanguageTag&&member.languageContext.supportLanguageTag===context.supportLanguageTag));
 const future=queue.activeTargets.flatMap(target=>{
  const dueAt=target.relearnAt?Date.parse(target.relearnAt):target.memory?.dueAt.getTime();
  return !target.planningOverrides.some(override=>override.kind==='declared_mastery')&&input.readiness[target.id]==='ready'&&input.eligibility[target.id]?.ongoing&&dueAt!==undefined&&dueAt>query.clock?[dueAt]:[];
 });
 const current=new Set(query.currentTargetIds);
 return {targetIds:query.includeTargetIds===false?[]:targets.map(target=>target.id),policies:query.includeTargetIds===false?[]:[...new Set(targets.map(target=>target.committedPolicy?.profileId??target.policyAssignment.profileId))],readyInitialCount:queue.initialReady.length,reviewDueCount:queue.due.length,currentCandidateCount:[...queue.initialReady,...queue.due].filter(target=>current.has(target.id)).length,routeTargetCount:query.includeInventory===false?null:targets.length,libraryTargetCount:query.includeInventory===false?null:stored.targets.length,nextReviewAt:future.length?Math.min(...future):null};
}
export function learningScheduleFromRecords(stored:HomeLearningStorageProjection,query:LearningScheduleQuery):LearningSchedulePage{
 const {queue,input}=planningQueueFromRecords(stored,{...query,dailyLimit:undefined});
 return learningSchedulePageFromTargets(queue.activeTargets.flatMap(target=>{
  const dueAt=target.relearnAt?Date.parse(target.relearnAt):target.memory?.dueAt.getTime();
  return !target.planningOverrides.some(override=>override.kind==='declared_mastery')&&input.readiness[target.id]==='ready'&&input.eligibility[target.id]?.ongoing&&dueAt!==undefined?[{targetId:target.id,dueAt,kind:target.relearnAt?'relearning' as const:'retention_review' as const}]:[];
 }),query);
}
export function runtimeLearningCandidatesFromRecords(stored:HomeLearningStorageProjection,query:RuntimeLearningCandidateQuery,scope?:LocalStudyScope):RuntimeLearningCandidates{
 if(query.scopeRevisionId&&!scope)throw new Error('localFlow.progressReadFailed');
 const {limit}=bounds(query),{input,queue}=planningQueueFromRecords(stored,query,scope),retries=new Set(query.retryTargetIds),excluded=new Set(query.excludedTargetIds),candidate=({id,relearnAt}:RuntimeLearningCandidate)=>({id,relearnAt});
 return {due:queue.due.filter(target=>!excluded.has(target.id)).filter((target,index)=>index<limit||retries.has(target.id)).map(candidate),initialReady:queue.initialReady.filter(target=>!excluded.has(target.id)).slice(0,limit).map(candidate),nextChangeAt:nextLearningQueueChangeAt(input,queue)};
}

const schema=`CREATE TABLE IF NOT EXISTS sensa_runtime_learning_candidate_sources(
 language_route_id TEXT NOT NULL,target_language_tag TEXT NOT NULL,support_language_tag TEXT NOT NULL,target_key TEXT NOT NULL,
 source_key TEXT NOT NULL,source_order INTEGER NOT NULL,enrollment_key TEXT,source_archive_sha256 TEXT,superseded INTEGER NOT NULL,sense_version_id TEXT,binding_version_id TEXT,
 policy_id TEXT NOT NULL,policy_version TEXT NOT NULL,validated INTEGER NOT NULL,declared INTEGER NOT NULL,package_key TEXT,assurance_package_key TEXT,
 started INTEGER NOT NULL,completed INTEGER NOT NULL,due_at INTEGER,relearn_at TEXT,
 PRIMARY KEY(language_route_id,target_language_tag,support_language_tag,target_key,source_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_runtime_source_due ON sensa_runtime_learning_candidate_sources(language_route_id,target_language_tag,support_language_tag,due_at,target_key) WHERE declared=0 AND validated=1;
CREATE INDEX IF NOT EXISTS sensa_runtime_source_initial ON sensa_runtime_learning_candidate_sources(language_route_id,target_language_tag,support_language_tag,started DESC,target_key) WHERE declared=0 AND validated=1 AND completed=0;
CREATE INDEX IF NOT EXISTS sensa_runtime_source_target ON sensa_runtime_learning_candidate_sources(target_key);
CREATE TABLE IF NOT EXISTS sensa_runtime_learning_enrollments(enrollment_key TEXT PRIMARY KEY NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,archive_sha256 TEXT,mode TEXT NOT NULL,whole_range INTEGER NOT NULL,range_revision_id TEXT,range_members_digest TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_runtime_learning_ranges(enrollment_key TEXT NOT NULL,package_key TEXT NOT NULL,sense_version_id TEXT NOT NULL,binding_version_id TEXT NOT NULL,PRIMARY KEY(enrollment_key,package_key,sense_version_id,binding_version_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_study_scope_sources(scope_key TEXT NOT NULL,target_key TEXT NOT NULL,source_key TEXT NOT NULL,policy_id TEXT NOT NULL,policy_version TEXT NOT NULL,introduce INTEGER NOT NULL,ongoing INTEGER NOT NULL,ready_initial INTEGER NOT NULL,ready_review INTEGER NOT NULL,ready_relearning INTEGER NOT NULL,PRIMARY KEY(scope_key,target_key,source_key)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_study_scope_members(scope_key TEXT NOT NULL,target_key TEXT NOT NULL,body_digest TEXT NOT NULL,PRIMARY KEY(scope_key,target_key)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_runtime_learning_introductions(target_key TEXT PRIMARY KEY NOT NULL,language_route_id TEXT NOT NULL,started_at INTEGER NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_runtime_learning_day ON sensa_runtime_learning_introductions(language_route_id,started_at);
CREATE TABLE IF NOT EXISTS sensa_runtime_learning_meta(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL) WITHOUT ROWID;`;
const supplementalSchema='CREATE TABLE IF NOT EXISTS sensa_runtime_supplemental_states(source_key TEXT PRIMARY KEY NOT NULL,status TEXT NOT NULL) WITHOUT ROWID;';
const tableNames=['sensa_runtime_learning_candidate_sources','sensa_runtime_learning_enrollments','sensa_runtime_learning_ranges','sensa_study_scope_sources','sensa_study_scope_members','sensa_runtime_learning_introductions','sensa_runtime_learning_meta','sensa_runtime_supplemental_states'];

/** Device-local scheduling index. Updated atomically with Target facts; neither
 * authoritative learning history nor an eligibility override. No material or
 * Run is decoded when selecting an ordinary continuation. */
export class SqliteRuntimeLearningCandidates {
 constructor(private readonly database:Database,private readonly decodeTarget:(encoded:string)=>LocalLearningTarget=encoded=>decodeBackupValue(JSON.parse(encoded)) as LocalLearningTarget,private readonly decodeEnrollment:(encoded:string)=>LocalCurriculumEnrollment=encoded=>decodeBackupValue(JSON.parse(encoded)) as LocalCurriculumEnrollment,private readonly rebuiltTarget?:(id:string,target:LocalLearningTarget)=>void,private readonly decodeScope:(encoded:string)=>LocalStudyScope=encoded=>decodeBackupValue(JSON.parse(encoded)) as LocalStudyScope){database.createFunction({name:'sensa_schedule_day',arity:1,innocuous:true,xFunc:(_context,at)=>localLearningHistoryDay(new Date(Number(at)))});}
 initialize():void{
  const tables=this.database.exec({sql:"SELECT name FROM sqlite_schema WHERE type='table' AND name IN (SELECT value FROM json_each(?))",bind:[JSON.stringify(tableNames)],rowMode:0,returnValue:'resultRows'}) as unknown[];
  if(tables.length===tableNames.length){
   const version=this.database.exec({sql:"SELECT value FROM sensa_runtime_learning_meta WHERE key='format'",rowMode:0,returnValue:'resultRows'}) as unknown[];
   if(version[0]==='v7'){ensureSqliteSchemaIndexes(this.database,schema);return;}
  }
  // Only these derived scheduling tables are rebuilt; learner facts stay put.
  for(const table of ['sensa_runtime_learning_candidate_sources','sensa_runtime_learning_enrollments','sensa_runtime_learning_ranges','sensa_study_scope_sources','sensa_study_scope_members'])this.database.exec(`DROP TABLE IF EXISTS ${table}`);
  this.database.exec(schema);this.database.exec(supplementalSchema);this.clear();this.clearSupplementalStates();
  this.database.exec('DELETE FROM sensa_runtime_learning_enrollments');this.database.exec('DELETE FROM sensa_runtime_learning_ranges');
  for(const row of this.database.exec({sql:"SELECT record_key,value_json FROM sensa_records WHERE table_name='curriculumEnrollments'",rowMode:'object',returnValue:'resultRows'}) as {record_key:string;value_json:string}[])this.upsertEnrollment(row.record_key,this.decodeEnrollment(row.value_json));
  for(const row of this.database.exec({sql:"SELECT record_key,value_json FROM sensa_records WHERE table_name='supplementalMembershipStates'",rowMode:'object',returnValue:'resultRows'}) as {record_key:string;value_json:string}[])this.upsertSupplementalState(row.record_key,decodeBackupValue(JSON.parse(unpackStoredRecord(row.value_json))) as SupplementalMembershipState);
  for(const row of this.database.exec({sql:"SELECT record_key,value_json FROM sensa_records WHERE table_name='studyScopes'",rowMode:'object',returnValue:'resultRows'}) as {record_key:string;value_json:string}[])this.upsertScope(row.record_key,this.decodeScope(row.value_json));
  let after='';
  for(;;){
   const rows=this.database.exec({sql:"SELECT record_key,value_json FROM sensa_records WHERE table_name='learningTargets' AND record_key>? ORDER BY record_key LIMIT 64",bind:[after],rowMode:'object',returnValue:'resultRows'}) as {record_key:string;value_json:string}[];
   for(const row of rows){const target=this.decodeTarget(row.value_json);this.upsert(row.record_key,target);this.rebuiltTarget?.(row.record_key,target);}
   if(rows.length<64)break;after=rows.at(-1)!.record_key;
  }
  this.database.exec("INSERT INTO sensa_runtime_learning_meta(key,value) VALUES('format','v7') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
 }
 clear():void{this.database.exec('DELETE FROM sensa_runtime_learning_candidate_sources');this.database.exec('DELETE FROM sensa_runtime_learning_introductions');}
 clearEnrollments():void{this.database.exec('DELETE FROM sensa_runtime_learning_enrollments');this.database.exec('DELETE FROM sensa_runtime_learning_ranges');}
 clearSupplementalStates():void{this.database.exec('DELETE FROM sensa_runtime_supplemental_states');}
 deleteSupplementalState(id:string):void{this.database.exec({sql:'DELETE FROM sensa_runtime_supplemental_states WHERE source_key=?',bind:[id]});}
 upsertSupplementalState(id:string,state:SupplementalMembershipState):void{this.database.exec({sql:'INSERT INTO sensa_runtime_supplemental_states VALUES(?,?) ON CONFLICT(source_key) DO UPDATE SET status=excluded.status',bind:[id,state.status]});}
 delete(targetId:string):void{for(const table of ['sensa_runtime_learning_candidate_sources','sensa_runtime_learning_introductions'])this.database.exec({sql:`DELETE FROM ${table} WHERE target_key=?`,bind:[targetId]});}
 deleteEnrollment(id:string):void{for(const table of ['sensa_runtime_learning_enrollments','sensa_runtime_learning_ranges'])this.database.exec({sql:`DELETE FROM ${table} WHERE enrollment_key=?`,bind:[id]});}
 clearScopes():void{for(const table of ['sensa_study_scope_sources','sensa_study_scope_members'])this.database.exec(`DELETE FROM ${table}`);}
 deleteScope(id:string):void{for(const table of ['sensa_study_scope_sources','sensa_study_scope_members'])this.database.exec({sql:`DELETE FROM ${table} WHERE scope_key=?`,bind:[id]});}
 scopeMember(scopeId:string,targetId:string):import('./studyScopes').LocalStudyScopeMember|null{
  return this.readScopeMember(scopeId,targetId,true);
 }
 private readScopeMember(scopeId:string,targetId:string,allowRepair:boolean):import('./studyScopes').LocalStudyScopeMember|null{
  const rows=this.database.exec({sql:`SELECT body.value_json,member.body_digest,owner.digest AS owned_digest,scope_record.record_key AS actual_scope
   FROM sensa_study_scope_members AS member
   LEFT JOIN sensa_shared_record_content_owners AS owner ON owner.owner_kind='record' AND owner.table_name='studyScopes' AND owner.record_key=member.scope_key AND owner.digest=member.body_digest
   LEFT JOIN sensa_shared_record_content AS body ON body.digest=member.body_digest
   LEFT JOIN sensa_records AS scope_record ON scope_record.table_name='studyScopes' AND scope_record.record_key=member.scope_key
   WHERE member.scope_key=? AND member.target_key=?`,bind:[scopeId,targetId],rowMode:'object',returnValue:'resultRows'}) as {value_json:string|null;body_digest:string;owned_digest:string|null;actual_scope:string|null}[];
  if(!rows.length){
   if(!allowRepair)throw new Error('localFlow.progressReadFailed');
   // A missing derived row is not proof that this Target is outside the frozen
   // Scope. In particular, it must never authorize a new policy assignment.
   const stored=this.database.exec({sql:"SELECT value_json FROM sensa_records WHERE table_name='studyScopes' AND record_key=?",bind:[scopeId],rowMode:0,returnValue:'resultRows'}) as string[];
   if(!stored.length)throw new Error('localFlow.progressReadFailed');
   const scope=this.decodeScope(stored[0]!);
   if(!scope||!Array.isArray(scope.members))throw new Error('localFlow.progressReadFailed');
   const {id,createdAt,createdByOperationId,definitionDigest,...body}=scope;
   if(id!==scopeId||definitionDigest!==canonicalJsonDigest(body)||id!==stableUuid(`local-study-scope:${createdByOperationId}:${definitionDigest}`))throw new Error('localFlow.progressReadFailed');
   if(!scope.members.some(member=>member.targetId===targetId))return null;
   const owned=new Set(this.database.exec({sql:"SELECT digest FROM sensa_shared_record_content_owners WHERE owner_kind='record' AND table_name='studyScopes' AND record_key=?",bind:[scopeId],rowMode:0,returnValue:'resultRows'}) as string[]);
   for(const member of scope.members)if(!owned.has(sha256(JSON.stringify(encodeBackupValue(member)))))throw new Error('localFlow.progressReadFailed');
   // Only rebuildable pointers/qualification rows change. Their original
   // immutable body, fact record and ownership remain untouched.
   this.database.exec('SAVEPOINT sensa_scope_member_repair');
   try{this.upsertScope(scopeId,scope);this.database.exec('RELEASE sensa_scope_member_repair');}
   catch(error){
    try{this.database.exec('ROLLBACK TO sensa_scope_member_repair');this.database.exec('RELEASE sensa_scope_member_repair');}
    catch(rollback){throw sqliteRollbackFailure(error,rollback);}
    throw error;
   }
   return this.readScopeMember(scopeId,targetId,false);
  }
  const row=rows[0]!;
  if(row.actual_scope!==scopeId||row.owned_digest!==row.body_digest||typeof row.value_json!=='string')throw new Error('localFlow.progressReadFailed');
  const encoded=unpackStoredRecord(row.value_json);if(sha256(encoded)!==row.body_digest)throw new Error('localFlow.progressReadFailed');
  const member=decodeBackupValue(JSON.parse(encoded)) as import('./studyScopes').LocalStudyScopeMember;
  if(member.targetId!==targetId)throw new Error('localFlow.progressReadFailed');return member;
 }
 upsertScope(id:string,scope:LocalStudyScope):void{
  this.deleteScope(id);
  const pointers:[string,string][]=[],qualifications:(string|number)[][]=[];
  for(const member of scope.members){
   const encoded=JSON.stringify(encodeBackupValue(member));
   // This index locates the owned immutable body; it is not a second copy.
   pointers.push([member.targetId,sha256(encoded)]);
   for(const source of member.sources){
   const ready=(purpose:string)=>Number(source.plans.some(plan=>plan.purpose===purpose&&plan.readiness==='ready'));
   qualifications.push([member.targetId,source.membershipId,member.policy.profileId,member.policy.profileVersion,Number(source.introduce),Number(source.ongoing),ready('initial_learning'),ready('retention_review'),ready('relearning')]);
   }
  }
  // Bounded relation batches avoid compiling one SQLite statement per member
  // of a complete inventory. This remains the caller's single transaction.
  for(let offset=0;offset<pointers.length;offset+=512)this.database.exec({sql:"INSERT INTO sensa_study_scope_members SELECT ?,json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)",bind:[id,JSON.stringify(pointers.slice(offset,offset+512))]});
  for(let offset=0;offset<qualifications.length;offset+=512)this.database.exec({sql:`INSERT INTO sensa_study_scope_sources SELECT ?,${Array.from({length:9},(_,index)=>`json_extract(value,'$[${index}]')`).join(',')} FROM json_each(?)`,bind:[id,JSON.stringify(qualifications.slice(offset,offset+512))]});
 }
 upsertEnrollment(id:string,enrollment:LocalCurriculumEnrollment):void{
  const before=this.database.exec({sql:'SELECT range_revision_id,range_members_digest FROM sensa_runtime_learning_enrollments WHERE enrollment_key=?',bind:[id],rowMode:'object',returnValue:'resultRows'}) as {range_revision_id:string|null;range_members_digest:string}[];
  const source=enrollment.source;
  const revision=enrollment.bookPlan?.range.rangeRevisionId??null;
  const members=enrollment.bookPlan?.range.members??[],digest=canonicalJsonDigest(members);
  this.database.exec({sql:'INSERT INTO sensa_runtime_learning_enrollments VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(enrollment_key) DO UPDATE SET kind=excluded.kind,status=excluded.status,archive_sha256=excluded.archive_sha256,mode=excluded.mode,whole_range=excluded.whole_range,range_revision_id=excluded.range_revision_id,range_members_digest=excluded.range_members_digest',bind:[id,source.kind,enrollment.status,source.kind==='published_book'?source.publicationArchiveSha256:null,source.kind==='published_book'?enrollment.bookPlan?.mode??'active':'active',Number(!enrollment.bookPlan||enrollment.bookPlan.range.selection.kind==='all'),revision,digest]});
  // A restored/replicated identifier alone cannot witness unchanged contents.
  if(before[0]?.range_revision_id===revision&&before[0]?.range_members_digest===digest)return;
  this.database.exec({sql:'DELETE FROM sensa_runtime_learning_ranges WHERE enrollment_key=?',bind:[id]});
  for(const member of members)this.database.exec({sql:'INSERT INTO sensa_runtime_learning_ranges VALUES(?,?,?,?)',bind:[id,member.packageKey,member.senseVersionId,member.bindingVersionId]});
 }
 upsert(targetId:string,target:LocalLearningTarget):void{
  this.delete(targetId);
  if(target.introducedLanguageRouteId&&target.startedAt)this.database.exec({sql:'INSERT INTO sensa_runtime_learning_introductions(target_key,language_route_id,started_at) VALUES(?,?,?)',bind:[targetId,target.introducedLanguageRouteId,Date.parse(target.startedAt)]});
  const policy=target.committedPolicy?.profileId??target.policyAssignment.profileId;
  let profileVersion=target.committedPolicy?.profileVersion??'';
  if(!profileVersion)try{profileVersion=learningPolicyProfileRegistry.get(policy).profileVersion;}catch{/* Unsupported policies remain indexed but cannot qualify. */}
  for(const [index,membership] of target.curriculumMemberships.entries()){
   const context=membership.languageContext;
   const due=target.relearnAt?Date.parse(target.relearnAt):target.memory?.dueAt.getTime()??null;
   this.database.exec({sql:'INSERT INTO sensa_runtime_learning_candidate_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',bind:[context.languageRouteId,context.targetLanguageTag,context.supportLanguageTag,targetId,membership.id??`${targetId}:${index}`,index,typeof membership.provenance?.curriculumEnrollmentId==='string'?membership.provenance.curriculumEnrollmentId:null,typeof membership.provenance?.publicationArchiveSha256==='string'?membership.provenance.publicationArchiveSha256:null,Number(membership.status==='superseded'),membership.material.snapshot.provenance?.senseVersionId as string??membership.provenance?.senseVersionId as string??null,membership.material.snapshot.provenance?.bindingVersionId as string??membership.provenance?.bindingVersionId as string??null,policy,profileVersion,Number(membership.material.snapshot.validationStatus==='validated'),Number(target.planningOverrides.some(override=>override.kind==='declared_mastery')),membership.packageKey,membership.assurancePackageKey??null,Number(!!target.startedAt),Number(!!target.completedAt),due,target.relearnAt]});
  }
 }
 private qualifiedSources(scopeRevisionId?:string,parameterOffset=0):string{
  return `FROM sensa_runtime_learning_candidate_sources AS candidate
   LEFT JOIN sensa_runtime_learning_enrollments AS enrollment ON enrollment.enrollment_key=candidate.enrollment_key
   ${scopeRevisionId?`JOIN sensa_study_scope_sources AS pinned ON pinned.scope_key=?${parameterOffset+5} AND pinned.target_key=candidate.target_key AND pinned.source_key=candidate.source_key`:''}
   WHERE candidate.language_route_id=?${parameterOffset+1} AND candidate.target_language_tag=?${parameterOffset+2} AND candidate.support_language_tag=?${parameterOffset+3}
    AND candidate.declared=0 AND candidate.validated=1 AND candidate.policy_id IN (SELECT value FROM json_each(?${parameterOffset+4}))
    AND (candidate.policy_id='lightweight' OR (candidate.package_key IS NOT NULL AND candidate.assurance_package_key IS NOT NULL
     AND EXISTS(SELECT 1 FROM sensa_records WHERE table_name='packageCache' AND record_key=candidate.package_key)))
    AND ${scopeRevisionId?`(candidate.policy_id=pinned.policy_id AND (candidate.started=0 OR candidate.policy_version=pinned.policy_version)
     AND ((candidate.started=1 AND pinned.ongoing=1) OR (candidate.started=0 AND pinned.introduce=1))
     AND (CASE WHEN candidate.relearn_at IS NOT NULL THEN pinned.ready_relearning WHEN candidate.completed=1 THEN pinned.ready_review ELSE pinned.ready_initial END)=1)`:`(NOT EXISTS(SELECT 1 FROM sensa_runtime_supplemental_states AS decision WHERE decision.source_key=candidate.source_key AND decision.status='removed') AND ((candidate.enrollment_key IS NULL AND candidate.superseded=0)
     OR (enrollment.status='active' AND (enrollment.kind<>'published_book' AND candidate.superseded=0
      OR enrollment.kind='published_book' AND enrollment.mode<>'paused' AND (candidate.started=1
       OR enrollment.mode='active' AND candidate.superseded=0 AND candidate.source_archive_sha256=enrollment.archive_sha256
        AND (enrollment.whole_range=1 OR EXISTS(SELECT 1 FROM sensa_runtime_learning_ranges AS selected
         WHERE selected.enrollment_key=enrollment.enrollment_key AND selected.package_key=candidate.package_key
          AND selected.sense_version_id=candidate.sense_version_id AND selected.binding_version_id=candidate.binding_version_id)))))))`}`;
 }
 sourceEligibility(routeId:string):Readonly<Record<string,{introduce:boolean;ongoing:boolean}>>{
  const ordinary=`candidate.enrollment_key IS NULL AND candidate.superseded=0 OR enrollment.status='active' AND enrollment.kind<>'published_book' AND candidate.superseded=0`;
  const book=`enrollment.kind='published_book' AND enrollment.status='active'`;
  const selected=`enrollment.whole_range=1 OR EXISTS(SELECT 1 FROM sensa_runtime_learning_ranges AS selected WHERE selected.enrollment_key=enrollment.enrollment_key AND selected.package_key=candidate.package_key AND selected.sense_version_id=candidate.sense_version_id AND selected.binding_version_id=candidate.binding_version_id)`;
  const rows=this.database.exec({sql:`SELECT candidate.source_key,
   (NOT EXISTS(SELECT 1 FROM sensa_runtime_supplemental_states AS decision WHERE decision.source_key=candidate.source_key AND decision.status='removed') AND (${ordinary} OR ${book} AND enrollment.mode='active' AND candidate.superseded=0 AND candidate.source_archive_sha256=enrollment.archive_sha256 AND (${selected}))) AS introduce,
   (NOT EXISTS(SELECT 1 FROM sensa_runtime_supplemental_states AS decision WHERE decision.source_key=candidate.source_key AND decision.status='removed') AND (${ordinary} OR ${book} AND enrollment.mode<>'paused' AND candidate.started=1)) AS ongoing
   FROM sensa_runtime_learning_candidate_sources AS candidate LEFT JOIN sensa_runtime_learning_enrollments AS enrollment ON enrollment.enrollment_key=candidate.enrollment_key WHERE candidate.language_route_id=?`,bind:[routeId],rowMode:'object',returnValue:'resultRows'}) as {source_key:string;introduce:number|null;ongoing:number|null}[];
  return Object.fromEntries(rows.map(row=>[row.source_key,{introduce:!!row.introduce,ongoing:!!row.ongoing}]));
 }
 read(query:RuntimeLearningCandidateQuery):RuntimeLearningCandidates{
  if(query.scopeRevisionId){const present=this.database.exec({sql:"SELECT 1 FROM sensa_records WHERE table_name='studyScopes' AND record_key=?",bind:[query.scopeRevisionId],rowMode:0,returnValue:'resultRows'}) as unknown[];if(!present.length)throw new Error('localFlow.progressReadFailed');}
  const {start,end,limit}=bounds(query),context=query.languageContext;
  const qualified=this.qualifiedSources(query.scopeRevisionId);
  const parameters=[context.languageRouteId,context.targetLanguageTag,context.supportLanguageTag,JSON.stringify(query.supportedPolicies),...(query.scopeRevisionId?[query.scopeRevisionId]:[])];
  const select=(where:string,bind:(string|number)[],suffix:string):RuntimeLearningCandidate[]=>{
   const rows=this.database.exec({sql:`SELECT candidate.target_key,candidate.relearn_at ${qualified} AND candidate.target_key NOT IN (SELECT value FROM json_each(?)) AND ${where} GROUP BY candidate.target_key ${suffix}`,bind:[...parameters,JSON.stringify(query.excludedTargetIds??[]),...bind],rowMode:'object',returnValue:'resultRows'}) as {target_key:string;relearn_at:string|null}[];
   return rows.map(row=>({id:row.target_key,relearnAt:row.relearn_at}));
  };
  const due=select('due_at<=?',[query.clock],`ORDER BY candidate.target_key LIMIT ${limit}`);
  if(query.retryTargetIds.length){const ids=new Set(due.map(target=>target.id));for(const target of select('due_at<=? AND candidate.target_key IN (SELECT value FROM json_each(?))',[query.clock,JSON.stringify(query.retryTargetIds)],'ORDER BY candidate.target_key'))if(!ids.has(target.id))due.push(target);}
  const introduced=this.database.exec({sql:'SELECT COUNT(*) FROM sensa_runtime_learning_introductions WHERE language_route_id=? AND started_at>=? AND started_at<?',bind:[context.languageRouteId,start,end],rowMode:0,returnValue:'resultRows'}) as unknown[];
  const remaining=Math.max(0,(query.dailyLimit??20)-Number(introduced[0]??0));
  const initialReady=select('completed=0 AND started=1',[],`ORDER BY candidate.target_key LIMIT ${limit}`);
  if(initialReady.length<limit&&remaining)initialReady.push(...select('completed=0 AND started=0',[],`ORDER BY candidate.target_key LIMIT ${Math.min(remaining,limit-initialReady.length)}`));
  const future=this.database.exec({sql:`SELECT MIN(candidate.due_at) ${qualified} AND candidate.due_at>?`,bind:[...parameters,query.clock],rowMode:0,returnValue:'resultRows'}) as unknown[];
  const next=Number(introduced[0]??0)>0?end:null,futureAt=future[0]===null||future[0]===undefined?null:Number(future[0]);
  return {due,initialReady,nextChangeAt:next===null?futureAt:futureAt===null?next:Math.min(next,futureAt)};
 }
 schedule(query:LearningScheduleQuery):LearningSchedulePage{
  const window=learningScheduleWindow(query),context=query.languageContext;
  const selected=`SELECT candidate.target_key AS targetId,candidate.due_at AS dueAt,CASE WHEN candidate.relearn_at IS NULL THEN 'retention_review' ELSE 'relearning' END AS kind ${this.qualifiedSources()} AND candidate.due_at>?5 AND candidate.due_at<?6 AND (?7='all' OR CASE WHEN candidate.relearn_at IS NULL THEN 'retention_review' ELSE 'relearning' END=?7) GROUP BY candidate.target_key`;
  const bind=[context.languageRouteId,context.targetLanguageTag,context.supportLanguageTag,JSON.stringify(query.supportedPolicies),window.from,window.until,query.kind];
  const grouped=this.database.exec({sql:`SELECT sensa_schedule_day(dueAt) AS day,SUM(kind='retention_review') AS retention_review,SUM(kind='relearning') AS relearning FROM (${selected}) GROUP BY day ORDER BY day`,bind,rowMode:'object',returnValue:'resultRows'}) as {day:string;retention_review:number;relearning:number}[];
  const targets=this.database.exec({sql:`SELECT * FROM (${selected}) ORDER BY dueAt,targetId LIMIT ?8 OFFSET ?9`,bind:[...bind,query.limit+1,query.offset],rowMode:'object',returnValue:'resultRows'}) as {targetId:string;dueAt:number;kind:'retention_review'|'relearning'}[];
  const more=targets.length>query.limit;if(more)targets.pop();
  return {clock:query.clock,total:grouped.reduce((sum,row)=>sum+Number(row.retention_review)+Number(row.relearning),0),fromDay:window.fromDay,throughDay:window.throughDay,days:grouped,targets,nextOffset:more?query.offset+targets.length:null};
 }
 management(query:LearningManagementSummaryQuery):LearningManagementStorageSummary{
  const {start,end}=bounds({...query,currentTargetIds:[],retryTargetIds:[]}),context=query.languageContext;
  const rows=query.includeTargetIds===false?[]:this.database.exec({sql:'SELECT DISTINCT target_key,policy_id FROM sensa_runtime_learning_candidate_sources WHERE language_route_id=? AND target_language_tag=? AND support_language_tag=? ORDER BY target_key',bind:[context.languageRouteId,context.targetLanguageTag,context.supportLanguageTag],rowMode:'object',returnValue:'resultRows'}) as {target_key:string;policy_id:string}[];
  const counts=this.database.exec({sql:`SELECT COALESCE(SUM(due_at<=?1),0) AS due,COALESCE(SUM(completed=0 AND started=1),0) AS resumed,COALESCE(SUM(completed=0 AND started=0),0) AS fresh,MIN(CASE WHEN due_at>?1 THEN due_at END) AS next_review,COALESCE(SUM(target_key IN (SELECT value FROM json_each(?6)) AND (due_at<=?1 OR (completed=0 AND started=1))),0) AS current_count FROM
   (SELECT candidate.target_key,candidate.due_at,candidate.completed,candidate.started ${this.qualifiedSources(undefined,1)} GROUP BY candidate.target_key)`,bind:[query.clock,context.languageRouteId,context.targetLanguageTag,context.supportLanguageTag,JSON.stringify(query.supportedPolicies),JSON.stringify(query.currentTargetIds??[])],rowMode:'object',returnValue:'resultRows'}) as {due:number;resumed:number;fresh:number;next_review:number|null;current_count:number}[];
  const totals=query.includeInventory===false?null:this.database.exec({sql:'SELECT COUNT(DISTINCT target_key) AS library,COUNT(DISTINCT CASE WHEN language_route_id=? AND target_language_tag=? AND support_language_tag=? THEN target_key END) AS route FROM sensa_runtime_learning_candidate_sources',bind:[context.languageRouteId,context.targetLanguageTag,context.supportLanguageTag],rowMode:'object',returnValue:'resultRows'}) as {library:number;route:number}[];
  const introduced=this.database.exec({sql:'SELECT COUNT(*) FROM sensa_runtime_learning_introductions WHERE language_route_id=? AND started_at>=? AND started_at<?',bind:[context.languageRouteId,start,end],rowMode:0,returnValue:'resultRows'}) as unknown[];
  return {targetIds:[...new Set(rows.map(row=>row.target_key))],policies:[...new Set(rows.map(row=>row.policy_id))],readyInitialCount:Number(counts[0]!.resumed)+Math.min(Number(counts[0]!.fresh),Math.max(0,(query.dailyLimit??20)-Number(introduced[0]??0))),reviewDueCount:Number(counts[0]!.due),currentCandidateCount:Number(counts[0]!.current_count),routeTargetCount:totals?Number(totals[0]!.route):null,libraryTargetCount:totals?Number(totals[0]!.library):null,nextReviewAt:counts[0]!.next_review===null?null:Number(counts[0]!.next_review)};
 }
}
