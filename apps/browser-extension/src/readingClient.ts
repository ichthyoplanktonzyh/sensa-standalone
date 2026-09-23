import type {ReadingRequest,CaptureSnapshot,SemanticLookupView} from '@sensa/contracts/sensa';
import {errorText} from './i18n';
export const readingError=errorText;
function portRequest<T>(name:string,payload:unknown,progress:(text:string)=>void,signal?:AbortSignal):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
    const port=chrome.runtime.connect({name});let settled=false;
    const finish=(error?:string,value?:T)=>{if(settled)return;settled=true;clearTimeout(timeout);clearInterval(keepAlive);signal?.removeEventListener('abort',abort);port.disconnect();if(error)reject(new Error(error));else resolve(value!);};
    const abort=()=>finish('reading_interrupted');
    const timeout=setTimeout(abort,47000);
    const keepAlive=setInterval(()=>{if(!settled)port.postMessage({type:'ping'});},15000);
    port.onDisconnect.addListener(()=>finish('reading_interrupted'));
    port.onMessage.addListener(frame=>{
      if(settled)return;
      if(frame.type==='partial'&&typeof frame.text==='string'&&frame.text.length<=24000)progress(frame.text);
      else if(frame.type==='error')finish(frame.error);
      else if(frame.type==='result')finish(undefined,frame.value);
    });
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    port.postMessage(payload);
  });
}
/**
 * `sourceLanguageTag` is the language of `text` when this side established one,
 * or `null` when it did not. The learner's own pair is added by the background,
 * which is the only side that holds it, so a caller states what it observed and
 * never guesses which pair the request is about.
 */
export async function runReading(accountId:string,feature:ReadingRequest['feature'],text:string,context='',instruction='',id=crypto.randomUUID(),progress?:(text:string)=>void,signal?:AbortSignal,sourceLanguageTag:string|null=null):Promise<string>{
  const payload={accountId,pageUrl:location.href,input:{id,feature,text,context,instruction,sourceLanguageTag}};
  let result:{status:string;text?:string;error?:string};
  if(progress&&typeof chrome.runtime.connect==='function')result=await portRequest('sensa-reading-stream',payload,progress,signal);
  else{const response=await chrome.runtime.sendMessage({kind:'reading-run',...payload});if(response.error)throw new Error(response.error);result=response.value;}
  if(result.status!=='ready'||typeof result.text!=='string')throw new Error(result.error??'reading_busy');
  return result.text;
}
export async function runLookup(accountId:string,snapshot:CaptureSnapshot,id:string,progress:(text:string)=>void,signal?:AbortSignal):Promise<SemanticLookupView>{
  if(typeof chrome.runtime.connect==='function')return portRequest('sensa-lookup-stream',{accountId,pageUrl:location.href,input:{id,snapshot}},progress,signal);
  const response=await chrome.runtime.sendMessage({kind:'lookup',accountId,snapshot,lookupId:id});
  if(response.error)throw new Error(response.error);return response.value;
}
