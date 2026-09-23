/** Stateless, metered model transport for the Web client. */
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {stream} from 'hono/streaming';
import {z} from 'zod';
import {canonicalConsumerJson,modelTurnInputSchema,SENSA_CONTENT_AGENT_TOOLS,SENSA_TEACHER_AGENT_TOOLS} from '@sensa/contracts/sensa';
import type {ReadingCompletion} from '../reading/service.js';
import {ConsumerError} from '../access/auth.js';
import {executeModel} from './executor.js';

type Input=z.infer<typeof modelTurnInputSchema>;
type Connection=Parameters<ReadingCompletion>[0];
type TextDelta=(text:string)=>Promise<void>;
type ModelTurnExecutionLease=Readonly<{
 kind:'execute';connection:Connection;
 markRunning:()=>Promise<void>;
 succeed:(response:unknown)=>Promise<void>;
 failBeforeExecution:(code:string)=>Promise<void>;
 failAfterExecution:(code:string,unknown:boolean)=>Promise<void>;
}>;
export type ModelTurnReservation=ModelTurnExecutionLease|Readonly<{kind:'replay';response:unknown}>;
export type ModelTurnCompletion=(connection:Connection,body:Input['body'],signal:AbortSignal,meta:{id:string;purpose:Input['purpose'];onExecutionStart:()=>Promise<void>},onText?:TextDelta)=>Promise<unknown>;

async function digest(value:unknown){
  const bytes=new TextEncoder().encode(canonicalConsumerJson(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export const completeModelTurn:ModelTurnCompletion=(connection,body,signal,meta,onText)=>{
  const model=connection.id==='00000000-0000-4000-8000-000000000001'
    ?(meta.purpose==='review'?process.env.SENSA_REVIEW_MODEL??process.env.SENSA_CONTENT_MODEL
      :meta.purpose==='content'?process.env.SENSA_CONTENT_MODEL
      :meta.purpose==='reference'?process.env.SENSA_REFERENCE_MODEL??process.env.SENSA_SEMANTIC_MODEL
      :process.env.SENSA_SEMANTIC_MODEL)
    :undefined;
  return executeModel({...connection,model:model??connection.model},body,{signal,id:meta.id,purpose:meta.purpose,onText,onExecutionStart:meta.onExecutionStart});
};

/** Tool exposure per purpose. A purpose absent here is a bug, not a permissive default. */
const purposeTools:Record<Input['purpose'],string[]>={
  teacher:[...SENSA_TEACHER_AGENT_TOOLS],
  content:[...SENSA_CONTENT_AGENT_TOOLS],
  review:[],
  reference:[],
};

export function createModelTurnRoutes(options:{
  authorize:(request:Request)=>Promise<{select:(purpose:Input['purpose'])=>Connection}>;
  reserve:(request:Request,input:{id:string;inputDigest:string;purpose:Input['purpose']},select:()=>Connection)=>Promise<ModelTurnReservation>;
  complete?:ModelTurnCompletion;
}){
  const app=new Hono();
  app.use('*',bodyLimit({maxSize:12*1024*1024,onError:c=>c.json({code:'body_too_large'},413)}));
  app.onError((error,c)=>c.json({code:error instanceof ConsumerError?error.code:error instanceof z.ZodError||error instanceof SyntaxError?'invalid_request':'provider_unavailable'},error instanceof ConsumerError?error.status:error instanceof z.ZodError||error instanceof SyntaxError?400:503));

  const prepare=async(request:Request)=>{
    // The session is verified before the body is read; the connection is resolved
    // only once the purpose is known, because each purpose has its own assignment.
    const scope=await options.authorize(request);
    const input=modelTurnInputSchema.parse(await request.json());
    const {inputDigest,...payload}=input;
    if(await digest(payload)!==inputDigest)throw new ConsumerError(400,'input_digest_mismatch');
    const textBody=JSON.stringify({...input.body,messages:input.body.messages.map(message=>({...message,content:Array.isArray(message.content)?message.content.map(part=>part.type==='image_url'?{type:'image_url'}:part):message.content}))});
    if(new TextEncoder().encode(textBody).length>256*1024)throw new ConsumerError(413,'model_input_too_large');
    const names=input.body.tools?.map(tool=>tool.function.name)??[];
    const allowed=purposeTools[input.purpose];
    if(names.some(name=>!allowed.includes(name))||new Set(names).size!==names.length)throw new ConsumerError(400,'unapproved_tool');
    const reservation=await options.reserve(request,input,()=>scope.select(input.purpose));
    return {input,reservation};
  };

  const run=async(request:Request,prepared:Awaited<ReturnType<typeof prepare>>,onText?:TextDelta)=>{
    const {input,reservation}=prepared;
    if(reservation.kind==='replay')return {id:input.id,inputDigest:input.inputDigest,response:reservation.response};
    const controller=new AbortController();
    const abort=()=>controller.abort();
    request.signal.addEventListener('abort',abort);
    if(request.signal.aborted)abort();
    const timer=setTimeout(abort,45000);
    let started=false,finalized=false;
    const failureCode=(error:unknown)=>error instanceof ConsumerError?error.code:error instanceof Error&&/^(?:model|provider)_[a-z_]+$/u.test(error.message)?error.message:'provider_unavailable';
    try{
      if(controller.signal.aborted)throw new ConsumerError(503,'provider_timeout');
      const response=await (options.complete??completeModelTurn)(reservation.connection,input.body,controller.signal,{id:input.id,purpose:input.purpose,onExecutionStart:async()=>{await reservation.markRunning();started=true;}},onText);
      if(!started)throw new ConsumerError(503,'model_execution_not_started');
      if(controller.signal.aborted)throw new ConsumerError(503,'provider_timeout');
      await reservation.succeed(response);finalized=true;
      await options.authorize(request);
      return {id:input.id,inputDigest:input.inputDigest,response};
    }catch(error){
      if(!finalized){
       const code=failureCode(error);
       try{
        if(started)await reservation.failAfterExecution(code,!['model_auth_failed','model_rate_limited','model_request_rejected','model_invalid_response'].includes(code));
        else await reservation.failBeforeExecution(code);
       }catch(stateError){console.error(JSON.stringify({event:'sensa.model_request_state_failed',message:stateError instanceof Error?stateError.message:String(stateError)}));}
      }
      throw error;
    }finally{
      clearTimeout(timer);
      request.signal.removeEventListener('abort',abort);
    }
  };

  app.post('/turn',async c=>{
    c.header('Cache-Control','no-store');
    const prepared=await prepare(c.req.raw);
    return c.json(await run(c.req.raw,prepared));
  });

  app.post('/turn/stream',async c=>{
    c.header('Content-Type','application/x-ndjson');
    c.header('Cache-Control','no-store');
    c.header('X-Accel-Buffering','no');
    const prepared=await prepare(c.req.raw);
    return stream(c,async output=>{
      try{
        const value=await run(c.req.raw,prepared,async text=>{
          if(output.aborted)throw new ConsumerError(503,'model_cancelled');
          for(let offset=0;offset<text.length;offset+=16000){
            await output.write(JSON.stringify({type:'delta',text:text.slice(offset,offset+16000)})+'\n');
          }
        });
        if(!output.aborted)await output.write(JSON.stringify({type:'result',value})+'\n');
      }catch(error){
        if(!output.aborted){
          const code=error instanceof ConsumerError?error.code:error instanceof z.ZodError||error instanceof SyntaxError?'invalid_request':'provider_unavailable';
          await output.write(JSON.stringify({type:'error',code})+'\n');
        }
      }
    });
  });
  return app;
}
