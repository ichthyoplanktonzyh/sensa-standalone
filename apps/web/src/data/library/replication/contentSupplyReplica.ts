import type {DomainReplicaModule} from './domainReplica';

const tables=new Set(['packageInstallations','personalLearning','contentAttempts']);

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
};

