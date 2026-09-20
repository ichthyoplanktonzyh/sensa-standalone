import {localModelQueue} from './modelExecution';
import {ModelExecutionError,type ModelExecutionRecord} from '@sensa/contracts/sensa';
import {z} from 'zod';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {auth} from '../account/auth';
import {clearCredential,providerCredential,providerSnapshot,type Provider,type Purpose} from './providers';
import type {ConversationImage} from './conversationImages';
import {ModelStreamError,readManagedModelStream,readOpenAiModelStream} from './modelStreaming';

const modelInputImagesSchema=z.array(z.object({id:z.string().uuid(),name:z.string().max(200),dataUrl:z.string().max(9*1024*1024).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u)}).strict()).max(4);
export type ModelMessage={role:'system'|'user'|'assistant'|'tool';content:string|null;images?:ConversationImage[];tool_call_id?:string;tool_calls?:{id:string;type:'function';function:{name:string;arguments:string}}[]};
export type ModelTool={type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}};
export const completionSchema=z.object({model:z.string().max(200),choices:z.array(z.object({finish_reason:z.enum(['stop','tool_calls']),message:z.object({content:z.string().max(32000).nullable().optional(),tool_calls:z.array(z.object({id:z.string().min(1).max(100),type:z.literal('function'),function:z.object({name:z.string().max(100),arguments:z.string().max(32000)}).strict()}).strip()).max(4).optional()}).passthrough()}).passthrough()).length(1)}).passthrough();
export const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalConsumerJson(value)))),b=>b.toString(16).padStart(2,'0')).join('');
async function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(new Error('localFlow.requestTimeout'));};if(signal.aborted){void promise.catch(()=>{});abort();return;}signal.addEventListener('abort',abort,{once:true});promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});
}

export type CompleteOptions={
 responseFormat?:'json_object';
 /** Raw provider text deltas. The owning feature decides what is safe to show. */
 onText?:(delta:string)=>void|Promise<void>;
};

export async function complete(provider:Provider,purpose:Purpose,id:string,messages:ModelMessage[],tools:ModelTool[],signal:AbortSignal,options:CompleteOptions={}){
 try{return await localModelQueue.run({id,provider:new URL(provider.endpoint).origin,model:provider.model,purpose,execution:'device'},signal,(bounded,record)=>completeRequest(provider,purpose,id,messages,tools,bounded,record,options));}catch(e){if(e instanceof ModelExecutionError)throw new Error(e.code==='model_timeout'?'localFlow.requestTimeout':e.code==='model_cancelled'?'localFlow.requestStopped':'localFlow.modelQueueFull');throw e;}
}

function modelFailure(code:unknown):never{
 if(code==='model_input_too_large')throw new Error('localFlow.modelInputLarge');
 if(code==='model_timeout'||code==='model_cancelled'||code==='provider_timeout')throw new Error('localFlow.requestTimeout');
 if(code==='model_auth_failed')throw new Error('localFlow.providerAccessDenied');
 if(code==='model_queue_full')throw new Error('localFlow.modelQueueFull');
 if(code==='model_rate_limited')throw new Error('localFlow.modelRateLimited');
 if(code==='model_request_rejected')throw new Error('localFlow.modelRequestRejected');
 if(code==='model_invalid_response'||code==='model_stream_invalid')throw new Error('localFlow.modelResponseInvalid');
 if(code==='model_response_too_large')throw new Error('localFlow.responseLimit');
 if(code==='model_stream_incomplete')throw new Error('localFlow.modelIncomplete');
 if(code==='model_daily_budget'||code==='reading_daily_budget')throw new Error('localFlow.serviceLimit');
 throw new Error('localFlow.modelUnavailable');
}

async function jsonResponse(response:Response):Promise<unknown>{
 if(!response.body)throw new Error('localFlow.modelIncomplete');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>256*1024)throw new Error('localFlow.responseLimit');chunks.push(value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('localFlow.modelResponseInvalid');}
}

async function completeRequest(provider:Provider,purpose:Purpose,id:string,messages:ModelMessage[],tools:ModelTool[],signal:AbortSignal,record:ModelExecutionRecord,options:CompleteOptions){
 signal=AbortSignal.any([signal,AbortSignal.timeout(45000)]);
 const images=messages.flatMap(m=>m.images??[]);modelInputImagesSchema.parse(images);
 const wireMessages=messages.map(({images,...m})=>images?.length?{...m,content:[...(m.content?[{type:'text',text:m.content}]:[]),...images.map(image=>({type:'image_url',image_url:{url:image.dataUrl}}))]}:m);
 const base=new URL(provider.endpoint),body={model:provider.model,messages:wireMessages,...(tools.length?{tools}:{}),max_tokens:3000,stream:false as const,...(options.responseFormat==='json_object'||(purpose!=='teacher'&&!tools.length)?{response_format:{type:'json_object' as const}}:{})};
 if(messages.length>100||new TextEncoder().encode(JSON.stringify(messages.map(({images,...m})=>m))).length>256*1024)throw new Error('localFlow.conversationSave');
 let endpoint=provider.endpoint+'/chat/completions',payload:unknown=body,key:string,subject:string|undefined;
 if(provider.kind==='sensa'){
  const configured=import.meta.env.VITE_SENSA_API_URL as string|undefined;
  if(!configured||provider.endpoint!==configured.replace(/\/+$/u,''))throw new Error('localFlow.sensaEndpoint');
  if(!auth)throw new Error('localFlow.authUnavailable');
  const {data,error}=await abortable(auth.getSession(),signal);if(error||!data.session)throw new Error('localFlow.onlineLogin');
  key=data.session.access_token;subject=data.session.user.id;endpoint=provider.endpoint+(options.onText?'/sensa/model/turn/stream':'/sensa/model/turn');
  const input={id,purpose,body};payload={...input,inputDigest:await digest(input)};
 }else{
  key=await providerCredential(provider);
  payload={...body,...(options.onText?{stream:true}:{}),...(base.hostname==='api.deepseek.com'?{thinking:{type:'disabled'}}:{})};
 }
 const response=await fetch(endpoint,{method:'POST',redirect:'error',credentials:'omit',headers:{authorization:'Bearer '+key,'content-type':'application/json',...(options.onText?{accept:provider.kind==='sensa'?'application/x-ndjson':'text/event-stream'}:{})},body:JSON.stringify(payload),signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});
 if(response.status===401||response.status===403){clearCredential(provider.id);throw new Error('localFlow.providerAccessDenied');}
 if(!response.ok){const error=await response.json().catch(()=>({}));modelFailure(error.code);}
 let value:unknown;
 try{
  if(options.onText&&response.body&&provider.kind==='sensa')value=await readManagedModelStream(response.body,options.onText);
  else if(options.onText&&response.body&&response.headers.get('content-type')?.includes('text/event-stream'))value=await readOpenAiModelStream(response.body,provider.model,options.onText);
  else{
   value=await jsonResponse(response);
   if(options.onText){const parsed=completionSchema.safeParse(value);const text=parsed.success?parsed.data.choices[0]?.message.content:undefined;if(text)await options.onText(text);}
  }
 }catch(error){if(error instanceof ModelStreamError)modelFailure(error.code);throw error;}
 const current=(await providerSnapshot()).providers.find(p=>p.id===provider.id);
 if(current?.revision!==provider.revision)throw new Error('localFlow.staleConfigResult');
 if(provider.kind==='sensa'){
  if((await abortable(auth!.getSession(),signal)).data.session?.user.id!==subject)throw new Error('localFlow.staleAccountResult');
  const envelope=z.object({id:z.literal(id),inputDigest:z.literal((payload as {inputDigest:string}).inputDigest),response:z.unknown()}).strict().parse(value);value=envelope.response;
 }
 if(signal.aborted)throw new Error('localFlow.stoppedResult');
 const raw=value as {choices?:Array<{finish_reason?:unknown}>;usage?:{prompt_tokens?:unknown;completion_tokens?:unknown};sensaExecution?:{traceId?:unknown}};
 if(raw.choices?.[0]?.finish_reason==='length')throw new Error('localFlow.modelTruncated');
 const parsed=completionSchema.safeParse(value);if(!parsed.success)throw new Error('localFlow.modelResponseInvalid');
 record.inputTokens=Number.isSafeInteger(raw.usage?.prompt_tokens)?raw.usage!.prompt_tokens as number:undefined;record.outputTokens=Number.isSafeInteger(raw.usage?.completion_tokens)?raw.usage!.completion_tokens as number:undefined;record.traceId=typeof raw.sensaExecution?.traceId==='string'?raw.sensaExecution.traceId:undefined;
 return parsed.data;
}
