#!/usr/bin/env node
/**
 * Run the paid language matrix only against a disposable local PostgreSQL
 * container, local API, and local Web server. This deliberately does not reuse
 * scripts/local/sensaLocal.mjs's long-lived owner database.
 */
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalModelEnvironment } from '../local/sensaLocalModelEnvironment.mjs';
import { summarizeRunDirectory } from './summarizeLanguageMatrix.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArguments(process.argv.slice(2));
const servicePort = 4319 + args.slot;
const webPort = 3000 + args.slot;
const serviceOrigin = `http://127.0.0.1:${servicePort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const image = 'postgres:17';
const matrixIds = {
  business: 'live-business-language-matrix',
  web: 'live-personal-language-matrix',
  extension: 'live-extension-language-matrix',
};
const selectedSuites = args.webOnly ? ['web'] : args.extensionOnly ? ['extension'] : ['business'];
const runtimeRoot = join(root, '.sensa-local/language-matrix');
const runId = `${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(4).toString('hex')}`;
const runDirectory = join(runtimeRoot, runId);
const logDirectory = join(runDirectory, 'logs');
const resultPath = join(runDirectory, 'result.json');
const serviceLog = join(logDirectory, 'service.log');
const webLog = join(logDirectory, 'web.log');
const migrationLog = join(logDirectory, 'migration.log');
const modelRuntimeBuildLog = join(logDirectory, 'model-runtime-build.log');
const extensionBuildLog = join(logDirectory, 'extension-build.log');
const mediaPrepareLog = join(logDirectory, 'media-prepare.log');
const testLogs = {};
const children = new Set();
let createdContainer;
let stopping = false;
let runState;
let serviceChild;
let webChild;

function parseArguments(arguments_) {
  const parsed = { webOnly: false, extensionOnly: false, start: 0, limit: undefined, caseKey: undefined, dryRun: false, preflight: false, slot: 0, reusePreparedArtifacts: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--web-only') parsed.webOnly = true;
    else if (argument === '--extension-only') parsed.extensionOnly = true;
    else if (argument === '--dry-run') parsed.dryRun = true;
    else if (argument === '--preflight') parsed.preflight = true;
    else if (argument === '--reuse-prepared-artifacts') parsed.reusePreparedArtifacts = true;
    else if (argument === '--slot' || argument.startsWith('--slot=')) {
      const value = argument === '--slot' ? arguments_[++index] : argument.slice('--slot='.length);
      if (!/^\d+$/u.test(value ?? '') || Number(value) > 7) throw new Error('--slot must be an integer from 0 to 7');
      parsed.slot = Number(value);
    }
    else if (argument === '--start' || argument.startsWith('--start=')) {
      const value = argument === '--start' ? arguments_[++index] : argument.slice('--start='.length);
      if (!/^\d+$/u.test(value ?? '') || Number(value) > 323) {
        throw new Error('--start must be a zero-based integer from 0 to 323');
      }
      parsed.start = Number(value);
    }
    else if (argument === '--limit' || argument.startsWith('--limit=')) {
      const value = argument === '--limit' ? arguments_[++index] : argument.slice('--limit='.length);
      if (!/^\d+$/u.test(value ?? '') || Number(value) < 1 || Number(value) > 324) {
        throw new Error('--limit must be an integer from 1 to 324');
      }
      parsed.limit = Number(value);
    } else if (argument === '--case' || argument.startsWith('--case=')) {
      const value = argument === '--case' ? arguments_[++index] : argument.slice('--case='.length);
      if (!/^[a-zA-Z0-9-]{2,40}--[a-zA-Z0-9-]{2,40}$/u.test(value ?? '')) {
        throw new Error('--case must be <target-language-tag>--<support-language-tag>');
      }
      parsed.caseKey = value;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (parsed.webOnly && parsed.extensionOnly) throw new Error('Choose only one of --web-only or --extension-only');
  if (parsed.caseKey && parsed.limit) throw new Error('Use either --case or --limit, not both');
  if (parsed.caseKey && parsed.start) throw new Error('--start cannot be combined with --case');
  if (parsed.start && parsed.limit === undefined) throw new Error('--start requires --limit');
  if (parsed.start + (parsed.limit ?? 0) > 324) throw new Error('--start plus --limit exceeds the 324-pair matrix');
  if (parsed.preflight && (parsed.webOnly || parsed.extensionOnly || parsed.start || parsed.limit || parsed.caseKey || parsed.dryRun)) {
    throw new Error('--preflight runs alone and does not accept suite or case selectors');
  }
  if ((parsed.webOnly || parsed.extensionOnly) && !parsed.caseKey && parsed.limit === undefined) {
    throw new Error('UI smoke requires --case or --limit (up to 6); the 324-pair matrix uses the default business suite.');
  }
  if ((parsed.webOnly || parsed.extensionOnly) && parsed.limit !== undefined && parsed.limit > 6) {
    throw new Error('UI smoke accepts at most 6 language pairs.');
  }
  if (parsed.preflight) return { ...parsed, webOnly: false, extensionOnly: false };
  return parsed;
}

function sanitizedEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^(VITE_|SUPABASE_|SENSA_|DEEPSEEK_|CLOUDFLARE_|DATABASE_URL$|MIGRATION_DATABASE_URL$|OPENAI_)/u.test(key)) {
      delete environment[key];
    }
  }
  return environment;
}

function result(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
}

function checked(command, commandArgs, options = {}) {
  const completed = result(command, commandArgs, options);
  if (completed.error) throw completed.error;
  if (completed.status !== 0) {
    const detail = completed.stderr?.trim() || completed.stdout?.trim();
    throw new Error(`${command} exited with status ${completed.status}${detail ? `: ${detail}` : ''}`);
  }
  return completed.stdout ?? '';
}

function ensureLoopbackPortAvailable(port) {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', () => rejectPort(new Error(`Required loopback port ${port} is already in use; stopping without touching that process.`)));
    server.listen(port, '127.0.0.1', () => server.close(error => error ? rejectPort(error) : resolvePort()));
  });
}

function logDescriptor(path) {
  return openSync(path, 'a', 0o600);
}

function start(command, commandArgs, logPath, options = {}) {
  const fd = logDescriptor(logPath);
  let child;
  try {
    child = spawn(command, commandArgs, {
      cwd: options.cwd ?? root,
      env: options.env ?? sanitizedEnvironment(),
      stdio: ['ignore', fd, fd],
      detached: process.platform !== 'win32',
    });
  } finally {
    closeSync(fd);
  }
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

async function waitFor(url, label, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${label} exited before becoming ready. See ${runDirectory}/logs.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* Wait while the owned local process starts. */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  throw new Error(`${label} did not become ready. See ${runDirectory}/logs.`);
}

function dockerChecked(commandArgs) {
  return checked('docker', commandArgs, { stdio: 'pipe' });
}

async function createDisposableDatabase() {
  const info = result('docker', ['info']);
  if (info.error?.code === 'ENOENT' || info.status !== 0) throw new Error('Docker must be running for the isolated language-matrix database.');

  const suffix = randomBytes(8).toString('hex');
  const container = `sensa-language-matrix-${suffix}`;
  const database = `sensa_m1a_matrix_${suffix}`;
  const password = randomBytes(24).toString('hex');
  dockerChecked([
    'run', '--detach', '--rm', '--name', container,
    '--env', `POSTGRES_PASSWORD=${password}`,
    '--env', `POSTGRES_DB=${database}`,
    '--publish', '127.0.0.1::5432',
    '--health-cmd', `pg_isready -U postgres -d ${database}`,
    '--health-interval', '2s', '--health-timeout', '3s', '--health-retries', '30',
    image,
  ]);
  createdContainer = container;

  let port;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const mapping = result('docker', ['port', container, '5432/tcp']);
    const match = mapping.stdout?.match(/^127\.0\.0\.1:(\d+)\s*$/mu);
    if (mapping.status === 0 && match) { port = Number(match[1]); break; }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  if (!port) throw new Error('Could not resolve the loopback port for the newly created disposable database.');
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const ready = result('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', database]);
    if (ready.status === 0) return { container, database, databaseUrl };
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1000));
  }
  throw new Error('The newly created disposable PostgreSQL container did not become ready.');
}

function runLogged(command, commandArgs, logPath, options = {}) {
  const fd = logDescriptor(logPath);
  try {
    const completed = result(command, commandArgs, {
      ...options,
      stdio: ['ignore', fd, fd],
    });
    if (completed.error) throw completed.error;
    if (completed.status !== 0) throw new Error(`${command} exited with status ${completed.status}; see ${logPath}`);
  } finally {
    closeSync(fd);
  }
}

function localWebEnvironment() {
  return {
    ...sanitizedEnvironment(),
    VITE_SENSA_MODE: 'local-owner-acceptance',
    VITE_SUPABASE_URL: serviceOrigin,
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sensa-local-public-key',
    VITE_SENSA_API_URL: serviceOrigin,
    VITE_SENSA_UNLIMITED_PREPARATION: 'true',
    VITE_SENSA_BROWSER_SMOKE: 'false',
    VITE_WEB_PORT: String(webPort),
    ...(process.env.SENSA_LOCAL_MEDIA_ROOT ? { SENSA_WEB_MEDIA_ROOT: resolve(process.env.SENSA_LOCAL_MEDIA_ROOT) } : {}),
  };
}

function writeResults(state, patch) {
  Object.assign(state, patch, { updatedAt: new Date().toISOString() });
  writeFileSync(resultPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function cleanup() {
  if (stopping) return;
  stopping = true;
  for (const child of [...children]) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch { /* The owned child already exited. */ }
  }
  await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
  for (const child of [...children]) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch { /* The owned child already exited. */ }
  }
  if (createdContainer) {
    result('docker', ['rm', '--force', createdContainer], { stdio: 'ignore' });
    createdContainer = undefined;
  }
}

function handleSignal(signal) {
  void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
}

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));

async function verifyPreflightSessions() {
  const healthResponse = await fetch(`${serviceOrigin}/health`);
  const health = await healthResponse.json();
  if (!healthResponse.ok || health.ok !== true) throw new Error('Preflight failed: isolated local service health check failed.');
  const caseKeys = ['web-en--zh-Hans', 'extension-en--zh-Hans'];
  const sessions = [];
  for (const caseKey of caseKeys) {
    const response = await fetch(`${serviceOrigin}/__sensa_local/session?case=${encodeURIComponent(caseKey)}`);
    if (!response.ok) throw new Error(`Preflight failed: could not create isolated session for ${caseKey}.`);
    const session = await response.json();
    if (!session.user?.id || !session.refresh_token) throw new Error(`Preflight failed: incomplete synthetic session for ${caseKey}.`);
    const refreshResponse = await fetch(`${serviceOrigin}/auth/v1/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!refreshResponse.ok) throw new Error(`Preflight failed: refresh token rejected for ${caseKey}.`);
    const refreshed = await refreshResponse.json();
    if (refreshed.user?.id !== session.user.id || refreshed.refresh_token !== session.refresh_token) {
      throw new Error(`Preflight failed: refreshed session identity changed for ${caseKey}.`);
    }
    sessions.push({ caseKey, userId: session.user.id, refreshStable: true });
  }
  if (sessions[0].userId === sessions[1].userId) throw new Error('Preflight failed: matrix cases share the same synthetic account.');
  return { serviceHealth: true, distinctAccounts: true, refreshStable: true, cases: sessions.map(({ caseKey, refreshStable }) => ({ caseKey, refreshStable })) };
}

async function main() {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('The isolated language-matrix runner supports macOS and Linux.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('The isolated language-matrix runner requires Node.js 24 or newer.');
  if (args.dryRun) {
    console.log(`Dry run: suites=${selectedSuites.join(',')} case=${args.caseKey ?? 'all'} start=${args.start} limit=${args.limit ?? 'none'}`);
    console.log(`A live run will use a newly created --rm PostgreSQL container, ${serviceOrigin}, ${webOrigin}, and write artifacts below .sensa-local/language-matrix/${runId}/.`);
    console.log('No services, models, or TTS were started.');
    return;
  }
  if (!args.preflight && process.env.SENSA_LIVE_ACCEPTANCE !== '1') {
    throw new Error('Live paid services are disabled. Set SENSA_LIVE_ACCEPTANCE=1 only when explicitly starting the real acceptance run.');
  }

  const modelEnvironment = loadLocalModelEnvironment({ root, enabled: !args.preflight, environment: process.env });
  mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  const state = {
    runId,
    startedAt: new Date().toISOString(),
    mode: args.preflight ? 'preflight' : 'live',
    suites: args.preflight ? [] : selectedSuites,
    case: args.caseKey ?? null,
    start: args.start,
    limit: args.limit ?? null,
    status: 'starting',
    tests: {},
    logs: { service: 'logs/service.log', web: 'logs/web.log', migration: 'logs/migration.log' },
  };
  runState = state;
  writeResults(state, {});

  await Promise.all([ensureLoopbackPortAvailable(servicePort), ensureLoopbackPortAvailable(webPort)]);
  if (!args.preflight && !args.reusePreparedArtifacts) {
    runLogged('npm', ['run', 'build', '--workspace', '@sensa/model-runtime'], modelRuntimeBuildLog);
    state.logs.modelRuntimeBuild = 'logs/model-runtime-build.log';
    writeResults(state, {});
  }
  const database = await createDisposableDatabase();
  runLogged(process.execPath, ['--import', 'tsx', 'scripts/db-migrate.ts'], migrationLog, {
    env: { ...sanitizedEnvironment(), MIGRATION_DATABASE_URL: database.databaseUrl },
  });

  const catalogPath = join(root, 'release-candidate/portable-catalog.json');
  const serviceEnvironment = {
    ...sanitizedEnvironment(),
    DATABASE_URL: database.databaseUrl,
    SENSA_LOCAL_SERVICE_PORT: String(servicePort),
    SENSA_LOCAL_WEB_ORIGINS: webOrigin,
    SENSA_REGISTRATION_POLICY: 'registered',
    SENSA_LOCAL_MATRIX_ACCEPTANCE: '1',
    SENSA_UNLIMITED_MODEL_USAGE: 'true',
    ...modelEnvironment,
    ...(process.env.SENSA_TTS_PYTHON ? { SENSA_TTS_PYTHON: process.env.SENSA_TTS_PYTHON } : {}),
    ...(existsSync(catalogPath) ? { SENSA_PACKAGE_CATALOG_JSON: readFileSync(catalogPath, 'utf8') } : {}),
  };
  serviceChild = start(process.execPath, ['--import', 'tsx', 'scripts/local/sensaLocalService.mts'], serviceLog, { env: serviceEnvironment });
  await waitFor(`${serviceOrigin}/health`, 'Local API service', serviceChild);
  const webEnvironment = localWebEnvironment();
  if (!args.reusePreparedArtifacts) {
    runLogged(process.execPath, ['scripts/prepareWebMedia.mjs'], mediaPrepareLog, { env: webEnvironment });
    state.logs.mediaPrepare = 'logs/media-prepare.log';
    writeResults(state, {});
  }
  webChild = start(join(root, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--mode', 'sensa-local', '--port', String(webPort), '--strictPort'], webLog, {
    cwd: join(root, 'apps/web'), env: webEnvironment,
  });
  await waitFor(webOrigin, 'Local Web', webChild);

  if (args.preflight) {
    const preflight = await verifyPreflightSessions();
    writeResults(state, { status: 'passed', preflight, finishedAt: new Date().toISOString() });
    console.log(`PASS isolated database, API health, Web readiness, distinct synthetic accounts, and stable refresh tokens. Results: .sensa-local/language-matrix/${runId}/result.json`);
    return;
  }

  let extensionPath = '';
  if (selectedSuites.includes('extension')) {
    extensionPath = join(runDirectory, 'extension');
    mkdirSync(extensionPath, { recursive: true, mode: 0o700 });
    runLogged(process.execPath, ['build.mjs'], extensionBuildLog, {
      cwd: join(root, 'apps/browser-extension'),
      env: {
        ...sanitizedEnvironment(),
        SENSA_EXTENSION_WEB_URL: webOrigin,
        SENSA_EXTENSION_API_URL: serviceOrigin,
        SENSA_EXTENSION_OUT_DIR: extensionPath,
        SENSA_EXTENSION_NAME: 'Sensa · Live matrix acceptance',
      },
    });
    state.logs.extensionBuild = 'logs/extension-build.log';
    writeResults(state, {});
  }

  const filter = args.caseKey;
  const caseStart = String(args.start);
  const limit = args.limit === undefined ? undefined : String(args.limit);
  const commonTestEnvironment = {
    ...sanitizedEnvironment(),
    SENSA_LIVE_ACCEPTANCE: '1',
    SENSA_LIVE_WEB_URL: webOrigin,
    SENSA_LIVE_SERVICE_URL: serviceOrigin,
    SENSA_LIVE_REPORT_DIR: runDirectory,
    ...(filter ? { SENSA_LIVE_CASE_FILTER: filter } : {}),
    SENSA_LIVE_CASE_START: caseStart,
    ...(limit ? { SENSA_LIVE_CASE_LIMIT: limit } : {}),
    ...(extensionPath ? { SENSA_LIVE_EXTENSION_PATH: extensionPath } : {}),
  };

  writeResults(state, { status: 'running' });
  for (const suite of selectedSuites) {
    const id = matrixIds[suite];
    const logPath = join(logDirectory, `${id}.log`);
    const playwrightOutputDirectory = join(runDirectory, 'playwright', id);
    mkdirSync(playwrightOutputDirectory, { recursive: true, mode: 0o700 });
    testLogs[suite] = `logs/${id}.log`;
    writeResults(state, { logs: { ...state.logs, tests: testLogs } });
    const fd = logDescriptor(logPath);
    const startedAt = new Date().toISOString();
    const completed = spawnSync(process.execPath, ['--import', 'tsx', 'tests/web/run.mts', `--id=${id}`], {
      cwd: root,
      env: { ...commonTestEnvironment, SENSA_PLAYWRIGHT_OUTPUT_DIR: playwrightOutputDirectory },
      stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    const status = completed.error ? 'failed' : completed.status === 0 ? 'passed' : 'failed';
    state.tests[suite] = { id, startedAt, finishedAt: new Date().toISOString(), status, exitCode: completed.status ?? null };
    writeResults(state, { tests: state.tests, status: status === 'passed' ? 'running' : 'failed' });
    if (completed.error) throw completed.error;
    if (completed.status !== 0) throw new Error(`${id} failed; inspect ${logPath}`);
    console.log(`PASS ${id}`);
  }
  writeResults(state, { status: 'passed', finishedAt: new Date().toISOString() });
  console.log(`Live ${selectedSuites.join(' and ')} acceptance completed. Logs and results: .sensa-local/language-matrix/${runId}/`);
}

try {
  await main();
} catch (error) {
  if (runState && existsSync(resultPath)) {
    try { writeResults(runState, { status: 'failed', finishedAt: new Date().toISOString() }); } catch { /* Keep the original failure. */ }
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (runState?.mode === 'live' && existsSync(resultPath)) {
    try {
      const summary = await summarizeRunDirectory(runDirectory);
      console.log(`Case summary: ${summary.passed} passed, ${summary.failed} failed; report: .sensa-local/language-matrix/${runId}/summary.json`);
    } catch (error) {
      console.error(`Could not summarize live case reports: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
  await cleanup();
}
