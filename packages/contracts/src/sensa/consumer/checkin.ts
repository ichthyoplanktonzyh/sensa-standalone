import {z} from 'zod';
const id=z.string().uuid(),instant=z.string().datetime({offset:true}),revision=z.string().regex(/^(0|[1-9][0-9]*)$/u);
export const accountClockGrantSchema=z.object({id,installationId:id,replicaId:id,scopeEpoch:revision,issuedAt:instant,expiresAt:instant,clockSessionId:id}).strict();
export const checkInViewSchema=z.object({id,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),revision,source:z.enum(['manual','formal_learning']),timeZone:z.string(),occurredAt:instant,runId:id.nullable(),activityEntryOperationId:id.nullable()}).strict();
export const checkInOperationSchema=z.object({operationId:id,occurredAt:instant,installationId:id,replicaId:id,dependsOn:z.array(id).max(50),kind:z.literal('check_in.record'),payload:z.object({source:z.enum(['manual','formal_learning']),runId:id.nullable(),activityEntryOperationId:id.nullable(),timeZoneRevision:z.literal('1'),clock:z.object({grantId:id,sessionId:id,elapsedMs:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict().nullable()}).strict()}).strict();
export type AccountClockGrant=z.infer<typeof accountClockGrantSchema>;
export type CheckInView=z.infer<typeof checkInViewSchema>;
export type CheckInOperation=z.infer<typeof checkInOperationSchema>;
