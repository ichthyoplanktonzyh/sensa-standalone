import {assertSavedLearningRecordChange} from '../savedLearningState';
import {reconcileConcurrentLearningEntries} from '../learningReconciliation';
import {backupEqual,decodeBackupValue} from '../backupCodec';
import type {DomainReplicaModule,ReplicaMergeResult,ReplicaRecordReference} from './domainReplica';

const tables=new Set(['curriculumEnrollments','supplementalMembershipStates','studyScopes','learningSessions','learningTargets','learningRuns','learningEvents','learningReconciliations']);
const immutableHistory=new Set(['studyScopes','learningSessions','learningRuns','learningEvents','learningReconciliations']);
const entryId=(entry:{table:string;key:string})=>JSON.stringify([entry.table,entry.key]);
const record=(value:unknown):Record<string,any>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:undefined;
const values=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
const reference=(table:ReplicaRecordReference['table'],key:unknown):ReplicaRecordReference[]=>typeof key==='string'&&key.length?[{table,key}]:[];
const references=(table:ReplicaRecordReference['table'],keys:unknown):ReplicaRecordReference[]=>values(keys).flatMap(key=>reference(table,key));
/** A stale device cannot change a committed participant's Policy. Future,
 * unstarted candidates are not frozen by the Session's origin selection. */
function activeRunPolicyConflicts(entries:ReplicaMergeResult['entries']):string[]{
 const facts=new Map(entries.map(entry=>[entryId(entry),entry]));
 const read=(table:string,key:string)=>{const entry=facts.get(JSON.stringify([table,key]));return entry===undefined?undefined:decodeBackupValue(entry.value);};
 const active=read('meta','learning-session-active');if(typeof active!=='string')return [];
 const session=record(read('learningSessions',active));if(!session||session.endedAt)return [];
 const activeRun=record(read('learningRuns',session.activeRunId)),conflicts:string[]=[];
 for(const id of values(activeRun?.targetIds)){
  if(typeof id!=='string')continue;
  const target=record(read('learningTargets',id)),committed=record(target?.committedPolicy);
  if(!committed||committed.profileId!==activeRun?.policyProfileId||committed.profileVersion!==activeRun?.policyProfileVersion)conflicts.push(JSON.stringify(['learningTargets',id]));
 }
 return conflicts;
}
function activeBookConflicts(entries:ReplicaMergeResult['entries']):string[]{
 const byRoute=new Map<string,string[]>();
 for(const entry of entries){
  if(entry.table!=='curriculumEnrollments')continue;
  const enrollment=record(decodeBackupValue(entry.value));
  if(enrollment?.source?.kind!=='published_book'||enrollment.status!=='active'||(enrollment.bookPlan?.mode??'active')!=='active')continue;
  const route=enrollment.languageContext?.languageRouteId;
  if(typeof route==='string')byRoute.set(route,[...(byRoute.get(route)??[]),entryId(entry)]);
 }
 return [...byRoute.values()].filter(ids=>ids.length>1).flat();
}
const materialDependencies=(material:unknown)=>{
 const provenance=record(record(material)?.snapshot)?.provenance;
 return [
  ...reference('packageInstallations',record(provenance)?.packageKey),
  ...reference('contentAttempts',record(provenance)?.attemptId),
  ...reference('semanticMeanings',record(provenance)?.personalMeaningId),
 ];
};

/** Reconciliation is for simultaneous changes, not the mere presence of old
 * decisions. The ordinary merger already selects a one-sided causal update. */
function needsLearningReconciliation(input:{base:ReplicaMergeResult['entries'];local:ReplicaMergeResult['entries'];remote:ReplicaMergeResult['entries']},conflicts:readonly string[]):boolean{
 if(conflicts.some(id=>JSON.parse(id)[0]==='learningTargets'))return true;
 const baseline=new Map(input.base.map(row=>[entryId(row),row]));
 const changed=(entries:ReplicaMergeResult['entries'])=>{
  const targets=new Set<string>();for(const row of entries){
   if(row.table==='learningTargets'&&!backupEqual(row.value,baseline.get(entryId(row))?.value))targets.add(row.key);
   if(row.table==='learningReconciliations'&&!baseline.has(entryId(row)))targets.add((decodeBackupValue(row.value) as {targetId:string}).targetId);
  }return targets;
 };
 const ours=changed(input.local);return [...changed(input.remote)].some(id=>ours.has(id));
}

export const learningReplica:DomainReplicaModule={
 namespace:'learning-system',
 owns:(table,key)=>tables.has(table)||(table==='meta'&&['learning-active','learning-session-active'].includes(key)),
 afterConflictChoice(selected,merged,{conflicts}){
  const blocked=new Set(conflicts);
  // The learner chose conflicting content, not to undo independent learning
  // facts or the domain's already-reconciled history.
  return [...selected.filter(row=>blocked.has(entryId(row))),...merged.filter(row=>!blocked.has(entryId(row)))];
 },
 *mergeSteps(input,ordinary){
  const historical=input.base.filter(entry=>immutableHistory.has(entry.table)),baseline=new Map(input.base.map(row=>[entryId(row),row]));
  for(const side of [input.local,input.remote]){
   const retained=new Set(side.map(entryId));
   if(historical.some(entry=>!retained.has(entryId(entry))))throw new Error('library_sync_history');
   const witnesses=new Set<string>(),decisions=new Set<string>();
   for(const row of side)if(!baseline.has(entryId(row))){if(row.table==='learningEvents'){const event=decodeBackupValue(row.value) as any,next=event.detail?.nextPresentation;if(next)witnesses.add(JSON.stringify([event.runId,next.targetId,next.stepId,next.material]));}else if(row.table==='learningReconciliations')decisions.add((decodeBackupValue(row.value) as any).targetId);}
   for(const row of side){yield;const before=baseline.get(entryId(row));if(before&&!backupEqual(before.value,row.value))assertSavedLearningRecordChange(row.table,decodeBackupValue(before.value),decodeBackupValue(row.value),()=>{throw Error('library_sync_history');},witnesses,decisions.has(row.key));}
  }
  const merged=yield* ordinary(input);
  yield;
  const reconciled=needsLearningReconciliation(input,merged.conflicts)?reconcileConcurrentLearningEntries({...input,merged:merged.entries,conflicts:merged.conflicts}) as ReplicaMergeResult:merged;
  yield;
  return {...reconciled,conflicts:[...new Set([...reconciled.conflicts,...activeRunPolicyConflicts(reconciled.entries),...activeBookConflicts(reconciled.entries)])].sort()};
 },
 conflictDependencies(entry,value){
  if(entry.table==='meta')return reference(entry.key==='learning-session-active'?'learningSessions':'learningRuns',value);
  const fact=record(value);if(!fact)return [];
  if(entry.table==='supplementalMembershipStates')return reference(fact.source?.kind==='stable_sense'?'curriculumEnrollments':'personalLearning',fact.source?.id);
  if(entry.table==='studyScopes')return [
   ...values(fact.enrollments).flatMap(enrollment=>reference('curriculumEnrollments',record(enrollment)?.id)),
   ...values(fact.members).flatMap(member=>[...reference('learningTargets',record(member)?.targetId),...values(record(member)?.sources).flatMap(source=>[...reference('packageInstallations',record(source)?.packageKey),...reference('supplementalMembershipStates',record(source)?.supplementalState?.id)])]),
  ];
  if(entry.table==='learningSessions')return [...reference('studyScopes',fact.scopeRevisionId),...references('learningRuns',fact.runIds)];
  if(entry.table==='learningTargets')return [
   ...reference('curriculumEnrollments',fact.policyAssignment?.provenance?.curriculumEnrollmentId),
   ...reference('learningRuns',fact.committedPolicy?.committedByProtocolRunId),
   ...(Array.isArray(fact.curriculumMemberships)?fact.curriculumMemberships.flatMap((membership:unknown)=>{
    const item=record(membership);return [
     ...reference('packageInstallations',item?.packageKey),
     ...reference('curriculumEnrollments',item?.provenance?.curriculumEnrollmentId),
     ...reference('contentAttempts',item?.provenance?.attemptId),
     ...reference('semanticMeanings',item?.provenance?.personalMeaningId),
     ...materialDependencies(item?.material),
    ];
   }):[]),
  ];
  if(entry.table==='curriculumEnrollments'){
   if(fact.source?.kind==='portable_package')return reference('packageInstallations',fact.source.packageKey);
   if(fact.source?.kind==='stable_sense'){
    const selected=fact.source.selection?.reference;
    if(selected?.origin?.kind==='published_package')return reference('packageInstallations',selected.origin.packageKey);
    return [['senses',selected?.senseId],['senseVersions',selected?.senseVersionId],['bindings',selected?.bindingId],['bindingVersions',selected?.bindingVersionId]].flatMap(([kind,id])=>typeof id==='string'?reference('semanticRegistry',`${kind}:${id}`):[]);
   }
   return [];
  }
  if(entry.table==='learningRuns')return [
   ...reference('learningSessions',fact.learningSessionId),...reference('studyScopes',fact.studyScopeRevisionId),
   ...reference('learningRuns',fact.continuedFromRunId),
   ...(Array.isArray(fact.lifecycleEvents)?fact.lifecycleEvents.flatMap(event=>reference('learningRuns',record(event)?.continuedFromRunId)):[]),
   ...references('learningTargets',fact.targetIds),
   ...reference('learningTargets',fact.targetId),
   ...Object.entries(record(fact.participants)??{}).flatMap(([targetId,participant])=>{
    const item=record(participant);return [
     ...reference('learningTargets',targetId),
     ...Object.values(record(item?.materializations)??{}).flatMap(materialDependencies),
    ];
   }),
   ...(Array.isArray(fact.lifecycleEvents)?fact.lifecycleEvents.flatMap((event:unknown)=>{
    const item=record(event);
    if(item?.kind!=='current_step_material_refreshed')return [];
    const participant=record(record(fact.participants)?.[item.targetId]),material=Object.values(record(participant?.materializations)??{}).map(record).find(material=>record(material?.snapshot)?.learningMaterializationId===item.materializationId),provenance=record(record(material?.snapshot)?.provenance);
    return provenance?.packageKey?[]:reference('contentAttempts',item.operationId);
   }):[]),
  ];
  if(entry.table==='learningEvents')return [
   ...reference('learningRuns',fact.runId),
   ...reference('learningTargets',fact.targetId),
  ];
  if(entry.table==='learningReconciliations')return [
   ...references('learningReconciliations',fact.supersededDecisionIds),
   ...reference('learningTargets',fact.targetId),
   ...references('learningRuns',[...values(fact.appliedRunIds),...values(fact.historyOnlyRunIds),fact.selectedRunId]),
   ...references('learningEvents',[...values(fact.candidateEventIds),...values(fact.appliedEventIds),...values(fact.historyOnlyEventIds),fact.selectedEventId]),
  ];
  return [];
 },
 assertDelete(entry){
  if(immutableHistory.has(entry.table)||entry.table==='supplementalMembershipStates')throw new Error('library_sync_history');
 },
};
