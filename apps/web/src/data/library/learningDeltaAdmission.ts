import {assertSavedLearningRecordChange} from './savedLearningState';
import {replicaWork} from './replicaWork';
import {runCooperatively,runSynchronously} from '../../experience/personalMeaningJourney/cooperative';
import {backupEqual} from './backupCodec';
import {validateLearningSyncRecordsCooperatively} from './backupValidation';
import type {LibraryRecordReader} from './libraryRecordReader';
import type {SqliteLibraryTable} from './sqliteProtocol';
import {replicaEntryId,type LibraryReplicaEntry} from './replication/libraryReplica';
import type {SqliteSyncDependencies,SyncDependencyCertificate} from './sqliteSyncDependencies';

export class DeltaReceiveFallback extends Error{constructor(readonly reason:string){super('library_sync_delta_fallback:'+reason);}}
export type DeltaReceiveEvidence={mode:'incremental'|'complete';fallbackReason?:string;changedRecords:number;baselineBuildRecords:number;baselineRecordsRead:number;candidateRecordsRead:number;targets:number;runs:number;events:number;decisions:number;scopes:number;sessions:number;scopeRuns:number;modifiedRecords?:number;accessByPhase?:Record<string,{baselineRecordsRead:number;candidateRecordsRead:number}>};
type DeltaKey={table:LibraryReplicaEntry['table'];key:string;deleted?:boolean};
const fail=():never=>{throw Error('libraryBackup.errors.inconsistent');};
const allow=new Set<SqliteLibraryTable>(['learningTargets','learningRuns','learningEvents','learningReconciliations','studyScopes','learningSessions','meta','settings']);
const without=(value:any,fields:readonly string[])=>Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));

/** A sparse successor preserves existing identities and immutable witnesses.
 * Saved business outcomes are admitted directly, rather than replayed here. */
function* deltaReceiveShapeSteps(changes:readonly {table:SqliteLibraryTable;key:string;deleted?:boolean}[],base:LibraryRecordReader,remote:LibraryRecordReader):Generator<unknown,void>{
 const witnesses=new Set<string>();
 const updatedRuns=changes.filter(row=>row.table==='learningRuns'&&base.has(row.table,row.key));
 if(updatedRuns.length)for(const row of changes)if(row.table==='learningEvents'&&!row.deleted){yield;const event=remote.get(row.table,row.key),next=event?.detail.nextPresentation;if(next)witnesses.add(JSON.stringify([event.runId,next.targetId,next.stepId,next.material]));}
 for(const row of changes){
  yield;
  if(!allow.has(row.table)||row.table==='meta'&&!['learning-active','learning-session-active'].includes(row.key)||row.table==='settings'&&row.key!=='language-route-study-plans')throw new DeltaReceiveFallback('structural_or_source_change');
  if(row.deleted){if(row.table==='meta')continue;fail();}
  const after=remote.get(row.table,row.key),before=base.get(row.table,row.key);if(after===undefined)fail();
  if(before===undefined)continue;
  assertSavedLearningRecordChange(row.table,before,after,fail,witnesses,changes.some(change=>change.table==='learningReconciliations'&&remote.get(change.table,change.key)?.targetId===row.key));
  if(row.table==='learningTargets'){
   if(!backupEqual(without(before,['memory','memoryRevision','completedAt','relearnAt','relearningState']),without(after,['memory','memoryRevision','completedAt','relearnAt','relearningState'])))throw new DeltaReceiveFallback('target_structure_change');
   if(after.memoryRevision<before.memoryRevision&&!changes.some(change=>change.table==='learningReconciliations'&&remote.get(change.table,change.key)?.targetId===row.key))fail();
  }

 }
}
export function assertDeltaReceiveShape(changes:readonly {table:SqliteLibraryTable;key:string;deleted?:boolean}[],base:LibraryRecordReader,remote:LibraryRecordReader):void{runSynchronously(deltaReceiveShapeSteps(changes,base,remote));}

/** Own-account delta admission visits changed rows and their direct references.
 * Row digests, owner indexes and the final transaction fence protect the saved
 * snapshot; they make no claim about historical Protocol/FSRS correctness. */
export async function admitLearningDelta(input:{
 changes:readonly DeltaKey[];base:LibraryRecordReader;remote:LibraryRecordReader;
 revalidateKeys?:readonly Pick<DeltaKey,'table'|'key'>[];
 dependencies:SqliteSyncDependencies;certificate:SyncDependencyCertificate;alive:()=>void;
 phase?:(name:string)=>void;window?:()=>()=>void;canonical?:(side:'base'|'remote',table:SqliteLibraryTable,key:string)=>string|undefined;
 consume?:(records:DeltaKey[],changes:DeltaKey[])=>Promise<void>;
}):Promise<{identity:any;prepare:()=>Promise<Array<{table:LibraryReplicaEntry['table'];key:string}>>;evidence:DeltaReceiveEvidence}>{
 const {changes,base,remote,dependencies,alive}=input;
 const selection=new Map<SqliteLibraryTable,Set<string>>();
 const select=(table:SqliteLibraryTable,key:string)=>{const keys=selection.get(table)??new Set<string>();keys.add(key);selection.set(table,keys);};
 const needed=(table:SqliteLibraryTable,key:string)=>remote.get(table,key)??fail();
 const changedSessions=changes.filter(row=>row.table==='learningSessions').map(row=>row.key),owners=new Map<string,{runId:string;targetId:string}>();
 const release=input.window?.();replicaWork('admission.windowOpen');
 try{
  await runCooperatively((function*(){
   yield*deltaReceiveShapeSteps(changes,base,remote);alive();input.phase?.('eligibility');
   for(const row of changes){alive();yield;if(!row.deleted)select(row.table,row.key);if(row.table==='learningEvents'&&!row.deleted){const event=needed(row.table,row.key);select('learningRuns',event.runId);select('learningTargets',event.targetId);}}
   // Reverse-affected owners are revalidated without pretending they changed.
   // Eligibility and the returned patch continue to use only actual changes.
   for(const row of input.revalidateKeys??[]){alive();yield;if(!allow.has(row.table))throw new DeltaReceiveFallback('unsupported_revalidation_owner');if(remote.has(row.table,row.key))select(row.table,row.key);}
   const active=remote.get('meta','learning-active');if(typeof active==='string')select('learningRuns',active);
   for(const key of selection.get('learningRuns')??[]){alive();yield;const run=needed('learningRuns',key);for(const id of run.targetIds){yield;select('learningTargets',id);}for(const [targetId,participant]of Object.entries(run.participants) as Array<[string,any]>){const protocolId=participant.protocolRunId,prior=owners.get(protocolId);if(prior&&(prior.runId!==key||prior.targetId!==targetId))fail();owners.set(protocolId,{runId:key,targetId});}}
  })());alive();input.phase?.('directReferences');
  const scoped:LibraryRecordReader={get:(table,key)=>{alive();return remote.get(table,key);},has:(table,key)=>{alive();return remote.has(table,key);},*entries(table){for(const key of selection.get(table)??[]){alive();yield {key,value:needed(table,key)};}}};
  const identity=await validateLearningSyncRecordsCooperatively(scoped,{
   hasProtocolRunId(protocolId,targetId){alive();const overlay=owners.get(protocolId),owner=dependencies.protocolOwner(protocolId);return overlay?.targetId===targetId||owner?.target_key===targetId;},
   assertProtocolOwner(protocolId,runId,targetId){alive();const owner=dependencies.protocolOwner(protocolId),overlay=owners.get(protocolId);if(overlay&&(overlay.runId!==runId||overlay.targetId!==targetId)||owner&&(owner.run_key!==runId||owner.target_key!==targetId))fail();},
   sessionStarted(operationId,at,exceptId){alive();const keys=new Set([...dependencies.keys('sessionStart',JSON.stringify([operationId,at])).map(row=>row.key),...changedSessions]);return [...keys].some(key=>{const session=needed('learningSessions',key);return key!==exceptId&&session.startedByOperationId===operationId&&session.startedAt===at;});},
  });alive();input.phase?.('savedAdmission');
  const records:DeltaKey[]=[];
  await runCooperatively((function*(){for(const row of changes){alive();yield;replicaWork('admission.changedCompare');const same=input.canonical?input.canonical('base',row.table,row.key)===input.canonical('remote',row.table,row.key):backupEqual(base.get(row.table,row.key),remote.get(row.table,row.key));if(!same)records.push({...row});}})());alive();
  await input.consume?.(records.map(row=>({...row})),changes.map(row=>({...row})));alive();
  const count=(table:SqliteLibraryTable)=>selection.get(table)?.size??0;
  const evidence:DeltaReceiveEvidence={mode:'incremental',changedRecords:changes.length,baselineBuildRecords:0,baselineRecordsRead:0,candidateRecordsRead:0,targets:count('learningTargets'),runs:count('learningRuns'),events:count('learningEvents'),decisions:count('learningReconciliations'),scopes:count('studyScopes'),sessions:count('learningSessions'),scopeRuns:count('learningRuns'),modifiedRecords:records.length};
  return {identity,evidence,prepare:async()=>{alive();return records.map(({table,key})=>({table,key}));}};
 }finally{release?.();replicaWork('admission.windowRelease');}
}
