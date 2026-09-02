/**
 * Stable identity helpers for the Personal Meaning journey.
 *
 * Every durable identity (personal meaning, focus, revision, construction,
 * proposal, sense, alignment, binding, operation) is a bare RFC-4122 UUID so
 * that it matches the `@sensa/contracts` schemas. Identities are generated once
 * and then persisted; refreshing the page never regenerates a confirmed id.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_RE.test(value);

/** Generate a fresh v4 UUID, falling back when `crypto.randomUUID` is absent. */
export const newUuid = (): string => {
  const globalCrypto =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
      .slice(6, 8)
      .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }
  // Last-resort deterministic-enough fallback; still a well-formed v4 shape.
  const rand = () => Math.floor(Math.random() * 16).toString(16);
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return template.replace(/[xy]/gu, (char) => {
    if (char === 'y') return ((Math.floor(Math.random() * 4) + 8)).toString(16);
    return rand();
  });
};

/** A random-id port so the mock gateway can inject deterministic ids in tests. */
export interface RandomIdPort {
  next(): string;
}

export const cryptoRandomIdPort: RandomIdPort = {
  next: newUuid,
};

/**
 * A deterministic id port that yields well-formed UUIDs from a fixed seed.
 * Used by the journey smoke so a full run produces byte-stable output.
 */
export const createSeededIdPort = (seed = 1): RandomIdPort => {
  let counter = seed;
  return {
    next(): string {
      const value = counter;
      counter += 1;
      const hex = value.toString(16).padStart(12, '0');
      return `00000000-0000-4000-8000-${hex}`;
    },
  };
};
