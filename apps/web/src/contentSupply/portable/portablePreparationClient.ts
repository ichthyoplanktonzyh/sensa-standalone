import type {SensaPortableBookDescriptor} from '@sensa/contracts/sensa';
import {inspectPortablePackage,prepareStandalonePortablePackage,preparePublishedBook,type PreparedPortableInstallation} from './portablePreparation';

export type PortablePreparationRequest=
 |{kind:'book';bytes:Uint8Array;descriptor:SensaPortableBookDescriptor}
 |{kind:'preview';bytes:Uint8Array}
 |{kind:'package';bytes:Uint8Array;expectedArchiveDigest:string};

/** Keep bounded ZIP/digest/canonical compilation off the UI thread. */
export async function preparePublishedBookOffThread(bytes:Uint8Array,descriptor:SensaPortableBookDescriptor,signal:AbortSignal):Promise<readonly PreparedPortableInstallation[]>{
 return runPreparation({kind:'book',bytes,descriptor},signal,()=>preparePublishedBook(bytes,descriptor));
}

export function inspectPortablePackageOffThread(bytes:Uint8Array){
 // Preview and installation share the caller's original archive; don't detach it.
 return runPreparation({kind:'preview',bytes:bytes.slice()},new AbortController().signal,()=>inspectPortablePackage(bytes));
}

export function prepareStandalonePortablePackageOffThread(bytes:Uint8Array,expectedArchiveDigest:string,signal=new AbortController().signal){
 return runPreparation({kind:'package',bytes:bytes.slice(),expectedArchiveDigest},signal,()=>prepareStandalonePortablePackage(bytes,expectedArchiveDigest));
}

async function runPreparation<T>(request:PortablePreparationRequest,signal:AbortSignal,inProcess:()=>T):Promise<T>{
 if(signal.aborted)throw new Error('localFlow.downloadCancelled');
 // The same pure implementation serves provider-free Node validation.
 if(typeof Worker==='undefined')return inProcess();
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./portablePreparationWorker.ts',import.meta.url),{type:'module',name:'sensa-portable-admission'});
  const cleanup=()=>{signal.removeEventListener('abort',abort);worker.terminate();};
  const abort=()=>{cleanup();reject(new Error('localFlow.downloadCancelled'));};
  signal.addEventListener('abort',abort,{once:true});
  worker.onmessage=event=>{
   const response=event.data as {ok:true;value:T}|{ok:false;message:string};
   cleanup();
   if(response.ok)resolve(response.value);else reject(new Error(response.message));
  };
  worker.onerror=()=>{cleanup();reject(new Error('localFlow.resourceInvalid'));};
  worker.onmessageerror=()=>{cleanup();reject(new Error('localFlow.resourceInvalid'));};
  try{worker.postMessage(request,[request.bytes.buffer as ArrayBuffer]);}
  catch(cause){cleanup();reject(new Error('localFlow.resourceInvalid',{cause}));}
 });
}
