import type { SensaPinnedLanguageContext } from '@sensa/contracts/sensa';
/**
 * Low-level ports the Personal Meaning journey gateway depends on. React
 * components never read or write persistence directly; they talk to the
 * gateway, and the gateway talks to these injectable ports.
 */

/** A namespaced asynchronous string store. */
export interface StoragePort {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** A monotonic ISO-8601 clock (with offset) so facts carry stable timestamps. */
export interface ClockPort {
  nowIso(): string;
}

export const systemClock: ClockPort = {
  nowIso: () => new Date().toISOString(),
};

/** An in-memory store for the deterministic smoke and non-browser contexts. */
export class MemoryStoragePort implements StoragePort {
  private readonly map = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  async write(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async remove(key: string): Promise<void> {
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
