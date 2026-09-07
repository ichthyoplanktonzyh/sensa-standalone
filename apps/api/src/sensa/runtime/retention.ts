import {computeReviewSchedule,consumerRunStepId} from '@sensa/learning-kernel';
import type {DatabaseExecutor} from '../../database/index.js';
import type {RuntimeScope} from './initial.js';
import {ConsumerError} from '../access/auth.js';
import {learnerScope,materialView} from '../curriculum/targets.js';
export const schedulingPolicy={algorithm:'fsrs-6' as const,desiredRetention:0.9,maximumIntervalDays:36500,learningStepsMinutes:[],relearningStepsMinutes:[],enableFuzz:false};
const intervalMs=10*60*1000;
export async function retentionAvailability(db:DatabaseExecutor,a:RuntimeScope){
 const due=(await db.query(`SELECT m.*,t.learning_target_id FROM sensa_consumer.retention_memory m JOIN sensa_consumer.target_memberships t USING(retention_target_id)
 JOIN sensa.retention_targets rt USING(retention_target_id) LEFT JOIN sensa_consumer.declared_masteries d USING(retention_target_id)
 WHERE m.learner_user_id=$1 AND m.due_at<=$2 AND rt.status='active' AND coalesce(d.active,false)=false
 AND NOT EXISTS(SELECT FROM sensa_consumer.runs r WHERE r.retention_target_id=m.retention_target_id AND r.status='active')
 AND NOT EXISTS(SELECT FROM sensa_consumer.relearning_needs n WHERE n.retention_target_id=m.retention_target_id AND n.status='pending') ORDER BY m.due_at,m.retention_target_id`,[a.learner_user_id,a.now])).rows;
 const needs=(await db.query(`SELECT n.*,t.learning_target_id FROM sensa_consumer.relearning_needs n JOIN sensa_consumer.target_memberships t USING(retention_target_id)
 JOIN sensa.retention_targets rt USING(retention_target_id) LEFT JOIN sensa_consumer.declared_masteries d USING(retention_target_id)
 WHERE n.learner_user_id=$1 AND n.status='pending' AND rt.status='active' AND coalesce(d.active,false)=false ORDER BY n.next_eligible_at,n.id`,[a.learner_user_id])).rows;
 return {due,needs};
}
async function retentionMaterial(db:DatabaseExecutor,a:RuntimeScope,targetId:string,purpose:string){
 const source=(await db.query("SELECT materialization_id FROM sensa_consumer.runs WHERE learning_target_id=$1 AND learner_user_id=$2 AND purpose='initial_learning' AND status='completed'",[targetId,a.learner_user_id])).rows[0];
 if(!source)throw new ConsumerError(409,'material_unavailable');
 const material=await materialView(db,a,source.materialization_id);const workspace=await learnerScope(db,a);const id=crypto.randomUUID();
 // Same validated recall/reveal roles, separately pinned to the retention purpose.
 await db.query(`INSERT INTO sensa.learning_materializations(learning_materialization_id,workspace_id,learner_user_id,learning_target_id,protocol_purpose,provisioning_path,content_schema_version,content_payload,content_digest,validation_status,validator_version,provenance)
 VALUES($1,$2,$3,$4,$5,'published','lightweight-initial-materialization-v1',$6::jsonb,$7,'validated','consumer-retention-reuse-v1',$8::jsonb)`,[id,workspace,a.learner_user_id,targetId,purpose,JSON.stringify(material.content),material.digest,JSON.stringify({sourceMaterializationId:source.materialization_id,purpose,policy:'lightweight-v1'})]);
 return {id,digest:material.digest};
}
export async function selectRetention(db:DatabaseExecutor,a:RuntimeScope,activityId:string,early:boolean){
 const {due,needs}=await retentionAvailability(db,a);
 const need=needs.find(n=>n.next_eligible_at<=a.now)||(early&&!due.length?needs[0]:undefined);
 if(!need&&!due.length)return null;
 if(need?.run_id){
  const row=(await db.query("SELECT * FROM sensa_consumer.runs WHERE id=$1 AND status='active' FOR UPDATE",[need.run_id])).rows[0];
  if(!row)throw new ConsumerError(409,'revision_conflict');
  if(row.phase==='waiting'){
   await db.query("UPDATE sensa_consumer.runs SET phase='recall',revision=revision+1,next_eligible_at=NULL WHERE id=$1",[row.id]);
   await db.query("INSERT INTO sensa_consumer.run_steps(id,run_id,ordinal,phase) VALUES($1,$2,$3,'recall')",[consumerRunStepId(row.id,row.ordinal,'recall',row.protocol_version),row.id,row.ordinal]);
  }
  await db.query('UPDATE sensa_consumer.relearning_needs SET next_eligible_at=LEAST(next_eligible_at,$2) WHERE id=$1',[need.id,a.now]);
  return (await db.query('SELECT * FROM sensa_consumer.runs WHERE id=$1',[row.id])).rows[0];
 }
 const target=need??due[0]!,purpose=need?'relearning':'retention_review',protocol=need?'consumer-relearning-v1':'consumer-review-v1';
 const material=await retentionMaterial(db,a,target.learning_target_id,purpose),id=crypto.randomUUID();
 const row=(await db.query(`INSERT INTO sensa_consumer.runs(id,learner_user_id,learning_target_id,retention_target_id,activity_id,purpose,status,phase,materialization_id,material_digest,protocol_version,started_at,trigger_memory_revision,trigger_due_at,triggering_outcome_id)
 VALUES($1,$2,$3,$4,$5,$6,'active','recall',$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[id,a.learner_user_id,target.learning_target_id,target.retention_target_id,activityId,purpose,material.id,material.digest,protocol,a.now,need?null:target.revision,need?null:target.due_at,need?.triggering_outcome_id??null])).rows[0]!;
 await db.query("INSERT INTO sensa_consumer.run_steps(id,run_id,ordinal,phase) VALUES($1,$2,1,'recall')",[consumerRunStepId(id,1,'recall',protocol),id]);
 if(need)await db.query('UPDATE sensa_consumer.relearning_needs SET run_id=$2,revision=revision+1,next_eligible_at=LEAST(next_eligible_at,$3) WHERE id=$1',[need.id,id,a.now]);
 return row;
}
export async function settleRetention(db:DatabaseExecutor,a:RuntimeScope,run:Record<string,any>,rating:'again'|'hard'|'good',operationId:string,occurred:Date){
 if(run.purpose==='relearning'&&rating==='again'){
  const at=new Date(occurred.getTime()+intervalMs);
  await db.query('UPDATE sensa_consumer.relearning_needs SET next_eligible_at=$2,revision=revision+1 WHERE run_id=$1 AND status=\'pending\'',[run.id,at]);
  await db.query('UPDATE sensa_consumer.runs SET next_eligible_at=$2 WHERE id=$1',[run.id,at]);return;
 }
 const completionId=crypto.randomUUID(),review=run.purpose==='retention_review';
 await db.query('INSERT INTO sensa_consumer.completions(id,run_id,retention_target_id,activity_id,operation_id,kind,evidence_level,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[completionId,run.id,run.retention_target_id,run.activity_id,operationId,review?'review_completed':'relearning_completion',review?'self_report':'non_evidentiary',occurred]);
 if(review){
  const memory=(await db.query('SELECT * FROM sensa_consumer.retention_memory WHERE retention_target_id=$1 FOR UPDATE',[run.retention_target_id])).rows[0]!;
  if(String(memory.revision)!==String(run.trigger_memory_revision)||memory.due_at.getTime()!==run.trigger_due_at.getTime())throw new ConsumerError(409,'stale_due');
  if(occurred<memory.due_at)throw new ConsumerError(409,'clock_untrusted');
  const previous={...memory.schedule,cardId:run.retention_target_id,fsrsLastReviewedAt:new Date(memory.schedule.fsrsLastReviewedAt)};
  const schedule=computeReviewSchedule(previous,schedulingPolicy,rating==='again'?0:rating==='hard'?1:2,occurred),outcomeId=crypto.randomUUID(),decisionId=crypto.randomUUID();
  await db.query("INSERT INTO sensa_consumer.memory_outcomes(id,run_id,retention_target_id,completion_id,memory_revision,due_at,grade,basis,evidence_level,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,'learner_rated','self_report',$8)",[outcomeId,run.id,run.retention_target_id,completionId,memory.revision,memory.due_at,rating,occurred]);
  await db.query("INSERT INTO sensa_consumer.scheduling_decisions(id,outcome_id,policy_version,schedule,decided_at) VALUES($1,$2,'sensa-lightweight-scheduling-v1',$3::jsonb,$4)",[decisionId,outcomeId,JSON.stringify(schedule),a.now]);
  await db.query('UPDATE sensa_consumer.retention_memory SET revision=revision+1,due_at=$2,schedule=$3::jsonb,scheduling_decision_id=$4 WHERE retention_target_id=$1',[run.retention_target_id,schedule.dueAt,JSON.stringify(schedule),decisionId]);
  if(rating==='again'){
   const at=new Date(occurred.getTime()+intervalMs);
   await db.query("INSERT INTO sensa_consumer.relearning_needs(id,learner_user_id,retention_target_id,triggering_outcome_id,status,next_eligible_at) VALUES($1,$2,$3,$4,'pending',$5)",[crypto.randomUUID(),a.learner_user_id,run.retention_target_id,outcomeId,at]);
   await db.query('UPDATE sensa_consumer.runs SET next_eligible_at=$2 WHERE id=$1',[run.id,at]);
  }
 }else await db.query("UPDATE sensa_consumer.relearning_needs SET status='resolved',resolved_at=$2,revision=revision+1 WHERE run_id=$1",[run.id,occurred]);
 await db.query('UPDATE sensa_consumer.target_memberships SET revision=revision+1 WHERE retention_target_id=$1',[run.retention_target_id]);
}
