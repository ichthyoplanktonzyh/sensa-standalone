import {z} from 'zod';
import {captureSnapshotSchema} from './intake.js';
import {semanticProposalSchema} from './semantic.js';
import {sensaPinnedLanguageContextSchema} from '../language.js';
const id=z.string().uuid();
export const localIntakeRequestSchema=z.object({
 version:z.literal('sensa-intake-v1'),libraryId:id,clientId:id,operationId:id,
 languageContext:sensaPinnedLanguageContextSchema,
 snapshot:captureSnapshotSchema,
 resolution:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('proposal'),proposal:semanticProposalSchema}).strict(),
  z.object({kind:z.literal('local_binding'),material_id:z.string().min(1)}).strict(),
 ]).nullable().default(null),
 acceptance:z.object({kind:z.enum(['direct','delegated']),consent:z.literal('accept_context_expression_sense'),authorization:z.string().trim().min(1).max(500)}).strict().nullable().default(null),
}).strict().superRefine((v,c)=>{
 if(v.acceptance&&!v.resolution)c.addIssue({code:'custom',message:'semantic_acceptance_required'});
 if(v.resolution&&!v.snapshot.expression)c.addIssue({code:'custom',message:'expression_required'});
 if(v.resolution?.kind==='proposal'&&v.resolution.proposal.expression.surface!==v.snapshot.expression?.text.trim())c.addIssue({code:'custom',message:'expression_binding_mismatch'});
 if(new TextEncoder().encode(JSON.stringify(v)).length>65536)c.addIssue({code:'custom',message:'invalid_intake_request'});
});
export const localIntakeReceiptSchema=z.object({version:z.literal('sensa-intake-v1'),libraryId:id,clientId:id,operationId:id,requestDigest:z.string().regex(/^[0-9a-f]{64}$/u),status:z.enum(['pending','confirmed']),entityId:id,committedAt:z.string().datetime({offset:true})}).strict();
export type LocalIntakeRequest=z.infer<typeof localIntakeRequestSchema>;
export type LocalIntakeReceipt=z.infer<typeof localIntakeReceiptSchema>;
