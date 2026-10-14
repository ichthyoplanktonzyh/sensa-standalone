import {stableUuid,canonicalJsonDigest} from '@sensa/learning-kernel';
import {z} from 'zod';

import {backupEqual,decodeBackupValue,encodeBackupValue} from './backupCodec';
import type {LibraryRecordReader} from './libraryRecordReader';
import {runSynchronously} from '../../experience/personalMeaningJourney/cooperative';

export const learningReconciliationAlgorithm = 'latest-completed-learning-branch-v3' as const
const legacyAlgorithm='latest-completed-learning-branch-v2' as const;

type SyncEntry={table:string;key:string;value:unknown;blocks?:string[]};
type LearningEventLike={id:string;runId:string;targetId:string;at:string};
type LearningRunLike={id:string;targetIds:string[];completedAt:string|null;participants?:Record<string,{memoryRevision:number}>};
type LearningTargetLike={id:string;retentionId:string;[key:string]:unknown};

export type LearningReconciliationDecision={
 id:string;
 targetId:string;
 retentionId:string;
 algorithm:typeof learningReconciliationAlgorithm|typeof legacyAlgorithm;
 supersededDecisionIds:string[];
 candidateEventIds:string[];
 appliedEventIds:string[];
 appliedRunIds:string[];
 historyOnlyEventIds:string[];
 historyOnlyRunIds:string[];
 selectedRunId:string;
 selectedEventId:string;
 decidedAt:string;
};

const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
const decisionSchema=z.object({
 id:uuid,targetId:uuid,retentionId:uuid,algorithm:z.enum([legacyAlgorithm,learningReconciliationAlgorithm]),
 supersededDecisionIds:z.array(uuid),
 candidateEventIds:z.array(uuid).min(2),appliedEventIds:z.array(uuid).min(1),
 appliedRunIds:z.array(uuid).min(1),
 historyOnlyEventIds:z.array(uuid).min(1),historyOnlyRunIds:z.array(uuid).min(1),
 selectedRunId:uuid,selectedEventId:uuid,decidedAt:timestamp,
}).strict();

const entryId=(table:string,key:string)=>JSON.stringify([table,key]);
const decoded=<T>(entry:SyncEntry|undefined):T|undefined=>entry?decodeBackupValue(entry.value) as T:undefined;
const mapFor=(entries:readonly SyncEntry[])=>new Map(entries.map(entry=>[entryId(entry.table,entry.key),entry]));
const idOrder=(left:string,right:string)=>left<right?-1:left>right?1:0;
const later=(left:LearningEventLike,right:LearningEventLike)=>Date.parse(left.at)-Date.parse(right.at)||idOrder(left.id,right.id);
type CompletedRunHeader=Pick<LearningRunLike,'id'|'completedAt'> & {memoryRevision?:number};
const laterRun=(left:CompletedRunHeader,right:CompletedRunHeader)=>Date.parse(left.completedAt??'')-Date.parse(right.completedAt??'')||idOrder(left.id,right.id);
const sortedUnique=(values:readonly string[])=>[...new Set(values)].sort();

/** Learning state is a projection. Ignore only fields written by starting or
 * settling a Protocol Run; every learner/content/policy field must still agree. */
function structuralTarget(target:LearningTargetLike){
 const value=structuredClone(target) as Record<string,unknown>;
 for(const key of ['startedAt','completedAt','memory','memoryRevision','relearnAt','relearningState','introducedLanguageRouteId','curriculumMemberships'])delete value[key];
 const commitment=value.committedPolicy as Record<string,unknown>|null|undefined;
 if(commitment)value.committedPolicy={
  commitmentId:commitment.commitmentId,revision:commitment.revision,
  assignmentId:commitment.assignmentId,assignmentRevision:commitment.assignmentRevision,
  profileId:commitment.profileId,profileVersion:commitment.profileVersion,
 };
 return value;
}

/** Source additions do not choose a scheduling branch. A shared membership
 * must retain exactly the same immutable source and revision on both sides. */
function sourceUnion(base:LearningTargetLike|undefined,left:LearningTargetLike,right:LearningTargetLike):unknown[]|null{
 const ours=left.curriculumMemberships,theirs=right.curriculumMemberships;
 if(ours===undefined&&theirs===undefined)return [];
 if(!Array.isArray(ours)||!Array.isArray(theirs))return null;
 const rows=new Map<string,any>();
 for(const row of [...ours,...theirs]){
  if(!row||typeof row.id!=='string'||rows.has(row.id)&&!backupEqual(rows.get(row.id),row))return null;
  rows.set(row.id,row);
 }
 const retained=Array.isArray(base?.curriculumMemberships)?base.curriculumMemberships:[];
 if(retained.some(row=>!ours.some(item=>item.id===row.id)||!theirs.some(item=>item.id===row.id)))return null;
 const ordered=retained.map(row=>rows.get(row.id)),known=new Set(retained.map(row=>row.id));
 return [...ordered,...[...rows.values()].filter(row=>!known.has(row.id)).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||a.id.localeCompare(b.id))];
}
const savedState=(target:LearningTargetLike)=>Object.fromEntries(['memory','memoryRevision','startedAt','completedAt','relearnAt','relearningState'].map(key=>[key,target[key]]));
const withoutSources=(target:LearningTargetLike)=>{const value=structuredClone(target);delete value.curriculumMemberships;return value;};

function decisionId(targetId:string,retentionId:string,candidateEventIds:readonly string[],parents:readonly string[],algorithm:LearningReconciliationDecision['algorithm']=learningReconciliationAlgorithm){
 return stableUuid(canonicalJsonDigest({algorithm,targetId,retentionId,candidateEventIds:sortedUnique(candidateEventIds),supersededDecisionIds:sortedUnique(parents)}));
}

/** Old decisions remain immutable evidence. Only the causal frontier determines
 * today's scheduling roles; a later complete decision replaces that frontier. */
function decisionFrontier(decisions:readonly LearningReconciliationDecision[]):Set<string>{
 const byId=new Map(decisions.map(row=>[row.id,row])),superseded=new Set<string>(),done=new Set<string>(),visiting=new Set<string>();
 if(byId.size!==decisions.length)throw Error('libraryBackup.errors.inconsistent');
 for(const root of decisions){const stack=[{id:root.id,exit:false}];while(stack.length){const {id,exit}=stack.pop()!;if(done.has(id))continue;if(exit){visiting.delete(id);done.add(id);continue;}const row=byId.get(id);if(!row||visiting.has(id))throw Error('libraryBackup.errors.inconsistent');visiting.add(id);stack.push({id,exit:true});if(!backupEqual(row.supersededDecisionIds,sortedUnique(row.supersededDecisionIds)))throw Error('libraryBackup.errors.inconsistent');for(const parentId of row.supersededDecisionIds){const parent=byId.get(parentId);if(!parent||parent.targetId!==row.targetId||parent.retentionId!==row.retentionId||parent.candidateEventIds.some(event=>!row.candidateEventIds.includes(event)))throw Error('libraryBackup.errors.inconsistent');superseded.add(parentId);stack.push({id:parentId,exit:false});}}}
 return new Set([...byId.keys()].filter(id=>!superseded.has(id)));
}
const decisionsIn=(entries:readonly SyncEntry[])=>entries.filter(row=>row.table==='learningReconciliations').map(row=>decisionSchema.parse(decodeBackupValue(row.value)) as LearningReconciliationDecision);
function historyRuns(decisions:readonly LearningReconciliationDecision[]):Set<string>{const frontier=decisionFrontier(decisions);return new Set(decisions.filter(row=>frontier.has(row.id)).flatMap(row=>row.historyOnlyRunIds));}

/**
 * Resolve the one conflict shape that ordinary record merge must never expose
 * as a local/cloud choice: two completed, disjoint learning branches for the
 * same Target. Both branches stay in history; the branch with the latest
 * completed Run owns the materialized Target projection. A deterministic
 * persisted decision makes the non-contributing branch explicit and auditable.
 */
export function reconcileConcurrentLearningEntries(input:{
 base:SyncEntry[];local:SyncEntry[];remote:SyncEntry[];merged:SyncEntry[];conflicts:string[];
}){
 const base=mapFor(input.base),local=mapFor(input.local),remote=mapFor(input.remote);
 const merged=new Map(input.merged.map(entry=>[entryId(entry.table,entry.key),entry]));
 const remaining=new Set(input.conflicts);
 const baseEventIds=new Set(input.base.filter(entry=>entry.table==='learningEvents').map(entry=>entry.key));
 const localOnly=input.local.filter(entry=>entry.table==='learningEvents'&&!baseEventIds.has(entry.key)&&!remote.has(entryId(entry.table,entry.key)));
 const remoteOnly=input.remote.filter(entry=>entry.table==='learningEvents'&&!baseEventIds.has(entry.key)&&!local.has(entryId(entry.table,entry.key)));

 // Two independent histories can produce the same materialized Target. The
 // facts, rather than inequality of the projection row, establish a fork.
 const localEventTargets=new Set(localOnly.map(entry=>decoded<LearningEventLike>(entry)?.targetId));
 const concurrentTargets=new Set(remoteOnly.map(entry=>decoded<LearningEventLike>(entry)?.targetId).filter((id):id is string=>typeof id==='string'&&localEventTargets.has(id)));
 const localDecisions=decisionsIn(input.local),remoteDecisions=decisionsIn(input.remote);
 const decisionMap=new Map<string,LearningReconciliationDecision>();
 for(const row of [...localDecisions,...remoteDecisions]){const prior=decisionMap.get(row.id);if(prior&&!backupEqual(prior,row))throw Error('library_sync_history');decisionMap.set(row.id,row);}
 const decisions=[...decisionMap.values()],frontier=decisionFrontier(decisions);
 const localHistory=historyRuns(localDecisions),remoteHistory=historyRuns(remoteDecisions);
 const byTarget=new Map<string,LearningReconciliationDecision[]>();
 for(const row of decisions)if(frontier.has(row.id))byTarget.set(row.targetId,[...byTarget.get(row.targetId)??[],row]);
 for(const [target,rows] of byTarget)if(rows.length>1)concurrentTargets.add(target);
 for(const id of input.conflicts){let value:unknown;try{value=JSON.parse(id);}catch{continue;}if(Array.isArray(value)&&value[0]==='learningTargets'&&typeof value[1]==='string')concurrentTargets.add(value[1]);}
 for(const targetId of concurrentTargets){
  const conflictId=entryId('learningTargets',targetId),localEntry=local.get(conflictId),remoteEntry=remote.get(conflictId);
  const ours=decoded<LearningTargetLike>(localEntry),theirs=decoded<LearningTargetLike>(remoteEntry);
  if(!ours||!theirs||ours.id!==targetId||theirs.id!==targetId||ours.retentionId!==theirs.retentionId)continue;
  const ancestor=decoded<LearningTargetLike>(base.get(conflictId)),memberships=sourceUnion(ancestor,ours,theirs);
  if(memberships===null)continue;
  const withSources=(entry:SyncEntry,target:LearningTargetLike):SyncEntry=>({...entry,value:encodeBackupValue({...target,...(target.curriculumMemberships===undefined?{}:{curriculumMemberships:memberships})})});
  // A source-only branch can join a causal progress branch without deciding
  // between learning histories or manufacturing a reconciliation receipt.
  const learningFork=(!ancestor||!backupEqual(withoutSources(ours),withoutSources(ancestor))&&!backupEqual(withoutSources(theirs),withoutSources(ancestor)))&&localOnly.some(entry=>decoded<LearningEventLike>(entry)?.targetId===targetId)&&remoteOnly.some(entry=>decoded<LearningEventLike>(entry)?.targetId===targetId);
  if(learningFork||(byTarget.get(targetId)?.length??0)>1)remaining.add(conflictId);
  if(!learningFork&&(byTarget.get(targetId)?.length??0)<2&&(backupEqual(withoutSources(ours),withoutSources(theirs))||ancestor&&(
    backupEqual(withoutSources(ours),withoutSources(ancestor))||backupEqual(withoutSources(theirs),withoutSources(ancestor))))){
   const selected=ancestor&&backupEqual(withoutSources(theirs),withoutSources(ancestor))?localEntry!:remoteEntry!;
   merged.set(conflictId,withSources(selected,decoded<LearningTargetLike>(selected)!));remaining.delete(conflictId);continue;
  }
  // Shared facts need not yet be in this device's confirmed base. A new Run
  // can directly pin the other side's exact saved input, including same-revision
  // Relearning state. That establishes a causal successor without old replay.
  const follows=(events:SyncEntry[],side:Map<string,SyncEntry>,prior:LearningTargetLike)=>events.some(entry=>{
   const event=decoded<LearningEventLike>(entry);if(event?.targetId!==targetId)return false;
   const run=decoded<LearningRunLike & {participants:Record<string,{retentionBaseline:unknown;policyCommitment:unknown}>}>(side.get(entryId('learningRuns',event.runId)));
   return !!run?.completedAt&&run.targetIds.every(id=>{const p=run.participants?.[id],other=decoded<LearningTargetLike>((side===local?remote:local).get(entryId('learningTargets',id)));return !!p&&!!other&&backupEqual(p.retentionBaseline,savedState(other))&&backupEqual(p.policyCommitment,other.committedPolicy);});
  });
  const localFollows=!remoteOnly.some(entry=>decoded<LearningEventLike>(entry)?.targetId===targetId)&&follows(localOnly,local,theirs),remoteFollows=!localOnly.some(entry=>decoded<LearningEventLike>(entry)?.targetId===targetId)&&follows(remoteOnly,remote,ours);
  if(localFollows!==remoteFollows&&backupEqual(structuralTarget(ours),structuralTarget(theirs))){const selected=localFollows?localEntry!:remoteEntry!;merged.set(conflictId,withSources(selected,localFollows?ours:theirs));remaining.delete(conflictId);continue;}
  if(!backupEqual(structuralTarget(ours),structuralTarget(theirs)))continue;
  const eventHeader=(entry:SyncEntry)=>{const event=decoded<LearningEventLike>(entry);return event?{id:event.id,runId:event.runId,targetId:event.targetId,at:event.at}:undefined;};
  const localNew=localOnly.map(eventHeader).filter((event):event is LearningEventLike=>event?.targetId===targetId),remoteNew=remoteOnly.map(eventHeader).filter((event):event is LearningEventLike=>event?.targetId===targetId);
  if(localNew.some(event=>remoteNew.some(other=>other.runId===event.runId)))continue;
  const parents=byTarget.get(targetId)??[];
  const candidateIds=new Set([...localNew,...remoteNew].map(event=>event.id));for(const parent of parents)for(const id of parent.candidateEventIds)candidateIds.add(id);
  const candidates=[...candidateIds].map(id=>{const entry=merged.get(entryId('learningEvents',id)),event=entry&&eventHeader(entry);return event?{entry,event}:undefined;});
  if(candidates.some(item=>!item||item.event.targetId!==targetId))continue;
  const facts=candidates as {entry:SyncEntry;event:LearningEventLike}[];
  const localEvents=facts.filter(({event})=>local.has(entryId('learningEvents',event.id))&&!localHistory.has(event.runId)),remoteEvents=facts.filter(({event})=>remote.has(entryId('learningEvents',event.id))&&!remoteHistory.has(event.runId));
  if(!localEvents.length||!remoteEvents.length)continue;
  const localRunIds=new Set(localEvents.map(item=>item.event.runId)),remoteRunIds=new Set(remoteEvents.map(item=>item.event.runId));
  const completed=(side:Map<string,SyncEntry>,ids:Set<string>):Array<CompletedRunHeader|null>=>[...ids].map(id=>{
   const run=decoded<LearningRunLike>(side.get(entryId('learningRuns',id)));
   if(run?.completedAt!==null&&run?.completedAt!==undefined&&!timestamp.safeParse(run.completedAt).success)throw Error('libraryBackup.errors.inconsistent');
   return run?.id===id&&run.completedAt!==null&&run.targetIds.length===1&&run.targetIds[0]===targetId?{id:run.id,completedAt:run.completedAt,memoryRevision:run.participants?.[targetId]?.memoryRevision}:null;
  });
  const localRuns=completed(local,localRunIds),remoteRuns=completed(remote,remoteRunIds);
  if(localRuns.some(run=>run===null)||remoteRuns.some(run=>run===null))continue;
  const validLocalRuns=localRuns.filter((run):run is CompletedRunHeader=>run!==null);
  const validRemoteRuns=remoteRuns.filter((run):run is CompletedRunHeader=>run!==null);
  if(facts.some(({event})=>event.id.length===0||!Number.isFinite(Date.parse(event.at))))continue;
  // Each side is one saved causal branch. The pinned input revision identifies
  // its successor without scanning older history or treating wall time as ancestry.
  const head=(runs:CompletedRunHeader[],side:Map<string,SyncEntry>)=>{const predecessors=new Set(runs.map(run=>decoded<LearningRunLike & {continuedFromRunId?:string}>(side.get(entryId('learningRuns',run.id)))?.continuedFromRunId));return runs.filter(run=>!predecessors.has(run.id)).sort((a,b)=>a.memoryRevision!==undefined&&b.memoryRevision!==undefined?a.memoryRevision-b.memoryRevision||laterRun(a,b):laterRun(a,b)).at(-1)!;};
  const selectedRun=[head(validLocalRuns,local),head(validRemoteRuns,remote)].sort(laterRun).at(-1)!;
  const localWins=localRunIds.has(selectedRun.id)&&(!remoteRunIds.has(selectedRun.id)||canonicalJsonDigest({runs:sortedUnique([...localRunIds]),target:ours})<=canonicalJsonDigest({runs:sortedUnique([...remoteRunIds]),target:theirs}));
  const applied=localWins?localEvents:remoteEvents,appliedIds=new Set(applied.map(item=>item.event.id)),history=facts.filter(item=>!appliedIds.has(item.event.id));
  if(!history.length)continue;
  const selected=applied.map(item=>item.event).filter(event=>event.runId===selectedRun.id).sort(later).at(-1)!;
  const candidateEventIds=sortedUnique(facts.map(item=>item.event.id)),supersededDecisionIds=sortedUnique(parents.map(row=>row.id));
  const decision:LearningReconciliationDecision={
   id:decisionId(targetId,ours.retentionId,candidateEventIds,supersededDecisionIds),targetId,retentionId:ours.retentionId,
   algorithm:learningReconciliationAlgorithm,supersededDecisionIds,candidateEventIds,
   appliedEventIds:sortedUnique(applied.map(item=>item.event.id)),
   appliedRunIds:sortedUnique(applied.map(item=>item.event.runId)),
   historyOnlyEventIds:sortedUnique(history.map(item=>item.event.id)),
   historyOnlyRunIds:sortedUnique(history.map(item=>item.event.runId)),
   selectedRunId:selectedRun.id,selectedEventId:selected.id,decidedAt:selectedRun.completedAt!,
  };
  decisionSchema.parse(decision);
  const decisionEntry:SyncEntry={table:'learningReconciliations',key:decision.id,value:encodeBackupValue(decision)};
  const existing=[local.get(entryId(decisionEntry.table,decision.id)),remote.get(entryId(decisionEntry.table,decision.id))].filter(Boolean) as SyncEntry[];
  if(existing.some(entry=>!backupEqual(entry.value,decisionEntry.value)))continue;
  merged.set(conflictId,withSources(localWins?localEntry!:remoteEntry!,localWins?ours:theirs));
  merged.set(entryId(decisionEntry.table,decision.id),existing[0]??decisionEntry);
  remaining.delete(conflictId);
 }
 return {entries:[...merged.values()].sort((a,b)=>entryId(a.table,a.key).localeCompare(entryId(b.table,b.key))),conflicts:[...remaining]};
}

/** Validate persisted decisions and expose the Runs excluded only from the
 * effective projection. Their Events remain normal immutable history rows. */
export function* validateLearningReconciliationRecordSteps(reader:LibraryRecordReader){
 // Decisions need only event identity/order, not every Action's materials and
 // evaluation bodies. Referenced Runs and Targets are read on demand.
 const events=new Map<string,LearningEventLike>();
 const eventIdsByRunTarget=new Map<string,string[]>(),groupKey=(runId:string,targetId:string)=>JSON.stringify([runId,targetId]);
 for(const row of reader.entries('learningEvents')){
  const {id,runId,targetId,at}=row.value;events.set(row.key,{id,runId,targetId,at});
  const group=groupKey(runId,targetId),ids=eventIdsByRunTarget.get(group)??[];ids.push(id);eventIdsByRunTarget.set(group,ids);
  yield;
 }
 const runs={get:(id:string)=>reader.get('learningRuns',id) as LearningRunLike|undefined};
 const targets={get:(id:string)=>reader.get('learningTargets',id) as LearningTargetLike|undefined};
 const decisions=[...reader.entries('learningReconciliations')].map(row=>decisionSchema.parse(row.value) as LearningReconciliationDecision),frontier=decisionFrontier(decisions);
 const historyOnlyEventIds=new Set<string>(),historyOnlyRunIds=new Set<string>(),appliedRunIdsAcrossDecisions=new Set<string>();
 for(const row of reader.entries('learningReconciliations')){
  yield;
  const decision=decisionSchema.parse(row.value) as LearningReconciliationDecision;
  if(row.key!==decision.id||decision.id!==decisionId(decision.targetId,decision.retentionId,decision.candidateEventIds,decision.supersededDecisionIds,decision.algorithm))throw new Error('libraryBackup.errors.inconsistent');
  const candidateSet=new Set(decision.candidateEventIds),applied=new Set(decision.appliedEventIds),history=new Set(decision.historyOnlyEventIds);
  if(candidateSet.size!==decision.candidateEventIds.length||applied.size!==decision.appliedEventIds.length||history.size!==decision.historyOnlyEventIds.length)throw new Error('libraryBackup.errors.inconsistent');
  if([...applied].some(id=>history.has(id))||new Set([...applied,...history]).size!==candidateSet.size||[...candidateSet].some(id=>!applied.has(id)&&!history.has(id)))throw new Error('libraryBackup.errors.inconsistent');
  const candidateEvents=[...candidateSet].map(id=>events.get(id));
  const target=targets.get(decision.targetId);
  if(candidateEvents.some(event=>!event||event.targetId!==decision.targetId)||!target||target.retentionId!==decision.retentionId)throw new Error('libraryBackup.errors.inconsistent');
  const recordedByRun=new Map<string,string[]>();
  for(const event of candidateEvents as LearningEventLike[]){const ids=recordedByRun.get(event.runId)??[];ids.push(event.id);recordedByRun.set(event.runId,ids);yield;}
  const appliedRunIds=new Set([...applied].map(id=>events.get(id)!.runId)),historyRunIds=new Set([...history].map(id=>events.get(id)!.runId));
  if([...appliedRunIds].some(id=>historyRunIds.has(id)))throw new Error('libraryBackup.errors.inconsistent');
  if(!backupEqual(sortedUnique([...appliedRunIds]),decision.appliedRunIds))throw new Error('libraryBackup.errors.inconsistent');
  const expectedHistoryRuns=sortedUnique([...history].map(id=>events.get(id)!.runId));
  if(!backupEqual(expectedHistoryRuns,decision.historyOnlyRunIds))throw new Error('libraryBackup.errors.inconsistent');
  const candidateRuns:CompletedRunHeader[]=[];
  for(const runId of [...appliedRunIds,...historyRunIds]){const run=runs.get(runId);if(!run||run.completedAt===null||run.targetIds.length!==1||run.targetIds[0]!==decision.targetId)throw new Error('libraryBackup.errors.inconsistent');candidateRuns.push({id:run.id,completedAt:run.completedAt,memoryRevision:run.participants?.[decision.targetId]?.memoryRevision});const runEvents=sortedUnique(eventIdsByRunTarget.get(groupKey(runId,decision.targetId))??[]);const recorded=sortedUnique(recordedByRun.get(runId)??[]);if(!backupEqual(runEvents,recorded))throw new Error('libraryBackup.errors.inconsistent');yield;}
  const effective=decision.algorithm===legacyAlgorithm?candidateRuns:candidateRuns.filter(run=>appliedRunIds.has(run.id));
  const selectedRun=effective.sort((a,b)=>decision.algorithm!==legacyAlgorithm&&a.memoryRevision!==undefined&&b.memoryRevision!==undefined?a.memoryRevision-b.memoryRevision||laterRun(a,b):laterRun(a,b)).at(-1)!;
  const selectedAppliedEvent=(candidateEvents as LearningEventLike[]).filter(event=>applied.has(event.id)&&(decision.algorithm===legacyAlgorithm||event.runId===selectedRun.id)).sort(later).at(-1)!;
  if(selectedRun.id!==decision.selectedRunId||selectedRun.completedAt!==decision.decidedAt||!appliedRunIds.has(selectedRun.id)||selectedAppliedEvent.id!==decision.selectedEventId)throw new Error('libraryBackup.errors.inconsistent');
  if(frontier.has(decision.id)){
   for(const runId of decision.appliedRunIds)appliedRunIdsAcrossDecisions.add(runId);
   for(const runId of decision.historyOnlyRunIds)historyOnlyRunIds.add(runId);
   for(const eventId of history)historyOnlyEventIds.add(eventId);
  }
 }
 if([...appliedRunIdsAcrossDecisions].some(runId=>historyOnlyRunIds.has(runId)))throw new Error('libraryBackup.errors.inconsistent');
 for(const runId of historyOnlyRunIds)for(const targetId of runs.get(runId)!.targetIds){
  if(!decisions.some(row=>frontier.has(row.id)&&row.targetId===targetId&&row.historyOnlyRunIds.includes(runId)))throw Error('libraryBackup.errors.inconsistent');
 }
 return {historyOnlyEventIds,historyOnlyRunIds};
}

export function validateLearningReconciliationRecords(reader:LibraryRecordReader){return runSynchronously(validateLearningReconciliationRecordSteps(reader));}

/** Ordinary sync checks this immutable choice and its direct refs. It does not
 * replay the old decision DAG or infer scheduling outcomes from old Events. */
export function* validateSavedLearningReconciliationSteps(reader:LibraryRecordReader){
 for(const row of reader.entries('learningReconciliations')){
  yield;const decision=decisionSchema.parse(row.value) as LearningReconciliationDecision;
  if(row.key!==decision.id||decision.id!==decisionId(decision.targetId,decision.retentionId,decision.candidateEventIds,decision.supersededDecisionIds,decision.algorithm))throw Error('libraryBackup.errors.inconsistent');
  const fail=():never=>{throw Error('libraryBackup.errors.inconsistent');};
  const target=reader.get('learningTargets',decision.targetId);if(!target||target.retentionId!==decision.retentionId)fail();
  for(const ids of [decision.supersededDecisionIds,decision.candidateEventIds,decision.appliedEventIds,decision.appliedRunIds,decision.historyOnlyEventIds,decision.historyOnlyRunIds])if(!backupEqual(ids,sortedUnique(ids)))fail();
  const applied=new Set(decision.appliedEventIds),history=new Set(decision.historyOnlyEventIds);
  if(applied.has(decision.selectedEventId)===false||!decision.appliedRunIds.includes(decision.selectedRunId)||[...applied].some(id=>history.has(id))||!backupEqual(sortedUnique([...applied,...history]),decision.candidateEventIds)||decision.appliedRunIds.some(id=>decision.historyOnlyRunIds.includes(id)))fail();
  const appliedRuns=new Set<string>(),historyRuns=new Set<string>();
  for(const id of decision.candidateEventIds){yield;const event=reader.get('learningEvents',id);if(!event||event.id!==id||event.targetId!==decision.targetId||!timestamp.safeParse(event.at).success)fail();(applied.has(id)?appliedRuns:historyRuns).add(event.runId);}
  if(!backupEqual(sortedUnique([...appliedRuns]),decision.appliedRunIds)||!backupEqual(sortedUnique([...historyRuns]),decision.historyOnlyRunIds))fail();
  for(const id of [...appliedRuns,...historyRuns]){yield;const run=reader.get('learningRuns',id);if(!run||run.id!==id||run.targetIds.length!==1||run.targetIds[0]!==decision.targetId||!timestamp.safeParse(run.completedAt).success||id===decision.selectedRunId&&run.completedAt!==decision.decidedAt)fail();}
  const selected=reader.get('learningEvents',decision.selectedEventId);if(decision.algorithm===legacyAlgorithm?!decision.appliedRunIds.includes(selected?.runId):selected?.runId!==decision.selectedRunId)fail();
  for(const id of decision.supersededDecisionIds){yield;const parent=reader.get('learningReconciliations',id);if(!parent||parent.id!==id||parent.targetId!==decision.targetId||parent.retentionId!==decision.retentionId||parent.candidateEventIds.some((id:string)=>!decision.candidateEventIds.includes(id)))fail();}
 }
}
