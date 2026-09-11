import {deliveryConfigSchema} from '@sensa/intake-transport';
import {queueWeb,pendingWeb,acknowledgeWeb,webStatus,flushWebDelivery} from './webDestination';
declare const SENSA_EXTENSION_LEGACY_WEB:boolean;
import {nativeEnabled,nativeScope,discoverNative,selectNative,selectWeb,queueNative,flushNative,nativeStatus} from './nativeDestination';
import {z} from 'zod';
import {canonicalConsumerJson,captureSnapshotSchema,intakeOperationSchema,semanticAcceptOperationSchema,intakeViewSchema,personalMeaningViewSchema} from '@sensa/contracts/sensa';
import type {IntakeOperation,IntakeView,SemanticAcceptOperation,PersonalMeaningView} from '@sensa/contracts/sensa';
import {webUrl,apiUrl} from './config';
import {readYoutubePlayer} from './youtubePlayer';
import {readingPreferences} from './preferences';
type Queue={wireVersion:'sensa-sync-v3';epoch:string;operation:IntakeOperation|SemanticAcceptOperation;error?:string};
type Account={expiresAt?:string;webLibraryId?:string;accountId:string;installationId:string;token:string;replicaId?:string;epoch?:string;queue:Queue[];recent:(IntakeView|PersonalMeaningView)[];savedOperations:Record<string,IntakeOperation|SemanticAcceptOperation>};
type Store={version:1;active:string|null;accounts:Record<string,Account>};
type Mode={accountId:string};
const operationSchema=z.union([intakeOperationSchema,semanticAcceptOperationSchema]);
const accountSchema=z.object({expiresAt:z.string().datetime().optional(),webLibraryId:z.string().uuid().optional(),accountId:z.string().uuid(),installationId:z.string().uuid(),token:z.string().min(1),replicaId:z.string().uuid().optional(),epoch:z.string().regex(/^[1-9][0-9]*$/u).optional(),queue:z.array(z.object({wireVersion:z.literal('sensa-sync-v3'),epoch:z.string(),operation:operationSchema,error:z.string().optional()}).strict()),recent:z.array(z.union([intakeViewSchema,personalMeaningViewSchema])),savedOperations:z.record(z.string(),operationSchema)}).strict();
const storeSchema=z.object({version:z.literal(1).default(1),active:z.string().uuid().nullable(),accounts:z.record(z.string(),accountSchema)}).strict();
let serial:Promise<unknown>=Promise.resolve();
function locked<T>(work:()=>Promise<T>):Promise<T>{const next=serial.catch(()=>undefined).then(work);serial=next;return next;}
async function load():Promise<Store>{
 const raw=(await chrome.storage.local.get('sensa')).sensa;if(!raw)return {version:1,active:null,accounts:{}};
 const parsed=storeSchema.safeParse(raw);if(!parsed.success)throw new Error('client_update_required');
 const store=parsed.data;if(store.active&&!store.accounts[store.active])throw new Error('client_update_required');
 for(const [key,a] of Object.entries(store.accounts)){if(key!==a.accountId||a.queue.some(q=>q.operation.installationId!==a.installationId||q.operation.replicaId!==a.replicaId)||Object.entries(a.savedOperations).some(([id,op])=>id!==op.operationId||op.installationId!==a.installationId||op.replicaId!==a.replicaId))throw new Error('client_update_required');}
 return store;
}
async function modes():Promise<Record<number,Mode>>{const raw=(await chrome.storage.session.get('modes')).modes??{};return Object.fromEntries(Object.entries(raw).filter((entry):entry is [string,Mode]=>typeof entry[1]==='object'&&entry[1]!==null&&typeof (entry[1] as Mode).accountId==='string'));}
async function stopAllReading(){const active=(await chrome.storage.session.get('modes')).modes??{};await chrome.storage.session.set({modes:{}});await Promise.all(Object.keys(active).map(id=>chrome.tabs.sendMessage(Number(id),{kind:'reading',enabled:false}).catch(()=>undefined)));}
function queueOperation(a:Account,operation:IntakeOperation|SemanticAcceptOperation){if(!a.epoch||!a.replicaId)throw new Error('client_update_required');const previous=a.savedOperations[operation.operationId];if(previous){if(previous.kind!==operation.kind||canonicalConsumerJson(previous.payload)!==canonicalConsumerJson(operation.payload))throw new Error('operation_id_reuse');return;}a.savedOperations[operation.operationId]=operation;a.queue.push({wireVersion:'sensa-sync-v3',epoch:a.epoch,operation});}

async function persist(store:Store){await chrome.storage.local.set({sensa:store});}
async function serviceFetch(url:string,init:RequestInit){try{return await fetch(url,init);}catch(error){throw new Error(error instanceof Error&&['AbortError','TimeoutError'].includes(error.name)?'TimeoutError':'network_failed');}}
async function request(path:string,body:unknown,token?:string){const response=await serviceFetch(apiUrl+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const data=await response.json();if(!response.ok)throw new Error(data.code??'temporarily_unavailable');return data;}
async function sync(){return locked(async()=>{const store=await load(),a=store.active?store.accounts[store.active]:null;if(!a)return;
 for(const item of [...a.queue]){if(item.error)continue;if(item.wireVersion!=='sensa-sync-v3'){item.error='client_update_required';await persist(store);continue;}
 try{const result=await request('/sensa/sync/push',{wireVersion:item.wireVersion,canonicalizerVersion:'sensa-sync-v3-canonical-1',scopeEpoch:item.epoch,replicaId:a.replicaId,operations:[item.operation]},a.token);const r=result.results?.[0];if(r?.operationId!==item.operation.operationId)throw new Error('unknown_result');
 if(r.status==='accepted'||r.status==='replayed'&&r.original==='accepted'){const saved=r.value?.meaning?personalMeaningViewSchema.parse(r.value.meaning):intakeViewSchema.parse(r.value?.intake);a.queue=a.queue.filter(x=>x.operation.operationId!==item.operation.operationId);a.recent=[saved,...a.recent.filter(x=>x.id!==saved.id)].slice(0,20);}else if(r.status!=='retryable')item.error=r.error?.code??'rejected';await persist(store);
 }catch(error){if(error instanceof Error&&['access_revoked','invite_required','bootstrap_required'].includes(error.message)){item.error=error.message;await persist(store);}break;}}
 });}
async function login(existingInstallation?:string,expectedAccount?:string){
 const verifier=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),state=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 const installationId=existingInstallation??crypto.randomUUID();
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))),challenge=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
 const redirectUri=chrome.identity.getRedirectURL('sensa'),url=new URL(webUrl);url.search=new URLSearchParams({extension:'connect',installationId,state,challenge,redirectUri}).toString();
 const callback=await chrome.identity.launchWebAuthFlow({url:url.href,interactive:true});if(!callback)throw new Error('authorization_cancelled');const result=new URL(callback);
 if(result.origin+result.pathname!==redirectUri||result.searchParams.get('state')!==state)throw new Error('authorization_invalid');
 const webLibraryId=SENSA_EXTENSION_LEGACY_WEB?undefined:z.string().uuid().parse(result.searchParams.get('libraryId'));
 const credential=z.object({token:z.string().min(1),accountId:z.string().uuid(),expiresAt:z.string().datetime()}).parse(await request('/sensa/extension/exchange',{code:result.searchParams.get('code'),installationId,state,verifier}));
 if(expectedAccount&&credential.accountId!==expectedAccount)throw new Error('account_mismatch');
 const previous=(await load()).accounts[credential.accountId];
 if(previous&&previous.installationId!==installationId)return login(previous.installationId,credential.accountId);
 await locked(async()=>{const store=await load();const old=store.accounts[credential.accountId];
 if(!SENSA_EXTENSION_LEGACY_WEB){
  store.accounts[credential.accountId]={...old,accountId:credential.accountId,installationId,webLibraryId,token:credential.token,expiresAt:credential.expiresAt,queue:old?.queue??[],recent:old?.recent??[],savedOperations:old?.savedOperations??{}};
  store.active=credential.accountId;await persist(store);await stopAllReading();return;
 }
 const session=await request('/sensa/account/session',{installationId,platform:'extension',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone},credential.token);
 const boot=await request('/sensa/sync/bootstrap',{wireVersion:'sensa-sync-v3',installationId,replicaId:null},credential.token);
 store.accounts[session.data.accountId]={webLibraryId,accountId:session.data.accountId,installationId,token:credential.token,replicaId:boot.replicaId,epoch:boot.scopeEpoch,queue:old?.queue??[],recent:old?.recent??[],savedOperations:old?.savedOperations??{}};
 for(const item of store.accounts[session.data.accountId].queue)if(item.error==='access_revoked'&&item.epoch===boot.scopeEpoch)delete item.error;store.active=session.data.accountId;await persist(store);await stopAllReading();});
}
// A short-lived, tab-bound PKCE request. The Web never receives the verifier or
// extension credential; its existing session only authorizes a one-time code.
async function webConnect(message:any,sender:chrome.runtime.MessageSender){
 if(SENSA_EXTENSION_LEGACY_WEB||!sender.tab?.id||!sender.url||new URL(sender.url).origin!==new URL(webUrl).origin)throw new Error('unsupported_message');
 return locked(async()=>{
  const store=await load(),accountId=z.string().uuid().parse(message.accountId),libraryId=z.string().uuid().parse(message.libraryId);
  if((await chrome.storage.local.get('sensaAutoConnectPaused')).sensaAutoConnectPaused)return {paused:true};
  const old=store.accounts[accountId];
  if(store.active&&store.active!==accountId)throw new Error('account_mismatch');
  if(old?.webLibraryId&&old.webLibraryId!==libraryId)throw new Error('library_mismatch');
  if(message.kind==='web-connect-prepare'){
   const inflight=(await chrome.storage.session.get('sensaWebConnect')).sensaWebConnect as {expires?:number}|null;
   if(inflight?.expires&&inflight.expires>Date.now())return {paused:true};
   if(store.active===accountId&&old?.expiresAt&&Date.parse(old.expiresAt)>Date.now()+3600000)return {connected:true};
   const installationId=old?.installationId??crypto.randomUUID();
   const verifier=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
   const state=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
   const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
   const challenge=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
   const redirectUri=chrome.identity.getRedirectURL('sensa');
   await chrome.storage.session.set({sensaWebConnect:{tabId:sender.tab!.id,accountId,libraryId,installationId,verifier,state,redirectUri,expires:Date.now()+120000}});
   return {authorization:{installationId,state,challenge,redirectUri}};
  }
  const pending=z.object({tabId:z.number(),accountId:z.string().uuid(),libraryId:z.string().uuid(),installationId:z.string().uuid(),verifier:z.string(),state:z.string(),redirectUri:z.string().url(),expires:z.number()}).nullable().parse((await chrome.storage.session.get('sensaWebConnect')).sensaWebConnect??null);
  if(!pending||pending.tabId!==sender.tab!.id||pending.accountId!==accountId||pending.libraryId!==libraryId||pending.expires<Date.now())throw new Error('authorization_expired');
  const destination=new URL(z.string().url().parse(message.receipt?.redirectUri));
  if(destination.origin+destination.pathname!==pending.redirectUri||destination.searchParams.get('state')!==pending.state)throw new Error('authorization_invalid');
  await chrome.storage.session.set({sensaWebConnect:null});
  const credential=z.object({token:z.string().min(1),accountId:z.string().uuid(),expiresAt:z.string().datetime()}).parse(await request('/sensa/extension/exchange',{code:destination.searchParams.get('code'),installationId:pending.installationId,state:pending.state,verifier:pending.verifier}));
  if(credential.accountId!==accountId)throw new Error('account_mismatch');
  store.accounts[accountId]={...old,accountId,installationId:pending.installationId,webLibraryId:libraryId,token:credential.token,expiresAt:credential.expiresAt,queue:old?.queue??[],recent:old?.recent??[],savedOperations:old?.savedOperations??{}};
  const changed=store.active!==accountId;store.active=accountId;await persist(store);if(changed)await stopAllReading();
  return {connected:true};
 });
}
async function deliverWeb(){const store=await load(),a=store.active?store.accounts[store.active]:null;if(a)await flushWebDelivery(a.accountId,async envelope=>{if((await load()).active!==a.accountId)throw new Error('account_mismatch');return request('/sensa/intake-delivery/push',envelope,a.token);});}
async function activeScope(){return await nativeEnabled()?nativeScope():(await load()).active;}
async function status(){if(await nativeEnabled())return nativeStatus();const store=await load(),a=store.active?store.accounts[store.active]:null;if(a&&!SENSA_EXTENSION_LEGACY_WEB){const current=await webStatus(a.accountId);return {accountId:a.accountId,destination:'web-local',...current,legacyPending:a.queue.length};}return {accountId:a?.accountId??null,pending:a?.queue.length??0,errors:a?.queue.filter(x=>x.error).map(x=>x.error)??[],recent:a?.recent??[]};}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id)return;
 const isPopup=sender.url===chrome.runtime.getURL('popup.html');
 const isOptions=sender.url===chrome.runtime.getURL('options.html');
 const work=async()=>{
 if(message.kind==='web-session-ended'){if(!sender.url||new URL(sender.url).origin!==new URL(webUrl).origin||!sender.tab)throw new Error('unsupported_message');return locked(async()=>{const store=await load();if(!store.active||store.active!==message.accountId)return {disconnected:false};const a=store.accounts[store.active];a.token='disconnected';a.expiresAt=new Date(0).toISOString();store.active=null;await persist(store);await chrome.storage.session.set({sensaWebConnect:null});await stopAllReading();return {disconnected:true};});}
 if(['web-connect-prepare','web-connect-complete'].includes(message.kind))return webConnect(message,sender);
 if(['web-intake-pull','web-intake-ack','web-delivery-config'].includes(message.kind)){
  if(!sender.url||new URL(sender.url).origin!==new URL(webUrl).origin||!sender.tab)throw new Error('unsupported_message');
  const store=await load(),a=store.active?store.accounts[store.active]:null;
  if(!a)throw new Error('authentication_required');
  if(message.accountId!==a.accountId)throw new Error('account_mismatch');
  const libraryId=z.string().uuid().parse(message.libraryId);
  if(message.kind==='web-delivery-config'){if(a.webLibraryId!==libraryId)throw new Error('library_mismatch');const config=message.receipt===null?null:deliveryConfigSchema.parse(message.receipt);if(config&&(config.accountId!==a.accountId||config.libraryId!==libraryId))throw new Error('account_mismatch');await chrome.storage.local.set({['sensaDelivery:'+a.accountId+':'+libraryId]:config});return {configured:true};}
  if(message.kind==='web-intake-ack'){if(message.receipt?.libraryId!==libraryId)throw new Error('library_mismatch');return acknowledgeWeb(a.accountId,message.receipt);}
  return pendingWeb(a.accountId,libraryId);
 }

 if(isPopup&&message.kind==='native-discover')return discoverNative();
 if(isPopup&&message.kind==='native-select'){await selectNative(message.connection);await stopAllReading();return status();}
 if(isPopup&&message.kind==='web-select'){await selectWeb();await stopAllReading();return status();}

 if(['reading-settings','reading-settings-save','reading-test','reading-models','reading-run','youtube-captions'].includes(message.kind)){
   const store=await load(),a=store.active?store.accounts[store.active]:null;
   if(!a&&message.kind!=='youtube-captions')throw new Error('authentication_required');
   if(message.kind==='reading-run'||message.kind==='youtube-captions'){
     const mode=(await modes())[sender.tab?.id??-1];
     if(!sender.tab?.id||mode?.accountId!==await activeScope()||message.accountId!==await activeScope()||sender.url!==message.pageUrl)throw new Error('account_mismatch');
   }else if(!isOptions||message.accountId&&message.accountId!==a!.accountId)throw new Error('unsupported_message');
   let result;
   if(message.kind==='youtube-captions'){
     if(typeof message.videoId!=='string'||!/^[a-zA-Z0-9_-]{11}$/u.test(message.videoId))throw new Error('invalid_request');
     result=(await chrome.scripting.executeScript({target:{tabId:sender.tab!.id!},world:'MAIN',func:readYoutubePlayer,args:[message.videoId]}))[0]?.result;
   }else{
     const path=message.kind==='reading-run'?'run':message.kind==='reading-test'?'test':message.kind==='reading-models'?'models':'settings';
     result=await request('/sensa/reading/'+path,message.kind==='reading-settings'?undefined:message.input,a!.token);
   }
   if(a&&(await load()).active!==a.accountId)throw new Error('account_mismatch');
   return message.kind==='reading-settings'?{...result,accountId:a!.accountId}:result;
 }
 if((isOptions||isPopup)&&message.kind==='service-status'){const store=await load(),a=store.active?store.accounts[store.active]:null;if(!a)throw new Error('authentication_required');const result=await request('/sensa/service/status',undefined,a.token);if((await load()).active!==a.accountId)throw new Error('account_mismatch');return result;}
 if(isOptions&&message.kind==='status')return status();
 if(await nativeEnabled()&&['save','accept'].includes(message.kind)&&sender.tab){
   const scope=await activeScope(),mode=(await modes())[sender.tab.id!];if(!scope||message.accountId!==scope||mode?.accountId!==scope)throw new Error('account_mismatch');
   let snapshot=message.snapshot,resolution=null;
   if(message.kind==='accept'){const cached:Record<string,any>=(await chrome.storage.session.get('nativeLookups')).nativeLookups as Record<string,any>??{};const item=cached[message.lookupId];if(!item||item.scope!==scope||item.tabId!==sender.tab.id||item.pageUrl!==sender.url)throw new Error('lookup_unavailable');snapshot=item.snapshot;resolution={kind:'proposal' as const,proposal:item.proposal};}
   snapshot=captureSnapshotSchema.parse(snapshot);if(snapshot.source.url!==sender.url)throw new Error('source_mismatch');
   return queueNative({operationId:message.operationId,snapshot,resolution,acceptance:message.kind==='accept'?{kind:'direct',consent:'accept_context_expression_sense',authorization:'browser:explicit_accept_button'}:null},scope);
 }
 if(!SENSA_EXTENSION_LEGACY_WEB&&!await nativeEnabled()&&['save','accept'].includes(message.kind)&&sender.tab){
  return locked(async()=>{
   const store=await load(),a=store.active?store.accounts[store.active]:null,mode=(await modes())[sender.tab!.id!];
   if(!a||a.accountId!==message.accountId||mode?.accountId!==a.accountId)throw new Error('account_mismatch');
   if(!a.webLibraryId)throw new Error('web_reconnect_required');
   let snapshot=message.snapshot,resolution=null;
   if(message.kind==='accept'){
    const cached=(await chrome.storage.session.get('nativeLookups')).nativeLookups as Record<string,any>??{},item=cached[message.lookupId];
    if(!item||item.scope!==a.accountId||item.tabId!==sender.tab!.id||item.pageUrl!==sender.url)throw new Error('lookup_unavailable');
    snapshot=item.snapshot;resolution={kind:'proposal' as const,proposal:item.proposal};
   }
   snapshot=captureSnapshotSchema.parse(snapshot);if(snapshot.source.url!==sender.url)throw new Error('source_mismatch');
   const queued=await queueWeb(a.accountId,{version:'sensa-intake-v1',libraryId:a.webLibraryId,clientId:a.installationId,operationId:message.operationId,snapshot,resolution,acceptance:message.kind==='accept'?{kind:'direct',consent:'accept_context_expression_sense',authorization:'browser:explicit_accept_button'}:null});
   void deliverWeb().catch(()=>undefined);return queued;
  });
 }
 if(message.kind==='lookup'&&sender.tab){const snapshot=captureSnapshotSchema.parse(message.snapshot);const readingModes=await modes();const store=await load(),a=store.active?store.accounts[store.active]:null;if(!a||message.accountId!==await activeScope()||readingModes[sender.tab!.id!]?.accountId!==await activeScope()||snapshot.source.url!==sender.url)throw new Error('authentication_required');const result=await request('/sensa/semantic/lookups',{id:message.lookupId,snapshot},a.token);await rememberLookup(sender,message.lookupId,snapshot,result,message.accountId);return result;}
 if(message.kind==='accept'&&sender.tab){const readingModes=await modes();if(!readingModes[sender.tab!.id!])throw new Error('reading_mode_off');await locked(async()=>{const store=await load(),a=store.active?store.accounts[store.active]:null;if(!a||message.accountId!==a.accountId||readingModes[sender.tab!.id!]?.accountId!==a.accountId)throw new Error('account_mismatch');const operation=semanticAcceptOperationSchema.parse({operationId:message.operationId,occurredAt:new Date().toISOString(),installationId:a.installationId,replicaId:a.replicaId,dependsOn:[],kind:'semantic.accept',payload:{lookupId:message.lookupId,expectedRevision:'1',intakeId:null,consent:'accept_context_expression_sense'}});queueOperation(a,operation);await persist(store);});void sync().catch(()=>undefined);return {savedLocally:true};}
 if(message.kind==='save'&&sender.tab){const readingModes=await modes();if(!readingModes[sender.tab!.id!])throw new Error('reading_mode_off');const snapshot=captureSnapshotSchema.parse(message.snapshot);if(!sender.url||snapshot.source.url!==sender.url)throw new Error('source_mismatch');await locked(async()=>{const store=await load(),a=store.active?store.accounts[store.active]:null;if(!a||message.accountId!==a.accountId||readingModes[sender.tab!.id!]?.accountId!==a.accountId)throw new Error('account_mismatch');const operation=intakeOperationSchema.parse({operationId:message.operationId,occurredAt:new Date().toISOString(),installationId:a.installationId,replicaId:a.replicaId,dependsOn:[],kind:'intake.save',payload:{snapshot}});queueOperation(a,operation);await persist(store);});void sync().catch(()=>undefined);return {savedLocally:true};}
 if(!isPopup)throw new Error('unsupported_message');
 if(message.kind==='status'){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const readingModes=await modes();if(tab?.id&&readingModes[tab.id]?.accountId===await activeScope()){try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});await chrome.tabs.sendMessage(tab.id,{kind:'reading',enabled:true,accountId:readingModes[tab.id].accountId,preferences:await readingPreferences()});await chrome.action.setBadgeText({tabId:tab.id,text:''});}catch{/* Preserve intent until the user grants this page. */}}}
 if(message.kind==='login'){await chrome.storage.local.set({sensaAutoConnectPaused:false});if(SENSA_EXTENSION_LEGACY_WEB)await login();else await chrome.tabs.create({url:new URL('/profile',webUrl).href});}
 if(message.kind==='sync'){await deliverWeb();if(await nativeEnabled())await flushNative();else await sync();}
 if(message.kind==='disconnect')await locked(async()=>{const store=await load();store.active=null;await chrome.storage.local.set({sensaAutoConnectPaused:true});await chrome.storage.session.set({sensaWebConnect:null});await persist(store);await stopAllReading();});
 if(message.kind==='toggle'){const scope=await activeScope();if(!scope)throw new Error('authentication_required');const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab.id||!tab.url||!/^https?:/u.test(tab.url))throw new Error('unsupported_page');const readingModes=await modes();readingModes[tab.id]={accountId:scope};await chrome.storage.session.set({modes:readingModes});await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});await chrome.tabs.sendMessage(tab.id,{kind:'reading',enabled:true,accountId:scope,preferences:await readingPreferences()});}
 if(message.kind==='stop'){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(tab.id){const readingModes=await modes();delete readingModes[tab.id];await chrome.storage.session.set({modes:readingModes});await chrome.tabs.sendMessage(tab.id,{kind:'reading',enabled:false}).catch(()=>undefined);}}
 return status();};void work().then(value=>respond({value}),error=>respond({error:error instanceof Error?error.message:'failed'}));return true;
});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status!=='complete')return;void (async()=>{const readingModes=await modes();if(!readingModes[id]||readingModes[id].accountId!==await activeScope())return;try{await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']});await chrome.tabs.sendMessage(id,{kind:'reading',enabled:true,accountId:readingModes[id].accountId,preferences:await readingPreferences()});await chrome.action.setBadgeText({tabId:id,text:''});}catch{await chrome.action.setBadgeText({tabId:id,text:'继续'});await chrome.action.setTitle({tabId:id,title:'点一次 Sensa 图标，继续当前网站的阅读模式'});}})().catch(()=>undefined);});
chrome.tabs.onRemoved.addListener(id=>{void locked(async()=>{const readingModes=await modes();delete readingModes[id];await chrome.storage.session.set({modes:readingModes});}).catch(()=>undefined);});
chrome.alarms.create('sync',{periodInMinutes:1});chrome.alarms.onAlarm.addListener(()=>{void sync().catch(()=>undefined);void deliverWeb().catch(()=>undefined);void flushNative().catch(()=>undefined);});
void chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});

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
   if(sender?.id!==chrome.runtime.id||!sender.tab?.id||sender.url!==message.pageUrl)throw new Error('authentication_required');
   const store=await load(),a=store.active?store.accounts[store.active]:null;
   async function authorize(){const current=await load(),mode=(await modes())[sender!.tab!.id!];if(!a||current.active!==a.accountId||current.accounts[a.accountId]?.token!==a.token||mode?.accountId!==await activeScope()||message.accountId!==await activeScope())throw new Error('account_mismatch');}
   await authorize();
   if(meaning&&captureSnapshotSchema.parse(message.input?.snapshot).source.url!==sender.url)throw new Error('source_mismatch');
   const response=await serviceFetch(apiUrl+(meaning?'/sensa/semantic/lookups/stream':'/sensa/reading/stream'),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+a!.token},body:JSON.stringify(message.input),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])});
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
  })().catch(error=>{if(!closed)port.postMessage({type:'error',error:error instanceof Error?error.message:'provider_unavailable'});});
 });
});

async function rememberLookup(sender:chrome.runtime.MessageSender,id:string,snapshot:unknown,result:any,scope:string){
 if(result?.status!=='ready'||!result.proposal)return;
 if(await activeScope()!==scope)throw new Error('account_mismatch');
 const store:Record<string,any>=(await chrome.storage.session.get('nativeLookups')).nativeLookups as Record<string,any>??{};
 store[id]={scope,tabId:sender.tab?.id,pageUrl:sender.url,snapshot:captureSnapshotSchema.parse(snapshot),proposal:result.proposal};
 const keys=Object.keys(store);for(const key of keys.slice(0,Math.max(0,keys.length-100)))delete store[key];
 await chrome.storage.session.set({nativeLookups:store});
}
