import {sha256} from '@noble/hashes/sha2.js';
import type {SqliteRecordAdapter} from './sqliteAdapter';
import type {SnapshotSourceFence,SnapshotSourceProof,SnapshotSourceResult} from './sqliteSnapshotSource';

export const snapshotDigest=(bytes:Uint8Array)=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
export type SnapshotFileWork={readRequests:number;writeRequests:number;readAwaitMs:number;writeAwaitMs:number;copyMs:number;hashMs:number;hashedBytes:number;closeAwaitMs:number};
/** One explicitly owned directory, never an account or active Library namespace. */
export async function snapshotFiles(){
 const root=await navigator.storage.getDirectory(),name='sensa-snapshot-transfer-'+crypto.randomUUID(),directory=await root.getDirectoryHandle(name,{create:true});
 return {name,directory,async discard(){try{await root.removeEntry(name,{recursive:true});}catch(error){if(!(error instanceof DOMException)||error.name!=='NotFoundError')throw error;}}};
}
/** Incremental hash and exact size cap while bytes flow to OPFS. */
export async function writeSnapshotFile(directory:FileSystemDirectoryHandle,name:string,stream:ReadableStream<Uint8Array>,limit:number,signal:AbortSignal,progress?:(bytes:number)=>void,hashFile=true){
 signal.throwIfAborted();
 const writer=await(await directory.getFileHandle(name,{create:true})).createWritable(),reader=stream.getReader(),digest=hashFile?sha256.create():undefined;let bytes=0,complete=false;
 const io:SnapshotFileWork={readRequests:0,writeRequests:0,readAwaitMs:0,writeAwaitMs:0,copyMs:0,hashMs:0,hashedBytes:0,closeAwaitMs:0};
 const abort=()=>{void reader.cancel(signal.reason).catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{
  for(;;){signal.throwIfAborted();const readAt=performance.now(),next=await reader.read();io.readRequests++;io.readAwaitMs+=performance.now()-readAt;signal.throwIfAborted();if(next.done)break;bytes+=next.value.byteLength;if(bytes>limit)throw Error('library_sync_capacity');const copyAt=performance.now(),chunk=next.value.slice();io.copyMs+=performance.now()-copyAt;if(digest){const hashAt=performance.now();digest.update(chunk);io.hashMs+=performance.now()-hashAt;io.hashedBytes+=chunk.byteLength;}const writeAt=performance.now();await writer.write(chunk);io.writeRequests++;io.writeAwaitMs+=performance.now()-writeAt;progress?.(bytes);}
  const closeAt=performance.now();await writer.close();io.closeAwaitMs+=performance.now()-closeAt;signal.throwIfAborted();complete=true;return {file:await(await directory.getFileHandle(name)).getFile(),sha256:digest?snapshotDigest(digest.digest()):undefined,byteLength:bytes,io};
 }finally{signal.removeEventListener('abort',abort);if(!complete){await reader.cancel().catch(()=>{});await writer.abort().catch(()=>{});}reader.releaseLock();digest?.destroy();}
}

/** Complete each native read RPC before requesting another. Normal reads can
 * use the same leased Worker between chunks; writes cancel its copy first. */
export async function copySnapshotSource(adapter:SqliteRecordAdapter,fence:SnapshotSourceFence,files:Awaited<ReturnType<typeof snapshotFiles>>,signal:AbortSignal,progress?:(bytes:number)=>void,diagnosticHash=true){
 if(!adapter.snapshotSource)throw Error('sqlite_snapshot_unavailable');
 const send=(request:Parameters<NonNullable<SqliteRecordAdapter['snapshotSource']>>[0])=>adapter.snapshotSource!(request);let proof:SnapshotSourceProof|undefined,copied=false;
 const reads={rpcRequests:0,rpcWallMs:0,nativeReadMs:0};
 const discard=async()=>{signal.removeEventListener('abort',abort);if(proof)await send({action:'discard',id:proof.id}).catch(()=>{});};
 const abort=()=>{void discard();};signal.addEventListener('abort',abort,{once:true});
 try{
  signal.throwIfAborted();const begin=await send({action:'begin',fence});if(begin.kind!=='begun')throw Error('sqlite_snapshot_source_protocol');proof=begin.proof;signal.throwIfAborted();const id=proof.id;let offset=0;
  const stream=new ReadableStream<Uint8Array>({async pull(controller){try{signal.throwIfAborted();if(offset===proof!.byteLength){controller.close();return;}const at=performance.now(),chunk:SnapshotSourceResult=await send({action:'read',id,offset});reads.rpcRequests++;reads.rpcWallMs+=performance.now()-at;if(chunk.kind!=='chunk'||chunk.offset!==offset||!chunk.bytes.length||offset+chunk.bytes.length>proof!.byteLength)throw Error('sqlite_snapshot_source_protocol');reads.nativeReadMs+=chunk.nativeReadMs;offset+=chunk.bytes.length;controller.enqueue(chunk.bytes);}catch(error){controller.error(error);}}},{highWaterMark:0});
  const result=await writeSnapshotFile(files.directory,'source.sqlite3',stream,proof.byteLength,signal,progress,diagnosticHash);if(result.byteLength!==proof.byteLength)throw Error('sqlite_snapshot_source_incomplete');
  const ended=await send({action:'copied',id});if(ended.kind!=='copied')throw Error('sqlite_snapshot_source_protocol');copied=true;
  return {...result,reads,proof,verify:async()=>{signal.throwIfAborted();if((await send({action:'verify',id})).kind!=='verified')throw Error('sqlite_snapshot_source_protocol');},discard};
 }finally{if(!copied)await discard();}
}
