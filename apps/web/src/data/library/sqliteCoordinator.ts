import type {
  HomeLearningStorageProjection,
  SqliteLibraryTable,
  SqliteMutation,
  SqliteStorageDiagnostics,
  SqliteWorkerInput,
} from './sqliteProtocol';

// Keep the original ownership name so a page from the previous release cannot
// open a second OPFS connection while a newly deployed page is active.
const ownerLock = 'sensa-sqlite-owner-v1';
const channelName = 'sensa-sqlite-coordinator-v1';
const remoteTimeoutMs = 15_000;
const leaderWaitMs = 10_000;

export interface CoordinatedSqliteBackend {
  initialize(): Promise<SqliteStorageDiagnostics>;
  get(table: SqliteLibraryTable, key: string): Promise<string | null>;
  entries(table: SqliteLibraryTable): Promise<Array<{ key: string; encodedValue: string }>>;
  count(table: SqliteLibraryTable): Promise<number>;
  homeLearningProjection(languageRouteId: string): Promise<HomeLearningStorageProjection>;
  countIntroducedLearningTargets(languageRouteId: string, startedAfter: string, startedBefore: string): Promise<number>;
  learningRunIdsForTarget(targetId: string, openOnly: boolean): Promise<string[]>;
  openLearningRunTargets(): Promise<Array<{ runId: string; targetId: string }>>;
  countContentAttemptsSince(taskId: string, createdAfter: string): Promise<number>;
  commit(mutation: SqliteMutation): Promise<void>;
  diagnostics(): Promise<SqliteStorageDiagnostics>;
}

type CoordinatorMessage =
  | { kind: 'leader'; sender: string }
  | { kind: 'probe'; sender: string }
  | { kind: 'request'; sender: string; requestId: string; input: SqliteWorkerInput }
  | { kind: 'response'; recipient: string; requestId: string; ok: true; value: unknown }
  | { kind: 'response'; recipient: string; requestId: string; ok: false; error: string };

const errorMessage = (cause: unknown): string => cause instanceof Error
  ? cause.message
  : 'sqlite_coordination_failed';

/**
 * One tab owns the OPFS connection; every other tab speaks the same record
 * interface over BroadcastChannel. Web Locks elect a replacement if the owner
 * closes, while the caller-level transaction lock protects read/modify/write
 * sequences that span several record requests.
 */
export class CoordinatedSqliteAdapter implements CoordinatedSqliteBackend {
  private readonly id = crypto.randomUUID();
  private readonly channel = new BroadcastChannel(channelName);
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private readonly leaderWaiters = new Set<() => void>();
  private backend: CoordinatedSqliteBackend | null = null;
  private connection: Promise<void> | null = null;
  private election: Promise<boolean> | null = null;
  private lastLeaderAt = 0;

  constructor(private readonly createBackend: () => CoordinatedSqliteBackend) {
    this.channel.addEventListener('message', (event: MessageEvent<CoordinatorMessage>) => {
      this.receive(event.data);
    });
  }

  initialize(): Promise<SqliteStorageDiagnostics> {
    return this.call({ kind: 'initialize' }) as Promise<SqliteStorageDiagnostics>;
  }

  get(table: SqliteLibraryTable, key: string): Promise<string | null> {
    return this.call({ kind: 'get', table, key }) as Promise<string | null>;
  }

  entries(table: SqliteLibraryTable): Promise<Array<{ key: string; encodedValue: string }>> {
    return this.call({ kind: 'entries', table }) as Promise<Array<{ key: string; encodedValue: string }>>;
  }

  count(table: SqliteLibraryTable): Promise<number> {
    return this.call({ kind: 'count', table }) as Promise<number>;
  }

  homeLearningProjection(languageRouteId: string): Promise<HomeLearningStorageProjection> {
    return this.call({ kind: 'homeLearningProjection', languageRouteId }) as Promise<HomeLearningStorageProjection>;
  }

  countIntroducedLearningTargets(languageRouteId: string, startedAfter: string, startedBefore: string): Promise<number> {
    return this.call({
      kind: 'countIntroducedLearningTargets', languageRouteId, startedAfter, startedBefore,
    }) as Promise<number>;
  }

  learningRunIdsForTarget(targetId: string, openOnly: boolean): Promise<string[]> {
    return this.call({ kind: 'learningRunIdsForTarget', targetId, openOnly }) as Promise<string[]>;
  }

  openLearningRunTargets(): Promise<Array<{ runId: string; targetId: string }>> {
    return this.call({ kind: 'openLearningRunTargets' }) as Promise<Array<{ runId: string; targetId: string }>>;
  }

  countContentAttemptsSince(taskId: string, createdAfter: string): Promise<number> {
    return this.call({ kind: 'countContentAttemptsSince', taskId, createdAfter }) as Promise<number>;
  }

  async commit(mutation: SqliteMutation): Promise<void> {
    await this.call({ kind: 'commit', mutation });
  }

  diagnostics(): Promise<SqliteStorageDiagnostics> {
    return this.call({ kind: 'diagnostics' }) as Promise<SqliteStorageDiagnostics>;
  }

  private async call(input: SqliteWorkerInput): Promise<unknown> {
    await this.connect();
    if (this.backend) return this.dispatch(this.backend, input);

    // A stale announcement is harmless: the lock decides whether this tab may
    // replace the old owner before the request is sent.
    if (await this.tryBecomeLeader()) {
      return this.dispatch(this.backend!, input);
    }
    try {
      return await this.remote(input);
    } catch (cause) {
      if (errorMessage(cause) !== 'sqlite_coordination_timeout') throw cause;
      this.lastLeaderAt = 0;
      if (await this.tryBecomeLeader()) return this.dispatch(this.backend!, input);
      await this.waitForLeader();
      return this.remote(input);
    }
  }

  private connect(): Promise<void> {
    if (!this.connection) {
      this.connection = (async () => {
        if (await this.tryBecomeLeader()) return;
        await this.waitForLeader();
      })();
      this.connection.catch(() => { this.connection = null; });
    }
    return this.connection;
  }

  private tryBecomeLeader(): Promise<boolean> {
    if (this.backend) return Promise.resolve(true);
    if (this.election) return this.election;
    const attempt = new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const succeed = (value: boolean) => {
        if (!settled) { settled = true; resolve(value); }
      };
      const fail = (cause: unknown) => {
        if (!settled) { settled = true; reject(cause); }
      };
      void navigator.locks.request(ownerLock, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) {
          succeed(false);
          return;
        }
        try {
          const backend = this.createBackend();
          await backend.initialize();
          this.backend = backend;
          this.markLeader();
          succeed(true);
          await new Promise<void>(() => { /* The document lifetime owns the OPFS connection. */ });
        } catch (cause) {
          fail(cause);
        }
      }).catch(fail);
    });
    this.election = attempt.finally(() => { this.election = null; });
    return this.election;
  }

  private waitForLeader(): Promise<void> {
    if (this.lastLeaderAt) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ready = () => {
        clearTimeout(timer);
        this.leaderWaiters.delete(ready);
        resolve();
      };
      const timer = setTimeout(() => {
        this.leaderWaiters.delete(ready);
        reject(new Error('sqlite_owner_incompatible'));
      }, leaderWaitMs);
      this.leaderWaiters.add(ready);
      this.channel.postMessage({ kind: 'probe', sender: this.id } satisfies CoordinatorMessage);
    });
  }

  private remote(input: SqliteWorkerInput): Promise<unknown> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('sqlite_coordination_timeout'));
      }, remoteTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.channel.postMessage({ kind: 'request', sender: this.id, requestId, input } satisfies CoordinatorMessage);
    });
  }

  private receive(message: CoordinatorMessage): void {
    if (!message || typeof message !== 'object') return;
    if (message.kind === 'leader') {
      this.lastLeaderAt = Date.now();
      for (const ready of this.leaderWaiters) ready();
      return;
    }
    if (message.kind === 'probe') {
      if (this.backend) this.markLeader();
      return;
    }
    if (message.kind === 'response') {
      if (message.recipient !== this.id) return;
      const waiting = this.pending.get(message.requestId);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      this.pending.delete(message.requestId);
      if (message.ok) waiting.resolve(message.value);
      else waiting.reject(new Error(message.error));
      return;
    }
    if (!this.backend || message.sender === this.id) return;
    void this.dispatch(this.backend, message.input).then(
      (value) => this.channel.postMessage({
        kind: 'response', recipient: message.sender, requestId: message.requestId, ok: true, value,
      } satisfies CoordinatorMessage),
      (cause) => this.channel.postMessage({
        kind: 'response', recipient: message.sender, requestId: message.requestId, ok: false, error: errorMessage(cause),
      } satisfies CoordinatorMessage),
    );
  }

  private markLeader(): void {
    this.lastLeaderAt = Date.now();
    this.channel.postMessage({ kind: 'leader', sender: this.id } satisfies CoordinatorMessage);
    for (const ready of this.leaderWaiters) ready();
  }

  private dispatch(backend: CoordinatedSqliteBackend, input: SqliteWorkerInput): Promise<unknown> {
    switch (input.kind) {
      case 'initialize': return backend.initialize();
      case 'get': return backend.get(input.table, input.key);
      case 'entries': return backend.entries(input.table);
      case 'count': return backend.count(input.table);
      case 'homeLearningProjection': return backend.homeLearningProjection(input.languageRouteId);
      case 'countIntroducedLearningTargets': return backend.countIntroducedLearningTargets(
        input.languageRouteId,
        input.startedAfter,
        input.startedBefore,
      );
      case 'learningRunIdsForTarget': return backend.learningRunIdsForTarget(input.targetId, input.openOnly);
      case 'openLearningRunTargets': return backend.openLearningRunTargets();
      case 'countContentAttemptsSince': return backend.countContentAttemptsSince(input.taskId, input.createdAfter);
      case 'commit': return backend.commit(input.mutation);
      case 'diagnostics': return backend.diagnostics();
    }
  }
}
