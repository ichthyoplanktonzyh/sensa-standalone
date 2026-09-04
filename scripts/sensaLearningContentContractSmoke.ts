import assert from "node:assert/strict";

import {
  assembleContentDemandMaterialization,
  assessContentDemandCoverage,
  sensaContentDemandDefinitionSchema,
  sensaContentGenerationRequestSchema,
  sensaLearningContentContractVersion,
  sensaMaterialCandidateSchema,
  sensaMaterialCandidateValidationSchema,
} from "@sensa/contracts/sensa";

const id = (suffix: string): string =>
  `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const now = "2026-09-04T00:00:00.000Z";
const digest = (digit: string): string => digit.repeat(64);

const demand = sensaContentDemandDefinitionSchema.parse({
  contractVersion: sensaLearningContentContractVersion,
  contentDemandKey: "smoke.generic-content-demand",
  definitionVersion: "v1",
  applicablePurposes: ["initial_learning"],
  acceptedProvisioningPaths: ["on_demand", "hybrid"],
  contextRequirements: [
    {
      contextKind: "expression_snapshot",
      required: true,
      minItems: 1,
      maxItems: 1,
      contentSchemaId: "smoke.expression-snapshot",
      contentSchemaVersion: "v1",
      acceptedSources: ["target_expression"],
    },
    {
      contextKind: "sense_snapshot",
      required: true,
      minItems: 1,
      maxItems: 1,
      contentSchemaId: "smoke.sense-snapshot",
      contentSchemaVersion: "v1",
      acceptedSources: ["confirmed_sense"],
    },
    {
      contextKind: "reference_facts",
      required: true,
      minItems: 1,
      maxItems: null,
      contentSchemaId: "smoke.reference-fact",
      contentSchemaVersion: "v1",
      acceptedSources: ["dictionary", "corpus", "pronunciation_lexicon"],
    },
  ],
  materialRoles: [
    {
      materialRoleKey: "primary_material",
      required: true,
      minItems: 1,
      maxItems: 1,
      contentSchemaId: "smoke.primary-material",
      contentSchemaVersion: "v1",
      eligibleStepIntents: ["instruction", "practice"],
      evidenceEligibility: "none",
      provisioningPolicyId: "smoke.generate-or-reuse-v1",
      provisioningPolicyVersion: "v1",
      validatorPolicies: [
        { validatorPolicyId: "schema-v1", validatorVersion: "v1" },
        { validatorPolicyId: "semantic-alignment-v1", validatorVersion: "v1" },
      ],
    },
    {
      materialRoleKey: "derived_material",
      required: true,
      minItems: 1,
      maxItems: 1,
      contentSchemaId: "smoke.derived-material",
      contentSchemaVersion: "v1",
      eligibleStepIntents: ["instruction"],
      evidenceEligibility: "none",
      provisioningPolicyId: "smoke.media-producer",
      provisioningPolicyVersion: "v1",
      validatorPolicies: [
        { validatorPolicyId: "schema-v1", validatorVersion: "v1" },
        { validatorPolicyId: "source-binding-v1", validatorVersion: "v1" },
      ],
    },
  ],
  derivations: [{
    derivationKey: "smoke.derive-secondary-material",
    derivationKind: "external_media_synthesis",
    inputMaterialRoleKeys: ["primary_material"],
    outputMaterialRoleKey: "derived_material",
    producerPolicyId: "smoke.media-producer",
    producerPolicyVersion: "v1",
    required: true,
  }],
  assemblyPolicyId: "smoke.materialization-assembly",
  assemblyPolicyVersion: "v1",
});

const request = sensaContentGenerationRequestSchema.parse({
  contractVersion: sensaLearningContentContractVersion,
  contentProvisioningTaskId: id("30"),
  contentAgentAttemptId: id("31"),
  contentGenerationRequestId: id("1"),
  idempotencyKey: "smoke-request-1",
  learnerUserId: "learner-1",
  learningTargetId: id("2"),
  senseId: id("3"),
  senseVersionId: id("4"),
  senseExpressionBindingId: id("5"),
  resolvedLearningPlanRevisionId: "smoke-plan-v1",
  profileId: "smoke-profile",
  profileVersion: "v1",
  protocolPurpose: "initial_learning",
  protocolId: "smoke-protocol",
  protocolVersion: "v1",
  provisioningPath: "on_demand",
  demandReference: {
    contentDemandKey: demand.contentDemandKey,
    definitionVersion: demand.definitionVersion,
  },
  demand,
  contextArtifacts: [
    {
      artifactId: "target-expression-artifact",
      contextKind: "expression_snapshot",
      source: "target_expression",
      sourceVersion: "v1",
      contentSchemaId: "smoke.expression-snapshot",
      contentSchemaVersion: "v1",
      payload: { expression: "example" },
      contentDigest: digest("1"),
      personalAnchorUseGrantId: null,
      producerToolCallId: null,
      mediaReference: null,
    },
    {
      artifactId: "confirmed-sense-artifact",
      contextKind: "sense_snapshot",
      source: "confirmed_sense",
      sourceVersion: "v1",
      contentSchemaId: "smoke.sense-snapshot",
      contentSchemaVersion: "v1",
      payload: { sense: "fixed meaning" },
      contentDigest: digest("2"),
      personalAnchorUseGrantId: null,
      producerToolCallId: null,
      mediaReference: null,
    },
    {
      artifactId: "reference-fact-artifact",
      contextKind: "reference_facts",
      source: "dictionary",
      sourceVersion: "dictionary-release-v1",
      contentSchemaId: "smoke.reference-fact",
      contentSchemaVersion: "v1",
      payload: { definition: "source-backed fact" },
      contentDigest: digest("3"),
      personalAnchorUseGrantId: null,
      producerToolCallId: null,
      mediaReference: null,
    },
  ],
  approvedTools: [],
  attemptBudget: {
    maxModelTurns: 1,
    maxToolCalls: 0,
    timeoutMs: 30_000,
  },
  generatorPolicyId: "smoke-content-generator",
  generatorPolicyVersion: "v1",
  requestedAt: now,
});

const primaryCandidate = sensaMaterialCandidateSchema.parse({
  contractVersion: sensaLearningContentContractVersion,
  materialCandidateId: id("10"),
  contentGenerationRequestId: request.contentGenerationRequestId,
  materialRoleKey: "primary_material",
  ordinal: 0,
  contentSchemaId: "smoke.primary-material",
  contentSchemaVersion: "v1",
  contentPayload: { body: "candidate" },
  contentDigest: digest("4"),
  sourceArtifactIds: [
    "target-expression-artifact",
    "confirmed-sense-artifact",
    "reference-fact-artifact",
  ],
  sourceMaterialCandidateIds: [],
  productionMethod: "model_generation",
  producerProvider: "smoke-provider",
  producerModel: "smoke-model",
  producerPolicyId: "smoke.generate-or-reuse-v1",
  producerPolicyVersion: "v1",
  producedAt: now,
});

const derivedCandidate = sensaMaterialCandidateSchema.parse({
  contractVersion: sensaLearningContentContractVersion,
  materialCandidateId: id("11"),
  contentGenerationRequestId: request.contentGenerationRequestId,
  materialRoleKey: "derived_material",
  ordinal: 0,
  contentSchemaId: "smoke.derived-material",
  contentSchemaVersion: "v1",
  contentPayload: { mediaRef: "immutable-media-ref" },
  contentDigest: digest("5"),
  sourceArtifactIds: ["target-expression-artifact"],
  sourceMaterialCandidateIds: [primaryCandidate.materialCandidateId],
  productionMethod: "external_tool",
  producerProvider: "smoke-media-tool",
  producerModel: null,
  producerPolicyId: "smoke.media-producer",
  producerPolicyVersion: "v1",
  producedAt: now,
});

const validation = (
  candidateId: string,
  suffix: string,
  validatorPolicyIds: readonly string[],
) => sensaMaterialCandidateValidationSchema.parse({
  contractVersion: sensaLearningContentContractVersion,
  materialCandidateValidationId: id(suffix),
  materialCandidateId: candidateId,
  status: "accepted",
  validatorResults: validatorPolicyIds.map((validatorPolicyId) => ({
    validatorPolicyId,
    validatorVersion: "v1",
    status: "passed",
    issueCodes: [],
  })),
  validatedAt: now,
});

const primaryValidation = validation(
  primaryCandidate.materialCandidateId,
  "20",
  ["schema-v1", "semantic-alignment-v1"],
);
const derivedValidation = validation(
  derivedCandidate.materialCandidateId,
  "21",
  ["schema-v1", "source-binding-v1"],
);

assert.deepEqual(
  assessContentDemandCoverage({
    request,
    supportingContextArtifacts: [],
    candidates: [primaryCandidate, derivedCandidate],
    validations: [primaryValidation, derivedValidation],
  }),
  { status: "satisfied", issues: [] },
);

const assembled = assembleContentDemandMaterialization({
  request,
  supportingContextArtifacts: [],
  candidates: [derivedCandidate, primaryCandidate],
  validations: [primaryValidation, derivedValidation],
});
assert.equal(assembled.status, "satisfied");
assert.ok(assembled.content);
assert.deepEqual(
  assembled.content.resources.map((resource) => resource.resourceKey),
  ["primary_material:0", "derived_material:0"],
  "Assembly follows Demand role order rather than producer completion order.",
);
assert.equal(Object.isFrozen(assembled.content), true);
assert.equal(Object.isFrozen(assembled.content.resources), true);

assert.equal(
  assessContentDemandCoverage({
    request,
    supportingContextArtifacts: [],
    candidates: [primaryCandidate],
    validations: [primaryValidation],
  }).status,
  "incomplete",
  "Missing required roles are an incomplete provisioning result, not a usable Materialization.",
);

const wrongSchema = {
  ...derivedCandidate,
  contentSchemaVersion: "wrong-version",
};
assert.equal(
  assessContentDemandCoverage({
    request,
    supportingContextArtifacts: [],
    candidates: [primaryCandidate, wrongSchema],
    validations: [primaryValidation, derivedValidation],
  }).status,
  "invalid",
  "A role produced against another schema version must fail admission.",
);

const incompleteValidation = validation(
  primaryCandidate.materialCandidateId,
  "22",
  ["schema-v1"],
);
assert.equal(
  assessContentDemandCoverage({
    request,
    supportingContextArtifacts: [],
    candidates: [primaryCandidate, derivedCandidate],
    validations: [incompleteValidation, derivedValidation],
  }).status,
  "invalid",
  "A Candidate cannot omit a validator required by its material role.",
);

const wrongValidatorVersion = sensaMaterialCandidateValidationSchema.parse({
  ...primaryValidation,
  materialCandidateValidationId: id("23"),
  validatorResults: primaryValidation.validatorResults.map((result) =>
    result.validatorPolicyId === "semantic-alignment-v1"
      ? { ...result, validatorVersion: "wrong-version" }
      : result),
});
assert.equal(
  assessContentDemandCoverage({
    request,
    supportingContextArtifacts: [],
    candidates: [primaryCandidate, derivedCandidate],
    validations: [wrongValidatorVersion, derivedValidation],
  }).status,
  "invalid",
  "A Candidate cannot satisfy a pinned validator with another validator version.",
);

assert.equal(
  assessContentDemandCoverage({
    request,
    supportingContextArtifacts: [],
    candidates: [{
      ...primaryCandidate,
      producerPolicyId: "another-provisioning-policy",
    }, derivedCandidate],
    validations: [primaryValidation, derivedValidation],
  }).status,
  "invalid",
  "A Candidate must use the provisioning policy pinned by its material role.",
);

assert.equal(
  assessContentDemandCoverage({
    request,
    supportingContextArtifacts: [],
    candidates: [primaryCandidate, {
      ...derivedCandidate,
      producerPolicyVersion: "wrong-version",
    }],
    validations: [primaryValidation, derivedValidation],
  }).status,
  "invalid",
  "External derivations must use the producer policy pinned by the Content Demand.",
);

const requestAwaitingRequiredToolContext = sensaContentGenerationRequestSchema.parse({
  ...request,
  contextArtifacts: request.contextArtifacts.filter((artifact) =>
    artifact.contextKind !== "reference_facts"),
});
assert.equal(assessContentDemandCoverage({
  request: requestAwaitingRequiredToolContext,
  supportingContextArtifacts: [],
  candidates: [{
    ...primaryCandidate,
    sourceArtifactIds: ["target-expression-artifact", "confirmed-sense-artifact"],
  }, derivedCandidate],
  validations: [primaryValidation, derivedValidation],
}).status, "incomplete", "An Attempt may acquire demanded context through tools, but admission remains incomplete until it does.");

assert.equal(sensaContentGenerationRequestSchema.safeParse({
  ...request,
  contextArtifacts: [
    ...request.contextArtifacts,
    {
      artifactId: "private-scene",
      contextKind: "personal_scene",
      source: "personal_anchor",
      sourceVersion: "v1",
      contentSchemaId: "smoke.personal-scene",
      contentSchemaVersion: "v1",
      payload: { scene: "private" },
      contentDigest: digest("6"),
      personalAnchorUseGrantId: null,
      producerToolCallId: null,
      mediaReference: null,
    },
  ],
}).success, false, "Personal context without an explicit use grant must be rejected.");

assert.equal(sensaContentDemandDefinitionSchema.safeParse({
  ...demand,
  derivations: [{
    ...demand.derivations[0],
    outputMaterialRoleKey: "undeclared-role",
  }],
}).success, false, "A derivation cannot synthesize an undeclared material role.");

assert.equal(sensaMaterialCandidateSchema.safeParse({
  ...primaryCandidate,
  producerModel: null,
}).success, false, "AI-generated candidates must retain model provenance.");

assert.equal(sensaMaterialCandidateValidationSchema.safeParse({
  ...primaryValidation,
  validatorResults: [{
    validatorPolicyId: "schema-v1",
    validatorVersion: "v1",
    status: "failed",
    issueCodes: [],
  }],
  status: "rejected",
}).success, false, "A failed validator must return a stable issue code.");

console.log("learning-content contract smoke OK");
