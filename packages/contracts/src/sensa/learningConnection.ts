import { z } from "zod";

export const sensaLearningConnectionContractVersion =
  "sensa-learning-connection-v1" as const;

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();
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
    retentionTargetId: uuid,
    senseId: uuid,
    senseVersionId: uuid,
    senseExpressionBindingId: uuid,
    bindingVersionId: uuid,
    familiarLanguageTag: nonEmpty,
    targetLanguageTag: nonEmpty,
    learnerLocale: nonEmpty,
    retentionScopeKey: nonEmpty,
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

export type SensaContentProvisioningPath = z.infer<
  typeof sensaContentProvisioningPathSchema
>;
export type SensaLearningProtocolPurpose = z.infer<
  typeof sensaLearningProtocolPurposeSchema
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
