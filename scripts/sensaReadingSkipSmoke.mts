/** Which reading a learner does not need done for them.
 *
 * The reading surfaces are built on one question — "does this learner already
 * read this text?" — and the answer is assembled from three things that live in
 * three places: what language the text is in (a detector), what the surface says
 * its text is (a declaration), and what that language means to this learner (the
 * published pair). This runs the real background bundle for the middle two and
 * the real content-side helper for the whole round trip, so the envelope the
 * background answers in is exercised rather than assumed: reading the payload
 * from the wrong depth is what silently turned every detected language into
 * "nothing was declared".
 */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {franc} from 'franc';
import {sensaLanguageRoleForTag} from '@sensa/contracts/sensa';

let listener:any,storage:Record<string,unknown>={readingLanguages:{familiarLanguageTag:'zh-CN',targetLanguageTag:'en'}},asleep=false;
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
// English is the language this product ships as a target, and a detector left to
// itself answers `sco` for it — an answer no release can place, which is how an
// English capture came back carrying no language at all. Asked which of the
// languages this release supports the text is in, it answers.
assert.equal(franc(english),'sco','if this ever stops being true, the candidate list is no longer earning its place');
assert.deepEqual(await detectCaptureLanguage(english),{language:'en',languageSource:'detector'});
assert.deepEqual(await detectCaptureLanguage(chinese),{language:'zh-CN',languageSource:'detector'});
assert.deepEqual(await detectCaptureLanguage(spanish),{language:'es',languageSource:'detector'});

// What the learner already reads: their own language, and nothing else. The
// third language is not theirs to skip — it is still worth translating.
assert.deepEqual(await readerLanguage(english),{familiarLanguageTag:'zh-CN',alreadyReadable:false});
assert.deepEqual(await readerLanguage(chinese),{familiarLanguageTag:'zh-CN',alreadyReadable:true});
assert.deepEqual(await readerLanguage(spanish),{familiarLanguageTag:'zh-CN',alreadyReadable:false});

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
assert.deepEqual(await chrome.storage.local.set({readingLanguages:{familiarLanguageTag:'en',targetLanguageTag:'zh-CN'}}).then(()=>readerLanguage(chinese)),{familiarLanguageTag:'en',alreadyReadable:false});
assert.deepEqual(await readerLanguage(english),{familiarLanguageTag:'en',alreadyReadable:true});
storage.readingLanguages={familiarLanguageTag:'zh-CN',targetLanguageTag:'en'};

// A surface the learner is reading for a language nobody has published a pair
// for falls back to the pair the product ships, the same one the library uses.
storage.readingLanguages=undefined;
assert.deepEqual(await readerLanguage(english),{familiarLanguageTag:'zh-CN',alreadyReadable:false});
storage.readingLanguages={familiarLanguageTag:'es',targetLanguageTag:'es'};
assert.equal((await readerLanguage(chinese)).familiarLanguageTag,'zh-CN','a pair that says one language is both sides of the boundary is not a pair');
storage.readingLanguages={familiarLanguageTag:'zh-CN',targetLanguageTag:'en'};

// A worker that is not there withholds the skip, never the translation, and the
// capture still falls back to what the page declares.
asleep=true;
assert.equal(await readerLanguage(chinese),null);
assert.equal(await readerLanguage(short,'zh-CN'),null);
assert.deepEqual(await detectCaptureLanguage(english),{language:null,languageSource:null});
assert.deepEqual(await detectCaptureLanguage(short),{language:null,languageSource:null});
asleep=false;

// The role helper the background decides with, stated where it is used: the pair
// is the boundary, and the familiar side is what a translation would duplicate.
assert.equal(sensaLanguageRoleForTag('zh-CN',{familiarLanguageTag:'zh-CN',targetLanguageTag:'en'}),'familiar');
assert.equal(sensaLanguageRoleForTag('en',{familiarLanguageTag:'zh-CN',targetLanguageTag:'en'}),'target');
assert.equal(sensaLanguageRoleForTag('es',{familiarLanguageTag:'zh-CN',targetLanguageTag:'en'}),null);
assert.equal(declaredCaptureLanguage(page('zh-Hans-CN')).language,'zh-CN','a declaration with subtags still places on the catalog');

console.log('PASS: the learner\'s own language is what a reading surface skips — detected per text, inherited from a declaration only when text is too short to detect, never inferred from the interface or the page as a whole, and never allowed to withhold a translation when the answer cannot be had. Real background handler, real detector, real published pair.');
