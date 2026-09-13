import { z } from "zod";
import {sensaFormalPinnedLanguageContextSchema} from './language.js';

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
  "feedback",
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

export const sensaProtocolStepMaterialUseSchema = z.enum([
  "prompt",
  "support",
  "response",
  "reveal",
  "feedback",
  "detail",
]);

export const sensaProtocolStepMaterialRequirementSchema = z
  .object({
    materialRoleKey: nonEmpty,
    use: sensaProtocolStepMaterialUseSchema,
    required: z.boolean(),
  })
  .strict();

export const sensaCardPresentationReferenceSchema = z
  .object({
    presentationKey: nonEmpty,
    presentationVersion: nonEmpty,
  })
  .strict();

export const sensaCardPresentationSlotSchema = z
  .object({
    slotId: nonEmpty,
    displayOrder: nonNegativeInteger,
    required: z.boolean(),
    acceptedMaterialRoleKeys: z.array(nonEmpty).min(1),
    minItems: nonNegativeInteger,
    maxItems: positiveInteger,
    disclosurePhase: nonEmpty,
    missingBehavior: z.enum(["block_step", "collapse_slot"]),
    overflowBehavior: z.enum(["reject", "truncate"]),
  })
  .strict()
  .superRefine((slot, context) => {
    if (slot.maxItems < slot.minItems) {
      context.addIssue({
        code: "custom",
        path: ["maxItems"],
        message: "A Presentation Slot maxItems must be at least minItems.",
      });
    }
    if (slot.required !== (slot.minItems > 0)) {
      context.addIssue({
        code: "custom",
        path: ["minItems"],
        message: "A required Presentation Slot must require items; an optional Slot must not.",
      });
    }
    if (slot.required !== (slot.missingBehavior === "block_step")) {
      context.addIssue({
        code: "custom",
        path: ["missingBehavior"],
        message: "Required Slots block the Step; optional Slots collapse when absent.",
      });
    }
    const roles = new Set(slot.acceptedMaterialRoleKeys);
    if (roles.size !== slot.acceptedMaterialRoleKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["acceptedMaterialRoleKeys"],
        message: "A Presentation Slot cannot repeat a material role.",
      });
    }
  });

export const sensaCardPresentationDefinitionSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    presentationKey: nonEmpty,
    presentationVersion: nonEmpty,
    stepKinds: z.array(nonEmpty).min(1),
    slots: z.array(sensaCardPresentationSlotSchema).min(1),
  })
  .strict()
  .superRefine((presentation, context) => {
    const stepKinds = new Set(presentation.stepKinds);
    if (stepKinds.size !== presentation.stepKinds.length) {
      context.addIssue({
        code: "custom",
        path: ["stepKinds"],
        message: "A Card Presentation cannot repeat a Step kind.",
      });
    }
    const slotIds = new Set<string>();
    const displayOrders = new Set<number>();
    presentation.slots.forEach((slot, index) => {
      if (slotIds.has(slot.slotId)) {
        context.addIssue({
          code: "custom",
          path: ["slots", index, "slotId"],
          message: `Duplicate Card Presentation Slot: ${slot.slotId}`,
        });
      }
      slotIds.add(slot.slotId);
      if (displayOrders.has(slot.displayOrder)) {
        context.addIssue({
          code: "custom",
          path: ["slots", index, "displayOrder"],
          message: `Duplicate Card Presentation display order: ${slot.displayOrder}`,
        });
      }
      displayOrders.add(slot.displayOrder);
    });
  });

export const sensaProtocolStepTransitionRuleSchema = z
  .object({
    outcomeKey: nonEmpty,
    observationKind: sensaProtocolObservationKindSchema,
    effect: z.enum(["advance", "repeat", "complete"]),
    nextProtocolStepDefinitionId: nonEmpty.nullable(),
  })
  .strict()
  .superRefine((rule, context) => {
    const requiresNext = rule.effect === "advance" || rule.effect === "repeat";
    if (requiresNext !== (rule.nextProtocolStepDefinitionId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["nextProtocolStepDefinitionId"],
        message: "Advance/repeat transitions require a next Step; complete transitions forbid one.",
      });
    }
    if (rule.effect === "complete" && rule.observationKind !== "protocol_completed") {
      context.addIssue({
        code: "custom",
        path: ["observationKind"],
        message: "A complete transition must produce an explicit protocol_completed Observation.",
      });
    }
  });

/**
 * Source-neutral executable Step definition. Card layout remains behind the
 * versioned presentation reference; material requirements name roles, never UI fields.
 */
export const sensaProtocolStepDefinitionSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    protocolStepDefinitionId: nonEmpty,
    protocolId: nonEmpty,
    protocolVersion: nonEmpty,
    purpose: sensaLearningProtocolPurposeSchema,
    intent: sensaLearningStepIntentSchema,
    stepKind: nonEmpty,
    materialRequirements: z.array(sensaProtocolStepMaterialRequirementSchema),
    presentation: sensaCardPresentationReferenceSchema,
    interactionContractId: nonEmpty,
    interactionContractVersion: nonEmpty,
    resultEligibility: z
      .object({
        attempt: z.boolean(),
        observation: z.boolean(),
        evidence: z.boolean(),
        memoryOutcome: z.boolean(),
      })
      .strict(),
    transitions: z.array(sensaProtocolStepTransitionRuleSchema).min(1),
  })
  .strict()
  .superRefine((definition, context) => {
    const materialUses = new Set<string>();
    definition.materialRequirements.forEach((requirement, index) => {
      const identity = `${requirement.materialRoleKey}:${requirement.use}`;
      if (materialUses.has(identity)) {
        context.addIssue({
          code: "custom",
          path: ["materialRequirements", index],
          message: `Duplicate Step material requirement: ${identity}`,
        });
      }
      materialUses.add(identity);
    });

    const outcomes = new Set<string>();
    definition.transitions.forEach((transition, index) => {
      if (outcomes.has(transition.outcomeKey)) {
        context.addIssue({
          code: "custom",
          path: ["transitions", index, "outcomeKey"],
          message: `Duplicate Step transition outcome: ${transition.outcomeKey}`,
        });
      }
      outcomes.add(transition.outcomeKey);
    });

    if (definition.resultEligibility.evidence && definition.intent !== "assessment") {
      context.addIssue({
        code: "custom",
        path: ["resultEligibility", "evidence"],
        message: "Only an assessment Step may be eligible to produce Evidence.",
      });
    }
    if (definition.resultEligibility.memoryOutcome && definition.intent !== "assessment") {
      context.addIssue({
        code: "custom",
        path: ["resultEligibility", "memoryOutcome"],
        message: "Only an assessment Step may be eligible to produce a Memory Outcome.",
      });
    }
    if (definition.resultEligibility.evidence && !definition.resultEligibility.observation) {
      context.addIssue({
        code: "custom",
        path: ["resultEligibility", "observation"],
        message: "Evidence eligibility requires Observation eligibility.",
      });
    }
    if (definition.resultEligibility.memoryOutcome && !definition.resultEligibility.observation) {
      context.addIssue({
        code: "custom",
        path: ["resultEligibility", "observation"],
        message: "Memory Outcome eligibility requires Observation eligibility.",
      });
    }
  });

export const sensaProtocolStepMaterialBindingSchema = z
  .object({
    materialRoleKey: nonEmpty,
    learningMaterializationId: uuid,
    resourceKey: nonEmpty,
  })
  .strict();

/** Immutable learner-specific execution of one Protocol Step. */
export const sensaProtocolStepInstanceSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    protocolStepInstanceId: uuid,
    protocolRunId: uuid,
    retentionTargetId: uuid,
    protocolStepDefinitionId: nonEmpty,
    stepKind: nonEmpty,
    intent: sensaLearningStepIntentSchema,
    ordinal: positiveInteger,
    materialBindings: z.array(sensaProtocolStepMaterialBindingSchema),
    presentation: sensaCardPresentationReferenceSchema,
    status: z.enum(["planned", "active", "completed", "interrupted"]),
    transitionDecisionId: uuid.nullable(),
    startedAt: timestamp.nullable(),
    completedAt: timestamp.nullable(),
  })
  .strict()
  .superRefine((instance, context) => {
    if (instance.status === "active" && instance.startedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "An active Protocol Step Instance requires startedAt.",
      });
    }
    if ((instance.status === "completed") !== (instance.completedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Only a completed Protocol Step Instance carries completedAt.",
      });
    }
    if ((instance.status === "completed") !== (instance.transitionDecisionId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["transitionDecisionId"],
        message: "A completed Protocol Step Instance requires its Transition Decision.",
      });
    }
  });

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
    targetLanguageTag: nonEmpty,
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

/** A Target can participate in more than one route-specific Curriculum. The
 * Membership owns source, Support Language and material selection; none of
 * those values change the Target or Retention identity. */
export const sensaCurriculumMembershipSnapshotSchema=z.object({
  contractVersion:z.literal(sensaLearningConnectionContractVersion),
  curriculumMembershipId:uuid,
  revision:positiveInteger,
  learningTargetId:uuid,
  languageContext:sensaFormalPinnedLanguageContextSchema,
  sourceKind:z.enum(['sense_learning_package','personal_meaning_alignment']),
  sourceProvenance:jsonObject,
  packageKey:nonEmpty.nullable(),
  assurancePackageKey:nonEmpty.optional(),
  learningMaterializationId:uuid,
  createdByOperationId:uuid,
  createdAt:timestamp,
  updatedAt:timestamp,
}).strict();

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

/** Version-pinned Content Demand selected by a purpose-specific Protocol. */
export const sensaContentDemandReferenceSchema = z
  .object({
    contentDemandKey: nonEmpty,
    definitionVersion: nonEmpty,
  })
  .strict();

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
    contentDemands: z.array(sensaContentDemandReferenceSchema).min(1),
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
    learningTargetId: uuid,
    retentionTargetId: uuid,
    initialLearningCompletionId: uuid,
    profileId: nonEmpty,
    profileVersion: nonEmpty,
    protocolId: nonEmpty,
    protocolVersion: nonEmpty,
    learningMaterializationIds: z.array(uuid).min(1),
    initializationBasis: sensaSchedulingHandoffBasisSchema,
    evidenceLevel: sensaLearningEvidenceLevelSchema,
    evidenceIds: z.array(uuid),
    schedulerPolicyVersion: nonEmpty,
    initializerVersion: nonEmpty,
    learnerVisibleClaimBoundary: nonEmpty,
    createdAt: timestamp,
  })
  .strict();

export const sensaRelearningCompletionSchema = z
  .object({
    contractVersion: z.literal(sensaLearningConnectionContractVersion),
    relearningCompletionId: uuid,
    learnerUserId: nonEmpty,
    learningTargetId: uuid,
    retentionTargetId: uuid,
    protocolRunId: uuid,
    protocolOutcome: nonEmpty,
    evidenceLevel: sensaLearningEvidenceLevelSchema,
    evidenceIds: z.array(uuid),
    completedAt: timestamp,
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
export type SensaProtocolStepMaterialUse = z.infer<
  typeof sensaProtocolStepMaterialUseSchema
>;
export type SensaProtocolStepMaterialRequirement = z.infer<
  typeof sensaProtocolStepMaterialRequirementSchema
>;
export type SensaCardPresentationReference = z.infer<
  typeof sensaCardPresentationReferenceSchema
>;
export type SensaCardPresentationSlot = z.infer<
  typeof sensaCardPresentationSlotSchema
>;
export type SensaCardPresentationDefinition = z.infer<
  typeof sensaCardPresentationDefinitionSchema
>;
export type SensaProtocolStepTransitionRule = z.infer<
  typeof sensaProtocolStepTransitionRuleSchema
>;
export type SensaProtocolStepDefinition = z.infer<
  typeof sensaProtocolStepDefinitionSchema
>;
export type SensaProtocolStepMaterialBinding = z.infer<
  typeof sensaProtocolStepMaterialBindingSchema
>;
export type SensaProtocolStepInstanceSnapshot = z.infer<
  typeof sensaProtocolStepInstanceSnapshotSchema
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
export type SensaCurriculumMembershipSnapshot=z.infer<
  typeof sensaCurriculumMembershipSnapshotSchema
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
export type SensaContentDemandReference = z.infer<
  typeof sensaContentDemandReferenceSchema
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
export type SensaRelearningCompletion = z.infer<
  typeof sensaRelearningCompletionSchema
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
