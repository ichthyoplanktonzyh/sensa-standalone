const storageKey = 'sensa:account-deletion';

export interface PendingAccountDeletion {
  readonly subject: string;
  readonly email: string;
  readonly operationId: string;
}

export function pendingAccountDeletion(): PendingAccountDeletion | null {
  try {
    const pending = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    return pending
      && typeof pending.subject === 'string'
      && typeof pending.email === 'string'
      && typeof pending.operationId === 'string'
      ? pending
      : null;
  } catch {
    return null;
  }
}

export function storePendingAccountDeletion(pending: PendingAccountDeletion): void {
  localStorage.setItem(storageKey, JSON.stringify(pending));
}

export function clearPendingAccountDeletion(): void {
  localStorage.removeItem(storageKey);
}
