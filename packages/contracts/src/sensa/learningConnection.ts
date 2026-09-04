import { z } from "zod";

export const sensaLearningConnectionContractVersion =
  "sensa-learning-connection-v2" as const;

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();
const timestamp = z.string().datetime({ offset: true });
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const jsonObject = z.record(z.string(), z.unknown());

export const sensaContentProvisioningPathSchema = z.enum([
  "published",
  "on_demand",
  "hybrid",
]);

export const sensaLearningProtocolPurposeSchema = z.enum([
  "initial_learning",
  "retention_review",
  "relearning",
]);

export const sensaLearningStepIntentSchema = z.enum([
  "instruction",
  "practice",
  "assessment",
  "repair",
]);

export const sensaInitialLearningCompletionKindSchema = z.enum([
  "study_completion",
  "acquisition_graduation",
  "imported_completion",
]);

export const sensaSchedulingHandoffBasisSchema = z.enum([
  "protocol_completion",
  "acquisition_graduation",
  "learner_rating",
  "imported",
]);

export const sensaLearningEvidenceLevelSchema = z.enum([
  "non_evidentiary",
  "self_report",
  "behavioral",
  "externally_attested",
]);

export const sensaMemoryOutcomeGradeSchema = z.enum([
  "again",
  "hard",
  "good",
  "easy",
]);

export const sensaProtocolObservationKindSchema = z.enum([
  "instruction_completed",
  "practice_completed",
  "checkpoint_satisfied",
  "checkpoint_not_satisfied",
  "repair_completed",
  "protocol_completed",
]);

export const sensaProtocolCheckpointDefinitionSchema = z
  .object({
    checkpointId: nonEmpty,
    capabilityObjectiveIds: z.array(nonEmpty),
    requiredForCompletion: z.boolean(),
  })
  .strict();

export const sensaProtocolCheckpointCreditSchema = z
  .object({
    status: z.enum(["unresolved", "credited", "failed"]),
    creditedInEpoch: nonNegativeInteger.nullable(),
    lastObservationId: nonEmpty.nullable(),
  })
  .strict()
  .superRefine((credit, context) => {
    if ((credit.status === "credited") !== (credit.creditedInEpoch !== null)) {
      context.addIssue({
        code: "custom",
        path: ["creditedInEpoch"],
        message: "Only credited Checkpoints carry a progress epoch.",
      });
    }
  });

export const sensaLearningObservationSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    observationId: uuid,
    protocolRunId: uuid,
    attemptId: uuid,
    actionId: uuid,
    kind: sensaProtocolObservationKindSchema,
    checkpointId: nonEmpty.nullable(),
    evidenceIds: z.array(uuid),
    observedAt: timestamp,
  })
  .strict()
  .superRefine((observation, context) => {
    const checkpointKind = observation.kind === "checkpoint_satisfied"
      || observation.kind === "checkpoint_not_satisfied"
      || observation.kind === "repair_completed";
    if (checkpointKind !== (observation.checkpointId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["checkpointId"],
        message: "Checkpoint observations require exactly one Checkpoint identity.",
      });
    }
  });

const checkpointEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("credit_checkpoint"), checkpointId: nonEmpty }).strict(),
  z.object({ kind: z.literal("invalidate_checkpoint"), checkpointId: nonEmpty }).strict(),
  z.object({
    kind: z.literal("schedule_repair"),
    checkpointId: nonEmpty,
    failedActionId: uuid,
  }).strict(),
  z.object({ kind: z.literal("require_reassessment"), checkpointId: nonEmpty }).strict(),
  z.object({ kind: z.literal("advance") }).strict(),
  z.object({ kind: z.literal("complete") }).strict(),
]);

const progressResetEffectSchema = z.discriminatedUnion("scope", [
  z.object({
    kind: z.literal("reset_progress"),
    scope: z.literal("current"),
    checkpointId: nonEmpty,
  }).strict(),
  z.object({
    kind: z.literal("reset_progress"),
    scope: z.literal("declared_set"),
    checkpointIds: z.array(nonEmpty).min(1),
  }).strict(),
  z.object({ kind: z.literal("reset_progress"), scope: z.literal("run") }).strict(),
]);

export const sensaProtocolTransitionEffectSchema = z.union([
  checkpointEffectSchema,
  progressResetEffectSchema,
]);

export const sensaProtocolTransitionDecisionSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    transitionDecisionId: uuid,
    protocolRunId: uuid,
    observationId: uuid,
    progressionPolicyId: nonEmpty,
    effects: z.array(sensaProtocolTransitionEffectSchema).min(1),
    decidedAt: timestamp,
  })
  .strict();

export const sensaProtocolProgressSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    protocolRunId: uuid,
    progressEpoch: nonNegativeInteger,
    checkpointCredits: z.record(nonEmpty, sensaProtocolCheckpointCreditSchema),
    pendingRepairCheckpointIds: z.array(nonEmpty),
    reassessmentRequiredCheckpointIds: z.array(nonEmpty),
    completed: z.boolean(),
    revision: positiveInteger,
    updatedAt: timestamp,
  })
  .strict();

export const sensaRetentionTargetStatusSchema = z.enum([
  "active",
  "paused",
  "retired",
]);

export const sensaMaterializationValidationStatusSchema = z.enum([
  "validated",
  "rejected",
]);

export const sensaPersonalAnchorUsePurposeSchema = z.enum([
  "content_generation",
  "learning_scaffold",
]);

export const sensaLearningTargetSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    learningTargetId: uuid,
    learnerUserId: nonEmpty,
    senseId: uuid,
    senseVersionId: uuid,
    senseExpressionBindingId: uuid,
    bindingVersionId: uuid,
    familiarLanguageTag: nonEmpty,
    targetLanguageTag: nonEmpty,
    learnerLocale: nonEmpty,
    curriculumProvenance: jsonObject,
    createdByOperationId: uuid,
    createdAt: timestamp,
  })
  .strict();

export const sensaLearningTargetPersonalSourceSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    learningTargetPersonalSourceId: uuid,
    learningTargetId: uuid,
    personalMeaningAlignmentId: uuid,
    createdAt: timestamp,
  })
  .strict();

export const sensaRetentionTargetSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    retentionTargetId: uuid,
    learningTargetId: uuid,
    learnerUserId: nonEmpty,
    senseId: uuid,
    senseExpressionBindingId: uuid,
    retentionScopeKey: nonEmpty,
    status: sensaRetentionTargetStatusSchema,
    revision: positiveInteger,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

export const sensaPersonalAnchorUseGrantFactSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    personalAnchorUseGrantId: uuid,
    learnerUserId: nonEmpty,
    personalSemanticAnchorRevisionId: uuid,
    personalMeaningAlignmentId: uuid,
    senseId: uuid,
    learningTargetId: uuid.nullable(),
    purpose: sensaPersonalAnchorUsePurposeSchema,
    grantedByOperationId: uuid,
    grantedAt: timestamp,
    expiresAt: timestamp.nullable(),
  })
  .strict();

export const sensaPersonalAnchorUseRevocationFactSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    personalAnchorUseRevocationId: uuid,
    personalAnchorUseGrantId: uuid,
    revokedByOperationId: uuid,
    reason: nonEmpty,
    revokedAt: timestamp,
  })
  .strict();

export const sensaLearningMaterializationSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    learningMaterializationId: uuid,
    learnerUserId: nonEmpty,
    learningTargetId: uuid,
    protocolPurpose: sensaLearningProtocolPurposeSchema,
    provisioningPath: sensaContentProvisioningPathSchema,
    contentSchemaVersion: nonEmpty,
    contentPayload: jsonObject,
    contentDigest: digest,
    validationStatus: sensaMaterializationValidationStatusSchema,
    validatorVersion: nonEmpty,
    provenance: jsonObject,
    personalAnchorUseGrantIds: z.array(uuid),
    createdAt: timestamp,
  })
  .strict();

export const sensaRetentionTargetKeySchema = z
  .object({
    learnerUserId: nonEmpty,
    senseId: uuid,
    senseExpressionBindingId: uuid,
    retentionScopeKey: nonEmpty,
  })
  .strict();

const independentScopeAdmissionSchema = z
  .object({
    learnerSelectable: z.literal(true),
    stableInteractionContract: z.literal(true),
    separablePerformance: z.literal(true),
    independentSchedulingValue: z.literal(true),
  })
  .strict();

export const sensaRetentionScopeDefinitionSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    retentionScopeKey: nonEmpty,
    definitionVersion: nonEmpty,
    kind: z.enum(["default", "independent"]),
    label: nonEmpty,
    targetCapability: nonEmpty,
    promptChannel: nonEmpty,
    responseChannel: nonEmpty,
    contentRequirement: z.array(nonEmpty).min(1),
    prerequisiteRetentionScopeKey: nonEmpty.nullable(),
    independentAdmission: independentScopeAdmissionSchema.nullable(),
  })
  .strict()
  .superRefine((scope, context) => {
    if (scope.kind === "independent" && scope.independentAdmission === null) {
      context.addIssue({
        code: "custom",
        path: ["independentAdmission"],
        message: "An independent Retention Scope requires all admission evidence.",
      });
    }
    if (scope.kind === "default" && scope.prerequisiteRetentionScopeKey !== null) {
      context.addIssue({
        code: "custom",
        path: ["prerequisiteRetentionScopeKey"],
        message: "The default Retention Scope cannot have a prerequisite.",
      });
    }
  });

const learningProtocolBindingSchema = z
  .object({
    protocolId: nonEmpty,
    protocolVersion: nonEmpty,
    runtimeAdapterId: nonEmpty,
    orchestrationId: nonEmpty,
    evaluationPolicyId: nonEmpty,
    progressionPolicyId: nonEmpty,
    completionPolicyId: nonEmpty,
    repairPolicyId: nonEmpty,
    memoryOutcomePolicyId: nonEmpty.nullable(),
    checkpointDefinitionIds: z.array(nonEmpty),
    contentRequirement: z.array(nonEmpty).min(1),
  })
  .strict();

export const sensaLearningPolicyProfileSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    profileId: nonEmpty,
    profileVersion: nonEmpty,
    protocols: z
      .object({
        initial_learning: learningProtocolBindingSchema,
        retention_review: learningProtocolBindingSchema,
        relearning: learningProtocolBindingSchema,
      })
      .strict(),
    lifecycle: z
      .object({
        evidencePolicyId: nonEmpty,
        schedulingPolicyId: nonEmpty,
        learnerVisibleClaimBoundary: nonEmpty,
        provisioningFallback: z.discriminatedUnion("behavior", [
          z.object({ behavior: z.literal("blocked") }).strict(),
          z
            .object({
              behavior: z.literal("learner_explicit_downgrade"),
              targetProfileId: nonEmpty,
            })
            .strict(),
        ]),
        migrationPolicy: z.literal("pin_existing_runs"),
      })
      .strict(),
  })
  .strict();

export const sensaProtocolRunSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    protocolRunId: uuid,
    learnerUserId: nonEmpty,
    learningTargetId: uuid,
    retentionTargetId: uuid,
    purpose: sensaLearningProtocolPurposeSchema,
    profileId: nonEmpty,
    profileVersion: nonEmpty,
    protocolId: nonEmpty,
    protocolVersion: nonEmpty,
    learningMaterializationIds: z.array(uuid).min(1),
    progressEpoch: nonNegativeInteger,
    checkpointCredits: z.record(nonEmpty, sensaProtocolCheckpointCreditSchema),
    status: z.enum(["planned", "active", "completed", "interrupted", "cancelled"]),
    startedAt: timestamp.nullable(),
    completedAt: timestamp.nullable(),
  })
  .strict();

export const sensaMemoryOutcomeBasisSchema = z.enum([
  "independent_retrieval",
  "transfer_confirmed",
  "retrieval_failed",
  "learner_rated",
]);

export const sensaMemoryOutcomeSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    memoryOutcomeId: uuid,
    learnerUserId: nonEmpty,
    retentionTargetId: uuid,
    protocolRunId: uuid,
    protocolStepId: nonEmpty,
    evaluationId: nonEmpty,
    dueReviewKey: nonEmpty,
    origin: z.enum(["retention_review", "relearning"]),
    basis: sensaMemoryOutcomeBasisSchema,
    evidenceLevel: sensaLearningEvidenceLevelSchema,
    evidenceIds: z.array(uuid),
    grade: sensaMemoryOutcomeGradeSchema,
    priorMemoryRevision: nonNegativeInteger,
    idempotencyKey: nonEmpty,
    occurredAt: timestamp,
  })
  .strict();

export const sensaSchedulingDecisionSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    schedulingDecisionId: uuid,
    retentionTargetId: uuid,
    memoryOutcomeId: uuid,
    schedulerPolicyVersion: nonEmpty,
    fsrsAdapterVersion: nonEmpty,
    grade: sensaMemoryOutcomeGradeSchema,
    priorMemoryRevision: nonNegativeInteger,
    resultingMemoryRevision: positiveInteger,
    nextDueAt: timestamp,
    decidedAt: timestamp,
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.resultingMemoryRevision !== decision.priorMemoryRevision + 1) {
      context.addIssue({
        code: "custom",
        path: ["resultingMemoryRevision"],
        message: "A Scheduling Decision advances exactly one Memory State revision.",
      });
    }
  });

export const sensaInitialLearningCompletionSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    initialLearningCompletionId: uuid,
    learnerUserId: nonEmpty,
    learningTargetId: uuid,
    retentionTargetId: uuid,
    protocolRunId: uuid,
    completionKind: sensaInitialLearningCompletionKindSchema,
    protocolOutcome: nonEmpty,
    completedAt: timestamp,
  })
  .strict();

export const sensaSchedulingHandoffSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    schedulingHandoffId: uuid,
    learnerUserId: nonEmpty,
    retentionTargetId: uuid,
    initialLearningCompletionId: uuid,
    initializationBasis: sensaSchedulingHandoffBasisSchema,
    evidenceLevel: sensaLearningEvidenceLevelSchema,
    evidenceIds: z.array(uuid),
    schedulerPolicyVersion: nonEmpty,
    initializerVersion: nonEmpty,
    learnerVisibleClaimBoundary: nonEmpty,
    createdAt: timestamp,
  })
  .strict();

export type SensaContentProvisioningPath = z.infer<
  typeof sensaContentProvisioningPathSchema
>;
export type SensaLearningProtocolPurpose = z.infer<
  typeof sensaLearningProtocolPurposeSchema
>;
export type SensaLearningStepIntent = z.infer<
  typeof sensaLearningStepIntentSchema
>;
export type SensaInitialLearningCompletionKind = z.infer<
  typeof sensaInitialLearningCompletionKindSchema
>;
export type SensaSchedulingHandoffBasis = z.infer<
  typeof sensaSchedulingHandoffBasisSchema
>;
export type SensaLearningEvidenceLevel = z.infer<
  typeof sensaLearningEvidenceLevelSchema
>;
export type SensaMemoryOutcomeGrade = z.infer<
  typeof sensaMemoryOutcomeGradeSchema
>;
export type SensaProtocolObservationKind = z.infer<
  typeof sensaProtocolObservationKindSchema
>;
export type SensaProtocolCheckpointDefinition = z.infer<
  typeof sensaProtocolCheckpointDefinitionSchema
>;
export type SensaProtocolCheckpointCredit = z.infer<
  typeof sensaProtocolCheckpointCreditSchema
>;
export type SensaLearningObservation = z.infer<
  typeof sensaLearningObservationSchema
>;
export type SensaProtocolTransitionEffect = z.infer<
  typeof sensaProtocolTransitionEffectSchema
>;
export type SensaProtocolTransitionDecision = z.infer<
  typeof sensaProtocolTransitionDecisionSchema
>;
export type SensaProtocolProgressSnapshot = z.infer<
  typeof sensaProtocolProgressSnapshotSchema
>;
export type SensaRetentionTargetStatus = z.infer<
  typeof sensaRetentionTargetStatusSchema
>;
export type SensaLearningTargetSnapshot = z.infer<
  typeof sensaLearningTargetSnapshotSchema
>;
export type SensaRetentionTargetSnapshot = z.infer<
  typeof sensaRetentionTargetSnapshotSchema
>;
export type SensaLearningTargetPersonalSource = z.infer<
  typeof sensaLearningTargetPersonalSourceSchema
>;
export type SensaPersonalAnchorUseGrantFact = z.infer<
  typeof sensaPersonalAnchorUseGrantFactSchema
>;
export type SensaPersonalAnchorUseRevocationFact = z.infer<
  typeof sensaPersonalAnchorUseRevocationFactSchema
>;
export type SensaLearningMaterializationSnapshot = z.infer<
  typeof sensaLearningMaterializationSnapshotSchema
>;
export type SensaRetentionTargetKey = z.infer<
  typeof sensaRetentionTargetKeySchema
>;
export type SensaRetentionScopeDefinition = z.infer<
  typeof sensaRetentionScopeDefinitionSchema
>;
export type SensaLearningPolicyProfile = z.infer<
  typeof sensaLearningPolicyProfileSchema
>;
export type SensaProtocolRunSnapshot = z.infer<
  typeof sensaProtocolRunSnapshotSchema
>;
export type SensaInitialLearningCompletion = z.infer<
  typeof sensaInitialLearningCompletionSchema
>;
export type SensaSchedulingHandoff = z.infer<
  typeof sensaSchedulingHandoffSchema
>;
export type SensaMemoryOutcomeBasis = z.infer<
  typeof sensaMemoryOutcomeBasisSchema
>;
export type SensaMemoryOutcomeSnapshot = z.infer<
  typeof sensaMemoryOutcomeSnapshotSchema
>;
export type SensaSchedulingDecision = z.infer<
  typeof sensaSchedulingDecisionSchema
>;
