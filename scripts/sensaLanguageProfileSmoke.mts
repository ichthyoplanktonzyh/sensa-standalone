/** The language catalog and the learner's stored language choice.
 *
 * A learner keeps one familiar language and any number of target languages; the
 * active target language is the one action surfaces act on. A stored profile
 * must survive a catalog that no longer carries one of its tags, and must never
 * leave an installation without a target language.
 */
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {IDBFactory} from 'fake-indexeddb';
import {
  defaultSensaLanguageProfile,resolveLanguageProfile,sensaLanguage,sensaLanguageDisplayName,
  sensaLanguageForDeclaredTag,sensaLanguageForIso6393,sensaLanguageForRole,sensaLanguageProfileSchema,
  sensaLanguageRoleForTag,sensaLanguages,sensaLearnerLocale,
  sensaInterfaceLanguages,
} from '@sensa/contracts/sensa';

const tags=sensaLanguages.map(language=>language.tag);
assert.equal(new Set(tags).size,tags.length,'language tags must be distinct');
assert.equal(sensaLanguage('zh-CN')?.asTarget,false,'Chinese is a familiar language only, so one target language list serves the shipped product');
assert.equal(sensaLanguage('en')?.asTarget,true);
assert(sensaLanguageForRole('target').length>=10,'the target list must cover the common languages the product promises');
assert(!sensaLanguageForRole('target').some(language=>language.tag==='zh-CN'));

// The detector answers in ISO 639-3 and the library stores BCP-47, so the
// catalog is the only thing that can join them. Two languages sharing a code
// would make a detector's answer ambiguous, and a code that is not three
// lowercase letters is not a code.
const isoCodes=sensaLanguages.map(language=>language.iso6393);
assert.equal(new Set(isoCodes).size,isoCodes.length,'two languages sharing one detector code would make every detection ambiguous');
for(const language of sensaLanguages)assert.match(language.iso6393,/^[a-z]{3}$/u,`${language.tag} needs a lowercase ISO 639-3 code`);

// An answer the catalog cannot place stays unplaced rather than borrowing a
// neighbouring language: this is the same rule that keeps a third language out
// of the learner's pair, applied one step earlier.
assert.equal(sensaLanguageForIso6393('spa')?.tag,'es');
assert.equal(sensaLanguageForIso6393('yue'),undefined,'Cantonese is a real code this release does not carry, so it must not resolve to Chinese');
assert.equal(sensaLanguageForIso6393('und'),undefined,'an undetermined answer is not a language');
assert.equal(sensaLanguageForIso6393('eng')?.tag,'en');
assert.equal(sensaLanguageForIso6393('ENG'),undefined,'the catalog matches the detector vocabulary exactly, in its own case');

// A declaration carries subtags the catalog does not, so the primary subtag is
// the fallback — but never a guess between two entries of the same family.
assert.equal(sensaLanguageForDeclaredTag('en')?.tag,'en');
assert.equal(sensaLanguageForDeclaredTag('en-US')?.tag,'en');
assert.equal(sensaLanguageForDeclaredTag('EN-gb')?.tag,'en');
assert.equal(sensaLanguageForDeclaredTag('zh')?.tag,'zh-CN','the bare zh of a declaration names the catalog Chinese entry');
assert.equal(sensaLanguageForDeclaredTag('zh-Hans-CN')?.tag,'zh-CN');
assert.equal(sensaLanguageForDeclaredTag('yue')?.tag,undefined,'an uncurated declaration is unplaced, not rounded to a relative');
assert.equal(sensaLanguageForDeclaredTag('')?.tag,undefined);

// The side a capture sits on is the library's answer, never the sender's, and a
// language outside the pair has no side at all rather than a default one.
const pair={familiarLanguageTag:'zh-CN',targetLanguageTag:'en'};
assert.equal(sensaLanguageRoleForTag('en',pair),'target');
assert.equal(sensaLanguageRoleForTag('zh-CN',pair),'familiar');
assert.equal(sensaLanguageRoleForTag('fr',pair),null,'a third language belongs to neither side');
assert.equal(sensaLanguageRoleForTag(null,pair),null,'an undetermined language belongs to neither side');

for(const language of sensaLanguages){
  assert(language.endonym.trim(),`${language.tag} needs an endonym`);
  assert(language.speechLocale.length>=2,`${language.tag} needs a speech locale`);
  assert(language.wiktionaryCode.trim().length>0,`${language.tag} needs a dictionary group`);
  for(const interfaceLanguage of sensaInterfaceLanguages)assert(language.names[interfaceLanguage].trim(),`${language.tag} needs a ${interfaceLanguage} name`);
  // A display name is read by someone who does not yet know the language, so an
  // unknown tag must still render as itself instead of as nothing.
  assert.equal(sensaLanguageDisplayName(language.tag,'zh-CN'),language.names['zh-CN']);
  assert.equal(sensaLanguageDisplayName(language.tag,'en'),language.names.en);
}
assert.equal(sensaLanguageDisplayName('xx-unknown','en'),'xx-unknown');
const dictionaryGroups=sensaLanguages.map(language=>language.wiktionaryCode);
assert.equal(new Set(dictionaryGroups).size,dictionaryGroups.length,'two languages sharing one dictionary group would cross-resolve their words');
assert.equal(sensaLearnerLocale('zh-CN'),'zh-CN','the reviewed access-path locale follows the familiar language');

const profile=defaultSensaLanguageProfile;
assert.deepEqual(sensaLanguageProfileSchema.parse(profile),profile);
assert.equal(profile.familiarLanguageTag,'zh-CN');
assert.deepEqual(profile.targetLanguageTags,['en']);
assert.equal(profile.activeTargetLanguageTag,'en','a library with no saved profile keeps the shipped pair');

const rejected=(label:string,value:unknown)=>{assert.equal(sensaLanguageProfileSchema.safeParse(value).success,false,label);};
rejected('familiar language cannot also be the active target language',{familiarLanguageTag:'en',targetLanguageTags:['en'],activeTargetLanguageTag:'en'});
rejected('the active target language must be one of the target languages',{familiarLanguageTag:'zh-CN',targetLanguageTags:['en'],activeTargetLanguageTag:'es'});
rejected('target languages must be distinct',{familiarLanguageTag:'zh-CN',targetLanguageTags:['en','en'],activeTargetLanguageTag:'en'});
rejected('the familiar language must not also be a target language',{familiarLanguageTag:'zh-CN',targetLanguageTags:['en','zh-CN'],activeTargetLanguageTag:'en'});
rejected('at least one target language is required',{familiarLanguageTag:'zh-CN',targetLanguageTags:[],activeTargetLanguageTag:'en'});

// A catalog can drop a language that a stored profile still names.
assert.deepEqual(resolveLanguageProfile({familiarLanguageTag:'zh-CN',targetLanguageTags:['en','xx-removed'],activeTargetLanguageTag:'en'}),
  {familiarLanguageTag:'zh-CN',targetLanguageTags:['en'],activeTargetLanguageTag:'en'});
assert.deepEqual(resolveLanguageProfile({familiarLanguageTag:'zh-CN',targetLanguageTags:['en','es'],activeTargetLanguageTag:'xx-removed'}),
  {familiarLanguageTag:'zh-CN',targetLanguageTags:['en','es'],activeTargetLanguageTag:'en'},'an unplaceable active language falls back to the first target language');
assert.deepEqual(resolveLanguageProfile({familiarLanguageTag:'xx-removed',targetLanguageTags:['xx-removed'],activeTargetLanguageTag:'xx-removed'}),defaultSensaLanguageProfile,
  'a profile with nothing placeable left is read as the shipped pair instead of breaking the library');
assert.deepEqual(resolveLanguageProfile(null),defaultSensaLanguageProfile);
assert.deepEqual(resolveLanguageProfile({familiarLanguageTag:'zh-CN',targetLanguageTags:[...tags,'en'],activeTargetLanguageTag:'en'}).targetLanguageTags.length,8,
  'a stored profile longer than the schema allows is truncated rather than repaired forever');
assert.deepEqual(resolveLanguageProfile(profile),profile,'a valid profile is returned unchanged');

const root=await mkdtemp(join(tmpdir(),'sensa-language-'));
Object.assign(globalThis,{indexedDB:new IDBFactory(),window:new EventTarget(),BroadcastChannel:undefined});
try{
 const file=join(root,'language.mjs');
 await build({entryPoints:['apps/web/src/data/library/language.ts'],outfile:file,bundle:true,platform:'browser',format:'esm',logLevel:'silent'});
 const language=await import(pathToFileURL(file).href);
 const op=()=>crypto.randomUUID();

 assert.deepEqual(await language.languageProfileSnapshot(),{profile:defaultSensaLanguageProfile,saved:false},'nothing is written before the learner chooses');

 const added=await language.addTargetLanguage(op(),'es');
 assert.deepEqual(added,{familiarLanguageTag:'zh-CN',targetLanguageTags:['en','es'],activeTargetLanguageTag:'en'},'adding a target language must not move the active one');
 assert.deepEqual(await language.addTargetLanguage(op(),'es'),added,'adding a language twice is a no-op, not a duplicate');
 assert.deepEqual((await language.languageProfileSnapshot()).saved,true);

 const switched=await language.setActiveTargetLanguage(op(),'es');
 assert.equal(switched.activeTargetLanguageTag,'es');
 assert.deepEqual(switched.targetLanguageTags,['en','es'],'switching keeps every target language in the profile');
 assert.equal((await language.setActiveTargetLanguage(op(),'es')).activeTargetLanguageTag,'es');
 await assert.rejects(()=>language.setActiveTargetLanguage(op(),'ja'),/localFlow\.unknownTargetLanguage/u,'a language that was never added cannot become active');
 await assert.rejects(()=>language.addTargetLanguage(op(),'xx-unknown'),/localFlow\.unknownTargetLanguage/u,'a language this release does not carry is refused instead of written');
 await assert.rejects(()=>language.addTargetLanguage(op(),'zh-CN'),/localFlow\.unknownTargetLanguage/u,'the familiar language cannot also be added as a target language');

 const removed=await language.removeTargetLanguage(op(),'es');
 assert.deepEqual(removed,{familiarLanguageTag:'zh-CN',targetLanguageTags:['en'],activeTargetLanguageTag:'en'},'removing the active language moves the active choice to a remaining one');
 await assert.rejects(()=>language.removeTargetLanguage(op(),'en'),/localFlow\.lastTargetLanguage/u,'an installation must keep a target language');
 assert.deepEqual((await language.languageProfileSnapshot()).profile,defaultSensaLanguageProfile);

 // The command ledger makes a retried write idempotent instead of additive.
 const retry=op();
 const first=await language.addTargetLanguage(retry,'fr');
 const replay=await language.addTargetLanguage(retry,'fr');
 assert.deepEqual(replay,first);
 assert.deepEqual((await language.languageProfileSnapshot()).profile.targetLanguageTags,['en','fr']);

 // Several target languages coexist without a second profile: each one is simply
 // another entry in the same list.
 const twoTargets=await language.addTargetLanguage(op(),'ja');
 assert.deepEqual(twoTargets.targetLanguageTags,['en','fr','ja']);
 console.log('PASS: the language catalog is complete and unambiguous — a detector code and a declared tag each place against exactly one entry — a stored profile survives catalog changes, adding, switching and removing target languages leave the active choice and the command ledger consistent, and the side a captured language sits on is resolved by the pair rather than named by the sender. Fake IndexedDB; browser storage is exercised by the Web smokes.');
}finally{await rm(root,{recursive:true,force:true});}
