import { z } from "zod";

/*
 * Runtime content is a published delivery contract, not an authoring
 * snapshot.  It intentionally does not contain source evidence, generator
 * metadata, review records, or learner state.  Those facts belong to the
 * authoring/publishing boundary.  The runtime keeps only immutable facts a
 * client needs to materialise an action.
 */

const nonEmpty = z.string().trim().min(1);
const slug = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();
const nonNegativeNumber = z.number().finite().nonnegative();
const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

const runtimeMediaSchema = z
  .object({
    mediaKey: slug,
    kind: z.enum(["image", "audio"]),
    uri: nonEmpty,
    mimeType: nonEmpty,
    sha256,
    sourceTextDigest: sha256.nullable(),
  })
  .strict();

const runtimePronunciationSchema = z
  .object({
    pronunciationKey: slug,
    accentLocale: nonEmpty,
    ipa: nonEmpty,
    mediaKey: slug.nullable(),
  })
  .strict();

const runtimeLexemeSchema = z
  .object({
    lexemeKey: slug,
    version: positiveInteger,
    languageTag: nonEmpty,
    lemma: nonEmpty,
    forms: z.array(nonEmpty).min(1),
    syllables: nonEmpty.nullable(),
    pronunciations: z.array(runtimePronunciationSchema).min(1),
  })
  .strict();

const runtimeRelationSchema = z
  .object({
    relationKey: slug,
    sourceSenseKey: slug,
    targetSenseKey: slug,
    relationType: nonEmpty,
    scope: z.enum(["intra_word", "cross_word"]),
    distinguishingFeature: nonEmpty,
  })
  .strict();

const runtimeCapabilityRequirementSchema = z.discriminatedUnion("kind", [
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

const acquisitionNeeds = z.enum([
  "perceptual_grounding",
  "boundary_formation",
  "abstraction_invariant",
  "spatial_aspectual_tuning",
  "social_normative_calibration",
  "form_binding",
]);

const acquisitionPrimitives = z.enum([
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

const assetCapabilities = z.enum([
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

const runtimeAcquisitionProfileSchema = z
  .object({
    profileKey: slug,
    acquisitionNeeds: z.array(acquisitionNeeds).min(1),
    minimumSufficientExperience: nonEmpty,
    distinguishingFeatures: z.array(nonEmpty).min(1),
    preferredPrimitives: z.array(acquisitionPrimitives).min(1),
    fallbackPrimitives: z.array(acquisitionPrimitives),
    requiredCapabilities: z.array(runtimeCapabilityRequirementSchema).min(1),
    optionalCapabilities: z.array(
      z.enum(["sound_recognition", "form_realization", "boundary_discrimination"]),
    ),
    requiredAssetCapabilities: z.array(assetCapabilities),
    optionalAssetCapabilities: z.array(assetCapabilities),
    domainBound: z.boolean(),
    domainConstraints: z.array(nonEmpty),
    boundaryTargets: z.array(
      z
        .object({
          relationKey: slug,
          isRequired: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

const runtimeExperienceSketchSchema = z
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
  })
  .strict();

const runtimeRenderBaseSchema = z
  .object({
    renderKey: slug,
    primitive: acquisitionPrimitives,
    supportedDeliveryProfiles: z.array(slug).min(1),
  })
  .strict();

const runtimeExperienceStepSchema = z
  .object({
    label: nonEmpty,
    description: nonEmpty,
  })
  .strict();

const runtimePresentationBaseSchema = z
  .object({
    controlLabelL1: nonEmpty,
    statusLabelsL1: z.array(nonEmpty),
    objectLabelL1: nonEmpty.nullable(),
    projectLabelL1: nonEmpty.nullable(),
    supportLabelsL1: z.array(nonEmpty),
    viewpointLabelL1: nonEmpty.nullable(),
    ownerLabelL1: nonEmpty.nullable(),
    userLabelL1: nonEmpty.nullable(),
  })
  .strict();

/**
 * Closed presentation vocabulary implemented by the frozen web renderer.
 * Sense-specific labels remain data; only the renderer variant and its stage
 * class are closed runtime vocabulary.
 */
export const sensaRuntimeExperiencePresentationSchema = z.discriminatedUnion(
  "variant",
  [
    runtimePresentationBaseSchema
      .extend({
        variant: z.literal("physical_threshold"),
        stageClassName: z.literal("physical"),
      })
      .strict(),
    runtimePresentationBaseSchema
      .extend({
        variant: z.literal("continuation_timeline"),
        stageClassName: z.literal("process"),
      })
      .strict(),
    runtimePresentationBaseSchema
      .extend({
        variant: z.literal("receiver_transfer"),
        stageClassName: z.literal("borrow"),
      })
      .strict(),
    runtimePresentationBaseSchema
      .extend({
        variant: z.literal("provider_transfer"),
        stageClassName: z.literal("lend"),
      })
      .strict(),
  ],
);

const runtimePhysicalPresentationSchema = z
  .object({
    variant: z.literal("physical_threshold"),
    controlLabelL1: nonEmpty,
    stageClassName: z.literal("physical"),
    statusLabelsL1: z.array(nonEmpty),
    objectLabelL1: nonEmpty.nullable(),
    projectLabelL1: nonEmpty.nullable(),
    supportLabelsL1: z.array(nonEmpty),
    viewpointLabelL1: nonEmpty.nullable(),
    ownerLabelL1: nonEmpty.nullable(),
    userLabelL1: nonEmpty.nullable(),
  })
  .strict();

const runtimeContinuationPresentationSchema = z
  .object({
    variant: z.literal("continuation_timeline"),
    controlLabelL1: nonEmpty,
    stageClassName: z.literal("process"),
    statusLabelsL1: z.array(nonEmpty),
    objectLabelL1: nonEmpty.nullable(),
    projectLabelL1: nonEmpty.nullable(),
    supportLabelsL1: z.array(nonEmpty),
    viewpointLabelL1: nonEmpty.nullable(),
    ownerLabelL1: nonEmpty.nullable(),
    userLabelL1: nonEmpty.nullable(),
  })
  .strict();

const runtimeReceiverPresentationSchema = z
  .object({
    variant: z.literal("receiver_transfer"),
    controlLabelL1: nonEmpty,
    stageClassName: z.literal("borrow"),
    statusLabelsL1: z.array(nonEmpty),
    objectLabelL1: nonEmpty.nullable(),
    projectLabelL1: nonEmpty.nullable(),
    supportLabelsL1: z.array(nonEmpty),
    viewpointLabelL1: nonEmpty.nullable(),
    ownerLabelL1: nonEmpty.nullable(),
    userLabelL1: nonEmpty.nullable(),
  })
  .strict();

const runtimeProviderPresentationSchema = z
  .object({
    variant: z.literal("provider_transfer"),
    controlLabelL1: nonEmpty,
    stageClassName: z.literal("lend"),
    statusLabelsL1: z.array(nonEmpty),
    objectLabelL1: nonEmpty.nullable(),
    projectLabelL1: nonEmpty.nullable(),
    supportLabelsL1: z.array(nonEmpty),
    viewpointLabelL1: nonEmpty.nullable(),
    ownerLabelL1: nonEmpty.nullable(),
    userLabelL1: nonEmpty.nullable(),
  })
  .strict();

const runtimePhysicalInteractionPayloadSchema = z
  .object({
    instructionL1: nonEmpty,
    runtimePresentation: runtimePhysicalPresentationSchema,
    subject: z
      .object({
        kind: nonEmpty,
        initialState: nonEmpty,
      })
      .strict(),
    control: z
      .object({
        kind: z.literal("slider"),
        valueKey: nonEmpty,
        minimum: nonNegativeNumber,
        maximum: nonNegativeNumber,
        step: z.number().finite().positive(),
      })
      .strict(),
    states: z
      .array(
        z
          .object({
            value: nonNegativeNumber,
            state: nonEmpty,
            labelL1: nonEmpty,
            feedbackL1: nonEmpty,
          })
          .strict(),
      )
      .min(2),
    resetLabelL1: nonEmpty,
    accessibility: z
      .object({
        keyboardStep: z.number().finite().positive(),
        summaryL1: nonEmpty,
      })
      .strict(),
  })
  .strict();

const runtimeContinuationInteractionPayloadSchema = z
  .object({
    instructionL1: nonEmpty,
    runtimePresentation: runtimeContinuationPresentationSchema,
    timeline: z
      .array(
        z
          .object({
            labelL1: nonEmpty,
            state: nonEmpty,
            feedbackL1: nonEmpty,
          })
          .strict(),
    )
      .min(2),
    supportKindsL1: z.array(nonEmpty).min(1),
  })
  .strict();

const runtimeTransferInteractionPayloadSchema = z
  .object({
    instructionL1: nonEmpty,
    runtimePresentation: z.union([
      runtimeReceiverPresentationSchema,
      runtimeProviderPresentationSchema,
    ]),
    actors: z
      .array(
        z
          .object({
            roleL1: nonEmpty,
            state: nonEmpty,
          })
          .strict(),
      )
      .min(1),
    object: z
      .object({
        kind: nonEmpty,
        ownership: z.array(nonEmpty).min(1),
      })
      .strict(),
    states: z
      .array(
        z
          .object({
            key: slug,
            labelL1: nonEmpty,
          })
          .strict(),
      )
      .min(2),
  })
  .strict();

/** Closed payloads for the currently supported state-change catalog. */
export const sensaRuntimeInteractionPayloadSchema = z.union([
  runtimePhysicalInteractionPayloadSchema,
  runtimeContinuationInteractionPayloadSchema,
  runtimeTransferInteractionPayloadSchema,
]);

const runtimeExperienceRenderSchema = z.discriminatedUnion("kind", [
  runtimeRenderBaseSchema
    .extend({
      kind: z.literal("text"),
      sceneL1: nonEmpty,
    })
    .strict(),
  runtimeRenderBaseSchema
    .extend({
      kind: z.literal("image"),
      mediaKey: slug,
      altTextL1: nonEmpty,
    })
    .strict(),
  runtimeRenderBaseSchema
    .extend({
      kind: z.literal("sequence"),
      sequenceKind: z.enum(["causal", "temporal"]),
      steps: z.array(runtimeExperienceStepSchema).min(2),
    })
    .strict(),
  runtimeRenderBaseSchema
    .extend({
      kind: z.literal("interaction"),
      rendererKey: z.literal("state_change_v1"),
      payload: sensaRuntimeInteractionPayloadSchema,
    })
    .strict(),
]);

const runtimeRenderPlanSchema = z
  .object({
    strategyVersion: z.literal("sensa-experience-render-plan-v1"),
    selections: z
      .array(
        z
          .object({
            renderKey: slug,
            role: z.enum(["preferred", "alternative", "fallback"]),
            rank: positiveInteger,
            reason: nonEmpty,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const runtimeExperienceRecapSchema = z
  .object({
    recapKey: slug,
    titleL1: nonEmpty,
    steps: z
      .array(
        z
          .object({
            stepKey: slug,
            labelL1: nonEmpty,
            descriptionL1: nonEmpty,
          })
          .strict(),
      )
      .min(2),
    bodyL1: nonEmpty,
  })
  .strict();

const runtimeReviewedTextAssetSchema = z
  .object({
    assetKey: slug,
    bodyL1: nonEmpty,
  })
  .strict();

const runtimeExampleRenderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), renderKey: slug }).strict(),
  z
    .object({
      kind: z.literal("static_audio"),
      renderKey: slug,
      mediaKey: slug,
      accentLocale: nonEmpty,
      sourceTextDigest: sha256,
    })
    .strict(),
]);

const runtimeLearningExampleRoleSchema = z.enum([
  "study_binding",
  "recognition_assessment",
  "retrieval_repair",
  "transfer_assessment",
  "retention_assessment",
  "usage_illustration",
  "free_practice",
]);

const runtimeLearningExampleSchema = z
  .object({
    exampleKey: slug,
    textL2: nonEmpty,
    textL1: nonEmpty,
    target: z
      .object({
        surface: nonEmpty,
        start: nonNegativeInteger,
        end: positiveInteger,
      })
      .strict(),
    scenarioFamily: slug,
    construction: nonEmpty,
    roles: z.array(runtimeLearningExampleRoleSchema).min(1),
    visibility: z.enum(["learning_only", "assessment_only"]),
    renders: z.array(runtimeExampleRenderSchema).min(1),
  })
  .strict();

const runtimeUsageExampleBindingSchema = z
  .object({
    bindingKey: slug,
    exampleKey: slug,
    start: nonNegativeInteger,
    end: positiveInteger,
    role: z.enum(["primary", "alternative"]),
  })
  .strict();

const runtimeUsageCollocationSchema = z
  .object({
    collocationKey: slug,
    displayTextL2: nonEmpty,
    exampleBindings: z.array(runtimeUsageExampleBindingSchema).min(1),
  })
  .strict();

const runtimeUsagePatternSchema = z
  .object({
    patternKey: slug,
    canonicalPattern: nonEmpty,
    registerLabel: nonEmpty.nullable(),
    domainLabel: nonEmpty.nullable(),
    usageRestriction: nonEmpty.nullable(),
    collocations: z.array(runtimeUsageCollocationSchema).min(1),
  })
  .strict();

const runtimeAssessmentPurposeSchema = z.enum([
  "acquisition_gate",
  "retention_review",
  "relearning_gate",
]);

const runtimeAssessmentOptionSchema = z
  .object({
    optionKey: slug,
    labelL1: nonEmpty,
    detailL1: nonEmpty.optional(),
    isCorrect: z.boolean(),
    reasonCode: slug,
    feedbackTitleL1: nonEmpty,
    feedbackBodyL1: nonEmpty,
  })
  .strict();

const runtimeTransferOptionSchema = runtimeAssessmentOptionSchema
  .extend({ detailL1: nonEmpty })
  .strict();

const runtimeAssessmentTaskBaseSchema = z
  .object({
    taskKey: slug,
    eligiblePurposes: z.array(runtimeAssessmentPurposeSchema).min(1),
    promptL1: nonEmpty,
  })
  .strict();

const runtimeContextualRecognitionTaskSchema = runtimeAssessmentTaskBaseSchema
  .extend({
    kind: z.literal("contextual_recognition"),
    exampleKey: slug,
    questionL1: nonEmpty,
    options: z.array(runtimeAssessmentOptionSchema).min(2),
    featureLabelsL1: z.array(nonEmpty).min(1),
  })
  .strict();

const runtimeMeaningToFormRecallTaskSchema = runtimeAssessmentTaskBaseSchema
  .extend({
    kind: z.literal("meaning_to_form_recall"),
    cue: z
      .object({
        bodyL1: nonEmpty,
        featureLabelsL1: z.array(nonEmpty).min(1),
      })
      .strict(),
    gradingContract: z.literal("lexeme_identity_v1"),
    supportInventory: z
      .object({
        firstLetter: z.boolean(),
        formChoices: z
          .array(
            z
              .object({
                optionKey: slug,
                formL2: nonEmpty,
                isTargetLexeme: z.boolean(),
                reasonCode: slug,
              })
              .strict(),
          )
          .min(2),
      })
      .strict(),
    feedback: z
      .object({
        independentSuccessTitleL1: nonEmpty,
        independentSuccessBodyL1: nonEmpty,
        supportedSuccessTitleL1: nonEmpty,
        supportedSuccessBodyL1: nonEmpty,
        choiceSuccessTitleL1: nonEmpty,
        choiceSuccessBodyL1: nonEmpty,
        repairTitleL1: nonEmpty,
        repairBodyL1: nonEmpty,
      })
      .strict(),
  })
  .strict();

const runtimeNovelContextTransferTaskSchema = runtimeAssessmentTaskBaseSchema
  .extend({
    kind: z.literal("novel_context_transfer"),
    exampleKey: slug,
    scene: z
      .object({
        sceneLabelL1: nonEmpty,
        setupL2: nonEmpty,
        setupL1: nonEmpty,
        visualKind: slug,
        visualAltL1: nonEmpty,
      })
      .strict(),
    questionL1: nonEmpty,
    options: z.array(runtimeTransferOptionSchema).min(2),
    connectionSummary: z
      .object({
        fromLabelL1: nonEmpty,
        toLabelL1: nonEmpty,
        invariantLabelsL1: z.array(nonEmpty).min(1),
      })
      .strict(),
    successTitleL1: nonEmpty,
    successBodyL1: nonEmpty,
  })
  .strict();

const runtimeBoundaryContrastTaskSchema = runtimeAssessmentTaskBaseSchema
  .extend({
    kind: z.literal("boundary_contrast"),
    relationKey: slug,
    exampleKey: slug,
    questionL1: nonEmpty,
    options: z.array(runtimeAssessmentOptionSchema).min(2),
  })
  .strict();

const runtimeAssessmentInventorySchema = z
  .object({
    contextualRecognition: z.array(runtimeContextualRecognitionTaskSchema),
    meaningToFormRecall: z.array(runtimeMeaningToFormRecallTaskSchema),
    novelContextTransfer: z.array(runtimeNovelContextTransferTaskSchema),
    boundaryContrast: z.array(runtimeBoundaryContrastTaskSchema),
  })
  .strict();

const runtimeRepairResourceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("experience_recap"), recapKey: slug }).strict(),
  z.object({ kind: z.literal("experience_render"), renderKey: slug }).strict(),
  z.object({ kind: z.literal("l1_bridge"), assetKey: slug }).strict(),
  z.object({ kind: z.literal("learning_example"), exampleKey: slug }).strict(),
  z.object({ kind: z.literal("sense_features") }).strict(),
  z.object({ kind: z.literal("lexeme_forms") }).strict(),
  z.object({ kind: z.literal("sense_relation"), relationKey: slug }).strict(),
]);

const runtimeRepairAssetBindingSchema = z
  .object({
    bindingKey: slug,
    capability: z.enum([
      "grounding",
      "contextual_recognition",
      "meaning_to_form_recall",
      "novel_context_transfer",
      "boundary_discrimination",
    ]),
    reasonCodes: z.array(slug).min(1),
    strategyKind: z.enum([
      "grounding_replay",
      "meaning_clarification",
      "form_rebinding",
      "varied_context_repair",
      "boundary_clarification",
    ]),
    resourceRefs: z.array(runtimeRepairResourceRefSchema).min(1),
  })
  .strict();

const runtimePracticeManifestSchema = z
  .object({
    profileVersion: z.literal("sensa-initial-free-practice-v1"),
    grants: z.array(
      z
        .object({
          taskFamily: z.enum([
            "immersive_browse",
            "portable_listening",
            "dictation",
            "quick_spelling",
          ]),
          resourceKeys: z.array(slug).min(1),
        })
        .strict(),
    ),
  })
  .strict();

export const sensaRuntimeLearningPackageSchema = z
  .object({
    schemaVersion: z.literal("sensa-sense-learning-package-v1"),
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
    acquisitionProfile: runtimeAcquisitionProfileSchema,
    experience: z
      .object({
        sketch: runtimeExperienceSketchSchema,
        renders: z.array(runtimeExperienceRenderSchema).min(1),
        renderPlan: runtimeRenderPlanSchema,
        recap: runtimeExperienceRecapSchema,
      })
      .strict(),
    l1Bridge: runtimeReviewedTextAssetSchema,
    examples: z.array(runtimeLearningExampleSchema).min(1),
    usagePatterns: z.array(runtimeUsagePatternSchema),
    assessmentInventory: runtimeAssessmentInventorySchema,
    repairBindings: z.array(runtimeRepairAssetBindingSchema),
    practiceManifest: runtimePracticeManifestSchema.optional(),
  })
  .strict();

export const sensaRuntimeLearningReleaseSchema = z
  .object({
    schemaVersion: z.literal("sensa-runtime-learning-release-v1"),
    release: z
      .object({
        releaseKey: slug,
        version: positiveInteger,
        targetLanguage: nonEmpty,
        learnerLocale: nonEmpty,
        deliveryProfileVersion: slug,
        validatorVersion: nonEmpty,
        capabilityResolverVersion: nonEmpty,
        sourceDigest: sha256,
      })
      .strict(),
    media: z.array(runtimeMediaSchema),
    lexemes: z.array(runtimeLexemeSchema).min(1),
    relations: z.array(runtimeRelationSchema),
    packages: z.array(sensaRuntimeLearningPackageSchema).min(1),
  })
  .strict();

export type SensaRuntimeMedia = z.infer<typeof runtimeMediaSchema>;
export type SensaRuntimeLexeme = z.infer<typeof runtimeLexemeSchema>;
export type SensaRuntimeSenseRelation = z.infer<typeof runtimeRelationSchema>;
export type SensaRuntimeExperiencePresentation = z.infer<
  typeof sensaRuntimeExperiencePresentationSchema
>;
export type SensaRuntimeInteractionPayload = z.infer<
  typeof sensaRuntimeInteractionPayloadSchema
>;
export type SensaRuntimeLearningPackage = z.infer<
  typeof sensaRuntimeLearningPackageSchema
>;
export type SensaRuntimeLearningRelease = z.infer<
  typeof sensaRuntimeLearningReleaseSchema
>;

export const sensaRuntimeLearningReleaseSchemaVersion =
  "sensa-runtime-learning-release-v1" as const;
export const sensaRuntimeLearningPackageSchemaVersion =
  "sensa-sense-learning-package-v1" as const;
