/** SQLite storage kernel: typed values, transactions and operation replay. */
import assert from 'node:assert/strict';

Object.assign(globalThis, { window: new EventTarget(), BroadcastChannel: undefined });

const store = await import('../apps/web/src/data/library/store.ts');
const identity = await store.openLibrary();
assert.equal(identity.schemaVersion, 2);

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
  { engine: 'memory-adapter', persistence: 'memory', schemaVersion: 4 },
);

const [{ default: sqlite3InitModule }, { SqliteRecordDatabase, sqliteHomeLearningTargetsQuery }, { encodeBackupValue }, { sqliteLibrarySchema }] = await Promise.all([
  import('@sqlite.org/sqlite-wasm'),
  import('../apps/web/src/data/library/sqliteDatabase.ts'),
  import('../apps/web/src/data/library/backupCodec.ts'),
  import('../apps/web/src/data/library/sqliteProtocol.ts'),
]);
const sqlite3 = await sqlite3InitModule();
const optimizerRawDatabase = new sqlite3.oo1.DB(':memory:', 'c');
optimizerRawDatabase.exec(sqliteLibrarySchema);
optimizerRawDatabase.exec("INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('drafts','optimizer-fixture','{}')");
const optimizerDatabase = new SqliteRecordDatabase(sqlite3, optimizerRawDatabase, 'memory');
optimizerDatabase.initialize();
const plannerStatistics = optimizerRawDatabase.exec({
  sql: "SELECT COUNT(*) FROM sqlite_stat1",
  rowMode: 0,
  returnValue: 'resultRows',
}) as unknown[];
assert(Number(plannerStatistics[0] ?? 0) > 0, 'initialize must maintain SQLite planner statistics');
optimizerDatabase.close();

const rawDatabase = new sqlite3.oo1.DB(':memory:', 'c');
const database = new SqliteRecordDatabase(
  sqlite3,
  rawDatabase,
  'memory',
);
database.initialize();
database.commit({
  clears: [],
  deletes: [],
  puts: [
    { table: 'semanticState', key: 'root', encodedValue: '{"version":"sensa-personal-meaning-journey-store-v4"}' },
    { table: 'media', key: crypto.randomUUID(), encodedValue: '{"mediaKind":"image"}' },
  ],
});
assert.equal(database.get('semanticState', 'root'), '{"version":"sensa-personal-meaning-journey-store-v4"}');
assert.throws(() => database.commit({
  clears: [],
  deletes: [],
  puts: [{ table: 'semanticWorld', key: 'journey', encodedValue: '{}' }],
} as any), /CHECK constraint failed|constraint failed/iu);

const encoded = (value: unknown) => JSON.stringify(encodeBackupValue(value));
const target = (id: string, route: string, packageKey: string) => ({
  id,
  curriculumMemberships: [{
    id: `${id}-membership`,
    languageContext: {
      languageRouteId: route,
      languageRouteRevision: 1,
      targetLanguageTag: 'en',
      supportLanguageTag: 'zh',
    },
    packageKey,
    material: { snapshot: { validationStatus: 'validated' } },
  }],
  policyAssignment: { profileId: 'lightweight' },
  committedPolicy: null,
  planningOverrides: [],
  introducedLanguageRouteId: null,
  startedAt: null,
  completedAt: null,
  memory: { dueAt: new Date('2026-09-14T00:00:00.000Z') },
  relearnAt: null,
});
database.commit({
  clears: [],
  deletes: [],
  puts: [
    { table: 'packages', key: 'package-a', encodedValue: encoded({ key: 'package-a' }) },
    { table: 'packages', key: 'package-b', encodedValue: encoded({ key: 'package-b' }) },
    { table: 'learningTargets', key: 'target-a', encodedValue: encoded(target('target-a', 'route-a', 'package-a')) },
    { table: 'learningTargets', key: 'target-b', encodedValue: encoded(target('target-b', 'route-b', 'package-b')) },
  ],
});
assert.equal(database.count('learningTargets'), 2);
const projectionPlan = rawDatabase.exec({
  sql: `EXPLAIN QUERY PLAN ${sqliteHomeLearningTargetsQuery}`,
  bind: ['route-a', 'route-a', '2026-09-14T00:00:00.000Z', '2026-09-15T00:00:00.000Z'],
  rowMode: 'object',
  returnValue: 'resultRows',
}) as Array<Record<string, unknown>>;
const projectionPlanDetails = projectionPlan.map((row) => String(row.detail));
assert(
  projectionPlanDetails.some((detail) => detail.includes('SEARCH route USING PRIMARY KEY')),
  `route branch must use the route index: ${projectionPlanDetails.join(' | ')}`,
);
assert(
  projectionPlanDetails.some((detail) => detail.includes('SEARCH target USING INDEX sensa_learning_targets_introduced')),
  `introduced branch must use the date index: ${projectionPlanDetails.join(' | ')}`,
);
assert(
  !projectionPlanDetails.some((detail) => /^SCAN target\b/u.test(detail)),
  `home projection must not scan every target: ${projectionPlanDetails.join(' | ')}`,
);
const routeA = database.homeLearningProjection('route-a');
assert.deepEqual(routeA.targets.map((entry) => entry.id), ['target-a']);
assert.deepEqual(routeA.availablePackageKeys, ['package-a']);
assert(routeA.targets[0]?.memory?.dueAt instanceof Date);
database.commit({
  clears: [],
  deletes: [{ table: 'learningTargets', key: 'target-b' }],
  puts: [{
    table: 'learningTargets',
    key: 'target-a',
    encodedValue: encoded({
      ...target('target-a', 'route-a', 'package-a'),
      curriculumMemberships: [{
        ...target('target-a', 'route-a', 'package-a').curriculumMemberships[0],
        status: 'superseded',
      }],
    }),
  }],
});
assert.equal(database.count('learningTargets'), 1);
assert.deepEqual(database.homeLearningProjection('route-a').targets, []);
assert.match(database.diagnostics().sqliteVersion, /^3\./u);
database.close();

console.log('PASS: Library records preserve typed values and atomic replay; SQLite schema v4 maintains planner statistics, indexed learning projections, native counts and logical-table constraints. Browser OPFS is checked separately.');
