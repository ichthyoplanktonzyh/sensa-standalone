import {authorizeExtensionConnection} from './extensionConnection';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {useEffect,useState} from 'react';
import {canonicalConsumerJson,sensaBridgeNotificationSchema,sensaBridgeRequestChannel,sensaBridgeResponseChannel,sensaBridgeValue,type SensaBridgeKind,type SensaBridgePayload,type SensaBridgeValue} from '@sensa/contracts/sensa';
import {languageRoutesSnapshot} from '../../data/library/language';
import {readingGlossarySnapshot} from '../../data/library/glossary';
import {openLibrary,observeLibrary} from '../../data/library/store';
import {useSemanticIntake} from '../intake';

const digest = async (value: unknown): Promise<string> => Array.from(
 new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalConsumerJson(value)))),
 byte=>byte.toString(16).padStart(2,'0'),
).join('');
/**
 * One round trip on the page bridge.
 *
 * The protocol is declared once in the contracts, and this is the only thing on
 * this side that speaks it: the kind decides both the payload a caller may send
 * and the answer it receives, so a field the extension does not know, or an
 * answer read as the wrong shape, is a type error here rather than a request that
 * quietly does less than it says.
 */
function bridge<K extends SensaBridgeKind>(kind:K,accountId:string,libraryId:string,signal:AbortSignal,payload:SensaBridgePayload<K>):Promise<SensaBridgeValue<K>>{
 return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();
  // The whole answer goes to the contracts, which unwrap the envelope and throw
  // the extension's own code: a mismatch and an outage read differently above.
  const finish=(error?:string,response?:unknown)=>{clearTimeout(timer);window.removeEventListener('message',listener);signal.removeEventListener('abort',abort);if(error)reject(new Error(error));else try{resolve(sensaBridgeValue(kind,response));}catch(e){reject(e);}};
  const listener=(event:MessageEvent)=>{if(event.source===window&&event.origin===location.origin&&event.data?.channel===sensaBridgeResponseChannel&&event.data.id===id)finish(undefined,event.data);};
  const abort=()=>finish('interrupted');
  const timer=setTimeout(()=>finish('extension_unavailable'),15000);
  window.addEventListener('message',listener);signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){abort();return;}
  window.postMessage({channel:sensaBridgeRequestChannel,id,kind,accountId,libraryId,...payload},location.origin);
 });
}
/** Receives only explicitly saved extension requests into the existing content screens. */
export function ExtensionIntake({accountId,onlineService=false}:{accountId:string;onlineService?:boolean}){
 useTranslation();
 const intake=useSemanticIntake();
 const [error,setError]=useState('');
 const [reconnectNeeded,setReconnectNeeded]=useState(false),[connecting,setConnecting]=useState(false),[attempt,setAttempt]=useState(0);
 const reconnect=async(discardPending=false)=>{
  setConnecting(true);const controller=new AbortController();
  try{await bridge('web-connect-reset',accountId,(await openLibrary()).id,controller.signal,{receipt:{discardPending}});setError('');setReconnectNeeded(false);setAttempt(n=>n+1);}
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
     const connection=await bridge('web-connect-prepare',accountId,library.id,controller.signal,{});
     if(connection.paused)return;
     if(connection.authorization){
      const result=await authorizeExtensionConnection(connection.authorization,controller.signal);
      await bridge('web-connect-complete',accountId,library.id,controller.signal,{receipt:result});
     }
    }
    // Reading is a separate product surface. Publish the learner-owned Routes;
    // the extension keeps its own device selection and cannot edit Route facts.
    const {collection}=await languageRoutesSnapshot();
    await bridge('web-language-routes',accountId,library.id,controller.signal,{routes:collection});
    // The glossary the learner wrote is published the same way and for the same
    // reason: it is their own words, the extension cannot read the library, and a
    // reading prompt that named a stale copy would be using words they edited
    // away.
    const {glossary}=await readingGlossarySnapshot();
    await bridge('web-reading-glossary',accountId,library.id,controller.signal,{glossary});
    const requests=await bridge('web-intake-pull',accountId,library.id,controller.signal,{});
    for(const request of requests){
     if(controller.signal.aborted)return;
     let receipt;
     try{
      const {replayed:_replayed,...result}=await intake.submit(request.intake);
      receipt={contractVersion:'sensa-browser-intake-delivery-v1' as const,libraryId:request.libraryId,clientId:request.clientId,operationId:request.intake.operationId,requestDigest:await digest(request),result,appliedAt:new Date().toISOString()};
     }catch{if(!controller.signal.aborted){setReconnectNeeded(false);setError(localFlowText('intakeStorageFailed'));}return;}
     if(controller.signal.aborted)return;
     await bridge('web-intake-ack',accountId,library.id,controller.signal,{receipt});
    }
    setError('');setReconnectNeeded(false);
   }catch(e){if(!controller.signal.aborted){const code=e instanceof Error?e.message:'';const mismatch=['account_mismatch','library_mismatch'].includes(code);if(mismatch){setReconnectNeeded(true);setError(code==='library_mismatch'?localFlowText('extensionLibraryMismatch'):localFlowText('extensionAccountMismatch'));}}}
   finally{running=false;}
  };
  const notification=(event:MessageEvent)=>{if(event.source!==window||event.origin!==location.origin)return;const parsed=sensaBridgeNotificationSchema.safeParse(event.data);if(parsed.success&&parsed.data.accountId===accountId)void receive();};
  const resume=()=>void receive();
  const visible=()=>{if(document.visibilityState==='visible')void receive();};
  void receive();
  const stop=observeLibrary(()=>void receive(),['settings']);
  window.addEventListener('message',notification);
  window.addEventListener('focus',resume);
  window.addEventListener('online',resume);
  document.addEventListener('visibilitychange',visible);
  return()=>{controller.abort();stop();window.removeEventListener('message',notification);window.removeEventListener('focus',resume);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',visible);};
 },[accountId,onlineService,attempt,intake]);
 return error?<div role="status" className="fixed bottom-20 left-4 right-4 z-50 rounded-xl border border-feedback-warning bg-accent-soft p-3 text-sm"><p>{localFlowNotice(error)}</p>{reconnectNeeded&&onlineService&&<><button type="button" disabled={connecting} onClick={()=>void reconnect()} className="mt-2 rounded-lg border border-border-strong bg-surface-panel px-4 py-2 font-medium text-fg-primary disabled:opacity-50">{localFlowText(connecting?'extensionConnecting':'extensionReconnect')}</button><button type="button" hidden={error===localFlowText('extensionLibraryMismatch')} disabled={connecting} onClick={()=>void reconnect(true)} className="ml-2 mt-2 rounded-lg border border-feedback-danger bg-surface-panel px-4 py-2 font-medium text-feedback-danger disabled:opacity-50">{localFlowText('extensionDiscardReconnect')}</button></>}</div>:null;
}
