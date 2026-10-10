import { readCloudSync } from '../data/library/cloudSync';
import { readLibraryStorageDiagnostics } from '../data/library/store';
import { readLocalStorageBudget, readLocalStoragePersistence } from '../data/library/storagePersistence';
import { buildSupportDiagnostics } from './supportDiagnosticsSchema';

declare const __SENSA_RELEASE__: string;

const settled = <T>(result: PromiseSettledResult<T>): { value: T | null; error: unknown } =>
  result.status === 'fulfilled' ? { value: result.value, error: null } : { value: null, error: result.reason };

export async function collectSupportDiagnostics() {
  const [libraryResult, persistenceResult, budgetResult, syncResult] = await Promise.allSettled([
    readLibraryStorageDiagnostics({verifyIntegrity:true}),
    readLocalStoragePersistence(),
    readLocalStorageBudget(),
    readCloudSync(),
  ]);
  const library = settled(libraryResult);
  const persistence = settled(persistenceResult);
  const budget = settled(budgetResult);
  const sync = settled(syncResult);
  return buildSupportDiagnostics({
    createdAt: new Date().toISOString(),
    release: __SENSA_RELEASE__,
    online: navigator.onLine,
    offlineShell: document.documentElement.dataset.offlineShell,
    capabilities: {
      opfs: typeof navigator.storage?.getDirectory === 'function',
      webLocks: typeof navigator.locks?.request === 'function',
      broadcastChannel: typeof BroadcastChannel === 'function',
      worker: typeof Worker === 'function',
      serviceWorker: 'serviceWorker' in navigator,
    },
    library: library.value,
    libraryError: library.error,
    persistence: persistence.value ?? 'unavailable',
    budget: budget.value,
    sync: sync.value ?? undefined,
    syncError: sync.error,
  });
}

export async function downloadSupportDiagnostics(): Promise<void> {
  const diagnostics = await collectSupportDiagnostics();
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(diagnostics, null, 2)}\n`], { type: 'application/json' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sensa-diagnostics-${diagnostics.createdAt.slice(0, 10)}.json`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
