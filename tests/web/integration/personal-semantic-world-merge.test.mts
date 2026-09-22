import test from 'node:test';

test('[integration][local-correctness][convergence] Personal Semantic World replicas preserve domain merge rules', async () => {
  await import('../../../scripts/sensaPersonalSemanticWorldMergeSmoke.mts');
});
