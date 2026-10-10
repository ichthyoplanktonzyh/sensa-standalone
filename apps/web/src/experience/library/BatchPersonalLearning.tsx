import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {personalLearningSourceKey} from '../../contentSupply/system';
import {journeyGateway,type JourneyWorldItemView} from '../personalMeaningJourney';
import {worldLearningChoice,type WorldBrowseQuery,type WorldLearningChoice} from '../personalMeaningJourney/worldRead';
import {useWorldLearningChoices} from '../personalMeaningJourney/useWorldRead';
import {collectLearningChoices} from '../personalMeaningJourney/worldReaders';
import {worldReadRepository} from '../personalMeaningJourney/worldRepository';
import type {usePersonalLearning} from './usePersonalLearning';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {SensaPagedVirtualList,SensaVirtualList} from '../ui/SensaVirtualList';
import {isBatchTaskReady} from './personalLearningBatch';
const noChoices:ReadonlyMap<string,WorldLearningChoice>=new Map();

export function BatchPersonalLearning({items,query,c,children}:{items:JourneyWorldItemView[];query?:Pick<WorldBrowseQuery,'query'|'filter'>;c:ReturnType<typeof usePersonalLearning>;children:ReactNode}){
 const {t}=useTranslation();
 const [selecting,setSelecting]=useState(false),[selections,setSelections]=useState<ReadonlyMap<string,ReadonlyMap<string,WorldLearningChoice>>>(new Map()),[confirming,setConfirming]=useState(false),[useContext,setUseContext]=useState(false);
 const selectionKey=JSON.stringify([c.languageContext.languageRouteId,c.languageContext.targetLanguageTag]),selected=selections.get(selectionKey)??noChoices;
 const setSelected=(update:ReadonlyMap<string,WorldLearningChoice>|((prior:ReadonlyMap<string,WorldLearningChoice>)=>ReadonlyMap<string,WorldLearningChoice>))=>setSelections(scopes=>{const next=new Map(scopes),prior=scopes.get(selectionKey)??noChoices;next.set(selectionKey,typeof update==='function'?update(prior):update);return next;});
 const [selectingAll,setSelectingAll]=useState(false),[selectionNotice,setSelectionNotice]=useState('');
 const collection=useRef<AbortController|null>(null);
 const choiceQuery={query:query?.query??'',filter:query?.filter??'all',targetLanguageTag:c.languageContext.targetLanguageTag};
 const window=useWorldLearningChoices(choiceQuery,!!query&&selecting);
 // Graph/explicit full-read callers already own their items; ordinary list
 // selection always uses compact indexed windows, never the command gateway.
 const fallback=useMemo(()=>!query&&selecting?items.flatMap(item=>journeyGateway.getLearningSources(item.personalMeaningId)).filter(source=>source.targetLanguageTag===c.languageContext.targetLanguageTag).map(worldLearningChoice):[],[items,query,selecting,c.languageContext.targetLanguageTag]);
 const taskByKey=useMemo(()=>new Map(c.tasks.filter(task=>task.languageContext.languageRouteId===c.languageContext.languageRouteId).map(task=>[personalLearningSourceKey(task.source),task])),[c.tasks,c.languageContext.languageRouteId]);
 const chosen=useMemo(()=>[...selected.values()].filter(choice=>!isBatchTaskReady(taskByKey.get(choice.key),c.languageContext)),[selected,taskByKey,c.languageContext]);
 const routeKey=JSON.stringify(c.languageContext);
 const confirmationRoute=useRef(routeKey);
 useEffect(()=>{setConfirming(false);setUseContext(false);},[routeKey]);
 useEffect(()=>()=>{collection.current?.abort();},[query?.query,query?.filter,routeKey,selecting]);
 const selectAll=async()=>{
  if(selectingAll)return;
  const controller=new AbortController();collection.current=controller;setSelectingAll(true);setSelectionNotice('');
  try{
   const choices=query?await collectLearningChoices(worldReadRepository,choiceQuery,controller.signal):fallback;
   controller.signal.throwIfAborted();
   setSelected(prior=>{const next=new Map(prior);for(const choice of choices)if(!isBatchTaskReady(taskByKey.get(choice.key),c.languageContext))next.set(choice.key,choice);return next;});setConfirming(false);
  }catch(cause){if(!controller.signal.aborted)setSelectionNotice(cause instanceof Error&&cause.message.startsWith('localFlow.')?cause.message:'localFlow.preparationReadFailed');}
  finally{if(collection.current===controller){collection.current=null;setSelectingAll(false);}}
 };
 const run=async(choices:readonly WorldLearningChoice[])=>{setConfirming(false);setSelecting(false);setSelected(new Map());await c.enrollBatch(choices,useContext);};
 const renderChoice=(choice:WorldLearningChoice)=>{
  const task=taskByKey.get(choice.key),joined=isBatchTaskReady(task,c.languageContext);
  return <label className="flex min-h-20 items-center gap-4 px-3 py-4 hover:bg-surface-subtle">
   <input type="checkbox" className="size-5 shrink-0 accent-action-primary" disabled={c.busy||selectingAll||joined} checked={selected.has(choice.key)} onChange={event=>{const checked=event.target.checked;setSelected(prior=>{const next=new Map(prior);if(checked)next.set(choice.key,choice);else next.delete(choice.key);return next;});setConfirming(false);}}/>
   <span className="min-w-0 flex-1"><strong className="block break-words font-medium">{choice.label}</strong><span className="text-sm text-fg-secondary">{localFlowText(joined?'batchReady':task&&['failed','rejected'].includes(task.status)?'batchFailed':task?'batchWaiting':'batchNotAdded')}</span></span>
  </label>;
 };
 return <div>
  {(c.notice||selectionNotice)&&<p role="status" className="mb-4 text-sm text-feedback-danger">{c.notice||localFlowNotice(selectionNotice)}</p>}
  <div className="mb-4 flex flex-wrap items-center gap-3">
   <button className={setupButton} disabled={c.busy} aria-pressed={selecting} onClick={()=>{setSelecting(!selecting);setConfirming(false);}}>{localFlowText(selecting?'batchDone':'batchSelect')}</button>
   {selecting&&<>
    <button className={setupButton} aria-busy={selectingAll||undefined} disabled={c.busy||selectingAll||(query?window.status.loading||!window.status.ok||!window.total:!fallback.length)} onClick={()=>void selectAll()}>{localFlowText('batchSelectVisible')}</button>
    <button className={setupButton} disabled={c.busy||selectingAll||!selected.size} onClick={()=>{setSelected(new Map());setConfirming(false);}}>{localFlowText('batchClear')}</button>
    <button className={setupPrimary} disabled={c.busy||selectingAll||!chosen.length} onClick={()=>{confirmationRoute.current=routeKey;setUseContext(false);setConfirming(true);}}>{localFlowText('batchEnroll',{count:chosen.length})}</button>
   </>}
  </div>
  {confirming&&confirmationRoute.current===routeKey&&<section aria-label={localFlowText('batchConfirm')} className="mb-5 space-y-4 rounded-2xl border border-border-strong bg-surface-panel p-5">
   <h3 className="font-medium">{localFlowText('batchEnroll',{count:chosen.length})}</h3>
   <p>{localFlowText('fixedLightweight')}</p>
   <label className="flex items-start gap-2"><input type="checkbox" checked={useContext} onChange={event=>setUseContext(event.target.checked)}/>{localFlowText('batchContext')}</label>
   <p className="text-sm text-fg-secondary">{localFlowText('batchSavedSettings')}</p>
   <div className="flex flex-wrap gap-3"><button className={setupPrimary} disabled={c.busy||selectingAll||!chosen.length||!c.preparationAvailable} onClick={()=>void run(chosen)}>{localFlowText('batchConfirm')}</button><button className={setupButton} onClick={()=>setConfirming(false)}>{localFlowText('cancelEdit')}</button></div>
  </section>}
  {!!c.batch.count&&(c.batch.busy||c.batch.context?.languageRouteId===c.languageContext.languageRouteId&&c.batch.context.targetLanguageTag===c.languageContext.targetLanguageTag)&&<section aria-label={localFlowText('batchProgress')} className="mb-5 rounded-2xl border border-border-strong bg-surface-subtle p-5">
   <p role="status">{localFlowText('batchSummary',{done:c.batch.counts.ready,total:c.batch.count,failed:c.batch.counts.failed})}</p>
   <div className="my-3 flex flex-wrap gap-3">{c.batch.busy?<button className={setupButton} onClick={c.stopBatch}>{localFlowText('stopPreparation')}</button>:<>{!!c.batch.counts.failed&&<button className={setupPrimary} disabled={c.busy} onClick={()=>void c.retryBatch('failed')}>{localFlowText('batchRetry')}</button>}{!!c.batch.counts.waiting&&<button className={setupButton} disabled={c.busy} onClick={()=>void c.retryBatch('waiting')}>{localFlowText('batchResume')}</button>}</>}</div>
   <details><summary className="cursor-pointer">{localFlowText('batchProgress')}</summary><SensaPagedVirtualList count={c.batch.count} itemAt={c.batchRowAt} indexForKey={c.batchIndexForKey} itemKey={row=>row.choice.key} label={localFlowText('batchProgress')} estimateSize={88} renderItem={row=><div className="flex flex-wrap justify-between gap-2 py-2"><span>{row.choice.label}</span><span>{localFlowText(row.status==='ready'?'batchReady':row.status==='working'?'batchWorking':row.status==='failed'?'batchFailed':'batchWaiting')}{row.notice&&<span className="block text-sm">{localFlowNotice(row.notice)}</span>}</span></div>}/></details>
  </section>}
  {selecting&&query?window.status.loading?<p role="status" aria-busy="true">{localFlowText('loadingSensa')}</p>:!window.status.ok?<div role="alert"><p>{window.status.error}</p><button className={setupButton} onClick={window.reload}>{localFlowText('retryPreparation')}</button></div>:!window.total?<p role="status" className="py-12 text-center text-sm text-fg-secondary">{t('content.noResults')}</p>:<SensaPagedVirtualList count={window.total} itemAt={index=>window.items.get(index)} itemKey={choice=>choice.key} indexForKey={key=>[...window.items].find(([,choice])=>choice.key===key)?.[0]??-1} request={window.request} label={localFlowText('batchSelect')} estimateSize={88} renderItem={renderChoice}/>:selecting?<SensaVirtualList items={fallback} itemKey={choice=>choice.key} label={localFlowText('batchSelect')} estimateSize={88} renderItem={renderChoice}/>:children}
 </div>;
}
