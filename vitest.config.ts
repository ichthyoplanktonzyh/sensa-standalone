import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/web/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage/web',
      include: ['apps/web/src/learning/system/learningProjection.ts'],
    },
  },
});
