import test from 'node:test';

test('[contract][local-correctness] Content Supply admits only its own transitions', async () => {
  await import('../../../scripts/sensaContentSupplyAuthoritySmoke.mts');
});
