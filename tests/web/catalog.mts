export {
  longJourneyMappings, auditedCapabilities, auditedScenarios,currentJourneyScenarios,
  scenarioEvidenceContributions, scenarioLongJourneyIds,
  journeySupportingTests,journeyTestIds,
} from './journeyMapping.mts';

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
  /** Full release validation only; default/local selection is still full. */
  browserDepth?: 'full';
}>;

/**
 * Tests are selected by execution boundary and by the product risks they guard.
 * Migrated checks retain their original isolation while the largest files are
 * split into named behavior scenarios.
 */
const foundationTests = [
  {id:'fixture-preparation',file:'tests/web/quality/fixture-preparation.test.mts',kind:'quality',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'release-archive',file:'tests/web/release/release-archive.test.mjs',kind:'contract',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'live-verification',file:'tests/web/release/live-verification.test.mjs',kind:'contract',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'api-release-identity',file:'tests/web/release/api-release-identity.test.mts',kind:'contract',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'test-execution',file:'tests/web/quality/test-execution.test.mts',kind:'quality',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest'},
  ...['account-recovery-journey','reference-practice-journey','learning-runtime-journey','learning-workspace-journey'].map(id=>({id,file:`tests/web/browser/${id}.spec.ts`,kind:'integration' as const,risks:['local-correctness','durability','convergence','scale'] as const,environment:'chromium' as const,suite:'browser' as const,runner:'playwright' as const})),
  {id:'release-status',file:'tests/web/release/release-status.test.mjs',kind:'contract',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'candidate-source',file:'tests/web/release/candidate-source.test.mjs',kind:'contract',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'evidence-archive',file:'tests/web/quality/evidence-archive.test.mts',kind:'quality',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'test-shards',file:'tests/web/quality/test-shards.test.mts',kind:'quality',risks:['local-correctness'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'api-runtime-imports',file:'tests/web/contracts/api-runtime-imports.test.mts',kind:'contract',risks:['local-correctness'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'library-sync-runtime',file:'tests/web/integration/library-sync-runtime.test.mts',kind:'integration',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'database-log-privacy',file:'tests/web/integration/database-log-privacy.test.mts',kind:'integration',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'account-admission',file:'tests/web/database/account-admission.test.mts',kind:'integration',risks:['local-correctness','convergence'],environment:'postgres',suite:'database',runner:'vitest'},
  {id:'operations-access-postgres',file:'tests/web/database/operations-access.test.mjs',kind:'integration',risks:['local-correctness','durability'],environment:'postgres',suite:'database',runner:'vitest'},
  {id:'guest-content-presence',file:'tests/web/integration/guest-content-presence.test.mts',kind:'integration',risks:['local-correctness'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'web-entry-hmr',file:'tests/web/browser/web-entry-hmr.spec.ts',kind:'integration',risks:['local-correctness','durability'],environment:'chromium',suite:'browser',runner:'playwright'},
  {id:'library-bootstrap-recovery',file:'tests/web/integration/library-bootstrap-recovery.test.mts',kind:'integration',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'account-session-boundary',file:'tests/web/integration/account-session-boundary.test.mts',kind:'integration',risks:['local-correctness','durability','convergence'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'local-clear-signed-out',file:'tests/web/integration/local-clear-signed-out.test.mts',kind:'integration',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'account-deletion-local',file:'tests/web/integration/account-deletion-local.test.mts',kind:'integration',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'account-deletion-flow',file:'tests/web/integration/account-deletion-flow.test.mts',kind:'integration',risks:['local-correctness','durability','convergence'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'hosted-identity-deletion',file:'tests/web/integration/hosted-identity-deletion.test.mts',kind:'integration',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'consumer-auth-proof',file:'tests/web/unit/consumer-auth-proof.test.mts',kind:'unit',risks:['local-correctness'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'email-link-boundary',file:'tests/web/unit/email-link-boundary.test.mts',kind:'unit',risks:['local-correctness','convergence'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'youglish-caption',file:'tests/web/unit/youglish-caption.test.mts',kind:'unit',risks:['local-correctness'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'sqlite-runtime-failure',file:'tests/web/browser/sqlite-runtime-failure.spec.ts',kind:'integration',risks:['local-correctness','durability'],environment:'chromium',suite:'browser',runner:'playwright'},
  {id:'supplemental-membership',file:'tests/web/integration/supplemental-membership.test.mts',kind:'integration',risks:['local-correctness','durability','convergence'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'learning-session-scope',file:'tests/web/integration/learning-session-scope.test.mts',kind:'integration',risks:['local-correctness','durability','convergence'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'personal-meaning-lifecycle',file:'tests/web/integration/personal-meaning-lifecycle.test.mts',kind:'integration',risks:['local-correctness','durability','convergence'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'learning-session-end',file:'tests/web/integration/learning-session-end.test.mts',kind:'integration',risks:['local-correctness','durability','convergence'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'book-plan-planning',file:'tests/web/integration/book-plan-planning.test.mts',kind:'integration',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'book-curriculum-sources',file:'tests/web/integration/book-curriculum-sources.test.mts',kind:'integration',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'book-publication-provenance',file:'tests/web/integration/book-publication-provenance.test.mts',kind:'integration',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'relearning-loop',file:'tests/web/integration/relearning-loop.test.mts',kind:'integration',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'library-sync-transport',file:'tests/web/integration/library-sync-transport.test.mts',kind:'integration',risks:['local-correctness','durability','convergence'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'personal-meaning-conflict-decision',file:'tests/web/integration/personal-meaning-conflict-decision.test.mts',kind:'integration',risks:['local-correctness','durability','convergence'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'cloud-sync-comparison',file:'tests/web/unit/cloud-sync-comparison.test.mts',kind:'unit',risks:['local-correctness','convergence'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'library-sync-incremental',file:'tests/web/integration/library-sync-incremental.test.mts',kind:'integration',risks:['local-correctness','durability','convergence','scale'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'library-sync-restore',file:'tests/web/integration/library-sync-restore.test.mts',kind:'integration',risks:['local-correctness','durability','convergence','scale'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'semantic-record-validation',file:'tests/web/integration/semantic-record-validation.test.mts',kind:'integration',risks:['local-correctness','durability','scale'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'library-record-validation',file:'tests/web/integration/library-record-validation.test.mts',kind:'integration',risks:['local-correctness','durability','scale'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'replica-candidate-storage',file:'tests/web/integration/replica-candidate-storage.test.mts',kind:'integration',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'replica-candidate-worker',file:'tests/web/browser/replica-candidate-worker.spec.ts',kind:'integration',risks:['local-correctness','durability','scale'],environment:'chromium',suite:'browser',runner:'playwright'},
  {id:'library-sync-blocks',file:'tests/web/unit/library-sync-blocks.test.mts',kind:'unit',risks:['local-correctness','durability','scale'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'shared-learning-storage',file:'tests/web/integration/shared-learning-storage.test.mts',kind:'integration',risks:['local-correctness','durability','scale'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'stored-record-codec',file:'tests/web/unit/stored-record-codec.test.mts',kind:'unit',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'cloud-sync-service-budget',file:'tests/web/unit/cloud-sync-service-budget.test.mts',kind:'unit',risks:['local-correctness','scale'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'study-scope-storage',file:'tests/web/integration/study-scope-storage.test.mts',kind:'integration',risks:['local-correctness','durability','scale'],environment:'node',suite:'fast',runner:'vitest',memoryLibrary:true},
  {id:'learning-target-view',file:'tests/web/unit/learning-target-view.test.mts',kind:'unit',risks:['local-correctness'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'scene-editor-read',file:'tests/web/unit/scene-editor-read.test.mts',kind:'unit',risks:['local-correctness','durability'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'statistics-calendar',file:'tests/web/unit/statistics-calendar.test.mts',kind:'unit',risks:['local-correctness','scale'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'cloud-sync-panel-read',file:'tests/web/unit/cloud-sync-panel-read.test.mts',kind:'unit',risks:['local-correctness'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'cloud-sync-panel-read-browser',file:'tests/web/browser/cloud-sync-panel-read.spec.ts',kind:'integration',risks:['local-correctness','durability','convergence'],environment:'chromium',suite:'browser',runner:'playwright'},
  {id:'practice-material-read',file:'tests/web/unit/practice-material-read.test.mts',kind:'unit',risks:['local-correctness','scale'],environment:'node',suite:'fast',runner:'vitest'},
  {id:'interaction-budget',file:'tests/web/unit/interaction-budget.test.mts',kind:'unit',risks:['local-correctness','scale'],environment:'node',suite:'fast',runner:'vitest'},
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
  {id:'library-sync-coordination',file:'tests/web/integration/library-sync-coordination.spec.ts',kind:'integration',risks:['local-correctness','durability','convergence'],environment:'browser-postgres',suite:'database',runner:'playwright'},
  {
    id: 'learning-branch-replay',
    file: 'tests/web/integration/learning-branch-replay.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'durability', 'convergence'],
    environment: 'node',
    suite: 'foundation',
    runner: 'vitest',
    memoryLibrary: true,
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
    id: 'library-replica-execution',
    file: 'tests/web/unit/library-replica-execution.test.mts',
    kind: 'unit',
    risks: ['local-correctness', 'convergence', 'scale'],
    environment: 'node',
    suite: 'fast',
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
    risks: ['local-correctness', 'durability','scale'],
    environment: 'node',
    suite: 'foundation',
    runner: 'vitest',
    memoryLibrary: true,
  },
  {
    id: 'personal-content-system',
    file: 'tests/web/integration/personal-content-system.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'durability', 'convergence'],
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
  'unit/direct-learning-choices',
  'unit/personal-learning-batch',
  'unit/world-readers',
  'integration/world-browse-storage',
  'unit/canonical-digest',
  'unit/book-center-projection',
  'unit/sqlite-sahpool-preservation',
  'unit/package-cache-projection',
  'contracts/journey-evidence',
  'integration/local-book-preparation',
  'integration/local-published-catalog',
  'integration/live-acceptance-runner',
  'integration/support-diagnostics',
  'release/learning-content-bucket',
  'release/system-release',
  'release/domain-baseline',
  'release/operations-access',
  'integration/english-lightweight-release',
  'integration/semantic-session-persistence',
  'contracts/stream-authorization',
  'contracts/portable-lightweight-package',
  'quality/content-supply-system-boundary',
  'release/incident-delivery',
  'integration/route-foundation-release',
] as const;

const fastWithMemory = [
  'integration/personal-learning-scene',
  'integration/personal-meaning-correction',
  'integration/learner-library-projection',
  'integration/direct-learning-provisioning',
  'integration/direct-learning-enrollment',
  'integration/direct-learning-source',
  'integration/manual-meaning',
  'integration/scoped-context-command',
  'integration/semantic-lookup-storage',
  'unit/version-store',
  'integration/agent-destination-initialization',
  'integration/semantic-lookup',
  'unit/workspace-source-aliases',
  'unit/personal-portable-export',
  'unit/portable-media-cache',
  'unit/package-workspace-refresh',
  'integration/book-installation-journey',
  'integration/content-agent', 'integration/reveal-resources', 'integration/reveal-render',
  'integration/known-continuation', 'integration/speech-provider', 'quality/youglish-isolation',
  'contracts/resource-contracts', 'integration/learning-registry', 'integration/service-status',
  'integration/portable-learning-registry',
  'integration/model-turn', 'integration/model-streaming', 'integration/model-execution',
  'quality/model-management', 'integration/semantic-agent-loop', 'integration/semantic-teacher-contract', 'integration/semantic-teacher-flow', 'integration/local-model-opt-in',
  'release/release-candidate', 'release/supabase-auth-config', 'quality/source-syntax',
  'integration/telemetry', 'integration/browser-reliability', 'integration/storage-capability',
  'integration/model-budget', 'quality/web-idle-work',
  'integration/agent-trace',
  'integration/live-matrix-summary',
  'integration/language-trace-evidence',
  'integration/guest-library', 'integration/local-clear-sync', 'integration/backup-restore', 'integration/extension-local-models',
  'integration/package-learning', 'integration/learning-command-receipt', 'integration/learning-material-pins', 'integration/review-session', 'integration/portable-package-loop', 'integration/local-learning-runtime', 'integration/learning-runtime-query', 'integration/runtime-learning-candidates', 'integration/learning-management-query', 'integration/learning-history-page', 'integration/media-library',
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
  'browser/youglish-lifecycle',
  'browser/reference-query-lifecycle',
  'browser/reference-assessment-boundary',
  'browser/extension-subtitle-surface',
  'browser/extension-reading-surface',
  'browser/browser-port', 'browser/extension-popup',
  'browser/retention-review-capacity',
  'browser/extension-intake-journey',
  'browser/practice-source-loading',
  'browser/extension-selection',
  'browser/semantic-lookup-opfs',
  'browser/personal-meaning-journey',
  'browser/portable-package-journey',
  'browser/skin-surface', 'browser/reference-presentation',
  'browser/package-center-journey',
  'browser/portable-book-capacity',
  'browser/sqlite-sahpool-recovery',
  'browser/semantic-session-persistence-browser',
  'browser/extension-storage-recovery',
  'browser/sqlite-opfs-benchmark', 'browser/web-bootstrap-budget',
] as const;

const databaseTests = [
  'database/database-budget', 'database/account-deletion', 'database/model-request-state',
  'database/intake-delivery', 'database/library-cloud',
] as const;

const manualTests = [
  'integration/local-book',
] as const;

const playwrightPaths = new Set<string>([
  'browser/youglish-lifecycle',
  'browser/reference-query-lifecycle',
  'browser/reference-assessment-boundary',
  'browser/extension-subtitle-surface',
  'browser/extension-reading-surface',
  'browser/retention-review-capacity',
  'browser/extension-intake-journey',
  'browser/practice-source-loading',
  'browser/extension-selection',
  'browser/semantic-lookup-opfs',
  'browser/personal-meaning-journey',
  'browser/portable-package-journey',
  'browser/skin-surface', 'browser/reference-presentation',
  'browser/package-center-journey',
  'browser/portable-book-capacity',
  'browser/sqlite-sahpool-recovery',
  'browser/semantic-session-persistence-browser',
  'browser/extension-storage-recovery',
  'browser/sqlite-opfs-benchmark', 'browser/web-bootstrap-budget',
  'browser/browser-port', 'browser/extension-popup', 'database/library-cloud',
]);

const durabilityTests = new Set<string>([
  'integration/personal-learning-scene',
  'integration/personal-meaning-correction',
  'integration/learner-library-projection',
  'integration/learning-material-pins',
  'integration/learning-management-query',
  'integration/learning-command-receipt',
  'integration/review-session',
  'integration/learning-runtime-query',
  'integration/direct-learning-provisioning',
  'integration/direct-learning-enrollment',
  'integration/manual-meaning',
  'browser/extension-intake-journey',
  'integration/scoped-context-command',
  'unit/personal-learning-batch',
  'unit/world-readers',
  'integration/world-browse-storage',
  'browser/practice-source-loading',
  'integration/semantic-lookup-storage',
  'browser/semantic-lookup-opfs',
  'integration/semantic-lookup',
  'browser/personal-meaning-journey',
  'unit/portable-media-cache',
  'browser/portable-package-journey',
  'unit/package-cache-projection',
  'unit/sqlite-sahpool-preservation',
  'integration/book-installation-journey',
  'integration/portable-learning-registry',
  'database/account-deletion', 'database/intake-delivery', 'database/library-cloud',
  'database/model-request-state', 'browser/sqlite-opfs-benchmark',
  'browser/semantic-session-persistence-browser',
  'browser/package-center-journey',
  'browser/portable-book-capacity',
  'browser/sqlite-sahpool-recovery',
  'browser/extension-storage-recovery',
  'browser/web-bootstrap-budget', 'integration/known-continuation',
  'integration/learning-registry', 'integration/local-book',
  'integration/local-learning-runtime', 'integration/media-library',
  'integration/model-turn', 'integration/package-learning', 'integration/portable-package-loop',
  'integration/personal-learning', 'integration/storage-capability',
  'integration/web-intake',
  'integration/guest-library',
  'integration/english-lightweight-release',
]);
const convergenceTests = new Set<string>([
  'integration/personal-meaning-correction',
  'integration/direct-learning-provisioning',
  'integration/direct-learning-enrollment',
  'browser/personal-meaning-journey',
  'integration/scoped-context-command',
  'unit/world-readers',
  'integration/world-browse-storage',
  'integration/semantic-lookup-storage',
  'browser/semantic-lookup-opfs',
  'unit/package-workspace-refresh',
  'database/library-cloud', 'browser/web-bootstrap-budget',
]);
const scaleTests = new Set<string>([
  'integration/learner-library-projection',
  'integration/learning-history-page',
  'integration/runtime-learning-candidates',
  'integration/learning-material-pins',
  'integration/learning-management-query',
  'browser/retention-review-capacity',
  'integration/learning-runtime-query',
  'unit/direct-learning-choices',
  'integration/scoped-context-command',
  'unit/personal-learning-batch',
  'unit/world-readers',
  'integration/world-browse-storage',
  'browser/personal-meaning-journey',
  'integration/semantic-lookup-storage',
  'browser/semantic-lookup-opfs',
  'integration/semantic-lookup',
  'unit/portable-media-cache',
  'browser/portable-package-journey',
  'unit/package-workspace-refresh',
  'unit/package-cache-projection',
  'unit/book-center-projection',
  'database/database-budget', 'browser/sqlite-opfs-benchmark',
  'browser/web-bootstrap-budget', 'browser/package-center-journey', 'browser/portable-book-capacity', 'integration/content-agent',
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
  const kind = path.startsWith('unit/') ? 'unit' : path.startsWith('contracts/') ? 'contract' : path.startsWith('quality/') ? 'quality' : 'integration';
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
    ...(['browser/retention-review-capacity','browser/portable-book-capacity'].includes(path)?{browserDepth:'full' as const}:{}),
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
    id: 'operation-settlement',
    file: 'tests/web/unit/operation-settlement.test.ts',
    kind: 'unit',
    risks: ['local-correctness', 'durability'],
    environment: 'node',
    suite: 'fast',
    runner: 'vitest',
  },
  {
    id: 'learning-question',
    file: 'tests/web/integration/learning-question.test.mts',
    kind: 'integration',
    risks: ['local-correctness', 'durability'],
    environment: 'node',
    suite: 'fast',
    runner: 'vitest',
    memoryLibrary: true,
  },
  {
    id: 'model-disclosure-preflight',
    file: 'tests/web/integration/model-disclosure-preflight.test.mts',
    kind: 'integration',
    risks: ['local-correctness'],
    environment: 'node',
    suite: 'fast',
    runner: 'vitest',
  },
  {
    id: 'refresh-coordinator',
    file: 'tests/web/unit/refresh-coordinator.test.ts',
    kind: 'unit',
    risks: ['local-correctness', 'scale'],
    environment: 'node',
    suite: 'fast',
    runner: 'vitest',
  },
  {
    // Real shared reader: localization, disclosures, native media focus and iframe dismissal.
    id: 'resource-presentation',
    file: 'tests/web/browser/resource-presentation.spec.ts',
    kind: 'integration',
    risks: ['local-correctness'],
    environment: 'chromium',
    suite: 'browser',
    runner: 'playwright',
  },
  {
    id: 'live-business-language-matrix',
    file: 'tests/web/live/business-language-matrix.spec.ts',
    kind: 'integration',
    risks: ['local-correctness'],
    environment: 'chromium',
    suite: 'manual',
    runner: 'playwright',
  },
  {
    id: 'live-personal-language-matrix',
    file: 'tests/web/live/personal-language-matrix.spec.ts',
    kind: 'integration',
    risks: ['local-correctness'],
    environment: 'chromium',
    suite: 'manual',
    runner: 'playwright',
  },
  {
    id: 'live-extension-language-matrix',
    file: 'tests/web/live/extension-language-matrix.spec.ts',
    kind: 'integration',
    risks: ['local-correctness'],
    environment: 'chromium',
    suite: 'manual',
    runner: 'playwright',
  },
];
