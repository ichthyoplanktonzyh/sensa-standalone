/** Which reading a learner does not need done for them.
 *
 * The reading surfaces are built on one question — "does this learner already
 * read this text?" — and the answer is assembled from three things that live in
 * three places: what language the text is in (a detector), what the surface says
 * its text is (a declaration), and what that language means to this learner (the
 * published Route context). This runs the real background bundle for the middle two and
 * the real content-side helper for the whole round trip, so the envelope the
 * background answers in is exercised rather than assumed: reading the payload
 * from the wrong depth is what silently turned every detected language into
 * "nothing was declared".
 */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {franc} from 'franc';
import {sensaLanguageRolesForTag} from '@sensa/contracts/sensa';

const routeContext=(supportLanguageTag:string,targetLanguageTag:string)=>({supportLanguageTag,targetLanguageTag,languageRouteId:'00000000-0000-4000-8000-000000000099',languageRouteRevision:1});
const routeCollection=(supportLanguageTag:string,targetLanguageTag:string)=>({revision:1,routes:[{id:routeContext(supportLanguageTag,targetLanguageTag).languageRouteId,revision:1,targetLanguageTag,defaultSupportLanguageTag:supportLanguageTag,status:'active'}]});
let listener:any,storage:Record<string,unknown>={readingLanguageRoutes:routeCollection('zh-CN','en'),readingActiveLanguageRouteId:routeContext('zh-CN','en').languageRouteId},asleep=false;
const chromeMock={
  storage:{local:{get:async(key:string)=>structuredClone({[key]:storage[key]}),set:async(value:Record<string,unknown>)=>{Object.assign(storage,structuredClone(value));},setAccessLevel:async()=>{}},session:{get:async()=>({}),set:async()=>{}}},
  runtime:{id:'fixture',getURL:(path:string)=>'chrome-extension://fixture/'+path,onMessage:{addListener:(fn:unknown)=>{listener=fn;}}},
  tabs:{onUpdated:{addListener:()=>{}},onRemoved:{addListener:()=>{}},sendMessage:async()=>{}},
};
// The content script's half of the wire, with the background on the other end of
// it: exactly what a sleeping worker and a live one look like to a reading panel.
Object.assign(globalThis,{chrome:{...chromeMock,runtime:{...chromeMock.runtime,sendMessage:(message:unknown)=>new Promise((resolve,reject)=>{
  if(asleep)return reject(new Error('Could not establish connection. Receiving end does not exist.'));
  listener(message,{id:'fixture',url:'https://example.com/article',tab:{id:1}},resolve);
})}}});
const bundle=await build({entryPoints:['apps/browser-extension/src/background.ts'],bundle:true,write:false,format:'iife',platform:'browser',define:{SENSA_WEB_URL:JSON.stringify('http://127.0.0.1:3000'),SENSA_API_URL:JSON.stringify('http://127.0.0.1:4319')}});
vm.runInNewContext(bundle.outputFiles[0]!.text,{chrome:chromeMock,crypto,btoa,URL,TextEncoder,TextDecoder,AbortSignal,setTimeout,clearTimeout,console,fetch:async()=>{throw new Error('no network in this smoke');}});
// The content-side helper reads the page it is running on for a declaration. The
// page here declares nothing, which is most of the web and the case every test
// below states explicitly when it wants a declaration to exist.
Object.assign(globalThis,{document:{documentElement:{lang:''}}});
const {declaredCaptureLanguage,detectCaptureLanguage,readerLanguage}=await import('../apps/browser-extension/src/language.ts');
/** A page that declares itself, for the tests that need a declaration. */
const page=(lang:string)=>({documentElement:{lang}} as Pick<Document,'documentElement'>);

// The detector's answer is the answer. English text is English however the page
// describes itself, and a Chinese paragraph on an English page is Chinese.
const english='She took her time and looked up at the sky before answering the question that had been waiting for her all afternoon.';
const chinese='这段话本身就是学习者已经能读的语言，把它再翻译一遍没有任何意义，所以这一整段都不应该被送去翻译，也不该占用今天的学习额度。';
const spanish='Ella se tomó su tiempo y miró al cielo antes de responder a la pregunta que había estado esperando toda la tarde.';
// The detector stays open-set. Its imperfect Scots observation for this English
// fixture is retained with confidence instead of coerced to a supported tag.
assert.equal(franc(english),'sco','if this ever stops being true, the candidate list is no longer earning its place');
const detectedEnglish=await detectCaptureLanguage(english);
assert.equal(detectedEnglish.language,'sco');assert.equal(detectedEnglish.languageSource,'detector');assert(detectedEnglish.languageConfidence!>0);
const detectedChinese=await detectCaptureLanguage(chinese);
assert.deepEqual(detectedChinese,{language:'zh-CN',languageSource:'detector',languageConfidence:1});
const detectedSpanish=await detectCaptureLanguage(spanish);
assert.equal(detectedSpanish.language,'es');assert.equal(detectedSpanish.languageSource,'detector');assert(detectedSpanish.languageConfidence!>0);

// What the learner already reads: their own language, and nothing else. The
// third language is not theirs to skip — it is still worth translating.
assert.deepEqual(await readerLanguage(english),{supportLanguageTag:'zh-CN',alreadyReadable:false});
assert.deepEqual(await readerLanguage(chinese),{supportLanguageTag:'zh-CN',alreadyReadable:true});
assert.deepEqual(await readerLanguage(spanish),{supportLanguageTag:'zh-CN',alreadyReadable:false});

// Text too short to detect is answered by the surface it came from, which is the
// only evidence there is: a short paragraph of a page that declares Chinese is a
// short paragraph of a page that declares Chinese.
const short='是的。';
assert.equal((await readerLanguage(short,'zh-CN')).alreadyReadable,true);
assert.equal((await readerLanguage(short,'en')).alreadyReadable,false);
assert.equal((await readerLanguage(short,'yue')).alreadyReadable,false,'a declaration this release cannot place is not the learner\'s language');
assert.equal((await readerLanguage(short)).alreadyReadable,false,'nothing to go on is not an answer');
// …and a short paragraph is still asked about rather than assumed, while a long
// one is detected, so the surface's own claim cannot override the text.
assert.equal((await readerLanguage(english,'zh-CN')).alreadyReadable,false,'a claim about the page is not a claim about the paragraph');

// The other direction: a learner reading English.
assert.deepEqual(await chrome.storage.local.set({readingLanguageRoutes:routeCollection('en','es')}).then(()=>readerLanguage(chinese)),{supportLanguageTag:'en',alreadyReadable:false});
assert.deepEqual(await readerLanguage(english),{supportLanguageTag:'en',alreadyReadable:false},'an unsupported detector observation is not coerced to English merely because the Route supports English');
storage.readingLanguageRoutes=routeCollection('zh-CN','en');

// A surface the learner is reading for a language nobody has published a pair
// for falls back to the pair the product ships, the same one the library uses.
storage.readingLanguageRoutes=undefined;
assert.deepEqual(await readerLanguage(english),{supportLanguageTag:'zh-CN',alreadyReadable:false});
storage.readingLanguageRoutes=routeCollection('es','es');
assert.equal((await readerLanguage(chinese)).supportLanguageTag,'es','the same language may be both Target and Support');
storage.readingLanguageRoutes=routeCollection('zh-CN','en');

// A worker that is not there withholds the skip, never the translation, and the
// capture still falls back to what the page declares.
asleep=true;
assert.equal(await readerLanguage(chinese),null);
assert.equal(await readerLanguage(short,'zh-CN'),null);
assert.deepEqual(await detectCaptureLanguage(english),{language:null,languageSource:null,languageConfidence:null});
assert.deepEqual(await detectCaptureLanguage(short),{language:null,languageSource:null,languageConfidence:null});
asleep=false;

// The role helper the background decides with, stated where it is used: the pair
// is the boundary, and the Support side is what a translation would duplicate.
assert.deepEqual(sensaLanguageRolesForTag('zh-CN',{supportLanguageTag:'zh-CN',targetLanguageTag:'en'}),['support']);
assert.deepEqual(sensaLanguageRolesForTag('en',{supportLanguageTag:'zh-CN',targetLanguageTag:'en'}),['target']);
assert.deepEqual(sensaLanguageRolesForTag('es',{supportLanguageTag:'zh-CN',targetLanguageTag:'en'}),[]);
assert.deepEqual(declaredCaptureLanguage(page('zh-Hans-CN')),{language:'zh-Hans-CN',languageSource:'declared',languageConfidence:1},'a declaration keeps its exact canonical tag');

console.log('PASS: reading skips only exact Support-Language observations, preserves unsupported detector answers and confidence, keeps exact declared tags, permits same-language Target/Support, and never withholds a translation when the answer is uncertain.');
