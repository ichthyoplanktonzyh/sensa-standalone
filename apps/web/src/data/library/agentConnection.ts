import {
  sensaAgentConnectionContractVersion,
  sensaAgentConnectionEventListSchema,
  sensaAgentConnectionListSchema,
  sensaAgentConnectionSetupSchema,
  type SensaAgentClientKind,
  type SensaAgentConnectionEvent,
  type SensaAgentConnectionSetup,
  type SensaAgentConnectionView,
} from '@sensa/contracts/sensa';

import { auth } from '../account/auth';

async function target(): Promise<{ base: string; token: string; subject: string }> {
  const session = (await auth?.getSession())?.data.session;
  if (!session) throw new Error('authentication_required');
  const configured = import.meta.env.VITE_SENSA_API_URL as string | undefined;
  if (!configured) throw new Error('agent_connection_unavailable');
  return {
    base: configured.replace(/\/+$/u, '') + '/sensa/agent',
    token: session.access_token,
    subject: session.user.id,
  };
}

async function send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const destination = await target();
  const response = await fetch(destination.base + path, {
    method,
    headers: {
      authorization: `Bearer ${destination.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
  });
  const current = (await auth?.getSession())?.data.session;
  if (!current || current.user.id !== destination.subject) throw new Error('account_changed');
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value?.code ?? 'agent_connection_unavailable');
  return value;
}

export async function listAgentConnections(): Promise<SensaAgentConnectionView[]> {
  return sensaAgentConnectionListSchema.parse(await send('GET', '/connections')).connections;
}

export async function listAgentConnectionEvents(): Promise<SensaAgentConnectionEvent[]> {
  return sensaAgentConnectionEventListSchema.parse(await send('GET', '/connection-events')).events;
}

export async function createAgentConnectionSetup(input: {
  clientKind: SensaAgentClientKind;
  label: string;
  replacesConnectionId?: string;
}): Promise<SensaAgentConnectionSetup> {
  return sensaAgentConnectionSetupSchema.parse(await send('POST', '/connection-setups', {
    contractVersion: sensaAgentConnectionContractVersion,
    setupId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    clientKind: input.clientKind,
    label: input.label,
    replacesConnectionId: input.replacesConnectionId ?? null,
  }));
}

export async function revokeAgentConnection(connectionId: string): Promise<void> {
  await send('POST', '/connections/revoke', {
    contractVersion: sensaAgentConnectionContractVersion,
    connectionId,
  });
}
