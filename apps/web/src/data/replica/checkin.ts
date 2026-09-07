import {checkInOperationSchema} from '@sensa/contracts/sensa';
import type {AccountContext,ConsumerRun} from '@sensa/contracts/sensa';
import {changeAccountReplica} from './accountStore';
import {clockSample} from './clock';
export function checkInDate(at:string,zone:string){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}
export function queueCheckIn(account:AccountContext,run?:ConsumerRun){
 return changeAccountReplica(account,state=>{
  if(!state.replicaId||!state.plan)throw new Error('请先联网完成每日数量设置');
  const sample=clockSample(run?run.offlineGrant:account.clockGrant),occurredAt=sample?.occurredAt??new Date().toISOString();
  const day=checkInDate(occurredAt,account.timeZone);
  if(sample&&(state.checkins[day]||state.outbox.some(x=>x.state==='pending'&&x.operation.kind==='check_in.record'&&x.operation.payload.clock&&checkInDate(x.operation.occurredAt,account.timeZone)===day)))return state;
  const entry=run?state.runEntries[run.id]:null;
  if(run&&(!sample||!entry))return state; // No automatic claim until a verifiable entry is available.
  const operation=checkInOperationSchema.parse({operationId:crypto.randomUUID(),occurredAt,installationId:state.installationId,replicaId:state.replicaId,dependsOn:[],kind:'check_in.record',payload:{source:run?'formal_learning':'manual',runId:run?.id??null,activityEntryOperationId:entry??null,timeZoneRevision:'1',clock:sample?.clock??null}});
  return {...state,outbox:[...state.outbox,{operation,state:'pending',error:null}]};
 });
}
