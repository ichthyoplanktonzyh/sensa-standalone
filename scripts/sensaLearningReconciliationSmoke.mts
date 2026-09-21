import assert from 'node:assert/strict';

import {decodeBackupValue,encodeBackupValue} from '../apps/web/src/data/library/backupCodec.ts';
import {
  reconcileConcurrentLearningEntries,
  validateLearningReconciliationRows,
} from '../apps/web/src/data/library/learningReconciliation.ts';
import {
  isReplicatedLibraryEntry,
  mergeLibraryReplicas,
  normalizeLibraryReplicaEntry,
  planLibraryReplicaApply,
} from '../apps/web/src/data/library/replication/libraryReplica.ts';

type Entry={table:string;key:string;value:unknown};
const ids={
  target:'00000000-0000-4000-8000-000000000001',
  retention:'00000000-0000-4000-8000-000000000002',
  localRun:'00000000-0000-4000-8000-000000000003',
  remoteRun:'00000000-0000-4000-8000-000000000004',
  localEvent:'00000000-0000-4000-8000-000000000005',
  remoteEvent:'00000000-0000-4000-8000-000000000006',
};
const entry=(table:string,key:string,value:unknown):Entry=>({table,key,value:encodeBackupValue(value)});
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
assert.equal(isReplicatedLibraryEntry('meta','package-catalog'),false,'Content Supply discovery cache stays device-local');
assert.equal(isReplicatedLibraryEntry('settings','providers'),false,'provider credentials stay device-local');
assert.equal(isReplicatedLibraryEntry('packageInstallations','artifact'),true);
const identity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:new Date().toISOString(),schemaVersion:2 as const};
const restoredSession=normalizeLibraryReplicaEntry({table:'sessions',key:crypto.randomUUID(),value:{status:'inflight',lease:{device:'other'}}},identity);
assert.deepEqual(restoredSession.value,{status:'stopped',lease:null},'Personal Semantic World owns cross-device Session normalization');
const restoredTask=normalizeLibraryReplicaEntry({table:'personalLearning',key:crypto.randomUUID(),value:{status:'generating',leaseUntil:42}},identity);
assert.deepEqual(restoredTask.value,{status:'failed',leaseUntil:0,notice:'localFlow.restoredPreparation'},'Content Supply owns interrupted preparation recovery');

const rows={
  learningTargets:[{key:ids.target,value:remoteTarget}],
  learningRuns:[{key:ids.localRun,value:localRun},{key:ids.remoteRun,value:remoteRun}],
  learningEvents:[{key:ids.localEvent,value:localEvent},{key:ids.remoteEvent,value:remoteEvent}],
  learningReconciliations:[{key:decisionRow.key,value:decision}],
};
const validated=validateLearningReconciliationRows(rows);
assert.deepEqual([...validated.historyOnlyRunIds],[ids.localRun]);
assert.deepEqual([...validated.historyOnlyEventIds],[ids.localEvent]);
assert.throws(()=>validateLearningReconciliationRows({...rows,learningReconciliations:[{key:decisionRow.key,value:{...decision,selectedEventId:ids.localEvent}}]}),/libraryBackup\.errors\.inconsistent/u);

console.log('PASS: domain Replica Modules own normalization and deletion policy; concurrent Learning histories retain both branches, persist an auditable decision, and deterministically materialize only the latest branch.');
