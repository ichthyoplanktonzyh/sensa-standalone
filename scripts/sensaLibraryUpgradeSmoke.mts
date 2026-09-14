/** SQLite storage kernel: typed values, transactions and operation replay. */
import assert from 'node:assert/strict';

Object.assign(globalThis, { window: new EventTarget(), BroadcastChannel: undefined });

const store = await import('../apps/web/src/data/library/store.ts');
const identity = await store.openLibrary();
assert.equal(identity.schemaVersion, 1);

const operationId = crypto.randomUUID();
const result = await store.command(
  { id: operationId, kind: 'fixture.sqlite', input: { revision: 1 } },
  async (tx) => {
    tx.put('drafts', 'typed', {
      createdAt: new Date('2026-09-14T00:00:00.000Z'),
      optional: undefined,
    });
    return { committed: true };
  },
);
assert.deepEqual(result, { committed: true });
const typed = await store.readLibrary((tx) => tx.get<any>('drafts', 'typed'));
assert(typed.createdAt instanceof Date);
assert.equal(typed.createdAt.toISOString(), '2026-09-14T00:00:00.000Z');
assert.equal('optional' in typed, true);
assert.equal(typed.optional, undefined);

const replayed = await store.command(
  { id: operationId, kind: 'fixture.sqlite', input: { revision: 1 } },
  async () => ({ committed: false }),
);
assert.deepEqual(replayed, result);
await assert.rejects(
  store.command(
    { id: operationId, kind: 'fixture.sqlite', input: { revision: 2 } },
    async () => ({ committed: false }),
  ),
  /operationConflict/,
);

await assert.rejects(
  store.restoreLibraryTransaction(async (tx) => {
    tx.put('drafts', 'rolled-back', { text: 'must not survive' });
    throw new Error('fixture abort');
  }),
  /fixture abort/,
);
assert.equal(await store.readLibrary((tx) => tx.get('drafts', 'rolled-back')), undefined);

const diagnostics = await store.readLibraryStorageDiagnostics();
assert.deepEqual(
  { engine: diagnostics.engine, persistence: diagnostics.persistence, schemaVersion: diagnostics.schemaVersion },
  { engine: 'memory-adapter', persistence: 'memory', schemaVersion: 1 },
);

const [{ default: sqlite3InitModule }, { SqliteRecordDatabase }] = await Promise.all([
  import('@sqlite.org/sqlite-wasm'),
  import('../apps/web/src/data/library/sqliteDatabase.ts'),
]);
const sqlite3 = await sqlite3InitModule();
const database = new SqliteRecordDatabase(
  sqlite3,
  new sqlite3.oo1.DB(':memory:', 'c'),
  'memory',
);
database.initialize();
database.commit({
  clears: [],
  deletes: [],
  puts: [{ table: 'semanticWorld', key: 'journey', encodedValue: '{"version":1}' }],
});
assert.equal(database.get('semanticWorld', 'journey'), '{"version":1}');
assert.match(database.diagnostics().sqliteVersion, /^3\./u);
database.close();

console.log('PASS: the library adapter preserves typed values, commits atomically, replays exact operations and rejects conflicts; the SQLite WASM kernel validates and stores the semantic-world row. Browser OPFS is checked separately.');
