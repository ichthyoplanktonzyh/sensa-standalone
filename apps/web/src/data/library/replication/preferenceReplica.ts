import type {DomainReplicaModule} from './domainReplica';

export const preferenceReplica:DomainReplicaModule={
 namespace:'library-preferences',
 owns:(table,key)=>(table==='meta'&&key==='identity')||(table==='settings'&&key!=='providers'),
 normalize(entry,identity){
  if(entry.table!=='meta'||entry.key!=='identity')return entry;
  return {...entry,value:{...(structuredClone(entry.value) as object),deviceId:identity.id}};
 },
 restore(entry,value,identity){
  if(entry.table!=='meta'||entry.key!=='identity')return value;
  return {...(structuredClone(value) as object),deviceId:identity.deviceId};
 },
};
