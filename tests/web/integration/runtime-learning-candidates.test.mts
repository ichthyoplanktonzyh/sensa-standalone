/** Scheduling projection parity/complexity only: synthetic scalar inputs are
 * not generated learning evidence, history, mastery or a browser latency claim. */
import {test,expect,afterAll} from 'vitest';
import type {Database} from '@sqlite.org/sqlite-wasm';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {SqliteRuntimeLearningCandidates,runtimeLearningCandidatesFromRecords,learningManagementSummaryFromRecords,type RuntimeLearningCandidateQuery} from '../../../apps/web/src/data/library/runtimeLearningCandidates';
import {createHomeLearningStorageProjection} from '../../../apps/web/src/data/library/homeLearningRecords';
import type {LocalLearningTarget} from '../../../apps/web/src/learning/runtime/localProtocol';
import {resolveLearningQueue,selectInterleavedLearningTarget} from '../../../apps/web/src/learning/system/learningPlanning';
import {localCurriculumMembershipForContext} from '../../../apps/web/src/learning/runtime/localCurriculum';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});
const database=await useNodeLearningCapacityStorage(),raw=Reflect.get(database,'database') as Database;
afterAll(()=>database.close());
const candidates=new SqliteRuntimeLearningCandidates(raw),context=sensaPinnedLanguageContext(defaultSensaLanguageRoute),clock=Date.parse('2026-09-01T08:00:00Z');
const supportedPolicies=['lightweight','four_stage'],targets:LocalLearningTarget[]=[];
raw.exec("INSERT INTO sensa_records(table_name,record_key,value_json,content_revision) VALUES('packageCache','available','{}',0)");
for(let index=0;index<10_000;index++){
 const id=`target-${String(index).padStart(5,'0')}`,started=index%7!==0,completed=index%5!==0;
 const member={status:'active',languageContext:context,packageKey:index%13===0?'missing':'available',assurancePackageKey:'assurance',material:{snapshot:{validationStatus:index%19===0?'pending':'validated'}}};
 const target={id,curriculumMemberships:[member,{...member,status:'superseded',material:{snapshot:{validationStatus:'pending'}}}],
  policyAssignment:{profileId:index%11===0?'four_stage':index%17===0?'unsupported':'lightweight'},committedPolicy:null,
  planningOverrides:index%23===0?[{kind:'declared_mastery'}]:[],introducedLanguageRouteId:started?context.languageRouteId:null,
  startedAt:started?(index%29===0?'2026-09-01T01:00:00-04:00':'2026-08-01T08:00:00Z'):null,completedAt:completed?'2026-08-02T08:00:00Z':null,
  memory:completed?{dueAt:new Date(clock+(index%3===0?60_000:-60_000))}:null,relearnAt:index%31===0?new Date(clock-5000).toISOString():null,
 } as unknown as LocalLearningTarget;
 targets.push(target);candidates.upsert(id,target);
}
targets[1]!.curriculumMemberships.push({...targets[1]!.curriculumMemberships[0]!,languageContext:{...context,supportLanguageTag:'es'},material:{snapshot:{validationStatus:'validated'}} as any});candidates.upsert(targets[1]!.id,targets[1]!);
const stored=createHomeLearningStorageProjection({targets,availablePackageKeys:['available'],activeRun:null,studyPlans:{},languageRouteId:context.languageRouteId,clock});

test('indexed selection matches the pure queue under scale, quota, retries, exclusions, future changes and pinned language pairs',()=>{
 for(const query of [
  {clock,dailyLimit:20,currentTargetIds:[],retryTargetIds:[]},
  {clock,dailyLimit:500,currentTargetIds:['target-00001','target-00002'],retryTargetIds:['target-09998','target-09800']},
  {clock,dailyLimit:0,currentTargetIds:[],retryTargetIds:['target-09998']},
  {clock:clock+86_400_000,dailyLimit:3,currentTargetIds:['target-00001'],retryTargetIds:[]},
 ].map(input=>({...input,languageContext:context,supportedPolicies}) as RuntimeLearningCandidateQuery)){
  const expected=runtimeLearningCandidatesFromRecords(stored,query),actual=candidates.read(query);
  expect(actual).toEqual(expected);expect(actual.due.length).toBeLessThanOrEqual(1+query.currentTargetIds.length+2*query.retryTargetIds.length);
  expect(candidates.management(query)).toEqual(learningManagementSummaryFromRecords(stored,query));
  expect(actual.initialReady.length).toBeLessThanOrEqual(1+query.currentTargetIds.length+query.retryTargetIds.length);
  const retries=query.retryTargetIds.map((id,index)=>({id,remaining:index}));
  const readiness=Object.fromEntries(stored.targets.map(target=>{const membership=localCurriculumMembershipForContext(target,query.languageContext),policy=target.committedPolicy?.profileId??target.policyAssignment.profileId;return [target.id,membership?.material.snapshot.validationStatus==='validated'&&supportedPolicies.includes(policy)&&(policy==='lightweight'||membership.packageKey==='available'&&!!membership.assurancePackageKey)?'ready':'blocked'];})) as Record<string,'ready'|'blocked'>;
  const complete=resolveLearningQueue({targets:stored.targets,languageRouteId:context.languageRouteId,readiness,clock:query.clock,dailyLimit:query.dailyLimit});
  expect(selectInterleavedLearningTarget({...actual,currentRunTargetIds:query.currentTargetIds,retries})?.id).toBe(selectInterleavedLearningTarget({...complete,currentRunTargetIds:query.currentTargetIds,retries})?.id);
 }
 expect(candidates.read({languageContext:{...context,supportLanguageTag:'fr'},clock,dailyLimit:20,supportedPolicies,currentTargetIds:[],retryTargetIds:[]})).toEqual({due:[],initialReady:[],nextChangeAt:new Date(new Date(clock).setHours(24,0,0,0)).getTime()});
});

test('continuations read scalar indexed rows rather than Target/material JSON, and reopen does not rebuild a valid index',()=>{
 const exec=raw.exec.bind(raw),statements:string[]=[];
 raw.exec=((input:any)=>{const sql=typeof input==='string'?input:input.sql;statements.push(sql);if(/SELECT.*(?:value_json|projection_value_json)/isu.test(sql))throw new Error('candidate query decoded collection payload');return exec(input);}) as typeof raw.exec;
 try{
  candidates.read({languageContext:context,clock,dailyLimit:20,supportedPolicies,currentTargetIds:[],retryTargetIds:[]});
  const changes=raw.changes(true);candidates.initialize();expect(raw.changes(true)).toBe(changes);
  expect(statements.some(sql=>sql.includes('sensa_runtime_learning_candidate_sources'))).toBe(true);
 }finally{raw.exec=exec;}
});
