import { z } from "zod";
import { sensaSemanticPolicyDecisionCodes } from "./semanticPolicyVocabulary.js";

/** Runtime schemas for serialized learning-kernel values. */
const jsonObjectSchema = z.record(z.string(), z.unknown());
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export const canonicalObjectPayloadSchema = z
  .object({ object: jsonObjectSchema, digest: sha256Schema })
  .strict();

export const learningAssetRoleSchema = z.enum([
  "experience_sketch",
  "l1_bridge",
  "study_example",
  "quiz_example",
  "boundary",
  "pronunciation",
  "study_example_audio",
  "extended_audio",
]);

export const learningAssetReferenceSchema = z
  .object({
    learningAssetId: z.string().min(1),
    ordinal: z.number().int().positive(),
    role: learningAssetRoleSchema,
  })
  .strict();

const schemaVersion = z.literal("sensa-learning-action-v3");

export const learningActionPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("grounding_bind"), schemaVersion }).strict(),
  z
    .object({
      kind: z.literal("boundary_discrimination"),
      schemaVersion,
      choices: z
        .array(
          z
            .object({
              choiceId: z.enum(["choice_a", "choice_b"]),
              text: z.string().min(1),
            })
            .strict(),
        )
        .length(2),
    })
    .strict(),
  z
    .object({
      kind: z.literal("meaning_to_form_recall"),
      schemaVersion,
      prompt: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("cloze_recall"),
      schemaVersion,
      exampleAssetId: z.string().min(1),
      maskedText: z.string().min(1),
      contextNovelty: z.enum(["familiar", "novel"]),
    })
    .strict(),
  z.object({ kind: z.literal("retrieval_repair"), schemaVersion }).strict(),
]);

/** Closed canonical payload for the serialized Action boundary. */
export const canonicalLearningActionPayloadSchema = z
  .object({ object: learningActionPayloadSchema, digest: sha256Schema })
  .strict();

export const learningActionSchema = z
  .object({
    learningActionId: z.string().min(1),
    ordinal: z.number().int().positive(),
    targetDimension: z.enum([
      "grounding",
      "boundary",
      "form_mapping",
      "retrieval",
      "transfer",
    ]),
    primitive: z.enum([
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
    ]),
    scaffoldLevel: z.enum(["full", "reduced", "minimal", "none"]),
    rendererKind: z.enum(["content", "single_choice", "text_input"]),
    semanticPolicyDecisionCode: z.enum(sensaSemanticPolicyDecisionCodes),
    actionSchemaVersion: schemaVersion,
    evidenceRuleVersion: z.enum([
      "sensa-evidence-rule-v1",
      "sensa-evidence-rule-v2",
    ]),
    actionPayload: canonicalLearningActionPayloadSchema,
    actionDigest: sha256Schema,
    assets: z.array(learningAssetReferenceSchema),
  })
  .strict()
  .superRefine((action, context) => {
    const payload = action.actionPayload.object;
    const expectedRoles = payload.kind === "grounding_bind"
      ? [
          "experience_sketch",
          "l1_bridge",
          "study_example",
          "study_example",
          "study_example",
          "pronunciation",
          "study_example_audio",
          "study_example_audio",
          "study_example_audio",
        ]
      : payload.kind === "retrieval_repair"
        ? ["experience_sketch", "l1_bridge", "study_example", "study_example_audio"]
        : null;
    if (expectedRoles !== null && (action.assets.length !== expectedRoles.length
      || action.assets.some((asset, index) => asset.role !== expectedRoles[index]))) {
      context.addIssue({
        code: "custom",
        path: ["assets"],
        message: "This Action kind requires a deterministic ordered asset sequence.",
      });
    }
  });

export const learningResponsePayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("acknowledgement"), acknowledged: z.literal(true) })
    .strict(),
  z
    .object({ kind: z.literal("single_choice"), choiceId: z.enum(["choice_a", "choice_b"]) })
    .strict(),
  z.object({ kind: z.literal("text_input"), answer: z.string() }).strict(),
]);

/** Closed canonical payload for the serialized Attempt response boundary. */
export const canonicalLearningResponsePayloadSchema = z
  .object({ object: learningResponsePayloadSchema, digest: sha256Schema })
  .strict();

export const responsePayloadSchema = z
  .object({ object: jsonObjectSchema, digest: sha256Schema })
  .strict();

export const actionSchemaVersion = schemaVersion;

export type ParsedLearningAction = z.infer<typeof learningActionSchema>;
export type ParsedLearningActionPayload = z.infer<typeof learningActionPayloadSchema>;
export type ParsedLearningResponsePayload = z.infer<typeof learningResponsePayloadSchema>;
