import {z} from 'zod';
import {sensaLightweightPronunciationMaterialSchema} from '@sensa/contracts/sensa';
export const speechInputSchema=z.object({surface:z.string().min(1).max(500).refine(v=>v===v.trim()),languageTag:z.string().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u)}).strict();
export type SpeechProvider=(input:z.infer<typeof speechInputSchema>,signal:AbortSignal)=>Promise<z.infer<typeof sensaLightweightPronunciationMaterialSchema>>;
/** Fixed text in, verified saved speech out. Providers cannot change the expression. */
export async function prepareSpeech(input:unknown,provider:SpeechProvider|undefined,signal:AbortSignal){
 const request=speechInputSchema.parse(input);
 if(!provider)throw Error('speech_provider_unconfigured');
 const result=sensaLightweightPronunciationMaterialSchema.parse(await provider(request,signal));
 if(result.surface!==request.surface||result.languageTag!==request.languageTag||result.method!=='tts')throw Error('speech_identity_mismatch');
 return result;
}
