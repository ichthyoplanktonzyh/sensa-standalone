import {sensaLightweightPronunciationMaterialSchema,type SensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {activeClientSpeechProvider,clientSpeechInputSchema} from './speech/defaultProvider';

/** Speech is saved into the materialization before it can become learning-ready. */
export async function prepareSpokenResource(surface:string,languages:SensaPinnedLanguageContext,signal:AbortSignal){
 const input=clientSpeechInputSchema.parse({surface,languageTag:languages.targetLanguageTag});
 const sound=sensaLightweightPronunciationMaterialSchema.parse(await activeClientSpeechProvider().synthesize(input,signal));
 if(sound.surface!==surface||sound.languageTag!==languages.targetLanguageTag||sound.method!=='tts')throw Error('localFlow.spokenResourceUnavailable');
 return sound;
}
