import {authorizeExtensionConnection} from './extensionConnection';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {useEffect,useState} from 'react';
import {z} from 'zod';
import {localIntakeRequestSchema} from '@sensa/contracts/sensa';
import {openLibrary,observeLibrary} from '../../data/library/store';
import {receiveWebIntake} from '../../data/library/intake';
function bridge(kind:string,accountId:string,libraryId:string,signal:AbortSignal,receipt?:unknown):Promise<unknown>{
 return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();
  const finish=(error?:string,value?:unknown)=>{clearTimeout(timer);window.removeEventListener('message',listener);signal.removeEventListener('abort',abort);if(error)reject(new Error(error));else resolve(value);};
  const listener=(event:MessageEvent)=>{if(event.source===window&&event.origin===location.origin&&event.data?.channel==='sensa-web-intake-response'&&event.data.id===id)finish(event.data.error,event.data.value);};
  const abort=()=>finish('interrupted');
  const timer=setTimeout(()=>finish('extension_unavailable'),15000);
  window.addEventListener('message',listener);signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){abort();return;}
  window.postMessage({channel:'sensa-web-intake-request',id,kind,accountId,libraryId,receipt},location.origin);
 });
}
/** Receives only explicitly saved extension requests into the existing content screens. */
export function ExtensionIntake({accountId,onlineService=false}:{accountId:string;onlineService?:boolean}){
 useTranslation();
 const [error,setError]=useState('');
 const [reconnectNeeded,setReconnectNeeded]=useState(false),[connecting,setConnecting]=useState(false),[attempt,setAttempt]=useState(0);
 const reconnect=async(discardPending=false)=>{
  setConnecting(true);const controller=new AbortController();
  try{await bridge('web-connect-reset',accountId,(await openLibrary()).id,controller.signal,{discardPending});setError('');setReconnectNeeded(false);setAttempt(n=>n+1);}
  catch{setError(localFlowText('extensionReconnectFailed'));}
  finally{setConnecting(false);}
 };
 useEffect(()=>{
  const controller=new AbortController();let running=false;
  const receive=async()=>{
   if(running||controller.signal.aborted)return;running=true;
   try{
    const library=await openLibrary();
    if(onlineService){
     const connection=z.object({connected:z.boolean().optional(),paused:z.boolean().optional(),authorization:z.object({installationId:z.string().uuid(),state:z.string(),challenge:z.string(),redirectUri:z.string().url()}).optional()}).parse(await bridge('web-connect-prepare',accountId,library.id,controller.signal));
     if(connection.paused)return;
     if(connection.authorization){
      const result=await authorizeExtensionConnection(connection.authorization,controller.signal);
      await bridge('web-connect-complete',accountId,library.id,controller.signal,result);
     }
    }
    await bridge('web-delivery-config',accountId,library.id,controller.signal,null);
    const requests=z.array(localIntakeRequestSchema).max(10).parse(await bridge('web-intake-pull',accountId,library.id,controller.signal));
    for(const request of requests){
     if(controller.signal.aborted)return;
     const receipt=await receiveWebIntake(accountId,request);
     if(controller.signal.aborted)return;
     await bridge('web-intake-ack',accountId,library.id,controller.signal,receipt);
    }
    setError('');setReconnectNeeded(false);
   }catch(e){if(!controller.signal.aborted&&!(e instanceof Error&&['extension_unavailable','authentication_required'].includes(e.message))){const mismatch=e instanceof Error&&e.message==='account_mismatch';setReconnectNeeded(mismatch);setError(mismatch?localFlowText('extensionAccountMismatch'):localFlowText('intakeStorageFailed'));}}
   finally{running=false;}
  };
  void receive();const stop=observeLibrary(()=>void receive());const timer=setInterval(()=>void receive(),5000);return()=>{controller.abort();clearInterval(timer);stop();};
 },[accountId,onlineService,attempt]);
 return error?<div role="status" className="fixed bottom-20 left-4 right-4 z-50 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p>{localFlowNotice(error)}</p>{reconnectNeeded&&onlineService&&<><button type="button" disabled={connecting} onClick={()=>void reconnect()} className="mt-2 rounded-lg border border-slate-400 bg-white px-4 py-2 font-medium text-slate-900 disabled:opacity-50">{localFlowText(connecting?'extensionConnecting':'extensionReconnect')}</button><button type="button" disabled={connecting} onClick={()=>void reconnect(true)} className="ml-2 mt-2 rounded-lg border border-red-400 bg-white px-4 py-2 font-medium text-red-800 disabled:opacity-50">{localFlowText('extensionDiscardReconnect')}</button></>}</div>:null;
}
