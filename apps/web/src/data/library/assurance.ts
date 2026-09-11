/** High-assurance execution adapter. Raw responses are evaluated against pinned resources. */
import {z} from 'zod';
import {computeReviewSchedule,createEmptyReviewableCardScheduleState} from '@sensa/learning-kernel';
import {LearnQueue} from '../../experience/engine/LearnQueue';
import {ReviewQueue,type ReviewRuntimeEffect} from '../../experience/engine/ReviewQueue';
import {bindPackageToRetentionTarget} from '../../experience/engine/types';
import {installLearningRelease,materializeReviewRepairContent,type PrototypeIntroductionPackage} from '../../experience/content/learningCatalog';
import {materializeAssessmentResource,assessmentKindForCapability} from '../../experience/content/assessmentResources';
import {resolveReviewMemoryOutcome,resolveReviewFocusDimension} from '../../experience/review/types';
import type {InstalledPackage} from './packages';
import type {LocalLearningRun,LocalLearningTarget} from './learning';
export type AssuranceState={initialCheckpoint:string;checkpoint:string;mode:'independent'|'first_letter'|'choice';revealed:boolean;feedback:{correct:boolean;answer:string}|null};
export const assuranceActionSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('undo')}).strict(),z.object({kind:z.literal('reveal')}).strict(),z.object({kind:z.literal('continue')}).strict(),
 z.object({kind:z.literal('hint'),mode:z.enum(['first_letter','choice'])}).strict(),
 z.object({kind:z.literal('skip')}).strict(),
 z.object({kind:z.literal('try_recall'),value:z.string().trim().min(1).max(500)}).strict(),
 z.object({kind:z.literal('answer'),value:z.string().trim().min(1).max(500)}).strict(),
]);
export type AssuranceAction={kind:'assurance';response:z.infer<typeof assuranceActionSchema>};
const schedulingPolicy={algorithm:'fsrs-6' as const,desiredRetention:0.9,maximumIntervalDays:36500,learningStepsMinutes:[],relearningStepsMinutes:[],enableFuzz:false};
export function assuranceContent(pack:InstalledPackage,key:string){
 if(!pack.bundle.assurance)throw new Error('localFlow.resourceInvalid');
 const {release,audio}=pack.bundle.assurance;
 const replacements=new Map(release.media.map(m=>['/golden-audio/'+m.sha256.slice(7)+'.mp3',audio[m.mediaKey]]));
 const replace=(v:unknown):any=>typeof v==='string'?(replacements.get(v)??v):Array.isArray(v)?v.map(replace):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x)])):v;
 const template=installLearningRelease(release).getPackage(key);if(!template)throw new Error('localFlow.resourceInvalid');
 return {template:replace(template) as typeof template,release,replace};
}
export function beginAssurance(t:LocalLearningTarget,pack:InstalledPackage,purpose:LocalLearningRun['purpose']):AssuranceState{
 const {template}=assuranceContent(pack,t.assurancePackageKey!);const bound=bindPackageToRetentionTarget(template,t.retentionId);
 const queue=purpose==='initial_learning'?new LearnQueue([bound],{minGap:0}):new ReviewQueue([{package:bound,dueAt:t.memory!.dueAt.getTime(),reps:t.memory!.reps,lapses:t.memory!.lapses,phase:'retaining'}],{},{minGap:0});
 const checkpoint=queue.exportCheckpoint();return {initialCheckpoint:checkpoint,checkpoint,mode:'independent',revealed:false,feedback:null};
}
function queueFor(run:LocalLearningRun,onEffect?:(effect:ReviewRuntimeEffect<PrototypeIntroductionPackage>)=>void){
 if(!run.assurance)throw new Error('localFlow.resourceInvalid');
 return run.purpose==='initial_learning'?LearnQueue.restoreCheckpoint<PrototypeIntroductionPackage>(run.assurance.checkpoint):ReviewQueue.restoreCheckpoint<PrototypeIntroductionPackage>(run.assurance.checkpoint,{onEffect});
}
export function assuranceView(run:LocalLearningRun,pack:InstalledPackage){
 const queue=queueFor(run),session=queue.getCurrentSession();if(!session)return null;
 const {release,replace}=assuranceContent(pack,session.package.packageId);
 const action=session.action,introduction=action.kind==='introduction'||action.intent==='repair';
 const resource=introduction?null:replace(materializeAssessmentResource({packageIdentity:{packageKey:session.package.packageId,senseKey:session.package.senseId},content:session.package.content,taskKey:action.taskKey,kind:assessmentKindForCapability(action.capability!),capability:action.capability!},release)) as ReturnType<typeof materializeAssessmentResource>|null;
 const repair=action.intent==='repair'?materializeReviewRepairContent(session.package.content,action.repairResourceRef,release):null;
 if(action.repairResourceRef?.source==='package_declared'&&!repair)throw new Error('localFlow.resourceInvalid');
 const stepKind=!introduction&&run.assurance!.feedback&&('stepKind' in session||action.stepKind==='review_assessment')?'review_feedback':action.stepKind;
 if(!stepKind)throw new Error('localFlow.resourceInvalid');
 return {content:repair?replace(repair) as PrototypeIntroductionPackage:session.package.content,action,stepKind,introduction,resource,projection:queue.getProjection()};
}
/** The caller commits response, checkpoint, outcome and schedule together in one transaction. */
export function transitionAssurance(t:LocalLearningTarget,run:LocalLearningRun,pack:InstalledPackage,raw:AssuranceAction['response'],at:string){
 const response=assuranceActionSchema.parse(raw),state=run.assurance!,view=assuranceView(run,pack);if(!view)throw new Error('localFlow.stepChanged');
 const effects:unknown[]=[];
 const queue=queueFor(run,effect=>{
  effects.push(effect);
  if(effect.type==='retention_outcome'){
   if(t.memoryRevision!==run.memoryRevision||t.memory?.dueAt.toISOString()!==run.dueAt)throw new Error('localFlow.stepChanged');
   const grade=effect.result.memoryOutcome?.grade;if(!grade)throw new Error('localFlow.resourceInvalid');
   t.memory=computeReviewSchedule({...t.memory!,cardId:t.retentionId},schedulingPolicy,grade==='again'?0:grade==='hard'?1:grade==='easy'?3:2,new Date(at));t.memoryRevision++;t.relearnAt=effect.relearningCycle?at:null;
  }
 });
 if(response.kind==='undo'){
  if(!(queue instanceof LearnQueue)||view.introduction||!queue.undo())throw new Error('localFlow.stepChanged');
  state.feedback=null;state.revealed=false;state.mode='independent';
  effects.push({kind:'undo'});
 }else if(response.kind==='reveal'){
  if(!view.introduction||state.feedback)throw new Error('localFlow.stepChanged');state.revealed=true;
 }else if(response.kind==='hint'){
  if(view.resource?.kind!=='meaning_to_form_recall'||state.feedback||state.mode==='choice')throw new Error('localFlow.stepChanged');state.mode=response.mode;
 }else if(response.kind==='answer'||response.kind==='try_recall'||response.kind==='skip'){
  if(!view.resource||state.feedback)throw new Error('localFlow.stepChanged');const r=view.resource;
  const answer=response.kind==='skip'?'':response.value;
  if(response.kind==='try_recall'&&r.kind!=='meaning_to_form_recall')throw new Error('localFlow.stepChanged');
  const correct=r.kind==='meaning_to_form_recall'?(state.mode==='choice'?r.choiceOptions.some(o=>o.id===answer&&o.isTarget):r.acceptedForms.some(f=>f.trim().toLocaleLowerCase()===answer.toLocaleLowerCase())):r.kind==='novel_context_transfer'?r.scenario.options.some(o=>o.id===answer&&o.isCorrect):r.options.some(o=>o.id===answer&&o.isCorrect);
  if(response.kind==='try_recall'&&!correct&&queue instanceof LearnQueue&&state.mode!=='choice'){
   state.mode=state.mode==='independent'?'first_letter':'choice';
   return [{kind:'recall_scaffold',taskKey:view.action.taskKey,support:state.mode}];
  }
  if(queue instanceof LearnQueue){
   switch(view.action.capability){case 'contextual_recognition':queue.completeRecognition(correct);break;case 'meaning_to_form_recall':queue.completeMeaningToFormRecall(correct?state.mode:'miss');break;case 'novel_context_transfer':queue.completeNovelTransfer(correct?'success':'repair');break;case 'boundary_discrimination':queue.completeBoundary(correct);break;default:throw new Error('localFlow.resourceInvalid');}
  }else{
   const session=queue.getCurrentSession()!;const independent=correct&&state.mode==='independent';
   queue.settle({assessmentId:session.action.taskKey+'.action-assessment',kind:session.assessmentKind,focusDimension:resolveReviewFocusDimension(session.assessmentKind),correct:independent,responseId:answer,memoryOutcome:resolveReviewMemoryOutcome(session.assessmentKind,independent),evidenceEligible:true});
  }
  state.feedback={correct,answer:answer};effects.push({kind:'assessment',taskKey:view.action.taskKey,capability:view.action.capability,correct,support:state.mode});
 }else{
  if(view.introduction){if(!state.revealed)throw new Error('localFlow.stepChanged');if(queue instanceof LearnQueue){queue.settle(true);queue.next();}else{queue.completeRepair();queue.next();}}
  else{if(!state.feedback)throw new Error('localFlow.stepChanged');queue.next();}
  state.feedback=null;state.revealed=false;state.mode='independent';
  if(queue.isDone()){
   run.completedAt=at;run.completionKind=run.purpose==='initial_learning'?'study_completion':'review_completed';
   if(run.purpose==='initial_learning'){if(!(queue instanceof LearnQueue)||!queue.getGraduatedRetentionTargetIds().includes(t.retentionId))throw new Error('localFlow.resourceInvalid');t.completedAt=at;t.memory=computeReviewSchedule(createEmptyReviewableCardScheduleState(t.retentionId),schedulingPolicy,2,new Date(at));t.memoryRevision++;effects.push({kind:'acquisition_graduation',basis:'all_required_gates',schedule:t.memory});}
   t.relearnAt=null;
  }
 }
 state.checkpoint=queue.exportCheckpoint();return effects;
}

/** Restore admission replays raw responses; snapshots cannot manufacture graduation or schedules. */
export function validateAssuranceHistory(target:LocalLearningTarget,pack:InstalledPackage,runs:LocalLearningRun[],events:import('./learning').LearningEvent[]){
 const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 const fail=()=>{throw new Error('libraryBackup.errors.inconsistent');};
 const normalize=(v:any):any=>Array.isArray(v)?v.filter(x=>!(Array.isArray(x)&&x[0]==='startTime')).map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='startTime').map(([k,x])=>[k,normalize(x)])):v;
 const t:LocalLearningTarget={...target,startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null};
 for(const saved of runs){
  const purpose=t.completedAt?'retention_review':'initial_learning';
  if(!saved.assurance||saved.purpose!==purpose||saved.protocolVersion!=='sensa-high-assurance-v1'||saved.memoryRevision!==t.memoryRevision||saved.dueAt!==(t.memory?.dueAt.toISOString()??null)||!Number.isFinite(Date.parse(saved.startedAt))||t.memory&&Date.parse(saved.startedAt)<t.memory.dueAt.getTime())fail();
  const fresh=beginAssurance(t,pack,purpose);
  if(!equal(normalize(JSON.parse(fresh.checkpoint)),normalize(JSON.parse(saved.assurance!.initialCheckpoint))))fail();
  const run:LocalLearningRun={...saved,revision:1,ordinal:1,completedAt:null,completionKind:undefined,assurance:{...fresh,checkpoint:saved.assurance!.initialCheckpoint,initialCheckpoint:saved.assurance!.initialCheckpoint}};
  t.startedAt??=saved.startedAt;
  const list=events.filter(e=>e.runId===run.id).sort((a,b)=>Number((a.detail as any).stepId.split(':').at(-1))-Number((b.detail as any).stepId.split(':').at(-1)));
  for(const e of list){const detail=e.detail as any;if(run.completedAt||e.targetId!==t.id||e.kind!=='assurance'||detail.stepId!==run.id+':'+run.ordinal||detail.action.kind!=='assurance'||!Number.isFinite(Date.parse(e.at))||Date.parse(e.at)<Date.parse(run.startedAt))fail();const effects=transitionAssurance(t,run,pack,detail.action.response,e.at);if(!equal(effects,detail.settlement))fail();run.ordinal++;run.revision++;}
  if(!equal(run,saved))fail();if(!run.completedAt&&runs.at(-1)!==saved)fail();
 }
 for(const key of ['startedAt','completedAt','memory','memoryRevision','relearnAt'] as const)if(!equal(t[key],target[key]))fail();
}
