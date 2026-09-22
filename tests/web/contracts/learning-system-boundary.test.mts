import test from 'node:test';

test('[contract][local-correctness] application code uses the Learning System boundary', async () => {
  await import('../../../scripts/sensaLearningSystemBoundarySmoke.mts');
});
