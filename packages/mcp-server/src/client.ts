import {
  sensaAgentIntakeContractVersion,
  sensaAgentIntakePayloadSchema,
  sensaAgentIntakeSubmissionSchema,
  sensaIntakeDeliveryReceiptSchema,
  type SensaAgentIntakePayload,
  type SensaIntakeDeliveryReceipt,
} from '@sensa/contracts/sensa';

import type { AgentConnectionConfig } from './config.js';

async function responseValue(response: Response): Promise<unknown> {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = value && typeof value === 'object' && 'code' in value
      ? String(value.code)
      : 'agent_intake_unavailable';
    throw new Error(code);
  }
  return value;
}

export class SensaAgentClient {
  constructor(private readonly config: AgentConnectionConfig) {}

  private headers(): HeadersInit {
    return {
      authorization: `Bearer ${this.config.token}`,
      'content-type': 'application/json',
      'x-client-platform': this.config.clientKind,
      'x-client-version': '0.2.0',
    };
  }

  async save(input: SensaAgentIntakePayload): Promise<SensaIntakeDeliveryReceipt> {
    const intake = sensaAgentIntakePayloadSchema.parse(input);
    const submission = sensaAgentIntakeSubmissionSchema.parse({
      contractVersion: sensaAgentIntakeContractVersion,
      intake,
    });
    const response = await fetch(`${this.config.apiUrl}/sensa/agent/intakes`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(submission),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    return sensaIntakeDeliveryReceiptSchema.parse(await responseValue(response));
  }

  async receipt(operationId: string): Promise<SensaIntakeDeliveryReceipt> {
    const id = sensaAgentIntakePayloadSchema.shape.operationId.parse(operationId);
    const response = await fetch(`${this.config.apiUrl}/sensa/agent/intakes/${encodeURIComponent(id)}`, {
      headers: this.headers(),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    return sensaIntakeDeliveryReceiptSchema.parse(await responseValue(response));
  }
}
