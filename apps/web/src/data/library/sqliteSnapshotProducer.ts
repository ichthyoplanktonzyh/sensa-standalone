import {copySnapshotSource,snapshotFiles,type SnapshotFileWork} from './sqliteSnapshotFiles';
import type {SqliteRecordAdapter} from './sqliteAdapter';
import type {SnapshotSourceFence} from './sqliteSnapshotSource';
import type {AdmittedSnapshotMetadata,SnapshotNativeWork} from './sqliteAdmittedSnapshot';

export type SnapshotProducerProgress={stage:string;wallMs?:number;nativeCallWallMs?:number;asyncPhaseWallMs?:number;bytes?:number;totalBytes?:number;work?:SnapshotNativeWork};
export type ProducedSnapshotFile={file:File;sha256:string;byteLength:number;io:SnapshotFileWork;metadata:AdmittedSnapshotMetadata;work:SnapshotNativeWork;timingsMs:{wall:number;nativeCallWall:number;asyncPhaseWall:number}};

async function verifyTerminatedProducer(directoryName:string){
 const probe=new Worker(new URL('./sqliteSnapshotCleanupWorker.ts',import.meta.url),{type:'module',name:'Sensa snapshot cleanup'});
 try{await new Promise<void>((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('sqlite_snapshot_cleanup_timeout')),3000);
  probe.onmessage=({data})=>{clearTimeout(timeout);if(data.ok)resolve();else reject(Error(data.error));};
  probe.onerror=event=>{clearTimeout(timeout);reject(Error(event.message));};
  try{probe.postMessage({directoryName});}catch(error){clearTimeout(timeout);reject(error);}
 });}finally{probe.terminate();}
}

/** Owns source proof, temporary files and exactly one private Worker. Neither
 * preparation nor cancellation opens or removes the selected Library pool. */
export async function prepareAdmittedSnapshotFile(adapter:SqliteRecordAdapter,fence:SnapshotSourceFence,signal:AbortSignal,onProgress?:(progress:SnapshotProducerProgress)=>void){
 const files=await snapshotFiles();let source:Awaited<ReturnType<typeof copySnapshotSource>>|undefined,worker:Worker|undefined,producerStarted=false,handlesConfirmed=false;
 const discard=async()=>{worker?.terminate();worker=undefined;await source?.discard();try{
  if(producerStarted&&!handlesConfirmed){await verifyTerminatedProducer(files.name);handlesConfirmed=true;}
  await files.discard();
 }catch(cause){throw Error('sqlite_snapshot_cleanup_unconfirmed: '+files.name,{cause});}};
 try{
  // The intermediate is private and never transmitted. Its former digest had
  // no verifier; source fences and native admission remain the actual proof.
  // The final sanitized file still receives its mandatory transport digest.
  const copyAt=performance.now();source=await copySnapshotSource(adapter,fence,files,signal,bytes=>onProgress?.({stage:'source-copy',bytes}),false);const sourceTransfer={wallMs:performance.now()-copyAt,byteLength:source.byteLength,io:source.io,reads:source.reads};
  signal.throwIfAborted();worker=new Worker(new URL('./sqliteSnapshotProducerWorker.ts',import.meta.url),{type:'module',name:'Sensa snapshot preparation'});producerStarted=true;
  const result=await new Promise<ProducedSnapshotFile>((resolve,reject)=>{
   const abort=()=>{worker?.terminate();reject(signal.reason??Error('library_sync_cancelled'));};
   const done=()=>signal.removeEventListener('abort',abort);signal.addEventListener('abort',abort,{once:true});
   worker!.onerror=event=>{done();reject(Error(event.message||'sqlite_snapshot_producer_failed'));};
   worker!.onmessage=({data})=>{
    if(data.progress){try{onProgress?.(data.progress);}catch(error){done();reject(error);}return;}
    done();handlesConfirmed=!data.cleanupError;if(data.ok)resolve(data);else reject(Error(data.cleanupError?'sqlite_snapshot_producer_cleanup_unconfirmed: '+data.error+'; '+data.cleanupError:data.error));
   };
   if(signal.aborted){done();abort();return;}
   try{worker!.postMessage({source:source!.file,proof:source!.proof,directoryName:files.name,directory:files.directory});}catch(error){done();reject(error);}
  });
  worker.terminate();worker=undefined;await source.verify();
  return {...result,sourceTransfer,verify:source.verify,discard};
 }catch(error){try{await discard();}catch(cleanup){throw new AggregateError([error,cleanup],'sqlite_snapshot_cleanup_unconfirmed');}throw error;}
}
