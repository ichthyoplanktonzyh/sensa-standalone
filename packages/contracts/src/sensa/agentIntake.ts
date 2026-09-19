import { z } from "zod";

import { sensaIntakeFactsSchema } from "./intake.js";

export const sensaAgentIntakeContractVersion = "sensa-agent-intake-v1" as const;

/**
 * Facts prepared in an external Agent conversation. Semantic Acceptance is
 * deliberately absent: invoking the authenticated save operation is the
 * delegated acceptance action, and the Sensa adapter records its trusted
 * connection identity.
 */
export const sensaAgentIntakePayloadSchema = sensaIntakeFactsSchema;

export const sensaAgentIntakeSubmissionSchema = z
  .object({
    contractVersion: z.literal(sensaAgentIntakeContractVersion),
    intake: sensaAgentIntakePayloadSchema,
  })
  .strict();

export type SensaAgentIntakePayload = z.infer<typeof sensaAgentIntakePayloadSchema>;
export type SensaAgentIntakeSubmission = z.infer<typeof sensaAgentIntakeSubmissionSchema>;
