import type { SensaPinnedLanguageContext } from '@sensa/contracts/sensa';
import { previewStorage } from '../services/previewStorage';
/**
 * Low-level ports the Personal Meaning journey gateway depends on. React
 * components never read or write `localStorage` directly; they talk to the
 * gateway, and the gateway talks to these injectable ports. This keeps the
 * journey testable (the smoke injects an in-memory store and a fixed clock) and
 * keeps a clean seam for a future server-backed implementation.
 */

/** A namespaced key/value string store (the browser adapter wraps localStorage). */
export interface StoragePort {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/** A monotonic ISO-8601 clock (with offset) so facts carry stable timestamps. */
export interface ClockPort {
  nowIso(): string;
}

export const systemClock: ClockPort = {
  nowIso: () => new Date().toISOString(),
};

/**
 * Browser localStorage adapter. It surfaces read/parse failures to the caller
 * rather than silently swallowing them, so the UI can show an honest,
 * recoverable error instead of pretending the store is empty.
 */
export class LocalStoragePort implements StoragePort {
  read(key: string): string | null {
    if (typeof window === 'undefined' || !window.localStorage) {
      throw new StorageUnavailableError('本机存储在当前环境不可用。');
    }
    return previewStorage.getItem(key);
  }

  write(key: string, value: string): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      throw new StorageUnavailableError('本机存储在当前环境不可用，无法保存。');
    }
    previewStorage.setItem(key, value);
  }

  remove(key: string): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    previewStorage.removeItem(key);
  }
}

/** An in-memory store for the deterministic smoke and non-browser contexts. */
export class MemoryStoragePort implements StoragePort {
  private readonly map = new Map<string, string>();

  read(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  write(key: string, value: string): void {
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }
}

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

/** A fixed / incrementing clock for deterministic tests. */
export const createSeededClock = (
  startIso = '2026-09-01T00:00:00.000Z',
  stepMs = 1000,
): ClockPort => {
  let current = new Date(startIso).getTime();
  return {
    nowIso(): string {
      const iso = new Date(current).toISOString();
      current += stepMs;
      return iso;
    },
  };
};

/**
 * Resolves the active Route into a context for a new operation.
 *
 * It is a port rather than a direct read so a command resolves the languages
 * once, before it writes anything: a learner switching their active target
 * language in another tab must not split one command's facts across two
 * languages.
 */
export interface LearnerLanguagePort {
  read(): Promise<SensaPinnedLanguageContext>;
}

export type CommandLanguages = SensaPinnedLanguageContext;
