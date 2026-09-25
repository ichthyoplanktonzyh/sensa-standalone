import {z} from "zod";

import {sensaLanguageTagSchema} from "./language.js";
import {sensaLightweightExpressionKindSchema} from "./learningResourceDefinitions.js";
import {
  sensaExpressionBindingRelationSchema,
  sensaExpressionTypeSchema,
  sensaSemanticCoverageSchema,
  sensaSenseSemanticSpecSchema,
} from "./semanticRegistry.js";

export const sensaPortableLightweightPackageFormat =
  "sensa-portable-lightweight-package-v2" as const;

const nonEmpty = z.string().trim().min(1);
const boundedText = (maximum: number) => nonEmpty.max(maximum);
const nullableBoundedText = (maximum: number) => boundedText(maximum).nullable();
const positiveInteger = z.number().int().positive();
const mediaId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const webUrl = z.url().refine((value) => /^https?:/u.test(value), "HTTP(S) URL required");

const textResource = z.object({text: boundedText(8_000)}).strict();
const sourcedTextResource = z.object({
  text: boundedText(8_000),
  source: boundedText(500),
  sourceUrl: webUrl,
}).strict();

export const sensaPortableLightweightMediaSchema = z.object({
  mediaId,
  kind: z.enum(["audio", "image"]),
  mimeType: boundedText(200),
  sha256,
  sizeBytes: positiveInteger,
  attribution: z.object({
    creator: boundedText(500).optional(),
    source: boundedText(1_000).optional(),
    license: boundedText(500).optional(),
  }).strict().optional(),
}).strict();

export const sensaPortableLightweightSemanticDeclarationSchema = z.object({
  contractVersion: z.literal("sensa-portable-semantic-declaration-v1"),
  sense: z.object({
    senseId: z.string().uuid(),
    senseVersionId: z.string().uuid(),
    senseKey: boundedText(500),
    versionNumber: positiveInteger,
    semanticPolicyVersion: boundedText(500),
    semanticSpec: sensaSenseSemanticSpecSchema,
  }).strict(),
  expression: z.object({
    expressionId: z.string().uuid(),
    expressionVersionId: z.string().uuid(),
    versionNumber: positiveInteger,
    expressionType: sensaExpressionTypeSchema,
    structure: z.record(z.string(), z.unknown()),
  }).strict(),
  binding: z.object({
    senseExpressionBindingId: z.string().uuid(),
    bindingVersionId: z.string().uuid(),
    versionNumber: positiveInteger,
    relation: sensaExpressionBindingRelationSchema,
    semanticCoverage: sensaSemanticCoverageSchema,
    registerLabel: nullableBoundedText(500),
    usageConstraints: z.array(boundedText(2_000)).max(100),
  }).strict(),
}).strict();

const portableLightweightPackageShape = {
  metadata: z.object({
    packageId: z.string().uuid(),
    version: positiveInteger,
    title: boundedText(500),
    description: z.string().trim().max(2_000),
    createdAt: z.string().datetime({offset: true}),
    author: z.object({
      name: boundedText(500),
      url: webUrl.optional(),
    }).strict(),
    license: z.object({
      name: boundedText(500),
      url: webUrl.optional(),
    }).strict(),
    sources: z.array(z.object({
      title: boundedText(500),
      url: webUrl.optional(),
    }).strict()).max(50).optional(),
  }).strict(),
  route: z.object({
    targetLanguage: sensaLanguageTagSchema,
    supportLanguage: sensaLanguageTagSchema,
  }).strict(),
  sense: z.object({
    senseId: boundedText(300),
    meaning: boundedText(8_000),
  }).strict(),
  targetExpression: z.object({
    text: boundedText(500),
    expressionKind: sensaLightweightExpressionKindSchema,
    spokenForm: boundedText(500).optional(),
    acceptedForms: z.array(boundedText(500)).max(50).optional(),
  }).strict(),
  resources: z.object({
    experienceRecallCue: z.object({
      text: z.string().trim().max(8_000).optional(),
      senseFocus: boundedText(4_000),
      images: z.array(z.object({
        mediaId,
        altText: boundedText(2_000),
      }).strict()).max(4).optional(),
    }).strict().refine(
      (cue) => (cue.text?.length ?? 0) > 0 || (cue.images?.length ?? 0) > 0,
      "Experience recall content requires text or an image",
    ),
    senseConfirmation: textResource,
    pronunciation: z.object({
      surface: boundedText(500),
      audioMediaId: mediaId,
      method: z.enum(["recording", "tts"]),
      source: boundedText(1_000),
      phoneticNotation: nullableBoundedText(500).optional(),
      accentLabel: nullableBoundedText(500).optional(),
    }).strict(),
    sceneBridge: textResource,
    sceneRealization: z.object({
      example: boundedText(8_000),
      translation: boundedText(8_000),
      targetStart: z.number().int().nonnegative(),
      targetEnd: positiveInteger,
      audioMediaId: mediaId.optional(),
    }).strict(),
    optional: z.object({
      recallSupport: z.array(textResource).max(4).optional(),
      languageStructure: z.object({
        expressionTypeLabel: nullableBoundedText(500),
        partOfSpeech: nullableBoundedText(500),
        usagePattern: nullableBoundedText(2_000).optional(),
        contrastNote: nullableBoundedText(2_000).optional(),
      }).strict().optional(),
      usageGuidance: z.array(z.object({
        example: boundedText(8_000),
        translation: nullableBoundedText(8_000).optional(),
        audioMediaId: mediaId.optional(),
      }).strict()).max(4).optional(),
      boundaryContrast: sourcedTextResource.optional(),
      wordFormation: sourcedTextResource.optional(),
      mnemonic: textResource.optional(),
      etymology: sourcedTextResource.optional(),
    }).strict(),
  }).strict(),
  media: z.array(sensaPortableLightweightMediaSchema).max(64),
};

export const sensaPortableLightweightPackageSchema = z.object({
  format: z.literal(sensaPortableLightweightPackageFormat),
  ...portableLightweightPackageShape,
  semanticDeclaration: sensaPortableLightweightSemanticDeclarationSchema.optional(),
}).strict();

export type SensaPortableLightweightMedia = z.infer<
  typeof sensaPortableLightweightMediaSchema
>;
export type SensaPortableLightweightSemanticDeclaration = z.infer<
  typeof sensaPortableLightweightSemanticDeclarationSchema
>;
export type SensaPortableLightweightPackage = z.infer<
  typeof sensaPortableLightweightPackageSchema
>;
