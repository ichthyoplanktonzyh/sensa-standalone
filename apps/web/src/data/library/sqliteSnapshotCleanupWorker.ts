/// <reference lib="webworker" />
import {assertSahPoolAccessHandlesFree} from './sqlitePoolLifecycle';

/** After hard cancellation, independently probe only this attempt's private
 * pool. Never treat Worker termination alone as proof that handles closed. */
self.onmessage=async({data}:{data:{directoryName:string}})=>{
 try{
  if(!/^sensa-snapshot-transfer-[0-9a-f-]{36}$/u.test(data.directoryName))throw Error('sqlite_snapshot_cleanup_owner');
  const deadline=performance.now()+2000;
  for(;;){
   try{await assertSahPoolAccessHandlesFree(navigator.storage,'/'+data.directoryName+'/producer');break;}
   catch(error){if(performance.now()>=deadline||!(error instanceof Error)||error.message!=='sqlite_sahpool_access_handle_busy_or_unavailable')throw error;await new Promise(resolve=>setTimeout(resolve,25));}
  }
  self.postMessage({ok:true});
 }catch(error){self.postMessage({ok:false,error:String(error)+(error instanceof Error&&error.cause?'; cause='+String(error.cause):'')});}
};
