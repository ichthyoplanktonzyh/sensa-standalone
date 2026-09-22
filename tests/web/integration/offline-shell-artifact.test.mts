import test from 'node:test';

test('[integration][durability] built offline shell preserves its cache and recovery contract', async () => {
  await import('../../../scripts/sensaOfflineShellSmoke.mts');
});
