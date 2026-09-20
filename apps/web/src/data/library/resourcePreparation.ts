import {canonicalConsumerJson,learningResourcePreparationResultSchema,type SensaLightweightExpressionSnapshot} from '@sensa/contracts/sensa';
import {auth} from '../account/auth';
/** Sources are prepared before the model sees its fixed scope. Optional source
 * outages leave the category unready and do not block otherwise valid learning. */
export async function prepareLearningReferenceFacts(expression:SensaLightweightExpressionSnapshot,supportLanguageTag:string,meaning:string,signal:AbortSignal){
 const session=(await auth?.getSession())?.data.session,base=import.meta.env.VITE_SENSA_API_URL;
 if(!session||!base)return [];
 const input={expression,supportLanguageTag,meaning};
 try{
  const response=await fetch(base.replace(/\/+$/u,'')+'/sensa/resource-facts',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},body:JSON.stringify(input),signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),credentials:'omit',redirect:'error'});
  if(!response.ok)return [];
  const result=learningResourcePreparationResultSchema.parse(await response.json());
  if((await auth?.getSession())?.data.session?.user.id!==session.user.id)throw Error('localFlow.accountChanged');
  if(canonicalConsumerJson(result.input)!==canonicalConsumerJson(input))throw Error('localFlow.resourceInvalid');
  return result.references;
 }catch(error){signal.throwIfAborted();if(error instanceof Error&&error.message.startsWith('localFlow.'))throw error;return [];}
}
