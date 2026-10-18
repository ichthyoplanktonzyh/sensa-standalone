import type {DomainReplicaModule,ReplicaRecordReference} from './domainReplica';
import {backupEqual,decodeBackupValue,encodeBackupValue} from '../backupCodec';
import {decideSceneConflict,mergeSceneHistory,sceneHistoryRecords} from '../../../personalContent/system/sceneConflictHistory';
import type {PersonalLearningScene} from '../../../personalContent/system/personalContentSystem';

const reference=(table:ReplicaRecordReference['table'],key:unknown):ReplicaRecordReference[]=>typeof key==='string'&&key.length?[{table,key}]:[];
const registryReference=(kind:string,key:unknown)=>reference('semanticRegistry',typeof key==='string'?`${kind}:${key}`:undefined);

/** Personal Content owns learner-created references and annotations. */
export const personalContentReplica:DomainReplicaModule={
 namespace:'personal-content',
 owns:(table)=>table==='annotations',
 assertDelete(entry){if(decodeBackupValue(entry.value)?.kind==='learning_scene')throw Error('library_sync_history');},
 *mergeSteps(input,ordinary){
  const merged=yield* ordinary(input),id=(row:{table:string;key:string})=>JSON.stringify([row.table,row.key]);
  const base=new Map(input.base.map(row=>[id(row),row])),remote=new Map(input.remote.map(row=>[id(row),row]));
  const localRows=new Map(input.local.map(row=>[id(row),row]));
  for(const row of input.base)if(decodeBackupValue(row.value)?.kind==='learning_scene'){
   const ours=localRows.get(id(row)),theirs=remote.get(id(row));
   if(!ours||!theirs||decodeBackupValue(ours.value)?.kind!=='learning_scene'||decodeBackupValue(theirs.value)?.kind!=='learning_scene')throw Error('library_sync_history');
  }
  const rows=new Map(merged.entries.map(row=>[id(row),row])),conflicts=new Set(merged.conflicts);
  for(const local of input.local){
   const key=id(local),other=remote.get(key);if(!other)continue;
   const ours=decodeBackupValue(local.value),theirs=decodeBackupValue(other.value);
   if(ours?.kind!=='learning_scene'||theirs?.kind!=='learning_scene')continue;
   const prior=base.get(key),value=mergeSceneHistory(prior?decodeBackupValue(prior.value):undefined,ours,theirs);
   if(value){rows.set(key,{...local,value:encodeBackupValue(value),blocks:undefined});conflicts.delete(key);}
   else if(!backupEqual(ours,theirs))conflicts.add(key);
   yield;
  }
  return {entries:[...rows.values()],conflicts:[...conflicts]};
 },
 afterConflictChoice(selected,_merged,context){
  const keys=new Set(context.conflicts);
  return selected.map(row=>{
   const key=JSON.stringify([row.table,row.key]),value=decodeBackupValue(row.value);
   if(!keys.has(key)||value?.kind!=='learning_scene')return row;
   const find=(branch:typeof selected)=>branch.find(candidate=>candidate.table===row.table&&candidate.key===row.key);
   const ours=find(context.local),theirs=find(context.remote),base=find(context.base);
   if(!ours||!theirs)throw Error('library_sync_conflict_unsupported');
   return {...row,value:encodeBackupValue(decideSceneConflict(decodeBackupValue(ours.value),decodeBackupValue(theirs.value),value,context.decision,base?decodeBackupValue(base.value):undefined)),blocks:undefined};
  });
 },
 conflictDependencies(entry,value){
  if(entry.table!=='annotations'||!value||typeof value!=='object'||Array.isArray(value))return [];
  const annotation=value as Record<string,any>;
  if(annotation.kind==='sense_note'||annotation.kind==='saved_sense'||annotation.kind==='sense_context')return registryReference('senses',annotation.senseId);
  if(annotation.kind==='learning_scene')return [
   ...reference('learningTargets',annotation.learningTargetId),
   ...sceneHistoryRecords(annotation as PersonalLearningScene).flatMap(scene=>reference('semanticMeanings',scene.acceptedPersonalMeaningId)),
   ...registryReference('senses',annotation.senseId),
   ...registryReference('senseVersions',annotation.senseVersionId),
   ...registryReference('bindingVersions',annotation.bindingVersionId),
  ];
  return [];
 },
};
