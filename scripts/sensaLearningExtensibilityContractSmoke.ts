import assert from "node:assert/strict";
import {
  sensaInitialLearningCompletionSchema,
  sensaLearningConnectionContractVersion,
  sensaLearningPolicyProfileSchema,
  sensaLearningObservationSchema,
  sensaMemoryOutcomeSnapshotSchema,
  sensaProtocolProgressSnapshotSchema,
  sensaProtocolTransitionDecisionSchema,
  sensaSchedulingDecisionSchema,
  sensaLearningTargetSnapshotSchema,
  sensaRetentionScopeDefinitionSchema,
  sensaRetentionTargetSnapshotSchema,
  sensaSchedulingHandoffSchema,
} from "@sensa/contracts/sensa";

const id = (suffix: string): string => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const now = "2026-09-04T00:00:00.000Z";

const learningTarget = sensaLearningTargetSnapshotSchema.parse({
  contractVersion: sensaLearningConnectionContractVersion,
  learningTargetId: id("2"),
  learnerUserId: "learner-1",
  senseId: id("20"),
  senseVersionId: id("21"),
  senseExpressionBindingId: id("22"),
  bindingVersionId: id("23"),
  familiarLanguageTag: "zh-CN",
  targetLanguageTag: "en",
  learnerLocale: "zh-CN",
  curriculumProvenance: { source: "smoke" },
  createdByOperationId: id("24"),
  createdAt: now,
});
const retentionTargetBase = {
  contractVersion: sensaLearningConnectionContractVersion,
  learningTargetId: learningTarget.learningTargetId,
  learnerUserId: "learner-1",
  senseId: learningTarget.senseId,
  senseExpressionBindingId: learningTarget.senseExpressionBindingId,
  status: "active",
  revision: 1,
  createdAt: now,
  updatedAt: now,
};
const semanticRetentionTarget = sensaRetentionTargetSnapshotSchema.parse({
  ...retentionTargetBase,
  retentionTargetId: id("3"),
  retentionScopeKey: "semantic_connection",
});
const spellingRetentionTarget = sensaRetentionTargetSnapshotSchema.parse({
  ...retentionTargetBase,
  retentionTargetId: id("30"),
  retentionScopeKey: "spelling_production",
});
assert.equal(semanticRetentionTarget.learningTargetId, spellingRetentionTarget.learningTargetId);
assert.notEqual(semanticRetentionTarget.retentionTargetId, spellingRetentionTarget.retentionTargetId);

const spellingScope = sensaRetentionScopeDefinitionSchema.parse({
  contractVersion: sensaLearningConnectionContractVersion,
  retentionScopeKey: "spelling_production",
  definitionVersion: "v1",
  kind: "independent",
  label: "Spelling production",
  targetCapability: "orthographic_production",
  promptChannel: "meaning_and_audio",
  responseChannel: "typed_expression",
  contentRequirement: ["compact_learning_material", "pronunciation_audio"],
  prerequisiteRetentionScopeKey: "semantic_connection",
  independentAdmission: {
    learnerSelectable: true,
    stableInteractionContract: true,
    separablePerformance: true,
    independentSchedulingValue: true,
  },
});
assert.equal(spellingScope.kind, "independent");
assert.equal(sensaRetentionScopeDefinitionSchema.safeParse({
  ...spellingScope,
  independentAdmission: null,
}).success, false);

const binding = {
  protocolId: "structured-acquisition",
  protocolVersion: "v1",
  runtimeAdapterId: "structured",
  orchestrationId: "structured_acquisition",
  evaluationPolicyId: "behavioral-checkpoint-evaluation-v1",
  progressionPolicyId: "structured-current-checkpoint-reset-v1",
  completionPolicyId: "all-required-checkpoints-v1",
  repairPolicyId: "structured-targeted-repair-v1",
  memoryOutcomePolicyId: null,
  checkpointDefinitionIds: ["recognition", "recall", "transfer"],
  contentRequirement: ["structured_learning_package"],
};
assert.equal(sensaLearningPolicyProfileSchema.safeParse({
  contractVersion: sensaLearningConnectionContractVersion,
  profileId: "high_assurance",
  profileVersion: "v1",
  protocols: {
    initial_learning: binding,
    retention_review: { ...binding, protocolId: "retention-review" },
    relearning: { ...binding, protocolId: "structured-relearning" },
  },
  lifecycle: {
    evidencePolicyId: "behavioral-v1",
    schedulingPolicyId: "fsrs-v1",
    learnerVisibleClaimBoundary: "Verified for this protocol; not permanent mastery.",
    provisioningFallback: {
      behavior: "learner_explicit_downgrade",
      targetProfileId: "lightweight",
    },
    migrationPolicy: "pin_existing_runs",
  },
}).success, true);

const completion = sensaInitialLearningCompletionSchema.parse({
  contractVersion: sensaLearningConnectionContractVersion,
  initialLearningCompletionId: id("1"),
  learnerUserId: "learner-1",
  learningTargetId: id("2"),
  retentionTargetId: id("3"),
  protocolRunId: id("4"),
  completionKind: "study_completion",
  protocolOutcome: "study_completed",
  completedAt: now,
});
assert.equal(completion.completionKind, "study_completion");

const handoffBase = {
  contractVersion: sensaLearningConnectionContractVersion,
  schedulingHandoffId: id("5"),
  learnerUserId: "learner-1",
  retentionTargetId: id("3"),
  initialLearningCompletionId: id("1"),
  initializationBasis: "protocol_completion",
  evidenceLevel: "non_evidentiary",
  evidenceIds: [],
  schedulerPolicyVersion: "fsrs-v1",
  initializerVersion: "initializer-v1",
  learnerVisibleClaimBoundary: "Study completed; no independent retrieval claim.",
  createdAt: now,
};
assert.equal(sensaSchedulingHandoffSchema.safeParse(handoffBase).success, true);
assert.equal(sensaSchedulingHandoffSchema.safeParse({
  ...handoffBase,
  initializationBasis: "study_completion",
}).success, false);

const observation = sensaLearningObservationSchema.parse({
  contractVersion: sensaLearningConnectionContractVersion,
  observationId: id("40"),
  protocolRunId: id("4"),
  attemptId: id("41"),
  actionId: id("42"),
  kind: "checkpoint_not_satisfied",
  checkpointId: "recognition",
  evidenceIds: [],
  observedAt: now,
});
assert.equal(observation.kind, "checkpoint_not_satisfied");
assert.equal(sensaLearningObservationSchema.safeParse({
  ...observation,
  checkpointId: null,
}).success, false);

const transition = sensaProtocolTransitionDecisionSchema.parse({
  contractVersion: sensaLearningConnectionContractVersion,
  transitionDecisionId: id("43"),
  protocolRunId: id("4"),
  observationId: observation.observationId,
  progressionPolicyId: "run-reset-v1",
  effects: [
    { kind: "reset_progress", scope: "run" },
    { kind: "schedule_repair", checkpointId: "recognition", failedActionId: id("42") },
  ],
  decidedAt: now,
});
assert.equal(transition.effects[0]?.kind, "reset_progress");

const progress = sensaProtocolProgressSnapshotSchema.parse({
  contractVersion: sensaLearningConnectionContractVersion,
  protocolRunId: id("4"),
  progressEpoch: 1,
  checkpointCredits: {
    recognition: {
      status: "failed",
      creditedInEpoch: null,
      lastObservationId: observation.observationId,
    },
  },
  pendingRepairCheckpointIds: ["recognition"],
  reassessmentRequiredCheckpointIds: [],
  completed: false,
  revision: 2,
  updatedAt: now,
});
assert.equal(progress.progressEpoch, 1);

const outcome = sensaMemoryOutcomeSnapshotSchema.parse({
  contractVersion: sensaLearningConnectionContractVersion,
  memoryOutcomeId: id("44"),
  learnerUserId: "learner-1",
  retentionTargetId: id("3"),
  protocolRunId: id("4"),
  protocolStepId: "review-step",
  evaluationId: "learner-rating-v1",
  dueReviewKey: "due-review-1",
  origin: "retention_review",
  basis: "learner_rated",
  evidenceLevel: "self_report",
  evidenceIds: [],
  grade: "hard",
  priorMemoryRevision: 2,
  idempotencyKey: "review-outcome-1",
  occurredAt: now,
});
assert.equal(outcome.grade, "hard");

assert.equal(sensaSchedulingDecisionSchema.safeParse({
  contractVersion: sensaLearningConnectionContractVersion,
  schedulingDecisionId: id("45"),
  retentionTargetId: id("3"),
  memoryOutcomeId: outcome.memoryOutcomeId,
  schedulerPolicyVersion: "fsrs-v1",
  fsrsAdapterVersion: "fsrs-adapter-v1",
  grade: outcome.grade,
  priorMemoryRevision: 2,
  resultingMemoryRevision: 3,
  nextDueAt: now,
  decidedAt: now,
}).success, true);
assert.equal(sensaSchedulingDecisionSchema.safeParse({
  contractVersion: sensaLearningConnectionContractVersion,
  schedulingDecisionId: id("46"),
  retentionTargetId: id("3"),
  memoryOutcomeId: outcome.memoryOutcomeId,
  schedulerPolicyVersion: "fsrs-v1",
  fsrsAdapterVersion: "fsrs-adapter-v1",
  grade: "hard",
  priorMemoryRevision: 2,
  resultingMemoryRevision: 4,
  nextDueAt: now,
  decidedAt: now,
}).success, false);

console.log("learning-extensibility contract smoke OK");
