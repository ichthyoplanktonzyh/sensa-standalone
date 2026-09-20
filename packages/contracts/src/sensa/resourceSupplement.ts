import {z} from 'zod';
import {sensaEtymologySchema} from './learningResourceDefinitions.js';

/** An explicit subset of resources currently supported for independent preparation. */
export const supplementaryResourceRoles=['etymology'] as const;
export const resourceSupplementRequestSchema=z.object({
 role:z.enum(supplementaryResourceRoles),surface:z.string().trim().min(1).max(500),
 targetLanguageTag:z.string().min(1).max(80),supportLanguageTag:z.string().min(1).max(80),
 expressionKind:z.enum(['word','phrase','construction','utterance','unspecified']),
}).strict();
export const resourceSupplementResultSchema=z.object({
 request:resourceSupplementRequestSchema,
 provider:z.string().min(1).max(200),sourceVersion:z.string().min(1).max(200),
 result:z.discriminatedUnion('status',[
  z.object({status:z.literal('available'),payload:sensaEtymologySchema}).strict(),
  z.object({status:z.literal('unavailable'),reason:z.enum(['source_missing','language_unsupported'])}).strict(),
  z.object({status:z.literal('not_applicable'),reason:z.literal('single_word_only')}).strict(),
 ]),
}).strict();
export type ResourceSupplementRequest=z.infer<typeof resourceSupplementRequestSchema>;
export type ResourceSupplementResult=z.infer<typeof resourceSupplementResultSchema>;
