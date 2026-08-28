import type {
  SensaSyncAppendFact,
  SensaSyncV2Operation,
  SensaSyncV2OperationResult,
} from "@sensa/contracts/sensa";

export type AttemptLifecycleSnapshot = Readonly<{
  appendFacts: readonly SensaSyncAppendFact[];
  outbox: readonly Readonly<{
    operation: SensaSyncV2Operation;
    status: "pending" | "failed" | "conflict" | "rejected";
  }>[];
}>;

/**
 * Attempt ordinal is scoped to one immutable Action, not to the Action's
 * position in an Encounter. The server uses this ordinal for same-Action
 * retries, so it must survive a reload and be derived from accepted facts.
 */
export function nextAttemptOrdinal(
  snapshot: AttemptLifecycleSnapshot,
  actionId: string,
  currentAttemptOrdinal = 1,
): number {
  let maximum = Math.max(0, currentAttemptOrdinal - 1);
  for (const appendFact of snapshot.appendFacts) {
    if (
      appendFact.factType === "learning_attempt"
      && appendFact.fact.learningActionId === actionId
    ) {
      maximum = Math.max(maximum, appendFact.fact.ordinal);
    }
  }
  return Math.max(1, maximum + 1);
}

/**
 * An unresolved local Attempt is immutable intent. Do not create another
 * Attempt for the same Action until Sync has acknowledged the existing
 * operation. A conflict/rejection is still an immutable intent that must be
 * retried or recovered; creating a fresh ordinal would hide the failure.
 */
export function unresolvedAttemptOperations(
  snapshot: AttemptLifecycleSnapshot,
  actionId: string,
): readonly SensaSyncV2Operation[] {
  return snapshot.outbox
    .filter((record) =>
      record.operation.kind === "learning_attempt.record"
      && record.operation.learningActionId === actionId
      && (record.status === "pending"
        || record.status === "failed"
        || record.status === "conflict"
        || record.status === "rejected")
    )
    .map((record) => record.operation);
}

export function shouldQueueTerminalCompletion(input: Readonly<{
  attemptResult: SensaSyncV2OperationResult;
  encounterStatus: "planned" | "active" | "completed" | "interrupted" | "cancelled";
  existingOperations: readonly SensaSyncV2Operation[];
}>): boolean {
  if (!input.attemptResult.acknowledged || input.encounterStatus !== "active") return false;
  const payload = input.attemptResult.payload;
  if (payload.kind !== "learning_attempt" || payload.nextAction !== null) return false;
  return !input.existingOperations.some(
    (operation) =>
      operation.kind === "sense_encounter.complete"
      && operation.senseEncounterId === payload.fact.senseEncounterId,
  );
}
