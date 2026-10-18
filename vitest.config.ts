import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    isolate: true,
    maxWorkers: 1,
    include: ['tests/web/**/*.test.{ts,tsx,mts,mjs}'],
    environment: 'node',
    testTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage/web',
      include: ['apps/web/src/learning/system/learningProjection.ts'],
    },
  },
});
