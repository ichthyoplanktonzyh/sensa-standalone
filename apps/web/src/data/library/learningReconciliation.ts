import {stableUuid} from '@sensa/learning-kernel';
import {z} from 'zod';

import {backupEqual,decodeBackupValue,encodeBackupValue} from './backupCodec';

export const learningReconciliationAlgorithm = 'latest-completed-learning-branch-v1' as const;

type SyncEntry={table:string;key:string;value:unknown;blocks?:string[]};
type LearningEventLike={id:string;runId:string;targetId:string;at:string};
type LearningRunLike={id:string;targetIds:string[];completedAt:string|null};
type LearningTargetLike={id:string;retentionId:string;[key:string]:unknown};

export type LearningReconciliationDecision={
 id:string;
 targetId:string;
 retentionId:string;
 algorithm:typeof learningReconciliationAlgorithm;
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
 id:uuid,targetId:uuid,retentionId:uuid,algorithm:z.literal(learningReconciliationAlgorithm),
 candidateEventIds:z.array(uuid).min(2),appliedEventIds:z.array(uuid).min(1),
 appliedRunIds:z.array(uuid).min(1),
 historyOnlyEventIds:z.array(uuid).min(1),historyOnlyRunIds:z.array(uuid).min(1),
 selectedRunId:uuid,selectedEventId:uuid,decidedAt:timestamp,
}).strict();

const entryId=(table:string,key:string)=>JSON.stringify([table,key]);
const decoded=<T>(entry:SyncEntry|undefined):T|undefined=>entry?decodeBackupValue(entry.value) as T:undefined;
const mapFor=(entries:readonly SyncEntry[])=>new Map(entries.map(entry=>[entryId(entry.table,entry.key),entry]));
const later=(left:LearningEventLike,right:LearningEventLike)=>left.at.localeCompare(right.at)||left.id.localeCompare(right.id);
const laterRun=(left:LearningRunLike,right:LearningRunLike)=>(left.completedAt??'').localeCompare(right.completedAt??'')||left.id.localeCompare(right.id);
const sortedUnique=(values:readonly string[])=>[...new Set(values)].sort();

/** Learning state is a projection. Ignore only fields written by starting or
 * settling a Protocol Run; every learner/content/policy field must still agree. */
function structuralTarget(target:LearningTargetLike){
 const value=structuredClone(target) as Record<string,unknown>;
 for(const key of ['startedAt','completedAt','memory','memoryRevision','relearnAt','relearningState','introducedLanguageRouteId'])delete value[key];
 const commitment=value.committedPolicy as Record<string,unknown>|null|undefined;
 if(commitment)value.committedPolicy={
  commitmentId:commitment.commitmentId,revision:commitment.revision,
  assignmentId:commitment.assignmentId,assignmentRevision:commitment.assignmentRevision,
  profileId:commitment.profileId,profileVersion:commitment.profileVersion,
 };
 return value;
}

function decisionId(targetId:string,candidateEventIds:readonly string[]){
 return stableUuid(`sensa-learning-reconciliation:${targetId}:${sortedUnique(candidateEventIds).join(':')}`);
}

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

 for(const conflictId of input.conflicts){
  let parsed:unknown;try{parsed=JSON.parse(conflictId);}catch{continue;}
  if(!Array.isArray(parsed)||parsed[0]!=='learningTargets'||typeof parsed[1]!=='string')continue;
  const targetId=parsed[1],localEntry=local.get(conflictId),remoteEntry=remote.get(conflictId);
  const ours=decoded<LearningTargetLike>(localEntry),theirs=decoded<LearningTargetLike>(remoteEntry);
  if(!ours||!theirs||ours.id!==targetId||theirs.id!==targetId||ours.retentionId!==theirs.retentionId)continue;
  if(!backupEqual(structuralTarget(ours),structuralTarget(theirs)))continue;
  const localEvents=localOnly.map(entry=>({entry,event:decoded<LearningEventLike>(entry)})).filter((item):item is {entry:SyncEntry;event:LearningEventLike}=>item.event?.targetId===targetId);
  const remoteEvents=remoteOnly.map(entry=>({entry,event:decoded<LearningEventLike>(entry)})).filter((item):item is {entry:SyncEntry;event:LearningEventLike}=>item.event?.targetId===targetId);
  if(!localEvents.length||!remoteEvents.length)continue;
  const localRunIds=new Set(localEvents.map(item=>item.event.runId)),remoteRunIds=new Set(remoteEvents.map(item=>item.event.runId));
  if([...localRunIds].some(id=>remoteRunIds.has(id)))continue;
  const completed=(side:Map<string,SyncEntry>,ids:Set<string>)=>[...ids].map(id=>{
   const run=decoded<LearningRunLike>(side.get(entryId('learningRuns',id)));
   return run?.id===id&&run.completedAt!==null&&run.targetIds.includes(targetId)?run:null;
  });
  const localRuns=completed(local,localRunIds),remoteRuns=completed(remote,remoteRunIds);
  if(localRuns.some(run=>run===null)||remoteRuns.some(run=>run===null))continue;
  const validLocalRuns=localRuns.filter((run):run is LearningRunLike=>run!==null);
  const validRemoteRuns=remoteRuns.filter((run):run is LearningRunLike=>run!==null);
  const candidates=[...localEvents,...remoteEvents];
  if(candidates.some(({event})=>event.id.length===0||!Number.isFinite(Date.parse(event.at))))continue;
  const selectedRun=[...validLocalRuns,...validRemoteRuns].sort(laterRun).at(-1)!;
  const localWins=localRunIds.has(selectedRun.id);
  const applied=localWins?localEvents:remoteEvents,history=localWins?remoteEvents:localEvents;
  const selected=applied.map(item=>item.event).sort(later).at(-1)!;
  const candidateEventIds=sortedUnique(candidates.map(item=>item.event.id));
  const decision:LearningReconciliationDecision={
   id:decisionId(targetId,candidateEventIds),targetId,retentionId:ours.retentionId,
   algorithm:learningReconciliationAlgorithm,candidateEventIds,
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
  merged.set(conflictId,localWins?localEntry!:remoteEntry!);
  merged.set(entryId(decisionEntry.table,decision.id),existing[0]??decisionEntry);
  remaining.delete(conflictId);
 }
 return {entries:[...merged.values()].sort((a,b)=>entryId(a.table,a.key).localeCompare(entryId(b.table,b.key))),conflicts:[...remaining]};
}

/** Validate persisted decisions and expose the Runs excluded only from the
 * effective projection. Their Events remain normal immutable history rows. */
export function validateLearningReconciliationRows(rows:{
 learningEvents:{key:string;value:any}[];
 learningRuns:{key:string;value:any}[];
 learningTargets:{key:string;value:any}[];
 learningReconciliations:{key:string;value:any}[];
}){
 const events=new Map(rows.learningEvents.map(row=>[row.key,row.value as LearningEventLike]));
 const runs=new Map(rows.learningRuns.map(row=>[row.key,row.value as LearningRunLike]));
 const targets=new Map(rows.learningTargets.map(row=>[row.key,row.value as LearningTargetLike]));
 const historyOnlyEventIds=new Set<string>(),historyOnlyRunIds=new Set<string>(),appliedRunIdsAcrossDecisions=new Set<string>();
 for(const row of rows.learningReconciliations){
  const decision=decisionSchema.parse(row.value) as LearningReconciliationDecision;
  if(row.key!==decision.id||decision.id!==decisionId(decision.targetId,decision.candidateEventIds))throw new Error('libraryBackup.errors.inconsistent');
  const candidateSet=new Set(decision.candidateEventIds),applied=new Set(decision.appliedEventIds),history=new Set(decision.historyOnlyEventIds);
  if(candidateSet.size!==decision.candidateEventIds.length||applied.size!==decision.appliedEventIds.length||history.size!==decision.historyOnlyEventIds.length)throw new Error('libraryBackup.errors.inconsistent');
  if([...applied].some(id=>history.has(id))||new Set([...applied,...history]).size!==candidateSet.size||[...candidateSet].some(id=>!applied.has(id)&&!history.has(id)))throw new Error('libraryBackup.errors.inconsistent');
  const candidateEvents=[...candidateSet].map(id=>events.get(id));
  const target=targets.get(decision.targetId);
  if(candidateEvents.some(event=>!event||event.targetId!==decision.targetId)||!target||target.retentionId!==decision.retentionId)throw new Error('libraryBackup.errors.inconsistent');
  const appliedRunIds=new Set([...applied].map(id=>events.get(id)!.runId)),historyRunIds=new Set([...history].map(id=>events.get(id)!.runId));
  if([...appliedRunIds].some(id=>historyRunIds.has(id)))throw new Error('libraryBackup.errors.inconsistent');
  if(!backupEqual(sortedUnique([...appliedRunIds]),decision.appliedRunIds))throw new Error('libraryBackup.errors.inconsistent');
  const expectedHistoryRuns=sortedUnique([...history].map(id=>events.get(id)!.runId));
  if(!backupEqual(expectedHistoryRuns,decision.historyOnlyRunIds))throw new Error('libraryBackup.errors.inconsistent');
  const candidateRuns:LearningRunLike[]=[];
  for(const runId of [...appliedRunIds,...historyRunIds]){const run=runs.get(runId);if(!run||run.completedAt===null||!run.targetIds.includes(decision.targetId))throw new Error('libraryBackup.errors.inconsistent');candidateRuns.push(run);const runEvents=sortedUnique([...events.values()].filter(event=>event.runId===runId&&event.targetId===decision.targetId).map(event=>event.id));const recorded=sortedUnique(decision.candidateEventIds.filter(id=>events.get(id)!.runId===runId));if(!backupEqual(runEvents,recorded))throw new Error('libraryBackup.errors.inconsistent');}
  const selectedRun=candidateRuns.sort(laterRun).at(-1)!;
  const selectedAppliedEvent=(candidateEvents as LearningEventLike[]).filter(event=>applied.has(event.id)).sort(later).at(-1)!;
  if(selectedRun.id!==decision.selectedRunId||selectedRun.completedAt!==decision.decidedAt||!appliedRunIds.has(selectedRun.id)||selectedAppliedEvent.id!==decision.selectedEventId)throw new Error('libraryBackup.errors.inconsistent');
  for(const runId of decision.appliedRunIds)appliedRunIdsAcrossDecisions.add(runId);
  for(const runId of decision.historyOnlyRunIds)historyOnlyRunIds.add(runId);
  for(const eventId of history)historyOnlyEventIds.add(eventId);
 }
 if([...appliedRunIdsAcrossDecisions].some(runId=>historyOnlyRunIds.has(runId)))throw new Error('libraryBackup.errors.inconsistent');
 return {historyOnlyEventIds,historyOnlyRunIds};
}
