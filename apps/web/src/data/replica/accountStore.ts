import { quantityOperationSchema, targetOperationSchema, planViewSchema } from '@sensa/contracts/sensa';
import type { AccountContext, PlanView, ConsumerOperation, QuantityResult, TargetView, CatalogTarget } from '@sensa/contracts/sensa';

export type PendingQuantity = {operation:ConsumerOperation; state:'pending'|'retained'; error:string|null};
export type AccountReplica = {installationId:string;replicaId:string|null;scopeEpoch:string;cursor:string|null;plan:PlanView|null;outbox:PendingQuantity[];targets:Record<string,TargetView>;catalog:CatalogTarget[]};
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
function initial(account:AccountContext):AccountReplica {return {installationId:account.installationId,replicaId:null,scopeEpoch:'1',cursor:null,plan:account.plan,outbox:[],targets:{},catalog:[]};}
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
    let plan=state.plan;let outbox=state.outbox;let targets=state.targets;
    for(const result of results) {
      const accepted=result.status==='accepted'||(result.status==='replayed'&&result.original==='accepted');
      if(accepted && 'value' in result && result.value) {
        const next=planViewSchema.parse(result.value.plan);
        if(!plan||BigInt(next.revision)>=BigInt(plan.revision))plan=next;
        if('target' in result.value)targets=mergeTargets(targets,[result.value.target]);
        outbox=outbox.filter(x=>x.operation.operationId!==result.operationId);
      } else if(result.status!=='retryable') {
        const error='error' in result?result.error?.code??'unknown':'unknown';
        outbox=outbox.map(x=>x.operation.operationId===result.operationId?{...x,state:'retained' as const,error}:x);
      }
    }return {...state,plan,outbox,targets};
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
