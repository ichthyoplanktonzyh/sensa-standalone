import {reconcileConcurrentLearningEntries} from '../learningReconciliation';
import type {DomainReplicaModule,ReplicaMergeResult} from './domainReplica';

const tables=new Set(['learningTargets','learningRuns','learningEvents','learningReconciliations']);
const immutableHistory=new Set(['learningRuns','learningEvents','learningReconciliations']);
const entryId=(entry:{table:string;key:string})=>JSON.stringify([entry.table,entry.key]);

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
 assertDelete(entry){
  if(immutableHistory.has(entry.table))throw new Error('library_sync_history');
 },
};
