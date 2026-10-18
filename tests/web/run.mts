import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import {randomUUID} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {journeyTestIds,validateJourneyMapping,type LongJourneyId} from './journeyMapping.mts';
import {partitionTestFiles,browserFileWeights,browserQuickFileWeights} from './support/testShards';
import {executionGroups, reportCoversSelection} from './support/executionGroups';
import {browserDepths,selectBrowserDepth,type BrowserDepth} from './support/browserDepth';

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
  journey?:LongJourneyId;
  shard?:string;
  depth?:BrowserDepth;
  list: boolean;
}>;

const catalog: readonly WebTestCatalogEntry[] = webTestCatalog;
validateJourneyMapping(catalog);

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
  let journey:LongJourneyId|undefined;
  let shard:string|undefined;
  let depth:BrowserDepth|undefined;
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
    const parsedJourney=option(argument,'journey');
    if(parsedJourney!==undefined){
      journey=parsedJourney as LongJourneyId;
      journeyTestIds(journey);
      continue;
    }
    const parsedShard=option(argument,'shard');
    if(parsedShard!==undefined){shard=parsedShard;continue;}
    const parsedDepth=option(argument,'depth');
    if(parsedDepth!==undefined){depth=allowed('depth',parsedDepth,browserDepths);continue;}
    throw new Error(`Unknown test selector ${JSON.stringify(argument)}`);
  }

  return {
    kind: allowed('kind', kind, webTestKinds),
    risk: allowed('risk', risk, webTestRisks),
    environment: allowed('environment', environment, webTestEnvironments),
    suite: allowed('suite', suite, webTestSuites),
    runner: allowed('runner', runner, webTestRunners),
    id,
    journey,
    shard,
    depth,
    list,
  };
};

const selectedTests = (filters: Filters): readonly WebTestCatalogEntry[] => {
  const journeyIds=filters.journey?new Set(journeyTestIds(filters.journey)):null;
  if(filters.depth!==undefined&&filters.suite!=='browser')throw Error('Validation depth only applies to the browser suite');
  return selectBrowserDepth(catalog.filter((entry) => (
    (filters.kind === undefined || entry.kind === filters.kind)
    && (filters.runner === undefined || entry.runner === filters.runner)
    && (filters.risk === undefined || entry.risks.includes(filters.risk))
    && (filters.id === undefined || entry.id === filters.id)
    && (journeyIds===null||journeyIds.has(entry.id))
    && (
      filters.suite !== undefined
        ? entry.suite === filters.suite || (filters.suite === 'fast' && entry.suite === 'foundation')
        : filters.environment !== undefined
          ? entry.environment === filters.environment
          : filters.id !== undefined || filters.journey !== undefined
            ? true
            : entry.suite === 'foundation' && defaultWebTestEnvironments.includes(entry.environment as (typeof defaultWebTestEnvironments)[number])
    )
    && (filters.environment === undefined || entry.environment === filters.environment)
  )),filters.depth??'full');
};

const formatEntry = (entry: WebTestCatalogEntry): string => [
  entry.id,
  `kind=${entry.kind}`,
  `risks=${entry.risks.join(',')}`,
  `environment=${entry.environment}`,
  `suite=${entry.suite}`,
  `runner=${entry.runner}`,
  `file=${entry.file}`,
].join(' | ');

const filters = parseFilters(process.argv.slice(2));
const selected = partitionTestFiles(selectedTests(filters),filters.shard,
  filters.suite==='browser'?entry=>(filters.depth==='quick'?browserQuickFileWeights:browserFileWeights)[entry.id]??5:undefined);
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
  const runner = entry.runner;
  if (runner === 'vitest') return !/\.test\.(?:ts|tsx|mts|mjs)$/u.test(entry.file) || !['node', 'built-web-artifact', 'postgres'].includes(entry.environment);
  return !entry.file.endsWith('.spec.ts') || !['chromium', 'browser-postgres'].includes(entry.environment);
});
if (wrongRunner.length !== 0) {
  throw new Error(`Tests assigned to an incompatible runner: ${wrongRunner.map((entry) => entry.id).join(', ')}`);
}
const unclassified = catalog.filter((entry) => entry.risks.length === 0);
if (unclassified.length !== 0) throw new Error(`Tests missing risk tags: ${unclassified.map((entry) => entry.id).join(', ')}`);
const wrongCiBoundary = catalog.filter((entry) => {
  if(entry.browserDepth!==undefined&&(entry.suite!=='browser'||entry.runner!=='playwright'))return true;
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
  const failures:string[]=[];
  const selectionName=filters.suite??'selection';
  const shardName=(filters.shard??'all').replace('/','-');
  const executionId=randomUUID();
  const reportRoot=resolve(repositoryRoot,`.tmp/test-results/${selectionName}/shard-${shardName}/${executionId}`);
  mkdirSync(reportRoot,{recursive:true,mode:0o700});
  const observations:{files:string[];runner:string;environment:string;exitCode:number|null;selectionReported:boolean;elapsedMs:number;report:string}[]=[];
  const runAttempt=process.env.GITHUB_RUN_ATTEMPT??'local';
  if(runAttempt!=='local'&&!/^[1-9][0-9]*$/.test(runAttempt))throw Error('Invalid test report attempt');
  for (const [index, group] of executionGroups(selected).entries()) {
    const ids=group.entries.map(entry=>entry.id),files=group.entries.map(entry=>entry.file);
    console.log(`\n[${group.runner}/${group.environment}] ${ids.join(', ')}`);
    if(group.runner==='playwright')console.log(`Browser depth: ${filters.depth??'full'}${filters.depth==='quick'?' (capacity cases excluded; not full release evidence)':''}`);
    const prefix=`shard-${shardName}-attempt-${runAttempt}-${executionId}-group-${index+1}`;
    const reportPath=join(reportRoot,`${prefix}.json`);
    const args = group.runner === 'vitest'
      ? [resolve(repositoryRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts', '--reporter=default', '--reporter=json', `--outputFile=${reportPath}`, ...files]
      : [resolve(repositoryRoot, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.config.ts', '--reporter=line,json,blob', ...files];
    const started=Date.now();
    const result = spawnSync(process.execPath, args, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...group.env,
        ...(group.runner === 'playwright' ? {
          SENSA_PLAYWRIGHT_OUTPUT_DIR: process.env.SENSA_PLAYWRIGHT_OUTPUT_DIR ?? `.tmp/playwright-results/${selectionName}-${shardName}-${executionId}-${index+1}`,
          PLAYWRIGHT_JSON_OUTPUT_FILE:reportPath,
          PLAYWRIGHT_BLOB_OUTPUT_FILE:join(reportRoot,`${prefix}.zip`),
          SENSA_BROWSER_DEPTH:filters.depth??'full',
        } : {}),
      },
      stdio: 'inherit',
    });
    let selectionReported=false;
    try{selectionReported=reportCoversSelection(JSON.parse(readFileSync(reportPath,'utf8')),group.runner,group.entries,repositoryRoot);}catch{/* Missing native evidence is not a pass. */}
    observations.push({files,runner:group.runner,environment:group.environment,exitCode:result.status,selectionReported,elapsedMs:Date.now()-started,report:reportPath});
    if (result.error) console.error('Native runner could not start:',(result.error as NodeJS.ErrnoException).code??'unknown');
    if (result.status !== 0 || !selectionReported) {
      process.exitCode = result.status ?? 1;
      if(process.exitCode===0)process.exitCode=1;
      failures.push(...ids);
      if(!selectionReported)console.error('Native report did not account for every selected file:',ids.join(', '));
    }
  }
  writeFileSync(join(reportRoot,'selection-summary.json'),JSON.stringify({format:'sensa-test-execution-v1',depth:filters.depth??'full',excludedCaseTag:filters.depth==='quick'?'@capacity':null,selectedFiles:selected.map(entry=>entry.file),groups:observations},null,2)+'\n');
  if(failures.length)console.error(`Failed test files (${failures.length}/${selected.length}): ${failures.join(', ')}`);
}
