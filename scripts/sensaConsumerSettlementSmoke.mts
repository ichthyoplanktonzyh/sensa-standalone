import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { runConsumerSettlementVectors } from './support/consumerSettlementVectors.ts';

const expected = runConsumerSettlementVectors();
const bundle = await build({ entryPoints: ['scripts/support/consumerSettlementVectors.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'SettlementVectors' });
const browser = await chromium.launch({ headless: true, executablePath: process.env.SENSA_CHROMIUM_PATH });
try {
  const context = await browser.newContext({ offline: true });
  const page = await context.newPage();
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const actual = await page.evaluate(() => (globalThis as any).SettlementVectors.runConsumerSettlementVectors());
  assert.deepEqual(actual, expected);
  assert.equal(requests.length, 0);
  console.log('PASS: identical initial/review/relearning settlement in Node and offline Chromium; invalid triggers rejected; no network requests.');
} finally {
  await browser.close();
}
