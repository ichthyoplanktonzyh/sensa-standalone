import {useMemo,useState,type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {personalLearningSourceKey} from '../../data/library/personalLearningSource';
import {journeyGateway,type JourneyWorldItemView} from '../personalMeaningJourney';
import type {usePersonalLearning} from './usePersonalLearning';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';

export function BatchPersonalLearning({items,c,children}:{items:JourneyWorldItemView[];c:ReturnType<typeof usePersonalLearning>;children:ReactNode}){
 useTranslation();
 const [selecting,setSelecting]=useState(false),[selected,setSelected]=useState<string[]>([]),[confirming,setConfirming]=useState(false),[useContext,setUseContext]=useState(false);
 const sources=useMemo(()=>items.flatMap(item=>journeyGateway.getLearningSources(item.personalMeaningId)).filter(source=>source.targetLanguageTag===c.languageContext.targetLanguageTag),[items,c.languageContext.targetLanguageTag]);
 const byKey=new Map(sources.map(source=>[personalLearningSourceKey(source.reference),source]));
 const ready=(key:string)=>c.tasks.some(task=>personalLearningSourceKey(task.source)===key&&task.languageContext.languageRouteId===c.languageContext.languageRouteId&&task.status==='ready');
 const eligible=sources.map(source=>personalLearningSourceKey(source.reference)).filter(key=>!ready(key));
 const chosen=selected.filter(key=>byKey.has(key)&&!ready(key));
 const failed=c.batch.filter(row=>row.status==='failed').map(row=>row.id);
 const remaining=c.batch.filter(row=>row.status==='waiting').map(row=>row.id);
 const run=async(keys:string[])=>{setConfirming(false);await c.enrollBatch(keys.flatMap(key=>{const source=byKey.get(key);return source?[source]:[];}),useContext);};
 return <div>
  {c.notice&&<p role="status" className="mb-4 text-sm text-feedback-danger">{c.notice}</p>}
  <div className="mb-4 flex flex-wrap items-center gap-3">
   <button className={setupButton} disabled={c.busy} aria-pressed={selecting} onClick={()=>{setSelecting(!selecting);setConfirming(false);}}>{localFlowText(selecting?'batchDone':'batchSelect')}</button>
   {selecting&&<>
    <button className={setupButton} disabled={c.busy||!eligible.length} onClick={()=>setSelected([...new Set([...selected,...eligible])])}>{localFlowText('batchSelectVisible')}</button>
    <button className={setupButton} disabled={c.busy||!selected.length} onClick={()=>{setSelected([]);setConfirming(false);}}>{localFlowText('batchClear')}</button>
    <button className={setupPrimary} disabled={c.busy||!chosen.length} onClick={()=>setConfirming(true)}>{localFlowText('batchEnroll',{count:chosen.length})}</button>
   </>}
  </div>
  {confirming&&<section aria-label={localFlowText('batchConfirm')} className="mb-5 space-y-4 rounded-2xl border border-border-strong bg-surface-panel p-5">
   <h3 className="font-medium">{localFlowText('batchEnroll',{count:chosen.length})}</h3>
   <p>{localFlowText('fixedLightweight')}</p>
   <label className="flex items-start gap-2"><input type="checkbox" checked={useContext} onChange={event=>setUseContext(event.target.checked)}/>{localFlowText('batchContext')}</label>
   <p className="text-sm text-fg-secondary">{localFlowText('batchSavedSettings')}</p>
   <div className="flex flex-wrap gap-3"><button className={setupPrimary} disabled={c.busy||!chosen.length||!c.providers} onClick={()=>void run(chosen)}>{localFlowText('batchConfirm')}</button><button className={setupButton} onClick={()=>setConfirming(false)}>{localFlowText('cancelEdit')}</button></div>
  </section>}
  {!!c.batch.length&&<section aria-label={localFlowText('batchProgress')} className="mb-5 rounded-2xl border border-border-strong bg-surface-subtle p-5">
   <p role="status">{localFlowText('batchSummary',{done:c.batch.filter(row=>row.status==='ready').length,total:c.batch.length,failed:failed.length})}</p>
   <ul className="my-3 divide-y divide-border-subtle">{c.batch.map(row=><li key={row.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{byKey.get(row.id)?.expression.surfaceForm??localFlowText('expression')}</span><span>{localFlowText(row.status==='ready'?'batchReady':row.status==='working'?'batchWorking':row.status==='failed'?'batchFailed':'batchWaiting')}{row.notice&&<span className="block text-sm">{localFlowNotice(row.notice)}</span>}</span></li>)}</ul>
   <div className="flex flex-wrap gap-3">{c.busy?<button className={setupButton} onClick={c.stopBatch}>{localFlowText('stopPreparation')}</button>:<>{!!failed.length&&<button className={setupPrimary} onClick={()=>void run(failed)}>{localFlowText('batchRetry')}</button>}{!!remaining.length&&<button className={setupButton} onClick={()=>void run(remaining)}>{localFlowText('batchResume')}</button>}</>}</div>
  </section>}
  {selecting?<div className="divide-y divide-border-subtle border-y border-border-subtle">{sources.map(source=>{
   const key=personalLearningSourceKey(source.reference),joined=ready(key),task=c.tasks.find(candidate=>personalLearningSourceKey(candidate.source)===key&&candidate.languageContext.languageRouteId===c.languageContext.languageRouteId);
   return <label key={key} className="flex min-h-20 items-center gap-4 px-3 py-4 hover:bg-surface-subtle">
    <input type="checkbox" className="size-5 shrink-0 accent-action-primary" disabled={c.busy||joined} checked={selected.includes(key)} onChange={event=>{setSelected(keys=>event.target.checked?[...new Set([...keys,key])]:keys.filter(candidate=>candidate!==key));setConfirming(false);}}/>
    <span className="min-w-0 flex-1"><strong className="block break-words font-medium">{source.expression.surfaceForm}</strong><span className="text-sm text-fg-secondary">{localFlowText(joined?'batchReady':task&&['failed','rejected'].includes(task.status)?'batchFailed':task?'batchWaiting':'batchNotAdded')}</span></span>
   </label>;
  })}</div>:children}
 </div>;
}
