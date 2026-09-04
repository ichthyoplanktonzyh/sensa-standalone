import { z } from "zod";

import { sensaExpressionTypeSchema } from "./semanticRegistry.js";

export const sensaIntakeContractVersion = "sensa-intake-v1" as const;

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);
const timestamp = z.string().datetime({ offset: true });
const nonNegativeInteger = z.number().int().nonnegative();

export const sensaIntakeModalitySchema = z.enum([
  "text",
  "image",
  "audio",
  "mixed",
]);

export const sensaIntakeWordingSourceSchema = z.enum([
  "learner_authored",
  "llm_suggested",
  "imported",
]);

export const sensaIntakeConfirmationStatusSchema = z.enum([
  "user_confirmed",
  "model_inferred",
  "candidate_only",
]);

export const sensaIntakeLanguageRoleSchema = z.enum(["target", "familiar"]);

export const sensaIntakeItemStatusSchema = z.enum([
  "pending_sense",
  "pending_expression",
]);

export const sensaIntakeSourceMetaSchema = z
  .object({
    client: nonEmpty,
    url: nonEmpty.nullable(),
    title: nonEmpty.nullable(),
    domSelector: nonEmpty.nullable(),
    paragraphContext: nonEmpty.nullable(),
  })
  .strict();

export const sensaIntakeContextSchema = z
  .object({
    modality: sensaIntakeModalitySchema,
    textSegment: nonEmpty.nullable(),
    mediaReferenceIds: z.array(nonEmpty),
    source: sensaIntakeSourceMetaSchema.nullable(),
  })
  .strict();

export const sensaIntakeExpressionSchema = z
  .object({
    surfaceForm: nonEmpty,
    languageRole: sensaIntakeLanguageRoleSchema,
    characterSpan: z
      .object({
        start: nonNegativeInteger,
        end: nonNegativeInteger,
      })
      .strict()
      .nullable(),
    expressionTypeHint: sensaExpressionTypeSchema.nullable(),
  })
  .strict();

export const sensaIntakeSenseCandidateSchema = z
  .object({
    senseKey: nonEmpty.nullable(),
    definitionSummary: nonEmpty,
  })
  .strict();

export const sensaIntakeSenseSchema = z
  .object({
    senseKey: nonEmpty.nullable(),
    confirmationStatus: sensaIntakeConfirmationStatusSchema,
    definitionSummary: nonEmpty,
    wordingSource: sensaIntakeWordingSourceSchema,
    candidates: z.array(sensaIntakeSenseCandidateSchema),
  })
  .strict();

export const sensaIntakePayloadSchema = z
  .object({
    contractVersion: z.literal(sensaIntakeContractVersion),
    intakeOperationId: uuid,
    capturedAt: timestamp,
    context: sensaIntakeContextSchema,
    expression: sensaIntakeExpressionSchema.nullable(),
    sense: sensaIntakeSenseSchema.nullable(),
  })
  .strict();

export const sensaIntakeItemSchema = z
  .object({
    contractVersion: z.literal(sensaIntakeContractVersion),
    intakeId: uuid,
    status: sensaIntakeItemStatusSchema,
    summaryView: nonEmpty,
    payload: sensaIntakePayloadSchema,
    createdAt: timestamp,
  })
  .strict();

export const sensaIntakeFastTrackResultSchema = z
  .object({
    route: z.literal("fast_track"),
    personalMeaningId: uuid,
  })
  .strict();

export const sensaIntakeInboxResultSchema = z
  .object({
    route: z.literal("inbox"),
    intakeId: uuid,
  })
  .strict();

export const sensaIntakeRejectedResultSchema = z
  .object({
    route: z.literal("rejected"),
    reason: nonEmpty,
  })
  .strict();

export const sensaIntakeResultSchema = z.discriminatedUnion("route", [
  sensaIntakeFastTrackResultSchema,
  sensaIntakeInboxResultSchema,
  sensaIntakeRejectedResultSchema,
]);

export type SensaIntakeModality = z.infer<typeof sensaIntakeModalitySchema>;
export type SensaIntakeWordingSource = z.infer<
  typeof sensaIntakeWordingSourceSchema
>;
export type SensaIntakeConfirmationStatus = z.infer<
  typeof sensaIntakeConfirmationStatusSchema
>;
export type SensaIntakeLanguageRole = z.infer<
  typeof sensaIntakeLanguageRoleSchema
>;
export type SensaIntakeItemStatus = z.infer<typeof sensaIntakeItemStatusSchema>;
export type SensaIntakeSourceMeta = z.infer<typeof sensaIntakeSourceMetaSchema>;
export type SensaIntakeContext = z.infer<typeof sensaIntakeContextSchema>;
export type SensaIntakeExpression = z.infer<typeof sensaIntakeExpressionSchema>;
export type SensaIntakeSenseCandidate = z.infer<
  typeof sensaIntakeSenseCandidateSchema
>;
export type SensaIntakeSense = z.infer<typeof sensaIntakeSenseSchema>;
export type SensaIntakePayload = z.infer<typeof sensaIntakePayloadSchema>;
export type SensaIntakeItem = z.infer<typeof sensaIntakeItemSchema>;
export type IngestResult = z.infer<typeof sensaIntakeResultSchema>;
