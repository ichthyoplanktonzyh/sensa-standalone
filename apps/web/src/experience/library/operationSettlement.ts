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

export type ReconciledOperation<T> = Exclude<OperationSettlement<T>,{kind:'rejected'}>
  | Readonly<{kind:'unconfirmed';error:unknown;projection:'current'}>
  | Readonly<{kind:'unconfirmed';error:unknown;projection:'stale';refreshError:unknown}>;

/** A missing response is not proof of rollback. Re-read durable truth without
 * re-executing the intent, and preserve uncertainty about its own receipt. */
export async function settleReconciledOperation<T>(execute:()=>Promise<T>,refresh:()=>Promise<void>):Promise<ReconciledOperation<T>>{
 const outcome=await settleOperation(execute,refresh);
 if(outcome.kind!=='rejected')return outcome;
 try{await refresh();return {kind:'unconfirmed',error:outcome.error,projection:'current'};}
 catch(refreshError){return {kind:'unconfirmed',error:outcome.error,projection:'stale',refreshError};}
}
