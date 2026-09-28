import {webUrl} from './config';
import {t,errorText,extensionLanguage,type MessageKey} from './i18n';
import {interfaceLanguageName} from './interfaceLanguageName';
const status=document.querySelector<HTMLParagraphElement>('#status')!;
const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
const routeSelect=document.querySelector<HTMLSelectElement>('#language-route')!;
document.documentElement.lang=extensionLanguage();
for(const element of document.querySelectorAll<HTMLElement>('[data-i18n]'))element.textContent=t(element.dataset.i18n as MessageKey);
for(const element of document.querySelectorAll<HTMLElement>('[data-i18n-label]'))element.setAttribute('aria-label',t(element.dataset.i18nLabel as MessageKey));
const progress:Record<string,MessageKey>={status:'checking',login:'loggingIn',toggle:'starting',stop:'stopping',sync:'checkingSave',disconnect:'disconnecting'};
const success:Record<string,MessageKey>={login:'loggingIn',toggle:'started',stop:'stopped',sync:'checked',disconnect:'disconnected'};
let busy=false;
async function act(kind:string){
 if(busy)return;busy=true;buttons.forEach(b=>{b.disabled=true;});routeSelect.disabled=true;status.textContent=t(progress[kind]??'working');status.setAttribute('aria-busy','true');
 try{
  const response=await chrome.runtime.sendMessage({kind});if(response.error)throw new Error(response.error);
  const v=response.value;
  routeSelect.replaceChildren();
  for(const route of v.language.collection.routes.filter((item:{status:string})=>item.status==='active')){
   const option=document.createElement('option');option.value=route.id;
   option.textContent=t('routeOption',{target:interfaceLanguageName(route.targetLanguageTag),support:interfaceLanguageName(route.defaultSupportLanguageTag)});
   option.selected=route.id===v.language.context.languageRouteId;routeSelect.append(option);
  }
  document.getElementById('login')!.textContent=t(v.accountId?'account':'login');
  status.textContent=t(v.accountId?'connected':'guest');
  if(v.pending)status.textContent+='\n'+t('pending',{count:v.pending});
  if(success[kind])status.textContent=t(success[kind])+'\n'+status.textContent;
  if(v.errors.length)status.textContent+='\n'+v.errors.map(errorText).join('\n');
  const recovery=document.getElementById('queue-recovery')!;
  recovery.hidden=!(v.recoveryCount??0);
  document.getElementById('queue-recovery-body')!.textContent=t('queueRecoveryBody',{count:v.recoveryCount??0});
  const recent=document.querySelector('#recent')!;recent.replaceChildren();
  for(const item of v.recent){const element=document.createElement('a');
   if(element instanceof HTMLAnchorElement){const url=new URL(v.destination==='web-local'?(item.status==='confirmed'?'/content/personal-meaning':'/content?worldAction=inbox'):webUrl,webUrl);url.searchParams.set(v.destination==='web-local'?'meaningId':('acceptanceId'in item||item.meaningId)?'meaning':'intake',item.meaningId??item.id);element.href=url.href;element.addEventListener('click',event=>{event.preventDefault();void chrome.runtime.sendMessage({kind:'open-web',path:url.pathname+url.search});});}
   element.textContent=t(item.status==='removed'?'removed':item.status==='confirmed'?'saved':'inbox')+(item.expression??t('text'));recent.append(element);
  }
  document.getElementById('recent-count')!.textContent=t('count',{count:v.recent.length});
  const empty=document.getElementById('recent-empty')!;empty.hidden=v.recent.length>0;empty.textContent=t(v.accountId?'empty':'guestEmpty');
  rule=v.rule??null;siteButton.hidden=!rule;if(rule)siteButton.textContent=t(rule.disabled?'siteEnable':'siteDisable');
 }catch(e){status.textContent=errorText(e);}
 finally{busy=false;buttons.forEach(b=>{b.disabled=false;});routeSelect.disabled=false;status.setAttribute('aria-busy','false');}
}
routeSelect.addEventListener('change',()=>void actRoute(routeSelect.value));
async function actRoute(routeId:string){
 if(busy)return;busy=true;buttons.forEach(button=>{button.disabled=true;});routeSelect.disabled=true;status.textContent=t('selectingRoute');status.setAttribute('aria-busy','true');
 try{const response=await chrome.runtime.sendMessage({kind:'select-language-route',routeId});if(response.error)throw new Error(response.error);status.textContent=t('routeSelected');}
 catch(error){status.textContent=errorText(error);}
 finally{busy=false;buttons.forEach(button=>{button.disabled=false;});routeSelect.disabled=false;status.setAttribute('aria-busy','false');await act('status');}
}
for(const id of ['login','toggle','stop','sync','disconnect'])document.getElementById(id)!.addEventListener('click',()=>void act(id));
document.getElementById('queue-recovery-export')!.addEventListener('click',()=>void (async()=>{
 if(busy)return;busy=true;buttons.forEach(button=>{button.disabled=true;});routeSelect.disabled=true;
 try{
  const response=await chrome.runtime.sendMessage({kind:'queue-recovery-export'});if(response.error)throw new Error(response.error);
  const blob=new Blob([JSON.stringify(response.value,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download='sensa-extension-queue-recovery.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),0);
  status.textContent=t('queueRecoveryExported');
 }catch(error){status.textContent=errorText(error);}
 finally{busy=false;buttons.forEach(button=>{button.disabled=false;});routeSelect.disabled=false;}
})());
document.getElementById('queue-recovery-discard')!.addEventListener('click',()=>void (async()=>{
 if(busy||!confirm(t('queueRecoveryDiscardConfirm')))return;
 busy=true;buttons.forEach(button=>{button.disabled=true;});routeSelect.disabled=true;
 try{
  const response=await chrome.runtime.sendMessage({kind:'queue-recovery-discard'});if(response.error)throw new Error(response.error);
  busy=false;buttons.forEach(button=>{button.disabled=false;});routeSelect.disabled=false;
  await act('status');status.textContent=t('queueRecoveryDiscarded')+'\n'+status.textContent;
 }catch(error){status.textContent=errorText(error);}
 finally{busy=false;buttons.forEach(button=>{button.disabled=false;});routeSelect.disabled=false;}
})());
/**
 * The site switch: the one control that has to be reachable from a page the
 * learner has already turned reading off on. Its label states the rule that is in
 * force and the click applies the other one, so the button never has to be
 * guessed at; a page that has no site — a browser page, a file — hides it.
 */
const siteButton=document.getElementById('site') as HTMLButtonElement;
let rule:{site:string;disabled:boolean}|null=null;
siteButton.addEventListener('click',()=>void (async()=>{
 if(busy||!rule)return;busy=true;buttons.forEach(b=>{b.disabled=true;});status.setAttribute('aria-busy','true');
 let message='';
 try{
  // The label states the rule in force and the click asks for the opposite of
  // it: a rule that is on is being turned off, and one that is off is being
  // lifted — which is why the request carries the current disabled state as the
  // enabled it wants.
  const response=await chrome.runtime.sendMessage({kind:'reading-site',enabled:rule.disabled});
  if(response.error)throw new Error(response.error);
  const v=response.value;
  message=t(v.disabled?'siteDisabled':'siteEnabled',{site:v.site});
 }catch(e){message=errorText(e);}
 finally{busy=false;siteButton.disabled=false;}
 // Re-reads the status first: the switch changes what the toggle button would do,
 // and the message about the rule is prepended to whatever the status says.
 await act('status');
 status.textContent=message+'\n'+status.textContent;
})());
document.getElementById('open-web')!.addEventListener('click',()=>void chrome.runtime.sendMessage({kind:'open-web'}));
void act('status');document.getElementById('options')?.addEventListener('click',()=>void chrome.runtime.openOptionsPage());
