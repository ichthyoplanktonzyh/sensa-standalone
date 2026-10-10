import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import {
  sensaAgentIntakePayloadSchema,
  type SensaIntakeDeliveryReceipt,
} from '@sensa/contracts/sensa';
import { z } from 'zod';

import { SensaAgentClient } from './client.js';

const statusInputSchema = z.object({ operationId: z.string().uuid() }).strict();
const intakePrompt = `Organize the language material already established with the user as Sensa Context–Expression–Sense facts. Context is the concrete text, image, audio, or mixed situation. Expression is the reusable form, with the exact observed occurrence kept separately when it differs. Sense is the selected meaning in that Context, represented by the semantic specification rather than a translation alone. Preserve actual source and resolver provenance. When a Context language was established, carry its languageObservation source (declared, detector, model or learner) and any actual confidence; never invent a confidence or use the active learning route as observed language. Use null only when a fact is genuinely absent; do not invent it and do not treat this guidance as a completeness check. Call sensa_save_meaning only after the user explicitly asks to save. The authenticated call records delegated acceptance, so do not add an acceptance field or ask for duplicate confirmation. Reuse one operationId and identical facts when retrying. Report queued versus applied exactly as returned.`;

function receiptText(receipt: SensaIntakeDeliveryReceipt): string {
  if (receipt.deliveryState === 'queued') {
    return `Sensa has durably queued operation ${receipt.operationId}. It is not in the personal semantic world yet; Sensa Web must apply it.`;
  }
  if (receipt.result.route === 'fast_track') {
    return `Sensa added the confirmed meaning to the personal semantic world as ${receipt.result.personalMeaningId}.`;
  }
  return `Sensa applied the intake to the Inbox as ${receipt.result.intakeId} (${receipt.result.status}).`;
}

const toolResult = (receipt: SensaIntakeDeliveryReceipt) => ({
  content: [{ type: 'text' as const, text: receiptText(receipt) }],
  structuredContent: receipt,
});

const toolError = (error: unknown) => ({
  isError: true,
  content: [{
    type: 'text' as const,
    text: `Sensa could not complete the request: ${error instanceof Error ? error.message : 'agent_intake_unavailable'}`,
  }],
});

export function createSensaMcpServer(client: SensaAgentClient): McpServer {
  const server = new McpServer({ name: 'sensa', version: '0.2.0' });
  server.registerPrompt('sensa_intake', {
    title: 'Prepare a meaning for Sensa',
    description: 'Conversation guidance for organizing established material as Context–Expression–Sense and saving it with explicit user intent.',
  }, () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: intakePrompt } }],
  }));
  server.registerTool('sensa_save_meaning', {
    title: 'Save to Sensa semantic world',
    description: 'Use only after the user explicitly asks to save the current Context–Expression–Sense material to Sensa. Supply known facts faithfully and leave genuinely missing facts null; Sensa routes incomplete material to its Inbox.',
    inputSchema: sensaAgentIntakePayloadSchema,
  }, async (input) => {
    try { return toolResult(await client.save(input)); }
    catch (error) { return toolError(error); }
  });
  server.registerTool('sensa_get_save_status', {
    title: 'Get Sensa save status',
    description: 'Read the truthful queued or applied result for a previously submitted Sensa operation.',
    inputSchema: statusInputSchema,
  }, async ({ operationId }) => {
    try { return toolResult(await client.receipt(operationId)); }
    catch (error) { return toolError(error); }
  });
  return server;
}

export async function serveSensaMcp(client: SensaAgentClient): Promise<void> {
  const server = createSensaMcpServer(client);
  await server.connect(new StdioServerTransport());
}
