import type {
  CanonicalObjectPayload,
  LearningAction,
} from "@sensa/learning-kernel";
import {
  type MemoryOutcomeKind,
  type ReviewRating,
  type SensaMemoryOutcomeDecisionCode,
  type SensaStopPolicyCompletionDecisionCode,
  sensaMemoryOutcomeMappingVersion,
} from "@sensa/learning-kernel";
import type { SensaPlanningMode } from "./planning.js";

/**
 * The wire and canonicalization versions are part of the Sensa Sync
 * contract.  A route may negotiate versions, but it must not silently
 * reinterpret a payload under a different canonicalizer.
 */
export const sensaSyncWireVersion = "sensa-sync-v1" as const;
export const sensaSyncCanonicalizerVersion = sensaSyncWireVersion;
export const sensaSyncResultSchemaVersion = "sensa-sync-result-v1" as const;
export const sensaSyncOutcomeMappingVersion = sensaMemoryOutcomeMappingVersion;

/**
 * v1 remains frozen.  v2 is an additive superset used only by replicas that
 * explicitly negotiate it at bootstrap; it does not reinterpret a v1
 * operation or result.
 */
export const sensaSyncV2WireVersion = "sensa-sync-v2" as const;
export const sensaSyncV2CanonicalizerVersion = sensaSyncV2WireVersion;
export const sensaSyncV2ResultSchemaVersion = "sensa-sync-result-v2" as const;

export const sensaSyncOperationKinds = [
  "study_plan.create",
  "study_plan.update",
  "learning_session.start",
  "learning_session.complete",
  "sense_encounter.open",
  "learning_attempt.record",
  "sense_encounter.complete",
  "sense_encounter.interrupt",
] as const;

export type SensaSyncOperationKind = (typeof sensaSyncOperationKinds)[number];

export const sensaSyncV2OperationKinds = [
  ...sensaSyncOperationKinds,
  "learner_declared_mastery.set",
] as const;

export type SensaSyncV2OperationKind = (typeof sensaSyncV2OperationKinds)[number];

/** Stored in 0117. `replayed` and `rejected` exist only in the response. */
export const sensaSyncStoredResultStatuses = [
  "applied",
  "rebased",
  "conflict",
] as const;

export type SensaSyncStoredResultStatus =
  (typeof sensaSyncStoredResultStatuses)[number];

export const sensaSyncResponseStatuses = [
  ...sensaSyncStoredResultStatuses,
  "replayed",
  "rejected",
] as const;

export type SensaSyncResultStatus = (typeof sensaSyncResponseStatuses)[number];

export const sensaSyncErrorCodes = [
  "authentication_required",
  "workspace_access_denied",
  "replica_scope_mismatch",
  "upgrade_required",
  "version_mismatch",
  "invalid_cursor",
  "bootstrap_required",
  "invalid_operation",
  "operation_id_reuse",
  "missing_dependency",
  "blocked_by_prior_operation",
  "immutable_fact_conflict",
  "revision_conflict",
  "terminal_state_conflict",
  "kernel_replay_failed",
  "content_unavailable",
  "schedule_conflict",
] as const;

export type SensaSyncErrorCode = (typeof sensaSyncErrorCodes)[number];

export const sensaSyncMutableEntityTypes = [
  "study_plan",
  "learning_session",
  "sense_encounter",
  "learner_semantic_state",
  "sense_memory_state",
] as const;

export type SensaSyncMutableEntityType =
  (typeof sensaSyncMutableEntityTypes)[number];

export const sensaSyncV2MutableEntityTypes = [
  ...sensaSyncMutableEntityTypes,
  "learner_declared_mastery",
] as const;

export type SensaSyncV2MutableEntityType =
  (typeof sensaSyncV2MutableEntityTypes)[number];

export const sensaSyncChangeActions = ["upsert", "tombstone"] as const;
export type SensaSyncChangeAction = (typeof sensaSyncChangeActions)[number];

export const sensaSyncAppendFactTypes = [
  "learning_action",
  "learning_attempt",
  "learning_evidence",
  "memory_outcome",
] as const;

export type SensaSyncAppendFactType = (typeof sensaSyncAppendFactTypes)[number];

/**
 * Cardinality is enforced at the serialized boundary by the shared Zod
 * schemas.  Keeping the TypeScript output composable avoids forcing every
 * adapter/HTTP client to manufacture tuple literals after parsing.
 */
export type SensaSyncNonEmptyArray<T> = ReadonlyArray<T>;

/**
 * Cursors are opaque and bound to the scope plus bootstrap epoch carried by
 * this pair.  Clients may store and return them, but never decode or combine
 * cursors from different pairs.
 */
export type SensaSyncCursor = string;

export type SensaSyncCursorPair = Readonly<{
  bootstrapEpoch: number;
  mutableCursor: SensaSyncCursor;
  factCursor: SensaSyncCursor;
}>;

/** UTC timestamp serialized with millisecond precision on the wire. */
export type SensaSyncTimestamp = string;

export type SensaSyncSha256Digest = string;

export function createSensaSyncSha256Digest(
  value: string,
): SensaSyncSha256Digest {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Sensa Sync digest must be lowercase SHA-256 hex");
  }

  return value as SensaSyncSha256Digest;
}

export type SensaSyncScope = Readonly<{
  workspaceId: string;
  learnerUserId: string;
  replicaId: string;
}>;

/** Versions captured when an Encounter is opened and replayed on the server. */
export type SensaSyncKernelVersionTuple = Readonly<{
  capabilityResolverVersion: string;
  semanticPolicyVersion: string;
  stopPolicyVersion: string;
  evidenceRuleVersion: string;
  stateUpdaterVersion: string;
  outcomeMappingVersion: typeof sensaSyncOutcomeMappingVersion;
}>;

export type SensaSyncBookReference = Readonly<{
  studyPlanId: string;
  bookVersionId: string;
  contentReleaseId: string;
  manifestDigest: string;
  targetLanguage: string;
  learnerLocale: string;
}>;

export type SensaSyncStudyPlanStatus =
  | "active"
  | "paused"
  | "completed"
  | "archived";

export type SensaSyncStudyPlanSnapshot = Readonly<{
  studyPlanId: string;
  workspaceId: string;
  learnerUserId: string;
  bookVersionId: string;
  status: SensaSyncStudyPlanStatus;
  dailyNewSenseTarget: number;
  revision: number;
  createdByReplicaId: string;
  createdAt: SensaSyncTimestamp;
  updatedAt: SensaSyncTimestamp;
  activatedAt: SensaSyncTimestamp;
  pausedAt: SensaSyncTimestamp | null;
  completedAt: SensaSyncTimestamp | null;
  archivedAt: SensaSyncTimestamp | null;
}>;

export type SensaSyncLearningSessionStatus =
  | "active"
  | "completed"
  | "abandoned";

export type SensaSyncLearningSessionSnapshot = Readonly<{
  learningSessionId: string;
  workspaceId: string;
  learnerUserId: string;
  studyPlanId: string;
  createdByReplicaId: string;
  status: SensaSyncLearningSessionStatus;
  revision: number;
  startedAt: SensaSyncTimestamp;
  endedAt: SensaSyncTimestamp | null;
  createdAt: SensaSyncTimestamp;
  updatedAt: SensaSyncTimestamp;
}>;

export type SensaSyncEncounterStatus =
  | "planned"
  | "active"
  | "completed"
  | "interrupted"
  | "cancelled";

export type SensaSyncEncounterKind = "introduction" | "review";

export type SensaSyncSenseEncounterSnapshot = Readonly<{
  senseEncounterId: string;
  workspaceId: string;
  learnerUserId: string;
  learningSessionId: string;
  studyPlanId: string;
  senseId: string;
  senseVersionId: string;
  contentReleaseId: string;
  bookVersionId: string;
  sessionOrdinal: number;
  kind: SensaSyncEncounterKind;
  status: SensaSyncEncounterStatus;
  revision: number;
  stopPolicyDecisionCode: SensaStopPolicyCompletionDecisionCode | null;
  kernelVersions: SensaSyncKernelVersionTuple;
  semanticStateRevisionAtOpen: number;
  memoryStateRevisionAtOpen: number;
  plannedAt: SensaSyncTimestamp;
  plannedLocalDate: string;
  planningTimeZone: string;
  planningTimeZoneSource: "client" | "user_settings" | "utc_fallback";
  openedAt: SensaSyncTimestamp | null;
  closedAt: SensaSyncTimestamp | null;
  createdAt: SensaSyncTimestamp;
  updatedAt: SensaSyncTimestamp;
}>;

export type SensaSyncMasteryLevel = "unknown" | "emerging" | "stable";

export type SensaSyncSemanticDimensionState = Readonly<{
  level: SensaSyncMasteryLevel;
  positiveCount: number;
  failureStreak: number;
}>;

export type SensaSyncLearnerSemanticStateSnapshot = Readonly<{
  learnerSemanticStateId: string;
  workspaceId: string;
  learnerUserId: string;
  senseId: string;
  grounding: SensaSyncSemanticDimensionState;
  boundary: SensaSyncSemanticDimensionState;
  formMapping: SensaSyncSemanticDimensionState;
  retrieval: SensaSyncSemanticDimensionState;
  transfer: SensaSyncSemanticDimensionState;
  projectionVersion: string;
  revision: number;
  stateDigest: string;
  projectedThroughEvidenceId: string | null;
  updatedAt: SensaSyncTimestamp;
}>;

export type SensaSyncFsrsCardState =
  | "new"
  | "learning"
  | "review"
  | "relearning";

export type SensaSyncSenseMemoryStateSnapshot = Readonly<{
  senseMemoryStateId: string;
  workspaceId: string;
  learnerUserId: string;
  senseId: string;
  dueAt: SensaSyncTimestamp | null;
  reps: number;
  lapses: number;
  fsrsCardState: SensaSyncFsrsCardState;
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: SensaSyncTimestamp | null;
  fsrsScheduledDays: number | null;
  revision: number;
  lastMemoryOutcomeId: string;
  updatedAt: SensaSyncTimestamp;
}>;

/**
 * A learner's explicit, reversible declaration is separate from both the
 * evidence-derived 5D state and the FSRS memory state.  The snapshot carries
 * only learner/runtime facts; provider, prompt, source and test provenance
 * are intentionally absent.
 */
export type SensaSyncLearnerDeclaredMasterySnapshot = Readonly<{
  learnerDeclaredMasteryId: string;
  workspaceId: string;
  learnerUserId: string;
  senseId: string;
  isMastered: boolean;
  revision: number;
  createdByReplicaId: string;
  declaredAt: SensaSyncTimestamp;
  revokedAt: SensaSyncTimestamp | null;
  createdAt: SensaSyncTimestamp;
  updatedAt: SensaSyncTimestamp;
}>;

export type SensaSyncMemoryOutcomeSnapshot = Readonly<{
  memoryOutcomeId: string;
  workspaceId: string;
  learnerUserId: string;
  senseId: string;
  senseEncounterId: string;
  outcomeKind: MemoryOutcomeKind;
  decisionCode: SensaMemoryOutcomeDecisionCode;
  outcomeMappingVersion: typeof sensaSyncOutcomeMappingVersion;
  scheduleDisposition: "acquisition_pending" | "fsrs_applied";
  fsrsRating: ReviewRating | null;
  observedCompletedAt: SensaSyncTimestamp;
  effectiveReviewedAt: SensaSyncTimestamp | null;
  reviewTimeClamped: boolean;
  reviewTimeClampReason: "previous_accepted_review_time" | null;
  priorMemoryRevision: number;
  resultingMemoryRevision: number;
  fsrsAdapterVersion: "sensa-fsrs-adapter-v2" | null;
  schedulerSettingsDigest: string | null;
  createdAt: SensaSyncTimestamp;
}>;

export type SensaSyncLearningAttemptFact = Readonly<{
  learningAttemptId: string;
  workspaceId: string;
  learnerUserId: string;
  senseEncounterId: string;
  learningActionId: string;
  ordinal: number;
  sourceReplicaId: string;
  responseSchemaVersion: string;
  responsePayload: CanonicalObjectPayload;
  durationMs: number | null;
  validity: "valid" | "invalid";
  isCorrect: boolean | null;
  evaluationCode: string;
  occurredAt: SensaSyncTimestamp;
  recordedAt: SensaSyncTimestamp;
}>;

export type SensaSyncLearningEvidenceFact = Readonly<{
  learningEvidenceId: string;
  workspaceId: string;
  learnerUserId: string;
  senseId: string;
  senseVersionId: string;
  senseEncounterId: string;
  learningActionId: string;
  learningAttemptId: string;
  dimension:
    | "grounding"
    | "boundary"
    | "form_mapping"
    | "retrieval"
    | "transfer";
  polarity: "positive" | "negative";
  contextNovelty: "familiar" | "novel";
  evidenceRuleVersion: string;
  basisCode: string;
  occurredAt: SensaSyncTimestamp;
  derivedAt: SensaSyncTimestamp;
}>;

export type SensaSyncLearningActionFact = Readonly<{
  action: LearningAction;
  workspaceId: string;
  learnerUserId: string;
  senseEncounterId: string;
  createdAt: SensaSyncTimestamp;
}>;

type SensaSyncAppendFactByType = Readonly<{
  learning_action: SensaSyncLearningActionFact;
  learning_attempt: SensaSyncLearningAttemptFact;
  learning_evidence: SensaSyncLearningEvidenceFact;
  memory_outcome: SensaSyncMemoryOutcomeSnapshot;
}>;

/** Append facts contain typed references, never a second entity JSON copy. */
export type SensaSyncAppendFact = {
  [FactType in keyof SensaSyncAppendFactByType]: Readonly<{
    factSequence: SensaSyncCursor;
    factType: FactType;
    factId: string;
    occurredAt: SensaSyncTimestamp;
    fact: SensaSyncAppendFactByType[FactType];
  }>;
}[keyof SensaSyncAppendFactByType];

type SensaSyncMutableSnapshotByEntity = Readonly<{
  study_plan: SensaSyncStudyPlanSnapshot;
  learning_session: SensaSyncLearningSessionSnapshot;
  sense_encounter: SensaSyncSenseEncounterSnapshot;
  learner_semantic_state: SensaSyncLearnerSemanticStateSnapshot;
  sense_memory_state: SensaSyncSenseMemoryStateSnapshot;
}>;

export type SensaSyncMutableUpsertChange = {
  [EntityType in keyof SensaSyncMutableSnapshotByEntity]: Readonly<{
    mutableSequence: SensaSyncCursor;
    entityType: EntityType;
    entityId: string;
    entityRevision: number;
    action: "upsert";
    snapshot: SensaSyncMutableSnapshotByEntity[EntityType];
    tombstoneReason: null;
  }>;
}[keyof SensaSyncMutableSnapshotByEntity];

export type SensaSyncMutableTombstoneChange = Readonly<{
  mutableSequence: SensaSyncCursor;
  entityType: SensaSyncMutableEntityType;
  entityId: string;
  entityRevision: number;
  action: "tombstone";
  snapshot: null;
  tombstoneReason: string;
}>;

export type SensaSyncMutableChange =
  | SensaSyncMutableUpsertChange
  | SensaSyncMutableTombstoneChange;

type SensaSyncV2MutableSnapshotByEntity = Readonly<{
  study_plan: SensaSyncStudyPlanSnapshot;
  learning_session: SensaSyncLearningSessionSnapshot;
  sense_encounter: SensaSyncSenseEncounterSnapshot;
  learner_semantic_state: SensaSyncLearnerSemanticStateSnapshot;
  sense_memory_state: SensaSyncSenseMemoryStateSnapshot;
  learner_declared_mastery: SensaSyncLearnerDeclaredMasterySnapshot;
}>;

export type SensaSyncV2MutableUpsertChange = {
  [EntityType in keyof SensaSyncV2MutableSnapshotByEntity]: Readonly<{
    mutableSequence: SensaSyncCursor;
    entityType: EntityType;
    entityId: string;
    entityRevision: number;
    action: "upsert";
    snapshot: SensaSyncV2MutableSnapshotByEntity[EntityType];
    tombstoneReason: null;
  }>;
}[keyof SensaSyncV2MutableSnapshotByEntity];

export type SensaSyncV2MutableTombstoneChange = Readonly<{
  mutableSequence: SensaSyncCursor;
  entityType: SensaSyncV2MutableEntityType;
  entityId: string;
  entityRevision: number;
  action: "tombstone";
  snapshot: null;
  tombstoneReason: string;
}>;

export type SensaSyncV2MutableChange =
  | SensaSyncV2MutableUpsertChange
  | SensaSyncV2MutableTombstoneChange;

export type SensaSyncBootstrapReplicaState = Readonly<{
  replicaId: string;
  bootstrapRequired: false;
  bootstrapCursors: SensaSyncCursorPair;
  acknowledgedCursors: SensaSyncCursorPair;
  revision: number;
  bootstrappedAt: SensaSyncTimestamp | null;
  lastPulledAt: SensaSyncTimestamp | null;
  lastPushedAt: SensaSyncTimestamp | null;
}>;

export type SensaSyncBootstrapInput = Readonly<{
  scope: SensaSyncScope;
  wireVersion: typeof sensaSyncWireVersion;
}>;

export type SensaSyncBootstrapSnapshot = Readonly<{
  replica: SensaSyncBootstrapReplicaState;
  pinnedBooks: ReadonlyArray<SensaSyncBookReference>;
  studyPlans: ReadonlyArray<SensaSyncStudyPlanSnapshot>;
  learningSessions: ReadonlyArray<SensaSyncLearningSessionSnapshot>;
  senseEncounters: ReadonlyArray<SensaSyncSenseEncounterSnapshot>;
  semanticStates: ReadonlyArray<SensaSyncLearnerSemanticStateSnapshot>;
  memoryStates: ReadonlyArray<SensaSyncSenseMemoryStateSnapshot>;
  cursors: SensaSyncCursorPair;
}>;

export type SensaSyncBootstrapResult = Readonly<{
  wireVersion: typeof sensaSyncWireVersion;
  resultSchemaVersion: typeof sensaSyncResultSchemaVersion;
  bootstrapRequired: false;
  supportedKernelVersions: SensaSyncNonEmptyArray<SensaSyncKernelVersionTuple>;
  snapshot: SensaSyncBootstrapSnapshot;
}>;

export type SensaSyncV2BootstrapInput = Readonly<{
  scope: SensaSyncScope;
  wireVersion: typeof sensaSyncV2WireVersion;
}>;

export type SensaSyncV2BootstrapSnapshot = Readonly<{
  replica: SensaSyncBootstrapReplicaState;
  pinnedBooks: ReadonlyArray<SensaSyncBookReference>;
  studyPlans: ReadonlyArray<SensaSyncStudyPlanSnapshot>;
  learningSessions: ReadonlyArray<SensaSyncLearningSessionSnapshot>;
  senseEncounters: ReadonlyArray<SensaSyncSenseEncounterSnapshot>;
  semanticStates: ReadonlyArray<SensaSyncLearnerSemanticStateSnapshot>;
  memoryStates: ReadonlyArray<SensaSyncSenseMemoryStateSnapshot>;
  learnerDeclaredMasteries: ReadonlyArray<SensaSyncLearnerDeclaredMasterySnapshot>;
  cursors: SensaSyncCursorPair;
}>;

export type SensaSyncV2BootstrapResult = Readonly<{
  wireVersion: typeof sensaSyncV2WireVersion;
  resultSchemaVersion: typeof sensaSyncV2ResultSchemaVersion;
  bootstrapRequired: false;
  supportedKernelVersions: SensaSyncNonEmptyArray<SensaSyncKernelVersionTuple>;
  snapshot: SensaSyncV2BootstrapSnapshot;
}>;

type SensaSyncOperationBase = Readonly<{
  operationId: string;
  occurredAt: SensaSyncTimestamp;
}>;

export type SensaSyncStudyPlanCreateOperation = Readonly<
  SensaSyncOperationBase & {
    kind: "study_plan.create";
    studyPlanId: string;
    bookVersionId: string;
    dailyNewSenseTarget: number;
  }
>;

type SensaSyncStudyPlanUpdateBase = SensaSyncOperationBase & {
  kind: "study_plan.update";
  studyPlanId: string;
  expectedRevision: number;
};

export type SensaSyncStudyPlanPacingUpdateOperation = Readonly<
  SensaSyncStudyPlanUpdateBase & {
    mutation: "pacing";
    dailyNewSenseTarget: number;
  }
>;

export type SensaSyncStudyPlanStatusUpdateOperation = Readonly<
  SensaSyncStudyPlanUpdateBase & {
    mutation: "status";
    status: SensaSyncStudyPlanStatus;
  }
>;

export type SensaSyncStudyPlanPacingAndStatusUpdateOperation = Readonly<
  SensaSyncStudyPlanUpdateBase & {
    mutation: "pacing_and_status";
    status: SensaSyncStudyPlanStatus;
    dailyNewSenseTarget: number;
  }
>;

/** At least one mutable field must be intentionally changed by the caller. */
export type SensaSyncStudyPlanUpdateOperation =
  | SensaSyncStudyPlanPacingUpdateOperation
  | SensaSyncStudyPlanStatusUpdateOperation
  | SensaSyncStudyPlanPacingAndStatusUpdateOperation;

export type SensaSyncLearningSessionStartOperation = Readonly<
  SensaSyncOperationBase & {
    kind: "learning_session.start";
    learningSessionId: string;
    studyPlanId: string;
  }
>;

export type SensaSyncLearningSessionCompleteOperation = Readonly<
  SensaSyncOperationBase & {
    kind: "learning_session.complete";
    learningSessionId: string;
    expectedRevision: number;
    status: "completed" | "abandoned";
  }
>;

export type SensaSyncSenseEncounterOpenOperation = Readonly<
  SensaSyncOperationBase & {
    kind: "sense_encounter.open";
    senseEncounterId: string;
    learningSessionId: string;
    studyPlanId: string;
    senseId: string;
    senseVersionId: string;
    contentReleaseId: string;
    bookVersionId: string;
    sessionOrdinal: number;
    encounterKind: SensaSyncEncounterKind;
    /** Candidate filter; omitted by older replicas and interpreted as mixed. */
    selectionMode?: SensaPlanningMode;
    /** Client IANA timezone used to freeze the Encounter planning day. */
    timeZone: string;
    kernelVersions: SensaSyncKernelVersionTuple;
  }
>;

export type SensaSyncLearningAttemptRecordOperation = Readonly<
  SensaSyncOperationBase & {
    kind: "learning_attempt.record";
    learningAttemptId: string;
    senseEncounterId: string;
    learningActionId: string;
    ordinal: number;
    responseSchemaVersion: string;
    responsePayload: CanonicalObjectPayload;
    durationMs: number | null;
  }
>;

export type SensaSyncSenseEncounterCompleteOperation = Readonly<
  SensaSyncOperationBase & {
    kind: "sense_encounter.complete";
    senseEncounterId: string;
    expectedRevision: number;
    clientEvidenceDigest?: string;
    clientSemanticStateDigest?: string;
    clientMemoryStateDigest?: string;
    predictedOutcomeKind?: MemoryOutcomeKind;
  }
>;

export type SensaSyncSenseEncounterInterruptOperation = Readonly<
  SensaSyncOperationBase & {
    kind: "sense_encounter.interrupt";
    senseEncounterId: string;
    expectedRevision: number;
    status: "interrupted" | "cancelled";
  }
>;

export type SensaSyncLearnerDeclaredMasterySetOperation = Readonly<
  SensaSyncOperationBase & {
    kind: "learner_declared_mastery.set";
    /** Stable entity identity chosen by the offline replica. */
    entityId: string;
    senseId: string;
    isMastered: boolean;
    /** 0 creates; later updates must match the current positive revision. */
    expectedRevision: number;
    /** Optional exact Encounter context from which the declaration was made. */
    encounter?: Readonly<{
      senseEncounterId: string;
      expectedRevision: number;
    }>;
  }
>;

/**
 * The only client-originated operations accepted by Sensa Sync V1.  The
 * Implementation canonicalizes kind and payload before consulting the
 * operation ledger: the same operation ID plus the same canonical values is
 * `replayed`; a different kind or payload is `operation_id_reuse` and writes
 * nothing.  Evidence, semantic state, Memory Outcome and FSRS writes are
 * intentionally absent from this union because those are server-owned.
 */
export type SensaSyncOperation =
  | SensaSyncStudyPlanCreateOperation
  | SensaSyncStudyPlanUpdateOperation
  | SensaSyncLearningSessionStartOperation
  | SensaSyncLearningSessionCompleteOperation
  | SensaSyncSenseEncounterOpenOperation
  | SensaSyncLearningAttemptRecordOperation
  | SensaSyncSenseEncounterCompleteOperation
  | SensaSyncSenseEncounterInterruptOperation;

export type SensaSyncOperationResultPayload =
  | Readonly<{
    kind: "study_plan";
    snapshot: SensaSyncStudyPlanSnapshot;
  }>
  | Readonly<{
    kind: "learning_session";
    snapshot: SensaSyncLearningSessionSnapshot;
  }>
  | Readonly<{
    kind: "sense_encounter";
    snapshot: SensaSyncSenseEncounterSnapshot;
    memoryOutcome: SensaSyncMemoryOutcomeSnapshot | null;
    memoryState: SensaSyncSenseMemoryStateSnapshot | null;
  }>
  | Readonly<{
      kind: "learning_attempt";
      fact: SensaSyncLearningAttemptFact;
      /** Current unresolved Action, or null when Stop Policy permits completion. */
      nextAction: LearningAction | null;
    }>
  | Readonly<{
    kind: "none";
  }>;

type SensaSyncOperationResultBase = Readonly<{
  operationId: string;
  payload: SensaSyncOperationResultPayload;
  mutableCursor: SensaSyncCursor | null;
  factCursor: SensaSyncCursor | null;
}>;

export type SensaSyncSuccessfulOperationResult =
  & SensaSyncOperationResultBase
  & Readonly<{
    status: "applied" | "rebased" | "replayed";
    acknowledged: true;
    errorCode: null;
    resultDigest: SensaSyncSha256Digest;
  }>;

export type SensaSyncDurableConflictOperationResult =
  & SensaSyncOperationResultBase
  & Readonly<{
    status: "conflict";
    acknowledged: false;
    errorCode: SensaSyncErrorCode;
    resultDigest: SensaSyncSha256Digest;
  }>;

export type SensaSyncRejectedOperationResult =
  & SensaSyncOperationResultBase
  & Readonly<{
    status: "rejected";
    acknowledged: false;
    errorCode: SensaSyncErrorCode;
    resultDigest: null;
  }>;

/** Stored rows only use applied/rebased/conflict; replayed is transport-only. */
export type SensaSyncOperationResult =
  | SensaSyncSuccessfulOperationResult
  | SensaSyncDurableConflictOperationResult
  | SensaSyncRejectedOperationResult;

export type SensaSyncV2Operation =
  | SensaSyncOperation
  | SensaSyncLearnerDeclaredMasterySetOperation;

export type SensaSyncV2OperationResultPayload =
  | SensaSyncOperationResultPayload
  | Readonly<{
      kind: "learner_declared_mastery";
      snapshot: SensaSyncLearnerDeclaredMasterySnapshot;
      encounter: SensaSyncSenseEncounterSnapshot | null;
    }>;

type SensaSyncV2OperationResultBase = Readonly<{
  operationId: string;
  payload: SensaSyncV2OperationResultPayload;
  mutableCursor: SensaSyncCursor | null;
  factCursor: SensaSyncCursor | null;
}>;

type SensaSyncV2RejectedOperationResultBase = Readonly<{
  operationId: string;
  payload: Readonly<{ kind: "none" }>;
  mutableCursor: null;
  factCursor: null;
}>;

export type SensaSyncV2SuccessfulOperationResult =
  & SensaSyncV2OperationResultBase
  & Readonly<{
    status: "applied" | "rebased" | "replayed";
    acknowledged: true;
    errorCode: null;
    resultDigest: SensaSyncSha256Digest;
  }>;

export type SensaSyncV2DurableConflictOperationResult =
  & SensaSyncV2RejectedOperationResultBase
  & Readonly<{
    status: "conflict";
    acknowledged: false;
    errorCode: SensaSyncErrorCode;
    resultDigest: SensaSyncSha256Digest;
  }>;

export type SensaSyncV2RejectedOperationResult =
  & SensaSyncV2RejectedOperationResultBase
  & Readonly<{
    status: "rejected";
    acknowledged: false;
    errorCode: SensaSyncErrorCode;
    resultDigest: null;
  }>;

export type SensaSyncV2OperationResult =
  | SensaSyncV2SuccessfulOperationResult
  | SensaSyncV2DurableConflictOperationResult
  | SensaSyncV2RejectedOperationResult;

export type SensaSyncPushInput = Readonly<{
  scope: SensaSyncScope;
  wireVersion: typeof sensaSyncWireVersion;
  cursors: SensaSyncCursorPair;
  operations: ReadonlyArray<SensaSyncOperation>;
}>;

export type SensaSyncPushResult = Readonly<{
  wireVersion: typeof sensaSyncWireVersion;
  resultSchemaVersion: typeof sensaSyncResultSchemaVersion;
  results: ReadonlyArray<SensaSyncOperationResult>;
  cursors: SensaSyncCursorPair;
}>;

export type SensaSyncV2PushInput = Readonly<{
  scope: SensaSyncScope;
  wireVersion: typeof sensaSyncV2WireVersion;
  cursors: SensaSyncCursorPair;
  operations: ReadonlyArray<SensaSyncV2Operation>;
}>;

export type SensaSyncV2PushResult = Readonly<{
  wireVersion: typeof sensaSyncV2WireVersion;
  resultSchemaVersion: typeof sensaSyncV2ResultSchemaVersion;
  results: ReadonlyArray<SensaSyncV2OperationResult>;
  cursors: SensaSyncCursorPair;
}>;

export const sensaSyncMaximumPullLimit = 500 as const;

declare const syncPullLimitBrand: unique symbol;

export type SensaSyncPullLimit = number & {
  readonly [syncPullLimitBrand]: "sensa-sync-pull-limit";
};

export function createSensaSyncPullLimit(value: number): SensaSyncPullLimit {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > sensaSyncMaximumPullLimit
  ) {
    throw new Error(
      `Sensa Sync pull limit must be an integer from 1 to ${sensaSyncMaximumPullLimit}`,
    );
  }

  return value as SensaSyncPullLimit;
}

export type SensaSyncPullInput = Readonly<{
  scope: SensaSyncScope;
  wireVersion: typeof sensaSyncWireVersion;
  cursors: SensaSyncCursorPair;
  limit: SensaSyncPullLimit;
}>;

type SensaSyncPullResultBase = Readonly<{
  wireVersion: typeof sensaSyncWireVersion;
  resultSchemaVersion: typeof sensaSyncResultSchemaVersion;
}>;

export type SensaSyncPullReadyResult =
  & SensaSyncPullResultBase
  & Readonly<{
    bootstrapRequired: false;
    errorCode: null;
    mutableChanges: ReadonlyArray<SensaSyncMutableChange>;
    appendFacts: ReadonlyArray<SensaSyncAppendFact>;
    nextCursors: SensaSyncCursorPair;
  }>;

export type SensaSyncPullBootstrapRequiredResult =
  & SensaSyncPullResultBase
  & Readonly<{
    bootstrapRequired: true;
    errorCode: "bootstrap_required";
    nextCursors: null;
  }>;

export type SensaSyncPullResult =
  | SensaSyncPullReadyResult
  | SensaSyncPullBootstrapRequiredResult;

export type SensaSyncV2PullInput = Readonly<{
  scope: SensaSyncScope;
  wireVersion: typeof sensaSyncV2WireVersion;
  cursors: SensaSyncCursorPair;
  limit: SensaSyncPullLimit;
}>;

export type SensaSyncV2PullReadyResult = Readonly<{
  wireVersion: typeof sensaSyncV2WireVersion;
  resultSchemaVersion: typeof sensaSyncV2ResultSchemaVersion;
  bootstrapRequired: false;
  errorCode: null;
  mutableChanges: ReadonlyArray<SensaSyncV2MutableChange>;
  appendFacts: ReadonlyArray<SensaSyncAppendFact>;
  nextCursors: SensaSyncCursorPair;
}>;

export type SensaSyncV2PullBootstrapRequiredResult = Readonly<{
  wireVersion: typeof sensaSyncV2WireVersion;
  resultSchemaVersion: typeof sensaSyncV2ResultSchemaVersion;
  bootstrapRequired: true;
  errorCode: "bootstrap_required";
  nextCursors: null;
}>;

export type SensaSyncV2PullResult =
  | SensaSyncV2PullReadyResult
  | SensaSyncV2PullBootstrapRequiredResult;

/**
 * Deep Sync Module seam.  Implementations own operation-id idempotency,
 * feed-first/ledger-last persistence, cursor validation and epoch rotation;
 * callers never receive SQL rows or write a feed directly.
 */
export interface SensaSyncModule {
  bootstrap(input: SensaSyncBootstrapInput): Promise<SensaSyncBootstrapResult>;
  push(input: SensaSyncPushInput): Promise<SensaSyncPushResult>;
  pull(input: SensaSyncPullInput): Promise<SensaSyncPullResult>;
}

export interface SensaSyncV2Module {
  bootstrap(input: SensaSyncV2BootstrapInput): Promise<SensaSyncV2BootstrapResult>;
  push(input: SensaSyncV2PushInput): Promise<SensaSyncV2PushResult>;
  pull(input: SensaSyncV2PullInput): Promise<SensaSyncV2PullResult>;
}
