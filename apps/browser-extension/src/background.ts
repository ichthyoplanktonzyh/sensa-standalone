import {queueWeb,pendingWeb,acknowledgeWeb,webStatus,discardPendingWeb,webOperationStatus,exportWebQueueRecovery,discardWebQueueRecovery} from './webDestination';
import {browserCaptureToIntake} from './semanticIntakeAdapter';
import {z} from 'zod';
import {captureSnapshotSchema,sensaLanguageForDeclaredTag,sensaLanguageForIso6393,sensaReadingGlossaryForPair,sensaBridgeNotificationKind,sensaBridgeRequestChannel,sensaBridgeRequestSchema,sensaExtensionCredentialSchema,type SensaBridgeRequest,type SensaBridgeRequestOf,type SensaExtensionAuthorization,type SensaExtensionExchange} from '@sensa/contracts/sensa';
import {webUrl,apiUrl} from './config';
import {detectIso6393} from './languageDetector';
import {maxDetectableCharacters,minSkimmableCharacters} from './language';
import {readYoutubePlayer} from './youtubePlayer';
import {readingLanguageContext,readingLanguageRouteSnapshot,selectReadingLanguageRoute,readingPreferences,saveReadingPreferences,readingSiteOf,publishReadingLanguageRoutes,readingGlossary,publishReadingGlossary} from './preferences';
import {t} from './i18n';
import {localSettings,saveLocalSettings,localModels,testLocalModel,localConnectionFor,runLocalReading,runLocalLookup} from './localModels';
import {bindLocalLibrary,resetLocalLibrary,queueLocalCapture,pendingLocal,acknowledgeLocal,localOperationStatus,localIntakeStatus} from './localIntake';
type Mode={accountId:string};
const accountSchema=z.object({expiresAt:z.string().datetime().optional(),webLibraryId:z.string().uuid().optional(),accountId:z.string().uuid(),installationId:z.string().uuid(),token:z.string().min(1),queue:z.array(z.unknown()).default([]),recent:z.array(z.unknown()).default([]),savedOperations:z.record(z.string(),z.unknown()).default({})}).passthrough();
const storeSchema=z.object({version:z.literal(1).default(1),active:z.string().uuid().nullable(),accounts:z.record(z.string(),accountSchema)}).strict();
type Store=z.infer<typeof storeSchema>;
let serial:Promise<unknown>=Promise.resolve();
const restrictedStorage=chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
function locked<T>(work:()=>Promise<T>):Promise<T>{const next=serial.catch(()=>undefined).then(work);serial=next;return next;}
async function load():Promise<Store>{
 const raw=(await chrome.storage.local.get('sensa')).sensa;if(!raw)return {version:1,active:null,accounts:{}};
 const parsed=storeSchema.safeParse(raw);if(!parsed.success)throw new Error('client_update_required');
 const store=parsed.data;if(store.active&&!store.accounts[store.active])throw new Error('client_update_required');
 for(const [key,a] of Object.entries(store.accounts))if(key!==a.accountId)throw new Error('client_update_required');
 return store;
}
async function modes():Promise<Record<number,Mode>>{const raw=(await chrome.storage.session.get('modes')).modes??{};return Object.fromEntries(Object.entries(raw).filter((entry):entry is [string,Mode]=>typeof entry[1]==='object'&&entry[1]!==null&&typeof (entry[1] as Mode).accountId==='string'));}
async function stopAllReading(){const active=(await chrome.storage.session.get('modes')).modes??{};await chrome.storage.session.set({modes:{}});await Promise.all(Object.keys(active).map(id=>chrome.tabs.sendMessage(Number(id),{kind:'reading',enabled:false}).catch(()=>undefined)));}
async function persist(store:Store){await chrome.storage.local.set({sensa:store});}
async function serviceFetch(url:string,init:RequestInit){try{return await fetch(url,init);}catch(error){throw new Error(error instanceof Error&&['AbortError','TimeoutError'].includes(error.name)?'TimeoutError':'network_failed');}}
async function apiRequest(path:string,body:unknown,token?:string){const response=await serviceFetch(apiUrl+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const data=await response.json();if(!response.ok)throw new Error(data.code??'temporarily_unavailable');return data;}
async function pkceAuthorization(installationId:string){
 const verifier=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 const state=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 const challenge=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
 const redirectUri=chrome.identity.getRedirectURL('sensa');
 return {verifier,authorization:{installationId,state,challenge,redirectUri} satisfies SensaExtensionAuthorization};
}
// A short-lived, tab-bound PKCE request. The Web never receives the verifier or
// extension credential; its existing session only authorizes a one-time code.
// The origin and tab this request came from are already checked by the bridge.
async function webConnect(request:SensaBridgeRequestOf<'web-connect-prepare'|'web-connect-complete'>,sender:chrome.runtime.MessageSender){
 return locked(async()=>{
  const store=await load(),accountId=request.accountId,libraryId=request.libraryId;
  if((await chrome.storage.local.get('sensaAutoConnectPaused')).sensaAutoConnectPaused)return {paused:true};
  const old=store.accounts[accountId];
  if(store.active&&store.active!==accountId)throw new Error('account_mismatch');
  const reconnect=(await chrome.storage.session.get('sensaExplicitReconnect')).sensaExplicitReconnect as {tabId:number;expires:number;accountId?:string;libraryId?:string}|undefined;
  const explicitReconnect=!!reconnect&&reconnect.tabId===sender.tab!.id&&reconnect.expires>Date.now()&&(!reconnect.accountId||reconnect.accountId===accountId)&&(!reconnect.libraryId||reconnect.libraryId===libraryId);
  if(old?.webLibraryId&&old.webLibraryId!==libraryId&&!explicitReconnect)throw new Error('library_mismatch');
  if(request.kind==='web-connect-prepare'){
   const inflight=(await chrome.storage.session.get('sensaWebConnect')).sensaWebConnect as {expires?:number}|null;
   if(inflight?.expires&&inflight.expires>Date.now())return {paused:true};
   if(store.active===accountId&&old?.webLibraryId===libraryId&&old?.expiresAt&&Date.parse(old.expiresAt)>Date.now()+3600000)return {connected:true};
   const installationId=old?.installationId??crypto.randomUUID();
   const {verifier,authorization}=await pkceAuthorization(installationId);
   await chrome.storage.session.set({sensaWebConnect:{tabId:sender.tab!.id,accountId,libraryId,installationId,verifier,state:authorization.state,redirectUri:authorization.redirectUri,expires:Date.now()+120000}});
   return {authorization};
  }
  const pending=z.object({tabId:z.number(),accountId:z.string().uuid(),libraryId:z.string().uuid(),installationId:z.string().uuid(),verifier:z.string(),state:z.string(),redirectUri:z.string().url(),expires:z.number()}).nullable().parse((await chrome.storage.session.get('sensaWebConnect')).sensaWebConnect??null);
  if(!pending||pending.tabId!==sender.tab!.id||pending.accountId!==accountId||pending.libraryId!==libraryId||pending.expires<Date.now())throw new Error('authorization_expired');
  const destination=new URL(request.receipt.redirectUri);
  if(destination.origin+destination.pathname!==pending.redirectUri||destination.searchParams.get('state')!==pending.state)throw new Error('authorization_invalid');
  // A redirect that carries no code is not an authorization result, whatever its
  // state says: refusing it here names the failure instead of sending the API a
  // request it can only answer with a schema error.
  const code=destination.searchParams.get('code');
  if(!code)throw new Error('authorization_invalid');
  await chrome.storage.session.set({sensaWebConnect:null});
  const exchange:SensaExtensionExchange={code,installationId:pending.installationId,state:pending.state,verifier:pending.verifier};
  const credential=sensaExtensionCredentialSchema.parse(await apiRequest('/sensa/extension/exchange',exchange));
  if(credential.accountId!==accountId)throw new Error('account_mismatch');
  store.accounts[accountId]={...old,accountId,installationId:pending.installationId,webLibraryId:libraryId,token:credential.token,expiresAt:credential.expiresAt,queue:old?.queue??[],recent:old?.recent??[],savedOperations:old?.savedOperations??{}};
  const changed=store.active!==accountId;store.active=accountId;await persist(store);await chrome.storage.session.set({sensaExplicitReconnect:null});if(changed)await stopAllReading();
  return {connected:true};
 });
}
async function reconnectWeb(discardForAccount?:string){return locked(async()=>{
 const store=await load();
 if(discardForAccount&&store.active===discardForAccount){
  await discardPendingWeb(discardForAccount);
  const previous=store.accounts[discardForAccount];
  previous.queue=[];previous.savedOperations={};
 }
 store.active=null;await persist(store);
 await chrome.storage.local.set({sensaAutoConnectPaused:false});
 await chrome.storage.session.set({sensaWebConnect:null,sensaExplicitReconnect:null});await stopAllReading();
 // Account-owned queues and credentials stay under their original account.
});}
/**
 * The Web library is one origin-owned SQLite database. Reuse its existing tab
 * instead of opening a competing OPFS connection that can strand the new tab on
 * the account gate while the already-open product remains healthy.
 */
async function openWebPath(path:string){
 const url=new URL(path,webUrl).href,pattern=new URL('/*',webUrl).href;
 const openTabs=await chrome.tabs.query({url:pattern});
 const existing=openTabs.find(tab=>tab.active&&tab.id)??openTabs.find(tab=>tab.id);
 if(existing?.id){await chrome.tabs.update(existing.id,{active:true,url});return;}
 await chrome.tabs.create({url});
}
function webContentPath(raw:unknown){
 if(raw===undefined)return '/content?worldAction=inbox';
 const target=new URL(z.string().max(2048).parse(raw),webUrl);
 if(target.origin!==new URL(webUrl).origin||!['/content','/content/personal-meaning'].includes(target.pathname)||target.hash)throw new Error('unsupported_message');
 return target.pathname+target.search;
}
async function loginThroughWeb(){
 await reconnectWeb();
 // The user's Sensa session lives in the ordinary Web origin. Chrome's identity
 // flow runs in an auth web view, which cannot be treated as that already-open
 // product tab. Open the real Web application and let its existing page bridge
 // perform the same tab-bound PKCE exchange used by automatic reconnect.
 const pattern=new URL('/*',webUrl).href;
 const openTabs=await chrome.tabs.query({url:pattern});
 const existing=openTabs.find(tab=>tab.active&&tab.id)??openTabs.find(tab=>tab.id);
 if(existing?.id){
  await chrome.storage.session.set({sensaExplicitReconnect:{tabId:existing.id,expires:Date.now()+600000}});
  await chrome.tabs.update(existing.id,{active:true});
  await chrome.tabs.reload(existing.id);
  return;
 }
 const tab=await chrome.tabs.create({url:'about:blank'});
 if(!tab.id)throw new Error('authorization_cancelled');
 await chrome.storage.session.set({sensaExplicitReconnect:{tabId:tab.id,expires:Date.now()+600000}});
 await chrome.tabs.update(tab.id,{url:new URL('/profile',webUrl).href});
}
async function localScope(){
 const key='sensaExtensionLocalScope',stored=(await chrome.storage.local.get(key))[key];
 if(typeof stored==='string'&&z.string().uuid().safeParse(stored).success)return stored;
 const id=crypto.randomUUID();await chrome.storage.local.set({[key]:id});return id;
}
/** A reading tab belongs to this installation even without a Sensa account. */
async function activeScope(){return (await load()).active??await localScope();}

/**
 * `MessageSender.url` identifies the document that opened the extension
 * connection. On a single-page application that document may have navigated
 * since then, while the selection snapshot correctly contains the current URL.
 * The active-tab grant lets the background read the tab's live URL, which is the
 * authority for page-bound reading and capture requests.
 */
async function currentPageUrl(sender:chrome.runtime.MessageSender){
 if(!sender.tab?.id)throw new Error('unsupported_page');
 const tab=await chrome.tabs.get(sender.tab.id);
 if(!tab.url||!/^https?:/u.test(tab.url))throw new Error('unsupported_page');
 return tab.url;
}

function errorCode(error:unknown){return error instanceof z.ZodError?'invalid_request':error instanceof Error?error.message:'failed';}

/** Reading off for one tab: the mode goes and the page is told, so a surface that
 * is already on screen disappears instead of waiting for a reload. */
async function stopReadingIn(tabId:number){
 const readingModes=await modes();delete readingModes[tabId];
 await chrome.storage.session.set({modes:readingModes});
 await chrome.tabs.sendMessage(tabId,{kind:'reading',enabled:false}).catch(()=>undefined);
}

/**
 * A reading request, completed with the learner's own state.
 *
 * A surface states what it observed — the text, what it sits in, the language it
 * recognised — and the pair and the glossary are added here, in the one context a
 * page cannot read. Both ways a reading leaves this extension go through this
 * function: the streaming port and the plain message. A request that reached the
 * service without the pair would be refused for naming no languages, and refused
 * for every paragraph the learner reads, which is what a second place to add them
 * had already produced.
 *
 * A model test and a model list are not reading requests: they ask about a
 * connection, and their bodies are strictly those questions. Adding the learner's
 * languages to them was a body the service refused.
 */
async function readingInput(input:unknown){
 const request=input as Record<string,unknown>,languages=await readingLanguageContext();
 const writing=request.feature==='writing';
 const inputLanguageTag=writing?languages.supportLanguageTag:typeof request.sourceLanguageTag==='string'?request.sourceLanguageTag:languages.targetLanguageTag;
 const outputLanguageTag=writing?languages.targetLanguageTag:languages.supportLanguageTag;
 return {...request,languages,glossary:sensaReadingGlossaryForPair(await readingGlossary(),inputLanguageTag,outputLanguageTag)};
}

/**
 * Every request the Web page bridge can make, served in one place.
 *
 * A page is a caller and never a source of truth: the account and library it
 * names are checked against the connection this installation actually holds. The
 * origin and tab checks live here once, because they are the same for all of
 * these requests — the bridge runs in a content script on the configured Sensa
 * origin, and no other page may reach any of it.
 */
async function serveWebBridge(request:SensaBridgeRequest,sender:chrome.runtime.MessageSender){
 if(!sender.tab?.id||!sender.url||new URL(sender.url).origin!==new URL(webUrl).origin)throw new Error('unsupported_message');
 switch(request.kind){
  case 'web-connect-prepare':
  case 'web-connect-complete':return webConnect(request,sender);
  case 'web-local-bind':return bindLocalLibrary(request.libraryId);
  case 'web-local-reset':return resetLocalLibrary(request.libraryId,request.receipt.discardPending);
  // The Web application owns Route facts. The extension accepts the collection
  // while preserving its own surface-scoped selection when it remains valid.
  case 'web-language-routes':if(request.accountId===null)await bindLocalLibrary(request.libraryId);return locked(()=>publishReadingLanguageRoutes(request.routes));
  case 'web-reading-glossary':if(request.accountId===null)await bindLocalLibrary(request.libraryId);return locked(()=>publishReadingGlossary(request.glossary));
  case 'web-session-ended':return locked(async()=>{
   const store=await load();
   if(!store.active||store.active!==request.accountId)return {disconnected:false};
   const a=store.accounts[store.active];a.token='disconnected';a.expiresAt=new Date(0).toISOString();store.active=null;
   await persist(store);await chrome.storage.session.set({sensaWebConnect:null});await stopAllReading();
   return {disconnected:true};
  });
  case 'web-connect-reset':{
   // The one request allowed to name a library other than the bound one: it is
   // the learner's explicit decision, and the connection it opens is offered to
   // the tab that asked rather than to whichever tab connects next.
   const previous=(await load()).active;
   await reconnectWeb(request.receipt.discardPending&&previous&&previous!==request.accountId?previous:undefined);
   await chrome.storage.session.set({sensaExplicitReconnect:{tabId:sender.tab.id,accountId:request.accountId,libraryId:request.libraryId,expires:Date.now()+120000}});
   return {reset:true};
  }
  case 'web-intake-pull':
  case 'web-intake-ack':{
   if(request.accountId===null){
    if(request.kind==='web-intake-ack'){
     if(request.receipt.libraryId!==request.libraryId)throw new Error('library_mismatch');
     return acknowledgeLocal(request.receipt);
    }
    return pendingLocal(request.libraryId,await localScope());
   }
   const store=await load(),a=store.active?store.accounts[store.active]:null;
   if(!a)throw new Error('authentication_required');
   if(request.accountId!==a.accountId)throw new Error('account_mismatch');
   if(request.kind==='web-intake-ack'){
    if(request.receipt.libraryId!==request.libraryId)throw new Error('library_mismatch');
    return acknowledgeWeb(a.accountId,request.receipt);
   }
   return pendingWeb(a.accountId,request.libraryId);
  }
 }
}
async function notifyWebIntake(accountId:string|null){
 const origin=new URL(webUrl).origin;
 const tabs=await chrome.tabs.query({url:origin+'/*'});
 await Promise.all(tabs.flatMap(tab=>tab.id===undefined?[]:[chrome.tabs.sendMessage(tab.id,{kind:sensaBridgeNotificationKind,accountId}).catch(()=>undefined)]));
}
async function status(){
 const store=await load(),a=store.active?store.accounts[store.active]:null;
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true}),site=readingSiteOf(tab?.url);
 const rule=site?{site,disabled:(await readingPreferences()).disabledSites.includes(site)}:null;
 const local=await localIntakeStatus(),account=await webStatus(a?.accountId??null);
 const base={accountId:a?.accountId??null,destination:'web-local',pending:local.pending+account.pending,errors:[...local.errors,...account.errors],recent:[...local.recent,...account.recent].slice(0,20),recoveryCount:account.recoveryCount};
 const language=await readingLanguageRouteSnapshot();
 return {...base,rule,language};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id)return;
 const isPopup=sender.url===chrome.runtime.getURL('popup.html');
 const isOptions=sender.url===chrome.runtime.getURL('options.html');
 const work=async()=>{
 await restrictedStorage;
 // The Web page bridge is one protocol, declared once in the contracts. A
 // message announcing its channel is parsed here, before anything else is even
 // considered, so a kind, a field or a library binding the protocol does not
 // have never reaches a handler — and a request that does not parse is refused
 // rather than falling through to be mistaken for an extension-internal message.
 if(message?.channel===sensaBridgeRequestChannel){
  const bridge=sensaBridgeRequestSchema.safeParse(message);
  if(!bridge.success)throw new Error('unsupported_message');
  return serveWebBridge(bridge.data,sender);
 }
 // Language detection is pure local computation on text the caller already has,
 // so it needs no account and no page: the content script sends a sample and
 // gets a code back. It lives here because the detector's tables are far larger
 // than anything a content script should carry into every page.
 if(message.kind==='detect-language'){const text=typeof message.text==='string'?message.text.slice(0,2048):'';return {language:text?detectIso6393(text):null};}
 // What the learner already reads, answered here rather than in the page's
 // context because the pair lives here and only here: the published profile is
 // kept out of reach of content scripts, so a reading surface asks a question
 // about the learner and gets an answer about the learner, not the profile.
 if(message.kind==='reading-language'){
  const pair=await readingLanguageContext();
  const text=typeof message.text==='string'?message.text.trim().slice(0,maxDetectableCharacters):'';
  const observation=text.length>=minSkimmableCharacters?detectIso6393(text):null;
  const detected=observation?sensaLanguageForIso6393(observation.code):undefined;
  const surface=typeof message.surfaceLanguage==='string'?sensaLanguageForDeclaredTag(message.surfaceLanguage):undefined;
  const observedTag=observation?(detected?.tag??observation.code):surface?.tag;
  return {supportLanguageTag:pair.supportLanguageTag,alreadyReadable:observedTag===pair.supportLanguageTag};
 }

 if(['reading-settings','reading-settings-save','reading-test','reading-models','reading-run','youtube-captions'].includes(message.kind)){
   const store=await load(),a=store.active?store.accounts[store.active]:null;
   if(message.kind==='reading-run'||message.kind==='youtube-captions'){
     const mode=(await modes())[sender.tab?.id??-1];
     if(!sender.tab?.id||mode?.accountId!==await activeScope()||message.accountId!==await activeScope())throw new Error('account_mismatch');
     if(await currentPageUrl(sender)!==message.pageUrl)throw new Error('source_mismatch');
   }else if(!isOptions)throw new Error('unsupported_message');
   let result;
   if(message.kind==='youtube-captions'){
     if(typeof message.videoId!=='string'||!/^[a-zA-Z0-9_-]{11}$/u.test(message.videoId))throw new Error('invalid_request');
     result=(await chrome.scripting.executeScript({target:{tabId:sender.tab!.id!},world:'MAIN',func:readYoutubePlayer,args:[message.videoId]}))[0]?.result;
   }else if(message.kind==='reading-settings')result=await localSettings();
   else if(message.kind==='reading-settings-save')result=await saveLocalSettings(message.input);
   else if(message.kind==='reading-test')result=await testLocalModel(z.object({providerId:z.string().uuid()}).parse(message.input).providerId);
   else if(message.kind==='reading-models')result=await localModels(z.object({providerId:z.string().uuid()}).parse(message.input).providerId);
   else{
     const body=await readingInput(message.input),feature=z.enum(['selection','page','subtitles','action','writing']).parse((body as Record<string,unknown>).feature);
     const local=await localConnectionFor(feature);
     if(local)result=await runLocalReading(local,body);
     else if(a)result=await apiRequest('/sensa/reading/run',body,a.token);
     else throw new Error('provider_not_configured');
   }
   if((await activeScope())!==(a?.accountId??await localScope()))throw new Error('account_mismatch');
   return result;
 }
 // The learner's rule for one site, from the page they are reading or from the
 // popup. The site is never taken from the message: it is the hostname of the tab
 // that asked — or of the active tab, when the popup asked — so no page can write
 // a rule about another site. Turning reading off stops it in that tab as well,
 // because a rule that only took effect on the next page load would leave the
 // page the learner is looking at reading as if nothing had happened.
 if(message.kind==='reading-site'){
  if(typeof message.enabled!=='boolean')throw new Error('invalid_request');
  const [active]=await chrome.tabs.query({active:true,currentWindow:true});
  const tab=sender.tab?.id?sender.tab:active;
  const site=readingSiteOf(tab?.url);
  if(!tab?.id||!site)throw new Error('unsupported_page');
  const preferences=await readingPreferences();
  const disabledSites=message.enabled?preferences.disabledSites.filter(value=>value!==site):[...new Set([...preferences.disabledSites,site])].slice(0,100);
  const changed=disabledSites.length!==preferences.disabledSites.length||disabledSites.some((value,index)=>value!==preferences.disabledSites[index]);
  if(changed)await saveReadingPreferences({...preferences,disabledSites});
  if(!message.enabled)await stopReadingIn(tab.id);
  return {site,disabled:!message.enabled,disabledSites:changed?disabledSites:preferences.disabledSites};
 }
 if((isOptions||isPopup)&&message.kind==='service-status'){const store=await load(),a=store.active?store.accounts[store.active]:null;if(!a)throw new Error('authentication_required');const result=await apiRequest('/sensa/service/status',undefined,a.token);if((await load()).active!==a.accountId)throw new Error('account_mismatch');return result;}
 if(isOptions&&message.kind==='status')return status();
 if(['save','accept'].includes(message.kind)&&sender.tab){
  return locked(async()=>{
   const store=await load(),a=store.active?store.accounts[store.active]:null,mode=(await modes())[sender.tab!.id!];
   const scope=await activeScope();
   if(message.accountId!==scope||mode?.accountId!==scope)throw new Error('account_mismatch');
   if(a&&!a.webLibraryId)throw new Error('web_reconnect_required');
   const pageUrl=await currentPageUrl(sender);
   let snapshot=message.snapshot,proposal=null,resolutionProvenance=null;
   if(message.kind==='accept'){
    const cached=(await chrome.storage.session.get('sensaLookups')).sensaLookups as Record<string,any>??{},item=cached[message.lookupId];
    if(!item||item.scope!==scope||item.tabId!==sender.tab!.id||item.pageUrl!==pageUrl)throw new Error('lookup_unavailable');
    snapshot=item.snapshot;proposal=item.proposal;resolutionProvenance=item.resolutionProvenance;
   }
   snapshot=captureSnapshotSchema.parse(snapshot);if(snapshot.source.url!==pageUrl)throw new Error('source_mismatch');
   const queued=a?await queueWeb(a.accountId,{contractVersion:'sensa-browser-intake-delivery-v1',libraryId:a.webLibraryId!,clientId:a.installationId,intake:browserCaptureToIntake(message.operationId,snapshot,proposal,resolutionProvenance)}):await queueLocalCapture(message.operationId,snapshot,proposal,resolutionProvenance);
   await notifyWebIntake(a?.accountId??null);
   return queued;
  });
 }
 if(message.kind==='lookup'&&sender.tab){const snapshot=captureSnapshotSchema.parse(message.snapshot);const readingModes=await modes();const store=await load(),a=store.active?store.accounts[store.active]:null;if(message.accountId!==await activeScope()||readingModes[sender.tab!.id!]?.accountId!==await activeScope())throw new Error('authentication_required');if(snapshot.source.url!==await currentPageUrl(sender))throw new Error('source_mismatch');const languages=await readingLanguageContext(),local=await localConnectionFor('meaning');const result=local?await runLocalLookup(local,message.lookupId,snapshot,languages):a?await apiRequest('/sensa/semantic/lookups',{id:message.lookupId,snapshot,languages},a.token):(()=>{throw new Error('provider_not_configured');})();await rememberLookup(sender,message.lookupId,snapshot,result,message.accountId);return result;}
 if(['open-inbox','save-status'].includes(message.kind)&&sender.tab){
  const store=await load(),a=store.active?store.accounts[store.active]:null,mode=(await modes())[sender.tab.id!];
  const scope=await activeScope();if(message.accountId!==scope||mode?.accountId!==scope)throw new Error('account_mismatch');
  const operationId=z.string().uuid().parse(message.operationId);
  const result=a?await webOperationStatus(a.accountId,operationId):await localOperationStatus(operationId);
  if(message.kind==='open-inbox')await openWebPath('/content?worldAction=inbox');
  return result;
 }
 if(!isPopup)throw new Error('unsupported_message');
 if(message.kind==='queue-recovery-export')return exportWebQueueRecovery();
 if(message.kind==='queue-recovery-discard')await discardWebQueueRecovery();
 if(message.kind==='status'){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const readingModes=await modes();if(tab?.id&&readingModes[tab.id]?.accountId===await activeScope()){try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});await chrome.tabs.sendMessage(tab.id,{kind:'reading',enabled:true,accountId:readingModes[tab.id].accountId,preferences:await readingPreferences()});await chrome.action.setBadgeText({tabId:tab.id,text:''});}catch{/* Preserve intent until the user grants this page. */}}}
 if(message.kind==='select-language-route'){
  if(typeof message.routeId!=='string')throw new Error('unknown_language_route');
  await selectReadingLanguageRoute(message.routeId);
 }
 if(message.kind==='login'){
  await loginThroughWeb();
 }
 if(message.kind==='open-web')await openWebPath(webContentPath(message.path));
 if(message.kind==='disconnect')await locked(async()=>{const store=await load();store.active=null;await chrome.storage.local.set({sensaAutoConnectPaused:true});await chrome.storage.session.set({sensaWebConnect:null});await persist(store);await stopAllReading();});
 if(message.kind==='toggle'){
  const scope=await activeScope();
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab.id||!tab.url||!/^https?:/u.test(tab.url))throw new Error('unsupported_page');
  // A rule the learner wrote is not a suggestion the toolbar can override: the
  // popup offers to lift it instead, so pressing this button either reads the
  // page or says why it will not.
  const site=readingSiteOf(tab.url);
  if(site&&(await readingPreferences()).disabledSites.includes(site))throw new Error('site_disabled');const readingModes=await modes();readingModes[tab.id]={accountId:scope};await chrome.storage.session.set({modes:readingModes});await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});await chrome.tabs.sendMessage(tab.id,{kind:'reading',enabled:true,accountId:scope,preferences:await readingPreferences()});}
 if(message.kind==='stop'){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(tab.id)await stopReadingIn(tab.id);}
 return status();};void work().then(value=>respond({value}),error=>respond({error:errorCode(error)}));return true;
});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status!=='complete')return;void (async()=>{const readingModes=await modes();if(!readingModes[id]||readingModes[id].accountId!==await activeScope())return;
 // A site the learner turned reading off for is not injected into at all: the
 // content script would refuse to start, and reaching it every page load is work
 // for an answer that never changes.
 const rule=readingSiteOf(change.url??'');if(rule&&(await readingPreferences()).disabledSites.includes(rule))return;try{await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']});await chrome.tabs.sendMessage(id,{kind:'reading',enabled:true,accountId:readingModes[id].accountId,preferences:await readingPreferences()});await chrome.action.setBadgeText({tabId:id,text:''});}catch{await chrome.action.setBadgeText({tabId:id,text:t('backgroundContinue')});await chrome.action.setTitle({tabId:id,title:t('backgroundContinueHint')});}})().catch(()=>undefined);});
chrome.tabs.onRemoved.addListener(id=>{void locked(async()=>{const readingModes=await modes();delete readingModes[id];await chrome.storage.session.set({modes:readingModes});}).catch(()=>undefined);});
// Credentials stay in this trusted background; pages receive only bounded text/result frames.
chrome.runtime.onConnect?.addListener(port=>{
 if(!['sensa-reading-stream','sensa-lookup-stream'].includes(port.name))return;
 const meaning=port.name==='sensa-lookup-stream';
 const sender=port.sender;let started=false,closed=false;
 const controller=new AbortController();
 port.onDisconnect.addListener(()=>{closed=true;controller.abort();});
 port.onMessage.addListener(message=>{
  if(started)return;started=true;
  void(async()=>{
   await restrictedStorage;
   if(sender?.id!==chrome.runtime.id||!sender.tab?.id)throw new Error('authentication_required');
   if(await currentPageUrl(sender)!==message.pageUrl)throw new Error('source_mismatch');
   const store=await load(),a=store.active?store.accounts[store.active]:null;
   async function authorize(){const current=await load(),mode=(await modes())[sender!.tab!.id!];if(a&&(current.active!==a.accountId||current.accounts[a.accountId]?.token!==a.token)||mode?.accountId!==await activeScope()||message.accountId!==await activeScope())throw new Error('account_mismatch');}
   await authorize();
   if(meaning&&captureSnapshotSchema.parse(message.input?.snapshot).source.url!==message.pageUrl)throw new Error('source_mismatch');
   // A lookup stream carries a capture; a reading stream is a reading request and
   // is completed here, the same way the plain path completes one.
   const body=meaning?{...message.input,languages:await readingLanguageContext()}:await readingInput(message.input);
   const local=await localConnectionFor(meaning?'meaning':z.enum(['selection','page','subtitles','action','writing']).parse(body.feature));
   if(local){
    if(meaning){const result=await runLocalLookup(local,message.input.id,message.input.snapshot,body.languages,controller.signal);await authorize();await rememberLookup(sender!,message.input.id,message.input.snapshot,result,message.accountId);port.postMessage({type:'result',value:result});}
    else{const result=await runLocalReading(local,body,controller.signal);await authorize();port.postMessage({type:'result',value:result});}
    return;
   }
   if(!a)throw new Error('provider_not_configured');
   const response=await serviceFetch(apiUrl+(meaning?'/sensa/semantic/lookups/stream':'/sensa/reading/stream'),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+a.token},body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])});
   if(!response.ok){const data=await response.json();throw new Error(data.code??'provider_unavailable');}
   if(!response.body)throw new Error('provider_invalid_response');
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,finished=false;
   try{while(!closed){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>4000000)throw new Error('provider_invalid_response');buffer+=decoder.decode(next.value,{stream:true});let index;
    while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;const frame=JSON.parse(line);await authorize();if(closed)return;
     if(frame.type==='partial'&&(typeof frame.text!=='string'||frame.text.length>24000))throw new Error('provider_invalid_response');
     if(!['partial','result','error'].includes(frame.type))throw new Error('provider_invalid_response');
     if(meaning&&frame.type==='result')await rememberLookup(sender!,message.input.id,message.input.snapshot,frame.value,message.accountId);
     port.postMessage(frame);if(frame.type!=='partial'){finished=true;return;}
    }
   }if(!finished&&!closed)throw new Error('reading_interrupted');}finally{await reader.cancel().catch(()=>undefined);}
  })().catch(error=>{if(!closed)port.postMessage({type:'error',error:errorCode(error)});});
 });
});

async function rememberLookup(sender:chrome.runtime.MessageSender,id:string,snapshot:unknown,result:any,scope:string){
 if(result?.status!=='ready'||!result.proposal)return;
 if(await activeScope()!==scope)throw new Error('account_mismatch');
 const store:Record<string,any>=(await chrome.storage.session.get('sensaLookups')).sensaLookups as Record<string,any>??{};
 const parsed=captureSnapshotSchema.parse(snapshot);
 if(!result.provenance)throw new Error('invalid_proposal');
 store[id]={scope,tabId:sender.tab?.id,pageUrl:parsed.source.url,snapshot:parsed,proposal:result.proposal,resolutionProvenance:{resolverKind:'language_model',provider:result.provenance.provider,model:result.provenance.model,policyVersion:result.provenance.policyVersion,sourceReferenceIds:[id,result.provenance.inputDigest,result.provenance.outputDigest]}};
 const keys=Object.keys(store);for(const key of keys.slice(0,Math.max(0,keys.length-100)))delete store[key];
 await chrome.storage.session.set({sensaLookups:store});
}
