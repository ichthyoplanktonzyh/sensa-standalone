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

type DeltaKey={table:LibraryReplicaEntry['table'];key:string;deleted?:boolean};
type DeltaComponent={selection:Map<SqliteLibraryTable,Set<string>>;changes:DeltaKey[];scopeRuns:Set<string>;mergeMeta?:Set<string>};
type RunLink={table:'learningTargets'|'learningRuns'|'learningSessions'|'studyScopes';key:string};
const graphLimit=4*1024*1024,utf8=new TextEncoder();
function* runLinks(run:any):Generator<RunLink>{
 for(const key of run.targetIds)yield {table:'learningTargets',key};
 if(run.continuedFromRunId)yield {table:'learningRuns',key:run.continuedFromRunId};
 if(run.learningSessionId)yield {table:'learningSessions',key:run.learningSessionId};
 if(run.studyScopeRevisionId)yield {table:'studyScopes',key:run.studyScopeRevisionId};
 for(const event of run.lifecycleEvents??[]){if(event.continuedFromRunId)yield {table:'learningRuns',key:event.continuedFromRunId};if(event.learningSessionId)yield {table:'learningSessions',key:event.learningSessionId};}
}

/** Partition execution, never admission: every selected row is still checked.
 * Shared Runs, predecessors, historical Sessions and Scopes join components.
 * Reconciliation keeps its original collective frontier in one component. */
export async function deltaComponents(selection:Map<SqliteLibraryTable,Set<string>>,changes:readonly DeltaKey[],scopeRuns:Set<string>,links:Map<string,RunLink[]>|undefined,base:LibraryRecordReader,remote:LibraryRecordReader,alive:()=>void,retainedLinkBytes=0):Promise<DeltaComponent[]>{
 const whole=()=>[{selection,changes:[...changes],scopeRuns,mergeMeta:new Set(['learning-active','learning-session-active'])}];
 if(selection.get('learningReconciliations')!.size)return whole();
 if(!links){replicaWork('component.graphBypass');return whole();}
 const parents=new Map<string,string>();let bytes=retainedLinkBytes,edges=0;const uncertain=Symbol('component graph capacity or shape');
 const id=(table:string,key:string)=>JSON.stringify([table,key]);
 const charge=(cost:number)=>{if(bytes+cost>graphLimit)throw uncertain;bytes+=cost;};
 const node=(key:string)=>{if(!parents.has(key)){charge(64+2*utf8.encode(key).length);parents.set(key,key);}};
 const root=(key:string):string=>{node(key);let current=key;while(parents.get(current)!==current)current=parents.get(current)!;while(parents.get(key)!==key){const next=parents.get(key)!;parents.set(key,current);key=next;}return current;};
 const join=(left:string,right:string)=>{alive();charge(64+2*(utf8.encode(left).length+utf8.encode(right).length));edges++;const a=root(left),b=root(right);if(a!==b)parents.set(b,a);};
 try{await runCooperatively((function*(){
  for(const [table,keys]of selection)for(const key of keys){alive();yield;node(id(table,key));}
  for(const change of changes){alive();yield;node(id(change.table,change.key));}
  for(const runId of new Set([...selection.get('learningRuns')!,...scopeRuns])){
   alive();yield;
   const runKey=id('learningRuns',runId);node(runKey);
   const saved=links.get(runId);
   if(saved){for(const link of saved){alive();yield;join(runKey,id(link.table,link.key));}}
   else for(const reader of [base,remote]){const run=reader.get('learningRuns',runId);if(run)for(const link of runLinks(run)){alive();yield;join(runKey,id(link.table,link.key));}}

  }
  for(const table of ['learningEvents','learningSessions','studyScopes','personalLearning'] as const)for(const key of selection.get(table)??[]){
   alive();yield;
   for(const reader of [base,remote]){const value=reader.get(table,key);if(!value)continue;
    if(table==='learningEvents'){join(id(table,key),id('learningRuns',value.runId));join(id(table,key),id('learningTargets',value.targetId));}
    if(table==='learningSessions'){if(!Array.isArray(value.runIds))throw uncertain;join(id(table,key),id('studyScopes',value.scopeRevisionId));for(const runId of value.runIds){alive();yield;join(id(table,key),id('learningRuns',runId));}}
    if(table==='studyScopes'){if(!Array.isArray(value.members))throw uncertain;for(const member of value.members){alive();yield;if(!member||typeof member.targetId!=='string')throw uncertain;join(id(table,key),id('learningTargets',member.targetId));}}
    if(table==='personalLearning')join(id(table,key),id('learningTargets',value.targetId));
   }
  }
  // Both pointer sides join the same execution component. Point reads and
  // global owner/negative-query callbacks still see the whole candidate.
  for(const reader of [base,remote])for(const [key,table]of [['learning-active','learningRuns'],['learning-session-active','learningSessions']] as const){alive();yield;const value=reader.get('meta',key);if(typeof value==='string')join(id('meta','learning-active'),id(table,value));}
  if(parents.has(id('meta','learning-active')))join(id('meta','learning-active'),id('meta','learning-session-active'));
 })());alive();}catch(cause){if(cause!==uncertain)throw cause;alive();replicaWork('component.graphBypass');return whole();}
 const groups=new Map<string,DeltaComponent>();
 const group=(table:string,key:string)=>{const identity=root(id(table,key));let value=groups.get(identity);if(!value){value={selection:new Map([...selection.keys()].map(table=>[table,new Set<string>()])),changes:[],scopeRuns:new Set()};groups.set(identity,value);}return value;};
 await runCooperatively((function*(){
 for(const [table,keys]of selection)for(const key of keys){alive();yield;group(table,key).selection.get(table)!.add(key);}
 for(const change of changes){alive();yield;group(change.table,change.key).changes.push(change);}
 for(const key of scopeRuns){alive();yield;group('learningRuns',key).scopeRuns.add(key);}
 // Preserve the original merge inventory's two active metadata keys.
 for(const key of ['learning-active','learning-session-active'])if(parents.has(id('meta',key))){const component=group('meta',key);(component.mergeMeta??=new Set()).add(key);}
 })());alive();
 if(!groups.size)return whole();
 replicaWork('component.graphBytes',bytes);replicaWork('component.graphEdges',edges);return [...groups.values()];
}

/** Select changed predicates and complete connected histories independently
 * from support point reads. Reading an unchanged source does not dirty all of
 * its consumers. Reverse queries come only from a certified baseline. */
export async function admitLearningDelta(input:{
 changes:readonly {table:LibraryReplicaEntry['table'];key:string;deleted?:boolean}[];
 base:LibraryRecordReader;remote:LibraryRecordReader;
 dependencies:SqliteSyncDependencies;certificate:SyncDependencyCertificate;
 alive:()=>void;phase?:(name:string)=>void;
 window?:()=>()=>void;canonical?:(side:'base'|'remote',table:SqliteLibraryTable,key:string)=>string|undefined;
 consume?:(records:DeltaKey[],changes:DeltaKey[])=>Promise<void>;
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
 const links=new Map<string,RunLink[]>();let linkBytes=0,linksOverflow=false;
 const overlayOwners=new Map<string,{runId:string;targetId:string}>();
 await runCooperatively((function*(){
  for(const step of deltaReceiveShapeSteps(changes,base,remote)){alive();yield step;}
  alive();input.phase?.('eligibility');
 for(const runId of changedRuns){
  alive();yield;
  for(const reader of [base,remote])for(const targetId of reader.get('learningRuns',runId)?.targetIds??[]){alive();yield;const keys=changedRunsByTarget.get(targetId)??new Set();keys.add(runId);changedRunsByTarget.set(targetId,keys);}
  const run=needed('learningRuns',runId),protocols:Array<[string,string]>=[];for(const [target,participant]of Object.entries(run.participants)){alive();yield;protocols.push([(participant as any).protocolRunId,target]);}changedRunHeaders.set(runId,{sessionId:run.learningSessionId,scopeId:run.studyScopeRevisionId,protocols});
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
   const related:RunLink[]=[],seen=new Set<string>();
   for(const reader of [base,remote]){const run=reader.get('learningRuns',runId);if(!run)continue;
    for(const targetId of run.targetIds){alive();yield;addTarget(targetId);}if(run.continuedFromRunId)addRun(run.continuedFromRunId);for(const event of run.lifecycleEvents??[]){alive();yield;if(event.continuedFromRunId)addRun(event.continuedFromRunId);}
    if(!linksOverflow)for(const link of runLinks(run)){alive();yield;const identity=JSON.stringify([link.table,link.key]);
     // Charge processed duplicates too: a high-degree row with few distinct
     // endpoints must not create an unbounded optional partitioning pass.
     const cost=96+4*utf8.encode(identity).length;if(linkBytes+cost>graphLimit){linksOverflow=true;links.clear();related.length=0;seen.clear();linkBytes=0;replicaWork('component.linksBypass');break;}
     linkBytes+=cost;if(seen.has(identity))continue;seen.add(identity);related.push(link);
    }
   }
   if(!linksOverflow)links.set(runId,related);needed('learningRuns',runId);
   for(const row of dependencies.keys('eventRun',runId))events.add(row.key);
   // Reverse-query results and cached adjacency still require a live fence.
   alive();changedEventClosure.runLookups++;
   for(const key of changedEventsByRun.get(runId)??[]){alive();changedEventClosure.edgeVisits++;events.add(key);}
   continue;
  }
  break;
 }
 for(const key of targets){alive();yield;const target=needed('learningTargets',key);for(const membership of target.curriculumMemberships){alive();yield;const attemptId=membership.material.snapshot.provenance.attemptId;if(attemptId)tasks.add(needed('contentAttempts',attemptId).taskId);}}
 // The Session validator consumes both declared and reverse Run membership.
 for(const sessionId of sessions){
  alive();yield;
  const session=needed('learningSessions',sessionId);
  for(const runId of session.runIds){alive();yield;scopeRuns.add(runId);}
  for(const row of dependencies.keys('runSession',sessionId)){alive();yield;scopeRuns.add(row.key);}
  for(const [runId,header]of changedRunHeaders)if(header.sessionId===sessionId)scopeRuns.add(runId);
 }
 for(const scopeId of scopes){alive();yield;for(const row of dependencies.keys('runScope',scopeId)){alive();yield;scopeRuns.add(row.key);}for(const [runId,header]of changedRunHeaders)if(header.scopeId===scopeId)scopeRuns.add(runId);}
 for(const runId of changedRuns)scopeRuns.add(runId);
 for(const reader of [base,remote]){const active=reader.get('meta','learning-active');if(typeof active==='string')scopeRuns.add(active);}
 if(scopeRuns.size+sessions.size+scopes.size>4096)fallback('session_component_capacity');
 selection=new Map<SqliteLibraryTable,Set<string>>([['learningTargets',targets],['learningRuns',runs],['learningEvents',events],['learningReconciliations',decisions],['studyScopes',scopes],['learningSessions',sessions],['personalLearning',tasks]]);
 input.phase?.('dependencyClosure');
 for(const [runId,header]of changedRunHeaders){alive();yield;for(const [protocolId,targetId]of header.protocols){if(overlayOwners.has(protocolId))fail();overlayOwners.set(protocolId,{runId,targetId});}}
 })());
 alive();
 let components:DeltaComponent[];try{components=await deltaComponents(selection,changes,scopeRuns,linksOverflow?undefined:links,base,remote,alive,linkBytes);}finally{links.clear();}
 const evidence:DeltaReceiveEvidence={mode:'incremental',changedRecords:changes.length,baselineBuildRecords:0,baselineRecordsRead:0,candidateRecordsRead:0,targets:targets.size,runs:runs.size,events:events.size,decisions:decisions.size,scopes:scopes.size,sessions:sessions.size,scopeRuns:scopeRuns.size,changedEventClosure};
 const records:DeltaKey[]=[];let identity:any;
 for(const component of components){
  alive();const release=input.window?.();replicaWork('component.open');
  try{
   const scoped:LibraryRecordReader={get:(table,key)=>{alive();return remote.get(table,key);},has:(table,key)=>{alive();return remote.has(table,key);},entries(table){return {[Symbol.iterator]:function*(){for(const key of [...component.selection.get(table)??[]].sort()){alive();yield {key,value:needed(table,key)};}}};}};
   const rows=(keys:Set<string>,table:SqliteLibraryTable):LibraryRecordRows['learningRuns']=>({[Symbol.iterator]:function*(){for(const key of keys){alive();yield {key,value:needed(table,key)};}}});
   const admitted=await validateLearningRestoreComponentCooperatively(scoped,{
  packageCacheComplete:certificate.packageCacheComplete,scopeRuns:rows(component.scopeRuns,'learningRuns'),
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
   });alive();if(identity&&!backupEqual(identity,admitted))fail();identity=admitted;
   // Run the unchanged merger while this component's exact inputs are resident.
   const mergeKeys=new Map<string,DeltaKey>();
   for(const [table,keys]of component.selection)if(table!=='personalLearning')for(const key of keys)mergeKeys.set(JSON.stringify([table,key]),{table:table as DeltaKey['table'],key});
   for(const key of component.mergeMeta??[])mergeKeys.set(JSON.stringify(['meta',key]),{table:'meta',key});
   for(const row of component.changes)mergeKeys.set(JSON.stringify([row.table,row.key]),row);
   let inputBytes=0;const before:LibraryReplicaEntry[]=[],after:LibraryReplicaEntry[]=[],texts={base:new Map<string,string>(),remote:new Map<string,string>()};
   await runCooperatively((function*(){
    for(const [side,reader,entries]of [['base',base,before],['remote',remote,after]] as const)for(const row of mergeKeys.values()){
     alive();yield;const canonical=input.canonical?input.canonical(side,row.table,row.key):(()=>{const value=reader.get(row.table,row.key);return value===undefined?undefined:JSON.stringify(encodeBackupValue(value));})();
     if(canonical!==undefined){inputBytes+=2*new TextEncoder().encode(canonical).length;if(inputBytes>4*1024*1024)fallback('component_body_capacity');texts[side].set(replicaEntryId(row),canonical);entries.push({table:row.table,key:row.key,value:JSON.parse(canonical)});}
    }
   })());
   replicaWork('component.mergeBytes',inputBytes);const merged=await mergeLibraryReplicasCooperatively({base:before,local:before,remote:after});alive();
   const changed:DeltaKey[]=[];
   await runCooperatively((function*(){
    if(merged.conflicts.length||merged.entries.length!==after.length)fallback('domain_conflict_or_derived_publication');
    for(const row of merged.entries){alive();yield;replicaWork('admission.canonicalCompare');if(JSON.stringify(row.value)!==texts.remote.get(replicaEntryId(row)))fallback('domain_conflict_or_derived_publication');}
    for(const row of component.changes){alive();yield;replicaWork('admission.changedCompare');const key=replicaEntryId(row);if(texts.base.get(key)!==texts.remote.get(key))changed.push({table:row.table,key:row.key,deleted:row.deleted});}
   })());alive();await input.consume?.(changed.map(row=>({...row})),component.changes.map(row=>({...row})));alive();records.push(...changed);
  }finally{release?.();replicaWork('component.release');}
 }
 const order=new Map(changes.map((row,index)=>[replicaEntryId(row),index]));records.sort((a,b)=>order.get(replicaEntryId(a))!-order.get(replicaEntryId(b))!);
 evidence.modifiedRecords=records.length;input.phase?.('restoreAdmission');input.phase?.('domainComparison');
 return {identity,evidence,prepare:async()=>{alive();return records.map(({table,key})=>({table,key}));}};
}
