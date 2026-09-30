/** Loopback-only Auth and consumer API for local owner acceptance. */
import { serve } from '@hono/node-server';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwtVerify, SignJWT } from 'jose';
import pg from 'pg';

import { createConsumerRoutes } from '../../apps/api/src/sensa/access/consumer.ts';
import { readLearningContentRegistry } from '../../apps/api/src/sensa/access/learningContentRegistry.ts';
import { ConsumerError, type ConsumerPrincipal } from '../../apps/api/src/sensa/access/auth.ts';
import type { DatabaseExecutor } from '../../apps/api/src/database/index.ts';
import {localSensaCorsOptions} from './localCors.mts';

const host = '127.0.0.1';
const port = Number(process.env.SENSA_LOCAL_SERVICE_PORT ?? 4319);
if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error('Invalid local service port');
const serviceOrigin = `http://${host}:${port}`;
const allowedOrigins = (process.env.SENSA_LOCAL_WEB_ORIGINS ?? '')
  .split(',').map(value => value.trim()).filter(Boolean);
if (!allowedOrigins.length || allowedOrigins.some(value => {
  try {
    const url = new URL(value);
    return url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname);
  } catch { return true; }
})) throw new Error('Local Web origins must be explicit loopback HTTP origins');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== host || !new URL(databaseUrl).pathname.startsWith('/sensa_m1a_')) {
  throw new Error('A disposable loopback Sensa database is required');
}
const catalogPath = process.env.SENSA_LOCAL_PACKAGE_CATALOG_PATH;
const localCatalog = catalogPath ? await readLearningContentRegistry({
  SENSA_PACKAGE_CATALOG_JSON: readFileSync(catalogPath,'utf8'),
}) : undefined;

const issuer = `${serviceOrigin}/auth/v1`;
const localSubject = '10000000-0000-4000-8000-000000000001';
const localSessionId = '10000000-0000-4000-8000-000000000002';
const localRefreshToken = 'sensa-local-refresh-token';
const localOtp = '123456';
const matrixAcceptance = process.env.SENSA_LOCAL_MATRIX_ACCEPTANCE === '1';
const signingKey = new TextEncoder().encode('sensa-local-owner-acceptance-only');
const createdAt = '2026-01-01T00:00:00.000Z';
let currentEmail = 'local@sensa.invalid';

const matrixIdentity = (caseKey: string) => {
  if (!matrixAcceptance || !/^[a-zA-Z0-9-]{2,40}--[a-zA-Z0-9-]{2,40}$/u.test(caseKey)) {
    throw new Error('Invalid language matrix case');
  }
  const uuid = (seed: string) => {
    const hash = createHash('sha256').update(`sensa-language-matrix:${seed}:${caseKey}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  };
  return {
    subject: uuid('subject'),
    sessionId: uuid('session'),
    email: `matrix+${caseKey.toLowerCase()}@sensa.invalid`,
    refreshToken: `sensa-matrix-refresh:${caseKey}`,
  };
};

const user = (email = currentEmail, subject = localSubject) => ({
  id: subject,
  aud: 'authenticated',
  role: 'authenticated',
  email,
  email_confirmed_at: createdAt,
  phone: '',
  confirmed_at: createdAt,
  last_sign_in_at: new Date().toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: createdAt,
  updated_at: new Date().toISOString(),
  is_anonymous: false,
});

async function localSession(email = currentEmail, caseKey?: string) {
  const identity = caseKey ? matrixIdentity(caseKey) : {
    subject: localSubject,
    sessionId: localSessionId,
    email,
    refreshToken: localRefreshToken,
  };
  if (!caseKey) currentEmail = email;
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await new SignJWT({
    email: identity.email,
    role: 'authenticated',
    session_id: identity.sessionId,
    ...(caseKey ? { case_key: caseKey } : {}),
    amr: [{ method: 'otp', timestamp: now }],
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setSubject(identity.subject)
    .setIssuedAt(now)
    .setExpirationTime(now + 24 * 60 * 60)
    .sign(signingKey);
  return {
    access_token: accessToken,
    refresh_token: identity.refreshToken,
    token_type: 'bearer',
    expires_in: 24 * 60 * 60,
    expires_at: now + 24 * 60 * 60,
    user: user(identity.email, identity.subject),
  };
}

const verify = async (request: Request): Promise<ConsumerPrincipal> => {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/u)?.[1];
  if (!token) throw new ConsumerError(401, 'authentication_required');
  try {
    const { payload } = await jwtVerify(token, signingKey, {
      issuer,
      audience: 'authenticated',
      algorithms: ['HS256'],
    });
    const identity = typeof payload.case_key === 'string' ? matrixIdentity(payload.case_key) : {
      subject: localSubject,
      sessionId: localSessionId,
      email: currentEmail,
    };
    if (payload.sub !== identity.subject || payload.session_id !== identity.sessionId || typeof payload.email !== 'string') {
      throw new Error('Invalid local identity');
    }
    const authenticatedAt = Array.isArray(payload.amr)
      ? payload.amr.reduce((latest, entry) => {
        if (!entry || typeof entry !== 'object' || entry.method !== 'otp' || typeof entry.timestamp !== 'number') {
          return latest;
        }
        return Math.max(latest, Math.floor(entry.timestamp));
      }, 0)
      : 0;
    if (!authenticatedAt) throw new Error('Missing local authentication method');
    return {
      issuer,
      subject: identity.subject,
      sessionId: identity.sessionId,
      email: payload.email,
      authenticatedAt,
    };
  } catch {
    throw new ConsumerError(401, 'authentication_required');
  }
};

const pool = new pg.Pool({ connectionString: databaseUrl, max: 6 });
const transaction = async <T>(work: (database: DatabaseExecutor) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE backend_app');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original transaction error. */ }
    throw error;
  } finally {
    client.release();
  }
};

const app = new Hono();
app.use('*', cors(localSensaCorsOptions(allowedOrigins)));
app.use('*', async (context, next) => {
  const origin = context.req.header('origin');
  if (origin && !allowedOrigins.includes(origin)) return context.json({ code: 'local_origin_refused' }, 403);
  context.header('Cache-Control', 'no-store');
  await next();
});

app.get('/health', context => context.json({ ok: true, environment: 'local-owner-acceptance' }));
app.get('/__sensa_local/session', async context => {
  const caseKey = context.req.query('case');
  if (!caseKey) return context.json(await localSession());
  try { return context.json(await localSession(undefined, caseKey)); }
  catch { return context.json({ code: 'invalid_matrix_case' }, 400); }
});
app.post('/auth/v1/otp', async context => {
  const input = await context.req.json().catch(() => ({})) as { email?: unknown };
  if (typeof input.email !== 'string' || !/^\S+@\S+\.\S+$/u.test(input.email) || input.email.length > 254) {
    return context.json({ message: 'Invalid email' }, 400);
  }
  currentEmail = input.email;
  return context.json({});
});
app.post('/auth/v1/verify', async context => {
  const input = await context.req.json().catch(() => ({})) as { email?: unknown; token?: unknown };
  if (input.token !== localOtp || typeof input.email !== 'string' || !/^\S+@\S+\.\S+$/u.test(input.email)) {
    return context.json({ message: 'Invalid OTP', code: 'otp_expired' }, 400);
  }
  return context.json(await localSession(input.email));
});
app.post('/auth/v1/token', async context => {
  const input = await context.req.json().catch(() => ({})) as { refresh_token?: unknown };
  if (typeof input.refresh_token === 'string' && input.refresh_token.startsWith('sensa-matrix-refresh:')) {
    const caseKey = input.refresh_token.slice('sensa-matrix-refresh:'.length);
    try { return context.json(await localSession(undefined, caseKey)); }
    catch { return context.json({ message: 'Invalid refresh token' }, 400); }
  }
  if (input.refresh_token !== localRefreshToken) return context.json({ message: 'Invalid refresh token' }, 400);
  return context.json(await localSession());
});
app.get('/auth/v1/user', async context => {
  try { const principal = await verify(context.req.raw); return context.json(user(principal.email ?? currentEmail, principal.subject)); }
  catch { return context.json({ message: 'Invalid token' }, 401); }
});
app.post('/auth/v1/logout', context => context.body(null, 204));
app.route('/', createConsumerRoutes({
  verify,
  transaction,
  telemetry: () => {},
  deleteIdentity: async () => {},
  learningContentRegistry: localCatalog ? async () => localCatalog : undefined,
}));

const server = serve({ fetch: app.fetch, hostname: host, port });
console.log(`Sensa local service ready at ${serviceOrigin}`);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => void pool.end().finally(() => process.exit(0)));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
