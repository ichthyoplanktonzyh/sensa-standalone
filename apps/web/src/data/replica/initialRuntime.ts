import {runtimeOperationSchema} from '@sensa/contracts/sensa';
import type {AccountContext,ConsumerRun,ConsumerAction,RuntimeOperation} from '@sensa/contracts/sensa';
import {consumerRunStepId,transitionConsumerRun} from '@sensa/learning-kernel';
import {changeAccountReplica} from './accountStore';
import type {AccountReplica} from './accountStore';
import {clockSessionId,canContinueRun,clockSample} from './clock';
export {clockSessionId,canContinueRun,calibrateRun} from './clock';
export function runProgress(state:AccountReplica,run:ConsumerRun){return state.localRuns[run.id]??{revision:run.revision,ordinal:run.currentStep?.ordinal??0,phase:run.currentStep?.phase??'pending_result'};}
export function queueRuntimeCommand(account:AccountContext,kind:'activity.start_or_resume'|'activity.next'|'activity.pause'|'activity.end',options:{mode?:'mixed'|'review_only';early?:boolean}={}){
 return changeAccountReplica(account,state=>{
  if(!state.plan||!state.replicaId)throw new Error('请先联网完成设置');
  const previous=state.outbox.filter(x=>x.state==='pending'&&x.operation.kind!=='check_in.record').at(-1)?.operation;
  const act=state.activity;
  if(kind==='activity.pause'&&state.outbox.some(x=>x.state==='pending'&&x.operation.kind===kind&&x.operation.payload.activityId===act?.id))return state;
  if(kind==='activity.start_or_resume'||kind==='activity.next'){
   if(!navigator.onLine)throw new Error('请联网开始新的学习');
   if(previous)throw new Error('请先检查本次结果');
  }
  if(kind!=='activity.start_or_resume'&&!act)throw new Error('请返回首页重新读取学习');
  const payload=kind==='activity.start_or_resume'?{mode:options.mode??state.activity?.mode??'mixed',expectedScopeRevision:state.plan.scopeRevision,activityId:act?.status==='ended'?null:act?.id??null,clockSessionId}:kind==='activity.next'?{activityId:act!.id,expectedRevision:act!.revision,mode:act!.mode,allowEarlyRelearning:options.early??false,clockSessionId}:kind==='activity.pause'?{activityId:act!.id,expectedRevision:act!.revision,runId:act!.runId,afterOperationId:previous?.operationId??null}:{activityId:act!.id,expectedRevision:act!.revision};
  const operation=runtimeOperationSchema.parse({operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId:state.installationId,replicaId:state.replicaId,dependsOn:previous?[previous.operationId]:[],kind,payload});
  return {...state,outbox:[...state.outbox,{operation,state:'pending',error:null}]};
 });
}
export function queueRunAction(account:AccountContext,runId:string,action:ConsumerAction){
 return changeAccountReplica(account,state=>{
  const run=state.runs[runId],g=run?.offlineGrant;
  if(!run||!g||!canContinueRun(run))throw new Error('请联网核对时间后继续；已保存的回答仍然保留');
  if(state.outbox.some(x=>x.state==='retained'&&!x.resolved&&x.operation.kind==='run.record_action'&&x.operation.payload.runId===runId))throw new Error('回答与最新进度有冲突，请先检查本次结果');
  if(!state.materials[run.materializationId]||state.materials[run.materializationId]!.digest!==run.materialDigest)throw new Error('请先联网下载学习材料');
  const progress=runProgress(state,run);if(progress.phase==='pending_result'||!run.currentStep&&run.nextEligibleAt)throw new Error('回答已保存，请检查本次结果');
  const phase=transitionConsumerRun(run.protocol.version,progress.phase,action),ordinal=phase==='completed'?progress.ordinal:progress.ordinal+1;
  const previous=state.outbox.filter(x=>x.state==='pending'&&x.operation.kind==='run.record_action'&&x.operation.payload.runId===runId).at(-1)?.operation;
  const sample=clockSample(g);if(!sample)throw new Error('请联网核对时间后继续');const elapsedMs=sample.clock.elapsedMs;
  const operation=runtimeOperationSchema.parse({operationId:crypto.randomUUID(),occurredAt:new Date(Date.parse(g.issuedAt)+elapsedMs).toISOString(),installationId:state.installationId,replicaId:state.replicaId,dependsOn:previous?[previous.operationId]:[],kind:'run.record_action',payload:{runId,expectedRevision:progress.revision,stepId:consumerRunStepId(runId,progress.ordinal,progress.phase,run.protocol.version),ordinal:progress.ordinal,materialDigest:run.materialDigest,grantId:g.id,clock:{sessionId:clockSessionId,elapsedMs},action}});
  return {...state,outbox:[...state.outbox,{operation,state:'pending',error:null}],localRuns:{...state.localRuns,[runId]:{revision:String(BigInt(progress.revision)+1n),ordinal,phase:phase==='completed'||phase==='waiting'?'pending_result':phase}}};
 });
}
export type InitialRuntimeOperation=RuntimeOperation;

export function useLatestRunProgress(account:AccountContext,runId:string){
 return changeAccountReplica(account,state=>{const localRuns={...state.localRuns};delete localRuns[runId];return {...state,localRuns,outbox:state.outbox.map(x=>x.state==='retained'&&x.operation.kind==='run.record_action'&&x.operation.payload.runId===runId?{...x,resolved:true}:x)};});
}
