/** Exact language tags the shipped client speech provider can synthesize. */
export const edgeVoiceByLanguage:ReadonlyMap<string,{voice:string;locale:string}>=new Map([
 ['en',{voice:'en-US-JennyNeural',locale:'en-US'}],
 ['en-US',{voice:'en-US-JennyNeural',locale:'en-US'}],
 ['en-GB',{voice:'en-GB-SoniaNeural',locale:'en-GB'}],
 ['zh',{voice:'zh-CN-XiaoxiaoNeural',locale:'zh-CN'}],
 ['zh-CN',{voice:'zh-CN-XiaoxiaoNeural',locale:'zh-CN'}],
 ['zh-Hans',{voice:'zh-CN-XiaoxiaoNeural',locale:'zh-CN'}],
 ['ja',{voice:'ja-JP-NanamiNeural',locale:'ja-JP'}],
 ['ja-JP',{voice:'ja-JP-NanamiNeural',locale:'ja-JP'}],
] as const);

/** Configuration only; actual synthesis is checked when preparing a resource. */
export function defaultClientSpeechConfiguredFor(languageTag:string):boolean{
 return edgeVoiceByLanguage.has(languageTag);
}
