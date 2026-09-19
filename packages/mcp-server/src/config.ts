import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

export const agentConnectionConfigSchema = z.object({
  version: z.literal(2),
  apiUrl: z.string().url(),
  token: z.string().startsWith('sensa_agent_').min(32),
  connectionId: z.string().uuid(),
  clientKind: z.enum(['codex', 'cursor', 'claude_desktop', 'windsurf', 'cli']),
  label: z.string().trim().min(1).max(100),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export type AgentConnectionConfig = z.infer<typeof agentConnectionConfigSchema>;

function safeApiUrl(value: string): string {
  const url = new URL(value);
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) throw new Error('agent_api_url_must_be_https_or_loopback');
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/+$/u, '');
}

export async function readAgentConnectionConfig(args: string[]): Promise<AgentConnectionConfig> {
  const at = args.indexOf('--config');
  const fromFile = at >= 0
    ? agentConnectionConfigSchema.parse(JSON.parse(await readFile(resolve(args[at + 1] ?? ''), 'utf8')))
    : null;
  const value = fromFile ?? agentConnectionConfigSchema.parse({
    version: 2,
    apiUrl: process.env.SENSA_AGENT_API_URL,
    token: process.env.SENSA_AGENT_TOKEN,
    connectionId: process.env.SENSA_AGENT_CONNECTION_ID,
    clientKind: process.env.SENSA_AGENT_CLIENT_KIND,
    label: process.env.SENSA_AGENT_LABEL,
    createdAt: process.env.SENSA_AGENT_CREATED_AT,
    expiresAt: process.env.SENSA_AGENT_EXPIRES_AT,
  });
  return { ...value, apiUrl: safeApiUrl(value.apiUrl) };
}
