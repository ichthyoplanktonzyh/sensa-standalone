import {z} from 'zod';
import {sensaSenseSemanticSpecSchema,sensaExpressionTypeSchema} from '../semanticRegistry.js';
const id=z.string().uuid(),digest=z.string().regex(/^[0-9a-f]{64}$/u);
export const nativeProvisioningInputSchema=z.object({
 version:z.literal('sensa-native-provisioning-v1'),id,taskId:id,learnerId:id,planRevision:id,
 policy:z.object({profileId:z.literal('lightweight'),profileVersion:z.literal('v1')}).strict(),
 protocol:z.object({id:z.literal('consumer-initial'),version:z.literal('v1'),purpose:z.literal('initial_learning')}).strict(),
 demandReference:z.object({contentDemandKey:z.literal('lightweight-initial-content'),definitionVersion:z.literal('v1')}).strict(),
 target:z.object({senseId:id,senseVersionId:id,bindingId:id,bindingVersionId:id,semanticSpec:sensaSenseSemanticSpecSchema.refine(v=>v.openQuestions.length===0&&JSON.stringify(v).length<=16000),expression:z.object({surface:z.string().trim().min(1).max(2000),type:sensaExpressionTypeSchema,language:z.literal('en')}).strict()}).strict(),
 requestedAt:z.string().datetime({offset:true}),inputDigest:digest,
}).strict();
export type NativeProvisioningInput=z.infer<typeof nativeProvisioningInputSchema>;
