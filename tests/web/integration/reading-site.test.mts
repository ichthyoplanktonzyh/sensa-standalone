import {test} from 'vitest';
/** The learner's rule about one site, and where it can be written from.
 *
 * Reading mode is turned on per tab, but the wish "not here" is about the site:
 * it has to survive the next page load, the next tab and the next day, and it has
 * to be reversible from the page where the learner is now stuck without it. So
 * the rule is written by the background from the tab's own hostname — never from
 * the message, which any page could compose — and this runs the real background
 * bundle for every way it can be written: the page panel, the popup, the settings
 * page, and the toolbar button that must refuse rather than pretend.
 */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {readingPreferences,readingSiteHost,readingSiteOf,saveReadingPreferences} from '../../../apps/browser-extension/src/preferences.ts';

test("reading-site", async () => {

// ── the rule itself ─────────────────────────────────────────────────────────
assert.equal(readingSiteHost('Example.COM '),'example.com','a rule is stored the way a hostname is written');
assert.equal(readingSiteHost('news.example.co.uk'),'news.example.co.uk');
assert.equal(readingSiteHost('https://example.com'),null,'a rule is a host, not a URL');
assert.equal(readingSiteHost('example.com/path'),null);
assert.equal(readingSiteHost(''),null);
assert.equal(readingSiteHost(42),null);
assert.equal(readingSiteOf('https://news.example.com/a?b#c'),'news.example.com','a page’s site comes from its URL');
assert.equal(readingSiteOf('http://127.0.0.1:8080/x'),'127.0.0.1','a port is not part of the site');
assert.equal(readingSiteOf('chrome://extensions'),null,'a browser page has no site to keep a rule about');
assert.equal(readingSiteOf('file:///tmp/a.html'),null);
assert.equal(readingSiteOf(undefined),null);

const preferences={actionName:'用法辨析',actionPrompt:'解释用法。',speechRate:1};
let storage:Record<string,unknown>={readingPreferences:{...preferences,disabledSites:['Example.com','example.com','news.example.com']}};
Object.assign(globalThis,{chrome:{storage:{local:{get:async(key:string)=>structuredClone({[key]:storage[key]}),set:async(value:unknown)=>{Object.assign(storage,structuredClone(value));}}}}});
const read=await readingPreferences();
assert.deepEqual(read.disabledSites,['example.com','example.com','news.example.com'],'reading back keeps what was stored, including what a hand-edited value left behind');
const saved=await saveReadingPreferences({...preferences,disabledSites:['Example.com','example.com','news.example.com']});
assert.deepEqual(saved.disabledSites,['example.com','news.example.com'],'saving normalises and never stores the same rule twice');
assert.deepEqual((storage.readingPreferences as any).disabledSites,['example.com','news.example.com']);
await saveReadingPreferences({...preferences,disabledSites:['example.com'],speechRate:5});
assert.equal((storage.readingPreferences as any).speechRate,2,'an out-of-range rate is clamped to the range the speaking side uses');
await saveReadingPreferences({...preferences,disabledSites:['example.com']});
assert.equal((storage.readingPreferences as any).speechRate,1);
await assert.rejects(()=>saveReadingPreferences({...preferences,disabledSites:['https://example.com']}),/invalid_sites/u,'a rule this release cannot represent is refused rather than dropped');
await saveReadingPreferences({actionName:'   ',actionPrompt:'',disabledSites:[]});
assert.deepEqual(storage.readingPreferences,{actionName:'用法辨析',actionPrompt:'',disabledSites:[],speechRate:1,speechVoice:''},'an empty name falls back to the shipped one; an empty prompt is a prompt the learner cleared');

// ── the real background ─────────────────────────────────────────────────────
const web='http://127.0.0.1:3000';
const host='news.example.com';
const pageUrl='https://'+host+'/article';
const accountId=crypto.randomUUID();
const englishRoute={id:crypto.randomUUID(),revision:1,targetLanguageTag:'en',defaultSupportLanguageTag:'zh-CN',status:'active'};
const spanishRoute={id:crypto.randomUUID(),revision:1,targetLanguageTag:'es',defaultSupportLanguageTag:'en',status:'active'};
storage={readingPreferences:{...preferences,disabledSites:[]},readingLanguageRoutes:{revision:1,routes:[englishRoute,spanishRoute]},readingActiveLanguageRouteId:englishRoute.id,sensa:{version:1,active:accountId,accounts:{[accountId]:{accountId,installationId:crypto.randomUUID(),webLibraryId:crypto.randomUUID(),token:'fixture-token',queue:[],recent:[],savedOperations:{}}}}};
const session:Record<string,unknown>={modes:{5:{accountId}}};
let messageListener:any=null,updatedListener:any=null,activeTab:any={id:5,url:pageUrl};
const injected:number[]=[],told:any[]=[];
const noopEvent={addListener:()=>{}};
const chromeMock:any={
 storage:{local:{get:async(key:string)=>structuredClone({[key]:storage[key]}),set:async(value:unknown)=>{Object.assign(storage,structuredClone(value));},setAccessLevel:async()=>{}},session:{get:async(key:string)=>structuredClone({[key]:session[key]}),set:async(value:unknown)=>{Object.assign(session,structuredClone(value));}}},
 runtime:{id:'fixture',getURL:(path:string)=>'chrome-extension://fixture/'+path,onMessage:{addListener:(fn:any)=>{messageListener=fn;}},onConnect:{addListener:()=>{}}},
 tabs:{query:async()=>activeTab?[activeTab]:[],sendMessage:async(id:number,message:unknown)=>{told.push({id,message:structuredClone(message)});},onUpdated:{addListener:(fn:any)=>{updatedListener=fn;}},onRemoved:noopEvent,create:async()=>({id:20}),update:async(id:number)=>({id})},
 scripting:{executeScript:async({target}:any)=>{injected.push(target.tabId);return [{result:null}];}},
 action:{setBadgeText:async()=>{},setTitle:async()=>{}},
 identity:{getRedirectURL:(path:string)=>'https://'+'a'.repeat(32)+'.chromiumapp.org/'+path},
 alarms:{create:()=>{},onAlarm:noopEvent},
};
const bundle=await build({entryPoints:['apps/browser-extension/src/background.ts'],bundle:true,write:false,format:'iife',platform:'browser',define:{SENSA_WEB_URL:JSON.stringify(web),SENSA_API_URL:JSON.stringify('http://127.0.0.1:4319')}});
vm.runInNewContext(bundle.outputFiles[0]!.text,{chrome:chromeMock,crypto,btoa,URL,TextEncoder,TextDecoder,AbortSignal,AbortController,setTimeout,clearTimeout,console,fetch:async()=>{throw new Error('no network in this smoke');}});
/** The real API structured-clones what a message handler answers, so this does
 * too: without it the values under test come from the bundle's own realm and are
 * never equal to the ones this file writes. */
const call=(input:unknown,sender:unknown)=>new Promise<any>(resolve=>messageListener(input,sender,(value:unknown)=>resolve(structuredClone(value))));
const contentSender={id:'fixture',url:pageUrl,tab:{id:5,url:pageUrl}};
const popupSender={id:'fixture',url:'chrome-extension://fixture/popup.html'};

// The page panel's button: the site is the tab's, and the panel goes away because
// reading is off here now.
const disabled=await call({kind:'reading-site',enabled:false},contentSender);
assert.deepEqual(disabled.value,{site:host,disabled:true,disabledSites:[host]},'the page’s own switch writes a rule about the page’s own site');
assert.deepEqual((storage.readingPreferences as any).disabledSites,[host]);
assert.equal((session.modes as any)[5],undefined,'turnings reading off on a site stops it in the tab the learner is looking at');
assert.deepEqual(told.at(-1),{id:5,message:{kind:'reading',enabled:false}},'and the page is told, so a surface already on screen disappears');
const again=await call({kind:'reading-site',enabled:false},contentSender);
assert.deepEqual(again.value.disabledSites,[host],'asking twice is one rule, not two');
// The rule is never taken from the message: a page cannot write a rule about
// somebody else's site.
const forged=await call({kind:'reading-site',enabled:false,site:'bank.example',hostname:'bank.example'},contentSender);
assert.deepEqual(forged.value.disabledSites,[host],'a site named in the message is not the site that gets the rule');
assert.equal((await call({kind:'reading-site',enabled:'yes'},contentSender)).error,'invalid_request','a rule is on or off, and nothing else is an answer');
// The toolbar button refuses on a site the learner turned off, because starting
// reading there would contradict the rule they wrote.
activeTab={id:5,url:pageUrl};
assert.equal((await call({kind:'toggle'},popupSender)).error,'site_disabled','the toolbar button does not override a rule the learner wrote');
// The popup is where the rule can be lifted; it works from its own active tab.
assert.deepEqual((await call({kind:'reading-site',enabled:true},popupSender)).value,{site:host,disabled:false,disabledSites:[]},'the popup lifts the rule for the site it is looking at');
assert.deepEqual((storage.readingPreferences as any).disabledSites,[]);
const status=await call({kind:'status'},popupSender);
assert.deepEqual(status.value.rule,{site:host,disabled:false},'the popup is told which site it is looking at, so it can label the switch honestly');
assert.equal(status.value.language.context.languageRouteId,englishRoute.id);
const selectedRoute=await call({kind:'select-language-route',routeId:spanishRoute.id},popupSender);
assert.equal(selectedRoute.value.language.context.languageRouteId,spanishRoute.id,'the extension owns its active Route selection independently of the Web surface');
assert.equal(storage.readingActiveLanguageRouteId,spanishRoute.id);
assert.equal((await call({kind:'select-language-route',routeId:crypto.randomUUID()},popupSender)).error,'unknown_language_route','the popup cannot select an absent Route');
activeTab={id:7,url:'chrome://extensions'};
assert.equal((await call({kind:'reading-site',enabled:false},popupSender)).error,'unsupported_page','a browser page has no site to write a rule about');
assert.equal((await call({kind:'status'},popupSender)).value.rule,null);
activeTab={id:5,url:pageUrl};
// A page the learner turned off is not injected into at all: no content script,
// no work on every load, for an answer that never changes.
await call({kind:'reading-site',enabled:false},contentSender);
session.modes={5:{accountId}};
const before=injected.length;
updatedListener(5,{status:'complete',url:pageUrl});
await new Promise(resolve=>setTimeout(resolve,50));
assert.equal(injected.length,before,'a disabled site is not injected into on the next page load');
activeTab={id:8,url:'https://'+host+'/other'};
updatedListener(8,{status:'complete',url:'https://'+host+'/other'});
await new Promise(resolve=>setTimeout(resolve,50));
assert.equal(injected.length,before,'nor on another page of the same site');
await call({kind:'reading-site',enabled:true},contentSender);
session.modes={5:{accountId}};
updatedListener(5,{status:'complete',url:pageUrl});
await new Promise(resolve=>setTimeout(resolve,50));
assert.equal(injected.length,before+1,'lifting the rule lets the site be read again');
// One storage, read the same way at both ends: what the page wrote is what the
// settings page shows, and the settings page is not a second place a rule could
// come from.
await call({kind:'reading-site',enabled:false},contentSender);
assert.deepEqual((await readingPreferences()).disabledSites,[host],'the settings page reads back the rule the page wrote');
console.log('PASS: a site rule is written by the background from the tab’s own hostname, normalised and deduplicated, applied to the tab the learner is on, refused by the toolbar button it would contradict, liftable from the popup, never injected into again — and the settings page and the page’s own switch save it through the same writer.');

});
