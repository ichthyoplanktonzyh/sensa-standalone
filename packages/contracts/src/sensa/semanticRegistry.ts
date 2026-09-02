import { z } from "zod";

export const sensaSemanticRegistryContractVersion =
  "sensa-semantic-registry-v1" as const;

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();
const timestamp = z.string().datetime({ offset: true });
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const jsonObject = z.record(z.string(), z.unknown());

export const sensaExpressionTypeSchema = z.enum([
  "word",
  "phrase",
  "construction",
  "sentence",
  "utterance_strategy",
]);

export const sensaSemanticCoverageSchema = z.enum([
  "exact",
  "broader",
  "narrower",
  "overlapping",
]);

export const sensaExpressionBindingRelationSchema = z.enum([
  "realizes",
  "approximates",
  "evokes",
]);

export const sensaSemanticReviewStatusSchema = z.enum([
  "learner_confirmed",
  "reviewed",
  "rejected",
]);

export const sensaSenseVersionOriginSchema = z.enum([
  "learner_confirmed",
  "published_release",
  "editorial",
  "imported",
]);

export const sensaSemanticGeneratorProvenanceSchema = z
  .object({
    provider: nonEmpty,
    model: nonEmpty,
    promptVersion: nonEmpty,
    policyVersion: nonEmpty,
    inputDigest: digest,
    outputDigest: digest,
  })
  .strict();

export const sensaSemanticProvenanceSchema = z
  .object({
    sourceKind: sensaSenseVersionOriginSchema,
    sourceReferenceIds: z.array(nonEmpty),
    generator: sensaSemanticGeneratorProvenanceSchema.nullable(),
  })
  .strict();

export const sensaPrototypeSceneSchema = z
  .object({
    summary: nonEmpty,
    participantRoles: z.array(nonEmpty),
    states: z.array(nonEmpty),
    directionOrCausality: nonEmpty.nullable(),
  })
  .strict();

export const sensaNeighborContrastSchema = z
  .object({
    label: nonEmpty,
    distinction: nonEmpty,
  })
  .strict();

export const sensaSenseSemanticSpecSchema = z
  .object({
    schemaVersion: z.literal("sensa-sense-semantic-spec-v1"),
    coreMeaningFocus: nonEmpty,
    prototypeScenes: z.array(sensaPrototypeSceneSchema).min(1),
    includedCases: z.array(nonEmpty),
    excludedCases: z.array(nonEmpty),
    neighborContrasts: z.array(sensaNeighborContrastSchema),
    openQuestions: z.array(nonEmpty),
  })
  .strict();

export const sensaSenseSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaSemanticRegistryContractVersion),
    senseId: uuid,
    senseKey: nonEmpty,
    currentSenseVersionId: uuid,
    currentVersionNumber: positiveInteger,
    createdAt: timestamp,
  })
  .strict();

export const sensaSenseVersionSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaSemanticRegistryContractVersion),
    senseVersionId: uuid,
    senseId: uuid,
    versionNumber: positiveInteger,
    origin: sensaSenseVersionOriginSchema,
    semanticPolicyVersion: nonEmpty,
    semanticSpec: sensaSenseSemanticSpecSchema,
    provenance: sensaSemanticProvenanceSchema,
    reviewStatus: sensaSemanticReviewStatusSchema,
    contentReleaseId: uuid.nullable(),
    createdAt: timestamp,
  })
  .strict();

export const sensaExpressionSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaSemanticRegistryContractVersion),
    expressionId: uuid,
    expressionType: sensaExpressionTypeSchema,
    languageTag: nonEmpty,
    lexemeId: uuid.nullable(),
    currentExpressionVersionId: uuid,
    currentVersionNumber: positiveInteger,
    createdAt: timestamp,
  })
  .strict();

export const sensaExpressionVersionSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaSemanticRegistryContractVersion),
    expressionVersionId: uuid,
    expressionId: uuid,
    versionNumber: positiveInteger,
    surfaceForm: nonEmpty,
    normalizedForm: nonEmpty,
    structure: jsonObject,
    provenance: sensaSemanticProvenanceSchema,
    createdAt: timestamp,
  })
  .strict();

export const sensaSenseExpressionBindingSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaSemanticRegistryContractVersion),
    senseExpressionBindingId: uuid,
    senseId: uuid,
    expressionId: uuid,
    relation: sensaExpressionBindingRelationSchema,
    currentBindingVersionId: uuid,
    currentVersionNumber: positiveInteger,
    createdAt: timestamp,
  })
  .strict();

export const sensaSenseExpressionBindingVersionSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaSemanticRegistryContractVersion),
    bindingVersionId: uuid,
    senseExpressionBindingId: uuid,
    versionNumber: positiveInteger,
    senseVersionId: uuid,
    expressionVersionId: uuid,
    semanticCoverage: sensaSemanticCoverageSchema,
    registerLabel: nonEmpty.nullable(),
    usageConstraints: z.array(nonEmpty),
    provenance: sensaSemanticProvenanceSchema,
    reviewStatus: sensaSemanticReviewStatusSchema,
    createdAt: timestamp,
  })
  .strict();

export type SensaExpressionType = z.infer<typeof sensaExpressionTypeSchema>;
export type SensaSemanticCoverage = z.infer<typeof sensaSemanticCoverageSchema>;
export type SensaExpressionBindingRelation = z.infer<
  typeof sensaExpressionBindingRelationSchema
>;
export type SensaSemanticReviewStatus = z.infer<
  typeof sensaSemanticReviewStatusSchema
>;
export type SensaSenseVersionOrigin = z.infer<
  typeof sensaSenseVersionOriginSchema
>;
export type SensaSenseSemanticSpec = z.infer<
  typeof sensaSenseSemanticSpecSchema
>;
export type SensaSemanticProvenance = z.infer<
  typeof sensaSemanticProvenanceSchema
>;
export type SensaSenseSnapshot = z.infer<typeof sensaSenseSnapshotSchema>;
export type SensaSenseVersionSnapshot = z.infer<
  typeof sensaSenseVersionSnapshotSchema
>;
export type SensaExpressionSnapshot = z.infer<
  typeof sensaExpressionSnapshotSchema
>;
export type SensaExpressionVersionSnapshot = z.infer<
  typeof sensaExpressionVersionSnapshotSchema
>;
export type SensaSenseExpressionBindingSnapshot = z.infer<
  typeof sensaSenseExpressionBindingSnapshotSchema
>;
export type SensaSenseExpressionBindingVersionSnapshot = z.infer<
  typeof sensaSenseExpressionBindingVersionSnapshotSchema
>;
