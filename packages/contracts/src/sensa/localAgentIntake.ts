import { z } from 'zod';

import {
  sensaIntakeDeliveryClientSchema,
} from './intakeDelivery.js';
import { sensaIntakePayloadSchema, sensaIntakeResultSchema } from './intake.js';

export const sensaLocalAgentIntakeVersion = 'sensa-local-agent-intake-v1' as const;
const uuid = z.string().uuid();

export const sensaLocalAgentConnectionStatusSchema = z.object({
  extensionId: z.string().regex(/^[a-p]{32}$/u),
  state: z.enum(['connected', 'setup_required', 'different_library']),
  clientLabel: z.string().trim().min(1).max(100).nullable(),
}).strict();

/** One durable CLI delivery, bound to the selected local Web library. */
export const sensaLocalAgentIntakeDeliverySchema = z.object({
  contractVersion: z.literal(sensaLocalAgentIntakeVersion),
  libraryId: uuid,
  client: sensaIntakeDeliveryClientSchema,
  intake: sensaIntakePayloadSchema,
  requestDigest: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict();

/** Written back only after the Web Journey transaction commits. */
export const sensaLocalAgentIntakeReceiptSchema = z.object({
  contractVersion: z.literal(sensaLocalAgentIntakeVersion),
  libraryId: uuid,
  clientId: uuid,
  operationId: uuid,
  requestDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  result: sensaIntakeResultSchema,
  appliedAt: z.string().datetime({ offset: true }),
}).strict();

export type SensaLocalAgentIntakeDelivery = z.infer<typeof sensaLocalAgentIntakeDeliverySchema>;
export type SensaLocalAgentIntakeReceipt = z.infer<typeof sensaLocalAgentIntakeReceiptSchema>;
export type SensaLocalAgentConnectionStatus = z.infer<typeof sensaLocalAgentConnectionStatusSchema>;
