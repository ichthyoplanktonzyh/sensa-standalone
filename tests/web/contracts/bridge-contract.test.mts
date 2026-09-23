import {test} from 'vitest';
/** The bridge between a Sensa Web page and the extension, run end to end.
 *
 * The protocol used to be written down three times — the isolated-world
 * forwarder's list of fields to pass along, the service worker's handlers, and
 * the Web application's call sites — and a field present at two ends was dropped
 * in silence by the third, which nothing in this repository could see. It is
 * declared once in the contracts now, and this runs all three ends against each
 * other: the real forwarder bundle in a fake page, the real background bundle on
 * the other side of `chrome.runtime.sendMessage`, and the contracts' own client
 * reading the answers back. The payload table below is what the compiler checks a
 * caller against; the round trips are what proves the far end accepts it.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import vm from 'node:vm';
import {
  canonicalConsumerJson,sensaBrowserIntakeDeliverySchema,sensaBridgeKinds,sensaBridgeMaxRequestIdLength,
  sensaBridgeNotificationChannel,sensaBridgeNotificationKind,sensaBridgeNotificationSchema,
  sensaBridgeRequestChannel,sensaBridgeRequestSchema,sensaBridgeResponseChannel,sensaBridgeResponseSchemas,sensaBridgeValue,
  type SensaBridgeKind,type SensaBridgePayload,
} from '@sensa/contracts/sensa';

test("bridge-contract", async () => {

const web='http://127.0.0.1:3000';
const otherWeb='http://127.0.0.1:3001';
const api='http://127.0.0.1:4319';
const accountId=crypto.randomUUID();
const libraryId=crypto.randomUUID();
const installationId=crypto.randomUUID();
const extensionId='a'.repeat(32);
const routeContext={supportLanguageTag:'zh-CN',targetLanguageTag:'en',languageRouteId:crypto.randomUUID(),languageRouteRevision:3};
const route={id:routeContext.languageRouteId,revision:routeContext.languageRouteRevision,targetLanguageTag:routeContext.targetLanguageTag,defaultSupportLanguageTag:routeContext.supportLanguageTag,status:'active' as const};
const routeCollection={revision:3,routes:[route]};
/** Injected exactly as `build.mjs` injects it: the page-scoped script carries no
 * schema, so the list it enforces comes from the contract at build time. */
const bridgeDefine=(kinds:readonly string[])=>JSON.stringify({request:sensaBridgeRequestChannel,response:sensaBridgeResponseChannel,notification:sensaBridgeNotificationChannel,notificationKind:sensaBridgeNotificationKind,maxIdLength:sensaBridgeMaxRequestIdLength,kinds});

// ── the page, the extension's storage, and one chrome on each side ───────────
let backgroundListener:((message:unknown,sender:unknown,respond:(value:unknown)=>void)=>unknown)|null=null;
let contentListener:((message:unknown,sender:{id?:string})=>unknown)|null=null;
let runtimeListenerCount=0;
// The account is connected but its credential is nearly out of date, which is
// the state that asks for a new authorization rather than answering that the
// connection is already good enough.
const storage:Record<string,unknown>={sensa:{version:1,active:accountId,accounts:{[accountId]:{accountId,installationId,webLibraryId:libraryId,token:'fixture-extension-token',expiresAt:new Date(Date.now()+60000).toISOString(),queue:[],recent:[],savedOperations:{}}}}};
const session:Record<string,unknown>={modes:{}};
/** The sender the real API fills in: a message from this page has this tab and
 * this URL, whatever the caller passed to `sendMessage`. */
const pageSender=(url=web+'/content',tab:unknown={id:7})=>({id:extensionId,url,tab});
/** Set for the cases that are about where a message came from rather than what
 * it says: the API decides the sender, so a test has to decide it too. */
let senderOverride:unknown=null;
const noopEvent={addListener:()=>{}};
let asleep=false,sendFailures=0,sendThrows=0;
const answers:any[]=[];
let wake:()=>void=()=>{};
const chromeMock:any={
  identity:{getRedirectURL:(path:string)=>'https://'+'a'.repeat(32)+'.chromiumapp.org/'+path},
  storage:{
    local:{get:async(key:string)=>structuredClone({[key]:storage[key]}),set:async(value:unknown)=>{Object.assign(storage,structuredClone(value));},setAccessLevel:async()=>{}},
    session:{get:async(key:string)=>structuredClone({[key]:session[key]}),set:async(value:unknown)=>{Object.assign(session,structuredClone(value));}},
  },
  runtime:{id:extensionId,getURL:(path:string)=>'chrome-extension://'+extensionId+'/'+path,onMessage:{addListener:(fn:any)=>{if(runtimeListenerCount++===0)contentListener=fn;else backgroundListener=fn;}},onConnect:{addListener:()=>{}},
    sendMessage:(message:unknown)=>new Promise((resolve,reject)=>{
      // What the real boundary does when the worker is not there, and when the
      // page's object cannot cross it at all.
      if(asleep)return reject(new Error('Could not establish connection. Receiving end does not exist.'));
      if(sendFailures>0){sendFailures--;return reject(new Error('Could not establish connection. Receiving end does not exist.'));}
      if(sendThrows>0){sendThrows--;throw new Error('Could not serialize message');}
      if(!backgroundListener)return reject(new Error('no listener'));
      backgroundListener(message,senderOverride??pageSender(),resolve);
    })},
  tabs:{create:async()=>({id:20}),update:async(id:number)=>({id}),query:async()=>[],sendMessage:async()=>{},onUpdated:noopEvent,onRemoved:noopEvent},
  alarms:{create:()=>{},onAlarm:noopEvent},
};
const pageListeners:((event:unknown)=>void)[]=[];
const context:any={chrome:chromeMock,crypto,btoa,URL,TextEncoder,TextDecoder,AbortSignal,setTimeout,clearTimeout,console,fetch:async()=>{throw new Error('no network in this smoke');}};
Object.assign(context,{
  location:{origin:web},
  addEventListener:(type:string,fn:(event:unknown)=>void)=>{if(type==='message')pageListeners.push(fn);},
  postMessage:(data:unknown)=>{answers.push(data);wake();},
});
context.window=context;context.self=context;
vm.createContext(context);
const bundle=(entry:string,defines:Record<string,string>)=>build({entryPoints:[entry],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120',define:{SENSA_WEB_URL:JSON.stringify(web),SENSA_API_URL:JSON.stringify(api),...defines}});
const forwarderBundle=await bundle('apps/browser-extension/src/webBridge.ts',{SENSA_BRIDGE:bridgeDefine(sensaBridgeKinds)});
const backgroundBundle=await bundle('apps/browser-extension/src/background.ts',{SENSA_BRIDGE:bridgeDefine(sensaBridgeKinds)});
vm.runInContext(forwarderBundle.outputFiles[0]!.text,context);
vm.runInContext(backgroundBundle.outputFiles[0]!.text,context);
assert.ok(backgroundListener,'the background bundle registers a listener');
assert.ok(contentListener,'the page forwarder registers a notification listener');
// The window the page's script sees is the contextified one, which is not the
// object handed to `vm.createContext` as seen from here: a dispatched event has
// to carry that exact one, because the bridge checks where a message came from.
const pageWindow=vm.runInContext('window',context) as unknown;
contentListener!({kind:sensaBridgeNotificationKind,accountId},{id:extensionId});
const notification=answers.at(-1);
assert.ok(sensaBridgeNotificationSchema.safeParse(notification).success,'the extension notification crosses into the page on its declared channel');
assert.equal(notification.channel,sensaBridgeNotificationChannel);

/** A turn on the bridge as the Web application builds one: the envelope, this
 * kind's payload, and nothing else. */
const request=(kind:string,body:Record<string,unknown>={},id=crypto.randomUUID())=>({
  channel:sensaBridgeRequestChannel,id,kind,
  accountId,
  ...(kind!=='web-session-ended'?{libraryId}:{}),
  ...body,
});
const settle=(budget:number)=>new Promise<void>(resolve=>{const timer=setTimeout(resolve,budget);wake=()=>{clearTimeout(timer);resolve();};});
/** Post from the page and wait for the answer to *that* request: the page
 * matches answers by id, so a wrong or missing echo is a failure, not a pass. */
const fromPage=async(body:any,{origin=web,source=pageWindow}:{origin?:string;source?:unknown}={})=>{
  const before=answers.length;
  for(const listener of pageListeners)listener({source,origin,data:body});
  const found=()=>answers.slice(before).find(answer=>answer?.id===body.id);
  for(const budget of [5,50,200]){if(found())break;await settle(budget);}
  const answer=found();
  if(!answer)return 'silent' as const;
  assert.equal(answer.channel,sensaBridgeResponseChannel,'an answer arrives on the bridge\'s own answer channel');
  return answer;
};
/** The service worker reached directly, for what a page cannot send. */
const raw=(message:unknown,sender:unknown)=>new Promise<any>((resolve,reject)=>{try{backgroundListener!(message,sender,resolve);}catch(error){reject(error);}});

// ── phase 1: what the boundary refuses, before any handler runs ──────────────
assert.equal(await fromPage({...request('web-intake-pull'),channel:'some-other-channel'}),'silent','another channel is not this bridge');
assert.equal(await fromPage({...request('web-intake-pull'),id:''}),'silent','a request nobody can answer is not taken');
assert.equal(await fromPage({...request('web-intake-pull'),id:'x'.repeat(sensaBridgeMaxRequestIdLength+1)}),'silent','an unbounded id is not taken');
assert.equal((await fromPage(request('reading-run'))).error,'unsupported_message','a page cannot reach the extension\'s other features through the bridge');
assert.equal((await fromPage(request('web-intake-pull',{glossary:['a term']}))).error,'unsupported_message','a field the protocol does not declare is refused, not dropped');
assert.equal((await fromPage(request('web-language-routes'))).error,'unsupported_message','a payload the protocol requires cannot be omitted');
assert.equal((await fromPage(request('web-language-routes',{routes:{...routeCollection,extra:true}}))).error,'unsupported_message','a payload is as strict as the request');
const immersionRoute={...route,targetLanguageTag:'zh-CN'};
const immersionContext={...routeContext,targetLanguageTag:'zh-CN'};
assert.deepEqual(sensaBridgeValue('web-language-routes',await fromPage(request('web-language-routes',{routes:{revision:4,routes:[immersionRoute]}}))),immersionContext,'one language may play both Target and Support roles');
assert.equal((await fromPage(request('web-language-routes',{routes:{revision:4,routes:[{...route,targetLanguageTag:'klingon'}]}}))).error,'unsupported_message','a language this release cannot name cannot be translated into');
assert.equal((await fromPage(request('web-connect-reset'))).error,'unsupported_message','discarding unsent captures is a decision, not a default');
assert.equal(await fromPage(request('web-intake-pull'),{origin:otherWeb}),'silent','an event posted from another origin is not this bridge');
assert.equal(await fromPage(request('web-intake-pull'),{source:{}}),'silent','an event from another window is not this bridge');
senderOverride=pageSender(otherWeb+'/content',{id:9});
assert.equal((await fromPage(request('web-intake-pull'))).error,'unsupported_message','a content script on another origin is not this bridge');
senderOverride={id:extensionId,url:web+'/content'};
assert.equal((await fromPage(request('web-intake-pull'))).error,'unsupported_message','a caller with no tab is not this bridge');
senderOverride=null;
assert.equal((await fromPage(request('web-intake-ack',{receipt:{}}))).error,'unsupported_message','a receipt the protocol does not define never reaches the ledger');
// The envelope is required at the service worker too, not only in the forwarder:
// a kind alone is not a bridge request, whatever it is called.
assert.equal((await raw({kind:'web-intake-pull',accountId,libraryId},pageSender())).error,'unsupported_message','a bridge kind without the envelope is not a bridge request');
asleep=true;
assert.equal((await fromPage(request('web-intake-pull'))).error,'extension_unavailable','a sleeping worker is named as one');
asleep=false;
// A send that fails — the worker closed between the two calls, or the page's
// object cannot be cloned — is an extension the page cannot reach, named as one
// rather than left to look like a request that was simply slow.
sendFailures=1;
assert.equal((await fromPage(request('web-intake-pull'))).error,'extension_unavailable','a rejected send is answered, not left hanging');
sendFailures=0;
sendThrows=1;
assert.equal((await fromPage(request('web-intake-pull'))).error,'extension_unavailable','a synchronously failing send is answered the same way');
sendThrows=0;
console.log('PASS: the boundary refuses another channel, window or origin, an unknown kind, an undeclared field, a missing or contradictory payload and an unbounded id — and it tells a sleeping worker apart from a refusal.');

// ── phase 2: every declared kind, through the real forwarder and handler ─────
Object.assign(globalThis,{chrome:chromeMock});
const {queueWeb,pendingWeb}=await import('../../../apps/browser-extension/src/webDestination.ts');
const {browserCaptureToIntake}=await import('../../../apps/browser-extension/src/semanticIntakeAdapter.ts');
const snapshot={sentence:'Slow mornings suit her.',language:'en',languageSource:'detector',languageConfidence:.9,source:{url:web+'/article',title:'An article',capturedAt:new Date().toISOString()},expression:{text:'suit',start:14,end:18}};
const browserIntake=browserCaptureToIntake(crypto.randomUUID(),snapshot,null);
const queued=sensaBrowserIntakeDeliverySchema.parse({contractVersion:'sensa-browser-intake-delivery-v1',libraryId,clientId:installationId,intake:browserIntake});
await queueWeb(accountId,queued);
const digest=createHash('sha256').update(canonicalConsumerJson(queued)).digest('hex');
const receipt={contractVersion:'sensa-browser-intake-delivery-v1' as const,libraryId,clientId:installationId,operationId:queued.intake.operationId,requestDigest:digest,result:{route:'inbox' as const,intakeId:crypto.randomUUID(),status:'pending_sense' as const},appliedAt:new Date().toISOString()};

const published=await fromPage(request('web-language-routes',{routes:routeCollection}));
assert.deepEqual(sensaBridgeValue('web-language-routes',published),routeContext,'publishing the Route collection answers the extension’s selected context');
assert.deepEqual(storage.readingLanguageRoutes,routeCollection,'the extension holds the Web-owned Route collection');
assert.equal(storage.readingActiveLanguageRouteId,route.id,'the extension keeps its own active Route selection');
assert.deepEqual(sensaBridgeValue('web-intake-pull',await fromPage(request('web-intake-pull'))),[queued],'the page receives the capture the way the contracts describe it');
assert.equal((await fromPage(request('web-intake-ack',{receipt:{...receipt,libraryId:crypto.randomUUID()}}))).error,'library_mismatch','a receipt for another library is the reconnect case, not a format error');
assert.equal((await fromPage(request('web-intake-ack',{receipt:{...receipt,requestDigest:'0'.repeat(64)}}))).error,'web_invalid_receipt','a receipt the ledger cannot vouch for is refused by the ledger');
assert.equal(sensaBridgeValue('web-intake-ack',await fromPage(request('web-intake-ack',{receipt}))).acknowledged,true,'a receipt that matches is acknowledged');
assert.deepEqual(sensaBridgeValue('web-intake-pull',await fromPage(request('web-intake-pull'))),[],'an acknowledged capture is not handed over again');
const pairGlossary=[{inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'prompt',rendering:'提示词'}];
assert.deepEqual(sensaBridgeValue('web-reading-glossary',await fromPage(request('web-reading-glossary',{glossary:pairGlossary}))),pairGlossary,'the published pair glossary is answered as published');
assert.deepEqual(storage.readingGlossary,pairGlossary,'the glossary the extension holds is the published one');
assert.equal((await fromPage(request('web-reading-glossary',{glossary:[...pairGlossary,{...pairGlossary[0],term:'Prompt',rendering:'提示'}]}))).error,'unsupported_message','two renderings for one term inside one pair is not a glossary');
const authorization=sensaBridgeValue('web-connect-prepare',await fromPage(request('web-connect-prepare'))).authorization;
assert.ok(authorization,'a connection with none in flight is offered an authorization');
assert.equal(authorization!.redirectUri,'https://'+'a'.repeat(32)+'.chromiumapp.org/sensa');
assert.equal(sensaBridgeValue('web-connect-prepare',await fromPage(request('web-connect-prepare'))).paused,true,'a second tab cannot start a second connection');
assert.equal((await fromPage(request('web-connect-complete',{receipt:{redirectUri:authorization!.redirectUri+'?state=wrong&code='+crypto.randomUUID()}}))).error,'authorization_invalid','a redirect with the wrong state is refused');
assert.equal((await fromPage(request('web-connect-complete',{receipt:{redirectUri:authorization!.redirectUri+'?state='+authorization!.state}}))).error,'authorization_invalid','a redirect with no code is refused here rather than by the API');
// Sign-out is the one request without a library, and it is scoped to the account
// the page names: another account's sign-out does not touch this connection.
assert.equal(sensaBridgeValue('web-session-ended',await fromPage({channel:sensaBridgeRequestChannel,id:crypto.randomUUID(),kind:'web-session-ended',accountId:crypto.randomUUID()})).disconnected,false,'another account cannot end this connection');
assert.equal(sensaBridgeValue('web-session-ended',await fromPage({channel:sensaBridgeRequestChannel,id:crypto.randomUUID(),kind:'web-session-ended',accountId})).disconnected,true,'the account that is connected can end it');
assert.equal((storage.sensa as any).active,null,'sign-out drops the active connection');
assert.equal(sensaBridgeValue('web-connect-reset',await fromPage(request('web-connect-reset',{receipt:{discardPending:false}}))).reset,true,'a reconnect is answered');
assert.deepEqual(await pendingWeb(accountId,libraryId),[],'a reconnect keeps delivered receipts');
console.log('PASS: every declared kind is served through the real forwarder and handler — published Route context and glossary, pull and acknowledgement, PKCE prepare and its refusals, account-scoped sign-out and reconnect — and each answer parses as the contracts describe it.');

// ── phase 3: one declaration, read by all three ends ─────────────────────────
/** What a caller may send for each kind, checked by the compiler against the
 * declaration: a kind without a payload, or with the wrong one, fails to build. */
const payloads:{[K in SensaBridgeKind]:SensaBridgePayload<K>}={
  'web-intake-pull':{},
  'web-intake-ack':{receipt},
  'web-connect-prepare':{},
  'web-connect-complete':{receipt:{redirectUri:'https://'+'a'.repeat(32)+'.chromiumapp.org/sensa'}},
  'web-connect-reset':{receipt:{discardPending:false}},
  'web-session-ended':{},
  'web-language-routes':{routes:routeCollection},
  'web-reading-glossary':{glossary:pairGlossary},
};
assert.deepEqual(Object.keys(payloads).sort(),[...sensaBridgeKinds].sort(),'every kind has exactly one payload shape, and no kind is missing one');
assert.deepEqual(Object.keys(sensaBridgeResponseSchemas).sort(),[...sensaBridgeKinds].sort(),'every kind has exactly one declared answer');
assert.equal(sensaBridgeKinds.length,8);
for(const kind of sensaBridgeKinds){
  const built:Record<string,unknown>={channel:sensaBridgeRequestChannel,id:crypto.randomUUID(),kind,accountId,...payloads[kind] as Record<string,unknown>};
  if(kind!=='web-session-ended')built.libraryId=libraryId;
  assert.ok(sensaBridgeRequestSchema.safeParse(built).success,'the declaration accepts what a caller builds for '+kind);
}
assert.equal(sensaBridgeRequestSchema.safeParse({...request('web-intake-pull'),glossary:[]}).success,false,'the declaration itself is strict about the fields it does not have');
assert.throws(()=>sensaBridgeValue('web-intake-pull',{channel:sensaBridgeResponseChannel,id:'1',error:'account_mismatch'}),/account_mismatch/,'an error answer carries the handler\'s own code to the caller');
assert.throws(()=>sensaBridgeValue('web-intake-pull',{channel:sensaBridgeResponseChannel,id:'1',value:[{nonsense:true}]}),'a value of the wrong shape is not read as an answer');
// The allowlist is injected data rather than a list written into the script: a
// build that injects one kind refuses the rest, which is what makes the injected
// contract the gate instead of a copy of the protocol living in the page.
let narrowSends=0;
const narrowListeners:((event:unknown)=>void)[]=[],narrowAnswers:any[]=[];
const narrowContext:any={crypto,console,URL,location:{origin:web},chrome:{runtime:{id:'fixture',getURL:()=>'',sendMessage:async()=>{narrowSends++;},onMessage:{addListener:()=>{}}}},addEventListener:(type:string,fn:(event:unknown)=>void)=>{if(type==='message')narrowListeners.push(fn);},postMessage:(data:unknown)=>{narrowAnswers.push(data);}};
narrowContext.window=narrowContext;
vm.createContext(narrowContext);
const narrowBundle=await bundle('apps/browser-extension/src/webBridge.ts',{SENSA_BRIDGE:bridgeDefine(['web-intake-pull'])});
vm.runInContext(narrowBundle.outputFiles[0]!.text,narrowContext);
const narrowWindow=vm.runInContext('window',narrowContext) as unknown;
const sendToNarrowPage=(data:unknown)=>{for(const listener of narrowListeners)listener({source:narrowWindow,origin:web,data});};
sendToNarrowPage(request('web-language-routes',{routes:routeCollection}));
assert.equal(narrowAnswers[0]?.error,'unsupported_message','a kind the injected list does not have is answered as unsupported, instead of waiting for an extension that will not reply');
assert.equal(narrowSends,0,'and it never reaches the extension');
sendToNarrowPage(request('web-intake-pull'));
assert.equal(narrowSends,1,'a kind the injected list does have is forwarded');
console.log('PASS: one declaration is read by all three ends — the payload and answer maps cover the kinds exactly, the schema accepts what a caller builds and refuses fields it does not have, and the forwarder\'s allowlist is the injected contract rather than a copy.');

});
