import type {DomainReplicaModule,ReplicaRecordReference} from './domainReplica';

const reference=(table:ReplicaRecordReference['table'],key:unknown):ReplicaRecordReference[]=>typeof key==='string'&&key.length?[{table,key}]:[];
const registryReference=(kind:string,key:unknown)=>reference('semanticRegistry',typeof key==='string'?`${kind}:${key}`:undefined);

/** Learner-owned media and annotations may be referenced by more than one product domain. */
export const learnerArtifactReplica:DomainReplicaModule={
 namespace:'learner-artifacts',
 owns:(table)=>table==='annotations'||table==='media',
 conflictDependencies(entry,value){
  if(entry.table!=='annotations'||!value||typeof value!=='object'||Array.isArray(value))return [];
  const annotation=value as Record<string,any>;
  if(annotation.kind==='sense_note'||annotation.kind==='saved_sense'||annotation.kind==='semantic_anchor')return registryReference('senses',annotation.senseId);
  if(annotation.kind==='learning_scene')return [
   ...reference('learningTargets',annotation.learningTargetId),
   ...reference('semanticMeanings',annotation.acceptedPersonalMeaningId),
   ...registryReference('senses',annotation.senseId),
   ...registryReference('senseVersions',annotation.senseVersionId),
   ...registryReference('bindingVersions',annotation.bindingVersionId),
  ];
  return [];
 },
};
