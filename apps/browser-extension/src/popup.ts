import {webUrl} from './config';
import {t,errorText,extensionLanguage,type MessageKey} from './i18n';
import type {NativeConnection} from './nativeDestination';
const status=document.querySelector<HTMLParagraphElement>('#status')!;
const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
document.documentElement.lang=extensionLanguage();
for(const element of document.querySelectorAll<HTMLElement>('[data-i18n]'))element.textContent=t(element.dataset.i18n as MessageKey);
const progress:Record<string,MessageKey>={status:'checking',login:'loggingIn',toggle:'starting',stop:'stopping',sync:'checkingSave',disconnect:'disconnecting'};
const success:Record<string,MessageKey>={login:'loggingIn',toggle:'started',stop:'stopped',sync:'checked',disconnect:'disconnected'};
let busy=false,candidate:NativeConnection|null=null;
async function act(kind:string){
 if(busy)return;busy=true;buttons.forEach(b=>{b.disabled=true;});status.textContent=t(progress[kind]??'working');status.setAttribute('aria-busy','true');
 try{
  const response=await chrome.runtime.sendMessage({kind,...(kind==='native-select'?{connection:candidate}:{})});if(response.error)throw new Error(response.error);
  if(kind==='native-discover'){candidate=response.value;document.getElementById('native-candidate')!.textContent=t('library',{name:candidate!.label});document.getElementById('native-candidate')!.hidden=false;document.getElementById('native-select')!.hidden=false;status.textContent=t('select');return;}
  if(kind==='native-select'||kind==='web-select'){candidate=null;document.getElementById('native-candidate')!.hidden=true;document.getElementById('native-select')!.hidden=true;}
  const v=response.value,native=v.destination==='native';
  document.getElementById('login')!.textContent=t(v.accountId?'account':'login');
  status.textContent=native?t('library',{name:v.label??t('unknownLibrary')}):t(v.accountId?'connected':'guest');
  if(v.pending)status.textContent+='\n'+t('pending',{count:v.pending});
  if(v.cloudPending)status.textContent+='\n'+t('cloudPending',{count:v.cloudPending});
  if(v.legacyPending)status.textContent+='\n'+t('legacy',{count:v.legacyPending});
  if(success[kind])status.textContent=t(success[kind])+'\n'+status.textContent;
  if(v.errors.length)status.textContent+='\n'+v.errors.map(errorText).join('\n');
  const recent=document.querySelector('#recent')!;recent.replaceChildren();
  for(const item of v.recent){const element=document.createElement(native?'p':'a');
   if(element instanceof HTMLAnchorElement){const url=new URL(v.destination==='web-local'?'/content/personal-meaning':webUrl,webUrl);url.searchParams.set(v.destination==='web-local'?'meaningId':('acceptanceId'in item||item.meaningId)?'meaning':'intake',item.meaningId??item.id);element.href=url.href;element.target='_blank';}
   element.textContent=t(item.status==='removed'?'removed':item.status==='confirmed'?'saved':'inbox')+(item.snapshot.expression?.text??t('text'));recent.append(element);
  }
  document.getElementById('recent-count')!.textContent=t('count',{count:v.recent.length});
  const empty=document.getElementById('recent-empty')!;empty.hidden=v.recent.length>0;empty.textContent=t(native||v.accountId?'empty':'guestEmpty');
 }catch(e){status.textContent=errorText(e);}
 finally{busy=false;buttons.forEach(b=>{b.disabled=false;});status.setAttribute('aria-busy','false');}
}
for(const id of ['login','toggle','stop','sync','disconnect','native-discover','native-select','web-select'])document.getElementById(id)!.addEventListener('click',()=>void act(id));
document.getElementById('open-web')!.addEventListener('click',()=>void chrome.tabs.create({url:new URL('/content',webUrl).href}));
void act('status');document.getElementById('options')?.addEventListener('click',()=>void chrome.runtime.openOptionsPage());
