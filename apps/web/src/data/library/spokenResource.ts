import {sensaLightweightPronunciationMaterialSchema,type SensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {auth} from '../account/auth';

/** Speech is saved into the materialization before it can become learning-ready. */
export async function prepareSpokenResource(surface:string,languages:SensaPinnedLanguageContext,signal:AbortSignal){
 const session=(await auth?.getSession())?.data.session;
 if(!session)throw Error('localFlow.accountLogin');
 const base=import.meta.env.VITE_SENSA_API_URL;
 if(!base)throw Error('localFlow.serviceUnconfigured');
 const response=await fetch(base.replace(/\/+$/u,'')+'/sensa/speech',{
  method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},
  body:JSON.stringify({surface,languageTag:languages.targetLanguageTag}),
  signal:AbortSignal.any([signal,AbortSignal.timeout(50000)]),credentials:'omit',redirect:'error',
 });
 if((await auth?.getSession())?.data.session?.user.id!==session.user.id)throw Error('localFlow.accountChanged');
 if(!response.ok)throw Error('localFlow.spokenResourceUnavailable');
 const sound=sensaLightweightPronunciationMaterialSchema.parse(await response.json());
 if(sound.surface!==surface||sound.languageTag!==languages.targetLanguageTag||sound.method!=='tts')throw Error('localFlow.spokenResourceUnavailable');
 return sound;
}
