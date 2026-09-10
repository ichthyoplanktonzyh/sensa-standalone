import {sensaContextImagesSchema,sensaInteractiveHtmlSchema} from './richExperience.js';
import { z } from "zod";

import {
  sensaContentDemandDefinitionSchema,
  sensaLearningContentContractVersion,
  sensaLearningMaterializationContentSchema,
  type SensaLearningMaterializationContent,
} from "./learningContent.js";

const nonEmpty = z.string().trim().min(1);
const nullableNonEmpty = nonEmpty.nullable();

export const sensaLightweightExpressionKindSchema = z.enum([
  "word",
  "phrase",
  "construction",
  "utterance",
  "unspecified",
]);

export const sensaLightweightExpressionSnapshotSchema = z
  .object({
    surface: nonEmpty,
    languageTag: nonEmpty,
    expressionKind: sensaLightweightExpressionKindSchema,
  })
  .strict();

export const sensaLightweightSenseSnapshotSchema = z
  .object({
    meaning: nonEmpty,
    familiarLanguageTag: nonEmpty,
  })
  .strict();

export const sensaLightweightOriginExperienceSchema = z
  .object({
    scene: z.string().trim(),
    senseFocus: nonEmpty,
    featureLabels: z.array(nonEmpty).max(4),
    images: sensaContextImagesSchema.optional(),
  })
  .strict();

export const sensaLightweightReferenceFactSchema = z.discriminatedUnion("factKind", [
  z.object({
    factKind: z.literal("pronunciation"),
    audioUrl: nullableNonEmpty,
    phoneticNotation: nullableNonEmpty,
    accentLabel: nullableNonEmpty,
  }).strict().superRefine((fact, context) => {
    if (fact.audioUrl === null && fact.phoneticNotation === null) {
      context.addIssue({
        code: "custom",
        path: ["phoneticNotation"],
        message: "A pronunciation fact requires audio or phonetic notation.",
      });
    }
  }),
  z.object({
    factKind: z.literal("language_structure"),
    expressionTypeLabel: nullableNonEmpty,
    partOfSpeech: nullableNonEmpty,
  }).strict().superRefine((fact, context) => {
    if (fact.expressionTypeLabel === null && fact.partOfSpeech === null) {
      context.addIssue({
        code: "custom",
        path: ["expressionTypeLabel"],
        message: "A language-structure fact requires at least one label.",
      });
    }
  }),
  z.object({
    factKind: z.literal("usage_example"),
    example: nonEmpty,
  }).strict(),
]);

export const sensaLightweightExperienceRecallCueSchema = z
  .object({ scene: z.string().trim(), senseFocus: nonEmpty, images:sensaContextImagesSchema.optional(), html:sensaInteractiveHtmlSchema.optional() })
  .strict().refine(c=>!!c.scene||!!c.images?.length||!!c.html,"Experience content is required");
export const sensaLightweightRecallSupportSchema = z
  .object({ text: nonEmpty })
  .strict();
export const sensaLightweightTargetExpressionMaterialSchema = z
  .object({ surface: nonEmpty })
  .strict();
export const sensaLightweightSenseConfirmationMaterialSchema = z
  .object({ meaning: nonEmpty })
  .strict();
export const sensaLightweightPronunciationMaterialSchema = z
  .object({
    audioUrl: nullableNonEmpty,
    phoneticNotation: nullableNonEmpty,
    accentLabel: nullableNonEmpty,
  })
  .strict()
  .superRefine((material, context) => {
    if (material.audioUrl === null && material.phoneticNotation === null) {
      context.addIssue({
        code: "custom",
        path: ["phoneticNotation"],
        message: "Pronunciation material requires audio or phonetic notation.",
      });
    }
  });
export const sensaLightweightLanguageStructureMaterialSchema = z
  .object({
    expressionKind: sensaLightweightExpressionKindSchema,
    expressionTypeLabel: nullableNonEmpty,
    partOfSpeech: nullableNonEmpty,
  })
  .strict();
export const sensaLightweightUsageGuidanceMaterialSchema = z
  .object({ example: nonEmpty })
  .strict();
export const sensaLightweightSceneBridgeMaterialSchema = z
  .object({ text: nonEmpty })
  .strict();

export const LIGHTWEIGHT_INITIAL_MATERIAL_ROLES = Object.freeze([
  "experience_recall_cue",
  "recall_support",
  "target_expression",
  "sense_confirmation",
  "pronunciation",
  "language_structure",
  "usage_guidance",
  "scene_bridge",
] as const);

export type SensaLightweightInitialMaterialRole =
  typeof LIGHTWEIGHT_INITIAL_MATERIAL_ROLES[number];

export const LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_KEY =
  "lightweight-initial-content" as const;
export const LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_VERSION = "v1" as const;
export const LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION =
  "lightweight-initial-materialization-v1" as const;

const SCHEMA_VALIDATOR = Object.freeze({
  validatorPolicyId: "lightweight.schema",
  validatorVersion: "v1",
});
const AUTHORITATIVE_BINDING_VALIDATOR = Object.freeze({
  validatorPolicyId: "lightweight.authoritative-binding",
  validatorVersion: "v1",
});
const SENSE_ALIGNMENT_VALIDATOR = Object.freeze({
  validatorPolicyId: "lightweight.sense-alignment",
  validatorVersion: "v1",
});
const PRE_REVEAL_NON_DISCLOSURE_VALIDATOR = Object.freeze({
  validatorPolicyId: "lightweight.pre-reveal-non-disclosure",
  validatorVersion: "v1",
});
const OBJECTIVE_BINDING_VALIDATOR = Object.freeze({
  validatorPolicyId: "lightweight.objective-derivation-binding",
  validatorVersion: "v1",
});

const materialRole = (
  materialRoleKey: SensaLightweightInitialMaterialRole,
  input: Readonly<{
    required: boolean;
    minItems: number;
    maxItems: number;
    contentSchemaId: string;
    eligibleStepIntents: readonly ("instruction" | "practice")[];
    provisioningPolicyId: string;
    validatorPolicies: readonly Readonly<{
      validatorPolicyId: string;
      validatorVersion: string;
    }>[];
  }>,
) => ({
  materialRoleKey,
  required: input.required,
  minItems: input.minItems,
  maxItems: input.maxItems,
  contentSchemaId: input.contentSchemaId,
  contentSchemaVersion: "v1",
  eligibleStepIntents: input.eligibleStepIntents,
  evidenceEligibility: "none" as const,
  provisioningPolicyId: input.provisioningPolicyId,
  provisioningPolicyVersion: "v1",
  validatorPolicies: input.validatorPolicies,
});

/** Exact, machine-readable resource contract for Lightweight Initial v2. */
export const SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND =
  sensaContentDemandDefinitionSchema.parse({
    contractVersion: sensaLearningContentContractVersion,
    contentDemandKey: LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_KEY,
    definitionVersion: LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_VERSION,
    applicablePurposes: ["initial_learning"],
    acceptedProvisioningPaths: ["published", "on_demand", "hybrid"],
    contextRequirements: [
      {
        contextKind: "expression_snapshot",
        required: true,
        minItems: 1,
        maxItems: 1,
        contentSchemaId: "lightweight.expression-snapshot",
        contentSchemaVersion: "v1",
        acceptedSources: ["target_expression"],
      },
      {
        contextKind: "sense_snapshot",
        required: true,
        minItems: 1,
        maxItems: 1,
        contentSchemaId: "lightweight.sense-snapshot",
        contentSchemaVersion: "v1",
        acceptedSources: ["confirmed_sense"],
      },
      {
        contextKind: "origin_experience",
        required: false,
        minItems: 0,
        maxItems: 1,
        contentSchemaId: "lightweight.origin-experience",
        contentSchemaVersion: "v1",
        acceptedSources: ["personal_anchor", "other_authoritative_source"],
      },
      {
        contextKind: "reference_fact",
        required: false,
        minItems: 0,
        maxItems: null,
        contentSchemaId: "lightweight.reference-fact",
        contentSchemaVersion: "v1",
        acceptedSources: [
          "dictionary",
          "corpus",
          "pronunciation_lexicon",
          "other_authoritative_source",
        ],
      },
    ],
    materialRoles: [
      materialRole("experience_recall_cue", {
        required: true,
        minItems: 1,
        maxItems: 1,
        contentSchemaId: "lightweight.experience-recall-cue",
        eligibleStepIntents: ["practice"],
        provisioningPolicyId: "lightweight.pedagogical-provisioning",
        validatorPolicies: [
          SCHEMA_VALIDATOR,
          SENSE_ALIGNMENT_VALIDATOR,
          PRE_REVEAL_NON_DISCLOSURE_VALIDATOR,
        ],
      }),
      materialRole("recall_support", {
        required: false,
        minItems: 0,
        maxItems: 4,
        contentSchemaId: "lightweight.recall-support",
        eligibleStepIntents: ["practice"],
        provisioningPolicyId: "lightweight.pedagogical-provisioning",
        validatorPolicies: [SCHEMA_VALIDATOR, PRE_REVEAL_NON_DISCLOSURE_VALIDATOR],
      }),
      materialRole("target_expression", {
        required: true,
        minItems: 1,
        maxItems: 1,
        contentSchemaId: "lightweight.target-expression",
        eligibleStepIntents: ["instruction"],
        provisioningPolicyId: "lightweight.authoritative-passthrough",
        validatorPolicies: [SCHEMA_VALIDATOR, AUTHORITATIVE_BINDING_VALIDATOR],
      }),
      materialRole("sense_confirmation", {
        required: true,
        minItems: 1,
        maxItems: 1,
        contentSchemaId: "lightweight.sense-confirmation",
        eligibleStepIntents: ["instruction"],
        provisioningPolicyId: "lightweight.authoritative-passthrough",
        validatorPolicies: [SCHEMA_VALIDATOR, AUTHORITATIVE_BINDING_VALIDATOR],
      }),
      materialRole("pronunciation", {
        required: false,
        minItems: 0,
        maxItems: 1,
        contentSchemaId: "lightweight.pronunciation",
        eligibleStepIntents: ["instruction"],
        provisioningPolicyId: "lightweight.objective-derivation",
        validatorPolicies: [SCHEMA_VALIDATOR, OBJECTIVE_BINDING_VALIDATOR],
      }),
      materialRole("language_structure", {
        required: false,
        minItems: 0,
        maxItems: 1,
        contentSchemaId: "lightweight.language-structure",
        eligibleStepIntents: ["instruction"],
        provisioningPolicyId: "lightweight.pedagogical-provisioning",
        validatorPolicies: [SCHEMA_VALIDATOR, SENSE_ALIGNMENT_VALIDATOR],
      }),
      materialRole("usage_guidance", {
        required: false,
        minItems: 0,
        maxItems: 1,
        contentSchemaId: "lightweight.usage-guidance",
        eligibleStepIntents: ["instruction"],
        provisioningPolicyId: "lightweight.pedagogical-provisioning",
        validatorPolicies: [SCHEMA_VALIDATOR, SENSE_ALIGNMENT_VALIDATOR],
      }),
      materialRole("scene_bridge", {
        required: false,
        minItems: 0,
        maxItems: 1,
        contentSchemaId: "lightweight.scene-bridge",
        eligibleStepIntents: ["instruction"],
        provisioningPolicyId: "lightweight.pedagogical-provisioning",
        validatorPolicies: [SCHEMA_VALIDATOR, SENSE_ALIGNMENT_VALIDATOR],
      }),
    ],
    derivations: [{
      derivationKey: "lightweight.pronunciation-from-expression",
      derivationKind: "external_pronunciation_lookup_or_tts",
      inputMaterialRoleKeys: ["target_expression"],
      outputMaterialRoleKey: "pronunciation",
      producerPolicyId: "lightweight.objective-derivation",
      producerPolicyVersion: "v1",
      required: false,
    }],
    assemblyPolicyId: "lightweight.role-indexed-materialization",
    assemblyPolicyVersion: "v1",
  });

const rolePayloadSchemas: Readonly<Record<SensaLightweightInitialMaterialRole, z.ZodType>> = {
  experience_recall_cue: sensaLightweightExperienceRecallCueSchema,
  recall_support: sensaLightweightRecallSupportSchema,
  target_expression: sensaLightweightTargetExpressionMaterialSchema,
  sense_confirmation: sensaLightweightSenseConfirmationMaterialSchema,
  pronunciation: sensaLightweightPronunciationMaterialSchema,
  language_structure: sensaLightweightLanguageStructureMaterialSchema,
  usage_guidance: sensaLightweightUsageGuidanceMaterialSchema,
  scene_bridge: sensaLightweightSceneBridgeMaterialSchema,
};

export const lightweightInitialRolePayloadSchema = (
  role: SensaLightweightInitialMaterialRole,
): z.ZodType => rolePayloadSchemas[role];

const normalizeDisclosureText = (value: string): string => value
  .normalize("NFKC")
  .trim()
  .replace(/\s+/gu, " ")
  .toLocaleLowerCase();

/** Persisted payload validation does not rely on the generation request still being present. */
export const sensaLightweightInitialMaterializationContentSchema =
  sensaLearningMaterializationContentSchema.superRefine((content, context) => {
    if (
      content.contentDemandKey !== LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_KEY
      || content.definitionVersion !== LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_VERSION
    ) {
      context.addIssue({
        code: "custom",
        path: ["contentDemandKey"],
        message: "Materialization content is not pinned to Lightweight Initial Content Demand v1.",
      });
    }
    const demandRoles = new Map(SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND.materialRoles.map(
      (role) => [role.materialRoleKey, role],
    ));
    const counts = new Map<string, number>();
    content.resources.forEach((resource, index) => {
      const role = demandRoles.get(resource.materialRoleKey);
      if (!role) {
        context.addIssue({
          code: "custom",
          path: ["resources", index, "materialRoleKey"],
          message: `Unknown Lightweight Initial material role: ${resource.materialRoleKey}`,
        });
        return;
      }
      counts.set(resource.materialRoleKey, (counts.get(resource.materialRoleKey) ?? 0) + 1);
      if (resource.resourceKey !== `${resource.materialRoleKey}:${resource.ordinal}`) {
        context.addIssue({
          code: "custom",
          path: ["resources", index, "resourceKey"],
          message: "Materialized resource key must be derived from its role and ordinal.",
        });
      }
      if (
        resource.contentSchemaId !== role.contentSchemaId
        || resource.contentSchemaVersion !== role.contentSchemaVersion
      ) {
        context.addIssue({
          code: "custom",
          path: ["resources", index],
          message: `Materialized resource schema does not match role ${resource.materialRoleKey}.`,
        });
      }
      if (
        resource.producerPolicyId !== role.provisioningPolicyId
        || resource.producerPolicyVersion !== role.provisioningPolicyVersion
      ) {
        context.addIssue({
          code: "custom",
          path: ["resources", index, "producerPolicyId"],
          message: `Materialized resource policy does not match role ${resource.materialRoleKey}.`,
        });
      }
      const payloadSchema = rolePayloadSchemas[
        resource.materialRoleKey as SensaLightweightInitialMaterialRole
      ];
      const parsedPayload = payloadSchema.safeParse(resource.contentPayload);
      if (!parsedPayload.success) {
        context.addIssue({
          code: "custom",
          path: ["resources", index, "contentPayload"],
          message: `Invalid payload for Lightweight Initial role ${resource.materialRoleKey}.`,
        });
      }
    });
    for (const role of SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND.materialRoles) {
      const count = counts.get(role.materialRoleKey) ?? 0;
      if (count < role.minItems || (role.maxItems !== null && count > role.maxItems)) {
        context.addIssue({
          code: "custom",
          path: ["resources"],
          message: `Materialized role cardinality is invalid: ${role.materialRoleKey}.`,
        });
      }
    }

    const targetExpressionResource = content.resources.find((resource) =>
      resource.materialRoleKey === "target_expression");
    const targetExpression = targetExpressionResource
      ? sensaLightweightTargetExpressionMaterialSchema.safeParse(
        targetExpressionResource.contentPayload,
      )
      : null;
    if (targetExpression?.success) {
      const normalizedExpression = normalizeDisclosureText(targetExpression.data.surface);
      const preRevealTexts = content.resources.flatMap((resource) => {
        if (resource.materialRoleKey === "experience_recall_cue") {
          const payload = sensaLightweightExperienceRecallCueSchema.safeParse(
            resource.contentPayload,
          );
          return payload.success ? [payload.data.scene, payload.data.senseFocus] : [];
        }
        if (resource.materialRoleKey === "recall_support") {
          const payload = sensaLightweightRecallSupportSchema.safeParse(resource.contentPayload);
          return payload.success ? [payload.data.text] : [];
        }
        return [];
      });
      if (
        normalizedExpression.length > 0
        && preRevealTexts.some((value) =>
          normalizeDisclosureText(value).includes(normalizedExpression))
      ) {
        context.addIssue({
          code: "custom",
          path: ["resources"],
          message: "Pre-reveal Lightweight material discloses the target expression.",
        });
      }
    }
  });

export type SensaLightweightExpressionKind = z.infer<
  typeof sensaLightweightExpressionKindSchema
>;
export type SensaLightweightExpressionSnapshot = z.infer<
  typeof sensaLightweightExpressionSnapshotSchema
>;
export type SensaLightweightSenseSnapshot = z.infer<
  typeof sensaLightweightSenseSnapshotSchema
>;
export type SensaLightweightOriginExperience = z.infer<
  typeof sensaLightweightOriginExperienceSchema
>;
export type SensaLightweightReferenceFact = z.infer<
  typeof sensaLightweightReferenceFactSchema
>;
export type SensaLightweightInitialMaterializationContent =
  SensaLearningMaterializationContent & z.infer<
    typeof sensaLightweightInitialMaterializationContentSchema
  >;
