import {z} from 'zod';
import {captureSnapshotSchema} from './intake.js';
import {sensaLanguageTagSchema} from '../language.js';
import {sensaSenseSemanticSpecSchema,sensaExpressionTypeSchema} from '../semanticRegistry.js';
const id=z.string().uuid(),instant=z.string().datetime({offset:true});
// The proposed expression is written in the target language of the operation
// that asked for it, so the language is a tag rather than a literal. The
// consumer that issued the lookup knows which language it asked for and is the
// one that can reject a mismatch; this schema only refuses an empty tag.
export const semanticProposalSchema=z.object({
 explanation:z.string().trim().min(1).max(2000),semanticSpec:sensaSenseSemanticSpecSchema,
 expression:z.object({surface:z.string().trim().min(1).max(2000),type:sensaExpressionTypeSchema,language:sensaLanguageTagSchema}).strict(),
}).strict().superRefine((v,c)=>{if(v.semanticSpec.openQuestions.length)c.addIssue({code:'custom',message:'Unresolved questions cannot form an acceptable proposal'});if(JSON.stringify(v).length>16000)c.addIssue({code:'custom',message:'Proposal too large'});});
export const semanticClarificationSchema=z.object({previousLookupId:id,text:z.string().trim().min(1).max(2000)}).strict();
export const meaningFocusSchema=z.object({id,constructionId:id,previousLookupId:id,text:z.string().trim().min(1).max(2000)}).strict();
export const semanticLookupInputSchema=z.object({id,snapshot:captureSnapshotSchema,clarification:semanticClarificationSchema.optional()}).strict();
export const semanticLookupViewSchema=z.object({id,revision:z.literal('1'),status:z.enum(['running','ready','unresolved','failed']),snapshot:captureSnapshotSchema,focus:meaningFocusSchema.nullable().default(null),proposal:semanticProposalSchema.nullable(),reason:z.string().nullable(),expiresAt:instant,provenance:z.object({provider:z.string(),model:z.string(),policyVersion:z.enum(['sensa-semantic-v1','sensa-semantic-v2','sensa-semantic-v3','sensa-semantic-v4']),inputDigest:z.string(),outputDigest:z.string()}).strict().nullable()}).strict();
export type SemanticProposal=z.infer<typeof semanticProposalSchema>;
export type SemanticLookupInput=z.infer<typeof semanticLookupInputSchema>;
export type SemanticLookupView=z.infer<typeof semanticLookupViewSchema>;
