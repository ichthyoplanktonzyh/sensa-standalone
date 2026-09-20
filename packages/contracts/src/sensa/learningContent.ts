import {revealResourcePlanSchema} from './revealResources.js';
import { z } from "zod";

import {
  sensaContentDemandReferenceSchema,
  sensaContentProvisioningPathSchema,
  sensaLearningProtocolPurposeSchema,
  sensaLearningStepIntentSchema,
} from "./learningConnection.js";

export const sensaLearningContentContractVersion =
  "sensa-learning-content-v3" as const;

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);
const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const timestamp = z.string().datetime({ offset: true });
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const jsonObject = z.record(z.string(), z.unknown());
const agentToolName = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);

const addDuplicateIssues = (
  values: readonly string[],
  label: string,
  path: PropertyKey[],
  context: z.RefinementCtx,
): void => {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: `Duplicate ${label}: ${value}`,
      });
    }
    seen.add(value);
  });
};

export const sensaContentEvidenceEligibilitySchema = z.enum([
  "none",
  "self_report",
  "behavioral",
]);

export const sensaValidatorPolicyReferenceSchema = z
  .object({
    validatorPolicyId: nonEmpty,
    validatorVersion: nonEmpty,
  })
  .strict();

export const sensaContentContextSourceSchema = z.enum([
  "target_expression",
  "confirmed_sense",
  "personal_anchor",
  "authorized_media",
  "dictionary",
  "corpus",
  "pronunciation_lexicon",
  "tool_observation",
  "other_authoritative_source",
]);

/** One typed, cardinality-bounded input slot in a standalone generation request. */
export const sensaContentContextRequirementSchema = z
  .object({
    contextKind: nonEmpty,
    required: z.boolean(),
    minItems: nonNegativeInteger,
    maxItems: positiveInteger.nullable(),
    contentSchemaId: nonEmpty,
    contentSchemaVersion: nonEmpty,
    acceptedSources: z.array(sensaContentContextSourceSchema).min(1),
  })
  .strict()
  .superRefine((requirement, context) => {
    if (requirement.required && requirement.minItems < 1) {
      context.addIssue({
        code: "custom",
        path: ["minItems"],
        message: "A required context kind must require at least one artifact.",
      });
    }
    if (!requirement.required && requirement.minItems !== 0) {
      context.addIssue({
        code: "custom",
        path: ["minItems"],
        message: "An optional context kind must have minItems = 0.",
      });
    }
    if (requirement.maxItems !== null && requirement.maxItems < requirement.minItems) {
      context.addIssue({
        code: "custom",
        path: ["maxItems"],
        message: "maxItems must be greater than or equal to minItems.",
      });
    }
    addDuplicateIssues(
      requirement.acceptedSources,
      "accepted context source",
      ["acceptedSources"],
      context,
    );
  });

/** One material role required by a Protocol, never a Card or session step. */
export const sensaMaterialRoleRequirementSchema = z
  .object({
    materialRoleKey: nonEmpty,
    required: z.boolean(),
    minItems: nonNegativeInteger,
    maxItems: positiveInteger.nullable(),
    contentSchemaId: nonEmpty,
    contentSchemaVersion: nonEmpty,
    eligibleStepIntents: z.array(sensaLearningStepIntentSchema).min(1),
    evidenceEligibility: sensaContentEvidenceEligibilitySchema,
    provisioningPolicyId: nonEmpty,
    provisioningPolicyVersion: nonEmpty,
    validatorPolicies: z.array(sensaValidatorPolicyReferenceSchema).min(1),
  })
  .strict()
  .superRefine((role, context) => {
    if (role.required && role.minItems < 1) {
      context.addIssue({
        code: "custom",
        path: ["minItems"],
        message: "A required material role must require at least one item.",
      });
    }
    if (!role.required && role.minItems !== 0) {
      context.addIssue({
        code: "custom",
        path: ["minItems"],
        message: "An optional material role must have minItems = 0.",
      });
    }
    if (role.maxItems !== null && role.maxItems < role.minItems) {
      context.addIssue({
        code: "custom",
        path: ["maxItems"],
        message: "maxItems must be greater than or equal to minItems.",
      });
    }
    addDuplicateIssues(
      role.eligibleStepIntents,
      "eligible Step intent",
      ["eligibleStepIntents"],
      context,
    );
    addDuplicateIssues(
      role.validatorPolicies.map((policy) => policy.validatorPolicyId),
      "validator Policy",
      ["validatorPolicies"],
      context,
    );
  });

/**
 * A non-model derivation such as media synthesis. It is deliberately separate
 * from model context: tools consume already accepted source material under a
 * pinned policy and produce another declared role.
 */
export const sensaContentDerivationRequirementSchema = z
  .object({
    derivationKey: nonEmpty,
    derivationKind: nonEmpty,
    inputMaterialRoleKeys: z.array(nonEmpty).min(1),
    outputMaterialRoleKey: nonEmpty,
    producerPolicyId: nonEmpty,
    producerPolicyVersion: nonEmpty,
    required: z.boolean(),
  })
  .strict()
  .superRefine((derivation, context) => {
    addDuplicateIssues(
      derivation.inputMaterialRoleKeys,
      "derivation input role",
      ["inputMaterialRoleKeys"],
      context,
    );
  });

/**
 * Machine-readable answer to "what content does this Protocol need?".
 * Presentation phases such as reveal remain outside this contract; a Protocol
 * may bind the same material role into prompt, reveal, feedback or detail.
 */
export const sensaContentDemandDefinitionSchema = z
  .object({
    contractVersion: z.literal(sensaLearningContentContractVersion),
    contentDemandKey: nonEmpty,
    definitionVersion: nonEmpty,
    applicablePurposes: z.array(sensaLearningProtocolPurposeSchema).min(1),
    acceptedProvisioningPaths: z.array(sensaContentProvisioningPathSchema).min(1),
    contextRequirements: z.array(sensaContentContextRequirementSchema).min(1),
    materialRoles: z.array(sensaMaterialRoleRequirementSchema).min(1),
    derivations: z.array(sensaContentDerivationRequirementSchema),
    assemblyPolicyId: nonEmpty,
    assemblyPolicyVersion: nonEmpty,
  })
  .strict()
  .superRefine((definition, context) => {
    addDuplicateIssues(
      definition.applicablePurposes,
      "Protocol purpose",
      ["applicablePurposes"],
      context,
    );
    addDuplicateIssues(
      definition.acceptedProvisioningPaths,
      "provisioning path",
      ["acceptedProvisioningPaths"],
      context,
    );
    addDuplicateIssues(
      definition.contextRequirements.map((requirement) => requirement.contextKind),
      "context requirement",
      ["contextRequirements"],
      context,
    );
    addDuplicateIssues(
      definition.materialRoles.map((role) => role.materialRoleKey),
      "material role",
      ["materialRoles"],
      context,
    );
    addDuplicateIssues(
      definition.derivations.map((derivation) => derivation.derivationKey),
      "derivation",
      ["derivations"],
      context,
    );

    const roleKeys = new Set(definition.materialRoles.map((role) => role.materialRoleKey));
    definition.derivations.forEach((derivation, index) => {
      derivation.inputMaterialRoleKeys.forEach((roleKey) => {
        if (!roleKeys.has(roleKey)) {
          context.addIssue({
            code: "custom",
            path: ["derivations", index, "inputMaterialRoleKeys"],
            message: `Derivation references unknown input material role: ${roleKey}`,
          });
        }
      });
      if (!roleKeys.has(derivation.outputMaterialRoleKey)) {
        context.addIssue({
          code: "custom",
          path: ["derivations", index, "outputMaterialRoleKey"],
          message: `Derivation references unknown output material role: ${derivation.outputMaterialRoleKey}`,
        });
      }
    });
  });

/** A frozen input artifact; AI adapters never fetch or reinterpret authority. */
export const sensaContentContextArtifactSchema = z
  .object({
    artifactId: nonEmpty,
    contextKind: nonEmpty,
    source: sensaContentContextSourceSchema,
    sourceVersion: nonEmpty,
    contentSchemaId: nonEmpty,
    contentSchemaVersion: nonEmpty,
    payload: jsonObject,
    contentDigest: digest,
    personalAnchorUseGrantId: uuid.nullable(),
    producerToolCallId: nonEmpty.nullable(),
    mediaReference: z.object({
      mediaObjectId: nonEmpty,
      mediaKind: z.enum(["image", "audio"]),
      mimeType: nonEmpty,
      sizeBytes: nonNegativeInteger,
      sha256: digest,
      accessCapability: nonEmpty,
    }).strict().nullable(),
  })
  .strict()
  .superRefine((artifact, context) => {
    const isPersonal = artifact.source === "personal_anchor"
      || artifact.source === "authorized_media";
    if (isPersonal !== (artifact.personalAnchorUseGrantId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["personalAnchorUseGrantId"],
        message: "Personal context requires an explicit use grant; non-personal context cannot carry one.",
      });
    }
    if (
      artifact.source === "tool_observation"
      && artifact.producerToolCallId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["producerToolCallId"],
        message: "A tool observation must identify its producing tool call.",
      });
    }
    if (artifact.source === "authorized_media" && artifact.mediaReference === null) {
      context.addIssue({
        code: "custom",
        path: ["mediaReference"],
        message: "Authorized media context must carry an immutable media reference.",
      });
    }
  });

export const sensaContentAgentToolDefinitionSchema = z
  .object({
    toolKey: agentToolName,
    toolVersion: nonEmpty,
    description: nonEmpty,
    inputSchemaId: nonEmpty,
    inputSchemaVersion: nonEmpty,
    inputJsonSchema: jsonObject,
    outputContextKinds: z.array(nonEmpty),
    outputMaterialRoleKeys: z.array(nonEmpty),
    maxCalls: positiveInteger,
  })
  .strict()
  .superRefine((tool, context) => {
    addDuplicateIssues(
      tool.outputContextKinds,
      "tool output context kind",
      ["outputContextKinds"],
      context,
    );
    addDuplicateIssues(
      tool.outputMaterialRoleKeys,
      "tool output material role",
      ["outputMaterialRoleKeys"],
      context,
    );
    if (tool.outputContextKinds.length === 0 && tool.outputMaterialRoleKeys.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["outputContextKinds"],
        message: "An approved content tool must produce an auditable artifact or Candidate.",
      });
    }
  });

export const sensaContentAgentAttemptBudgetSchema = z
  .object({
    maxModelTurns: positiveInteger.max(32),
    maxToolCalls: nonNegativeInteger.max(128),
    timeoutMs: positiveInteger.max(600_000),
  })
  .strict();

/**
 * Standalone request handed to a content-producing adapter. It embeds the
 * exact demand definition, initial frozen artifacts and approved tool/budget
 * constraints so the adapter need not read application code or infer Protocol.
 */
export const sensaContentGenerationRequestSchema = z
  .object({
    contractVersion: z.literal(sensaLearningContentContractVersion),
    contentProvisioningTaskId: uuid,
    contentAgentAttemptId: uuid,
    contentGenerationRequestId: uuid,
    idempotencyKey: nonEmpty,
    learnerUserId: nonEmpty,
    learningTargetId: uuid,
    senseId: uuid,
    senseVersionId: uuid,
    senseExpressionBindingId: uuid,
    resolvedLearningPlanRevisionId: nonEmpty,
    profileId: nonEmpty,
    profileVersion: nonEmpty,
    protocolPurpose: sensaLearningProtocolPurposeSchema,
    protocolId: nonEmpty,
    protocolVersion: nonEmpty,
    provisioningPath: sensaContentProvisioningPathSchema,
    demandReference: sensaContentDemandReferenceSchema,
    demand: sensaContentDemandDefinitionSchema,
    contextArtifacts: z.array(sensaContentContextArtifactSchema).min(2),
    approvedTools: z.array(sensaContentAgentToolDefinitionSchema),
    attemptBudget: sensaContentAgentAttemptBudgetSchema,
    generatorPolicyId: nonEmpty,
    generatorPolicyVersion: nonEmpty,
    requestedAt: timestamp,
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.demandReference.contentDemandKey !== request.demand.contentDemandKey
      || request.demandReference.definitionVersion !== request.demand.definitionVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["demandReference"],
        message: "Embedded Content Demand does not match the Protocol-pinned reference.",
      });
    }
    if (!request.demand.applicablePurposes.includes(request.protocolPurpose)) {
      context.addIssue({
        code: "custom",
        path: ["demand", "applicablePurposes"],
        message: "Content Demand does not apply to the requested Protocol purpose.",
      });
    }
    if (!request.demand.acceptedProvisioningPaths.includes(request.provisioningPath)) {
      context.addIssue({
        code: "custom",
        path: ["provisioningPath"],
        message: "Content Demand does not accept the requested provisioning path.",
      });
    }
    addDuplicateIssues(
      request.contextArtifacts.map((artifact) => artifact.artifactId),
      "context artifact identity",
      ["contextArtifacts"],
      context,
    );
    addDuplicateIssues(
      request.approvedTools.map((tool) => tool.toolKey),
      "approved content tool",
      ["approvedTools"],
      context,
    );
    const contextRequirements = new Map(request.demand.contextRequirements.map(
      (requirement) => [requirement.contextKind, requirement],
    ));
    const countByContext = new Map<string, number>();
    request.contextArtifacts.forEach((artifact, index) => {
      const requirement = contextRequirements.get(artifact.contextKind);
      if (!requirement) {
        context.addIssue({
          code: "custom",
          path: ["contextArtifacts", index, "contextKind"],
          message: `Generation context is not declared by the Content Demand: ${artifact.contextKind}`,
        });
        return;
      }
      countByContext.set(artifact.contextKind, (countByContext.get(artifact.contextKind) ?? 0) + 1);
      if (
        artifact.contentSchemaId !== requirement.contentSchemaId
        || artifact.contentSchemaVersion !== requirement.contentSchemaVersion
      ) {
        context.addIssue({
          code: "custom",
          path: ["contextArtifacts", index],
          message: `Generation context does not match the declared schema: ${artifact.contextKind}`,
        });
      }
      if (!requirement.acceptedSources.includes(artifact.source)) {
        context.addIssue({
          code: "custom",
          path: ["contextArtifacts", index, "source"],
          message: `Generation context uses a source not accepted for ${artifact.contextKind}.`,
        });
      }
    });
    request.demand.contextRequirements.forEach((requirement) => {
      const count = countByContext.get(requirement.contextKind) ?? 0;
      if (requirement.maxItems !== null && count > requirement.maxItems) {
        context.addIssue({
          code: "custom",
          path: ["contextArtifacts"],
          message: `Generation context exceeds its declared cardinality: ${requirement.contextKind}`,
        });
      }
    });
    const contextKinds = new Set(request.demand.contextRequirements.map(
      (requirement) => requirement.contextKind,
    ));
    const materialRoleKeys = new Set(request.demand.materialRoles.map(
      (role) => role.materialRoleKey,
    ));
    request.approvedTools.forEach((tool, index) => {
      tool.outputContextKinds.forEach((contextKind) => {
        if (!contextKinds.has(contextKind)) {
          context.addIssue({
            code: "custom",
            path: ["approvedTools", index, "outputContextKinds"],
            message: `Approved tool produces undeclared context: ${contextKind}`,
          });
        }
      });
      tool.outputMaterialRoleKeys.forEach((materialRoleKey) => {
        if (!materialRoleKeys.has(materialRoleKey)) {
          context.addIssue({
            code: "custom",
            path: ["approvedTools", index, "outputMaterialRoleKeys"],
            message: `Approved tool produces undeclared material role: ${materialRoleKey}`,
          });
        }
      });
    });
    const sources = new Set(request.contextArtifacts.map((artifact) => artifact.source));
    if (!sources.has("target_expression") || !sources.has("confirmed_sense")) {
      context.addIssue({
        code: "custom",
        path: ["contextArtifacts"],
        message: "Generation requires frozen target-expression and confirmed-Sense artifacts.",
      });
    }
  });

export const sensaContentProvisioningTaskStatusSchema = z.enum([
  "queued",
  "preparing",
  "submitted",
  "validating",
  "ready",
  "blocked",
  "cancelled",
]);

export const sensaContentProvisioningTaskSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaLearningContentContractVersion),
    contentProvisioningTaskId: uuid,
    learnerUserId: nonEmpty,
    learningTargetId: uuid,
    resolvedLearningPlanRevisionId: nonEmpty,
    protocolPurpose: sensaLearningProtocolPurposeSchema,
    protocolId: nonEmpty,
    protocolVersion: nonEmpty,
    demandReference: sensaContentDemandReferenceSchema,
    status: sensaContentProvisioningTaskStatusSchema,
    attemptIds: z.array(uuid),
    activeAttemptId: uuid.nullable(),
    submittedBundleId: uuid.nullable(),
    learningMaterializationId: uuid.nullable(),
    blockedReasonCode: nonEmpty.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .superRefine((task, context) => {
    addDuplicateIssues(task.attemptIds, "Content Agent Attempt", ["attemptIds"], context);
    if (task.activeAttemptId !== null && !task.attemptIds.includes(task.activeAttemptId)) {
      context.addIssue({
        code: "custom",
        path: ["activeAttemptId"],
        message: "The active Attempt must belong to the Content Provisioning Task.",
      });
    }
    if (["submitted", "validating"].includes(task.status) && task.submittedBundleId === null) {
      context.addIssue({
        code: "custom",
        path: ["submittedBundleId"],
        message: `${task.status} requires a submitted Material Candidate Bundle.`,
      });
    }
    if ((task.status === "ready") !== (task.learningMaterializationId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["learningMaterializationId"],
        message: "A Task has a Learning Materialization exactly when it is ready.",
      });
    }
    if ((task.status === "blocked") !== (task.blockedReasonCode !== null)) {
      context.addIssue({
        code: "custom",
        path: ["blockedReasonCode"],
        message: "A blocked Task must carry one reason; other states cannot.",
      });
    }
    if (["submitted", "validating", "ready", "blocked", "cancelled"].includes(task.status)
      && task.activeAttemptId !== null) {
      context.addIssue({
        code: "custom",
        path: ["activeAttemptId"],
        message: "A non-preparing Task cannot retain an active Agent Attempt.",
      });
    }
  });

export const sensaContentAgentAttemptStatusSchema = z.enum([
  "running",
  "submitted",
  "failed",
  "timed_out",
  "cancelled",
]);

export const sensaContentAgentBudgetUsageSchema = z
  .object({
    modelTurns: nonNegativeInteger,
    toolCalls: nonNegativeInteger,
    inputTokens: nonNegativeInteger.nullable(),
    outputTokens: nonNegativeInteger.nullable(),
  })
  .strict();

export const sensaContentAgentAttemptSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaLearningContentContractVersion),
    contentAgentAttemptId: uuid,
    contentProvisioningTaskId: uuid,
    contentGenerationRequestId: uuid,
    sequence: positiveInteger,
    status: sensaContentAgentAttemptStatusSchema,
    provider: nonEmpty,
    model: nonEmpty,
    promptPolicyId: nonEmpty,
    promptPolicyVersion: nonEmpty,
    inputSnapshotDigest: digest,
    budget: sensaContentAgentAttemptBudgetSchema,
    usage: sensaContentAgentBudgetUsageSchema,
    submittedBundleId: uuid.nullable(),
    failureCode: nonEmpty.nullable(),
    startedAt: timestamp,
    endedAt: timestamp.nullable(),
  })
  .strict()
  .superRefine((attempt, context) => {
    const terminal = attempt.status !== "running";
    if (terminal !== (attempt.endedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "Only a terminal Content Agent Attempt has an end timestamp.",
      });
    }
    if ((attempt.status === "submitted") !== (attempt.submittedBundleId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["submittedBundleId"],
        message: "Only a submitted Attempt owns a submitted Bundle identity.",
      });
    }
    const failed = ["failed", "timed_out", "cancelled"].includes(attempt.status);
    if (failed !== (attempt.failureCode !== null)) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "An unsuccessful terminal Attempt must carry one failure code.",
      });
    }
    if (
      attempt.usage.modelTurns > attempt.budget.maxModelTurns
      || attempt.usage.toolCalls > attempt.budget.maxToolCalls
    ) {
      context.addIssue({
        code: "custom",
        path: ["usage"],
        message: "Attempt usage cannot exceed its pinned budget.",
      });
    }
  });

export const sensaContentProductionMethodSchema = z.enum([
  "model_generation",
  "published_reuse",
  "deterministic_transform",
  "external_tool",
]);

/** Candidate content is still untrusted and cannot be used by Runtime. */
export const sensaMaterialCandidateSchema = z
  .object({
    contractVersion: z.literal(sensaLearningContentContractVersion),
    materialCandidateId: uuid,
    contentGenerationRequestId: uuid,
    materialRoleKey: nonEmpty,
    ordinal: nonNegativeInteger,
    contentSchemaId: nonEmpty,
    contentSchemaVersion: nonEmpty,
    contentPayload: jsonObject,
    contentDigest: digest,
    sourceArtifactIds: z.array(nonEmpty),
    sourceMaterialCandidateIds: z.array(uuid),
    productionMethod: sensaContentProductionMethodSchema,
    producerProvider: nonEmpty,
    producerModel: nonEmpty.nullable(),
    producerPolicyId: nonEmpty,
    producerPolicyVersion: nonEmpty,
    producedAt: timestamp,
  })
  .strict()
  .superRefine((candidate, context) => {
    addDuplicateIssues(
      candidate.sourceArtifactIds,
      "source artifact reference",
      ["sourceArtifactIds"],
      context,
    );
    addDuplicateIssues(
      candidate.sourceMaterialCandidateIds,
      "source material Candidate reference",
      ["sourceMaterialCandidateIds"],
      context,
    );
    if (
      candidate.productionMethod === "model_generation"
      && candidate.producerModel === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["producerModel"],
        message: "Model-generated material must identify the model.",
      });
    }
  });

export const sensaContentAgentToolCallStatusSchema = z.enum([
  "succeeded",
  "failed",
]);

export const sensaContentAgentToolCallRecordSchema = z
  .object({
    contractVersion: z.literal(sensaLearningContentContractVersion),
    toolCallId: nonEmpty,
    contentAgentAttemptId: uuid,
    ordinal: nonNegativeInteger,
    toolKey: agentToolName,
    toolVersion: nonEmpty,
    inputPayload: jsonObject,
    inputDigest: digest,
    status: sensaContentAgentToolCallStatusSchema,
    outputDigest: digest.nullable(),
    supportingArtifactIds: z.array(nonEmpty),
    materialCandidateIds: z.array(uuid),
    failureCode: nonEmpty.nullable(),
    startedAt: timestamp,
    completedAt: timestamp,
  })
  .strict()
  .superRefine((call, context) => {
    addDuplicateIssues(
      call.supportingArtifactIds,
      "tool supporting artifact",
      ["supportingArtifactIds"],
      context,
    );
    addDuplicateIssues(
      call.materialCandidateIds,
      "tool Material Candidate",
      ["materialCandidateIds"],
      context,
    );
    if ((call.status === "succeeded") !== (call.outputDigest !== null)) {
      context.addIssue({
        code: "custom",
        path: ["outputDigest"],
        message: "A successful tool call must record an output digest; a failed call cannot.",
      });
    }
    if ((call.status === "failed") !== (call.failureCode !== null)) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "A failed tool call must carry one failure code; a successful call cannot.",
      });
    }
  });

export const sensaMaterialRoleOmissionSchema = z
  .object({
    materialRoleKey: nonEmpty,
    reasonCode: nonEmpty,
    rationale: nonEmpty,
  })
  .strict();

/**
 * Immutable, untrusted output of one ended Content Agent Attempt. Independent
 * validation consumes this Bundle; Runtime never does.
 */
export const sensaMaterialCandidateBundleSchema = z
  .object({
    contractVersion: z.literal(sensaLearningContentContractVersion),
    materialCandidateBundleId: uuid,
    contentProvisioningTaskId: uuid,
    contentAgentAttemptId: uuid,
    contentGenerationRequestId: uuid,
    inputSnapshotDigest: digest,
    supportingContextArtifacts: z.array(sensaContentContextArtifactSchema),
    candidates: z.array(sensaMaterialCandidateSchema).min(1),
    omissions: z.array(sensaMaterialRoleOmissionSchema),
    toolCalls: z.array(sensaContentAgentToolCallRecordSchema),
    provider: nonEmpty,
    model: nonEmpty,
    promptPolicyId: nonEmpty,
    promptPolicyVersion: nonEmpty,
    usage: sensaContentAgentBudgetUsageSchema,
    submittedAt: timestamp,
  })
  .strict()
  .superRefine((bundle, context) => {
    addDuplicateIssues(
      bundle.supportingContextArtifacts.map((artifact) => artifact.artifactId),
      "supporting context artifact",
      ["supportingContextArtifacts"],
      context,
    );
    addDuplicateIssues(
      bundle.candidates.map((candidate) => candidate.materialCandidateId),
      "Material Candidate",
      ["candidates"],
      context,
    );
    addDuplicateIssues(
      bundle.omissions.map((omission) => omission.materialRoleKey),
      "material role omission",
      ["omissions"],
      context,
    );
    addDuplicateIssues(
      bundle.toolCalls.map((call) => call.toolCallId),
      "Content Agent tool call",
      ["toolCalls"],
      context,
    );
    bundle.candidates.forEach((candidate, index) => {
      if (candidate.contentGenerationRequestId !== bundle.contentGenerationRequestId) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "contentGenerationRequestId"],
          message: "A bundled Candidate must belong to the Bundle Generation Request.",
        });
      }
    });
    bundle.toolCalls.forEach((call, index) => {
      if (call.contentAgentAttemptId !== bundle.contentAgentAttemptId) {
        context.addIssue({
          code: "custom",
          path: ["toolCalls", index, "contentAgentAttemptId"],
          message: "A bundled tool call must belong to the Bundle Agent Attempt.",
        });
      }
    });
  });

const sensaMaterialValidatorResultSchema = z
  .object({
    validatorPolicyId: nonEmpty,
    validatorVersion: nonEmpty,
    status: z.enum(["passed", "failed"]),
    issueCodes: z.array(nonEmpty),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "passed" && result.issueCodes.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["issueCodes"],
        message: "A passing validator cannot report failure issue codes.",
      });
    }
    if (result.status === "failed" && result.issueCodes.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["issueCodes"],
        message: "A failing validator must report at least one stable issue code.",
      });
    }
  });

export const sensaMaterialCandidateValidationSchema = z
  .object({
    contractVersion: z.literal(sensaLearningContentContractVersion),
    materialCandidateValidationId: uuid,
    materialCandidateId: uuid,
    status: z.enum(["accepted", "rejected"]),
    validatorResults: z.array(sensaMaterialValidatorResultSchema).min(1),
    validatedAt: timestamp,
  })
  .strict()
  .superRefine((validation, context) => {
    addDuplicateIssues(
      validation.validatorResults.map((result) => result.validatorPolicyId),
      "validator result",
      ["validatorResults"],
      context,
    );
    const allPassed = validation.validatorResults.every((result) => result.status === "passed");
    if ((validation.status === "accepted") !== allPassed) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "A candidate is accepted exactly when every recorded validator passes.",
      });
    }
  });

export type ContentDemandCoverageIssue = Readonly<{
  code:
    | "supporting_artifact_identity_duplicate"
    | "context_kind_unknown"
    | "context_schema_mismatch"
    | "context_source_not_accepted"
    | "context_underfilled"
    | "context_overfilled"
    | "candidate_identity_duplicate"
    | "candidate_ordinal_duplicate"
    | "candidate_request_mismatch"
    | "material_role_unknown"
    | "material_schema_mismatch"
    | "provisioning_policy_mismatch"
    | "source_artifact_unknown"
    | "source_material_candidate_unknown"
    | "validation_identity_duplicate"
    | "candidate_validation_duplicate"
    | "validation_candidate_unknown"
    | "candidate_validation_missing"
    | "candidate_rejected"
    | "validator_policy_missing"
    | "validator_version_mismatch"
    | "derivation_output_missing"
    | "derivation_policy_mismatch"
    | "derivation_input_missing"
    | "material_role_omission_missing"
    | "material_role_omission_invalid"
    | "material_role_underfilled"
    | "material_role_overfilled";
  materialRoleKey: string | null;
  materialCandidateId: string | null;
}>;

export type ContentDemandCoverage = Readonly<{
  status: "satisfied" | "incomplete" | "invalid";
  issues: readonly ContentDemandCoverageIssue[];
}>;

export type ContentDemandCoverageInput = Readonly<{
  request: SensaContentGenerationRequest;
  supportingContextArtifacts: readonly SensaContentContextArtifact[];
  candidates: readonly SensaMaterialCandidate[];
  validations: readonly SensaMaterialCandidateValidation[];
}>;

/**
 * Structural admission check before a caller assembles the existing immutable
 * Learning Materialization. Domain/content validators remain separate and
 * report through candidate validations.
 */
export function assessContentDemandCoverage(
  input: ContentDemandCoverageInput,
): ContentDemandCoverage {
  const request = sensaContentGenerationRequestSchema.parse(input.request);
  const supportingContextArtifacts = input.supportingContextArtifacts.map((artifact) =>
    sensaContentContextArtifactSchema.parse(artifact));
  const candidates = input.candidates.map((candidate) =>
    sensaMaterialCandidateSchema.parse(candidate));
  const validations = input.validations.map((validation) =>
    sensaMaterialCandidateValidationSchema.parse(validation));
  const issues: ContentDemandCoverageIssue[] = [];
  const roles = new Map(request.demand.materialRoles.map((role) => [role.materialRoleKey, role]));
  const contextRequirements = new Map(request.demand.contextRequirements.map(
    (requirement) => [requirement.contextKind, requirement],
  ));
  const artifacts = new Set(request.contextArtifacts.map((artifact) => artifact.artifactId));
  const countByContext = new Map<string, number>();
  for (const artifact of request.contextArtifacts) {
    countByContext.set(
      artifact.contextKind,
      (countByContext.get(artifact.contextKind) ?? 0) + 1,
    );
  }
  for (const artifact of supportingContextArtifacts) {
    if (artifacts.has(artifact.artifactId)) {
      issues.push({
        code: "supporting_artifact_identity_duplicate",
        materialRoleKey: null,
        materialCandidateId: null,
      });
    }
    artifacts.add(artifact.artifactId);
    const requirement = contextRequirements.get(artifact.contextKind);
    if (!requirement) {
      issues.push({
        code: "context_kind_unknown",
        materialRoleKey: null,
        materialCandidateId: null,
      });
      continue;
    }
    countByContext.set(
      artifact.contextKind,
      (countByContext.get(artifact.contextKind) ?? 0) + 1,
    );
    if (
      artifact.contentSchemaId !== requirement.contentSchemaId
      || artifact.contentSchemaVersion !== requirement.contentSchemaVersion
    ) {
      issues.push({
        code: "context_schema_mismatch",
        materialRoleKey: null,
        materialCandidateId: null,
      });
    }
    if (!requirement.acceptedSources.includes(artifact.source)) {
      issues.push({
        code: "context_source_not_accepted",
        materialRoleKey: null,
        materialCandidateId: null,
      });
    }
  }
  for (const requirement of request.demand.contextRequirements) {
    const count = countByContext.get(requirement.contextKind) ?? 0;
    if (count < requirement.minItems) {
      issues.push({
        code: "context_underfilled",
        materialRoleKey: null,
        materialCandidateId: null,
      });
    }
    if (requirement.maxItems !== null && count > requirement.maxItems) {
      issues.push({
        code: "context_overfilled",
        materialRoleKey: null,
        materialCandidateId: null,
      });
    }
  }
  const validationByCandidate = new Map<string, SensaMaterialCandidateValidation>();
  const validationIds = new Set<string>();
  const candidateIds = new Set<string>();
  const candidateById = new Map(candidates.map((candidate) => [
    candidate.materialCandidateId,
    candidate,
  ]));
  const candidateOrdinals = new Set<string>();
  const countByRole = new Map<string, number>();

  for (const validation of validations) {
    if (validationIds.has(validation.materialCandidateValidationId)) {
      issues.push({
        code: "validation_identity_duplicate",
        materialRoleKey: null,
        materialCandidateId: validation.materialCandidateId,
      });
    }
    validationIds.add(validation.materialCandidateValidationId);
    if (!candidateById.has(validation.materialCandidateId)) {
      issues.push({
        code: "validation_candidate_unknown",
        materialRoleKey: null,
        materialCandidateId: validation.materialCandidateId,
      });
    }
    if (validationByCandidate.has(validation.materialCandidateId)) {
      issues.push({
        code: "candidate_validation_duplicate",
        materialRoleKey: candidateById.get(validation.materialCandidateId)?.materialRoleKey ?? null,
        materialCandidateId: validation.materialCandidateId,
      });
    } else {
      validationByCandidate.set(validation.materialCandidateId, validation);
    }
  }

  for (const candidate of candidates) {
    if (candidateIds.has(candidate.materialCandidateId)) {
      issues.push({
        code: "candidate_identity_duplicate",
        materialRoleKey: candidate.materialRoleKey,
        materialCandidateId: candidate.materialCandidateId,
      });
    }
    candidateIds.add(candidate.materialCandidateId);
    const ordinalKey = `${candidate.materialRoleKey}:${candidate.ordinal}`;
    if (candidateOrdinals.has(ordinalKey)) {
      issues.push({
        code: "candidate_ordinal_duplicate",
        materialRoleKey: candidate.materialRoleKey,
        materialCandidateId: candidate.materialCandidateId,
      });
    }
    candidateOrdinals.add(ordinalKey);
    if (candidate.contentGenerationRequestId !== request.contentGenerationRequestId) {
      issues.push({
        code: "candidate_request_mismatch",
        materialRoleKey: candidate.materialRoleKey,
        materialCandidateId: candidate.materialCandidateId,
      });
    }
    const role = roles.get(candidate.materialRoleKey);
    if (!role) {
      issues.push({
        code: "material_role_unknown",
        materialRoleKey: candidate.materialRoleKey,
        materialCandidateId: candidate.materialCandidateId,
      });
      continue;
    }
    countByRole.set(candidate.materialRoleKey, (countByRole.get(candidate.materialRoleKey) ?? 0) + 1);
    if (
      candidate.contentSchemaId !== role.contentSchemaId
      || candidate.contentSchemaVersion !== role.contentSchemaVersion
    ) {
      issues.push({
        code: "material_schema_mismatch",
        materialRoleKey: candidate.materialRoleKey,
        materialCandidateId: candidate.materialCandidateId,
      });
    }
    if (
      candidate.producerPolicyId !== role.provisioningPolicyId
      || candidate.producerPolicyVersion !== role.provisioningPolicyVersion
    ) {
      issues.push({
        code: "provisioning_policy_mismatch",
        materialRoleKey: candidate.materialRoleKey,
        materialCandidateId: candidate.materialCandidateId,
      });
    }
    if (candidate.sourceArtifactIds.some((artifactId) => !artifacts.has(artifactId))) {
      issues.push({
        code: "source_artifact_unknown",
        materialRoleKey: candidate.materialRoleKey,
        materialCandidateId: candidate.materialCandidateId,
      });
    }
    if (candidate.sourceMaterialCandidateIds.some((candidateId) => !candidateById.has(candidateId))) {
      issues.push({
        code: "source_material_candidate_unknown",
        materialRoleKey: candidate.materialRoleKey,
        materialCandidateId: candidate.materialCandidateId,
      });
    }
    const validation = validationByCandidate.get(candidate.materialCandidateId);
    if (!validation) {
      issues.push({
        code: "candidate_validation_missing",
        materialRoleKey: candidate.materialRoleKey,
        materialCandidateId: candidate.materialCandidateId,
      });
      continue;
    }
    if (validation.status !== "accepted") {
      issues.push({
        code: "candidate_rejected",
        materialRoleKey: candidate.materialRoleKey,
        materialCandidateId: candidate.materialCandidateId,
      });
    }
    const passedValidators = new Map(validation.validatorResults
      .filter((result) => result.status === "passed")
      .map((result) => [result.validatorPolicyId, result.validatorVersion]));
    for (const requiredValidator of role.validatorPolicies) {
      const actualVersion = passedValidators.get(requiredValidator.validatorPolicyId);
      if (actualVersion === undefined) {
        issues.push({
          code: "validator_policy_missing",
          materialRoleKey: candidate.materialRoleKey,
          materialCandidateId: candidate.materialCandidateId,
        });
      } else if (actualVersion !== requiredValidator.validatorVersion) {
        issues.push({
          code: "validator_version_mismatch",
          materialRoleKey: candidate.materialRoleKey,
          materialCandidateId: candidate.materialCandidateId,
        });
      }
    }
  }

  for (const derivation of request.demand.derivations) {
    const outputCandidates = candidates.filter((candidate) =>
      candidate.materialRoleKey === derivation.outputMaterialRoleKey
      && candidate.sourceMaterialCandidateIds.length > 0);
    if (derivation.required && outputCandidates.length === 0) {
      issues.push({
        code: "derivation_output_missing",
        materialRoleKey: derivation.outputMaterialRoleKey,
        materialCandidateId: null,
      });
    }
    for (const output of outputCandidates) {
      if (
        output.producerPolicyId !== derivation.producerPolicyId
        || output.producerPolicyVersion !== derivation.producerPolicyVersion
      ) {
        issues.push({
          code: "derivation_policy_mismatch",
          materialRoleKey: output.materialRoleKey,
          materialCandidateId: output.materialCandidateId,
        });
      }
      const inputRoleKeys = new Set(output.sourceMaterialCandidateIds.flatMap((candidateId) => {
        const source = candidateById.get(candidateId);
        return source ? [source.materialRoleKey] : [];
      }));
      if (derivation.inputMaterialRoleKeys.some((roleKey) => !inputRoleKeys.has(roleKey))) {
        issues.push({
          code: "derivation_input_missing",
          materialRoleKey: output.materialRoleKey,
          materialCandidateId: output.materialCandidateId,
        });
      }
    }
  }

  for (const role of request.demand.materialRoles) {
    const count = countByRole.get(role.materialRoleKey) ?? 0;
    if (count < role.minItems) {
      issues.push({
        code: "material_role_underfilled",
        materialRoleKey: role.materialRoleKey,
        materialCandidateId: null,
      });
    }
    if (role.maxItems !== null && count > role.maxItems) {
      issues.push({
        code: "material_role_overfilled",
        materialRoleKey: role.materialRoleKey,
        materialCandidateId: null,
      });
    }
  }

  const incompleteOnly = issues.length > 0
    && issues.every((issue) => issue.code === "context_underfilled"
      || issue.code === "material_role_underfilled"
      || issue.code === "derivation_output_missing");
  return Object.freeze({
    status: issues.length === 0 ? "satisfied" : incompleteOnly ? "incomplete" : "invalid",
    issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
  });
}

export const sensaMaterializedResourceSchema = z
  .object({
    resourceKey: nonEmpty,
    materialRoleKey: nonEmpty,
    ordinal: nonNegativeInteger,
    materialCandidateId: uuid,
    contentSchemaId: nonEmpty,
    contentSchemaVersion: nonEmpty,
    contentPayload: jsonObject,
    contentDigest: digest,
    sourceArtifactIds: z.array(nonEmpty),
    sourceMaterialCandidateIds: z.array(uuid),
    productionMethod: sensaContentProductionMethodSchema,
    producerProvider: nonEmpty,
    producerModel: nonEmpty.nullable(),
    producerPolicyId: nonEmpty,
    producerPolicyVersion: nonEmpty,
  })
  .strict();

/** Role-indexed immutable payload stored inside a Learning Materialization snapshot. */
export const sensaLearningMaterializationContentSchema = z
  .object({
    contentDemandKey: nonEmpty,
    definitionVersion: nonEmpty,
    contentGenerationRequestId: uuid,
    resources: z.array(sensaMaterializedResourceSchema).min(1),
    resourcePlan: revealResourcePlanSchema.optional(),
  })
  .strict()
  .superRefine((content, context) => {
    addDuplicateIssues(
      content.resources.map((resource) => resource.resourceKey),
      "materialized resource key",
      ["resources"],
      context,
    );
    addDuplicateIssues(
      content.resources.map((resource) => resource.materialCandidateId),
      "materialized Candidate",
      ["resources"],
      context,
    );
    addDuplicateIssues(
      content.resources.map((resource) => `${resource.materialRoleKey}:${resource.ordinal}`),
      "materialized role ordinal",
      ["resources"],
      context,
    );
  });

export type ContentDemandMaterializationAssembly =
  | Readonly<{
      status: "satisfied";
      issues: readonly [];
      content: SensaLearningMaterializationContent;
    }>
  | Readonly<{
      status: "incomplete" | "invalid";
      issues: readonly ContentDemandCoverageIssue[];
      content: null;
    }>;

const freezeMaterializedValue = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (value === null || typeof value !== "object") return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const child of Object.values(objectValue)) freezeMaterializedValue(child, seen);
  return Object.freeze(value);
};

/**
 * The generic admission-and-assembly seam. Callers never select accepted
 * Candidates themselves: only a fully satisfied Demand becomes Runtime content.
 */
export function assembleContentDemandMaterialization(
  input: ContentDemandCoverageInput,
): ContentDemandMaterializationAssembly {
  const coverage = assessContentDemandCoverage(input);
  if (coverage.status !== "satisfied") {
    return Object.freeze({
      status: coverage.status,
      issues: coverage.issues,
      content: null,
    });
  }
  const request = sensaContentGenerationRequestSchema.parse(input.request);
  const roleOrder = new Map(request.demand.materialRoles.map((role, index) => [
    role.materialRoleKey,
    index,
  ]));
  const candidates = input.candidates
    .map((candidate) => sensaMaterialCandidateSchema.parse(candidate))
    .sort((left, right) =>
      (roleOrder.get(left.materialRoleKey) ?? Number.MAX_SAFE_INTEGER)
        - (roleOrder.get(right.materialRoleKey) ?? Number.MAX_SAFE_INTEGER)
      || left.ordinal - right.ordinal);
  const content = sensaLearningMaterializationContentSchema.parse({
    contentDemandKey: request.demand.contentDemandKey,
    definitionVersion: request.demand.definitionVersion,
    contentGenerationRequestId: request.contentGenerationRequestId,
    resources: candidates.map((candidate) => ({
      resourceKey: `${candidate.materialRoleKey}:${candidate.ordinal}`,
      materialRoleKey: candidate.materialRoleKey,
      ordinal: candidate.ordinal,
      materialCandidateId: candidate.materialCandidateId,
      contentSchemaId: candidate.contentSchemaId,
      contentSchemaVersion: candidate.contentSchemaVersion,
      contentPayload: candidate.contentPayload,
      contentDigest: candidate.contentDigest,
      sourceArtifactIds: candidate.sourceArtifactIds,
      sourceMaterialCandidateIds: candidate.sourceMaterialCandidateIds,
      productionMethod: candidate.productionMethod,
      producerProvider: candidate.producerProvider,
      producerModel: candidate.producerModel,
      producerPolicyId: candidate.producerPolicyId,
      producerPolicyVersion: candidate.producerPolicyVersion,
    })),
  });
  return Object.freeze({
    status: "satisfied",
    issues: Object.freeze([] as const),
    content: freezeMaterializedValue(content),
  });
}

export type SensaMaterialRoleRequirement = z.infer<
  typeof sensaMaterialRoleRequirementSchema
>;
export type SensaValidatorPolicyReference = z.infer<
  typeof sensaValidatorPolicyReferenceSchema
>;
export type SensaContentContextRequirement = z.infer<
  typeof sensaContentContextRequirementSchema
>;
export type SensaContentContextSource = z.infer<
  typeof sensaContentContextSourceSchema
>;
export type SensaContentDerivationRequirement = z.infer<
  typeof sensaContentDerivationRequirementSchema
>;
export type SensaContentDemandDefinition = z.infer<
  typeof sensaContentDemandDefinitionSchema
>;
export type SensaContentContextArtifact = z.infer<
  typeof sensaContentContextArtifactSchema
>;
export type SensaContentAgentToolDefinition = z.infer<
  typeof sensaContentAgentToolDefinitionSchema
>;
export type SensaContentAgentAttemptBudget = z.infer<
  typeof sensaContentAgentAttemptBudgetSchema
>;
export type SensaContentGenerationRequest = z.infer<
  typeof sensaContentGenerationRequestSchema
>;
export type SensaContentProvisioningTaskStatus = z.infer<
  typeof sensaContentProvisioningTaskStatusSchema
>;
export type SensaContentProvisioningTaskSnapshot = z.infer<
  typeof sensaContentProvisioningTaskSnapshotSchema
>;
export type SensaContentAgentAttemptStatus = z.infer<
  typeof sensaContentAgentAttemptStatusSchema
>;
export type SensaContentAgentBudgetUsage = z.infer<
  typeof sensaContentAgentBudgetUsageSchema
>;
export type SensaContentAgentAttemptSnapshot = z.infer<
  typeof sensaContentAgentAttemptSnapshotSchema
>;
export type SensaContentProductionMethod = z.infer<
  typeof sensaContentProductionMethodSchema
>;
export type SensaMaterialCandidate = z.infer<typeof sensaMaterialCandidateSchema>;
export type SensaContentAgentToolCallStatus = z.infer<
  typeof sensaContentAgentToolCallStatusSchema
>;
export type SensaContentAgentToolCallRecord = z.infer<
  typeof sensaContentAgentToolCallRecordSchema
>;
export type SensaMaterialRoleOmission = z.infer<
  typeof sensaMaterialRoleOmissionSchema
>;
export type SensaMaterialCandidateBundle = z.infer<
  typeof sensaMaterialCandidateBundleSchema
>;
export type SensaMaterialCandidateValidation = z.infer<
  typeof sensaMaterialCandidateValidationSchema
>;
export type SensaMaterializedResource = z.infer<
  typeof sensaMaterializedResourceSchema
>;
export type SensaLearningMaterializationContent = z.infer<
  typeof sensaLearningMaterializationContentSchema
>;
