import type {DomainReplicaModule} from './domainReplica';

const tables=new Set([
 'drafts','sessions','meanings','identities',
 'semanticState','semanticMeanings','semanticRegistry','semanticInbox',
 'semanticDrafts','semanticReceipts',
]);

export const personalSemanticWorldReplica:DomainReplicaModule={
 namespace:'personal-semantic-world',
 owns:(table)=>tables.has(table),
 normalize(entry){
  if(entry.table!=='sessions')return entry;
  const value=structuredClone(entry.value) as {status?:string;lease?:unknown};
  if(value.status==='inflight'){value.status='stopped';value.lease=null;}
  return {...entry,value};
 },
};
