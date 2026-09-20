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
    };
  }
}

const browserSqliteAvailable = (): boolean =>
  typeof window !== "undefined"
  && typeof Worker !== "undefined"
  && typeof navigator !== "undefined"
  && typeof navigator.storage?.getDirectory === "function";

let adapter: Promise<SqliteRecordAdapter> | undefined;

async function browserAdapter(): Promise<SqliteRecordAdapter> {
  if (!navigator.locks) throw new Error("sqlite_web_locks_unavailable");
  if (typeof BroadcastChannel === "undefined") throw new Error("sqlite_broadcast_channel_unavailable");
  const coordinated = new CoordinatedSqliteAdapter(() => new WorkerSqliteAdapter());
  await coordinated.initialize();
  return coordinated;
}

export function sqliteRecordAdapter(): Promise<SqliteRecordAdapter> {
  if (!adapter) {
    adapter = browserSqliteAvailable()
      ? browserAdapter()
      : Promise.resolve(new MemoryRecordAdapter());
    adapter.catch(() => { adapter = undefined; });
  }
  return adapter;
}
