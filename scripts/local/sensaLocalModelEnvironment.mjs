import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/** Server-only variables the explicit local-model preview may inherit. */
export const LOCAL_MODEL_ENV_KEYS = [
  'DEEPSEEK_API_KEY',
  'SENSA_SEMANTIC_PROVIDER',
  'SENSA_SEMANTIC_MODEL',
  'SENSA_CONTENT_PROVIDER',
  'SENSA_CONTENT_MODEL',
  'SENSA_REVIEW_MODEL',
  'SENSA_REFERENCE_MODEL',
  'SENSA_MODEL_CONCURRENCY',
  'SENSA_MODEL_PROVIDER_CONCURRENCY',
];

const valueFrom = (sources, key) => {
  for (const source of sources) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

/** Pure resolver kept separate so the safety boundary can be tested without starting services. */
export function resolveLocalModelEnvironment({ enabled, sources = [] }) {
  if (!enabled) return { SENSA_MANAGED_MODELS_PAUSED: '1' };

  const apiKey = valueFrom(sources, 'DEEPSEEK_API_KEY');
  if (!apiKey) {
    throw new Error('Local models were explicitly enabled, but DEEPSEEK_API_KEY is not configured in the shell, apps/api/.env, or .env');
  }
  const provider = valueFrom(sources, 'SENSA_SEMANTIC_PROVIDER') ?? 'deepseek';
  if (provider !== 'deepseek') {
    throw new Error(`Local managed-model preview only supports SENSA_SEMANTIC_PROVIDER=deepseek (received ${provider})`);
  }

  const resolved = {
    SENSA_MANAGED_MODELS_PAUSED: '0',
    SENSA_SEMANTIC_PROVIDER: provider,
    DEEPSEEK_API_KEY: apiKey,
  };
  for (const key of LOCAL_MODEL_ENV_KEYS) {
    if (key === 'DEEPSEEK_API_KEY' || key === 'SENSA_SEMANTIC_PROVIDER') continue;
    const value = valueFrom(sources, key);
    if (value !== undefined) resolved[key] = value;
  }
  return resolved;
}

const readEnvironmentFile = (path) => {
  if (!existsSync(path)) return {};
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`Could not parse local model environment file: ${path}`);
  }
};

/**
 * Disabled mode reads no files. Enabled mode applies the ordinary precedence:
 * shell, apps/api/.env, then repository .env. Only LOCAL_MODEL_ENV_KEYS leave
 * this function, so unrelated production credentials never reach the preview.
 */
export function loadLocalModelEnvironment({ root, enabled, environment }) {
  if (!enabled) return resolveLocalModelEnvironment({ enabled: false });
  return resolveLocalModelEnvironment({
    enabled: true,
    sources: [
      environment,
      readEnvironmentFile(join(root, 'apps/api/.env')),
      readEnvironmentFile(join(root, '.env')),
    ],
  });
}
