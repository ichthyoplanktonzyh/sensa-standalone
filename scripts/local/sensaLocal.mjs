#!/usr/bin/env node
/** One-command local development and production-build owner acceptance. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadLocalModelEnvironment } from './sensaLocalModelEnvironment.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeRoot = join(root, '.sensa-local');
const lockPath = join(runtimeRoot, 'run.json');
const container = 'sensa-local-postgres';
const image = 'postgres:17';
const database = 'sensa_m1a_local';
const databasePort = 55434;
const databasePassword = 'sensa-local-only';
const databaseUrl = `postgresql://postgres:${databasePassword}@127.0.0.1:${databasePort}/${database}`;
const serviceOrigin = 'http://127.0.0.1:4319';
const extensionOutput = join(root, 'apps/browser-extension/dist-local');
const vite = join(root, 'node_modules/.bin/vite');
const children = [];
let browserContext;
let stopping = false;

const mode = process.argv[2];
const smoke = process.argv.includes('--smoke');
const modelsEnabled = process.argv.includes('--models') || process.env.SENSA_LOCAL_ENABLE_MODELS === '1';
if (!['dev', 'preview', 'reset'].includes(mode)) {
  console.error('Usage: node scripts/local/sensaLocal.mjs dev|preview|reset [--smoke] [--models]');
  process.exit(2);
}
if (!['darwin', 'linux'].includes(process.platform)) {
  console.error('The managed local preview currently supports macOS and Linux.');
  process.exit(2);
}
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Sensa local preview requires Node.js 24 or newer.');
  process.exit(2);
}

mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
mkdirSync(join(runtimeRoot, 'env'), { recursive: true, mode: 0o700 });
const modelEnvironment = loadLocalModelEnvironment({
  root,
  enabled: modelsEnabled,
  environment: process.env,
});

function result(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
}

function checked(command, args, options = {}) {
  const completed = result(command, args, { stdio: 'inherit', ...options });
  if (completed.error) throw completed.error;
  if (completed.status !== 0) throw new Error(`${command} exited with status ${completed.status}`);
}

function activeRun() {
  if (!existsSync(lockPath)) return null;
  try {
    const value = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (!Number.isInteger(value.pid) || value.pid < 1) throw new Error();
    process.kill(value.pid, 0);
    return value;
  } catch {
    rmSync(lockPath, { force: true });
    return null;
  }
}

function releaseLock() {
  try {
    const held = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (held.pid === process.pid) unlinkSync(lockPath);
  } catch { /* A stale or already removed lock needs no cleanup. */ }
}

function requireIdle() {
  const active = activeRun();
  if (active) throw new Error(`Sensa ${active.mode} is already running (PID ${active.pid})`);
}

function safeEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^(VITE_|SUPABASE_|SENSA_|DEEPSEEK_|CLOUDFLARE_|DATABASE_URL$|MIGRATION_DATABASE_URL$|OPENAI_)/u.test(key)) {
      delete environment[key];
    }
  }
  return environment;
}

function dockerInspection() {
  const inspected = result('docker', ['inspect', container]);
  if (inspected.error?.code === 'ENOENT') throw new Error('Docker is required for the isolated local database');
  if (inspected.status !== 0) return null;
  return JSON.parse(inspected.stdout)[0];
}

async function ensureDatabaseContainer() {
  const info = result('docker', ['info']);
  if (info.error?.code === 'ENOENT' || info.status !== 0) {
    throw new Error('Start Docker before running Sensa local preview');
  }
  let inspected = dockerInspection();
  if (!inspected) {
    checked('docker', [
      'run', '--detach', '--name', container,
      '--env', `POSTGRES_PASSWORD=${databasePassword}`,
      '--env', `POSTGRES_DB=${database}`,
      '--publish', `127.0.0.1:${databasePort}:5432`,
      '--health-cmd', `pg_isready -U postgres -d ${database}`,
      '--health-interval', '2s', '--health-timeout', '3s', '--health-retries', '20',
      image,
    ]);
    inspected = dockerInspection();
  }
  const binding = inspected?.HostConfig?.PortBindings?.['5432/tcp']?.[0];
  if (inspected?.Config?.Image !== image || binding?.HostIp !== '127.0.0.1' || binding?.HostPort !== String(databasePort)) {
    throw new Error(`Docker container ${container} exists but is not the managed Sensa local database`);
  }
  if (!inspected.State?.Running) checked('docker', ['start', container]);
  for (let attempt = 0; attempt < 30; attempt++) {
    const ready = result('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', database]);
    if (ready.status === 0) return;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1000));
  }
  throw new Error('The local PostgreSQL container did not become ready');
}

function migrateDatabase() {
  checked(process.execPath, ['--import', 'tsx', 'scripts/db-migrate.ts'], {
    env: { ...safeEnvironment(), MIGRATION_DATABASE_URL: databaseUrl },
  });
}

async function reset() {
  requireIdle();
  await ensureDatabaseContainer();
  checked('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${database}' AND pid<>pg_backend_pid();`]);
  checked('docker', ['exec', container, 'dropdb', '--if-exists', '-U', 'postgres', database]);
  checked('docker', ['exec', container, 'createdb', '-U', 'postgres', database]);
  for (const profile of ['browser-dev', 'browser-preview', 'browser-smoke']) {
    rmSync(join(runtimeRoot, profile), { recursive: true, force: true });
  }
  migrateDatabase();
  console.log('Sensa local development data was reset. Production data was not accessed.');
}

function localWebEnvironment(webOrigin) {
  return {
    ...safeEnvironment(),
    VITE_SENSA_MODE: 'local-owner-acceptance',
    VITE_SUPABASE_URL: serviceOrigin,
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sensa-local-public-key',
    VITE_SENSA_API_URL: serviceOrigin,
    VITE_SENSA_UNLIMITED_PREPARATION: 'true',
    VITE_SENSA_BROWSER_SMOKE: smoke ? 'true' : 'false',
    VITE_WEB_PORT: new URL(webOrigin).port,
    ...(process.env.SENSA_LOCAL_MEDIA_ROOT ? { SENSA_WEB_MEDIA_ROOT: resolve(process.env.SENSA_LOCAL_MEDIA_ROOT) } : {}),
  };
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });
  children.push(child);
  return child;
}

async function waitFor(url, label, child) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`${label} exited before becoming ready`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* Keep waiting for the owned loopback process. */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  throw new Error(`${label} did not become ready`);
}

function stopChild(child) {
  if (!child.pid || child.exitCode !== null) return;
  try { child.kill('SIGTERM'); } catch { /* It already stopped. */ }
}

async function cleanup() {
  if (stopping) return;
  stopping = true;
  try { await browserContext?.close(); } catch { /* Browser already closed. */ }
  for (const child of [...children].reverse()) stopChild(child);
  releaseLock();
}

async function buildLocalAssets(webOrigin) {
  const environment = localWebEnvironment(webOrigin);
  checked(process.execPath, ['--import', 'tsx', 'scripts/release/buildStarterPackage.mts'], {
    env: {
      ...environment,
      SENSA_WEB_ORIGIN: webOrigin,
      SENSA_PACKAGE_OUTPUT: join(root, 'apps/web/public/learning-packages'),
      SENSA_BOOK_RELEASE_SOURCES: join(root, 'content/preview/lightweight-ui-v2.json'),
    },
  });
  checked(process.execPath, ['build.mjs'], {
    cwd: join(root, 'apps/browser-extension'),
    env: {
      ...environment,
      SENSA_EXTENSION_WEB_URL: webOrigin,
      SENSA_EXTENSION_API_URL: serviceOrigin,
      SENSA_EXTENSION_OUT_DIR: extensionOutput,
      SENSA_EXTENSION_NAME: mode === 'preview' ? 'Sensa · Local preview' : 'Sensa · Local development',
    },
  });
  return environment;
}

async function launchBrowser(webOrigin, profile, session) {
  const { chromium } = await import('@playwright/test');
  const args = smoke ? [] : [
    `--disable-extensions-except=${extensionOutput}`,
    `--load-extension=${extensionOutput}`,
  ];
  const requested = process.env.SENSA_LOCAL_BROWSER_CHANNEL;
  const channels = smoke ? [undefined] : requested ? [requested] : ['chrome', 'msedge', undefined];
  let lastError;
  for (const channel of channels) {
    try {
      browserContext = await chromium.launchPersistentContext(profile, {
        ...(channel ? { channel } : {}),
        headless: smoke,
        args,
        viewport: smoke ? { width: 1280, height: 900 } : null,
      });
      break;
    } catch (error) { lastError = error; }
  }
  if (!browserContext) {
    throw new Error(`Could not launch a local acceptance browser. Run "npx playwright install chromium". ${lastError instanceof Error ? lastError.message : ''}`);
  }
  const authKey = `sb-${new URL(serviceOrigin).hostname.split('.')[0]}-auth-token`;
  await browserContext.addInitScript(({ origin, authKey: key, session: value }) => {
    if (location.origin !== origin) return;
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('sensa:local-bootstrap:v1', 'complete');
  }, { origin: webOrigin, authKey, session });
  const page = browserContext.pages()[0] ?? await browserContext.newPage();
  await page.goto(webOrigin, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('nav').length > 0, undefined, { timeout: 60_000 });
  return page;
}

async function runSmoke(page, webOrigin) {
  await page.waitForFunction(() => Boolean(window.__sensaBrowserSmoke), undefined, { timeout: 30_000 });
  const before = await page.evaluate(() => window.__sensaBrowserSmoke.draftCount());
  const diagnostics = await page.evaluate(() => window.__sensaBrowserSmoke.storageDiagnostics());
  if (diagnostics.engine !== 'sqlite-wasm' || diagnostics.persistence !== 'opfs') {
    throw new Error(`Expected SQLite OPFS, received ${JSON.stringify(diagnostics)}`);
  }
  await page.evaluate(() => window.__sensaBrowserSmoke.seedDrafts(1, 0));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(expected => window.__sensaBrowserSmoke?.draftCount().then(count => count === expected), before + 1);
  const health = await fetch(`${serviceOrigin}/health`).then(response => response.json());
  if (!health.ok || page.url() !== `${webOrigin}/`) throw new Error('Local acceptance surface did not remain on loopback');
  console.log(`PASS: ${mode} serves an authenticated Sensa shell with durable SQLite OPFS at ${webOrigin}.`);
}

async function runLocal() {
  requireIdle();
  writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, mode, startedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  const webOrigin = mode === 'preview' ? 'http://127.0.0.1:4173' : 'http://127.0.0.1:3000';
  await ensureDatabaseContainer();
  migrateDatabase();
  const webEnvironment = await buildLocalAssets(webOrigin);
  checked(process.execPath, ['scripts/prepareWebMedia.mjs'], { env: webEnvironment });
  const catalog = readFileSync(join(root, 'release-candidate/catalog.json'), 'utf8');
  const service = start(process.execPath, ['--import', 'tsx', 'scripts/local/sensaLocalService.mts'], {
    env: {
      ...safeEnvironment(),
      DATABASE_URL: databaseUrl,
      SENSA_LOCAL_SERVICE_PORT: '4319',
      SENSA_LOCAL_WEB_ORIGINS: 'http://127.0.0.1:3000,http://127.0.0.1:4173',
      SENSA_REGISTRATION_POLICY: 'registered',
      ...modelEnvironment,
      SENSA_PACKAGE_CATALOG_JSON: catalog,
    },
  });
  await waitFor(`${serviceOrigin}/health`, 'Local service', service);
  if (mode === 'preview') {
    checked(vite, ['build', '--mode', 'sensa-local'], {
      cwd: join(root, 'apps/web'),
      env: webEnvironment,
    });
  }
  const webArgs = mode === 'preview'
    ? ['preview', '--host', '127.0.0.1', '--mode', 'sensa-local', '--port', '4173', '--strictPort']
    : ['--host', '127.0.0.1', '--mode', 'sensa-local', '--port', '3000', '--strictPort'];
  const web = start(vite, webArgs, {
    cwd: join(root, 'apps/web'),
    env: webEnvironment,
  });
  await waitFor(webOrigin, 'Local Web', web);
  const sessionResponse = await fetch(`${serviceOrigin}/__sensa_local/session`);
  if (!sessionResponse.ok) throw new Error('Could not create the local test session');
  const session = await sessionResponse.json();
  if (modelsEnabled) {
    console.warn('Local model opt-in is enabled. Requests use the configured real provider and may incur cost.');
  }
  const profileName = smoke ? 'browser-smoke' : mode === 'preview' ? 'browser-preview' : 'browser-dev';
  const page = await launchBrowser(webOrigin, join(runtimeRoot, profileName), session);
  if (smoke) {
    await runSmoke(page, webOrigin);
    return;
  }
  console.log(`${mode === 'preview' ? 'Production-build preview' : 'Local development'} ready: ${webOrigin}`);
  console.log('Close the acceptance browser or press Ctrl+C to stop.');
  await new Promise((resolveDone, rejectDone) => {
    browserContext.on('close', resolveDone);
    for (const child of children) child.on('exit', code => {
      if (!stopping) rejectDone(new Error(`A local service stopped unexpectedly (${code ?? 'signal'})`));
    });
  });
}

process.on('SIGINT', () => void cleanup());
process.on('SIGTERM', () => void cleanup());
process.on('exit', releaseLock);

try {
  if (mode === 'reset') await reset();
  else await runLocal();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await cleanup();
}
