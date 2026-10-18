import type {Database,Sqlite3Static} from '@sqlite.org/sqlite-wasm';
// Batch native file I/O and RPC at the existing1MiB source-window bound.
export const snapshotSourceChunkBytes=1024*1024;
export const snapshotDatabaseByteLimit=4*1024**3;

/** Bounded public VFS reads, not a snapshot API. The caller must keep the
 * checkpointed main file immutable using its read transaction/sole owner. */
export function openSnapshotDatabaseFile(sqlite:Sqlite3Static,db:Database){
 const {capi:c,wasm:w}=sqlite;let file:InstanceType<typeof c.sqlite3_file>|undefined,io:InstanceType<typeof c.sqlite3_io_methods>|undefined,buffer:number|undefined,closed=false;
 const close=()=>{if(closed)return;closed=true;try{io?.dispose();}finally{try{file?.dispose();}finally{if(buffer!==undefined)w.dealloc(buffer);}}};
 try{
  const pointer=w.allocPtr(1);try{w.pokePtr(pointer,0);if(c.sqlite3_file_control(db.pointer!,'main',c.SQLITE_FCNTL_FILE_POINTER,pointer)!==0||!w.peekPtr(pointer))throw Error('sqlite_snapshot_source_file');file=new c.sqlite3_file(w.peekPtr(pointer));}finally{w.dealloc(pointer);}
  if(!file.$pMethods)throw Error('sqlite_snapshot_source_methods');io=new c.sqlite3_io_methods(file.$pMethods);
  const methods=io as unknown as {$iVersion:number;$xRead:number;$xFileSize:number};if(methods.$iVersion<1||!methods.$xRead||!methods.$xFileSize)throw Error('sqlite_snapshot_source_methods');
  const sizePointer=w.alloc(8);let byteLength:number;try{const size=w.functionEntry(methods.$xFileSize) as (file:number,pointer:number)=>number;if(size(file.pointer!,sizePointer)!==0)throw Error('sqlite_snapshot_source_size');byteLength=Number(w.peek64(sizePointer));}finally{w.dealloc(sizePointer);}
  if(!Number.isSafeInteger(byteLength)||byteLength<512||byteLength>snapshotDatabaseByteLimit||byteLength!==Number(db.selectValue('PRAGMA page_count'))*Number(db.selectValue('PRAGMA page_size')))throw Error('library_sync_capacity');
  buffer=w.alloc(snapshotSourceChunkBytes);const read=w.functionEntry(methods.$xRead) as (file:number,buffer:number,n:number,offset:bigint)=>number;
  return {byteLength,close,read(offset:number){
   if(closed||!Number.isSafeInteger(offset)||offset<0||offset>=byteLength)throw Error('sqlite_snapshot_source_offset');
   const n=Math.min(snapshotSourceChunkBytes,byteLength-offset);if(read(file!.pointer!,buffer!,n,BigInt(offset))!==0)throw Error('sqlite_snapshot_source_read');
   return w.heap8u().slice(buffer!,buffer!+n);
  }};
 }catch(error){close();throw error;}
}
