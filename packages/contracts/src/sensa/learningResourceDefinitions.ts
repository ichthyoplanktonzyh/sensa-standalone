import {sensaSenseSemanticSpecSchema} from './semanticRegistry.js';
import {z} from "zod";
import {sensaContextImagesSchema,sensaInteractiveHtmlSchema} from "./richExperience.js";
const nonEmpty = z.string().trim().min(1);
const nullableNonEmpty = nonEmpty.nullable();

export const sensaLightweightExpressionKindSchema = z.enum([
  "word",
  "phrase",
  "construction",
  "utterance",
  "sentence",
  "unspecified",
]);

export const sensaLightweightExpressionSnapshotSchema = z
  .object({
    surface: nonEmpty,
    languageTag: nonEmpty,
    expressionKind: sensaLightweightExpressionKindSchema,
    spokenForm: nonEmpty.optional(),
    acceptedForms: z.array(nonEmpty).max(50).optional(),
    formParts: z.array(z.object({kind:z.enum(['fixed','slot']),text:nonEmpty,constraint:nonEmpty.optional()}).strict()).max(30).optional(),
  })
  .strict();

export const sensaLightweightSenseSnapshotSchema = z
  .object({
    meaning: nonEmpty,
    semanticSpec: sensaSenseSemanticSpecSchema.optional(),
    supportLanguageTag: nonEmpty,
  })
  .strict();

export const sensaLightweightOriginExperienceSchema = z
  .object({
    scene: z.string().trim(),
    senseFocus: nonEmpty,
    featureLabels: z.array(nonEmpty).max(4),
    sceneBridge: nonEmpty.optional(),
    sceneRealization: z.object({example: nonEmpty, targetStart: z.number().int().nonnegative(), targetEnd: z.number().int().positive(), translation: nullableNonEmpty.optional(), audioUrl: nullableNonEmpty.optional()}).strict().optional(),
    images: sensaContextImagesSchema.optional(),
  })
  .strict();

export const sensaEtymologySchema = z.object({
  explanation: nonEmpty,
  source: nonEmpty,
  sourceUrl: z.url().refine(value => /^https?:/.test(value), 'HTTP source required'),
}).strict();

export const sensaSourcedExplanationSchema=z.object({explanation:nonEmpty,source:nonEmpty,sourceUrl:z.url().refine(v=>/^https?:/.test(v))}).strict();
export const sensaMnemonicSchema=z.object({text:nonEmpty,kind:z.literal('teaching_aid')}).strict();

export const sensaLightweightPronunciationMaterialSchema = z.object({
  audioUrl: z.string().regex(/^data:audio\/(?:mpeg|mp3|wav|ogg);base64,[A-Za-z0-9+/]+={0,2}$/u, 'Saved audio bytes are required'),
  surface: nonEmpty,
  languageTag: nonEmpty,
  source: nonEmpty,
  method: z.enum(['recording','tts']),
  phoneticNotation: nullableNonEmpty,
  accentLabel: nullableNonEmpty,
}).strict();

export const sensaLightweightReferenceFactSchema = z.discriminatedUnion("factKind", [
  sensaSourcedExplanationSchema.extend({factKind:z.literal('boundary_contrast')}),
  sensaSourcedExplanationSchema.extend({factKind:z.literal('word_formation')}),
  sensaMnemonicSchema.extend({factKind:z.literal('mnemonic')}),
  z.object({factKind:z.literal('resource_scope'),assessments:z.record(z.string(),z.object({applicable:z.boolean(),reason:nonEmpty,source:nonEmpty}).strict())}).strict(),
  sensaEtymologySchema.extend({factKind:z.literal("etymology")}),
  sensaLightweightPronunciationMaterialSchema.extend({factKind:z.literal("pronunciation")}),
  z.object({
    factKind: z.literal("language_structure"),
    expressionTypeLabel: nullableNonEmpty,
    partOfSpeech: nullableNonEmpty,
    usagePattern: nullableNonEmpty.optional(),
    contrastNote: nullableNonEmpty.optional(),
  }).strict().superRefine((fact, context) => {
    if (
      fact.expressionTypeLabel === null
      && fact.partOfSpeech === null
      && !fact.usagePattern
      && !fact.contrastNote
    ) {
      context.addIssue({
        code: "custom",
        path: ["expressionTypeLabel"],
        message: "A language-structure fact requires at least one useful field.",
      });
    }
  }),
  z.object({
    factKind: z.literal("usage_example"),
    example: nonEmpty,
    translation: nullableNonEmpty.optional(),
    audioUrl: nullableNonEmpty.optional(),
  }).strict(),
]);

export const sensaLightweightExperienceRecallCueSchema = z
  .object({ scene: z.string().trim(), senseFocus: nonEmpty, images:sensaContextImagesSchema.optional(), html:sensaInteractiveHtmlSchema.optional() })
  .strict().refine(c=>!!c.scene||!!c.images?.length||!!c.html,"Experience content is required");
export const sensaLightweightRecallSupportSchema = z
  .object({ text: nonEmpty })
  .strict();
export const sensaLightweightTargetExpressionMaterialSchema = sensaLightweightExpressionSnapshotSchema;
export const sensaLightweightSenseConfirmationMaterialSchema = z
  .object({ meaning: nonEmpty })
  .strict();
export const sensaLightweightLanguageStructureMaterialSchema = z
  .object({
    expressionKind: sensaLightweightExpressionKindSchema,
    expressionTypeLabel: nullableNonEmpty,
    partOfSpeech: nullableNonEmpty,
    usagePattern: nullableNonEmpty.optional(),
    contrastNote: nullableNonEmpty.optional(),
  })
  .strict();
export const sensaLightweightUsageGuidanceMaterialSchema = z
  .object({
    example: nonEmpty,
    translation: nullableNonEmpty.optional(),
    audioUrl: nullableNonEmpty.optional(),
  })
  .strict();
export const sensaLightweightSceneBridgeMaterialSchema = z
  .object({ text: nonEmpty })
  .strict();


export const sensaSceneRealizationSchema = z.object({
  example: nonEmpty,
  targetStart: z.number().int().nonnegative(),
  targetEnd: z.number().int().positive(),
  translation: nullableNonEmpty.optional(),
  audioUrl: nullableNonEmpty.optional(),
  experienceResourceKey: z.literal('experience_recall_cue:0'),
}).strict();
/** Shared content semantics. React and learning progression do not belong here. */
const definition = <S extends z.ZodType>(schema:S, input:{
  label:{'zh-CN':string;en:string};
  generation:'authority'|'source'|'model';
  instruction:string;
  fields:readonly string[];
}) => Object.freeze({schema, schemaVersion:'v1' as const, ...input});
export const LEARNING_RESOURCE_DEFINITIONS = Object.freeze({
  experience_recall_cue: definition(sensaLightweightExperienceRecallCueSchema, {label:{'zh-CN':'经验建立／回想',en:'Experience'},generation:'model',instruction:'Create or faithfully paraphrase the supplied experience in the support language. Never reveal the target expression. Personal experience must not gain invented details. Images may only reference supplied imageIds. Offline declarative HTML is permitted.',fields:['scene','senseFocus']}),
  recall_support: definition(sensaLightweightRecallSupportSchema,{label:{'zh-CN':'回想提示',en:'Recall hint'},generation:'model',instruction:'Optional support-language hint; do not reveal the target expression.',fields:['text']}),
  target_expression: definition(sensaLightweightTargetExpressionMaterialSchema,{label:{'zh-CN':'目标表达',en:'Target expression'},generation:'authority',instruction:'Copy the exact accepted expression snapshot; never replace the binding.',fields:['surface','formParts','acceptedForms','expressionKind','languageTag']}),
  sense_confirmation: definition(sensaLightweightSenseConfirmationMaterialSchema,{label:{'zh-CN':'义项确认',en:'Meaning'},generation:'authority',instruction:'Copy the fixed confirmed meaning.',fields:['meaning']}),
  pronunciation: definition(sensaLightweightPronunciationMaterialSchema,{label:{'zh-CN':'主要声音',en:'Spoken realization'},generation:'source',instruction:'Requires a sourced, playable recording or fixed TTS output for the exact expression and language. IPA alone does not satisfy this role.',fields:['surface','phoneticNotation','accentLabel','languageTag','source']}),
  language_structure: definition(sensaLightweightLanguageStructureMaterialSchema,{label:{'zh-CN':'最小使用框架',en:'Usage frame'},generation:'model',instruction:'Provide only when it helps use this expression. Match its expressionKind; explain fixed parts and replaceable slots using usagePattern. Never invent grammatical facts or force a template on a fixed utterance. Omit contrastNote unless the resolved contrast category is applicable.',fields:['expressionTypeLabel','partOfSpeech','usagePattern','contrastNote']}),
  usage_guidance: definition(sensaLightweightUsageGuidanceMaterialSchema,{label:{'zh-CN':'补充例句',en:'Additional example'},generation:'model',instruction:'An optional natural target-language example of this exact sense. Translation is in the support language. Do not invent an audio URL. This is not necessarily the original scene.',fields:['example','translation']}),
  scene_bridge: definition(sensaLightweightSceneBridgeMaterialSchema,{label:{'zh-CN':'经验与表达的连接',en:'Experience binding'},generation:'model',instruction:'Explain briefly in the support language why the target expression fits the experience_recall_cue in this bundle. Align perspective, roles or intent; do not merely repeat the gloss or invent personal facts.',fields:['text']}),
  scene_realization: definition(sensaSceneRealizationSchema,{label:{'zh-CN':'这个场景怎么说',en:'Express this experience'},generation:'model',instruction:'Express the SAME recall experience naturally in the target language. Supply exact UTF-16 targetStart/targetEnd offsets selecting an exact target occurrence from the accepted surface, spokenForm or acceptedForms and experienceResourceKey experience_recall_cue:0. A target utterance may itself be the example. Translation optional; never invent personal details or audio URLs.',fields:['example','translation']}),
  boundary_contrast: definition(sensaSourcedExplanationSchema,{label:{'zh-CN':'辨析',en:'Contrast'},generation:'source',instruction:'Use a verified contrast for this exact sense; never fabricate a distinction.',fields:['explanation','source','sourceUrl']}),
  word_formation: definition(sensaSourcedExplanationSchema,{label:{'zh-CN':'构词',en:'Word formation'},generation:'source',instruction:'Use verified modern word formation, not historical etymology or arbitrary spelling splits.',fields:['explanation','source','sourceUrl']}),
  mnemonic: definition(sensaMnemonicSchema,{label:{'zh-CN':'助记',en:'Memory aid'},generation:'model',instruction:'Provide a useful memory cue grounded in the supplied experience. Mark kind as teaching_aid. Do not claim it is a linguistic fact, historical origin or personal event.',fields:['text']}),
  etymology: definition(sensaEtymologySchema,{label:{'zh-CN':'词源',en:'Etymology'},generation:'source',instruction:'Only pass through a pinned source-backed etymology fact. Historical etymology is distinct from modern morphology and editorial mnemonics. Omit when no verified source is supplied.',fields:['explanation','source','sourceUrl']}),
});
export type LearningResourceKind = keyof typeof LEARNING_RESOURCE_DEFINITIONS;
export const learningResourceDefinition = (kind:string) => Object.hasOwn(LEARNING_RESOURCE_DEFINITIONS,kind)
  ? LEARNING_RESOURCE_DEFINITIONS[kind as LearningResourceKind] : undefined;
