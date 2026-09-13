import {
  defaultSensaLanguageRoute,
  defaultSensaLanguageRouteCollection,
  sensaFormalPinnedLanguageContextSchema,
  sensaLanguageRouteCollectionSchema,
  sensaPinnedLanguageContext,
  sensaReadingGlossarySchema,
  type SensaFormalPinnedLanguageContext,
  type SensaLanguageRouteCollection,
  type SensaReadingGlossary,
} from '@sensa/contracts/sensa';
/**
 * The learner's Route collection, as published by the Web application.
 *
 * The Route source of truth is the learner's local library, which this
 * extension cannot read, so the Web application publishes the collection here.
 * The extension edits only its own Active Route Selection; Route languages,
 * status and revisions remain Web-owned.
 */
export type ReadingLanguageContext=SensaFormalPinnedLanguageContext;
export const defaultReadingLanguageContext:ReadingLanguageContext=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
async function readingLanguageRoutes():Promise<SensaLanguageRouteCollection>{
 const parsed=sensaLanguageRouteCollectionSchema.safeParse((await chrome.storage.local.get('readingLanguageRoutes')).readingLanguageRoutes);
 return parsed.success?parsed.data:defaultSensaLanguageRouteCollection;
}
export async function readingLanguageContext():Promise<ReadingLanguageContext>{
 const routes=await readingLanguageRoutes(),selected=(await chrome.storage.local.get('readingActiveLanguageRouteId')).readingActiveLanguageRouteId;
 const route=routes.routes.find(item=>item.id===selected&&item.status==='active')??routes.routes.find(item=>item.status==='active')??defaultSensaLanguageRoute;
 return sensaPinnedLanguageContext(route);
}
export async function readingLanguageRouteSnapshot(){
 const collection=await readingLanguageRoutes(),context=await readingLanguageContext();
 return {collection,context};
}
export async function publishReadingLanguageRoutes(value:unknown):Promise<ReadingLanguageContext>{
 const collection=sensaLanguageRouteCollectionSchema.parse(value),selected=(await chrome.storage.local.get('readingActiveLanguageRouteId')).readingActiveLanguageRouteId;
 const route=collection.routes.find(item=>item.id===selected&&item.status==='active')??collection.routes.find(item=>item.status==='active')!;
 const context=sensaFormalPinnedLanguageContextSchema.parse(sensaPinnedLanguageContext(route));
 await chrome.storage.local.set({readingLanguageRoutes:collection,readingActiveLanguageRouteId:route.id});
 return context;
}
export async function selectReadingLanguageRoute(routeId:string):Promise<ReadingLanguageContext>{
 const collection=await readingLanguageRoutes(),route=collection.routes.find(item=>item.id===routeId&&item.status==='active');
 if(!route)throw new Error('unknown_language_route');
 await chrome.storage.local.set({readingActiveLanguageRouteId:route.id});
 return sensaPinnedLanguageContext(route);
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
export type ReadingPreferences={actionName:string;actionPrompt:string;disabledSites:string[];speechRate:number;speechVoice:string};
export const defaultPreferences:ReadingPreferences={actionName:'用法辨析',actionPrompt:'解释选中表达在当前语境中的用法，指出容易混淆的意思，并给出一个简短例句。',disabledSites:[],speechRate:1,speechVoice:''};
/** Out-of-range rather than merely odd: the speaking side clamps to the same
 * range, so a stored number outside it is a number nothing will use. */
const speechRate=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.min(2,Math.max(0.5,value)):defaultPreferences.speechRate;
/** A site rule is a hostname and nothing else: no scheme, no port, no path, so
 * the rule a learner writes in the settings page is the rule a page can match. */
export function readingSiteHost(value:unknown):string|null{
  if(typeof value!=='string')return null;
  const host=value.trim().toLowerCase();
  return /^([a-z0-9-]+\.)*[a-z0-9-]+$/u.test(host)?host:null;
}
/** The site a page belongs to, or none when it has none: `chrome://`, `file://`
 * and extension pages are not sites a reading rule could be about. */
export function readingSiteOf(url:unknown):string|null{
  if(typeof url!=='string')return null;
  try{
    const parsed=new URL(url);
    return parsed.protocol==='http:'||parsed.protocol==='https:'?readingSiteHost(parsed.hostname):null;
  }catch{return null;}
}
export async function readingPreferences():Promise<ReadingPreferences>{
  const stored=(await chrome.storage.local.get('readingPreferences')).readingPreferences;
  const raw=stored&&typeof stored==='object'?stored as Record<string,unknown>:{};
  return {actionName:typeof raw?.actionName==='string'?raw.actionName.slice(0,24):defaultPreferences.actionName,
    actionPrompt:typeof raw?.actionPrompt==='string'?raw.actionPrompt.slice(0,2000):defaultPreferences.actionPrompt,
    speechRate:speechRate(raw?.speechRate),
    // An empty name means the same as a name this machine does not have: the
    // reader chooses. A voice belongs to a device, so a name chosen on another
    // one is not a preference this device can honour.
    speechVoice:typeof raw?.speechVoice==='string'?raw.speechVoice.trim().slice(0,100):'',
    // A stored rule this release cannot read is dropped from the rules it is
    // read with: a learner whose settings page was hand-edited keeps reading.
    disabledSites:Array.isArray(raw?.disabledSites)?raw.disabledSites.map(readingSiteHost).filter((site):site is string=>site!==null).slice(0,100):[]};
}
/**
 * The one writer for reading preferences.
 *
 * The settings page and the page's own site switch both save through it, so a
 * value one of them writes is a value the other reads back the same way. It
 * refuses what it cannot represent instead of dropping it: a settings page that
 * quietly discarded a mistyped line would leave the learner believing a rule
 * exists.
 */
export async function saveReadingPreferences(value:unknown):Promise<ReadingPreferences>{
  const raw=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const requested=Array.isArray(raw.disabledSites)?raw.disabledSites:[];
  const sites=requested.map(readingSiteHost);
  if(requested.length>100||sites.some(site=>site===null))throw new Error('invalid_sites');
  const next:ReadingPreferences={
    actionName:typeof raw.actionName==='string'?(raw.actionName.trim().slice(0,24)||defaultPreferences.actionName):defaultPreferences.actionName,
    actionPrompt:typeof raw.actionPrompt==='string'?raw.actionPrompt.slice(0,2000):defaultPreferences.actionPrompt,
    speechRate:speechRate(raw.speechRate),
    speechVoice:typeof raw.speechVoice==='string'?raw.speechVoice.trim().slice(0,100):'',
    disabledSites:[...new Set(sites as string[])],
  };
  await chrome.storage.local.set({readingPreferences:next});
  return next;
}
