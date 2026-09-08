import type {ReadingRequest,CaptureSnapshot,SemanticLookupView} from '@sensa/contracts/sensa';
export const readingError=(error:unknown)=>({
  provider_not_configured:'请先在阅读设置中配置模型连接。',provider_vault_unavailable:'服务端尚未启用安全凭据存储，请联系服务维护者。',
  provider_origin_not_allowed:'此服务地址尚未获服务端支持，请使用设置中列出的服务。',provider_key_required:'请输入该连接的 API Key。',
  settings_conflict:'设置已在另一处更新，请重新加载后再保存。',provider_auth_failed:'模型连接认证失败，请检查密钥。',
  provider_rate_limited:'模型服务正在限流，请稍后重试。',reading_daily_budget:'今日阅读请求额度已用完，保存原文仍可使用。',
  reading_busy:'还有阅读请求正在处理，请稍后重试。',reading_timeout:'请求超时，请重试。',authentication_required:'请先连接 Sensa 账号。',
  account_mismatch:'账号已变化，请重新打开阅读模式。',provider_invalid_response:'模型返回的内容不完整，请重试。',
  reading_interrupted:'连接已中断，内容尚未完成，请重试。',
}[error instanceof Error?error.message:String(error)]??'暂时无法完成，请检查连接后重试。');
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
export async function runReading(accountId:string,feature:ReadingRequest['feature'],text:string,context='',instruction='',id=crypto.randomUUID(),progress?:(text:string)=>void,signal?:AbortSignal):Promise<string>{
  const payload={accountId,pageUrl:location.href,input:{id,feature,text,context,instruction}};
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
