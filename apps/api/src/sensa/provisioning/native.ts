/** Stateless content execution; native SQLite owns membership, attempts and materialization. */
import {Hono} from 'hono';
import {bytesDigest} from '../media/consumer.js';
import {bodyLimit} from 'hono/body-limit';
import {z} from 'zod';
import {nativeProvisioningInputSchema} from '@sensa/contracts/sensa';
import type {NativeProvisioningInput} from '@sensa/contracts/sensa';
import {ConsumerError} from '../access/auth.js';
import {semanticDigest} from '../personal/nativeSemantic.js';
import {makeRequest,makeBundle,validateBundle,SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND} from './material.js';
import type {ContentGenerator,ContentReviewer} from './material.js';
export type NativePronunciation={digest:string;sourceTextDigest:string;mimeType:'audio/mpeg';byteSize:number};
export function createNativeProvisioningRoutes(options:{authorize:(request:Request)=>Promise<void>;reserve:(request:Request,input:NativeProvisioningInput)=>Promise<void>;generate:ContentGenerator;review:ContentReviewer;pronunciation?:(expression:string)=>Promise<NativePronunciation|null>;media?:(digest:string,expressionDigest:string)=>Promise<{metadata:NativePronunciation;bytes:Uint8Array}|null>;cancel?:(request:Request,input:{id:string;inputDigest:string})=>Promise<void>;checkActive?:(request:Request,input:NativeProvisioningInput)=>Promise<void>}){
 const app=new Hono();
 app.use('*',bodyLimit({maxSize:64*1024,onError:c=>c.json({code:'body_too_large'},413)}));
 app.onError((e,c)=>c.json({code:e instanceof ConsumerError?e.code:e instanceof z.ZodError||e instanceof SyntaxError?'invalid_request':'provider_unavailable'},e instanceof ConsumerError?e.status:e instanceof z.ZodError||e instanceof SyntaxError?400:503));
 app.get('/pronunciation/:digest',async c=>{
  await options.authorize(c.req.raw);
  const digest=z.string().regex(/^[0-9a-f]{64}$/u).parse(c.req.param('digest'));
  const expressionDigest=z.string().regex(/^[0-9a-f]{64}$/u).parse(c.req.query('expressionDigest'));
  const asset=await options.media?.(digest,expressionDigest);
  if(!asset||asset.metadata.digest!==digest||asset.metadata.sourceTextDigest!==expressionDigest||asset.metadata.mimeType!=='audio/mpeg'||asset.bytes.length!==asset.metadata.byteSize||asset.bytes.length===0||asset.bytes.length>2097152||await bytesDigest(asset.bytes)!==digest)throw new ConsumerError(503,'media_unavailable');
  await options.authorize(c.req.raw);
  return new Response(Uint8Array.from(asset.bytes),{headers:{'Content-Type':'audio/mpeg','Content-Length':String(asset.bytes.length),'Cache-Control':'private, no-store'}});
 });
 app.post('/cancel',async c=>{await options.authorize(c.req.raw);const input=z.object({id:z.string().uuid(),inputDigest:z.string().regex(/^[0-9a-f]{64}$/u)}).strict().parse(await c.req.json());if(!options.cancel)throw new ConsumerError(503,'cancellation_unavailable');await options.cancel(c.req.raw,input);c.header('Cache-Control','no-store');return c.json({id:input.id,inputDigest:input.inputDigest,status:'cancelled'});});
 app.post('/prepare',async c=>{
  c.header('Cache-Control','no-store');await options.authorize(c.req.raw);
  const input=nativeProvisioningInputSchema.parse(await c.req.json());const {inputDigest,...payload}=input;
  if(await semanticDigest(payload)!==inputDigest)throw new ConsumerError(400,'input_digest_mismatch');
  await options.reserve(c.req.raw,input);
  const check=async()=>{await options.authorize(c.req.raw);await options.checkActive?.(c.req.raw,input);};
  await check();
  const {target}=input,proposal=target;
  // Optional static lookup cannot prevent the independently validated text path.
  let pronunciation:NativePronunciation|null=null;
  let lookupTimer:ReturnType<typeof setTimeout>|undefined;
  try{pronunciation=await Promise.race([options.pronunciation?.(proposal.expression.surface)??Promise.resolve(null),new Promise<null>(resolve=>{lookupTimer=setTimeout(()=>resolve(null),3000);})]);}catch{pronunciation=null;}finally{clearTimeout(lookupTimer);}
  if(pronunciation&&(pronunciation.sourceTextDigest!==await bytesDigest(new TextEncoder().encode(proposal.expression.surface))||!/^[0-9a-f]{64}$/u.test(pronunciation.digest)||pronunciation.mimeType!=='audio/mpeg'||!Number.isInteger(pronunciation.byteSize)||pronunciation.byteSize<=0||pronunciation.byteSize>2097152))pronunciation=null;
  await check();
  const request=await makeRequest({id:input.taskId,learner_user_id:input.learnerId,learning_target_id:input.taskId,fixed_input:{...target,pronunciation,anchor:input.anchor,expression:proposal.expression.surface,expressionKind:proposal.expression.type==='word'?'word':'phrase',meaning:proposal.semanticSpec.coreMeaningFocus,prototype:proposal.semanticSpec.prototypeScenes[0].summary,planRevision:input.planRevision,demand:SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND}},input.id,new Date(input.requestedAt));
  const envelope={version:input.version,id:input.id,inputDigest};
  const blocked=(reason:string)=>({...envelope,status:'blocked',reason,material:null,proof:null});
  let timer:ReturnType<typeof setTimeout>|undefined;
  const execute=async()=>{
   let generated,bundle;
   try{generated=await options.generate(request);bundle=await makeBundle(request,generated,new Date());}catch{return blocked('generation_failed');}
   await check();
   let review;
   try{review=await options.review(request,generated.cue);}catch{return blocked('validation_unavailable');}
   await check();
   let checked;
   try{checked=await validateBundle(request,bundle,review,new Date());}catch{return blocked('material_invalid');}
   if(!checked.content)return {...blocked('material_rejected'),proof:{request,bundle,validation:{validations:checked.validations,review,issues:checked.issues}}};
   const cue=bundle.candidates.find(v=>v.materialRoleKey==='experience_recall_cue')!.contentPayload;
   const material={scene:cue.scene,sense:cue.senseFocus,expression:proposal.expression.surface,...(pronunciation?{pronunciation}:{})};
   const proof={request,bundle,validation:{validations:checked.validations,review,issues:checked.issues},content:checked.content,contentDigest:await semanticDigest(checked.content),materialDigest:await semanticDigest(material),adapter:pronunciation?'native-lightweight-v2':'native-lightweight-v1'};
   return {...envelope,status:'ready',reason:null,material,proof};
  };
  try{
   const result=await Promise.race([execute(),new Promise<ReturnType<typeof blocked>>(resolve=>{timer=setTimeout(()=>resolve(blocked('attempt_timed_out')),75000);})]);
   await check();
   return c.json(result);
  }finally{clearTimeout(timer);}
 });return app;
}
