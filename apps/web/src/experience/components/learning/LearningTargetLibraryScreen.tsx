import {ArrowLeft,ArrowRight,Plus,Search} from 'lucide-react';
import {useEffect,useRef,type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {studyButton} from '../StudyScreen';
import {SensaCollectionBrowserLayout} from '../../ui/SensaPageLayouts';
import {useScreenState} from '../../ui/ScreenHost';
import {localFlowText} from '../../../i18n/localFlowText';
import {learningLibrarySelection,type LearningLibraryItem,type LearningLibraryFilter,type LearningLibrarySort} from '../../library/learningTargetBrowsing';
import type {ShellParams} from '../../router/screenRegistry';

interface LearningTargetLibraryScreenProps{
 active:boolean;notice?:ReactNode;availability:'loading'|'ready'|'unavailable';
 items:readonly LearningLibraryItem[];routeKey:string;routeLabel:string;
 params:ShellParams;onParamsChange:(params:ShellParams)=>void;
 onBack:()=>void;onAddLearning:()=>void;onOpenTarget:(targetId:string)=>void;onOpenPending:(enrollmentId:string)=>void;
}
export function LearningTargetLibraryScreen(props:LearningTargetLibraryScreenProps){
 const {t,i18n}=useTranslation(),locale=i18n.resolvedLanguage??'zh-CN';
 const query=props.params.learningQuery??'';
 const filter:LearningLibraryFilter=['new','due','paused','active','complete'].includes(props.params.learningFilter??'')?props.params.learningFilter as LearningLibraryFilter:'all';
 const sort:LearningLibrarySort=props.params.learningSort==='expression'?'expression':'due';
 const page=/^\d+$/u.test(props.params.learningPage??'')?Math.max(1,Math.min(1_000_000,Number(props.params.learningPage))):1;
 const [returnFocus,setReturnFocus]=useScreenState<string|null>(`learning-library:${props.routeKey}:returnFocus`,null);
 const root=useRef<HTMLDivElement>(null);
 const visible=learningLibrarySelection(props.items,query,filter,sort,locale);
 const pages=Math.max(1,Math.ceil(visible.length/40)),currentPage=Math.min(page,pages);
 const start=visible.length?(currentPage-1)*40+1:0,end=Math.min(currentPage*40,visible.length);
 const change=(next:ShellParams)=>props.onParamsChange({...props.params,learningPage:'1',...next});
 useEffect(()=>{
  if(props.availability==='ready'&&page!==currentPage)props.onParamsChange({...props.params,learningPage:String(currentPage)});
 },[props.availability,page,currentPage]);
 useEffect(()=>{
  if(!props.active||props.availability!=='ready'||!returnFocus)return;
  const frame=requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>(`[data-learning-target="${CSS.escape(returnFocus)}"]`)?.focus({preventScroll:true}));
  return()=>cancelAnimationFrame(frame);
 },[props.active,props.availability,returnFocus]);
 const stateLabel=(state:string)=>state==='paused'?localFlowText('learningPaused'):state==='not_planned'?localFlowText('learningNotPlanned'):state==='awaiting_content'?localFlowText('prepareResources'):t('study.states.'+state);
 const filterLabel=(value:LearningLibraryFilter)=>value==='due'?localFlowText('learningFilterDue'):value==='new'?localFlowText('learningFilterNew'):value==='paused'?localFlowText('learningFilterPaused'):t('study.filters.'+value);
 return <SensaCollectionBrowserLayout id="s-learning-library" measure="wide" className={`screen z-20 ${props.active?'active':'invisible pointer-events-none'}`} regions={{
  header:<>{props.notice}<button className={studyButton+' -ml-4 text-fg-secondary'} onClick={props.onBack}><ArrowLeft size={18}/>{t('study.back')}</button>
   <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-medium tracking-tight">{t('study.library')}</h1><p className="mt-2 text-sm text-fg-secondary">{props.routeLabel}</p></div><button className={studyButton+' bg-action-primary text-action-on-primary hover:bg-action-primary-hover'} onClick={props.onAddLearning}><Plus size={17}/>{t('study.add')}</button></div></>,
  controls:<div className="flex flex-wrap gap-2">
   <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-control border border-border-subtle bg-surface-panel px-3 focus-within:outline-2 focus-within:outline-focus"><Search size={17} className="shrink-0 text-fg-tertiary"/><input type="search" value={query} onChange={event=>change({learningQuery:event.target.value||undefined})} aria-label={t('study.search')} placeholder={t('study.search')} className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"/></label>
   <select aria-label={t('study.status')} value={filter} onChange={event=>change({learningFilter:event.target.value})} className="min-h-11 max-w-full rounded-control border border-border-subtle bg-surface-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus">{(['all','due','new','paused','active','complete'] as const).map(value=><option key={value} value={value}>{filterLabel(value)}</option>)}</select>
   <select aria-label={localFlowText('learningSort')} value={sort} onChange={event=>change({learningSort:event.target.value})} className="min-h-11 max-w-full rounded-control border border-border-subtle bg-surface-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus"><option value="due">{localFlowText('learningSortDue')}</option><option value="expression">{localFlowText('learningSortExpression')}</option></select>
  </div>,
  collection:<div ref={root}>{props.availability==='ready'&&<>
   <p role="status" className="my-4 text-sm tabular-nums text-fg-secondary">{localFlowText('learningVisibleCount',{start,end,count:visible.length})}</p>
   <div aria-hidden="true" className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_1rem] gap-4 border-b border-border-subtle px-3 py-2 text-xs text-fg-tertiary md:grid"><span>{localFlowText('learningExpression')}</span><span>{localFlowText('learningSource')}</span><span>{localFlowText('learningState')}</span><span>{localFlowText('nextReviewLabel')}</span></div>
   <ul className="divide-y divide-border-subtle">{visible.slice((currentPage-1)*40,currentPage*40).map(item=><li key={item.id}><button data-learning-target={item.id} onClick={()=>{setReturnFocus(item.id);if(item.enrollmentId)props.onOpenPending(item.enrollmentId);else if(item.targetId)props.onOpenTarget(item.targetId);}} className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-4 gap-y-2 rounded-control px-3 py-4 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_1rem]">
    <span className="min-w-0 break-words"><strong className="block font-language text-lg font-medium">{item.expression}</strong><span className="mt-1 block text-sm text-fg-secondary">{item.meaning}</span></span>
    <span className="col-start-1 min-w-0 break-words text-xs text-fg-secondary md:col-auto">{item.sourceLabel}</span>
    <span className="col-start-1 text-xs text-fg-secondary md:col-auto">{stateLabel(item.state)}</span>
    <span className="col-start-1 text-xs tabular-nums text-fg-tertiary md:col-auto">{item.nextReviewAt?<time dateTime={item.nextReviewAt}>{new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.nextReviewAt))}</time>:localFlowText('learningNotScheduled')}</span>
    <ArrowRight size={16} className="col-start-2 row-start-1 shrink-0 text-fg-tertiary md:col-auto"/>
   </button></li>)}</ul>
   {visible.length>40&&<nav aria-label={localFlowText('catalogPagination')} className="my-5 flex items-center gap-3"><button className={studyButton} disabled={currentPage===1} onClick={()=>props.onParamsChange({...props.params,learningPage:String(currentPage-1)})}>{t('directLearning.previous',{ns:'learning'})}</button><span className="text-sm tabular-nums">{currentPage} / {pages}</span><button className={studyButton} disabled={currentPage===pages} onClick={()=>props.onParamsChange({...props.params,learningPage:String(currentPage+1)})}>{t('directLearning.next',{ns:'learning'})}</button></nav>}
   {!visible.length&&<p className="py-12 text-center text-sm text-fg-tertiary">{t(props.items.length?'study.noMatches':'study.empty')}</p>}
  </>}</div>
 }}/>
}
