import {edgeSpeechProvider} from './speechProvider.mts';
/** Loopback-only Auth and consumer API for local owner acceptance. */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwtVerify, SignJWT } from 'jose';
import pg from 'pg';

import { createConsumerRoutes } from '../../apps/api/src/sensa/access/consumer.ts';
import { ConsumerError, type ConsumerPrincipal } from '../../apps/api/src/sensa/access/auth.ts';
import type { DatabaseExecutor } from '../../apps/api/src/database/index.ts';

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

const issuer = `${serviceOrigin}/auth/v1`;
const localSubject = '10000000-0000-4000-8000-000000000001';
const localSessionId = '10000000-0000-4000-8000-000000000002';
const localRefreshToken = 'sensa-local-refresh-token';
const localOtp = '123456';
const signingKey = new TextEncoder().encode('sensa-local-owner-acceptance-only');
const createdAt = '2026-01-01T00:00:00.000Z';
let currentEmail = 'local@sensa.invalid';

const user = (email = currentEmail) => ({
  id: localSubject,
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

async function localSession(email = currentEmail) {
  currentEmail = email;
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await new SignJWT({
    email,
    role: 'authenticated',
    session_id: localSessionId,
    amr: [{ method: 'otp', timestamp: now }],
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setSubject(localSubject)
    .setIssuedAt(now)
    .setExpirationTime(now + 24 * 60 * 60)
    .sign(signingKey);
  return {
    access_token: accessToken,
    refresh_token: localRefreshToken,
    token_type: 'bearer',
    expires_in: 24 * 60 * 60,
    expires_at: now + 24 * 60 * 60,
    user: user(email),
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
    if (payload.sub !== localSubject || payload.session_id !== localSessionId || typeof payload.email !== 'string') {
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
      subject: localSubject,
      sessionId: localSessionId,
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
app.use('*', cors({
  origin: allowedOrigins,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['authorization', 'content-type', 'apikey', 'x-client-info', 'x-supabase-api-version'],
  exposeHeaders: ['x-request-id'],
}));
app.use('*', async (context, next) => {
  const origin = context.req.header('origin');
  if (origin && !allowedOrigins.includes(origin)) return context.json({ code: 'local_origin_refused' }, 403);
  context.header('Cache-Control', 'no-store');
  await next();
});

app.get('/health', context => context.json({ ok: true, environment: 'local-owner-acceptance' }));
app.get('/__sensa_local/session', async context => context.json(await localSession()));
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
  if (input.refresh_token !== localRefreshToken) return context.json({ message: 'Invalid refresh token' }, 400);
  return context.json(await localSession());
});
app.get('/auth/v1/user', async context => {
  try { return context.json(user((await verify(context.req.raw)).email ?? currentEmail)); }
  catch { return context.json({ message: 'Invalid token' }, 401); }
});
app.post('/auth/v1/logout', context => context.body(null, 204));
app.route('/', createConsumerRoutes({
  verify,
  speechProvider: edgeSpeechProvider(process.env.SENSA_LOCAL_ENABLE_TTS === '1'),
  transaction,
  telemetry: () => {},
  deleteIdentity: async () => {},
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
