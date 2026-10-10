import type { SensaPinnedLanguageContext } from '@sensa/contracts/sensa';
/**
 * Low-level ports the Personal Meaning journey gateway depends on. React
 * components never read or write persistence directly; they talk to the
 * gateway, and the gateway talks to these injectable ports.
 */

/** A monotonic ISO-8601 clock (with offset) so facts carry stable timestamps. */
export interface ClockPort {
  nowIso(): string;
}

export const systemClock: ClockPort = {
  nowIso: () => new Date().toISOString(),
};

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
/** Deterministic fact construction; persistence remains with the command executor. */
export interface JourneyFactPorts {
  newId(): string;
  nowIso(): string;
}
