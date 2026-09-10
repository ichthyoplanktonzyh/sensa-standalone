import {z} from 'zod';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {auth} from '../consumer/client';
import {clearCredential,providerCredential,providerSnapshot,type Provider,type Purpose} from './providers';
export type ModelMessage={role:'system'|'user'|'assistant'|'tool';content:string|null;tool_call_id?:string;tool_calls?:{id:string;type:'function';function:{name:string;arguments:string}}[]};
export type ModelTool={type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}};
export const completionSchema=z.object({model:z.string().max(200),choices:z.array(z.object({finish_reason:z.enum(['stop','tool_calls']),message:z.object({content:z.string().max(32000).nullable().optional(),tool_calls:z.array(z.object({id:z.string().min(1).max(100),type:z.literal('function'),function:z.object({name:z.string().max(100),arguments:z.string().max(32000)}).strict()}).strict()).max(4).optional()}).passthrough()}).passthrough()).length(1)}).passthrough();
export const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalConsumerJson(value)))),b=>b.toString(16).padStart(2,'0')).join('');
export async function complete(provider:Provider,purpose:Purpose,id:string,messages:ModelMessage[],tools:ModelTool[],signal:AbortSignal){
 const base=new URL(provider.endpoint),body={model:provider.model,messages,...(tools.length?{tools}:{}),max_tokens:3000,stream:false as const,...(purpose==='review'?{response_format:{type:'json_object' as const}}:{})};
 if(messages.length>100||new TextEncoder().encode(JSON.stringify(body)).length>256*1024)throw new Error('本次对话已达到长度上限，请保存现有结果。');
 let endpoint=provider.endpoint+'/chat/completions',payload:unknown=body,key:string,subject:string|undefined;
 if(provider.kind==='sensa'){
  const configured=import.meta.env.VITE_SENSA_API_URL as string|undefined;
  if(!configured||provider.endpoint!==configured.replace(/\/+$/u,''))throw new Error('Sensa 连接需要使用当前应用配置的服务地址。');
  if(!auth)throw new Error('Sensa 登录服务暂不可用，请稍后重试。');
  const {data,error}=await auth.getSession();if(error||!data.session)throw new Error('请先登录 Sensa 在线服务。本机资料仍然保留。');
  key=data.session.access_token;subject=data.session.user.id;endpoint=provider.endpoint+'/sensa/native/agent/turn';
  const input={id,purpose,body};payload={...input,inputDigest:await digest(input)};
 }else{key=await providerCredential(provider);payload={...body,...(base.hostname==='api.deepseek.com'?{thinking:{type:'disabled'}}:{})};}
 const response=await fetch(endpoint,{method:'POST',redirect:'error',credentials:'omit',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});
 if(response.status===401||response.status===403){clearCredential(provider.id);throw new Error('当前服务拒绝访问，请检查登录或更新 Key 后再继续。');}
 if(!response.ok){const error=await response.json().catch(()=>({}));if(['native_semantic_daily_budget','daily_preparation_limit','reading_daily_budget'].includes(error.code))throw new Error('最近 24 小时的服务请求已达上限，请稍后再试。已保存的内容仍然保留。');throw new Error('模型服务暂不可用，已保存的对话仍然保留。');}
 if(!response.body)throw new Error('模型响应未完成，请重试。');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>256*1024)throw new Error('模型响应超过上限，本次结果未接纳。');chunks.push(value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let value=JSON.parse(new TextDecoder().decode(bytes));
 const current=(await providerSnapshot()).providers.find(p=>p.id===provider.id);
 if(current?.revision!==provider.revision)throw new Error('服务配置已改变，旧请求结果未接纳。');
 if(provider.kind==='sensa'){
  if((await auth!.getSession()).data.session?.user.id!==subject)throw new Error('登录身份已改变，旧请求结果未接纳。');
  const envelope=z.object({id:z.literal(id),inputDigest:z.literal((payload as {inputDigest:string}).inputDigest),response:z.unknown()}).strict().parse(value);value=envelope.response;
 }
 if(signal.aborted)throw new Error('本次请求已停止，旧结果未接纳。');
 return completionSchema.parse(value);
}
