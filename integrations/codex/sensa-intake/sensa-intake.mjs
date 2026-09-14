#!/usr/bin/env node
/** Local Agent intake transport: durable queue only, never direct library SQL. */
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const INTAKE_VERSION = 'sensa-intake-v3';
const DELIVERY_VERSION = 'sensa-local-agent-intake-v1';
const LIMIT = 96 * 1024;
const HOST = 'app.sensa.intake';
const args = process.argv.slice(2);

const option = (name) => {
  const at = args.indexOf(name);
  if (at < 0 || !args[at + 1]) throw new Error(`missing_${name.slice(2).replaceAll('-', '_')}`);
  return args[at + 1];
};
const isUuid = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error('invalid_request');
}

const digest = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');

function privateWrite(path, bytes, replace = false) {
  const descriptor = openSync(path, replace ? 'w' : 'wx', 0o600);
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(path, 0o600);
}

function database(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS deliveries(
      operation_id TEXT PRIMARY KEY,
      request_digest TEXT NOT NULL,
      delivery_json TEXT NOT NULL CHECK(json_valid(delivery_json)),
      receipt_json TEXT CHECK(receipt_json IS NULL OR json_valid(receipt_json)),
      queued_at TEXT NOT NULL
    ) STRICT;
  `);
  return db;
}

function defaultConnectionDirectory(libraryId) {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Sensa', 'Agent Intake', libraryId);
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'sensa', 'agent-intake', libraryId);
}

function defaultManifestDirectory(browser) {
  if (!['chrome', 'edge'].includes(browser)) throw new Error('unsupported_browser');
  if (process.platform === 'darwin') {
    return browser === 'edge'
      ? join(homedir(), 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts')
      : join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
  }
  if (process.platform === 'linux') {
    const config = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    return join(config, browser === 'edge' ? 'microsoft-edge' : 'google-chrome', 'NativeMessagingHosts');
  }
  throw new Error('unsupported_platform');
}

function parseConfig(bytes) {
  if (bytes.length > 8192) throw new Error('invalid_configuration');
  const config = JSON.parse(bytes.toString('utf8'));
  if (!exactKeys(config, ['version', 'libraryId', 'clientId', 'label', 'extensionId', 'queuePath'])
    || config.version !== 1
    || !isUuid(config.libraryId)
    || !isUuid(config.clientId)
    || typeof config.label !== 'string'
    || !/^[a-p]{32}$/u.test(config.extensionId)
    || typeof config.queuePath !== 'string') throw new Error('invalid_configuration');
  return config;
}

function registerManifest(browser, manifest, overrideDirectory) {
  if (overrideDirectory) {
    const directory = resolve(overrideDirectory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const installed = resolve(directory, `${HOST}.json`);
    privateWrite(installed, `${JSON.stringify(manifest, null, 2)}\n`, existsSync(installed));
    return installed;
  }
  if (!browser) throw new Error('missing_browser');
  const directory = defaultManifestDirectory(browser);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const installed = resolve(directory, `${HOST}.json`);
  privateWrite(installed, `${JSON.stringify(manifest, null, 2)}\n`, existsSync(installed));
  return installed;
}

const safeAssetBase = (value) => {
  const url = new URL(value);
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) throw new Error('invalid_asset_origin');
  url.pathname = url.pathname.replace(/\/+$/u, '') + '/';
  url.search = '';
  url.hash = '';
  return url;
};

async function fetchAsset(base, name, limit) {
  const response = await fetch(new URL(name, base), { redirect: 'error' });
  if (!response.ok) throw new Error('integration_asset_unavailable');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > limit) throw new Error('invalid_integration_asset');
  return bytes.toString('utf8');
}

function installCodexSkill(config, skillSource, exampleSource, requestedDirectory) {
  if (!skillSource.startsWith('---\n') || !skillSource.includes('\nname: sensa-intake\n')
    || !skillSource.includes('sensa-managed: "true"')) throw new Error('invalid_codex_skill');
  JSON.parse(exampleSource);
  const skillDirectory = requestedDirectory
    ? resolve(requestedDirectory)
    : join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills', 'sensa-intake');
  mkdirSync(skillDirectory, { recursive: true, mode: 0o700 });
  const skillPath = join(skillDirectory, 'SKILL.md');
  if (existsSync(skillPath)) {
    const existing = readFileSync(skillPath, 'utf8');
    const knownOlderSensaSkill = existing.includes('name: sensa-intake')
      && existing.includes('Sensa intake CLI')
      && existing.includes('Never write');
    if (!existing.includes('sensa-managed: "true"') && !knownOlderSensaSkill) {
      throw new Error('codex_skill_conflict');
    }
  }
  const frontmatterEnd = skillSource.indexOf('\n---\n', 4);
  if (frontmatterEnd < 0) throw new Error('invalid_codex_skill');
  const connection = {
    executable: resolve(dirname(config.queuePath), 'sensa-intake.mjs'),
    config: resolve(dirname(config.queuePath), 'connection.json'),
    libraryId: config.libraryId,
  };
  const installed = `${skillSource.slice(0, frontmatterEnd + 5)}\n## Installed connection\n\nUse this connection unless the user supplies another:\n\n\`\`\`json\n${JSON.stringify(connection, null, 2)}\n\`\`\`\n${skillSource.slice(frontmatterEnd + 5)}`;
  privateWrite(skillPath, installed, existsSync(skillPath));
  const examplePath = join(skillDirectory, 'request-example.json');
  privateWrite(examplePath, exampleSource.endsWith('\n') ? exampleSource : `${exampleSource}\n`, existsSync(examplePath));
  return skillPath;
}

async function setup() {
  const libraryId = option('--library-id');
  const label = args.includes('--label') ? option('--label').trim() : 'Codex';
  const extensionId = option('--extension');
  const browser = args.includes('--browser') ? option('--browser') : null;
  if (!isUuid(libraryId)) throw new Error('invalid_library_id');
  if (!label || [...label].length > 100) throw new Error('invalid_label');
  if (!/^[a-p]{32}$/u.test(extensionId)) throw new Error('invalid_extension_id');
  if (browser && !['chrome', 'edge'].includes(browser)) throw new Error('unsupported_browser');
  if (!['darwin', 'linux'].includes(process.platform)) {
    throw new Error('unsupported_platform');
  }
  const directory = args.includes('--directory')
    ? resolve(option('--directory'))
    : defaultConnectionDirectory(libraryId);
  const existed = existsSync(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const configPath = resolve(directory, 'connection.json');
  if (existed && !existsSync(configPath) && readdirSync(directory).length > 0) {
    throw new Error('connection_directory_not_empty');
  }
  const prior = existsSync(configPath) ? parseConfig(readFileSync(configPath)) : null;
  if (prior && prior.libraryId !== libraryId) throw new Error('library_mismatch');
  const executable = resolve(directory, 'sensa-intake.mjs');
  const sourceExecutable = fileURLToPath(import.meta.url);
  if (sourceExecutable !== executable) copyFileSync(sourceExecutable, executable);
  chmodSync(executable, 0o700);
  const queuePath = prior?.queuePath ?? resolve(directory, 'intake-queue.sqlite3');
  database(queuePath).close();
  chmodSync(queuePath, 0o600);
  const config = {
    version: 1,
    libraryId,
    clientId: prior?.clientId ?? randomUUID(),
    label,
    extensionId,
    queuePath,
  };
  privateWrite(configPath, JSON.stringify(config), existsSync(configPath));
  const manifest = {
    name: HOST,
    description: 'Sensa local Agent intake',
    path: executable,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  const manifestPath = resolve(directory, `${HOST}.json`);
  privateWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, existsSync(manifestPath));
  const registeredManifest = registerManifest(
    browser,
    manifest,
    args.includes('--manifest-dir') ? option('--manifest-dir') : null,
  );
  let codexSkill = null;
  if (args.includes('--assets-base-url')) {
    const base = safeAssetBase(option('--assets-base-url'));
    codexSkill = installCodexSkill(
      config,
      await fetchAsset(base, 'SKILL.md', 32 * 1024),
      await fetchAsset(base, 'request-example.json', 64 * 1024),
      args.includes('--codex-skill-dir') ? option('--codex-skill-dir') : null,
    );
  } else if (args.includes('--codex-skill-source') || args.includes('--codex-example-source')) {
    if (!args.includes('--codex-skill-source') || !args.includes('--codex-example-source')) {
      throw new Error('missing_codex_skill_asset');
    }
    codexSkill = installCodexSkill(
      config,
      readFileSync(resolve(option('--codex-skill-source')), 'utf8'),
      readFileSync(resolve(option('--codex-example-source')), 'utf8'),
      args.includes('--codex-skill-dir') ? option('--codex-skill-dir') : null,
    );
  }
  return { libraryId, clientId: config.clientId, label, connection: configPath, manifest: registeredManifest, codexSkill };
}

function loadConfig(native) {
  const configPath = args.includes('--config')
    ? resolve(option('--config'))
    : resolve(fileURLToPath(new URL('./connection.json', import.meta.url)));
  const config = parseConfig(readFileSync(configPath));
  if (native && !args.includes(`chrome-extension://${config.extensionId}/`)) {
    throw new Error('extension_not_authorized');
  }
  return config;
}

function validateIntake(value) {
  if (!exactKeys(value, [
    'contractVersion', 'operationId', 'capturedAt', 'context', 'expression', 'sense', 'acceptance',
  ]) || value.contractVersion !== INTAKE_VERSION || !isUuid(value.operationId)
    || typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt))) {
    throw new Error('invalid_request');
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 64 * 1024) throw new Error('invalid_request');
  return value;
}

function deliveryFor(config, intake) {
  const base = {
    contractVersion: DELIVERY_VERSION,
    libraryId: config.libraryId,
    client: { clientId: config.clientId, kind: 'agent', label: config.label },
    intake,
  };
  return { ...base, requestDigest: digest(base) };
}

function submit(db, config, input, native) {
  if (!exactKeys(input, ['kind', 'intake'])) throw new Error('invalid_request');
  const intake = validateIntake(input.intake);
  if (intake.acceptance !== null && (native || !args.includes('--allow-accept'))) {
    throw new Error('explicit_acceptance_required');
  }
  const delivery = deliveryFor(config, intake);
  const prior = db.prepare('SELECT request_digest FROM deliveries WHERE operation_id=?').get(intake.operationId);
  if (prior && prior.request_digest !== delivery.requestDigest) throw new Error('operation_conflict');
  if (!prior) {
    db.prepare('INSERT INTO deliveries VALUES(?,?,?,?,?)').run(
      intake.operationId,
      delivery.requestDigest,
      JSON.stringify(delivery),
      null,
      new Date().toISOString(),
    );
  }
  return {
    deliveryState: 'queued',
    libraryId: config.libraryId,
    clientId: config.clientId,
    operationId: intake.operationId,
    requestDigest: delivery.requestDigest,
  };
}

function pull(db, config, input) {
  if (!exactKeys(input, ['kind', 'libraryId', 'limit']) || input.libraryId !== config.libraryId
    || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10) {
    throw new Error(input.libraryId !== config.libraryId ? 'library_mismatch' : 'invalid_request');
  }
  return db.prepare(`SELECT delivery_json FROM deliveries
    WHERE receipt_json IS NULL ORDER BY queued_at,operation_id LIMIT ?`).all(input.limit)
    .map((row) => JSON.parse(row.delivery_json));
}

function acknowledge(db, config, input) {
  if (!exactKeys(input, ['kind', 'receipt']) || !input.receipt || typeof input.receipt !== 'object') {
    throw new Error('invalid_request');
  }
  const receipt = input.receipt;
  if (receipt.contractVersion !== DELIVERY_VERSION || receipt.libraryId !== config.libraryId
    || receipt.clientId !== config.clientId || !isUuid(receipt.operationId)
    || !/^[0-9a-f]{64}$/u.test(receipt.requestDigest ?? '')) throw new Error('receipt_mismatch');
  const row = db.prepare('SELECT request_digest,receipt_json FROM deliveries WHERE operation_id=?')
    .get(receipt.operationId);
  if (!row || row.request_digest !== receipt.requestDigest) throw new Error('receipt_mismatch');
  const encoded = canonicalJson(receipt);
  if (row.receipt_json && canonicalJson(JSON.parse(row.receipt_json)) !== encoded) {
    throw new Error('receipt_conflict');
  }
  if (!row.receipt_json) db.prepare('UPDATE deliveries SET receipt_json=? WHERE operation_id=?')
    .run(JSON.stringify(receipt), receipt.operationId);
  return { acknowledged: true };
}

function receipt(db, config, input) {
  if (!exactKeys(input, ['kind', 'operationId']) || !isUuid(input.operationId)) {
    throw new Error('invalid_request');
  }
  const row = db.prepare('SELECT request_digest,receipt_json,queued_at FROM deliveries WHERE operation_id=?')
    .get(input.operationId);
  if (!row) return null;
  if (row.receipt_json) return { deliveryState: 'applied', receipt: JSON.parse(row.receipt_json) };
  return {
    deliveryState: 'queued',
    libraryId: config.libraryId,
    clientId: config.clientId,
    operationId: input.operationId,
    requestDigest: row.request_digest,
    queuedAt: row.queued_at,
  };
}

function handle(db, config, input, native) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.kind !== 'string') {
    throw new Error('invalid_request');
  }
  if (input.kind === 'hello' && exactKeys(input, ['kind'])) {
    return {
      intakeContractVersion: INTAKE_VERSION,
      deliveryContractVersion: DELIVERY_VERSION,
      libraryId: config.libraryId,
      clientId: config.clientId,
      label: config.label,
    };
  }
  if (input.kind === 'submit') return submit(db, config, input, native);
  if (input.kind === 'receipt') return receipt(db, config, input);
  if (native && input.kind === 'pull') return pull(db, config, input);
  if (native && input.kind === 'ack') return acknowledge(db, config, input);
  throw new Error('unsupported_request');
}

function frameRead() {
  const size = Buffer.alloc(4);
  const first = readSync(0, size, 0, 1, null);
  if (first === 0) return null;
  let offset = 1;
  while (offset < 4) {
    const read = readSync(0, size, offset, 4 - offset, null);
    if (read === 0) throw new Error('truncated_frame');
    offset += read;
  }
  const length = size.readUInt32LE();
  if (length < 1 || length > LIMIT) throw new Error('frame_too_large');
  const body = Buffer.alloc(length);
  offset = 0;
  while (offset < length) {
    const read = readSync(0, body, offset, length - offset, null);
    if (read === 0) throw new Error('truncated_frame');
    offset += read;
  }
  return body;
}

function frameWrite(value) {
  const body = Buffer.from(JSON.stringify(value));
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  writeSync(1, size);
  writeSync(1, body);
}

async function run() {
  if (args.includes('--setup')) return console.log(JSON.stringify({ value: await setup() }));
  if (args.includes('--help')) {
    console.log('Sensa local Agent intake\nSetup: node sensa-intake.mjs --setup --library-id UUID --extension CHROME_ID (--browser chrome|edge | --manifest-dir PATH) [--assets-base-url URL]\nCall: sensa-intake.mjs --config connection.json [--allow-accept] < request.json\nJSON actions: hello, submit, receipt. Native host actions: pull, ack.');
    return;
  }
  const native = args.some((value) => value.startsWith('chrome-extension://'));
  const config = loadConfig(native);
  const db = database(config.queuePath);
  try {
    if (native) {
      for (;;) {
        const bytes = frameRead();
        if (bytes === null) break;
        try { frameWrite({ value: handle(db, config, JSON.parse(bytes.toString('utf8')), true) }); }
        catch (error) { frameWrite({ error: error instanceof Error ? error.message : 'invalid_request' }); }
      }
      return;
    }
    const bytes = readFileSync(0);
    if (bytes.length < 1 || bytes.length > LIMIT) throw new Error('frame_too_large');
    console.log(JSON.stringify({ value: handle(db, config, JSON.parse(bytes.toString('utf8')), false) }));
  } finally {
    db.close();
  }
}

try { await run(); }
catch (error) {
  console.log(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid_request' }));
  process.exitCode = 1;
}
