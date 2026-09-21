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

await store.restoreLibraryTransaction(async (tx) => {
  tx.put('learningTargets', 'indexed-target', {
    introducedLanguageRouteId: 'indexed-route',
    startedAt: '2026-09-14T08:00:00.000Z',
  });
  tx.put('learningRuns', 'indexed-run', {
    id: 'indexed-run',
    targetIds: ['indexed-target'],
    completedAt: null,
  });
  tx.put('contentAttempts', 'indexed-attempt', {
    id: 'indexed-attempt',
    taskId: 'indexed-task',
    createdAt: '2026-09-14T09:00:00.000Z',
  });
  assert.deepEqual(await tx.learningRunIdsForTarget('indexed-target', { openOnly: true }), ['indexed-run']);
  assert.deepEqual(await tx.openLearningTargetIds(), ['indexed-target']);
  assert.equal(await tx.countIntroducedLearningTargets(
    'indexed-route',
    '2026-09-14T00:00:00.000Z',
    '2026-09-15T00:00:00.000Z',
  ), 1);
  assert.equal(await tx.countContentAttemptsSince('indexed-task', '2026-09-14T00:00:00.000Z'), 1);
});
await store.readLibrary(async (tx) => {
  assert.deepEqual(await tx.learningRunIdsForTarget('indexed-target', { openOnly: true }), ['indexed-run']);
  assert.deepEqual(await tx.openLearningTargetIds(), ['indexed-target']);
  assert.equal(await tx.countContentAttemptsSince('indexed-task', '2026-09-14T00:00:00.000Z'), 1);
});

const diagnostics = await store.readLibraryStorageDiagnostics();
assert.deepEqual(
  { engine: diagnostics.engine, persistence: diagnostics.persistence, schemaVersion: diagnostics.schemaVersion },
  { engine: 'memory-adapter', persistence: 'memory', schemaVersion: 7 },
);

const [{ default: sqlite3InitModule }, { SqliteRecordDatabase, sqliteHomeLearningTargetsQuery }, { encodeBackupValue }, { sqliteLibrarySchema }] = await Promise.all([
  import('@sqlite.org/sqlite-wasm'),
  import('../apps/web/src/data/library/sqliteDatabase.ts'),
  import('../apps/web/src/data/library/backupCodec.ts'),
  import('../apps/web/src/data/library/sqliteProtocol.ts'),
]);
const sqlite3 = await sqlite3InitModule();
for (const version of [6, 8]) {
  const incompatibleRaw = new sqlite3.oo1.DB(':memory:', 'c');
  incompatibleRaw.exec(`CREATE TABLE owner_fixture(value TEXT); INSERT INTO owner_fixture VALUES('preserve-me'); PRAGMA user_version=${version}`);
  const incompatibleDatabase = new SqliteRecordDatabase(sqlite3, incompatibleRaw, 'memory');
  assert.throws(
    () => incompatibleDatabase.initialize(),
    version < 7 ? /sqlite_schema_legacy:6/u : /sqlite_schema_future:8/u,
    'unsupported physical schemas must stop instead of opening an empty replacement',
  );
  const preserved = incompatibleRaw.exec({ sql: 'SELECT value FROM owner_fixture', rowMode: 0, returnValue: 'resultRows' }) as unknown[];
  assert.deepEqual(preserved, ['preserve-me'], 'a failed version check must leave the original database intact');
  incompatibleDatabase.close();
}
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
const tableLayouts = rawDatabase.exec({
  sql: `SELECT name,wr FROM pragma_table_list
        WHERE name IN ('sensa_records','sensa_learning_targets','sensa_learning_run_targets')`,
  rowMode: 'object',
  returnValue: 'resultRows',
}) as Array<Record<string, unknown>>;
const withoutRowId = new Map(tableLayouts.map((row) => [String(row.name), Number(row.wr)]));
assert.equal(withoutRowId.get('sensa_records'), 0, 'large logical JSON records belong in a rowid table');
assert.equal(withoutRowId.get('sensa_learning_targets'), 0, 'large Target projections belong in a rowid table');
assert.equal(withoutRowId.get('sensa_learning_run_targets'), 1, 'small relationship rows retain clustered composite keys');
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
    sourceKind: 'sense_learning_package',
    provenance: { bookId: 'book-a', bookVersionId: packageKey },
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
assert.equal(database.countIntroducedLearningTargets(
  'route-a',
  '2026-09-14T00:00:00.000Z',
  '2026-09-15T00:00:00.000Z',
), 0);
database.commit({
  clears: [],
  deletes: [],
  puts: [
    { table: 'learningRuns', key: 'run-complete', encodedValue: encoded({ id: 'run-complete', targetIds: ['target-a'], completedAt: '2026-09-13T12:00:00.000Z' }) },
    { table: 'learningRuns', key: 'run-open', encodedValue: encoded({ id: 'run-open', targetIds: ['target-a', 'target-b'], completedAt: null }) },
    { table: 'contentAttempts', key: 'attempt-old', encodedValue: encoded({ id: 'attempt-old', taskId: 'task-a', createdAt: '2026-09-13T12:00:00.000Z', status: 'failed' }) },
    { table: 'contentAttempts', key: 'attempt-recent', encodedValue: encoded({ id: 'attempt-recent', taskId: 'task-a', createdAt: '2026-09-14T12:00:00.000Z', status: 'ready' }) },
    { table: 'contentAttempts', key: 'attempt-other', encodedValue: encoded({ id: 'attempt-other', taskId: 'task-b', createdAt: '2026-09-14T12:00:00.000Z', status: 'ready' }) },
    { table: 'semanticMeanings', key: 'meaning-media', encodedValue: encoded({ personalSemanticAnchorRevisions: [{ personalMediaObjectId: 'media-a' }, { personalMediaObjectId: 'media-a' }] }) },
    { table: 'semanticInbox', key: 'inbox-media', encodedValue: encoded({ payload: { context: { mediaReferenceIds: ['media-b'] } } }) },
  ],
});
assert.deepEqual(database.learningRunIdsForTarget('target-a', false), ['run-complete', 'run-open']);
assert.deepEqual(database.learningRunIdsForTarget('target-a', true), ['run-open']);
assert.deepEqual(database.openLearningRunTargets(), [
  { runId: 'run-open', targetId: 'target-a' },
  { runId: 'run-open', targetId: 'target-b' },
]);
assert.equal(database.countContentAttemptsSince('task-a', '2026-09-14T00:00:00.000Z'), 1);
assert.deepEqual(database.learningTargetIdsForBookUpgrade('route-a', 'en', 'zh', 'book-a', 'package-next'), ['target-a']);
assert.equal(database.isMediaReferenced('media-a'), true);
assert.equal(database.isMediaReferenced('media-b'), true);
assert.equal(database.isMediaReferenced('media-free'), false);
const indexedQueryPlans = [
  {
    sql: `EXPLAIN QUERY PLAN SELECT run_key FROM sensa_learning_run_targets
          WHERE target_key=? AND completed_at IS NULL ORDER BY run_key`,
    bind: ['target-a'],
    expected: 'SEARCH sensa_learning_run_targets USING',
  },
  {
    sql: `EXPLAIN QUERY PLAN SELECT COUNT(*) FROM sensa_content_attempts
          WHERE task_id=? AND created_at>?`,
    bind: ['task-a', '2026-09-14T00:00:00.000Z'],
    expected: 'sensa_content_attempts_task_created',
  },
  {
    sql: `EXPLAIN QUERY PLAN SELECT COUNT(*) FROM sensa_learning_targets
          WHERE introduced_language_route_id=? AND started_at>=? AND started_at<?`,
    bind: ['route-a', '2026-09-14T00:00:00.000Z', '2026-09-15T00:00:00.000Z'],
    expected: 'sensa_learning_targets_introduced',
  },
  {
    sql: `EXPLAIN QUERY PLAN SELECT DISTINCT target_key FROM sensa_learning_route_targets
          WHERE language_route_id=? AND source_kind='sense_learning_package'
            AND target_language_tag=? AND support_language_tag=?
            AND book_id=? AND book_version_id<>? ORDER BY target_key`,
    bind: ['route-a', 'en', 'zh', 'book-a', 'package-next'],
    expected: 'SEARCH sensa_learning_route_targets USING',
  },
  {
    sql: 'EXPLAIN QUERY PLAN SELECT EXISTS(SELECT 1 FROM sensa_media_references WHERE media_id=?)',
    bind: ['media-a'],
    expected: 'SEARCH sensa_media_references USING PRIMARY KEY',
  },
];
for (const plan of indexedQueryPlans) {
  const details = (rawDatabase.exec({
    sql: plan.sql,
    bind: plan.bind,
    rowMode: 'object',
    returnValue: 'resultRows',
  }) as Array<Record<string, unknown>>).map((row) => String(row.detail));
  assert(
    details.some((detail) => detail.includes(plan.expected)),
    `${plan.expected} must serve its domain query: ${details.join(' | ')}`,
  );
}
database.commit({
  clears: [],
  deletes: [{ table: 'learningRuns', key: 'run-complete' }],
  puts: [{
    table: 'learningRuns',
    key: 'run-open',
    encodedValue: encoded({ id: 'run-open', targetIds: ['target-a', 'target-b'], completedAt: '2026-09-14T13:00:00.000Z' }),
  }],
});
assert.deepEqual(database.learningRunIdsForTarget('target-a', false), ['run-open']);
assert.deepEqual(database.openLearningRunTargets(), []);
database.commit({
  clears: [],
  deletes: [{ table: 'semanticInbox', key: 'inbox-media' }],
  puts: [{ table: 'semanticMeanings', key: 'meaning-media', encodedValue: encoded({ personalSemanticAnchorRevisions: [] }) }],
});
assert.equal(database.isMediaReferenced('media-a'), false);
assert.equal(database.isMediaReferenced('media-b'), false);
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

console.log('PASS: Library records preserve typed values and atomic replay; SQLite schema v7 uses rowid for large JSON plus compact indexed relationship projections, planner statistics, native counts and logical-table constraints. Browser OPFS is checked separately.');
