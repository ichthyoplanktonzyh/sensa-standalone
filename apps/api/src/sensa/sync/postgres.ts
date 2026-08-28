import {
  transactionWithWorkspaceScope,
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database/index.js";
import { unsafeRepeatableReadTransaction } from "../../database/core.js";
import { getDatabaseErrorFields } from "../../database/transient.js";
import { SensaEncounterError } from "@sensa/contracts/sensa";
import {
  sensaSyncResultSchemaVersion,
  sensaSyncV2ResultSchemaVersion,
  sensaSyncV2WireVersion,
  sensaSyncWireVersion,
  type SensaSyncAppendFact,
  type SensaSyncBootstrapInput,
  type SensaSyncBootstrapResult,
  type SensaSyncCursorPair,
  type SensaSyncErrorCode,
  type SensaSyncMutableChange,
  type SensaSyncOperation,
  type SensaSyncOperationResult,
  type SensaSyncOperationResultPayload,
  type SensaSyncPullInput,
  type SensaSyncPullResult,
  type SensaSyncPushInput,
  type SensaSyncPushResult,
  type SensaSyncScope,
  type SensaSyncV2BootstrapInput,
  type SensaSyncV2BootstrapResult,
  type SensaSyncV2MutableChange,
  type SensaSyncV2Operation,
  type SensaSyncV2OperationResult,
  type SensaSyncV2PullInput,
  type SensaSyncV2PullResult,
  type SensaSyncV2PushInput,
  type SensaSyncV2PushResult,
} from "@sensa/contracts/sensa";
import {
  asSafeInteger,
  fail,
  query,
  SensaSyncError,
  stableJson,
  verifyReplicaScope,
  type Row,
  type SensaSyncErrorStatus,
} from "./support.js";
import {
  cursorPair,
  makeV2Cursor,
  parseCursor,
  parseV2Cursor,
  v2CursorPair,
  type CursorKind,
} from "./protocol.js";
import {
  loadSnapshot,
  makeSnapshotResult,
  makeV2SnapshotResult,
} from "./snapshots.js";
import {
  appendFactFromRow,
  mutableChangeFromRow,
  mutableChangeFromV2Row,
  stageFeeds,
} from "./feeds.js";
import {
  findLedgerRow,
  insertConflictLedger,
  insertLedger,
  insertV2ConflictLedger,
  insertV2Ledger,
  lockOperationIdentity,
  replayResult,
  replayV2Result,
} from "./operationLedger.js";
import {
  executeDomainOperation,
  executeV2DomainOperation,
} from "./operations.js";
export { SensaSyncError } from "./support.js";
export type { SensaSyncErrorStatus } from "./support.js";
export {
  parseSensaSyncBootstrapInput,
  parseSensaSyncPullInput,
  parseSensaSyncPushInput,
  parseSensaSyncV2BootstrapInput,
  parseSensaSyncV2PullInput,
  parseSensaSyncV2PushInput,
} from "./protocol.js";

async function ensureReplicaState(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  wireVersion: typeof sensaSyncWireVersion | typeof sensaSyncV2WireVersion = sensaSyncWireVersion,
  allowV2Upgrade = false,
): Promise<Row> {
  await verifyReplicaScope(executor, scope);
  await executor.query(`INSERT INTO sensa.sync_replica_states (workspace_id, learner_user_id, replica_id, wire_version) VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, learner_user_id, replica_id) DO NOTHING`, [scope.workspaceId, scope.learnerUserId, scope.replicaId, wireVersion]);
  const rows = await query<Row>(executor, `SELECT workspace_id::TEXT AS workspace_id, learner_user_id, replica_id::TEXT AS replica_id, wire_version, bootstrap_epoch, bootstrap_required, bootstrap_mutable_cursor, bootstrap_fact_cursor, acknowledged_mutable_cursor, acknowledged_fact_cursor, revision, bootstrapped_at, last_pulled_at, last_pushed_at FROM sensa.sync_replica_states WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3 FOR UPDATE`, [scope.workspaceId, scope.learnerUserId, scope.replicaId]);
  const row = rows[0];
  if (row === undefined) fail("state_corrupt", "Verified Sensa Sync replica state was not returned.", 500);
  const currentWireVersion = String(row.wire_version);
  if (currentWireVersion === sensaSyncV2WireVersion && wireVersion === sensaSyncWireVersion) {
    fail("upgrade_required", "This replica has upgraded to sensa-sync-v2 and cannot downgrade.", 409);
  }
  if (currentWireVersion === sensaSyncWireVersion && wireVersion === sensaSyncV2WireVersion) {
    if (!allowV2Upgrade) fail("upgrade_required", "This replica must bootstrap before using sensa-sync-v2.", 409);
    await executor.query(`
      UPDATE sensa.sync_replica_states
         SET wire_version = $4,
             bootstrap_required = TRUE
       WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3
    `, [scope.workspaceId, scope.learnerUserId, scope.replicaId, sensaSyncV2WireVersion]);
    const upgraded = await query<Row>(executor, `SELECT workspace_id::TEXT AS workspace_id, learner_user_id, replica_id::TEXT AS replica_id, wire_version, bootstrap_epoch, bootstrap_required, bootstrap_mutable_cursor, bootstrap_fact_cursor, acknowledged_mutable_cursor, acknowledged_fact_cursor, revision, bootstrapped_at, last_pulled_at, last_pushed_at FROM sensa.sync_replica_states WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3 FOR UPDATE`, [scope.workspaceId, scope.learnerUserId, scope.replicaId]);
    if (upgraded[0] === undefined) fail("state_corrupt", "Sensa Sync replica state disappeared during v2 upgrade.", 500);
    return upgraded[0];
  }
  if (currentWireVersion !== wireVersion) fail("state_corrupt", "Sensa Sync replica state has an unsupported wire version.", 500);
  return row;
}

function stateEpoch(row: Row): number { return asSafeInteger(row.bootstrap_epoch, "bootstrap epoch", 1); }
function stateSequence(row: Row, kind: CursorKind): number { return asSafeInteger(kind === "mutable" ? row.acknowledged_mutable_cursor : row.acknowledged_fact_cursor, `${kind} acknowledged cursor`); }

async function currentHighWater(executor: DatabaseExecutor): Promise<Readonly<{ mutable: number; fact: number }>> {
  const rows = await query<Row>(executor, `SELECT (SELECT COALESCE(MAX(mutable_change_sequence), 0) FROM sensa.sync_mutable_changes)::BIGINT AS mutable, (SELECT COALESCE(MAX(fact_sequence), 0) FROM sensa.sync_append_facts)::BIGINT AS fact`);
  const row = rows[0] ?? {};
  return { mutable: asSafeInteger(row.mutable ?? 0, "mutable feed high-water"), fact: asSafeInteger(row.fact ?? 0, "fact feed high-water") };
}

async function validateCursors(executor: DatabaseExecutor, row: Row, cursors: SensaSyncCursorPair, scope: SensaSyncScope): Promise<Readonly<{ mutable: number; fact: number; epoch: number }>> {
  const mutable = parseCursor(cursors.mutableCursor, "mutable");
  const fact = parseCursor(cursors.factCursor, "fact");
  const epoch = stateEpoch(row);
  if (mutable.bootstrapEpoch !== epoch || fact.bootstrapEpoch !== epoch) fail("invalid_cursor", "Cursor bootstrap epoch does not match the verified replica state.", 409);
  const high = await currentHighWater(executor);
  if (mutable.sequence > high.mutable || fact.sequence > high.fact) fail("invalid_cursor", "Cursor is beyond the current server feed high-water mark.", 409);
  if (row.bootstrap_required) fail("bootstrap_required", "This replica must bootstrap before incremental Sensa Sync.", 409);
  if (mutable.sequence < asSafeInteger(row.bootstrap_mutable_cursor, "bootstrap mutable cursor") || fact.sequence < asSafeInteger(row.bootstrap_fact_cursor, "bootstrap fact cursor")) fail("bootstrap_required", "Cursor predates the current bootstrap snapshot.", 409);
  const acknowledgedMutable = stateSequence(row, "mutable");
  const acknowledgedFact = stateSequence(row, "fact");
  if (mutable.sequence !== acknowledgedMutable || fact.sequence !== acknowledgedFact) {
    fail("invalid_cursor", "Cursors must exactly match the server-acknowledged replica position.", 409);
  }
  if (stableJson(mutable.scope) !== stableJson(scope) || stableJson(fact.scope) !== stableJson(scope)) fail("invalid_cursor", "Cursor scope does not match the verified replica.", 409);
  return { mutable: mutable.sequence, fact: fact.sequence, epoch };
}

async function validateV2Cursors(executor: DatabaseExecutor, row: Row, cursors: SensaSyncCursorPair, scope: SensaSyncScope): Promise<Readonly<{ mutable: number; fact: number; epoch: number }>> {
  const mutable = parseV2Cursor(cursors.mutableCursor, "mutable");
  const fact = parseV2Cursor(cursors.factCursor, "fact");
  const epoch = stateEpoch(row);
  if (mutable.bootstrapEpoch !== epoch || fact.bootstrapEpoch !== epoch) fail("invalid_cursor", "Cursor bootstrap epoch does not match the verified v2 replica state.", 409);
  const high = await currentHighWater(executor);
  if (mutable.sequence > high.mutable || fact.sequence > high.fact) fail("invalid_cursor", "Cursor is beyond the current server feed high-water mark.", 409);
  if (row.bootstrap_required) fail("bootstrap_required", "This replica must bootstrap before incremental Sensa Sync v2.", 409);
  if (mutable.sequence < asSafeInteger(row.bootstrap_mutable_cursor, "bootstrap mutable cursor") || fact.sequence < asSafeInteger(row.bootstrap_fact_cursor, "bootstrap fact cursor")) fail("bootstrap_required", "Cursor predates the current v2 bootstrap snapshot.", 409);
  const acknowledgedMutable = stateSequence(row, "mutable");
  const acknowledgedFact = stateSequence(row, "fact");
  if (mutable.sequence !== acknowledgedMutable || fact.sequence !== acknowledgedFact) fail("invalid_cursor", "Cursors must exactly match the server-acknowledged v2 replica position.", 409);
  if (stableJson(mutable.scope) !== stableJson(scope) || stableJson(fact.scope) !== stableJson(scope)) fail("invalid_cursor", "Cursor scope does not match the verified v2 replica.", 409);
  return { mutable: mutable.sequence, fact: fact.sequence, epoch };
}

async function bootstrapInExecutor(
  executor: DatabaseExecutor,
  input: SensaSyncBootstrapInput,
): Promise<SensaSyncBootstrapResult> {
  const state = await ensureReplicaState(executor, input.scope);
  if (!state.bootstrap_required) {
    await executor.query(`UPDATE sensa.sync_replica_states SET bootstrap_required = TRUE WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3`, [input.scope.workspaceId, input.scope.learnerUserId, input.scope.replicaId]);
  }
  const snapshot = await loadSnapshot(executor, input.scope);
  const high = await currentHighWater(executor);
  const nextEpoch = stateEpoch(state) + 1;
  const nextCursors = cursorPair(input.scope, nextEpoch, high.mutable, high.fact);
  await executor.query(`
    UPDATE sensa.sync_replica_states
       SET bootstrap_epoch = $4,
           bootstrap_required = FALSE,
           bootstrap_mutable_cursor = $5,
           bootstrap_fact_cursor = $6,
           acknowledged_mutable_cursor = $5,
           acknowledged_fact_cursor = $6,
           bootstrapped_at = statement_timestamp()
     WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3
  `, [input.scope.workspaceId, input.scope.learnerUserId, input.scope.replicaId, nextEpoch, high.mutable, high.fact]);
  const refreshedRows = await query<Row>(executor, `SELECT revision, bootstrapped_at, last_pulled_at, last_pushed_at FROM sensa.sync_replica_states WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3`, [input.scope.workspaceId, input.scope.learnerUserId, input.scope.replicaId]);
  const refreshed = refreshedRows[0];
  if (refreshed === undefined) fail("state_corrupt", "Replica state disappeared during bootstrap.", 500);
  return makeSnapshotResult(input.scope, refreshed, snapshot, nextCursors);
}

async function bootstrapV2InExecutor(executor: DatabaseExecutor, input: SensaSyncV2BootstrapInput): Promise<SensaSyncV2BootstrapResult> {
  const state = await ensureReplicaState(executor, input.scope, sensaSyncV2WireVersion, true);
  if (!state.bootstrap_required) {
    await executor.query(`UPDATE sensa.sync_replica_states SET bootstrap_required = TRUE WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3`, [input.scope.workspaceId, input.scope.learnerUserId, input.scope.replicaId]);
  }
  const snapshot = await loadSnapshot(executor, input.scope);
  const high = await currentHighWater(executor);
  const nextEpoch = stateEpoch(state) + 1;
  const nextCursors = v2CursorPair(input.scope, nextEpoch, high.mutable, high.fact);
  await executor.query(`
    UPDATE sensa.sync_replica_states
       SET bootstrap_epoch = $4,
           bootstrap_required = FALSE,
           bootstrap_mutable_cursor = $5,
           bootstrap_fact_cursor = $6,
           acknowledged_mutable_cursor = $5,
           acknowledged_fact_cursor = $6,
           bootstrapped_at = statement_timestamp()
     WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3
  `, [input.scope.workspaceId, input.scope.learnerUserId, input.scope.replicaId, nextEpoch, high.mutable, high.fact]);
  const refreshedRows = await query<Row>(executor, `SELECT revision, bootstrapped_at, last_pulled_at, last_pushed_at FROM sensa.sync_replica_states WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3`, [input.scope.workspaceId, input.scope.learnerUserId, input.scope.replicaId]);
  const refreshed = refreshedRows[0];
  if (refreshed === undefined) fail("state_corrupt", "Replica state disappeared during v2 bootstrap.", 500);
  return makeV2SnapshotResult(executor, input.scope, refreshed, snapshot, nextCursors);
}

function resultPayloadNone(): SensaSyncOperationResultPayload { return { kind: "none" }; }
function v2ResultPayloadNone(): Readonly<{ kind: "none" }> { return { kind: "none" }; }

async function processOneOperation(executor: DatabaseExecutor, input: SensaSyncPushInput, operation: SensaSyncOperation): Promise<SensaSyncOperationResult> {
  await ensureReplicaState(executor, input.scope);
  await lockOperationIdentity(executor, input.scope, operation.operationId);
  const state = await ensureReplicaState(executor, input.scope);
  await validateCursors(executor, state, input.cursors, input.scope);
  const existing = await findLedgerRow(executor, input, operation);
  if (existing !== undefined) return replayResult(input.scope, state, operation, existing);
  await executor.query("SAVEPOINT sensa_sync_domain_operation", []);
  let domainSavepointReleased = false;
  try {
    const execution = await executeDomainOperation(executor, input, operation);
    await stageFeeds(executor, input.scope, operation.operationId, execution.entities, execution.facts);
    const result = await insertLedger(executor, input, operation, execution);
    // Keep domain writes and feed staging under the savepoint until the
    // ledger is inserted last.  An unexpected feed/ledger error must roll
    // back the whole operation before any durable conflict ledger is written.
    await executor.query("RELEASE SAVEPOINT sensa_sync_domain_operation", []);
    domainSavepointReleased = true;
    await executor.query(`UPDATE sensa.sync_replica_states SET last_pushed_at = statement_timestamp() WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3`, [input.scope.workspaceId, input.scope.learnerUserId, input.scope.replicaId]);
    return result;
  } catch (caught) {
    if (!domainSavepointReleased) {
      await executor.query("ROLLBACK TO SAVEPOINT sensa_sync_domain_operation", []);
      await executor.query("RELEASE SAVEPOINT sensa_sync_domain_operation", []);
    }
    if (caught instanceof SensaSyncError) {
      if (["revision_conflict", "terminal_state_conflict", "immutable_fact_conflict", "missing_dependency", "content_unavailable", "schedule_conflict", "kernel_replay_failed", "version_mismatch", "upgrade_required"].includes(caught.code)) {
        return insertConflictLedger(executor, input, operation, caught);
      }
      throw caught;
    }
    if (caught instanceof SensaEncounterError) {
      const mapped: SensaSyncErrorCode = caught.code === "revision_conflict"
        ? "revision_conflict"
        : caught.code === "terminal_state_conflict"
          ? "terminal_state_conflict"
          : caught.code === "attempt_identity_conflict"
            ? "immutable_fact_conflict"
            : caught.code === "attempt_ordinal_conflict" || caught.code === "action_not_current"
              ? "missing_dependency"
              : caught.code === "runtime_version_unsupported" || caught.code === "response_version_unsupported"
                ? "upgrade_required"
                : caught.code === "content_unavailable"
                  ? "content_unavailable"
                  : caught.code === "schedule_conflict"
                    ? "schedule_conflict"
                    : caught.code === "kernel_replay_failed"
                      ? "kernel_replay_failed"
                      : "invalid_operation";
      if (["revision_conflict", "terminal_state_conflict", "immutable_fact_conflict", "missing_dependency", "content_unavailable", "schedule_conflict", "kernel_replay_failed", "upgrade_required"].includes(mapped)) {
        return insertConflictLedger(executor, input, operation, new SensaSyncError(mapped, caught.message, caught.statusCode, operation.operationId));
      }
      throw new SensaSyncError(mapped, caught.message, caught.statusCode, operation.operationId);
    }
    const { sqlState } = getDatabaseErrorFields(caught);
    if (sqlState === "40001" || sqlState === "40P01") fail("schedule_conflict", "The Sensa Sync operation conflicted with another accepted runtime transition; retry unchanged.", 409, operation.operationId, true);
    if (sqlState === "23505") return insertConflictLedger(executor, input, operation, new SensaSyncError("immutable_fact_conflict", "The Sensa Sync operation conflicts with an immutable server fact.", 409, operation.operationId));
    if (sqlState === "23514" || sqlState === "23503") return insertConflictLedger(executor, input, operation, new SensaSyncError("version_mismatch", "The Sensa Sync operation violates a frozen runtime invariant.", 409, operation.operationId));
    throw caught;
  }
}

function blockedV2Result(operationId: string): SensaSyncV2OperationResult {
  return { status: "rejected", acknowledged: false, errorCode: "blocked_by_prior_operation", operationId, payload: v2ResultPayloadNone(), mutableCursor: null, factCursor: null, resultDigest: null };
}

async function processOneV2Operation(
  executor: DatabaseExecutor,
  input: SensaSyncV2PushInput,
  operation: SensaSyncV2Operation,
): Promise<SensaSyncV2OperationResult> {
  await ensureReplicaState(executor, input.scope, sensaSyncV2WireVersion);
  await lockOperationIdentity(executor, input.scope, operation.operationId);
  const state = await ensureReplicaState(executor, input.scope, sensaSyncV2WireVersion);
  await validateV2Cursors(executor, state, input.cursors, input.scope);
  const existing = await findLedgerRow(executor, input, operation);
  if (existing !== undefined) return replayV2Result(input.scope, state, operation, existing);
  await executor.query("SAVEPOINT sensa_sync_v2_domain_operation", []);
  let released = false;
  try {
    const execution = await executeV2DomainOperation(executor, input, operation);
    await stageFeeds(executor, input.scope, operation.operationId, execution.entities, execution.facts);
    const result = await insertV2Ledger(executor, input, operation, execution);
    await executor.query("RELEASE SAVEPOINT sensa_sync_v2_domain_operation", []);
    released = true;
    await executor.query(`UPDATE sensa.sync_replica_states SET last_pushed_at = statement_timestamp() WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3`, [input.scope.workspaceId, input.scope.learnerUserId, input.scope.replicaId]);
    return result;
  } catch (caught) {
    if (!released) {
      await executor.query("ROLLBACK TO SAVEPOINT sensa_sync_v2_domain_operation", []);
      await executor.query("RELEASE SAVEPOINT sensa_sync_v2_domain_operation", []);
    }
    if (caught instanceof SensaSyncError) {
      if (["revision_conflict", "terminal_state_conflict", "immutable_fact_conflict", "missing_dependency", "content_unavailable", "schedule_conflict", "kernel_replay_failed", "version_mismatch", "upgrade_required"].includes(caught.code)) {
        return insertV2ConflictLedger(executor, input, operation, caught);
      }
      throw caught;
    }
    if (caught instanceof SensaEncounterError) {
      const mapped: SensaSyncErrorCode = caught.code === "revision_conflict"
        ? "revision_conflict"
        : caught.code === "terminal_state_conflict"
          ? "terminal_state_conflict"
          : caught.code === "attempt_identity_conflict"
            ? "immutable_fact_conflict"
            : caught.code === "attempt_ordinal_conflict" || caught.code === "action_not_current"
              ? "missing_dependency"
              : caught.code === "runtime_version_unsupported" || caught.code === "response_version_unsupported"
                ? "upgrade_required"
                : caught.code === "content_unavailable"
                  ? "content_unavailable"
                  : caught.code === "schedule_conflict"
                    ? "schedule_conflict"
                    : caught.code === "kernel_replay_failed"
                      ? "kernel_replay_failed"
                      : "invalid_operation";
      if (["revision_conflict", "terminal_state_conflict", "immutable_fact_conflict", "missing_dependency", "content_unavailable", "schedule_conflict", "kernel_replay_failed", "upgrade_required"].includes(mapped)) {
        return insertV2ConflictLedger(executor, input, operation, new SensaSyncError(mapped, caught.message, caught.statusCode, operation.operationId));
      }
      throw new SensaSyncError(mapped, caught.message, caught.statusCode, operation.operationId);
    }
    const { sqlState } = getDatabaseErrorFields(caught);
    if (sqlState === "40001" || sqlState === "40P01") fail("schedule_conflict", "The Sensa Sync v2 operation conflicted with another accepted runtime transition; retry unchanged.", 409, operation.operationId, true);
    if (sqlState === "23505") return insertV2ConflictLedger(executor, input, operation, new SensaSyncError("immutable_fact_conflict", "The Sensa Sync v2 operation conflicts with an immutable server fact.", 409, operation.operationId));
    if (sqlState === "23514" || sqlState === "23503") return insertV2ConflictLedger(executor, input, operation, new SensaSyncError("version_mismatch", "The Sensa Sync v2 operation violates a frozen runtime invariant.", 409, operation.operationId));
    throw caught;
  }
}

function blockedResult(operationId: string): SensaSyncOperationResult {
  return { status: "rejected", acknowledged: false, errorCode: "blocked_by_prior_operation", operationId, payload: resultPayloadNone(), mutableCursor: null, factCursor: null, resultDigest: null };
}

async function pullInExecutor(executor: DatabaseExecutor, input: SensaSyncPullInput): Promise<SensaSyncPullResult> {
  const state = await ensureReplicaState(executor, input.scope);
  if (state.bootstrap_required) return { wireVersion: sensaSyncWireVersion, resultSchemaVersion: sensaSyncResultSchemaVersion, bootstrapRequired: true, errorCode: "bootstrap_required", nextCursors: null };
  const cursorState = await validateCursors(executor, state, input.cursors, input.scope);
  const acknowledgedMutable = stateSequence(state, "mutable");
  const acknowledgedFact = stateSequence(state, "fact");
  if (cursorState.mutable < acknowledgedMutable || cursorState.fact < acknowledgedFact) fail("invalid_cursor", "Pull cursors cannot move backward from the server-acknowledged cursor.", 409);
  const mutableRows = await query<Row>(executor, `SELECT mutable_change_sequence, entity_type::TEXT AS entity_type, entity_id::TEXT AS entity_id, entity_revision, action::TEXT AS action, tombstone_reason FROM sensa.sync_mutable_changes WHERE workspace_id = $1 AND learner_user_id = $2 AND mutable_change_sequence > $3 ORDER BY mutable_change_sequence ASC LIMIT $4`, [input.scope.workspaceId, input.scope.learnerUserId, cursorState.mutable, input.limit]);
  const factRows = await query<Row>(executor, `SELECT fact_sequence, fact_type::TEXT AS fact_type, fact_id::TEXT AS fact_id, occurred_at FROM sensa.sync_append_facts WHERE workspace_id = $1 AND learner_user_id = $2 AND fact_sequence > $3 ORDER BY fact_sequence ASC LIMIT $4`, [input.scope.workspaceId, input.scope.learnerUserId, cursorState.fact, input.limit]);
  const mutableChanges: SensaSyncMutableChange[] = [];
  const latestMutable = new Map<string, Row>();
  // sensa-sync-v1 is intentionally unaware of v2-only mutable entities. It
  // still advances to the last fetched sequence below, so a v1 replica never
  // loops forever on a Learner-Declared Mastery change.
  for (const row of mutableRows) {
    if (String(row.entity_type) === "learner_declared_mastery") continue;
    latestMutable.set(`${row.entity_type}:${row.entity_id}`, row);
  }
  for (const row of latestMutable.values()) mutableChanges.push(await mutableChangeFromRow(executor, input.scope, row, cursorState.epoch));
  mutableChanges.sort((left, right) => parseCursor(left.mutableSequence, "mutable").sequence - parseCursor(right.mutableSequence, "mutable").sequence);
  const appendFacts: SensaSyncAppendFact[] = [];
  for (const row of factRows) appendFacts.push(await appendFactFromRow(executor, input.scope, row, cursorState.epoch));
  const nextMutable = mutableRows.length === 0 ? cursorState.mutable : asSafeInteger(mutableRows[mutableRows.length - 1]!.mutable_change_sequence, "next mutable cursor", 1);
  const nextFact = factRows.length === 0 ? cursorState.fact : asSafeInteger(factRows[factRows.length - 1]!.fact_sequence, "next fact cursor", 1);
  await executor.query(`UPDATE sensa.sync_replica_states SET acknowledged_mutable_cursor = $4, acknowledged_fact_cursor = $5, last_pulled_at = statement_timestamp() WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3`, [input.scope.workspaceId, input.scope.learnerUserId, input.scope.replicaId, nextMutable, nextFact]);
  const cursors = cursorPair(input.scope, cursorState.epoch, nextMutable, nextFact);
  return { wireVersion: sensaSyncWireVersion, resultSchemaVersion: sensaSyncResultSchemaVersion, bootstrapRequired: false, errorCode: null, mutableChanges, appendFacts, nextCursors: cursors };
}

async function pullV2InExecutor(executor: DatabaseExecutor, input: SensaSyncV2PullInput): Promise<SensaSyncV2PullResult> {
  const state = await ensureReplicaState(executor, input.scope, sensaSyncV2WireVersion);
  if (state.bootstrap_required) return { wireVersion: sensaSyncV2WireVersion, resultSchemaVersion: sensaSyncV2ResultSchemaVersion, bootstrapRequired: true, errorCode: "bootstrap_required", nextCursors: null };
  const cursorState = await validateV2Cursors(executor, state, input.cursors, input.scope);
  const acknowledgedMutable = stateSequence(state, "mutable");
  const acknowledgedFact = stateSequence(state, "fact");
  if (cursorState.mutable < acknowledgedMutable || cursorState.fact < acknowledgedFact) fail("invalid_cursor", "Pull cursors cannot move backward from the server-acknowledged v2 cursor.", 409);
  const mutableRows = await query<Row>(executor, `SELECT mutable_change_sequence, entity_type::TEXT AS entity_type, entity_id::TEXT AS entity_id, entity_revision, action::TEXT AS action, tombstone_reason FROM sensa.sync_mutable_changes WHERE workspace_id = $1 AND learner_user_id = $2 AND mutable_change_sequence > $3 ORDER BY mutable_change_sequence ASC LIMIT $4`, [input.scope.workspaceId, input.scope.learnerUserId, cursorState.mutable, input.limit]);
  const factRows = await query<Row>(executor, `SELECT fact_sequence, fact_type::TEXT AS fact_type, fact_id::TEXT AS fact_id, occurred_at FROM sensa.sync_append_facts WHERE workspace_id = $1 AND learner_user_id = $2 AND fact_sequence > $3 ORDER BY fact_sequence ASC LIMIT $4`, [input.scope.workspaceId, input.scope.learnerUserId, cursorState.fact, input.limit]);
  const latestMutable = new Map<string, Row>();
  for (const row of mutableRows) latestMutable.set(`${row.entity_type}:${row.entity_id}`, row);
  const mutableChanges: SensaSyncV2MutableChange[] = [];
  for (const row of latestMutable.values()) mutableChanges.push(await mutableChangeFromV2Row(executor, input.scope, row, cursorState.epoch));
  mutableChanges.sort((left, right) => parseV2Cursor(left.mutableSequence, "mutable").sequence - parseV2Cursor(right.mutableSequence, "mutable").sequence);
  const appendFacts: SensaSyncAppendFact[] = [];
  for (const row of factRows) {
    const fact = await appendFactFromRow(executor, input.scope, row, cursorState.epoch);
    appendFacts.push({ ...fact, factSequence: makeV2Cursor(input.scope, cursorState.epoch, "fact", asSafeInteger(row.fact_sequence, "fact sequence", 1)) });
  }
  const nextMutable = mutableRows.length === 0 ? cursorState.mutable : asSafeInteger(mutableRows[mutableRows.length - 1]!.mutable_change_sequence, "next mutable cursor", 1);
  const nextFact = factRows.length === 0 ? cursorState.fact : asSafeInteger(factRows[factRows.length - 1]!.fact_sequence, "next fact cursor", 1);
  await executor.query(`UPDATE sensa.sync_replica_states SET acknowledged_mutable_cursor = $4, acknowledged_fact_cursor = $5, last_pulled_at = statement_timestamp() WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3`, [input.scope.workspaceId, input.scope.learnerUserId, input.scope.replicaId, nextMutable, nextFact]);
  return { wireVersion: sensaSyncV2WireVersion, resultSchemaVersion: sensaSyncV2ResultSchemaVersion, bootstrapRequired: false, errorCode: null, mutableChanges, appendFacts, nextCursors: v2CursorPair(input.scope, cursorState.epoch, nextMutable, nextFact) };
}

async function currentReplicaCursors(executor: DatabaseExecutor, scope: SensaSyncScope): Promise<SensaSyncCursorPair> {
  const rows = await query<Row>(executor, `SELECT bootstrap_epoch, acknowledged_mutable_cursor, acknowledged_fact_cursor FROM sensa.sync_replica_states WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3`, [scope.workspaceId, scope.learnerUserId, scope.replicaId]);
  const row = rows[0];
  if (row === undefined) fail("state_corrupt", "Sensa Sync replica state is missing.", 500);
  return cursorPair(scope, stateEpoch(row), asSafeInteger(row.acknowledged_mutable_cursor, "acknowledged mutable cursor"), asSafeInteger(row.acknowledged_fact_cursor, "acknowledged fact cursor"));
}

async function currentV2ReplicaCursors(executor: DatabaseExecutor, scope: SensaSyncScope): Promise<SensaSyncCursorPair> {
  const rows = await query<Row>(executor, `SELECT bootstrap_epoch, acknowledged_mutable_cursor, acknowledged_fact_cursor FROM sensa.sync_replica_states WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3`, [scope.workspaceId, scope.learnerUserId, scope.replicaId]);
  const row = rows[0];
  if (row === undefined) fail("state_corrupt", "Sensa Sync v2 replica state is missing.", 500);
  return v2CursorPair(scope, stateEpoch(row), asSafeInteger(row.acknowledged_mutable_cursor, "acknowledged v2 mutable cursor"), asSafeInteger(row.acknowledged_fact_cursor, "acknowledged v2 fact cursor"));
}

async function pushWithTransactions(input: SensaSyncPushInput): Promise<SensaSyncPushResult> {
  const results: SensaSyncOperationResult[] = [];
  let blocked = false;
  for (const operation of input.operations) {
    if (blocked) {
      results.push(blockedResult(operation.operationId));
      continue;
    }
    try {
      const result = await transactionWithWorkspaceScope({ userId: input.scope.learnerUserId, workspaceId: input.scope.workspaceId }, async (executor) => processOneOperation(executor, input, operation));
      results.push(result);
      if (result.status === "conflict" || result.status === "rejected") blocked = true;
  } catch (caught) {
      if (caught instanceof SensaSyncError) {
        results.push({ status: "rejected", acknowledged: false, errorCode: caught.code as SensaSyncErrorCode, operationId: operation.operationId, payload: resultPayloadNone(), mutableCursor: null, factCursor: null, resultDigest: null });
        blocked = true;
        continue;
      }
      throw caught;
    }
  }
  const cursors = await transactionWithWorkspaceScope({ userId: input.scope.learnerUserId, workspaceId: input.scope.workspaceId }, async (executor) => {
    const state = await ensureReplicaState(executor, input.scope);
    await validateCursors(executor, state, input.cursors, input.scope);
    return currentReplicaCursors(executor, input.scope);
  });
  return { wireVersion: sensaSyncWireVersion, resultSchemaVersion: sensaSyncResultSchemaVersion, results, cursors };
}

async function pushV2WithTransactions(input: SensaSyncV2PushInput): Promise<SensaSyncV2PushResult> {
  const results: SensaSyncV2OperationResult[] = [];
  let blocked = false;
  for (const operation of input.operations) {
    if (blocked) {
      results.push(blockedV2Result(operation.operationId));
      continue;
    }
    try {
      const result = await transactionWithWorkspaceScope({ userId: input.scope.learnerUserId, workspaceId: input.scope.workspaceId }, async (executor) => processOneV2Operation(executor, input, operation));
      results.push(result);
      if (result.status === "conflict" || result.status === "rejected") blocked = true;
  } catch (caught) {
      if (caught instanceof SensaSyncError) {
        results.push({ status: "rejected", acknowledged: false, errorCode: caught.code as SensaSyncErrorCode, operationId: operation.operationId, payload: v2ResultPayloadNone(), mutableCursor: null, factCursor: null, resultDigest: null });
        blocked = true;
        continue;
      }
      throw caught;
    }
  }
  const cursors = await transactionWithWorkspaceScope({ userId: input.scope.learnerUserId, workspaceId: input.scope.workspaceId }, async (executor) => {
    const state = await ensureReplicaState(executor, input.scope, sensaSyncV2WireVersion);
    await validateV2Cursors(executor, state, input.cursors, input.scope);
    return currentV2ReplicaCursors(executor, input.scope);
  });
  return { wireVersion: sensaSyncV2WireVersion, resultSchemaVersion: sensaSyncV2ResultSchemaVersion, results, cursors };
}

export function createPostgresSensaSyncModule() {
  return Object.freeze({
    async bootstrap(input: SensaSyncBootstrapInput | SensaSyncV2BootstrapInput): Promise<SensaSyncBootstrapResult | SensaSyncV2BootstrapResult> {
      if (input.wireVersion === sensaSyncV2WireVersion) {
        return unsafeRepeatableReadTransaction(async (executor) => {
          await applyWorkspaceDatabaseScopeInExecutor(executor, { userId: input.scope.learnerUserId, workspaceId: input.scope.workspaceId });
          return bootstrapV2InExecutor(executor, input);
        });
      }
      if (input.wireVersion !== sensaSyncWireVersion) fail("upgrade_required", "Unsupported Sensa Sync wire version.", 409);
      return unsafeRepeatableReadTransaction(async (executor) => {
        await applyWorkspaceDatabaseScopeInExecutor(executor, { userId: input.scope.learnerUserId, workspaceId: input.scope.workspaceId });
        return bootstrapInExecutor(executor, input);
      });
    },
    async push(input: SensaSyncPushInput | SensaSyncV2PushInput): Promise<SensaSyncPushResult | SensaSyncV2PushResult> {
      if (input.wireVersion === sensaSyncV2WireVersion) return pushV2WithTransactions(input);
      if (input.wireVersion !== sensaSyncWireVersion) fail("upgrade_required", "Unsupported Sensa Sync wire version.", 409);
      return pushWithTransactions(input);
    },
    async pull(input: SensaSyncPullInput | SensaSyncV2PullInput): Promise<SensaSyncPullResult | SensaSyncV2PullResult> {
      if (input.wireVersion === sensaSyncV2WireVersion) {
        return transactionWithWorkspaceScope({ userId: input.scope.learnerUserId, workspaceId: input.scope.workspaceId }, (executor) => pullV2InExecutor(executor, input));
      }
      if (input.wireVersion !== sensaSyncWireVersion) fail("upgrade_required", "Unsupported Sensa Sync wire version.", 409);
      return transactionWithWorkspaceScope({ userId: input.scope.learnerUserId, workspaceId: input.scope.workspaceId }, (executor) => pullInExecutor(executor, input));
    },
  });
}

export const postgresSensaSyncModule = createPostgresSensaSyncModule();

export type SensaSyncModuleImplementation = ReturnType<typeof createPostgresSensaSyncModule>;
