import {backupEqual,decodeBackupValue,encodeBackupValue} from '../backupCodec';
import type {ReplicaEntry,ReplicaMergeInput,ReplicaMergeSteps} from './domainReplica';
import {assertMeaningLifecycle,assertMeaningLifecycleReceipts,assertMeaningLifecycleOperationReceipt,type MeaningLifecycleRecord} from '../../../experience/personalMeaningJourney/meaningLifecycle';
import type {CommandReceipt} from '../../../experience/personalMeaningJourney/store';
import type {MeaningJourneyRecord} from '../../../experience/personalMeaningJourney/store';
import {assertMeaningCorrectionReceipts} from '../../../experience/personalMeaningJourney/meaningCorrection';
import {mergeMeaningConflictHistory,assertMeaningConflictHistory} from '../../../experience/personalMeaningJourney/meaningConflictHistory';
import {meaningHistoryRecords} from '../../../experience/personalMeaningJourney/meaningHistoryRead';

type JsonRecord=Record<string,any>;
type ValueResult={ok:true;value:any}|{ok:false};

const failed:ValueResult={ok:false};
const equal=(left:unknown,right:unknown)=>backupEqual(left,right);
const record=(value:unknown):JsonRecord|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:undefined;
const entryId=(entry:Pick<ReplicaEntry,'table'|'key'>)=>JSON.stringify([entry.table,entry.key]);
const byId=(entries:readonly ReplicaEntry[])=>new Map(entries.map(entry=>[entryId(entry),entry]));

function threeWay(base:unknown,local:unknown,remote:unknown):ValueResult{
 if(equal(local,base))return {ok:true,value:remote};
 if(equal(remote,base)||equal(local,remote))return {ok:true,value:local};
 return failed;
}

function withoutFields(value:JsonRecord,fields:ReadonlySet<string>){return Object.fromEntries(Object.entries(value).filter(([key])=>!fields.has(key)));}

const registryVersions=new Set(['senseVersions','expressionVersions','bindingVersions']);
const registryHeads=new Set(['senses','expressions','bindings']);
const registryPointerFields:Record<string,readonly string[]>={
 senses:['currentSenseVersionId','currentVersionNumber'],
 expressions:['currentExpressionVersionId','currentVersionNumber'],
 bindings:['currentBindingVersionId','currentVersionNumber'],
};

function withoutNamedFields(value:JsonRecord,fields:readonly string[]){return withoutFields(value,new Set(fields));}
function validRegistryHeadTransition(base:JsonRecord,candidate:JsonRecord,fields:readonly string[]){
 if(!equal(withoutNamedFields(base,fields),withoutNamedFields(candidate,fields)))return false;
 const [pointerField,revisionField]=fields,prior=base[revisionField],next=candidate[revisionField];
 if(!Number.isSafeInteger(prior)||!Number.isSafeInteger(next)||next<prior)return false;
 return next!==prior||candidate[pointerField]===base[pointerField];
}
function mergeRegistryHead(kind:string,base:unknown,local:unknown,remote:unknown):ValueResult{
 const prior=record(base),left=record(local),right=record(remote),fields=registryPointerFields[kind];
 if(!prior||!left||!right||!fields||!validRegistryHeadTransition(prior,left,fields)||!validRegistryHeadTransition(prior,right,fields))return failed;
 const ordinary=threeWay(base,local,remote);if(ordinary.ok)return ordinary;
 if(!equal(withoutNamedFields(left,fields),withoutNamedFields(right,fields)))return failed;
 const leftRevision=left.currentVersionNumber,rightRevision=right.currentVersionNumber;
 if(!Number.isSafeInteger(leftRevision)||!Number.isSafeInteger(rightRevision))return failed;
 if(leftRevision===rightRevision)return left[fields[0]]===right[fields[0]]?{ok:true,value:left}:failed;
 return {ok:true,value:leftRevision>rightRevision?left:right};
}

function mergeRegistry(base:unknown,local:unknown,remote:unknown):ValueResult{
 const prior=record(base),ours=record(local),theirs=record(remote);if(!prior||!ours||!theirs||prior.kind!==ours.kind||prior.kind!==theirs.kind)return failed;
 const kind=String(prior.kind);let value:ValueResult;
 if(registryVersions.has(kind))value=equal(prior.value,ours.value)&&equal(prior.value,theirs.value)?{ok:true,value:prior.value}:failed;
 else if(registryHeads.has(kind))value=mergeRegistryHead(kind,prior.value,ours.value,theirs.value);
 else return failed;
 if(!value.ok)return failed;
 const ordinals=[prior.ordinal,ours.ordinal,theirs.ordinal].filter(Number.isSafeInteger) as number[];
 return {ok:true,value:{kind,ordinal:Math.min(...ordinals),value:structuredClone(value.value)}};
}

function mergedEntry(value:unknown,...candidates:Array<ReplicaEntry|undefined>):ReplicaEntry{
 for(const candidate of candidates)if(candidate&&equal(decodeBackupValue(candidate.value),value))return candidate;
 const source=candidates.find(Boolean)!;
 return {table:source.table,key:source.key,value:encodeBackupValue(value)};
}

const durableTables=new Set<ReplicaEntry['table']>(['semanticState','semanticMeanings','semanticRegistry','semanticReceipts','meanings','identities']);
const registrySlot=(entry:ReplicaEntry)=>{
 const wrapper=record(decodeBackupValue(entry.value)),fact=record(wrapper?.value);if(!wrapper||!fact)return undefined;
 if(wrapper.kind==='senseVersions')return `senseVersions:${fact.senseId}:${fact.versionNumber}`;
 if(wrapper.kind==='expressionVersions')return `expressionVersions:${fact.expressionId}:${fact.versionNumber}`;
 if(wrapper.kind==='bindingVersions')return `bindingVersions:${fact.senseExpressionBindingId}:${fact.versionNumber}`;
 return undefined;
};

/** Domain merge for revisioned Personal Semantic World facts and durable tombstones. */
export function* mergePersonalSemanticWorldReplica(
 input:ReplicaMergeInput,
 ordinary:(input:ReplicaMergeInput)=>ReplicaMergeSteps,
):ReplicaMergeSteps{
 const result=yield* ordinary(input),entries=new Map(result.entries.map(entry=>[entryId(entry),entry])),conflicts=new Set(result.conflicts);
 const base=byId(input.base),local=byId(input.local),remote=byId(input.remote);
 const admissionConflicts=new Set<string>();
 // Validate each branch against its own durable operation facts, before any
 // ordinary three-way choice can import a well-shaped but unwitnessed restore.
 for(const side of [input.base,input.local,input.remote]){
  // Retain record references, not all decoded receipt bodies. Admission reads
  // only the receipts belonging to the Meaning currently under examination.
  const lifecycleReceipts=new Map<string,ReplicaEntry[]>(),correctionReceipts=new Map<string,ReplicaEntry[]>();
  for(const entry of side)if(entry.table==='semanticReceipts'){
   yield;
   const receipt=decodeBackupValue(entry.value) as CommandReceipt;
   const groups=receipt.command==='CorrectPersonalMeaning'?correctionReceipts:receipt.command==='ChangeMeaningLifecycle'?lifecycleReceipts:undefined;
   if(groups){const id=String(receipt.result.personalMeaningId),group=groups.get(id)??[];group.push(entry);groups.set(id,group);}
  }
  const receiptsFor=(groups:Map<string,ReplicaEntry[]>,id:string)=>(groups.get(id)??[]).map(entry=>decodeBackupValue(entry.value) as CommandReceipt);
  const meanings=new Map(side.filter(entry=>entry.table==='semanticMeanings').map(entry=>[entry.key,entry]));
  const meaningFor=(id:string)=>{const entry=meanings.get(id);return entry?decodeBackupValue(entry.value) as MeaningLifecycleRecord:undefined;};
  for(const entry of side)if(entry.table==='semanticMeanings'){
   yield;
   const meaning=meaningFor(entry.key)!;
   try{
    assertMeaningConflictHistory(meaning as MeaningJourneyRecord);for(const branch of meaningHistoryRecords(meaning as MeaningJourneyRecord))assertMeaningLifecycle(branch);
    assertMeaningLifecycleReceipts([meaning],receiptsFor(lifecycleReceipts,entry.key));
    assertMeaningCorrectionReceipts(meaning as MeaningJourneyRecord,receiptsFor(correctionReceipts,entry.key));
   }catch{conflicts.add(entryId(entry));admissionConflicts.add(entryId(entry));}
  }
  for(const entry of side)if(entry.table==='semanticReceipts')try{
   yield;
   const receipt=decodeBackupValue(entry.value) as CommandReceipt;
   assertMeaningLifecycleOperationReceipt(meaningFor(String(receipt.result.personalMeaningId)),receipt);
   if(receipt.command==='CorrectPersonalMeaning'){const meaning=meaningFor(String(receipt.result.personalMeaningId));if(!meaning)throw Error('meaning_correction_invalid');assertMeaningCorrectionReceipts(meaning as MeaningJourneyRecord,receiptsFor(correctionReceipts,String(receipt.result.personalMeaningId)));}
  }catch{conflicts.add(entryId(entry));admissionConflicts.add(entryId(entry));}
 }
 for(const id of new Set([...base.keys(),...local.keys(),...remote.keys()])){
  yield;
  const prior=base.get(id),ours=local.get(id),theirs=remote.get(id),sample=ours??theirs??prior!;
  if(prior&&durableTables.has(sample.table)&&(!ours||!theirs)){conflicts.add(id);continue;}
  if(!prior||!ours||!theirs)continue;
  if(sample.table!=='semanticMeanings'&&sample.table!=='semanticRegistry')continue;
  const merge=sample.table==='semanticMeanings'?mergeMeaningConflictHistory:mergeRegistry;
  const merged=merge(decodeBackupValue(prior.value),decodeBackupValue(ours.value),decodeBackupValue(theirs.value));
  if(!merged.ok){if(!equal(ours.value,theirs.value))conflicts.add(id);continue;}
  entries.set(id,mergedEntry(merged.value,ours,theirs,prior));
  // A successful content merge cannot erase failed branch admission above.
  if(!admissionConflicts.has(id))conflicts.delete(id);
 }
 const slots=new Map<string,string>();
 for(const entry of entries.values())if(entry.table==='semanticRegistry'){
  yield;
  const slot=registrySlot(entry);if(!slot)continue;const existing=slots.get(slot);
  if(existing&&existing!==entryId(entry)){conflicts.add(existing);conflicts.add(entryId(entry));}else slots.set(slot,entryId(entry));
 }
 return {entries:[...entries.values()].sort((a,b)=>entryId(a).localeCompare(entryId(b))),conflicts:[...conflicts].sort()};
}

export const requiresPersonalSemanticWorldTombstone=(entry:Pick<ReplicaEntry,'table'|'key'>)=>durableTables.has(entry.table);
