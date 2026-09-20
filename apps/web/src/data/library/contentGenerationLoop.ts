import {makeBundle,validateBundle,modelFacts,generationSystem,requestLanguages,type SensaContentGenerationRequest,type SensaMaterialCandidateBundle} from '@sensa/contracts/sensa';
import {complete,type ModelMessage} from './transport';
import type {Provider} from './providers';
export type ContentGenerationStep={round:number;accepted:boolean;issues:string[]};
/** Bounded generation/feedback loop. Only the caller may publish validated material. */
export async function generateLearningCandidate(request:SensaContentGenerationRequest,provider:Provider,personal:boolean,signal:AbortSignal,onStep:(step:ContentGenerationStep)=>Promise<void>){
 const images=(request.contextArtifacts.find(a=>a.contextKind==='origin_experience')?.payload.images??[]) as import('./conversationImages').ConversationImage[];
 // The cue language is read from the frozen request, not from the profile: a
 // switch mid-preparation must not change the language of material for a sense
 // that was accepted in another one.
 const languages=requestLanguages(request);
 const richInstructions=' HTML must be offline and declarative: no scripts, event handlers, links, forms, external media or stylesheets. Use button data-action=toggle data-target=ID, data-action=increment data-target=ID, draggable=true and data-dropzone. Reference supplied images only by imageIds.';
 const messages:ModelMessage[]=[{role:'system',content:generationSystem(personal,languages)+richInstructions},{role:'user',content:JSON.stringify(modelFacts(request)),...(images.length?{images}:{})}];
 const bounded=AbortSignal.any([signal,AbortSignal.timeout(request.attemptBudget.timeoutMs)]);
 for(let round=1;round<=request.attemptBudget.maxModelTurns;round++){
  bounded.throwIfAborted();
  const result=await complete(provider,'content',crypto.randomUUID(),messages,[],bounded);
  const message=result.choices[0]!.message;
  if(message.tool_calls?.length)throw new Error('localFlow.generationToolDenied');
  let bundle:SensaMaterialCandidateBundle|undefined;
  let accepted=false;let correction='The candidate did not satisfy the fixed learning demand.';
  try{
   bundle=await makeBundle(request,{cue:JSON.parse(message.content??'null'),provider:provider.id,model:result.model},new Date());
   bundle.usage.modelTurns=round;
   accepted=!!(await validateBundle(request,bundle,null,new Date())).content;
  }catch(error){if(!(error instanceof SyntaxError)&&!(error instanceof Error&&(error.name==='ZodError'||['unknown_context_image','undeclared_generated_resource'].includes(error.message))))throw error;correction=error instanceof SyntaxError?'Return valid JSON without markdown fences.':error.message.slice(0,4000);}
  await onStep({round,accepted,issues:accepted?[]:['invalid_learning_resources']});
  if(accepted)return bundle!;
  if(round===request.attemptBudget.maxModelTurns){if(bundle)return bundle;throw new Error('localFlow.validationRejected');}
  messages.push({role:'assistant',content:message.content??''},{role:'user',content:correction+' Return only JSON {resources:[{role,payload}]} satisfying the supplied resourceContracts. Include all required model roles. Preserve the same experience across cue, binding and scene realization; never change the learning target.'});
 }
 throw new Error('localFlow.validationRejected');
}
