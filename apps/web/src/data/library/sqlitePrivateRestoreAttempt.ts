import {assertIsolatedSnapshotNamespace,localLibraryPoolDirectory,validateLocalLibraryNamespace,unregisterIsolatedSnapshotNamespace} from './localLibraryLocation';
import {assertSahPoolAccessHandlesFree} from './sqlitePoolLifecycle';
const prefix='sensa:private-restore-attempt:v1:';
const lockName=(namespace:string)=>'sensa-private-restore-attempt-v1:'+namespace;
const tokenFor=(namespace:string)=>localStorage.getItem(prefix+namespace);
const forget=(namespace:string,token:string)=>{if(tokenFor(namespace)===token)localStorage.removeItem(prefix+namespace);};

/** Reclaims only this mechanism's abandoned, unselected private pools.
 *
 * A live attempt holds its namespace lock. A native-handle probe and the
 * selection lock protect other pages; unknown or retained pools are preserved.
 */
async function reclaimAbandonedPrivateRestores():Promise<void>{
 const attempts:Array<{namespace:string;token:string}>=[];
 for(let i=0;i<localStorage.length&&attempts.length<64;i++){
  const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;const namespace=key.slice(prefix.length),token=localStorage.getItem(key);try{if(validateLocalLibraryNamespace(namespace)&&token&&validateLocalLibraryNamespace(token))attempts.push({namespace,token});}catch{/* Unrecognized recovery data is retained. */}
 }
 for(const {namespace,token}of attempts)await navigator.locks.request(lockName(namespace),{mode:'exclusive',ifAvailable:true},async lock=>{
  if(!lock||tokenFor(namespace)!==token)return;
  await navigator.locks.request('sensa-library-selection-v1',{mode:'exclusive',signal:AbortSignal.timeout(15000)},async()=>{
   try{assertIsolatedSnapshotNamespace(namespace,false);}catch(cause){if(cause instanceof Error&&cause.message==='sqlite_snapshot_owner_namespace')forget(namespace,token);return;}
   if(tokenFor(namespace)!==token)return;
   try{
    await assertSahPoolAccessHandlesFree(navigator.storage,localLibraryPoolDirectory(namespace));
    const root=await navigator.storage.getDirectory();try{await root.removeEntry(localLibraryPoolDirectory(namespace).replace(/^\//u,''),{recursive:true});}catch(error){if(!(error instanceof DOMException)||error.name!=='NotFoundError')throw error;}
    unregisterIsolatedSnapshotNamespace(namespace);forget(namespace,token);
   }catch{/* A busy or uncertain pool keeps its exact recovery witness. */}
  });
 });
}

/** Holds and persists the exact ownership of one fresh restore namespace.
 *
 * Call complete only after activation succeeded or owned cleanup finished. Call release after its handles close and owned cleanup finishes.
 */
export async function beginPrivateRestoreAttempt(namespace:string):Promise<{complete:()=>void;release:()=>Promise<void>}>{
 assertIsolatedSnapshotNamespace(namespace,false);await reclaimAbandonedPrivateRestores();assertIsolatedSnapshotNamespace(namespace,false);
 const token=crypto.randomUUID();let unlock!:()=>void,acquired!:()=>void,reject!: (cause:unknown)=>void;
 const ready=new Promise<void>((resolve,fail)=>{acquired=resolve;reject=fail;}),held=new Promise<void>(resolve=>unlock=resolve);
 const lock=navigator.locks.request(lockName(namespace),{mode:'exclusive',signal:AbortSignal.timeout(15000)},async()=>{localStorage.setItem(prefix+namespace,token);acquired();await held;});void lock.catch(reject);await ready;
 return {complete:()=>forget(namespace,token),release:async()=>{unlock();await lock;}};
}
