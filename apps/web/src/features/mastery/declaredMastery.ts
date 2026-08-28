import type { SensaSyncV2Operation } from "@sensa/contracts/sensa";
import { sensaSyncV2OperationSchema } from "@sensa/contracts/sensa";
import type { SensaLocalSnapshot } from "../../store";
import type { SensaScope } from "../../api";

export function effectiveMastery(
  snapshot: SensaLocalSnapshot,
  senseId: string,
): boolean {
  const authoritative = snapshot.masteries.find((item) => item.senseId === senseId)?.isMastered ?? false;
  const pending = snapshot.outbox
    .flatMap((record) => record.operation.kind === "learner_declared_mastery.set"
      && record.operation.senseId === senseId
      && (record.status === "pending" || record.status === "failed") ? [record] : [])
    .sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt)
      || left.operationId.localeCompare(right.operationId),
    )
    .at(-1);
  return pending === undefined || pending.operation.kind !== "learner_declared_mastery.set"
    ? authoritative
    : pending.operation.isMastered;
}

/**
 * The authoritative set with unsynchronized intent laid over it. Only a Sense
 * carrying a queued declaration can differ from the server's answer, so the
 * overlay is enumerated from the outbox -- not from the content library, which
 * is no longer loaded in full.
 */
export function effectiveMasteryIds(snapshot: SensaLocalSnapshot): ReadonlySet<string> {
  const ids = new Set(snapshot.masteries.filter((item) => item.isMastered).map((item) => item.senseId));
  const pendingSenseIds = new Set(
    snapshot.outbox.flatMap((record) =>
      record.operation.kind === "learner_declared_mastery.set" ? [record.operation.senseId] : []),
  );
  for (const senseId of pendingSenseIds) {
    if (effectiveMastery(snapshot, senseId)) ids.add(senseId);
    else ids.delete(senseId);
  }
  return ids;
}

export class MasterySyncConflictError extends Error {
  readonly senseId: string;
  constructor(senseId: string) {
    super("这条已会声明需要先同步最新状态，再继续修改。");
    this.name = "MasterySyncConflictError";
    this.senseId = senseId;
  }
}

function masteryChain(snapshot: SensaLocalSnapshot, senseId: string): readonly Extract<SensaSyncV2Operation, { kind: "learner_declared_mastery.set" }>[] {
  return snapshot.outbox
    .filter((record) =>
      record.operation.kind === "learner_declared_mastery.set"
      && record.operation.senseId === senseId
      && (record.status === "pending" || record.status === "failed"),
    )
    .sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt)
      || left.operationId.localeCompare(right.operationId),
    )
    .map((record) => record.operation)
    .filter((operation): operation is Extract<SensaSyncV2Operation, { kind: "learner_declared_mastery.set" }> => operation.kind === "learner_declared_mastery.set");
}

export function masteryMutationIdentity(snapshot: SensaLocalSnapshot, senseId: string): Readonly<{
  entityId: string;
  expectedRevision: number;
}> {
  // Conflict/rejected intents remain in the outbox for inspection and
  // explicit retry, but they must not permanently block a new declaration.
  // Once the authoritative snapshot has been pulled, the next intent is
  // based on that canonical entity/revision while the original immutable
  // operation is preserved as a recoverable record.
  const authoritative = snapshot.masteries.find((item) => item.senseId === senseId) ?? null;
  const chain = masteryChain(snapshot, senseId);
  const entityId = authoritative?.learnerDeclaredMasteryId
    ?? chain[0]?.entityId
    ?? crypto.randomUUID();
  if (chain.some((operation) => operation.entityId !== entityId)) throw new MasterySyncConflictError(senseId);
  const expectedRevision = chain.reduce(
    (revision, operation) => Math.max(revision, operation.expectedRevision + 1),
    authoritative?.revision ?? 0,
  );
  return { entityId, expectedRevision };
}

export function createDeclaredMasteryOperation(input: Readonly<{
  scope: SensaScope;
  senseId: string;
  isMastered: boolean;
  entityId: string;
  expectedRevision: number;
  encounter: Readonly<{ senseEncounterId: string; expectedRevision: number }> | null;
}>): SensaSyncV2Operation {
  const operation: SensaSyncV2Operation = {
    operationId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    kind: "learner_declared_mastery.set",
    entityId: input.entityId,
    senseId: input.senseId,
    isMastered: input.isMastered,
    expectedRevision: input.expectedRevision,
    ...(input.encounter === null ? {} : { encounter: input.encounter }),
  };
  const result = sensaSyncV2OperationSchema.safeParse(operation);
  if (!result.success) throw new Error("无法创建已会声明操作。");
  return result.data;
}
