import type { DatabaseExecutor } from "../../database/index.js";
import {
  sensaSyncCanonicalizerVersion,
  sensaSyncResultSchemaVersion,
  sensaSyncV2CanonicalizerVersion,
  sensaSyncV2ResultSchemaVersion,
  sensaSyncV2WireVersion,
  sensaSyncWireVersion,
} from "@sensa/contracts/sensa";
import type {
  SensaSyncErrorCode,
  SensaSyncOperation,
  SensaSyncOperationResult,
  SensaSyncOperationResultPayload,
  SensaSyncPushInput,
  SensaSyncScope,
  SensaSyncV2Operation,
  SensaSyncV2OperationResult,
  SensaSyncV2OperationResultPayload,
  SensaSyncV2PushInput,
} from "@sensa/contracts/sensa";
import { makeCursor, makeV2Cursor } from "./protocol.js";
import {
  asSafeInteger,
  digest,
  fail,
  query,
  requireObject,
  SensaSyncError,
  stableJson,
  type Row,
} from "./support.js";

type AcceptedExecution<TPayload> = Readonly<{
  payload: TPayload;
  rebased: boolean;
}>;

function nonePayload(): SensaSyncOperationResultPayload {
  return { kind: "none" };
}

function noneV2Payload(): Readonly<{ kind: "none" }> {
  return { kind: "none" };
}

function stateEpoch(row: Row): number {
  return asSafeInteger(row.bootstrap_epoch, "bootstrap epoch", 1);
}

function resultStatusForApplied(rebased: boolean): "applied" | "rebased" {
  return rebased ? "rebased" : "applied";
}

function operationPayloadForHash(
  operation: SensaSyncOperation | SensaSyncV2Operation,
): unknown {
  const clone = { ...operation } as Record<string, unknown>;
  delete clone.kind;
  delete clone.operationId;
  delete clone.occurredAt;
  return {
    kind: operation.kind,
    operationId: operation.operationId,
    occurredAt: operation.occurredAt,
    payload: clone,
  };
}

export async function lockOperationIdentity(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  operationId: string,
): Promise<void> {
  await executor.query(
    "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0::bigint))",
    [stableJson([scope.workspaceId, scope.learnerUserId, operationId])],
  );
}

export async function findLedgerRow(
  executor: DatabaseExecutor,
  input: Readonly<{ scope: SensaSyncScope }>,
  operation: Readonly<{ operationId: string }>,
): Promise<Row | undefined> {
  // The immutable ledger grants no UPDATE privilege to backend_app. The
  // unique key serializes first writers while exact replays remain reads.
  const rows = await query<Row>(executor, `
    SELECT operation_id, kind::TEXT AS kind, wire_version, payload_digest,
           result_digest, result_payload, stored_status::TEXT AS stored_status,
           error_code::TEXT AS error_code, first_mutable_sequence,
           last_mutable_sequence, first_fact_sequence, last_fact_sequence
      FROM sensa.sync_operations
     WHERE workspace_id = $1 AND learner_user_id = $2 AND operation_id = $3
  `, [input.scope.workspaceId, input.scope.learnerUserId, operation.operationId]);
  return rows[0];
}

export function replayResult(
  scope: SensaSyncScope,
  state: Row,
  operation: SensaSyncOperation,
  row: Row,
): SensaSyncOperationResult {
  const storedPayload = requireObject(row.result_payload, "stored result payload") as SensaSyncOperationResultPayload;
  const storedDigest = String(row.result_digest);
  if (String(row.wire_version) !== sensaSyncWireVersion
    || String(row.kind) !== operation.kind
    || String(row.payload_digest) !== digest(operationPayloadForHash(operation))) {
    return {
      status: "rejected",
      acknowledged: false,
      errorCode: "operation_id_reuse",
      operationId: operation.operationId,
      payload: nonePayload(),
      mutableCursor: null,
      factCursor: null,
      resultDigest: null,
    };
  }
  if (String(row.stored_status) === "conflict") {
    return {
      status: "conflict",
      acknowledged: false,
      errorCode: String(row.error_code) as SensaSyncErrorCode,
      operationId: operation.operationId,
      payload: storedPayload,
      mutableCursor: null,
      factCursor: null,
      resultDigest: storedDigest as SensaSyncOperationResult["resultDigest"],
    } as SensaSyncOperationResult;
  }
  const mutableSequence = row.last_mutable_sequence === null
    ? null
    : asSafeInteger(row.last_mutable_sequence, "stored mutable cursor");
  const factSequence = row.last_fact_sequence === null
    ? null
    : asSafeInteger(row.last_fact_sequence, "stored fact cursor");
  const bootstrapMutable = asSafeInteger(state.bootstrap_mutable_cursor, "bootstrap mutable cursor");
  const bootstrapFact = asSafeInteger(state.bootstrap_fact_cursor, "bootstrap fact cursor");
  return {
    status: "replayed",
    acknowledged: true,
    errorCode: null,
    operationId: operation.operationId,
    payload: storedPayload,
    mutableCursor: mutableSequence === null || mutableSequence < bootstrapMutable
      ? null
      : makeCursor(scope, stateEpoch(state), "mutable", mutableSequence),
    factCursor: factSequence === null || factSequence < bootstrapFact
      ? null
      : makeCursor(scope, stateEpoch(state), "fact", factSequence),
    resultDigest: storedDigest as SensaSyncOperationResult["resultDigest"],
  } as SensaSyncOperationResult;
}

export function replayV2Result(
  scope: SensaSyncScope,
  state: Row,
  operation: SensaSyncV2Operation,
  row: Row,
): SensaSyncV2OperationResult {
  const storedPayload = requireObject(row.result_payload, "stored result payload") as SensaSyncV2OperationResultPayload;
  const storedDigest = typeof row.result_digest === "string" && row.result_digest.trim() !== ""
    ? row.result_digest
    : null;
  const storedWireVersion = String(row.wire_version);
  const canReplayV1Subset = storedWireVersion === sensaSyncWireVersion
    && operation.kind !== "learner_declared_mastery.set";
  if ((storedWireVersion !== sensaSyncV2WireVersion && !canReplayV1Subset)
    || String(row.kind) !== operation.kind
    || String(row.payload_digest) !== digest(operationPayloadForHash(operation))) {
    return {
      status: "rejected",
      acknowledged: false,
      errorCode: "operation_id_reuse",
      operationId: operation.operationId,
      payload: noneV2Payload(),
      mutableCursor: null,
      factCursor: null,
      resultDigest: null,
    };
  }
  if (String(row.stored_status) === "conflict") {
    if (storedDigest === null) {
      fail("state_corrupt", "The stored Sensa Sync v2 conflict result has no result digest.", 500, operation.operationId);
    }
    return {
      status: "conflict",
      acknowledged: false,
      errorCode: String(row.error_code) as SensaSyncErrorCode,
      operationId: operation.operationId,
      payload: noneV2Payload(),
      mutableCursor: null,
      factCursor: null,
      resultDigest: storedDigest,
    };
  }
  const mutableSequence = row.last_mutable_sequence === null
    ? null
    : asSafeInteger(row.last_mutable_sequence, "stored mutable cursor");
  const factSequence = row.last_fact_sequence === null
    ? null
    : asSafeInteger(row.last_fact_sequence, "stored fact cursor");
  const bootstrapMutable = asSafeInteger(state.bootstrap_mutable_cursor, "bootstrap mutable cursor");
  const bootstrapFact = asSafeInteger(state.bootstrap_fact_cursor, "bootstrap fact cursor");
  return {
    status: "replayed",
    acknowledged: true,
    errorCode: null,
    operationId: operation.operationId,
    payload: storedPayload,
    mutableCursor: mutableSequence === null || mutableSequence < bootstrapMutable
      ? null
      : makeV2Cursor(scope, stateEpoch(state), "mutable", mutableSequence),
    factCursor: factSequence === null || factSequence < bootstrapFact
      ? null
      : makeV2Cursor(scope, stateEpoch(state), "fact", factSequence),
    resultDigest: storedDigest as SensaSyncV2OperationResult["resultDigest"],
  } as SensaSyncV2OperationResult;
}

export async function insertLedger(
  executor: DatabaseExecutor,
  input: SensaSyncPushInput,
  operation: SensaSyncOperation,
  execution: AcceptedExecution<SensaSyncOperationResultPayload>,
): Promise<SensaSyncOperationResult> {
  const resultPayload = execution.payload;
  const resultDigest = digest(resultPayload);
  const status = resultStatusForApplied(execution.rebased);
  const rows = await query<Row>(executor, `
    INSERT INTO sensa.sync_operations (
      workspace_id, learner_user_id, operation_id, server_acceptance_sequence,
      replica_id, wire_version, canonicalizer_version, result_schema_version,
      kind, occurred_at, payload_digest, result_digest, result_payload,
      stored_status, acknowledged
    ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8::sensa.sync_operation_kind,
              $9, $10, $11, $12::JSONB, $13::sensa.sync_operation_result_status, TRUE)
    RETURNING first_mutable_sequence, last_mutable_sequence,
              first_fact_sequence, last_fact_sequence
  `, [input.scope.workspaceId, input.scope.learnerUserId, operation.operationId,
    input.scope.replicaId, sensaSyncWireVersion, sensaSyncCanonicalizerVersion,
    sensaSyncResultSchemaVersion, operation.kind, new Date(operation.occurredAt),
    digest(operationPayloadForHash(operation)), resultDigest,
    JSON.stringify(resultPayload), status]);
  const row = rows[0];
  if (row === undefined) fail("state_corrupt", "Sensa Sync operation ledger row was not returned.", 500, operation.operationId);
  const stateRows = await query<Row>(executor, `
    SELECT bootstrap_epoch
      FROM sensa.sync_replica_states
     WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3
  `, [input.scope.workspaceId, input.scope.learnerUserId, input.scope.replicaId]);
  const state = stateRows[0];
  if (state === undefined) fail("state_corrupt", "Sensa Sync replica state disappeared while acknowledging an operation.", 500, operation.operationId);
  return {
    status,
    acknowledged: true,
    errorCode: null,
    operationId: operation.operationId,
    payload: resultPayload,
    mutableCursor: row.last_mutable_sequence === null
      ? null
      : makeCursor(input.scope, stateEpoch(state), "mutable", asSafeInteger(row.last_mutable_sequence, "operation mutable cursor")),
    factCursor: row.last_fact_sequence === null
      ? null
      : makeCursor(input.scope, stateEpoch(state), "fact", asSafeInteger(row.last_fact_sequence, "operation fact cursor")),
    resultDigest: resultDigest as SensaSyncOperationResult["resultDigest"],
  } as SensaSyncOperationResult;
}

export async function insertConflictLedger(
  executor: DatabaseExecutor,
  input: SensaSyncPushInput,
  operation: SensaSyncOperation,
  error: SensaSyncError,
): Promise<SensaSyncOperationResult> {
  const payload = nonePayload();
  const resultDigest = digest(payload);
  await executor.query(`
    INSERT INTO sensa.sync_operations (
      workspace_id, learner_user_id, operation_id, server_acceptance_sequence,
      replica_id, wire_version, canonicalizer_version, result_schema_version,
      kind, occurred_at, payload_digest, result_digest, result_payload,
      stored_status, error_code, acknowledged
    ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8::sensa.sync_operation_kind,
              $9, $10, $11, $12::JSONB, 'conflict', $13::sensa.sync_error_code, FALSE)
  `, [input.scope.workspaceId, input.scope.learnerUserId, operation.operationId,
    input.scope.replicaId, sensaSyncWireVersion, sensaSyncCanonicalizerVersion,
    sensaSyncResultSchemaVersion, operation.kind, new Date(operation.occurredAt),
    digest(operationPayloadForHash(operation)), resultDigest,
    JSON.stringify(payload), error.code]);
  return {
    status: "conflict",
    acknowledged: false,
    errorCode: error.code as SensaSyncErrorCode,
    operationId: operation.operationId,
    payload,
    mutableCursor: null,
    factCursor: null,
    resultDigest: resultDigest as SensaSyncOperationResult["resultDigest"],
  } as SensaSyncOperationResult;
}

export async function insertV2Ledger(
  executor: DatabaseExecutor,
  input: SensaSyncV2PushInput,
  operation: SensaSyncV2Operation,
  execution: AcceptedExecution<SensaSyncV2OperationResultPayload>,
): Promise<SensaSyncV2OperationResult> {
  const resultPayload = execution.payload;
  const resultDigest = digest(resultPayload);
  const status = resultStatusForApplied(execution.rebased);
  const rows = await query<Row>(executor, `
    INSERT INTO sensa.sync_operations (
      workspace_id, learner_user_id, operation_id, server_acceptance_sequence,
      replica_id, wire_version, canonicalizer_version, result_schema_version,
      kind, occurred_at, payload_digest, result_digest, result_payload,
      stored_status, acknowledged
    ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8::sensa.sync_operation_kind,
              $9, $10, $11, $12::JSONB, $13::sensa.sync_operation_result_status, TRUE)
    RETURNING first_mutable_sequence, last_mutable_sequence,
              first_fact_sequence, last_fact_sequence
  `, [input.scope.workspaceId, input.scope.learnerUserId, operation.operationId,
    input.scope.replicaId, sensaSyncV2WireVersion, sensaSyncV2CanonicalizerVersion,
    sensaSyncV2ResultSchemaVersion, operation.kind, new Date(operation.occurredAt),
    digest(operationPayloadForHash(operation)), resultDigest,
    JSON.stringify(resultPayload), status]);
  const row = rows[0];
  if (row === undefined) fail("state_corrupt", "Sensa Sync v2 operation ledger row was not returned.", 500, operation.operationId);
  const stateRows = await query<Row>(executor, `
    SELECT bootstrap_epoch
      FROM sensa.sync_replica_states
     WHERE workspace_id = $1 AND learner_user_id = $2 AND replica_id = $3
  `, [input.scope.workspaceId, input.scope.learnerUserId, input.scope.replicaId]);
  const state = stateRows[0];
  if (state === undefined) fail("state_corrupt", "Sensa Sync v2 replica state disappeared while acknowledging an operation.", 500, operation.operationId);
  return {
    status,
    acknowledged: true,
    errorCode: null,
    operationId: operation.operationId,
    payload: resultPayload,
    mutableCursor: row.last_mutable_sequence === null
      ? null
      : makeV2Cursor(input.scope, stateEpoch(state), "mutable", asSafeInteger(row.last_mutable_sequence, "operation mutable cursor")),
    factCursor: row.last_fact_sequence === null
      ? null
      : makeV2Cursor(input.scope, stateEpoch(state), "fact", asSafeInteger(row.last_fact_sequence, "operation fact cursor")),
    resultDigest: resultDigest as SensaSyncV2OperationResult["resultDigest"],
  } as SensaSyncV2OperationResult;
}

export async function insertV2ConflictLedger(
  executor: DatabaseExecutor,
  input: SensaSyncV2PushInput,
  operation: SensaSyncV2Operation,
  error: SensaSyncError,
): Promise<SensaSyncV2OperationResult> {
  const payload: Readonly<{ kind: "none" }> = noneV2Payload();
  const resultDigest = digest(payload);
  await executor.query(`
    INSERT INTO sensa.sync_operations (
      workspace_id, learner_user_id, operation_id, server_acceptance_sequence,
      replica_id, wire_version, canonicalizer_version, result_schema_version,
      kind, occurred_at, payload_digest, result_digest, result_payload,
      stored_status, error_code, acknowledged
    ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8::sensa.sync_operation_kind,
              $9, $10, $11, $12::JSONB, 'conflict', $13::sensa.sync_error_code, FALSE)
  `, [input.scope.workspaceId, input.scope.learnerUserId, operation.operationId,
    input.scope.replicaId, sensaSyncV2WireVersion, sensaSyncV2CanonicalizerVersion,
    sensaSyncV2ResultSchemaVersion, operation.kind, new Date(operation.occurredAt),
    digest(operationPayloadForHash(operation)), resultDigest,
    JSON.stringify(payload), error.code]);
  return {
    status: "conflict",
    acknowledged: false,
    errorCode: error.code as SensaSyncErrorCode,
    operationId: operation.operationId,
    payload,
    mutableCursor: null,
    factCursor: null,
    resultDigest: resultDigest as SensaSyncV2OperationResult["resultDigest"],
  } as SensaSyncV2OperationResult;
}
