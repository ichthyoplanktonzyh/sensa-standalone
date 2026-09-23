export const webTestKinds = ['contract', 'integration', 'quality'] as const;
export type WebTestKind = (typeof webTestKinds)[number];

export const webTestRisks = [
  'local-correctness',
  'durability',
  'convergence',
  'scale',
] as const;
export type WebTestRisk = (typeof webTestRisks)[number];

export const webTestEnvironments = ['node', 'built-web-artifact', 'browser-postgres'] as const;
export type WebTestEnvironment = (typeof webTestEnvironments)[number];

export const defaultWebTestEnvironments = ['node', 'built-web-artifact'] as const satisfies readonly WebTestEnvironment[];

export type WebTestCatalogEntry = Readonly<{
  id: string;
  file: string;
  kind: WebTestKind;
  risks: readonly WebTestRisk[];
  environment: WebTestEnvironment;
  legacyEntrypoint?: string;
}>;

/**
 * The migration baseline. A catalog entry classifies what a check proves;
 * legacy entry points remain the implementation until their assertions move
 * beside the owning module without changing meaning.
 */
export const webTestCatalog = [
  {
    id: 'learning-system-boundary',
    file: 'tests/web/contracts/learning-system-boundary.test.mts',
    kind: 'contract',
    risks: ['local-correctness'],
    environment: 'node',
  },
  {
    id: 'content-supply-authority',
    file: 'tests/web/contracts/content-supply-authority.test.mts',
    kind: 'contract',
    risks: ['local-correctness'],
    environment: 'node',
  },
  {
    id: 'learner-projection-boundary',
    file: 'tests/web/contracts/learner-projection-boundary.test.mts',
    kind: 'contract',
    risks: ['local-correctness'],
    environment: 'node',
  },
  {
    id: 'library-convergence-world',
    file: 'tests/web/convergence/library-convergence-world.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'durability', 'convergence'],
    environment: 'node',
  },
  {
    id: 'library-cloud-convergence',
    file: 'tests/web/integration/library-cloud-convergence.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'durability', 'convergence'],
    environment: 'browser-postgres',
  },
  {
    id: 'personal-semantic-world-merge',
    file: 'tests/web/integration/personal-semantic-world-merge.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'convergence'],
    environment: 'node',
    legacyEntrypoint: 'scripts/sensaPersonalSemanticWorldMergeSmoke.mts',
  },
  {
    id: 'learning-authority',
    file: 'tests/web/integration/learning-authority.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'durability'],
    environment: 'node',
    legacyEntrypoint: 'scripts/sensaLearningAuthoritySmoke.mts',
  },
  {
    id: 'learning-reconciliation',
    file: 'tests/web/integration/learning-reconciliation.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'convergence'],
    environment: 'node',
    legacyEntrypoint: 'scripts/sensaLearningReconciliationSmoke.mts',
  },
  {
    id: 'library-transaction-and-replay',
    file: 'tests/web/integration/library-transaction-and-replay.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'durability'],
    environment: 'node',
    legacyEntrypoint: 'scripts/sensaLibraryUpgradeSmoke.mts',
  },
  {
    id: 'personal-content-system',
    file: 'tests/web/integration/personal-content-system.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'durability'],
    environment: 'node',
    legacyEntrypoint: 'scripts/sensaPersonalContentSystemSmoke.mts',
  },
  {
    id: 'offline-shell-artifact',
    file: 'tests/web/integration/offline-shell-artifact.test.mts',
    kind: 'integration',
    risks: ['durability'],
    environment: 'built-web-artifact',
    legacyEntrypoint: 'scripts/sensaOfflineShellSmoke.mts',
  },
  {
    id: 'web-bundle-budget',
    file: 'tests/web/quality/web-bundle-budget.test.mts',
    kind: 'quality',
    risks: ['scale'],
    environment: 'built-web-artifact',
    legacyEntrypoint: 'scripts/sensaWebBundleBudgetSmoke.mts',
  },
] as const satisfies readonly WebTestCatalogEntry[];
