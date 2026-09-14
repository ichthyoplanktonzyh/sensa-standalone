/** SQLite-backed adapter for the Personal Meaning aggregate. */
import {
  assertCurrentLibrary,
  readLibrary,
  restoreLibraryTransaction,
} from '../../data/library/store';
import { StorageUnavailableError, type StoragePort } from './ports';

const TABLE = 'semanticWorld' as const;

const translate = (cause: unknown, action: string): never => {
  const detail = cause instanceof Error ? cause.message : String(cause);
  throw new StorageUnavailableError(`${action}（${detail}）`);
};

/**
 * One Journey aggregate is one SQLite record. The gateway owns its fact
 * schemas and idempotency receipts; this adapter owns only durable atomic I/O.
 */
export class LibraryJourneyStoragePort implements StoragePort {
  async read(key: string): Promise<string | null> {
    try {
      return (await readLibrary((tx) => tx.get<string>(TABLE, key))) ?? null;
    } catch (cause) {
      return translate(cause, '无法读取本机的个人意义数据。');
    }
  }

  async write(key: string, value: string): Promise<void> {
    try {
      await restoreLibraryTransaction(async (tx) => {
        await assertCurrentLibrary(tx);
        tx.put(TABLE, key, value);
      });
    } catch (cause) {
      translate(cause, '无法保存本机的个人意义数据。');
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await restoreLibraryTransaction(async (tx) => {
        await assertCurrentLibrary(tx);
        tx.delete(TABLE, key);
      });
    } catch (cause) {
      translate(cause, '无法删除本机的个人意义数据。');
    }
  }
}
