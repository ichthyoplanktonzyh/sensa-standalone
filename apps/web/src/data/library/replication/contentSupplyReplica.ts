import type {DomainReplicaModule,ReplicaRecordReference} from './domainReplica';

const tables=new Set(['packageInstallations','personalLearning','contentAttempts']);
const reference=(table:ReplicaRecordReference['table'],key:unknown):ReplicaRecordReference[]=>typeof key==='string'&&key.length?[{table,key}]:[];

export const contentSupplyReplica:DomainReplicaModule={
 namespace:'content-supply',
 owns:(table)=>tables.has(table),
 normalize(entry){
  const value=structuredClone(entry.value) as {status?:string;leaseUntil?:number;notice?:string};
  if(entry.table==='personalLearning'&&['generating','reviewing'].includes(value.status??'')){
   value.status='failed';value.leaseUntil=0;value.notice='localFlow.restoredPreparation';
  }
  if(entry.table==='contentAttempts'&&['generating','reviewing'].includes(value.status??''))value.status='failed';
  return {...entry,value};
 },
 conflictDependencies(entry,value){
  const fact=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
  if(entry.table==='personalLearning')return [
   ...reference('semanticMeanings',fact.source?.personalMeaningId),
   ...reference('learningTargets',fact.targetId),
   ...reference('contentAttempts',fact.attemptId),
  ];
  if(entry.table==='contentAttempts')return [
   ...reference('personalLearning',fact.taskId),
   ...reference('contentAttempts',fact.resumedFrom),
   ...reference('learningTargets',fact.request?.learningTargetId),
  ];
  return [];
 },
};
