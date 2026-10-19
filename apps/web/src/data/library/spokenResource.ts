import {sensaLightweightPronunciationMaterialSchema,type SensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {activeClientSpeechProvider,clientSpeechInputSchema} from './speech/defaultProvider';

/** Speech is saved into the materialization before it can become learning-ready. */
export async function prepareSpokenResource(surface:string,languages:SensaPinnedLanguageContext,signal:AbortSignal){
 const input=clientSpeechInputSchema.parse({surface,languageTag:languages.targetLanguageTag});
 let result;
 try {result=await activeClientSpeechProvider().synthesize(input,signal);}
 catch(error){
  signal.throwIfAborted();
  if(error instanceof Error&&(error.message.startsWith('edge_tts_')||error.message==='speech_language_unavailable'||error.message==='speech_cancelled'))throw Error('localFlow.spokenResourceUnavailable',{cause:error});
  throw error;
 }
 const sound=sensaLightweightPronunciationMaterialSchema.parse(result);
 if(sound.surface!==surface||sound.languageTag!==languages.targetLanguageTag||sound.method!=='tts')throw Error('localFlow.spokenResourceUnavailable');
 return sound;
}
