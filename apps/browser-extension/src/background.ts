import {captureSnapshotSchema,intakeOperationSchema,semanticAcceptOperationSchema} from '@sensa/contracts/sensa';
import type {IntakeOperation,IntakeView,SemanticAcceptOperation,PersonalMeaningView} from '@sensa/contracts/sensa';
import {webUrl,apiUrl} from './config';
type Queue={wireVersion:'sensa-sync-v3';epoch:string;operation:IntakeOperation|SemanticAcceptOperation;error?:string};
type Account={accountId:string;installationId:string;token:string;replicaId:string;epoch:string;queue:Queue[];recent:(IntakeView|PersonalMeaningView)[];savedOperations:Record<string,IntakeOperation|SemanticAcceptOperation>};
type Store={active:string|null;accounts:Record<string,Account>};
let serial:Promise<unknown>=Promise.resolve();
function locked<T>(work:()=>Promise<T>):Promise<T>{const next=serial.catch(()=>undefined).then(work);serial=next;return next;}
async function load():Promise<Store>{return (await chrome.storage.local.get('sensa')).sensa as Store|undefined??{active:null,accounts:{}};}
async function persist(store:Store){await chrome.storage.local.set({sensa:store});}
async function request(path:string,body:unknown,token?:string){const response=await fetch(apiUrl+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(data.code??'temporarily_unavailable');return data;}
async function sync(){return locked(async()=>{const store=await load(),a=store.active?store.accounts[store.active]:null;if(!a)return;
 for(const item of [...a.queue]){if(item.error)continue;if(item.wireVersion!=='sensa-sync-v3'){item.error='client_update_required';await persist(store);continue;}
 try{const result=await request('/sensa/sync/push',{wireVersion:item.wireVersion,canonicalizerVersion:'sensa-sync-v3-canonical-1',scopeEpoch:item.epoch,replicaId:a.replicaId,operations:[item.operation]},a.token);const r=result.results?.[0];if(r?.operationId!==item.operation.operationId)throw new Error('unknown_result');
 if(r.status==='accepted'||r.status==='replayed'&&r.original==='accepted'){a.queue=a.queue.filter(x=>x.operation.operationId!==item.operation.operationId);const saved=r.value?.meaning??r.value?.intake;if(saved)a.recent=[saved,...a.recent.filter(x=>x.id!==saved.id)].slice(0,20);}else if(r.status!=='retryable')item.error=r.error?.code??'rejected';await persist(store);
 }catch(error){if(error instanceof Error&&['access_revoked','invite_required','bootstrap_required'].includes(error.message)){item.error=error.message;await persist(store);}break;}}
 });}
async function login(existingInstallation?:string,expectedAccount?:string){
 const verifier=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),state=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 const installationId=existingInstallation??crypto.randomUUID();
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))),challenge=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
 const redirectUri=chrome.identity.getRedirectURL('sensa'),url=new URL(webUrl);url.search=new URLSearchParams({extension:'connect',installationId,state,challenge,redirectUri}).toString();
 const callback=await chrome.identity.launchWebAuthFlow({url:url.href,interactive:true});if(!callback)throw new Error('authorization_cancelled');const result=new URL(callback);
 if(result.origin+result.pathname!==redirectUri||result.searchParams.get('state')!==state)throw new Error('authorization_invalid');
 const credential=await request('/sensa/extension/exchange',{code:result.searchParams.get('code'),installationId,state,verifier});
 if(expectedAccount&&credential.accountId!==expectedAccount)throw new Error('account_mismatch');
 const previous=(await load()).accounts[credential.accountId];
 if(previous&&previous.installationId!==installationId)return login(previous.installationId,credential.accountId);
 await locked(async()=>{const store=await load();const old=store.accounts[credential.accountId];
 const session=await request('/sensa/account/session',{installationId,platform:'extension',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone},credential.token);
 const boot=await request('/sensa/sync/bootstrap',{wireVersion:'sensa-sync-v3',installationId,replicaId:null},credential.token);
 store.accounts[session.data.accountId]={accountId:session.data.accountId,installationId,token:credential.token,replicaId:boot.replicaId,epoch:boot.scopeEpoch,queue:old?.queue??[],recent:old?.recent??[],savedOperations:old?.savedOperations??{}};
 for(const item of store.accounts[session.data.accountId].queue)if(item.error==='access_revoked'&&item.epoch===boot.scopeEpoch)delete item.error;store.active=session.data.accountId;await persist(store);});
}
async function status(){const store=await load(),a=store.active?store.accounts[store.active]:null;return {accountId:a?.accountId??null,pending:a?.queue.length??0,errors:a?.queue.filter(x=>x.error).map(x=>x.error)??[],recent:a?.recent??[]};}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id)return;
 const isPopup=sender.url===chrome.runtime.getURL('popup.html');
 const work=async()=>{
 if(message.kind==='lookup'&&sender.tab){const snapshot=captureSnapshotSchema.parse(message.snapshot);const modes=((await chrome.storage.session.get('modes')).modes??{}) as Record<number,boolean>;const store=await load(),a=store.active?store.accounts[store.active]:null;if(!a||!modes[sender.tab.id!]||snapshot.source.url!==sender.url)throw new Error('authentication_required');return request('/sensa/semantic/lookups',{id:message.lookupId,snapshot},a.token);}
 if(message.kind==='accept'&&sender.tab){const modes=((await chrome.storage.session.get('modes')).modes??{}) as Record<number,boolean>;if(!modes[sender.tab.id!])throw new Error('reading_mode_off');await locked(async()=>{const store=await load(),a=store.active?store.accounts[store.active]:null;if(!a)throw new Error('authentication_required');const operation=semanticAcceptOperationSchema.parse({operationId:message.operationId,occurredAt:new Date().toISOString(),installationId:a.installationId,replicaId:a.replicaId,dependsOn:[],kind:'semantic.accept',payload:{lookupId:message.lookupId,expectedRevision:'1',intakeId:null,consent:'accept_context_expression_sense'}});if(!a.savedOperations[operation.operationId]){a.savedOperations[operation.operationId]=operation;a.queue.push({wireVersion:'sensa-sync-v3',epoch:a.epoch,operation});}await persist(store);});void sync();return {savedLocally:true};}
 if(message.kind==='save'&&sender.tab){const mode=((await chrome.storage.session.get('modes')).modes??{}) as Record<number,boolean>;if(!mode[sender.tab.id!])throw new Error('reading_mode_off');const snapshot=captureSnapshotSchema.parse(message.snapshot);if(!sender.url||snapshot.source.url!==sender.url)throw new Error('source_mismatch');await locked(async()=>{const store=await load(),a=store.active?store.accounts[store.active]:null;if(!a)throw new Error('authentication_required');const operation=a.savedOperations[message.operationId]??intakeOperationSchema.parse({operationId:message.operationId,occurredAt:new Date().toISOString(),installationId:a.installationId,replicaId:a.replicaId,dependsOn:[],kind:'intake.save',payload:{snapshot}});if(!a.savedOperations[operation.operationId]){a.savedOperations[operation.operationId]=operation;a.queue.push({wireVersion:'sensa-sync-v3',epoch:a.epoch,operation});}await persist(store);});void sync();return {savedLocally:true};}
 if(!isPopup)throw new Error('unsupported_message');
 if(message.kind==='status'){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const modes=((await chrome.storage.session.get('modes')).modes??{}) as Record<number,boolean>;if(tab?.id&&modes[tab.id]){try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});await chrome.tabs.sendMessage(tab.id,{kind:'reading',enabled:true});await chrome.action.setBadgeText({tabId:tab.id,text:''});}catch{/* Preserve intent until the user grants this page. */}}}
 if(message.kind==='login')await login();
 if(message.kind==='sync')await sync();
 if(message.kind==='disconnect')await locked(async()=>{const store=await load();store.active=null;await persist(store);await chrome.storage.session.set({modes:{}});});
 if(message.kind==='toggle'){const store=await load();if(!store.active)throw new Error('authentication_required');const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab.id||!tab.url||!/^https?:/u.test(tab.url))throw new Error('unsupported_page');const modes=((await chrome.storage.session.get('modes')).modes??{}) as Record<number,boolean>;modes[tab.id]=true;await chrome.storage.session.set({modes});await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});await chrome.tabs.sendMessage(tab.id,{kind:'reading',enabled:true});}
 if(message.kind==='stop'){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(tab.id){const modes=((await chrome.storage.session.get('modes')).modes??{}) as Record<number,boolean>;delete modes[tab.id];await chrome.storage.session.set({modes});await chrome.tabs.sendMessage(tab.id,{kind:'reading',enabled:false}).catch(()=>undefined);}}
 return status();};void work().then(value=>respond({value}),error=>respond({error:error instanceof Error?error.message:'failed'}));return true;
});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status!=='complete')return;void (async()=>{const modes=((await chrome.storage.session.get('modes')).modes??{}) as Record<number,boolean>;if(!modes[id])return;try{await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']});await chrome.tabs.sendMessage(id,{kind:'reading',enabled:true});await chrome.action.setBadgeText({tabId:id,text:''});}catch{await chrome.action.setBadgeText({tabId:id,text:'继续'});await chrome.action.setTitle({tabId:id,title:'点一次 Sensa 图标，继续当前网站的阅读模式'});}})();});
chrome.tabs.onRemoved.addListener(id=>{void locked(async()=>{const modes=((await chrome.storage.session.get('modes')).modes??{}) as Record<number,boolean>;delete modes[id];await chrome.storage.session.set({modes});});});
chrome.alarms.create('sync',{periodInMinutes:1});chrome.alarms.onAlarm.addListener(()=>void sync());
void chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
