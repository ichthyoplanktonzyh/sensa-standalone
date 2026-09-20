import {z} from 'zod';
import {sensaLightweightExpressionSnapshotSchema,sensaLightweightReferenceFactSchema} from './learningResourceDefinitions.js';
export const learningResourcePreparationInputSchema=z.object({expression:sensaLightweightExpressionSnapshotSchema,supportLanguageTag:z.string().min(1),meaning:z.string().min(1)}).strict();
export const learningReferenceInputSchema=z.object({source:z.enum(['dictionary','corpus','pronunciation_lexicon','other_authoritative_source']),sourceVersion:z.string().min(1),fact:sensaLightweightReferenceFactSchema}).strict();
export const learningResourcePreparationResultSchema=z.object({input:learningResourcePreparationInputSchema,references:z.array(learningReferenceInputSchema).max(30)}).strict();
