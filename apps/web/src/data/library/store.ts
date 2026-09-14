/** Production local-library storage: SQLite WASM in an OPFS Worker. */
import { canonicalConsumerJson } from "@sensa/contracts/sensa";

import { decodeBackupValue, encodeBackupValue } from "./backupCodec";
import { sqliteRecordAdapter } from "./sqliteAdapter";
import {
  sqliteLibraryTables,
  type SqliteLibraryTable,
  type SqliteMutation,
  type SqliteStorageDiagnostics,
} from "./sqliteProtocol";

export const libraryDatabaseName = "sensa-local-library-v1.sqlite3";
export const libraryTables = sqliteLibraryTables;
export type Table = SqliteLibraryTable;

let sessionIncarnation: string | undefined;
let serial: Promise<unknown> = Promise.resolve();

const recordKey = (key: string): string => {
  if (key.length === 0 || key.length > 2000) {
    throw new Error("libraryBackup.errors.recordKey");
  }
  return key;
};

const decode = (encoded: string): unknown => decodeBackupValue(JSON.parse(encoded));
const encode = (value: unknown): string => JSON.stringify(encodeBackupValue(value));
const clone = <T>(value: T): T => structuredClone(value);

const storageCall = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (/full|quota/iu.test(message)) throw new Error("localFlow.storageFull", { cause });
    if (/lock|busy|AbortError|TimeoutError|timed out/iu.test(message)) {
      throw new Error("localFlow.closeOldTabs", { cause });
    }
    if (message.startsWith("localFlow.")) throw cause;
    throw new Error("localFlow.storageWrite", { cause });
  }
};

/**
 * A transaction is an isolated logical record view. Writes stay in memory
 * while domain code executes, then cross the Worker seam as one SQLite
 * transaction. No caller holds a database lock across network or model work.
 */
export class LibraryTransaction {
  wrote = false;
  private readonly clears = new Set<Table>();
  private readonly deletes = new Map<Table, Set<string>>();
  private readonly puts = new Map<Table, Map<string, unknown>>();

  constructor(
    private readonly mode: "readonly" | "readwrite",
    private readonly adapter: Awaited<ReturnType<typeof sqliteRecordAdapter>>,
  ) {}

  async get<T>(table: Table, inputKey: string): Promise<T | undefined> {
    const key = recordKey(inputKey);
    const pending = this.puts.get(table);
    if (pending?.has(key)) return clone(pending.get(key) as T);
    if (this.clears.has(table) || this.deletes.get(table)?.has(key)) return undefined;
    const encoded = await storageCall(() => this.adapter.get(table, key));
    return encoded === null ? undefined : clone(decode(encoded) as T);
  }

  async entries(table: Table): Promise<Array<{ key: string; value: any }>> {
    const values = new Map<string, unknown>();
    if (!this.clears.has(table)) {
      for (const row of await storageCall(() => this.adapter.entries(table))) {
        if (!this.deletes.get(table)?.has(row.key)) values.set(row.key, decode(row.encodedValue));
      }
    }
    for (const [key, value] of this.puts.get(table) ?? []) values.set(key, value);
    return [...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, value: clone(value) }));
  }

  async all<T>(table: Table): Promise<T[]> {
    return (await this.entries(table)).map((entry) => entry.value as T);
  }

  put(table: Table, inputKey: string, value: unknown): void {
    this.assertWritable();
    const key = recordKey(inputKey);
    const tablePuts = this.puts.get(table) ?? new Map<string, unknown>();
    tablePuts.set(key, clone(value));
    this.puts.set(table, tablePuts);
    this.deletes.get(table)?.delete(key);
    this.wrote = true;
  }

  clear(table: Table): void {
    this.assertWritable();
    this.clears.add(table);
    this.deletes.delete(table);
    this.puts.delete(table);
    this.wrote = true;
  }

  delete(table: Table, inputKey: string): void {
    this.assertWritable();
    const key = recordKey(inputKey);
    this.puts.get(table)?.delete(key);
    if (!this.clears.has(table)) {
      const tableDeletes = this.deletes.get(table) ?? new Set<string>();
      tableDeletes.add(key);
      this.deletes.set(table, tableDeletes);
    }
    this.wrote = true;
  }

  mutation(): SqliteMutation {
    return {
      clears: [...this.clears],
      deletes: [...this.deletes].flatMap(([table, keys]) =>
        [...keys].map((key) => ({ table, key }))),
      puts: [...this.puts].flatMap(([table, values]) =>
        [...values].map(([key, value]) => ({ table, key, encodedValue: encode(value) }))),
    };
  }

  private assertWritable(): void {
    if (this.mode !== "readwrite") throw new Error("library_readonly_transaction");
  }
}

const runSerially = <T>(work: () => Promise<T>): Promise<T> => {
  const next = serial.catch(() => undefined).then(work);
  serial = next.then(() => undefined, () => undefined);
  return next;
};

/** Only local SQLite requests belong in work; network and hashing finish before entry. */
async function transaction<T>(
  mode: "readonly" | "readwrite",
  work: (tx: LibraryTransaction) => Promise<T>,
  kind: "content" | "state" = "content",
): Promise<T> {
  return runSerially(async () => {
    const adapter = await storageCall(sqliteRecordAdapter);
    const library = new LibraryTransaction(mode, adapter);
    const value = await work(library);
    if (mode === "readwrite" && library.wrote) {
      const mutation = library.mutation();
      await storageCall(() => adapter.commit(mutation));
      if (kind === "state") window.dispatchEvent(new Event("sensa-sync-state-changed"));
      else {
        window.dispatchEvent(new Event("sensa-library-changed"));
        if (typeof BroadcastChannel !== "undefined") {
          const channel = new BroadcastChannel("sensa-local-library");
          channel.postMessage("changed");
          channel.close();
        }
      }
    }
    return value;
  });
}

/** Reserved for validated full-library restore; it remains one SQLite transaction. */
export const restoreLibraryTransaction = <T>(work: (tx: LibraryTransaction) => Promise<T>) =>
  transaction("readwrite", work);
/** Sync progress and baselines do not announce learner-content changes. */
export const writeLibraryState = <T>(work: (tx: LibraryTransaction) => Promise<T>) =>
  transaction("readwrite", work, "state");
export const readLibrary = <T>(work: (tx: LibraryTransaction) => Promise<T>) =>
  transaction("readonly", work);

/** A cleared/restored library fences every command from an older page instance. */
export async function assertCurrentLibrary(tx: LibraryTransaction): Promise<string> {
  const current = await tx.get<string>("meta", "local-incarnation") ?? "initial";
  sessionIncarnation ??= current;
  if (sessionIncarnation !== current) throw new Error("localFlow.libraryReplaced");
  return current;
}

export type Operation = { id: string; kind: string; input: unknown };

export async function command<T>(
  op: Operation,
  work: (tx: LibraryTransaction) => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f-]{36}$/iu.test(op.id)) throw new Error("localFlow.operationInvalid");
  const input = canonicalConsumerJson({ kind: op.kind, input: op.input });
  return transaction("readwrite", async (tx) => {
    await assertCurrentLibrary(tx);
    const prior = await tx.get<{ input: string; result: T }>("operations", op.id);
    if (prior) {
      if (prior.input !== input) throw new Error("localFlow.operationConflict");
      return prior.result;
    }
    const value = await work(tx);
    tx.put("operations", op.id, { input, result: value, committedAt: new Date().toISOString() });
    return value;
  });
}

export type LibraryIdentity = {
  id: string;
  learnerId: string;
  deviceId: string;
  createdAt: string;
  schemaVersion: 1;
};

export async function openLibrary(): Promise<LibraryIdentity> {
  return command({
    id: "00000000-0000-4000-8000-000000000001",
    kind: "library.create",
    input: {},
  }, async (tx) => {
    const identity: LibraryIdentity = {
      id: crypto.randomUUID(),
      learnerId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      schemaVersion: 1,
    };
    tx.put("meta", "identity", identity);
    return identity;
  });
}

export function observeLibrary(listener: () => void): () => void {
  window.addEventListener("sensa-library-changed", listener);
  const channel = typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("sensa-local-library");
  if (channel) channel.onmessage = listener;
  return () => {
    window.removeEventListener("sensa-library-changed", listener);
    channel?.close();
  };
}

export function observeCloudSync(listener: () => void): () => void {
  window.addEventListener("sensa-sync-state-changed", listener);
  const stop = observeLibrary(listener);
  return () => {
    window.removeEventListener("sensa-sync-state-changed", listener);
    stop();
  };
}

export async function readLibraryStorageDiagnostics(): Promise<SqliteStorageDiagnostics> {
  return (await sqliteRecordAdapter()).diagnostics();
}
