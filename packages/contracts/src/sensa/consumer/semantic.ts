import {z} from 'zod';
import {captureSnapshotSchema} from './intake.js';
import {sensaSenseSemanticSpecSchema,sensaExpressionTypeSchema} from '../semanticRegistry.js';
const id=z.string().uuid(),instant=z.string().datetime({offset:true});
export const semanticProposalSchema=z.object({
 explanation:z.string().trim().min(1).max(2000),semanticSpec:sensaSenseSemanticSpecSchema,
 expression:z.object({surface:z.string().trim().min(1).max(2000),type:sensaExpressionTypeSchema,language:z.literal('en')}).strict(),
}).strict().superRefine((v,c)=>{if(v.semanticSpec.openQuestions.length)c.addIssue({code:'custom',message:'Unresolved questions cannot form an acceptable proposal'});if(JSON.stringify(v).length>16000)c.addIssue({code:'custom',message:'Proposal too large'});});
export const semanticClarificationSchema=z.object({previousLookupId:id,text:z.string().trim().min(1).max(2000)}).strict();
export const meaningFocusSchema=z.object({id,constructionId:id,previousLookupId:id,text:z.string().trim().min(1).max(2000)}).strict();
export const semanticLookupInputSchema=z.object({id,snapshot:captureSnapshotSchema,clarification:semanticClarificationSchema.optional()}).strict();
export const semanticLookupViewSchema=z.object({id,revision:z.literal('1'),status:z.enum(['running','ready','unresolved','failed']),snapshot:captureSnapshotSchema,focus:meaningFocusSchema.nullable().default(null),proposal:semanticProposalSchema.nullable(),reason:z.string().nullable(),expiresAt:instant,provenance:z.object({provider:z.string(),model:z.string(),policyVersion:z.enum(['consumer-semantic-v1','consumer-semantic-v2','consumer-semantic-v3','consumer-semantic-v4']),inputDigest:z.string(),outputDigest:z.string()}).strict().nullable()}).strict();
export const semanticAcceptOperationSchema=z.object({operationId:id,occurredAt:instant,installationId:id,replicaId:id,dependsOn:z.array(id).max(50),kind:z.literal('semantic.accept'),payload:z.object({lookupId:id,expectedRevision:z.literal('1'),intakeId:id.nullable(),consent:z.literal('accept_context_expression_sense')}).strict()}).strict();
export const personalMeaningViewSchema=z.object({id,contextAnchorId:id,expressionAnchorId:id,revision:z.string().regex(/^[1-9][0-9]*$/u),status:z.enum(['confirmed','removed']),focus:meaningFocusSchema.nullable().default(null),anchorUseGrantId:id.nullable().default(null),snapshot:captureSnapshotSchema,proposal:semanticProposalSchema,senseId:id,senseVersionId:id,bindingId:id,bindingVersionId:id,alignmentId:id,acceptanceId:id,acceptedAt:instant,acceptanceKind:z.literal('direct')}).strict();
export type SemanticProposal=z.infer<typeof semanticProposalSchema>;
export type SemanticLookupInput=z.infer<typeof semanticLookupInputSchema>;
export type SemanticLookupView=z.infer<typeof semanticLookupViewSchema>;
export type SemanticAcceptOperation=z.infer<typeof semanticAcceptOperationSchema>;
export type PersonalMeaningView=z.infer<typeof personalMeaningViewSchema>;

export const anchorUseOperationSchema=z.object({operationId:id,occurredAt:instant,installationId:id,replicaId:id,dependsOn:z.array(id).max(50),kind:z.literal('personal.set_anchor_use'),payload:z.object({meaningId:id,expectedRevision:z.string().regex(/^[1-9][0-9]*$/u),enabled:z.boolean(),policy:z.literal('original-context-v1')}).strict()}).strict();
export type AnchorUseOperation=z.infer<typeof anchorUseOperationSchema>;
