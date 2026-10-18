import {copySnapshotSource,snapshotFiles} from '../../apps/web/src/data/library/sqliteSnapshotFiles';
import type {SqliteRecordAdapter} from '../../apps/web/src/data/library/sqliteAdapter';
import {prepareAdmittedSnapshotFile} from '../../apps/web/src/data/library/sqliteSnapshotProducer';
const worker=new Worker(new URL('./snapshotSourceBrowserWorker.ts',import.meta.url),{type:'module'}),pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();let id=0;
const ready=new Promise<void>(resolve=>{worker.addEventListener('message',({data})=>{if(data.ready){resolve();return;}const waiting=pending.get(data.id);if(!waiting)return;pending.delete(data.id);if(data.ok)waiting.resolve(data.value);else waiting.reject(Error(data.error));});});
const send=async(kind:string,input?:unknown)=>{await ready;const key=++id;return new Promise<any>((resolve,reject)=>{pending.set(key,{resolve,reject});worker.postMessage({id:key,kind,input});});};
const adapter={snapshotSource:(input:any)=>send('snapshotSource',input)} as SqliteRecordAdapter;
export async function roundtrip(){
 const files=await snapshotFiles(),fence=await send('fence'),probes:number[]=[];let running=true;
 const probe=(async()=>{while(running){const started=performance.now();await send('get');probes.push(performance.now()-started);await new Promise(resolve=>setTimeout(resolve,1));}})();
 try{let chunks=0;const copied=await copySnapshotSource(adapter,fence,files,new AbortController().signal,()=>chunks++);await copied.verify();const result=await send('checkCopy',copied.file);await copied.discard();return {byteLength:copied.byteLength,sha256:copied.sha256,chunks,probes,result};}
 finally{running=false;await probe;await files.discard();}
}
export async function interrupt(mode:'write'|'abort'|'close'){
 const files=await snapshotFiles(),fence=await send('fence'),controller=new AbortController();let fired=false,error:string|undefined;
 try{try{await copySnapshotSource(adapter,fence,files,controller.signal,()=>{if(fired)return;fired=true;if(mode==='write')void send('commit','survives-copy-cancellation');else if(mode==='abort')controller.abort(Error('test-cancel'));else void send('close');});}catch(cause){error=String(cause);}
  return {error,fired,...(mode!=='close'?{identity:await send('get'),write:await send('get','private-test-write')}: {})};
 }finally{await files.discard();}
}
export const candidateBusy=()=>send('candidateBusy');
export async function prepare(mode:'none'|'write'|'abort'|'abort-export'='none'){
 const fence=await send('fence'),progress:unknown[]=[],probes:number[]=[],controller=new AbortController();let running=true,fired=false,write:Promise<unknown>|undefined,result:Awaited<ReturnType<typeof prepareAdmittedSnapshotFile>>|undefined;
 const probe=(async()=>{while(running){const at=performance.now();await send('get');probes.push(performance.now()-at);await new Promise(resolve=>setTimeout(resolve,2));}})();
 try{
  result=await prepareAdmittedSnapshotFile(adapter,fence,controller.signal,step=>{progress.push(step);if(!fired&&step.stage==='private-source-imported'&&mode!=='abort-export'){fired=true;if(mode==='write')write=send('commit','survives-private-preparation');if(mode==='abort')controller.abort(Error('private-preparation-cancel'));}if(!fired&&mode==='abort-export'&&step.stage==='file-export'&&step.bytes!>0){fired=true;controller.abort(Error('private-export-cancel'));}});
  const checked=await send('checkCopy',result.file);await result.verify();return {checked,byteLength:result.byteLength,sha256:result.sha256,io:result.io,sourceTransfer:result.sourceTransfer,metadata:result.metadata,work:result.work,timingsMs:result.timingsMs,probes,progress};
 }catch(error){const retained:string[]=[];for await(const [name]of(await navigator.storage.getDirectory() as any).entries())if(name.startsWith('sensa-snapshot-transfer-'))retained.push(name);const details=(value:any):any=>({message:String(value),...(value?.cause?{cause:details(value.cause)}:{}),...(value instanceof AggregateError?{errors:value.errors.map(details)}:{})});return {error:String(error),errorDetails:details(error),identity:await send('get'),write:await send('get','private-test-write'),retained,probes,progress};}
 finally{running=false;await probe;await write;await result?.discard();}
}
export const close=async()=>{await send('close');worker.terminate();};
