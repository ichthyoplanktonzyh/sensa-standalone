import {
 createLocalProtocolState,
 readLocalProtocolState,
 type LocalLearningRun,
 type LocalLearningResource,
 type LocalExecutableLearningTarget,
 type LocalLearningTarget,
 type LocalProtocolExecution,
 type LocalProtocolAuditEffect,
 type LocalProtocolSettlementIntent,
 type LocalProtocolTransitionIntent,
} from '../runtime/localProtocol';
/** High-assurance execution adapter. Raw responses are evaluated against pinned resources. */
import {z} from 'zod';
import {LearnQueue} from '../engine/LearnQueue';
import {ReviewQueue,type ReviewRuntimeEffect} from '../engine/ReviewQueue';
import {bindPackageToRetentionTarget,type RelearningCycle} from '../engine/types';
import {installLearningRelease,type RuntimeLearningContent} from '../content/learningCatalog';
import {materializeReviewRepairContent} from '../content/reviewRepairContent';
import {materializeAssessmentResource,assessmentKindForCapability} from '../content/assessmentResources';
import {resolveReviewMemoryOutcome,resolveReviewFocusDimension} from '../review/types';
export type AssuranceState={initialCheckpoint:string;checkpoint:string;mode:'independent'|'first_letter'|'choice';revealed:boolean;feedback:{correct:boolean;answer:string}|null};
const auditPayload=(value:unknown):unknown=>JSON.parse(JSON.stringify(value));
export const localAssuranceState=(run:LocalLearningRun)=>readLocalProtocolState<AssuranceState>(run,'structured');
export const assuranceActionSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('undo')}).strict(),z.object({kind:z.literal('reveal')}).strict(),z.object({kind:z.literal('continue')}).strict(),
 z.object({kind:z.literal('hint'),mode:z.enum(['first_letter','choice'])}).strict(),
 z.object({kind:z.literal('skip')}).strict(),
 z.object({kind:z.literal('try_recall'),value:z.string().trim().min(1).max(500)}).strict(),
 z.object({kind:z.literal('answer'),value:z.string().trim().min(1).max(500)}).strict(),
]);
export type AssuranceAction={kind:'assurance';response:z.infer<typeof assuranceActionSchema>};
import {initialCompletionContractOf,orchestrationRegistry} from '../runtime/orchestrations';
import {localRunBinding,localTargetPolicy} from '../runtime/localRuntimeBindings';
import {learningPolicyProfileRegistry} from '../runtime/policyProfiles';
export function assuranceContent(pack:LocalLearningResource,key:string){
 if(!pack.content.assurance)throw new Error('localFlow.resourceInvalid');
 const {release,audio}=pack.content.assurance;
 const replacements=new Map(release.media.map(m=>['/golden-audio/'+m.sha256.slice(7)+'.mp3',audio[m.mediaKey]]));
 const replace=(v:unknown):any=>typeof v==='string'?(replacements.get(v)??v):Array.isArray(v)?v.map(replace):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x)])):v;
 const template=installLearningRelease(release).getPackage(key);if(!template)throw new Error('localFlow.resourceInvalid');
 return {template:replace(template) as typeof template,release,replace};
}
export function beginAssurance(t:LocalExecutableLearningTarget,pack:LocalLearningResource,purpose:LocalLearningRun['purpose'],run?:LocalLearningRun):AssuranceState{
 const {template}=assuranceContent(pack,t.assurancePackageKey!);const bound=bindPackageToRetentionTarget(template,t.retentionId);
 const binding=run?localRunBinding(run):learningPolicyProfileRegistry.get(localTargetPolicy(t)).protocols[purpose];
 const orchestration=orchestrationRegistry.get(binding.orchestrationId);
 if(purpose==='initial_learning'?!orchestration.acquisitionExecution:!orchestration.retentionExecution)throw new Error('localFlow.resourceInvalid');
 const queue=purpose==='initial_learning'
  ?new LearnQueue([bound],{minGap:0},orchestration.acquisitionExecution)
  :new ReviewQueue([purpose==='retention_review'
   ?{package:bound,dueAt:t.memory!.dueAt.getTime(),reps:t.memory!.reps,lapses:t.memory!.lapses,phase:'retaining'}
   :{package:bound,dueAt:t.memory!.dueAt.getTime(),reps:t.memory!.reps,lapses:t.memory!.lapses,phase:'relearning',relearning:relearningCycleFor(t)}],{},{minGap:0},orchestration.retentionExecution);
 const checkpoint=queue.exportCheckpoint();return {initialCheckpoint:checkpoint,checkpoint,mode:'independent',revealed:false,feedback:null};
}
function relearningCycleFor(target:LocalLearningTarget):RelearningCycle{
 const cycle=target.relearningState as RelearningCycle|null;
 if(!cycle||cycle.retentionTargetId!==target.retentionId||cycle.stage!=='repair_pending'&&cycle.stage!=='retest_pending')throw new Error('localFlow.resourceInvalid');
 return structuredClone(cycle);
}
function queueFor(run:LocalLearningRun,onEffect?:(effect:ReviewRuntimeEffect<RuntimeLearningContent>)=>void){
 const state=localAssuranceState(run);
 const orchestration=orchestrationRegistry.get(localRunBinding(run).orchestrationId);
 if(run.purpose==='initial_learning'?!orchestration.acquisitionExecution:!orchestration.retentionExecution)throw new Error('localFlow.resourceInvalid');
 return run.purpose==='initial_learning'?LearnQueue.restoreCheckpoint<RuntimeLearningContent>(state.checkpoint,orchestration.acquisitionExecution):ReviewQueue.restoreCheckpoint<RuntimeLearningContent>(state.checkpoint,{onEffect},orchestration.retentionExecution);
}
export function assuranceView(run:LocalLearningRun,pack:LocalLearningResource){
 const queue=queueFor(run),session=queue.getCurrentSession();if(!session)return null;
 const {release,replace}=assuranceContent(pack,session.package.packageId);
 const action=session.action,introduction=action.kind==='introduction'||action.intent==='repair';
 const resource=introduction?null:replace(materializeAssessmentResource({packageIdentity:{packageKey:session.package.packageId,senseKey:session.package.senseId},content:session.package.content,taskKey:action.taskKey,kind:assessmentKindForCapability(action.capability!),capability:action.capability!},release)) as ReturnType<typeof materializeAssessmentResource>|null;
 const repair=action.intent==='repair'?materializeReviewRepairContent(session.package.content,action.repairResourceRef,release):null;
 if(action.repairResourceRef?.source==='package_declared'&&!repair)throw new Error('localFlow.resourceInvalid');
 const stepKind=!introduction&&localAssuranceState(run).feedback&&('stepKind' in session||action.stepKind==='review_assessment')?'review_feedback':action.stepKind;
 if(!stepKind)throw new Error('localFlow.resourceInvalid');
 return {content:repair?replace(repair) as RuntimeLearningContent:session.package.content,action,stepKind,introduction,resource,projection:queue.getProjection()};
}
/** The caller commits response, checkpoint, outcome and schedule together in one transaction. */
export function transitionAssurance(t:LocalExecutableLearningTarget,run:LocalLearningRun,pack:LocalLearningResource,raw:unknown,at:string):LocalProtocolTransitionIntent{
 const response=assuranceActionSchema.parse(raw),state=localAssuranceState(run),view=assuranceView(run,pack);if(!view)throw new Error('localFlow.stepChanged');
 const effects:LocalProtocolAuditEffect[]=[];
 let settlement:LocalProtocolSettlementIntent|null=null;
 let evaluation:ReturnType<LocalProtocolExecution['unsafeTransition']>['evaluation']=null;
 let sessionCompletion:ReturnType<LocalProtocolExecution['unsafeTransition']>['sessionCompletion']=null;
 const queue=queueFor(run,effect=>{
  effects.push({kind:'review_engine_effect',payload:auditPayload(effect)});
  if(effect.type==='retention_outcome'){
   if(run.purpose!=='retention_review')throw new Error('localFlow.stepChanged');
   const grade=effect.result.memoryOutcome?.grade;if(!grade)throw new Error('localFlow.resourceInvalid');
   const {evidenceIds:_ignoredEvidenceIds,...outcome}=effect.result.memoryOutcome!;
   settlement={kind:'memory_outcome',schedulerEligibility:'due_review',outcome,relearning:effect.relearningCycle?{nextEligibleAt:at,state:effect.relearningCycle}:null};
  }else{
   if(run.purpose!=='relearning')throw new Error('localFlow.stepChanged');
   settlement=effect.event==='retest_passed'
    ?{kind:'relearning_completion',protocolOutcome:'independent_retest_passed',evidenceLevel:'behavioral'}
    :{kind:'relearning_progress',nextEligibleAt:at,state:effect.cycle};
  }
 });
 if(response.kind==='undo'){
  if(!(queue instanceof LearnQueue)||view.introduction||!queue.undo())throw new Error('localFlow.stepChanged');
  state.feedback=null;state.revealed=false;state.mode='independent';
  effects.push({kind:'undo',payload:null});
 }else if(response.kind==='reveal'){
  if(!view.introduction||state.feedback)throw new Error('localFlow.stepChanged');state.revealed=true;
 }else if(response.kind==='hint'){
  if(view.resource?.kind!=='meaning_to_form_recall'||state.feedback||state.mode==='choice')throw new Error('localFlow.stepChanged');state.mode=response.mode;
 }else if(response.kind==='answer'||response.kind==='try_recall'||response.kind==='skip'){
  if(!view.resource||state.feedback)throw new Error('localFlow.stepChanged');const r=view.resource;
  const answer=response.kind==='skip'?'':response.value;
  if(response.kind==='try_recall'&&r.kind!=='meaning_to_form_recall')throw new Error('localFlow.stepChanged');
  const correct=r.kind==='meaning_to_form_recall'?(state.mode==='choice'?r.choiceOptions.some(o=>o.id===answer&&o.isTarget):r.acceptedForms.some(f=>f.trim().toLocaleLowerCase(view.content.accentLocale)===answer.toLocaleLowerCase(view.content.accentLocale))):r.kind==='novel_context_transfer'?r.scenario.options.some(o=>o.id===answer&&o.isCorrect):r.options.some(o=>o.id===answer&&o.isCorrect);
  if(response.kind==='try_recall'&&!correct&&queue instanceof LearnQueue&&state.mode!=='choice'){
   state.mode=state.mode==='independent'?'first_letter':'choice';
   // This response only reveals progressively stronger support. The learner has
   // not submitted the final checkpoint attempt yet, so it cannot create a
   // formal Observation, Evidence, or Progression decision.
   return {protocolEffects:[{kind:'recall_scaffold',payload:{taskKey:view.action.taskKey,support:state.mode}}],evaluation:null,settlement:null,sessionCompletion:null};
  }
  if(queue instanceof LearnQueue){
   queue.settle(correct,correct?state.mode:'miss');
  }else{
   const session=queue.getCurrentSession()!;const independent=correct&&state.mode==='independent';
   queue.settle({assessmentId:session.action.taskKey+'.action-assessment',kind:session.assessmentKind,focusDimension:resolveReviewFocusDimension(session.assessmentKind),correct:independent,responseId:answer,memoryOutcome:resolveReviewMemoryOutcome(session.assessmentKind,independent),evidenceEligible:true});
  }
  state.feedback={correct,answer:answer};effects.push({kind:'assessment',payload:{taskKey:view.action.taskKey,capability:view.action.capability,correct,support:state.mode}});
  const initialCheckpoint=run.purpose==='initial_learning'?`structured-acquisition:${view.action.capability}`:null;
  const independent=state.mode==='independent';
  evaluation={actionIntent:'assessment',observation:{kind:initialCheckpoint?(correct&&independent?'checkpoint_satisfied':'checkpoint_not_satisfied'):settlement?'protocol_completed':'practice_completed',checkpointId:initialCheckpoint,valid:true,result:{correct,responseKind:response.kind,support:state.mode}},evidenceCandidates:independent?[{basis:String(view.action.capability),polarity:correct?'positive':'negative',capabilityObjectiveIds:[String(view.action.capability)]}]:[]};
 }else{
  if(view.introduction){if(!state.revealed)throw new Error('localFlow.stepChanged');if(queue instanceof LearnQueue){queue.settle(true);queue.next();}else{queue.completeRepair();queue.next();}}
  else{if(!state.feedback)throw new Error('localFlow.stepChanged');if(run.purpose!=='retention_review')queue.next();}
  state.feedback=null;state.revealed=false;state.mode='independent';
  if(run.purpose==='retention_review'||queue.isDone()){
   sessionCompletion='complete';
   if(run.purpose==='initial_learning'){
    if(!(queue instanceof LearnQueue)||!queue.getGraduatedRetentionTargetIds().includes(t.retentionId))throw new Error('localFlow.resourceInvalid');
    const completion=initialCompletionContractOf(orchestrationRegistry.get(localRunBinding(run).orchestrationId));
    settlement={kind:'initial_learning_completion',completion};
    effects.push({kind:'acquisition_graduation',payload:{basis:'all_required_gates'}});
   }
  }
 }
 state.checkpoint=queue.exportCheckpoint();run.protocolState.value=state;return {protocolEffects:effects,evaluation,settlement,sessionCompletion};
}

/** Bind the original structured queue to the application's transaction boundary. */
export const assuranceLocalExecution: LocalProtocolExecution = {
 initialize:(target,pack,purpose,run)=>{if(!pack)throw new Error('localFlow.resourceInvalid');return createLocalProtocolState('structured',beginAssurance(target,pack,purpose,run));},
 stepId:run=>run.id+':'+run.ordinal,
 unsafeTransition:(target,run,pack,action,at)=>{
  if(!pack||action.kind!=='assurance')throw new Error('localFlow.stepChanged');
  return transitionAssurance(target,run,pack,action.response,at);
 },
 replayState:(target,pack,saved)=>{
  if(!pack)throw new Error('libraryBackup.errors.inconsistent');
  const savedState=localAssuranceState(saved);
  const fresh=beginAssurance(target,pack,saved.purpose,saved);
  const normalize=(v:any):any=>Array.isArray(v)?v.filter(x=>!(Array.isArray(x)&&x[0]==='startTime')).map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='startTime').map(([k,x])=>[k,normalize(x)])):v;
  if(JSON.stringify(normalize(JSON.parse(fresh.checkpoint)))!==JSON.stringify(normalize(JSON.parse(savedState.initialCheckpoint))))throw new Error('libraryBackup.errors.inconsistent');
  return createLocalProtocolState('structured',{...fresh,checkpoint:savedState.initialCheckpoint,initialCheckpoint:savedState.initialCheckpoint});
 },
};
