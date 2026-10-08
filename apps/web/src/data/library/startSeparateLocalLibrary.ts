import {localLibraryScopedName,assertSeparateLibraryStartSource,selectSeparateLocalLibrary} from './localLibraryLocation';
import {closeLocalLibraryStorage} from './sqliteAdapter';

/** Explicitly start an unconnected local library. The old physical pool is never cleared.
 * Current transactions settle before selection changes; other tabs are fenced and asked to reopen. */
export async function startSeparateLocalLibrary():Promise<void>{
 // A damaged selection is recoverable by explicit fresh start, not by guessing
 // an old pool. The selector retains the exact unreadable pointer and files.
 const source=assertSeparateLibraryStartSource();
 const transactionLock=localLibraryScopedName('sensa-library-transaction-v1',source??null);
 if(!navigator.locks||typeof navigator.storage?.getDirectory!=='function')throw new Error('localFlow.storageUnsupported');
 const {auth}=await import('../account/auth');
 let timer:ReturnType<typeof setTimeout>|undefined;
 const signedOut=await Promise.race([auth?.signOut({scope:'local'}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('localFlow.signoutIncomplete')),15_000);})]).finally(()=>clearTimeout(timer));
 if(signedOut?.error)throw new Error('localFlow.signoutIncomplete');
 await navigator.locks.request('sensa-library-selection-v1',{mode:'exclusive',signal:AbortSignal.timeout(15_000)},()=>
  navigator.locks.request(transactionLock,{mode:'exclusive',signal:AbortSignal.timeout(15_000)},()=>{selectSeparateLocalLibrary();}));
 // A damaged old connection may be unable to confirm cleanup. A separate pool
 // is still safe; retain its files/lease and never reuse or remove them here.
 await Promise.race([closeLocalLibraryStorage().catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(resolve,5_000);})]).finally(()=>clearTimeout(timer));
}
