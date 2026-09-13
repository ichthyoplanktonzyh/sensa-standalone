import {z} from 'zod';

export const serviceUsageKinds=['reading','reference','teacher','content'] as const;
export const serviceStatusSchema=z.object({
  authorized:z.literal(true),
  explanationAvailable:z.boolean(),
  checkedAt:z.string().datetime(),
  windowHours:z.literal(24),
  usage:z.array(z.object({kind:z.enum(serviceUsageKinds),used:z.number().int().nonnegative(),limit:z.number().int().positive().nullable()}).strict()).length(serviceUsageKinds.length),
}).strict();
export type ServiceStatus=z.infer<typeof serviceStatusSchema>;
