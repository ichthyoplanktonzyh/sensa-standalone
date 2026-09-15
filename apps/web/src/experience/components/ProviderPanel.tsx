import {ModelExecutionPanel} from './ModelExecutionPanel';
import {listProviderModels,providerCredential} from '../../data/library/providers';
import {localFlowErrorKey} from '../../i18n/localFlowText';
import {useTranslation} from 'react-i18next';
import {readServiceStatus} from '../../data/library/serviceStatus';
import type {ServiceStatus} from '@sensa/contracts/sensa';
import {useAccountExperience} from '../account/AccountExperience';
import {useEffect,useState,useRef} from 'react';
import {
  assignProvider,clearCredential,deleteProvider,defaultSensaProvider,executionOf,hasCredential,providerSnapshot,
  purposes,purposeLabels,saveProvider,setCredential,setModelReviewEnabled,
  type Provider,type ProviderSettings,type Purpose,
} from '../../data/library/providers';
import {
  addAccountConnection,assignAccountPurpose,listAccountConnectionModels,readAccountModels,removeAccountConnection,updateAccountConnection,
  type AccountConnection,type AccountModels,
} from '../../data/library/accountModels';
import {setupButton,setupPrimary} from './learning/LearningSetupFrame';
import {Cpu,RefreshCw,Server} from 'lucide-react';

const feedback=' transition-colors hover:bg-surface-selected active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50';
const field='mt-2 block min-h-11 w-full rounded-control border border-border-strong bg-surface-panel p-3 focus-visible:outline-2 focus-visible:outline-focus';
const card='rounded-card border border-border-subtle p-5';
const chipBase='inline-flex w-fit items-center gap-1.5 rounded-pill border px-3 py-1 text-xs';
const hintText='text-sm leading-6 text-fg-secondary';
/** One hint per purpose: what the person is doing when this purpose is used. */
const purposeHints:Record<Purpose,string>={
 teacher:'modelService.purposeTeacherHint',content:'modelService.purposeContentHint',
 review:'modelService.purposeReviewHint',reference:'modelService.purposeReferenceHint',
};
const usageLabels:Record<ServiceStatus['usage'][number]['kind'],string>={
 reading:'modelService.reading',reference:'modelService.reference',teacher:'modelService.teacher',content:'modelService.content',
};

type Owner={kind:'default'}|{kind:'local';provider:Provider}|{kind:'account';connection:AccountConnection};

function OwnerChip({owner}:{owner:Owner}){
 const {t}=useTranslation();
 if(owner.kind==='default')return <span className={`${chipBase} border-border-strong bg-accent-soft text-action-primary`}><Server size={13} aria-hidden="true"/>{t('modelService.default')}</span>;
 if(owner.kind==='local')return <span className={`${chipBase} border-border-strong bg-surface-subtle text-fg-secondary`}><Cpu size={13} aria-hidden="true"/>{owner.provider.name}</span>;
 return <span className={`${chipBase} border-border-strong bg-surface-panel text-action-primary`}><Server size={13} aria-hidden="true"/>{owner.connection.name}</span>;
}

/** Add or update one connection. The group it is submitted to decides where the key lives. */
function ConnectionForm({title,label,note,keyRequired,initial,busy,onSubmit,onCancel}:{
 title:string;label:string;note:string;keyRequired:boolean;
 initial?:{name:string;endpoint:string;model:string};
 busy:boolean;
 onSubmit:(input:{name:string;endpoint:string;model:string;key:string})=>Promise<void>;
 onCancel:()=>void;
}){
 const {t}=useTranslation();
 const [name,setName]=useState(initial?.name??''),[endpoint,setEndpoint]=useState(initial?.endpoint??''),[model,setModel]=useState(initial?.model??''),[key,setKey]=useState('');
 return <form className={`${card} space-y-5`} onSubmit={event=>{event.preventDefault();void onSubmit({name,endpoint,model,key});}}>
  <h4 className="font-medium">{title}</h4>
  <label className="block text-sm">{t('modelService.name')}<input className={field} maxLength={80} value={name} onChange={event=>setName(event.target.value)} required/></label>
  <label className="block text-sm">{t('modelService.endpoint')}<input className={field} type="url" value={endpoint} onChange={event=>setEndpoint(event.target.value)} placeholder="https://api.example.com/v1" required/></label>
  <label className="block text-sm">{t('modelService.model')}<input className={field} maxLength={160} value={model} onChange={event=>setModel(event.target.value)} required/></label>
  <label className="block text-sm">{label}<input className={field} type="password" autoComplete="off" value={key} onChange={event=>setKey(event.target.value)} required={keyRequired}/></label>
  <p className={hintText}>{note}</p>
  <div className="flex flex-wrap gap-2"><button className={setupPrimary+' '+feedback} disabled={busy}>{t('modelService.save')}</button><button type="button" className={setupButton+feedback} onClick={onCancel}>{t('modelService.cancel')}</button></div>
 </form>;
}

export function ProviderPanel(){
 const {t}=useTranslation();
 const account=useAccountExperience();
 const [service,setService]=useState<ServiceStatus|null>(null),[serviceError,setServiceError]=useState('');
 const statusGeneration=useRef(0);const [refreshing,setRefreshing]=useState(false),[refreshed,setRefreshed]=useState(false);
 /** The shell keeps every screen mounted, so mounting is not "the user opened this".
  * The rolling service counters are read on demand, when the panel is on screen. */
 const panel=useRef<HTMLDivElement>(null);const [visible,setVisible]=useState(false);
 useEffect(()=>{const node=panel.current;if(!node)return;const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)));observer.observe(node);return()=>observer.disconnect();},[]);
 const refreshService=async()=>{const gen=++statusGeneration.current;setRefreshing(true);setRefreshed(false);setServiceError('');try{const next=await readServiceStatus();if(gen===statusGeneration.current){setService(next);setRefreshed(true);}}catch(e){if(gen===statusGeneration.current)setServiceError(localFlowErrorKey(e,'modelService.statusFailed'));}finally{if(gen===statusGeneration.current)setRefreshing(false);}};
 useEffect(()=>{if(account.onlineService&&visible)void refreshService();else if(!account.onlineService){setService(null);setRefreshing(false);setRefreshed(false);setServiceError('');}return()=>{statusGeneration.current++;};},[account.onlineService,account.email,visible]);

 const [providers,setProviders]=useState<Provider[]>([defaultSensaProvider]),[settings,setSettings]=useState<ProviderSettings>({revision:0,assignments:{}});
 const [accountModels,setAccountModels]=useState<AccountModels|null>(null),[accountError,setAccountError]=useState('');
 const [accountLoaded,setAccountLoaded]=useState(false);
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [addLocal,setAddLocal]=useState(false),[addAccount,setAddAccount]=useState(false);
 const [selected,setSelected]=useState<Provider|null>(null),[credential,setKeyInput]=useState('');
 const [editing,setEditing]=useState<AccountConnection|null>(null);
 const [catalog,setCatalog]=useState<{kind:'local';provider:Provider;models:string[]}|{kind:'account';connection:AccountConnection;models:string[]}|null>(null);

 const readAccount=async()=>{
  if(!account.onlineService)return;
  try{setAccountModels(await readAccountModels());setAccountLoaded(true);setAccountError('');}
  catch(e){setAccountError(localFlowErrorKey(e,'modelService.statusFailed'));}
 };
 const refresh=async()=>{
  const snapshot=await providerSnapshot();setProviders(snapshot.providers);setSettings(snapshot.settings);
  await readAccount();
 };
 /** Mounting is not "the user opened this": the shell keeps every screen mounted, so the
  * local store is read here and account connections only once the panel is on screen. */
 useEffect(()=>{void providerSnapshot().then(snapshot=>{setProviders(snapshot.providers);setSettings(snapshot.settings);}).catch(()=>setNotice('modelService.readFailed'));},[]);
 useEffect(()=>{
  if(account.onlineService&&visible)void readAccount();
  else if(!account.onlineService){setAccountModels(null);setAccountLoaded(false);setAccountError('');}
 },[account.onlineService,account.email,visible]);
 const perform=async(work:()=>Promise<unknown>)=>{setBusy(true);setNotice('');try{await work();await refresh();setNotice('modelService.updated');}catch(e){setNotice(localFlowErrorKey(e,'modelService.saveFailed'));}finally{setBusy(false);}};

 const localConnections=providers.filter(provider=>provider.id!==defaultSensaProvider.id);
 const accountConnections=accountModels?.connections??[];
 const ownerFor=(purpose:Purpose):Owner=>{
  const local=localConnections.find(provider=>provider.id===settings.assignments[purpose]);
  if(local)return {kind:'local',provider:local};
  const connection=accountConnections.find(item=>item.id===accountModels?.assignments[purpose]);
  return connection?{kind:'account',connection}:{kind:'default'};
 };
 /** Exactly one registry owns a purpose, so assigning here clears the other one. */
 const assign=(purpose:Purpose,value:string)=>perform(async()=>{
  if(value.startsWith('account:')){
   if(settings.assignments[purpose])await assignProvider(crypto.randomUUID(),purpose,null,settings.revision);
   if(accountModels)await assignAccountPurpose(accountModels,purpose,value.slice('account:'.length));
   return;
  }
  if(accountModels?.assignments[purpose])await assignAccountPurpose(accountModels,purpose,null);
  await assignProvider(crypto.randomUUID(),purpose,value.startsWith('local:')?value.slice('local:'.length):null,settings.revision);
 });
 /** Picking from a listed catalog only changes the model, never the stored key. */
 const applyModel=(model:string)=>perform(async()=>{
  if(!catalog)return;
  if(catalog.kind==='local'){
   const provider=catalog.provider;
   await saveProvider(crypto.randomUUID(),{id:provider.id,expectedRevision:provider.revision,name:provider.name,endpoint:provider.endpoint,kind:provider.kind,model},await providerCredential(provider));
  }else{
   if(!accountModels)return;
   const {keyConfigured,...connection}=catalog.connection;
   await updateAccountConnection(accountModels,{...connection,model});
  }
  setCatalog(null);
 });

 return <div className="sensa-model-settings space-y-8" ref={panel}>
  <header className="space-y-4">
   <div className={`${card} space-y-4`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
     <div className="space-y-1">
      <p>{account.onlineService?t('modelService.connected'):t('modelService.disconnected')}</p>
      {service&&<p className={hintText}>{service.explanationAvailable?t('modelService.available'):t('modelService.unavailable')}</p>}
      {serviceError&&<p role="status" className={hintText}>{t(serviceError)}</p>}
     </div>
     <div className="flex flex-wrap gap-2">
      {!account.onlineService&&<button className={setupButton+feedback} onClick={account.login}>{t('modelService.login')}</button>}
      {account.onlineService&&<button className={setupButton+feedback} disabled={refreshing} aria-busy={refreshing} onClick={()=>void refreshService()}><RefreshCw size={16} aria-hidden="true"/>{t(refreshing?'modelService.refreshing':'modelService.refresh')}</button>}
     </div>
    </div>
    {refreshed&&!refreshing&&<p role="status" className="text-sm text-feedback-success">{t('modelService.refreshed')}</p>}
    {service&&<div className="space-y-3 border-t border-border-subtle pt-4">
     <h2 className="text-sm font-medium">{t('modelService.usageTitle')}</h2>
     <ul className="grid gap-2 sm:grid-cols-2">
      {service.usage.map(entry=><li key={entry.kind} className="flex items-baseline justify-between gap-3 rounded-control bg-surface-subtle px-4 py-3 text-sm">
       <span>{t(usageLabels[entry.kind])}</span>
       <span className={entry.limit!==null&&entry.used>=entry.limit?'text-feedback-warning':'text-fg-secondary'}>{entry.used} / {entry.limit??'∞'}{entry.limit!==null&&entry.used>=entry.limit?` · ${t('modelService.limit')}`:''}</span>
      </li>)}
     </ul>
     <p className={hintText}>{t('modelService.usageNote')}</p>
    </div>}
   </div>
  </header>

  {notice&&<p role="status" className="rounded-control bg-accent-soft p-4">{t(notice)}</p>}

  <section className="space-y-4" aria-labelledby="model-owners">
   <div><h2 id="model-owners" className="text-lg font-medium">{t('modelService.providers')}</h2></div>
   <ul className="space-y-3">
    {purposes.map(purpose=>{
     const owner=ownerFor(purpose);
     const label=t(purposeLabels[purpose]);
     return <li key={purpose} className={`${card} flex flex-wrap items-start justify-between gap-4`}>
      <div className="min-w-[200px] flex-1 space-y-2">
       <p className="font-medium">{label}</p>
       <p className={hintText}>{t(purposeHints[purpose])}</p>
       <OwnerChip owner={owner}/>
      </div>
      <label className="text-sm">
       <span className="sr-only">{label}</span>
       <select className={field} aria-label={label} value={owner.kind==='default'?'':owner.kind==='local'?'local:'+owner.provider.id:'account:'+owner.connection.id} disabled={busy} onChange={event=>void assign(purpose,event.target.value)}>
        <option value="">{t('modelService.default')}</option>
        {accountConnections.length>0&&<optgroup label={t('modelService.accountGroup')}>{accountConnections.map(connection=><option key={connection.id} value={'account:'+connection.id}>{connection.name} · {connection.model}</option>)}</optgroup>}
        {localConnections.length>0&&<optgroup label={t('modelService.localGroup')}>{localConnections.map(provider=><option key={provider.id} value={'local:'+provider.id}>{provider.name} · {provider.model}</option>)}</optgroup>}
       </select>
      </label>
     </li>;
    })}
   </ul>
   <div className={`${card} space-y-2`}>
    <label className="flex items-center gap-3"><input type="checkbox" checked={settings.modelReviewEnabled===true} disabled={busy} onChange={event=>void perform(()=>setModelReviewEnabled(crypto.randomUUID(),event.target.checked,settings.revision))}/>{t('modelService.enableReview')}</label>
    <p className={hintText}>{t('modelService.reviewNote')}</p>
   </div>
  </section>

  <section className="space-y-4" aria-labelledby="model-connections">
   <div><h2 id="model-connections" className="text-lg font-medium">{t('modelService.connections')}</h2></div>

   <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">{t('modelService.localGroup')}</h3>{!addLocal&&<button className={setupButton+feedback} disabled={busy} onClick={()=>setAddLocal(true)}>{t('modelService.addLocal')}</button>}</div>
    <p className={hintText}>{t('modelService.localGroupNote')}</p>
    {localConnections.length===0&&!addLocal&&<p className={hintText}>{t('modelService.localEmpty')}</p>}
    {localConnections.map(provider=><article key={provider.id} className={card}>
     <h4 className="font-medium">{provider.name} · {provider.model}</h4>
     <p className="mt-2 break-all text-sm text-fg-secondary">{provider.endpoint}</p>
     <p className="mt-2 flex flex-wrap items-center gap-3 text-sm">{provider.kind==='sensa'?t('modelService.accountCredential'):hasCredential(provider)?t('modelService.keyPresent'):t('modelService.keyAbsent')}<span className={`${chipBase} border-border-strong text-fg-secondary`}>{t(executionOf(provider)==='device'?'modelService.executionDevice':'modelService.executionService')}</span></p>
     <div className="mt-3 flex flex-wrap gap-2">
      {provider.kind==='compatible'&&<>
       <button className={setupButton+feedback} disabled={busy} onClick={()=>void perform(async()=>{setCatalog({kind:'local',provider,models:await listProviderModels(provider)});})}>{t('modelService.modelList')}</button>
       <button className={setupButton+feedback} disabled={busy} onClick={()=>{setSelected(provider);setKeyInput('');}}>{t('modelService.changeKey')}</button>
       <button className={setupButton+feedback} disabled={busy} onClick={()=>{clearCredential(provider.id);void refresh();}}>{t('modelService.forget')}</button>
      </>}
      <button className={setupButton+feedback} disabled={busy} onClick={()=>void perform(()=>deleteProvider(crypto.randomUUID(),provider))}>{t('modelService.remove')}</button>
     </div>
    </article>)}
    {catalog&&<section className="space-y-3 rounded-card border border-border-strong p-5"><h4>{catalog.kind==='local'?catalog.provider.name:catalog.connection.name}</h4>
     <label className="block text-sm">{t('modelService.model')}<select className={field} value={catalog.kind==='local'?catalog.provider.model:catalog.connection.model} disabled={busy} onChange={event=>void applyModel(event.target.value)}>{[catalog.kind==='local'?catalog.provider.model:catalog.connection.model,...catalog.models.filter(model=>model!==(catalog.kind==='local'?catalog.provider.model:catalog.connection.model))].map(model=><option key={model} value={model}>{model}</option>)}</select></label>
     <button className={setupButton} onClick={()=>setCatalog(null)}>{t('modelService.cancel')}</button></section>}
    {selected&&<form className={card} onSubmit={event=>{event.preventDefault();void perform(async()=>{await setCredential(selected,credential);setKeyInput('');setSelected(null);});}}>
     <label className="text-sm">{t('modelService.keyLabel',{name:selected.name})}<input className={field} type="password" autoComplete="off" value={credential} onChange={event=>setKeyInput(event.target.value)} required/></label>
     <div className="mt-4 flex flex-wrap gap-2"><button className={setupPrimary+feedback} disabled={busy}>{t('modelService.pageOnly')}</button><button type="button" className={setupButton+feedback} onClick={()=>{setSelected(null);setKeyInput('');}}>{t('modelService.cancel')}</button></div>
    </form>}
    {addLocal&&<ConnectionForm title={t('modelService.addLocal')} label={t('modelService.optionalKey')} note={t('modelService.keyNote')} keyRequired={false} busy={busy} onCancel={()=>setAddLocal(false)} onSubmit={async input=>{await perform(async()=>{await saveProvider(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,name:input.name.trim(),endpoint:input.endpoint.trim(),model:input.model.trim(),kind:'compatible'},input.key);setAddLocal(false);});}}/>}
   </div>

   <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">{t('modelService.accountGroup')}</h3>{account.onlineService&&!addAccount&&accountModels?.vaultConfigured&&<button className={setupButton+feedback} disabled={busy} onClick={()=>setAddAccount(true)}>{t('modelService.addAccount')}</button>}</div>
    <p className={hintText}>{t('modelService.accountGroupNote')}</p>
    {!account.onlineService&&<p className={hintText}>{t('modelService.accountLoginRequired')}</p>}
    {account.onlineService&&accountError&&<p role="status" className={hintText}>{t(accountError)}</p>}
    {account.onlineService&&accountModels&&!accountModels.vaultConfigured&&<p role="status" className={hintText}>{t('localFlow.accountVault')}</p>}
    {account.onlineService&&accountModels?.vaultConfigured&&accountModels.allowedOrigins.length>0&&<p className={hintText}>{t('modelService.allowedOrigins')}{accountModels.allowedOrigins.join(' · ')}</p>}
    {account.onlineService&&accountLoaded&&accountModels?.vaultConfigured&&accountConnections.length===0&&!addAccount&&<p className={hintText}>{t('modelService.accountEmpty')}</p>}
    {accountConnections.map(connection=><article key={connection.id} className={card}>
     <h4 className="font-medium">{connection.name} · {connection.model}</h4>
     <p className="mt-2 break-all text-sm text-fg-secondary">{connection.baseUrl}</p>
     <p className="mt-2 flex flex-wrap items-center gap-3 text-sm">{connection.keyConfigured?t('modelService.keyConfigured'):t('modelService.keyAbsent')}<span className={`${chipBase} border-border-strong text-fg-secondary`}>{t('modelService.executionService')}</span></p>
     <div className="mt-3 flex flex-wrap gap-2">
      <button className={setupButton+feedback} disabled={busy} onClick={()=>void perform(async()=>{setCatalog({kind:'account',connection,models:await listAccountConnectionModels(connection.id)});})}>{t('modelService.modelList')}</button>
      <button className={setupButton+feedback} disabled={busy} onClick={()=>setEditing(connection)}>{t('modelService.updateAccount')}</button>
      <button className={setupButton+feedback} disabled={busy} onClick={()=>void perform(()=>removeAccountConnection(accountModels!,connection.id))}>{t('modelService.remove')}</button>
     </div>
    </article>)}
    {editing&&accountModels&&<ConnectionForm title={t('modelService.updateAccount')} label={t('modelService.optionalKey')} note={t('modelService.accountKeyKeep')} keyRequired={false} initial={{name:editing.name,endpoint:editing.baseUrl,model:editing.model}} busy={busy} onCancel={()=>setEditing(null)} onSubmit={async input=>{await perform(async()=>{const {keyConfigured,...connection}=editing;await updateAccountConnection(accountModels,{...connection,name:input.name.trim(),baseUrl:input.endpoint.trim(),model:input.model.trim(),...(input.key.trim()?{key:input.key}:{})});setEditing(null);});}}/>}
    {addAccount&&accountModels&&<ConnectionForm title={t('modelService.addAccount')} label={t('modelService.key')} note={t('modelService.accountKeyNote')} keyRequired busy={busy} onCancel={()=>setAddAccount(false)} onSubmit={async input=>{await perform(async()=>{await addAccountConnection(accountModels,{id:crypto.randomUUID(),name:input.name.trim(),baseUrl:input.endpoint.trim(),model:input.model.trim(),enabled:true,key:input.key});setAddAccount(false);});}}/>}
   </div>
  </section>

  <details className="rounded-card border border-border-subtle p-5">
   <summary className="cursor-pointer font-medium">{t('modelService.diagnostics')}</summary>
   <div className="mt-4"><ModelExecutionPanel/></div>
  </details>
 </div>;
}
