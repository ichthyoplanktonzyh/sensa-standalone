export type LocalStoragePersistence =
  | 'persistent'
  | 'best-effort'
  | 'unsupported'
  | 'unavailable';
export type LocalStorageBudget={usageBytes:number;quotaBytes:number};

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

/** Browser-provided origin estimate; values are advisory and may include app assets. */
export async function readLocalStorageBudget():Promise<LocalStorageBudget|null>{
 const storage=storageManager();
 if(!storage||typeof storage.estimate!=='function')return null;
 try{const estimate=await storage.estimate(),usage=estimate.usage,quota=estimate.quota;if(!Number.isFinite(usage)||!Number.isFinite(quota)||usage===undefined||quota===undefined||usage<0||quota<=0)return null;return {usageBytes:usage,quotaBytes:quota};}catch{return null;}
}
