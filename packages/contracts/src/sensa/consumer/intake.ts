import {z} from 'zod';
const id=z.string().uuid();
const sourceUrl=z.string().url().max(4096).refine(value=>{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;},'HTTP(S) source required');
export const captureSnapshotSchema=z.object({
  sentence:z.string().min(1).max(12000).refine(s=>s.trim().length>0),language:z.literal('en'),
  source:z.object({url:sourceUrl.nullable(),title:z.string().max(1000),capturedAt:z.string().datetime({offset:true})}).strict(),
  expression:z.object({text:z.string().min(1).max(2000),start:z.number().int().nonnegative(),end:z.number().int().positive()}).strict().nullable(),
}).strict().superRefine((value,ctx)=>{const e=value.expression;if(e&&(e.end<=e.start||Array.from(value.sentence).slice(e.start,e.end).join('')!==e.text||e.end>Array.from(value.sentence).length))ctx.addIssue({code:'custom',message:'Invalid code point occurrence',path:['expression']});});
export const intakeOperationSchema=z.object({operationId:id,occurredAt:z.string().datetime({offset:true}),installationId:id,replicaId:id,dependsOn:z.array(id).max(50),kind:z.literal('intake.save'),payload:z.object({snapshot:captureSnapshotSchema}).strict()}).strict();
export const intakeViewSchema=z.object({id,revision:z.string().regex(/^[1-9][0-9]*$/u),status:z.enum(['inbox','confirmed','removed']),meaningId:id.nullable().default(null),snapshot:captureSnapshotSchema,savedAt:z.string().datetime({offset:true})}).strict();
export type CaptureSnapshot=z.infer<typeof captureSnapshotSchema>;
export type IntakeView=z.infer<typeof intakeViewSchema>;
export type IntakeOperation=z.infer<typeof intakeOperationSchema>;
/** Product duplicate identity excludes changing title/capture time; original provenance stays immutable. */
export function captureIdentity(snapshot:CaptureSnapshot){return {sentence:snapshot.sentence,language:snapshot.language,url:snapshot.source.url,expression:snapshot.expression};}

export const contentMembershipOperationSchema=z.object({operationId:id,occurredAt:z.string().datetime({offset:true}),installationId:id,replicaId:id,dependsOn:z.array(id).max(50),kind:z.literal('content.set_membership'),payload:z.object({entity:z.enum(['intake','meaning']),id,expectedRevision:z.string().regex(/^[1-9][0-9]*$/u),active:z.boolean()}).strict()}).strict();
export type ContentMembershipOperation=z.infer<typeof contentMembershipOperationSchema>;
