import {backupEqual,decodeBackupValue,encodeBackupValue} from '../backupCodec';
import type {ReplicaEntry,ReplicaMergeInput,ReplicaMergeSteps} from './domainReplica';
import {assertMeaningLifecycle,assertMeaningLifecycleReceipts,assertMeaningLifecycleOperationReceipt,type MeaningLifecycleRecord} from '../../../experience/personalMeaningJourney/meaningLifecycle';
import type {CommandReceipt} from '../../../experience/personalMeaningJourney/store';
import type {MeaningJourneyRecord} from '../../../experience/personalMeaningJourney/store';
import {assertMeaningCorrectionReceipts,meaningCorrectionBindings} from '../../../experience/personalMeaningJourney/meaningCorrection';
import {mergeMeaningConflictHistory,assertMeaningConflictHistory} from '../../../experience/personalMeaningJourney/meaningConflictHistory';
import {meaningHistoryRecords} from '../../../experience/personalMeaningJourney/meaningHistoryRead';
import {registryVersionSlot} from '../../../experience/personalMeaningJourney/registryVersionSlot';
import {isAlignmentActive} from '../../../experience/personalMeaningJourney/alignmentLifecycle';
import {mergeContextHeads} from '../../../experience/personalMeaningJourney/contextConflictHistory';
import type {ContextRecord} from '../../../experience/personalMeaningJourney/contextRecords';

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
function mergeRegistryHead(kind:string,base:unknown,local:unknown,remote:unknown,versions:ReadonlyMap<string,JsonRecord>):ValueResult{
 const prior=record(base),left=record(local),right=record(remote),fields=registryPointerFields[kind];
 if(!prior||!left||!right||!fields||!validRegistryHeadTransition(prior,left,fields)||!validRegistryHeadTransition(prior,right,fields))return failed;
 const ordinary=threeWay(base,local,remote);if(ordinary.ok)return ordinary;
 if(!equal(withoutNamedFields(left,fields),withoutNamedFields(right,fields)))return failed;
 const leftRevision=left.currentVersionNumber,rightRevision=right.currentVersionNumber;
 if(!Number.isSafeInteger(leftRevision)||!Number.isSafeInteger(rightRevision))return failed;
 const versionKind=kind==='senses'?'senseVersions':kind==='bindings'?'bindingVersions':null,parentField=kind==='senses'?'parentSenseVersionId':'parentBindingVersionId';
 if(versionKind){
  const leftId=left[fields[0]],rightId=right[fields[0]],leftVersion=versions.get(`${versionKind}:${leftId}`),rightVersion=versions.get(`${versionKind}:${rightId}`);
  if(leftVersion?.[parentField]||rightVersion?.[parentField]){
   const follows=(start:string,ancestor:string)=>{const seen=new Set<string>();let cursor:string|undefined=start;while(cursor&&!seen.has(cursor)){if(cursor===ancestor)return true;seen.add(cursor);cursor=versions.get(`${versionKind}:${cursor}`)?.[parentField];}return false;};
   if(follows(leftId,rightId))return {ok:true,value:left};if(follows(rightId,leftId))return {ok:true,value:right};return failed;
  }
 }
 if(leftRevision===rightRevision)return left[fields[0]]===right[fields[0]]?{ok:true,value:left}:failed;
 return {ok:true,value:leftRevision>rightRevision?left:right};
}

function mergeRegistry(base:unknown,local:unknown,remote:unknown,versions:ReadonlyMap<string,JsonRecord>):ValueResult{
 const prior=record(base),ours=record(local),theirs=record(remote);if(!prior||!ours||!theirs||prior.kind!==ours.kind||prior.kind!==theirs.kind)return failed;
 const kind=String(prior.kind);let value:ValueResult;
 if(registryVersions.has(kind))value=equal(prior.value,ours.value)&&equal(prior.value,theirs.value)?{ok:true,value:prior.value}:failed;
 else if(registryHeads.has(kind))value=mergeRegistryHead(kind,prior.value,ours.value,theirs.value,versions);
 else return failed;
 if(!value.ok)return failed;
 const ordinals=[prior.ordinal,ours.ordinal,theirs.ordinal].filter(Number.isSafeInteger) as number[];
 return {ok:true,value:{kind,ordinal:Math.min(...ordinals),value:structuredClone(value.value)}};
}

/** The retained Meaning decision witnesses the two exact wording versions.
 * It can settle their Registry pointer too, but cannot cover a later peer edit. */
function registryHeadDecision(kind:string,local:JsonRecord,remote:JsonRecord,meanings:readonly MeaningJourneyRecord[],versions:ReadonlyMap<string,JsonRecord>):JsonRecord|undefined{
 const field=registryPointerFields[kind]?.[0];if(!field||kind==='expressions')return;
 const entity=kind==='senses'?local.senseId:local.senseExpressionBindingId;
 const refs=(meaning:MeaningJourneyRecord)=>{
  const alignments=meaning.alignments.filter(alignment=>isAlignmentActive(meaning,alignment));
  if(kind==='senses')return alignments.filter(row=>row.senseId===entity).map(row=>row.senseVersionId);
  return alignments.flatMap(alignment=>{
   return meaningCorrectionBindings(meaning,alignment).filter(confirmation=>versions.get(`bindingVersions:${confirmation.bindingVersionId}`)?.senseExpressionBindingId===entity).map(confirmation=>confirmation.bindingVersionId);
  });
 };
 const choices=new Set<string>();
 for(const meaning of meanings){
  const history=meaning.conflictHistory;if(!history)continue;
  const decision=history.decisions.find(row=>row.id===history.head),selected=history.branches.find(row=>row.digest===decision?.selected);if(!selected)continue;
  const parents=decision!.parents.map(id=>history.branches.find(branch=>branch.digest===id)!).filter(Boolean);
  if(parents.length!==2)continue;
  const parentRefs=parents.map(branch=>refs(branch.record));
  if(!((parentRefs[0]!.includes(local[field])&&parentRefs[1]!.includes(remote[field]))||(parentRefs[1]!.includes(local[field])&&parentRefs[0]!.includes(remote[field]))))continue;
  const observed=new Set(parentRefs.flat());
  if(!observed.has(local[field])||!observed.has(remote[field]))continue;
  // The active branch must still select one of the exact observed pointers.
  // Descendant edits are handled by ancestry above, not by an older decision.
  const current=[...new Set(refs(meaning))],selectedRefs=[...new Set(refs(selected.record))];
  if(current.length!==1||selectedRefs.length!==1||current[0]!==selectedRefs[0]||![local[field],remote[field]].includes(current[0]))continue;
  choices.add(current[0]!);
 }
 if(choices.size!==1)return;
 const chosen=[...choices][0];return chosen===local[field]?local:chosen===remote[field]?remote:undefined;
}

function mergedEntry(value:unknown,...candidates:Array<ReplicaEntry|undefined>):ReplicaEntry{
 for(const candidate of candidates)if(candidate&&equal(decodeBackupValue(candidate.value),value))return candidate;
 const source=candidates.find(Boolean)!;
 return {table:source.table,key:source.key,value:encodeBackupValue(value)};
}

const durableTables=new Set<ReplicaEntry['table']>(['semanticState','semanticMeanings','semanticContexts','semanticRegistry','semanticReceipts','meanings','identities']);
const registrySlot=(entry:ReplicaEntry)=>{
 const wrapper=record(decodeBackupValue(entry.value)),fact=record(wrapper?.value);if(!wrapper||!fact)return undefined;
 return registryVersionSlot(String(wrapper.kind),fact);
};

/** Domain merge for revisioned Personal Semantic World facts and durable tombstones. */
export function* mergePersonalSemanticWorldReplica(
 input:ReplicaMergeInput,
 ordinary:(input:ReplicaMergeInput)=>ReplicaMergeSteps,
):ReplicaMergeSteps{
 const result=yield* ordinary(input),entries=new Map(result.entries.map(entry=>[entryId(entry),entry])),conflicts=new Set(result.conflicts);
 const base=byId(input.base),local=byId(input.local),remote=byId(input.remote);
 const versions=new Map<string,JsonRecord>();for(const row of [...input.base,...input.local,...input.remote])if(row.table==='semanticRegistry'){const wrapper=record(decodeBackupValue(row.value)),fact=record(wrapper?.value);if(wrapper&&fact&&registryVersions.has(wrapper.kind))versions.set(row.key,fact);}
 const contextVersions=new Map<string,{personalSemanticAnchorId:string;parentRevisionId:string|null}>();for(const row of [...input.base,...input.local,...input.remote])if(row.table==='semanticContexts'){const fact=decodeBackupValue(row.value) as ContextRecord;if(fact.kind==='anchorRevisions')contextVersions.set(fact.value.personalSemanticAnchorRevisionId,{personalSemanticAnchorId:fact.value.personalSemanticAnchorId,parentRevisionId:fact.parentRevisionId});}
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
   const groups=(receipt.command==='CorrectPersonalMeaning'||receipt.command==='AcceptPublishedLearningScene')?correctionReceipts:receipt.command==='ChangeMeaningLifecycle'?lifecycleReceipts:undefined;
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
  if(sample.table==='semanticContexts'){
   const before=decodeBackupValue(prior.value) as ContextRecord,left=decodeBackupValue(ours.value) as ContextRecord,right=decodeBackupValue(theirs.value) as ContextRecord;
   const merged=before.kind==='anchors'&&left.kind==='anchors'&&right.kind==='anchors'?mergeContextHeads(before.value,left.value,right.value,contextVersions):equal(before,left)&&equal(before,right)?{ok:true as const,value:before}: {ok:false as const};
   if(merged.ok){const value=before.kind==='anchors'?{kind:'anchors',value:merged.value}:merged.value;entries.set(id,mergedEntry(value,ours,theirs,prior));conflicts.delete(id);}else conflicts.add(id);
   continue;
  }
  if(sample.table!=='semanticMeanings'&&sample.table!=='semanticRegistry')continue;
  const merge=sample.table==='semanticMeanings'?mergeMeaningConflictHistory:mergeRegistry;
  const merged=merge===mergeRegistry?mergeRegistry(decodeBackupValue(prior.value),decodeBackupValue(ours.value),decodeBackupValue(theirs.value),versions):mergeMeaningConflictHistory(decodeBackupValue(prior.value),decodeBackupValue(ours.value),decodeBackupValue(theirs.value));
  if(!merged.ok){if(!equal(ours.value,theirs.value))conflicts.add(id);continue;}
  entries.set(id,mergedEntry(merged.value,ours,theirs,prior));
  // A successful content merge cannot erase failed branch admission above.
  if(!admissionConflicts.has(id))conflicts.delete(id);
 }
 // Ordinary Meaning decisions also settle the exact stable Registry pointers
 // they observed. Immutable versions and all archived Meanings stay retained.
 const decidedMeanings=[...entries.values()].filter(row=>row.table==='semanticMeanings'&&!conflicts.has(entryId(row))).map(row=>decodeBackupValue(row.value) as MeaningJourneyRecord);
 for(const id of [...conflicts]){
  const prior=base.get(id),ours=local.get(id),theirs=remote.get(id);if(!prior||!ours||!theirs||ours.table!=='semanticRegistry')continue;
  const before=decodeBackupValue(prior.value),left=decodeBackupValue(ours.value),right=decodeBackupValue(theirs.value),kind=String(left.kind),fields=registryPointerFields[kind];
  if(before.kind!==kind||right.kind!==kind||!fields||![left.value,right.value].every(fact=>equal(withoutNamedFields(before.value,fields),withoutNamedFields(fact,fields))&&Number.isSafeInteger(fact[fields[1]])&&fact[fields[1]]>=before.value[fields[1]]))continue;
  const entity=kind==='senses'?left.value.senseId:left.value.senseExpressionBindingId;
  const unresolved=[...conflicts].some(key=>[local.get(key),remote.get(key)].some(row=>{
   if(row?.table!=='semanticMeanings')return false;const meaning=decodeBackupValue(row.value) as MeaningJourneyRecord;
   return kind==='senses'?meaning.alignments.some(alignment=>alignment.senseId===entity):meaning.bindingConfirmations.some(confirmation=>versions.get(`bindingVersions:${confirmation.bindingVersionId}`)?.senseExpressionBindingId===entity);
  }));if(unresolved)continue;
  const selected=registryHeadDecision(kind,left.value,right.value,decidedMeanings,versions);if(!selected)continue;
  entries.set(id,mergedEntry({...left,ordinal:Math.min(before.ordinal,left.ordinal,right.ordinal),value:selected},ours,theirs,prior));conflicts.delete(id);
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
