import {useEffect,useState} from 'react';
import type {AccountContext,CatalogTarget,TargetView} from '@sensa/contracts/sensa';
import {readCatalog,readTarget,checkMaterial,readMaterialAudio} from '../data/consumer/client';
import type {AccountReplica} from '../data/replica/accountStore';
import {setupButton,setupPrimary} from '../experience/components/learning/LearningSetupFrame';
export function TargetLibrary({account,replica,onSubmit,onHome,onMastery}:{account:AccountContext;replica:AccountReplica;onSubmit:(candidate:CatalogTarget,retry?:TargetView)=>Promise<void>;onHome:()=>void;onMastery:(target:TargetView)=>Promise<void>}){
 const [audio,setAudio]=useState<string|null>(null);
 useEffect(()=>()=>{if(audio)URL.revokeObjectURL(audio);},[audio]);
 const [items,setItems]=useState<CatalogTarget[]>(replica.catalog);const [query,setQuery]=useState('');const [cursor,setCursor]=useState<string|null>(null);
 const [selection,setSelection]=useState<TargetView|null>(null);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [loaded,setLoaded]=useState(false);
 async function search(more=false){setBusy(true);setNotice('');try{const page=await readCatalog(account,query,more?cursor??undefined:undefined);setItems(previous=>more?[...previous,...page.items]:page.items);setCursor(page.nextCursor);setLoaded(true);}catch{setNotice('暂时无法读取内容，显示的是上次保存的列表。请联网重试。');}finally{setBusy(false);}}
 useEffect(()=>{void search();},[account.accountId]);
 async function open(candidate:CatalogTarget){setBusy(true);setNotice('');
  const cached=Object.values(replica.targets).find(x=>x.candidate.senseId===candidate.senseId&&x.candidate.bindingId===candidate.bindingId);
  setSelection(cached??{candidate,learningTarget:null,retentionTarget:null,membership:null,plan:null,declaredMastery:{active:false,revision:'0'},phase:'new',dueAt:null});
  try{setSelection(await readTarget(account,candidate.candidateId,true));}catch{setNotice('暂时无法更新目标状态。已保存的请求仍会保留，请联网后检查。');}finally{setBusy(false);}}
 const view=selection?(Object.values(replica.targets).find(x=>x.candidate.senseId===selection.candidate.senseId&&x.candidate.bindingId===selection.candidate.bindingId)??selection):null;
 const pending=!!view&&replica.outbox.some(x=>x.state==='pending'&&((x.operation.kind==='curriculum.add_target'&&x.operation.payload.candidateId===view.candidate.candidateId)||(x.operation.kind==='learning.retry_preparation'&&x.operation.payload.learningTargetId===view.learningTarget?.learningTargetId)));
 async function submit(retry=false){if(!view)return;setBusy(true);setNotice('');try{await onSubmit(view.candidate,retry?view:undefined);}catch{setNotice('暂时无法完成。请检查同步结果后重试。');}finally{setBusy(false);}}
 async function inspectMaterial(){if(!view?.plan?.materializationId)return;setBusy(true);try{const material=await checkMaterial(view.plan.materializationId);const reference=material.content.resources.find(r=>r.materialRoleKey==='pronunciation')?.contentPayload.audioUrl;
   if(typeof reference==='string'&&reference.startsWith('sensa-media:'))setAudio(URL.createObjectURL(await readMaterialAudio(material.id,reference.slice(12))));
   setNotice('学习材料已读取，可以返回首页。');}catch{setNotice('暂时无法读取学习材料，请联网后重试。');}finally{setBusy(false);}}
 const status=notice?<p role="status" className="rounded-xl bg-[#edf0f7] p-4 text-sm leading-6">{notice}</p>:null;
 if(view)return <div className="space-y-5"><button className={setupButton} onClick={()=>{setSelection(null);setNotice('');setAudio(null);}}>返回学习内容</button>
  <h2 className="text-3xl font-semibold">{view.candidate.expression}</h2><p className="text-xl leading-8">{view.candidate.meaning}</p><p className="text-sm text-[#68748d]">轻量学习 · {view.candidate.source.kind==='book'?'词书内容':'已发布内容'}</p>
  {status}{audio&&<audio aria-label="目标表达发音" controls src={audio} className="max-w-full"/>}{pending&&<p role="status">加入请求已保存在本机，等待确认。</p>}
  {view.membership?<div className="rounded-2xl border p-5 space-y-4"><p>已在学习中</p>
   {view.declaredMastery.active&&<p>你已将此目标标记为已会。可以撤销声明，恢复学习安排。</p>}
   <button className={setupButton} disabled={busy||pending} onClick={()=>{setBusy(true);void onMastery(view).catch(()=>setNotice('声明尚未确认，请检查同步结果。')).finally(()=>setBusy(false));}}>{view.declaredMastery.active?'撤销已会声明':'标记为已会'}</button>
   <h3 className="text-xl">{view.plan?.readiness==='ready'?'学习内容已准备好':view.plan?.readiness==='preparing'?'学习内容准备中':'这项内容暂时无法用于轻量学习'}</h3>
   {view.plan?.readiness==='blocked'&&<p>{view.plan.reason==='media_missing'?'还需要可用的音频材料。目标已保留。':'材料尚未通过校验。目标已保留，可先选择其他内容。'}</p>}
   {view.plan?.retryAllowed&&<button className={setupButton} disabled={busy||pending} onClick={()=>void submit(true)}>重试准备</button>}
   {view.plan?.readiness==='ready'&&<button className={setupButton} disabled={busy} onClick={()=>void inspectMaterial()}>检查学习材料</button>}
   <button className={setupPrimary} onClick={onHome}>回首页</button></div>:
   <button className={setupPrimary} disabled={busy||pending||view.candidate.admission!=='available'} onClick={()=>void submit()}>{pending?'等待加入确认':view.candidate.admission==='available'?'加入学习':'暂不支持学习'}</button>}
 </div>;
 return <div className="space-y-5"><h2 className="text-2xl font-semibold">选择想学的意思</h2><p className="text-[#68748d]">先查看具体意思，再决定是否加入学习。</p>
  <form className="flex gap-3" onSubmit={e=>{e.preventDefault();void search();}}><input aria-label="搜索表达或意思" value={query} onChange={e=>setQuery(e.target.value)} className="min-w-0 flex-1 rounded-xl border bg-white p-3"/><button className={setupButton} disabled={busy}>搜索</button></form>
  {status}{!loaded&&busy&&<p role="status">正在读取学习内容…</p>}{loaded&&!items.length&&<p>{query?'没有找到匹配的意思。':'还没有已发布的学习内容。'}</p>}
  <div className="space-y-3">{items.map(c=><button key={c.candidateId} className="block w-full rounded-2xl border bg-white p-5 text-left" onClick={()=>void open(c)}><span className="block text-xl font-semibold">{c.expression}</span><span className="mt-2 block leading-7 text-[#68748d]">{c.meaning}</span></button>)}</div>
  {cursor&&<button className={setupButton} disabled={busy} onClick={()=>void search(true)}>加载更多</button>}
 </div>;
}
