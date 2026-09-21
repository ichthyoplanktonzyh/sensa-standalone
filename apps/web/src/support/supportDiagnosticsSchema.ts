export type SupportDiagnosticsInput = {
  createdAt: string;
  release: string;
  online: boolean;
  offlineShell: string | undefined;
  capabilities: Record<'opfs' | 'webLocks' | 'broadcastChannel' | 'worker' | 'serviceWorker', boolean>;
  library: {
    engine: 'sqlite-wasm' | 'memory-adapter';
    persistence: 'opfs' | 'memory';
    schemaVersion: number;
    journalMode: string;
    synchronous: number | null;
    lockingMode: string;
  } | null;
  libraryError: unknown;
  persistence: 'persistent' | 'best-effort' | 'unsupported' | 'unavailable';
  budget: { usageBytes: number; quotaBytes: number } | null;
  sync: ({
    status: 'pending' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'failed';
    error?: string;
    failureKind?: 'transient' | 'terminal';
    retryCount?: number;
    pending?: { entries: unknown[] };
    conflict?: { records: unknown[]; affectedRecordIds: unknown[] };
    lastSyncedAt?: string;
    lastCheckedAt?: string;
  } & Record<string, unknown>) | undefined;
  syncError: unknown;
};

const diagnosticCode = (value: unknown): string | null => {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  const code = message.split(':', 1)[0] ?? '';
  const safe = /^(?:library_sync_[a-z0-9_]+|libraryBackup\.errors\.[a-zA-Z0-9]+|localFlow\.[a-zA-Z0-9]+|sqlite_[a-z0-9_]+|authentication_required|account_changed)$/u;
  return safe.test(code) ? code : message ? 'unclassified' : null;
};
const wholeMiB = (bytes: number): number => Math.round(bytes / 1024 / 1024);

/** Strict projection: counts and state only; never account, record, content, URL, token, or stack fields. */
export function buildSupportDiagnostics(input: SupportDiagnosticsInput) {
  const sync = input.sync;
  return {
    format: 'sensa-support-diagnostics-v1',
    createdAt: input.createdAt,
    release: input.release,
    runtime: {
      online: input.online,
      offlineShell: ['preparing', 'ready', 'failed', 'development'].includes(input.offlineShell ?? '')
        ? input.offlineShell
        : 'unknown',
      ...input.capabilities,
    },
    storage: {
      state: input.library ? 'ready' : 'unavailable',
      errorCode: diagnosticCode(input.libraryError),
      engine: input.library?.engine ?? null,
      persistence: input.library?.persistence ?? null,
      schemaVersion: input.library?.schemaVersion ?? null,
      journalMode: input.library?.journalMode ?? null,
      synchronous: input.library?.synchronous ?? null,
      lockingMode: input.library?.lockingMode ?? null,
      evictionProtection: input.persistence,
      usageMiB: input.budget ? wholeMiB(input.budget.usageBytes) : null,
      quotaMiB: input.budget ? wholeMiB(input.budget.quotaBytes) : null,
    },
    sync: {
      state: sync?.status ?? 'not-configured',
      errorCode: diagnosticCode(sync?.error ?? input.syncError),
      failureKind: sync?.failureKind ?? null,
      retryCount: sync?.retryCount ?? 0,
      pendingRecordCount: sync?.pending?.entries.length ?? 0,
      conflictRecordCount: sync?.conflict?.records.length ?? 0,
      affectedRecordCount: sync?.conflict?.affectedRecordIds.length ?? 0,
      lastSyncedAt: sync?.lastSyncedAt ?? null,
      lastCheckedAt: sync?.lastCheckedAt ?? null,
    },
  } as const;
}
