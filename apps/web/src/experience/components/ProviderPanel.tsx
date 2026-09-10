import {localFlowErrorKey} from '../../i18n/localFlowText';
import {useTranslation} from 'react-i18next';
import {readServiceStatus} from '../../data/library/serviceStatus';
import type {ServiceStatus} from '@sensa/contracts/sensa';
import {useAccountExperience} from '../account/AccountExperience';
import {useEffect,useState,useRef} from 'react';
import {assignProvider,clearCredential,deleteProvider,hasCredential,providerSnapshot,purposes,saveProvider,setCredential,type Provider,type ProviderSettings} from '../../data/library/providers';
import {setupButton,setupPrimary} from './learning/LearningSetupFrame';
const feedback=' transition-colors hover:bg-[#e6ebf5] active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5268a9] disabled:cursor-not-allowed disabled:opacity-50';
const field='mt-2 block min-h-11 w-full rounded-xl border border-[#cbd1df] bg-white p-3';
export function ProviderPanel(){
 const {t}=useTranslation();
 const account=useAccountExperience();
 const [service,setService]=useState<ServiceStatus|null>(null),[serviceError,setServiceError]=useState('');
 const statusGeneration=useRef(0);const [refreshing,setRefreshing]=useState(false),[refreshed,setRefreshed]=useState(false);
 const refreshService=async()=>{const gen=++statusGeneration.current;setRefreshing(true);setRefreshed(false);setServiceError('');try{const next=await readServiceStatus();if(gen===statusGeneration.current){setService(next);setRefreshed(true);}}catch(e){if(gen===statusGeneration.current)setServiceError(localFlowErrorKey(e,'modelService.statusFailed'));}finally{if(gen===statusGeneration.current)setRefreshing(false);}};
 useEffect(()=>{if(account.onlineService)void refreshService();else{setService(null);setRefreshing(false);setRefreshed(false);setServiceError('');}return()=>{statusGeneration.current++;};},[account.onlineService,account.email]);
 const [providers,setProviders]=useState<Provider[]>([]),[settings,setSettings]=useState<ProviderSettings>({revision:0,assignments:{}});
 const [name,setName]=useState(''),[endpoint,setEndpoint]=useState(''),[model,setModel]=useState(''),[kind,setKind]=useState<'compatible'|'sensa'>('compatible'),[key,setKey]=useState('');
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<Provider|null>(null),[credential,setKeyInput]=useState('');
 const refresh=async()=>{const snapshot=await providerSnapshot();setProviders(snapshot.providers);setSettings(snapshot.settings);};
 useEffect(()=>{void refresh().catch(()=>setNotice('modelService.readFailed'));},[]);
 const perform=async(work:()=>Promise<unknown>)=>{setBusy(true);setNotice('');try{await work();await refresh();setNotice('modelService.updated');}catch(e){setNotice(localFlowErrorKey(e,'modelService.saveFailed'));}finally{setBusy(false);}};
 return <div className="space-y-8">
  <header><h2 className="text-2xl font-semibold">{t('modelService.title')}</h2><p className="mt-3 leading-7 text-[#68748d]">{t('modelService.intro')}</p><p className="mt-3 text-sm">{account.onlineService?t('modelService.connected'):t('modelService.disconnected')}</p>{!account.onlineService&&<button className={setupButton+feedback} onClick={account.login}>{t('modelService.login')}</button>}{service&&<div className="mt-5 space-y-2"><p>{service.explanationAvailable?t('modelService.available'):t('modelService.unavailable')}</p><p className="text-sm text-[#68748d]">{t('modelService.usage')}</p>{service.usage.map(u=><p key={u.kind}>{({reading:t('modelService.reading'),teacher:t('modelService.teacher'),content:t('modelService.content')})[u.kind]}：{u.used} / {u.limit}{u.used>=u.limit?t('modelService.limit'):''}</p>)}</div>}{serviceError&&<p role="status" className="mt-3">{t(serviceError)}</p>}<button className={setupButton+feedback} disabled={refreshing} aria-busy={refreshing} onClick={()=>void refreshService()}>{t(refreshing?'modelService.refreshing':'modelService.refresh')}</button>{refreshed&&!refreshing&&<p role="status" className="mt-3 text-sm text-emerald-700">{t('modelService.refreshed')}</p>}</header>
  {notice&&<p role="status" className="rounded-xl bg-[#edf0f7] p-4">{t(notice)}</p>}
  <details className="rounded-2xl border border-[#e0e5ee] p-5"><summary className="cursor-pointer font-medium">{t('modelService.advanced')}</summary><div className="mt-6 space-y-6">
  <div className="grid gap-5 sm:grid-cols-3">{purposes.map(purpose=><label key={purpose} className="text-sm">{t('modelService.'+({teacher:'purposeTeacher',content:'purposeContent',review:'purposeReview'})[purpose])}<select aria-label={t('modelService.'+({teacher:'purposeTeacher',content:'purposeContent',review:'purposeReview'})[purpose])} className={field} value={settings.assignments[purpose]??''} disabled={busy} onChange={e=>void perform(()=>assignProvider(crypto.randomUUID(),purpose,e.target.value||null,settings.revision))}><option value="">{t('modelService.default')}</option>{providers.map(p=><option key={p.id} value={p.id}>{p.id==='00000000-0000-4000-8000-000000000002'?t('modelService.title'):p.name} · {p.model}</option>)}</select></label>)}</div>
  <p className="text-sm leading-7 text-[#68748d]">{t('modelService.reviewNote')}</p>
  <div className="space-y-3">{providers.filter(provider=>provider.id!=="00000000-0000-4000-8000-000000000002").map(provider=><article key={provider.id} className="rounded-2xl border border-[#e0e5ee] p-5"><h3 className="font-medium">{provider.name} · {provider.model}</h3><p className="mt-2 break-all text-sm text-[#68748d]">{provider.endpoint}</p><p className="mt-2 text-sm">{provider.kind==='sensa'?t('modelService.accountCredential'):hasCredential(provider)?t('modelService.keyPresent'):t('modelService.keyAbsent')}</p><div className="mt-3 flex flex-wrap gap-2">{provider.kind==='compatible'&&<><button className={setupButton+feedback} disabled={busy} onClick={()=>{setSelected(provider);setKeyInput('');}}>{t('modelService.changeKey')}</button><button className={setupButton+feedback} disabled={busy} onClick={()=>{clearCredential(provider.id);void refresh();}}>{t('modelService.forget')}</button></>}<button className={setupButton+feedback} disabled={busy} onClick={()=>void perform(()=>deleteProvider(crypto.randomUUID(),provider))}>{t('modelService.remove')}</button></div></article>)}</div>
  {selected&&<form className="rounded-2xl border border-[#cbd1df] p-5" onSubmit={e=>{e.preventDefault();void perform(async()=>{await setCredential(selected,credential);setKeyInput('');setSelected(null);});}}><label className="text-sm">{t('modelService.keyLabel',{name:selected.name})}<input className={field} type="password" autoComplete="off" value={credential} onChange={e=>setKeyInput(e.target.value)} required/></label><button className={setupPrimary+' mt-4'} disabled={busy}>{t('modelService.pageOnly')}</button><button type="button" className={setupButton+feedback} onClick={()=>{setSelected(null);setKeyInput('');}}>{t('modelService.cancel')}</button></form>}
  <form className="space-y-5 border-t border-[#e0e5ee] pt-7" onSubmit={e=>{e.preventDefault();void perform(async()=>{await saveProvider(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,name,endpoint,model,kind},key);setName('');setEndpoint('');setModel('');setKey('');setNotice('modelService.saved');});}}>
   <h3 className="text-lg font-medium">{t('modelService.add')}</h3>
   <label className="block text-sm">{t('modelService.name')}<input className={field} maxLength={80} value={name} onChange={e=>setName(e.target.value)} required/></label>
   <label className="block text-sm">{t('modelService.kind')}<select className={field} value={kind} onChange={e=>{const next=e.target.value as typeof kind;setKind(next);setKey('');setEndpoint(next==='sensa'?(import.meta.env.VITE_SENSA_API_URL??''):'');}}><option value="compatible">{t('modelService.compatible')}</option><option value="sensa">{t('modelService.sensa')}</option></select></label>
   <label className="block text-sm">{t('modelService.endpoint')}<input className={field} type="url" value={endpoint} onChange={e=>setEndpoint(e.target.value)} placeholder="https://api.example.com/v1" required/></label>
   <label className="block text-sm">{t('modelService.model')}<input className={field} maxLength={100} value={model} onChange={e=>setModel(e.target.value)} required/></label>
   {kind==='compatible'&&<label className="block text-sm">{t('modelService.optionalKey')}<input className={field} type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)}/></label>}
   <p className="text-sm leading-7 text-[#68748d]">{t('modelService.keyNote')}</p>
   <button className={setupPrimary+feedback} disabled={busy}>{t('modelService.save')}</button>
  </form>
 </div></details>
 </div>;
}
