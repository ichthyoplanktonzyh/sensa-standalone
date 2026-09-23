import {z} from 'zod';
import {captureSnapshotSchema} from './intake.js';
import {sensaFormalPinnedLanguageContextSchema,sensaLanguageTagSchema} from '../language.js';
import {sensaSenseSemanticSpecSchema,sensaExpressionTypeSchema} from '../semanticRegistry.js';
const id=z.string().uuid(),instant=z.string().datetime({offset:true});
// A selected page occurrence keeps its observed language, even when the active
// learning Route targets another language. The API checks the proposal against
// the captured language before accepting it; the schema refuses an empty tag.
export const semanticProposalSchema=z.object({
 explanation:z.string().trim().min(1).max(2000),semanticSpec:sensaSenseSemanticSpecSchema,
 expression:z.object({surface:z.string().trim().min(1).max(2000),type:sensaExpressionTypeSchema,language:sensaLanguageTagSchema}).strict(),
}).strict().superRefine((v,c)=>{if(v.semanticSpec.openQuestions.length)c.addIssue({code:'custom',message:'Unresolved questions cannot form an acceptable proposal'});if(JSON.stringify(v).length>16000)c.addIssue({code:'custom',message:'Proposal too large'});});
export const semanticClarificationSchema=z.object({previousLookupId:id,text:z.string().trim().min(1).max(2000)}).strict();
export const meaningFocusSchema=z.object({id,constructionId:id,previousLookupId:id,text:z.string().trim().min(1).max(2000)}).strict();
export const semanticLookupInputSchema=z.object({id,snapshot:captureSnapshotSchema,languages:sensaFormalPinnedLanguageContextSchema,clarification:semanticClarificationSchema.optional()}).strict();
export const semanticLookupViewSchema=z.object({id,revision:z.literal('1'),status:z.enum(['running','ready','unresolved','failed']),snapshot:captureSnapshotSchema,focus:meaningFocusSchema.nullable().default(null),proposal:semanticProposalSchema.nullable(),reason:z.string().nullable(),expiresAt:instant,provenance:z.object({provider:z.string(),model:z.string(),policyVersion:z.enum(['sensa-semantic-v1','sensa-semantic-v2','sensa-semantic-v3','sensa-semantic-v4']),inputDigest:z.string(),outputDigest:z.string()}).strict().nullable()}).strict().superRefine((value,context)=>{if(value.status==='ready'&&value.proposal&&!value.provenance)context.addIssue({code:'custom',message:'A ready semantic proposal requires resolution provenance',path:['provenance']});});
export type SemanticProposal=z.infer<typeof semanticProposalSchema>;
export type SemanticLookupInput=z.infer<typeof semanticLookupInputSchema>;
export type SemanticLookupView=z.infer<typeof semanticLookupViewSchema>;
