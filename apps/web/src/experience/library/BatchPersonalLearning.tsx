import {useState,type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import type {LocalMeaning} from '../../data/library/teacher';
import type {JourneyWorldItemView} from '../personalMeaningJourney';
import type {usePersonalLearning} from './usePersonalLearning';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';

export function BatchPersonalLearning({items,meanings,c,children}:{items:JourneyWorldItemView[];meanings:LocalMeaning[];c:ReturnType<typeof usePersonalLearning>;children:ReactNode}){
 useTranslation();
 const [selecting,setSelecting]=useState(false),[selected,setSelected]=useState<string[]>([]),[confirming,setConfirming]=useState(false),[useContext,setUseContext]=useState(false);
 const meaningFor=(item:JourneyWorldItemView)=>meanings.find(m=>m.draftId===item.personalMeaningId);
 const ready=(id:string)=>c.tasks.some(t=>t.id===id&&t.status==='ready');
 const eligible=items.flatMap(item=>{const m=meaningFor(item);return m&&!ready(m.id)?[m.id]:[];});
 const chosen=selected.filter(id=>meanings.some(m=>m.id===id)&&!ready(id));
 const failed=c.batch.filter(r=>r.status==='failed').map(r=>r.id);
 const remaining=c.batch.filter(r=>r.status==='waiting').map(r=>r.id);
 const run=async(ids:string[])=>{setConfirming(false);await c.enrollBatch(ids,useContext);};
 return <div>
  {c.notice&&<p role="status" className="mb-4 text-sm text-red-700">{c.notice}</p>}
  <div className="mb-4 flex flex-wrap items-center gap-3">
   <button className={setupButton} disabled={c.busy} aria-pressed={selecting} onClick={()=>{setSelecting(!selecting);setConfirming(false);}}>{localFlowText(selecting?'batchDone':'batchSelect')}</button>
   {selecting&&<>
    <button className={setupButton} disabled={c.busy||!eligible.length} onClick={()=>setSelected([...new Set([...selected,...eligible])])}>{localFlowText('batchSelectVisible')}</button>
    <button className={setupButton} disabled={c.busy||!selected.length} onClick={()=>{setSelected([]);setConfirming(false);}}>{localFlowText('batchClear')}</button>
    <button className={setupPrimary} disabled={c.busy||!chosen.length} onClick={()=>setConfirming(true)}>{localFlowText('batchEnroll',{count:chosen.length})}</button>
   </>}
  </div>
  {confirming&&<section aria-label={localFlowText('batchConfirm')} className="mb-5 space-y-4 rounded-2xl border border-[#bdc8dd] bg-white p-5">
   <h3 className="font-medium">{localFlowText('batchEnroll',{count:chosen.length})}</h3>
   <p>{localFlowText('fixedLightweight')}</p>
   <label className="flex items-start gap-2"><input type="checkbox" checked={useContext} onChange={e=>setUseContext(e.target.checked)}/>{localFlowText('batchContext')}</label>
   <p className="text-sm text-[#68748d]">{localFlowText('batchSavedSettings')}</p>
   <div className="flex flex-wrap gap-3"><button className={setupPrimary} disabled={c.busy||!chosen.length||!c.providers} onClick={()=>void run(chosen)}>{localFlowText('batchConfirm')}</button><button className={setupButton} onClick={()=>setConfirming(false)}>{localFlowText('cancelEdit')}</button></div>
  </section>}
  {!!c.batch.length&&<section aria-label={localFlowText('batchProgress')} className="mb-5 rounded-2xl border border-[#bdc8dd] bg-[#f4f6fb] p-5">
   <p role="status">{localFlowText('batchSummary',{done:c.batch.filter(r=>r.status==='ready').length,total:c.batch.length,failed:failed.length})}</p>
   <ul className="my-3 divide-y divide-[#dfe4ed]">{c.batch.map(row=><li key={row.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{meanings.find(m=>m.id===row.id)?.proposal.expression.surface??localFlowText('expression')}</span><span>{localFlowText(row.status==='ready'?'batchReady':row.status==='working'?'batchWorking':row.status==='failed'?'batchFailed':'batchWaiting')}{row.notice&&<span className="block text-sm">{localFlowNotice(row.notice)}</span>}</span></li>)}</ul>
   <div className="flex flex-wrap gap-3">{c.busy?<button className={setupButton} onClick={c.stopBatch}>{localFlowText('stopPreparation')}</button>:<>{!!failed.length&&<button className={setupPrimary} onClick={()=>void run(failed)}>{localFlowText('batchRetry')}</button>}{!!remaining.length&&<button className={setupButton} onClick={()=>void run(remaining)}>{localFlowText('batchResume')}</button>}</>}</div>
  </section>}
  {selecting?<div className="divide-y divide-[#e7e9ef] border-y border-[#e7e9ef]">{items.map(item=>{
   const m=meaningFor(item),joined=!!m&&ready(m.id),task=m&&c.tasks.find(t=>t.id===m.id);
   return <label key={item.personalMeaningId} className="flex min-h-20 items-center gap-4 px-3 py-4 hover:bg-[#f0f2f8]">
    <input type="checkbox" className="size-5 shrink-0 accent-[#303f76]" disabled={c.busy||!m||joined} checked={!!m&&selected.includes(m.id)} onChange={e=>{if(m)setSelected(ids=>e.target.checked?[...new Set([...ids,m.id])]:ids.filter(id=>id!==m.id));setConfirming(false);}}/>
    <span className="min-w-0 flex-1"><strong className="block break-words font-medium">{m?.proposal.expression.surface??item.primaryLabel}</strong><span className="text-sm text-[#68748d]">{localFlowText(!m?'batchUnconfirmed':joined?'batchReady':task&&['failed','rejected'].includes(task.status)?'batchFailed':task?'batchWaiting':'batchNotAdded')}</span></span>
   </label>;
  })}</div>:children}
 </div>;
}
