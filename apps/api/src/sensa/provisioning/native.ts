/** Stateless content execution; native SQLite owns membership, attempts and materialization. */
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {z} from 'zod';
import {nativeProvisioningInputSchema} from '@sensa/contracts/sensa';
import type {NativeProvisioningInput} from '@sensa/contracts/sensa';
import {ConsumerError} from '../access/auth.js';
import {semanticDigest} from '../personal/nativeSemantic.js';
import {makeRequest,makeBundle,validateBundle,SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND} from './material.js';
import type {ContentGenerator,ContentReviewer} from './material.js';
export function createNativeProvisioningRoutes(options:{authorize:(request:Request)=>Promise<void>;reserve:(request:Request,input:NativeProvisioningInput)=>Promise<void>;generate:ContentGenerator;review:ContentReviewer}){
 const app=new Hono();
 app.use('*',bodyLimit({maxSize:64*1024,onError:c=>c.json({code:'body_too_large'},413)}));
 app.onError((e,c)=>c.json({code:e instanceof ConsumerError?e.code:e instanceof z.ZodError||e instanceof SyntaxError?'invalid_request':'provider_unavailable'},e instanceof ConsumerError?e.status:e instanceof z.ZodError||e instanceof SyntaxError?400:503));
 app.post('/prepare',async c=>{
  c.header('Cache-Control','no-store');await options.authorize(c.req.raw);
  const input=nativeProvisioningInputSchema.parse(await c.req.json());const {inputDigest,...payload}=input;
  if(await semanticDigest(payload)!==inputDigest)throw new ConsumerError(400,'input_digest_mismatch');
  await options.reserve(c.req.raw,input);
  const {target}=input,proposal=target;
  const request=await makeRequest({id:input.taskId,learner_user_id:input.learnerId,learning_target_id:input.taskId,fixed_input:{...target,expression:proposal.expression.surface,expressionKind:proposal.expression.type==='word'?'word':'phrase',meaning:proposal.semanticSpec.coreMeaningFocus,prototype:proposal.semanticSpec.prototypeScenes[0].summary,planRevision:input.planRevision,demand:SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND}},input.id,new Date(input.requestedAt));
  const envelope={version:input.version,id:input.id,inputDigest};
  const blocked=(reason:string)=>({...envelope,status:'blocked',reason,material:null,proof:null});
  let timer:ReturnType<typeof setTimeout>|undefined;
  const execute=async()=>{
   let generated,bundle;
   try{generated=await options.generate(request);bundle=await makeBundle(request,generated,new Date());}catch{return blocked('generation_failed');}
   let review;
   try{review=await options.review(request,generated.cue);}catch{return blocked('validation_unavailable');}
   let checked;
   try{checked=await validateBundle(request,bundle,review,new Date());}catch{return blocked('material_invalid');}
   if(!checked.content)return {...blocked('material_rejected'),proof:{request,bundle,validation:{validations:checked.validations,review,issues:checked.issues}}};
   const cue=bundle.candidates.find(v=>v.materialRoleKey==='experience_recall_cue')!.contentPayload;
   const material={scene:cue.scene,sense:cue.senseFocus,expression:proposal.expression.surface};
   const proof={request,bundle,validation:{validations:checked.validations,review,issues:checked.issues},content:checked.content,contentDigest:await semanticDigest(checked.content),materialDigest:await semanticDigest(material),adapter:'native-lightweight-v1'};
   return {...envelope,status:'ready',reason:null,material,proof};
  };
  try{
   const result=await Promise.race([execute(),new Promise<ReturnType<typeof blocked>>(resolve=>{timer=setTimeout(()=>resolve(blocked('attempt_timed_out')),75000);})]);
   await options.authorize(c.req.raw);
   return c.json(result);
  }finally{clearTimeout(timer);}
 });return app;
}
