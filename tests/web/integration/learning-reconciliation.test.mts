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

test('a shared Run cannot be applied for one Target and history-only for another',()=>{
 // A header-only domain gate. This does not manufacture an admitted cohort
 // or claim that the current ordinary UI can start this structured protocol.
 const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const entry=(table:LibraryReplicaEntry['table'],key:string,value:unknown):LibraryReplicaEntry=>({table,key,value:encodeBackupValue(value)});
 const target=(n:number)=>({id:id(n),retentionId:id(n+10),memory:null,memoryRevision:0});
 const a=target(1),b=target(2),at=(minute:string)=>`2026-09-21T09:${minute}:00.000Z`;
 const event=(n:number,run:number,targetId:string,minute:string)=>entry('learningEvents',id(n),{id:id(n),runId:id(run),targetId,at:at(minute)});
 const run=(n:number,targetIds:string[],minute:string)=>entry('learningRuns',id(n),{id:id(n),targetIds,completedAt:at(minute)});
 const base=[entry('learningTargets',a.id,a),entry('learningTargets',b.id,b)];
 const local=[entry('learningTargets',a.id,{...a,memoryRevision:1}),entry('learningTargets',b.id,{...b,memoryRevision:1}),run(3,[a.id,b.id],'05'),event(6,3,a.id,'05'),event(7,3,b.id,'05')];
 const remote=[entry('learningTargets',a.id,{...a,memoryRevision:1}),entry('learningTargets',b.id,{...b,memoryRevision:1}),run(4,[a.id],'00'),run(5,[b.id],'10'),event(8,4,a.id,'00'),event(9,5,b.id,'10')];
 const merged=mergeLibraryReplicas({base,local,remote});
 const rows=Object.fromEntries(sqliteLibraryTables.map(table=>[table,merged.entries.filter(row=>row.table===table).map(row=>({key:row.key,value:decodeBackupValue(row.value)}))])) as unknown as LibraryRecordRows;
 assert.throws(()=>validateLearningReconciliationRecords(libraryRowsReader(rows)),/libraryBackup\.errors\.inconsistent/u,'global Run consistency must reject a partial cohort decision');
});

for(const identicalProjection of [true,false])for(const tied of [true,false])for(const reverse of [true,false]){
test(`completed learning facts reconcile with ${identicalProjection?'identical':'different'} projections, ${tied?'tied':'different'} completion times, ${reverse?'remote':'local'} first`,()=>{
 const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const entry=(table:LibraryReplicaEntry['table'],key:string,value:unknown):LibraryReplicaEntry=>({table,key,value:encodeBackupValue(value)});
 const target={id:id(1),retentionId:id(2),expression:'raincoat',memory:null,memoryRevision:0};
 const firstAt='2026-09-21T09:00:00.000Z',lastAt=tied?firstAt:'2026-09-21T09:05:00.000Z';
 const projection={...target,memory:{dueAt:'2026-09-24T09:00:00.000Z'},memoryRevision:2};
 const local=[entry('learningTargets',target.id,projection),
  entry('learningRuns',id(3),{id:id(3),targetIds:[target.id],completedAt:firstAt}),
  entry('learningEvents',id(5),{id:id(5),runId:id(3),targetId:target.id,at:firstAt})];
 // Two serial Runs on this device belong to one branch. A parallel branch
 // must not be inserted between them to manufacture a third scheduling step.
 const remote=[entry('learningTargets',target.id,identicalProjection?projection:{...projection,memory:{dueAt:'2026-09-25T09:05:00.000Z'}}),
  entry('learningRuns',id(4),{id:id(4),targetIds:[target.id],completedAt:firstAt}),
  entry('learningRuns',id(8),{id:id(8),targetIds:[target.id],completedAt:lastAt}),
  entry('learningEvents',id(6),{id:id(6),runId:id(4),targetId:target.id,at:firstAt}),
  entry('learningEvents',id(7),{id:id(7),runId:id(8),targetId:target.id,at:lastAt})];
 const base=[entry('learningTargets',target.id,target)];
 const merged=mergeLibraryReplicas({base,local:reverse?remote:local,remote:reverse?local:remote});
 assert.deepEqual(merged.conflicts,[]);
 const decisions=merged.entries.filter(row=>row.table==='learningReconciliations');
 assert.equal(decisions.length,1,'independent completed facts require a persisted branch decision even when Target rows are equal');
 const decision=decodeBackupValue(decisions[0]!.value) as any;
 assert.deepEqual(decision.appliedRunIds,[id(4),id(8)]);
 assert.deepEqual(decision.historyOnlyRunIds,[id(3)]);
 assert.deepEqual(decision.appliedEventIds,[id(6),id(7)]);
 assert.deepEqual(decision.historyOnlyEventIds,[id(5)]);
 assert.equal(decision.selectedRunId,id(8));
 assert.deepEqual(decodeBackupValue(merged.entries.find(row=>row.table==='learningTargets')!.value),decodeBackupValue(remote[0]!.value));
 assert.deepEqual(merged.entries.filter(row=>row.table==='learningEvents').map(row=>row.key).sort(),[id(5),id(6),id(7)]);
 assert.deepEqual(mergeLibraryReplicas({base,local:reverse?remote:local,remote:reverse?local:remote}),merged,'repeating a lost-ack merge is deterministic');
 const converged=mergeLibraryReplicas({base:merged.entries,local:merged.entries,remote:merged.entries});
 assert.deepEqual(converged.conflicts,[]);
 assert.deepEqual(converged.entries.map(({table,key,value})=>({table,key,value})),merged.entries.map(({table,key,value})=>({table,key,value})),'a converged checkpoint needs no second decision');
});
}

for(const minute of ['02','04'])for(const reverse of [false,true])test(`a stale third branch at minute ${minute} inherits the previous decision, reverse=${reverse}`,()=>{
 const id=(n:number)=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const entry=(table:LibraryReplicaEntry['table'],key:string,value:unknown):LibraryReplicaEntry=>({table,key,value:encodeBackupValue(value)});
 const target={id:id(1),retentionId:id(2),memory:null,memoryRevision:0},base=[entry('learningTargets',target.id,target)];
 const branch=(n:number,minute:string)=>[entry('learningTargets',target.id,{...target,memory:{dueAt:`2026-10-02T00:${minute}:00Z`},memoryRevision:1}),entry('learningRuns',id(n),{id:id(n),targetIds:[target.id],completedAt:`2026-10-01T00:${minute}:00Z`}),entry('learningEvents',id(n+10),{id:id(n+10),runId:id(n),targetId:target.id,at:`2026-10-01T00:${minute}:00Z`})];
 const a=branch(3,'01'),b=branch(4,'03'),c=branch(5,minute),first=mergeLibraryReplicas({base,local:a,remote:b});
 const second=mergeLibraryReplicas({base,local:reverse?first.entries:c,remote:reverse?c:first.entries});
 assert.deepEqual(second.conflicts,[]);const decisions=second.entries.filter(row=>row.table==='learningReconciliations').map(row=>decodeBackupValue(row.value));
 assert.equal(decisions.length,2);const original=decodeBackupValue(first.entries.find(row=>row.table==='learningReconciliations')!.value),next=decisions.find(row=>row.id!==original.id)!;
 assert.deepEqual(decisions.find(row=>row.id===original.id),original);assert.deepEqual(next.supersededDecisionIds,[original.id]);
 assert.deepEqual(next.appliedRunIds,[minute==='02'?id(4):id(5)]);assert.deepEqual(next.historyOnlyRunIds,[id(3),minute==='02'?id(5):id(4)].sort());
 const rows=Object.fromEntries(sqliteLibraryTables.map(table=>[table,second.entries.filter(row=>row.table===table).map(row=>({key:row.key,value:decodeBackupValue(row.value)}))])) as unknown as LibraryRecordRows;
 const roles=validateLearningReconciliationRecords(libraryRowsReader(rows));assert.deepEqual([...roles.historyOnlyRunIds].sort(),next.historyOnlyRunIds);
 assert.deepEqual(decodeBackupValue(second.entries.find(row=>row.table==='learningTargets')!.value),decodeBackupValue((minute==='02'?b:c)[0]!.value));
 assert.deepEqual(mergeLibraryReplicas({base,local:reverse?c:first.entries,remote:reverse?first.entries:c}),second);
 assert.deepEqual(mergeLibraryReplicas({base:second.entries,local:second.entries,remote:second.entries}).entries.map(({table,key,value})=>({table,key,value})),second.entries.map(({table,key,value})=>({table,key,value})));
 const tampered=structuredClone(rows);[...tampered.learningReconciliations].find(row=>row.key===next.id)!.value.supersededDecisionIds=[id(999)];assert.throws(()=>validateLearningReconciliationRecords(libraryRowsReader(tampered)),/inconsistent/u);
});

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
const mergeActive=(facts:Entry[])=>mergeLibraryReplicas({base:facts,local:facts,remote:facts});
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
 entry('annotations',dependencies.annotation,{id:dependencies.annotation,kind:'learning_scene',learningTargetId:ids.target,conflictHistory:{version:1,head:null,branches:[],decisions:[]}}),
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
