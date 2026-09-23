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
 ['ko',{voice:'ko-KR-SunHiNeural',locale:'ko-KR'}],
 ['es',{voice:'es-ES-ElviraNeural',locale:'es-ES'}],
 ['fr',{voice:'fr-FR-DeniseNeural',locale:'fr-FR'}],
 ['de',{voice:'de-DE-KatjaNeural',locale:'de-DE'}],
 ['ru',{voice:'ru-RU-SvetlanaNeural',locale:'ru-RU'}],
 ['it',{voice:'it-IT-IsabellaNeural',locale:'it-IT'}],
 ['pt',{voice:'pt-BR-FranciscaNeural',locale:'pt-BR'}],
 ['ar',{voice:'ar-SA-ZariyahNeural',locale:'ar-SA'}],
 ['hi',{voice:'hi-IN-SwaraNeural',locale:'hi-IN'}],
 ['th',{voice:'th-TH-PremwadeeNeural',locale:'th-TH'}],
 ['vi',{voice:'vi-VN-HoaiMyNeural',locale:'vi-VN'}],
 ['id',{voice:'id-ID-GadisNeural',locale:'id-ID'}],
 ['tr',{voice:'tr-TR-EmelNeural',locale:'tr-TR'}],
 ['nl',{voice:'nl-NL-ColetteNeural',locale:'nl-NL'}],
 ['pl',{voice:'pl-PL-ZofiaNeural',locale:'pl-PL'}],
] as const);

/** Configuration only; actual synthesis is checked when preparing a resource. */
export function defaultClientSpeechConfiguredFor(languageTag:string):boolean{
 return edgeVoiceByLanguage.has(languageTag);
}
