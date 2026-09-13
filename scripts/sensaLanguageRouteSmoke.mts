/** Language identities, contextual roles, learner-owned Routes, and one
 * surface-scoped Active Route Selection. Fake IndexedDB; no network. */
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {IDBFactory} from 'fake-indexeddb';
import {
  defaultSensaLanguageRoute,
  defaultSensaLanguageRouteCollection,
  sensaCanonicalLanguageTag,
  sensaInterfaceLocales,
  sensaLanguage,
  sensaLanguageDisplayName,
  sensaLanguageForDeclaredTag,
  sensaLanguageForIso6393,
  sensaLanguageForRole,
  sensaLanguageLearningRouteSchema,
  sensaLanguageRolesForTag,
  sensaLanguageRouteCollectionSchema,
  sensaLanguageTagSchema,
  sensaLanguages,
  sensaLearnerLocale,
  sensaPinnedLanguageContext,
  sensaPinnedLanguageContextSchema,
  sensaResolveLanguageSupport,
} from '@sensa/contracts/sensa';

const tags=sensaLanguages.map(language=>language.tag);
assert.equal(new Set(tags).size,tags.length,'language tags must be distinct');
assert.equal(sensaLanguage('en')?.asTarget,true);
assert(sensaLanguageForRole('target').length>=10);
assert.equal(sensaLanguageForRole('support').length,sensaLanguages.length);

const isoCodes=sensaLanguages.map(language=>language.iso6393);
assert.equal(new Set(isoCodes).size,isoCodes.length);
for(const language of sensaLanguages)assert.match(language.iso6393,/^[a-z]{3}$/u);
assert.equal(sensaLanguageForIso6393('spa')?.tag,'es');
assert.equal(sensaLanguageForIso6393('yue'),undefined);
assert.equal(sensaLanguageForIso6393('und'),undefined);

assert.equal(sensaCanonicalLanguageTag('en-us'),'en-US');
assert.equal(sensaCanonicalLanguageTag('not_a_tag'),null);
assert.equal(sensaLanguageTagSchema.safeParse('en-US').success,true);
assert.equal(sensaLanguageTagSchema.safeParse('en-us').success,false,'stored identities use canonical spelling');
assert.equal(sensaLanguageForDeclaredTag('en-US')?.tag,'en');
assert.equal(sensaLanguageForDeclaredTag('EN-gb')?.tag,'en');
assert.equal(sensaLanguageForDeclaredTag('zh-Hans-CN')?.tag,'zh-CN');
assert.equal(sensaLanguageForDeclaredTag('yue'),undefined);
assert.deepEqual(sensaResolveLanguageSupport('en',['en','es']),{status:'exact',requestedLanguageTag:'en',effectiveLanguageTag:'en'});
assert.deepEqual(sensaResolveLanguageSupport('en-US',['en','es']),{status:'fallback',requestedLanguageTag:'en-US',effectiveLanguageTag:'en'});
assert.deepEqual(sensaResolveLanguageSupport('fr',['en','es']),{status:'unavailable',requestedLanguageTag:'fr',effectiveLanguageTag:null});

const context={targetLanguageTag:'en',supportLanguageTag:'zh-CN'};
assert.deepEqual(sensaLanguageRolesForTag('en',context),['target']);
assert.deepEqual(sensaLanguageRolesForTag('zh-CN',context),['support']);
assert.deepEqual(sensaLanguageRolesForTag('fr',context),[]);
assert.deepEqual(sensaLanguageRolesForTag('en',{targetLanguageTag:'en',supportLanguageTag:'en'}),['target','support'],'one language may play both contextual roles');
assert.equal(sensaPinnedLanguageContextSchema.safeParse({...context,languageRouteId:crypto.randomUUID()}).success,false,'a formal context pins id and revision together');

for(const language of sensaLanguages){
  assert(language.endonym.trim());
  for(const locale of sensaInterfaceLocales)assert(language.names[locale].trim());
  assert.equal(sensaLanguageDisplayName(language.tag,'zh-CN'),language.names['zh-CN']);
  assert.equal(sensaLanguageDisplayName(language.tag,'en'),language.names.en);
}
assert.equal(sensaLanguageDisplayName('yue','en'),'yue');
assert.equal(sensaLearnerLocale('zh-CN'),'zh-CN');

assert.deepEqual(sensaLanguageLearningRouteSchema.parse(defaultSensaLanguageRoute),defaultSensaLanguageRoute);
assert.deepEqual(sensaLanguageRouteCollectionSchema.parse(defaultSensaLanguageRouteCollection),defaultSensaLanguageRouteCollection);
assert.deepEqual(sensaPinnedLanguageContext(defaultSensaLanguageRoute),{
  targetLanguageTag:'en',supportLanguageTag:'zh-CN',languageRouteId:defaultSensaLanguageRoute.id,languageRouteRevision:1,
});
assert.equal(sensaLanguageLearningRouteSchema.safeParse({...defaultSensaLanguageRoute,targetLanguageTag:'en-US'}).success,true,'a Route preserves an exact supported variant');
assert.equal(sensaLanguageLearningRouteSchema.safeParse({...defaultSensaLanguageRoute,defaultSupportLanguageTag:'en'}).success,true,'Target and Support may be the same');
assert.equal(sensaLanguageRouteCollectionSchema.safeParse({revision:1,routes:[defaultSensaLanguageRoute,defaultSensaLanguageRoute]}).success,false);
assert.equal(sensaLanguageRouteCollectionSchema.safeParse({revision:1,routes:[{...defaultSensaLanguageRoute,status:'paused'}]}).success,false,'a collection must keep one Route available for active selection');

const root=await mkdtemp(join(tmpdir(),'sensa-language-route-'));
Object.assign(globalThis,{indexedDB:new IDBFactory(),window:new EventTarget(),BroadcastChannel:undefined});
try{
  const file=join(root,'language.mjs');
  await build({entryPoints:['apps/web/src/data/library/language.ts'],outfile:file,bundle:true,platform:'browser',format:'esm',logLevel:'silent'});
  const language=await import(pathToFileURL(file).href);
  const op=()=>crypto.randomUUID();

  const shipped=await language.languageRoutesSnapshot();
  assert.deepEqual(shipped.collection,defaultSensaLanguageRouteCollection);
  assert.deepEqual(shipped.activeRoute,defaultSensaLanguageRoute);
  assert.deepEqual(shipped.context,sensaPinnedLanguageContext(defaultSensaLanguageRoute));
  assert.equal(shipped.saved,false,'absence remains absence until the learner changes Routes');

  const spanish=await language.addLanguageRoute(op(),'es','zh-CN');
  assert.equal(spanish.targetLanguageTag,'es');
  assert.equal((await language.languageRoutesSnapshot()).activeRoute.id,defaultSensaLanguageRoute.id,'adding is not selecting');
  assert.equal((await language.addLanguageRoute(op(),'es','zh-CN')).id,spanish.id,'the same live Route is not duplicated');
  await language.setActiveLanguageRoute(op(),spanish.id);
  assert.equal((await language.languageRoutesSnapshot()).context.languageRouteId,spanish.id);

  const immersion=await language.updateLanguageRouteSupport(op(),spanish.id,'es');
  assert.equal(immersion.defaultSupportLanguageTag,'es');
  assert.equal(immersion.revision,2);
  assert.deepEqual((await language.languageRoutesSnapshot()).context.targetLanguageTag,(await language.languageRoutesSnapshot()).context.supportLanguageTag);

  await language.setLanguageRouteStatus(op(),spanish.id,'paused');
  assert.equal((await language.languageRoutesSnapshot()).activeRoute.id,defaultSensaLanguageRoute.id,'pausing the selected Route repairs only the device selection');
  await language.setLanguageRouteStatus(op(),spanish.id,'active');
  await language.setActiveLanguageRoute(op(),spanish.id);
  await language.setLanguageRouteStatus(op(),spanish.id,'archived');
  assert.equal((await language.languageRoutesSnapshot()).activeRoute.id,defaultSensaLanguageRoute.id,'archiving the selected Route repairs only the device selection');
  await assert.rejects(()=>language.setLanguageRouteStatus(op(),defaultSensaLanguageRoute.id,'archived'),/localFlow\.lastLanguageRoute/u);
  await language.setLanguageRouteStatus(op(),spanish.id,'active');

  const retry=op();
  const french=await language.addLanguageRoute(retry,'fr','en');
  assert.deepEqual(await language.addLanguageRoute(retry,'fr','en'),french,'the command ledger makes retry idempotent');
  assert.equal((await language.languageRoutesSnapshot()).collection.routes.length,3);
  await assert.rejects(()=>language.addLanguageRoute(op(),'yue','en'),/localFlow\.unknownTargetLanguage/u);
  console.log('PASS: absolute canonical Language Tags, contextual roles including same-language Target/Support, versioned learner-owned Routes, device-scoped Active Route Selection, archival repair and pinned contexts.');
}finally{await rm(root,{recursive:true,force:true});}
