/** Stateless, metered model transport for the Web client. */
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {z} from 'zod';
import {canonicalConsumerJson,modelTurnInputSchema} from '@sensa/contracts/sensa';
import type {ReadingCompletion} from '../reading/service.js';
import {ConsumerError} from '../access/auth.js';
import {executeModel} from './executor.js';

type Input=z.infer<typeof modelTurnInputSchema>;
type Connection=Parameters<ReadingCompletion>[0];
export type ModelTurnCompletion=(connection:Connection,body:Input['body'],signal:AbortSignal,meta:{id:string;purpose:Input['purpose']})=>Promise<unknown>;

async function digest(value:unknown){
  const bytes=new TextEncoder().encode(canonicalConsumerJson(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export const completeModelTurn:ModelTurnCompletion=(connection,body,signal,meta)=>{
  const model=connection.id==='00000000-0000-4000-8000-000000000001'
    ?(meta.purpose==='review'?process.env.SENSA_REVIEW_MODEL??process.env.SENSA_CONTENT_MODEL
      :meta.purpose==='content'?process.env.SENSA_CONTENT_MODEL
      :meta.purpose==='reference'?process.env.SENSA_REFERENCE_MODEL??process.env.SENSA_SEMANTIC_MODEL
      :process.env.SENSA_SEMANTIC_MODEL)
    :undefined;
  return executeModel({...connection,model:model??connection.model},body,{signal,id:meta.id,purpose:meta.purpose});
};

/** Tool exposure per purpose. A purpose absent here is a bug, not a permissive default. */
const purposeTools:Record<Input['purpose'],string[]>={
  teacher:['lookup_meanings'],
  content:['read_demand','lookup_reference_facts','submit_candidate'],
  review:[],
  reference:[],
};

export function createModelTurnRoutes(options:{
  authorize:(request:Request)=>Promise<{select:(purpose:Input['purpose'])=>Connection}>;
  reserve:(request:Request,input:{id:string;inputDigest:string;purpose:Input['purpose']})=>Promise<void>;
  complete?:ModelTurnCompletion;
}){
  const app=new Hono();
  app.use('*',bodyLimit({maxSize:12*1024*1024,onError:c=>c.json({code:'body_too_large'},413)}));
  app.onError((error,c)=>c.json({code:error instanceof ConsumerError?error.code:error instanceof z.ZodError||error instanceof SyntaxError?'invalid_request':'provider_unavailable'},error instanceof ConsumerError?error.status:error instanceof z.ZodError||error instanceof SyntaxError?400:503));
  app.post('/turn',async c=>{
    c.header('Cache-Control','no-store');
    // The session is verified before the body is read; the connection is resolved
    // only once the purpose is known, because each purpose has its own assignment.
    const scope=await options.authorize(c.req.raw);
    const input=modelTurnInputSchema.parse(await c.req.json());
    const {inputDigest,...payload}=input;
    if(await digest(payload)!==inputDigest)throw new ConsumerError(400,'input_digest_mismatch');
    const textBody=JSON.stringify({...input.body,messages:input.body.messages.map(message=>({...message,content:Array.isArray(message.content)?message.content.map(part=>part.type==='image_url'?{type:'image_url'}:part):message.content}))});
    if(new TextEncoder().encode(textBody).length>256*1024)throw new ConsumerError(413,'model_input_too_large');
    const names=input.body.tools?.map(tool=>tool.function.name)??[];
    const allowed=purposeTools[input.purpose];
    if(names.some(name=>!allowed.includes(name))||new Set(names).size!==names.length)throw new ConsumerError(400,'unapproved_tool');
    await options.reserve(c.req.raw,input);
    const connection=scope.select(input.purpose);
    const controller=new AbortController();
    const abort=()=>controller.abort();
    c.req.raw.signal.addEventListener('abort',abort);
    if(c.req.raw.signal.aborted)abort();
    const timer=setTimeout(abort,45000);
    try{
      if(controller.signal.aborted)throw new ConsumerError(503,'provider_timeout');
      const response=await (options.complete??completeModelTurn)(connection,input.body,controller.signal,{id:input.id,purpose:input.purpose});
      if(controller.signal.aborted)throw new ConsumerError(503,'provider_timeout');
      await options.authorize(c.req.raw);
      return c.json({id:input.id,inputDigest,response});
    }finally{
      clearTimeout(timer);
      c.req.raw.signal.removeEventListener('abort',abort);
    }
  });
  return app;
}
