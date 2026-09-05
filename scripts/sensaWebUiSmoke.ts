/** Reuse the accepted prototype scenarios against the migrated Web modules. */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scenarios = [
  'router/shellLocationSmoke.ts',
  'learningJourney/journeySmoke.ts',
  'learningJourney/learningHistorySmoke.ts',
  'learningRuntime/lightweightInitialProtocolSmoke.ts',
  'learningRuntime/retentionStoresSmoke.ts',
  'personalMeaningJourney/journeySmoke.ts',
  'personalMeaningJourney/intakeSmoke.ts',
  'learningRuntime/runtimeSessionSmoke.ts',
  'planning/dailyInitialPlannerSmoke.ts',
];
for (const scenario of scenarios) {
  const source = resolve(root, 'apps/web-next/src', scenario);
  const target = resolve(root, 'apps/web/src/experience', scenario.replace(/Smoke\.ts$/, '.web-verification.ts'));
  writeFileSync(target, readFileSync(source, 'utf8'));
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', target], {
      cwd: root, stdio: 'inherit', env: { ...process.env, TSX_TSCONFIG_PATH: resolve(root, 'apps/web/tsconfig.json') },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Web behavior verification failed: ${scenario}`);
  } finally { unlinkSync(target); }
}
console.log(`Web UI behavior: ${scenarios.length} accepted scenario suites passed; no provider calls.`);
