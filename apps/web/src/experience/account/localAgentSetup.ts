import type { SensaAgentClientKind, SensaAgentConnectionSetup } from '@sensa/contracts/sensa';

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

const executable = (origin: string): { base: string; url: string } => {
  const base = new URL('/integrations/', origin).href;
  return { base, url: new URL('sensa-mcp.mjs', base).href };
};

/** One paste exchanges a short-lived code locally; it never exposes the long-lived credential. */
export function agentSetupCommand(input: {
  origin: string;
  apiUrl: string;
  setup: SensaAgentConnectionSetup;
}): string {
  const asset = executable(input.origin);
  const fileName = `sensa-mcp-setup-${input.setup.connectionId}.mjs`;
  const flags = [
    '--install',
    '--client', input.setup.clientKind,
    '--api-url', input.apiUrl.replace(/\/+$/u, ''),
    '--assets-base-url', asset.base,
    '--setup-id', input.setup.setupId,
    '--setup-code', input.setup.setupCode,
    '--connection-id', input.setup.connectionId,
  ];
  if (input.setup.replacesConnectionId) {
    flags.push('--replaces-connection-id', input.setup.replacesConnectionId);
  }
  return `sensa_setup="\${TMPDIR:-/tmp}/${fileName}"; curl -fsSL ${shellQuote(asset.url)} -o "$sensa_setup" && node "$sensa_setup" ${flags.map(shellQuote).join(' ')}`;
}

export function agentUninstallCommand(input: {
  origin: string;
  clientKind: SensaAgentClientKind;
  connectionId: string;
}): string {
  const asset = executable(input.origin);
  const fileName = `sensa-mcp-remove-${input.connectionId}.mjs`;
  const flags = [
    '--uninstall',
    '--client', input.clientKind,
    '--connection-id', input.connectionId,
  ];
  return `sensa_remove="\${TMPDIR:-/tmp}/${fileName}"; curl -fsSL ${shellQuote(asset.url)} -o "$sensa_remove" && node "$sensa_remove" ${flags.map(shellQuote).join(' ')}`;
}
