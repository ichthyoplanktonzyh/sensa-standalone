import {test} from 'vitest';
/** What the learner wrote, and what the service is actually asked.
 *
 * A glossary is learner state: it is written in the local library, published to
 * the extension and carried by every reading request. This runs all of that for
 * real — the library module against a fake IndexedDB, and the real background
 * bundle against a fake browser — and it checks the one thing a stub in every
 * other check had hidden: the body the extension puts on the wire is a body the
 * service accepts. Three of them were not. The streamed reading request carried
 * no language pair at all, and both connection requests carried one they have no
 * field for, so every reading surface and the settings page's own model test were
 * sending requests their service refuses.
 */
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import vm from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';
import {
  readingRequestSchema,readingTestRequestSchema,readingModelsRequestSchema,semanticLookupInputSchema,
  sensaReadingGlossaryLimits,sensaReadingGlossarySchema,
} from '@sensa/contracts/sensa';

test("reading-glossary", async () => {

// ── the library: what the learner wrote ──────────────────────────────────────
const root=await mkdtemp(join(tmpdir(),'sensa-glossary-'));
Object.assign(globalThis,{indexedDB:new IDBFactory(),window:new EventTarget(),BroadcastChannel:undefined});
try{
 const file=join(root,'glossary.mjs');
 await build({entryPoints:['apps/web/src/data/library/glossary.ts'],outfile:file,bundle:true,platform:'browser',format:'esm',logLevel:'silent'});
 const glossary=await import(pathToFileURL(file).href);
 const op=()=>crypto.randomUUID();

 assert.deepEqual(await glossary.readingGlossarySnapshot(),{glossary:[],saved:false},'a learner who has written no terms has no glossary, and nothing is written for them');
 await glossary.setReadingGlossaryEntry(op(),'en','zh-CN','prompt','提示词');
 await glossary.setReadingGlossaryEntry(op(),'en','zh-CN','token','令牌');
 await glossary.setReadingGlossaryEntry(op(),'zh-CN','en','prompt','prompt');
 assert.deepEqual((await glossary.readingGlossarySnapshot()).glossary,[{inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'prompt',rendering:'提示词'},{inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'token',rendering:'令牌'},{inputLanguageTag:'zh-CN',outputLanguageTag:'en',term:'prompt',rendering:'prompt'}]);
 assert.equal((await glossary.readingGlossarySnapshot()).saved,true);
 // One word, one rendering: writing it again corrects the entry rather than
 // leaving the reader to choose between two answers, and the case of the word
 // the learner typed is not a second word.
 const corrected=await glossary.setReadingGlossaryEntry(op(),'en','zh-CN','Prompt','提示');
 assert.deepEqual(corrected.slice(0,2),[{inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'Prompt',rendering:'提示'},{inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'token',rendering:'令牌'}],'a term already listed in the pair is corrected, not duplicated');
 await assert.rejects(()=>glossary.setReadingGlossaryEntry(op(),'en','zh-CN',' '.repeat(3),'提示'),'a blank term is not a term');
 await assert.rejects(()=>glossary.setReadingGlossaryEntry(op(),'en','zh-CN','x'.repeat(sensaReadingGlossaryLimits.term+1),'y'),'a term longer than the limit the schema states is refused');
 const removed=await glossary.removeReadingGlossaryEntry(op(),'en','zh-CN','TOKEN');
 assert.deepEqual(removed,[{inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'Prompt',rendering:'提示'},{inputLanguageTag:'zh-CN',outputLanguageTag:'en',term:'prompt',rendering:'prompt'}],'a term is removed only from its pair and without case sensitivity');
 assert.deepEqual(await glossary.removeReadingGlossaryEntry(op(),'en','zh-CN','token'),removed,'removing a term that is not listed changes nothing');
 // A stored value this release cannot read is no glossary: the learner is not
 // locked out of reading by an entry an older release allowed.
 assert.deepEqual(glossary.readGlossary([{term:'a',rendering:'b'},{term:'a',rendering:'c'}]),[],'an unreadable stored glossary reads as none');
 assert.deepEqual(glossary.readGlossary(undefined),[]);
 assert.deepEqual(sensaReadingGlossarySchema.safeParse(Array.from({length:sensaReadingGlossaryLimits.entriesPerPair+1},(_,i)=>({inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'t'+i,rendering:'r'}))).success,false,'the per-pair limit is the schema’s, so the editor and the publication cannot disagree with it');
 console.log('PASS: the learner’s glossary is route-pair state — the same term may differ across pairs, correction/removal stays inside one pair, and unreadable data is no glossary rather than a failure.');
}finally{await rm(root,{recursive:true,force:true});}

// ── the wire: what the extension asks the service ────────────────────────────
const api='http://127.0.0.1:4319';
const web='http://127.0.0.1:3000';
const pageUrl=web+'/article';
const accountId=crypto.randomUUID();
const libraryId=crypto.randomUUID();
const defaultRoute={id:'00000000-0000-4000-8000-000000000001',revision:1,targetLanguageTag:'en',defaultSupportLanguageTag:'zh-CN',status:'active'};
const stored={readingLanguageRoutes:{revision:1,routes:[defaultRoute]},readingActiveLanguageRouteId:defaultRoute.id,readingGlossary:[{inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'prompt',rendering:'提示词'}]};
const storage:Record<string,unknown>={sensa:{version:1,active:accountId,accounts:{[accountId]:{accountId,installationId:crypto.randomUUID(),webLibraryId:libraryId,token:'fixture-token',queue:[],recent:[],savedOperations:{}}}}};
const session:Record<string,unknown>={modes:{1:{accountId}}};
const sent:{url:string;body:unknown}[]=[];
let messageListener:any=null,connectListener:any=null;
const noopEvent={addListener:()=>{}};
const chromeMock:any={
 storage:{local:{get:async(key:string)=>structuredClone({[key]:key in stored?(stored as any)[key]:storage[key]}),set:async(value:unknown)=>{Object.assign(storage,structuredClone(value));},setAccessLevel:async()=>{}},session:{get:async(key:string)=>structuredClone({[key]:session[key]}),set:async(value:unknown)=>{Object.assign(session,structuredClone(value));}}},
 runtime:{id:'fixture',getURL:(path:string)=>'chrome-extension://fixture/'+path,onMessage:{addListener:(fn:any)=>{messageListener=fn;}},onConnect:{addListener:(fn:any)=>{connectListener=fn;}},sendMessage:async()=>{}},
 tabs:{get:async(id:number)=>({id,url:pageUrl}),create:async()=>({id:20}),update:async(id:number)=>({id}),query:async()=>[],sendMessage:async()=>{},onUpdated:noopEvent,onRemoved:noopEvent},
 identity:{getRedirectURL:(path:string)=>'https://'+'a'.repeat(32)+'.chromiumapp.org/'+path},
 alarms:{create:()=>{},onAlarm:noopEvent},
};
const bundle=await build({entryPoints:['apps/browser-extension/src/background.ts'],bundle:true,write:false,format:'iife',platform:'browser',define:{SENSA_WEB_URL:JSON.stringify(web),SENSA_API_URL:JSON.stringify(api)}});
const responses:Record<string,unknown>={
 '/sensa/reading/run':{status:'ready',text:'她不慌不忙地做事。'},
 '/sensa/reading/test':{status:'ready',text:'ok'},
 '/sensa/reading/models':{data:[{id:'fixture-model'}]},
 '/sensa/semantic/lookups/stream':{},
};
vm.runInNewContext(bundle.outputFiles[0]!.text,{chrome:chromeMock,crypto,btoa,URL,TextEncoder,TextDecoder,AbortSignal,AbortController,setTimeout,clearTimeout,console,
 fetch:async(url:string,init:any)=>{const path=new URL(url).pathname;sent.push({url:path,body:init.body===undefined?undefined:JSON.parse(String(init.body))});
  if(path.endsWith('/stream'))return {ok:true,body:{getReader:()=>({read:async()=>({done:true}),cancel:async()=>{}})}};
  return {ok:true,json:async()=>responses[path]??{}};}});

const fromPage=(input:unknown,sender:unknown={id:'fixture',url:pageUrl,tab:{id:1}})=>new Promise<any>(resolve=>messageListener({...input as object,accountId,pageUrl},sender,resolve));
const reading={id:crypto.randomUUID(),feature:'page',text:'She took her time.',context:'A title',instruction:'',sourceLanguageTag:'en'};
const settled=(ms=50)=>new Promise(resolve=>setTimeout(resolve,ms));
// The defect this smoke was written for: the streamed path sent the caller's own
// input onward and never added the pair the service requires, so every reading
// surface — which is what uses this port — asked a question the service refused.
const portHandler={message:null as any};
connectListener({name:'sensa-reading-stream',sender:{id:'fixture',tab:{id:1},url:web+'/previous-route'},onDisconnect:{addListener:()=>{}},onMessage:{addListener:(fn:any)=>{portHandler.message=fn;}},postMessage:()=>{},disconnect:()=>{}});
portHandler.message({accountId,pageUrl,input:reading});
await settled();
assert.equal(sent.length,1,'a streamed reading reaches the service');
const streamed=sent[0]!;
assert.equal(streamed.url,'/sensa/reading/stream');
assert.deepEqual(streamed.body,{...reading,languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'en',languageRouteId:defaultRoute.id,languageRouteRevision:1},glossary:[{inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'prompt',rendering:'提示词'}]},'the streamed request carries the pinned Route context and only the glossary for this transformation');
const plain=await fromPage({kind:'reading-run',input:{...reading,id:crypto.randomUUID()}});
assert.equal(plain.value.status,'ready');
assert.equal(sent[1]!.url,'/sensa/reading/run');
assert.deepEqual(sent[1]!.body,{...sent[0]!.body,id:(sent[1]!.body as any).id},'both ways a reading leaves the extension ask the same question');
assert.deepEqual((sent[1]!.body as any).glossary,[{inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'prompt',rendering:'提示词'}],'the glossary is the learner’s own pair-scoped copy, not the reader’s guess');
// The service reads exactly these bodies: this is the schema its routes parse.
assert.ok(readingRequestSchema.safeParse(streamed.body).success,'the streaming route must accept the body the port path sends');
assert.ok(readingRequestSchema.safeParse(sent[1]!.body).success,'the run route must accept the body the message path sends');
// With nothing published the request still asks a question the service accepts:
// the shipped pair and no glossary, rather than fields the service has no room for.
delete (stored as any).readingLanguageRoutes;delete (stored as any).readingActiveLanguageRouteId;delete (stored as any).readingGlossary;
const unpublished=await fromPage({kind:'reading-run',input:{...reading,id:crypto.randomUUID()}});
assert.equal(unpublished.error,undefined);
assert.deepEqual((sent[2]!.body as any).languages,{supportLanguageTag:'zh-CN',targetLanguageTag:'en',languageRouteId:'00000000-0000-4000-8000-000000000001',languageRouteRevision:1},'an installation the Web application has not published to still reads with the shipped Route context');
assert.deepEqual((sent[2]!.body as any).glossary,[],'and with no glossary, because the learner has not written one');
(stored as any).readingLanguageRoutes={revision:1,routes:[defaultRoute]};(stored as any).readingActiveLanguageRouteId=defaultRoute.id;(stored as any).readingGlossary=[{inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'prompt',rendering:'提示词'}];

const test=await fromPage({kind:'reading-test',input:{id:crypto.randomUUID(),providerId:crypto.randomUUID()}},{id:'fixture',url:'chrome-extension://fixture/options.html'});
assert.equal(test.error,undefined);
const models=await fromPage({kind:'reading-models',input:{providerId:crypto.randomUUID()}},{id:'fixture',url:'chrome-extension://fixture/options.html'});
assert.equal(models.error,undefined);
const testBody=sent.find(entry=>entry.url==='/sensa/reading/test')!.body;
const modelsBody=sent.find(entry=>entry.url==='/sensa/reading/models')!.body;
assert.ok(readingTestRequestSchema.safeParse(testBody).success,'a model test is the connection question and nothing else');
assert.ok(readingModelsRequestSchema.safeParse(modelsBody).success,'a model list is the connection question and nothing else');
assert.equal('languages' in (testBody as object),false,'a connection question has no languages to speak of');

// The other port on this channel is not a reading: a lookup streams a capture,
// and completing it would be answering a question nobody asked.
const lookupHandler={message:null as any};
connectListener({name:'sensa-lookup-stream',sender:{id:'fixture',tab:{id:1},url:web+'/previous-route'},onDisconnect:{addListener:()=>{}},onMessage:{addListener:(fn:any)=>{lookupHandler.message=fn;}},postMessage:()=>{},disconnect:()=>{}});
const lookup={id:crypto.randomUUID(),snapshot:{sentence:'She took her time.',language:'en',languageSource:'detector',languageConfidence:.9,source:{url:pageUrl,title:'An article',capturedAt:new Date().toISOString()},expression:null}};
lookupHandler.message({accountId,pageUrl,input:lookup});
await new Promise(resolve=>setTimeout(resolve,50));
const lookupBody=sent.find(entry=>entry.url==='/sensa/semantic/lookups/stream')!.body;
assert.deepEqual(lookupBody,{...lookup,languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'en',languageRouteId:defaultRoute.id,languageRouteRevision:1}},'a lookup carries the extension’s selected Route rather than assuming an English/Chinese pair at the API');
assert.equal(semanticLookupInputSchema.safeParse(lookupBody).success,true,'the semantic lookup body matches the API contract');
console.log('PASS: readings and semantic lookups carry the pinned Route context, readings carry the learner glossary, and connection questions carry only their own request.');

});
