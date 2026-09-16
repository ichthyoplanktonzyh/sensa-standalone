import { z } from 'zod';

import { sensaIntakePayloadSchema, sensaIntakeResultSchema } from './intake.js';

/**
 * Browser delivery is only a durable transport envelope around canonical
 * Semantic Intake. It does not define another semantic payload or routing
 * model: Web applies `intake` through the same authority as every other entry.
 */
export const sensaBrowserIntakeDeliveryVersion = 'sensa-browser-intake-delivery-v1' as const;

const uuid = z.string().uuid();
const digest = z.string().regex(/^[0-9a-f]{64}$/u);

export const sensaBrowserIntakeDeliverySchema = z.object({
  contractVersion: z.literal(sensaBrowserIntakeDeliveryVersion),
  libraryId: uuid,
  clientId: uuid,
  intake: sensaIntakePayloadSchema,
}).strict().superRefine((value, context) => {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 65_536) {
    context.addIssue({ code: 'custom', message: 'browser intake delivery is too large' });
  }
});

/** Written only after the local Personal Semantic World transaction commits. */
export const sensaBrowserIntakeReceiptSchema = z.object({
  contractVersion: z.literal(sensaBrowserIntakeDeliveryVersion),
  libraryId: uuid,
  clientId: uuid,
  operationId: uuid,
  requestDigest: digest,
  result: sensaIntakeResultSchema,
  appliedAt: z.string().datetime({ offset: true }),
}).strict();

export type SensaBrowserIntakeDelivery = z.infer<typeof sensaBrowserIntakeDeliverySchema>;
export type SensaBrowserIntakeReceipt = z.infer<typeof sensaBrowserIntakeReceiptSchema>;
