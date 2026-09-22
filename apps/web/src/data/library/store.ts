/** Production local-library storage: SQLite WASM in an OPFS Worker. */
import {canonicalConsumerJson} from '@sensa/contracts/sensa/canonical-json';

import { decodeBackupValue, encodeBackupValue } from "./backupCodec";
import { sqliteRecordAdapter } from "./sqliteAdapter";
import {
  type HomeLearningStorageProjection,
  sqliteLibraryFile,
  sqliteLibraryTables,
  type SqliteLibraryTable,
  type SqliteMutation,
  type SqliteRecordChange,
  type SqliteStorageDiagnostics,
} from "./sqliteProtocol";

export const libraryDatabaseName = sqliteLibraryFile.slice(1);
export const libraryTables = sqliteLibraryTables;
export type Table = SqliteLibraryTable;
export type LibraryRecordTransition<Tables extends readonly Table[]=readonly Table[]>={
  table:Tables[number];
  key:string;
  before:unknown|null;
  after:unknown|null;
};
export const localLibraryRevisionKey = "local-content-revision";
export const cloudCheckpointRequestEvent = "sensa-cloud-checkpoint-requested";

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

const storageCall = async <T>(
  work: () => Promise<T>,
  fallback: 'localFlow.storageOpen' | 'localFlow.storageWrite' = 'localFlow.storageWrite',
): Promise<T> => {
  try {
    return await work();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (/full|quota/iu.test(message)) throw new Error("localFlow.storageFull", { cause });
    if (/^sqlite_(?:browser_environment|worker|opfs|web_locks|broadcast_channel)_unavailable$/u.test(message)) {
      throw new Error('localFlow.storageUnsupported', { cause });
    }
    if (message === 'sqlite_storage_probe_failed') {
      throw new Error('localFlow.storageOpen', { cause });
    }
    if (message === 'sqlite_owner_incompatible') {
      throw new Error('localFlow.closeOldTabs', { cause });
    }
    if (/coordination|lock|busy|AbortError|TimeoutError|timed out/iu.test(message)) {
      throw new Error("localFlow.storageBusy", { cause });
    }
    if (message.startsWith("localFlow.")) throw cause;
    throw new Error(fallback, { cause });
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
  private syncBaseReplacement: Array<{ table: Table; key: string; valueJson: string; blockRefs: string[] }> | undefined;

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

  async changesSince<Tables extends readonly Table[]>(contentRevision: number, tables: Tables): Promise<Array<{
    table: Tables[number];
    key: string;
    value: unknown | null;
    contentRevision: number;
  }>> {
    if (this.wrote) throw new Error('library_changes_require_snapshot');
    const changes: SqliteRecordChange[] = await storageCall(
      () => this.adapter.changesSince(contentRevision, tables),
    );
    return changes.map((change) => ({
      table: change.table as Tables[number],
      key: change.key,
      value: change.encodedValue === null ? null : clone(decode(change.encodedValue)),
      contentRevision: change.contentRevision,
    }));
  }

  async syncBaseEntries<Tables extends readonly Table[]>(keys?: readonly {
    table: Tables[number];
    key: string;
  }[]): Promise<Array<{ table: Tables[number]; key: string; value: unknown; blocks: string[] }>> {
    if (this.wrote) throw new Error('library_sync_base_requires_snapshot');
    const normalizedKeys = keys?.map(({ table, key }) => ({ table, key: recordKey(key) }));
    const entries = await storageCall(() => this.adapter.syncBaseEntries(normalizedKeys));
    return entries.map((entry) => ({
      table: entry.table as Tables[number],
      key: entry.key,
      value: clone(JSON.parse(entry.valueJson)),
      blocks: [...entry.blockRefs],
    }));
  }

  replaceSyncBase(entries: readonly { table: Table; key: string; value: unknown; blocks?: readonly string[] }[]): void {
    this.assertWritable();
    const unique = new Map<string, { table: Table; key: string; valueJson: string; blockRefs: string[] }>();
    for (const entry of entries) {
      const key = recordKey(entry.key);
      const blockRefs = [...(entry.blocks ?? [])];
      if (blockRefs.some((ref) => !/^[a-f0-9]{64}$/u.test(ref))) throw new Error('library_sync_format');
      unique.set(`${entry.table}\u0000${key}`, {
        table: entry.table,
        key,
        valueJson: JSON.stringify(entry.value),
        blockRefs,
      });
    }
    this.syncBaseReplacement = [...unique.values()]
      .sort((left, right) => left.table.localeCompare(right.table) || left.key.localeCompare(right.key));
    this.wrote = true;
  }

  async all<T>(table: Table): Promise<T[]> {
    return (await this.entries(table)).map((entry) => entry.value as T);
  }

  async count(table: Table): Promise<number> {
    if (this.clears.has(table) || this.deletes.has(table) || this.puts.has(table)) {
      return (await this.entries(table)).length;
    }
    return storageCall(() => this.adapter.count(table));
  }

  async learningRunIdsForTarget(
    inputTargetId: string,
    options: Readonly<{ openOnly?: boolean }> = {},
  ): Promise<string[]> {
    const targetId = recordKey(inputTargetId);
    const openOnly = options.openOnly ?? false;
    if (this.hasPendingChanges('learningRuns')) {
      return (await this.entries('learningRuns'))
        .filter(({ value }) => {
          const run = value as { targetIds: string[]; completedAt: string | null };
          return run.targetIds.includes(targetId) && (!openOnly || !run.completedAt);
        })
        .map(({ key }) => key);
    }
    return storageCall(() => this.adapter.learningRunIdsForTarget(targetId, openOnly));
  }

  async countIntroducedLearningTargets(
    languageRouteId: string,
    startedAfter: string,
    startedBefore: string,
  ): Promise<number> {
    if (this.hasPendingChanges('learningTargets')) {
      return (await this.all<{
        introducedLanguageRouteId: string | null;
        startedAt: string | null;
      }>('learningTargets'))
        .filter((target) => target.introducedLanguageRouteId === languageRouteId
          && target.startedAt !== null
          && target.startedAt >= startedAfter
          && target.startedAt < startedBefore)
        .length;
    }
    return storageCall(() => this.adapter.countIntroducedLearningTargets(
      languageRouteId,
      startedAfter,
      startedBefore,
    ));
  }

  async openLearningTargetIds(): Promise<string[]> {
    if (this.hasPendingChanges('learningRuns')) {
      const targetIds = (await this.all<{ targetIds: string[]; completedAt: string | null }>('learningRuns'))
        .filter((run) => !run.completedAt)
        .flatMap((run) => run.targetIds);
      return [...new Set(targetIds)].sort();
    }
    const links = await storageCall(() => this.adapter.openLearningRunTargets());
    return [...new Set(links.map((link) => link.targetId))].sort();
  }

  async countContentAttemptsSince(inputTaskId: string, createdAfter: string): Promise<number> {
    const taskId = recordKey(inputTaskId);
    if (this.hasPendingChanges('contentAttempts')) {
      return (await this.all<{ taskId: string; createdAt: string }>('contentAttempts'))
        .filter((attempt) => attempt.taskId === taskId && attempt.createdAt > createdAfter)
        .length;
    }
    return storageCall(() => this.adapter.countContentAttemptsSince(taskId, createdAfter));
  }

  async learningTargetIdsForBookUpgrade(
    languageRouteId: string,
    targetLanguageTag: string,
    supportLanguageTag: string,
    bookId: string,
    nextBookVersionId: string,
  ): Promise<string[]> {
    if (this.hasPendingChanges('learningTargets')) {
      return (await this.entries('learningTargets'))
        .filter(({ value }) => (value as {
          curriculumMemberships: Array<{
            status?: 'active' | 'superseded';
            sourceKind: string;
            languageContext: {
              languageRouteId: string;
              targetLanguageTag: string;
              supportLanguageTag: string;
            };
            provenance: Record<string, unknown>;
          }>;
        }).curriculumMemberships.some((membership) => (
          membership.status !== 'superseded'
          && membership.sourceKind === 'sense_learning_package'
          && membership.languageContext.languageRouteId === languageRouteId
          && membership.languageContext.targetLanguageTag === targetLanguageTag
          && membership.languageContext.supportLanguageTag === supportLanguageTag
          && membership.provenance.bookId === bookId
          && membership.provenance.bookVersionId !== nextBookVersionId
        )))
        .map(({ key }) => key);
    }
    return storageCall(() => this.adapter.learningTargetIdsForBookUpgrade(
      languageRouteId,
      targetLanguageTag,
      supportLanguageTag,
      bookId,
      nextBookVersionId,
    ));
  }

  async isMediaReferenced(inputMediaId: string): Promise<boolean> {
    const mediaId = recordKey(inputMediaId);
    if (!this.hasPendingChanges('semanticMeanings') && !this.hasPendingChanges('semanticInbox')) {
      return storageCall(() => this.adapter.isMediaReferenced(mediaId));
    }
    const meanings = await this.all<{
      personalSemanticAnchorRevisions?: Array<{ personalMediaObjectId?: string | null }>;
    }>('semanticMeanings');
    if (meanings.some((meaning) => meaning.personalSemanticAnchorRevisions
      ?.some((revision) => revision.personalMediaObjectId === mediaId))) return true;
    const inbox = await this.all<{
      payload?: { context?: { mediaReferenceIds?: string[] } | null };
    }>('semanticInbox');
    return inbox.some((item) => item.payload?.context?.mediaReferenceIds?.includes(mediaId));
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

  /**
   * Returns the persisted and proposed values for only the records staged by
   * this transaction. Domain authorities use this seam before SQLite commit;
   * ordinary commands never need to scan an entire logical table.
   */
  async proposedChanges<Tables extends readonly Table[]>(
    tables: Tables,
  ): Promise<Array<LibraryRecordTransition<Tables>>> {
    const selected = new Set<Table>(tables);
    const keys = new Map<Table, Set<string>>();
    const add = (table: Table, key: string) => {
      if (!selected.has(table)) return;
      const tableKeys = keys.get(table) ?? new Set<string>();
      tableKeys.add(key);
      keys.set(table, tableKeys);
    };
    for (const table of this.clears) {
      if (!selected.has(table)) continue;
      for (const row of await storageCall(() => this.adapter.entries(table))) add(table, row.key);
    }
    for (const [table, deleted] of this.deletes) for (const key of deleted) add(table, key);
    for (const [table, values] of this.puts) for (const key of values.keys()) add(table, key);

    const changes: Array<LibraryRecordTransition<Tables>> = [];
    for (const [table, tableKeys] of keys) {
      for (const key of tableKeys) {
        const beforeEncoded = await storageCall(() => this.adapter.get(table, key));
        const after = await this.get(table, key);
        const afterEncoded = after === undefined ? null : encode(after);
        if (beforeEncoded === afterEncoded) continue;
        changes.push({
          table: table as Tables[number],
          key,
          before: beforeEncoded === null ? null : clone(decode(beforeEncoded)),
          after: after === undefined ? null : clone(after),
        });
      }
    }
    return changes.sort((left, right) => (
      left.table.localeCompare(right.table) || left.key.localeCompare(right.key)
    ));
  }

  mutation(): SqliteMutation {
    return {
      clears: [...this.clears],
      deletes: [...this.deletes].flatMap(([table, keys]) =>
        [...keys].map((key) => ({ table, key }))),
      puts: [...this.puts].flatMap(([table, values]) =>
        [...values].map(([key, value]) => ({ table, key, encodedValue: encode(value) }))),
      ...(this.syncBaseReplacement === undefined
        ? {}
        : { syncBaseReplacement: this.syncBaseReplacement }),
    };
  }

  private hasPendingChanges(table: Table): boolean {
    return this.clears.has(table) || this.deletes.has(table) || this.puts.has(table);
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

async function runAcrossPages<T>(
  mode: "readonly" | "readwrite",
  work: () => Promise<T>,
): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return work();
  try {
    return await navigator.locks.request(
      "sensa-library-transaction-v1",
      {
        mode: mode === "readonly" ? "shared" : "exclusive",
        signal: AbortSignal.timeout(45_000),
      },
      work,
    );
  } catch (cause) {
    if (cause instanceof DOMException && ['AbortError', 'TimeoutError'].includes(cause.name)) {
      throw new Error('localFlow.storageBusy', { cause });
    }
    throw cause;
  }
}

/** Only local SQLite requests belong in work; network and hashing finish before entry. */
async function transaction<T>(
  mode: "readonly" | "readwrite",
  work: (tx: LibraryTransaction) => Promise<T>,
  kind: "content" | "state" | "cache" = "content",
): Promise<T> {
  const execute = async () => {
    const adapter = await storageCall(sqliteRecordAdapter, 'localFlow.storageOpen');
    const library = new LibraryTransaction(mode, adapter);
    const value = await work(library);
    if (mode === "readwrite" && library.wrote) {
      let contentRevision: number | undefined;
      if (kind === "content") {
        const revision = await library.get<number>("meta", localLibraryRevisionKey) ?? 0;
        contentRevision = revision + 1;
        library.put("meta", localLibraryRevisionKey, contentRevision);
      }
      const mutation = library.mutation();
      mutation.contentRevision = contentRevision;
      await storageCall(() => adapter.commit(mutation));
      if (kind === "state") window.dispatchEvent(new Event("sensa-sync-state-changed"));
      else {
        const tables = [...new Set([
          ...mutation.clears,
          ...mutation.deletes.map((row) => row.table),
          ...mutation.puts.map((row) => row.table),
        ])];
        window.dispatchEvent(new CustomEvent("sensa-library-changed", { detail: { tables } }));
        if (typeof BroadcastChannel !== "undefined") {
          const channel = new BroadcastChannel("sensa-local-library");
          channel.postMessage({ tables });
          channel.close();
        }
      }
    }
    return value;
  };
  // Web Locks already coordinate this entire logical transaction within and
  // across pages. Shared reads may overlap; an exclusive writer still fences
  // every read/modify/write sequence. Non-browser adapters retain the serial
  // fallback so their in-memory snapshots cannot interleave.
  return typeof navigator !== "undefined" && navigator.locks
    ? runAcrossPages(mode, execute)
    : runSerially(execute);
}

/** Reserved for validated full-library restore; it remains one SQLite transaction. */
export const restoreLibraryTransaction = <T>(work: (tx: LibraryTransaction) => Promise<T>) =>
  transaction("readwrite", work);
/** Sync progress and baselines do not announce learner-content changes. */
export const writeLibraryState = <T>(work: (tx: LibraryTransaction) => Promise<T>) =>
  transaction("readwrite", work, "state");
/** Device-local, reproducible caches announce UI changes without entering the
 * learner-content revision journal or scheduling a Cloud Checkpoint. */
export const writeLibraryCache = <T>(work: (tx: LibraryTransaction) => Promise<T>) =>
  transaction("readwrite", work, "cache");
export const readLibrary = <T>(work: (tx: LibraryTransaction) => Promise<T>) =>
  transaction("readonly", work);

/**
 * A Worker-owned, single-snapshot read for the home queue. It intentionally
 * bypasses the page transaction chain: the Worker returns one immutable compact
 * result, so it cannot observe a partial SQLite commit or staged page writes.
 */
export const readHomeLearningRecords = async (
  languageRouteId: string,
): Promise<HomeLearningStorageProjection> => {
  const adapter = await storageCall(sqliteRecordAdapter, 'localFlow.storageOpen');
  return storageCall(() => adapter.homeLearningProjection(languageRouteId));
};

export const readLocalLibraryRevision = (tx: LibraryTransaction): Promise<number> =>
  tx.get<number>("meta", localLibraryRevisionKey).then((value) => value ?? 0);

/** A meaningful product milestone asks the account adapter for an early Checkpoint. */
export function requestCloudCheckpoint(): void {
  window.dispatchEvent(new Event(cloudCheckpointRequestEvent));
}

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
    const prior = await tx.get<{ input: string; result: T; cloudReceipt?: true }>("operations", op.id);
    if (prior) {
      if (prior.input !== input) throw new Error("localFlow.operationConflict");
      // Restored domain facts already contain this command's effects. A compact cloud
      // receipt must prevent duplicate execution without pretending to carry its result.
      if (prior.cloudReceipt) throw new Error("localFlow.operationAlreadyApplied");
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
  schemaVersion: 2;
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
      schemaVersion: 2,
    };
    tx.put("meta", "identity", identity);
    return identity;
  });
}

export function observeLibrary(listener: () => void, tables?: readonly Table[]): () => void {
  const filter = tables ? new Set<Table>(tables) : null;
  const relevant = (changed: unknown): boolean => !filter
    || !Array.isArray(changed)
    || changed.some((table) => filter.has(table as Table));
  const local = (event: Event) => {
    if (relevant((event as CustomEvent<{ tables?: unknown }>).detail?.tables)) listener();
  };
  window.addEventListener("sensa-library-changed", local);
  const channel = typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("sensa-local-library");
  if (channel) channel.onmessage = (event) => {
    if (relevant(event.data?.tables)) listener();
  };
  return () => {
    window.removeEventListener("sensa-library-changed", local);
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

export function observeCloudSyncState(listener: () => void): () => void {
  window.addEventListener("sensa-sync-state-changed", listener);
  return () => window.removeEventListener("sensa-sync-state-changed", listener);
}

export async function readLibraryStorageDiagnostics(): Promise<SqliteStorageDiagnostics> {
  const adapter = await storageCall(sqliteRecordAdapter, 'localFlow.storageOpen');
  return storageCall(() => adapter.diagnostics());
}
