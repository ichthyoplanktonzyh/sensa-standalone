import {localModelQueue} from './modelExecution';
import {ModelExecutionError,type ModelExecutionRecord} from '@sensa/contracts/sensa';
import {z} from 'zod';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {auth} from '../consumer/client';
import {clearCredential,providerCredential,providerSnapshot,type Provider,type Purpose} from './providers';
import {conversationImagesSchema,type ConversationImage} from './conversationImages';
export type ModelMessage={role:'system'|'user'|'assistant'|'tool';content:string|null;images?:ConversationImage[];tool_call_id?:string;tool_calls?:{id:string;type:'function';function:{name:string;arguments:string}}[]};
export type ModelTool={type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}};
export const completionSchema=z.object({model:z.string().max(200),choices:z.array(z.object({finish_reason:z.enum(['stop','tool_calls']),message:z.object({content:z.string().max(32000).nullable().optional(),tool_calls:z.array(z.object({id:z.string().min(1).max(100),type:z.literal('function'),function:z.object({name:z.string().max(100),arguments:z.string().max(32000)}).strict()}).strip()).max(4).optional()}).passthrough()}).passthrough()).length(1)}).passthrough();
export const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalConsumerJson(value)))),b=>b.toString(16).padStart(2,'0')).join('');
async function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(new Error('localFlow.requestTimeout'));};if(signal.aborted){void promise.catch(()=>{});abort();return;}signal.addEventListener('abort',abort,{once:true});promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});
}
export async function complete(provider:Provider,purpose:Purpose,id:string,messages:ModelMessage[],tools:ModelTool[],signal:AbortSignal){
 try{return await localModelQueue.run({id,provider:new URL(provider.endpoint).origin,model:provider.model,purpose},signal,(bounded,record)=>completeRequest(provider,purpose,id,messages,tools,bounded,record));}catch(e){if(e instanceof ModelExecutionError)throw new Error(e.code==='model_timeout'?'localFlow.requestTimeout':e.code==='model_cancelled'?'localFlow.requestStopped':'localFlow.modelQueueFull');throw e;}
}
async function completeRequest(provider:Provider,purpose:Purpose,id:string,messages:ModelMessage[],tools:ModelTool[],signal:AbortSignal,record:ModelExecutionRecord){
 signal=AbortSignal.any([signal,AbortSignal.timeout(45000)]);
 const images=messages.flatMap(m=>m.images??[]);conversationImagesSchema.parse(images);
 const wireMessages=messages.map(({images,...m})=>images?.length?{...m,content:[...(m.content?[{type:'text',text:m.content}]:[]),...images.map(image=>({type:'image_url',image_url:{url:image.dataUrl}}))]}:m);
 const base=new URL(provider.endpoint),body={model:provider.model,messages:wireMessages,...(tools.length?{tools}:{}),max_tokens:3000,stream:false as const,...(purpose!=='teacher'&&!tools.length?{response_format:{type:'json_object' as const}}:{})};
 if(messages.length>100||new TextEncoder().encode(JSON.stringify(messages.map(({images,...m})=>m))).length>256*1024)throw new Error('localFlow.conversationSave');
 let endpoint=provider.endpoint+'/chat/completions',payload:unknown=body,key:string,subject:string|undefined;
 if(provider.kind==='sensa'){
  const configured=import.meta.env.VITE_SENSA_API_URL as string|undefined;
  if(!configured||provider.endpoint!==configured.replace(/\/+$/u,''))throw new Error('localFlow.sensaEndpoint');
  if(!auth)throw new Error('localFlow.authUnavailable');
  const {data,error}=await abortable(auth.getSession(),signal);if(error||!data.session)throw new Error('localFlow.onlineLogin');
  key=data.session.access_token;subject=data.session.user.id;endpoint=provider.endpoint+'/sensa/model/turn';
  const input={id,purpose,body};payload={...input,inputDigest:await digest(input)};
 }else{key=await providerCredential(provider);payload={...body,...(base.hostname==='api.deepseek.com'?{thinking:{type:'disabled'}}:{})};}
 const response=await fetch(endpoint,{method:'POST',redirect:'error',credentials:'omit',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});
 if(response.status===401||response.status===403){clearCredential(provider.id);throw new Error('localFlow.providerAccessDenied');}
 if(!response.ok){const error=await response.json().catch(()=>({}));if(error.code==='model_input_too_large')throw new Error('localFlow.modelInputLarge');if(error.code==='model_timeout'||error.code==='model_cancelled')throw new Error('localFlow.requestTimeout');if(error.code==='model_auth_failed')throw new Error('localFlow.providerAccessDenied');if(error.code==='model_queue_full')throw new Error('localFlow.modelQueueFull');if(error.code==='model_rate_limited')throw new Error('localFlow.modelRateLimited');if(error.code==='model_request_rejected')throw new Error('localFlow.modelRequestRejected');if(error.code==='model_invalid_response')throw new Error('localFlow.modelResponseInvalid');if(['model_daily_budget','reading_daily_budget'].includes(error.code))throw new Error('localFlow.serviceLimit');throw new Error('localFlow.modelUnavailable');}
 if(!response.body)throw new Error('localFlow.modelIncomplete');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>256*1024)throw new Error('localFlow.responseLimit');chunks.push(value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('localFlow.modelResponseInvalid');}
 const current=(await providerSnapshot()).providers.find(p=>p.id===provider.id);
 if(current?.revision!==provider.revision)throw new Error('localFlow.staleConfigResult');
 if(provider.kind==='sensa'){
  if((await abortable(auth!.getSession(),signal)).data.session?.user.id!==subject)throw new Error('localFlow.staleAccountResult');
  const envelope=z.object({id:z.literal(id),inputDigest:z.literal((payload as {inputDigest:string}).inputDigest),response:z.unknown()}).strict().parse(value);value=envelope.response;
 }
 if(signal.aborted)throw new Error('localFlow.stoppedResult');
 if(value?.choices?.[0]?.finish_reason==='length')throw new Error('localFlow.modelTruncated');
 const parsed=completionSchema.safeParse(value);if(!parsed.success)throw new Error('localFlow.modelResponseInvalid');
 record.inputTokens=Number.isSafeInteger(value?.usage?.prompt_tokens)?value.usage.prompt_tokens:undefined;record.outputTokens=Number.isSafeInteger(value?.usage?.completion_tokens)?value.usage.completion_tokens:undefined;record.traceId=typeof value?.sensaExecution?.traceId==='string'?value.sensaExecution.traceId:undefined;
 return parsed.data;
}
