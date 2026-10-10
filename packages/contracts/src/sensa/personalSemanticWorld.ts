import { z } from "zod";
import {
  sensaExpressionTypeSchema,
  sensaSenseSemanticSpecSchema,
} from "./semanticRegistry.js";
import {sensaPinnedLanguageContextSchema} from './language.js';

export const sensaPersonalSemanticWorldContractVersion =
  "sensa-personal-semantic-world-v3" as const;

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();
const timestamp = z.string().datetime({ offset: true });
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const jsonObject = z.record(z.string(), z.unknown());

export const sensaPersonalRecordStatusSchema = z.enum(["active", "deleted"]);

const personalLifecycleShape = {
  lifecycleRevision: positiveInteger,
  status: sensaPersonalRecordStatusSchema,
  deletedAt: timestamp.nullable(),
  deletedByOperationId: uuid.nullable(),
};

const validatePersonalLifecycle = (
  value: {
    status: "active" | "deleted";
    deletedAt: string | null;
    deletedByOperationId: string | null;
  },
  context: z.RefinementCtx,
) => {
  const deleted = value.status === "deleted";
  if (deleted !== (value.deletedAt !== null) || deleted !== (value.deletedByOperationId !== null)) {
    context.addIssue({
      code: "custom",
      message: "personal lifecycle tombstone fields must agree with status",
    });
  }
};

export const sensaPersonalProvenanceKindSchema = z.enum([
  "learner_authored",
  "llm_suggested",
  "reviewed",
  "imported",
]);

export const sensaPersonalAnchorKindSchema = z.enum([
  "text",
  "image",
  "audio",
  "scene",
  "action",
  "feeling",
  "other",
]);

export const sensaExpressionVerificationStatusSchema = z.enum([
  "unverified",
  "learner_confirmed",
  "reviewed",
  "rejected",
]);

export const sensaSenseConstructionStatusSchema = z.enum([
  "active",
  "paused",
  "completed",
  "abandoned",
]);

export const sensaSenseProposalStatusSchema = z.enum([
  "open",
  "superseded",
  "confirmed",
  "rejected",
]);

export const sensaPersonalMeaningAlignmentStatusSchema = z.enum([
  "active",
  "withdrawn",
]);

export const sensaExpressionOccurrenceLocatorSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("text_span"),
        start: nonNegativeInteger,
        end: nonNegativeInteger,
      })
      .strict()
      .refine((value) => value.end > value.start, {
        message: "text span end must be greater than start",
      }),
    z
      .object({
        kind: z.literal("media_region"),
        mediaReferenceId: nonEmpty,
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1),
      })
      .strict()
      .refine((value) => value.x + value.width <= 1, {
        message: "media region exceeds horizontal bounds",
      })
      .refine((value) => value.y + value.height <= 1, {
        message: "media region exceeds vertical bounds",
      }),
    /** The exact target expression presented beside a learner-owned scene in
     * a formal learning surface. The referenced target and membership are the
     * occurrence location; the learner's scene text need not repeat the form. */
    z
      .object({
        kind: z.literal("learning_target"),
        learningTargetId: uuid,
        curriculumMembershipId: uuid,
      })
      .strict(),
    /** A learner-authored replacement expression beside a real Context in an
     * existing Personal Meaning. This cannot locate a new standalone capture. */
    z.object({
      kind: z.literal("personal_meaning"),
      personalMeaningId: uuid,
      personalSemanticAnchorRevisionIds: z.array(uuid).min(1),
    }).strict(),
  ],
);

export const sensaSemanticAcceptanceAuthoritySchema = z.discriminatedUnion(
  "mode",
  [
    z
      .object({
        mode: z.literal("learner_direct"),
        actorId: nonEmpty,
      })
      .strict(),
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
  ],
);

export const sensaSemanticResolutionProvenanceSchema = z
  .object({
    resolverKind: z.enum(["learner", "external_tool", "language_model"]),
    provider: nonEmpty,
    model: nonEmpty.nullable(),
    policyVersion: nonEmpty.nullable(),
    sourceReferenceIds: z.array(nonEmpty),
  })
  .strict();

export const sensaPersonalProvenanceSchema = z
  .object({
    kind: sensaPersonalProvenanceKindSchema,
    sourceReferenceIds: z.array(nonEmpty),
    createdByOperationId: uuid,
  })
  .strict();

export const sensaPersonalMeaningSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    personalMeaningId: uuid,
    learnerUserId: nonEmpty,
    currentRevision: positiveInteger,
    ...personalLifecycleShape,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .superRefine(validatePersonalLifecycle);

export const sensaPersonalMeaningRevisionSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    personalMeaningRevisionId: uuid,
    personalMeaningId: uuid,
    revision: positiveInteger,
    displayLabel: nonEmpty.nullable(),
    learnerIntentNote: nonEmpty.nullable(),
    provenance: sensaPersonalProvenanceSchema,
    createdAt: timestamp,
    /** Present only for an explicit move to/from the learner's recycle bin. */
    lifecycle: z.object({kind:z.enum(['delete','restore']),revision:positiveInteger.min(2)}).strict().optional(),
  })
  .strict();

export const sensaMeaningFocusSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    meaningFocusId: uuid,
    personalMeaningId: uuid,
    splitFromMeaningFocusId: uuid.nullable(),
    currentRevision: positiveInteger,
    acceptedRevision: positiveInteger.nullable(),
    ...personalLifecycleShape,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .superRefine(validatePersonalLifecycle);

export const sensaMeaningFocusRevisionSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    meaningFocusRevisionId: uuid,
    meaningFocusId: uuid,
    revision: positiveInteger,
    statement: nonEmpty,
    distinguishingNotes: z.array(nonEmpty),
    provenance: sensaPersonalProvenanceSchema,
    createdAt: timestamp,
  })
  .strict();

export const sensaMeaningFocusAcceptanceFactSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    meaningFocusAcceptanceId: uuid,
    meaningFocusId: uuid,
    meaningFocusRevisionId: uuid,
    operationId: uuid,
    acceptedAt: timestamp,
  })
  .strict();

export const sensaPersonalMediaObjectSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    personalMediaObjectId: uuid,
    learnerUserId: nonEmpty,
    mediaKind: z.enum(["image", "audio"]),
    mimeType: nonEmpty,
    sizeBytes: nonNegativeInteger,
    sha256: digest,
    ...personalLifecycleShape,
    createdAt: timestamp,
  })
  .strict()
  .superRefine(validatePersonalLifecycle);

export const sensaPersonalSemanticAnchorSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    personalSemanticAnchorId: uuid,
    personalMeaningId: uuid,
    currentRevision: positiveInteger,
    ...personalLifecycleShape,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .superRefine(validatePersonalLifecycle);

export const sensaPersonalSemanticAnchorRevisionSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    personalSemanticAnchorRevisionId: uuid,
    personalSemanticAnchorId: uuid,
    revision: positiveInteger,
    anchorKind: sensaPersonalAnchorKindSchema,
    languageTag: nonEmpty.nullable(),
    bodyText: nonEmpty.nullable(),
    personalMediaObjectId: uuid.nullable(),
    structuredPayload: jsonObject,
    provenance: sensaPersonalProvenanceSchema,
    createdAt: timestamp,
  })
  .strict();

export const sensaMeaningFocusSemanticAnchorLinkSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    focusAnchorLinkId: uuid,
    meaningFocusId: uuid,
    personalSemanticAnchorId: uuid,
    currentRevision: positiveInteger,
    ...personalLifecycleShape,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .superRefine(validatePersonalLifecycle);

export const sensaMeaningFocusSemanticAnchorLinkRevisionSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    focusAnchorLinkRevisionId: uuid,
    focusAnchorLinkId: uuid,
    revision: positiveInteger,
    focusNote: nonEmpty,
    provenance: sensaPersonalProvenanceSchema,
    createdAt: timestamp,
  })
  .strict();

export const sensaPersonalExpressionAnchorSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    personalExpressionAnchorId: uuid,
    personalMeaningId: uuid,
    currentRevision: positiveInteger,
    ...personalLifecycleShape,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .superRefine(validatePersonalLifecycle);

export const sensaPersonalExpressionAnchorRevisionSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    personalExpressionAnchorRevisionId: uuid,
    personalExpressionAnchorId: uuid,
    revision: positiveInteger,
    expressionType: sensaExpressionTypeSchema,
    languageTag: nonEmpty,
    surfaceForm: nonEmpty,
    normalizedForm: nonEmpty,
    contextAnchorRevisionId: uuid.nullable(),
    occurrence: sensaExpressionOccurrenceLocatorSchema.nullable(),
    provenanceKind: sensaPersonalProvenanceKindSchema,
    verificationStatus: sensaExpressionVerificationStatusSchema,
    provenance: sensaPersonalProvenanceSchema,
    createdAt: timestamp,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.contextAnchorRevisionId === null) !== (value.occurrence === null)) {
      context.addIssue({
        code: "custom",
        message: "context anchor revision and occurrence locator must be present together",
      });
    }
  });

export const sensaMeaningFocusExpressionAnchorLinkSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    focusExpressionAnchorLinkId: uuid,
    meaningFocusId: uuid,
    personalExpressionAnchorId: uuid,
    currentRevision: positiveInteger,
    ...personalLifecycleShape,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .superRefine(validatePersonalLifecycle);

export const sensaMeaningFocusExpressionAnchorLinkRevisionSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    focusExpressionAnchorLinkRevisionId: uuid,
    focusExpressionAnchorLinkId: uuid,
    revision: positiveInteger,
    focusNote: nonEmpty,
    provenance: sensaPersonalProvenanceSchema,
    createdAt: timestamp,
  })
  .strict();

export const sensaSenseConstructionSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    senseConstructionId: uuid,
    learnerUserId: nonEmpty,
    personalMeaningId: uuid,
    personalMeaningRevisionId: uuid,
    meaningFocusId: uuid.nullable(),
    meaningFocusRevisionId: uuid.nullable(),
    languageContext:sensaPinnedLanguageContextSchema,
    semanticPolicyVersion: nonEmpty,
    status: sensaSenseConstructionStatusSchema,
    revision: positiveInteger,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.meaningFocusId === null) !== (value.meaningFocusRevisionId === null)) {
      context.addIssue({
        code: "custom",
        message: "meaning focus and its revision must be present together",
      });
    }
  });

export const sensaSenseConstructionTurnSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    constructionTurnId: uuid,
    senseConstructionId: uuid,
    ordinal: positiveInteger,
    actor: z.enum(["learner", "semantic_llm", "system"]),
    body: nonEmpty,
    inputDigest: digest.nullable(),
    outputDigest: digest,
    modelProvenance: z
      .object({
        provider: nonEmpty,
        model: nonEmpty,
        promptVersion: nonEmpty,
      })
      .strict()
      .nullable(),
    occurredAt: timestamp,
  })
  .strict();

export const sensaSenseProposalSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    senseProposalId: uuid,
    senseConstructionId: uuid,
    currentVersion: positiveInteger,
    status: sensaSenseProposalStatusSchema,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

export const sensaSenseProposalVersionSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    senseProposalVersionId: uuid,
    senseProposalId: uuid,
    version: positiveInteger,
    meaningFocusRevisionId: uuid.nullable(),
    semanticSpec: sensaSenseSemanticSpecSchema,
    expressionCandidates: z.array(
      z
        .object({
          candidateId: uuid,
          personalExpressionAnchorRevisionId: uuid.nullable(),
          expressionType: sensaExpressionTypeSchema,
          languageTag: nonEmpty,
          surfaceForm: nonEmpty,
          rationale: nonEmpty,
        })
        .strict(),
    ),
    unresolvedQuestions: z.array(nonEmpty),
    semanticPolicyVersion: nonEmpty,
    generatorProvenance: z
      .object({
        provider: nonEmpty,
        model: nonEmpty,
        promptVersion: nonEmpty,
        inputDigest: digest,
        outputDigest: digest,
      })
      .strict(),
    createdAt: timestamp,
  })
  .strict();

export const sensaConfirmSenseProposalFactSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    senseProposalConfirmationId: uuid,
    operationId: uuid,
    learnerUserId: nonEmpty,
    senseProposalVersionId: uuid,
    meaningFocusRevisionId: uuid.nullable(),
    resolution: z.enum(["create_new", "reuse_existing"]),
    senseId: uuid,
    senseVersionId: uuid,
    confirmedAt: timestamp,
  })
  .strict();

export const sensaConfirmExpressionBindingFactSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    expressionBindingConfirmationId: uuid,
    operationId: uuid,
    learnerUserId: nonEmpty,
    senseProposalVersionId: uuid.nullable(),
    personalExpressionAnchorRevisionId: uuid,
    senseVersionId: uuid,
    expressionVersionId: uuid,
    bindingVersionId: uuid,
    confirmedAt: timestamp,
  })
  .strict();

export const sensaSemanticAcceptanceFactSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    semanticAcceptanceId: uuid,
    operationId: uuid,
    learnerUserId: nonEmpty,
    authority: sensaSemanticAcceptanceAuthoritySchema,
    personalSemanticAnchorRevisionId: uuid,
    personalExpressionAnchorRevisionId: uuid,
    expressionOccurrence: sensaExpressionOccurrenceLocatorSchema,
    resolution: z.enum(["create_new", "reuse_existing"]),
    senseId: uuid,
    senseVersionId: uuid,
    resolutionProvenance: sensaSemanticResolutionProvenanceSchema,
    acceptedAt: timestamp,
  })
  .strict();

export const sensaPersonalMeaningAlignmentBasisSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("sense_construction"),
        meaningFocusId: uuid.nullable(),
        meaningFocusRevisionId: uuid.nullable(),
        senseProposalConfirmationId: uuid,
      })
      .strict(),
    z
      .object({
        kind: z.literal("contextual_resolution"),
        semanticAcceptanceId: uuid,
      })
      .strict(),
  ]).superRefine((value, context) => {
    if (
      value.kind === "sense_construction"
      && ((value.meaningFocusId === null) !== (value.meaningFocusRevisionId === null))
    ) {
      context.addIssue({
        code: "custom",
        message: "meaning focus and its revision must be present together",
      });
    }
  });

export const sensaPersonalMeaningAlignmentSnapshotSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    personalMeaningAlignmentId: uuid,
    learnerUserId: nonEmpty,
    personalMeaningId: uuid,
    personalMeaningRevisionId: uuid,
    basis: sensaPersonalMeaningAlignmentBasisSchema,
    senseId: uuid,
    senseVersionId: uuid,
    status: sensaPersonalMeaningAlignmentStatusSchema,
    revision: positiveInteger,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

export const sensaPersonalMeaningAlignmentEventSchema = z
  .object({
    contractVersion: z.literal(sensaPersonalSemanticWorldContractVersion),
    personalMeaningAlignmentEventId: uuid,
    personalMeaningAlignmentId: uuid,
    ordinal: positiveInteger,
    eventType: z.enum(["confirmed", "withdrawn", "restored"]),
    operationId: uuid,
    reason: nonEmpty.nullable(),
    occurredAt: timestamp,
  })
  .strict();

export type SensaPersonalMeaningSnapshot = z.infer<
  typeof sensaPersonalMeaningSnapshotSchema
>;
export type SensaPersonalMeaningRevisionSnapshot = z.infer<
  typeof sensaPersonalMeaningRevisionSnapshotSchema
>;
export type SensaMeaningFocusSnapshot = z.infer<
  typeof sensaMeaningFocusSnapshotSchema
>;
export type SensaMeaningFocusRevisionSnapshot = z.infer<
  typeof sensaMeaningFocusRevisionSnapshotSchema
>;
export type SensaMeaningFocusAcceptanceFact = z.infer<
  typeof sensaMeaningFocusAcceptanceFactSchema
>;
export type SensaPersonalMediaObjectSnapshot = z.infer<
  typeof sensaPersonalMediaObjectSnapshotSchema
>;
export type SensaPersonalSemanticAnchorSnapshot = z.infer<
  typeof sensaPersonalSemanticAnchorSnapshotSchema
>;
export type SensaPersonalSemanticAnchorRevisionSnapshot = z.infer<
  typeof sensaPersonalSemanticAnchorRevisionSnapshotSchema
>;
export type SensaMeaningFocusSemanticAnchorLinkSnapshot = z.infer<
  typeof sensaMeaningFocusSemanticAnchorLinkSnapshotSchema
>;
export type SensaMeaningFocusSemanticAnchorLinkRevisionSnapshot = z.infer<
  typeof sensaMeaningFocusSemanticAnchorLinkRevisionSnapshotSchema
>;
export type SensaPersonalExpressionAnchorSnapshot = z.infer<
  typeof sensaPersonalExpressionAnchorSnapshotSchema
>;
export type SensaPersonalExpressionAnchorRevisionSnapshot = z.infer<
  typeof sensaPersonalExpressionAnchorRevisionSnapshotSchema
>;
export type SensaMeaningFocusExpressionAnchorLinkSnapshot = z.infer<
  typeof sensaMeaningFocusExpressionAnchorLinkSnapshotSchema
>;
export type SensaMeaningFocusExpressionAnchorLinkRevisionSnapshot = z.infer<
  typeof sensaMeaningFocusExpressionAnchorLinkRevisionSnapshotSchema
>;
export type SensaSenseConstructionSnapshot = z.infer<
  typeof sensaSenseConstructionSnapshotSchema
>;
export type SensaSenseConstructionTurn = z.infer<
  typeof sensaSenseConstructionTurnSchema
>;
export type SensaSenseProposalSnapshot = z.infer<
  typeof sensaSenseProposalSnapshotSchema
>;
export type SensaSenseProposalVersionSnapshot = z.infer<
  typeof sensaSenseProposalVersionSnapshotSchema
>;
export type SensaConfirmSenseProposalFact = z.infer<
  typeof sensaConfirmSenseProposalFactSchema
>;
export type SensaConfirmExpressionBindingFact = z.infer<
  typeof sensaConfirmExpressionBindingFactSchema
>;
export type SensaPersonalMeaningAlignmentSnapshot = z.infer<
  typeof sensaPersonalMeaningAlignmentSnapshotSchema
>;
export type SensaExpressionOccurrenceLocator = z.infer<
  typeof sensaExpressionOccurrenceLocatorSchema
>;
export type SensaSemanticAcceptanceAuthority = z.infer<
  typeof sensaSemanticAcceptanceAuthoritySchema
>;
export type SensaSemanticResolutionProvenance = z.infer<
  typeof sensaSemanticResolutionProvenanceSchema
>;
export type SensaSemanticAcceptanceFact = z.infer<
  typeof sensaSemanticAcceptanceFactSchema
>;
export type SensaPersonalMeaningAlignmentBasis = z.infer<
  typeof sensaPersonalMeaningAlignmentBasisSchema
>;
export type SensaPersonalMeaningAlignmentEvent = z.infer<
  typeof sensaPersonalMeaningAlignmentEventSchema
>;
