/** Native libraries own requests and acceptance. This service never persists personal payloads. */
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {z} from 'zod';
import {canonicalConsumerJson,nativeSemanticRequestSchema,nativeSemanticResultSchema,semanticProposalSchema} from '@sensa/contracts/sensa';
import {ConsumerError} from '../access/auth.js';
import type {NativeSemanticRequest} from '@sensa/contracts/sensa';
import type {SemanticResolver} from './semanticResolver.js';
export async function semanticDigest(value:unknown):Promise<string>{
  const bytes=new TextEncoder().encode(canonicalConsumerJson(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
export function createNativeSemanticRoutes(authorize:(request:Request)=>Promise<SemanticResolver>, reserve:(request:Request,input:NativeSemanticRequest)=>Promise<void>){
  const app=new Hono();
  app.use('*',bodyLimit({maxSize:96*1024,onError:c=>c.json({code:'body_too_large'},413)}));
  app.onError((e,c)=>c.json({code:e instanceof ConsumerError?e.code:e instanceof z.ZodError||e instanceof SyntaxError?'invalid_request':'provider_unavailable'},e instanceof ConsumerError?e.status:e instanceof z.ZodError||e instanceof SyntaxError?400:503));
  app.post('/resolve',async c=>{
    c.header('Cache-Control','no-store');
    const resolver=await authorize(c.req.raw);
    const input=nativeSemanticRequestSchema.parse(await c.req.json());
    const {inputDigest,...payload}=input;
    if(await semanticDigest(payload)!==inputDigest)throw new ConsumerError(400,'input_digest_mismatch');
    await reserve(c.req.raw,input);
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const resolved=await Promise.race([
        resolver(input.snapshot,input.focus===null?null:{text:input.focus}),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ConsumerError(503,'lookup_timeout')),45000);}),
      ]);
      const parsed=resolved.proposal===null?null:semanticProposalSchema.safeParse(resolved.proposal);
      if(parsed&&!parsed.success)throw new ConsumerError(503,'invalid_proposal');
      const proposal=parsed?.data??null;
      if(proposal&&proposal.expression.surface!==input.snapshot.expression!.text.trim())throw new ConsumerError(503,'invalid_proposal');
      await authorize(c.req.raw); // Revocation during the provider call invalidates the response.
      return c.json(nativeSemanticResultSchema.parse({version:input.version,id:input.id,inputDigest,status:proposal?'ready':'unresolved',proposal,
        provenance:{provider:resolved.provider,model:resolved.model,policyVersion:resolved.policyVersion??'consumer-semantic-v4',outputDigest:await semanticDigest(proposal)}}));
    }catch(error){
      if(error instanceof z.ZodError||error instanceof SyntaxError)throw new ConsumerError(503,'invalid_proposal');
      throw error;
    }finally{clearTimeout(timer);}
  });
  return app;
}
