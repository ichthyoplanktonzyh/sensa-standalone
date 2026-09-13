import { z } from "zod";

const id = z.string().min(1);
const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const cursor = z.string();
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
