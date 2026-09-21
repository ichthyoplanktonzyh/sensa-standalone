export type LocalStoragePersistence =
  | 'persistent'
  | 'best-effort'
  | 'unsupported'
  | 'unavailable';

const storageManager = (): StorageManager | null =>
  typeof navigator === 'undefined' ? null : navigator.storage ?? null;

/** Read the browser's current eviction guarantee without prompting the user. */
export async function readLocalStoragePersistence(): Promise<LocalStoragePersistence> {
  const storage = storageManager();
  if (!storage || typeof storage.persisted !== 'function') return 'unsupported';
  try {
    return await storage.persisted() ? 'persistent' : 'best-effort';
  } catch {
    return 'unavailable';
  }
}

/** Request stronger eviction protection only from an explicit user action. */
export async function requestLocalStoragePersistence(): Promise<LocalStoragePersistence> {
  const storage = storageManager();
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';
  try {
    if (typeof storage.persisted === 'function' && await storage.persisted()) return 'persistent';
    return await storage.persist() ? 'persistent' : 'best-effort';
  } catch {
    return 'unavailable';
  }
}
