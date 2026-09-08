import {anchorUseOperationSchema,contentMembershipOperationSchema,personalLearningOperationSchema,semanticAcceptOperationSchema} from '@sensa/contracts/sensa';
import type {PersonalMeaningView} from '@sensa/contracts/sensa';
import {intakeOperationSchema,captureIdentity,canonicalConsumerJson} from '@sensa/contracts/sensa';
import type {CaptureSnapshot,IntakeView} from '@sensa/contracts/sensa';
import { quantityOperationSchema, targetOperationSchema, planViewSchema } from '@sensa/contracts/sensa';
import type { AccountContext, PlanView, ConsumerOperation, QuantityResult, TargetView, CatalogTarget, ConsumerRun, ConsumerActivity, ConsumerSummary, CheckInView, SensaLightweightInitialMaterializationContent } from '@sensa/contracts/sensa';

export type PendingQuantity = {operation:ConsumerOperation; state:'pending'|'retained'; error:string|null;resolved?:boolean};
export type AccountReplica = {meanings:Record<string,PersonalMeaningView>;intakes:Record<string,IntakeView>;accountId:string;installationId:string;replicaId:string|null;scopeEpoch:string;cursor:string|null;plan:PlanView|null;outbox:PendingQuantity[];targets:Record<string,TargetView>;catalog:CatalogTarget[];runs:Record<string,ConsumerRun>;activity:ConsumerActivity|null;localRuns:Record<string,{revision:string;ordinal:number;phase:"recall"|"reveal"|"pending_result"}>;materials:Record<string,{id:string;digest:string;content:SensaLightweightInitialMaterializationContent}>;audio:Record<string,Blob>;summary:ConsumerSummary|null;checkins:Record<string,CheckInView>;runEntries:Record<string,string>;homeCounts:{newAvailable:number;initialContinuations:number;dueReviews:number;relearningReady:number;relearningWaiting:number;distinctExecutableTargets:number}|null};
const connections=new Map<string,Promise<IDBDatabase>>();
function open(accountId:string) {
  let value=connections.get(accountId);
  if(!value) {
    value=new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open(`sensa:consumer:v3:${accountId}`,1);
      request.onupgradeneeded=()=>request.result.createObjectStore('state');
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('请关闭其他旧版本页面后重试'));
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();connections.delete(accountId);};resolve(request.result);};
    }); connections.set(accountId,value);value.catch(()=>connections.delete(accountId));
  } return value;
}
function initial(account:AccountContext):AccountReplica {return {accountId:account.accountId,installationId:account.installationId,replicaId:null,scopeEpoch:'1',cursor:null,plan:account.plan,outbox:[],targets:{},catalog:[],runs:{},activity:null,localRuns:{},materials:{},audio:{},summary:null,homeCounts:null,checkins:{},runEntries:{},intakes:{},meanings:{}};}
/** One IDB transaction owns the read-modify-write; no network or token enters it. */
export async function changeAccountReplica(account:AccountContext,change:(value:AccountReplica)=>AccountReplica):Promise<AccountReplica> {
  const db=await open(account.accountId);
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('state','readwrite');const store=tx.objectStore('state');let next:AccountReplica;
    const get=store.get('current');
    get.onsuccess=()=>{try {next=change({...initial(account),...(get.result as AccountReplica|undefined)});store.put(next,'current');}catch(e){tx.abort();reject(e);}};
    tx.oncomplete=()=>resolve(next!);tx.onerror=()=>reject(tx.error??new Error('本机保存失败'));tx.onabort=()=>reject(tx.error??new Error('本机保存失败'));
  });
}
export function loadAccountReplica(account:AccountContext) { return changeAccountReplica(account,x=>x); }
export function queueQuantity(account:AccountContext,quantity:5|10|15|20|30) {
  return changeAccountReplica(account,state=>{
    if(!state.replicaId)throw new Error('首次设置需要联网完成账号初始化');
    const previous=state.outbox.filter(x=>x.state==='pending'&&(x.operation.kind==='plan.confirm_quantity'||x.operation.kind==='plan.set_quantity')).at(-1)?.operation;
    // Do not invent a server-assigned plan id while initial confirmation is pending.
    if(!state.plan && previous)throw new Error('首次数量已保存在本机，请联网确认后再修改');
    const revision=previous&&(previous.kind==='plan.confirm_quantity'||previous.kind==='plan.set_quantity')?String(BigInt(previous.payload.expectedRevision??'0')+1n):state.plan?.revision??null;
    const common={operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId:state.installationId,replicaId:state.replicaId,dependsOn:previous?[previous.operationId]:[]};
    const operation=quantityOperationSchema.parse(state.plan?{...common,kind:'plan.set_quantity',payload:{planId:state.plan.id,expectedRevision:revision,dailyNewLimit:quantity}}:{...common,kind:'plan.confirm_quantity',payload:{expectedRevision:null,dailyNewLimit:quantity,timeZone:account.timeZone}});
    return {...state,outbox:[...state.outbox,{operation,state:'pending',error:null}]};
  });
}
export function applyQuantityResults(account:AccountContext,results:QuantityResult[]) {
  return changeAccountReplica(account,state=>{
    let meanings=state.meanings;let intakes=state.intakes;let plan=state.plan;let outbox=state.outbox;let targets=state.targets;let runs=state.runs,activity=state.activity,summary=state.summary,checkins=state.checkins,runEntries=state.runEntries;
    for(const result of results) {
      const accepted=result.status==='accepted'||(result.status==='replayed'&&result.original==='accepted');
      if(accepted && 'value' in result && result.value) {
        const next=result.value.plan?planViewSchema.parse(result.value.plan):null;
        if(next&&(!plan||BigInt(next.revision)>=BigInt(plan.revision)))plan=next;
        if('meaning' in result.value)meanings={...meanings,[result.value.meaning.id]:result.value.meaning};
        if('intake' in result.value)intakes={...intakes,[result.value.intake.id]:result.value.intake};
        if('target' in result.value)targets=mergeTargets(targets,[result.value.target]);
        if('checkin' in result.value)checkins={...checkins,[result.value.checkin.date]:result.value.checkin};
        if('runtime' in result.value){const v=result.value.runtime;const op=outbox.find(x=>x.operation.operationId===result.operationId)?.operation;if(v.run&&(op?.kind==='activity.start_or_resume'||op?.kind==='activity.next'))runEntries={...runEntries,[v.run.id]:op.operationId};if(v.summary)summary=v.summary;runs=mergeRuns(runs,v.run?[v.run]:[]);if(!activity||activity.id!==v.activity.id||BigInt(v.activity.revision)>=BigInt(activity.revision))activity=v.activity;}
        outbox=outbox.filter(x=>x.operation.operationId!==result.operationId);
      } else if(result.status!=='retryable') {
        const error='error' in result?result.error?.code??'unknown':'unknown';
        outbox=outbox.map(x=>x.operation.operationId===result.operationId?{...x,state:'retained' as const,error}:x);
      }
    }const localRuns={...state.localRuns};for(const id of Object.keys(localRuns))if(!outbox.some(x=>x.operation.kind==='run.record_action'&&x.operation.payload.runId===id))delete localRuns[id];return {...state,plan,outbox,targets,runs,activity,localRuns,summary,checkins,runEntries,intakes,meanings};
  });
}

export function mergeTargets(current:Record<string,TargetView>,incoming:TargetView[]){
  const next={...current};for(const view of incoming){
    const id=view.learningTarget?.learningTargetId;if(!id)continue;
    const old=next[id];
    if(!old||BigInt(view.membership?.revision??'0')+BigInt(view.plan?.revision??'0')>=BigInt(old.membership?.revision??'0')+BigInt(old.plan?.revision??'0'))next[id]=view;
  }return next;
}
export function queueTarget(account:AccountContext,candidate:CatalogTarget,retry?:TargetView){
  return changeAccountReplica(account,state=>{
    if(!state.replicaId||!state.plan)throw new Error('请先联网确认每日数量');
    const duplicate=state.outbox.some(x=>x.state==='pending'&&((x.operation.kind==='curriculum.add_target'&&x.operation.payload.candidateId===candidate.candidateId)||(x.operation.kind==='learning.retry_preparation'&&x.operation.payload.learningTargetId===retry?.learningTarget?.learningTargetId)));
    if(duplicate)return state;
    const common={operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId:state.installationId,replicaId:state.replicaId,dependsOn:[]};
    const operation=targetOperationSchema.parse(retry?{...common,kind:'learning.retry_preparation',payload:{learningTargetId:retry.learningTarget?.learningTargetId,expectedPlanRevision:retry.plan?.revision}}:{...common,kind:'curriculum.add_target',payload:{planId:state.plan.id,expectedScopeRevision:state.plan.scopeRevision,candidateId:candidate.candidateId,source:candidate.source}});
    return {...state,outbox:[...state.outbox,{operation,state:'pending',error:null}]};
  });
}

export function queueMastery(account:AccountContext,target:TargetView){
 return changeAccountReplica(account,state=>{
  const operation=targetOperationSchema.parse({operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId:state.installationId,replicaId:state.replicaId,dependsOn:[],kind:'declared_mastery.set',payload:{retentionTargetId:target.retentionTarget?.retentionTargetId,expectedRevision:target.declaredMastery.revision,active:!target.declaredMastery.active}});
  return {...state,outbox:[...state.outbox,{operation,state:'pending',error:null}]};
 });
}

export function mergeRuns(current:Record<string,ConsumerRun>,incoming:ConsumerRun[]){
 const result={...current};for(const next of incoming){const old=result[next.id];if(!old||BigInt(next.revision)>=BigInt(old.revision))result[next.id]={...next,offlineGrant:next.offlineGrant??(old?.offlineGrant?.materialDigest===next.materialDigest?old.offlineGrant:null)};}return result;
}

export function queueIntake(account:AccountContext,snapshot:CaptureSnapshot){
 return changeAccountReplica(account,state=>{
  if(!state.replicaId)throw new Error('请先联网初始化账号');
  const identity=canonicalConsumerJson(captureIdentity(snapshot));
  if(state.outbox.some(x=>x.state==='pending'&&x.operation.kind==='intake.save'&&canonicalConsumerJson(captureIdentity(x.operation.payload.snapshot))===identity))return state;
  const operation=intakeOperationSchema.parse({operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId:state.installationId,replicaId:state.replicaId,dependsOn:[],kind:'intake.save',payload:{snapshot}});
  return {...state,outbox:[...state.outbox,{operation,state:'pending',error:null}]};
 });
}

export function queueSemanticAcceptance(account:AccountContext,lookupId:string,intakeId:string|null){return changeAccountReplica(account,state=>{
 if(!state.replicaId)throw new Error('请先联网初始化账号');
 if(state.outbox.some(x=>x.state==='pending'&&x.operation.kind==='semantic.accept'&&x.operation.payload.lookupId===lookupId))return state;
 const operation=semanticAcceptOperationSchema.parse({operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId:state.installationId,replicaId:state.replicaId,dependsOn:[],kind:'semantic.accept',payload:{lookupId,expectedRevision:'1',intakeId,consent:'accept_context_expression_sense'}});
 return {...state,outbox:[...state.outbox,{operation,state:'pending',error:null}]};
});}

export function queuePersonalLearning(account:AccountContext,meaningId:string){return changeAccountReplica(account,state=>{
 if(!state.plan||!state.replicaId)throw new Error('请先设置每日学习数量');
 if(state.outbox.some(x=>x.state==='pending'&&x.operation.kind==='personal.add_to_learning'&&x.operation.payload.meaningId===meaningId))return state;
 const operation=personalLearningOperationSchema.parse({operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId:state.installationId,replicaId:state.replicaId,dependsOn:[],kind:'personal.add_to_learning',payload:{meaningId,expectedRevision:state.meanings[meaningId]?.revision,planId:state.plan.id,expectedScopeRevision:state.plan.scopeRevision}});
 return {...state,outbox:[...state.outbox,{operation,state:'pending',error:null}]};
});}
export function queueCancelPreparation(account:AccountContext,target:TargetView){return changeAccountReplica(account,state=>{const operation=targetOperationSchema.parse({operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId:state.installationId,replicaId:state.replicaId,dependsOn:[],kind:'learning.cancel_preparation',payload:{learningTargetId:target.learningTarget?.learningTargetId,expectedPlanRevision:target.plan?.revision}});return {...state,outbox:[...state.outbox,{operation,state:'pending',error:null}]};});}

export function queueContentMembership(account:AccountContext,entity:'intake'|'meaning',id:string,active:boolean){return changeAccountReplica(account,state=>{
 const item=entity==='meaning'?state.meanings[id]:state.intakes[id];if(!item||!state.replicaId)throw new Error('请先同步内容');
 if(state.outbox.some(x=>x.state==='pending'&&x.operation.kind==='content.set_membership'&&x.operation.payload.id===id))return state;
 const operation=contentMembershipOperationSchema.parse({operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId:state.installationId,replicaId:state.replicaId,dependsOn:[],kind:'content.set_membership',payload:{entity,id,expectedRevision:item.revision,active}});
 return {...state,outbox:[...state.outbox,{operation,state:'pending',error:null}]};
});}

export function queueAnchorUse(account:AccountContext,meaningId:string,enabled:boolean){return changeAccountReplica(account,state=>{
 const meaning=state.meanings[meaningId];if(!meaning||!state.replicaId)throw new Error('请先同步内容');
 if(state.outbox.some(x=>x.state==='pending'&&x.operation.kind==='personal.set_anchor_use'&&x.operation.payload.meaningId===meaningId))return state;
 const operation=anchorUseOperationSchema.parse({operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId:state.installationId,replicaId:state.replicaId,dependsOn:[],kind:'personal.set_anchor_use',payload:{meaningId,expectedRevision:meaning.revision,enabled,policy:'original-context-v1'}});
 return {...state,outbox:[...state.outbox,{operation,state:'pending',error:null}]};
});}
