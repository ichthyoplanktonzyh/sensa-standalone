import {test} from 'vitest';
import assert from 'node:assert/strict';

import {decodeBackupValue,encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec.ts';
import {
  reconcileConcurrentLearningEntries,
  validateLearningReconciliationRecords,
} from '../../../apps/web/src/data/library/learningReconciliation.ts';
import {learningReplica} from '../../../apps/web/src/data/library/replication/learningReplica.ts';
import {libraryRowsReader,type LibraryRecordRows} from '../../../apps/web/src/data/library/libraryRecordReader';
import {sqliteLibraryTables} from '../../../apps/web/src/data/library/sqliteProtocol';
import {
  isReplicatedLibraryEntry,
  mergeLibraryReplicas,
  normalizeLibraryReplicaEntry,
  partitionLibraryReplicaConflicts,
  planLibraryReplicaApply,
  replicaEntryId,
  type LibraryReplicaEntry,
} from '../../../apps/web/src/data/library/replication/libraryReplica.ts';

test("learning-reconciliation", async () => {

type Entry=LibraryReplicaEntry;
const ids={
  target:'00000000-0000-4000-8000-000000000001',
  retention:'00000000-0000-4000-8000-000000000002',
  localRun:'00000000-0000-4000-8000-000000000003',
  remoteRun:'00000000-0000-4000-8000-000000000004',
  localEvent:'00000000-0000-4000-8000-000000000005',
  remoteEvent:'00000000-0000-4000-8000-000000000006',
};
const entry=(table:Entry['table'],key:string,value:unknown):Entry=>({table,key,value:encodeBackupValue(value)});
const baseTarget={id:ids.target,retentionId:ids.retention,expression:'raincoat',memory:null,memoryRevision:0,startedAt:null,completedAt:null,relearnAt:null,relearningState:null};
const localTarget={...baseTarget,memory:{dueAt:'2026-09-22T09:00:00.000Z'},memoryRevision:1,startedAt:'2026-09-21T08:55:00.000Z',completedAt:'2026-09-21T09:00:00.000Z'};
const remoteTarget={...baseTarget,memory:{dueAt:'2026-09-24T09:05:00.000Z'},memoryRevision:1,startedAt:'2026-09-21T09:00:00.000Z',completedAt:'2026-09-21T09:05:00.000Z'};
const localRun={id:ids.localRun,targetIds:[ids.target],completedAt:'2026-09-21T09:00:00.000Z'};
const remoteRun={id:ids.remoteRun,targetIds:[ids.target],completedAt:'2026-09-21T09:05:00.000Z'};
const localEvent={id:ids.localEvent,runId:ids.localRun,targetId:ids.target,at:'2026-09-21T09:00:00.000Z'};
const remoteEvent={id:ids.remoteEvent,runId:ids.remoteRun,targetId:ids.target,at:'2026-09-21T09:05:00.000Z'};
const base=[entry('learningTargets',ids.target,baseTarget)];
const local=[entry('learningTargets',ids.target,localTarget),entry('learningRuns',ids.localRun,localRun),entry('learningEvents',ids.localEvent,localEvent)];
const remote=[entry('learningTargets',ids.target,remoteTarget),entry('learningRuns',ids.remoteRun,remoteRun),entry('learningEvents',ids.remoteEvent,remoteEvent)];
const conflict=JSON.stringify(['learningTargets',ids.target]);
const result=reconcileConcurrentLearningEntries({
  base,local,remote,
  merged:[local[0]!,local[1]!,local[2]!,remote[1]!,remote[2]!],
  conflicts:[conflict],
});
assert.deepEqual(result.conflicts,[],'completed disjoint learning branches must not become a local/cloud choice');
const materialized=result.entries.find(row=>row.table==='learningTargets'&&row.key===ids.target)!;
assert.deepEqual(decodeBackupValue(materialized.value),remoteTarget,'the branch with the latest deterministic event owns the projection');
const decisionRow=result.entries.find(row=>row.table==='learningReconciliations')!;
const decision=decodeBackupValue(decisionRow.value) as any;
assert.deepEqual(decision.appliedEventIds,[ids.remoteEvent]);
assert.deepEqual(decision.appliedRunIds,[ids.remoteRun]);
assert.deepEqual(decision.historyOnlyEventIds,[ids.localEvent]);
assert.deepEqual(decision.historyOnlyRunIds,[ids.localRun]);
assert.equal(decision.selectedRunId,ids.remoteRun);

const domainResult=mergeLibraryReplicas({base:base as any,local:local as any,remote:remote as any});
assert.deepEqual(domainResult.conflicts,[],'the Learning domain Module must own concurrent-history reconciliation');
assert.deepEqual(
 decodeBackupValue(domainResult.entries.find(row=>row.table==='learningTargets'&&row.key===ids.target)!.value),
 remoteTarget,
);
assert.throws(()=>mergeLibraryReplicas({base:local as any,local:local.filter(row=>row.key!==ids.localEvent) as any,remote:local as any}),/library_sync_history/u,'a local tombstone cannot erase confirmed Learning history');
assert.throws(()=>planLibraryReplicaApply(local as any,[local[0]!,local[1]!] as any),/library_sync_history/u,'immutable Learning history cannot use generic physical deletion');
assert.doesNotThrow(()=>planLibraryReplicaApply([entry('packageInstallations','artifact',{})] as any,[]),'Content Supply owns installation removal semantics');
const bookRoute=crypto.randomUUID(),bookA=crypto.randomUUID(),bookB=crypto.randomUUID();
const independentBook=(id:string)=>entry('curriculumEnrollments',id,{id,status:'active',languageContext:{languageRouteId:bookRoute},source:{kind:'published_book'},bookPlan:{mode:'active'}});
const independent={base:[],local:[independentBook(bookA)],remote:[independentBook(bookB)]};
const booksMerged=mergeLibraryReplicas(independent as any);
assert.deepEqual(booksMerged.conflicts.sort(),[replicaEntryId({table:'curriculumEnrollments',key:bookA} as any),replicaEntryId({table:'curriculumEnrollments',key:bookB} as any)].sort(),'independent records must not silently create two active Books on one Route');
const booksHeld=partitionLibraryReplicaConflicts({...independent,merged:booksMerged.entries,conflicts:booksMerged.conflicts} as any);
assert.deepEqual(booksHeld.local.map(row=>row.key),[bookA]);assert.deepEqual(booksHeld.upload.map(row=>row.key),[bookB]);
// Metadata-only merge boundary fixture, not admitted learning content or an
// outcome. A historical full-inventory Scope must not freeze future policies.
const activeSessionId=crypto.randomUUID(),historicalScopeId=crypto.randomUUID(),futureTargetId=crypto.randomUUID();
const activeFacts=[
 entry('meta','learning-session-active',activeSessionId),
 entry('learningSessions',activeSessionId,{id:activeSessionId,activeRunId:ids.localRun,scopeRevisionId:historicalScopeId,endedAt:null}),
 entry('learningRuns',ids.localRun,{id:ids.localRun,targetIds:[ids.target],studyScopeRevisionId:historicalScopeId,policyProfileId:'lightweight',policyProfileVersion:'1',completedAt:null}),
 entry('studyScopes',historicalScopeId,{id:historicalScopeId,members:[{targetId:ids.target,policy:{profileId:'lightweight',profileVersion:'1'}},{targetId:futureTargetId,policy:{profileId:'lightweight',profileVersion:'1'}}]}),
 entry('learningTargets',ids.target,{id:ids.target,committedPolicy:{profileId:'lightweight',profileVersion:'1'}}),
 entry('learningTargets',futureTargetId,{id:futureTargetId,committedPolicy:null,policyAssignment:{profileId:'four_stage'}}),
];
const merge=learningReplica.merge;assert(merge);
const mergeActive=(facts:Entry[])=>merge({base:facts,local:facts,remote:facts},()=>({entries:facts,conflicts:[]}));
assert.deepEqual(mergeActive(activeFacts).conflicts,[],'unstarted targets in a legacy Scope remain outside the active Run policy lock');
const driftedActive=activeFacts.map(row=>row.table==='learningTargets'&&row.key===ids.target?entry('learningTargets',row.key,{id:row.key,committedPolicy:{profileId:'four_stage',profileVersion:'1'}}):row);
assert.deepEqual(mergeActive(driftedActive).conflicts,[conflict],'the actual started participant remains protected');
assert.equal(isReplicatedLibraryEntry('meta','package-catalog'),false,'Content Supply discovery cache stays device-local');
assert.equal(isReplicatedLibraryEntry('settings','providers'),false,'provider credentials stay device-local');
assert.equal(isReplicatedLibraryEntry('packageInstallations','artifact'),true);
const identity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:new Date().toISOString(),schemaVersion:2 as const};
const restoredSession=normalizeLibraryReplicaEntry({table:'sessions',key:crypto.randomUUID(),value:{status:'inflight',lease:{device:'other'}}},identity);
assert.deepEqual(restoredSession.value,{status:'stopped',lease:null},'Personal Semantic World owns cross-device Session normalization');
const restoredTask=normalizeLibraryReplicaEntry({table:'personalLearning',key:crypto.randomUUID(),value:{status:'generating',leaseUntil:42}},identity);
assert.deepEqual(restoredTask.value,{status:'failed',leaseUntil:0,notice:'localFlow.restoredPreparation'},'Content Supply owns interrupted preparation recovery');

const dependencies={
 package:'package-fixture',task:crypto.randomUUID(),attempt:crypto.randomUUID(),meaning:crypto.randomUUID(),media:crypto.randomUUID(),
 registrySenseVersion:crypto.randomUUID(),unrelatedRegistrySenseVersion:crypto.randomUUID(),annotation:'learning-scene:fixture',draft:crypto.randomUUID(),reconciliation:crypto.randomUUID(),
};
const continuationParent=crypto.randomUUID(),selectionParent=crypto.randomUUID();
const dependenciesFor=learningReplica.conflictDependencies;assert(dependenciesFor);
assert.deepEqual(dependenciesFor({table:'learningRuns',key:ids.localRun} as any,{
 id:ids.localRun,continuedFromRunId:continuationParent,
 lifecycleEvents:[{kind:'session_intent_selected',continuedFromRunId:selectionParent}],
 participants:{[ids.target]:{materializations:{digest:{snapshot:{provenance:{packageKey:dependencies.package,attemptId:dependencies.attempt}}}}}},
}).filter(reference=>reference.table==='learningRuns'||reference.table==='packageInstallations'||reference.table==='contentAttempts'),[
 {table:'learningRuns',key:continuationParent},{table:'learningRuns',key:selectionParent},
 {table:'packageInstallations',key:dependencies.package},{table:'contentAttempts',key:dependencies.attempt},
],'continuation and selection parents, plus referenced immutable bodies, follow the Run conflict closure');
const dependencyRows=[
 entry('packageInstallations',dependencies.package,{key:dependencies.package}),
 entry('learningTargets',ids.target,{id:ids.target,curriculumMemberships:[{packageKey:dependencies.package,provenance:{}}]}),
 entry('personalLearning',dependencies.task,{id:dependencies.task,targetId:ids.target,attemptId:dependencies.attempt,source:{personalMeaningId:dependencies.meaning}}),
 entry('contentAttempts',dependencies.attempt,{id:dependencies.attempt,taskId:dependencies.task,resumedFrom:null}),
 entry('semanticMeanings',dependencies.meaning,{personalMeaning:{personalMeaningId:dependencies.meaning},alignments:[{senseVersionId:dependencies.registrySenseVersion}],personalSemanticAnchorRevisions:[{personalMediaObjectId:dependencies.media,structuredPayload:{senseVersionId:dependencies.unrelatedRegistrySenseVersion}}]}),
 entry('semanticRegistry',`senseVersions:${dependencies.registrySenseVersion}`,{kind:'senseVersions',value:{senseVersionId:dependencies.registrySenseVersion}}),
 entry('semanticRegistry',`senseVersions:${dependencies.unrelatedRegistrySenseVersion}`,{kind:'senseVersions',value:{senseVersionId:dependencies.unrelatedRegistrySenseVersion}}),
 entry('media',dependencies.media,{mediaId:dependencies.media}),
 entry('learningRuns',ids.localRun,{id:ids.localRun,targetId:ids.target,targetIds:[ids.target],participants:{[ids.target]:{presentedMaterials:{}}}}),
 entry('learningEvents',ids.localEvent,{id:ids.localEvent,runId:ids.localRun,targetId:ids.target}),
 entry('learningReconciliations',dependencies.reconciliation,{id:dependencies.reconciliation,targetId:ids.target,candidateEventIds:[ids.localEvent],appliedEventIds:[ids.localEvent],historyOnlyEventIds:[],appliedRunIds:[ids.localRun],historyOnlyRunIds:[],selectedRunId:ids.localRun,selectedEventId:ids.localEvent}),
 entry('annotations',dependencies.annotation,{id:dependencies.annotation,kind:'learning_scene',learningTargetId:ids.target}),
 entry('drafts',dependencies.draft,{id:dependencies.draft,text:JSON.stringify({targetId:ids.target})}),
];
const targetConflict=replicaEntryId({table:'learningTargets',key:ids.target} as any);
const dependencyPartition=partitionLibraryReplicaConflicts({
 base:dependencyRows as any,
 local:dependencyRows.map(row=>row.key===ids.target?entry(row.table,row.key,{id:ids.target,curriculumMemberships:[{packageKey:dependencies.package,provenance:{}}],side:'local'}):row) as any,
 remote:dependencyRows.map(row=>row.key===ids.target?entry(row.table,row.key,{id:ids.target,curriculumMemberships:[{packageKey:dependencies.package,provenance:{}}],side:'remote'}):row) as any,
 merged:dependencyRows as any,
 conflicts:[targetConflict],
});
const affected=new Set(dependencyPartition.affectedRecordIds);
const unrelatedRegistryId=replicaEntryId({table:'semanticRegistry',key:`senseVersions:${dependencies.unrelatedRegistrySenseVersion}`} as any);
const draftId=replicaEntryId({table:'drafts',key:dependencies.draft} as any);
for(const row of dependencyRows.filter(row=>![unrelatedRegistryId,draftId].includes(replicaEntryId(row as any))))assert(affected.has(replicaEntryId(row as any)),`${row.table}/${row.key} must follow its declared conflict dependency`);
assert(!affected.has(unrelatedRegistryId),'undeclared IDs inside structured payloads must remain opaque');
assert(!affected.has(draftId),'learner prose containing serialized record IDs must remain opaque');

const rows={
  learningTargets:[{key:ids.target,value:remoteTarget}],
  learningRuns:[{key:ids.localRun,value:localRun},{key:ids.remoteRun,value:remoteRun}],
  learningEvents:[{key:ids.localEvent,value:localEvent},{key:ids.remoteEvent,value:remoteEvent}],
  learningReconciliations:[{key:decisionRow.key,value:decision}],
};
const reader=(input:typeof rows)=>libraryRowsReader(Object.assign(Object.fromEntries(sqliteLibraryTables.map(table=>[table,[]])),input) as unknown as LibraryRecordRows);
const validated=validateLearningReconciliationRecords(reader(rows));
assert.deepEqual([...validated.historyOnlyRunIds],[ids.localRun]);
assert.deepEqual([...validated.historyOnlyEventIds],[ids.localEvent]);
assert.throws(()=>validateLearningReconciliationRecords(reader({...rows,learningReconciliations:[{key:decisionRow.key,value:{...decision,selectedEventId:ids.localEvent}}]})),/libraryBackup\.errors\.inconsistent/u);

console.log('PASS: domain Replica Modules own normalization, deletion and explicit conflict dependencies; learner prose stays opaque while concurrent Learning histories reconcile deterministically.');

});
