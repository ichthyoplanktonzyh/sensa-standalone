import 'openai/shims/web';
import {AsyncLocalStorage} from 'node:async_hooks';
import {genkit,type GenerateRequest,type GenerateResponseData,type Part} from 'genkit';
import {openAIModelRunner} from '@genkit-ai/compat-oai';
import OpenAI from 'openai';
import {ModelExecutionQueue,ModelExecutionError,type ModelPurpose,type ModelTurnBody,type ModelExecutionRecord} from '@sensa/contracts/sensa';

type Connection={id?:string;schedulingKey?:string;baseUrl:string;apiKey:string;model:string;temperature?:number};
type Work={connection:Connection;body:ModelTurnBody;signal:AbortSignal;onText?:(text:string)=>Promise<void>;result?:GenerateResponseData;record:ModelExecutionRecord};
const context=new AsyncLocalStorage<Work>();
const apiStatus=(e:unknown)=>{if(!e||typeof e!=='object')return undefined;const status='status' in e&&typeof e.status==='number'?e.status:'code' in e&&typeof e.code==='number'?e.code:undefined;return status&&status>=400&&status<=599?status:undefined;};
const ai=genkit({});
const positive=(key:string,fallback:number)=>{const n=Number(process.env[key]);return Number.isInteger(n)&&n>0?n:fallback;};
export const modelQueue=new ModelExecutionQueue({maxConcurrent:positive('SENSA_MODEL_CONCURRENCY',2),perProvider:positive('SENSA_MODEL_PROVIDER_CONCURRENCY',1),maxQueued:64,timeoutMs:45000},r=>console.info(JSON.stringify({event:'sensa.model',...r})));
function jsonOrText(value:string){try{return JSON.parse(value);}catch{return value;}}
function toRequest(body:ModelTurnBody,streaming=false):GenerateRequest{
 return {messages:body.messages.map(m=>{
  const content:Part[]=typeof m.content==='string'?(m.role==='tool'?[{toolResponse:{name:body.messages.flatMap(v=>v.tool_calls??[]).find(t=>t.id===m.tool_call_id)?.function.name??'tool',ref:m.tool_call_id,output:jsonOrText(m.content)}}]:[{text:m.content}]):Array.isArray(m.content)?m.content.map(p=>p.type==='text'?{text:p.text}:{media:{url:p.image_url.url}}):[];
  for(const t of m.tool_calls??[])content.push({toolRequest:{name:t.function.name,ref:t.id,input:JSON.parse(t.function.arguments)}});
  return {role:m.role==='assistant'?'model':m.role,content};
 }),tools:body.tools?.map(t=>({name:t.function.name,description:t.function.description,inputSchema:t.function.parameters})),config:{maxOutputTokens:body.max_tokens},...(body.response_format&&!streaming?{output:{format:'json'}}:{})};
}
// Only operational metadata enters Genkit traces. Private request/response and keys
// live in request-local context, never in flow inputs, outputs, or error messages.
const flow=ai.defineFlow('sensa-model-execution',async(meta:{id:string;purpose:ModelPurpose;provider:string;model:string})=>{
 const w=context.getStore();if(!w)throw new ModelExecutionError('model_context_missing');
 try{
  const client=new OpenAI({apiKey:w.connection.apiKey,baseURL:w.connection.baseUrl,maxRetries:0,timeout:45000,fetch:async(url,init)=>{
   const response=await fetch(url,{...init,redirect:'error'});if(!response.body)return response;let size=0;const limit=w.onText?2*1024*1024:256*1024;const body=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){size+=chunk.length;if(size>limit){controller.error(new ModelExecutionError('model_invalid_response'));return;}controller.enqueue(chunk);}}));return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }});
  const runner=openAIModelRunner(w.connection.model,client as unknown as Parameters<typeof openAIModelRunner>[1],(_req,params)=>{
   // compat-oai parses each JSON-mode stream delta as a complete document. Keep
   // deltas as text while still requesting JSON from the provider on the wire.
   if(w.onText&&w.body.response_format)params.response_format=w.body.response_format;
   if(new URL(w.connection.baseUrl).hostname==='api.deepseek.com')(params as unknown as Record<string,unknown>).thinking={type:'disabled'};if(w.connection.temperature!==undefined)params.temperature=w.connection.temperature;});
  // Network retries are bounded here; content/schema correction belongs to the caller.
  for(let attempt=0;;attempt++){
   try{w.result=await runner(toRequest(w.body,!!w.onText),{abortSignal:w.signal,...(w.onText?{streamingRequested:true,sendChunk:async chunk=>{const text=chunk.content?.map(p=>p.text??'').join('');if(text)await w.onText!(text);}}:{})});break;}
   catch(e){const status=apiStatus(e);if(w.onText||attempt>=1||!status||![429,502,503,504].includes(status)||w.signal.aborted)throw e;await new Promise<void>((resolve,reject)=>{const done=()=>{clearTimeout(timer);w.signal.removeEventListener('abort',abort);resolve();};const abort=()=>{clearTimeout(timer);reject(new ModelExecutionError('model_cancelled'));};const timer=setTimeout(done,500);w.signal.addEventListener('abort',abort,{once:true});if(w.signal.aborted)abort();});}
  }
  if(!w.result.message||!['stop','unknown'].includes(w.result.finishReason??'unknown'))throw new ModelExecutionError('model_invalid_response');
  if(w.onText&&w.body.response_format&&!w.result.message.content.some(p=>p.toolRequest))JSON.parse(w.result.message.content.map(p=>p.text??'').join(''));
  w.record.inputTokens=w.result.usage?.inputTokens;w.record.outputTokens=w.result.usage?.outputTokens;
  return {...meta,finishReason:w.result.finishReason,inputTokens:w.record.inputTokens??0,outputTokens:w.record.outputTokens??0};
 }catch(e){if(e instanceof ModelExecutionError)throw e;const status=apiStatus(e);throw new ModelExecutionError(w.signal.aborted?'model_cancelled':status===401||status===403?'model_auth_failed':status===429?'model_rate_limited':status===400?'model_request_rejected':e instanceof SyntaxError?'model_invalid_response':'model_provider_failed');}
});
export async function executeModel(connection:Connection,body:ModelTurnBody,options:{id?:string;purpose:ModelPurpose;signal?:AbortSignal;onText?:(text:string)=>Promise<void>;onExecutionStart?:()=>Promise<void>}){
 const base=new URL(connection.baseUrl);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new ModelExecutionError('model_provider_failed');
 const id=options.id??crypto.randomUUID(),provider=base.origin;
 try{return await modelQueue.run({id,provider,model:connection.model,purpose:options.purpose,execution:'service',schedulingKey:connection.schedulingKey??connection.id??provider},options.signal??AbortSignal.timeout(45000),async(signal,record)=>{
  await options.onExecutionStart?.();
  const work:Work={connection,body,signal,onText:options.onText,record};
  const traced=await context.run(work,()=>flow.run({id,purpose:options.purpose,provider,model:connection.model},{abortSignal:signal}));record.traceId=traced.telemetry.traceId;
  const result=work.result!,parts=result.message!.content;const calls=parts.flatMap(p=>p.toolRequest?[{id:p.toolRequest.ref??crypto.randomUUID(),type:'function' as const,function:{name:p.toolRequest.name,arguments:JSON.stringify(p.toolRequest.input)}}]:[]);
  return {model:connection.model,choices:[{finish_reason:calls.length?'tool_calls':'stop',message:{content:parts.map(p=>p.text??(p.data!==undefined?JSON.stringify(p.data):'')).join('')||null,...(calls.length?{tool_calls:calls}:{})}}],usage:{prompt_tokens:record.inputTokens??0,completion_tokens:record.outputTokens??0},sensaExecution:{id,traceId:record.traceId}};
 });}catch(e){throw e;}
}
