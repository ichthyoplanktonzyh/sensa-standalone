import test from 'node:test';

test('[contract][local-correctness] learner projection stays read-only and outside storage ownership', async () => {
  await import('../../../scripts/sensaLearnerProjectionBoundarySmoke.mts');
});
