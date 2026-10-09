import { once } from 'node:events';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

import {
  chromium,
  type Browser,
  type Page,
} from '@playwright/test';
import pg from 'pg';
import { build as viteBuild } from 'vite';

import { createConsumerRoutes } from '../../../apps/api/src/sensa/access/consumer.ts';
import type { ConsumerPrincipal } from '../../../apps/api/src/sensa/access/auth.ts';
import type { DatabaseExecutor } from '../../../apps/api/src/database/index.ts';

export type LibraryCloudAccount = Readonly<{
  accountId: string;
  subject: string;
  token: string;
}>;

export type LibraryCloudRequest = Readonly<{
  path: string;
  method: string;
}>;

export type LibraryCloudBrowserFixture = Readonly<{
  browser: Browser;
  origin: string;
  pool: pg.Pool;
  createAccount(token?: string): Promise<LibraryCloudAccount>;
  createClient(account: LibraryCloudAccount): Promise<Page>;
  requests(): readonly LibraryCloudRequest[];
  clearRequests(): void;
  close(): Promise<void>;
}>;

const disposableDatabaseUrl = (): string => {
  const value = process.env.SENSA_ADMIN_TEST_DATABASE_URL ?? process.env.SENSA_TEST_DATABASE_URL;
  if (!value) throw new Error('Disposable loopback database required');
  const parsed = new URL(value);
  if (parsed.hostname !== '127.0.0.1' || !parsed.pathname.startsWith('/sensa_m1a_')) {
    throw new Error('Disposable loopback database required');
  }
  return value;
};

/** Real Chromium, Hono and PostgreSQL fixture shared by database-bound Web tests. */
export async function createLibraryCloudBrowserFixture(providedBrowser?: Browser): Promise<LibraryCloudBrowserFixture> {
  const previousRegistrationPolicy = process.env.SENSA_REGISTRATION_POLICY;
  process.env.SENSA_REGISTRATION_POLICY = 'registered';

  const pool = new pg.Pool({ connectionString: disposableDatabaseUrl() });
  const identities = new Map<string, ConsumerPrincipal>();
  const identity = (token: string): ConsumerPrincipal => {
    const existing = identities.get(token);
    if (existing) return existing;
    const created = {
      issuer: 'https://fixture.supabase.co/auth/v1',
      subject: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      email: 'sync@sensa.invalid',
      authenticatedAt: Math.floor(Date.now() / 1000),
    } satisfies ConsumerPrincipal;
    identities.set(token, created);
    return created;
  };
  identity('first');
  identity('second');

  const app = createConsumerRoutes({
    deleteIdentity: async () => {},
    telemetry: () => {},
    verify: async (request) => {
      const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/u)?.[1];
      const principal = token ? identities.get(token) : undefined;
      if (!principal) throw new Error('Unknown fixture identity');
      return principal;
    },
    transaction: async <Value,>(work: (database: DatabaseExecutor) => Promise<Value>): Promise<Value> => {
      const database = await pool.connect();
      await database.query('BEGIN');
      try {
        await database.query('SET LOCAL ROLE backend_app');
        const value = await work(database);
        await database.query('COMMIT');
        return value;
      } catch (error) {
        await database.query('ROLLBACK');
        throw error;
      } finally {
        database.release();
      }
    },
  });

  const built = await viteBuild({
    configFile: false,
    worker: {format:'es'},
    root: process.cwd(),
    logLevel: 'silent',
    base: '/',
    define: {
      'import.meta.env.VITE_SENSA_API_URL': JSON.stringify('https://service.fixture.invalid'),
    },
    plugins: [{
      name: 'fixture-auth',
      enforce: 'pre',
      load(id) {
        if (id.endsWith('/apps/web/src/data/account/auth.ts')) {
          return "export const auth={getSession:async()=>({data:{session:window.__fixtureAuthSession??{access_token:'fixture',user:{id:'fixture'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})}; export const cachedAuthSubject=()=>window.__fixtureAuthSession?.user.id??null; export {authStorageKey} from './authSessionHint';";
        }
      },
    }],
    build: {
      write: false,
      target: 'es2022',
      rollupOptions: {
        preserveEntrySignatures: 'strict',
        input: {
          core: resolve('scripts/support/libraryCloudBrowserEntry.ts'),
          'local-clear': resolve('scripts/support/localClearBrowserEntry.tsx'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  });
  if (Array.isArray(built) || !('output' in built)) {
    throw new Error('Expected one browser integration bundle');
  }
  const browserFiles = new Map<string, string | Uint8Array>();
  for (const file of built.output) {
    browserFiles.set(
      file.fileName,
      file.type === 'chunk'
        ? file.code
        : typeof file.source === 'string' ? file.source : new Uint8Array(file.source),
    );
  }

  let calls: LibraryCloudRequest[] = [];
  const server = createServer(async (request, response) => {
    const path = request.url ?? '/';
    const assetPath = path.split('?')[0]!.replace(/^\//u, '');
    const asset = browserFiles.get(assetPath);
    if (asset !== undefined) {
      response.setHeader('content-type', assetPath.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
      response.end(typeof asset === 'string' ? asset : Buffer.from(asset));
      return;
    }
    if (!path.startsWith('/sensa/')) {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><title>Library sync integration</title>');
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    calls.push({ path, method: request.method ?? 'GET' });
    const reply = await app.request(`http://fixture${path}`, {
      method: request.method,
      headers: {
        authorization: request.headers.authorization ?? 'Bearer first',
        'content-type': 'application/json',
      },
      ...(body.length > 0 ? { body: new Uint8Array(body) } : {}),
    });
    response.writeHead(reply.status, Object.fromEntries(reply.headers));
    response.end(Buffer.from(await reply.arrayBuffer()));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Library sync fixture did not bind a TCP port');
  const origin = `http://127.0.0.1:${address.port}`;

  let browser: Browser;
  try {
    browser = providedBrowser ?? await chromium.launch({
      headless: true,
      executablePath: process.env.SENSA_CHROMIUM_PATH,
    });
  } catch (error) {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await pool.end();
    if (previousRegistrationPolicy === undefined) delete process.env.SENSA_REGISTRATION_POLICY;
    else process.env.SENSA_REGISTRATION_POLICY = previousRegistrationPolicy;
    throw error;
  }

  let closed = false;
  const contexts = new Set<Awaited<ReturnType<Browser['newContext']>>>();
  return {
    browser,
    origin,
    pool,

    async createAccount(requestedToken = `fixture-${crypto.randomUUID()}`) {
      const principal = identity(requestedToken);
      const reply = await fetch(`${origin}/sensa/web/access/session`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${requestedToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ installationId: crypto.randomUUID() }),
      });
      if (!reply.ok) throw new Error(`Fixture account initialization failed with ${reply.status}`);
      const value = await reply.json() as { accountId: string };
      return { accountId: value.accountId, subject: principal.subject, token: requestedToken };
    },

    async createClient(account) {
      const context = await browser.newContext();
      contexts.add(context);
      await context.addInitScript('window.__name = fn => fn;');
      const page = await context.newPage();
      await page.goto(origin);
      await page.evaluate(async ({ accountId, subject, token }) => {
        const browserWindow = window as any;
        const corePath = '/core.js';
        const core = await import(/* @vite-ignore */ corePath);
        browserWindow.core = core;
        browserWindow.token = token;
        browserWindow.failAck = false;
        browserWindow.offline = false;
        await core.openLibrary();
        await core.command(
          { id: crypto.randomUUID(), kind: 'service.connect', input: {} },
          async (transaction: any) => transaction.put('meta', 'service-owner', { subject, accountId, email:'learner@fixture.invalid' }),
        );
        browserWindow.request = async (path: string, body?: unknown) => {
          if (browserWindow.offline) throw new Error('offline');
          const response = await fetch(`/sensa/library-sync${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
              authorization: `Bearer ${browserWindow.token}`,
              'content-type': 'application/json',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const value = await response.json();
          if (!response.ok) throw new Error(value.code);
          if (browserWindow.failAck && path === '/commit') {
            browserWindow.failAck = false;
            throw new Error('lost_ack');
          }
          return value;
        };
        browserWindow.sync = () => core.synchronizeLibrary(browserWindow.request);
      }, account);
      return page;
    },

    requests: () => calls.map((call) => ({ ...call })),
    clearRequests: () => { calls = []; },

    async close() {
      if (closed) return;
      closed = true;
      await Promise.all([...contexts].map((context) => context.close()));
      if (!providedBrowser) await browser.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await pool.end();
      if (previousRegistrationPolicy === undefined) delete process.env.SENSA_REGISTRATION_POLICY;
      else process.env.SENSA_REGISTRATION_POLICY = previousRegistrationPolicy;
    },
  };
}
