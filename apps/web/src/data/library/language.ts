import {
  defaultSensaLanguageProfile,resolveLanguageProfile,sensaLanguage,sensaLanguageProfileSchema,
  type SensaLanguageProfile,
} from '@sensa/contracts/sensa';
import {command,readLibrary,type LibraryTransaction} from './store';

/** One key, one profile. The learner's languages are account state, not content:
 * they ride the same settings table as the daily limit, so an installation that
 * signs in reads the languages its owner already chose. */
const PROFILE_KEY='language-profile';

/** A library with no saved profile is the pair the product has always shipped.
 * Nothing is written here: absence stays absence until the learner chooses. */
export const languageProfileSnapshot=()=>readLibrary(async tx=>{
 const stored=await tx.get<unknown>('settings',PROFILE_KEY);
 return {profile:resolveLanguageProfile(stored??defaultSensaLanguageProfile),saved:stored!==undefined};
});

export async function readLanguageProfile(tx:LibraryTransaction):Promise<SensaLanguageProfile>{
  return resolveLanguageProfile(await tx.get<unknown>('settings',PROFILE_KEY)??defaultSensaLanguageProfile);
}

export async function writeLanguageProfile(tx:LibraryTransaction,profile:SensaLanguageProfile){
  const parsed=sensaLanguageProfileSchema.parse(profile);
  tx.put('settings',PROFILE_KEY,parsed);
  return parsed;
}

/** Only languages this release can actually learn enter the ledger; a tag the
 * catalog does not carry is refused here rather than written and ignored. */
function requireTargetLanguage(tag:string){
 if(sensaLanguage(tag)?.asTarget!==true)throw new Error('localFlow.unknownTargetLanguage');
 return tag;
}

/** Adding a target language is not switching to it; the active language only
 * moves when the learner says so. */
export function addTargetLanguage(operationId:string,tag:string){
 return command({id:operationId,kind:'language.addTarget',input:{tag}},async tx=>{
  requireTargetLanguage(tag);
  const current=await readLanguageProfile(tx);
  if(current.targetLanguageTags.includes(tag))return current;
  return writeLanguageProfile(tx,{...current,targetLanguageTags:[...current.targetLanguageTags,tag]});
 });
}

export function removeTargetLanguage(operationId:string,tag:string){
 return command({id:operationId,kind:'language.removeTarget',input:{tag}},async tx=>{
  const current=await readLanguageProfile(tx);
  const remaining=current.targetLanguageTags.filter(value=>value!==tag);
  if(remaining.length===current.targetLanguageTags.length)return current;
  // The last target language cannot be removed: a learner with no target
  // language has no action surface, and the profile schema forbids it.
  if(remaining.length===0)throw new Error('localFlow.lastTargetLanguage');
  return writeLanguageProfile(tx,{...current,targetLanguageTags:remaining,
    activeTargetLanguageTag:current.activeTargetLanguageTag===tag?remaining[0]!:current.activeTargetLanguageTag});
 });
}

export function setActiveTargetLanguage(operationId:string,tag:string){
 return command({id:operationId,kind:'language.setActiveTarget',input:{tag}},async tx=>{
  const current=await readLanguageProfile(tx);
  if(!current.targetLanguageTags.includes(tag))throw new Error('localFlow.unknownTargetLanguage');
  if(current.activeTargetLanguageTag===tag)return current;
  return writeLanguageProfile(tx,{...current,activeTargetLanguageTag:tag});
 });
}
