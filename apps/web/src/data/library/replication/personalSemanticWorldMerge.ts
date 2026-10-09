import {backupEqual,decodeBackupValue,encodeBackupValue} from '../backupCodec';
import type {ReplicaEntry,ReplicaMergeInput,ReplicaMergeSteps} from './domainReplica';
import {assertMeaningLifecycle,assertMeaningLifecycleReceipts,assertMeaningLifecycleOperationReceipt,validMeaningLifecycleDescendant,type MeaningLifecycleRecord} from '../../../experience/personalMeaningJourney/meaningLifecycle';
import type {CommandReceipt} from '../../../experience/personalMeaningJourney/store';
import type {MeaningJourneyRecord} from '../../../experience/personalMeaningJourney/store';
import {assertMeaningCorrectionReceipts} from '../../../experience/personalMeaningJourney/meaningCorrection';

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

const tombstoneFields=new Set(['status','lifecycleRevision','updatedAt','deletedAt','deletedByOperationId']);
const mutableSnapshotFields=new Set([...tombstoneFields,'currentRevision','acceptedRevision']);
function withoutFields(value:JsonRecord,fields:ReadonlySet<string>){return Object.fromEntries(Object.entries(value).filter(([key])=>!fields.has(key)));}
function withoutTombstone(value:JsonRecord){return withoutFields(value,tombstoneFields);}
function compareTombstones(left:JsonRecord,right:JsonRecord){
 const revision=Number(left.lifecycleRevision)-Number(right.lifecycleRevision);if(revision)return revision;
 const deletedAt=String(left.deletedAt).localeCompare(String(right.deletedAt));if(deletedAt)return deletedAt;
 return String(left.deletedByOperationId).localeCompare(String(right.deletedByOperationId));
}

function validLifecycleTransition(base:unknown,next:unknown){
 if(equal(base,next))return true;
 const prior=record(base),candidate=record(next);if(!prior||!candidate)return false;
 if(prior.status!=='active'||!Number.isSafeInteger(prior.lifecycleRevision)||prior.lifecycleRevision<1)return false;
 if(!equal(withoutFields(prior,mutableSnapshotFields),withoutFields(candidate,mutableSnapshotFields)))return false;
 if(candidate.status==='active')return candidate.lifecycleRevision===prior.lifecycleRevision
  &&candidate.deletedAt===null&&candidate.deletedByOperationId===null;
 return candidate.status==='deleted'
  &&candidate.lifecycleRevision===prior.lifecycleRevision+1
  &&typeof candidate.deletedAt==='string'
  &&typeof candidate.deletedByOperationId==='string'
  &&equal(withoutTombstone(prior),withoutTombstone(candidate));
}

function mergeLifecycle(base:unknown,local:unknown,remote:unknown):ValueResult{
 if(!validLifecycleTransition(base,local)||!validLifecycleTransition(base,remote))return failed;
 const ordinary=threeWay(base,local,remote);if(ordinary.ok)return ordinary;
 const left=record(local),right=record(remote);
 if(!left||!right||left.status!=='deleted'||right.status!=='deleted'||!equal(withoutTombstone(left),withoutTombstone(right)))return failed;
 return {ok:true,value:compareTombstones(left,right)>=0?left:right};
}

type ArraySpec={name:string;id:string;mutable?:boolean;lifecycle?:boolean;slot?:(value:JsonRecord)=>string};
const arraySpecs:ArraySpec[]=[
 {name:'personalMeaningRevisions',id:'personalMeaningRevisionId',slot:value=>`${value.personalMeaningId}:${value.revision}`},
 {name:'personalSemanticAnchors',id:'personalSemanticAnchorId',mutable:true,lifecycle:true},
 {name:'personalSemanticAnchorRevisions',id:'personalSemanticAnchorRevisionId',slot:value=>`${value.personalSemanticAnchorId}:${value.revision}`},
 {name:'personalExpressionAnchors',id:'personalExpressionAnchorId',mutable:true,lifecycle:true},
 {name:'personalExpressionAnchorRevisions',id:'personalExpressionAnchorRevisionId',slot:value=>`${value.personalExpressionAnchorId}:${value.revision}`},
 {name:'focuses',id:'meaningFocusId',mutable:true,lifecycle:true},
 {name:'focusRevisions',id:'meaningFocusRevisionId',slot:value=>`${value.meaningFocusId}:${value.revision}`},
 {name:'focusAcceptances',id:'meaningFocusAcceptanceId'},
 {name:'constructions',id:'senseConstructionId',mutable:true},
 {name:'constructionTurns',id:'constructionTurnId',slot:value=>`${value.senseConstructionId}:${value.ordinal}`},
 {name:'proposals',id:'senseProposalId',mutable:true},
 {name:'proposalVersions',id:'senseProposalVersionId',slot:value=>`${value.senseProposalId}:${value.version}`},
 {name:'senseConfirmations',id:'senseProposalConfirmationId'},
 {name:'semanticAcceptances',id:'semanticAcceptanceId'},
 {name:'alignments',id:'personalMeaningAlignmentId',mutable:true},
 {name:'alignmentEvents',id:'personalMeaningAlignmentEventId',slot:value=>`${value.personalMeaningAlignmentId}:${value.ordinal}`},
 {name:'bindingConfirmations',id:'expressionBindingConfirmationId'},
];

function arrayMap(value:unknown,idField:string){
 if(!Array.isArray(value))return undefined;
 const result=new Map<string,JsonRecord>();
 for(const item of value){const fact=record(item),id=fact?.[idField];if(!fact||typeof id!=='string'||result.has(id))return undefined;result.set(id,fact);}
 return result;
}

function factOrder(value:JsonRecord,idField:string){
 const at=value.createdAt??value.occurredAt??value.acceptedAt??value.confirmedAt??value.updatedAt??'';
 return `${String(at)}\u0000${String(value[idField])}`;
}

function mergeArray(spec:ArraySpec,base:unknown,local:unknown,remote:unknown):ValueResult{
 const prior=arrayMap(base,spec.id),ours=arrayMap(local,spec.id),theirs=arrayMap(remote,spec.id);
 if(!prior||!ours||!theirs)return failed;
 const merged:JsonRecord[]=[];
 for(const id of new Set([...prior.keys(),...ours.keys(),...theirs.keys()])){
  const before=prior.get(id),left=ours.get(id),right=theirs.get(id);
  if(before&&(!left||!right))return failed;
  if(!before){
   if(left&&right&&!equal(left,right))return failed;
   merged.push(structuredClone(left??right!));continue;
  }
  if(!spec.mutable){if(!equal(left,before)||!equal(right,before))return failed;merged.push(structuredClone(before));continue;}
  const result=spec.lifecycle?mergeLifecycle(before,left,right):threeWay(before,left,right);if(!result.ok)return failed;merged.push(structuredClone(result.value));
 }
 if(spec.slot){
  const slots=new Map<string,string>();
  for(const fact of merged){const slot=spec.slot(fact),id=String(fact[spec.id]),existing=slots.get(slot);if(existing&&existing!==id)return failed;slots.set(slot,id);}
 }
 merged.sort((left,right)=>factOrder(left,spec.id).localeCompare(factOrder(right,spec.id)));
 return {ok:true,value:merged};
}

function mergeMap(base:unknown,local:unknown,remote:unknown):ValueResult{
 const prior=record(base)??{},ours=record(local)??{},theirs=record(remote)??{},merged:JsonRecord={};
 for(const key of new Set([...Object.keys(prior),...Object.keys(ours),...Object.keys(theirs)])){
  const result=threeWay(prior[key],ours[key],theirs[key]);if(!result.ok)return failed;
  if(result.value!==undefined)merged[key]=structuredClone(result.value);
 }
 return {ok:true,value:merged};
}

function mergeMockState(base:unknown,local:unknown,remote:unknown):ValueResult{
 const prior=record(base)??{},ours=record(local)??{},theirs=record(remote)??{};
 const labels=mergeMap(prior.focusAspectLabels,ours.focusAspectLabels,theirs.focusAspectLabels);if(!labels.ok)return failed;
 const startingPoint=threeWay(prior.startingPoint,ours.startingPoint,theirs.startingPoint);if(!startingPoint.ok)return failed;
 return {ok:true,value:{focusAspectLabels:labels.value,...(startingPoint.value===undefined?{}:{startingPoint:structuredClone(startingPoint.value)})}};
}

function mergeMeaning(base:unknown,local:unknown,remote:unknown):ValueResult{
 const prior=record(base),ours=record(local),theirs=record(remote);if(!prior||!ours||!theirs)return failed;
 if(!validMeaningLifecycleDescendant(prior as MeaningLifecycleRecord,ours as MeaningLifecycleRecord)||!validMeaningLifecycleDescendant(prior as MeaningLifecycleRecord,theirs as MeaningLifecycleRecord))return failed;
 const personalMeaning=threeWay(prior.personalMeaning,ours.personalMeaning,theirs.personalMeaning);if(!personalMeaning.ok)return failed;
 const merged:JsonRecord={personalMeaning:structuredClone(personalMeaning.value)};
 for(const spec of arraySpecs){const result=mergeArray(spec,prior[spec.name],ours[spec.name],theirs[spec.name]);if(!result.ok)return failed;merged[spec.name]=result.value;}
 const mockState=mergeMockState(prior.mockState,ours.mockState,theirs.mockState);if(!mockState.ok)return failed;merged.mockState=mockState.value;
 try{assertMeaningLifecycle(merged as MeaningLifecycleRecord);}catch{return failed;}
 return {ok:true,value:merged};
}

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
    assertMeaningLifecycle(meaning);assertMeaningLifecycleReceipts([meaning],receiptsFor(lifecycleReceipts,entry.key));
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
  const merge=sample.table==='semanticMeanings'?mergeMeaning:mergeRegistry;
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
