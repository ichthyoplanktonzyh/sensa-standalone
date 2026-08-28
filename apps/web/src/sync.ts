import type {
  SensaSyncV2Operation,
  SensaSyncV2OperationResult,
} from "@sensa/contracts/sensa";
import { sensaSyncV2OperationSchema } from "@sensa/contracts/sensa";
import { canonicalJsonDigest, parseLearningResponsePayload } from "@sensa/learning-kernel";
import { SensaApiError, SensaContractError, sensaApi, type SensaScope } from "./api";
import { shouldQueueTerminalCompletion } from "./features/study/lifecycle";
import {
  outboxRecord,
  sensaStore,
  type SensaLocalOutbox,
  type SensaLocalSnapshot,
} from "./store";

export type SensaSyncResult = Readonly<{
  snapshot: SensaLocalSnapshot;
  notice: string | null;
}>;

function describe(error: unknown): string {
  if (error instanceof SensaApiError) {
    return error.requestId === null ? error.message : `${error.message}（request ID: ${error.requestId}）`;
  }
  if (error instanceof SensaContractError) return error.message;
  return error instanceof Error ? error.message : "同步暂时不可用。";
}

/**
 * A cursor the server no longer recognises is not a transport failure; it means
 * this replica's projection cannot be advanced and must be rebuilt. Everything
 * else is left alone so an offline learner keeps their queued intent.
 */
function needsProjectionRepair(error: unknown): boolean {
  if (!(error instanceof SensaApiError)) return false;
  const code = error.code?.toLowerCase() ?? "";
  return code.includes("cursor") || code.includes("bootstrap") || code.includes("epoch");
}

function pendingFor(snapshot: SensaLocalSnapshot, scope: SensaScope): readonly SensaLocalOutbox[] {
  return snapshot.outbox
    .filter((record) =>
      record.scope.workspaceId === scope.workspaceId
      && record.scope.learnerUserId === scope.learnerUserId
      && record.scope.replicaId === scope.replicaId
      && (record.status === "pending" || record.status === "failed"))
    .slice()
    .sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt)
      || left.operationId.localeCompare(right.operationId));
}

function assertCompleteResponse(
  operations: readonly SensaSyncV2Operation[],
  results: readonly SensaSyncV2OperationResult[],
): void {
  const answered = new Set(results.map((result) => result.operationId));
  const asked = operations.map((operation) => operation.operationId);
  if (results.length !== operations.length || asked.some((id) => !answered.has(id))) {
    throw new SensaContractError("sync/push", "服务端没有为每条操作返回结果。");
  }
}

type PushOutcome = Readonly<{
  notice: string | null;
  results: readonly SensaSyncV2OperationResult[];
}>;

async function push(scope: SensaScope, snapshot: SensaLocalSnapshot): Promise<PushOutcome> {
  const pending = pendingFor(snapshot, scope);
  const cursors = snapshot.meta.cursors;
  if (pending.length === 0 || cursors === null) return { notice: null, results: [] };
  const operations = pending.map((record) => record.operation);
  try {
    const result = await sensaApi.syncPush(scope, cursors, operations);
    assertCompleteResponse(operations, result.results);
    await sensaStore.applyPushResult({ cursors: result.cursors, results: result.results });
    const unresolved = result.results.filter((item) => !item.acknowledged);
    return {
      notice: unresolved.length === 0
        ? null
        : `有 ${unresolved.length} 条学习记录未被接受，已保留在本机等待处理。`,
      results: result.results,
    };
  } catch (error) {
    const message = describe(error);
    await sensaStore.markOutboxFailed(
      pending.map((record) => record.operationId),
      { code: error instanceof SensaApiError ? error.code : null, message },
    );
    return { notice: `已保存在本机，联网后继续同步：${message}`, results: [] };
  }
}

/**
 * The Stop Policy lives on the server; a `nextAction` of `null` on an accepted
 * Attempt is how it tells this replica that the Encounter's facts are complete.
 * Completion is then a separate operation, exactly as the Sync contract splits
 * `learning_attempt.record` from `sense_encounter.complete`.
 */
async function queueCompletions(
  scope: SensaScope,
  results: readonly SensaSyncV2OperationResult[],
): Promise<boolean> {
  if (results.length === 0) return false;
  const fresh = await sensaStore.loadSnapshot();
  const existingOperations = fresh.outbox.map((record) => record.operation);
  const queued = new Set(
    existingOperations
      .filter((operation) => operation.kind === "sense_encounter.complete")
      .map((operation) => operation.senseEncounterId),
  );
  let added = false;
  for (const result of results) {
    if (!result.acknowledged || result.payload.kind !== "learning_attempt") continue;
    const encounterId = result.payload.fact.senseEncounterId;
    if (queued.has(encounterId)) continue;
    const encounter = fresh.encounters.find((item) => item.senseEncounterId === encounterId);
    if (encounter === undefined) continue;
    if (!shouldQueueTerminalCompletion({
      attemptResult: result,
      encounterStatus: encounter.status,
      existingOperations,
    })) continue;
    await sensaStore.addOutbox(outboxRecord(scope, sensaSyncV2OperationSchema.parse({
      operationId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      kind: "sense_encounter.complete",
      senseEncounterId: encounterId,
      expectedRevision: encounter.revision,
    })));
    queued.add(encounterId);
    added = true;
  }
  return added;
}

async function pull(scope: SensaScope, snapshot: SensaLocalSnapshot): Promise<"ok" | "bootstrap_required"> {
  const cursors = snapshot.meta.cursors;
  if (cursors === null) return "bootstrap_required";
  const result = await sensaApi.syncPull(scope, cursors);
  if (result.bootstrapRequired) return "bootstrap_required";
  await sensaStore.applyPull(result);
  return "ok";
}

/** Push everything queued, then advance the projection. Never throws. */
async function drain(scope: SensaScope, start: SensaLocalSnapshot): Promise<SensaSyncResult> {
  let snapshot = start;
  let notice: string | null = null;

  const first = await push(scope, snapshot);
  notice = first.notice;
  if (await queueCompletions(scope, first.results)) {
    snapshot = await sensaStore.loadSnapshot();
    const second = await push(scope, snapshot);
    notice = second.notice ?? notice;
  }

  snapshot = await sensaStore.loadSnapshot();
  try {
    if (await pull(scope, snapshot) === "bootstrap_required") {
      await sensaStore.applyBootstrap(scope, await sensaApi.syncBootstrap(scope));
      snapshot = await sensaStore.loadSnapshot();
      const replayed = await push(scope, snapshot);
      notice = replayed.notice ?? notice;
      snapshot = await sensaStore.loadSnapshot();
      await pull(scope, snapshot);
    }
  } catch (error) {
    if (needsProjectionRepair(error)) {
      try {
        await sensaStore.applyBootstrap(scope, await sensaApi.syncBootstrap(scope));
        snapshot = await sensaStore.loadSnapshot();
        await pull(scope, snapshot);
      } catch (repairError) {
        notice = `本机记录已保留，联网后继续同步：${describe(repairError)}`;
      }
    } else {
      notice = `本机记录已保留，联网后继续同步：${describe(error)}`;
    }
  }

  snapshot = await sensaStore.loadSnapshot();
  if (snapshot.invalidOutbox.length > 0) {
    const extra = `有 ${snapshot.invalidOutbox.length} 条本机记录无法按当前合同读取，已原样保留。`;
    notice = notice === null ? extra : `${notice} ${extra}`;
  }
  return { snapshot, notice };
}

export async function synchronize(scope: SensaScope): Promise<SensaSyncResult> {
  let snapshot = await sensaStore.loadSnapshot();
  if (snapshot.meta.scope === null || snapshot.meta.bootstrapRequired || snapshot.meta.cursors === null) {
    await sensaStore.applyBootstrap(scope, await sensaApi.syncBootstrap(scope));
    snapshot = await sensaStore.loadSnapshot();
  }
  return drain(scope, snapshot);
}

export function learningAttemptOperation(input: Readonly<{
  attemptId: string;
  encounterId: string;
  actionId: string;
  ordinal: number;
  response: Readonly<Record<string, unknown>>;
  durationMs: number | null;
}>): SensaSyncV2Operation {
  const accepted = parseLearningResponsePayload(input.response);
  if (accepted === null) {
    throw new SensaContractError("learning_attempt.responsePayload", "这不是一个受支持的作答形状。");
  }
  return sensaSyncV2OperationSchema.parse({
    operationId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    kind: "learning_attempt.record",
    learningAttemptId: input.attemptId,
    senseEncounterId: input.encounterId,
    learningActionId: input.actionId,
    ordinal: input.ordinal,
    responseSchemaVersion: "sensa-learning-response-v1",
    responsePayload: { object: accepted, digest: canonicalJsonDigest(accepted) },
    durationMs: input.durationMs,
  });
}

export function encounterInterruptOperation(input: Readonly<{
  encounterId: string;
  expectedRevision: number;
  status: "interrupted" | "cancelled";
}>): SensaSyncV2Operation {
  return sensaSyncV2OperationSchema.parse({
    operationId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    kind: "sense_encounter.interrupt",
    senseEncounterId: input.encounterId,
    expectedRevision: input.expectedRevision,
    status: input.status,
  });
}

export function sessionCompleteOperation(input: Readonly<{
  learningSessionId: string;
  expectedRevision: number;
  status: "completed" | "abandoned";
}>): SensaSyncV2Operation {
  return sensaSyncV2OperationSchema.parse({
    operationId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    kind: "learning_session.complete",
    learningSessionId: input.learningSessionId,
    expectedRevision: input.expectedRevision,
    status: input.status,
  });
}

export function studyPlanPacingOperation(input: Readonly<{
  studyPlanId: string;
  expectedRevision: number;
  dailyNewSenseTarget: number;
}>): SensaSyncV2Operation {
  return sensaSyncV2OperationSchema.parse({
    operationId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    kind: "study_plan.update",
    studyPlanId: input.studyPlanId,
    expectedRevision: input.expectedRevision,
    mutation: "pacing",
    dailyNewSenseTarget: input.dailyNewSenseTarget,
  });
}
