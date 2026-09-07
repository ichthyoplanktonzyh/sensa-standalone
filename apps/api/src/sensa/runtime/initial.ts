import {retentionAvailability,selectRetention,settleRetention,schedulingPolicy} from './retention.js';
import {consumerActivitySchema,consumerRunSchema,consumerGrantSchema} from '@sensa/contracts/sensa';
import type {ConsumerRun,RuntimeOperation,RuntimeValue,ConsumerActivity} from '@sensa/contracts/sensa';
import {consumerInitialStepId,consumerRunStepId,transitionConsumerRun,computeReviewSchedule,createEmptyReviewableCardScheduleState} from '@sensa/learning-kernel';
import type {DatabaseExecutor} from '../../database/index.js';
import {learnerScope,materialView} from '../curriculum/targets.js';
import {ConsumerError} from '../access/auth.js';
export type RuntimeScope={learner_user_id:string;account_id:string;epoch:string;time_zone:string;now:Date};
export function accountDate(at:Date,zone:string){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);}
export async function startedToday(db:DatabaseExecutor,a:RuntimeScope){return Number((await db.query('SELECT count(*) AS n FROM sensa_consumer.daily_starts WHERE learner_user_id=$1 AND account_date=$2',[a.learner_user_id,accountDate(a.now,a.time_zone)])).rows[0]!.n);}
function activity(row:Record<string,any>):ConsumerActivity{return consumerActivitySchema.parse({id:row.id,revision:String(row.revision),mode:row.mode,status:row.status,runId:row.current_run_id});}
async function getActivity(db:DatabaseExecutor,a:RuntimeScope,id:string){const row=(await db.query('SELECT * FROM sensa_consumer.activities WHERE id=$1 AND learner_user_id=$2 FOR UPDATE',[id,a.learner_user_id])).rows[0];if(!row)throw new ConsumerError(404,'activity_not_found');return row;}
export async function currentActivity(db:DatabaseExecutor,a:RuntimeScope){
 const active=(await db.query("SELECT * FROM sensa_consumer.activities WHERE learner_user_id=$1 AND status='active' LIMIT 1",[a.learner_user_id])).rows[0];if(active)return activity(active);
 const latest=(await db.query("SELECT snapshot FROM sensa_consumer.changes WHERE learner_user_id=$1 AND entity_type='activity' ORDER BY sequence DESC LIMIT 1",[a.learner_user_id])).rows[0];
 return latest?consumerActivitySchema.parse(latest.snapshot):null;
}
export async function runView(db:DatabaseExecutor,a:RuntimeScope,id:string,grantId?:string):Promise<ConsumerRun>{
 const row=(await db.query('SELECT * FROM sensa_consumer.runs WHERE id=$1 AND learner_user_id=$2',[id,a.learner_user_id])).rows[0];if(!row)throw new ConsumerError(404,'run_not_found');
 const completion=(await db.query(`SELECT c.id,c.kind,o.id AS outcome_id,o.grade,h.id AS handoff_id,d.id AS decision_id,(d.schedule->>'dueAt')::timestamptz AS due_at FROM sensa_consumer.completions c LEFT JOIN sensa_consumer.scheduling_handoffs h ON h.completion_id=c.id LEFT JOIN sensa_consumer.memory_outcomes o ON o.completion_id=c.id LEFT JOIN sensa_consumer.scheduling_decisions d ON d.handoff_id=h.id OR d.outcome_id=o.id WHERE c.run_id=$1`,[id])).rows[0];
 const grant=grantId?(await db.query('SELECT * FROM sensa_consumer.offline_grants WHERE id=$1 AND run_id=$2',[grantId,id])).rows[0]:null;
 return consumerRunSchema.parse({id:row.id,revision:String(row.revision),activityId:row.activity_id,learningTargetId:row.learning_target_id,retentionTargetId:row.retention_target_id,purpose:row.purpose,status:row.status,policy:{id:'lightweight',version:'v1'},protocol:{id:row.purpose==='initial_learning'?'lightweight-initial':row.purpose==='retention_review'?'lightweight-review':'lightweight-relearning',version:row.protocol_version},materializationId:row.materialization_id,materialDigest:row.material_digest,currentStep:row.status==='completed'||row.phase==='waiting'?null:{id:consumerRunStepId(id,row.ordinal,row.phase,row.protocol_version),ordinal:row.ordinal,phase:row.phase,allowedActions:row.phase==='recall'?['reveal']:['rate']},nextEligibleAt:row.next_eligible_at?.toISOString()??null,progress:{attemptCount:row.attempt_count,cycleIndex:row.cycle_index},completion:completion?{kind:completion.kind,completionId:completion.id,outcomeId:completion.outcome_id,rating:completion.grade,handoffId:completion.handoff_id,schedulingDecisionId:completion.decision_id,dueAt:completion.due_at?.toISOString()??null}:null,offlineGrant:grant?consumerGrantSchema.parse({id:grant.id,runId:id,learnerUserId:a.learner_user_id,installationId:grant.installation_id,replicaId:grant.replica_id,scopeEpoch:String(grant.scope_epoch),issuedAt:grant.issued_at.toISOString(),expiresAt:grant.expires_at.toISOString(),protocolVersion:grant.protocol_version,materialDigest:grant.material_digest,baseRevision:String(grant.base_revision),allowedActions:['reveal','rate'],clockSessionId:grant.clock_session_id}):null});
}
export async function listRuns(db:DatabaseExecutor,a:RuntimeScope){const rows=(await db.query('SELECT id FROM sensa_consumer.runs WHERE learner_user_id=$1 ORDER BY started_at DESC LIMIT 501',[a.learner_user_id])).rows;if(rows.length>500)throw new ConsumerError(409,'snapshot_limit_exceeded');const result:ConsumerRun[]=[];for(const r of rows)result.push(await runView(db,a,r.id));return result;}
async function issueGrant(db:DatabaseExecutor,a:RuntimeScope,runId:string,op:Extract<RuntimeOperation,{kind:'activity.start_or_resume'|'activity.next'}>){
 const row=(await db.query('SELECT * FROM sensa_consumer.runs WHERE id=$1',[runId])).rows[0]!;const id=crypto.randomUUID();
 await db.query('INSERT INTO sensa_consumer.offline_grants(id,run_id,installation_id,replica_id,scope_epoch,base_revision,material_digest,protocol_version,clock_session_id,issued_at,expires_at,entry_operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,runId,op.installationId,op.replicaId,a.epoch,row.revision,row.material_digest,row.protocol_version,op.payload.clockSessionId,a.now,new Date(a.now.getTime()+7*86400000),op.operationId]);return id;
}
export async function initialAvailability(db:DatabaseExecutor,a:RuntimeScope){
 const rows=(await db.query(`SELECT m.learning_target_id,m.retention_target_id,p.materialization_id,lm.content_digest FROM sensa_consumer.target_memberships m
 JOIN sensa_consumer.target_plans p ON p.membership_id=m.id JOIN sensa.learning_materializations lm ON lm.learning_materialization_id=p.materialization_id
 JOIN sensa.retention_targets rt ON rt.retention_target_id=m.retention_target_id
 LEFT JOIN sensa_consumer.declared_masteries d ON d.retention_target_id=m.retention_target_id
 WHERE m.learner_user_id=$1 AND p.readiness='ready' AND rt.status='active' AND coalesce(d.active,false)=false
 AND NOT EXISTS(SELECT 1 FROM sensa_consumer.runs r WHERE r.retention_target_id=m.retention_target_id) ORDER BY m.id`,[a.learner_user_id])).rows;
 return rows;
}
export async function activitySummary(db:DatabaseExecutor,a:RuntimeScope,act:ConsumerActivity){
 const completed=(await db.query('SELECT retention_target_id,kind FROM sensa_consumer.completions WHERE activity_id=$1',[act.id])).rows;
 const {due,needs}=await retentionAvailability(db,a);const waiting=needs.filter(n=>n.next_eligible_at>a.now);
 const active=(await db.query("SELECT id FROM sensa_consumer.runs WHERE learner_user_id=$1 AND status='active' AND phase<>'waiting' AND ($2='mixed' OR purpose<>'initial_learning')",[a.learner_user_id,act.mode])).rows;
 const initial=act.mode==='mixed'&&(await initialAvailability(db,a)).length>0&&(await startedToday(db,a))<Number((await db.query('SELECT daily_new_limit FROM sensa_consumer.plans WHERE learner_user_id=$1',[a.learner_user_id])).rows[0]!.daily_new_limit);
 const ids=(kind:string)=>[...new Set<string>(completed.filter(r=>r.kind===kind).map(r=>r.retention_target_id))];
 return {activityId:act.id,status:act.status==='ended'?'ended' as const:'active' as const,initialTargetIds:ids('study_completion'),reviewTargetIds:ids('review_completed'),restoredTargetIds:ids('relearning_completion'),needsRecallTargetIds:needs.map(n=>n.retention_target_id),waitingTargetIds:waiting.map(n=>n.retention_target_id),nextEligibleAt:waiting[0]?.next_eligible_at.toISOString()??null,immediateAvailable:!!(initial||due.length||active.length||needs.length>waiting.length)};
}
export async function applyRuntime(db:DatabaseExecutor,a:RuntimeScope,op:RuntimeOperation):Promise<RuntimeValue>{
 await learnerScope(db,a);
 const plan=(await db.query('SELECT * FROM sensa_consumer.plans WHERE learner_user_id=$1 FOR UPDATE',[a.learner_user_id])).rows[0];
 if(!plan)throw new ConsumerError(409,'onboarding_required');
 if(plan.policy_key!=='lightweight-v1')throw new ConsumerError(409,'unsupported_policy');
 if(op.kind==='run.record_action')return recordAction(db,a,op);
 if(op.kind==='activity.pause'||op.kind==='activity.end'){
  const act=await getActivity(db,a,op.payload.activityId);
  if(String(act.revision)!==op.payload.expectedRevision)throw new ConsumerError(409,'revision_conflict');
  if(act.status==='ended')throw new ConsumerError(409,'activity_ended');
  if(op.kind==='activity.pause'){
   if(op.payload.runId!==act.current_run_id)throw new ConsumerError(409,'revision_conflict');
   if(op.payload.afterOperationId&&!op.dependsOn.includes(op.payload.afterOperationId))throw new ConsumerError(400,'missing_dependency');
  }
  const next=(await db.query('UPDATE sensa_consumer.activities SET status=$2,revision=revision+1 WHERE id=$1 RETURNING *',[act.id,op.kind==='activity.pause'?'paused':'ended'])).rows[0]!;
  const view=activity(next);return {activity:view,run:act.current_run_id?await runView(db,a,act.current_run_id):null,reason:null,...(op.kind==='activity.end'?{summary:await activitySummary(db,a,view)}:{})};
 }
 let act:Record<string,any>|undefined;
 if(op.payload.activityId)act=await getActivity(db,a,op.payload.activityId);
 if(op.kind==='activity.next'){
  if(!act||String(act.revision)!==op.payload.expectedRevision||act.mode!==op.payload.mode||act.status!=='active')throw new ConsumerError(409,'revision_conflict');
  if(act.current_run_id&&(await runView(db,a,act.current_run_id)).currentStep)throw new ConsumerError(409,'pending_result');
 }else{
  if(String(plan.scope_revision)!==op.payload.expectedScopeRevision)throw new ConsumerError(409,'revision_conflict');
  if(act?.status==='ended')throw new ConsumerError(409,'activity_ended');
  if(act&&act.mode!==op.payload.mode)act=undefined;
 }
 if(!act){act=(await db.query("SELECT * FROM sensa_consumer.activities WHERE learner_user_id=$1 AND mode=$2 AND status<>'ended' ORDER BY created_at DESC LIMIT 1",[a.learner_user_id,op.payload.mode])).rows[0];}
 await db.query("UPDATE sensa_consumer.activities SET status='paused',revision=revision+1 WHERE learner_user_id=$1 AND status='active' AND ($2::uuid IS NULL OR id<>$2)",[a.learner_user_id,act?.id??null]);
 if(!act)act=(await db.query("INSERT INTO sensa_consumer.activities(id,learner_user_id,mode,status) VALUES($1,$2,$3,'active') RETURNING *",[crypto.randomUUID(),a.learner_user_id,op.payload.mode])).rows[0]!;
 else act=(await db.query("UPDATE sensa_consumer.activities SET status='active',revision=revision+1 WHERE id=$1 RETURNING *",[act.id])).rows[0]!;
 let selected:Record<string,any>|null|undefined=(await db.query("SELECT * FROM sensa_consumer.runs WHERE learner_user_id=$1 AND status='active' AND phase<>'waiting' AND ($2='mixed' OR purpose<>'initial_learning') ORDER BY started_at LIMIT 1 FOR UPDATE",[a.learner_user_id,op.payload.mode])).rows[0];
 const hasNew=op.payload.mode==='mixed'&&(await startedToday(db,a))<plan.daily_new_limit&&(await initialAvailability(db,a)).length>0;
 if(!selected)selected=await selectRetention(db,a,act.id,op.kind==='activity.next'&&op.payload.allowEarlyRelearning&&!hasNew);
 let reason:RuntimeValue['reason']=null;
 if(!selected&&op.payload.mode==='mixed'){
  const available=await initialAvailability(db,a);
  if(available.length&&(await startedToday(db,a))<plan.daily_new_limit){
   const target=available[0]!;await materialView(db,a,target.materialization_id);
   const id=crypto.randomUUID();await db.query("INSERT INTO sensa_consumer.policy_commitments(retention_target_id,policy_id,policy_version,committed_at) VALUES($1,'lightweight','v1',$2)",[target.retention_target_id,a.now]);
   selected=(await db.query(`INSERT INTO sensa_consumer.runs(id,learner_user_id,learning_target_id,retention_target_id,activity_id,purpose,status,phase,materialization_id,material_digest,protocol_version,started_at) VALUES($1,$2,$3,$4,$5,'initial_learning','active','recall',$6,$7,'consumer-initial-v1',$8) RETURNING *`,[id,a.learner_user_id,target.learning_target_id,target.retention_target_id,act.id,target.materialization_id,target.content_digest,a.now])).rows[0]!;
   await db.query("INSERT INTO sensa_consumer.run_steps(id,run_id,ordinal,phase) VALUES($1,$2,1,'recall')",[consumerInitialStepId(id,1,'recall'),id]);
   await db.query('INSERT INTO sensa_consumer.daily_starts(learner_user_id,account_date,retention_target_id,run_id,time_zone) VALUES($1,$2,$3,$4,$5)',[a.learner_user_id,accountDate(a.now,a.time_zone),target.retention_target_id,id,a.time_zone]);
   await db.query('UPDATE sensa_consumer.target_memberships SET revision=revision+1 WHERE retention_target_id=$1',[target.retention_target_id]);
   await db.query('UPDATE sensa_consumer.plans SET revision=revision+1 WHERE learner_user_id=$1',[a.learner_user_id]);
  }else reason=available.length?'daily_limit':'none_due';
 }
 if(selected){
  if(selected.activity_id!==act.id)await db.query('UPDATE sensa_consumer.runs SET activity_id=$2,revision=revision+1 WHERE id=$1',[selected.id,act.id]);
  await db.query('INSERT INTO sensa_consumer.activity_runs(activity_id,run_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[act.id,selected.id]);
  const updated=(await db.query('UPDATE sensa_consumer.activities SET current_run_id=$2 WHERE id=$1 RETURNING *',[act.id,selected.id])).rows[0]!;
  const grant=await issueGrant(db,a,selected.id,op);return {activity:activity(updated),run:await runView(db,a,selected.id,grant),reason:null};
 }
 await db.query('UPDATE sensa_consumer.activities SET current_run_id=NULL WHERE id=$1',[act.id]);act.current_run_id=null;
 if(!reason)reason='none_due';
 if((await retentionAvailability(db,a)).needs.length)reason='waiting_relearning';
 const members=(await db.query('SELECT p.readiness FROM sensa_consumer.target_memberships m JOIN sensa_consumer.target_plans p ON p.membership_id=m.id WHERE m.learner_user_id=$1',[a.learner_user_id])).rows;
 if(op.payload.mode==='mixed'&&reason==='none_due'){if(!members.length)reason='no_targets';else if(members.every(x=>x.readiness!=='ready'))reason=members.some(x=>x.readiness==='preparing')?'preparing':'blocked';}
 return {activity:activity(act),run:null,reason,summary:await activitySummary(db,a,activity(act))};
}
async function recordAction(db:DatabaseExecutor,a:RuntimeScope,op:Extract<RuntimeOperation,{kind:'run.record_action'}>):Promise<RuntimeValue>{
 const p=op.payload;
 const run=(await db.query('SELECT * FROM sensa_consumer.runs WHERE id=$1 AND learner_user_id=$2 FOR UPDATE',[p.runId,a.learner_user_id])).rows[0];if(!run)throw new ConsumerError(404,'run_not_found');
 if(run.status!=='active'||run.phase==='waiting'||String(run.revision)!==p.expectedRevision||run.ordinal!==p.ordinal||consumerRunStepId(run.id,run.ordinal,run.phase,run.protocol_version)!==p.stepId)throw new ConsumerError(409,'stale_step');
 if(run.material_digest!==p.materialDigest)throw new ConsumerError(409,'material_mismatch');
 const grant=(await db.query('SELECT * FROM sensa_consumer.offline_grants WHERE id=$1 FOR UPDATE',[p.grantId])).rows[0];
 if(!grant||grant.run_id!==run.id||grant.installation_id!==op.installationId||grant.replica_id!==op.replicaId||String(grant.scope_epoch)!==String(a.epoch)||grant.protocol_version!==run.protocol_version||grant.material_digest!==p.materialDigest||BigInt(grant.base_revision)>BigInt(p.expectedRevision))throw new ConsumerError(409,'offline_grant_invalid');
 const occurred=new Date(op.occurredAt),calibrated=grant.issued_at.getTime()+p.clock.elapsedMs;
 if(p.clock.sessionId!==grant.clock_session_id||p.clock.elapsedMs<Number(grant.last_elapsed_ms)||Math.abs(occurred.getTime()-calibrated)>5000||occurred<grant.issued_at||(run.last_action_at&&occurred<run.last_action_at)||occurred>grant.expires_at||occurred.getTime()>a.now.getTime()+300000)throw new ConsumerError(409,'clock_untrusted');
 let next:'recall'|'reveal'|'waiting'|'completed';try{next=transitionConsumerRun(run.protocol_version,run.phase,p.action);}catch{throw new ConsumerError(409,'stale_step');}
 const attemptId=crypto.randomUUID();await db.query('INSERT INTO sensa_consumer.run_attempts(id,run_id,step_id,operation_id,grant_id,raw_action,occurred_at,received_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)',[attemptId,run.id,p.stepId,op.operationId,grant.id,JSON.stringify(p.action),occurred,a.now]);
 await db.query('INSERT INTO sensa_consumer.run_transitions(id,attempt_id,run_id,next_phase,protocol_version) VALUES($1,$2,$3,$4,$5)',[crypto.randomUUID(),attemptId,run.id,next,run.protocol_version]);
 await db.query('UPDATE sensa_consumer.offline_grants SET last_elapsed_ms=$2 WHERE id=$1',[grant.id,p.clock.elapsedMs]);
 const ordinal=next==='completed'?run.ordinal:run.ordinal+1;
 if(next!=='completed'&&next!=='waiting')await db.query('INSERT INTO sensa_consumer.run_steps(id,run_id,ordinal,phase) VALUES($1,$2,$3,$4)',[consumerRunStepId(run.id,ordinal,next,run.protocol_version),run.id,ordinal,next]);
 await db.query("UPDATE sensa_consumer.runs SET revision=revision+1,phase=$2,status=$3,ordinal=$4,attempt_count=attempt_count+1,cycle_index=cycle_index+$5,completed_at=$6,last_action_at=$7 WHERE id=$1",[run.id,next,next==='completed'?'completed':'active',ordinal,next==='recall'||next==='waiting'?1:0,next==='completed'?occurred:null,occurred]);
 if(run.purpose!=='initial_learning'&&p.action.kind==='rate')await settleRetention(db,a,run,p.action.rating,op.operationId,occurred);
 if(next==='completed'&&run.purpose==='initial_learning'){
  const completionId=crypto.randomUUID(),handoffId=crypto.randomUUID(),decisionId=crypto.randomUUID();
  const schedule=computeReviewSchedule(createEmptyReviewableCardScheduleState(run.retention_target_id),schedulingPolicy,2,occurred);
  await db.query("INSERT INTO sensa_consumer.completions(id,run_id,retention_target_id,operation_id,kind,evidence_level,completed_at,activity_id) VALUES($1,$2,$3,$4,'study_completion','non_evidentiary',$5,$6)",[completionId,run.id,run.retention_target_id,op.operationId,occurred,run.activity_id]);
  await db.query("INSERT INTO sensa_consumer.scheduling_handoffs(id,retention_target_id,completion_id,basis) VALUES($1,$2,$3,'protocol_completion')",[handoffId,run.retention_target_id,completionId]);
  await db.query("INSERT INTO sensa_consumer.scheduling_decisions(id,handoff_id,policy_version,schedule,decided_at) VALUES($1,$2,'sensa-lightweight-scheduling-v1',$3::jsonb,$4)",[decisionId,handoffId,JSON.stringify(schedule),a.now]);
  await db.query('INSERT INTO sensa_consumer.retention_memory(retention_target_id,learner_user_id,due_at,schedule,scheduling_decision_id) VALUES($1,$2,$3,$4::jsonb,$5)',[run.retention_target_id,a.learner_user_id,schedule.dueAt,JSON.stringify(schedule),decisionId]);
  await db.query('UPDATE sensa_consumer.target_memberships SET revision=revision+1 WHERE retention_target_id=$1',[run.retention_target_id]);
 }
 const act=await getActivity(db,a,run.activity_id);return {activity:activity(act),run:await runView(db,a,run.id,grant.id),reason:next==='waiting'?'waiting_relearning':null,summary:await activitySummary(db,a,activity(act))};
}
