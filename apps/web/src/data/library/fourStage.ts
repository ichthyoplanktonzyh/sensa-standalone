/** Transaction adapter for the existing four-stage queues; no independent progression rules. */
import {z} from 'zod';
import {InterleavedFourStageQueue,InterleavedFourStageReviewQueue} from '../../experience/learningRuntime/interleavedFourStageProtocol';
import {
 createLocalProtocolState,
 readLocalProtocolState,
 resetLocalRunParticipantsForReplay,
 type LocalLearningRun,
 type LocalLearningTarget,
 type LocalProtocolExecution,
 type LocalProtocolAuditEffect,
 type LocalProtocolSettlementIntent,
} from '../../experience/learningRuntime/localProtocol';
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
 const state=z.object({checkpoint:z.string()}).strict().parse(readLocalProtocolState(run,'interleaved_four_stage'));
 return run.purpose==='initial_learning'
  ?InterleavedFourStageQueue.restoreCheckpoint<string>(state.checkpoint)
  :InterleavedFourStageReviewQueue.restoreCheckpoint<string>(state.checkpoint);
}
function initialize(run:LocalLearningRun):FourStageState{
 const ids=run.targetIds;
 const queue=run.purpose==='initial_learning'
  ?new InterleavedFourStageQueue(ids,{minGap:2,protocolRunId:run.id})
  :new InterleavedFourStageReviewQueue(ids.map(targetId=>({targetId,mode:run.purpose==='relearning'?'relearning':'review'} as const)));
 return {checkpoint:queue.exportCheckpoint()};
}
export const fourStageLocalExecution:LocalProtocolExecution={
 cohort:true,
 validate:fourStageContent,
 initialize:(_target,_pack,_purpose,run)=>createLocalProtocolState('interleaved_four_stage',initialize(run)),
 activeTargetId:run=>fourStageQueue(run).getCurrentSession()?.targetId??run.targetId,
 stepId:run=>`${run.id}:${run.ordinal}`,
 replayStart:(_target,_pack,saved)=>{
  const run={...saved,revision:1,ordinal:1,completedAt:null,participants:resetLocalRunParticipantsForReplay(saved),protocolState:createLocalProtocolState('interleaved_four_stage',initialize(saved))};
  delete run.completionKind;run.targetCompletions={};return run;
 },
 unsafeTransition:(target,run,pack,raw,at)=>{
  const {response}=fourStageActionSchema.parse(raw),queue=fourStageQueue(run),session=queue.getCurrentSession();
  if(!session||session.targetId!==target.id||!run.schedulingPolicy)throw new Error('localFlow.stepChanged');
  const effects:LocalProtocolAuditEffect[]=[];
  let settlement:LocalProtocolSettlementIntent|null=null;
  let evaluation:ReturnType<LocalProtocolExecution['unsafeTransition']>['evaluation']=null;
  const complete=(kind:string)=>{run.targetCompletions[target.id]={at,kind};};
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
    queue.settle(satisfied);effects.push({kind:'checkpoint',payload:{checkpointId:current.checkpointId,satisfied}});
    if(queue.getProjection().graduatedTargetIds.includes(target.id)&&!target.completedAt){
     const completion=initialCompletionContractOf(orchestrationRegistry.get(localRunBinding(run).orchestrationId));
     complete(completion.completionKind);settlement={kind:'initial_learning_completion',completion,evidenceIds:[]};effects.push({kind:completion.completionKind,payload:null});
    }
    evaluation={actionIntent:'assessment',observation:{kind:satisfied?'checkpoint_satisfied':'checkpoint_not_satisfied',checkpointId:current.checkpointId,valid:true,result:{response:structuredClone(response),satisfied}},evidenceCandidates:[]};
   }else{
    if(response.kind!=='review')throw new Error('localFlow.stepChanged');
    const result=queue.settle(response.answer)!;
    if(result.memoryOutcome){
     settlement={kind:'memory_outcome',schedulerEligibility:'due_review',evaluationId:`${run.id}:${run.ordinal}:evaluation`,outcome:result.memoryOutcome,relearning:response.answer==='forgotten'?{nextEligibleAt:at,state:null}:null};
     effects.push({kind:'memory_outcome',payload:JSON.parse(JSON.stringify({outcome:result.memoryOutcome}))});
    }
    if(run.purpose==='relearning'){
     settlement=response.answer==='forgotten'
      ?{kind:'relearning_progress',nextEligibleAt:at,state:null}
      :{kind:'relearning_completion',protocolOutcome:'four_stage_relearning_completed',evidenceLevel:'self_report',evidenceIds:[]};
    }
    if(run.purpose==='retention_review')complete('review_completed');
    else if(response.answer!=='forgotten')complete('relearning_completion');
    effects.push({kind:'review_response',payload:{mode:result.mode,answer:response.answer}});
    evaluation={actionIntent:'assessment',observation:{kind:run.purpose==='retention_review'||response.answer!=='forgotten'?'protocol_completed':'practice_completed',checkpointId:null,valid:true,result:{learnerRating:response.answer}},evidenceCandidates:[]};
   }
  }
  run.protocolState.value={checkpoint:queue.exportCheckpoint()};return {protocolEffects:effects,evaluation,settlement};
 },
};
