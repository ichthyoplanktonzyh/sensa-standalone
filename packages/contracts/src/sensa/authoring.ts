import { z } from "zod";

const nonEmpty = z.string().trim().min(1);
const slug = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
const positiveInteger = z.number().int().positive();
const sha256 = z.string().regex(/^(?:sha256:)?[0-9a-f]{64}$/u);
const isoTimestamp = z.string().datetime({ offset: true });

export const sensaAuthoringReviewSchema = z
  .object({
    status: z.enum(["draft", "approved", "rejected"]),
    reviewedBy: nonEmpty.nullable(),
    reviewedAt: isoTimestamp.nullable(),
    note: nonEmpty.nullable(),
  })
  .strict();

export const sensaAuthoringSourceEvidenceSchema = z
  .object({
    sourceKey: slug,
    kind: z.enum(["dictionary", "corpus", "editorial", "generated"]),
    title: nonEmpty,
    provider: nonEmpty.nullable(),
    locator: nonEmpty.nullable(),
    sourceLicense: nonEmpty.nullable(),
    sourceAttribution: nonEmpty.nullable(),
    capturedAt: isoTimestamp.nullable(),
    evidenceDigest: sha256.nullable(),
  })
  .strict();

export const sensaAuthoringAssetProvenanceSchema = z
  .object({
    sourceRefs: z.array(slug).min(1),
    generator: z
      .object({
        provider: nonEmpty,
        model: nonEmpty,
        promptVersion: nonEmpty,
      })
      .strict()
      .nullable(),
    review: sensaAuthoringReviewSchema,
  })
  .strict();

export const sensaAuthoringMediaDefinitionSchema = z
  .object({
    mediaKey: slug,
    kind: z.enum(["image", "audio"]),
    uri: nonEmpty,
    mimeType: nonEmpty,
    sha256: sha256.nullable(),
    sourceTextDigest: sha256.nullable(),
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

export const sensaAuthoringLexemeDefinitionSchema = z
  .object({
    lexemeKey: slug,
    version: positiveInteger,
    languageTag: nonEmpty,
    lemma: nonEmpty,
    forms: z.array(nonEmpty).min(1),
    syllables: nonEmpty.nullable(),
    pronunciations: z.array(
      z
        .object({
          pronunciationKey: slug,
          accentLocale: nonEmpty,
          ipa: nonEmpty,
          mediaKey: slug.nullable(),
        })
        .strict(),
    ).min(1),
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

export const sensaAuthoringSenseRelationSchema = z
  .object({
    relationKey: slug,
    sourceSenseKey: slug,
    targetSenseKey: slug,
    relationType: nonEmpty,
    scope: z.enum(["intra_word", "cross_word"]),
    distinguishingFeature: nonEmpty,
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

export const sensaAuthoringCapabilityRequirementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("contextual_recognition") }).strict(),
  z
    .object({
      kind: z.literal("meaning_to_form_recall"),
      gradingContract: z.literal("lexeme_identity_v1"),
    })
    .strict(),
  z.object({ kind: z.literal("novel_context_transfer") }).strict(),
  z
    .object({
      kind: z.literal("boundary_discrimination"),
      relationKey: slug,
    })
    .strict(),
  ]);

export const sensaAuthoringAcquisitionNeedSchema = z.enum([
  "perceptual_grounding",
  "boundary_formation",
  "abstraction_invariant",
  "spatial_aspectual_tuning",
  "social_normative_calibration",
  "form_binding",
]);

export const sensaAuthoringAcquisitionPrimitiveSchema = z.enum([
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

export const sensaAuthoringAssetCapabilitySchema = z.enum([
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

export const sensaAuthoringAcquisitionProfileSchema = z
  .object({
    profileKey: slug,
    acquisitionNeeds: z.array(sensaAuthoringAcquisitionNeedSchema).min(1),
    minimumSufficientExperience: nonEmpty,
    distinguishingFeatures: z.array(nonEmpty).min(1),
    preferredPrimitives: z.array(sensaAuthoringAcquisitionPrimitiveSchema).min(1),
    fallbackPrimitives: z.array(sensaAuthoringAcquisitionPrimitiveSchema),
    requiredCapabilities: z.array(sensaAuthoringCapabilityRequirementSchema).min(3),
    optionalCapabilities: z.array(z.enum([
      "sound_recognition",
      "form_realization",
      "boundary_discrimination",
    ])),
    requiredAssetCapabilities: z.array(sensaAuthoringAssetCapabilitySchema),
    optionalAssetCapabilities: z.array(sensaAuthoringAssetCapabilitySchema),
    domainBound: z.boolean(),
    domainConstraints: z.array(nonEmpty),
    boundaryTargets: z.array(z.object({
      relationKey: slug,
      isRequired: z.boolean(),
    }).strict()),
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

export const sensaAuthoringExperienceSketchSchema = z
  .object({
    sketchKey: slug,
    experienceGoal: nonEmpty,
    focalStructure: z.array(nonEmpty).min(1),
    learnerInference: nonEmpty,
    constraints: z
      .object({
        mustConvey: z.array(nonEmpty).min(1),
        mustAvoid: z.array(nonEmpty),
        hideTargetForms: z.literal(true),
      })
      .strict(),
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

const experienceRenderBase = z
  .object({
    renderKey: slug,
    primitive: sensaAuthoringAcquisitionPrimitiveSchema,
    supportedDeliveryProfiles: z.array(slug).min(1),
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

export const sensaAuthoringExperienceRenderSchema = z.discriminatedUnion("kind", [
  experienceRenderBase.extend({
    kind: z.literal("text"),
    sceneL1: nonEmpty,
  }).strict(),
  experienceRenderBase.extend({
    kind: z.literal("image"),
    mediaKey: slug,
    altTextL1: nonEmpty,
  }).strict(),
  experienceRenderBase.extend({
    kind: z.literal("sequence"),
    sequenceKind: z.enum(["causal", "temporal"]),
    steps: z.array(z.object({
      label: nonEmpty,
      description: nonEmpty,
    }).strict()).min(2),
  }).strict(),
  experienceRenderBase.extend({
    kind: z.literal("interaction"),
    rendererKey: z.enum([
      "state_change_v1",
      "sequence_order_v1",
      "figure_ground_v1",
    ]),
    payload: z.record(z.string(), z.unknown()),
  }).strict(),
]);

export const sensaAuthoringExperienceRenderPlanSchema = z
  .object({
    strategyVersion: z.literal("sensa-experience-render-plan-v1"),
    selections: z.array(z.object({
      renderKey: slug,
      role: z.enum(["preferred", "alternative", "fallback"]),
      rank: positiveInteger,
      reason: nonEmpty,
    }).strict()).min(1),
  })
  .strict();

export const sensaAuthoringReviewedTextAssetSchema = z
  .object({
    assetKey: slug,
    bodyL1: nonEmpty,
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

export const sensaAuthoringExampleRoleSchema = z.enum([
  "study_binding",
  "recognition_assessment",
  "retrieval_repair",
  "transfer_assessment",
  "retention_assessment",
  "free_practice",
]);

const exampleRenderBase = z.object({ renderKey: slug }).strict();

export const sensaAuthoringExampleRenderSchema = z.discriminatedUnion("kind", [
  exampleRenderBase.extend({ kind: z.literal("text") }).strict(),
  exampleRenderBase.extend({
    kind: z.literal("static_audio"),
    mediaKey: slug,
    accentLocale: nonEmpty,
    sourceTextDigest: sha256,
  }).strict(),
]);

export const sensaAuthoringLearningExampleSchema = z
  .object({
    exampleKey: slug,
    textL2: nonEmpty,
    textL1: nonEmpty,
    target: z
      .object({
        surface: nonEmpty,
        start: z.number().int().nonnegative(),
        end: positiveInteger,
      })
      .strict(),
    scenarioFamily: slug,
    construction: nonEmpty,
    roles: z.array(sensaAuthoringExampleRoleSchema).min(1),
    visibility: z.enum(["learning_only", "assessment_only"]),
    renders: z.array(sensaAuthoringExampleRenderSchema).min(1),
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

export const sensaAuthoringUsagePatternSchema = z
  .object({
    patternKey: slug,
    canonicalPattern: nonEmpty,
    commonCollocations: z.array(nonEmpty),
    registerLabel: nonEmpty.nullable(),
    domainLabel: nonEmpty.nullable(),
    usageRestriction: nonEmpty.nullable(),
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

export const sensaAuthoringPackagePracticeManifestSchema = z
  .object({
    profileVersion: z.literal("sensa-initial-free-practice-v1"),
    grants: z.array(z.object({
      taskFamily: z.enum([
        "immersive_browse",
        "portable_listening",
        "dictation",
        "quick_spelling",
      ]),
      resourceKeys: z.array(slug).min(1),
    }).strict()),
  })
  .strict();

export const sensaAuthoringSensePackageSchema = z
  .object({
    schemaVersion: z.literal("sensa-sense-package-definition-v1"),
    identity: z
      .object({
        packageKey: slug,
        packageVersion: positiveInteger,
        senseKey: slug,
        senseVersion: positiveInteger,
        lexemeKey: slug,
        lexemeVersion: positiveInteger,
        targetLanguage: nonEmpty,
        learnerLocale: nonEmpty,
      })
      .strict(),
    sense: z
      .object({
        partOfSpeech: nonEmpty,
        senseRank: positiveInteger,
        guideLabelL1: nonEmpty,
        definitionL2: nonEmpty,
        teachingPriority: z.enum(["core", "extended", "recognition"]),
        coreFeatures: z.array(nonEmpty).min(1),
      })
      .strict(),
    acquisitionProfile: sensaAuthoringAcquisitionProfileSchema,
    experience: z
      .object({
        sketch: sensaAuthoringExperienceSketchSchema,
        renders: z.array(sensaAuthoringExperienceRenderSchema).min(1),
        renderPlan: sensaAuthoringExperienceRenderPlanSchema,
      })
      .strict(),
    l1Bridge: sensaAuthoringReviewedTextAssetSchema,
    examples: z.array(sensaAuthoringLearningExampleSchema).min(1),
    usagePatterns: z.array(sensaAuthoringUsagePatternSchema),
    practiceManifest: sensaAuthoringPackagePracticeManifestSchema.optional(),
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

export const sensaGoldenContentBundleSchema = z
  .object({
    schemaVersion: z.literal("sensa-golden-content-bundle-v1"),
    release: z
      .object({
        releaseKey: slug,
        version: positiveInteger,
        targetLanguage: nonEmpty,
        learnerLocale: nonEmpty,
        deliveryProfileVersion: z.literal("sensa-web-prototype-acquisition-v1"),
        status: z.enum(["draft", "approved"]),
      })
      .strict(),
    sources: z.array(sensaAuthoringSourceEvidenceSchema).min(1),
    media: z.array(sensaAuthoringMediaDefinitionSchema),
    lexemes: z.array(sensaAuthoringLexemeDefinitionSchema).min(1),
    relations: z.array(sensaAuthoringSenseRelationSchema),
    packages: z.array(sensaAuthoringSensePackageSchema).min(1),
  })
  .strict();

export type SensaAuthoringReview = z.infer<typeof sensaAuthoringReviewSchema>;
export type SensaAuthoringAssetProvenance = z.infer<typeof sensaAuthoringAssetProvenanceSchema>;
export type SensaAuthoringAcquisitionNeed = z.infer<typeof sensaAuthoringAcquisitionNeedSchema>;
export type SensaAuthoringAcquisitionPrimitive = z.infer<typeof sensaAuthoringAcquisitionPrimitiveSchema>;
export type SensaAuthoringAssetCapability = z.infer<typeof sensaAuthoringAssetCapabilitySchema>;
export type SensaAuthoringAcquisitionProfile = z.infer<typeof sensaAuthoringAcquisitionProfileSchema>;
export type SensaAuthoringLexemeDefinition = z.infer<typeof sensaAuthoringLexemeDefinitionSchema>;
export type SensaAuthoringSenseRelation = z.infer<typeof sensaAuthoringSenseRelationSchema>;
export type SensaAuthoringExperienceRender = z.infer<typeof sensaAuthoringExperienceRenderSchema>;
export type SensaAuthoringExperienceRenderPlan = z.infer<typeof sensaAuthoringExperienceRenderPlanSchema>;
export type SensaAuthoringLearningExample = z.infer<typeof sensaAuthoringLearningExampleSchema>;
export type SensaAuthoringSensePackage = z.infer<typeof sensaAuthoringSensePackageSchema>;
export type SensaGoldenContentBundle = z.infer<typeof sensaGoldenContentBundleSchema>;
