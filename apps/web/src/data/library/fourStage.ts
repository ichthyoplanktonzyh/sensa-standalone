/** Transaction adapter for the existing four-stage queues; no independent progression rules. */
import {z} from 'zod';
import {computeReviewSchedule,createEmptyReviewableCardScheduleState} from '@sensa/learning-kernel';
import {InterleavedFourStageQueue,InterleavedFourStageReviewQueue} from '../../experience/learningRuntime/interleavedFourStageProtocol';
import type {LocalProtocolExecution} from '../../experience/learningRuntime/runtimeCoordinator';
import type {LocalLearningRun,LocalLearningTarget} from './learning';
import type {InstalledPackage} from './packages';
import {assuranceContent} from './assurance';
import {localRunBinding} from '../../experience/learningRuntime/localRuntimeBindings';
import {initialCompletionContractOf,orchestrationRegistry} from '../../experience/learningRuntime/orchestrations';

const responseSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('choice'),optionId:z.string().min(1).max(500)}).strict(),
 z.object({kind:z.literal('self_report'),known:z.boolean()}).strict(),
 z.object({kind:z.literal('continue')}).strict(),
 z.object({kind:z.literal('review'),answer:z.enum(['known','vague','forgotten'])}).strict(),
]);
export const fourStageActionSchema=z.object({kind:z.literal('protocol'),response:responseSchema}).strict();
export type FourStageAction=z.infer<typeof fourStageActionSchema>;
export type FourStageState={checkpoint:string};

export function fourStageContent(target:LocalLearningTarget,pack:InstalledPackage|undefined){
 if(!pack||!target.assurancePackageKey)throw new Error('localFlow.resourceInvalid');
 const content=assuranceContent(pack,target.assurancePackageKey).template.content;
 const options=content.recognitionAssessment.options;
 if(options.length<2||options.filter(o=>o.isCorrect).length!==1||new Set(options.map(o=>o.id)).size!==options.length||!content.pronunciations.some(p=>p.audioUrl))throw new Error('localFlow.resourceInvalid');
 return content;
}
export function fourStageQueue(run:LocalLearningRun){
 const state=z.object({checkpoint:z.string()}).strict().parse(run.protocolState);
 return run.purpose==='initial_learning'
  ?InterleavedFourStageQueue.restoreCheckpoint<string>(state.checkpoint)
  :InterleavedFourStageReviewQueue.restoreCheckpoint<string>(state.checkpoint);
}
function initialize(run:LocalLearningRun):FourStageState{
 const ids=run.targetIds??[run.targetId];
 const queue=run.purpose==='initial_learning'
  ?new InterleavedFourStageQueue(ids,{minGap:2,protocolRunId:run.id})
  :new InterleavedFourStageReviewQueue(ids.map(targetId=>({targetId,mode:run.purpose==='relearning'?'relearning':'review'} as const)));
 return {checkpoint:queue.exportCheckpoint()};
}
export const fourStageLocalExecution:LocalProtocolExecution={
 cohort:true,
 validate:fourStageContent,
 purpose:t=>t.relearnAt?'relearning':t.completedAt?'retention_review':'initial_learning',
 initialize:(_target,_pack,_purpose,run)=>({protocolState:initialize(run)}),
 activeTargetId:run=>fourStageQueue(run).getCurrentSession()?.targetId??run.targetId,
 stepId:run=>`${run.id}:${run.ordinal}`,
 replayStart:(_target,_pack,saved)=>{
  const run={...saved,revision:1,ordinal:1,completedAt:null,protocolState:initialize(saved)};
  delete run.completionKind;delete run.targetCompletions;return run;
 },
 transition:(target,run,pack,raw,at)=>{
  const {response}=fourStageActionSchema.parse(raw),queue=fourStageQueue(run),session=queue.getCurrentSession();
  if(!session||session.targetId!==target.id||!run.schedulingPolicy)throw new Error('localFlow.stepChanged');
  const effects:unknown[]=[];
  const complete=(kind:string)=>{(run.targetCompletions??={})[target.id]={at,kind};};
  if(response.kind==='continue'){
   if(session.phase!=='feedback')throw new Error('localFlow.stepChanged');
   queue.completeFeedback();
   if(!queue.getCurrentSession()&&queue.isDone()){
    run.completedAt=at;
    run.completionKind=run.purpose==='initial_learning'?initialCompletionContractOf(orchestrationRegistry.get(localRunBinding(run).orchestrationId)).completionKind:run.purpose==='retention_review'?'review_completed':'relearning_completion';
   }
  }else{
   if(session.phase!=='assessment')throw new Error('localFlow.stepChanged');
   if(queue instanceof InterleavedFourStageQueue){
    const current=queue.getCurrentSession()!;
    let satisfied:boolean;
    if(current.presentation==='meaning_choice'||current.presentation==='sound_choice'){
     if(response.kind!=='choice')throw new Error('localFlow.stepChanged');
     const option=fourStageContent(target,pack).recognitionAssessment.options.find(o=>o.id===response.optionId);
     if(!option)throw new Error('localFlow.stepChanged');satisfied=option.isCorrect;
    }else{
     if(response.kind!=='self_report')throw new Error('localFlow.stepChanged');satisfied=response.known;
    }
    queue.settle(satisfied);effects.push({kind:'checkpoint',checkpointId:current.checkpointId,satisfied});
    if(queue.getProjection().graduatedTargetIds.includes(target.id)&&!target.completedAt){
     target.completedAt=at;
     target.memory=computeReviewSchedule(createEmptyReviewableCardScheduleState(target.retentionId),run.schedulingPolicy,2,new Date(at));target.memoryRevision++;
     const kind=initialCompletionContractOf(orchestrationRegistry.get(localRunBinding(run).orchestrationId)).completionKind;
     complete(kind);effects.push({kind,schedule:target.memory});
    }
   }else{
    if(response.kind!=='review')throw new Error('localFlow.stepChanged');
    const result=queue.settle(response.answer)!;
    if(result.memoryOutcome){
     const trigger=run.participants?.[target.id]??run;
     if(!target.memory||target.memoryRevision!==trigger.memoryRevision||target.memory.dueAt.toISOString()!==trigger.dueAt||new Date(at)<target.memory.dueAt)throw new Error('localFlow.stepChanged');
     const grade=result.memoryOutcome.grade;
     target.memory=computeReviewSchedule({...target.memory,cardId:target.retentionId},run.schedulingPolicy,grade==='again'?0:grade==='hard'?1:grade==='easy'?3:2,new Date(at));target.memoryRevision++;
     effects.push({kind:'memory_outcome',outcome:result.memoryOutcome,schedule:target.memory});
    }
    target.relearnAt=response.answer==='forgotten'?at:null;
    if(response.answer!=='forgotten')complete(run.purpose==='retention_review'?'review_completed':'relearning_completion');
    effects.push({kind:'review_response',mode:result.mode,answer:response.answer});
   }
  }
  run.protocolState={checkpoint:queue.exportCheckpoint()};return effects;
 },
};
