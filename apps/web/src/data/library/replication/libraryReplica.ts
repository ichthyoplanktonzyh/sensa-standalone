import {decodeBackupValue} from '../backupCodec';
import {backupEqual} from '../backupCodec';
import {type LibraryIdentity} from '../store';
import {librarySyncTables} from '@sensa/contracts/sensa';
import {contentSupplyReplica} from './contentSupplyReplica';
import type {DomainReplicaModule,ReplicaEntry,ReplicaMergeInput,ReplicaMergeResult,ReplicaMergeSteps} from './domainReplica';
import {runCooperatively,runSynchronously} from '../../../experience/personalMeaningJourney/cooperative';
import {learningReplica} from './learningReplica';
import {personalContentReplica} from './personalContentReplica';
import {personalSemanticWorldReplica} from './personalSemanticWorldReplica';
import {preferenceReplica} from './preferenceReplica';

export type LibraryReplicaEntry=ReplicaEntry;

const modules:readonly DomainReplicaModule[]=[
 preferenceReplica,
 personalSemanticWorldReplica,
 contentSupplyReplica,
 learningReplica,
 personalContentReplica,
];

export const replicaEntryId=(entry:Pick<ReplicaEntry,'table'|'key'>)=>JSON.stringify([entry.table,entry.key]);
export const replicaEntryEqual=(left:ReplicaEntry|undefined,right:ReplicaEntry|undefined)=>left===undefined||right===undefined
 ?left===right
 :left.table===right.table&&left.key===right.key&&backupEqual(left.value,right.value);
export const replicaEntriesEqual=(left:ReplicaEntry[],right:ReplicaEntry[])=>left.length===right.length&&left.every((entry,index)=>replicaEntryEqual(entry,right[index]));

const moduleFor=(table:string,key:string)=>{
 if(!(librarySyncTables as readonly string[]).includes(table))return undefined;
 const syncTable=table as LibraryReplicaEntry['table'];
 const claimed=modules.filter(module=>module.owns(syncTable,key));
 if(claimed.length!==1)return undefined;
 return claimed[0];
};

export const isReplicatedLibraryEntry=(table:string,key:string)=>moduleFor(table,key)!==undefined;

export function normalizeLibraryReplicaEntry(entry:ReplicaEntry,identity:LibraryIdentity):ReplicaEntry{
 const module=moduleFor(entry.table,entry.key);
 if(!module)throw new Error('library_sync_format');
 return module.normalize?.(entry,identity)??entry;
}

export function restoreLibraryReplicaValue(entry:ReplicaEntry,value:unknown,identity:LibraryIdentity){
 const module=moduleFor(entry.table,entry.key);
 if(!module)throw new Error('library_sync_format');
 return module.restore?.(entry,value,identity)??value;
}

/** Exact validated bytes are copyable only when their owner has no restore
 * transform. Future domain transforms automatically retain the value path. */
export function canCopyLibraryReplicaValue(entry:Pick<ReplicaEntry,'table'|'key'>):boolean{
 const module=moduleFor(entry.table,entry.key);if(!module)throw Error('library_sync_format');return module.restore===undefined;
}

function* ordinaryMerge(input:ReplicaMergeInput):ReplicaMergeSteps{
 const index=function*(rows:ReplicaEntry[]){const result=new Map<string,ReplicaEntry>();for(const row of rows){result.set(replicaEntryId(row),row);yield;}return result;};
 const base=yield* index(input.base),local=yield* index(input.local),remote=yield* index(input.remote);
 const conflicts:string[]=[],entries:ReplicaEntry[]=[];
 for(const key of new Set([...base.keys(),...local.keys(),...remote.keys()])){
  yield;
  const prior=base.get(key),ours=local.get(key),theirs=remote.get(key);let chosen=ours;
  if(replicaEntryEqual(ours,prior))chosen=theirs;
  else if(!replicaEntryEqual(theirs,prior)&&!replicaEntryEqual(ours,theirs))conflicts.push(key);
  if(chosen)entries.push(chosen);
 }
 return {entries:entries.sort((a,b)=>replicaEntryId(a).localeCompare(replicaEntryId(b))),conflicts:conflicts.sort()};
}

/** Each domain converges only the records it owns. Body reads may be lazy and
 * repeatable; an I/O failure must never be downgraded to a domain conflict. */
function* mergeLibraryReplicaSteps(input:ReplicaMergeInput):ReplicaMergeSteps{
 let readFailed=false,readFailure:unknown;
 const observed=new WeakMap<ReplicaEntry,ReplicaEntry>();
 const observe=function*(source:ReplicaEntry[]){
  const rows:ReplicaEntry[]=[];
  for(const entry of source){
   if(!moduleFor(entry.table,entry.key))throw new Error('library_sync_format');
   let row=observed.get(entry);
   if(!row){
    row={table:entry.table,key:entry.key,blocks:entry.blocks,get value(){
     if(readFailed)throw readFailure;
     try{return entry.value;}catch(error){readFailed=true;readFailure=error;throw error;}
    }};
    observed.set(entry,row);
   }
   rows.push(row);yield;
  }
  return rows;
 };
 const branches={base:yield* observe(input.base),local:yield* observe(input.local),remote:yield* observe(input.remote)};
 const entries:ReplicaEntry[]=[],conflicts:string[]=[];
 try{
  for(const module of modules){
   const slice=(source:ReplicaEntry[])=>source.filter(entry=>module.owns(entry.table,entry.key));
   const domainInput={base:slice(branches.base),local:slice(branches.local),remote:slice(branches.remote)};
   const result=yield* (module.mergeSteps?.(domainInput,ordinaryMerge)??ordinaryMerge(domainInput));
   if(readFailed)throw readFailure;
   for(const entry of result.entries){entries.push(entry);yield;}
   for(const conflict of result.conflicts)conflicts.push(conflict);
  }
 }catch(error){
  if(readFailed)throw readFailure;
  throw error;
 }
 return {entries:entries.sort((a,b)=>replicaEntryId(a).localeCompare(replicaEntryId(b))),conflicts:[...new Set(conflicts)].sort()};
}

export const mergeLibraryReplicas=(input:ReplicaMergeInput):ReplicaMergeResult=>runSynchronously(mergeLibraryReplicaSteps(input));
export const mergeLibraryReplicasCooperatively=(input:ReplicaMergeInput):Promise<ReplicaMergeResult>=>runCooperatively(mergeLibraryReplicaSteps(input));

/** Hold a conflicting fact together with the explicit record dependencies
 * declared by its owning domain Module. */
export function partitionLibraryReplicaConflicts(input:ReplicaMergeInput&{merged:ReplicaEntry[];conflicts:string[]}){
 const all=[...input.base,...input.local,...input.remote],edges=new Map<string,Set<string>>();
 for(const row of all)edges.set(replicaEntryId(row),edges.get(replicaEntryId(row))??new Set());
 const connect=(left:string,right:string)=>{if(left===right)return;edges.get(left)!.add(right);edges.get(right)!.add(left);};
 for(const row of all){
  const id=replicaEntryId(row),module=moduleFor(row.table,row.key);
  if(!module)throw new Error('library_sync_format');
  for(const dependency of module.conflictDependencies?.(row,decodeBackupValue(row.value))??[]){
   const dependencyId=replicaEntryId(dependency);
   if(edges.has(dependencyId))connect(id,dependencyId);
  }
 }
 const blocked=new Set(input.conflicts),queue=[...blocked];
 for(let at=0;at<queue.length;at++)for(const next of edges.get(queue[at])??[])if(!blocked.has(next)){blocked.add(next);queue.push(next);}
 const select=(unblocked:ReplicaEntry[],held:ReplicaEntry[])=>[
  ...unblocked.filter(entry=>!blocked.has(replicaEntryId(entry))),
  ...held.filter(entry=>blocked.has(replicaEntryId(entry))),
 ].sort((a,b)=>replicaEntryId(a).localeCompare(replicaEntryId(b)));
 return {
  local:select(input.merged,input.local),
  upload:select(input.merged,input.remote),
  base:(published:ReplicaEntry[])=>select(published,input.base),
  affectedRecordIds:[...blocked].sort(),
 };
}

/** The owner may retain immutable audit history; it cannot silently choose a
 * different content branch or turn a conflict into an automatic merge. */
export function finalizeLibraryReplicaConflictChoice(selected:ReplicaEntry[],merged:ReplicaEntry[],context:{base:ReplicaEntry[];conflicts:readonly string[]}):ReplicaEntry[]{
 return modules.flatMap(module=>{
  const slice=(entries:ReplicaEntry[])=>entries.filter(entry=>module.owns(entry.table,entry.key));
  const chosen=slice(selected);return module.afterConflictChoice?.(chosen,slice(merged),{base:slice(context.base),conflicts:context.conflicts})??chosen;
 }).sort((a,b)=>replicaEntryId(a).localeCompare(replicaEntryId(b)));
}

export function assertLibraryReplicaDelete(entry:ReplicaEntry){
 const module=moduleFor(entry.table,entry.key);
 if(!module)throw new Error('library_sync_format');
 module.assertDelete?.(entry);
}

/** Produce the atomic local mutation set; delete semantics stay domain-owned. */
export function planLibraryReplicaApply(current:ReplicaEntry[],desired:ReplicaEntry[]){
 const next=new Map(desired.map(entry=>[replicaEntryId(entry),entry]));
 const before=new Map(current.map(entry=>[replicaEntryId(entry),entry]));
 const deletes=current.filter(entry=>!next.has(replicaEntryId(entry)));
 for(const entry of deletes)assertLibraryReplicaDelete(entry);
 const puts=desired.filter(entry=>!replicaEntryEqual(before.get(replicaEntryId(entry)),entry));
 return {deletes,puts};
}
