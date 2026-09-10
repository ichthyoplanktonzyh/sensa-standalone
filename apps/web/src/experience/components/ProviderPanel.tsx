import {readServiceStatus} from '../../data/library/serviceStatus';
import type {ServiceStatus} from '@sensa/contracts/sensa';
import {useAccountExperience} from '../account/AccountExperience';
import {useEffect,useState,useRef} from 'react';
import {assignProvider,clearCredential,deleteProvider,hasCredential,providerSnapshot,purposes,purposeLabels,saveProvider,setCredential,type Provider,type ProviderSettings} from '../../data/library/providers';
import {setupButton,setupPrimary} from './learning/LearningSetupFrame';
const field='mt-2 block min-h-11 w-full rounded-xl border border-[#cbd1df] bg-white p-3';
export function ProviderPanel(){
 const account=useAccountExperience();
 const [service,setService]=useState<ServiceStatus|null>(null),[serviceError,setServiceError]=useState('');
 const statusGeneration=useRef(0);
 const refreshService=async()=>{const gen=++statusGeneration.current;setService(null);setServiceError('');try{const next=await readServiceStatus();if(gen===statusGeneration.current)setService(next);}catch(e){if(gen===statusGeneration.current)setServiceError(e instanceof Error?e.message:'服务状态暂不可用。');}};
 useEffect(()=>{if(account.onlineService)void refreshService();else setService(null);return()=>{statusGeneration.current++;};},[account.onlineService,account.email]);
 const [providers,setProviders]=useState<Provider[]>([]),[settings,setSettings]=useState<ProviderSettings>({revision:0,assignments:{}});
 const [name,setName]=useState(''),[endpoint,setEndpoint]=useState(''),[model,setModel]=useState(''),[kind,setKind]=useState<'compatible'|'sensa'>('compatible'),[key,setKey]=useState('');
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<Provider|null>(null),[credential,setKeyInput]=useState('');
 const refresh=async()=>{const snapshot=await providerSnapshot();setProviders(snapshot.providers);setSettings(snapshot.settings);};
 useEffect(()=>{void refresh().catch(()=>setNotice('无法读取本机模型配置，请重试。'));},[]);
 const perform=async(work:()=>Promise<unknown>)=>{setBusy(true);setNotice('');try{await work();await refresh();}catch(e){setNotice(e instanceof Error?e.message:'未能保存配置，请重试。');}finally{setBusy(false);}};
 return <div className="space-y-8">
  <header><h2 className="text-2xl font-semibold">Sensa 服务</h2><p className="mt-3 leading-7 text-[#68748d]">解释与澄清默认由 Sensa 提供，无需配置模型。已有学习内容可在本机继续使用。</p><p className="mt-3 text-sm">{account.onlineService?"已连接账号，具体功能按服务权限开放。":"在线服务尚未连接。"}</p>{!account.onlineService&&<button className={setupButton} onClick={account.login}>登录 Sensa</button>}{service&&<div className="mt-5 space-y-2"><p>{service.explanationAvailable?'解释与澄清服务可用':'解释与澄清服务暂不可用'}</p><p className="text-sm text-[#68748d]">最近 24 小时的请求用量（各项独立限制，含已预约请求）</p>{service.usage.map(u=><p key={u.kind}>{({reading:'网页阅读',teacher:'澄清与解析',content:'材料准备'})[u.kind]}：{u.used} / {u.limit}{u.used>=u.limit?' · 已达上限，请稍后再试':''}</p>)}<p className="text-xs text-[#68748d]">此处显示在线服务用量，不代表同步已启用或学习材料已准备完成。</p></div>}{serviceError&&<p role="status" className="mt-3">{serviceError}</p>}<button className={setupButton} onClick={()=>void refreshService()}>刷新服务状态</button></header>
  {notice&&<p role="status" className="rounded-xl bg-[#edf0f7] p-4">{notice}</p>}
  <details className="rounded-2xl border border-[#e0e5ee] p-5"><summary className="cursor-pointer font-medium">高级设置 · 自定义模型服务</summary><div className="mt-6 space-y-6">
  <div className="grid gap-5 sm:grid-cols-3">{purposes.map(purpose=><label key={purpose} className="text-sm">{purposeLabels[purpose]}<select aria-label={purposeLabels[purpose]} className={field} value={settings.assignments[purpose]??''} disabled={busy} onChange={e=>void perform(()=>assignProvider(crypto.randomUUID(),purpose,e.target.value||null,settings.revision))}><option value="">默认使用 Sensa</option>{providers.map(p=><option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</select></label>)}</div>
  <p className="text-sm leading-7 text-[#68748d]">生成和审核可以使用同一个连接，但审核会以独立请求执行。不会自动切换到其他服务。</p>
  <div className="space-y-3">{providers.filter(provider=>provider.id!=="00000000-0000-4000-8000-000000000002").map(provider=><article key={provider.id} className="rounded-2xl border border-[#e0e5ee] p-5"><h3 className="font-medium">{provider.name} · {provider.model}</h3><p className="mt-2 break-all text-sm text-[#68748d]">{provider.endpoint}</p><p className="mt-2 text-sm">{provider.kind==='sensa'?'使用当前 Sensa 登录身份':hasCredential(provider)?'当前页面已填写 Key':'当前页面尚未填写 Key'}</p><div className="mt-3 flex flex-wrap gap-2">{provider.kind==='compatible'&&<><button className={setupButton} disabled={busy} onClick={()=>{setSelected(provider);setKeyInput('');}}>填写或更换 Key</button><button className={setupButton} disabled={busy} onClick={()=>{clearCredential(provider.id);void refresh();}}>忘记当前 Key</button></>}<button className={setupButton} disabled={busy} onClick={()=>void perform(()=>deleteProvider(crypto.randomUUID(),provider))}>移除连接</button></div></article>)}</div>
  {selected&&<form className="rounded-2xl border border-[#cbd1df] p-5" onSubmit={e=>{e.preventDefault();void perform(async()=>{await setCredential(selected,credential);setKeyInput('');setSelected(null);});}}><label className="text-sm">{selected.name} 的 Key<input className={field} type="password" autoComplete="off" value={credential} onChange={e=>setKeyInput(e.target.value)} required/></label><button className={setupPrimary+' mt-4'} disabled={busy}>仅在当前页面使用</button><button type="button" className={setupButton} onClick={()=>{setSelected(null);setKeyInput('');}}>取消</button></form>}
  <form className="space-y-5 border-t border-[#e0e5ee] pt-7" onSubmit={e=>{e.preventDefault();void perform(async()=>{await saveProvider(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,name,endpoint,model,kind},key);setName('');setEndpoint('');setModel('');setKey('');setNotice('连接已保存在本机，请选择它的用途。');});}}>
   <h3 className="text-lg font-medium">添加连接</h3>
   <label className="block text-sm">连接名称<input className={field} maxLength={80} value={name} onChange={e=>setName(e.target.value)} required/></label>
   <label className="block text-sm">服务类型<select className={field} value={kind} onChange={e=>{const next=e.target.value as typeof kind;setKind(next);setKey('');setEndpoint(next==='sensa'?(import.meta.env.VITE_SENSA_API_URL??''):'');}}><option value="compatible">OpenAI 兼容服务</option><option value="sensa">Sensa 在线服务</option></select></label>
   <label className="block text-sm">服务地址<input className={field} type="url" value={endpoint} onChange={e=>setEndpoint(e.target.value)} placeholder="https://服务地址/v1" required/></label>
   <label className="block text-sm">模型名称<input className={field} maxLength={100} value={model} onChange={e=>setModel(e.target.value)} required/></label>
   {kind==='compatible'&&<label className="block text-sm">Key（可稍后填写）<input className={field} type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)}/></label>}
   <p className="text-sm leading-7 text-[#68748d]">Key 仅保留在当前页面内存，刷新或关闭后需要重新填写。浏览器直接连接的服务需要允许跨域请求；连接失败时会保留本机资料。Sensa 服务需要单独登录。</p>
   <button className={setupPrimary} disabled={busy}>保存连接</button>
  </form>
 </div></details>
 </div>;
}
