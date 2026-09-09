import {z} from 'zod';
import {captureSnapshotSchema} from './intake.js';
import {semanticProposalSchema} from './semantic.js';
const digest=z.string().regex(/^[0-9a-f]{64}$/u);
export const nativeSemanticRequestSchema=z.object({
  version:z.literal('sensa-native-semantic-v1'),id:z.string().uuid(),snapshot:captureSnapshotSchema,
  focus:z.string().trim().min(1).max(2000).nullable(),inputDigest:digest,
}).strict().refine(v=>v.snapshot.expression!==null,{message:'Expression required'});
export const nativeSemanticResultSchema=z.object({
  version:z.literal('sensa-native-semantic-v1'),id:z.string().uuid(),inputDigest:digest,
  status:z.enum(['ready','unresolved']),proposal:semanticProposalSchema.nullable(),
  provenance:z.object({provider:z.string().min(1).max(200),model:z.string().min(1).max(200),policyVersion:z.literal('consumer-semantic-v4'),outputDigest:digest}).strict(),
}).strict().refine(v=>(v.status==='ready')===(v.proposal!==null),{message:'Result status mismatch'});
export type NativeSemanticRequest=z.infer<typeof nativeSemanticRequestSchema>;
export type NativeSemanticResult=z.infer<typeof nativeSemanticResultSchema>;
