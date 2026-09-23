export const webTestKinds = ['unit', 'contract', 'integration', 'quality'] as const;
export type WebTestKind = (typeof webTestKinds)[number];

export const webTestRunners = ['vitest', 'playwright'] as const;
export type WebTestRunner = (typeof webTestRunners)[number];

export const webTestRisks = [
  'local-correctness',
  'durability',
  'convergence',
  'scale',
] as const;
export type WebTestRisk = (typeof webTestRisks)[number];

export const webTestEnvironments = ['node', 'built-web-artifact', 'chromium', 'postgres', 'browser-postgres'] as const;
export type WebTestEnvironment = (typeof webTestEnvironments)[number];

export const webTestSuites = ['foundation', 'fast', 'browser', 'database', 'manual'] as const;
export type WebTestSuite = (typeof webTestSuites)[number];

export const defaultWebTestEnvironments = ['node', 'built-web-artifact'] as const satisfies readonly WebTestEnvironment[];

export type WebTestCatalogEntry = Readonly<{
  id: string;
  file: string;
  kind: WebTestKind;
  risks: readonly WebTestRisk[];
  environment: WebTestEnvironment;
  suite: WebTestSuite;
  runner: WebTestRunner;
  memoryLibrary?: boolean;
  env?: Readonly<Record<string, string>>;
}>;

/**
 * Tests are selected by execution boundary and by the product risks they guard.
 * Migrated checks retain their original isolation while the largest files are
 * split into named behavior scenarios.
 */
const foundationTests = [
  {
    id: 'learning-language-matrix',
    file: 'tests/web/integration/learning-language-matrix.test.mts',
    kind: 'integration',
    risks: ['local-correctness'],
    environment: 'node',
    suite: 'foundation',
    runner: 'vitest',
  },
  {
    id: 'learning-system-boundary',
    file: 'tests/web/contracts/learning-system-boundary.test.mts',
    kind: 'contract',
    risks: ['local-correctness'],
    environment: 'node',
    suite: 'foundation',
    runner: 'vitest',
  },
  {
    id: 'content-supply-authority',
    file: 'tests/web/contracts/content-supply-authority.test.mts',
    kind: 'contract',
    risks: ['local-correctness'],
    environment: 'node',
    suite: 'foundation',
    runner: 'vitest',
  },
  {
    id: 'learner-projection-boundary',
    file: 'tests/web/contracts/learner-projection-boundary.test.mts',
    kind: 'contract',
    risks: ['local-correctness'],
    environment: 'node',
    suite: 'foundation',
    runner: 'vitest',
  },
  {
    id: 'library-convergence-world',
    file: 'tests/web/convergence/library-convergence-world.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'durability', 'convergence'],
    environment: 'node',
    suite: 'foundation',
    runner: 'vitest',
  },
  {
    id: 'library-cloud-convergence',
    file: 'tests/web/integration/library-cloud-convergence.spec.ts',
    kind: 'integration',
    risks: ['local-correctness', 'durability', 'convergence'],
    environment: 'browser-postgres',
    suite: 'database',
    runner: 'playwright',
  },
  {
    id: 'personal-semantic-world-merge',
    file: 'tests/web/integration/personal-semantic-world-merge.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'convergence'],
    environment: 'node',
    suite: 'foundation',
    runner: 'vitest',
  },
  {
    id: 'learning-authority',
    file: 'tests/web/integration/learning-authority.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'durability'],
    environment: 'node',
    suite: 'foundation',
    runner: 'vitest',
    memoryLibrary: true,
  },
  {
    id: 'learning-reconciliation',
    file: 'tests/web/integration/learning-reconciliation.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'convergence'],
    environment: 'node',
    suite: 'foundation',
    runner: 'vitest',
  },
  {
    id: 'library-transaction-and-replay',
    file: 'tests/web/integration/library-transaction-and-replay.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'durability'],
    environment: 'node',
    suite: 'foundation',
    runner: 'vitest',
    memoryLibrary: true,
  },
  {
    id: 'personal-content-system',
    file: 'tests/web/integration/personal-content-system.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'durability'],
    environment: 'node',
    suite: 'foundation',
    runner: 'vitest',
    memoryLibrary: true,
  },
  {
    id: 'offline-shell-artifact',
    file: 'tests/web/integration/offline-shell-artifact.test.mts',
    kind: 'integration',
    risks: ['durability'],
    environment: 'built-web-artifact',
    suite: 'foundation',
    runner: 'vitest',
  },
  {
    id: 'web-bundle-budget',
    file: 'tests/web/quality/web-bundle-budget.test.mts',
    kind: 'quality',
    risks: ['scale'],
    environment: 'built-web-artifact',
    suite: 'foundation',
    runner: 'vitest',
  },
] as const satisfies readonly WebTestCatalogEntry[];

type MigratedTest = Readonly<{path: string; suite: WebTestSuite; memoryLibrary?: boolean; env?: Readonly<Record<string, string>>}>;

const fastBeforeMemory = [
  'integration/support-diagnostics',
  'contracts/stream-authorization',
  'quality/content-supply-system-boundary',
  'release/incident-delivery',
] as const;

const fastWithMemory = [
  'integration/content-agent', 'integration/reveal-resources', 'integration/reveal-render',
  'integration/known-continuation', 'integration/speech-provider', 'quality/youglish-isolation',
  'contracts/resource-contracts', 'integration/learning-registry', 'integration/service-status',
  'integration/model-turn', 'integration/model-streaming', 'integration/model-execution',
  'quality/model-management', 'integration/semantic-agent-loop', 'integration/local-model-opt-in',
  'release/release-candidate', 'release/supabase-auth-config', 'quality/source-syntax',
  'integration/telemetry', 'integration/browser-reliability', 'integration/storage-capability',
  'integration/model-budget', 'quality/web-idle-work',
  'integration/package-learning', 'integration/local-learning-runtime', 'integration/media-library',
  'integration/learning-scene-bridge', 'integration/personal-learning', 'integration/language-route',
  'integration/language-journey', 'integration/reading-language', 'integration/reading-glossary',
  'integration/reading-skip', 'integration/extension-speech', 'integration/reading-site',
  'integration/reference-language', 'integration/spoken-language', 'integration/package-language',
  'integration/language-scope', 'integration/practice-scope', 'integration/action-language',
  'contracts/bridge-contract', 'integration/agent-mcp', 'integration/web-intake',
  'contracts/account-backup-contract', 'integration/scene-image-input', 'quality/appearance',
  'quality/mobile-interaction', 'integration/local-i18n',
] as const;

const browserTests = [
  'browser/skin-surface', 'browser/reference-presentation',
  'browser/sqlite-opfs-benchmark', 'browser/web-bootstrap-budget',
] as const;

const databaseTests = [
  'database/database-budget', 'database/account-deletion', 'database/model-request-state',
  'database/intake-delivery', 'database/library-cloud',
] as const;

const manualTests = [
  'browser/browser-port', 'browser/extension-popup', 'integration/local-book',
] as const;

const playwrightPaths = new Set<string>([
  'browser/skin-surface', 'browser/reference-presentation',
  'browser/sqlite-opfs-benchmark', 'browser/web-bootstrap-budget',
  'browser/browser-port', 'browser/extension-popup', 'database/library-cloud',
]);

const durabilityTests = new Set<string>([
  'database/account-deletion', 'database/intake-delivery', 'database/library-cloud',
  'database/model-request-state', 'browser/sqlite-opfs-benchmark',
  'browser/web-bootstrap-budget', 'integration/known-continuation',
  'integration/learning-registry', 'integration/local-book',
  'integration/local-learning-runtime', 'integration/media-library',
  'integration/model-turn', 'integration/package-learning',
  'integration/personal-learning', 'integration/storage-capability',
  'integration/web-intake',
]);
const convergenceTests = new Set<string>([
  'database/library-cloud', 'browser/web-bootstrap-budget',
]);
const scaleTests = new Set<string>([
  'database/database-budget', 'browser/sqlite-opfs-benchmark',
  'browser/web-bootstrap-budget', 'integration/content-agent',
  'quality/web-idle-work',
]);

const migrated: readonly MigratedTest[] = [
  ...fastBeforeMemory.map((path) => ({path, suite: 'fast' as const})),
  ...fastWithMemory.map((path) => ({
    path,
    suite: 'fast' as const,
    memoryLibrary: true,
    ...(path === 'integration/model-execution' ? {env: {GENKIT_ENV: 'prod'}} : {}),
  })),
  ...browserTests.map((path) => ({path, suite: 'browser' as const})),
  ...databaseTests.map((path) => ({path, suite: 'database' as const})),
  ...manualTests.map((path) => ({
    path,
    suite: 'manual' as const,
    ...(path === 'integration/local-book' ? {memoryLibrary: true} : {}),
  })),
];

const migratedPaths = new Set(migrated.map((entry) => entry.path));
for (const [risk, paths] of [
  ['durability', durabilityTests],
  ['convergence', convergenceTests],
  ['scale', scaleTests],
] as const) {
  for (const path of paths) {
    if (!migratedPaths.has(path)) throw new Error(`Unknown ${risk} test path: ${path}`);
  }
}

const migratedEntry = ({path, suite, memoryLibrary, env}: MigratedTest): WebTestCatalogEntry => {
  const kind = path.startsWith('contracts/') ? 'contract' : path.startsWith('quality/') ? 'quality' : 'integration';
  const environment = path === 'database/library-cloud' ? 'browser-postgres'
    : suite === 'browser' || path.startsWith('browser/') ? 'chromium'
      : suite === 'database' ? 'postgres' : 'node';
  const extension = path.startsWith('release/') ? 'mjs' : 'mts';
  const risks: WebTestRisk[] = ['local-correctness'];
  if (durabilityTests.has(path)) risks.push('durability');
  if (convergenceTests.has(path)) risks.push('convergence');
  if (scaleTests.has(path)) risks.push('scale');
  return {
    id: path.split('/').at(-1)!,
    file: playwrightPaths.has(path) ? `tests/web/${path}.spec.ts` : `tests/web/${path}.test.${extension}`,
    kind,
    risks,
    environment,
    suite,
    runner: playwrightPaths.has(path) ? 'playwright' : 'vitest',
    ...(memoryLibrary ? {memoryLibrary} : {}),
    ...(env ? {env} : {}),
  };
};

export const webTestCatalog: readonly WebTestCatalogEntry[] = [
  ...foundationTests,
  ...migrated.map(migratedEntry),
  {
    id: 'home-readiness',
    file: 'tests/web/unit/home-readiness.test.ts',
    kind: 'unit',
    risks: ['local-correctness'],
    environment: 'node',
    suite: 'fast',
    runner: 'vitest',
    memoryLibrary: true,
  },
  {
    id: 'resource-presentation',
    file: 'tests/web/browser/resource-presentation.spec.ts',
    kind: 'integration',
    risks: ['local-correctness'],
    environment: 'chromium',
    suite: 'browser',
    runner: 'playwright',
  },
];
