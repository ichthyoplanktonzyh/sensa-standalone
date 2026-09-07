import { z } from 'zod';
import {runtimeOperationSchema,consumerRuntimeValueSchema} from './runtime.js';
import { targetOperationSchema, targetViewSchema } from './target.js';

export const consumerVersion = 'sensa-consumer-v1' as const;
export const consumerWireVersion = 'sensa-sync-v3' as const;
export const consumerCanonicalizerVersion = 'sensa-sync-v3-canonical-1' as const;
const id = z.string().uuid();
export const revisionSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u);
export const quantitySchema = z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30)]);
export const timeZoneSchema = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Invalid IANA time zone');
export const installationInputSchema = z.object({
  installationId: id, platform: z.enum(['web', 'extension', 'flutter']), timeZone: timeZoneSchema,
}).strict();
export const planViewSchema = z.object({
  id, revision: revisionSchema, scopeRevision: revisionSchema, quantityConfirmed: z.literal(true),
  dailyNewLimit: quantitySchema, accountDate: z.string(), timeZone: timeZoneSchema,
  newStartedToday: z.number().int().nonnegative(), newRemaining: z.number().int().nonnegative(),
}).strict();
export const accountContextSchema = z.object({
  accountId: id, learnerUserId: z.string().min(1), accountSessionId: id, installationId: id,
  accessStatus: z.literal('invited'), timeZone: timeZoneSchema, timeZoneRevision: revisionSchema,
  quantityConfirmed: z.boolean(), plan: planViewSchema.nullable(),
  supportedWireVersions: z.array(z.string()), minClientVersion: z.string(),
}).strict();
const common = {
  operationId: id, occurredAt: z.string().datetime({ offset: true }), installationId: id, replicaId: id,
  dependsOn: z.array(id).max(50),
};
export const quantityOperationSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('plan.confirm_quantity'), payload: z.object({
    expectedRevision: revisionSchema.nullable(), dailyNewLimit: quantitySchema, timeZone: timeZoneSchema,
  }).strict() }).strict(),
  z.object({ ...common, kind: z.literal('plan.set_quantity'), payload: z.object({
    planId: id, expectedRevision: revisionSchema, dailyNewLimit: quantitySchema,
  }).strict() }).strict(),
]);
export const consumerOperationSchema=z.union([quantityOperationSchema,targetOperationSchema,runtimeOperationSchema]);
export type ConsumerOperation=z.infer<typeof consumerOperationSchema>;
export const consumerPushSchema = z.object({
  wireVersion: z.literal(consumerWireVersion), canonicalizerVersion: z.literal(consumerCanonicalizerVersion),
  scopeEpoch: revisionSchema, replicaId: id, operations: z.array(consumerOperationSchema).max(50),
}).strict();
export const consumerBootstrapSchema = z.object({
  wireVersion: z.literal(consumerWireVersion), installationId: id, replicaId: id.nullable(),
}).strict();
export const consumerPullSchema = z.object({
  wireVersion: z.literal(consumerWireVersion), scopeEpoch: revisionSchema, replicaId: id,
  cursor: z.string().min(1), limit: z.number().int().min(1).max(500).optional(),
}).strict();
export const failureSchema = z.object({
  code: z.string(), retryable: z.boolean(), retryAfterMs: z.number().nullable(),
  latest: z.object({ id, revision: revisionSchema }).nullable(), field: z.string().nullable(), messageKey: z.string(),
}).strict();
const valueSchema = z.union([z.object({plan:planViewSchema,runtime:consumerRuntimeValueSchema}).strict(),z.object({plan:planViewSchema}).strict(),z.object({plan:planViewSchema,target:targetViewSchema,disposition:z.enum(['accepted','already_in_scope']).optional()}).strict()]);
export const quantityResultSchema = z.discriminatedUnion('status', [
  z.object({ operationId: id, status: z.literal('accepted'), value: valueSchema }).strict(),
  z.object({ operationId: id, status: z.literal('replayed'), original: z.enum(['accepted','conflict','rejected']), value: valueSchema.nullable(), error: failureSchema.nullable() }).strict(),
  z.object({ operationId: id, status: z.enum(['conflict','rejected','retryable']), error: failureSchema }).strict(),
]);
export type PlanView = z.infer<typeof planViewSchema>;
export type AccountContext = z.infer<typeof accountContextSchema>;
export type QuantityOperation = z.infer<typeof quantityOperationSchema>;
export type QuantityResult = z.infer<typeof quantityResultSchema>;
export type ConsumerPush = z.infer<typeof consumerPushSchema>;

/** Frozen v3 encoding. No caller-specific normalization is allowed. */
export function canonicalConsumerJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)) return String(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalConsumerJson).join(',') + ']';
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    const compare = (a: string, b: string) => {
      const aa = Array.from(a, c => c.codePointAt(0)!); const bb = Array.from(b, c => c.codePointAt(0)!);
      for (let i=0; i<Math.min(aa.length,bb.length); i++) if (aa[i] !== bb[i]) return aa[i]-bb[i];
      return aa.length-bb.length;
    };
    return '{' + Object.keys(object).sort(compare).map(key => JSON.stringify(key)+':'+canonicalConsumerJson(object[key])).join(',') + '}';
  }
  throw new Error('Invalid canonical JSON value');
}
