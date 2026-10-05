import type {Database} from '@sqlite.org/sqlite-wasm';
import type {SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {canonicalJsonDigest} from '@sensa/learning-kernel';
import {decodeBackupValue} from './backupCodec';
import type {HomeLearningStorageProjection} from './homeLearningRecords';
import {planningMembershipForContext,curriculumSourceEligibility} from '../../learning/runtime/curriculumEligibility';
import type {LocalCurriculumEnrollment} from './curriculumEnrollments';
import type {LocalLearningTarget} from '../../learning/runtime/localProtocol';
import {resolveLearningQueue,nextLearningQueueChangeAt} from '../../learning/system/learningPlanning';
import {ensureSqliteSchemaIndexes} from './sqliteSchemaIndexes';

export interface RuntimeLearningCandidateQuery {
 readonly languageContext:SensaFormalPinnedLanguageContext;
 readonly clock:number;
 readonly dailyLimit:number|undefined;
 readonly supportedPolicies:readonly string[];
 readonly currentTargetIds:readonly string[];
 readonly retryTargetIds:readonly string[];
}
export interface RuntimeLearningCandidate {readonly id:string;readonly relearnAt:string|null;}
export interface RuntimeLearningCandidates {
 readonly due:readonly RuntimeLearningCandidate[];
 readonly initialReady:readonly RuntimeLearningCandidate[];
 readonly nextChangeAt:number|null;
}
export type LearningManagementSummaryQuery=Pick<RuntimeLearningCandidateQuery,'languageContext'|'clock'|'dailyLimit'|'supportedPolicies'>;
export interface LearningManagementStorageSummary{readonly targetIds:readonly string[];readonly policies:readonly string[];readonly readyInitialCount:number;readonly reviewDueCount:number;}
const bounds=(query:RuntimeLearningCandidateQuery)=>{
 if(!Number.isFinite(query.clock))throw new Error('localFlow.clockChanged');
 const start=new Date(query.clock);start.setHours(0,0,0,0);
 const end=new Date(start);end.setDate(end.getDate()+1);
 return {start:start.getTime(),end:end.getTime(),limit:1+new Set([...query.currentTargetIds,...query.retryTargetIds]).size};
};
/** In-memory test adapter uses the same queue oracle. Production returns only
 * a bounded prefix plus exact retry candidates across the Worker boundary. */
function planningQueueFromRecords(stored:HomeLearningStorageProjection,query:LearningManagementSummaryQuery){
 const available=new Set(stored.availablePackageKeys);
 const enrollments=new Map((stored.enrollments??[]).map(enrollment=>[enrollment.id,enrollment]));
 const eligibility:Record<string,{introduce:boolean;ongoing:boolean}>={};
 const readiness=Object.fromEntries(stored.targets.map(target=>{
  const policy=target.committedPolicy?.profileId??target.policyAssignment.profileId;
  const membership=planningMembershipForContext(target,query.languageContext,enrollments,member=>member.material.snapshot.validationStatus==='validated'&&query.supportedPolicies.includes(policy)&&(policy==='lightweight'||!!member.packageKey&&available.has(member.packageKey)&&!!member.assurancePackageKey),stored.sourceEligibility);
  const id=membership?.provenance?.curriculumEnrollmentId;
  eligibility[target.id]=membership?(membership.id&&stored.sourceEligibility?.[membership.id]||curriculumSourceEligibility(membership,typeof id==='string'?enrollments.get(id):undefined,!!target.startedAt)):{introduce:false,ongoing:false};
  return [target.id,membership?'ready':'blocked'];
 })) as Record<string,'ready'|'blocked'>;
 const input={targets:[...stored.targets].sort((a,b)=>a.id.localeCompare(b.id)),languageRouteId:query.languageContext.languageRouteId,readiness,eligibility,clock:query.clock,dailyLimit:query.dailyLimit};
 return {input,queue:resolveLearningQueue(input)};
}
export function learningManagementSummaryFromRecords(stored:HomeLearningStorageProjection,query:LearningManagementSummaryQuery):LearningManagementStorageSummary{
 const {queue}=planningQueueFromRecords(stored,query);
 return {targetIds:stored.targets.map(target=>target.id),policies:[...new Set(stored.targets.map(target=>target.committedPolicy?.profileId??target.policyAssignment.profileId))],readyInitialCount:queue.initialReady.length,reviewDueCount:queue.due.length};
}
export function runtimeLearningCandidatesFromRecords(stored:HomeLearningStorageProjection,query:RuntimeLearningCandidateQuery):RuntimeLearningCandidates{
 const {limit}=bounds(query),{input,queue}=planningQueueFromRecords(stored,query),retries=new Set(query.retryTargetIds),candidate=({id,relearnAt}:RuntimeLearningCandidate)=>({id,relearnAt});
 return {due:queue.due.filter((target,index)=>index<limit||retries.has(target.id)).map(candidate),initialReady:queue.initialReady.slice(0,limit).map(candidate),nextChangeAt:nextLearningQueueChangeAt(input,queue)};
}

const schema=`CREATE TABLE IF NOT EXISTS sensa_runtime_learning_candidate_sources(
 language_route_id TEXT NOT NULL,target_language_tag TEXT NOT NULL,support_language_tag TEXT NOT NULL,target_key TEXT NOT NULL,
 source_key TEXT NOT NULL,source_order INTEGER NOT NULL,enrollment_key TEXT,source_archive_sha256 TEXT,superseded INTEGER NOT NULL,sense_version_id TEXT,binding_version_id TEXT,
 policy_id TEXT NOT NULL,validated INTEGER NOT NULL,declared INTEGER NOT NULL,package_key TEXT,assurance_package_key TEXT,
 started INTEGER NOT NULL,completed INTEGER NOT NULL,due_at INTEGER,relearn_at TEXT,
 PRIMARY KEY(language_route_id,target_language_tag,support_language_tag,target_key,source_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_runtime_source_due ON sensa_runtime_learning_candidate_sources(language_route_id,target_language_tag,support_language_tag,due_at,target_key) WHERE declared=0 AND validated=1;
CREATE INDEX IF NOT EXISTS sensa_runtime_source_initial ON sensa_runtime_learning_candidate_sources(language_route_id,target_language_tag,support_language_tag,started DESC,target_key) WHERE declared=0 AND validated=1 AND completed=0;
CREATE INDEX IF NOT EXISTS sensa_runtime_source_target ON sensa_runtime_learning_candidate_sources(target_key);
CREATE TABLE IF NOT EXISTS sensa_runtime_learning_enrollments(enrollment_key TEXT PRIMARY KEY NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,archive_sha256 TEXT,mode TEXT NOT NULL,whole_range INTEGER NOT NULL,range_revision_id TEXT,range_members_digest TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_runtime_learning_ranges(enrollment_key TEXT NOT NULL,package_key TEXT NOT NULL,sense_version_id TEXT NOT NULL,binding_version_id TEXT NOT NULL,PRIMARY KEY(enrollment_key,package_key,sense_version_id,binding_version_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_runtime_learning_introductions(target_key TEXT PRIMARY KEY NOT NULL,language_route_id TEXT NOT NULL,started_at INTEGER NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_runtime_learning_day ON sensa_runtime_learning_introductions(language_route_id,started_at);
CREATE TABLE IF NOT EXISTS sensa_runtime_learning_meta(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL) WITHOUT ROWID;`;
const tableNames=['sensa_runtime_learning_candidate_sources','sensa_runtime_learning_enrollments','sensa_runtime_learning_ranges','sensa_runtime_learning_introductions','sensa_runtime_learning_meta'];

/** Device-local scheduling index. Updated atomically with Target facts; neither
 * authoritative learning history nor an eligibility override. No material or
 * Run is decoded when selecting an ordinary continuation. */
export class SqliteRuntimeLearningCandidates {
 constructor(private readonly database:Database,private readonly decodeTarget:(encoded:string)=>LocalLearningTarget=encoded=>decodeBackupValue(JSON.parse(encoded)) as LocalLearningTarget,private readonly decodeEnrollment:(encoded:string)=>LocalCurriculumEnrollment=encoded=>decodeBackupValue(JSON.parse(encoded)) as LocalCurriculumEnrollment,private readonly rebuiltTarget?:(id:string,target:LocalLearningTarget)=>void){}
 initialize():void{
  const tables=this.database.exec({sql:"SELECT name FROM sqlite_schema WHERE type='table' AND name IN (SELECT value FROM json_each(?))",bind:[JSON.stringify(tableNames)],rowMode:0,returnValue:'resultRows'}) as unknown[];
  if(tables.length===tableNames.length){
   const version=this.database.exec({sql:"SELECT value FROM sensa_runtime_learning_meta WHERE key='format'",rowMode:0,returnValue:'resultRows'}) as unknown[];
   if(version[0]==='v4'){ensureSqliteSchemaIndexes(this.database,schema);return;}
  }
  // Only these derived scheduling tables are rebuilt; learner facts stay put.
  for(const table of ['sensa_runtime_learning_candidate_sources','sensa_runtime_learning_enrollments','sensa_runtime_learning_ranges'])this.database.exec(`DROP TABLE IF EXISTS ${table}`);
  this.database.exec(schema);this.clear();
  this.database.exec('DELETE FROM sensa_runtime_learning_enrollments');this.database.exec('DELETE FROM sensa_runtime_learning_ranges');
  for(const row of this.database.exec({sql:"SELECT record_key,value_json FROM sensa_records WHERE table_name='curriculumEnrollments'",rowMode:'object',returnValue:'resultRows'}) as {record_key:string;value_json:string}[])this.upsertEnrollment(row.record_key,this.decodeEnrollment(row.value_json));
  let after='';
  for(;;){
   const rows=this.database.exec({sql:"SELECT record_key,value_json FROM sensa_records WHERE table_name='learningTargets' AND record_key>? ORDER BY record_key LIMIT 64",bind:[after],rowMode:'object',returnValue:'resultRows'}) as {record_key:string;value_json:string}[];
   for(const row of rows){const target=this.decodeTarget(row.value_json);this.upsert(row.record_key,target);this.rebuiltTarget?.(row.record_key,target);}
   if(rows.length<64)break;after=rows.at(-1)!.record_key;
  }
  this.database.exec("INSERT INTO sensa_runtime_learning_meta(key,value) VALUES('format','v4') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
 }
 clear():void{this.database.exec('DELETE FROM sensa_runtime_learning_candidate_sources');this.database.exec('DELETE FROM sensa_runtime_learning_introductions');}
 clearEnrollments():void{this.database.exec('DELETE FROM sensa_runtime_learning_enrollments');this.database.exec('DELETE FROM sensa_runtime_learning_ranges');}
 delete(targetId:string):void{for(const table of ['sensa_runtime_learning_candidate_sources','sensa_runtime_learning_introductions'])this.database.exec({sql:`DELETE FROM ${table} WHERE target_key=?`,bind:[targetId]});}
 deleteEnrollment(id:string):void{for(const table of ['sensa_runtime_learning_enrollments','sensa_runtime_learning_ranges'])this.database.exec({sql:`DELETE FROM ${table} WHERE enrollment_key=?`,bind:[id]});}
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
  for(const [index,membership] of target.curriculumMemberships.entries()){
   const context=membership.languageContext;
   const due=target.relearnAt?Date.parse(target.relearnAt):target.memory?.dueAt.getTime()??null;
   this.database.exec({sql:'INSERT INTO sensa_runtime_learning_candidate_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',bind:[context.languageRouteId,context.targetLanguageTag,context.supportLanguageTag,targetId,membership.id??`${targetId}:${index}`,index,typeof membership.provenance?.curriculumEnrollmentId==='string'?membership.provenance.curriculumEnrollmentId:null,typeof membership.provenance?.publicationArchiveSha256==='string'?membership.provenance.publicationArchiveSha256:null,Number(membership.status==='superseded'),membership.material.snapshot.provenance?.senseVersionId as string??membership.provenance?.senseVersionId as string??target.identity?.senseVersionId??null,membership.material.snapshot.provenance?.bindingVersionId as string??membership.provenance?.bindingVersionId as string??target.identity?.bindingVersionId??null,policy,Number(membership.material.snapshot.validationStatus==='validated'),Number(target.planningOverrides.some(override=>override.kind==='declared_mastery')),membership.packageKey,membership.assurancePackageKey??null,Number(!!target.startedAt),Number(!!target.completedAt),due,target.relearnAt]});
  }
 }
 private qualifiedSources():string{
  return `FROM sensa_runtime_learning_candidate_sources AS candidate
   LEFT JOIN sensa_runtime_learning_enrollments AS enrollment ON enrollment.enrollment_key=candidate.enrollment_key
   WHERE candidate.language_route_id=? AND candidate.target_language_tag=? AND candidate.support_language_tag=?
    AND candidate.declared=0 AND candidate.validated=1 AND candidate.policy_id IN (SELECT value FROM json_each(?))
    AND (candidate.policy_id='lightweight' OR (candidate.package_key IS NOT NULL AND candidate.assurance_package_key IS NOT NULL
     AND EXISTS(SELECT 1 FROM sensa_records WHERE table_name='packageCache' AND record_key=candidate.package_key)))
    AND ((candidate.enrollment_key IS NULL AND candidate.superseded=0)
     OR (enrollment.status='active' AND (enrollment.kind<>'published_book' AND candidate.superseded=0
      OR enrollment.kind='published_book' AND enrollment.mode<>'paused' AND (candidate.started=1
       OR enrollment.mode='active' AND candidate.superseded=0 AND candidate.source_archive_sha256=enrollment.archive_sha256
        AND (enrollment.whole_range=1 OR EXISTS(SELECT 1 FROM sensa_runtime_learning_ranges AS selected
         WHERE selected.enrollment_key=enrollment.enrollment_key AND selected.package_key=candidate.package_key
          AND selected.sense_version_id=candidate.sense_version_id AND selected.binding_version_id=candidate.binding_version_id))))))`;
 }
 sourceEligibility(routeId:string):Readonly<Record<string,{introduce:boolean;ongoing:boolean}>>{
  const ordinary=`candidate.enrollment_key IS NULL AND candidate.superseded=0 OR enrollment.status='active' AND enrollment.kind<>'published_book' AND candidate.superseded=0`;
  const book=`enrollment.kind='published_book' AND enrollment.status='active'`;
  const selected=`enrollment.whole_range=1 OR EXISTS(SELECT 1 FROM sensa_runtime_learning_ranges AS selected WHERE selected.enrollment_key=enrollment.enrollment_key AND selected.package_key=candidate.package_key AND selected.sense_version_id=candidate.sense_version_id AND selected.binding_version_id=candidate.binding_version_id)`;
  const rows=this.database.exec({sql:`SELECT candidate.source_key,
   (${ordinary} OR ${book} AND enrollment.mode='active' AND candidate.superseded=0 AND candidate.source_archive_sha256=enrollment.archive_sha256 AND (${selected})) AS introduce,
   (${ordinary} OR ${book} AND enrollment.mode<>'paused' AND candidate.started=1) AS ongoing
   FROM sensa_runtime_learning_candidate_sources AS candidate LEFT JOIN sensa_runtime_learning_enrollments AS enrollment ON enrollment.enrollment_key=candidate.enrollment_key WHERE candidate.language_route_id=?`,bind:[routeId],rowMode:'object',returnValue:'resultRows'}) as {source_key:string;introduce:number|null;ongoing:number|null}[];
  return Object.fromEntries(rows.map(row=>[row.source_key,{introduce:!!row.introduce,ongoing:!!row.ongoing}]));
 }
 read(query:RuntimeLearningCandidateQuery):RuntimeLearningCandidates{
  const {start,end,limit}=bounds(query),context=query.languageContext;
  const qualified=this.qualifiedSources();
  const parameters=[context.languageRouteId,context.targetLanguageTag,context.supportLanguageTag,JSON.stringify(query.supportedPolicies)];
  const select=(where:string,bind:(string|number)[],suffix:string):RuntimeLearningCandidate[]=>{
   const rows=this.database.exec({sql:`SELECT candidate.target_key,candidate.relearn_at ${qualified} AND ${where} GROUP BY candidate.target_key ${suffix}`,bind:[...parameters,...bind],rowMode:'object',returnValue:'resultRows'}) as {target_key:string;relearn_at:string|null}[];
   return rows.map(row=>({id:row.target_key,relearnAt:row.relearn_at}));
  };
  const due=select('due_at<=?',[query.clock],`ORDER BY target_key LIMIT ${limit}`);
  if(query.retryTargetIds.length){const ids=new Set(due.map(target=>target.id));for(const target of select('due_at<=? AND target_key IN (SELECT value FROM json_each(?))',[query.clock,JSON.stringify(query.retryTargetIds)],'ORDER BY target_key'))if(!ids.has(target.id))due.push(target);}
  const introduced=this.database.exec({sql:'SELECT COUNT(*) FROM sensa_runtime_learning_introductions WHERE language_route_id=? AND started_at>=? AND started_at<?',bind:[context.languageRouteId,start,end],rowMode:0,returnValue:'resultRows'}) as unknown[];
  const remaining=Math.max(0,(query.dailyLimit??20)-Number(introduced[0]??0));
  const initialReady=select('completed=0 AND started=1',[],`ORDER BY target_key LIMIT ${limit}`);
  if(initialReady.length<limit&&remaining)initialReady.push(...select('completed=0 AND started=0',[],`ORDER BY target_key LIMIT ${Math.min(remaining,limit-initialReady.length)}`));
  const future=this.database.exec({sql:`SELECT MIN(candidate.due_at) ${qualified} AND candidate.due_at>?`,bind:[...parameters,query.clock],rowMode:0,returnValue:'resultRows'}) as unknown[];
  const next=Number(introduced[0]??0)>0?end:null,futureAt=future[0]===null||future[0]===undefined?null:Number(future[0]);
  return {due,initialReady,nextChangeAt:next===null?futureAt:futureAt===null?next:Math.min(next,futureAt)};
 }
 management(query:LearningManagementSummaryQuery):LearningManagementStorageSummary{
  const {start,end}=bounds({...query,currentTargetIds:[],retryTargetIds:[]}),context=query.languageContext;
  const rows=this.database.exec({sql:'SELECT DISTINCT target_key,policy_id FROM sensa_runtime_learning_candidate_sources WHERE language_route_id=? ORDER BY target_key',bind:[context.languageRouteId],rowMode:'object',returnValue:'resultRows'}) as {target_key:string;policy_id:string}[];
  const counts=this.database.exec({sql:`SELECT COALESCE(SUM(due_at<=?),0) AS due,COALESCE(SUM(completed=0 AND started=1),0) AS resumed,COALESCE(SUM(completed=0 AND started=0),0) AS fresh FROM
   (SELECT candidate.target_key,candidate.due_at,candidate.completed,candidate.started ${this.qualifiedSources()} GROUP BY candidate.target_key)`,bind:[query.clock,context.languageRouteId,context.targetLanguageTag,context.supportLanguageTag,JSON.stringify(query.supportedPolicies)],rowMode:'object',returnValue:'resultRows'}) as {due:number;resumed:number;fresh:number}[];
  const introduced=this.database.exec({sql:'SELECT COUNT(*) FROM sensa_runtime_learning_introductions WHERE language_route_id=? AND started_at>=? AND started_at<?',bind:[context.languageRouteId,start,end],rowMode:0,returnValue:'resultRows'}) as unknown[];
  return {targetIds:rows.map(row=>row.target_key),policies:[...new Set(rows.map(row=>row.policy_id))],readyInitialCount:Number(counts[0]!.resumed)+Math.min(Number(counts[0]!.fresh),Math.max(0,(query.dailyLimit??20)-Number(introduced[0]??0))),reviewDueCount:Number(counts[0]!.due)};
 }
}
