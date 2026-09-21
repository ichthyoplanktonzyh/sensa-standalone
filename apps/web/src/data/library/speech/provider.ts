import {z} from 'zod';
import type {sensaLightweightPronunciationMaterialSchema} from '@sensa/contracts/sensa';

export const clientSpeechInputSchema=z.object({
 surface:z.string().min(1).max(500).refine(value=>value===value.trim()),
 languageTag:z.string().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u),
}).strict();
export type ClientSpeechInput=z.infer<typeof clientSpeechInputSchema>;
export type ClientSpeechMaterial=z.infer<typeof sensaLightweightPronunciationMaterialSchema>;

/** Browser-side synthesis boundary. Learning code never depends on a vendor protocol. */
export type ClientSpeechProvider=Readonly<{
 id:string;
 revision:number;
 displayName:string;
 synthesize:(input:ClientSpeechInput,signal:AbortSignal)=>Promise<ClientSpeechMaterial>;
}>;

const providers=new Map<string,ClientSpeechProvider>();
let selectedProviderId:string|undefined;

export function registerClientSpeechProvider(provider:ClientSpeechProvider,{select=false}:{select?:boolean}={}){
 if(!provider.id.trim()||!Number.isInteger(provider.revision)||provider.revision<1)throw Error('invalid_client_speech_provider');
 providers.set(provider.id,provider);
 if(select||selectedProviderId===undefined)selectedProviderId=provider.id;
 return ()=>{
  if(providers.get(provider.id)!==provider)return;
  providers.delete(provider.id);
  if(selectedProviderId===provider.id)selectedProviderId=providers.keys().next().value;
 };
}

export function selectClientSpeechProvider(providerId:string){
 if(!providers.has(providerId))throw Error('client_speech_provider_unavailable');
 selectedProviderId=providerId;
}

export function activeClientSpeechProvider(){
 const provider=selectedProviderId?providers.get(selectedProviderId):undefined;
 if(!provider)throw Error('client_speech_provider_unavailable');
 return provider;
}

/** Test/composition seam; production installs its default in defaultProvider.ts. */
export function replaceClientSpeechProvider(provider:ClientSpeechProvider){
 const previous=selectedProviderId;
 const unregister=registerClientSpeechProvider(provider,{select:true});
 return ()=>{
  unregister();
  if(previous&&providers.has(previous))selectedProviderId=previous;
 };
}
