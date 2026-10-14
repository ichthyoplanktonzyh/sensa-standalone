import {replicaWork} from './replicaWork';
import {runCooperatively,runSynchronously} from '../../experience/personalMeaningJourney/cooperative';
import {backupEqual,encodeBackupValue} from './backupCodec';
import {validateLearningRestoreComponentCooperatively} from './backupValidation';
import type {LibraryRecordReader,LibraryRecordRows} from './libraryRecordReader';
import type {SqliteLibraryTable} from './sqliteProtocol';
import {mergeLibraryReplicasCooperatively,replicaEntryId,type LibraryReplicaEntry} from './replication/libraryReplica';
import type {SqliteSyncDependencies,SyncDependencyCertificate} from './sqliteSyncDependencies';

export class DeltaReceiveFallback extends Error{constructor(readonly reason:string){super('library_sync_delta_fallback:'+reason);}}
export type DeltaReceiveEvidence={mode:'incremental'|'complete';fallbackReason?:string;changedRecords:number;baselineBuildRecords:number;baselineRecordsRead:number;candidateRecordsRead:number;targets:number;runs:number;events:number;decisions:number;scopes:number;sessions:number;scopeRuns:number;modifiedRecords?:number;changedEventClosure?:{baselineLookups:number;candidateLookups:number;runLookups:number;indexedRelations:number;edgeVisits:number};accessByPhase?:Record<string,{baselineRecordsRead:number;candidateRecordsRead:number}>};
const fallback=(reason:string):never=>{throw new DeltaReceiveFallback(reason);};
const fail=():never=>{throw Error('libraryBackup.errors.inconsistent');};
const allow=new Set<SqliteLibraryTable>(['learningTargets','learningRuns','learningEvents','studyScopes','learningSessions','meta','settings']);
const targetFields=['memory','memoryRevision','completedAt','relearnAt','relearningState'];
const targetStructure=(value:any)=>Object.fromEntries(Object.entries(value).filter(([key])=>!targetFields.includes(key)));

/** Eligibility is field-specific. All other shapes use complete admission;
 * malformed supported facts still fail the same shared restore predicates. */
function* deltaReceiveShapeSteps(changes:readonly {table:SqliteLibraryTable;key:string;deleted?:boolean}[],base:LibraryRecordReader,remote:LibraryRecordReader):Generator<unknown,void>{
 for(const row of changes){
  yield;
  if(!allow.has(row.table)||row.table==='meta'&&!['learning-active','learning-session-active'].includes(row.key)||row.table==='settings'&&row.key!=='language-route-study-plans')fallback('structural_or_source_change');
  // Current quantity preferences have no historical Scope/Run consumers; the
  // shared restore validator checks the entire map against unchanged routes.
  if(row.deleted){if(row.table==='meta')continue;fallback('deleted_record');}
  const after=remote.get(row.table,row.key),before=base.get(row.table,row.key);if(after===undefined)fail();
  if(row.table==='learningTargets'&&(!before?.startedAt||!backupEqual(targetStructure(before),targetStructure(after))))fallback('target_structure_change');
  if(row.table==='learningRuns'&&before){
   const participants=(run:any)=>Object.fromEntries(Object.entries(run.participants).map(([key,p])=>{const participant=p as any;return [key,{protocolRunId:participant.protocolRunId,curriculumMembershipId:participant.curriculumMembershipId,languageContext:participant.languageContext,policyCommitment:participant.policyCommitment,retentionBaseline:participant.retentionBaseline,memoryRevision:participant.memoryRevision,material:participant.material}];}));
   if(!backupEqual(before.targetIds,after.targetIds)||!backupEqual(participants(before),participants(after)))fallback('run_participant_structure_change');
  }
  if(['learningEvents','studyScopes'].includes(row.table)&&before!==undefined&&!backupEqual(before,after))fallback('immutable_record_change');
 }
}

export function assertDeltaReceiveShape(changes:readonly {table:SqliteLibraryTable;key:string;deleted?:boolean}[],base:LibraryRecordReader,remote:LibraryRecordReader):void{runSynchronously(deltaReceiveShapeSteps(changes,base,remote));}

/** Select changed predicates and complete connected histories independently
 * from support point reads. Reading an unchanged source does not dirty all of
 * its consumers. Reverse queries come only from a certified baseline. */
export async function admitLearningDelta(input:{
 changes:readonly {table:LibraryReplicaEntry['table'];key:string;deleted?:boolean}[];
 base:LibraryRecordReader;remote:LibraryRecordReader;
 dependencies:SqliteSyncDependencies;certificate:SyncDependencyCertificate;
 alive:()=>void;phase?:(name:string)=>void;
}):Promise<{identity:any;prepare:()=>Promise<Array<{table:LibraryReplicaEntry['table'];key:string}>>;evidence:DeltaReceiveEvidence}>{
 const {changes,base,remote,dependencies,certificate,alive}=input;
 const targets=new Set<string>(),runs=new Set<string>(),events=new Set<string>(),decisions=new Set<string>(),scopes=new Set<string>(),sessions=new Set<string>(),scopeRuns=new Set<string>(),tasks=new Set<string>();
 const targetQueue:string[]=[],runQueue:string[]=[];
 const addTarget=(key:string)=>{if(!targets.has(key)){targets.add(key);targetQueue.push(key);}};
 const addRun=(key:string)=>{if(!runs.has(key)){runs.add(key);runQueue.push(key);}};
 const needed=(table:SqliteLibraryTable,key:string)=>remote.get(table,key)??fail();
 const changedRuns=changes.filter(row=>row.table==='learningRuns').map(row=>row.key),changedSessions=changes.filter(row=>row.table==='learningSessions').map(row=>row.key);
 const changedEventsByRun=new Map<string,Set<string>>(),changedEventClosure={baselineLookups:0,candidateLookups:0,runLookups:0,indexedRelations:0,edgeVisits:0};
 const changedRunHeaders=new Map<string,{sessionId:string;scopeId:string;protocols:Array<[string,string]>}>(),changedRunsByTarget=new Map<string,Set<string>>();
 let selection!:Map<SqliteLibraryTable,Set<string>>;
 const overlayOwners=new Map<string,{runId:string;targetId:string}>();
 await runCooperatively((function*(){
  for(const step of deltaReceiveShapeSteps(changes,base,remote)){alive();yield step;}
  alive();input.phase?.('eligibility');
 for(const runId of changedRuns){
  alive();yield;
  for(const reader of [base,remote])for(const targetId of reader.get('learningRuns',runId)?.targetIds??[]){const keys=changedRunsByTarget.get(targetId)??new Set();keys.add(runId);changedRunsByTarget.set(targetId,keys);}
  const run=needed('learningRuns',runId);changedRunHeaders.set(runId,{sessionId:run.learningSessionId,scopeId:run.studyScopeRevisionId,protocols:Object.entries(run.participants).map(([target,participant])=>[(participant as any).protocolRunId,target])});
 }
 for(const row of changes){
  alive();yield;
  if(row.table==='learningTargets')addTarget(row.key);
  if(row.table==='learningRuns')addRun(row.key);
  if(row.table==='learningEvents'){for(const reader of [base,remote]){
   if(reader===base)changedEventClosure.baselineLookups++;else changedEventClosure.candidateLookups++;
   const event=reader.get(row.table,row.key);if(event){
    addRun(event.runId);addTarget(event.targetId);
    // Candidate-local headers only. Preserve both sides' reachability, even
    // for redundant puts, without retaining decoded Event bodies.
    const keys=changedEventsByRun.get(event.runId)??new Set<string>();
    if(!keys.has(row.key)){keys.add(row.key);changedEventClosure.indexedRelations++;}
    changedEventsByRun.set(event.runId,keys);
   }
  }}
  if(row.table==='studyScopes')scopes.add(row.key);
  if(row.table==='learningSessions')sessions.add(row.key);
 }
 for(const sessionId of changedSessions){
  alive();yield;
  for(const reader of [base,remote])for(const runId of reader.get('learningSessions',sessionId)?.runIds??[])addRun(runId);
  for(const row of dependencies.keys('runSession',sessionId))addRun(row.key);
 }
 // A Run may remain in earlier Sessions' historical lists after resuming.
 for(const runId of changedRuns){alive();yield;for(const row of dependencies.keys('sessionRun',runId))sessions.add(row.key);}
 for(const runId of changedRuns){alive();yield;for(const row of dependencies.keys('runPredecessor',runId))addRun(row.key);}
 // Pointer changes can invalidate the previously active Run, too.
 for(const reader of [base,remote]){
  const runId=reader.get('meta','learning-active'),sessionId=reader.get('meta','learning-session-active');
  if(typeof runId==='string')addRun(runId);
  if(reader===remote&&typeof sessionId==='string')sessions.add(sessionId);
 }
 for(;;){
  alive();yield;if(targets.size+runs.size+events.size+decisions.size>4096)fallback('history_component_capacity');
  if(targetQueue.length){
   const targetId=targetQueue.shift()!;needed('learningTargets',targetId);
   for(const row of dependencies.keys('runTarget',targetId))addRun(row.key);
   for(const runId of changedRunsByTarget.get(targetId)??[])addRun(runId);
   for(const row of dependencies.keys('decisionTarget',targetId)){
    decisions.add(row.key);const decision=needed('learningReconciliations',row.key);
    for(const runId of [...decision.appliedRunIds,...decision.historyOnlyRunIds])addRun(runId);
   }
   continue;
  }
  if(runQueue.length){
   const runId=runQueue.shift()!;
   for(const reader of [base,remote]){const run=reader.get('learningRuns',runId);if(!run)continue;for(const targetId of run.targetIds)addTarget(targetId);if(run.continuedFromRunId)addRun(run.continuedFromRunId);for(const event of run.lifecycleEvents??[])if(event.continuedFromRunId)addRun(event.continuedFromRunId);}
   needed('learningRuns',runId);
   for(const row of dependencies.keys('eventRun',runId))events.add(row.key);
   // Reverse-query results and cached adjacency still require a live fence.
   alive();changedEventClosure.runLookups++;
   for(const key of changedEventsByRun.get(runId)??[]){alive();changedEventClosure.edgeVisits++;events.add(key);}
   continue;
  }
  break;
 }
 for(const key of targets){alive();yield;const target=needed('learningTargets',key);for(const membership of target.curriculumMemberships){const attemptId=membership.material.snapshot.provenance.attemptId;if(attemptId)tasks.add(needed('contentAttempts',attemptId).taskId);}}
 // The Session validator consumes both declared and reverse Run membership.
 for(const sessionId of sessions){
  alive();yield;
  const session=needed('learningSessions',sessionId);
  for(const runId of session.runIds)scopeRuns.add(runId);
  for(const row of dependencies.keys('runSession',sessionId))scopeRuns.add(row.key);
  for(const [runId,header]of changedRunHeaders)if(header.sessionId===sessionId)scopeRuns.add(runId);
 }
 for(const scopeId of scopes){alive();yield;for(const row of dependencies.keys('runScope',scopeId))scopeRuns.add(row.key);for(const [runId,header]of changedRunHeaders)if(header.scopeId===scopeId)scopeRuns.add(runId);}
 for(const runId of changedRuns)scopeRuns.add(runId);
 for(const reader of [base,remote]){const active=reader.get('meta','learning-active');if(typeof active==='string')scopeRuns.add(active);}
 if(scopeRuns.size+sessions.size+scopes.size>4096)fallback('session_component_capacity');
 selection=new Map<SqliteLibraryTable,Set<string>>([['learningTargets',targets],['learningRuns',runs],['learningEvents',events],['learningReconciliations',decisions],['studyScopes',scopes],['learningSessions',sessions],['personalLearning',tasks]]);
 input.phase?.('dependencyClosure');
 for(const [runId,header]of changedRunHeaders){alive();yield;for(const [protocolId,targetId]of header.protocols){if(overlayOwners.has(protocolId))fail();overlayOwners.set(protocolId,{runId,targetId});}}
 })());
 alive();
 const scoped:LibraryRecordReader={get:(table,key)=>{alive();return remote.get(table,key);},has:(table,key)=>{alive();return remote.has(table,key);},entries(table){return {[Symbol.iterator]:function*(){for(const key of [...selection.get(table)??[]].sort()){alive();yield {key,value:needed(table,key)};}}};}};
 const rows=(keys:Set<string>,table:SqliteLibraryTable):LibraryRecordRows['learningRuns']=>({[Symbol.iterator]:function*(){for(const key of keys){alive();yield {key,value:needed(table,key)};}}});
 const identity=await validateLearningRestoreComponentCooperatively(scoped,{
  packageCacheComplete:certificate.packageCacheComplete,scopeRuns:rows(scopeRuns,'learningRuns'),
  hasProtocolRunId(protocolId){alive();return overlayOwners.has(protocolId)||!!dependencies.protocolOwner(protocolId);},
  assertProtocolOwner(protocolId,runId,targetId){
   alive();const overlay=overlayOwners.get(protocolId);if(overlay&&(overlay.runId!==runId||overlay.targetId!==targetId))fail();
   const owner=dependencies.protocolOwner(protocolId);if(!owner)return;
   if(owner.run_key===runId&&owner.target_key===targetId)return;
   if(changedRuns.includes(owner.run_key)&&!Object.values(needed('learningRuns',owner.run_key).participants).some((participant:any)=>participant.protocolRunId===protocolId))return;
   fail();
  },
  sessionStarted(operationId,at,exceptId){
   alive();const keys=new Set([...dependencies.keys('sessionStart',JSON.stringify([operationId,at])).map(row=>row.key),...changedSessions]);
   return [...keys].some(key=>{const session=needed('learningSessions',key);return key!==exceptId&&session.startedByOperationId===operationId&&session.startedAt===at;});
  },
 });
 alive();input.phase?.('restoreAdmission');
 const evidence:DeltaReceiveEvidence={mode:'incremental',changedRecords:changes.length,baselineBuildRecords:0,baselineRecordsRead:0,candidateRecordsRead:0,targets:targets.size,runs:runs.size,events:events.size,decisions:decisions.size,scopes:scopes.size,sessions:sessions.size,scopeRuns:scopeRuns.size,changedEventClosure};
 return {identity,evidence,prepare:async()=>{
 // Retain the existing Learning merger over this complete affected component.
 // Only an exact remote result can use the sparse clean apply; actual conflicts
 // and derived publication fall back to the complete reconciliation path.
 const mergeKeys=new Map<string,{table:SqliteLibraryTable;key:string}>();
 const before:LibraryReplicaEntry[]=[],after:LibraryReplicaEntry[]=[];
 await runCooperatively((function*(){
  for(const [table,keys]of selection)if(table!=='personalLearning')for(const key of keys){alive();yield;mergeKeys.set(JSON.stringify([table,key]),{table,key});}
  for(const row of changes){alive();yield;mergeKeys.set(JSON.stringify([row.table,row.key]),{table:row.table,key:row.key});}
  for(const key of ['learning-active','learning-session-active'])mergeKeys.set(JSON.stringify(['meta',key]),{table:'meta',key});
  for(const [reader,entries]of [[base,before],[remote,after]] as const)for(const row of mergeKeys.values()){
   alive();yield;const value=reader.get(row.table,row.key);if(value!==undefined)entries.push({...row,table:row.table as LibraryReplicaEntry['table'],value:encodeBackupValue(value)});
  }
 })());
 const merged=await mergeLibraryReplicasCooperatively({base:before,local:before,remote:after});alive();
 const records:Array<{table:LibraryReplicaEntry['table'];key:string}>=[];
 await runCooperatively((function*(){
  const expected=new Map(after.map(row=>[replicaEntryId(row),row])),previous=new Map(before.map(row=>[replicaEntryId(row),row]));
  if(merged.conflicts.length||merged.entries.length!==after.length)fallback('domain_conflict_or_derived_publication');
  for(const row of merged.entries){alive();yield;replicaWork('admission.canonicalCompare');if(JSON.stringify(row.value)!==JSON.stringify(expected.get(replicaEntryId(row))?.value))fallback('domain_conflict_or_derived_publication');}
  for(const row of changes){alive();yield;const id=replicaEntryId(row);replicaWork('admission.changedCompare');if(JSON.stringify(previous.get(id)?.value)!==JSON.stringify(expected.get(id)?.value))records.push({table:row.table,key:row.key});}
 })());alive();

 evidence.modifiedRecords=records.length;input.phase?.('domainComparison');
 return records;
 }};
}
