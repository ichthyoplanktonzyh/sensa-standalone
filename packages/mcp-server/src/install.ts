import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sensaAgentClientKindSchema,
  sensaAgentConnectionContractVersion,
  sensaAgentConnectionCredentialSchema,
  type SensaAgentClientKind,
  type SensaAgentConnectionCredential,
} from '@sensa/contracts/sensa';

import { agentConnectionConfigSchema, type AgentConnectionConfig } from './config.js';

const option = (args: string[], name: string): string => {
  const at = args.indexOf(name);
  if (at < 0 || !args[at + 1]) throw new Error(`missing_${name.slice(2).replaceAll('-', '_')}`);
  return args[at + 1];
};

function privateWrite(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const descriptor = openSync(path, existsSync(path) ? 'w' : 'wx', 0o600);
  try { writeFileSync(descriptor, value); }
  finally { closeSync(descriptor); }
  chmodSync(path, 0o600);
}

function installDirectory(connectionId: string): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Sensa', 'Agent Connections', connectionId);
  }
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Sensa', 'Agent Connections', connectionId);
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'sensa', 'agent-connections', connectionId);
}

function safeUrl(value: string, kind: 'api' | 'asset'): URL {
  const url = new URL(value);
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error(kind === 'api' ? 'agent_api_url_must_be_https_or_loopback' : 'invalid_asset_origin');
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  if (kind === 'asset') url.pathname = url.pathname.replace(/\/+$/u, '') + '/';
  return url;
}

async function fetchAsset(base: URL, name: string, limit: number): Promise<string> {
  const response = await fetch(new URL(name, base), { redirect: 'error' });
  if (!response.ok) throw new Error('integration_asset_unavailable');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > limit) throw new Error('invalid_integration_asset');
  return bytes.toString('utf8');
}

function verifySkill(skill: string, example: string): void {
  if (!skill.startsWith('---\n') || !skill.includes('\nname: sensa-intake\n')
    || !skill.includes('sensa-managed: "true"')) throw new Error('invalid_codex_skill');
  JSON.parse(example);
  const path = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills', 'sensa-intake', 'SKILL.md');
  if (existsSync(path) && !readFileSync(path, 'utf8').includes('sensa-managed: "true"')) {
    throw new Error('codex_skill_conflict');
  }
}

function installCodexSkill(skill: string, example: string): string {
  verifySkill(skill, example);
  const directory = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills', 'sensa-intake');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privateWrite(join(directory, 'SKILL.md'), skill.endsWith('\n') ? skill : `${skill}\n`);
  privateWrite(join(directory, 'request-example.json'), example.endsWith('\n') ? example : `${example}\n`);
  return directory;
}

function jsonClientPath(client: Exclude<SensaAgentClientKind, 'codex' | 'cli'>): string {
  if (client === 'cursor') return process.env.CURSOR_MCP_CONFIG ?? join(homedir(), '.cursor', 'mcp.json');
  if (client === 'windsurf') {
    return process.env.WINDSURF_MCP_CONFIG ?? join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
  }
  if (process.env.CLAUDE_DESKTOP_CONFIG) return process.env.CLAUDE_DESKTOP_CONFIG;
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Claude', 'claude_desktop_config.json');
}

type McpEntry = { command: string; args: string[] };
type McpJson = { mcpServers?: Record<string, unknown>; [key: string]: unknown };

function readMcpJson(path: string): McpJson {
  if (!existsSync(path)) return {};
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_client_mcp_config');
  const result = value as McpJson;
  if (result.mcpServers !== undefined && (
    !result.mcpServers || typeof result.mcpServers !== 'object' || Array.isArray(result.mcpServers)
  )) throw new Error('invalid_client_mcp_config');
  return result;
}

const sameEntry = (value: unknown, expected: McpEntry): boolean => {
  if (!value || typeof value !== 'object') return false;
  const outer = value as { command?: unknown; args?: unknown; transport?: unknown };
  const entry = outer.transport && typeof outer.transport === 'object'
    ? outer.transport as { command?: unknown; args?: unknown }
    : outer;
  return entry.command === expected.command
    && Array.isArray(entry.args)
    && entry.args.length === expected.args.length
    && entry.args.every((item, index) => item === expected.args[index]);
};

function preflightClient(client: SensaAgentClientKind, expected: McpEntry, previous: McpEntry | null): void {
  if (client === 'cli') return;
  if (client === 'codex') {
    const found = spawnSync('codex', ['mcp', 'get', 'sensa', '--json'], { encoding: 'utf8' });
    if (found.error) throw new Error('codex_cli_unavailable');
    if (found.status === 0) {
      let value: unknown;
      try { value = JSON.parse(found.stdout); }
      catch { throw new Error('codex_mcp_name_already_exists'); }
      if (!sameEntry(value, expected) && (!previous || !sameEntry(value, previous))) {
        throw new Error('codex_mcp_name_already_exists');
      }
    }
    return;
  }
  const path = jsonClientPath(client);
  const configured = readMcpJson(path).mcpServers?.sensa;
  if (configured !== undefined && !sameEntry(configured, expected)
    && (!previous || !sameEntry(configured, previous))) throw new Error('client_mcp_name_already_exists');
}

function registerClient(client: SensaAgentClientKind, entry: McpEntry, previous: McpEntry | null): string | null {
  if (client === 'cli') return null;
  if (client === 'codex') {
    const existing = spawnSync('codex', ['mcp', 'get', 'sensa', '--json'], { encoding: 'utf8' });
    if (existing.error) throw new Error('codex_cli_unavailable');
    if (existing.status === 0) {
      const configured: unknown = JSON.parse(existing.stdout);
      if (sameEntry(configured, entry)) return 'codex:sensa';
      if (!previous || !sameEntry(configured, previous)) throw new Error('codex_mcp_name_already_exists');
      const removed = spawnSync('codex', ['mcp', 'remove', 'sensa'], { encoding: 'utf8' });
      if (removed.error || removed.status !== 0) throw new Error('codex_mcp_removal_failed');
    }
    const registered = spawnSync('codex', ['mcp', 'add', 'sensa', '--', entry.command, ...entry.args], { encoding: 'utf8' });
    if (registered.error || registered.status !== 0) {
      throw new Error(registered.error ? 'codex_cli_unavailable' : 'codex_mcp_registration_failed');
    }
    return 'codex:sensa';
  }
  const path = jsonClientPath(client);
  const value = readMcpJson(path);
  const configured = value.mcpServers?.sensa;
  if (configured !== undefined && !sameEntry(configured, entry)
    && (!previous || !sameEntry(configured, previous))) throw new Error('client_mcp_name_already_exists');
  value.mcpServers = { ...(value.mcpServers ?? {}), sensa: entry };
  privateWrite(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function unregisterClient(client: SensaAgentClientKind, entry: McpEntry): string | null {
  if (client === 'cli') return null;
  if (client === 'codex') {
    const found = spawnSync('codex', ['mcp', 'get', 'sensa', '--json'], { encoding: 'utf8' });
    if (found.error) throw new Error('codex_cli_unavailable');
    if (found.status !== 0) return 'codex:sensa';
    let value: unknown;
    try { value = JSON.parse(found.stdout); }
    catch { throw new Error('codex_mcp_config_conflict'); }
    if (!sameEntry(value, entry)) throw new Error('codex_mcp_config_conflict');
    const removed = spawnSync('codex', ['mcp', 'remove', 'sensa'], { encoding: 'utf8' });
    if (removed.error || removed.status !== 0) throw new Error('codex_mcp_removal_failed');
    return 'codex:sensa';
  }
  const path = jsonClientPath(client);
  if (!existsSync(path)) return path;
  const value = readMcpJson(path);
  const configured = value.mcpServers?.sensa;
  if (configured === undefined) return path;
  if (!sameEntry(configured, entry)) throw new Error('client_mcp_config_conflict');
  delete value.mcpServers!.sensa;
  privateWrite(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

async function exchangeSetup(input: {
  apiUrl: string;
  setupId: string;
  setupCode: string;
}): Promise<SensaAgentConnectionCredential> {
  const response = await fetch(`${input.apiUrl}/sensa/agent/connection-setups/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-platform': 'sensa-installer' },
    body: JSON.stringify({
      contractVersion: sensaAgentConnectionContractVersion,
      setupId: input.setupId,
      setupCode: input.setupCode,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = value && typeof value === 'object' && 'code' in value
      ? String(value.code)
      : 'agent_setup_exchange_failed';
    throw new Error(code);
  }
  return sensaAgentConnectionCredentialSchema.parse(value);
}

function installedConfig(path: string, input: {
  apiUrl: string;
  connectionId: string;
  client: SensaAgentClientKind;
}): AgentConnectionConfig | null {
  if (!existsSync(path)) return null;
  const value = agentConnectionConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (value.apiUrl !== input.apiUrl || value.connectionId !== input.connectionId || value.clientKind !== input.client) {
    throw new Error('agent_connection_config_conflict');
  }
  return value;
}

/** Installs this reviewed bundle and its guidance; it never receives library authority. */
export async function installSensaAgent(args: string[]): Promise<unknown> {
  const client = sensaAgentClientKindSchema.parse(option(args, '--client'));
  const connectionId = option(args, '--connection-id');
  const apiUrl = safeUrl(option(args, '--api-url'), 'api').href.replace(/\/+$/u, '');
  const directory = args.includes('--directory')
    ? resolve(option(args, '--directory'))
    : installDirectory(connectionId);
  const executable = join(directory, 'sensa-mcp.mjs');
  const config = join(directory, 'connection.json');
  const entry = { command: process.execPath, args: [executable, '--config', config] };
  const replacesConnectionId = args.includes('--replaces-connection-id')
    ? option(args, '--replaces-connection-id')
    : null;
  const previousDirectory = replacesConnectionId
    ? args.includes('--replaces-directory')
      ? resolve(option(args, '--replaces-directory'))
      : installDirectory(replacesConnectionId)
    : null;
  const previous = previousDirectory ? {
    command: process.execPath,
    args: [join(previousDirectory, 'sensa-mcp.mjs'), '--config', join(previousDirectory, 'connection.json')],
  } : null;

  let skill: string | null = null;
  let example: string | null = null;
  if (args.includes('--assets-base-url')) {
    const base = safeUrl(option(args, '--assets-base-url'), 'asset');
    [skill, example] = await Promise.all([
      fetchAsset(base, 'SKILL.md', 64 * 1024),
      fetchAsset(base, 'request-example.json', 96 * 1024),
    ]);
    if (client === 'codex') verifySkill(skill, example);
  }
  preflightClient(client, entry, previous);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  const existing = installedConfig(config, { apiUrl, connectionId, client });
  const credential = existing ?? await exchangeSetup({
    apiUrl,
    setupId: option(args, '--setup-id'),
    setupCode: option(args, '--setup-code'),
  });
  if (credential.connectionId !== connectionId || credential.clientKind !== client) {
    throw new Error('agent_setup_identity_mismatch');
  }
  const source = fileURLToPath(import.meta.url);
  if (resolve(source) !== resolve(executable)) copyFileSync(source, executable);
  chmodSync(executable, 0o700);
  if (!existing) {
    privateWrite(config, `${JSON.stringify({
      version: 2,
      apiUrl,
      token: credential.token,
      connectionId: credential.connectionId,
      clientKind: credential.clientKind,
      label: credential.label,
      createdAt: credential.createdAt,
      expiresAt: credential.expiresAt,
    })}\n`);
  }
  const skillDirectory = client === 'codex' && skill && example
    ? installCodexSkill(skill, example)
    : null;
  const clientConfiguration = registerClient(client, entry, previous);
  if (previousDirectory && resolve(previousDirectory) !== resolve(directory)) {
    for (const path of [join(previousDirectory, 'connection.json'), join(previousDirectory, 'sensa-mcp.mjs')]) {
      if (existsSync(path)) unlinkSync(path);
    }
    if (existsSync(previousDirectory)) {
      try { rmdirSync(previousDirectory); } catch { /* Preserve unexpected user files. */ }
    }
  }
  return {
    installed: true,
    connectionId: credential.connectionId,
    clientKind: credential.clientKind,
    label: credential.label,
    expiresAt: credential.expiresAt,
    executable,
    config,
    skillDirectory,
    clientConfiguration,
  };
}

export function uninstallSensaAgent(args: string[]): unknown {
  const client = sensaAgentClientKindSchema.parse(option(args, '--client'));
  const connectionId = option(args, '--connection-id');
  const directory = args.includes('--directory')
    ? resolve(option(args, '--directory'))
    : installDirectory(connectionId);
  const executable = join(directory, 'sensa-mcp.mjs');
  const config = join(directory, 'connection.json');
  const entry = { command: process.execPath, args: [executable, '--config', config] };
  const clientConfiguration = unregisterClient(client, entry);
  for (const path of [config, executable]) if (existsSync(path)) unlinkSync(path);
  if (existsSync(directory)) {
    try { rmdirSync(directory); } catch { /* Preserve unexpected user files. */ }
  }
  let skillRemoved = false;
  if (client === 'codex') {
    const skillDirectory = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills', 'sensa-intake');
    const skillPath = join(skillDirectory, 'SKILL.md');
    if (existsSync(skillPath) && readFileSync(skillPath, 'utf8').includes('sensa-managed: "true"')) {
      for (const path of [skillPath, join(skillDirectory, 'request-example.json')]) {
        if (existsSync(path)) unlinkSync(path);
      }
      try { rmdirSync(skillDirectory); } catch { /* Preserve unexpected user files. */ }
      skillRemoved = true;
    }
  }
  return { uninstalled: true, connectionId, clientKind: client, clientConfiguration, skillRemoved };
}
