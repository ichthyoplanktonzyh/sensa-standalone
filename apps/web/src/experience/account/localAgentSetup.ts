export type LocalAgentPlatform = 'macos' | 'linux';
export type LocalAgentBrowser = 'chrome' | 'edge' | 'chromium';

export type LocalAgentEnvironment = {
  platform: LocalAgentPlatform;
  browser: LocalAgentBrowser;
};

export function detectLocalAgentEnvironment(userAgent: string): LocalAgentEnvironment | null {
  const platform: LocalAgentPlatform | null = /Macintosh|Mac OS X/u.test(userAgent)
      ? 'macos'
      : /Linux/u.test(userAgent)
        ? 'linux'
        : null;
  const browser: LocalAgentBrowser | null = /Edg\//u.test(userAgent)
    ? 'edge'
    : /Chromium\//u.test(userAgent)
      ? 'chromium'
      : /Chrome\//u.test(userAgent)
        ? 'chrome'
        : null;
  return platform && browser ? { platform, browser } : null;
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

/** One paste installs the host, binds this library, and installs the Codex skill. */
export function localAgentSetupCommand(input: {
  origin: string;
  libraryId: string;
  extensionId: string;
  environment: LocalAgentEnvironment;
  label?: string;
}): string {
  const base = new URL('/integrations/', input.origin).href;
  const executableUrl = new URL('sensa-intake.mjs', base).href;
  const fileName = `sensa-intake-setup-${input.libraryId}.mjs`;
  const flags = [
    '--setup',
    '--library-id', input.libraryId,
    '--extension', input.extensionId,
    '--browser', input.environment.browser,
    '--assets-base-url', base,
    ...(input.label ? ['--label', input.label] : []),
  ];
  const quotedFlags = flags.map(shellQuote).join(' ');
  return `sensa_setup="\${TMPDIR:-/tmp}/${fileName}"; curl -fsSL ${shellQuote(executableUrl)} -o "$sensa_setup" && node "$sensa_setup" ${quotedFlags}`;
}
