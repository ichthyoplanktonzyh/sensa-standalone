/** SQLite storage kernel: typed values, transactions and operation replay. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {afterAll,test} from 'vitest';

Object.assign(globalThis, { window: new EventTarget(), BroadcastChannel: undefined });

test('memory adapter preserves typed values, idempotent operations and rollback', async () => {
const store = await import('../../../apps/web/src/data/library/store.ts');
const identity = await store.openLibrary();
assert.equal(identity.schemaVersion, 2);

await store.restoreLibraryTransaction(async tx=>tx.delete('operations','00000000-0000-4000-8000-000000000001'));
assert.deepEqual(await store.openLibrary(),identity,'a lost create receipt must never replace an existing library identity');
assert.deepEqual((await store.readLibrary(tx=>tx.get<any>('operations','00000000-0000-4000-8000-000000000001')))?.result,identity);

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

const probeRevision=await store.readLibrary(store.readLocalLibraryRevision);
assert.equal(await store.readLibrary(tx=>tx.hasChangesSince(probeRevision,['drafts'])),false);
await store.restoreLibraryTransaction(async tx=>{
  tx.put('drafts','revision-probe',{text:'no payload required for invalidation'});
  await assert.rejects(tx.hasChangesSince(probeRevision,['drafts']),/library_changes_require_snapshot/u);
  await assert.rejects(tx.entryBatches('drafts').next(),/library_entries_require_snapshot/u);
});
assert.equal(await store.readLibrary(tx=>tx.hasChangesSince(probeRevision,['drafts'])),true);
assert.equal(await store.readLibrary(tx=>tx.hasChangesSince(probeRevision,['semanticMeanings'])),false);
const deletionRevision=await store.readLibrary(store.readLocalLibraryRevision);
await store.restoreLibraryTransaction(async tx=>{tx.delete('drafts','revision-probe');});
assert.equal(await store.readLibrary(tx=>tx.hasChangesSince(deletionRevision,['drafts'])),true,'deleted rows must invalidate through tombstones');

const stopped=crypto.randomUUID(),cancel=new AbortController();
await assert.rejects(store.command({id:stopped,kind:'fixture.cancel-before-commit',input:{}},async tx=>{
  tx.requireCommitSignal(cancel.signal,'library_transaction_cancelled',()=>assert.fail('aborted work must not reach commit'));
  tx.put('drafts','stopped-before-commit',{text:'must not survive'});
  cancel.abort();
}),/library_transaction_cancelled/u);
assert.equal(await store.readLibrary(tx=>tx.get('drafts','stopped-before-commit')),undefined);
assert.equal(await store.readLibrary(tx=>tx.get('operations',stopped)),undefined,'a cancelled commit has no replay receipt');

const committing=crypto.randomUUID(),commitCancel=new AbortController(),phases:string[]=[];
const committed=await store.command({id:committing,kind:'fixture.cancel-after-commit-start',input:{}},async tx=>{
  tx.requireCommitSignal(commitCancel.signal,'library_transaction_cancelled',()=>{
    phases.push('committing');
    commitCancel.abort();
  });
  tx.put('drafts','commit-started',{text:'atomic commit has started'});
  return {committed:true};
});
assert.deepEqual(phases,['committing']);
assert.deepEqual(committed,{committed:true});
assert.equal((await store.readLibrary(tx=>tx.get<any>('drafts','commit-started')))?.text,'atomic commit has started');
const commitReceipt=await store.readLibrary(tx=>tx.get<any>('operations',committing));
assert.deepEqual(commitReceipt?.result,{committed:true});
assert.equal(typeof commitReceipt?.committedAt,'string');
assert.deepEqual(await store.command({id:committing,kind:'fixture.cancel-after-commit-start',input:{}},async()=>{
  assert.fail('a committed operation must replay its receipt instead of repeating work');
}),{committed:true});

const yielding=crypto.randomUUID(),yieldCancel=new AbortController();
let yieldReachedCommit=false;
const previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
Object.defineProperty(globalThis,'document',{configurable:true,value:{}});
try{
  await assert.rejects(store.command({id:yielding,kind:'fixture.cancel-during-mutation-yield',input:{}},async tx=>{
    tx.requireCommitSignal(yieldCancel.signal,'library_transaction_cancelled',()=>{yieldReachedCommit=true;});
    for(let index=0;index<8;index++)tx.put('drafts',`yield-batch-${index}`,{index});
    // If encoding continues after the scheduled yield, this unsupported value
    // would fail before the final signal guard and mask the expected cancel.
    tx.put('drafts','yield-batch-unsupported',{value:new Map([['x',1]])});
    for(let index=9;index<24;index++)tx.put('drafts',`yield-batch-${index}`,{index});
    setTimeout(()=>yieldCancel.abort(),0);
    return {committed:false};
  }),/library_transaction_cancelled/u);
}finally{
  if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);
  else Reflect.deleteProperty(globalThis,'document');
}
assert.equal(yieldReachedCommit,false,'cancellation while yielding must stop before the commit phase');
assert.equal(await store.readLibrary(tx=>tx.get('drafts','yield-batch-0')),undefined);
assert.equal(await store.readLibrary(tx=>tx.get('operations',yielding)),undefined,'a cancelled mutation has no replay receipt');

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
  { engine: 'memory-adapter', persistence: 'memory', schemaVersion: 13 },
);
});

const [{ default: sqlite3InitModule }, { SqliteRecordDatabase, sqliteHomeLearningTargetsQuery }, { encodeBackupValue }, { sqliteLibrarySchema }] = await Promise.all([
  import('@sqlite.org/sqlite-wasm'),
  import('../../../apps/web/src/data/library/sqliteDatabase.ts'),
  import('../../../apps/web/src/data/library/backupCodec.ts'),
  import('../../../apps/web/src/data/library/sqliteProtocol.ts'),
]);
const sqlite3 = await sqlite3InitModule();
test('unsupported physical schemas preserve owner data', () => {
for (const version of [9, 14]) {
  const incompatibleRaw = new sqlite3.oo1.DB(':memory:', 'c');
  incompatibleRaw.exec(`CREATE TABLE owner_fixture(value TEXT); INSERT INTO owner_fixture VALUES('preserve-me'); PRAGMA user_version=${version}`);
  const incompatibleDatabase = new SqliteRecordDatabase(sqlite3, incompatibleRaw, 'memory');
  assert.throws(
    () => incompatibleDatabase.initialize(),
    version < 10 ? /sqlite_schema_legacy:9/u : /sqlite_schema_future:14/u,
    'unsupported physical schemas must stop instead of opening an empty replacement',
  );
  const preserved = incompatibleRaw.exec({ sql: 'SELECT value FROM owner_fixture', rowMode: 0, returnValue: 'resultRows' }) as unknown[];
  assert.deepEqual(preserved, ['preserve-me'], 'a failed version check must leave the original database intact');
  incompatibleDatabase.close();
}
});
test('schema 10 migrates in place and preserves owner tables',()=>{
  const migratedRaw=new sqlite3.oo1.DB(':memory:','c');
  migratedRaw.exec(`CREATE TABLE owner_fixture(value TEXT);
                    INSERT INTO owner_fixture VALUES('preserve-me');
                    PRAGMA user_version=10`);
  const migrated=new SqliteRecordDatabase(sqlite3,migratedRaw,'memory');
  assert.equal(migrated.initialize().schemaVersion,13);
  const preserved=migratedRaw.exec({
    sql:'SELECT value FROM owner_fixture',rowMode:0,returnValue:'resultRows',
  }) as unknown[];
  assert.deepEqual(preserved,['preserve-me']);
  assert.equal(migrated.portableMediaDiagnostics().blobCount,0);
  migrated.close();
});
test('SQLite initialization maintains query planner statistics', () => {
const optimizerRawDatabase = new sqlite3.oo1.DB(':memory:', 'c');
const optimizerDatabase = new SqliteRecordDatabase(sqlite3, optimizerRawDatabase, 'memory');
optimizerRawDatabase.exec(sqliteLibrarySchema);
optimizerRawDatabase.exec("INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('drafts','optimizer-fixture','{}')");
optimizerDatabase.initialize();
const plannerStatistics = optimizerRawDatabase.exec({
  sql: "SELECT COUNT(*) FROM sqlite_stat1",
  rowMode: 0,
  returnValue: 'resultRows',
}) as unknown[];
assert(Number(plannerStatistics[0] ?? 0) > 0, 'initialize must maintain SQLite planner statistics');
optimizerDatabase.close();
});

const rawDatabase = new sqlite3.oo1.DB(':memory:', 'c');
const database = new SqliteRecordDatabase(
  sqlite3,
  rawDatabase,
  'memory',
);
database.initialize();
test('record journals, sync base replacement and logical table constraints', () => {
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
    { table: 'semanticState', key: 'root', encodedValue: '{"version":"sensa-personal-meaning-journey-store-v5"}' },
    { table: 'media', key: crypto.randomUUID(), encodedValue: '{"mediaKind":"image"}' },
  ],
});
assert.equal(database.get('semanticState', 'root'), '{"version":"sensa-personal-meaning-journey-store-v5"}');
database.commit({
  contentRevision: 1,
  clears: [],
  deletes: [],
  puts: [
    { table: 'drafts', key: 'changed-a', encodedValue: '{"revision":1}' },
    { table: 'drafts', key: 'changed-b', encodedValue: '{"revision":1}' },
  ],
});
database.commit({
  contentRevision: 2,
  clears: [],
  deletes: [{ table: 'drafts', key: 'changed-a' }],
  puts: [
    { table: 'drafts', key: 'changed-b', encodedValue: '{"revision":2}' },
    { table: 'drafts', key: 'changed-c', encodedValue: '{"revision":1}' },
  ],
});
assert.deepEqual(database.changesSince(1, ['drafts']), [
  { table: 'drafts', key: 'changed-a', encodedValue: null, contentRevision: 2 },
  { table: 'drafts', key: 'changed-b', encodedValue: '{"revision":2}', contentRevision: 2 },
  { table: 'drafts', key: 'changed-c', encodedValue: '{"revision":1}', contentRevision: 2 },
]);
assert.deepEqual(database.changesSince(2, ['drafts']), []);
assert.equal(database.hasChangesSince(1,['drafts']),true);
assert.equal(database.hasChangesSince(2,['drafts']),false);
assert.equal(database.hasChangesSince(0,['semanticMeanings']),false);
assert.equal(database.hasChangesSince(1,[]),false);
assert.equal(database.hasChangesSince(-1,['drafts']),false);
database.commit({contentRevision:3,clears:[],deletes:[{table:'drafts',key:'changed-c'}],puts:[]});
assert.equal(database.hasChangesSince(2,['drafts']),true,'tombstone-only changes are not an unchanged snapshot');
assert.deepEqual(database.entriesPage('drafts',null,1),[database.entries('drafts')[0]]);
assert.deepEqual(database.entriesPage('drafts','changed-b',1),[]);
assert.throws(()=>database.entriesPage('drafts',null,0),/sqlite_invalid_page_size/u);
assert.throws(()=>database.entriesPage('drafts',null,257),/sqlite_invalid_page_size/u);
database.commit({
  clears: [],
  deletes: [],
  puts: [],
  syncBaseReplacement: [
    { table: 'drafts', key: 'changed-b', valueJson: '{"revision":2}', blockRefs: ['a'.repeat(64)] },
    { table: 'meta', key: 'identity', valueJson: '{"id":"fixture"}', blockRefs: ['b'.repeat(64)] },
  ],
});
assert.deepEqual(database.syncBaseEntries(), [
  { table: 'drafts', key: 'changed-b', valueJson: '{"revision":2}', blockRefs: ['a'.repeat(64)] },
  { table: 'meta', key: 'identity', valueJson: '{"id":"fixture"}', blockRefs: ['b'.repeat(64)] },
]);
assert.deepEqual(database.syncBaseEntries([{ table: 'drafts', key: 'changed-b' }]), [
  { table: 'drafts', key: 'changed-b', valueJson: '{"revision":2}', blockRefs: ['a'.repeat(64)] },
]);
database.commit({ clears: [], deletes: [], puts: [], syncBaseReplacement: [] });
assert.deepEqual(database.syncBaseEntries(), []);
assert.throws(() => database.commit({
  clears: [],
  deletes: [],
  puts: [{ table: 'semanticWorld', key: 'journey', encodedValue: '{}' }],
} as any), /CHECK constraint failed|constraint failed/iu);
});

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
test('home projection uses route and date indexes without scanning targets', () => {
database.commit({
  clears: [],
  deletes: [],
  puts: [
    { table: 'packageCache', key: 'package-a', encodedValue: encoded({ key: 'package-a' }) },
    { table: 'packageCache', key: 'package-b', encodedValue: encoded({ key: 'package-b' }) },
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
});
test('learning, content and media indexes update with commits and deletes', () => {
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
});
test('portable media rows deduplicate by digest and collect after the last package reference',()=>{
  const bytes=new TextEncoder().encode('shared portable sqlite media');
  const digest=createHash('sha256').update(bytes).digest('hex');
  const portable=(packageKey:string)=>({
    packageKey,
    media:[{mediaId:'pronunciation',sha256:digest,mimeType:'audio/mpeg',kind:'audio' as const,sizeBytes:bytes.byteLength,bytes}],
  });
  database.commit({
    clears:[],deletes:[],
    puts:[
      {table:'packageCache',key:'portable-a',encodedValue:encoded({})},
      {table:'packageCache',key:'portable-b',encodedValue:encoded({})},
    ],
    portablePackages:[portable('portable-a'),portable('portable-b')],
  });
  assert.deepEqual(database.portableMediaDiagnostics(),{
    blobCount:1,totalBytes:bytes.byteLength,referenceCount:2,
  });
  assert.deepEqual(database.portableMedia(digest)?.bytes,bytes);
  database.commit({clears:[],deletes:[{table:'packageCache',key:'portable-a'}],puts:[]});
  assert.deepEqual(database.portableMediaDiagnostics(),{
    blobCount:1,totalBytes:bytes.byteLength,referenceCount:1,
  });
  database.commit({clears:[],deletes:[{table:'packageCache',key:'portable-b'}],puts:[]});
  assert.deepEqual(database.portableMediaDiagnostics(),{
    blobCount:0,totalBytes:0,referenceCount:0,
  });
});
afterAll(()=>database.close());
