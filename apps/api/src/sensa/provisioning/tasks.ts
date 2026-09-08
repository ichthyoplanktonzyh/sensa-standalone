import {sensaContentGenerationRequestSchema,sensaMaterialCandidateBundleSchema} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/index.js';
import {ConsumerError} from '../access/auth.js';
import {contentHash,learnerScope} from '../curriculum/targets.js';
import {makeRequest,makeBundle,validateBundle,SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND} from './material.js';
import type {ContentGenerator,ContentReviewer} from './material.js';
type Scope={learner_user_id:string;account_id:string;epoch:string;now:Date};
export async function createTask(db:DatabaseExecutor,a:Scope,member:Record<string,any>,candidate:Record<string,any>){
 const meaning=(await db.query('SELECT * FROM sensa_consumer.personal_meanings WHERE learner_user_id=$1 AND id=$2',[a.learner_user_id,candidate.id])).rows[0];if(!meaning)throw new ConsumerError(409,'alignment_required');
 const plan=(await db.query('SELECT id,revision FROM sensa_consumer.target_plans WHERE membership_id=$1',[member.id])).rows[0]!;
 const fixed={senseId:candidate.sense_id,senseVersionId:candidate.sense_version_id,bindingId:candidate.binding_id,bindingVersionId:candidate.binding_version_id,expression:candidate.expression,meaning:candidate.meaning,expressionKind:meaning.proposal.expression.type==='word'?'word':'phrase',prototype:meaning.proposal.semanticSpec.prototypeScenes[0].summary,planRevision:plan.id+':'+plan.revision,demand:SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND};
 await db.query("INSERT INTO sensa_consumer.provisioning_tasks(id,learner_user_id,learning_target_id,meaning_id,scope_epoch,status,fixed_input,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'pending',$6::jsonb,$7,$7)",[crypto.randomUUID(),a.learner_user_id,member.learning_target_id,meaning.id,a.epoch,JSON.stringify(fixed),a.now]);
}
export async function resetTask(db:DatabaseExecutor,a:Scope,targetId:string,cancel=false){
 const task=(await db.query('SELECT * FROM sensa_consumer.provisioning_tasks WHERE learner_user_id=$1 AND learning_target_id=$2 FOR UPDATE',[a.learner_user_id,targetId])).rows[0];if(!task)throw new ConsumerError(404,'task_not_found');
 if(task.status==='ready'||(!cancel&&!['blocked','cancelled'].includes(task.status)))throw new ConsumerError(409,'retry_not_allowed');if(!cancel&&task.attempt_count>=3)throw new ConsumerError(409,'preparation_budget_exhausted');
 if(task.active_attempt_id)await db.query("UPDATE sensa_consumer.provisioning_attempts SET status='cancelled',reason='cancelled',ended_at=$2 WHERE id=$1 AND ended_at IS NULL",[task.active_attempt_id,a.now]);
 await db.query('UPDATE sensa_consumer.provisioning_tasks SET status=$2,reason=$3,active_attempt_id=NULL,submitted_attempt_id=NULL,revision=revision+1,updated_at=$4 WHERE id=$1',[task.id,cancel?'cancelled':'pending',cancel?'cancelled':null,a.now]);
 await setPlan(db,targetId,cancel?'blocked':'preparing',cancel?'cancelled':null,!cancel||task.attempt_count<3);
}
async function setPlan(db:DatabaseExecutor,targetId:string,state:string,reason:string|null,retry:boolean,materialId:string|null=null){await db.query('UPDATE sensa_consumer.target_plans SET revision=revision+1,readiness=$2,reason=$3,retry_allowed=$4,materialization_id=$5 WHERE membership_id=(SELECT id FROM sensa_consumer.target_memberships WHERE learning_target_id=$1)',[targetId,state,reason,retry,materialId]);}
async function taskRow(db:DatabaseExecutor,a:Scope,targetId:string){const task=(await db.query('SELECT * FROM sensa_consumer.provisioning_tasks WHERE learner_user_id=$1 AND learning_target_id=$2 FOR UPDATE',[a.learner_user_id,targetId])).rows[0];if(!task)throw new ConsumerError(404,'task_not_found');if(String(task.scope_epoch)!==String(a.epoch))throw new ConsumerError(409,'bootstrap_required');return task;}
export async function processTask(input:{withScope:<T>(work:(db:DatabaseExecutor,a:Scope)=>Promise<T>)=>Promise<T>;targetId:string;generate:ContentGenerator;review:ContentReviewer}){
 const {withScope,targetId}=input;
 const claim=await withScope(async(db,a)=>{
  const task=await taskRow(db,a,targetId);
  if(task.active_attempt_id||(task.status==='validating'&&task.submitted_attempt_id)){const attempt=(await db.query('SELECT * FROM sensa_consumer.provisioning_attempts WHERE id=$1',[task.active_attempt_id??task.submitted_attempt_id])).rows[0]!;if(attempt.lease_until<=a.now){await block(db,a,task,attempt.id,'attempt_timed_out');}return null;}
  if(task.status!=='pending')return null;
  if(task.attempt_count>=3){await setPlan(db,targetId,'blocked','preparation_budget_exhausted',false);return null;}
  const id=crypto.randomUUID(),request=await makeRequest(task,id,a.now);
  await db.query("INSERT INTO sensa_consumer.provisioning_attempts(id,task_id,sequence,request,status,lease_until,started_at) VALUES($1,$2,$3,$4::jsonb,'running',$5,$6)",[id,task.id,task.attempt_count+1,JSON.stringify(request),new Date(a.now.getTime()+75000),a.now]);
  await db.query("UPDATE sensa_consumer.provisioning_tasks SET status='generating',active_attempt_id=$2,attempt_count=attempt_count+1,revision=revision+1,updated_at=$3 WHERE id=$1",[task.id,id,a.now]);return {id,request};
 });if(!claim)return;
 let bundle;
 try{const generated=await input.generate(claim.request);bundle=await makeBundle(claim.request,generated,new Date());}
 catch{await withScope(async(db,a)=>{const task=await taskRow(db,a,targetId);if((task.active_attempt_id??task.submitted_attempt_id)===claim.id)await block(db,a,task,claim.id,'generation_failed');});return;}
 const submitted=await withScope(async(db,a)=>{const task=await taskRow(db,a,targetId),attempt=(await db.query('SELECT * FROM sensa_consumer.provisioning_attempts WHERE id=$1',[claim.id])).rows[0]!;if(task.active_attempt_id!==claim.id)return false;if(attempt.lease_until<=a.now){await block(db,a,task,claim.id,'attempt_timed_out');return false;}
 await db.query("UPDATE sensa_consumer.provisioning_attempts SET bundle=$2::jsonb,status='submitted',ended_at=$3 WHERE id=$1",[claim.id,JSON.stringify(bundle),a.now]);await db.query("UPDATE sensa_consumer.provisioning_tasks SET status='validating',active_attempt_id=NULL,submitted_attempt_id=$3,revision=revision+1,updated_at=$2 WHERE id=$1",[task.id,a.now,claim.id]);return true;});if(!submitted)return;
 let review;
 try{review=await input.review(claim.request,bundle.candidates.find(c=>c.materialRoleKey==='experience_recall_cue')!.contentPayload);}catch{await withScope(async(db,a)=>{const task=await taskRow(db,a,targetId);if((task.active_attempt_id??task.submitted_attempt_id)===claim.id)await block(db,a,task,claim.id,'validation_unavailable');});return;}
 await withScope(async(db,a)=>{const task=await taskRow(db,a,targetId),attempt=(await db.query('SELECT * FROM sensa_consumer.provisioning_attempts WHERE id=$1',[claim.id])).rows[0]!;if((task.active_attempt_id??task.submitted_attempt_id)!==claim.id)return;if(attempt.lease_until<=a.now){await block(db,a,task,claim.id,'attempt_timed_out');return;}
 const request=sensaContentGenerationRequestSchema.parse(attempt.request),saved=sensaMaterialCandidateBundleSchema.parse(attempt.bundle);let checked;try{checked=await validateBundle(request,saved,review,a.now);}catch{await block(db,a,task,claim.id,'material_invalid');return;}
 await db.query('UPDATE sensa_consumer.provisioning_attempts SET validation=$2::jsonb WHERE id=$1',[claim.id,JSON.stringify({...checked,content:undefined})]);if(!checked.content){await block(db,a,task,claim.id,'material_rejected');return;}
 const workspace=await learnerScope(db,a),materialId=crypto.randomUUID(),digest=await contentHash(checked.content);
 await db.query("INSERT INTO sensa.learning_materializations(learning_materialization_id,workspace_id,learner_user_id,learning_target_id,protocol_purpose,provisioning_path,content_schema_version,content_payload,content_digest,validation_status,validator_version,provenance) VALUES($1,$2,$3,$4,'initial_learning','on_demand','lightweight-initial-materialization-v1',$5::jsonb,$6,'validated','consumer-independent-content-v1',$7::jsonb)",[materialId,workspace,a.learner_user_id,targetId,JSON.stringify(checked.content),digest,JSON.stringify({taskId:task.id,attemptId:claim.id,bundleId:saved.materialCandidateBundleId,requestDigest:saved.inputSnapshotDigest,demand:request.demandReference,reviewProvider:review.provider,reviewModel:review.model})]);
 await db.query("UPDATE sensa_consumer.provisioning_tasks SET status='ready',materialization_id=$2,active_attempt_id=NULL,reason=NULL,revision=revision+1,updated_at=$3 WHERE id=$1",[task.id,materialId,a.now]);await setPlan(db,targetId,'ready',null,false,materialId);
 });
 async function block(db:DatabaseExecutor,a:Scope,task:Record<string,any>,attemptId:string,reason:string){await db.query("UPDATE sensa_consumer.provisioning_attempts SET status=CASE WHEN ended_at IS NULL THEN $2 ELSE status END,reason=$3,ended_at=COALESCE(ended_at,$4) WHERE id=$1",[attemptId,reason==='attempt_timed_out'?'timed_out':'failed',reason,a.now]);await db.query("UPDATE sensa_consumer.provisioning_tasks SET status='blocked',reason=$2,active_attempt_id=NULL,submitted_attempt_id=NULL,revision=revision+1,updated_at=$3 WHERE id=$1",[task.id,reason,a.now]);await setPlan(db,targetId,'blocked',reason,task.attempt_count<3);}
}
