import type {AccountDeletionLocalScope} from '../../data/library/dataControl';
const storageKey = 'sensa:account-deletion';

export interface PendingAccountDeletion {
  readonly subject: string;
  readonly email: string;
  readonly operationId: string;
  readonly phase: 'verifying' | 'submitted';
  readonly localScope: AccountDeletionLocalScope;
  readonly signoutEpoch: string | null;
  readonly dismissed?: boolean;
}

export function pendingAccountDeletion(): PendingAccountDeletion | null {
  try {
    const pending = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    return pending
      && typeof pending.subject === 'string'
      && typeof pending.email === 'string'
      && typeof pending.operationId === 'string'
      && ['verifying','submitted'].includes(pending.phase)
      && typeof pending.localScope?.libraryId === 'string'
      && typeof pending.localScope?.incarnation === 'string'
      && (pending.signoutEpoch === null || typeof pending.signoutEpoch === 'string')
      ? pending
      : null;
  } catch {
    return null;
  }
}

async function locked<T>(work:()=>T):Promise<T>{
  return typeof navigator!=='undefined'&&navigator.locks
    ? navigator.locks.request('sensa-account-deletion-receipt',work):work();
}
export function storePendingAccountDeletion(pending: PendingAccountDeletion,options:{create?:boolean}={}): Promise<PendingAccountDeletion> {
  return locked(()=>{
    const current=pendingAccountDeletion();
    if(!current&&!options.create)throw Error('localFlow.deleteRetry');
    if(current&&current.operationId!==pending.operationId)throw Error('localFlow.deleteRetry');
    const next={...pending,phase:current?.phase==='submitted'?'submitted' as const:pending.phase};
    localStorage.setItem(storageKey,JSON.stringify(next));return next;
  });
}

export function clearPendingAccountDeletion(operationId: string,onlyUnsubmitted=false): Promise<void> {
  return locked(()=>{
    const current=pendingAccountDeletion();
    if(current?.operationId===operationId&&(!onlyUnsubmitted||current.phase==='verifying'))localStorage.removeItem(storageKey);
  });
}
