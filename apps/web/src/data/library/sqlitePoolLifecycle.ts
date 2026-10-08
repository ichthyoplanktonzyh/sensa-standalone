export const sqliteSahPoolOwnerLock='sensa-sqlite-opfs-pool-v1';
export const sqliteSahPoolLockWaitMs=15_000;

type DirectoryEntry=readonly [string,FileSystemHandle];
type DirectoryWithEntries=FileSystemDirectoryHandle&{
  entries:()=>AsyncIterableIterator<DirectoryEntry>;
};
type SyncAccessHandle=Readonly<{close:()=>void}>;
type FileWithSyncHandle={
  createSyncAccessHandle:()=>Promise<SyncAccessHandle>;
};
type OpfsStorage=Pick<StorageManager,'getDirectory'>;

const isNotFound=(cause:unknown):boolean=>cause instanceof DOMException&&cause.name==='NotFoundError';

export class SahPoolProbeCloseError extends Error{
  constructor(cause:unknown){super('sqlite_sahpool_access_handle_probe_close_failed',{cause});}
}

/** Probe existing SAH files without changing them; fail before SQLite can initialize. */
export const assertSahPoolAccessHandlesFree=async(
  storage:OpfsStorage,
  poolDirectory:string,
):Promise<void>=>{
  let directory:DirectoryWithEntries=await storage.getDirectory() as DirectoryWithEntries;
  for(const segment of poolDirectory.split('/').filter(Boolean)){
    try{directory=await directory.getDirectoryHandle(segment) as DirectoryWithEntries;}
    catch(cause){if(isNotFound(cause))return;throw cause;}
  }
  let opaque:DirectoryWithEntries;
  try{opaque=await directory.getDirectoryHandle('.opaque') as DirectoryWithEntries;}
  catch(cause){if(isNotFound(cause))return;throw cause;}

  for await(const [,entry] of opaque.entries()){
    if(entry.kind!=='file')continue;
    let access:SyncAccessHandle|undefined;
    try{
      access=await (entry as unknown as FileWithSyncHandle).createSyncAccessHandle();
    }catch(cause){
      throw new Error('sqlite_sahpool_access_handle_busy_or_unavailable',{cause});
    }
    try{access.close();}
    catch(cause){throw new SahPoolProbeCloseError(cause);}
  }
};

export type SqliteSahPoolLease=Readonly<{release:()=>Promise<void>}>;

/** Hold one physical-pool Web Lock for the Worker VFS lifetime. */
export const acquireSqliteSahPoolLease=async(
  locks:Pick<LockManager,'request'>,
  ownerLock=sqliteSahPoolOwnerLock,
):Promise<SqliteSahPoolLease>=>{
  let grant!:()=>void;
  let rejectGrant!:(cause:unknown)=>void;
  let releaseHold!:()=>void;
  let acquired=false;
  const granted=new Promise<void>((resolve,reject)=>{grant=resolve;rejectGrant=reject;});
  const hold=new Promise<void>(resolve=>{releaseHold=resolve;});
  const owner=locks.request(ownerLock,{
    mode:'exclusive',
    signal:AbortSignal.timeout(sqliteSahPoolLockWaitMs),
  },async lock=>{
    if(!lock)throw new Error('sqlite_sahpool_owner_lock_unavailable');
    acquired=true;
    grant();
    await hold;
  });
  void owner.catch(cause=>{
    if(!acquired)rejectGrant(cause instanceof Error&&cause.name==='TimeoutError'
      ?new Error('sqlite_sahpool_owner_lock_timeout',{cause})
      :cause);
  });
  await granted;
  let released=false;
  return {
    release:async()=>{
      if(released)return;
      released=true;
      releaseHold();
      await owner;
    },
  };
};

/** Release the physical lease only after SQLite and every pooled OPFS handle are closed. */
export const closeSqliteSahPoolSafely=async(input:Readonly<{
  closeDatabase:()=>void;
  pauseVfs:()=>unknown;
  verifyAccessHandlesFree:()=>Promise<void>;
  releaseLease:()=>Promise<void>;
}>):Promise<void>=>{
  input.closeDatabase();
  input.pauseVfs();
  await input.verifyAccessHandlesFree();
  await input.releaseLease();
};

export const observeSahPoolPageHide=(
  target:Pick<EventTarget,'addEventListener'|'removeEventListener'>,
  close:()=>Promise<void>,
):(()=>void)=>{
  const onPageHide=()=>{void close().catch(()=>{});};
  target.addEventListener('pagehide',onPageHide);
  return ()=>target.removeEventListener('pagehide',onPageHide);
};

/** Failed pool initialization has no DB handle; still verify before releasing its lease. */
export const releaseSqliteSahPoolLeaseWhenFree=async(input:Readonly<{
  verifyAccessHandlesFree:()=>Promise<void>;
  releaseLease:()=>Promise<void>;
}>):Promise<void>=>{
  await input.verifyAccessHandlesFree();
  await input.releaseLease();
};
