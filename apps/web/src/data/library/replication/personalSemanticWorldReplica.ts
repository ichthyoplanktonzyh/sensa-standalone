import {meaningContextKeys} from '../../../experience/personalMeaningJourney/contextRecords';
import type {DomainReplicaModule,ReplicaRecordReference,ReplicaEntry} from './domainReplica';
import {mergePersonalSemanticWorldReplica,requiresPersonalSemanticWorldTombstone} from './personalSemanticWorldMerge';
import {decodeBackupValue,encodeBackupValue,backupEqual} from '../backupCodec';
import {decideMeaningConflict} from '../../../experience/personalMeaningJourney/meaningConflictHistory';
import {meaningHistoryRecords} from '../../../experience/personalMeaningJourney/meaningHistoryRead';
import type {MeaningJourneyRecord} from '../../../experience/personalMeaningJourney/store';
import {decideContextConflict} from '../../../experience/personalMeaningJourney/contextConflictHistory';
import type {ContextRecord} from '../../../experience/personalMeaningJourney/contextRecords';

const tables=new Set([
 'drafts','sessions','meanings','identities',
 'semanticState','semanticMeanings','semanticContexts','semanticRegistry','semanticInbox',
 'semanticDrafts','semanticReceipts','media',
]);

const record=(value:unknown):Record<string,any>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:undefined;
const reference=(table:ReplicaRecordReference['table'],key:unknown):ReplicaRecordReference[]=>typeof key==='string'&&key.length?[{table,key}]:[];
const registryReference=(kind:string,key:unknown)=>reference('semanticRegistry',typeof key==='string'?`${kind}:${key}`:undefined);
const values=(value:unknown):Record<string,any>[]=>Array.isArray(value)?value.flatMap(item=>record(item)??[]):[];

function branchDependencies(value:unknown){
 const meaning=record(value);if(!meaning)return [];
 const references:ReplicaRecordReference[]=[];
 for(const key of meaningContextKeys(meaning as MeaningJourneyRecord))references.push(...reference('semanticContexts',key));
 for(const fact of [
  ...values(meaning.senseConfirmations),
  ...values(meaning.semanticAcceptances),
  ...values(meaning.alignments),
 ])references.push(...registryReference('senses',fact.senseId),...registryReference('senseVersions',fact.senseVersionId));
 for(const fact of values(meaning.bindingConfirmations))references.push(
  ...registryReference('senseVersions',fact.senseVersionId),
  ...registryReference('expressionVersions',fact.expressionVersionId),
  ...registryReference('bindingVersions',fact.bindingVersionId),
 );
 return references;
}
function meaningDependencies(value:unknown){return meaningHistoryRecords(value as MeaningJourneyRecord).flatMap(branchDependencies);}

function registryDependencies(value:unknown){
 const row=record(value),fact=record(row?.value);if(!row||!fact)return [];
 if(row.kind==='senses')return registryReference('senseVersions',fact.currentSenseVersionId);
 if(row.kind==='senseVersions')return [...registryReference('senses',fact.senseId),...registryReference('senseVersions',fact.parentSenseVersionId)];
 if(row.kind==='expressions')return registryReference('expressionVersions',fact.currentExpressionVersionId);
 if(row.kind==='expressionVersions')return registryReference('expressions',fact.expressionId);
 if(row.kind==='bindings')return [
  ...registryReference('senses',fact.senseId),
  ...registryReference('expressions',fact.expressionId),
  ...registryReference('bindingVersions',fact.currentBindingVersionId),
 ];
 if(row.kind==='bindingVersions')return [
  ...registryReference('bindings',fact.senseExpressionBindingId),
  ...registryReference('senseVersions',fact.senseVersionId),
  ...registryReference('expressionVersions',fact.expressionVersionId),
  ...registryReference('bindingVersions',fact.parentBindingVersionId),
 ];
 return [];
}

function dependencyBody(entry:ReplicaEntry){
 const value=decodeBackupValue(entry.value);
 if(entry.table==='semanticContexts'&&value.kind==='anchors'){const fact={...value.value};for(const key of ['currentRevision','currentRevisionId','updatedAt','conflictHistory'])delete fact[key];return {kind:value.kind,value:fact};}
 if(entry.table!=='semanticRegistry')return value;
 const fact={...value.value};
 for(const key of ['currentSenseVersionId','currentExpressionVersionId','currentBindingVersionId','currentVersionNumber'])delete fact[key];
 return {kind:value.kind,value:fact};
}

export const personalSemanticWorldReplica:DomainReplicaModule={
 namespace:'personal-semantic-world',
 owns:(table)=>tables.has(table),
 normalize(entry){
  if(entry.table!=='sessions')return entry;
  const value=structuredClone(entry.value) as {status?:string;lease?:unknown;revision?:number};
  if(value.status==='inflight'){
   value.status='stopped';value.lease=null;
   if(Number.isSafeInteger(value.revision))value.revision=(value.revision??0)+1;
  }
  return {...entry,value};
 },
 mergeSteps:mergePersonalSemanticWorldReplica,
 afterConflictChoice(selected,merged,context){
  const id=(entry:ReplicaRecordReference)=>JSON.stringify([entry.table,entry.key]);
  const chosen=new Map(selected.map(entry=>[id(entry),entry])),base=new Set(context.base.map(id)),conflicts=new Set(context.conflicts),rows=new Map(merged.map(entry=>[id(entry),entry]));
  // A shared immutable registry node may hold an otherwise independent first
  // acceptance behind a note conflict. Selecting the note must not discard
  // that uncontested new Meaning and leave an orphan revision-stable receipt.
  const meanings=merged.filter(entry=>entry.table==='semanticMeanings'&&!conflicts.has(id(entry))&&meaningContextKeys(decodeBackupValue(entry.value)).some(key=>{const context=rows.get(id({table:'semanticContexts',key}));return context&&record(record(decodeBackupValue(context.value))?.value?.structuredPayload?.learningScene);}));
  // Uncontested re-acceptance of an existing Meaning is equally independent:
  // retain the owner's validated ordinary merge, including baseline facts.
  const queue:ReplicaEntry[]=[];
  for(const entry of meanings){chosen.set(id(entry),entry);for(const dependency of meaningDependencies(decodeBackupValue(entry.value))){const row=rows.get(id(dependency));if(row)queue.push(row);}}
  for(let at=0;at<queue.length;at++){
   const entry=queue[at]!,key=id(entry);if(chosen.has(key)||base.has(key)||conflicts.has(key))continue;
   chosen.set(key,entry);
   for(const dependency of this.conflictDependencies?.(entry,decodeBackupValue(entry.value))??[]){const row=rows.get(id(dependency));if(row)queue.push(row);}
  }
  {
   const local=new Map(context.local.map(entry=>[id(entry),entry])),remote=new Map(context.remote.map(entry=>[id(entry),entry])),decided=new Set<string>();
   const variants=new Map<string,ReplicaEntry[]>();for(const branch of [context.base,context.local,context.remote])for(const entry of branch){const key=id(entry),group=variants.get(key)??[];group.push(entry);variants.set(key,group);}
   // Immutable Context IDs cannot be resolved by choosing a different body.
   for(const candidates of variants.values())if(candidates[0]?.table==='semanticContexts'&&record(decodeBackupValue(candidates[0].value))?.kind==='anchorRevisions'&&!candidates.every(row=>backupEqual(row.value,candidates[0]!.value)))throw Error('library_sync_conflict_unsupported');
   const contextVersions=new Map<string,{personalSemanticAnchorId:string;parentRevisionId:string|null}>();for(const entry of merged)if(entry.table==='semanticContexts'){const row=decodeBackupValue(entry.value) as ContextRecord;if(row.kind==='anchorRevisions')contextVersions.set(row.value.personalSemanticAnchorRevisionId,{personalSemanticAnchorId:row.value.personalSemanticAnchorId,parentRevisionId:row.parentRevisionId});}
   let contextDecided=false;
   for(const key of conflicts){const ours=local.get(key),theirs=remote.get(key),selected=chosen.get(key);if(selected?.table!=='semanticContexts'||!ours||!theirs)continue;
    const left=decodeBackupValue(ours.value) as ContextRecord,right=decodeBackupValue(theirs.value) as ContextRecord,choice=decodeBackupValue(selected.value) as ContextRecord;
    if(left.kind!=='anchors'||right.kind!=='anchors'||choice.kind!=='anchors')throw Error('library_sync_conflict_unsupported');
    const value=decideContextConflict(left.value,right.value,choice.value,context.decision.id,context.decision.createdAt,contextVersions);
    chosen.set(key,{...selected,value:encodeBackupValue({kind:'anchors',value}),blocks:undefined});contextDecided=true;
   }
   for(const key of conflicts){const ours=local.get(key),theirs=remote.get(key),selected=chosen.get(key);if(selected?.table!=='semanticMeanings'||!ours||!theirs)continue;
    const dependencies=[...meaningDependencies(decodeBackupValue(ours.value)),...meaningDependencies(decodeBackupValue(theirs.value))],visited=new Set<string>();
    for(let at=0;at<dependencies.length;at++){const key=id(dependencies[at]!);if(visited.has(key))continue;visited.add(key);const candidates=variants.get(key);const decidedOwner=candidates?.[0]?.table==='semanticMeanings'&&conflicts.has(key)&&chosen.has(key);if(!candidates?.length||(!decidedOwner&&!candidates.every(row=>backupEqual(dependencyBody(row),dependencyBody(candidates[0]!)))))throw Error('library_sync_conflict_unsupported');for(const entry of candidates)dependencies.push(...this.conflictDependencies!(entry,decodeBackupValue(entry.value)));}
    const prior=context.base.find(entry=>id(entry)===key);
    const value=decideMeaningConflict(decodeBackupValue(ours.value),decodeBackupValue(theirs.value),decodeBackupValue(selected.value),context.decision.id,context.decision.createdAt,prior?decodeBackupValue(prior.value):undefined);
    chosen.set(key,{...selected,value:encodeBackupValue(value),blocks:undefined});decided.add(selected.key);
   }
   if(decided.size||contextDecided){
    for(const entry of merged)if(['semanticRegistry','semanticContexts','semanticReceipts','media'].includes(entry.table)&&!conflicts.has(id(entry)))chosen.set(id(entry),entry);
    const retain=(key:string)=>{const present=chosen.get(key);if(present)return present;const candidates=variants.get(key);if(!candidates?.length||!candidates.every(row=>backupEqual(row.value,candidates[0]!.value)))throw Error('library_sync_conflict_unsupported');chosen.set(key,candidates[0]!);return candidates[0]!;};
    const dependencies:ReplicaRecordReference[]=[];for(const meaningId of decided)dependencies.push(...meaningDependencies(decodeBackupValue(chosen.get(id({table:'semanticMeanings',key:meaningId}))!.value)));
    const visited=new Set<string>();for(let at=0;at<dependencies.length;at++){const key=id(dependencies[at]!);if(visited.has(key))continue;visited.add(key);const row=retain(key);dependencies.push(...this.conflictDependencies!(row,decodeBackupValue(row.value)));}
    for(const [key,rows] of variants)if(rows[0]!.table==='semanticReceipts'&&decided.has(String(record(decodeBackupValue(rows[0]!.value))?.result?.personalMeaningId)))retain(key);
   }
  }
  return [...chosen.values(),...merged.filter(entry=>entry.table==='semanticReceipts'&&record(decodeBackupValue(entry.value))?.command==='AcceptPublishedLearningScene'&&!chosen.has(id(entry)))];
 },
 conflictDependencies(entry,value){
  const fact=record(value);
  if(entry.table==='sessions')return [
   ...reference('drafts',fact?.draftId),
   ...reference('meanings',fact?.meaningId),
  ];
  if(entry.table==='meanings')return [
   ...reference('drafts',fact?.draftId),
   ...reference('sessions',fact?.sessionId),
   ...registryReference('senses',fact?.senseId),
   ...registryReference('senseVersions',fact?.senseVersionId),
   ...registryReference('bindings',fact?.bindingId),
   ...registryReference('bindingVersions',fact?.bindingVersionId),
  ];
  if(entry.table==='identities')return [
   ...registryReference('senses',fact?.senseId),
   ...registryReference('senseVersions',fact?.senseVersionId),
   ...registryReference('bindings',fact?.bindingId),
   ...registryReference('bindingVersions',fact?.bindingVersionId),
  ];
  if(entry.table==='semanticDrafts')return [
   ...reference('semanticInbox',fact?.intakeId),
  ];
  if(entry.table==='semanticInbox')return [
   ...reference('semanticDrafts',fact?.intakeId),
   ...(Array.isArray(fact?.payload?.context?.mediaReferenceIds)?fact.payload.context.mediaReferenceIds.flatMap((id:unknown)=>reference('media',id)):[]),
  ];
  if(entry.table==='semanticReceipts')return [
   ...reference('semanticInbox',fact?.result?.intakeId),
   ...reference('semanticDrafts',fact?.result?.intakeId),
   ...reference('semanticMeanings',fact?.result?.personalMeaningId),
   ...reference('semanticContexts',typeof fact?.result?.contextId==='string'?`anchors:${fact.result.contextId}`:undefined),
   ...reference('semanticContexts',typeof fact?.result?.revisionId==='string'?`anchorRevisions:${fact.result.revisionId}`:undefined),
  ];
  if(entry.table==='semanticMeanings')return meaningDependencies(value);
  if(entry.table==='semanticRegistry')return registryDependencies(value);
  if(entry.table==='semanticContexts'){const context=record(fact?.value);return fact?.kind==='anchors'?[...reference('semanticContexts',typeof context?.currentRevisionId==='string'?`anchorRevisions:${context.currentRevisionId}`:undefined),...values(context?.conflictHistory?.branches).flatMap(branch=>reference('semanticContexts',typeof branch.revisionId==='string'?`anchorRevisions:${branch.revisionId}`:undefined))]:[...reference('semanticContexts',typeof context?.personalSemanticAnchorId==='string'?`anchors:${context.personalSemanticAnchorId}`:undefined),...reference('semanticContexts',typeof fact?.parentRevisionId==='string'?`anchorRevisions:${fact.parentRevisionId}`:undefined),...((context?.structuredPayload?.learningScene||context?.lifecycle)?reference('semanticReceipts',context?.provenance?.createdByOperationId):[]),...reference('media',context?.personalMediaObjectId),...(Array.isArray(context?.structuredPayload?.mediaReferenceIds)?context.structuredPayload.mediaReferenceIds.flatMap((id:unknown)=>reference('media',id)):[])];}
  return [];
 },
 assertDelete(entry){
  if(requiresPersonalSemanticWorldTombstone(entry))throw new Error('library_sync_tombstone_required');
 },
};
