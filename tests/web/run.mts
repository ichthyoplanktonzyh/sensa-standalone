import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  defaultWebTestEnvironments,
  webTestCatalog,
  webTestEnvironments,
  webTestKinds,
  webTestRisks,
  webTestRunners,
  webTestSuites,
  type WebTestCatalogEntry,
  type WebTestEnvironment,
  type WebTestKind,
  type WebTestRisk,
  type WebTestRunner,
  type WebTestSuite,
} from './catalog.mts';

type Filters = Readonly<{
  kind?: WebTestKind;
  risk?: WebTestRisk;
  environment?: WebTestEnvironment;
  suite?: WebTestSuite;
  runner?: WebTestRunner;
  id?: string;
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
  let suite: string | undefined;
  let runner: string | undefined;
  let id: string | undefined;
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
    const parsedSuite = option(argument, 'suite');
    if (parsedSuite !== undefined) {
      suite = parsedSuite;
      continue;
    }
    const parsedRunner = option(argument, 'runner');
    if (parsedRunner !== undefined) {
      runner = parsedRunner;
      continue;
    }
    const parsedId = option(argument, 'id');
    if (parsedId !== undefined) {
      id = parsedId;
      continue;
    }
    throw new Error(`Unknown test selector ${JSON.stringify(argument)}`);
  }

  return {
    kind: allowed('kind', kind, webTestKinds),
    risk: allowed('risk', risk, webTestRisks),
    environment: allowed('environment', environment, webTestEnvironments),
    suite: allowed('suite', suite, webTestSuites),
    runner: allowed('runner', runner, webTestRunners),
    id,
    list,
  };
};

const selectedTests = (filters: Filters): readonly WebTestCatalogEntry[] => {
  return catalog.filter((entry) => (
    (filters.kind === undefined || entry.kind === filters.kind)
    && (filters.runner === undefined || (entry.runner ?? 'node') === filters.runner)
    && (filters.risk === undefined || entry.risks.includes(filters.risk))
    && (filters.id === undefined || entry.id === filters.id)
    && (
      filters.suite !== undefined
        ? entry.suite === filters.suite || (filters.suite === 'fast' && entry.suite === 'foundation')
        : filters.environment !== undefined
          ? entry.environment === filters.environment
          : filters.id !== undefined
            ? true
            : entry.suite === 'foundation' && defaultWebTestEnvironments.includes(entry.environment as (typeof defaultWebTestEnvironments)[number])
    )
    && (filters.environment === undefined || entry.environment === filters.environment)
  ));
};

const formatEntry = (entry: WebTestCatalogEntry): string => [
  entry.id,
  `kind=${entry.kind}`,
  `risks=${entry.risks.join(',')}`,
  `environment=${entry.environment}`,
  `suite=${entry.suite}`,
  `runner=${entry.runner ?? 'node'}`,
  `file=${entry.file}`,
].join(' | ');

const filters = parseFilters(process.argv.slice(2));
const selected = selectedTests(filters);
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const testFiles = (directory: string, relativeDirectory = 'tests/web'): string[] => readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
  const path = join(directory, entry.name);
  const relativePath = `${relativeDirectory}/${entry.name}`;
  if (entry.isDirectory()) return testFiles(path, relativePath);
  return /\.(?:test\.(?:mts|mjs|ts|tsx)|spec\.ts)$/u.test(entry.name) ? [relativePath] : [];
});

for (const field of ['id', 'file'] as const) {
  const values = catalog.map((entry) => entry[field]);
  if (new Set(values).size !== values.length) throw new Error(`Duplicate Web test catalog ${field}.`);
}
const cataloguedFiles = new Set(catalog.map((entry) => entry.file));
const wrongRunner = catalog.filter((entry) => {
  const runner = entry.runner ?? 'node';
  if (runner === 'vitest') return !/\.test\.(?:ts|tsx|mts|mjs)$/u.test(entry.file) || !['node', 'built-web-artifact', 'postgres'].includes(entry.environment);
  if (runner === 'playwright') return !entry.file.endsWith('.spec.ts') || entry.environment !== 'chromium';
  return !/\.test\.(?:mts|mjs)$/u.test(entry.file);
});
if (wrongRunner.length !== 0) {
  throw new Error(`Tests assigned to an incompatible runner: ${wrongRunner.map((entry) => entry.id).join(', ')}`);
}
const unclassified = catalog.filter((entry) => entry.risks.length === 0);
if (unclassified.length !== 0) throw new Error(`Tests missing risk tags: ${unclassified.map((entry) => entry.id).join(', ')}`);
const wrongCiBoundary = catalog.filter((entry) => {
  if (entry.suite === 'manual') return false;
  if (entry.environment === 'node' || entry.environment === 'built-web-artifact') {
    return entry.suite !== 'foundation' && entry.suite !== 'fast';
  }
  if (entry.environment === 'chromium') return entry.suite !== 'browser';
  return entry.suite !== 'database';
});
if (wrongCiBoundary.length !== 0) {
  throw new Error(`Tests assigned outside their CI execution boundary: ${wrongCiBoundary.map((entry) => entry.id).join(', ')}`);
}
const manualRiskExceptions = new Set(['local-book']); // Requires a separately generated release-candidate catalog.
const unreviewedManualRisk = catalog.filter((entry) => entry.suite === 'manual'
  && entry.risks.some((risk) => risk !== 'local-correctness')
  && !manualRiskExceptions.has(entry.id));
if (unreviewedManualRisk.length !== 0) {
  throw new Error(`High-risk tests outside CI need an explicit exception: ${unreviewedManualRisk.map((entry) => entry.id).join(', ')}`);
}
const uncataloguedFiles = testFiles(resolve(repositoryRoot, 'tests/web')).filter((file) => !cataloguedFiles.has(file));
if (uncataloguedFiles.length !== 0) throw new Error(`Uncatalogued Web tests: ${uncataloguedFiles.join(', ')}`);
if (selected.length === 0) {
  throw new Error('No Web tests matched the requested selectors.');
}

for (const entry of selected) {
  if (!existsSync(resolve(repositoryRoot, entry.file))) throw new Error(`Catalogued test does not exist: ${entry.file}`);
}

if (filters.list) {
  for (const entry of selected) console.log(formatEntry(entry));
} else {
  for (const entry of selected) {
    console.log(`\n[${entry.suite}] ${entry.id}`);
    const runner = entry.runner ?? 'node';
    const args = runner === 'vitest'
      ? [resolve(repositoryRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts', entry.file]
      : runner === 'playwright'
        ? [resolve(repositoryRoot, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.config.ts', entry.file]
        : ['--import', 'tsx', '--test', '--test-reporter=spec', entry.file];
    const result = spawnSync(process.execPath, args, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...(entry.memoryLibrary ? {SENSA_TEST_MEMORY_LIBRARY: 'true'} : {}),
        ...entry.env,
      },
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
}
