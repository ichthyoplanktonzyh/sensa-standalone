/** Pure single-branch history merge, shared by replica merge and conflict ancestry. */
import {backupEqual} from '../../data/library/backupCodec';
import {assertMeaningLifecycle,validMeaningLifecycleDescendant,type MeaningLifecycleRecord} from './meaningLifecycle';
import {canonicalMeaningFacts} from './clarificationSource';
import type {MeaningJourneyRecord} from './store';
type JsonRecord=Record<string,any>;
export type MeaningBranchMergeResult={ok:true;value:any}|{ok:false};
type ValueResult=MeaningBranchMergeResult;
const failed:ValueResult={ok:false};
const equal=backupEqual;
const record=(value:unknown):JsonRecord|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:undefined;
function threeWay(base:unknown,local:unknown,remote:unknown):ValueResult{
 if(equal(local,base))return {ok:true,value:remote};
 if(equal(remote,base)||equal(local,remote))return {ok:true,value:local};
 return failed;
}
const tombstoneFields=new Set(['status','lifecycleRevision','updatedAt','deletedAt','deletedByOperationId']);
const mutableSnapshotFields=new Set([...tombstoneFields,'currentRevision','selectedRevisionId','acceptedRevision']);
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
 {name:'personalSemanticAnchorRevisions',id:'personalSemanticAnchorRevisionId'},
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

export function mergeMeaningBranch(base:unknown,local:unknown,remote:unknown):ValueResult{
 const prior=record(base),ours=record(local),theirs=record(remote);if(!prior||!ours||!theirs)return failed;
 if(!validMeaningLifecycleDescendant(prior as MeaningLifecycleRecord,ours as MeaningLifecycleRecord)||!validMeaningLifecycleDescendant(prior as MeaningLifecycleRecord,theirs as MeaningLifecycleRecord))return failed;
 const personalMeaning=threeWay(prior.personalMeaning,ours.personalMeaning,theirs.personalMeaning);if(!personalMeaning.ok)return failed;
 const merged:JsonRecord={personalMeaning:structuredClone(personalMeaning.value),...(prior.contextStorageVersion===1?{contextStorageVersion:1}:{})};
 for(const spec of arraySpecs){const result=mergeArray(spec,prior[spec.name],ours[spec.name],theirs[spec.name]);if(!result.ok)return failed;merged[spec.name]=result.value;}
 const mockState=mergeMockState(prior.mockState,ours.mockState,theirs.mockState);if(!mockState.ok)return failed;merged.mockState=mockState.value;
 try{assertMeaningLifecycle(merged as MeaningLifecycleRecord);}catch{return failed;}
 return {ok:true,value:merged};
}


export const meaningBranchExtends=(before:unknown,after:unknown)=>{const base=canonicalMeaningFacts(before as MeaningJourneyRecord);return mergeMeaningBranch(base,base,canonicalMeaningFacts(after as MeaningJourneyRecord)).ok;};
export function* stableMeaningFacts(snapshot:MeaningJourneyRecord):Generator<{key:string;value:unknown}>{
 snapshot=canonicalMeaningFacts(snapshot);
 for(const spec of arraySpecs){const rows=(snapshot as unknown as JsonRecord)[spec.name];if(!Array.isArray(rows))throw Error('meaning_conflict_history_invalid');
  for(const fact of rows){const id=fact?.[spec.id];if(typeof id!=='string')throw Error('meaning_conflict_history_invalid');yield {key:`${spec.name}:${id}`,value:spec.lifecycle?withoutFields(fact,mutableSnapshotFields):fact};}
 }
}
