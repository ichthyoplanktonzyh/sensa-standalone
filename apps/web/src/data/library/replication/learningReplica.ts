import {reconcileConcurrentLearningEntries} from '../learningReconciliation';
import type {DomainReplicaModule,ReplicaMergeResult,ReplicaRecordReference} from './domainReplica';

const tables=new Set(['learningTargets','learningRuns','learningEvents','learningReconciliations']);
const immutableHistory=new Set(['learningRuns','learningEvents','learningReconciliations']);
const entryId=(entry:{table:string;key:string})=>JSON.stringify([entry.table,entry.key]);
const record=(value:unknown):Record<string,any>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:undefined;
const values=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
const reference=(table:ReplicaRecordReference['table'],key:unknown):ReplicaRecordReference[]=>typeof key==='string'&&key.length?[{table,key}]:[];
const references=(table:ReplicaRecordReference['table'],keys:unknown):ReplicaRecordReference[]=>values(keys).flatMap(key=>reference(table,key));
const materialDependencies=(material:unknown)=>{
 const provenance=record(record(material)?.snapshot)?.provenance;
 return [
  ...reference('contentAttempts',record(provenance)?.attemptId),
  ...reference('semanticMeanings',record(provenance)?.personalMeaningId),
 ];
};

export const learningReplica:DomainReplicaModule={
 namespace:'learning-system',
 owns:(table,key)=>tables.has(table)||(table==='meta'&&key==='learning-active'),
 merge(input,ordinary){
  const historical=input.base.filter(entry=>immutableHistory.has(entry.table));
  for(const side of [input.local,input.remote]){
   const retained=new Set(side.map(entryId));
   if(historical.some(entry=>!retained.has(entryId(entry))))throw new Error('library_sync_history');
  }
  const merged=ordinary(input);
  return reconcileConcurrentLearningEntries({...input,merged:merged.entries,conflicts:merged.conflicts}) as ReplicaMergeResult;
 },
 conflictDependencies(entry,value){
  if(entry.table==='meta')return reference('learningRuns',value);
  const fact=record(value);if(!fact)return [];
  if(entry.table==='learningTargets')return [
   ...reference('learningRuns',fact.committedPolicy?.committedByProtocolRunId),
   ...(Array.isArray(fact.curriculumMemberships)?fact.curriculumMemberships.flatMap((membership:unknown)=>{
    const item=record(membership);return [
     ...reference('packageInstallations',item?.packageKey),
     ...reference('contentAttempts',item?.provenance?.attemptId),
     ...reference('semanticMeanings',item?.provenance?.personalMeaningId),
     ...materialDependencies(item?.material),
    ];
   }):[]),
  ];
  if(entry.table==='learningRuns')return [
   ...references('learningTargets',fact.targetIds),
   ...reference('learningTargets',fact.targetId),
   ...Object.entries(record(fact.participants)??{}).flatMap(([targetId,participant])=>{
    const item=record(participant);return [
     ...reference('learningTargets',targetId),
     ...materialDependencies(item?.material),
     ...Object.values(record(item?.presentedMaterials)??{}).flatMap(materialDependencies),
    ];
   }),
   ...(Array.isArray(fact.lifecycleEvents)?fact.lifecycleEvents.flatMap((event:unknown)=>{
    const item=record(event);return item?.kind==='current_step_material_refreshed'?reference('contentAttempts',item.operationId):[];
   }):[]),
  ];
  if(entry.table==='learningEvents')return [
   ...reference('learningRuns',fact.runId),
   ...reference('learningTargets',fact.targetId),
  ];
  if(entry.table==='learningReconciliations')return [
   ...reference('learningTargets',fact.targetId),
   ...references('learningRuns',[...values(fact.appliedRunIds),...values(fact.historyOnlyRunIds),fact.selectedRunId]),
   ...references('learningEvents',[...values(fact.candidateEventIds),...values(fact.appliedEventIds),...values(fact.historyOnlyEventIds),fact.selectedEventId]),
  ];
  return [];
 },
 assertDelete(entry){
  if(immutableHistory.has(entry.table))throw new Error('library_sync_history');
 },
};
