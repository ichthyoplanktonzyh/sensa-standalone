import {webUrl} from './config';
import {readingFeatures,defaultReadingAssignments} from '@sensa/contracts/sensa';
import type {ReadingSettingsView,ReadingSettingsInput} from '@sensa/contracts/sensa';
import {readingError} from './readingClient';
import {t,extensionLanguage} from './i18n';
import {defaultPreferences,readingPreferences,saveReadingPreferences} from './preferences';
const feedback=document.querySelector<HTMLElement>('#feedback')!;
const providers=document.querySelector<HTMLElement>('#providers')!;
const assignments=document.querySelector<HTMLElement>('#assignments')!;
const labels:Record<(typeof readingFeatures)[number],ReturnType<typeof t>>={selection:t('optionsSelection'),page:t('optionsPage'),subtitles:t('optionsSubtitles'),action:t('optionsAction'),meaning:t('optionsMeaning'),writing:t('optionsWriting')};
document.documentElement.lang=extensionLanguage();
for(const element of document.querySelectorAll<HTMLElement>('[data-i18n]'))element.textContent=t(element.dataset.i18n as Parameters<typeof t>[0]);
const voiceSelect=document.getElementById('speech-voice')!;voiceSelect.setAttribute('aria-label',t('optionsSpeechVoice'));
let current:(ReadingSettingsView & {accountId:string})|null=null;
let busy=false;
function value(id:string){return (document.getElementById(id) as HTMLInputElement).value.trim();}
async function message(kind:string,input?:unknown){const response=await chrome.runtime.sendMessage({kind,input,accountId:current?.accountId});if(response.error)throw new Error(response.error);return response.value;}
async function perform(work:()=>Promise<void>){if(busy)return;busy=true;document.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);try{await work();}catch(e){feedback.textContent=readingError(e);}finally{busy=false;document.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);}}
function inputField(parent:Element,label:string,name:string,initial:string,type='text'){
  const wrap=document.createElement('label');wrap.textContent=label;const field=document.createElement('input');field.name=name;field.type=type;field.value=initial;field.autocomplete=type==='password'?'new-password':'off';wrap.append(field);parent.append(wrap);return field;
}
function addProvider(provider?:ReadingSettingsView['providers'][number]){
  const box=document.createElement('fieldset');box.dataset.id=provider?.id??crypto.randomUUID();
  const legend=document.createElement('legend');legend.textContent=provider?.name??t('optionsNewConnection');box.append(legend);
  inputField(box,t('optionsName'),'name',provider?.name??'DeepSeek');
  inputField(box,t('optionsBaseUrl'),'baseUrl',provider?.baseUrl??'https://api.deepseek.com','url');
  const model=inputField(box,t('optionsModelId'),'model',provider?.model??'deepseek-chat');
  const modelChoices=document.createElement('datalist');modelChoices.id='models-'+box.dataset.id;box.append(modelChoices);model.setAttribute('list',modelChoices.id);
  const fetchModels=document.createElement('button');fetchModels.textContent=t('optionsFetchModels');fetchModels.onclick=()=>void perform(async()=>{
    const result=await message('reading-models',{providerId:box.dataset.id});modelChoices.replaceChildren(...result.models.map((id:string)=>new Option(id,id)));feedback.textContent=t('optionsModelsFetched',{count:result.models.length});
  });box.append(fetchModels);
  const advanced=document.createElement('details');const summary=document.createElement('summary');summary.textContent=t('optionsParameters');advanced.append(summary);box.append(advanced);
  const temperature=inputField(advanced,t('optionsTemperature'),'temperature',String(provider?.temperature??0),'number');temperature.min='0';temperature.max='2';temperature.step='0.1';
  const key=inputField(box,provider?.keyConfigured?t('optionsKeyConfigured'):'API Key','apiKey','','password');key.maxLength=4096;
  const enabled=inputField(box,t('optionsEnabled'),'enabled','','checkbox');enabled.checked=provider?.enabled??true;
  const remove=document.createElement('button');remove.textContent=t('optionsRemove');remove.onclick=()=>{box.remove();refreshChoices();};
  const test=document.createElement('button');test.textContent=t('optionsTest');test.onclick=()=>void perform(async()=>{
    if(!current?.providers.some(p=>p.id===box.dataset.id))throw new Error('provider_not_configured');
    feedback.textContent=t('optionsTesting');const result=await message('reading-test',{id:crypto.randomUUID(),providerId:box.dataset.id});
    feedback.textContent=result.status==='ready'?t('optionsTestSuccess'):readingError(result.error);
  });
  box.append(test,remove);box.addEventListener('change',refreshChoices);providers.append(box);refreshChoices();
}
function draftProviders():ReadingSettingsInput['providers']{return Array.from(providers.querySelectorAll('fieldset')).map(box=>{
  const field=(name:string)=>box.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  return {id:box.dataset.id!,name:field('name').value.trim(),baseUrl:field('baseUrl').value.trim(),model:field('model').value.trim(),temperature:Number(field('temperature').value),enabled:field('enabled').checked,...(field('apiKey').value.trim()?{apiKey:field('apiKey').value.trim()}:{})};
});}
function refreshChoices(){
  const choices=draftProviders();for(const feature of readingFeatures){const select=document.getElementById('feature-'+feature) as HTMLSelectElement|null;if(!select)continue;const selected=select.value;select.replaceChildren(new Option(t('optionsDefault'),''));for(const p of choices.filter(p=>p.enabled))select.add(new Option(p.name,p.id));if(choices.some(p=>p.enabled&&p.id===selected))select.value=selected;}
}
function render(){
  providers.replaceChildren();assignments.replaceChildren();for(const feature of readingFeatures){const label=document.createElement('label');label.textContent=labels[feature];const select=document.createElement('select');select.id='feature-'+feature;select.setAttribute('aria-label',labels[feature]);label.append(select);assignments.append(label);}
  current?.providers.forEach(addProvider);refreshChoices();for(const feature of readingFeatures)(document.getElementById('feature-'+feature) as HTMLSelectElement).value=current?.assignments[feature]??'';
  document.getElementById('origins')!.textContent=t('optionsOrigins',{origins:current?.allowedOrigins.join(', ')??''});
}
async function reload(){current=null;const result=await message('reading-settings');current=result;render();feedback.textContent=t(current?.configured?'optionsLoaded':'optionsVaultUnavailable');}
document.getElementById('reload')!.onclick=()=>void perform(reload);
document.getElementById('add')!.onclick=()=>addProvider();
document.getElementById('save')!.onclick=()=>void perform(async()=>{
  if(!current)throw new Error('authentication_required');
  const next={...defaultReadingAssignments};for(const feature of readingFeatures)next[feature]=(document.getElementById('feature-'+feature) as HTMLSelectElement).value||null;
  const input:ReadingSettingsInput={expectedRevision:current.revision,providers:draftProviders(),assignments:next};
  const result=await message('reading-settings-save',input);current={...result,accountId:current.accountId};render();feedback.textContent=t('optionsModelSaved');
});
document.getElementById('preferences')!.onclick=()=>void perform(async()=>{
  const disabledSites=value('disabled-sites').split(/\s+/u).filter(Boolean);
  const speechRate=Number(value('speech-rate'));
  if(!Number.isFinite(speechRate)||speechRate<0.5||speechRate>2)throw new Error('invalid_speech_rate');
  // One writer for these preferences: this page and a page's own site switch save
  // through the same function, so a rule written here is one the other can read
  // back. It normalises the sites and refuses a line it cannot represent.
  await saveReadingPreferences({actionName:value('action-name'),actionPrompt:value('action-prompt')||defaultPreferences.actionPrompt,disabledSites,speechRate,speechVoice:value('speech-voice')});
  feedback.textContent=t('optionsPrefsSaved');
});
document.getElementById('account')!.onclick=()=>void chrome.tabs.create({url:new URL('/profile',webUrl).toString()});
async function serviceStatus(){const target=document.getElementById('service-status')!;try{const result=await message('service-status');target.textContent=result.authorized?t('optionsAccountConnected')+t(result.explanationAvailable?'optionsExplanationReady':'optionsExplanationUnavailable')+' '+t('optionsLastDay')+result.usage.map((u:{kind:string;used:number;limit:number})=>`${t(({reading:'optionsUsageReading',teacher:'optionsUsageTeacher',content:'optionsUsageContent'} as const)[u.kind as 'reading'|'teacher'|'content']??'optionsUsageReading')} ${u.used}/${u.limit}`).join('; '):t('optionsSignIn');}catch(e){target.textContent=readingError(e);}}
document.getElementById('service-reload')!.onclick=()=>void serviceStatus();
document.getElementById('advanced')!.addEventListener('toggle',()=>{if((document.getElementById('advanced') as HTMLDetailsElement).open&&!current)void perform(reload);});
void serviceStatus();
/**
 * The voices this machine has, listed as they are named here: a voice belongs to
 * a device, so the list cannot come from anywhere else and a name chosen on
 * another machine means nothing on this one. The list arrives asynchronously in
 * Chrome, so it is filled on the event as well as on the first read.
 */
function showVoices(selected=''){
  const select=document.getElementById('speech-voice') as HTMLSelectElement;
  const keep=selected||select.value;
  const voices=typeof speechSynthesis==='undefined'?[]:speechSynthesis.getVoices();
  select.replaceChildren(new Option(t('optionsAutomaticVoice'),''));
  for(const voice of voices)select.add(new Option(`${voice.name} · ${voice.lang}`,voice.name));
  if(keep&&!voices.some(voice=>voice.name===keep))select.add(new Option(t('optionsMissingVoice',{name:keep}),keep));
  select.value=keep;
}
if(typeof speechSynthesis!=='undefined')speechSynthesis.addEventListener?.('voiceschanged',()=>showVoices());
void perform(async()=>{const prefs=await readingPreferences();(document.getElementById('action-name') as HTMLInputElement).value=prefs.actionName;(document.getElementById('action-prompt') as HTMLTextAreaElement).value=prefs.actionPrompt;(document.getElementById('disabled-sites') as HTMLTextAreaElement).value=prefs.disabledSites.join('\n');(document.getElementById('speech-rate') as HTMLInputElement).value=String(prefs.speechRate);showVoices(prefs.speechVoice);feedback.textContent=t('optionsPrefsLoaded');});
