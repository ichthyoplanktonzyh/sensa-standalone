/// <reference lib="webworker" />
import initialize from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import type {Database,SAHPoolUtil} from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from './sqliteDatabase';
import {sqliteLibraryFile,sqliteLibrarySchema} from './sqliteProtocol';
import {portableSnapshotSchema,portableSnapshotVersions,restrictPortableSnapshot} from './sqlitePortableSnapshot';
import {sanitizeAdmittedSnapshot} from './sqliteAdmittedSnapshot';
import {openSnapshotDatabaseFile,snapshotDatabaseByteLimit} from './sqliteSnapshotFile';
import {writeSnapshotFile} from './sqliteSnapshotFiles';
import {assertSahPoolAccessHandlesFree} from './sqlitePoolLifecycle';
import type {SnapshotSourceProof} from './sqliteSnapshotSource';

type Input={source:File;proof:SnapshotSourceProof;directoryName:string;directory:FileSystemDirectoryHandle};
let used=false;
self.onmessage=async({data}:{data:Input})=>{
 if(used)return;used=true;
 const started=performance.now();let nativeCallWallMs=0,asyncPhaseWallMs=0,pool:SAHPoolUtil|undefined,library:SqliteRecordDatabase|undefined,raw:Database|undefined,output:Database|undefined;
 const poolDirectory='/'+data.directoryName+'/producer';
 const step=(stage:string,value:Record<string,unknown>={})=>self.postMessage({progress:{stage,wallMs:performance.now()-started,nativeCallWallMs,asyncPhaseWallMs,...value}});
 const native=<T>(work:()=>T)=>{const at=performance.now();try{return work();}finally{nativeCallWallMs+=performance.now()-at;}};
 const wait=async<T>(work:Promise<T>)=>{const at=performance.now(),nativeBefore=nativeCallWallMs;try{return await work;}finally{asyncPhaseWallMs+=performance.now()-at-(nativeCallWallMs-nativeBefore);}};
 try{
  if(!/^sensa-snapshot-transfer-[0-9a-f-]{36}$/u.test(data.directoryName)||data.source.size!==data.proof.byteLength||data.source.size>snapshotDatabaseByteLimit)throw Error('sqlite_snapshot_source_binding');
  const init=initialize as unknown as(options:{locateFile:(name:string)=>string})=>ReturnType<typeof initialize>;
  const sqlite=await wait(init({locateFile:name=>name.endsWith('.wasm')?wasmUrl:name}));
  pool=await wait(sqlite.installOpfsSAHPoolVfs({name:'snapshot-producer-'+crypto.randomUUID(),directory:poolDirectory,initialCapacity:6}));
  if(pool.getFileNames().length)throw Error('sqlite_snapshot_requires_fresh_files');
  const reader=data.source.stream().getReader();let importedBytes=0;
  try{await wait(pool.importDb(sqliteLibraryFile,async()=>{const next=await reader.read();if(next.done)return undefined;importedBytes+=next.value.byteLength;if(importedBytes>data.source.size)throw Error('sqlite_snapshot_source_binding');return next.value;}));}finally{reader.releaseLock();}
  if(importedBytes!==data.source.size)throw Error('sqlite_snapshot_source_binding');
  step('private-source-imported',{bytes:importedBytes});
  const expectedRaw=new sqlite.oo1.DB(':memory:','c'),expectedLibrary=new SqliteRecordDatabase(sqlite,expectedRaw,'memory');
  let expected:Parameters<typeof sanitizeAdmittedSnapshot>[3];
  try{native(()=>expectedLibrary.initialize());expected={schema:portableSnapshotSchema(expectedRaw),versions:portableSnapshotVersions(expectedRaw)};}finally{expectedLibrary.close(false);}
  raw=new pool.OpfsSAHPoolDb(sqliteLibraryFile);restrictPortableSnapshot(sqlite,raw);raw.exec(sqliteLibrarySchema.slice(0,sqliteLibrarySchema.indexOf('CREATE TABLE')));
  library=new SqliteRecordDatabase(sqlite,raw,'opfs');
  const admitted=native(()=>sanitizeAdmittedSnapshot(sqlite,raw!,data.proof,expected,(stage,work)=>step(stage,{work})));
  await wait(pool.reserveMinimumCapacity(pool.getFileCount()+4));
  const outputName='/snapshot-output.sqlite3';native(()=>raw!.exec({sql:'VACUUM INTO ?',bind:[outputName]}));step('vacuum-complete',{work:admitted.work});
  library.close(false);library=undefined;raw=undefined;
  output=new pool.OpfsSAHPoolDb(outputName);output.exec('PRAGMA locking_mode=EXCLUSIVE;BEGIN;SELECT count(*) FROM sqlite_schema');
  const fileReader=openSnapshotDatabaseFile(sqlite,output);let offset=0,lastProgress=0;
  try{
   const stream=new ReadableStream<Uint8Array>({pull(controller){
    if(offset===fileReader.byteLength){controller.close();return;}
    const bytes=native(()=>fileReader.read(offset));offset+=bytes.byteLength;controller.enqueue(bytes);
   }},{highWaterMark:0});
   const result=await wait(writeSnapshotFile(data.directory,'snapshot.sqlite3',stream,fileReader.byteLength,new AbortController().signal,bytes=>{if(!lastProgress||bytes-lastProgress>=4*1024*1024){lastProgress=bytes;step('file-export',{bytes,totalBytes:fileReader.byteLength});}}));
   if(result.byteLength!==fileReader.byteLength)throw Error('sqlite_snapshot_source_incomplete');
   if(!result.sha256||result.io.hashedBytes!==result.byteLength)throw Error('sqlite_snapshot_digest_missing');
   fileReader.close();output.exec('ROLLBACK');output.close();output=undefined;pool.pauseVfs();
   await wait(assertSahPoolAccessHandlesFree(navigator.storage,poolDirectory));pool=undefined;
   self.postMessage({ok:true,...result,...admitted,timingsMs:{wall:performance.now()-started,nativeCallWall:nativeCallWallMs,asyncPhaseWall:asyncPhaseWallMs}});
  }finally{fileReader.close();}
 }catch(error){
  let cleanupError:unknown;
  try{if(output){output.close();output=undefined;}if(library){library.close(false);library=undefined;raw=undefined;}else raw?.close();pool?.pauseVfs();await assertSahPoolAccessHandlesFree(navigator.storage,poolDirectory);}catch(cause){cleanupError=cause;}
  self.postMessage({ok:false,error:String(error),...(cleanupError?{cleanupError:String(cleanupError)}:{}),timingsMs:{wall:performance.now()-started,nativeCallWall:nativeCallWallMs,asyncPhaseWall:asyncPhaseWallMs}});
 }
};
