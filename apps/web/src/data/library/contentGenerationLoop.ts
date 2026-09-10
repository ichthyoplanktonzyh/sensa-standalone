import {makeBundle,validateBundle,modelFacts,generationSystem,type SensaContentGenerationRequest,type SensaMaterialCandidateBundle} from '@sensa/contracts/sensa';
import {complete,type ModelMessage} from './transport';
import type {Provider} from './providers';
export type ContentGenerationStep={round:number;accepted:boolean;issues:string[]};
/** Bounded generation/feedback loop. Only the caller may publish validated material. */
export async function generateLearningCandidate(request:SensaContentGenerationRequest,provider:Provider,personal:boolean,signal:AbortSignal,onStep:(step:ContentGenerationStep)=>Promise<void>){
 const messages:ModelMessage[]=[{role:'system',content:generationSystem(personal)},{role:'user',content:JSON.stringify(modelFacts(request))}];
 const bounded=AbortSignal.any([signal,AbortSignal.timeout(request.attemptBudget.timeoutMs)]);
 for(let round=1;round<=request.attemptBudget.maxModelTurns;round++){
  bounded.throwIfAborted();
  const result=await complete(provider,'content',crypto.randomUUID(),messages,[],bounded);
  const message=result.choices[0]!.message;
  if(message.tool_calls?.length)throw new Error('localFlow.generationToolDenied');
  let bundle:SensaMaterialCandidateBundle|undefined;
  let accepted=false;
  try{
   bundle=await makeBundle(request,{cue:JSON.parse(message.content??'null'),provider:provider.id,model:result.model},new Date());
   bundle.usage.modelTurns=round;
   accepted=!!(await validateBundle(request,bundle,null,new Date())).content;
  }catch(error){if(!(error instanceof SyntaxError)&&!(error instanceof Error&&error.name==='ZodError'))throw error;}
  await onStep({round,accepted,issues:accepted?[]:['invalid_recall_cue']});
  if(accepted)return bundle!;
  if(round===request.attemptBudget.maxModelTurns){if(bundle)return bundle;throw new Error('localFlow.validationRejected');}
  messages.push({role:'assistant',content:message.content??''},{role:'user',content:'Validation failed. Return only JSON with exactly scene and senseFocus. scene must be a concrete Chinese recall cue of 10–1800 characters; senseFocus must be 2–500 characters. Neither field may contain the target expression. Preserve the fixed sense and authorized context. Correct the candidate; do not change the learning target.'});
 }
 throw new Error('localFlow.validationRejected');
}
