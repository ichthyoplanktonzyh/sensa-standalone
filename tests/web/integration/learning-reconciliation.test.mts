import test from 'node:test';

test('[integration][local-correctness][convergence] Learning preserves immutable histories and reconciles projections', async () => {
  await import('../../../scripts/sensaLearningReconciliationSmoke.mts');
});
