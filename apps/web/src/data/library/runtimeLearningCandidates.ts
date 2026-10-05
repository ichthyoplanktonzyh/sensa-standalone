import type {Database} from '@sqlite.org/sqlite-wasm';
import type {SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {decodeBackupValue} from './backupCodec';
import type {HomeLearningStorageProjection} from './homeLearningRecords';
import {localCurriculumMembershipForContext} from '../../learning/runtime/localCurriculum';
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
 const readiness=Object.fromEntries(stored.targets.map(target=>{
  const membership=localCurriculumMembershipForContext(target,query.languageContext),policy=target.committedPolicy?.profileId??target.policyAssignment.profileId;
  return [target.id,membership&&membership.material.snapshot.validationStatus==='validated'&&query.supportedPolicies.includes(policy)&&(policy==='lightweight'||!!membership.packageKey&&available.has(membership.packageKey)&&!!membership.assurancePackageKey)?'ready':'blocked'];
 })) as Record<string,'ready'|'blocked'>;
 const input={targets:[...stored.targets].sort((a,b)=>a.id.localeCompare(b.id)),languageRouteId:query.languageContext.languageRouteId,readiness,clock:query.clock,dailyLimit:query.dailyLimit};
 return {input,queue:resolveLearningQueue(input)};
}
export function learningManagementSummaryFromRecords(stored:HomeLearningStorageProjection,query:LearningManagementSummaryQuery):LearningManagementStorageSummary{
 const {queue}=planningQueueFromRecords(stored,query);
 return {targetIds:queue.activeTargets.map(target=>target.id),policies:[...new Set(queue.activeTargets.map(target=>target.committedPolicy?.profileId??target.policyAssignment.profileId))],readyInitialCount:queue.initialReady.length,reviewDueCount:queue.due.length};
}
export function runtimeLearningCandidatesFromRecords(stored:HomeLearningStorageProjection,query:RuntimeLearningCandidateQuery):RuntimeLearningCandidates{
 const {limit}=bounds(query),{input,queue}=planningQueueFromRecords(stored,query),retries=new Set(query.retryTargetIds),candidate=({id,relearnAt}:RuntimeLearningCandidate)=>({id,relearnAt});
 return {due:queue.due.filter((target,index)=>index<limit||retries.has(target.id)).map(candidate),initialReady:queue.initialReady.slice(0,limit).map(candidate),nextChangeAt:nextLearningQueueChangeAt(input,queue)};
}

const schema=`CREATE TABLE IF NOT EXISTS sensa_runtime_learning_candidates(
 language_route_id TEXT NOT NULL,target_language_tag TEXT NOT NULL,support_language_tag TEXT NOT NULL,target_key TEXT NOT NULL,
 policy_id TEXT NOT NULL,validated INTEGER NOT NULL,declared INTEGER NOT NULL,package_key TEXT,assurance_package_key TEXT,
 started INTEGER NOT NULL,completed INTEGER NOT NULL,due_at INTEGER,relearn_at TEXT,
 PRIMARY KEY(language_route_id,target_language_tag,support_language_tag,target_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_runtime_learning_due ON sensa_runtime_learning_candidates(language_route_id,target_language_tag,support_language_tag,due_at,target_key) WHERE declared=0 AND validated=1;
CREATE INDEX IF NOT EXISTS sensa_runtime_learning_initial ON sensa_runtime_learning_candidates(language_route_id,target_language_tag,support_language_tag,started DESC,target_key) WHERE declared=0 AND validated=1 AND completed=0;
CREATE INDEX IF NOT EXISTS sensa_runtime_learning_target ON sensa_runtime_learning_candidates(target_key);
CREATE TABLE IF NOT EXISTS sensa_runtime_learning_introductions(target_key TEXT PRIMARY KEY NOT NULL,language_route_id TEXT NOT NULL,started_at INTEGER NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_runtime_learning_day ON sensa_runtime_learning_introductions(language_route_id,started_at);
CREATE TABLE IF NOT EXISTS sensa_runtime_learning_meta(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL) WITHOUT ROWID;`;
const tableNames=['sensa_runtime_learning_candidates','sensa_runtime_learning_introductions','sensa_runtime_learning_meta'];

/** Device-local scheduling index. Updated atomically with Target facts; neither
 * authoritative learning history nor an eligibility override. No material or
 * Run is decoded when selecting an ordinary continuation. */
export class SqliteRuntimeLearningCandidates {
 constructor(private readonly database:Database,private readonly decodeTarget:(encoded:string)=>LocalLearningTarget=encoded=>decodeBackupValue(JSON.parse(encoded)) as LocalLearningTarget){}
 initialize():void{
  const tables=this.database.exec({sql:"SELECT name FROM sqlite_schema WHERE type='table' AND name IN (SELECT value FROM json_each(?))",bind:[JSON.stringify(tableNames)],rowMode:0,returnValue:'resultRows'}) as unknown[];
  if(tables.length===tableNames.length){
   const version=this.database.exec({sql:"SELECT value FROM sensa_runtime_learning_meta WHERE key='format'",rowMode:0,returnValue:'resultRows'}) as unknown[];
   if(version[0]==='v1'){ensureSqliteSchemaIndexes(this.database,schema);return;}
  }
  this.database.exec(schema);this.clear();
  let after='';
  for(;;){
   const rows=this.database.exec({sql:"SELECT record_key,value_json FROM sensa_records WHERE table_name='learningTargets' AND record_key>? ORDER BY record_key LIMIT 64",bind:[after],rowMode:'object',returnValue:'resultRows'}) as {record_key:string;value_json:string}[];
   for(const row of rows)this.upsert(row.record_key,this.decodeTarget(row.value_json));
   if(rows.length<64)break;after=rows.at(-1)!.record_key;
  }
  this.database.exec("INSERT INTO sensa_runtime_learning_meta(key,value) VALUES('format','v1') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
 }
 clear():void{this.database.exec('DELETE FROM sensa_runtime_learning_candidates');this.database.exec('DELETE FROM sensa_runtime_learning_introductions');}
 delete(targetId:string):void{for(const table of ['sensa_runtime_learning_candidates','sensa_runtime_learning_introductions'])this.database.exec({sql:`DELETE FROM ${table} WHERE target_key=?`,bind:[targetId]});}
 upsert(targetId:string,target:LocalLearningTarget):void{
  this.delete(targetId);
  if(target.introducedLanguageRouteId&&target.startedAt)this.database.exec({sql:'INSERT INTO sensa_runtime_learning_introductions(target_key,language_route_id,started_at) VALUES(?,?,?)',bind:[targetId,target.introducedLanguageRouteId,Date.parse(target.startedAt)]});
  const selected=new Set<string>(),policy=target.committedPolicy?.profileId??target.policyAssignment.profileId;
  for(const membership of [...target.curriculumMemberships].reverse()){
   if(membership.status==='superseded')continue;
   const context=membership.languageContext,key=JSON.stringify([context.languageRouteId,context.targetLanguageTag,context.supportLanguageTag]);
   if(selected.has(key))continue;selected.add(key);
   const due=target.relearnAt?Date.parse(target.relearnAt):target.memory?.dueAt.getTime()??null;
   this.database.exec({sql:'INSERT INTO sensa_runtime_learning_candidates VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',bind:[context.languageRouteId,context.targetLanguageTag,context.supportLanguageTag,targetId,policy,Number(membership.material.snapshot.validationStatus==='validated'),Number(target.planningOverrides.some(override=>override.kind==='declared_mastery')),membership.packageKey,membership.assurancePackageKey??null,Number(!!target.startedAt),Number(!!target.completedAt),due,target.relearnAt]});
  }
 }
 read(query:RuntimeLearningCandidateQuery):RuntimeLearningCandidates{
  const {start,end,limit}=bounds(query),context=query.languageContext;
  const ready=`language_route_id=? AND target_language_tag=? AND support_language_tag=? AND declared=0 AND validated=1
   AND policy_id IN (SELECT value FROM json_each(?))
   AND (policy_id='lightweight' OR (package_key IS NOT NULL AND assurance_package_key IS NOT NULL AND EXISTS(SELECT 1 FROM sensa_records WHERE table_name='packageCache' AND record_key=package_key)))`;
  const parameters=[context.languageRouteId,context.targetLanguageTag,context.supportLanguageTag,JSON.stringify(query.supportedPolicies)];
  const select=(where:string,bind:(string|number)[],suffix:string):RuntimeLearningCandidate[]=>{
   const rows=this.database.exec({sql:`SELECT target_key,relearn_at FROM sensa_runtime_learning_candidates WHERE ${ready} AND ${where} ${suffix}`,bind:[...parameters,...bind],rowMode:'object',returnValue:'resultRows'}) as {target_key:string;relearn_at:string|null}[];
   return rows.map(row=>({id:row.target_key,relearnAt:row.relearn_at}));
  };
  const due=select('due_at<=?',[query.clock],`ORDER BY target_key LIMIT ${limit}`);
  if(query.retryTargetIds.length){const ids=new Set(due.map(target=>target.id));for(const target of select('due_at<=? AND target_key IN (SELECT value FROM json_each(?))',[query.clock,JSON.stringify(query.retryTargetIds)],'ORDER BY target_key'))if(!ids.has(target.id))due.push(target);}
  const introduced=this.database.exec({sql:'SELECT COUNT(*) FROM sensa_runtime_learning_introductions WHERE language_route_id=? AND started_at>=? AND started_at<?',bind:[context.languageRouteId,start,end],rowMode:0,returnValue:'resultRows'}) as unknown[];
  const remaining=Math.max(0,(query.dailyLimit??20)-Number(introduced[0]??0));
  const initialReady=select('completed=0 AND started=1',[],`ORDER BY target_key LIMIT ${limit}`);
  if(initialReady.length<limit&&remaining)initialReady.push(...select('completed=0 AND started=0',[],`ORDER BY target_key LIMIT ${Math.min(remaining,limit-initialReady.length)}`));
  const future=this.database.exec({sql:`SELECT MIN(due_at) FROM sensa_runtime_learning_candidates WHERE ${ready} AND due_at>?`,bind:[...parameters,query.clock],rowMode:0,returnValue:'resultRows'}) as unknown[];
  const next=Number(introduced[0]??0)>0?end:null,futureAt=future[0]===null||future[0]===undefined?null:Number(future[0]);
  return {due,initialReady,nextChangeAt:next===null?futureAt:futureAt===null?next:Math.min(next,futureAt)};
 }
 management(query:LearningManagementSummaryQuery):LearningManagementStorageSummary{
  const {start,end}=bounds({...query,currentTargetIds:[],retryTargetIds:[]}),context=query.languageContext;
  const rows=this.database.exec({sql:'SELECT DISTINCT target_key,policy_id FROM sensa_runtime_learning_candidates WHERE language_route_id=? ORDER BY target_key',bind:[context.languageRouteId],rowMode:'object',returnValue:'resultRows'}) as {target_key:string;policy_id:string}[];
  const ready=`language_route_id=? AND target_language_tag=? AND support_language_tag=? AND declared=0 AND validated=1
   AND policy_id IN (SELECT value FROM json_each(?)) AND (policy_id='lightweight' OR (package_key IS NOT NULL AND assurance_package_key IS NOT NULL AND EXISTS(SELECT 1 FROM sensa_records WHERE table_name='packageCache' AND record_key=package_key)))`;
  const counts=this.database.exec({sql:`SELECT COALESCE(SUM(due_at<=?),0) AS due,COALESCE(SUM(completed=0 AND started=1),0) AS resumed,COALESCE(SUM(completed=0 AND started=0),0) AS fresh FROM sensa_runtime_learning_candidates WHERE ${ready}`,bind:[query.clock,context.languageRouteId,context.targetLanguageTag,context.supportLanguageTag,JSON.stringify(query.supportedPolicies)],rowMode:'object',returnValue:'resultRows'}) as {due:number;resumed:number;fresh:number}[];
  const introduced=this.database.exec({sql:'SELECT COUNT(*) FROM sensa_runtime_learning_introductions WHERE language_route_id=? AND started_at>=? AND started_at<?',bind:[context.languageRouteId,start,end],rowMode:0,returnValue:'resultRows'}) as unknown[];
  return {targetIds:rows.map(row=>row.target_key),policies:[...new Set(rows.map(row=>row.policy_id))],readyInitialCount:Number(counts[0]!.resumed)+Math.min(Number(counts[0]!.fresh),Math.max(0,(query.dailyLimit??20)-Number(introduced[0]??0))),reviewDueCount:Number(counts[0]!.due)};
 }
}
