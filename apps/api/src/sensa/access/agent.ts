import {
  sensaAgentConnectionContractVersion,
  type SensaAgentConnectionCredential,
  type SensaAgentConnectionEvent,
  type SensaAgentConnectionExchange,
  type SensaAgentConnectionSetup,
  type SensaAgentConnectionSetupCreate,
  type SensaAgentConnectionView,
} from '@sensa/contracts/sensa';

import type { DatabaseExecutor } from '../../database/index.js';
import { ConsumerError, type ConsumerPrincipal, type ConsumerVerifier } from './auth.js';

type AgentAccount = {
  account_id: string;
  session_id: string;
  epoch: string;
  now: Date;
};

const setupLifetimeMs = 10 * 60 * 1000;
const tokenLifetimeMs = 365 * 24 * 60 * 60 * 1000;

async function hash(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

const iso = (value: Date | string): string => new Date(value).toISOString();

async function event(
  db: DatabaseExecutor,
  input: {
    accountId: string;
    connectionId: string;
    clientKind: string;
    label: string;
    eventType: 'setup_created' | 'activated' | 'replaced' | 'revoked';
    now: Date;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO sensa_consumer.agent_connection_events
      (event_id,account_id,connection_id,client_kind,label,event_type,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      crypto.randomUUID(), input.accountId, input.connectionId, input.clientKind,
      input.label, input.eventType, input.now,
    ],
  );
}

export async function createAgentConnectionSetup(
  db: DatabaseExecutor,
  account: AgentAccount,
  input: SensaAgentConnectionSetupCreate,
): Promise<SensaAgentConnectionSetup> {
  const active = Number((await db.query(
    `SELECT count(*)::int AS n FROM sensa_consumer.agent_connections
      WHERE account_id=$1 AND revoked_at IS NULL AND expires_at>$2`,
    [account.account_id, account.now],
  )).rows[0]!.n);
  if (active >= 20 && input.replacesConnectionId === null) {
    throw new ConsumerError(409, 'agent_connection_limit');
  }
  const pending = Number((await db.query(
    `SELECT count(*)::int AS n FROM sensa_consumer.agent_connection_setups
      WHERE account_id=$1 AND consumed_at IS NULL AND expires_at>$2`,
    [account.account_id, account.now],
  )).rows[0]!.n);
  if (pending >= 10) throw new ConsumerError(429, 'agent_setup_rate_limit');
  if (input.replacesConnectionId !== null) {
    const replaced = (await db.query(
      `SELECT connection_id FROM sensa_consumer.agent_connections
        WHERE account_id=$1 AND connection_id=$2 AND revoked_at IS NULL AND expires_at>$3
        FOR UPDATE`,
      [account.account_id, input.replacesConnectionId, account.now],
    )).rows[0];
    if (!replaced) throw new ConsumerError(404, 'agent_connection_not_found');
  }
  const setupCode = `sensa_setup_${crypto.randomUUID()}${crypto.randomUUID()}`;
  const expiresAt = new Date(account.now.getTime() + setupLifetimeMs);
  try {
    await db.query(
      `INSERT INTO sensa_consumer.agent_connection_setups
        (setup_id,connection_id,account_id,session_id,scope_epoch,client_kind,label,code_hash,
         replaces_connection_id,created_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.setupId, input.connectionId, account.account_id, account.session_id, account.epoch,
        input.clientKind, input.label, await hash(setupCode), input.replacesConnectionId,
        account.now, expiresAt,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ConsumerError(409, 'agent_setup_conflict');
    }
    throw error;
  }
  await event(db, {
    accountId: account.account_id,
    connectionId: input.connectionId,
    clientKind: input.clientKind,
    label: input.label,
    eventType: 'setup_created',
    now: account.now,
  });
  return {
    contractVersion: sensaAgentConnectionContractVersion,
    setupId: input.setupId,
    connectionId: input.connectionId,
    clientKind: input.clientKind,
    label: input.label,
    setupCode,
    replacesConnectionId: input.replacesConnectionId,
    createdAt: account.now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

/** Atomically consumes a setup code, activates the new connection and only then revokes its predecessor. */
export async function exchangeAgentConnectionSetup(
  db: DatabaseExecutor,
  input: SensaAgentConnectionExchange,
  now: Date,
): Promise<SensaAgentConnectionCredential> {
  const row = (await db.query(
    `SELECT p.*,a.lifecycle,a.epoch AS account_epoch,s.revoked,i.revoked AS invite_revoked
       FROM sensa_consumer.agent_connection_setups p
       JOIN sensa_consumer.accounts a USING(account_id)
       JOIN sensa_consumer.sessions s ON s.id=p.session_id
       JOIN sensa_consumer.invitations i ON i.issuer=a.issuer AND i.subject=a.subject
      WHERE p.setup_id=$1 AND p.code_hash=$2 FOR UPDATE OF p,a`,
    [input.setupId, await hash(input.setupCode)],
  )).rows[0];
  if (!row) throw new ConsumerError(401, 'agent_setup_invalid');
  if (row.consumed_at) throw new ConsumerError(409, 'agent_setup_consumed');
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    throw new ConsumerError(410, 'agent_setup_expired');
  }
  if (
    row.lifecycle !== 'active' || row.revoked || row.invite_revoked
    || String(row.account_epoch) !== String(row.scope_epoch)
  ) throw new ConsumerError(401, 'access_revoked');
  const active = Number((await db.query(
    `SELECT count(*)::int AS n FROM sensa_consumer.agent_connections
      WHERE account_id=$1 AND revoked_at IS NULL AND expires_at>$2`,
    [row.account_id, now],
  )).rows[0]!.n);
  if (active >= 20 && row.replaces_connection_id === null) {
    throw new ConsumerError(409, 'agent_connection_limit');
  }
  const token = `sensa_agent_${crypto.randomUUID()}${crypto.randomUUID()}`;
  const expiresAt = new Date(now.getTime() + tokenLifetimeMs);
  await db.query(
    `INSERT INTO sensa_consumer.agent_connections
      (connection_id,account_id,session_id,scope_epoch,label,token_hash,created_at,expires_at,client_kind)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      row.connection_id, row.account_id, row.session_id, row.scope_epoch, row.label,
      await hash(token), now, expiresAt, row.client_kind,
    ],
  );
  if (row.replaces_connection_id !== null) {
    const replaced = (await db.query(
      `UPDATE sensa_consumer.agent_connections SET revoked_at=$3
        WHERE account_id=$1 AND connection_id=$2 AND revoked_at IS NULL
        RETURNING connection_id,client_kind,label`,
      [row.account_id, row.replaces_connection_id, now],
    )).rows[0];
    if (!replaced) throw new ConsumerError(409, 'agent_replacement_unavailable');
    await event(db, {
      accountId: String(row.account_id),
      connectionId: String(replaced.connection_id),
      clientKind: String(replaced.client_kind),
      label: String(replaced.label),
      eventType: 'replaced',
      now,
    });
  }
  await db.query(
    `UPDATE sensa_consumer.agent_connection_setups SET consumed_at=$2 WHERE setup_id=$1`,
    [input.setupId, now],
  );
  await event(db, {
    accountId: String(row.account_id),
    connectionId: String(row.connection_id),
    clientKind: String(row.client_kind),
    label: String(row.label),
    eventType: 'activated',
    now,
  });
  return {
    contractVersion: sensaAgentConnectionContractVersion,
    connectionId: String(row.connection_id),
    clientKind: row.client_kind,
    label: String(row.label),
    token,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function listAgentConnections(
  db: DatabaseExecutor,
  accountId: string,
  now: Date,
): Promise<SensaAgentConnectionView[]> {
  const rows = (await db.query(
    `SELECT connection_id,client_kind,label,created_at,expires_at,last_used_at,revoked_at
       FROM sensa_consumer.agent_connections
      WHERE account_id=$1
      ORDER BY created_at DESC,connection_id LIMIT 100`,
    [accountId],
  )).rows;
  return rows.map((row) => ({
    contractVersion: sensaAgentConnectionContractVersion,
    connectionId: String(row.connection_id),
    clientKind: row.client_kind,
    label: String(row.label),
    state: row.revoked_at !== null
      ? 'revoked'
      : new Date(row.expires_at).getTime() <= now.getTime() ? 'expired' : 'active',
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    lastUsedAt: row.last_used_at === null ? null : iso(row.last_used_at),
    revokedAt: row.revoked_at === null ? null : iso(row.revoked_at),
  }));
}

export async function listAgentConnectionEvents(
  db: DatabaseExecutor,
  accountId: string,
): Promise<SensaAgentConnectionEvent[]> {
  const rows = (await db.query(
    `SELECT event_id,connection_id,client_kind,label,event_type,created_at
       FROM sensa_consumer.agent_connection_events
      WHERE account_id=$1 ORDER BY created_at DESC,event_id LIMIT 100`,
    [accountId],
  )).rows;
  return rows.map((row) => ({
    contractVersion: sensaAgentConnectionContractVersion,
    eventId: String(row.event_id),
    connectionId: String(row.connection_id),
    clientKind: row.client_kind,
    label: String(row.label),
    eventType: row.event_type,
    createdAt: iso(row.created_at),
  }));
}

export async function revokeAgentConnection(
  db: DatabaseExecutor,
  account: AgentAccount,
  connectionId: string,
): Promise<void> {
  const row = (await db.query(
    `UPDATE sensa_consumer.agent_connections
        SET revoked_at=COALESCE(revoked_at,$3)
      WHERE account_id=$1 AND connection_id=$2
      RETURNING client_kind,label,revoked_at`,
    [account.account_id, connectionId, account.now],
  )).rows[0];
  if (!row) throw new ConsumerError(404, 'agent_connection_not_found');
  if (new Date(row.revoked_at).getTime() === account.now.getTime()) {
    await event(db, {
      accountId: account.account_id,
      connectionId,
      clientKind: String(row.client_kind),
      label: String(row.label),
      eventType: 'revoked',
      now: account.now,
    });
  }
}

/** Adds the intake-only Agent credential form without broadening Web/extension credentials. */
export function agentVerifier(
  base: ConsumerVerifier,
  transaction: <T>(work: (db: DatabaseExecutor) => Promise<T>) => Promise<T>,
  clock: () => Date,
): ConsumerVerifier {
  return async (request) => {
    const token = request.headers.get('authorization')?.match(/^Bearer (sensa_agent_\S+)$/u)?.[1];
    if (!token) return base(request);
    const now = clock();
    const row = await transaction(async (db) => {
      const found = (await db.query(
        `SELECT c.connection_id,c.label,c.scope_epoch,c.expires_at,c.revoked_at,
                a.issuer,a.subject,a.epoch,a.lifecycle,
                s.provider_session_id,s.revoked,i.revoked AS invite_revoked
           FROM sensa_consumer.agent_connections c
           JOIN sensa_consumer.accounts a USING(account_id)
           JOIN sensa_consumer.sessions s ON s.id=c.session_id
           JOIN sensa_consumer.invitations i ON i.issuer=a.issuer AND i.subject=a.subject
          WHERE c.token_hash=$1`,
        [await hash(token)],
      )).rows[0];
      if (
        !found || found.lifecycle !== 'active'
        || new Date(found.expires_at).getTime() <= now.getTime()
        || found.revoked_at || found.revoked || found.invite_revoked
        || String(found.epoch) !== String(found.scope_epoch)
      ) throw new ConsumerError(401, 'access_revoked');
      await db.query(
        `UPDATE sensa_consumer.agent_connections
            SET last_used_at=CASE WHEN last_used_at IS NULL OR last_used_at<$2 THEN $2 ELSE last_used_at END
          WHERE connection_id=$1`,
        [found.connection_id, now],
      );
      return found;
    });
    return {
      issuer: String(row.issuer),
      subject: String(row.subject),
      sessionId: String(row.provider_session_id),
      email: null,
      agentConnectionId: String(row.connection_id),
      agentLabel: String(row.label),
    } satisfies ConsumerPrincipal;
  };
}
