import {z} from 'zod';

import {sensaLanguageTagSchema} from './language.js';
import {sensaLightweightInitialMaterializationContentSchema} from './lightweightLearningContent.js';
import {sensaRuntimeLearningReleaseSchema} from './runtimeLearningRelease.js';
import {
  sensaExpressionBindingRelationSchema,
  sensaExpressionTypeSchema,
  sensaSemanticCoverageSchema,
  sensaSenseSemanticSpecSchema,
} from './semanticRegistry.js';

const id=z.string().uuid();
const label=z.string().trim().min(1).max(500);

/** Trusted semantic facts compiled from a Registry-attested Portable Package. */
export const publishedLearningSemanticFactsSchema=z.object({
  senseKey:label,
  senseVersionNumber:z.number().int().positive(),
  semanticPolicyVersion:label,
  semanticSpec:sensaSenseSemanticSpecSchema,
  expressionId:id,
  expressionVersionId:id,
  expressionType:sensaExpressionTypeSchema,
  expressionVersionNumber:z.number().int().positive(),
  expressionStructure:z.record(z.string(),z.unknown()),
  bindingVersionNumber:z.number().int().positive(),
  relation:sensaExpressionBindingRelationSchema,
  semanticCoverage:sensaSemanticCoverageSchema,
  registerLabel:label.nullable(),
  usageConstraints:z.array(label),
}).strict();

export const installedLearningEntrySchema=z.object({
  senseId:id,
  senseVersionId:id,
  bindingId:id,
  bindingVersionId:id,
  expression:label,
  assurancePackageKey:label.optional(),
  meaning:z.string().trim().min(1).max(8000),
  content:sensaLightweightInitialMaterializationContentSchema,
  semantic:publishedLearningSemanticFactsSchema.optional(),
}).strict();

const assuranceSchema=z.object({
  release:sensaRuntimeLearningReleaseSchema,
  audio:z.record(
    z.string(),
    z.string().regex(/^data:audio\/mpeg;base64,[A-Za-z0-9+/]+={0,2}$/u),
  ),
}).strict().optional();

/** Device-local Runtime projection compiled from admitted `.sensa` bytes.
 * This is neither a public exchange format nor an independently importable package. */
export const installedLearningContentSchema=z.object({
  format:z.literal('sensa-installed-learning-content-v1'),
  targetLanguage:sensaLanguageTagSchema,
  supportLanguage:sensaLanguageTagSchema,
  assurance:assuranceSchema,
  entries:z.array(installedLearningEntrySchema).min(1).max(100),
}).strict().superRefine((content,context)=>{
  const keys=content.entries.map(entry=>entry.senseVersionId+':'+entry.bindingVersionId);
  if(new Set(keys).size!==keys.length){
    context.addIssue({code:'custom',message:'Duplicate learning target'});
  }
});

export type PublishedLearningSemanticFacts=z.infer<typeof publishedLearningSemanticFactsSchema>;
export type InstalledLearningEntry=z.infer<typeof installedLearningEntrySchema>;
export type InstalledLearningContent=z.infer<typeof installedLearningContentSchema>;
