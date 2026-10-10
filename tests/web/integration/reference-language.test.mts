import {test} from 'vitest';
/** The Reference dictionary boundary under the learner's own language pair.
 *
 * A dictionary lookup is about one target language. This exercises the real
 * lookup module against canned provider payloads and a canned model answer, and
 * asserts that the language reaches every part of the answer: which provider is
 * asked, which Wiktionary group is kept, which entry the cache holds, which
 * languages the word-sense prompt names, and which language the returned
 * learner-language rendering belongs to. Nothing here calls a live provider.
 */
import assert from 'node:assert/strict';
import {sensaLanguage,sensaLanguages} from '@sensa/contracts/sensa';
import {indexedDB} from 'fake-indexeddb';
import {build} from 'esbuild';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test("reference-language", async () => {

const compiled=await build({
  stdin:{
    contents:[
      `export {lookupReference} from './apps/web/src/experience/reference/referenceLookup';`,
      `export {lookupDictionaryEntry} from './apps/web/src/experience/services/quickDict';`,
      `export {ReferenceLookupUnavailableError} from './apps/web/src/experience/reference/referenceLookup';`,
      `export {resolveLookupLemma} from './apps/web/src/experience/reference/resolveClickedLemma';`,
      ...['store','providers','language'].map(n=>`export * from './apps/web/src/data/library/${n}';`),
    ].join('\n'),
    resolveDir:process.cwd(),
  },
  bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'},
});
Object.assign(globalThis,{indexedDB,window:new EventTarget(),location:{origin:'http://127.0.0.1:9998'},BroadcastChannel:undefined});
const temp=await mkdtemp(join(tmpdir(),'sensa-reference-'));
await writeFile(join(temp,'core.mjs'),compiled.outputFiles[0]!.text);
const api=await import(pathToFileURL(join(temp,'core.mjs')).href);
const id=()=>crypto.randomUUID();

const WIKT='https://api.wiktapi.dev/v1/en/word/';
const REST='https://en.wiktionary.org/api/rest_v1/page/definition/';
const FREE='https://api.dictionaryapi.dev/api/v2/entries/en/';
const MODEL='https://fixture.invalid/v1/chat/completions';

/** One canned Wiktionary group per (language, word). A missing pair answers 404
 * the way the live API does, so provider fallthrough is exercised rather than
 * asserted. */
const groups:Record<string,{pos:string;glosses:string[];examples?:string[];ipa?:string;sounds?:{ipa?:string;audio?:string;tags?:string[]}[]}>={};
/** Canned payloads for the official endpoint, keyed by word. */
const restPayloads:Record<string,Record<string,{partOfSpeech:string;language:string;definitions:{definition:string;parsedExamples?:{example:string}[]}[]}[]>>={};
const requested:string[]=[];
const unavailableRestWords=new Set<string>();
const modelPrompts:{system:string;user:any}[]=[];
/** The rendering the fixture model returns with its decision. */
let modelGloss:string|undefined='打招呼用语';
const realFetch=globalThis.fetch;

globalThis.fetch=async(url:string|URL|Request,init?:RequestInit)=>{
  const href=typeof url==='string'?url:url instanceof URL?url.href:url.url;
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

  if(href===MODEL){
    const body=JSON.parse(String(init?.body));
    const messages=body.messages as {role:string;content:string}[];
    const user=JSON.parse(messages[1]!.content);
    modelPrompts.push({system:messages[0]!.content,user});
    const decision:Record<string,unknown>={status:'selected',referenceSenseId:user.candidates[0].referenceSenseId,confidence:0.92};
    if(modelGloss!==undefined)decision.glossL1=modelGloss;
    return json({model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify(decision)}}]});
  }

  requested.push(href);
  if(href.startsWith(WIKT)){
    const word=decodeURIComponent(href.slice(WIKT.length).split('/')[0]!);
    const group=new URL(href).searchParams.get('lang')!;
    const source=groups[`${group}:${word}`];
    if(!source||!href.includes('/definitions')&&!source.ipa&&!source.sounds)return json({},404);
    if(href.includes('/definitions')){
      return json({word,edition:'en',definitions:[{pos:source.pos,lang_code:group,senses:[{glosses:source.glosses,examples:(source.examples??[]).map(text=>({text})),tags:[]}]}]});
    }
    return json({word,edition:'en',pronunciations:[{lang_code:group,sounds:source.sounds??[{ipa:source.ipa,audio:null,tags:[]}]}]});
  }
  if(href.startsWith(FREE)){
    const word=decodeURIComponent(href.slice(FREE.length));
    const source=groups[`free:${word}`];
    if(!source)return json({},404);
    return json([{word,phonetic:'/ˈfɪkʃən/',phonetics:[{text:'/ˈfɪkʃən/'}],meanings:[{partOfSpeech:source.pos,definitions:source.glosses.map(definition=>({definition}))}],sourceUrls:['https://example.invalid/fixture']}]);
  }
  if(href.startsWith(REST)){
    const word=decodeURIComponent(href.slice(REST.length));
    if(unavailableRestWords.has(word))return json({},503);
    const payload=restPayloads[word];
    return payload?json(payload):json({},404);
  }
  throw new Error('unexpected request: '+href);
};

const spanish={supportLanguageTag:'zh-CN',targetLanguageTag:'es'};
const english={supportLanguageTag:'zh-CN',targetLanguageTag:'en'};

try{
  const library=await api.openLibrary(),accountId=id();
  await api.command({id:id(),kind:'fixture.owner',input:{}},async(tx:any)=>tx.put('meta','service-owner',{subject:accountId,accountId}));
  const provider=await api.saveProvider(id(),{id:id(),expectedRevision:0,name:'Fixture',kind:'compatible',endpoint:'https://fixture.invalid/v1',model:'fixture'},'fixture-secret');
  for(const purpose of ['teacher','content','review','reference']){const {settings}=await api.providerSnapshot();await api.assignProvider(id(),purpose,provider.id,settings.revision);}

  groups['es:hola']={pos:'intj',glosses:['hello, hi, hey'],examples:['¡Hola! ¿Cómo estás?'],ipa:'/ˈola/'};
  groups['fr:hola']={pos:'intj',glosses:['French greeting']};

  const spanishResult=await api.lookupReference('hola',{languages:spanish});
  const spanishRequestsEnd=requested.length;
  assert.ok(spanishResult,'a Spanish lookup answers');
  assert.equal(spanishResult.release.targetLanguage,'es','the release belongs to the target language, not to English');
  assert.equal(spanishResult.release.learnerLocale,'zh-CN','the release locale follows the Support Language');
  assert.ok(spanishResult.release.provider.includes('Spanish'),'the release names the language the entry is in');
  assert.deepEqual(spanishResult.entry.senses[0]!.definition,{text:'hello, hi, hey',languageTag:'en'},'English Wiktionary defines a Spanish headword in its source language');
  assert.equal(spanishResult.entry.attribution,'English Wiktionary via WiktAPI (CC BY-SA)','source attribution names the edition, not the headword language');
  assert.equal(spanishResult.release.edition,'实时查询','live lookup is not advertised as a fixed snapshot');
  assert.equal(spanishResult.release.rightsLabel,'Wiktionary 内容遵循 CC BY-SA','visible rights retain licensing without engineering roadmap notes');
  assert.equal(spanishResult.entry.senses[0]!.examples[0]!.sourceLabel,'English Wiktionary','an uncited Spanish example keeps its actual dictionary edition');
  assert.equal(spanishResult.entry.pronunciations[0]?.accent,'es','a non-English recording is never relabelled as an English accent');
  assert.equal(spanishResult.entry.pronunciations[0]?.ipa,'/ˈola/','pronunciation evidence the provider returned is kept');

  groups['en:qzxaccent']={pos:'noun',glosses:['controlled regional evidence'],sounds:[
    {ipa:'/us/',audio:'en-us-qzxaccent.ogg',tags:['US']},
    {ipa:'/rp/',tags:['Received-Pronunciation']},
    {ipa:'/scot/',tags:['Scotland']},
    {ipa:'/au/',tags:['Australia']},
    {ipa:'/unplaced/',tags:[]},
  ]};
  const accents=await api.lookupReference('qzxaccent',{languages:english});
  assert.deepEqual(accents.entry.pronunciations.map((source:any)=>source.accent),['en-US','en-GB','en-GB','en-AU','en'],'only source-declared regions receive regional pronunciation labels');

  // The exact configured 18 targets each select their own Wiktionary group;
  // no target is inferred from the English fallback provider.
  const targets=sensaLanguages.filter(language=>language.asTarget);
  assert.equal(targets.length,18);
  const supportLanguages=sensaLanguages;
  assert.equal(supportLanguages.length,18);
  for(const [index,language] of targets.entries()){
    const word=`qzxmatrix${String.fromCharCode(97+index)}`;
    groups[`${language.wiktionaryCode}:${word}`]={pos:'noun',glosses:[`fixture for ${language.tag}`]};
    for(const support of supportLanguages){
      const result=await api.lookupReference(word,{languages:{targetLanguageTag:language.tag,supportLanguageTag:support.tag}});
      assert.ok(result,`${language.tag} → ${support.tag} returns its canned target-language group`);
      assert.equal(result?.release.targetLanguage,language.tag,`${language.tag} release identifies the requested target`);
      assert.equal(result?.release.learnerLocale,support.tag,`${support.tag} remains the declared Support Language`);
      assert.deepEqual(result?.entry.senses[0]?.definition,{text:`fixture for ${language.tag}`,languageTag:'en'},`${language.tag} keeps its word group without relabelling the English definition`);
      assert.ok(requested.some(href=>href.includes(`lang=${encodeURIComponent(language.wiktionaryCode)}`)),`${language.tag} requests its Wiktionary code`);
    }
  }

  // Every dictionary request was scoped to the target language, and a provider
  // that indexes English only was never asked.
  const dictionaryRequests=requested.slice(0,spanishRequestsEnd).filter(href=>href!==MODEL);
  assert.ok(dictionaryRequests.length>0,'the lookup reached a dictionary provider');
  assert.ok(dictionaryRequests.every(href=>!href.startsWith(FREE)),'the English-only aggregator is not asked about a Spanish word');
  assert.ok(dictionaryRequests.every(href=>href.includes('lang=es')),'every Wiktionary request selects the Spanish group');
  assert.ok(!dictionaryRequests.some(href=>href.includes('lang=en')),'no request falls back to the English group');

  // A bare word has no occurrence, so it runs no word-sense decision.
  assert.equal(modelPrompts.length,0);

  const occurrence={rawClickedForm:'Hola',textL2:'¡Hola! ¿Cómo estás?',clickedStart:1,clickedEnd:5,clickedSurface:'Hola'};
  const contextual=await api.lookupReference({...occurrence,exampleId:'fixture.example.1'},{languages:spanish});
  assert.equal(modelPrompts.length,1,'an occurrence runs exactly one closed-set decision');
  const prompt=modelPrompts[0]!;
  assert.ok(prompt.system.includes('Spanish (es)'),'the resolver is told which language it is disambiguating');
  assert.ok(!prompt.system.includes('strict English'),'the English-only instruction is gone');
  assert.ok(prompt.system.includes('Chinese (Simplified) (zh-CN)'),'the resolver is told which language to render the gloss in');
  assert.equal(prompt.user.targetLanguage,'es');
  assert.equal(prompt.user.supportLanguage,'zh-CN');
  assert.equal(prompt.user.sentence,'¡Hola! ¿Cómo estás?','the clicked sentence travels unchanged');
  assert.equal(prompt.user.candidates[0].definitionLanguage,'en','word and source-definition language are distinct model inputs');
  assert.ok(prompt.system.includes('Source definitions need not be in the headword or sentence language'));

  assert.equal(contextual.contextualResolution?.status,'model_confident');
  assert.equal(contextual.contextualResolution?.glossL1,'打招呼用语','the Support-Language rendering is recorded with the decision');
  assert.equal(contextual.contextualResolution?.modelId,'fixture','the rendering keeps the model that produced it');
  const selectedSense=contextual.entry.senses.find((sense:any)=>sense.referenceSenseId===contextual.contextualResolution?.referenceSenseId);
  assert.equal(selectedSense.glossL1,'打招呼用语','the selected sense carries the rendering for display');
  assert.deepEqual(selectedSense.definition,{text:'hello, hi, hey',languageTag:'en'},'learner gloss never rewrites source wording or language');
  assert.equal(contextual.entry.senses.filter((sense:any)=>sense.glossL1).length,1,'only the selected sense is rendered');

  // A rendering the model will not keep short is dropped instead of shown.
  modelGloss='x'.repeat(400);
  const longGloss=await api.lookupReference({...occurrence,exampleId:'fixture.example.2'},{languages:spanish});
  assert.equal(longGloss.contextualResolution?.glossL1,undefined,'a paragraph is not a glossary rendering');
  assert.equal(longGloss.entry.senses.filter((sense:any)=>sense.glossL1).length,0);

  modelGloss=undefined;
  const noGloss=await api.lookupReference({...occurrence,exampleId:'fixture.example.3'},{languages:spanish});
  assert.equal(noGloss.contextualResolution?.status,'model_confident');
  assert.equal(noGloss.contextualResolution?.glossL1,undefined,'a decision without a rendering still resolves the sense');
  modelGloss='打招呼用语';

  // The cache is keyed by language: the same spelling in two languages is two entries.
  const beforeCache=requested.length;
  const frenchResult=await api.lookupReference('hola',{languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'fr'}});
  assert.ok(requested.slice(beforeCache).some(href=>href.includes('lang=fr')),'a second language is fetched instead of answered from the first language cache');
  assert.equal(frenchResult?.release.targetLanguage,'fr','the cached Spanish entry never answers a French lookup');
  assert.deepEqual(frenchResult?.entry.senses[0]?.definition,{text:'French greeting',languageTag:'en'});

  // A real miss is empty; a miss from one source plus an unavailable eligible
  // source is reported as unavailable because absence cannot be established.
  assert.equal(await api.lookupReference('definitelymissing',{languages:spanish}),null);
  unavailableRestWords.add('partiallyunavailable');
  delete groups['es:partiallyunavailable'];
  await assert.rejects(
    api.lookupReference('partiallyunavailable',{languages:spanish}),
    api.ReferenceLookupUnavailableError,
    'one provider outage is not turned into a false missing-word result',
  );
  unavailableRestWords.delete('partiallyunavailable');

  // Letters outside the Latin range survive normalization.
  groups['es:niño']={pos:'noun',glosses:['child, boy']};
  await api.lookupReference('niño',{languages:spanish});
  assert.ok(requested.some(href=>href.includes('ni%C3%B1o')),'a Spanish headword reaches the provider with its own characters');
  groups['ja:ありがとう']={pos:'intj',glosses:['thank you']};
  await api.lookupReference('ありがとう',{languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'ja'}});
  assert.ok(requested.some(href=>href.includes(encodeURIComponent('ありがとう'))),'a Japanese headword is not normalized away');

  // The official endpoint answers a language the aggregators do not carry, and
  // its rendered HTML is stripped to the sentence a learner reads.
  restPayloads['agua']={es:[{partOfSpeech:'Noun',language:'Spanish',definitions:[{definition:'<a href="/wiki/water">water</a>, <span>H<sub>2</sub>O</span> &amp; more',parsedExamples:[{example:'El agua está fría.'}]}]}]};
  const official=await api.lookupReference('agua',{languages:spanish});
  assert.ok(official,'the official Wiktionary endpoint answers when the aggregators have no group');
  assert.ok(official.release.provider.includes('Wiktionary REST'));
  assert.equal(official.release.targetLanguage,'es');
  assert.deepEqual(official.entry.senses[0]!.definition,{text:'water, H2O & more',languageTag:'en'},'English-edition REST wording is stripped without relabelling it Spanish');
  assert.equal(official.entry.attribution,'English Wiktionary (CC BY-SA 4.0)','REST attribution also identifies the actual source edition');
  assert.equal(official.release.rightsLabel,'Wiktionary 内容遵循 CC BY-SA 4.0','REST visible rights likewise retain licensing without roadmap notes');
  assert.equal(official.entry.senses[0]!.examples[0]!.sourceLabel,'English Wiktionary','REST example source is the edition, not its Spanish language group');
  assert.equal(official.entry.pronunciations.length,0,'an endpoint without pronunciation evidence yields no guessed IPA');

  // English keeps the aggregator that actually indexes English entries, and the
  // endpoint that returns pronunciation evidence. The shared Wiktionary source
  // has no English group for this word, so the English-only provider answers.
  groups['free:fragile']={pos:'adjective',glosses:['easily broken']};
  const englishResult=await api.lookupReference('fragile',{languages:english});
  assert.equal(englishResult?.release.targetLanguage,'en');
  assert.equal(englishResult?.release.learnerLocale,'zh-CN');
  assert.ok(requested.some(href=>href.startsWith(FREE)),'the English-only provider is asked for an English target');
  assert.deepEqual(englishResult?.entry.senses[0]?.definition,{text:'easily broken',languageTag:'en'});
  assert.equal(englishResult?.entry.pronunciations[0]?.ipa,'/ˈfɪkʃən/','English pronunciation evidence still comes from the aggregator');
  assert.equal(englishResult?.entry.pronunciations[0]?.accent,'en','a phonetic without regional evidence is not labelled American');

  // The lemma engine is English-only, so another language keeps its surface form.
  const spanishLemma=api.resolveLookupLemma('se tomó',sensaLanguage('es'));
  assert.equal(spanishLemma.strategy,'surface','an English lemma engine never answers for another language');
  assert.equal(spanishLemma.lemma,'se tomó','the occurrence is kept as the learner clicked it');
  assert.equal(api.resolveLookupLemma('Took',sensaLanguage('en')).lemma,'take','an English occurrence still lemmatizes');

  // A language outside the catalog answers nothing at all.
  const beforeUnknown=requested.length;
  assert.equal(await api.lookupReference('hola',{languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'xx-unknown'}}),null,'an unplaceable language cannot be answered in another language');
  assert.equal(requested.length,beforeUnknown,'an unplaceable language reaches no provider');

  // With no explicit context the learner's active Route decides, which is what
  // every existing call site relies on.
  const germanRoute=await api.addLanguageRoute(id(),'de','zh-CN');
  await api.setActiveLanguageRoute(id(),germanRoute.id);
  groups['de:wasser']={pos:'noun',glosses:['water']};
  const profileDriven=await api.lookupReference('Wasser');
  assert.ok(requested.some(href=>href.includes('lang=de')),'the default context comes from the active Route');
  assert.equal(profileDriven?.release.targetLanguage,'de');
  assert.equal(profileDriven?.release.learnerLocale,'zh-CN');
  const routeSnapshot=await api.languageRoutesSnapshot();
  assert.equal(routeSnapshot.activeRoute.id,germanRoute.id);
  assert.deepEqual(routeSnapshot.context,{targetLanguageTag:'de',supportLanguageTag:'zh-CN',languageRouteId:germanRoute.id,languageRouteRevision:1});
  assert.deepEqual(routeSnapshot.collection.routes.map((route:any)=>[route.targetLanguageTag,route.defaultSupportLanguageTag,route.status]),[['en','zh-CN','active'],['de','zh-CN','active']]);
  const pinnedEntry=await api.lookupDictionaryEntry({...occurrence,exampleId:'fixture.pinned-spanish-run'},{languages:spanish});
  assert.equal(pinnedEntry.referenceLookup.release.targetLanguage,'es','the public quick lookup keeps a material source language after another Route becomes active');
  assert.equal(modelPrompts.at(-1)!.user.targetLanguage,'es');assert.equal(modelPrompts.at(-1)!.user.sentence,occurrence.textL2);
  assert.equal((await api.languageRoutesSnapshot()).activeRoute.id,germanRoute.id,'a pinned lookup does not change the active Route');

  console.log('PASS: Reference lookups are scoped to the pinned language context — provider group, cache identity, prompt languages and the Support-Language rendering all follow it, and an unplaceable language answers nothing.');
}finally{
  globalThis.fetch=realFetch;
  await rm(temp,{recursive:true,force:true});
}

});
