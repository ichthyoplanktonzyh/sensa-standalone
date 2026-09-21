import assert from 'node:assert/strict';
import { buildSupportDiagnostics } from '../apps/web/src/support/supportDiagnosticsSchema.ts';
import { parseSupportUrl } from '../apps/web/src/support/supportUrl.ts';

const privateValues = ['learner@example.com', 'secret-token', 'https://private.example/path', 'record-private-id', 'private learning sentence'];
const report = buildSupportDiagnostics({
  createdAt: '2026-09-21T00:00:00.000Z',
  release: 'a'.repeat(40),
  online: true,
  offlineShell: 'ready',
  capabilities: { opfs: true, webLocks: true, broadcastChannel: true, worker: true, serviceWorker: true },
  library: { engine: 'sqlite-wasm', persistence: 'opfs', schemaVersion: 7, journalMode: 'wal', synchronous: 2, lockingMode: 'exclusive' },
  libraryError: new Error(privateValues[2]),
  persistence: 'persistent',
  budget: { usageBytes: 15_900_000, quotaBytes: 200_100_000 },
  sync: {
    owner: { subject: privateValues[0], accountId: privateValues[3] },
    incarnation: privateValues[1],
    base: [{ table: 'meanings', key: privateValues[3], value: privateValues[4] }],
    revision: 4,
    pending: { operationId: privateValues[1], baseRevision: 3, manifest: [privateValues[1]], entries: [{ table: 'meanings', key: privateValues[3], value: privateValues[4] }] },
    status: 'failed',
    error: privateValues[2],
    failureKind: 'terminal',
    retryCount: 5,
  },
  syncError: null,
});
const encoded = JSON.stringify(report);
for (const value of privateValues) assert(!encoded.includes(value), `diagnostics leaked ${value}`);
assert.deepEqual(Object.keys(report), ['format', 'createdAt', 'release', 'runtime', 'storage', 'sync']);
assert.deepEqual(Object.keys(report.sync), ['state', 'errorCode', 'failureKind', 'retryCount', 'pendingRecordCount', 'conflictRecordCount', 'affectedRecordCount', 'lastSyncedAt', 'lastCheckedAt']);
assert.equal(report.sync.errorCode, 'unclassified');
assert.equal(report.sync.pendingRecordCount, 1);
assert.equal(parseSupportUrl('mailto:support@example.com'), 'mailto:support@example.com');
assert.equal(parseSupportUrl('https://support.example.com/request?product=sensa'), 'https://support.example.com/request?product=sensa');
for (const unsafe of ['', 'mailto:no-at-sign', 'http://support.example.com', 'https://localhost/help', 'https://user:pass@support.example.com', 'https://support.example.com/#token']) assert.equal(parseSupportUrl(unsafe), null);
console.log('PASS: support diagnostics expose only the fixed state/count schema and support links reject unsafe release targets.');
