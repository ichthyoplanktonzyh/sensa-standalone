import { z } from "zod";

import {
  sensaContentDemandDefinitionSchema,
  sensaLearningContentContractVersion,
  sensaLearningMaterializationContentSchema,
  type SensaLearningMaterializationContent,
} from "./learningContent.js";

export * from "./learningResourceDefinitions.js";
import {sensaLightweightExpressionKindSchema,sensaLightweightExpressionSnapshotSchema,sensaLightweightSenseSnapshotSchema,sensaLightweightOriginExperienceSchema,sensaLightweightReferenceFactSchema,sensaLightweightTargetExpressionMaterialSchema,sensaLightweightExperienceRecallCueSchema,sensaLightweightRecallSupportSchema,LEARNING_RESOURCE_DEFINITIONS} from "./learningResourceDefinitions.js";
export type SensaLightweightInitialMaterialRole = keyof typeof LIGHTWEIGHT_RESOURCE_PROFILE;

export const LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_KEY =
  "lightweight-initial-content" as const;
export const LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_VERSION = "v3" as const;
export const LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION =
  "lightweight-initial-materialization-v3" as const;

/** The two-stage lightweight composition; adding a resource does not change the state machine. */
export const LIGHTWEIGHT_RESOURCE_PROFILE = {
  experience_recall_cue: {required:true,maxItems:1,phase:'pre_reveal',use:'prompt'},
  recall_support: {required:false,maxItems:4,phase:'pre_reveal',use:'support'},
  target_expression: {required:true,maxItems:1,phase:'post_reveal',use:'reveal'},
  sense_confirmation: {required:true,maxItems:1,phase:'post_reveal',use:'feedback'},
  pronunciation: {required:true,maxItems:1,phase:'post_reveal',use:'support'},
  language_structure: {required:false,maxItems:1,phase:'post_reveal',use:'support'},
  usage_guidance: {required:false,maxItems:4,phase:'post_reveal',use:'support'},
  scene_bridge: {required:true,maxItems:1,phase:'post_reveal',use:'support'},
  scene_realization: {required:true,maxItems:1,phase:'post_reveal',use:'support'},
  etymology: {required:false,maxItems:1,phase:'post_reveal',use:'support'},
} as const satisfies Partial<Record<keyof typeof LEARNING_RESOURCE_DEFINITIONS,{required:boolean;maxItems:number;phase:'pre_reveal'|'post_reveal';use:'prompt'|'support'|'reveal'|'feedback'}>>;
export const LIGHTWEIGHT_INITIAL_MATERIAL_ROLES = Object.freeze(Object.keys(LIGHTWEIGHT_RESOURCE_PROFILE) as SensaLightweightInitialMaterialRole[]);
export const lightweightStepRequirements = (phase:'pre_reveal'|'post_reveal') => LIGHTWEIGHT_INITIAL_MATERIAL_ROLES.filter(key => LIGHTWEIGHT_RESOURCE_PROFILE[key].phase === phase).map(key => ({materialRoleKey:key,use:LIGHTWEIGHT_RESOURCE_PROFILE[key].use,required:LIGHTWEIGHT_RESOURCE_PROFILE[key].required}));

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
  contentSchemaVersion: LEARNING_RESOURCE_DEFINITIONS[materialRoleKey].schemaVersion,
  eligibleStepIntents: input.eligibleStepIntents,
  evidenceEligibility: "none" as const,
  provisioningPolicyId: input.provisioningPolicyId,
  provisioningPolicyVersion: "v1",
  validatorPolicies: input.validatorPolicies,
});

/** Exact, machine-readable resource contract for Lightweight Initial v3. */
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
    materialRoles: LIGHTWEIGHT_INITIAL_MATERIAL_ROLES.map(key => {
      const definition = LEARNING_RESOURCE_DEFINITIONS[key];
      const profile = LIGHTWEIGHT_RESOURCE_PROFILE[key];
      return materialRole(key, {
        required: profile.required, minItems: profile.required ? 1 : 0, maxItems: profile.maxItems,
        contentSchemaId: `resource.${key}`,
        eligibleStepIntents: [profile.phase === 'pre_reveal' ? 'practice' : 'instruction'],
        provisioningPolicyId: definition.generation === 'authority' ? 'lightweight.authoritative-passthrough' : definition.generation === 'source' ? 'lightweight.objective-derivation' : 'lightweight.pedagogical-provisioning',
        validatorPolicies: [SCHEMA_VALIDATOR, ...(definition.generation === 'authority' ? [AUTHORITATIVE_BINDING_VALIDATOR] : definition.generation === 'source' ? [OBJECTIVE_BINDING_VALIDATOR] : [SENSE_ALIGNMENT_VALIDATOR]), ...(profile.phase === 'pre_reveal' ? [PRE_REVEAL_NON_DISCLOSURE_VALIDATOR] : [])],
      });
    }),
    derivations: [{
      derivationKey: "lightweight.pronunciation-from-expression",
      derivationKind: "external_pronunciation_lookup_or_tts",
      inputMaterialRoleKeys: ["target_expression"],
      outputMaterialRoleKey: "pronunciation",
      producerPolicyId: "lightweight.objective-derivation",
      producerPolicyVersion: "v1",
      required: true,
    }],
    assemblyPolicyId: "lightweight.role-indexed-materialization",
    assemblyPolicyVersion: "v1",
  });

export const lightweightInitialRolePayloadSchema = (role: SensaLightweightInitialMaterialRole): z.ZodType => LEARNING_RESOURCE_DEFINITIONS[role].schema;

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
        message: "Materialization content is not pinned to Lightweight Initial Content Demand v3.",
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
      const payloadSchema = lightweightInitialRolePayloadSchema(resource.materialRoleKey as SensaLightweightInitialMaterialRole);
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
      for (const resource of content.resources) {
        const payload = resource.contentPayload;
        if (resource.materialRoleKey === 'pronunciation' && (payload.surface !== targetExpression.data.surface || payload.languageTag !== targetExpression.data.languageTag)) context.addIssue({code:'custom',path:['resources'],message:'Spoken realization must match the exact expression and language.'});
        if (resource.materialRoleKey === 'scene_realization') {
          const start = payload.targetStart as number, end = payload.targetEnd as number;
          if (typeof payload.example !== 'string' || start >= end || end > payload.example.length || ![targetExpression.data.surface,...(targetExpression.data.acceptedForms??[])].some(form=>normalizeDisclosureText(form)===normalizeDisclosureText((payload.example as string).slice(start,end))) || payload.experienceResourceKey !== 'experience_recall_cue:0') context.addIssue({code:'custom',path:['resources'],message:'Scene realization requires an exact target span and experience binding.'});
        }
      }
      const normalizedExpression = normalizeDisclosureText(targetExpression.data.surface);
      const preRevealTexts = content.resources.flatMap((resource) => {
        if (resource.materialRoleKey === "experience_recall_cue") {
          const payload = sensaLightweightExperienceRecallCueSchema.safeParse(
            resource.contentPayload,
          );
          return payload.success ? [payload.data.scene, payload.data.senseFocus, payload.data.html ?? ''] : [];
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
