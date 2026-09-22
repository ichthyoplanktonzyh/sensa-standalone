import {
  assertContentSupplyTransition,
  contentSupplyTransitionTables,
  ContentSupplyInvariantError,
} from './contentSupplyAuthority';
import {
  command,
  type LibraryIdentity,
  type LibraryTransaction,
  type Operation,
} from './store';

export async function admitContentSupplyTransaction(
  tx: LibraryTransaction,
  operation: Operation,
): Promise<void> {
  const changes = await tx.proposedChanges(contentSupplyTransitionTables);
  if (!changes.length) return;
  const identity = await tx.get<LibraryIdentity>('meta', 'identity');
  if (!identity) throw new ContentSupplyInvariantError('Content Supply has no Library identity.');
  await assertContentSupplyTransition({
    identity,
    operation,
    changes,
    read: (table, key) => tx.get(table, key),
  });
}

/** Run one local command and admit its complete Content Supply transition before commit. */
export function contentSupplyCommand<T>(
  operation: Operation,
  work: (tx: LibraryTransaction) => Promise<T>,
): Promise<T> {
  return command(operation, async (tx) => {
    const result = await work(tx);
    await admitContentSupplyTransaction(tx, operation);
    return result;
  });
}
