import {z} from 'zod';

export const readingFeatures = ['selection','page','subtitles','action','meaning'] as const;
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
export const readingRequestSchema = z.object({
  id:z.string().uuid(), feature:z.enum(['selection','page','subtitles','action']),
  text:z.string().trim().min(1).max(12000), context:z.string().max(12000).default(''),
  instruction:z.string().trim().max(2000).default(''),
}).strict();
export type ReadingProvider = z.infer<typeof readingProviderSchema>;
export type ReadingAssignments = z.infer<typeof readingAssignmentsSchema>;
export type ReadingRequest = z.infer<typeof readingRequestSchema>;
export type ReadingSettingsInput = z.infer<typeof readingSettingsInputSchema>;
export type ReadingSettingsView = {
  revision:number; providers:(ReadingProvider & {keyConfigured:boolean})[];
  assignments:ReadingAssignments; configured:boolean; allowedOrigins:string[];
};
export const defaultReadingAssignments:ReadingAssignments = {selection:null,page:null,subtitles:null,action:null,meaning:null};
