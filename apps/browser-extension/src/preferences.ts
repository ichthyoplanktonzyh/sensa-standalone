import {sensaReadingGlossarySchema,type SensaReadingGlossary} from '@sensa/contracts/sensa';
/**
 * The learner's two languages, as published by the Web application.
 *
 * The profile's source of truth is the learner's local library, which this
 * extension cannot read, so the Web application publishes it here through the
 * same bridge it uses to hand over captures. The extension never edits this: an
 * editable second copy is how two surfaces come to disagree about which language
 * a learner is studying.
 */
export type ReadingLanguages={familiarLanguageTag:string;targetLanguageTag:string};
/** The pair the product ships, used only while nothing has been published yet —
 * the same answer the library gives for a library with no saved profile. */
export const defaultReadingLanguages:ReadingLanguages={familiarLanguageTag:'zh-CN',targetLanguageTag:'en'};
const languageTag=(value:unknown,fallback:string)=>typeof value==='string'&&value.trim()&&value.trim().length<=35?value.trim():fallback;
export async function readingLanguages():Promise<ReadingLanguages>{
 const stored=(await chrome.storage.local.get('readingLanguages')).readingLanguages as Record<string,unknown>|undefined;
 if(!stored||typeof stored!=='object')return defaultReadingLanguages;
 const familiar=languageTag(stored.familiarLanguageTag,defaultReadingLanguages.familiarLanguageTag);
 const target=languageTag(stored.targetLanguageTag,defaultReadingLanguages.targetLanguageTag);
 // One language cannot be both sides of the boundary, so a published pair that
 // says so is not a pair and the shipped one stands.
 return familiar===target?defaultReadingLanguages:{familiarLanguageTag:familiar,targetLanguageTag:target};
}
export async function publishReadingLanguages(value:unknown):Promise<ReadingLanguages>{
 const raw=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const next={familiarLanguageTag:languageTag(raw.familiarLanguageTag,defaultReadingLanguages.familiarLanguageTag),targetLanguageTag:languageTag(raw.targetLanguageTag,defaultReadingLanguages.targetLanguageTag)};
 if(next.familiarLanguageTag===next.targetLanguageTag)throw new Error('invalid_languages');
 await chrome.storage.local.set({readingLanguages:next});
 return next;
}
/**
 * The learner's glossary, as published by the Web application.
 *
 * Same rule as the pair: the library owns it, this holds the copy it was told,
 * and nothing here edits it. Every reading request carries it, so a prompt names
 * the learner's own renderings rather than whatever the model would have chosen.
 * A copy this release cannot read is no glossary — the reader is not blocked by
 * it — and the publication itself is refused, so a Web application speaking a
 * shape this release does not have learns that instead of silently losing the
 * learner's words.
 */
export async function readingGlossary():Promise<SensaReadingGlossary>{
 const parsed=sensaReadingGlossarySchema.safeParse((await chrome.storage.local.get('readingGlossary')).readingGlossary??[]);
 return parsed.success?parsed.data:[];
}
export async function publishReadingGlossary(value:unknown):Promise<SensaReadingGlossary>{
 const parsed=sensaReadingGlossarySchema.parse(value);
 await chrome.storage.local.set({readingGlossary:parsed});
 return parsed;
}
export type ReadingPreferences={actionName:string;actionPrompt:string;disabledSites:string[];speechRate:number};
export const defaultPreferences:ReadingPreferences={actionName:'用法辨析',actionPrompt:'解释选中表达在当前语境中的用法，指出容易混淆的意思，并给出一个简短例句。',disabledSites:[],speechRate:1};
/** Out-of-range rather than merely odd: the speaking side clamps to the same
 * range, so a stored number outside it is a number nothing will use. */
const speechRate=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.min(2,Math.max(0.5,value)):defaultPreferences.speechRate;
export async function readingPreferences():Promise<ReadingPreferences>{
  const stored=(await chrome.storage.local.get('readingPreferences')).readingPreferences;
  const raw=stored&&typeof stored==='object'?stored as Record<string,unknown>:{};
  return {actionName:typeof raw?.actionName==='string'?raw.actionName.slice(0,24):defaultPreferences.actionName,
    actionPrompt:typeof raw?.actionPrompt==='string'?raw.actionPrompt.slice(0,2000):defaultPreferences.actionPrompt,
    speechRate:speechRate(raw?.speechRate),
    disabledSites:Array.isArray(raw?.disabledSites)?raw.disabledSites.filter((s:unknown)=>typeof s==='string').slice(0,100):[]};
}
