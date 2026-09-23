import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  defaultWebTestEnvironments,
  webTestCatalog,
  webTestEnvironments,
  webTestKinds,
  webTestRisks,
  type WebTestCatalogEntry,
  type WebTestEnvironment,
  type WebTestKind,
  type WebTestRisk,
} from './catalog.mts';

type Filters = Readonly<{
  kind?: WebTestKind;
  risk?: WebTestRisk;
  environment?: WebTestEnvironment;
  list: boolean;
}>;

const catalog: readonly WebTestCatalogEntry[] = webTestCatalog;

const option = (argument: string, name: string): string | undefined => {
  const prefix = `--${name}=`;
  return argument.startsWith(prefix) ? argument.slice(prefix.length) : undefined;
};

const allowed = <Value extends string>(
  name: string,
  value: string | undefined,
  values: readonly Value[],
): Value | undefined => {
  if (value === undefined) return undefined;
  if (values.includes(value as Value)) return value as Value;
  throw new Error(`Unknown ${name} ${JSON.stringify(value)}. Expected one of: ${values.join(', ')}`);
};

const parseFilters = (arguments_: readonly string[]): Filters => {
  let kind: string | undefined;
  let risk: string | undefined;
  let environment: string | undefined;
  let list = false;

  for (const argument of arguments_) {
    if (argument === '--list') {
      list = true;
      continue;
    }
    const parsedKind = option(argument, 'kind');
    if (parsedKind !== undefined) {
      kind = parsedKind;
      continue;
    }
    const parsedRisk = option(argument, 'risk');
    if (parsedRisk !== undefined) {
      risk = parsedRisk;
      continue;
    }
    const parsedEnvironment = option(argument, 'environment');
    if (parsedEnvironment !== undefined) {
      environment = parsedEnvironment;
      continue;
    }
    throw new Error(`Unknown test selector ${JSON.stringify(argument)}`);
  }

  return {
    kind: allowed('kind', kind, webTestKinds),
    risk: allowed('risk', risk, webTestRisks),
    environment: allowed('environment', environment, webTestEnvironments),
    list,
  };
};

const selectedTests = (filters: Filters): readonly WebTestCatalogEntry[] => {
  return catalog.filter((entry) => (
    (filters.kind === undefined || entry.kind === filters.kind)
    && (filters.risk === undefined || entry.risks.includes(filters.risk))
    && (
      filters.environment === undefined
        ? defaultWebTestEnvironments.includes(entry.environment as (typeof defaultWebTestEnvironments)[number])
        : entry.environment === filters.environment
    )
  ));
};

const formatEntry = (entry: WebTestCatalogEntry): string => [
  entry.id,
  `kind=${entry.kind}`,
  `risks=${entry.risks.join(',')}`,
  `environment=${entry.environment}`,
  `file=${entry.file}`,
].join(' | ');

const filters = parseFilters(process.argv.slice(2));
const selected = selectedTests(filters);
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

for (const field of ['id', 'file'] as const) {
  const values = catalog.map((entry) => entry[field]);
  if (new Set(values).size !== values.length) throw new Error(`Duplicate Web test catalog ${field}.`);
}
const legacyEntrypoints = catalog.flatMap((entry) => entry.legacyEntrypoint ? [entry.legacyEntrypoint] : []);
if (new Set(legacyEntrypoints).size !== legacyEntrypoints.length) {
  throw new Error('Duplicate Web test catalog legacyEntrypoint.');
}

if (selected.length === 0) {
  throw new Error('No Web foundation tests matched the requested selectors.');
}

for (const entry of selected) {
  if (!existsSync(resolve(repositoryRoot, entry.file))) throw new Error(`Catalogued test does not exist: ${entry.file}`);
  if (entry.legacyEntrypoint && !existsSync(resolve(repositoryRoot, entry.legacyEntrypoint))) {
    throw new Error(`Catalogued legacy entry point does not exist: ${entry.legacyEntrypoint}`);
  }
}

if (filters.list) {
  for (const entry of selected) console.log(formatEntry(entry));
} else {
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    '--test',
    '--test-concurrency=1',
    '--test-reporter=spec',
    ...selected.map((entry) => entry.file),
  ], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
