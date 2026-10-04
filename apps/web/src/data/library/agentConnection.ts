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

async function send(method: 'GET' | 'POST', path: string, body?: unknown, expectedSubject?:string): Promise<unknown> {
  const destination = await target();
  if(expectedSubject&&destination.subject!==expectedSubject)throw new Error('account_changed');
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
  // Explicitly connecting an Agent needs a stable account Library destination,
  // even before the first Meaning exists. Ordinary empty-account boot remains
  // read-only; this publishes the identity checkpoint, not invented learner facts.
  const [{readCloudSync},{syncAccountLibrary},{openLibrary,readLibrary},{registerIntakeDeliveryChannel}] = await Promise.all([
    import('./cloudSync'),import('./cloudSyncService'),import('./store'),import('./intakeDelivery'),
  ]);
  const owner=await readLibrary(async tx=>{
    if(await tx.get('meta','signed-out'))throw new Error('authentication_required');
    return tx.get<{subject:string;accountId:string}>('meta','service-owner');
  });
  if(!owner||(await target()).subject!==owner.subject)throw new Error('account_changed');
  let sync = await readCloudSync();
  if (!sync?.revision || !['synced','pending'].includes(sync.status)) {
    await syncAccountLibrary({publishEmptyIdentity:true});
    sync = await readCloudSync();
  }
  if (!sync?.revision || !['synced','pending'].includes(sync.status)) throw new Error('intake_destination_unavailable');
  if(sync.owner.subject!==owner.subject||sync.owner.accountId!==owner.accountId)throw new Error('account_changed');
  await registerIntakeDeliveryChannel((await openLibrary()).id,owner.subject);
  return sensaAgentConnectionSetupSchema.parse(await send('POST', '/connection-setups', {
    contractVersion: sensaAgentConnectionContractVersion,
    setupId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    clientKind: input.clientKind,
    label: input.label,
    replacesConnectionId: input.replacesConnectionId ?? null,
  },owner.subject));
}

export async function revokeAgentConnection(connectionId: string): Promise<void> {
  await send('POST', '/connections/revoke', {
    contractVersion: sensaAgentConnectionContractVersion,
    connectionId,
  });
}
