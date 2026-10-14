import {librarySyncLogicalByteLimit,librarySyncStageMetadataByteLimit} from '@sensa/contracts/sensa';
import {readLocalStorageBudget,type LocalStorageBudget} from './storagePersistence';

const mib=1024*1024;
/** Retained local text: one logical source, ordered refs and private witnesses. */
export const cloudScratchPayloadBytes=librarySyncLogicalByteLimit+librarySyncStageMetadataByteLimit+384*mib;
/** Local disk envelope; independent of cloud quota, binary size and RAM. */
export const cloudScratchDiskBytes=cloudScratchPayloadBytes+512*mib;
/** Allocated SQLite page growth, leaving 256 MiB for journal/high-water slack. */
export const cloudScratchAllocatedBytes=cloudScratchDiskBytes-256*mib;

/** Checks advisory origin quota before replacing scratch or appending a page.
 *
 * Unknown estimates fail closed. SQLite still enforces physical writes; this
 * reserve includes the existing 90 MiB singleton and is not a heap allowance.
 */
export async function requireCloudScratchSpace(begin:boolean,read:()=>Promise<LocalStorageBudget|null>=readLocalStorageBudget):Promise<void>{
 const budget=await read();
 if(!budget||!Number.isFinite(budget.quotaBytes)||!Number.isFinite(budget.usageBytes)||budget.usageBytes<0||budget.quotaBytes<=0)throw Error('library_sync_storage_unavailable');
 if(budget.quotaBytes-budget.usageBytes<(begin?cloudScratchDiskBytes:512*mib))throw Error('library_sync_capacity');
}
