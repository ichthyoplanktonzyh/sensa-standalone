import type { DatabaseExecutor } from "../../../database/index.js";
import { HttpError } from "../../../shared/errors.js";
import { formatDateAsTimeZoneLocalDate } from "../../../progress/timeZone.js";
import {
  completeEncounterInExecutor,
  openEncounterInExecutor,
  recordAttemptInExecutor,
} from "../../encounter/postgres.js";
import { planNextInExecutor } from "../../planning/postgres.js";
import type {
  SensaPlanNextResult,
  SensaSyncMemoryOutcomeSnapshot,
  SensaSyncOperation,
  SensaSyncScope,
  SensaSyncSenseMemoryStateSnapshot,
} from "@sensa/contracts/sensa";
import type {
  CompletedEncounter,
  LearningAction,
  SubmitAttemptInput,
} from "@sensa/learning-kernel";
import { canonicalJsonDigest } from "@sensa/learning-kernel";
import {
  loadActionFact,
  loadAttemptFact,
  loadEvidenceFacts,
  type FeedEntity,
  type FeedFact,
} from "../feeds.js";
import { supportedKernelVersions } from "../protocol.js";
import {
  loadEncounter,
  loadMemory,
  loadOutcome,
} from "../snapshots.js";
import {
  asDate,
  asSafeInteger,
  fail,
  query,
  stableJson,
  timestamp,
  type Row,
  type SensaSyncErrorStatus,
} from "../support.js";
import type { OperationExecution } from "./types.js";

type EncounterOperation = Extract<
  SensaSyncOperation,
  {
    kind:
      | "sense_encounter.open"
      | "learning_attempt.record"
      | "sense_encounter.complete"
      | "sense_encounter.interrupt";
  }
>;

async function openEncounter(executor: DatabaseExecutor, scope: SensaSyncScope, operation: Extract<SensaSyncOperation, { kind: "sense_encounter.open" }>): Promise<OperationExecution> {
  if (stableJson(operation.kernelVersions) !== stableJson(supportedKernelVersions)) fail("upgrade_required", "The Encounter Kernel tuple is not supported by this server.", 409, operation.operationId);
  const occurredAt = new Date(operation.occurredAt);
  let planned: SensaPlanNextResult;
  try {
    planned = await planNextInExecutor(executor, {
      workspaceId: scope.workspaceId,
      learnerUserId: scope.learnerUserId,
      learningSessionId: operation.learningSessionId,
      studyPlanId: operation.studyPlanId,
      selectionMode: operation.selectionMode ?? "mixed",
      timeZone: operation.timeZone,
      now: occurredAt,
    }, {
      clock: () => occurredAt,
      encounterId: operation.senseEncounterId,
    });
  } catch (caught) {
    if (caught instanceof HttpError) {
      const code: SensaSyncErrorStatus = caught.code?.includes("BOOK")
        ? "content_unavailable"
        : caught.code === "SENSA_PLANNING_SNAPSHOT_INVALID"
          ? "state_corrupt"
          : caught.statusCode === 404
            ? "missing_dependency"
            : "schedule_conflict";
      fail(code, caught.message, caught.statusCode, operation.operationId);
    }
    throw caught;
  }
  if (planned.kind !== "planned_encounter") {
    fail("schedule_conflict", `The canonical Planner returned ${planned.reason}; no Encounter can be opened for this operation.`, 409, operation.operationId);
  }
  const candidate = planned.encounter;
  const plannedLocalDate = formatDateAsTimeZoneLocalDate(occurredAt, candidate.planningTimeZone);
  if (candidate.encounterId !== operation.senseEncounterId
    || candidate.learningSessionId !== operation.learningSessionId
    || candidate.studyPlanId !== operation.studyPlanId
    || candidate.senseId !== operation.senseId
    || candidate.senseVersionId !== operation.senseVersionId
    || candidate.contentReleaseId !== operation.contentReleaseId
    || candidate.bookVersionId !== operation.bookVersionId
    || candidate.sessionOrdinal !== operation.sessionOrdinal
    || candidate.kind !== operation.encounterKind
    || candidate.planningTimeZone !== operation.timeZone
    || candidate.plannedLocalDate !== plannedLocalDate) {
    fail("schedule_conflict", "The asserted Encounter does not match the server-selected canonical planning candidate; rebase from the authoritative Encounter.", 409, operation.operationId);
  }
  const priorActions = await query<Row>(executor, "SELECT learning_action_id::TEXT AS learning_action_id FROM sensa.learning_actions WHERE sense_encounter_id = $1", [operation.senseEncounterId]);
  const step = await openEncounterInExecutor(executor, {
    workspaceId: scope.workspaceId,
    learnerUserId: scope.learnerUserId,
    encounterId: operation.senseEncounterId,
  });
  const snapshot = await loadEncounter(executor, scope, operation.senseEncounterId);
  const entities: FeedEntity[] = snapshot.revision === candidate.revision
    ? []
    : [{ entityType: "sense_encounter", entityId: snapshot.senseEncounterId, entityRevision: snapshot.revision }];
  const facts: FeedFact[] = [];
  if (step.kind === "next_action" && !priorActions.some((action) => String(action.learning_action_id) === step.action.learningActionId)) {
    const actionRows = await query<Row>(executor, "SELECT created_at FROM sensa.learning_actions WHERE learning_action_id = $1", [step.action.learningActionId]);
    if (actionRows[0] === undefined) fail("state_corrupt", "Opened Encounter Action is missing.", 500, operation.operationId);
    facts.push({ factType: "learning_action", factId: step.action.learningActionId, occurredAt: asDate(actionRows[0].created_at, "Learning Action createdAt") });
  }
  let memoryOutcome: SensaSyncMemoryOutcomeSnapshot | null = null;
  let memoryState: SensaSyncSenseMemoryStateSnapshot | null = null;
  if (step.kind === "completed") {
    memoryOutcome = await loadOutcome(executor, scope, step.memoryOutcome.memoryOutcomeId);
    memoryState = await loadMemory(executor, scope, step.memoryState.senseId);
  }
  return { payload: { kind: "sense_encounter", snapshot, memoryOutcome, memoryState }, entities, facts, rebased: candidate.status === "active" };
}

async function loadEncounterEvidenceDigest(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  encounterId: string,
): Promise<string> {
  const rows = await query<Row>(executor, `
    SELECT learning_evidence_id::TEXT AS learning_evidence_id,
           sense_id::TEXT AS sense_id,
           sense_version_id::TEXT AS sense_version_id,
           learning_action_id::TEXT AS learning_action_id,
           learning_attempt_id::TEXT AS learning_attempt_id,
           dimension::TEXT AS dimension,
           polarity::TEXT AS polarity,
           context_novelty::TEXT AS context_novelty,
           evidence_rule_version,
           basis_code,
           occurred_at,
           derived_at
      FROM sensa.learning_evidence
     WHERE sense_encounter_id = $1
       AND workspace_id = $2
       AND learner_user_id = $3
     ORDER BY occurred_at ASC, learning_evidence_id ASC
  `, [encounterId, scope.workspaceId, scope.learnerUserId]);
  return canonicalJsonDigest(rows.map((row) => ({
    learningEvidenceId: String(row.learning_evidence_id),
    senseId: String(row.sense_id),
    senseVersionId: String(row.sense_version_id),
    learningActionId: String(row.learning_action_id),
    learningAttemptId: String(row.learning_attempt_id),
    dimension: String(row.dimension),
    polarity: String(row.polarity),
    contextNovelty: String(row.context_novelty),
    evidenceRuleVersion: String(row.evidence_rule_version),
    basisCode: String(row.basis_code),
    occurredAt: timestamp(row.occurred_at, "Evidence occurredAt"),
    derivedAt: timestamp(row.derived_at, "Evidence derivedAt"),
  })));
}

async function recordAttempt(executor: DatabaseExecutor, scope: SensaSyncScope, operation: Extract<SensaSyncOperation, { kind: "learning_attempt.record" }>): Promise<OperationExecution> {
  const input: SubmitAttemptInput = {
    workspaceId: scope.workspaceId,
    learnerUserId: scope.learnerUserId,
    encounterId: operation.senseEncounterId,
    learningActionId: operation.learningActionId,
    attemptId: operation.learningAttemptId,
    ordinal: operation.ordinal,
    sourceReplicaId: scope.replicaId,
    responseSchemaVersion: operation.responseSchemaVersion,
    responsePayload: operation.responsePayload,
    durationMs: operation.durationMs,
    occurredAt: new Date(operation.occurredAt),
  };
  const existingAttempt = await query<Row>(executor, `SELECT learning_attempt_id FROM sensa.learning_attempts WHERE learning_attempt_id = $1 AND workspace_id = $2 AND learner_user_id = $3`, [operation.learningAttemptId, scope.workspaceId, scope.learnerUserId]);
  const beforeActions = await query<Row>(executor, `SELECT learning_action_id::TEXT AS learning_action_id FROM sensa.learning_actions WHERE sense_encounter_id = $1 ORDER BY ordinal ASC`, [operation.senseEncounterId]);
  const beforeEvidence = await query<Row>(executor, `SELECT learning_evidence_id FROM sensa.learning_evidence WHERE learning_attempt_id = $1 AND workspace_id = $2 AND learner_user_id = $3`, [operation.learningAttemptId, scope.workspaceId, scope.learnerUserId]);
  const recorded = await recordAttemptInExecutor(executor, input);
  const loaded = await loadAttemptFact(executor, scope, operation.learningAttemptId);
  const evidenceFacts = beforeEvidence.length > 0 ? [] : await loadEvidenceFacts(executor, scope, operation.learningAttemptId);
  const semantic = evidenceFacts.length > 0
    ? await query<Row>(executor, `
        SELECT learner_semantic_state_id::TEXT AS learner_semantic_state_id, revision
          FROM sensa.learner_semantic_states
         WHERE workspace_id = $1
           AND learner_user_id = $2
           AND sense_id = (
             SELECT sense_id
               FROM sensa.sense_encounters
              WHERE sense_encounter_id = $3
           )
      `, [scope.workspaceId, scope.learnerUserId, operation.senseEncounterId])
    : [];
  const entities: FeedEntity[] = [];
  if (semantic[0] !== undefined) {
    entities.push({ entityType: "learner_semantic_state", entityId: String(semantic[0].learner_semantic_state_id), entityRevision: asSafeInteger(semantic[0].revision, "Semantic State revision", 1) });
  }
  const replayedFact = existingAttempt.length > 0;
  let nextAction: LearningAction | null = null;
  let nextActionFact: FeedFact | null = null;
  if (!replayedFact && recorded.completionDecision?.stopDecision.disposition !== "complete") {
    const progressed = await openEncounterInExecutor(executor, {
      workspaceId: scope.workspaceId,
      learnerUserId: scope.learnerUserId,
      encounterId: operation.senseEncounterId,
    });
    if (progressed.kind === "next_action") {
      nextAction = progressed.action;
      if (!beforeActions.some((action) => String(action.learning_action_id) === progressed.action.learningActionId)) {
        const actionFact = await loadActionFact(executor, scope, progressed.action.learningActionId);
        nextActionFact = { factType: "learning_action", factId: progressed.action.learningActionId, occurredAt: actionFact.occurredAt };
      }
    }
  }
  return {
    payload: { kind: "learning_attempt", fact: loaded.fact, nextAction },
    entities: replayedFact ? [] : entities,
    facts: replayedFact
      ? []
      : [
        { factType: "learning_attempt", factId: operation.learningAttemptId, occurredAt: loaded.occurredAt },
        ...evidenceFacts,
        ...(nextActionFact === null ? [] : [nextActionFact]),
      ],
    rebased: replayedFact,
  };
}

async function completeEncounter(executor: DatabaseExecutor, scope: SensaSyncScope, operation: Extract<SensaSyncOperation, { kind: "sense_encounter.complete" }>): Promise<OperationExecution> {
  const before = await loadEncounter(executor, scope, operation.senseEncounterId, true);
  const equivalentTerminalReplay = before.status === "completed";
  if (!equivalentTerminalReplay && before.revision !== operation.expectedRevision) fail("revision_conflict", "Encounter revision is stale; pull the authoritative Encounter snapshot before retrying.", 409, operation.operationId);
  const result: CompletedEncounter = await completeEncounterInExecutor(executor, {
    workspaceId: scope.workspaceId,
    learnerUserId: scope.learnerUserId,
    encounterId: operation.senseEncounterId,
    expectedRevision: equivalentTerminalReplay ? undefined : operation.expectedRevision,
  });
  const snapshot = await loadEncounter(executor, scope, operation.senseEncounterId);
  const memoryState = await loadMemory(executor, scope, result.memoryState.senseId);
  if (memoryState === null) fail("state_corrupt", "Completed Encounter has no canonical Memory State snapshot.", 500, operation.operationId);
  const outcome = await loadOutcome(executor, scope, result.memoryOutcome.memoryOutcomeId);
  const evidenceDigest = await loadEncounterEvidenceDigest(executor, scope, operation.senseEncounterId);
  const memoryDigest = canonicalJsonDigest(memoryState);
  const drifted = (operation.clientEvidenceDigest !== undefined && operation.clientEvidenceDigest !== evidenceDigest)
    || (operation.clientSemanticStateDigest !== undefined && operation.clientSemanticStateDigest !== result.semanticState.stateDigest)
    || (operation.clientMemoryStateDigest !== undefined && operation.clientMemoryStateDigest !== memoryDigest)
    || (operation.predictedOutcomeKind !== undefined && operation.predictedOutcomeKind !== outcome.outcomeKind);
  if (before.status === "completed") {
    return { payload: { kind: "sense_encounter", snapshot, memoryOutcome: outcome, memoryState }, entities: [], facts: [], rebased: true };
  }
  return {
    payload: { kind: "sense_encounter", snapshot, memoryOutcome: outcome, memoryState },
    entities: [{ entityType: "sense_encounter", entityId: snapshot.senseEncounterId, entityRevision: snapshot.revision }, { entityType: "sense_memory_state", entityId: memoryState.senseMemoryStateId, entityRevision: memoryState.revision }],
    facts: [{ factType: "memory_outcome", factId: outcome.memoryOutcomeId, occurredAt: new Date(outcome.observedCompletedAt) }],
    rebased: drifted,
  };
}

async function interruptEncounter(executor: DatabaseExecutor, scope: SensaSyncScope, operation: Extract<SensaSyncOperation, { kind: "sense_encounter.interrupt" }>): Promise<OperationExecution> {
  const current = await loadEncounter(executor, scope, operation.senseEncounterId, true);
  if (["completed", "interrupted", "cancelled"].includes(current.status)) {
    if (current.status === operation.status) return { payload: { kind: "sense_encounter", snapshot: current, memoryOutcome: null, memoryState: null }, entities: [], facts: [], rebased: true };
    fail("terminal_state_conflict", "The Encounter already has a different terminal state.", 409, operation.operationId);
  }
  if (current.revision !== operation.expectedRevision) fail("revision_conflict", "Encounter revision is stale; pull the authoritative snapshot before retrying.", 409, operation.operationId);
  if (current.status === "planned" && operation.status === "interrupted") fail("terminal_state_conflict", "A planned Encounter must be cancelled before it opens.", 409, operation.operationId);
  await executor.query(`UPDATE sensa.sense_encounters SET status = $1::sensa.encounter_status WHERE sense_encounter_id = $2 AND revision = $3`, [operation.status, operation.senseEncounterId, operation.expectedRevision]);
  const snapshot = await loadEncounter(executor, scope, operation.senseEncounterId);
  return { payload: { kind: "sense_encounter", snapshot, memoryOutcome: null, memoryState: null }, entities: [{ entityType: "sense_encounter", entityId: snapshot.senseEncounterId, entityRevision: snapshot.revision }], facts: [], rebased: false };
}

export async function executeEncounterOperation(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  operation: EncounterOperation,
): Promise<OperationExecution> {
  switch (operation.kind) {
    case "sense_encounter.open":
      return openEncounter(executor, scope, operation);
    case "learning_attempt.record":
      return recordAttempt(executor, scope, operation);
    case "sense_encounter.complete":
      return completeEncounter(executor, scope, operation);
    case "sense_encounter.interrupt":
      return interruptEncounter(executor, scope, operation);
  }
}

