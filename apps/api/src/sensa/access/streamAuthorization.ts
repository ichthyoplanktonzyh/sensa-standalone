/** Bounds revocation detection without turning every streamed text fragment into
 * a database transaction. Start/final authorization stays with the caller. */
export function createStreamAuthorizationGate(
  revalidate: () => Promise<void>,
  options: Readonly<{ intervalMs?: number; now?: () => number }> = {},
): () => Promise<boolean> {
  const intervalMs = options.intervalMs ?? 2_000;
  const now = options.now ?? Date.now;
  if (!Number.isFinite(intervalMs) || intervalMs < 250) {
    throw new Error('stream_authorization_interval_invalid');
  }
  let checkedAt = now();
  let pending: Promise<void> | null = null;
  return async () => {
    if (pending) {
      await pending;
      return true;
    }
    const current = now();
    if (current - checkedAt < intervalMs) return false;
    checkedAt = current;
    pending = revalidate().finally(() => { pending = null; });
    await pending;
    return true;
  };
}
