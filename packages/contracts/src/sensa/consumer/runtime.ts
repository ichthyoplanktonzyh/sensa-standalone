import {z} from 'zod';
const id=z.string().uuid(),rev=z.string().regex(/^(0|[1-9][0-9]*)$/u),instant=z.string().datetime({offset:true});
export const consumerActivityModeSchema=z.enum(['mixed','review_only']);
export const consumerReasonSchema=z.enum(['no_targets','daily_limit','none_due','preparing','blocked','waiting_relearning','onboarding_required']).nullable();
export const consumerGrantSchema=z.object({id,runId:id,learnerUserId:z.string(),installationId:id,replicaId:id,scopeEpoch:rev,issuedAt:instant,expiresAt:instant,protocolVersion:z.enum(['consumer-initial-v1','consumer-review-v1','consumer-relearning-v1']),materialDigest:z.string(),baseRevision:rev,allowedActions:z.tuple([z.literal('reveal'),z.literal('rate')]),clockSessionId:id}).strict();
export const consumerCompletionSchema=z.object({kind:z.enum(['study_completion','review_completed','relearning_completion']),completionId:id,outcomeId:id.nullable(),handoffId:id.nullable(),schedulingDecisionId:id.nullable(),dueAt:instant.nullable(),rating:z.enum(['again','hard','good']).nullable().default(null)}).strict();
export const consumerRunSchema=z.object({id,revision:rev,activityId:id,learningTargetId:id,retentionTargetId:id,purpose:z.enum(['initial_learning','retention_review','relearning']),status:z.enum(['active','completed']),policy:z.object({id:z.literal('lightweight'),version:z.literal('v1')}).strict(),protocol:z.object({id:z.enum(['lightweight-initial','lightweight-review','lightweight-relearning']),version:z.enum(['consumer-initial-v1','consumer-review-v1','consumer-relearning-v1'])}).strict(),materializationId:id,materialDigest:z.string(),currentStep:z.object({id,ordinal:z.number().int().positive(),phase:z.enum(['recall','reveal']),allowedActions:z.array(z.string())}).strict().nullable(),nextEligibleAt:instant.nullable(),progress:z.object({attemptCount:z.number().int().nonnegative(),cycleIndex:z.number().int().nonnegative()}).strict(),completion:consumerCompletionSchema.nullable(),offlineGrant:consumerGrantSchema.nullable()}).strict();
export const consumerActivitySchema=z.object({id,revision:rev,mode:consumerActivityModeSchema,status:z.enum(['active','paused','ended']),runId:id.nullable()}).strict();
export const consumerSummarySchema=z.object({activityId:id,status:z.enum(['active','ended']),initialTargetIds:z.array(id),reviewTargetIds:z.array(id),restoredTargetIds:z.array(id),needsRecallTargetIds:z.array(id),waitingTargetIds:z.array(id),nextEligibleAt:instant.nullable(),immediateAvailable:z.boolean()}).strict();
const common={operationId:id,occurredAt:instant,installationId:id,replicaId:id,dependsOn:z.array(id).max(50)};
export const consumerActionSchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('reveal')}).strict(),z.object({kind:z.literal('rate'),rating:z.enum(['again','hard','good'])}).strict()]);
export const runtimeOperationSchema=z.discriminatedUnion('kind',[
 z.object({...common,kind:z.literal('activity.start_or_resume'),payload:z.object({mode:consumerActivityModeSchema,expectedScopeRevision:rev,activityId:id.nullable(),clockSessionId:id}).strict()}).strict(),
 z.object({...common,kind:z.literal('activity.next'),payload:z.object({activityId:id,expectedRevision:rev,mode:consumerActivityModeSchema,allowEarlyRelearning:z.boolean(),clockSessionId:id}).strict()}).strict(),
 z.object({...common,kind:z.literal('run.record_action'),payload:z.object({runId:id,expectedRevision:rev,stepId:id,ordinal:z.number().int().positive(),materialDigest:z.string(),grantId:id,clock:z.object({sessionId:id,elapsedMs:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict(),action:consumerActionSchema}).strict()}).strict(),
 z.object({...common,kind:z.literal('activity.pause'),payload:z.object({activityId:id,expectedRevision:rev,runId:id.nullable(),afterOperationId:id.nullable()}).strict()}).strict(),
 z.object({...common,kind:z.literal('activity.end'),payload:z.object({activityId:id,expectedRevision:rev}).strict()}).strict(),
]);
export const consumerRuntimeValueSchema=z.object({activity:consumerActivitySchema,run:consumerRunSchema.nullable(),reason:consumerReasonSchema,summary:consumerSummarySchema.optional()}).strict();
export type ConsumerRun=z.infer<typeof consumerRunSchema>;
export type ConsumerActivity=z.infer<typeof consumerActivitySchema>;
export type ConsumerGrant=z.infer<typeof consumerGrantSchema>;
export type RuntimeOperation=z.infer<typeof runtimeOperationSchema>;
export type ConsumerAction=z.infer<typeof consumerActionSchema>;
export type RuntimeValue=z.infer<typeof consumerRuntimeValueSchema>;

export type ConsumerSummary=z.infer<typeof consumerSummarySchema>;
