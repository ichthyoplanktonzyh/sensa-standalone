import test from 'node:test';

test('[quality][scale] production Web dependency closures stay inside bundle budgets', async () => {
  await import('../../../scripts/sensaWebBundleBudgetSmoke.mts');
});
