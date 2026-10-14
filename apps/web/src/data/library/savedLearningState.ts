import {LIGHTWEIGHT_STUDY_PROTOCOL_ID,LIGHTWEIGHT_STUDY_PROTOCOL_VERSION} from '../../learning/runtime/lightweightInitialProtocol';
import {z} from 'zod';
import {localProtocolActiveTargetId,localProtocolStepId,isJsonValue} from '../../learning/runtime/localProtocol';
import {sensaInitialLearningCompletionSchema,sensaSchedulingHandoffSchema,sensaMemoryOutcomeSnapshotSchema,sensaSchedulingDecisionSchema,sensaRelearningCompletionSchema,sensaProtocolCheckpointCreditSchema,sensaProtocolTransitionEffectSchema} from '@sensa/contracts/sensa';
import type {LocalLearningRun} from '../../learning/runtime/localProtocol';
import type {LearningEvent} from './learning';
import {materialSourcePin,sameLearningSourcePin} from '../../learning/runtime/learningIdentity';
import {localExecutionForRun} from '../../learning/runtime/runtimeCoordinator';
import {backupEqual} from './backupCodec';

const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true}),integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),text=z.string().min(1);
const jsonValue=z.custom(isJsonValue),date=z.custom<Date>(value=>value instanceof Date&&Number.isFinite(value.getTime()));
const memory=z.object({dueAt:date,reps:integer,lapses:integer,fsrsCardState:z.enum(['new','learning','review','relearning']),fsrsStepIndex:integer.nullable(),fsrsStability:z.number().positive(),fsrsDifficulty:z.number().min(1).max(10),fsrsLastReviewedAt:date,fsrsScheduledDays:z.number().nonnegative()}).strict();
export const savedRetentionStateSchema=z.object({memory:memory.nullable(),memoryRevision:integer,startedAt:timestamp.nullable(),completedAt:timestamp.nullable(),relearnAt:timestamp.nullable(),relearningState:jsonValue.nullable()}).strict().superRefine((state,ctx)=>{
 if((state.memory!==null)!==(state.memoryRevision>0)||(state.completedAt!==null)!==(state.memory!==null)||state.completedAt&&!state.startedAt||state.relearnAt&&!state.memory||state.relearningState!==null&&!state.relearnAt)ctx.addIssue({code:'custom',message:'Invalid saved retention state'});
});
const progressSchema=z.object({protocolRunId:uuid,protocolId:text,protocolVersion:text,progressEpoch:integer,checkpointCredits:z.record(text,sensaProtocolCheckpointCreditSchema),pendingRepairs:z.record(text,z.object({checkpointId:text,failedActionId:uuid,observationId:uuid}).strict()),reassessmentRequiredCheckpointIds:z.array(text),completed:z.boolean(),appliedDecisions:z.record(text,text)}).strict();
const actionSchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('reveal')}).strict(),z.object({kind:z.literal('rate'),rating:z.enum(['again','hard','good'])}).strict(),z.object({kind:z.literal('assurance'),response:jsonValue}).strict(),z.object({kind:z.literal('protocol'),response:jsonValue}).strict()]);
const effects=z.array(sensaProtocolTransitionEffectSchema);
const factsSchema=z.object({
 step:z.object({protocolStepInstanceId:uuid,protocolRunId:uuid,stepKey:text,ordinal:integer.min(1),purpose:z.enum(['initial_learning','retention_review','relearning']),learningMaterializationIds:z.array(uuid)}).strict(),
 action:z.object({actionId:uuid,protocolStepInstanceId:uuid,protocolRunId:uuid,actionIntent:z.enum(['instruction','practice','assessment','feedback','repair']),kind:z.enum(['reveal','rate','assurance','protocol']),issuedAt:timestamp}).strict(),
 attempt:z.object({attemptId:uuid,actionId:uuid,protocolRunId:uuid,learnerUserId:uuid,learningTargetId:uuid,response:actionSchema,submittedAt:timestamp}).strict(),
 observation:z.object({observationId:uuid,attemptId:uuid,actionId:uuid,protocolRunId:uuid,kind:z.enum(['instruction_completed','practice_completed','checkpoint_satisfied','checkpoint_not_satisfied','repair_completed','protocol_completed']),checkpointId:text.nullable(),valid:z.boolean(),result:jsonValue,evidenceIds:z.array(uuid),observedAt:timestamp}).strict(),
 evidence:z.array(z.object({learningEvidenceId:uuid,observationId:uuid,attemptId:uuid,protocolRunId:uuid,learningTargetId:uuid,basis:text,polarity:z.enum(['positive','negative']),capabilityObjectiveIds:z.array(text),evidenceRuleVersion:text,derivedAt:timestamp}).strict()),
 evaluation:z.object({evaluationId:uuid,observationId:uuid,protocolRunId:uuid,evaluationPolicyId:text,result:jsonValue,evaluatedAt:timestamp}).strict(),
 transitionDecision:z.object({transitionDecisionId:uuid,protocolRunId:uuid,observationId:uuid,progressionPolicyId:text,effects,decidedAt:timestamp}).strict(),
}).strict();
const retentionSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('initial_learning_completion'),completion:sensaInitialLearningCompletionSchema,handoff:sensaSchedulingHandoffSchema,resultingMemoryRevision:integer.min(1),nextDueAt:timestamp}).strict(),
 z.object({kind:z.literal('memory_outcome'),outcome:sensaMemoryOutcomeSnapshotSchema,schedulingDecision:sensaSchedulingDecisionSchema,nextEligibleAt:timestamp.nullable()}).strict(),
 z.object({kind:z.literal('relearning_progress'),nextEligibleAt:timestamp}).strict(),
 z.object({kind:z.literal('relearning_completion'),completion:sensaRelearningCompletionSchema}).strict(),
]);
export function assertSavedLearningEvent(event:LearningEvent,run:LocalLearningRun,learnerId:string,retentionId:string,fail:()=>never){
 uuid.parse(event.id);uuid.parse(event.runId);uuid.parse(event.targetId);timestamp.parse(event.at);integer.min(1).parse(event.detail.runRevision);text.parse(event.detail.stepId);uuid.parse(event.detail.materializationId);
 const action=actionSchema.parse(event.detail.action),facts=factsSchema.nullable().parse(event.detail.formalEvaluation);
 z.object({protocolEffects:z.array(z.object({kind:text,payload:jsonValue}).strict()),retention:retentionSchema.nullable()}).strict().parse(event.detail.transition);
 if(event.runId!==run.id||!run.targetIds.includes(event.targetId)||!run.participants[event.targetId]||event.detail.runRevision>=run.revision||event.kind!==action.kind||Date.parse(event.at)<Date.parse(run.startedAt)||run.completedAt&&Date.parse(event.at)>Date.parse(run.completedAt))fail();
 if(facts){
  const protocolRunId=run.participants[event.targetId]!.protocolRunId;
  if(facts.step.stepKey!==event.detail.stepId||facts.step.purpose!==run.purpose||facts.action.kind!==event.kind||!backupEqual(facts.attempt.response,action)||facts.attempt.learningTargetId!==event.targetId||facts.attempt.learnerUserId!==learnerId||facts.observation.actionId!==facts.action.actionId||facts.transitionDecision.progressionPolicyId!==run.protocolBinding.progressionPolicyId)fail();
  for(const fact of [facts.step,facts.action,facts.attempt,facts.observation,facts.evaluation,facts.transitionDecision])if(fact.protocolRunId!==protocolRunId)fail();
  for(const at of [facts.action.issuedAt,facts.attempt.submittedAt,facts.observation.observedAt,facts.evaluation.evaluatedAt,facts.transitionDecision.decidedAt,...facts.evidence.map(e=>e.derivedAt)])if(at!==event.at)fail();
 }
 const retention=event.detail.transition.retention;
 if(retention){
  const protocolRunId=run.participants[event.targetId]!.protocolRunId;
  if(retention.kind==='initial_learning_completion'){
   const {completion,handoff}=retention;
   if(run.purpose!=='initial_learning'||completion.learnerUserId!==learnerId||completion.learningTargetId!==event.targetId||completion.retentionTargetId!==retentionId||completion.protocolRunId!==protocolRunId||completion.completedAt!==event.at||handoff.learnerUserId!==learnerId||handoff.learningTargetId!==event.targetId||handoff.retentionTargetId!==retentionId||handoff.initialLearningCompletionId!==completion.initialLearningCompletionId||handoff.createdAt!==event.at||handoff.schedulerPolicyVersion!==run.schedulingPolicyId||handoff.profileId!==run.policyProfileId||handoff.profileVersion!==run.policyProfileVersion||handoff.protocolId!==run.protocolBinding.protocolId||handoff.protocolVersion!==run.protocolBinding.protocolVersion||!backupEqual(handoff.learningMaterializationIds,run.participants[event.targetId]!.resolvedPlan.learningMaterializationIds)||handoff.learnerVisibleClaimBoundary!==run.learnerVisibleClaimBoundary||retention.resultingMemoryRevision!==1)fail();
  }else if(retention.kind==='memory_outcome'){
   const {outcome,schedulingDecision:decision}=retention;
   if(outcome.learnerUserId!==learnerId||outcome.retentionTargetId!==retentionId||outcome.protocolRunId!==protocolRunId||outcome.protocolStepId!==event.detail.stepId||outcome.idempotencyKey!==event.id||outcome.occurredAt!==event.at||outcome.origin!==run.purpose||!facts||outcome.evaluationId!==facts.evaluation.evaluationId||decision.retentionTargetId!==retentionId||decision.memoryOutcomeId!==outcome.memoryOutcomeId||decision.priorMemoryRevision!==outcome.priorMemoryRevision||decision.decidedAt!==event.at||decision.schedulerPolicyVersion!==run.schedulingPolicyId||decision.grade!==outcome.grade||!backupEqual(outcome.evidenceIds,facts.evidence.map(e=>e.learningEvidenceId)))fail();
  }else{
   if(run.purpose!=='relearning')fail();
   if(retention.kind==='relearning_completion'){const completion=retention.completion;if(completion.learnerUserId!==learnerId||completion.learningTargetId!==event.targetId||completion.retentionTargetId!==retentionId||completion.protocolRunId!==protocolRunId||completion.completedAt!==event.at)fail();}
  }
 }
}

/** Shape and stored identity checks only. No policy evaluation or scheduler invocation. */
export function assertSavedRunState(run:LocalLearningRun,fail:()=>never){
 uuid.parse(run.id);timestamp.parse(run.startedAt);timestamp.nullable().parse(run.completedAt);integer.min(1).parse(run.ordinal);integer.min(1).parse(run.revision);
 if(run.completedAt&&Date.parse(run.completedAt)<Date.parse(run.startedAt)||run.protocolState?.adapterId!==run.protocolBinding.runtimeAdapterId)fail();
 if(Object.keys(run.targetCompletions).some(id=>!run.targetIds.includes(id)))fail();
 jsonValue.parse(run.protocolState.value);
 if(run.protocolState.adapterId==='lightweight'){
  const state=z.object({phase:z.enum(['recall','reveal']),initial:z.object({protocolRunId:uuid,retentionTargetId:uuid,learningMaterializationId:uuid,materialBindings:z.array(z.object({materialRoleKey:text,learningMaterializationId:uuid,resourceKey:text}).strict()),currentStepDefinitionId:z.enum(['lightweight-study.experience-recall','lightweight-study.expression-reveal']).nullable(),currentStepOrdinal:integer.min(1),eventOrdinal:integer,retryCount:integer,completionRating:z.enum(['again','hard','good']).nullable(),progress:progressSchema,completedSteps:z.array(jsonValue)}).strict().nullable()}).strict().parse(run.protocolState.value);
  if((run.purpose==='initial_learning')!==(state.initial!==null))fail();
  if(state.initial){const p=run.participants[run.targetId]!;if(state.initial.progress.protocolRunId!==state.initial.protocolRunId||state.initial.progress.protocolId!==LIGHTWEIGHT_STUDY_PROTOCOL_ID||state.initial.progress.protocolVersion!==LIGHTWEIGHT_STUDY_PROTOCOL_VERSION||Object.keys(state.initial.progress.checkpointCredits).length||state.initial.protocolRunId!==p.protocolRunId||state.initial.retentionTargetId!==p.resolvedPlan.retentionTargetId||!Object.values(p.materializations).some(material=>material.snapshot.learningMaterializationId===state.initial!.learningMaterializationId))fail();}
 }
 for(const [id,participant] of Object.entries(run.participants)){
  savedRetentionStateSchema.parse(participant.retentionBaseline);integer.parse(participant.memoryRevision);timestamp.nullable().parse(participant.dueAt);
  if(participant.memoryRevision!==participant.retentionBaseline.memoryRevision||participant.dueAt!==(participant.retentionBaseline.memory?.dueAt.toISOString()??null))fail();
  const progress=progressSchema.parse(participant.progress),checkpoints=new Set(run.protocolBinding.checkpointDefinitionIds);
  if(progress.protocolRunId!==participant.protocolRunId||progress.protocolId!==run.protocolBinding.protocolId||progress.protocolVersion!==run.protocolBinding.protocolVersion||!backupEqual(Object.keys(progress.checkpointCredits).sort(),[...checkpoints].sort()))fail();
  if(Object.keys(progress.pendingRepairs).some(key=>!checkpoints.has(key)||progress.pendingRepairs[key]!.checkpointId!==key)||progress.reassessmentRequiredCheckpointIds.some(key=>!checkpoints.has(key))||Object.values(progress.checkpointCredits).some(credit=>credit.creditedInEpoch!==null&&credit.creditedInEpoch>progress.progressEpoch))fail();
  for(const completion of Object.values(run.targetCompletions)){timestamp.parse(completion.at);text.parse(completion.kind);}
  if(run.targetCompletions[id]&&!progress.completed)fail();
 }
}

/** Preserve committed identities and append-only witnesses across snapshots. */
export function assertSavedLearningRecordChange(table:string,before:any,after:any,fail:()=>never,presentationWitnesses:ReadonlySet<string>=new Set(),branchChoice=false):void{
 if(before===undefined)return;if(after===undefined)fail();
 const prefix=(before:readonly unknown[],after:readonly unknown[])=>Array.isArray(after)&&before.length<=after.length&&before.every((value,index)=>backupEqual(value,after[index]));
 const without=(value:any,fields:readonly string[])=>Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));
 if(['learningEvents','learningReconciliations','studyScopes'].includes(table)&&!backupEqual(before,after))fail();
 if(table==='learningTargets'){
  for(const field of ['id','identity','retentionId','expression','targetLanguageTag','createdAt'])if(!backupEqual(before[field],after[field]))fail();
  if(before.startedAt&&!branchChoice&&before.startedAt!==after.startedAt)fail();
  if(before.policyAssignment&&!backupEqual(before.policyAssignment,after.policyAssignment)&&(before.startedAt||after.policyAssignment?.assignmentId!==before.policyAssignment.assignmentId))fail();
  if(Array.isArray(before.curriculumMemberships)){
   const next=new Map(after.curriculumMemberships.map((member:any)=>[member.id,member]));
   for(const previous of before.curriculumMemberships){const current:any=next.get(previous.id);if(!current)fail();if(backupEqual(previous,current))continue;
    if(!backupEqual(without(previous,['revision','status','material','updatedAt']),without(current,['revision','status','material','updatedAt']))||!sameLearningSourcePin(materialSourcePin(previous.material),materialSourcePin(current.material)))fail();
   }
  }
 }

  if(table==='learningRuns'){
   if(!backupEqual(without(before,['participants','targetCompletions','protocolState','ordinal','revision','lifecycleEvents','completedAt','completionKind']),without(after,['participants','targetCompletions','protocolState','ordinal','revision','lifecycleEvents','completedAt','completionKind']))||after.revision<before.revision||after.revision===before.revision&&!backupEqual(before,after)||after.ordinal<before.ordinal||!prefix(before.lifecycleEvents,after.lifecycleEvents))fail();
   for(const [id,value]of Object.entries(before.participants) as Array<[string,any]>){
    const current=after.participants[id];if(!current||!backupEqual(without(value,['materializations','presentedMaterials','presentationOrder','progress','evidenceIds']),without(current,['materializations','presentedMaterials','presentationOrder','progress','evidenceIds']))||!prefix(value.evidenceIds,current.evidenceIds)||!prefix(value.presentationOrder,current.presentationOrder))fail();
    for(const [key,material]of Object.entries(value.materializations))if(!backupEqual(material,current.materializations[key]))fail();
    for(const [step,hash]of Object.entries(current.presentedMaterials))if(!Object.hasOwn(value.presentedMaterials,step)){
     const material=current.materializations[hash as string];
     const refreshed=material&&after.lifecycleEvents.slice(before.lifecycleEvents.length).some((event:any)=>event.kind==='current_step_material_refreshed'&&event.targetId===id&&event.stepId===step&&event.materializationId===material.snapshot.learningMaterializationId);
     if(!presentationWitnesses.has(JSON.stringify([after.id,id,step,hash]))&&!refreshed)fail();
    }
    for(const [step,hash]of Object.entries(value.presentedMaterials))if(current.presentedMaterials[step]!==hash){
     const execution=localExecutionForRun(before),material=current.materializations[current.presentedMaterials[step]];
     if(localProtocolActiveTargetId(execution,before)!==id||localProtocolStepId(execution,before)!==step||!material||!after.lifecycleEvents.slice(before.lifecycleEvents.length).some((event:any)=>event.kind==='current_step_material_refreshed'&&event.targetId===id&&event.stepId===step&&event.materializationId===material.snapshot.learningMaterializationId))fail();
    }
   }
   for(const [key,value]of Object.entries(before.targetCompletions))if(!backupEqual(value,after.targetCompletions[key]))fail();
   if(before.completedAt&&!backupEqual(before,after))fail();
  }
  if(table==='learningSessions'){
   if(!backupEqual(without(before,['revision','runIds','activeRunId','endedAt','endedByOperationId','endReason']),without(after,['revision','runIds','activeRunId','endedAt','endedByOperationId','endReason']))||after.revision<before.revision||after.revision===before.revision&&!backupEqual(before,after)||!prefix(before.runIds,after.runIds)||before.endedAt&&!backupEqual(before,after))fail();
  }
}
