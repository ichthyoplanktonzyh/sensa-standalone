import test from 'node:test';

test('[integration][local-correctness][durability] Personal Content commits through its system interface', async () => {
  const previousMemoryLibrary = process.env.SENSA_TEST_MEMORY_LIBRARY;
  process.env.SENSA_TEST_MEMORY_LIBRARY = 'true';
  try {
    await import('../../../scripts/sensaPersonalContentSystemSmoke.mts');
  } finally {
    if (previousMemoryLibrary === undefined) delete process.env.SENSA_TEST_MEMORY_LIBRARY;
    else process.env.SENSA_TEST_MEMORY_LIBRARY = previousMemoryLibrary;
  }
});
