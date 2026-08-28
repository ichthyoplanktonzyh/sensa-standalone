import { z } from "zod";
import {
  canonicalLearningResponsePayloadSchema,
  learningActionSchema,
  learningResponsePayloadSchema,
  mapMemoryOutcomeToFsrsRating,
  memoryOutcomeDecisionMatchesKind,
} from "@sensa/learning-kernel";
import { sensaSyncErrorCodes } from "./sync.js";

const id = z.string().min(1);
const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const cursor = z.string();
const jsonObject = z.record(z.string(), z.unknown());
const assetCapability = z.enum([
  "meaning_grounding",
  "l1_mediation",
  "usage_pattern",
  "contextual_variation",
  "pronunciation",
  "study_example_audio",
  "boundary_contrast",
  "counterexample",
  "visual_grounding",
  "spatial_grounding",
  "causal_grounding",
  "temporal_grounding",
  "extended_audio",
]);
const acquisitionPrimitive = z.enum([
  "visual_grounding",
  "motion_grounding",
  "spatial_relation",
  "causal_sequence",
  "temporal_sequence",
  "social_micro_scenario",
  "introspective_scenario",
  "contrast_pair",
  "counterexample",
  "contextual_variation",
  "production_cue",
]);
const acquisitionNeed = z.enum([
  "perceptual_grounding",
  "boundary_formation",
  "abstraction_invariant",
  "spatial_aspectual_tuning",
  "social_normative_calibration",
  "form_binding",
]);
const exampleConstruction = z.enum([
  "head_verb",
  "nonfinite_verb",
  "passive",
  "subject",
  "object",
  "prep_object",
  "predicative",
  "modifier",
  "adverbial",
]);
const exampleSceneDomain = z.enum([
  "daily_life",
  "work_business",
  "study_school",
  "social_relations",
  "media_news",
  "travel_transport",
  "health_body",
  "tech_digital",
  "nature_environment",
  "arts_leisure",
]);
const reviewRating = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const sensaApiIdentitySchema = z
  .object({
    name: z.literal("sensa-standalone"),
    version: z.string().min(1),
    contractVersion: z.literal("sensa-api-v1"),
    learningModel: z.literal("sense-first-semantic-learning-loop"),
  })
  .strict();

export const sensaApiMeSchema = z
  .object({
    userId: id,
    learnerUserId: id,
    subjectUserId: id,
    selectedWorkspaceId: uuid.nullable(),
    email: z.string().email().nullable(),
    locale: z.string().min(1),
    transport: z.enum(["local", "cognito"]),
    authTransport: z.literal("bearer"),
    csrfToken: z.string().nullable(),
    profile: z.object({ email: z.string().email().nullable(), locale: z.string().min(1), createdAt: timestamp }).strict(),
    preferences: z.object({ reviewReactionAnimationsEnabled: z.boolean() }).strict(),
  })
  .strict();

export const sensaScopeSchema = z
  .object({ workspaceId: id, learnerUserId: id, replicaId: uuid })
  .strict();

export const sensaErrorShapeSchema = z
  .object({
    error: z.string().optional(),
    code: z.string().optional(),
    requestId: id.optional(),
    details: z.object({
      validationIssues: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() }).strict()).optional(),
      retryAfterSeconds: z.number().int().nonnegative().optional(),
    }).strict().nullable().optional(),
  })
  .strict();

const provenance = z
  .object({
    sourceEvidenceRefs: z.array(id).min(1),
    generatorProvider: z.string().nullable(),
    generatorModel: z.string().nullable(),
    promptVersion: z.string().nullable(),
    sourceLicense: z.string().nullable(),
    sourceAttribution: z.string().nullable(),
  })
  .strict();
const senseAssetBase = z
  .object({
    learningAssetId: id,
    contentReleaseId: id,
    senseVersionId: id,
    learnerLocale: z.string().min(1),
    contentDigest: digest,
    reviewStatus: z.literal("approved"),
    provenance,
  })
  .strict();
const lexemeAssetBase = z
  .object({
    learningAssetId: id,
    contentReleaseId: id,
    lexemeVersionId: id,
    learnerLocale: z.string().nullable(),
    contentDigest: digest,
    reviewStatus: z.literal("approved"),
    provenance,
  })
  .strict();

export const sensaMediaReferenceSchema = z
  .object({ mediaBlobId: id, sha256: digest, mimeType: z.string().min(1), sizeBytes: z.number().int().nonnegative() })
  .strict();

export const sensaPublicLearningAssetSchema = z.discriminatedUnion("kind", [
  senseAssetBase.extend({ kind: z.literal("experience_sketch"), body: z.string().min(1) }),
  senseAssetBase.extend({ kind: z.literal("l1_bridge"), body: z.string().min(1) }),
  senseAssetBase.extend({ kind: z.literal("boundary_note"), body: z.string().min(1), senseRelationId: id }),
  senseAssetBase.extend({
    kind: z.literal("example"),
    ordinal: z.number().int().positive(),
    textL2: z.string().min(1),
    textL1: z.string().min(1),
    targetForm: z.string().min(1),
    targetStart: z.number().int().nonnegative(),
    targetEnd: z.number().int().positive(),
    construction: exampleConstruction,
    sceneDomain: exampleSceneDomain,
    disambiguatingCue: z.string().min(1).nullable(),
    collocations: z.array(z.string()),
    variationNote: z.string().min(1).nullable(),
    role: z.enum(["study", "quiz"]),
    contextL2: z.string().nullable(),
    contextL1: z.string().nullable(),
  }),
  senseAssetBase.extend({
    kind: z.enum(["contrast_pair", "counterexample"]),
    senseRelationId: id,
    positiveTextL2: z.string().min(1),
    positiveTextL1: z.string().min(1),
    negativeTextL2: z.string().min(1),
    negativeTextL1: z.string().min(1),
    distinguishingFeature: z.string().min(1),
  }),
  senseAssetBase.extend({
    kind: z.literal("visual_grounding"),
    media: sensaMediaReferenceSchema,
    altText: z.string().min(1),
    distinguishingFeature: z.string().min(1),
  }),
  senseAssetBase.extend({
    kind: z.literal("spatial_diagram"),
    figureLabel: z.string(),
    groundLabel: z.string(),
    pathDescription: z.string(),
    topology: z.string(),
    textFallback: z.string(),
    startDescription: z.string().nullable(),
    endpointDescription: z.string().nullable(),
    contrastRelationId: id.nullable(),
  }),
  senseAssetBase.extend({
    kind: z.enum(["causal_sequence", "temporal_sequence"]),
    textFallback: z.string(),
    steps: z.array(z.object({ ordinal: z.number().int().positive(), label: z.string(), description: z.string() }).strict()).min(2),
  }),
  lexemeAssetBase.extend({
    kind: z.literal("pronunciation_audio"),
    senseVersionId: z.null(),
    media: sensaMediaReferenceSchema,
    sourceExampleAssetId: z.null(),
    accentLocale: z.string().nullable(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    voice: z.string().nullable(),
    sourceTextDigest: digest,
    durationMs: z.number().int().positive(),
  }),
  senseAssetBase.extend({
    kind: z.enum(["study_example_audio", "extended_audio"]),
    media: sensaMediaReferenceSchema,
    sourceExampleAssetId: id.nullable(),
    accentLocale: z.string(),
    provider: z.string(),
    model: z.string(),
    voice: z.string(),
    sourceTextDigest: digest,
    durationMs: z.number().int().positive(),
  }),
]);

const contentReleaseReference = z
  .object({
    contentReleaseId: id,
    releaseKey: z.string().min(1),
    versionNumber: z.number().int().positive(),
    targetLanguage: z.string().min(1),
    learnerLocale: z.string().min(1),
    schemaVersion: z.string().min(1),
    sourceDigest: digest,
    validatorVersion: z.string().min(1),
    status: z.enum(["published", "superseded"]),
  })
  .strict();

const pinnedBookSummary = z
  .object({
    bookId: id,
    bookKey: id,
    bookVersionId: id,
    versionNumber: z.number().int().positive(),
    contentRelease: contentReleaseReference,
    targetLanguage: z.string().min(1),
    learnerLocale: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    manifestDigest: digest,
    senseCount: z.number().int().nonnegative(),
    lexemeCount: z.number().int().nonnegative(),
    status: z.enum(["published", "retired"]),
    publishedAt: timestamp,
  })
  .strict();
const manifestMember = z
  .object({
    ordinal: z.number().int().positive(),
    senseVersionId: id,
    senseId: id,
    senseKey: id,
    lexemeVersionId: id,
    lexemeId: id,
    lemma: z.string().min(1),
    partOfSpeech: z.string().min(1),
    guideLabelL1: z.string().min(1),
    teachingPriority: z.enum(["core", "extended", "recognition"]),
    packageDigest: digest,
  })
  .strict();

const lexeme = z
  .object({ lexemeVersionId: id, lexemeId: id, languageTag: z.string(), lemma: z.string().min(1), forms: z.array(z.string().min(1)).min(1), ipaUs: z.string().min(1).nullable(), ipaUk: z.string().min(1).nullable(), syllables: z.string().min(1).nullable() })
  .strict();
const sense = z
  .object({ senseVersionId: id, senseId: id, senseKey: id, senseRank: z.number().int().nonnegative(), partOfSpeech: z.string(), guideLabelL1: z.string().min(1), definitionL2: z.string().min(1), teachingPriority: z.enum(["core", "extended", "recognition"]), reviewStatus: z.literal("approved") })
  .strict();
const senseRelation = z.object({
  contentReleaseId: id,
  senseRelationId: id,
  sourceSenseId: id,
  targetSenseId: id,
  sourceLexemeId: id,
  targetLexemeId: id,
  relationType: z.string().min(1),
  scope: z.enum(["intra_word", "cross_word"]),
  distinguishingFeature: z.string().min(1),
  sourceEvidenceRefs: z.array(id).min(1),
  reviewStatus: z.literal("approved"),
}).strict();
const usagePatternSlot = z.object({
  ordinal: z.number().int().positive(),
  slotName: z.string().min(1),
  semanticRole: z.string().min(1),
  valueDescription: z.string().min(1),
  isOptional: z.boolean(),
}).strict();
const usagePattern = z.object({
  contentReleaseId: id,
  usagePatternId: id,
  senseVersionId: id,
  ordinal: z.number().int().positive(),
  canonicalPattern: z.string().min(1),
  commonCollocations: z.array(z.string()),
  registerLabel: z.string().nullable(),
  domainLabel: z.string().nullable(),
  usageRestriction: z.string().nullable(),
  sourceEvidenceRefs: z.array(id).min(1),
  slots: z.array(usagePatternSlot),
  reviewStatus: z.literal("approved"),
}).strict();
const acquisitionProfile = z.object({
  contentReleaseId: id,
  acquisitionProfileId: id,
  senseVersionId: id,
  learnerLocale: z.string().min(1),
  schemaVersion: z.string().min(1),
  acquisitionNeeds: z.array(acquisitionNeed).min(1),
  minimumSufficientExperience: z.string().min(1),
  distinguishingFeatures: z.array(z.string().min(1)).min(1),
  preferredPrimitives: z.array(acquisitionPrimitive).min(1),
  requiredAssetCapabilities: z.array(assetCapability),
  optionalAssetCapabilities: z.array(assetCapability),
  fallbackPrimitives: z.array(acquisitionPrimitive),
  domainBound: z.boolean(),
  domainConstraints: z.array(z.string()),
  boundaryTargets: z.array(z.object({ senseRelationId: id, ordinal: z.number().int().positive(), isRequired: z.boolean() }).strict()),
  sourceDigest: digest,
  profileProvenance: z.object({ generatorProvider: z.string().nullable(), generatorModel: z.string().nullable(), promptVersion: z.string().nullable() }).strict(),
  reviewStatus: z.literal("approved"),
}).strict();
const manifestRequirement = z.object({
  manifestRequirementId: id,
  requirementKey: z.string().min(1),
  capability: assetCapability,
  requiredCount: z.number().int().positive(),
  satisfiedCount: z.number().int().nonnegative(),
  matchedResourceIds: z.array(id).min(1),
  status: z.literal("satisfied"),
}).strict();
const requiredAssetManifest = z.object({
  requiredAssetManifestId: id,
  contentReleaseId: id,
  senseVersionId: id,
  acquisitionProfileId: id,
  validatorVersion: z.string().min(1),
  capabilityResolverVersion: z.literal("sensa-executable-learning-capability-resolver-v1"),
  status: z.literal("satisfied"),
  packageDigest: digest,
  validatedAt: timestamp,
  requirements: z.array(manifestRequirement).min(1),
}).strict();

export const sensaPinnedPackageSchema = z
  .object({
    packageDigest: digest,
    contentRelease: contentReleaseReference,
    lexeme,
    sense,
    relations: z.array(senseRelation),
    usagePatterns: z.array(usagePattern),
    acquisitionProfile,
    learningAssets: z.array(sensaPublicLearningAssetSchema).min(1),
    requiredAssetManifest,
  })
  .strict();

export const sensaPinnedContentPageSchema = z
  .object({
    studyPlanId: id,
    bookVersionId: id,
    contentReleaseId: id,
    manifestDigest: digest,
    targetLanguage: z.string().min(1),
    learnerLocale: z.string().min(1),
    book: pinnedBookSummary,
    contentRelease: contentReleaseReference,
    items: z.array(z.object({ ordinal: z.number().int().positive(), package: sensaPinnedPackageSchema }).strict()),
    nextCursor: cursor.nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const sensaPinnedContentManifestSchema = sensaPinnedContentPageSchema
  .omit({ items: true, nextCursor: true, hasMore: true })
  .extend({ members: z.array(manifestMember) })
  .strict();

export const sensaPinnedContentItemSchema = sensaPinnedContentPageSchema
  .omit({ items: true, nextCursor: true, hasMore: true })
  .extend({ item: z.object({ ordinal: z.number().int().positive(), package: sensaPinnedPackageSchema }).strict() })
  .strict();

const publicContentReleaseReference = contentReleaseReference.extend({ status: z.literal("published") }).strict();
const publicBookSummary = z.object({
  bookId: id,
  bookKey: id,
  bookVersionId: id,
  versionNumber: z.number().int().positive(),
  contentRelease: publicContentReleaseReference,
  targetLanguage: z.string().min(1),
  learnerLocale: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  manifestDigest: digest,
  senseCount: z.number().int().nonnegative(),
  lexemeCount: z.number().int().nonnegative(),
  status: z.literal("published"),
  publishedAt: timestamp,
}).strict();
const publicPackage = sensaPinnedPackageSchema.extend({ contentRelease: publicContentReleaseReference }).strict();
const publicContentItem = z.object({ ordinal: z.number().int().positive(), package: publicPackage }).strict();
export const sensaPublicBookListPageSchema = z.object({ books: z.array(publicBookSummary), nextCursor: cursor.nullable(), hasMore: z.boolean() }).strict();
export const sensaPublicBookManifestSchema = z.object({ book: publicBookSummary, contentRelease: publicContentReleaseReference, members: z.array(manifestMember), manifestDigest: digest }).strict();
export const sensaPublicContentReleasePageSchema = z.object({ book: publicBookSummary, contentRelease: publicContentReleaseReference, items: z.array(publicContentItem), nextCursor: cursor.nullable(), hasMore: z.boolean() }).strict();

const studyPlan = z.object({
  studyPlanId: id,
  workspaceId: id,
  learnerUserId: id,
  bookVersionId: id,
  status: z.enum(["active", "paused", "completed", "archived"]),
  dailyNewSenseTarget: z.number().int().positive(),
  revision: z.number().int().positive(),
  createdByReplicaId: id,
  createdAt: timestamp,
  updatedAt: timestamp,
  activatedAt: timestamp,
  pausedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  archivedAt: timestamp.nullable(),
}).strict();
const learningSession = z.object({
  learningSessionId: id,
  workspaceId: id,
  learnerUserId: id,
  studyPlanId: id,
  createdByReplicaId: id,
  status: z.enum(["active", "completed", "abandoned"]),
  revision: z.number().int().positive(),
  startedAt: timestamp,
  endedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();
const kernelVersions = z.object({
  capabilityResolverVersion: z.literal("sensa-executable-learning-capability-resolver-v1"),
  semanticPolicyVersion: z.string().min(1),
  stopPolicyVersion: z.literal("sensa-stop-policy-v2"),
  evidenceRuleVersion: z.string().min(1),
  stateUpdaterVersion: z.string().min(1),
  outcomeMappingVersion: z.literal("sensa-memory-outcome-v3"),
}).strict();
const encounter = z.object({
  senseEncounterId: id,
  workspaceId: id,
  learnerUserId: id,
  learningSessionId: id,
  studyPlanId: id,
  senseId: id,
  senseVersionId: id,
  contentReleaseId: id,
  bookVersionId: id,
  sessionOrdinal: z.number().int().positive(),
  kind: z.enum(["introduction", "review"]),
  status: z.enum(["planned", "active", "completed", "interrupted", "cancelled"]),
  revision: z.number().int().positive(),
  stopPolicyDecisionCode: z.enum([
    "introduction_grounding_accepted",
    "retrieval_failure_limit_reached",
    "retrieval_succeeded",
  ]).nullable(),
  kernelVersions,
  semanticStateRevisionAtOpen: z.number().int().nonnegative(),
  memoryStateRevisionAtOpen: z.number().int().nonnegative(),
  plannedAt: timestamp,
  plannedLocalDate: z.string(),
  planningTimeZone: z.string(),
  planningTimeZoneSource: z.enum(["client", "user_settings", "utc_fallback"]),
  openedAt: timestamp.nullable(),
  closedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict().superRefine((value, context) => {
  const completed = value.status === "completed";
  if (completed !== (value.stopPolicyDecisionCode !== null)) {
    context.addIssue({
      code: "custom",
      message: "Only a completed Encounter carries a Stop Policy completion reason.",
      path: ["stopPolicyDecisionCode"],
    });
  }
});

const semanticDimension = z.object({
  level: z.enum(["unknown", "emerging", "stable"]),
  positiveCount: z.number().int().nonnegative(),
  failureStreak: z.number().int().nonnegative(),
}).strict();
const semanticState = z.object({
  learnerSemanticStateId: id,
  workspaceId: id,
  learnerUserId: id,
  senseId: id,
  grounding: semanticDimension,
  boundary: semanticDimension,
  formMapping: semanticDimension,
  retrieval: semanticDimension,
  transfer: semanticDimension,
  projectionVersion: z.string().min(1),
  revision: z.number().int().positive(),
  stateDigest: digest,
  projectedThroughEvidenceId: id.nullable(),
  updatedAt: timestamp,
}).strict();
const memoryState = z.object({
  senseMemoryStateId: id,
  workspaceId: id,
  learnerUserId: id,
  senseId: id,
  dueAt: timestamp.nullable(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  fsrsCardState: z.enum(["new", "learning", "review", "relearning"]),
  fsrsStepIndex: z.number().int().nonnegative().nullable(),
  fsrsStability: z.number().nonnegative().nullable(),
  fsrsDifficulty: z.number().nonnegative().nullable(),
  fsrsLastReviewedAt: timestamp.nullable(),
  fsrsScheduledDays: z.number().nonnegative().nullable(),
  revision: z.number().int().positive(),
  lastMemoryOutcomeId: id,
  updatedAt: timestamp,
}).strict();

const plannedEncounter = z.object({
  encounterId: id,
  learningSessionId: id,
  studyPlanId: id,
  senseId: id,
  senseVersionId: id,
  contentReleaseId: id,
  bookVersionId: id,
  sessionOrdinal: z.number().int().positive(),
  kind: z.enum(["introduction", "review"]),
  status: z.enum(["planned", "active"]),
  reason: z.enum(["new", "due"]),
  revision: z.number().int().positive(),
  capabilityResolverVersion: z.literal("sensa-executable-learning-capability-resolver-v1"),
  semanticPolicyVersion: z.literal("sensa-semantic-policy-v2"),
  stopPolicyVersion: z.literal("sensa-stop-policy-v2"),
  evidenceRuleVersion: z.literal("sensa-evidence-rule-v2"),
  stateUpdaterVersion: z.literal("sensa-state-updater-v2"),
  outcomeMappingVersion: z.literal("sensa-memory-outcome-v3"),
  plannedAt: timestamp,
  plannedLocalDate: z.string().min(1),
  planningTimeZone: z.string().min(1),
  planningTimeZoneSource: z.enum(["client", "user_settings", "utc_fallback"]),
  openedAt: timestamp.nullable(),
  closedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const sensaPlanNextResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("planned_encounter"), encounter: plannedEncounter }).strict(),
  z.object({ kind: z.literal("no_candidate"), reason: z.enum(["no_eligible_sense", "plan_unavailable", "daily_new_target_reached"]) }).strict(),
]);
export const sensaStudyPlanCreateResultSchema = z.object({ status: z.enum(["created", "replayed"]), studyPlan: studyPlan }).strict();
export const sensaLearningSessionStartResultSchema = z.object({ status: z.enum(["started", "resumed"]), learningSession: learningSession }).strict();

const mastery = z.object({
  learnerDeclaredMasteryId: id,
  workspaceId: id,
  learnerUserId: id,
  senseId: id,
  isMastered: z.boolean(),
  revision: z.number().int().nonnegative(),
  createdByReplicaId: id,
  declaredAt: timestamp,
  revokedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();
const syncCursors = z.object({ bootstrapEpoch: z.number().int().nonnegative(), mutableCursor: cursor, factCursor: cursor }).strict();
const operationBase = z.object({ operationId: id, occurredAt: timestamp });

const studyPlanUpdateOperationSchema = z.union([
  operationBase.extend({ kind: z.literal("study_plan.update"), studyPlanId: id, expectedRevision: z.number().int().positive(), mutation: z.literal("pacing"), dailyNewSenseTarget: z.number().int().positive() }).strict(),
  operationBase.extend({ kind: z.literal("study_plan.update"), studyPlanId: id, expectedRevision: z.number().int().positive(), mutation: z.literal("status"), status: z.enum(["active", "paused", "completed", "archived"]) }).strict(),
  operationBase.extend({ kind: z.literal("study_plan.update"), studyPlanId: id, expectedRevision: z.number().int().positive(), mutation: z.literal("pacing_and_status"), dailyNewSenseTarget: z.number().int().positive(), status: z.enum(["active", "paused", "completed", "archived"]) }).strict(),
]);

export const sensaSyncV2OperationSchema = z.union([
  operationBase.extend({ kind: z.literal("study_plan.create"), studyPlanId: id, bookVersionId: id, dailyNewSenseTarget: z.number().int().positive() }).strict(),
  studyPlanUpdateOperationSchema,
  operationBase.extend({ kind: z.literal("learning_session.start"), learningSessionId: id, studyPlanId: id }).strict(),
  operationBase.extend({ kind: z.literal("learning_session.complete"), learningSessionId: id, expectedRevision: z.number().int().positive(), status: z.enum(["completed", "abandoned"]) }).strict(),
  operationBase.extend({ kind: z.literal("sense_encounter.open"), senseEncounterId: id, learningSessionId: id, studyPlanId: id, senseId: id, senseVersionId: id, contentReleaseId: id, bookVersionId: id, sessionOrdinal: z.number().int().positive(), encounterKind: z.enum(["introduction", "review"]), selectionMode: z.enum(["mixed", "due_only"]).optional(), timeZone: z.string().min(1), kernelVersions }).strict(),
  operationBase.extend({ kind: z.literal("learning_attempt.record"), learningAttemptId: id, senseEncounterId: id, learningActionId: id, ordinal: z.number().int().positive(), responseSchemaVersion: z.string().min(1), responsePayload: canonicalLearningResponsePayloadSchema, durationMs: z.number().int().nonnegative().nullable() }).strict(),
  operationBase.extend({ kind: z.literal("sense_encounter.complete"), senseEncounterId: id, expectedRevision: z.number().int().positive() }).strict(),
  operationBase.extend({ kind: z.literal("sense_encounter.interrupt"), senseEncounterId: id, expectedRevision: z.number().int().positive(), status: z.enum(["interrupted", "cancelled"]) }).strict(),
  operationBase.extend({ kind: z.literal("learner_declared_mastery.set"), entityId: id, senseId: id, isMastered: z.boolean(), expectedRevision: z.number().int().nonnegative(), encounter: z.object({ senseEncounterId: id, expectedRevision: z.number().int().positive() }).strict().optional() }).strict(),
]);

const memoryOutcome = z.object({
  memoryOutcomeId: id,
  workspaceId: id,
  learnerUserId: id,
  senseId: id,
  senseEncounterId: id,
  outcomeKind: z.enum(["introduced", "retrieval_failed", "supported_retrieval", "independent_retrieval", "transfer_confirmed"]),
  decisionCode: z.enum([
    "introduced_after_grounding",
    "retrieval_failed_after_failure_limit",
    "supported_retrieval_after_prior_failure",
    "supported_retrieval_after_strong_support",
    "independent_retrieval_without_support",
    "transfer_confirmed_after_novel_cloze",
  ]),
  outcomeMappingVersion: z.literal("sensa-memory-outcome-v3"),
  scheduleDisposition: z.enum(["acquisition_pending", "fsrs_applied"]),
  fsrsRating: reviewRating.nullable(),
  observedCompletedAt: timestamp,
  effectiveReviewedAt: timestamp.nullable(),
  reviewTimeClamped: z.boolean(),
  reviewTimeClampReason: z.literal("previous_accepted_review_time").nullable(),
  priorMemoryRevision: z.number().int().nonnegative(),
  resultingMemoryRevision: z.number().int().positive(),
  fsrsAdapterVersion: z.literal("sensa-fsrs-adapter-v2").nullable(),
  schedulerSettingsDigest: digest.nullable(),
  createdAt: timestamp,
}).strict().superRefine((outcome, context) => {
  if (!memoryOutcomeDecisionMatchesKind(outcome.decisionCode, outcome.outcomeKind)) {
    context.addIssue({ code: "custom", message: "Memory Outcome decision code does not match its kind." });
  }
  if (outcome.resultingMemoryRevision !== outcome.priorMemoryRevision + 1) {
    context.addIssue({ code: "custom", message: "A Memory Outcome must advance the memory revision exactly once." });
  }
  const acquisitionPending = outcome.outcomeKind === "introduced";
  if (acquisitionPending) {
    if (outcome.scheduleDisposition !== "acquisition_pending"
      || outcome.fsrsRating !== null
      || outcome.effectiveReviewedAt !== null
      || outcome.reviewTimeClamped
      || outcome.reviewTimeClampReason !== null
      || outcome.fsrsAdapterVersion !== null
      || outcome.schedulerSettingsDigest !== null) {
      context.addIssue({ code: "custom", message: "A V2 introduced Outcome must remain acquisition-pending and contain no FSRS result." });
    }
    return;
  }
  const expectedRating = mapMemoryOutcomeToFsrsRating(outcome.outcomeKind);
  if (outcome.scheduleDisposition !== "fsrs_applied"
    || outcome.fsrsRating !== expectedRating
    || outcome.effectiveReviewedAt === null
    || outcome.fsrsAdapterVersion !== "sensa-fsrs-adapter-v2"
    || outcome.schedulerSettingsDigest === null) {
    context.addIssue({ code: "custom", message: "A scheduled Memory Outcome must contain a complete FSRS result." });
  }
  if (outcome.effectiveReviewedAt !== null) {
    const observed = Date.parse(outcome.observedCompletedAt);
    const effective = Date.parse(outcome.effectiveReviewedAt);
    const validTimeShape = outcome.reviewTimeClamped
      ? outcome.reviewTimeClampReason === "previous_accepted_review_time" && effective > observed
      : outcome.reviewTimeClampReason === null && effective === observed;
    if (!validTimeShape) {
      context.addIssue({ code: "custom", message: "A scheduled Memory Outcome has an invalid effective review time." });
    }
  }
});
const learningAttemptFact = z.object({
  learningAttemptId: id,
  workspaceId: id,
  learnerUserId: id,
  senseEncounterId: id,
  learningActionId: id,
  ordinal: z.number().int().positive(),
  sourceReplicaId: id,
  responseSchemaVersion: z.string().min(1),
  responsePayload: canonicalLearningResponsePayloadSchema,
  durationMs: z.number().int().nonnegative().nullable(),
  validity: z.enum(["valid", "invalid"]),
  isCorrect: z.boolean().nullable(),
  evaluationCode: z.string().min(1),
  occurredAt: timestamp,
  recordedAt: timestamp,
}).strict();
const learningEvidenceFact = z.object({
  learningEvidenceId: id,
  workspaceId: id,
  learnerUserId: id,
  senseId: id,
  senseVersionId: id,
  senseEncounterId: id,
  learningActionId: id,
  learningAttemptId: id,
  dimension: z.enum(["grounding", "boundary", "form_mapping", "retrieval", "transfer"]),
  polarity: z.enum(["positive", "negative"]),
  contextNovelty: z.enum(["familiar", "novel"]),
  evidenceRuleVersion: z.string().min(1),
  basisCode: z.string().min(1),
  occurredAt: timestamp,
  derivedAt: timestamp,
}).strict();
const learningActionFact = z.object({
  action: learningActionSchema,
  workspaceId: id,
  learnerUserId: id,
  senseEncounterId: id,
  createdAt: timestamp,
}).strict();
const appendFact = z.discriminatedUnion("factType", [
  z.object({ factSequence: cursor, factType: z.literal("learning_action"), factId: id, occurredAt: timestamp, fact: learningActionFact }).strict(),
  z.object({ factSequence: cursor, factType: z.literal("learning_attempt"), factId: id, occurredAt: timestamp, fact: learningAttemptFact }).strict(),
  z.object({ factSequence: cursor, factType: z.literal("learning_evidence"), factId: id, occurredAt: timestamp, fact: learningEvidenceFact }).strict(),
  z.object({ factSequence: cursor, factType: z.literal("memory_outcome"), factId: id, occurredAt: timestamp, fact: memoryOutcome }).strict(),
]);
const pinnedBookReference = z.object({ studyPlanId: id, bookVersionId: id, contentReleaseId: id, manifestDigest: digest, targetLanguage: z.string().min(1), learnerLocale: z.string().min(1) }).strict();
const replica = z.object({ replicaId: uuid, bootstrapRequired: z.literal(false), bootstrapCursors: syncCursors, acknowledgedCursors: syncCursors, revision: z.number().int().nonnegative(), bootstrappedAt: timestamp.nullable(), lastPulledAt: timestamp.nullable(), lastPushedAt: timestamp.nullable() }).strict();
const mutableUpsert = z.discriminatedUnion("entityType", [
  z.object({ mutableSequence: cursor, entityType: z.literal("study_plan"), entityId: id, entityRevision: z.number().int().positive(), action: z.literal("upsert"), snapshot: studyPlan, tombstoneReason: z.null() }).strict(),
  z.object({ mutableSequence: cursor, entityType: z.literal("learning_session"), entityId: id, entityRevision: z.number().int().positive(), action: z.literal("upsert"), snapshot: learningSession, tombstoneReason: z.null() }).strict(),
  z.object({ mutableSequence: cursor, entityType: z.literal("sense_encounter"), entityId: id, entityRevision: z.number().int().positive(), action: z.literal("upsert"), snapshot: encounter, tombstoneReason: z.null() }).strict(),
  z.object({ mutableSequence: cursor, entityType: z.literal("learner_semantic_state"), entityId: id, entityRevision: z.number().int().positive(), action: z.literal("upsert"), snapshot: semanticState, tombstoneReason: z.null() }).strict(),
  z.object({ mutableSequence: cursor, entityType: z.literal("sense_memory_state"), entityId: id, entityRevision: z.number().int().positive(), action: z.literal("upsert"), snapshot: memoryState, tombstoneReason: z.null() }).strict(),
  z.object({ mutableSequence: cursor, entityType: z.literal("learner_declared_mastery"), entityId: id, entityRevision: z.number().int().nonnegative(), action: z.literal("upsert"), snapshot: mastery, tombstoneReason: z.null() }).strict(),
]);
const mutableChange = z.union([
  mutableUpsert,
  z.object({ mutableSequence: cursor, entityType: z.enum(["study_plan", "learning_session", "sense_encounter", "learner_semantic_state", "sense_memory_state", "learner_declared_mastery"]), entityId: id, entityRevision: z.number().int().nonnegative(), action: z.literal("tombstone"), snapshot: z.null(), tombstoneReason: z.string().min(1) }).strict(),
]);
const operationPayload = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("study_plan"), snapshot: studyPlan }).strict(),
  z.object({ kind: z.literal("learning_session"), snapshot: learningSession }).strict(),
  z.object({ kind: z.literal("sense_encounter"), snapshot: encounter, memoryOutcome: memoryOutcome.nullable(), memoryState: memoryState.nullable() }).strict(),
  z.object({ kind: z.literal("learning_attempt"), fact: learningAttemptFact, nextAction: learningActionSchema.nullable() }).strict(),
  z.object({ kind: z.literal("learner_declared_mastery"), snapshot: mastery, encounter: encounter.nullable() }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
]);
const operationResultBase = z.object({ operationId: id, payload: operationPayload, mutableCursor: cursor.nullable(), factCursor: cursor.nullable() });
const rejectedOperationResultBase = z.object({ operationId: id, payload: z.object({ kind: z.literal("none") }).strict(), mutableCursor: z.null(), factCursor: z.null() });
const syncOperationResult = z.union([
  operationResultBase.extend({ status: z.enum(["applied", "rebased", "replayed"]), acknowledged: z.literal(true), errorCode: z.null(), resultDigest: digest }).strict(),
  rejectedOperationResultBase.extend({ status: z.literal("conflict"), acknowledged: z.literal(false), errorCode: z.enum(sensaSyncErrorCodes), resultDigest: digest }).strict(),
  rejectedOperationResultBase.extend({ status: z.literal("rejected"), acknowledged: z.literal(false), errorCode: z.enum(sensaSyncErrorCodes), resultDigest: z.null() }).strict(),
]);
export const sensaSyncV2OperationResultSchema = syncOperationResult;

export const sensaSyncV2BootstrapResultSchema = z.object({
  wireVersion: z.literal("sensa-sync-v2"),
  resultSchemaVersion: z.literal("sensa-sync-result-v2"),
  bootstrapRequired: z.literal(false),
  supportedKernelVersions: z.array(kernelVersions).min(1),
  snapshot: z.object({
    replica,
    pinnedBooks: z.array(pinnedBookReference),
    studyPlans: z.array(studyPlan),
    learningSessions: z.array(learningSession),
    senseEncounters: z.array(encounter),
    semanticStates: z.array(semanticState),
    memoryStates: z.array(memoryState),
    learnerDeclaredMasteries: z.array(mastery),
    cursors: syncCursors,
  }).strict(),
}).strict();

export const sensaSyncV2PushResultSchema = z.object({
  wireVersion: z.literal("sensa-sync-v2"),
  resultSchemaVersion: z.literal("sensa-sync-result-v2"),
  results: z.array(sensaSyncV2OperationResultSchema),
  cursors: syncCursors,
}).strict();

export const sensaSyncV2PullResultSchema = z.union([
  z.object({ wireVersion: z.literal("sensa-sync-v2"), resultSchemaVersion: z.literal("sensa-sync-result-v2"), bootstrapRequired: z.literal(false), errorCode: z.null(), mutableChanges: z.array(mutableChange), appendFacts: z.array(appendFact), nextCursors: syncCursors }).strict(),
  z.object({ wireVersion: z.literal("sensa-sync-v2"), resultSchemaVersion: z.literal("sensa-sync-result-v2"), bootstrapRequired: z.literal(true), errorCode: z.literal("bootstrap_required"), nextCursors: z.null() }).strict(),
]);

/**
 * A completed Encounter step carries the kernel's 5D projection, not the stored
 * `learner_semantic_states` row.  Its keys are the rule-packet dimension names
 * because `stateDigest` is computed over exactly this shape: renaming
 * `form_mapping` to `formMapping` here would make the digest unreproducible.
 * The row projection (`sensaLearnerSemanticStateSchema`) stays the Sync shape.
 */
const encounterSemanticProjection = z.object({
  workspaceId: id,
  learnerUserId: id,
  senseId: id,
  grounding: semanticDimension,
  boundary: semanticDimension,
  form_mapping: semanticDimension,
  retrieval: semanticDimension,
  transfer: semanticDimension,
  projectionVersion: z.enum([
    "sensa-state-updater-v1",
    "sensa-state-updater-v2",
  ]),
  revision: z.number().int().positive(),
  stateDigest: digest,
  projectedThroughEvidenceId: id.nullable(),
}).strict();

export const sensaEncounterStepSchema = z.union([
  z.object({ kind: z.literal("next_action"), encounterId: id, action: learningActionSchema }).strict(),
  z.object({
    kind: z.literal("completed"),
    encounterId: id,
    memoryOutcome,
    memoryState,
    semanticState: encounterSemanticProjection,
  }).strict(),
]);

/**
 * Interruption is not an Encounter step: it emits no Action and no Memory
 * Outcome, so it carries its own closed response shape.
 */
export const sensaInterruptedEncounterSchema = z.object({
  kind: z.literal("interrupted"),
  encounterId: id,
  status: z.enum(["interrupted", "cancelled"]),
}).strict();

export const sensaMediaDownloadSchema = z.object({
  media: sensaMediaReferenceSchema.optional(),
  download: z.object({ method: z.literal("GET"), url: z.string().url(), expiresAt: timestamp, rangeRequests: z.boolean() }).strict(),
}).strict();

export const sensaStudyPlanSchema = studyPlan;
export const sensaLearningSessionSchema = learningSession;
export const sensaEncounterSchema = encounter;
export const sensaMasterySchema = mastery;
export const sensaTimestampSchema = timestamp;
export const sensaJsonObjectSchema = jsonObject;
export const sensaLearningResponsePayloadSchema = learningResponsePayloadSchema;
export const sensaSyncCursorsSchema = syncCursors;
export const sensaSyncAppendFactSchema = appendFact;
export const sensaSyncMutableChangeSchema = mutableChange;
export const sensaKernelVersionsSchema = kernelVersions;
export const sensaLearnerSemanticStateSchema = semanticState;
export const sensaMemoryStateSchema = memoryState;
export const sensaLearningAttemptFactSchema = learningAttemptFact;
export const sensaLearningEvidenceFactSchema = learningEvidenceFact;
export const sensaMemoryOutcomeSchema = memoryOutcome;
export const sensaUuidRouteParamSchema = z.string().uuid();
export const sensaWorkspaceRouteParamSchema = z.string().uuid();

/** Shared strict request schemas used by the HTTP route adapters. */
export const sensaCatalogBooksQuerySchema = z.object({
  targetLanguage: z.string().trim().min(1).max(128).optional(),
  learnerLocale: z.string().trim().min(1).max(128).optional(),
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();
export const sensaCatalogContentQuerySchema = z.object({
  bookVersionId: uuid,
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().positive().max(25).optional(),
}).strict();
export const sensaPinnedContentQuerySchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().positive().max(25).optional(),
}).strict();
export const sensaBookSearchQuerySchema = z.object({ q: z.string().max(128).optional() }).strict();
export const sensaPlanningCreateBodySchema = z.object({ studyPlanId: uuid, bookVersionId: uuid, dailyNewSenseTarget: z.number().int().positive().max(100), replicaId: uuid }).strict();
export const sensaPlanningStartBodySchema = z.object({ learningSessionId: uuid, studyPlanId: uuid, replicaId: uuid }).strict();
export const sensaPlanningNextBodySchema = z.object({ studyPlanId: uuid, selectionMode: z.enum(["mixed", "due_only"]).optional(), timeZone: z.string().min(1).optional() }).strict();
export const sensaEncounterAttemptBodySchema = z.object({
  attemptId: uuid,
  actionId: uuid,
  ordinal: z.number().int().positive(),
  replicaId: uuid,
  responseSchemaVersion: z.string().min(1).max(128),
  responsePayload: learningResponsePayloadSchema,
  durationMs: z.number().int().nonnegative().nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();
export const sensaEncounterInterruptBodySchema = z.object({ status: z.enum(["interrupted", "cancelled"]).optional() }).strict();
export const sensaSyncBootstrapBodySchema = z.object({ wireVersion: z.literal("sensa-sync-v2"), replicaId: uuid }).strict();
export const sensaSyncPushBodySchema = z.object({ wireVersion: z.literal("sensa-sync-v2"), replicaId: uuid, cursors: syncCursors, operations: z.array(sensaSyncV2OperationSchema).max(100) }).strict();
export const sensaSyncPullBodySchema = z.object({ wireVersion: z.literal("sensa-sync-v2"), replicaId: uuid, cursors: syncCursors, limit: z.number().int().positive().max(500) }).strict();
export const sensaMediaCapabilitySchema = z.string().min(1).max(8_192);
