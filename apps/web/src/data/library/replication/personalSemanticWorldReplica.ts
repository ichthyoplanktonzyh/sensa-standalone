import type {DomainReplicaModule,ReplicaRecordReference} from './domainReplica';
import {mergePersonalSemanticWorldReplica,requiresPersonalSemanticWorldTombstone} from './personalSemanticWorldMerge';

const tables=new Set([
 'drafts','sessions','meanings','identities',
 'semanticState','semanticMeanings','semanticRegistry','semanticInbox',
 'semanticDrafts','semanticReceipts',
]);

const record=(value:unknown):Record<string,any>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:undefined;
const reference=(table:ReplicaRecordReference['table'],key:unknown):ReplicaRecordReference[]=>typeof key==='string'&&key.length?[{table,key}]:[];
const registryReference=(kind:string,key:unknown)=>reference('semanticRegistry',typeof key==='string'?`${kind}:${key}`:undefined);
const values=(value:unknown):Record<string,any>[]=>Array.isArray(value)?value.flatMap(item=>record(item)??[]):[];

function meaningDependencies(value:unknown){
 const meaning=record(value);if(!meaning)return [];
 const references:ReplicaRecordReference[]=[];
 for(const revision of values(meaning.personalSemanticAnchorRevisions))references.push(...reference('media',revision.personalMediaObjectId));
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

function registryDependencies(value:unknown){
 const row=record(value),fact=record(row?.value);if(!row||!fact)return [];
 if(row.kind==='senses')return registryReference('senseVersions',fact.currentSenseVersionId);
 if(row.kind==='senseVersions')return registryReference('senses',fact.senseId);
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
 ];
 return [];
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
 merge(input,ordinary){return mergePersonalSemanticWorldReplica(input,ordinary);},
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
  ];
  if(entry.table==='semanticMeanings')return meaningDependencies(value);
  if(entry.table==='semanticRegistry')return registryDependencies(value);
  return [];
 },
 assertDelete(entry){
  if(requiresPersonalSemanticWorldTombstone(entry))throw new Error('library_sync_tombstone_required');
 },
};
