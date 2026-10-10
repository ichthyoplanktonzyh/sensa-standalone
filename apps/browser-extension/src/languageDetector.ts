import {sensaCanonicalLanguageTag,sensaLanguageForDeclaredTag} from '@sensa/contracts/sensa';

/**
 * Chrome's local CLD observation, or nothing when it cannot reliably place text.
 *
 * Keep the browser's mature detector behind one interface instead of bundling
 * another language model. Known plain codes use the existing ISO-639-3 wire
 * vocabulary; variants and unsupported codes stay intact. No learner Route or
 * supported-language candidate restriction changes the observation.
 *
 * Confidence records CLD's reported text share, not a correctness probability.
 * An unreliable/unknown observation is not guessed into English. Callers may
 * use an actual source declaration, or keep language undetermined.
 */
export async function detectSourceLanguage(text:string):Promise<{code:string;confidence:number}|null>{
 try{
  const result=await chrome.i18n.detectLanguage(text);
  if(result.isReliable!==true||!Array.isArray(result.languages))return null;
  const first=result.languages.filter(item=>typeof item.language==='string'&&Number.isFinite(item.percentage)&&item.percentage>0&&item.percentage<=100).sort((a,b)=>b.percentage-a.percentage)[0];
  const tag=first?sensaCanonicalLanguageTag(first.language):null;
  if(!first||!tag||tag==='und')return null;
  const language=sensaLanguageForDeclaredTag(tag);
  return {code:!tag.includes('-')&&language?language.iso6393:tag,confidence:first.percentage/100};
 }catch{return null;}
}
