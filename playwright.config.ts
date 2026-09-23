import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  // CI uploads failed traces; specs here must use synthetic, non-sensitive data.
  testDir: 'tests/web',
  testMatch: '**/*.spec.ts',
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: process.env.SENSA_PLAYWRIGHT_OUTPUT_DIR ?? '.tmp/playwright-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.SENSA_CHROMIUM_PATH,
    },
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
});
