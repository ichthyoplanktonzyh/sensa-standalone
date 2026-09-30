export type OperationSettlement<T> =
  | Readonly<{ kind: 'committed'; value: T; projection: 'current' }>
  | Readonly<{ kind: 'committed'; value: T; projection: 'stale'; refreshError: unknown }>
  | Readonly<{ kind: 'rejected'; error: unknown }>;

/**
 * Preserve the truth of a local intent separately from its read projection.
 * Once `execute` resolves, a failed projection refresh must never be reported
 * as though the durable command itself failed.
 */
export async function settleOperation<T>(
  execute: () => Promise<T>,
  refresh: () => Promise<void>,
): Promise<OperationSettlement<T>> {
  let value: T;
  try {
    value = await execute();
  } catch (error) {
    return { kind: 'rejected', error };
  }
  try {
    await refresh();
    return { kind: 'committed', value, projection: 'current' };
  } catch (refreshError) {
    return { kind: 'committed', value, projection: 'stale', refreshError };
  }
}
