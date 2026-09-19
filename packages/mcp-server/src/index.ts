#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { sensaAgentIntakePayloadSchema } from '@sensa/contracts/sensa';
import { z } from 'zod';

import { SensaAgentClient } from './client.js';
import { readAgentConnectionConfig } from './config.js';
import { installSensaAgent, uninstallSensaAgent } from './install.js';
import { serveSensaMcp } from './server.js';

const cliRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('save'), intake: sensaAgentIntakePayloadSchema }).strict(),
  z.object({ kind: z.literal('receipt'), operationId: z.string().uuid() }).strict(),
]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--uninstall')) {
    process.stdout.write(`${JSON.stringify(uninstallSensaAgent(args))}\n`);
    return;
  }
  if (args.includes('--install')) {
    process.stdout.write(`${JSON.stringify(await installSensaAgent(args))}\n`);
    return;
  }
  const client = new SensaAgentClient(await readAgentConnectionConfig(args));
  if (!args.includes('--cli')) {
    await serveSensaMcp(client);
    return;
  }
  const bytes = readFileSync(0, 'utf8');
  if (Buffer.byteLength(bytes) > 96 * 1024) throw new Error('request_too_large');
  const request = cliRequestSchema.parse(JSON.parse(bytes));
  const value = request.kind === 'save'
    ? await client.save(request.intake)
    : await client.receipt(request.operationId);
  process.stdout.write(`${JSON.stringify({ value })}\n`);
}

main().catch((error: unknown) => {
  process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.message : 'agent_intake_unavailable' })}\n`);
  process.exitCode = 1;
});
