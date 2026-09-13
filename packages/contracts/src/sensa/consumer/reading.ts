import {z} from 'zod';
import {sensaLanguageNameableTagSchema,sensaCommandLanguagesSchema} from '../language.js';

/**
 * What a reading connection can be asked to do.
 *
 * `writing` is the one that runs the other way: the other features explain or
 * translate something the learner met, while this produces the target language
 * from what the learner wrote themselves. It is listed here because it is the
 * same operation in every other respect — one pair, one connection, one budget,
 * one streamed answer — and a learner who wants a different model for producing
 * their own sentences assigns one here.
 */
export const readingFeatures = ['selection','page','subtitles','action','meaning','writing'] as const;
export const readingFeatureSchema = z.enum(readingFeatures);
/** Purposes the Web application assigns to an account connection. They share one
 * account-level connection registry with reading, so a key is configured once.
 * Omitted means "leave the current assignment alone"; null means "clear it". */
export const modelAssignmentFeatures = ['teacher','content','review','reference'] as const;
export type ModelAssignmentFeature = typeof modelAssignmentFeatures[number];
const endpoint = z.string().url().max(2048).refine(value => {
  const u = new URL(value);
  return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash;
});
export const readingProviderSchema = z.object({
  id:z.string().uuid(), name:z.string().trim().min(1).max(80), baseUrl:endpoint,
  model:z.string().trim().min(1).max(160), enabled:z.boolean(),
  temperature:z.number().min(0).max(2).optional(),
}).strict();
export const readingAssignmentsSchema = z.object({
  selection:z.string().uuid().nullable(), page:z.string().uuid().nullable(),
  subtitles:z.string().uuid().nullable(), action:z.string().uuid().nullable(), meaning:z.string().uuid().nullable(),
  writing:z.string().uuid().nullable(),
  teacher:z.string().uuid().nullable().optional(), content:z.string().uuid().nullable().optional(),
  review:z.string().uuid().nullable().optional(), reference:z.string().uuid().nullable().optional(),
}).strict();
export const readingSettingsInputSchema = z.object({
  expectedRevision:z.number().int().nonnegative(),
  providers:z.array(readingProviderSchema.extend({apiKey:z.string().trim().min(1).max(4096).optional()})).max(12),
  assignments:readingAssignmentsSchema,
}).strict().superRefine((v,c) => {
  if(new Set(v.providers.map(p=>p.id)).size!==v.providers.length)c.addIssue({code:'custom',message:'Duplicate provider'});
  for(const id of Object.values(v.assignments))if(id&&!v.providers.some(p=>p.id===id&&p.enabled))c.addIssue({code:'custom',message:'Provider unavailable'});
});

/**
 * The two requests that are about a connection rather than about a reading.
 *
 * They are declared here, beside the reading request, because the extension is
 * their client and the service is their reader: a surface that sent the learner's
 * pair with a model test would be sending a body this service refuses, and the
 * learner would be told their connection failed when it was their client that was
 * wrong. Strict on purpose — a connection question has exactly these fields.
 */
export const readingTestRequestSchema=z.object({id:z.string().uuid(),providerId:z.string().uuid()}).strict();
export const readingModelsRequestSchema=z.object({providerId:z.string().uuid()}).strict();
/**
 * The learner's own renderings for the words they care about.
 *
 * A glossary is not an instruction and not a definition: it is the learner
 * saying which word they want to read. So it is part of the operation's input —
 * and therefore part of its digest, because asking again with a different
 * glossary is asking a different question — and bounded, because it travels
 * inside every prompt of every paragraph the learner reads. One term is listed
 * once: two renderings for the same word is not a preference, it is a
 * contradiction the model would have to resolve on its own.
 */
/** What a glossary is allowed to be, in one place: the schema that accepts one,
 * the editor that writes one and the surface that publishes one all read these
 * numbers, so the limit the learner meets is the limit the request carries. */
export const sensaReadingGlossaryLimits={entries:50,term:80,rendering:160} as const;
export const sensaReadingGlossaryEntrySchema=z.object({
  term:z.string().trim().min(1).max(sensaReadingGlossaryLimits.term),
  rendering:z.string().trim().min(1).max(sensaReadingGlossaryLimits.rendering),
}).strict();
export const sensaReadingGlossarySchema=z.array(sensaReadingGlossaryEntrySchema).max(sensaReadingGlossaryLimits.entries).superRefine((entries,context)=>{
  if(new Set(entries.map(entry=>entry.term.toLowerCase())).size!==entries.length)context.addIssue({code:'custom',message:'a glossary lists each term once'});
});

/**
 * One reading operation, in the learner's own two languages.
 *
 * The pair travels with the request rather than being read from an account
 * setting, because the profile lives in the learner's local library and this
 * service is a capability, not a fact store: it is told which two languages the
 * operation is about and it must not remember a pair of its own. The request
 * digest covers the whole input, so the same request id under a different pair
 * is a conflict instead of a replay of the other language's answer.
 *
 * `sourceLanguageTag` is the language of `text` when the caller established one,
 * which is a statement about the text and not a third member of the pair: the
 * text a learner quotes is usually their target language, but a familiar-language
 * quote is a real capture too.
 */
export const readingRequestSchema = z.object({
  id:z.string().uuid(), feature:z.enum(['selection','page','subtitles','action','writing']),
  text:z.string().trim().min(1).max(12000), context:z.string().max(12000).default(''),
  instruction:z.string().trim().max(2000).default(''),
  languages:sensaCommandLanguagesSchema,
  sourceLanguageTag:sensaLanguageNameableTagSchema.nullable().default(null),
  glossary:sensaReadingGlossarySchema.default([]),
}).strict();
export type ReadingProvider = z.infer<typeof readingProviderSchema>;
export type ReadingAssignments = z.infer<typeof readingAssignmentsSchema>;
export type ReadingRequest = z.infer<typeof readingRequestSchema>;
export type SensaReadingGlossaryEntry = z.infer<typeof sensaReadingGlossaryEntrySchema>;
export type SensaReadingGlossary = z.infer<typeof sensaReadingGlossarySchema>;
export type ReadingSettingsInput = z.infer<typeof readingSettingsInputSchema>;
export type ReadingSettingsView = {
  revision:number; providers:(ReadingProvider & {keyConfigured:boolean})[];
  assignments:ReadingAssignments; configured:boolean; allowedOrigins:string[];
};
export const defaultReadingAssignments:ReadingAssignments = {selection:null,page:null,subtitles:null,action:null,meaning:null,writing:null};
