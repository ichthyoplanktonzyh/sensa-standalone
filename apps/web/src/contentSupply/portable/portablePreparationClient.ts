import type {SensaPortableBookDescriptor} from '@sensa/contracts/sensa';
import {preparePublishedBook,type PreparedPortableInstallation} from './portablePreparation';

/** Keep bounded ZIP/digest/canonical compilation off the UI thread. */
export async function preparePublishedBookOffThread(bytes:Uint8Array,descriptor:SensaPortableBookDescriptor,signal:AbortSignal):Promise<readonly PreparedPortableInstallation[]>{
 if(signal.aborted)throw new Error('localFlow.downloadCancelled');
 // The same pure implementation serves provider-free Node validation.
 if(typeof Worker==='undefined')return preparePublishedBook(bytes,descriptor);
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./portablePreparationWorker.ts',import.meta.url),{type:'module',name:'sensa-portable-admission'});
  const cleanup=()=>{signal.removeEventListener('abort',abort);worker.terminate();};
  const abort=()=>{cleanup();reject(new Error('localFlow.downloadCancelled'));};
  signal.addEventListener('abort',abort,{once:true});
  worker.onmessage=event=>{
   const response=event.data as {ok:true;value:readonly PreparedPortableInstallation[]}|{ok:false;message:string};
   cleanup();
   if(response.ok)resolve(response.value);else reject(new Error(response.message));
  };
  worker.onerror=()=>{cleanup();reject(new Error('localFlow.resourceInvalid'));};
  worker.onmessageerror=()=>{cleanup();reject(new Error('localFlow.resourceInvalid'));};
  try{worker.postMessage({bytes,descriptor},[bytes.buffer as ArrayBuffer]);}
  catch(cause){cleanup();reject(new Error('localFlow.resourceInvalid',{cause}));}
 });
}
