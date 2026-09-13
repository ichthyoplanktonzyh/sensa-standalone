import { z } from "zod";

import { sensaLanguageTagSchema } from "./language.js";
import type { SensaLanguageRole } from "./language.js";
import { sensaExpressionTypeSchema } from "./semanticRegistry.js";
import { sensaExpressionOccurrenceLocatorSchema } from "./personalSemanticWorld.js";

export const sensaIntakeContractVersion = "sensa-intake-v2" as const;

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);
const timestamp = z.string().datetime({ offset: true });

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

export const sensaIntakeSenseResolutionStatusSchema = z.enum([
  "resolved",
  "candidate_only",
]);

export const sensaIntakeAcceptanceRequestSchema = z.discriminatedUnion(
  "mode",
  [
    z.object({ mode: z.literal("learner_direct") }).strict(),
    z
      .object({
        mode: z.literal("delegated_agent"),
        actorId: nonEmpty,
        authorizationGrantId: uuid,
      })
      .strict(),
  ],
);

export const sensaIntakeItemStatusSchema = z.enum([
  "pending_sense",
  "pending_expression",
  "pending_acceptance",
  /** The material names a language that is neither this learner's target nor
   * their familiar language, so no expression anchor can be stamped with a
   * side. The item waits on the learner deciding what that language is to them,
   * which is a different question from the other three and must not be reported
   * as one of them. */
  "pending_language",
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

/**
 * The captured expression, and the language it is actually in.
 *
 * A tag rather than a side of the learner's boundary: only the library holds the
 * language profile, so a capture that named a side would be choosing one it
 * cannot see. `null` means nothing established a language, which routes the item
 * to `pending_language` rather than letting a default decide for the learner.
 */
export const sensaIntakeExpressionSchema = z
  .object({
    surfaceForm: nonEmpty,
    languageTag: sensaLanguageTagSchema.nullable(),
    occurrence: sensaExpressionOccurrenceLocatorSchema.nullable(),
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
    resolutionStatus: sensaIntakeSenseResolutionStatusSchema,
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
    acceptanceRequest: sensaIntakeAcceptanceRequestSchema.nullable(),
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
export type SensaIntakeSenseResolutionStatus = z.infer<
  typeof sensaIntakeSenseResolutionStatusSchema
>;
export type SensaIntakeAcceptanceRequest = z.infer<
  typeof sensaIntakeAcceptanceRequestSchema
>;
export type SensaIntakeLanguageRole = SensaLanguageRole;
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
