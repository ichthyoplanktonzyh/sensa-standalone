import type {
  HomeLearningStorageProjection,
  SqliteLibraryTable,
  SqliteMutation,
  SqliteStorageDiagnostics,
  SqliteWorkerInput,
  SqliteWorkerRequest,
  SqliteWorkerResult,
} from "./sqliteProtocol";
import {sqliteLibrarySchemaVersion} from './sqliteProtocol';
import {decodeBackupValue} from './backupCodec';
import {createHomeLearningStorageProjection} from './homeLearningRecords';
import type {LocalLearningRun,LocalLearningTarget} from '../../learning/runtime/localProtocol';
import {CoordinatedSqliteAdapter,type CoordinatedSqliteBackend} from './sqliteCoordinator';

export interface SqliteRecordAdapter {
  get(table: SqliteLibraryTable, key: string): Promise<string | null>;
  entries(table: SqliteLibraryTable): Promise<Array<{ key: string; encodedValue: string }>>;
  count(table: SqliteLibraryTable): Promise<number>;
  homeLearningProjection(languageRouteId: string): Promise<HomeLearningStorageProjection>;
  countIntroducedLearningTargets(languageRouteId: string, startedAfter: string, startedBefore: string): Promise<number>;
  learningRunIdsForTarget(targetId: string, openOnly: boolean): Promise<string[]>;
  openLearningRunTargets(): Promise<Array<{ runId: string; targetId: string }>>;
  countContentAttemptsSince(taskId: string, createdAfter: string): Promise<number>;
  learningTargetIdsForBookUpgrade(languageRouteId: string, targetLanguageTag: string, supportLanguageTag: string, bookId: string, nextBookVersionId: string): Promise<string[]>;
  isMediaReferenced(mediaId: string): Promise<boolean>;
  commit(mutation: SqliteMutation): Promise<void>;
  diagnostics(): Promise<SqliteStorageDiagnostics>;
}

class WorkerSqliteAdapter implements SqliteRecordAdapter,CoordinatedSqliteBackend {
  private readonly worker = new Worker(new URL("./sqliteWorker.ts", import.meta.url), {
    type: "module",
    name: "sensa-sqlite",
  });
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private nextId = 1;

  constructor() {
    this.worker.addEventListener("message", (event: MessageEvent<SqliteWorkerResult>) => {
      const waiting = this.pending.get(event.data.id);
      if (!waiting) return;
      this.pending.delete(event.data.id);
      if (event.data.ok) waiting.resolve(event.data.value);
      else waiting.reject(new Error(event.data.error));
    });
    this.worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "sqlite_worker_failed");
      for (const waiting of this.pending.values()) waiting.reject(error);
      this.pending.clear();
    });
  }

  initialize(): Promise<SqliteStorageDiagnostics> {
    return this.send({ kind: "initialize" }) as Promise<SqliteStorageDiagnostics>;
  }

  get(table: SqliteLibraryTable, key: string): Promise<string | null> {
    return this.send({ kind: "get", table, key }) as Promise<string | null>;
  }

  entries(table: SqliteLibraryTable): Promise<Array<{ key: string; encodedValue: string }>> {
    return this.send({ kind: "entries", table }) as Promise<Array<{ key: string; encodedValue: string }>>;
  }

  count(table: SqliteLibraryTable): Promise<number> {
    return this.send({ kind: "count", table }) as Promise<number>;
  }

  homeLearningProjection(languageRouteId: string): Promise<HomeLearningStorageProjection> {
    return this.send({ kind: "homeLearningProjection", languageRouteId }) as Promise<HomeLearningStorageProjection>;
  }

  countIntroducedLearningTargets(languageRouteId: string, startedAfter: string, startedBefore: string): Promise<number> {
    return this.send({
      kind: 'countIntroducedLearningTargets', languageRouteId, startedAfter, startedBefore,
    }) as Promise<number>;
  }

  learningRunIdsForTarget(targetId: string, openOnly: boolean): Promise<string[]> {
    return this.send({ kind: 'learningRunIdsForTarget', targetId, openOnly }) as Promise<string[]>;
  }

  openLearningRunTargets(): Promise<Array<{ runId: string; targetId: string }>> {
    return this.send({ kind: 'openLearningRunTargets' }) as Promise<Array<{ runId: string; targetId: string }>>;
  }

  countContentAttemptsSince(taskId: string, createdAfter: string): Promise<number> {
    return this.send({ kind: 'countContentAttemptsSince', taskId, createdAfter }) as Promise<number>;
  }

  learningTargetIdsForBookUpgrade(
    languageRouteId: string,
    targetLanguageTag: string,
    supportLanguageTag: string,
    bookId: string,
    nextBookVersionId: string,
  ): Promise<string[]> {
    return this.send({
      kind: 'learningTargetIdsForBookUpgrade',
      languageRouteId,
      targetLanguageTag,
      supportLanguageTag,
      bookId,
      nextBookVersionId,
    }) as Promise<string[]>;
  }

  isMediaReferenced(mediaId: string): Promise<boolean> {
    return this.send({ kind: 'isMediaReferenced', mediaId }) as Promise<boolean>;
  }

  async commit(mutation: SqliteMutation): Promise<void> {
    await this.send({ kind: "commit", mutation });
  }

  diagnostics(): Promise<SqliteStorageDiagnostics> {
    return this.send({ kind: "diagnostics" }) as Promise<SqliteStorageDiagnostics>;
  }

  private send(input: SqliteWorkerInput): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...input } as SqliteWorkerRequest);
    });
  }
}

/** Test/non-browser Adapter. Production never selects this path. */
class MemoryRecordAdapter implements SqliteRecordAdapter {
  private records = new Map<string, string>();

  async get(table: SqliteLibraryTable, key: string): Promise<string | null> {
    return this.records.get(`${table}\u0000${key}`) ?? null;
  }

  async entries(table: SqliteLibraryTable) {
    const prefix = `${table}\u0000`;
    return [...this.records]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, encodedValue]) => ({ key: key.slice(prefix.length), encodedValue }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async count(table: SqliteLibraryTable): Promise<number> {
    const prefix = `${table}\u0000`;
    let count = 0;
    for (const key of this.records.keys()) if (key.startsWith(prefix)) count++;
    return count;
  }

  async homeLearningProjection(languageRouteId: string): Promise<HomeLearningStorageProjection> {
    const decode = <T>(encoded: string | undefined): T | undefined => encoded === undefined
      ? undefined
      : decodeBackupValue(JSON.parse(encoded)) as T;
    const targets = (await this.entries('learningTargets'))
      .map((row) => decode<LocalLearningTarget>(row.encodedValue)!);
    const availablePackageKeys = (await this.entries('packages')).map((row) => row.key);
    const activeId = decode<string>(this.records.get('meta\u0000learning-active'));
    return createHomeLearningStorageProjection({
      targets,
      availablePackageKeys,
      activeRun: activeId
        ? decode<LocalLearningRun>(this.records.get(`learningRuns\u0000${activeId}`)) ?? null
        : null,
      studyPlans: decode(this.records.get('settings\u0000language-route-study-plans')) ?? {},
      languageRouteId,
    });
  }

  async learningRunIdsForTarget(targetId: string, openOnly: boolean): Promise<string[]> {
    return (await this.entries('learningRuns'))
      .map((row) => ({ key: row.key, run: decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningRun }))
      .filter(({ run }) => run.targetIds.includes(targetId) && (!openOnly || !run.completedAt))
      .map(({ key }) => key)
      .sort();
  }

  async countIntroducedLearningTargets(
    languageRouteId: string,
    startedAfter: string,
    startedBefore: string,
  ): Promise<number> {
    return (await this.entries('learningTargets'))
      .map((row) => decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningTarget)
      .filter((target) => target.introducedLanguageRouteId === languageRouteId
        && target.startedAt !== null
        && target.startedAt >= startedAfter
        && target.startedAt < startedBefore)
      .length;
  }

  async openLearningRunTargets(): Promise<Array<{ runId: string; targetId: string }>> {
    return (await this.entries('learningRuns'))
      .map((row) => ({ key: row.key, run: decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningRun }))
      .filter(({ run }) => !run.completedAt)
      .flatMap(({ key, run }) => run.targetIds.map((targetId) => ({ runId: key, targetId })))
      .sort((left, right) => left.targetId.localeCompare(right.targetId) || left.runId.localeCompare(right.runId));
  }

  async countContentAttemptsSince(taskId: string, createdAfter: string): Promise<number> {
    return (await this.entries('contentAttempts'))
      .map((row) => decodeBackupValue(JSON.parse(row.encodedValue)) as { taskId: string; createdAt: string })
      .filter((attempt) => attempt.taskId === taskId && attempt.createdAt > createdAfter)
      .length;
  }

  async learningTargetIdsForBookUpgrade(
    languageRouteId: string,
    targetLanguageTag: string,
    supportLanguageTag: string,
    bookId: string,
    nextBookVersionId: string,
  ): Promise<string[]> {
    return (await this.entries('learningTargets'))
      .map((row) => ({ key: row.key, target: decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningTarget }))
      .filter(({ target }) => target.curriculumMemberships.some((membership) => (
        membership.status !== 'superseded'
        && membership.sourceKind === 'sense_learning_package'
        && membership.languageContext.languageRouteId === languageRouteId
        && membership.languageContext.targetLanguageTag === targetLanguageTag
        && membership.languageContext.supportLanguageTag === supportLanguageTag
        && membership.provenance.bookId === bookId
        && membership.provenance.bookVersionId !== nextBookVersionId
      )))
      .map(({ key }) => key)
      .sort();
  }

  async isMediaReferenced(mediaId: string): Promise<boolean> {
    const meanings = await this.entries('semanticMeanings');
    if (meanings.some((row) => (
      decodeBackupValue(JSON.parse(row.encodedValue)) as {
        personalSemanticAnchorRevisions?: Array<{ personalMediaObjectId?: string | null }>;
      }
    ).personalSemanticAnchorRevisions?.some((revision) => revision.personalMediaObjectId === mediaId))) return true;
    const inbox = await this.entries('semanticInbox');
    return inbox.some((row) => (
      decodeBackupValue(JSON.parse(row.encodedValue)) as {
        payload?: { context?: { mediaReferenceIds?: string[] } | null };
      }
    ).payload?.context?.mediaReferenceIds?.includes(mediaId));
  }

  async commit(mutation: SqliteMutation): Promise<void> {
    const next = new Map(this.records);
    for (const table of mutation.clears) {
      const prefix = `${table}\u0000`;
      for (const key of next.keys()) if (key.startsWith(prefix)) next.delete(key);
    }
    for (const item of mutation.deletes) next.delete(`${item.table}\u0000${item.key}`);
    for (const item of mutation.puts) next.set(`${item.table}\u0000${item.key}`, item.encodedValue);
    this.records = next;
  }

  async diagnostics(): Promise<SqliteStorageDiagnostics> {
    return {
      engine: "memory-adapter",
      persistence: "memory",
      sqliteVersion: "not-applicable",
      schemaVersion: sqliteLibrarySchemaVersion,
      journalMode: "not-applicable",
      synchronous: null,
      lockingMode: "not-applicable",
    };
  }
}

const testMemoryAdapterRequested = (): boolean =>
  typeof document === 'undefined'
  && (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env?.SENSA_TEST_MEMORY_LIBRARY === 'true';

function assertBrowserSqliteAvailable(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    throw new Error('sqlite_browser_environment_unavailable');
  }
  if (typeof Worker === 'undefined') throw new Error('sqlite_worker_unavailable');
  if (typeof navigator.storage?.getDirectory !== 'function') throw new Error('sqlite_opfs_unavailable');
  if (!navigator.locks) throw new Error('sqlite_web_locks_unavailable');
  if (typeof BroadcastChannel === 'undefined') throw new Error('sqlite_broadcast_channel_unavailable');
}

let adapter: Promise<SqliteRecordAdapter> | undefined;

async function browserAdapter(): Promise<SqliteRecordAdapter> {
  assertBrowserSqliteAvailable();
  const coordinated = new CoordinatedSqliteAdapter(() => new WorkerSqliteAdapter());
  await coordinated.initialize();
  // Capability checks alone cannot prove that this origin can durably write.
  // Exercise the initialized database before any product operation may report
  // success, then remove the private probe row immediately.
  const probeKey = `storage-probe:${crypto.randomUUID()}`;
  const probeValue = JSON.stringify({ value: probeKey });
  let wroteProbe = false;
  try {
    await coordinated.commit({
      clears: [],
      deletes: [],
      puts: [{ table: 'meta', key: probeKey, encodedValue: probeValue }],
    });
    wroteProbe = true;
    if (await coordinated.get('meta', probeKey) !== probeValue) {
      throw new Error('sqlite_storage_probe_failed');
    }
  } finally {
    if (wroteProbe) {
      await coordinated.commit({
        clears: [],
        deletes: [{ table: 'meta', key: probeKey }],
        puts: [],
      });
    }
  }
  return coordinated;
}

export function sqliteRecordAdapter(): Promise<SqliteRecordAdapter> {
  if (!adapter) {
    // Node smoke tests must opt in explicitly. A production browser never
    // accepts volatile storage as a successful local-library implementation.
    adapter = testMemoryAdapterRequested()
      ? Promise.resolve(new MemoryRecordAdapter())
      : browserAdapter();
    adapter.catch(() => { adapter = undefined; });
  }
  return adapter;
}
