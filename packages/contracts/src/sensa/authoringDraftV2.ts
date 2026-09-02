import { z } from "zod";
import {
  sensaAuthoringAcquisitionProfileSchema,
  sensaAuthoringAssetProvenanceSchema,
  sensaAuthoringExampleRenderSchema,
  sensaAuthoringExperienceRenderPlanSchema,
  sensaAuthoringExperienceRenderSchema,
  sensaAuthoringExperienceSketchSchema,
  sensaAuthoringLexemeDefinitionSchema,
  sensaAuthoringMediaDefinitionSchema,
  sensaAuthoringReviewedTextAssetSchema,
  sensaAuthoringSenseRelationSchema,
  sensaAuthoringSourceEvidenceSchema,
} from "./authoring.js";

const nonEmpty = z.string().trim().min(1);
const slug = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();

/** A learner-facing compact restatement of an Experience Sketch. */
export const sensaAuthoringExperienceRecapSchema = z
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
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

/** Draft V2 adds an explicit usage-illustration role to the V1 role set. */
export const sensaAuthoringLearningExampleRoleV2Schema = z.enum([
  "study_binding",
  "recognition_assessment",
  "retrieval_repair",
  "transfer_assessment",
  "retention_assessment",
  "usage_illustration",
  "free_practice",
]);

export const sensaAuthoringLearningExampleV2Schema = z
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
    roles: z.array(sensaAuthoringLearningExampleRoleV2Schema).min(1),
    visibility: z.enum(["learning_only", "assessment_only"]),
    renders: z.array(sensaAuthoringExampleRenderSchema).min(1),
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

export const sensaAuthoringUsageExampleBindingSchema = z
  .object({
    bindingKey: slug,
    exampleKey: slug,
    start: nonNegativeInteger,
    end: positiveInteger,
    role: z.enum(["primary", "alternative"]),
  })
  .strict();

export const sensaAuthoringUsageCollocationSchema = z
  .object({
    collocationKey: slug,
    displayTextL2: nonEmpty,
    exampleBindings: z.array(sensaAuthoringUsageExampleBindingSchema).min(1),
  })
  .strict();

export const sensaAuthoringUsagePatternV2Schema = z
  .object({
    patternKey: slug,
    canonicalPattern: nonEmpty,
    registerLabel: nonEmpty.nullable(),
    domainLabel: nonEmpty.nullable(),
    usageRestriction: nonEmpty.nullable(),
    collocations: z.array(sensaAuthoringUsageCollocationSchema).min(1),
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

const assessmentPurposeSchema = z.enum([
  "acquisition_gate",
  "retention_review",
  "relearning_gate",
]);

const assessmentOptionSchema = z
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

const transferOptionSchema = assessmentOptionSchema
  .extend({ detailL1: nonEmpty })
  .strict();

const assessmentTaskBaseSchema = z
  .object({
    taskKey: slug,
    eligiblePurposes: z.array(assessmentPurposeSchema).min(1),
    promptL1: nonEmpty,
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

export const sensaAuthoringContextualRecognitionTaskSchema = assessmentTaskBaseSchema
  .extend({
    kind: z.literal("contextual_recognition"),
    exampleKey: slug,
    questionL1: nonEmpty,
    options: z.array(assessmentOptionSchema).min(2),
    featureLabelsL1: z.array(nonEmpty).min(1),
  })
  .strict();

export const sensaAuthoringMeaningToFormRecallTaskSchema = assessmentTaskBaseSchema
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

export const sensaAuthoringNovelContextTransferTaskSchema = assessmentTaskBaseSchema
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
    options: z.array(transferOptionSchema).min(2),
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

export const sensaAuthoringBoundaryContrastTaskSchema = assessmentTaskBaseSchema
  .extend({
    kind: z.literal("boundary_contrast"),
    relationKey: slug,
    exampleKey: slug,
    questionL1: nonEmpty,
    options: z.array(assessmentOptionSchema).min(2),
  })
  .strict();

export const sensaAuthoringAssessmentTaskSchema = z.discriminatedUnion("kind", [
  sensaAuthoringContextualRecognitionTaskSchema,
  sensaAuthoringMeaningToFormRecallTaskSchema,
  sensaAuthoringNovelContextTransferTaskSchema,
  sensaAuthoringBoundaryContrastTaskSchema,
]);

export const sensaAuthoringAssessmentInventorySchema = z
  .object({
    contextualRecognition: z.array(sensaAuthoringContextualRecognitionTaskSchema),
    meaningToFormRecall: z.array(sensaAuthoringMeaningToFormRecallTaskSchema),
    novelContextTransfer: z.array(sensaAuthoringNovelContextTransferTaskSchema),
    boundaryContrast: z.array(sensaAuthoringBoundaryContrastTaskSchema),
  })
  .strict();

const repairCapabilitySchema = z.enum([
  "grounding",
  "contextual_recognition",
  "meaning_to_form_recall",
  "novel_context_transfer",
  "boundary_discrimination",
]);

const repairStrategySchema = z.enum([
  "grounding_replay",
  "meaning_clarification",
  "form_rebinding",
  "varied_context_repair",
  "boundary_clarification",
]);

export const sensaAuthoringRepairResourceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("experience_recap"), recapKey: slug }).strict(),
  z.object({ kind: z.literal("experience_render"), renderKey: slug }).strict(),
  z.object({ kind: z.literal("l1_bridge"), assetKey: slug }).strict(),
  z.object({ kind: z.literal("learning_example"), exampleKey: slug }).strict(),
  z.object({ kind: z.literal("sense_features") }).strict(),
  z.object({ kind: z.literal("lexeme_forms") }).strict(),
  z.object({ kind: z.literal("sense_relation"), relationKey: slug }).strict(),
]);

export const sensaAuthoringRepairAssetBindingSchema = z
  .object({
    bindingKey: slug,
    capability: repairCapabilitySchema,
    reasonCodes: z.array(slug).min(1),
    strategyKind: repairStrategySchema,
    resourceRefs: z.array(sensaAuthoringRepairResourceRefSchema).min(1),
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

export const sensaAuthoringSensePackageDraftV2Schema = z
  .object({
    schemaVersion: z.literal("sensa-sense-package-definition-v2-draft"),
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
        recap: sensaAuthoringExperienceRecapSchema,
      })
      .strict(),
    l1Bridge: sensaAuthoringReviewedTextAssetSchema,
    examples: z.array(sensaAuthoringLearningExampleV2Schema).min(1),
    usagePatterns: z.array(sensaAuthoringUsagePatternV2Schema),
    assessmentInventory: sensaAuthoringAssessmentInventorySchema,
    repairBindings: z.array(sensaAuthoringRepairAssetBindingSchema),
    practiceManifest: z
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
      .strict()
      .optional(),
    provenance: sensaAuthoringAssetProvenanceSchema,
  })
  .strict();

export const sensaGoldenContentDraftV2BundleSchema = z
  .object({
    schemaVersion: z.literal("sensa-golden-content-bundle-v2-draft"),
    release: z
      .object({
        releaseKey: slug,
        version: positiveInteger,
        targetLanguage: nonEmpty,
        learnerLocale: nonEmpty,
        deliveryProfileVersion: z.literal("sensa-web-prototype-acquisition-v2-draft"),
        status: z.enum(["draft", "approved"]),
      })
      .strict(),
    sources: z.array(sensaAuthoringSourceEvidenceSchema).min(1),
    media: z.array(sensaAuthoringMediaDefinitionSchema),
    lexemes: z.array(sensaAuthoringLexemeDefinitionSchema).min(1),
    relations: z.array(sensaAuthoringSenseRelationSchema),
    packages: z.array(sensaAuthoringSensePackageDraftV2Schema).min(1),
  })
  .strict();

export type SensaAuthoringExperienceRecap = z.infer<typeof sensaAuthoringExperienceRecapSchema>;
export type SensaAuthoringLearningExampleRoleV2 = z.infer<typeof sensaAuthoringLearningExampleRoleV2Schema>;
export type SensaAuthoringLearningExampleV2 = z.infer<typeof sensaAuthoringLearningExampleV2Schema>;
export type SensaAuthoringUsageExampleBinding = z.infer<typeof sensaAuthoringUsageExampleBindingSchema>;
export type SensaAuthoringUsageCollocation = z.infer<typeof sensaAuthoringUsageCollocationSchema>;
export type SensaAuthoringUsagePatternV2 = z.infer<typeof sensaAuthoringUsagePatternV2Schema>;
export type SensaAuthoringContextualRecognitionTask = z.infer<typeof sensaAuthoringContextualRecognitionTaskSchema>;
export type SensaAuthoringMeaningToFormRecallTask = z.infer<typeof sensaAuthoringMeaningToFormRecallTaskSchema>;
export type SensaAuthoringNovelContextTransferTask = z.infer<typeof sensaAuthoringNovelContextTransferTaskSchema>;
export type SensaAuthoringBoundaryContrastTask = z.infer<typeof sensaAuthoringBoundaryContrastTaskSchema>;
export type SensaAuthoringAssessmentTask = z.infer<typeof sensaAuthoringAssessmentTaskSchema>;
export type SensaAuthoringAssessmentInventory = z.infer<typeof sensaAuthoringAssessmentInventorySchema>;
export type SensaAuthoringRepairResourceRef = z.infer<typeof sensaAuthoringRepairResourceRefSchema>;
export type SensaAuthoringRepairAssetBinding = z.infer<typeof sensaAuthoringRepairAssetBindingSchema>;
export type SensaAuthoringSensePackageDraftV2 = z.infer<typeof sensaAuthoringSensePackageDraftV2Schema>;
export type SensaGoldenContentDraftV2Bundle = z.infer<typeof sensaGoldenContentDraftV2BundleSchema>;
