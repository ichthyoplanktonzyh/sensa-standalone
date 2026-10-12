import {backupEqual,encodeBackupValue} from './backupCodec';
import {validateLearningRestoreComponentCooperatively} from './backupValidation';
import type {LibraryRecordReader,LibraryRecordRows} from './libraryRecordReader';
import type {SqliteLibraryTable} from './sqliteProtocol';
import {mergeLibraryReplicasCooperatively,replicaEntryEqual,replicaEntryId,type LibraryReplicaEntry} from './replication/libraryReplica';
import type {SqliteSyncDependencies,SyncDependencyCertificate} from './sqliteSyncDependencies';

export class DeltaReceiveFallback extends Error{constructor(readonly reason:string){super('library_sync_delta_fallback:'+reason);}}
export type DeltaReceiveEvidence={mode:'incremental'|'complete';fallbackReason?:string;changedRecords:number;baselineBuildRecords:number;baselineRecordsRead:number;candidateRecordsRead:number;targets:number;runs:number;events:number;decisions:number;scopes:number;sessions:number;scopeRuns:number;modifiedRecords?:number;accessByPhase?:Record<string,{baselineRecordsRead:number;candidateRecordsRead:number}>};
const fallback=(reason:string):never=>{throw new DeltaReceiveFallback(reason);};
const fail=():never=>{throw Error('libraryBackup.errors.inconsistent');};
const allow=new Set<SqliteLibraryTable>(['learningTargets','learningRuns','learningEvents','studyScopes','learningSessions','meta']);
const targetFields=['memory','memoryRevision','completedAt','relearnAt','relearningState'];
const targetStructure=(value:any)=>Object.fromEntries(Object.entries(value).filter(([key])=>!targetFields.includes(key)));

/** Eligibility is field-specific. All other shapes use complete admission;
 * malformed supported facts still fail the same shared restore predicates. */
export function assertDeltaReceiveShape(changes:readonly {table:SqliteLibraryTable;key:string;deleted?:boolean}[],base:LibraryRecordReader,remote:LibraryRecordReader):void{
 for(const row of changes){
  if(!allow.has(row.table)||row.table==='meta'&&!['learning-active','learning-session-active'].includes(row.key))fallback('structural_or_source_change');
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
 assertDeltaReceiveShape(changes,base,remote);alive();input.phase?.('eligibility');
 const targets=new Set<string>(),runs=new Set<string>(),events=new Set<string>(),decisions=new Set<string>(),scopes=new Set<string>(),sessions=new Set<string>(),scopeRuns=new Set<string>(),tasks=new Set<string>();
 const targetQueue:string[]=[],runQueue:string[]=[];
 const addTarget=(key:string)=>{if(!targets.has(key)){targets.add(key);targetQueue.push(key);}};
 const addRun=(key:string)=>{if(!runs.has(key)){runs.add(key);runQueue.push(key);}};
 const needed=(table:SqliteLibraryTable,key:string)=>remote.get(table,key)??fail();
 const changedRuns=changes.filter(row=>row.table==='learningRuns').map(row=>row.key),changedEvents=changes.filter(row=>row.table==='learningEvents').map(row=>row.key),changedSessions=changes.filter(row=>row.table==='learningSessions').map(row=>row.key);
 const changedRunHeaders=new Map<string,{sessionId:string;scopeId:string;protocols:Array<[string,string]>}>(),changedRunsByTarget=new Map<string,Set<string>>();
 for(const runId of changedRuns){
  for(const reader of [base,remote])for(const targetId of reader.get('learningRuns',runId)?.targetIds??[]){const keys=changedRunsByTarget.get(targetId)??new Set();keys.add(runId);changedRunsByTarget.set(targetId,keys);}
  const run=needed('learningRuns',runId);changedRunHeaders.set(runId,{sessionId:run.learningSessionId,scopeId:run.studyScopeRevisionId,protocols:Object.entries(run.participants).map(([target,participant])=>[(participant as any).protocolRunId,target])});
 }
 for(const row of changes){
  if(row.table==='learningTargets')addTarget(row.key);
  if(row.table==='learningRuns')addRun(row.key);
  if(row.table==='learningEvents'){for(const reader of [base,remote]){const event=reader.get(row.table,row.key);if(event){addRun(event.runId);addTarget(event.targetId);}}}
  if(row.table==='studyScopes')scopes.add(row.key);
  if(row.table==='learningSessions')sessions.add(row.key);
 }
 for(const sessionId of changedSessions){
  for(const reader of [base,remote])for(const runId of reader.get('learningSessions',sessionId)?.runIds??[])addRun(runId);
  for(const row of dependencies.keys('runSession',sessionId))addRun(row.key);
 }
 // A Run may remain in earlier Sessions' historical lists after resuming.
 for(const runId of changedRuns)for(const row of dependencies.keys('sessionRun',runId))sessions.add(row.key);
 for(const runId of changedRuns)for(const row of dependencies.keys('runPredecessor',runId))addRun(row.key);
 // Pointer changes can invalidate the previously active Run, too.
 for(const reader of [base,remote]){
  const runId=reader.get('meta','learning-active'),sessionId=reader.get('meta','learning-session-active');
  if(typeof runId==='string')addRun(runId);
  if(reader===remote&&typeof sessionId==='string')sessions.add(sessionId);
 }
 for(;;){
  alive();if(targets.size+runs.size+events.size+decisions.size>4096)fallback('history_component_capacity');
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
   for(const key of changedEvents)if(needed('learningEvents',key).runId===runId)events.add(key);
   continue;
  }
  break;
 }
 for(const key of targets){const target=needed('learningTargets',key);for(const membership of target.curriculumMemberships){const attemptId=membership.material.snapshot.provenance.attemptId;if(attemptId)tasks.add(needed('contentAttempts',attemptId).taskId);}}
 // The Session validator consumes both declared and reverse Run membership.
 for(const sessionId of sessions){
  const session=needed('learningSessions',sessionId);
  for(const runId of session.runIds)scopeRuns.add(runId);
  for(const row of dependencies.keys('runSession',sessionId))scopeRuns.add(row.key);
  for(const [runId,header]of changedRunHeaders)if(header.sessionId===sessionId)scopeRuns.add(runId);
 }
 for(const scopeId of scopes){for(const row of dependencies.keys('runScope',scopeId))scopeRuns.add(row.key);for(const [runId,header]of changedRunHeaders)if(header.scopeId===scopeId)scopeRuns.add(runId);}
 for(const runId of changedRuns)scopeRuns.add(runId);
 for(const reader of [base,remote]){const active=reader.get('meta','learning-active');if(typeof active==='string')scopeRuns.add(active);}
 if(scopeRuns.size+sessions.size+scopes.size>4096)fallback('session_component_capacity');
 const selection=new Map<SqliteLibraryTable,Set<string>>([['learningTargets',targets],['learningRuns',runs],['learningEvents',events],['learningReconciliations',decisions],['studyScopes',scopes],['learningSessions',sessions],['personalLearning',tasks]]);
 const scoped:LibraryRecordReader={get:(table,key)=>{alive();return remote.get(table,key);},has:(table,key)=>{alive();return remote.has(table,key);},entries(table){return {[Symbol.iterator]:function*(){for(const key of [...selection.get(table)??[]].sort()){alive();yield {key,value:needed(table,key)};}}};}};
 const rows=(keys:Set<string>,table:SqliteLibraryTable):LibraryRecordRows['learningRuns']=>({[Symbol.iterator]:function*(){for(const key of keys){alive();yield {key,value:needed(table,key)};}}});
 input.phase?.('dependencyClosure');
 const overlayOwners=new Map<string,{runId:string;targetId:string}>();
 for(const [runId,header]of changedRunHeaders)for(const [protocolId,targetId]of header.protocols){if(overlayOwners.has(protocolId))fail();overlayOwners.set(protocolId,{runId,targetId});}
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
 const evidence:DeltaReceiveEvidence={mode:'incremental',changedRecords:changes.length,baselineBuildRecords:0,baselineRecordsRead:0,candidateRecordsRead:0,targets:targets.size,runs:runs.size,events:events.size,decisions:decisions.size,scopes:scopes.size,sessions:sessions.size,scopeRuns:scopeRuns.size};
 return {identity,evidence,prepare:async()=>{
 // Retain the existing Learning merger over this complete affected component.
 // Only an exact remote result can use the sparse clean apply; actual conflicts
 // and derived publication fall back to the complete reconciliation path.
 const mergeKeys=new Map<string,{table:SqliteLibraryTable;key:string}>();
 for(const [table,keys]of selection)if(table!=='personalLearning')for(const key of keys)mergeKeys.set(JSON.stringify([table,key]),{table,key});
 for(const key of ['learning-active','learning-session-active'])mergeKeys.set(JSON.stringify(['meta',key]),{table:'meta',key});
 const entries=(reader:LibraryRecordReader):LibraryReplicaEntry[]=>[...mergeKeys.values()].flatMap(row=>{const value=reader.get(row.table,row.key);return value===undefined?[]:[{...row,table:row.table as LibraryReplicaEntry['table'],value:encodeBackupValue(value)}];});
 const before=entries(base),after=entries(remote),merged=await mergeLibraryReplicasCooperatively({base:before,local:before,remote:after});alive();
 const expected=new Map(after.map(row=>[replicaEntryId(row),row]));
 if(merged.conflicts.length||merged.entries.length!==after.length||merged.entries.some(row=>!replicaEntryEqual(row,expected.get(replicaEntryId(row)))))fallback('domain_conflict_or_derived_publication');
 const records=changes.filter(row=>!backupEqual(base.get(row.table,row.key),remote.get(row.table,row.key))).map(({table,key})=>({table,key}));

 evidence.modifiedRecords=records.length;input.phase?.('domainComparison');
 return records;
 }};
}
