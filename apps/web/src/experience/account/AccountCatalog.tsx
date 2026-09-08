import {LearningEntryScreen} from '../components/learning/LearningEntryScreen';
import {LearningTargetDetailScreen} from '../components/learning/LearningTargetDetailScreen';
import {presentTarget} from './projections';
import {useEffect,useState} from 'react';
import type {AccountContext,CatalogTarget,TargetView} from '@sensa/contracts/sensa';
import {readCatalog,readTarget,checkMaterial,readMaterialAudio} from '../../data/consumer/client';
import type {AccountReplica} from '../../data/replica/accountStore';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
export function AccountCatalog({status:globalStatus,screenId,account,replica,onSubmit,onHome,onMastery,onBack,onPersonal,initialTarget,onPrepare}:{status?:import('react').ReactNode;screenId:string;onPrepare:(target:TargetView,cancel?:boolean)=>Promise<void>;initialTarget?:TargetView|null;onBack:()=>void;onPersonal:()=>void;account:AccountContext;replica:AccountReplica;onSubmit:(candidate:CatalogTarget,retry?:TargetView)=>Promise<void>;onHome:()=>void;onMastery:(target:TargetView)=>Promise<void>}){
 const [audio,setAudio]=useState<string|null>(null);
 useEffect(()=>()=>{if(audio)URL.revokeObjectURL(audio);},[audio]);
 const [items,setItems]=useState<CatalogTarget[]>(replica.catalog);const [query,setQuery]=useState('');const [cursor,setCursor]=useState<string|null>(null);
 const [selection,setSelection]=useState<TargetView|null>(initialTarget??null);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [loaded,setLoaded]=useState(false);
 async function search(more=false,searchQuery=query){setBusy(true);setNotice('');try{const page=await readCatalog(account,searchQuery,more?cursor??undefined:undefined);setItems(previous=>more?[...previous,...page.items]:page.items);setCursor(page.nextCursor);setLoaded(true);}catch{setNotice('暂时无法读取内容，显示的是上次保存的列表。请联网重试。');}finally{setBusy(false);}}
 useEffect(()=>{void search();const candidate=new URLSearchParams(location.search).get('candidate');if(candidate)void readTarget(account,candidate,true).then(setSelection).catch(()=>setNotice('暂时无法读取这个意思，请联网后重试。'));},[account.accountId]);
 async function open(candidate:CatalogTarget){const url=new URL(location.href);url.searchParams.set('candidate',candidate.candidateId);history.replaceState(history.state,'',url);setBusy(true);setNotice('');
  const cached=Object.values(replica.targets).find(x=>x.candidate.senseId===candidate.senseId&&x.candidate.bindingId===candidate.bindingId);
  setSelection(cached??{candidate,learningTarget:null,retentionTarget:null,membership:null,plan:null,declaredMastery:{active:false,revision:'0'},phase:'new',dueAt:null});
  try{setSelection(await readTarget(account,candidate.candidateId,true));}catch{setNotice('暂时无法更新目标状态。已保存的请求仍会保留，请联网后检查。');}finally{setBusy(false);}}
 const view=selection?(Object.values(replica.targets).find(x=>x.candidate.senseId===selection.candidate.senseId&&x.candidate.bindingId===selection.candidate.bindingId)??selection):Object.values(replica.targets).find(x=>x.candidate.candidateId===new URLSearchParams(location.search).get('candidate'))??null;
 const pending=!!view&&replica.outbox.some(x=>x.state==='pending'&&((x.operation.kind==='curriculum.add_target'&&x.operation.payload.candidateId===view.candidate.candidateId)||(x.operation.kind==='learning.retry_preparation'&&x.operation.payload.learningTargetId===view.learningTarget?.learningTargetId)));
 async function submit(retry=false){if(!view)return;setBusy(true);setNotice('');try{await onSubmit(view.candidate,retry?view:undefined);}catch{setNotice('暂时无法完成。请检查同步结果后重试。');}finally{setBusy(false);}}
 async function inspectMaterial(){if(!view?.plan?.materializationId)return;setBusy(true);try{const material=await checkMaterial(view.plan.materializationId);const reference=material.content.resources.find(r=>r.materialRoleKey==='pronunciation')?.contentPayload.audioUrl;
   if(typeof reference==='string'&&reference.startsWith('sensa-media:'))setAudio(URL.createObjectURL(await readMaterialAudio(material.id,reference.slice(12))));
   setNotice('学习材料已读取，可以返回首页。');}catch{setNotice('暂时无法读取学习材料，请联网后重试。');}finally{setBusy(false);}}
 const status=<>{globalStatus}{notice?<p role="status" className="rounded-xl bg-[#edf0f7] p-4 text-sm leading-6">{notice}</p>:null}</>;
 if(view){
  const target=presentTarget(view.candidate,view),isPersonal=view.candidate.source.kind==='personal_alignment';
  return <LearningTargetDetailScreen screenId={screenId} active target={target} selectedPolicy="lightweight" fixedPolicy preparation={view.plan?.readiness??'preparing'} committedPolicy={view.phase==='acquiring'?'lightweight':null} initialCompletionKind={view.phase==='retaining'?'study_completion':null} reviewDue={!!view.dueAt&&Date.parse(view.dueAt)<=Date.now()} relearning={false} retentionRuntimeState={null} nextReviewLabel={view.dueAt?new Date(view.dueAt).toLocaleString():null} declaredMastery={view.declaredMastery.active} isAdded={!!view.membership} onBack={()=>{if(initialTarget)onBack();else {const url=new URL(location.href);url.searchParams.delete('candidate');history.replaceState(history.state,'',url);setSelection(null);setNotice('');setAudio(null);}}} onAdd={()=>void submit()} onOpenPolicy={()=>{}} onOpenSource={isPersonal?onPersonal:()=>{setSelection(null);setNotice('');}} onRefreshPreparation={()=>void submit(true)} onGoHome={onHome} onStartReview={onHome} onContinueRetentionRuntime={onHome} onContinueRuntime={onHome} onRevokeDeclaredMastery={()=>void onMastery(view)} notice={<>{status}{pending&&<p role="status">加入请求已保存在本机，等待确认。</p>}</>} actions={<div className="mt-7 space-y-3">
   {audio&&<audio aria-label="目标表达发音" controls src={audio} className="max-w-full"/>}
   {view.membership?<>
    <p>已在学习中</p><h3 className="text-lg">{view.plan?.readiness==='ready'?'学习内容已准备好':view.plan?.readiness==='preparing'?'学习内容准备中':'这项内容暂时无法用于轻量学习'}</h3>
    <button className={setupButton+' w-full border border-[#e0e5ee]'} disabled={busy||pending||view.phase==='acquiring'} onClick={()=>{setBusy(true);void onMastery(view).catch(()=>setNotice('声明尚未确认，请检查同步结果。')).finally(()=>setBusy(false));}}>{view.declaredMastery.active?'撤销已会声明':'标记为已会'}</button>
    {view.plan?.readiness==='blocked'&&<p className="text-sm text-[#68748d]">{view.plan.reason==='media_missing'?'还需要可用的音频材料。目标已保留。':'材料尚未通过校验。目标已保留，可先选择其他内容。'}</p>}
    {(view.plan?.retryAllowed||isPersonal&&view.plan?.readiness==='preparing')&&<button className={setupButton} disabled={busy||pending} onClick={()=>{if(!isPersonal){void submit(true);return;}setBusy(true);void onPrepare(view).catch(()=>setNotice('准备结果尚未确认，请检查原任务。')).finally(()=>setBusy(false));}}>{view.plan?.readiness==='blocked'?'重试准备':'准备 / 检查学习内容'}</button>}
    {isPersonal&&view.plan?.readiness==='preparing'&&<button className={setupButton} onClick={()=>void onPrepare(view,true).catch(()=>setNotice('取消尚未确认。'))}>取消准备</button>}
    {view.plan?.readiness==='ready'&&<button className={setupButton} disabled={busy} onClick={()=>void inspectMaterial()}>检查学习材料</button>}
    <button className={setupPrimary+' w-full'} onClick={onHome}>回首页</button>
   </>:<button className={setupPrimary+' w-full'} disabled={busy||pending||view.candidate.admission!=='available'} onClick={()=>void submit()}>{pending?'等待加入确认':view.candidate.admission==='available'?'加入学习':'暂不支持学习'}</button>}
  </div>}/>;
 }
 return <LearningEntryScreen screenId={screenId} active onBack={onBack} onOpenPersonalSemanticWorld={onPersonal} onOpenTarget={id=>{const candidate=items.find(x=>x.candidateId===id);if(candidate)void open(candidate);}} catalog={items.map(item=>presentTarget(item))} status={<>{status}{!loaded&&busy&&<p role="status">正在读取学习内容…</p>}{loaded&&!items.length&&!query&&<p role="status">还没有已发布的学习内容。</p>}</>} busy={busy} onSearch={value=>{setQuery(value);void search(false,value);}} onMore={cursor?()=>void search(true):undefined}/>;
}
