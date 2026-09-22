import test from 'node:test';

test('[integration][local-correctness][durability] Learning authority rejects invalid local commits atomically', async () => {
  const previousMemoryLibrary = process.env.SENSA_TEST_MEMORY_LIBRARY;
  process.env.SENSA_TEST_MEMORY_LIBRARY = 'true';
  try {
    await import('../../../scripts/sensaLearningAuthoritySmoke.mts');
  } finally {
    if (previousMemoryLibrary === undefined) delete process.env.SENSA_TEST_MEMORY_LIBRARY;
    else process.env.SENSA_TEST_MEMORY_LIBRARY = previousMemoryLibrary;
  }
});
