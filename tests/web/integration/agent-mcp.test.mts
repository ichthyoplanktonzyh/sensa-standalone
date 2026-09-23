import {test} from 'vitest';
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test("agent-mcp", async () => {

const operationId = crypto.randomUUID();
const queuedAt = '2026-09-19T08:00:00.000Z';
const token = `sensa_agent_${'a'.repeat(48)}`;
let applied = false;
let submitted: unknown;
const execute = promisify(execFile);
type ClientKind = 'codex' | 'cursor' | 'claude_desktop' | 'windsurf' | 'cli';
const setups = new Map<string, { code: string; connectionId: string; clientKind: ClientKind; label: string; token: string }>();
const setup = (clientKind: ClientKind, label: string) => {
  const setupId = crypto.randomUUID(), code = `sensa_setup_${crypto.randomUUID()}${crypto.randomUUID()}`;
  const value = { code, connectionId: crypto.randomUUID(), clientKind, label, token: `sensa_agent_${crypto.randomUUID()}${crypto.randomUUID()}` };
  setups.set(setupId, value);
  return { setupId, ...value };
};

const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (request.method === 'GET' && request.url === '/integrations/SKILL.md') {
    response.writeHead(200, { 'content-type': 'text/markdown' });
    response.end(await readFile(resolve('integrations/codex/sensa-intake/SKILL.md')));
    return;
  }
  if (request.method === 'GET' && request.url === '/integrations/request-example.json') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(await readFile(resolve('integrations/codex/sensa-intake/request-example.json')));
    return;
  }
  if (request.method === 'POST' && request.url === '/sensa/agent/connection-setups/exchange') {
    assert.equal(request.headers.authorization, undefined, 'the installer exchanges directly without a Web or Agent bearer token');
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const pending = setups.get(input.setupId);
    if (!pending || input.setupCode !== pending.code) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 'agent_setup_invalid' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      contractVersion: 'sensa-agent-connection-v1',
      connectionId: pending.connectionId,
      clientKind: pending.clientKind,
      label: pending.label,
      token: pending.token,
      createdAt: '2026-09-19T08:00:00.000Z',
      expiresAt: '2027-09-19T08:00:00.000Z',
    }));
    setups.delete(input.setupId);
    return;
  }
  assert.equal(request.headers.authorization, `Bearer ${token}`);
  assert.equal(request.headers['x-client-platform'], 'codex');

  if (request.method === 'POST' && request.url === '/sensa/agent/intakes') {
    submitted = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      contractVersion: 'sensa-intake-delivery-v1',
      deliveryId: operationId,
      operationId,
      deliveryState: 'queued',
      queuedAt,
    }));
    return;
  }
  if (request.method === 'GET' && request.url === `/sensa/agent/intakes/${operationId}`) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(applied ? {
      contractVersion: 'sensa-intake-delivery-v1',
      deliveryId: operationId,
      operationId,
      deliveryState: 'applied',
      queuedAt,
      appliedAt: '2026-09-19T08:01:00.000Z',
      result: { route: 'inbox', intakeId: crypto.randomUUID(), status: 'pending_sense' },
    } : {
      contractVersion: 'sensa-intake-delivery-v1',
      deliveryId: operationId,
      operationId,
      deliveryState: 'queued',
      queuedAt,
    }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ code: 'not_found' }));
});

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'sensa-agent-mcp-'));
try {
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  assert(address && typeof address === 'object');
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const assetUrl = `${apiUrl}/integrations/`;
  const configPath = join(temporaryDirectory, 'connection.json');
  await writeFile(configPath, JSON.stringify({
    version: 2,
    apiUrl,
    token,
    connectionId: crypto.randomUUID(),
    clientKind: 'codex',
    label: 'Codex',
    createdAt: '2026-09-19T08:00:00.000Z',
    expiresAt: '2027-09-19T08:00:00.000Z',
  }), { mode: 0o600 });
  const bundle = resolve('packages/mcp-server/dist/sensa-mcp.mjs');

  const transport = new StdioClientTransport({ command: process.execPath, args: [bundle, '--config', configPath], stderr: 'pipe' });
  const client = new Client({ name: 'sensa-agent-mcp-smoke', version: '1.0.0' });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['sensa_get_save_status', 'sensa_save_meaning']);
    const prompts = await client.listPrompts();
    assert.deepEqual(prompts.prompts.map((prompt) => prompt.name), ['sensa_intake']);
    const prompt = await client.getPrompt({ name: 'sensa_intake' });
    assert.match((prompt.messages[0]!.content as { text: string }).text, /do not add an acceptance field/u);

    const save = await client.callTool({
      name: 'sensa_save_meaning',
      arguments: {
        contractVersion: 'sensa-intake-v3', operationId, capturedAt: '2026-09-19T07:59:00.000Z',
        context: { modality: 'text', textSegment: 'I backed out.', mediaReferenceIds: [], languageTag: 'en', source: { client: 'codex', url: null, title: 'Agent conversation', sourceReferenceId: null, domSelector: null, paragraphContext: null } },
        expression: { surfaceForm: 'back out', languageTag: 'en', occurrence: { surfaceForm: 'backed out', locator: { kind: 'text_span', start: 2, end: 12 } }, expressionTypeHint: 'phrase' },
        sense: null,
      },
    });
    assert.equal(save.isError, undefined);
    assert.equal((save.structuredContent as { deliveryState: string }).deliveryState, 'queued');
    assert.match((save.content[0] as { text: string }).text, /not in the personal semantic world yet/u);
    assert.deepEqual(submitted, {
      contractVersion: 'sensa-agent-intake-v1',
      intake: {
        contractVersion: 'sensa-intake-v3', operationId, capturedAt: '2026-09-19T07:59:00.000Z',
        context: { modality: 'text', textSegment: 'I backed out.', mediaReferenceIds: [], languageTag: 'en', source: { client: 'codex', url: null, title: 'Agent conversation', sourceReferenceId: null, domSelector: null, paragraphContext: null } },
        expression: { surfaceForm: 'back out', languageTag: 'en', occurrence: { surfaceForm: 'backed out', locator: { kind: 'text_span', start: 2, end: 12 } }, expressionTypeHint: 'phrase' },
        sense: null,
      },
    });
    applied = true;
    const status = await client.callTool({ name: 'sensa_get_save_status', arguments: { operationId } });
    assert.equal((status.structuredContent as { deliveryState: string }).deliveryState, 'applied');
    assert.match((status.content[0] as { text: string }).text, /applied the intake to the Inbox/u);
  } finally { await client.close(); }

  const cliStatus = await new Promise<any>((resolveCli, rejectCli) => {
    const child = spawn(process.execPath, [bundle, '--cli', '--config', configPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', rejectCli);
    child.on('close', (code) => code === 0
      ? resolveCli(JSON.parse(Buffer.concat(stdout).toString('utf8')))
      : rejectCli(new Error(Buffer.concat(stderr).toString('utf8') || Buffer.concat(stdout).toString('utf8'))));
    child.stdin.end(JSON.stringify({ kind: 'receipt', operationId }));
  });
  assert.equal(cliStatus.value.deliveryState, 'applied');

  const fakeBin = join(temporaryDirectory, 'bin');
  const codexHome = join(temporaryDirectory, 'codex-home');
  const installed = join(temporaryDirectory, 'installed-codex');
  const codexArguments = join(temporaryDirectory, 'codex-args.json');
  await mkdir(fakeBin);
  await writeFile(join(fakeBin, 'codex'), `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[3] === 'get') process.exit(1);
fs.writeFileSync(process.env.CODEX_ARGS, JSON.stringify(process.argv.slice(2)));
`, { mode: 0o700 });
  await chmod(join(fakeBin, 'codex'), 0o700);
  const codexSetup = setup('codex', 'Codex');
  const { stdout } = await execute(process.execPath, [
    bundle, '--install', '--client', 'codex', '--api-url', apiUrl, '--assets-base-url', assetUrl,
    '--setup-id', codexSetup.setupId, '--setup-code', codexSetup.code,
    '--connection-id', codexSetup.connectionId, '--directory', installed,
  ], { env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}`, CODEX_HOME: codexHome, CODEX_ARGS: codexArguments } });
  assert.equal(JSON.parse(stdout).installed, true);
  assert.equal((await stat(join(installed, 'connection.json'))).mode & 0o077, 0);
  assert.equal(JSON.parse(await readFile(join(installed, 'connection.json'), 'utf8')).token, codexSetup.token);
  assert.match(await readFile(join(codexHome, 'skills/sensa-intake/SKILL.md'), 'utf8'), /call `sensa_save_meaning`/u);
  assert.deepEqual(JSON.parse(await readFile(codexArguments, 'utf8')).slice(0, 3), ['mcp', 'add', 'sensa']);

  for (const clientKind of ['cursor', 'claude_desktop', 'windsurf'] as const) {
    const pending = setup(clientKind, clientKind);
    const clientDirectory = join(temporaryDirectory, `installed-${clientKind}`);
    const clientConfig = join(temporaryDirectory, `${clientKind}.json`);
    const env = {
      ...process.env,
      CURSOR_MCP_CONFIG: clientConfig,
      CLAUDE_DESKTOP_CONFIG: clientConfig,
      WINDSURF_MCP_CONFIG: clientConfig,
    };
    await execute(process.execPath, [
      bundle, '--install', '--client', clientKind, '--api-url', apiUrl,
      '--setup-id', pending.setupId, '--setup-code', pending.code,
      '--connection-id', pending.connectionId, '--directory', clientDirectory,
    ], { env });
    const configured = JSON.parse(await readFile(clientConfig, 'utf8'));
    assert.equal(configured.mcpServers.sensa.command, process.execPath);
    assert.deepEqual(configured.mcpServers.sensa.args, [join(clientDirectory, 'sensa-mcp.mjs'), '--config', join(clientDirectory, 'connection.json')]);
    let installedConnectionId = pending.connectionId;
    let installedDirectory = clientDirectory;
    if (clientKind === 'cursor') {
      const replacement = setup('cursor', 'Cursor replacement');
      const replacementDirectory = join(temporaryDirectory, 'installed-cursor-replacement');
      await execute(process.execPath, [
        bundle, '--install', '--client', 'cursor', '--api-url', apiUrl,
        '--setup-id', replacement.setupId, '--setup-code', replacement.code,
        '--connection-id', replacement.connectionId,
        '--replaces-connection-id', pending.connectionId, '--replaces-directory', clientDirectory,
        '--directory', replacementDirectory,
      ], { env });
      const rotated = JSON.parse(await readFile(clientConfig, 'utf8'));
      assert.equal(rotated.mcpServers.sensa.args[0], join(replacementDirectory, 'sensa-mcp.mjs'));
      await assert.rejects(readFile(join(clientDirectory, 'connection.json')));
      installedConnectionId = replacement.connectionId;
      installedDirectory = replacementDirectory;
    }
    await execute(process.execPath, [bundle, '--uninstall', '--client', clientKind, '--connection-id', installedConnectionId, '--directory', installedDirectory], { env });
    assert.equal(JSON.parse(await readFile(clientConfig, 'utf8')).mcpServers.sensa, undefined);
  }

  if (spawnSync('codex', ['--version'], { stdio: 'ignore' }).status === 0) {
    const realHome = join(temporaryDirectory, 'real-codex-home');
    const realInstalled = join(temporaryDirectory, 'real-codex-install');
    const pending = setup('codex', 'Codex real CLI');
    await mkdir(realHome);
    const installArgs = [
      bundle, '--install', '--client', 'codex', '--api-url', apiUrl, '--assets-base-url', assetUrl,
      '--setup-id', pending.setupId, '--setup-code', pending.code,
      '--connection-id', pending.connectionId, '--directory', realInstalled,
    ];
    await execute(process.execPath, installArgs, { env: { ...process.env, CODEX_HOME: realHome } });
    await execute(process.execPath, installArgs, { env: { ...process.env, CODEX_HOME: realHome } });
    const registered = await execute('codex', ['mcp', 'get', 'sensa', '--json'], { env: { ...process.env, CODEX_HOME: realHome } });
    const value = JSON.parse(registered.stdout);
    assert.equal(value.name, 'sensa');
    assert.equal(value.transport.command, process.execPath);
  }

  console.log('PASS: one-time setup keeps the Agent token out of command arguments; real MCP tools/prompt and CLI work; Codex Skill/registration, Cursor, Claude Desktop, Windsurf, retry-safe config and uninstall are exercised.');
} finally {
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  await rm(temporaryDirectory, { recursive: true, force: true });
}

});
