import {registerClientSpeechProvider,type ClientSpeechProvider} from './provider';

// Composition root only: the rest of the application depends on ClientSpeechProvider.
const defaultClientSpeechProvider:ClientSpeechProvider=Object.freeze({
 id:'microsoft-edge-read-aloud',revision:1,displayName:'Microsoft Edge Read Aloud',
 synthesize:async(input,signal)=>(await import('./edgeTtsClientProvider')).edgeTtsClientProvider.synthesize(input,signal),
});
registerClientSpeechProvider(defaultClientSpeechProvider,{select:true});

export * from './provider';
