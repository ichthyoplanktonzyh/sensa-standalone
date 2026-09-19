import { z } from "zod";

import { sensaLanguageTagSchema } from "./language.js";
import {
  sensaExpressionTypeSchema,
  sensaSenseSemanticSpecSchema,
} from "./semanticRegistry.js";
import { sensaExpressionOccurrenceLocatorSchema } from "./personalSemanticWorld.js";
import { sensaSemanticResolutionProvenanceSchema } from "./personalSemanticWorld.js";

/**
 * The port-neutral contract spoken by first-party surfaces, local agent
 * adapters and the remote delivery service. Transport adapters add their own
 * destination and authenticated caller; neither belongs to the semantic
 * payload.
 */
export const sensaIntakeContractVersion = "sensa-intake-v3" as const;

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
  "reviewed",
  "imported",
]);

/**
 * Acceptance describes the learner's semantic decision, not transport access.
 * A connected Agent may record the explicit request made in its conversation;
 * the receiving library does not ask the learner to confirm the same item a
 * second time. Standing automation can carry an external authorization
 * reference, but one-shot user-confirmed Agent work does not need a grant id.
 */
export const sensaIntakeAcceptanceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("learner_direct") }).strict(),
  z
    .object({
      mode: z.literal("delegated_agent"),
      actorId: nonEmpty,
      basis: z.enum(["explicit_user_request", "standing_authorization"]),
      authorizationReference: nonEmpty.nullable(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.basis === "standing_authorization" && value.authorizationReference === null) {
        context.addIssue({
          code: "custom",
          message: "standing authorization requires a reference",
          path: ["authorizationReference"],
        });
      }
    }),
]);

/** Slow-track status names only the next missing domain fact. */
export const sensaIntakeItemStatusSchema = z.enum([
  "pending_context",
  "pending_expression",
  "pending_sense",
  "pending_acceptance",
]);

export const sensaIntakeSourceMetaSchema = z
  .object({
    /** Human-readable caller/surface, for example `codex` or `browser-extension`. */
    client: nonEmpty,
    url: z.string().url().max(4096).nullable(),
    title: z.string().trim().min(1).max(1000).nullable(),
    /** Optional opaque id in the source system; never an authorization token. */
    sourceReferenceId: z.string().trim().min(1).max(1000).nullable(),
    domSelector: z.string().trim().min(1).max(2000).nullable(),
    paragraphContext: z.string().trim().min(1).max(12000).nullable(),
  })
  .strict();

/**
 * `null` means the caller does not currently have a Context and therefore asks
 * for the slow track. A non-null Context has concrete text or media, but the
 * receiver deliberately does not judge whether that material is semantically
 * sufficient; that judgement belongs to the producing person or model.
 */
export const sensaIntakeContextSchema = z
  .object({
    modality: sensaIntakeModalitySchema,
    textSegment: z.string().trim().min(1).max(12000).nullable(),
    mediaReferenceIds: z.array(nonEmpty).max(20),
    languageTag: sensaLanguageTagSchema.nullable(),
    source: sensaIntakeSourceMetaSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.textSegment === null && value.mediaReferenceIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "a present context requires text or media",
      });
    }
  });

/**
 * The remembered form and the observed occurrence are intentionally distinct:
 * `back out` may be the expression the learner keeps while `backed out` is the
 * exact surface in the captured Context.
 */
export const sensaIntakeExpressionOccurrenceSchema = z
  .object({
    surfaceForm: nonEmpty.max(2000),
    locator: sensaExpressionOccurrenceLocatorSchema,
  })
  .strict();

export const sensaIntakeExpressionSchema = z
  .object({
    surfaceForm: nonEmpty.max(2000),
    languageTag: sensaLanguageTagSchema.nullable(),
    occurrence: sensaIntakeExpressionOccurrenceSchema.nullable(),
    expressionTypeHint: sensaExpressionTypeSchema.nullable(),
  })
  .strict();

/**
 * A non-null Sense is a resolved, teaching-sufficient Sense asserted by the
 * producer. The receiver validates its data shape but does not score, re-run or
 * second-guess its semantic quality.
 */
export const sensaIntakeSenseSchema = z
  .object({
    senseKey: nonEmpty.max(500).nullable(),
    semanticSpec: sensaSenseSemanticSpecSchema,
    wordingSource: sensaIntakeWordingSourceSchema,
    /** Who resolved the Sense. This is independent from both Context source
     * and the direct/delegated authority that accepts the final tuple. */
    resolutionProvenance: sensaSemanticResolutionProvenanceSchema,
  })
  .strict();

const validateOccurrence = (
  value: {
    context: z.infer<typeof sensaIntakeContextSchema> | null;
    expression: z.infer<typeof sensaIntakeExpressionSchema> | null;
  },
  context: z.RefinementCtx,
) => {
  const occurrence = value.expression?.occurrence;
  if (!occurrence) return;
  if (!value.context) {
    context.addIssue({
      code: "custom",
      message: "an expression occurrence requires a context",
      path: ["expression", "occurrence"],
    });
    return;
  }
  const locator = occurrence.locator;
  if (locator.kind === "media_region") {
    if (!value.context.mediaReferenceIds.includes(locator.mediaReferenceId)) {
      context.addIssue({
        code: "custom",
        message: "the expression occurrence references absent media",
        path: ["expression", "occurrence", "locator"],
      });
    }
    return;
  }
  if (locator.kind === "learning_target") return;
  const text = value.context.textSegment;
  if (!text || locator.end > text.length
    || text.slice(locator.start, locator.end) !== occurrence.surfaceForm) {
    context.addIssue({
      code: "custom",
      message: "the expression occurrence does not match the context",
      path: ["expression", "occurrence", "locator"],
    });
  }
};

const sensaIntakeFactsShape = {
  contractVersion: z.literal(sensaIntakeContractVersion),
  operationId: uuid,
  capturedAt: timestamp,
  context: sensaIntakeContextSchema.nullable(),
  expression: sensaIntakeExpressionSchema.nullable(),
  sense: sensaIntakeSenseSchema.nullable(),
};

/** Context–Expression–Sense facts before a trusted surface records acceptance. */
export const sensaIntakeFactsSchema = z
  .object(sensaIntakeFactsShape)
  .strict()
  .superRefine(validateOccurrence);

export const sensaIntakePayloadSchema = z
  .object({
    ...sensaIntakeFactsShape,
    acceptance: sensaIntakeAcceptanceSchema.nullable(),
  })
  .strict()
  .superRefine(validateOccurrence);

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
  .object({ route: z.literal("fast_track"), personalMeaningId: uuid })
  .strict();

export const sensaIntakeInboxResultSchema = z
  .object({
    route: z.literal("inbox"),
    intakeId: uuid,
    status: sensaIntakeItemStatusSchema,
  })
  .strict();

/** Semantic routing has no rejection branch; malformed transport is an error. */
export const sensaIntakeResultSchema = z.discriminatedUnion("route", [
  sensaIntakeFastTrackResultSchema,
  sensaIntakeInboxResultSchema,
]);

export type SensaIntakeModality = z.infer<typeof sensaIntakeModalitySchema>;
export type SensaIntakeWordingSource = z.infer<typeof sensaIntakeWordingSourceSchema>;
export type SensaIntakeAcceptance = z.infer<typeof sensaIntakeAcceptanceSchema>;
export type SensaIntakeItemStatus = z.infer<typeof sensaIntakeItemStatusSchema>;
export type SensaIntakeSourceMeta = z.infer<typeof sensaIntakeSourceMetaSchema>;
export type SensaIntakeContext = z.infer<typeof sensaIntakeContextSchema>;
export type SensaIntakeExpressionOccurrence = z.infer<typeof sensaIntakeExpressionOccurrenceSchema>;
export type SensaIntakeExpression = z.infer<typeof sensaIntakeExpressionSchema>;
export type SensaIntakeSense = z.infer<typeof sensaIntakeSenseSchema>;
export type SensaIntakePayload = z.infer<typeof sensaIntakePayloadSchema>;
export type SensaIntakeItem = z.infer<typeof sensaIntakeItemSchema>;
export type IngestResult = z.infer<typeof sensaIntakeResultSchema>;
