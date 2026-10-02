/// <reference lib="webworker" />

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import sqliteWasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import type {SAHPoolUtil} from '@sqlite.org/sqlite-wasm';

type PoolOptions=Readonly<{
  directory:string;
  name:string;
  databaseFile:string;
  initialCapacity:number;
}>;

type WorkerRequest=PoolOptions&Readonly<{
  requestId:string;
  action:'createSentinel'|'initExpectedConflict'|'openAndRead'|'openAbruptly'|'holdSlots'|'probeSlots'|'releaseSlots'|'damageDigest'|'restoreDigest'|'inspectFile'|'createEmptySlot';
  sentinelKey?:string;
  sentinelValue?:string;
  slotCount?:number;
  fileName?:string;
  originalByte?:number;
}>;

type ErrorDetails=Readonly<{
  name:string;
  message:string;
  stack?:string;
  diagnostics?:Readonly<Record<string,unknown>>;
}>;
type WorkerResponse=Readonly<{
  requestId:string;
  ok:boolean;
  value?:unknown;
  error?:ErrorDetails;
}>;

type SQLiteModule=Awaited<ReturnType<typeof sqlite3InitModule>>&Readonly<{
  installOpfsSAHPoolVfs:(options:Readonly<{
    directory:string;
    name:string;
    initialCapacity:number;
    verbosity:0;
  }>)=>Promise<SAHPoolUtil>;
}>;

const scope=self as unknown as DedicatedWorkerGlobalScope;
const heldAccessHandles:Array<Readonly<{name:string;handle:FileSystemSyncAccessHandle}>>=[];
let activePool:SAHPoolUtil|undefined;
let activeDatabase:InstanceType<SAHPoolUtil['OpfsSAHPoolDb']>|undefined;

const errorDetails=(cause:unknown):ErrorDetails=>cause instanceof Error
  ?{
    name:cause.name,
    message:cause.message,
    ...(cause.stack?{stack:cause.stack}:{}),
    ...('diagnostics' in cause&&cause.diagnostics&&typeof cause.diagnostics==='object'
      ?{diagnostics:cause.diagnostics as Readonly<Record<string,unknown>>}:{}),
  }
  :{name:'Error',message:String(cause)};

const sqliteModule=async():Promise<SQLiteModule>=>{
  const initialize=sqlite3InitModule as unknown as (options?:Readonly<{
    locateFile?:(path:string)=>string;
  }>)=>Promise<SQLiteModule>;
  return initialize({locateFile:path=>path.endsWith('.wasm')?sqliteWasmUrl:path});
};

const installPool=async(options:PoolOptions):Promise<Readonly<{
  sqlite3:SQLiteModule;
  pool:SAHPoolUtil;
}>>=>{
  const sqlite3=await sqliteModule();
  const pool=await sqlite3.installOpfsSAHPoolVfs({
    directory:options.directory,
    name:options.name,
    initialCapacity:options.initialCapacity,
    verbosity:0,
  });
  return {sqlite3,pool};
};

const scalar=(database:InstanceType<SAHPoolUtil['OpfsSAHPoolDb']>,sql:string):string=>{
  const rows=database.exec({sql,rowMode:'array',returnValue:'resultRows'}) as unknown[][];
  return String(rows[0]?.[0]??'');
};

const closeDatabaseAndPausePool=():Readonly<{
  pausedAfterClose:boolean;
  unpauseApiStillAvailable:boolean;
}>=>{
  const database=activeDatabase;
  const pool=activePool;
  activeDatabase=undefined;
  activePool=undefined;
  let closeFailure:unknown;
  let pauseFailure:unknown;
  try{database?.close();}catch(cause){closeFailure=cause;}
  try{pool?.pauseVfs();}catch(cause){pauseFailure=cause;}
  if(closeFailure||pauseFailure){
    throw new AggregateError(
      [closeFailure,pauseFailure].filter((cause):cause is unknown=>cause!==undefined),
      'sqlite_sahpool_normal_close_failed',
    );
  }
  const pausedAfterClose=pool?.isPaused()??false;
  const unpauseApiStillAvailable=typeof pool?.unpauseVfs==='function';
  if(pool&&!pausedAfterClose)throw new Error('sqlite_sahpool_pause_state_not_retained');
  if(pool&&!unpauseApiStillAvailable)throw new Error('sqlite_sahpool_unpause_api_removed');
  return {pausedAfterClose,unpauseApiStillAvailable};
};

const poolOpaqueDirectory=async(directoryName:string):Promise<FileSystemDirectoryHandle>=>{
  let directory=await navigator.storage.getDirectory();
  for(const segment of directoryName.split('/').filter(Boolean)){
    directory=await directory.getDirectoryHandle(segment);
  }
  return directory.getDirectoryHandle('.opaque');
};

const fileDigest=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))
  .map(value=>value.toString(16).padStart(2,'0')).join('');

/** Fault injection is limited to the isolated test pool and its named sentinel file. */
const editDigest=async(request:WorkerRequest):Promise<unknown>=>{
  const directory=await poolOpaqueDirectory(request.directory);
  for await(const [name,entry] of directory.entries()){
    if(entry.kind!=='file'||(request.fileName&&name!==request.fileName))continue;
    const handle=await (entry as FileSystemFileHandle).createSyncAccessHandle();
    try{
      const header=new Uint8Array(524);
      if(handle.read(header,{at:0})!==header.length)continue;
      const pathEnd=header.subarray(0,512).indexOf(0);
      const path=new TextDecoder().decode(header.subarray(0,pathEnd));
      if(path!==request.databaseFile)continue;
      const before=new Uint8Array(handle.getSize());
      if(handle.read(before,{at:0})!==before.length)throw new Error('fixture_file_read_short');
      const originalByte=request.action==='damageDigest'?header[516]!:request.originalByte;
      if(originalByte===undefined||!Number.isInteger(originalByte)||originalByte<0||originalByte>255)throw new Error('fixture_original_byte_invalid');
      if(request.action==='restoreDigest'&&header[516]!==((originalByte^1)&255))throw new Error('fixture_header_changed');
      const value=request.action==='damageDigest'?originalByte^1:originalByte;
      handle.write(Uint8Array.of(value),{at:516});handle.flush();
      const after=before.slice();after[516]=value;
      return {fileName:name,originalByte,size:before.length,beforeDigest:await fileDigest(before),afterDigest:await fileDigest(after)};
    }finally{handle.close();}
  }
  throw new Error('fixture_database_file_missing');
};

const inspectFile=async(request:WorkerRequest):Promise<unknown>=>{
  if(!request.fileName)throw new Error('fixture_file_name_missing');
  const directory=await poolOpaqueDirectory(request.directory);
  const file=await(await directory.getFileHandle(request.fileName)).getFile();
  const bytes=new Uint8Array(await file.arrayBuffer());
  let fileCount=0;for await(const [,entry] of directory.entries())if(entry.kind==='file')fileCount++;
  return {size:file.size,digest:await fileDigest(bytes),fileCount};
};

/** Reproduce addCapacity() stopping between fresh file creation and its header write. */
const createEmptySlot=async(request:WorkerRequest):Promise<unknown>=>{
  const directory=await poolOpaqueDirectory(request.directory);
  const fileName=`empty-${crypto.randomUUID()}`;
  const file=await(await directory.getFileHandle(fileName,{create:true})).getFile();
  if(file.size!==0)throw new Error('fixture_empty_slot_not_empty');
  return {fileName,size:file.size};
};

const createSentinel=async(request:WorkerRequest):Promise<unknown>=>{
  if(!request.sentinelKey||!request.sentinelValue)throw new Error('sentinel_input_missing');
  const {sqlite3,pool}=await installPool(request);
  activePool=pool;
  try{
    const database=new pool.OpfsSAHPoolDb(request.databaseFile);
    activeDatabase=database;
    database.exec('PRAGMA locking_mode=EXCLUSIVE');
    database.exec('PRAGMA journal_mode=DELETE');
    database.exec('PRAGMA synchronous=FULL');
    database.exec('CREATE TABLE recovery_sentinel (sentinel_key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID');
    database.exec({
      sql:'INSERT INTO recovery_sentinel(sentinel_key,value) VALUES(?,?)',
      bind:[request.sentinelKey,request.sentinelValue],
    });
    const rows=database.exec({
      sql:'SELECT value FROM recovery_sentinel WHERE sentinel_key=?',
      bind:[request.sentinelKey],
      rowMode:'array',
      returnValue:'resultRows',
    }) as unknown[][];
    const storedValue=String(rows[0]?.[0]??'');
    if(storedValue!==request.sentinelValue)throw new Error('sentinel_write_verification_failed');
    const result={
      sqliteVersion:sqlite3.version.libVersion,
      capacity:pool.getCapacity(),
      sentinelValue:storedValue,
      integrity:scalar(database,'PRAGMA quick_check(1)'),
    };
    return {...result,pauseState:closeDatabaseAndPausePool()};
  }finally{
    if(activeDatabase||activePool)closeDatabaseAndPausePool();
  }
};

const initExpectedConflict=async(request:WorkerRequest):Promise<unknown>=>{
  const sqlite3=await sqliteModule();
  try{
    const pool=await sqlite3.installOpfsSAHPoolVfs({
      directory:request.directory,
      name:request.name,
      initialCapacity:request.initialCapacity,
      verbosity:0,
    });
    activePool=pool;
    return {
      unexpectedSuccess:true,
      sqliteVersion:sqlite3.version.libVersion,
      capacity:pool.getCapacity(),
    };
  }catch(cause){
    const error=new Error(cause instanceof Error?cause.message:String(cause),{cause});
    error.name=cause instanceof Error?cause.name:'Error';
    Object.assign(error,{diagnostics:{vfsRegistered:Boolean(sqlite3.capi.sqlite3_vfs_find(request.name))}});
    throw error;
  }finally{
    if(activePool)closeDatabaseAndPausePool();
  }
};

const openAndRead=async(request:WorkerRequest,leaveOpen:boolean):Promise<unknown>=>{
  if(!request.sentinelKey)throw new Error('sentinel_key_missing');
  const {sqlite3,pool}=await installPool(request);
  activePool=pool;
  try{
    const database=new pool.OpfsSAHPoolDb(request.databaseFile);
    activeDatabase=database;
    database.exec('PRAGMA locking_mode=EXCLUSIVE');
    const rows=database.exec({
      sql:'SELECT value FROM recovery_sentinel WHERE sentinel_key=?',
      bind:[request.sentinelKey],
      rowMode:'array',
      returnValue:'resultRows',
    }) as unknown[][];
    const value=String(rows[0]?.[0]??'');
    const integrity=scalar(database,'PRAGMA quick_check(1)');
    const capacity=pool.getCapacity();
    if(leaveOpen){
      return {
        sqliteVersion:sqlite3.version.libVersion,
        capacity,
        sentinelValue:value,
        integrity,
        workerStorageLeftOpen:true,
      };
    }
    const pauseState=closeDatabaseAndPausePool();
    return {
      sqliteVersion:sqlite3.version.libVersion,
      capacity,
      sentinelValue:value,
      integrity,
      workerStorageLeftOpen:false,
      pauseState,
    };
  }catch(cause){
    if(!leaveOpen){
      try{closeDatabaseAndPausePool();}catch(cleanupCause){
        throw new AggregateError([cause,cleanupCause],'sqlite_sahpool_recovery_cleanup_failed');
      }
    }
    throw cause;
  }
};

const holdSlots=async(request:WorkerRequest):Promise<unknown>=>{
  const directory=await poolOpaqueDirectory(request.directory);
  const fileEntries:Array<Readonly<{name:string;handle:FileSystemFileHandle}>>=[];
  for await(const [name,handle] of directory.entries()){
    if(handle.kind==='file')fileEntries.push({name,handle:handle as FileSystemFileHandle});
  }
  const requestedCount=request.slotCount??1;
  if(requestedCount<1||fileEntries.length<requestedCount){
    throw new Error(`pool_slots_unavailable:${fileEntries.length}:${requestedCount}`);
  }
  try{
    for(const entry of fileEntries.slice(0,requestedCount)){
      heldAccessHandles.push({name:entry.name,handle:await entry.handle.createSyncAccessHandle()});
    }
  }catch(cause){
    for(const entry of heldAccessHandles.splice(0))entry.handle.close();
    throw cause;
  }
  return {slotCount:fileEntries.length,heldNames:heldAccessHandles.map(entry=>entry.name)};
};

const probeSlots=async(request:WorkerRequest):Promise<unknown>=>{
  const directory=await poolOpaqueDirectory(request.directory);
  const openedNames:string[]=[];
  const busySlots:Array<Readonly<{name:string;errorName:string}>>=[];
  for await(const [name,entry] of directory.entries()){
    if(entry.kind!=='file')continue;
    try{
      const handle=await (entry as FileSystemFileHandle).createSyncAccessHandle();
      openedNames.push(name);
      handle.close();
    }catch(cause){
      if(cause instanceof DOMException&&cause.name==='NoModificationAllowedError'){
        busySlots.push({name,errorName:cause.name});
      }else throw cause;
    }
  }
  return {slotCount:openedNames.length+busySlots.length,openedNames,busySlots};
};

const releaseHeldSlots=():unknown=>{
  const errors:ErrorDetails[]=[];
  for(const entry of heldAccessHandles.splice(0)){
    try{entry.handle.close();}
    catch(cause){errors.push(errorDetails(cause));}
  }
  if(errors.length)throw new AggregateError(errors.map(error=>new Error(error.message)),'sqlite_sahpool_slot_release_failed');
  return {released:true};
};

const respond=(requestId:string,ok:boolean,value?:unknown,error?:unknown):void=>{
  scope.postMessage({
    requestId,
    ok,
    ...(ok?{value}:{error:errorDetails(error)}),
  } satisfies WorkerResponse);
};

scope.addEventListener('message',(event:MessageEvent<WorkerRequest>)=>{
  const request=event.data;
  void (async()=>{
    switch(request.action){
      case 'createSentinel':return createSentinel(request);
      case 'initExpectedConflict':return initExpectedConflict(request);
      case 'openAndRead':return openAndRead(request,false);
      case 'openAbruptly':return openAndRead(request,true);
      case 'holdSlots':return holdSlots(request);
      case 'probeSlots':return probeSlots(request);
      case 'releaseSlots':return releaseHeldSlots();
      case 'damageDigest':case 'restoreDigest':return editDigest(request);
      case 'inspectFile':return inspectFile(request);
      case 'createEmptySlot':return createEmptySlot(request);
    }
  })().then(
    value=>respond(request.requestId,true,value),
    cause=>respond(request.requestId,false,undefined,cause),
  );
});
