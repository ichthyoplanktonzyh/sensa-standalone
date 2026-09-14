import type {
  SqliteLibraryTable,
  SqliteMutation,
  SqliteStorageDiagnostics,
  SqliteWorkerInput,
  SqliteWorkerRequest,
  SqliteWorkerResult,
} from "./sqliteProtocol";

export interface SqliteRecordAdapter {
  get(table: SqliteLibraryTable, key: string): Promise<string | null>;
  entries(table: SqliteLibraryTable): Promise<Array<{ key: string; encodedValue: string }>>;
  commit(mutation: SqliteMutation): Promise<void>;
  diagnostics(): Promise<SqliteStorageDiagnostics>;
}

class WorkerSqliteAdapter implements SqliteRecordAdapter {
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
      schemaVersion: 1,
    };
  }
}

const browserSqliteAvailable = (): boolean =>
  typeof window !== "undefined"
  && typeof Worker !== "undefined"
  && typeof navigator !== "undefined"
  && typeof navigator.storage?.getDirectory === "function";

let adapter: Promise<SqliteRecordAdapter> | undefined;

/**
 * OPFS SAH pools intentionally have one owner. The lifetime Web Lock makes the
 * database Worker that owner; another tab receives an honest error instead of
 * opening a competing SQLite connection. A reload gets a short grace period
 * for the previous document to release its lock.
 */
async function browserAdapter(): Promise<SqliteRecordAdapter> {
  if (!navigator.locks) throw new Error("sqlite_web_locks_unavailable");
  return new Promise((resolve, reject) => {
    const signal = AbortSignal.timeout(2500);
    void navigator.locks.request(
      "sensa-sqlite-owner-v1",
      { mode: "exclusive", signal },
      async () => {
        try {
          const driver = new WorkerSqliteAdapter();
          await driver.initialize();
          resolve(driver);
          await new Promise<void>(() => { /* Hold the OPFS ownership lock for this page. */ });
        } catch (error) {
          reject(error);
        }
      },
    ).catch((error) => reject(error));
  });
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
