import { z } from "zod";

import {
  sensaIntakePayloadSchema,
  sensaIntakeResultSchema,
} from "./intake.js";

export const sensaIntakeDeliveryContractVersion = "sensa-intake-delivery-v1" as const;

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const nonEmpty = z.string().trim().min(1);

/** Caller identity is provenance. Account authentication selects the destination. */
export const sensaIntakeDeliveryClientSchema = z
  .object({
    clientId: uuid,
    kind: z.enum(["agent", "first_party_surface", "extension", "other"]),
    label: nonEmpty.max(100),
  })
  .strict();

/** What local CLI, HTTP and a future MCP adapter conceptually submit. */
export const sensaIntakeDeliverySubmissionSchema = z
  .object({
    contractVersion: z.literal(sensaIntakeDeliveryContractVersion),
    client: sensaIntakeDeliveryClientSchema,
    intake: sensaIntakePayloadSchema,
  })
  .strict();

/** A trusted local library registers itself as this account's delivery target. */
export const sensaIntakeDeliveryChannelRequestSchema = z
  .object({
    contractVersion: z.literal(sensaIntakeDeliveryContractVersion),
    libraryId: uuid,
  })
  .strict();

export const sensaIntakeDeliveryPullRequestSchema = sensaIntakeDeliveryChannelRequestSchema
  .extend({ limit: z.number().int().min(1).max(50).default(20) })
  .strict();

export const sensaQueuedIntakeDeliverySchema = z
  .object({
    deliveryId: uuid,
    libraryId: uuid,
    queuedAt: timestamp,
    submission: sensaIntakeDeliverySubmissionSchema,
  })
  .strict();

export const sensaIntakeDeliveryPullResultSchema = z
  .object({ deliveries: z.array(sensaQueuedIntakeDeliverySchema).max(50) })
  .strict();

export const sensaIntakeDeliveryAcknowledgementSchema = z
  .object({
    contractVersion: z.literal(sensaIntakeDeliveryContractVersion),
    libraryId: uuid,
    deliveryId: uuid,
    result: sensaIntakeResultSchema,
    appliedAt: timestamp,
  })
  .strict();

export const sensaQueuedIntakeDeliveryReceiptSchema = z
  .object({
    contractVersion: z.literal(sensaIntakeDeliveryContractVersion),
    deliveryId: uuid,
    operationId: uuid,
    deliveryState: z.literal("queued"),
    queuedAt: timestamp,
  })
  .strict();

export const sensaAppliedIntakeDeliveryReceiptSchema = z
  .object({
    contractVersion: z.literal(sensaIntakeDeliveryContractVersion),
    deliveryId: uuid,
    operationId: uuid,
    deliveryState: z.literal("applied"),
    queuedAt: timestamp,
    appliedAt: timestamp,
    result: sensaIntakeResultSchema,
  })
  .strict();

/** `queued` is transport success; only `applied` says the local library committed. */
export const sensaIntakeDeliveryReceiptSchema = z.discriminatedUnion("deliveryState", [
  sensaQueuedIntakeDeliveryReceiptSchema,
  sensaAppliedIntakeDeliveryReceiptSchema,
]);

export type SensaIntakeDeliveryClient = z.infer<typeof sensaIntakeDeliveryClientSchema>;
export type SensaIntakeDeliverySubmission = z.infer<typeof sensaIntakeDeliverySubmissionSchema>;
export type SensaIntakeDeliveryChannelRequest = z.infer<typeof sensaIntakeDeliveryChannelRequestSchema>;
export type SensaIntakeDeliveryPullRequest = z.infer<typeof sensaIntakeDeliveryPullRequestSchema>;
export type SensaQueuedIntakeDelivery = z.infer<typeof sensaQueuedIntakeDeliverySchema>;
export type SensaIntakeDeliveryPullResult = z.infer<typeof sensaIntakeDeliveryPullResultSchema>;
export type SensaIntakeDeliveryAcknowledgement = z.infer<typeof sensaIntakeDeliveryAcknowledgementSchema>;
export type SensaIntakeDeliveryReceipt = z.infer<typeof sensaIntakeDeliveryReceiptSchema>;
