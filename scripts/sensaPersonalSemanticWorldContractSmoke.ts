import assert from "node:assert/strict";
import {
  sensaConfirmExpressionBindingFactSchema,
  sensaConfirmSenseProposalFactSchema,
  sensaLearningMaterializationSnapshotSchema,
  sensaLearningConnectionContractVersion,
  sensaLearningTargetPersonalSourceSchema,
  sensaMeaningFocusAcceptanceFactSchema,
  sensaPersonalMeaningAlignmentSnapshotSchema,
  sensaPersonalMeaningRevisionSnapshotSchema,
  sensaPersonalSemanticWorldContractVersion,
  sensaRetentionTargetKeySchema,
  sensaSemanticAcceptanceFactSchema,
  sensaSenseProposalVersionSnapshotSchema,
  sensaSenseVersionSnapshotSchema,
} from "@sensa/contracts/sensa";

const ids = {
  operation: "00000000-0000-4000-8000-000000000001",
  personalMeaning: "00000000-0000-4000-8000-000000000002",
  personalMeaningRevision: "00000000-0000-4000-8000-000000000003",
  focus: "00000000-0000-4000-8000-000000000004",
  focusRevision: "00000000-0000-4000-8000-000000000005",
  focusAcceptance: "00000000-0000-4000-8000-000000000006",
  construction: "00000000-0000-4000-8000-000000000007",
  proposal: "00000000-0000-4000-8000-000000000008",
  proposalVersion: "00000000-0000-4000-8000-000000000009",
  candidate: "00000000-0000-4000-8000-000000000010",
  expressionAnchorRevision: "00000000-0000-4000-8000-000000000011",
  sense: "00000000-0000-4000-8000-000000000012",
  senseVersion: "00000000-0000-4000-8000-000000000013",
  senseConfirmation: "00000000-0000-4000-8000-000000000014",
  expressionVersion: "00000000-0000-4000-8000-000000000015",
  binding: "00000000-0000-4000-8000-000000000016",
  bindingVersion: "00000000-0000-4000-8000-000000000017",
  bindingConfirmation: "00000000-0000-4000-8000-000000000018",
  retentionTarget: "00000000-0000-4000-8000-000000000019",
  learningTarget: "00000000-0000-4000-8000-000000000020",
  alignment: "00000000-0000-4000-8000-000000000021",
  learningTargetSource: "00000000-0000-4000-8000-000000000022",
  materialization: "00000000-0000-4000-8000-000000000023",
  semanticAnchorRevision: "00000000-0000-4000-8000-000000000024",
  semanticAcceptance: "00000000-0000-4000-8000-000000000025",
} as const;

const occurredAt = "2026-09-01T08:00:00.000+00:00";
const sha256 = "a".repeat(64);
const semanticSpec = {
  schemaVersion: "sensa-sense-semantic-spec-v1" as const,
  coreMeaningFocus: "暂时取得并使用他人的物品",
  prototypeScenes: [{
    summary: "朋友把伞暂时交给 learner 使用",
    participantRoles: ["temporary possessor", "owner"],
    states: ["possession changes temporarily"],
    directionOrCausality: "owner → temporary possessor",
  }],
  includedCases: ["借入雨伞"],
  excludedCases: ["永久取得所有权"],
  neighborContrasts: [{ label: "lend", distinction: "参与者方向相反" }],
  openQuestions: [],
};

sensaSenseVersionSnapshotSchema.parse({
  contractVersion: "sensa-semantic-registry-v1",
  senseVersionId: ids.senseVersion,
  senseId: ids.sense,
  versionNumber: 1,
  origin: "learner_confirmed",
  semanticPolicyVersion: "sensa-semantic-policy-v3",
  semanticSpec,
  provenance: {
    sourceKind: "learner_confirmed",
    sourceReferenceIds: [ids.senseConfirmation],
    generator: {
      provider: "test-provider",
      model: "test-model",
      promptVersion: "sense-construction-v1",
      policyVersion: "sensa-semantic-policy-v3",
      inputDigest: sha256,
      outputDigest: sha256,
    },
  },
  reviewStatus: "learner_confirmed",
  contentReleaseId: null,
  createdAt: occurredAt,
});

const personalMeaningRevision = {
  contractVersion: sensaPersonalSemanticWorldContractVersion,
  personalMeaningRevisionId: ids.personalMeaningRevision,
  personalMeaningId: ids.personalMeaning,
  revision: 1,
  displayLabel: "借伞时我真正想表达的意思",
  learnerIntentNote: null,
  provenance: {
    kind: "learner_authored" as const,
    sourceReferenceIds: [],
    createdByOperationId: ids.operation,
  },
  createdAt: occurredAt,
};
sensaPersonalMeaningRevisionSnapshotSchema.parse(personalMeaningRevision);
assert.equal(sensaPersonalMeaningRevisionSnapshotSchema.safeParse({
  ...personalMeaningRevision,
  focuses: [],
}).success, false, "Personal Meaning must not become a giant nested JSON aggregate");

sensaMeaningFocusAcceptanceFactSchema.parse({
  contractVersion: sensaPersonalSemanticWorldContractVersion,
  meaningFocusAcceptanceId: ids.focusAcceptance,
  meaningFocusId: ids.focus,
  meaningFocusRevisionId: ids.focusRevision,
  operationId: ids.operation,
  acceptedAt: occurredAt,
});

sensaSenseProposalVersionSnapshotSchema.parse({
  contractVersion: sensaPersonalSemanticWorldContractVersion,
  senseProposalVersionId: ids.proposalVersion,
  senseProposalId: ids.proposal,
  version: 1,
  meaningFocusRevisionId: ids.focusRevision,
  semanticSpec,
  expressionCandidates: [{
    candidateId: ids.candidate,
    personalExpressionAnchorRevisionId: ids.expressionAnchorRevision,
    expressionType: "word",
    languageTag: "en",
    surfaceForm: "borrow",
    rationale: "自然表达该方向的暂时占有",
  }],
  unresolvedQuestions: [],
  semanticPolicyVersion: "sensa-semantic-policy-v3",
  generatorProvenance: {
    provider: "test-provider",
    model: "test-model",
    promptVersion: "sense-construction-v1",
    inputDigest: sha256,
    outputDigest: sha256,
  },
  createdAt: occurredAt,
});

sensaConfirmSenseProposalFactSchema.parse({
  contractVersion: sensaPersonalSemanticWorldContractVersion,
  senseProposalConfirmationId: ids.senseConfirmation,
  operationId: ids.operation,
  learnerUserId: "learner-1",
  senseProposalVersionId: ids.proposalVersion,
  meaningFocusRevisionId: ids.focusRevision,
  resolution: "create_new",
  senseId: ids.sense,
  senseVersionId: ids.senseVersion,
  confirmedAt: occurredAt,
});

sensaConfirmExpressionBindingFactSchema.parse({
  contractVersion: sensaPersonalSemanticWorldContractVersion,
  expressionBindingConfirmationId: ids.bindingConfirmation,
  operationId: ids.operation,
  learnerUserId: "learner-1",
  senseProposalVersionId: ids.proposalVersion,
  personalExpressionAnchorRevisionId: ids.expressionAnchorRevision,
  senseVersionId: ids.senseVersion,
  expressionVersionId: ids.expressionVersion,
  bindingVersionId: ids.bindingVersion,
  confirmedAt: occurredAt,
});

sensaSemanticAcceptanceFactSchema.parse({
  contractVersion: sensaPersonalSemanticWorldContractVersion,
  semanticAcceptanceId: ids.semanticAcceptance,
  operationId: ids.operation,
  learnerUserId: "learner-1",
  authority: { mode: "learner_direct", actorId: "learner-1" },
  personalSemanticAnchorRevisionId: ids.semanticAnchorRevision,
  personalExpressionAnchorRevisionId: ids.expressionAnchorRevision,
  expressionOccurrence: { kind: "text_span", start: 7, end: 13 },
  resolution: "reuse_existing",
  senseId: ids.sense,
  senseVersionId: ids.senseVersion,
  resolutionProvenance: {
    resolverKind: "external_tool",
    provider: "browser-extension",
    model: null,
    policyVersion: "contextual-resolution-v1",
    sourceReferenceIds: [ids.operation],
  },
  acceptedAt: occurredAt,
});

sensaPersonalMeaningAlignmentSnapshotSchema.parse({
  contractVersion: sensaPersonalSemanticWorldContractVersion,
  personalMeaningAlignmentId: ids.alignment,
  learnerUserId: "learner-1",
  personalMeaningId: ids.personalMeaning,
  personalMeaningRevisionId: ids.personalMeaningRevision,
  basis: {
    kind: "contextual_resolution",
    semanticAcceptanceId: ids.semanticAcceptance,
  },
  senseId: ids.sense,
  senseVersionId: ids.senseVersion,
  status: "active",
  revision: 1,
  createdAt: occurredAt,
  updatedAt: occurredAt,
});

const firstRetentionKey = sensaRetentionTargetKeySchema.parse({
  learnerUserId: "learner-1",
  senseId: ids.sense,
  senseExpressionBindingId: ids.binding,
  retentionScopeKey: "general",
});
const secondRetentionKey = sensaRetentionTargetKeySchema.parse({
  ...firstRetentionKey,
  senseExpressionBindingId: "00000000-0000-4000-8000-000000000024",
});
assert.notDeepEqual(firstRetentionKey, secondRetentionKey);

sensaLearningTargetPersonalSourceSchema.parse({
  contractVersion: sensaLearningConnectionContractVersion,
  learningTargetPersonalSourceId: ids.learningTargetSource,
  learningTargetId: ids.learningTarget,
  personalMeaningAlignmentId: ids.alignment,
  createdAt: occurredAt,
});

sensaLearningMaterializationSnapshotSchema.parse({
  contractVersion: sensaLearningConnectionContractVersion,
  learningMaterializationId: ids.materialization,
  learnerUserId: "learner-1",
  learningTargetId: ids.learningTarget,
  protocolPurpose: "initial_learning",
  provisioningPath: "on_demand",
  contentSchemaVersion: "sensa-lightweight-materialization-v1",
  contentPayload: { items: [] },
  contentDigest: sha256,
  validationStatus: "validated",
  validatorVersion: "sensa-materialization-validator-v1",
  provenance: { source: "on_demand" },
  personalAnchorUseGrantIds: [],
  createdAt: occurredAt,
});

console.log("Sensa Personal Semantic World contracts: OK");
