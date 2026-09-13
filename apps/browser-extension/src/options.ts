import {webUrl} from './config';
import {readingFeatures,defaultReadingAssignments} from '@sensa/contracts/sensa';
import type {ReadingSettingsView,ReadingSettingsInput} from '@sensa/contracts/sensa';
import {readingError} from './readingClient';
import {defaultPreferences,readingPreferences,saveReadingPreferences} from './preferences';
const feedback=document.querySelector<HTMLElement>('#feedback')!;
const providers=document.querySelector<HTMLElement>('#providers')!;
const assignments=document.querySelector<HTMLElement>('#assignments')!;
const labels:Record<(typeof readingFeatures)[number],string>={selection:'划词翻译',page:'网页翻译',subtitles:'视频字幕',action:'自定义阅读动作',meaning:'句中意义解释',writing:'输入框翻译'};
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
  const legend=document.createElement('legend');legend.textContent=provider?.name??'新连接';box.append(legend);
  inputField(box,'名称','name',provider?.name??'DeepSeek');
  inputField(box,'兼容 API 基础地址','baseUrl',provider?.baseUrl??'https://api.deepseek.com','url');
  const model=inputField(box,'模型标识','model',provider?.model??'deepseek-chat');
  const modelChoices=document.createElement('datalist');modelChoices.id='models-'+box.dataset.id;box.append(modelChoices);model.setAttribute('list',modelChoices.id);
  const fetchModels=document.createElement('button');fetchModels.textContent='获取已保存连接的模型列表';fetchModels.onclick=()=>void perform(async()=>{
    const result=await message('reading-models',{providerId:box.dataset.id});modelChoices.replaceChildren(...result.models.map((id:string)=>new Option(id,id)));feedback.textContent=`已获取 ${result.models.length} 个模型，点击模型输入框选择或继续手填。`;
  });box.append(fetchModels);
  const advanced=document.createElement('details');const summary=document.createElement('summary');summary.textContent='高级参数';advanced.append(summary);box.append(advanced);
  const temperature=inputField(advanced,'Temperature（不确定时保持 0）','temperature',String(provider?.temperature??0),'number');temperature.min='0';temperature.max='2';temperature.step='0.1';
  const key=inputField(box,provider?.keyConfigured?'API Key（已配置，留空保留）':'API Key','apiKey','','password');key.maxLength=4096;
  const enabled=inputField(box,'启用此连接','enabled','','checkbox');enabled.checked=provider?.enabled??true;
  const remove=document.createElement('button');remove.textContent='移除此连接';remove.onclick=()=>{box.remove();refreshChoices();};
  const test=document.createElement('button');test.textContent='测试已保存连接';test.onclick=()=>void perform(async()=>{
    if(!current?.providers.some(p=>p.id===box.dataset.id))throw new Error('provider_not_configured');
    feedback.textContent='正在测试已保存的连接…';const result=await message('reading-test',{id:crypto.randomUUID(),providerId:box.dataset.id});
    feedback.textContent=result.status==='ready'?'连接成功。结构化解释能力仍需在实际功能中验证。':readingError(result.error);
  });
  box.append(test,remove);box.addEventListener('change',refreshChoices);providers.append(box);refreshChoices();
}
function draftProviders():ReadingSettingsInput['providers']{return Array.from(providers.querySelectorAll('fieldset')).map(box=>{
  const field=(name:string)=>box.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  return {id:box.dataset.id!,name:field('name').value.trim(),baseUrl:field('baseUrl').value.trim(),model:field('model').value.trim(),temperature:Number(field('temperature').value),enabled:field('enabled').checked,...(field('apiKey').value.trim()?{apiKey:field('apiKey').value.trim()}:{})};
});}
function refreshChoices(){
  const choices=draftProviders();for(const feature of readingFeatures){const select=document.getElementById('feature-'+feature) as HTMLSelectElement|null;if(!select)continue;const selected=select.value;select.replaceChildren(new Option('Sensa 默认',''));for(const p of choices.filter(p=>p.enabled))select.add(new Option(p.name,p.id));if(choices.some(p=>p.enabled&&p.id===selected))select.value=selected;}
}
function render(){
  providers.replaceChildren();assignments.replaceChildren();for(const feature of readingFeatures){const label=document.createElement('label');label.textContent=labels[feature];const select=document.createElement('select');select.id='feature-'+feature;select.setAttribute('aria-label',labels[feature]);label.append(select);assignments.append(label);}
  current?.providers.forEach(addProvider);refreshChoices();for(const feature of readingFeatures)(document.getElementById('feature-'+feature) as HTMLSelectElement).value=current?.assignments[feature]??'';
  document.getElementById('origins')!.textContent='支持的服务地址：'+(current?.allowedOrigins.join('、')??'');
}
async function reload(){current=null;const result=await message('reading-settings');current=result;render();feedback.textContent=current?.configured?'模型设置已加载。':'当前服务尚未启用安全凭据存储；可以使用已配置的 Sensa 默认服务。';}
document.getElementById('reload')!.onclick=()=>void perform(reload);
document.getElementById('add')!.onclick=()=>addProvider();
document.getElementById('save')!.onclick=()=>void perform(async()=>{
  if(!current)throw new Error('authentication_required');
  const next={...defaultReadingAssignments};for(const feature of readingFeatures)next[feature]=(document.getElementById('feature-'+feature) as HTMLSelectElement).value||null;
  const input:ReadingSettingsInput={expectedRevision:current.revision,providers:draftProviders(),assignments:next};
  const result=await message('reading-settings-save',input);current={...result,accountId:current.accountId};render();feedback.textContent='模型设置已保存。密钥已从表单清除。';
});
document.getElementById('preferences')!.onclick=()=>void perform(async()=>{
  const disabledSites=value('disabled-sites').split(/\s+/u).filter(Boolean);
  const speechRate=Number(value('speech-rate'));
  if(!Number.isFinite(speechRate)||speechRate<0.5||speechRate>2)throw new Error('invalid_speech_rate');
  // One writer for these preferences: this page and a page's own site switch save
  // through the same function, so a rule written here is one the other can read
  // back. It normalises the sites and refuses a line it cannot represent.
  await saveReadingPreferences({actionName:value('action-name'),actionPrompt:value('action-prompt')||defaultPreferences.actionPrompt,disabledSites,speechRate,speechVoice:value('speech-voice')});
  feedback.textContent='本机偏好已保存，重新开启页面阅读后生效。';
});
document.getElementById('account')!.onclick=()=>void chrome.tabs.create({url:new URL('/profile',webUrl).toString()});
async function serviceStatus(){const target=document.getElementById('service-status')!;try{const result=await message('service-status');target.textContent=result.authorized?`账号已连接。${result.explanationAvailable?'解释服务可用。':'解释服务暂不可用。'} 最近 24 小时：`+result.usage.map((u:{kind:string;used:number;limit:number})=>`${({reading:'网页阅读',teacher:'澄清与解析',content:'材料准备'} as Record<string,string>)[u.kind]} ${u.used}/${u.limit}`).join('；'):'请从插件弹窗登录 Sensa。';}catch(e){target.textContent=readingError(e);}}
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
  select.replaceChildren(new Option('自动选择（按文字语言）',''));
  for(const voice of voices)select.add(new Option(`${voice.name} · ${voice.lang}`,voice.name));
  if(keep&&!voices.some(voice=>voice.name===keep))select.add(new Option(`${keep}（本机没有这个音色）`,keep));
  select.value=keep;
}
if(typeof speechSynthesis!=='undefined')speechSynthesis.addEventListener?.('voiceschanged',()=>showVoices());
void perform(async()=>{const prefs=await readingPreferences();(document.getElementById('action-name') as HTMLInputElement).value=prefs.actionName;(document.getElementById('action-prompt') as HTMLTextAreaElement).value=prefs.actionPrompt;(document.getElementById('disabled-sites') as HTMLTextAreaElement).value=prefs.disabledSites.join('\n');(document.getElementById('speech-rate') as HTMLInputElement).value=String(prefs.speechRate);showVoices(prefs.speechVoice);feedback.textContent='阅读偏好已加载。自定义模型服务可在高级设置中调整。';});
