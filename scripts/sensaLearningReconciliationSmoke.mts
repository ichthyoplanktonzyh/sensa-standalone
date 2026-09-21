import assert from 'node:assert/strict';

import {decodeBackupValue,encodeBackupValue} from '../apps/web/src/data/library/backupCodec.ts';
import {
  reconcileConcurrentLearningEntries,
  validateLearningReconciliationRows,
} from '../apps/web/src/data/library/learningReconciliation.ts';

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

console.log('PASS: concurrent completed learning histories retain both branches, persist an auditable decision, and deterministically materialize only the latest branch.');
