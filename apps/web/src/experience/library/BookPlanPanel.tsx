import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import '../../i18n/learningResources';
import {learningSystem,type LearningBookPlanProjection,type LearningBookMode,type LearningBookRangeSelection} from '../../learning/system';
import {localFlowText} from '../../i18n/localFlowText';
import {SensaOverlayLayout} from '../ui/SensaComponents';
import {useActiveLanguageContext} from './useActiveLanguageContext';
import {createRefreshCoordinator} from './refreshCoordinator';
import {settleReconciledOperation} from './operationSettlement';

const control='min-h-11 rounded-control border border-border-subtle bg-surface-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus';
const inputControl=control+' min-w-0 w-full';
const button=control+' inline-flex items-center justify-center hover:bg-surface-selected';

export function BookPlanPanel({active}:{active:boolean}){
 const {t}=useTranslation(),context=useActiveLanguageContext();
 const key=`${context.languageRouteId}:${context.languageRouteRevision}:${context.targetLanguageTag}:${context.supportLanguageTag}`;
 const current=useRef(key);current.current=key;
 const [state,setState]=useState<{key:string;books:readonly LearningBookPlanProjection[]|null;error:boolean}>({key,books:null,error:false});
 const [editing,setEditing]=useState<LearningBookPlanProjection|null>(null);
 const [mode,setMode]=useState<LearningBookMode>('active');
 const [selection,setSelection]=useState<LearningBookRangeSelection>({kind:'all'});
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const [needsRead,setNeedsRead]=useState(false),saved=useRef(false);
 const retry=useRef<()=>void>(()=>{});
 useEffect(()=>{
  if(!active)return;
  let live=true;setState({key,books:null,error:false});setEditing(null);setBusy(false);setError(null);setNeedsRead(false);
  const coordinator=createRefreshCoordinator(async()=>{
   if(!live)return;
   try{const books=await learningSystem.read({kind:'book_plans',languageContext:context});if(live&&current.current===key)setState({key,books,error:false});}
   catch{if(live&&current.current===key)setState({key,books:null,error:true});}
  });
  retry.current=()=>{void coordinator.request();};retry.current();
  const stop=learningSystem.subscribe({kind:'book_plans',languageContext:context},()=>{void coordinator.request();});
  return()=>{live=false;stop();};
 },[active,key]);
 useEffect(()=>{
  if(!editing)return;
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy)setEditing(null);}};
  document.addEventListener('keydown',escape,true);return()=>document.removeEventListener('keydown',escape,true);
 },[editing,busy]);
 if(!active)return null;
 const books=state.key===key?state.books:null;
 const title=(book:LearningBookPlanProjection)=>book.title??t('bookPlan.fallback',{version:book.bookVersionNumber});
 const range=(book:LearningBookPlanProjection)=>book.selection.kind==='all'?t('bookPlan.allLabel',{count:book.memberCount}):book.selection.kind==='ordinals'?t('bookPlan.rangeLabel',{first:book.selection.first,last:book.selection.last}):t('bookPlan.selectedLabel',{count:book.selection.senseVersionIds.length});
 const edit=(book:LearningBookPlanProjection)=>{setEditing(book);setMode(book.mode);setSelection(structuredClone(book.selection));setError(null);setNeedsRead(false);saved.current=false;};
 const save=async()=>{
  if(!editing||busy)return;
  if(needsRead){
   setBusy(true);const requestKey=key;
   try{const next=await learningSystem.read({kind:'book_plans',languageContext:context});if(current.current===requestKey){setState({key,books:next,error:false});setNeedsRead(false);if(saved.current)setEditing(null);else{setEditing(next.find(book=>book.enrollmentId===editing.enrollmentId)??editing);setError(t('bookPlanFeedback.unconfirmed'));}}}
   catch{if(current.current===requestKey)setError(saved.current?t('bookPlanFeedback.savedReadFailed'):localFlowText('progressReadFailed'));}
   finally{if(current.current===requestKey)setBusy(false);}return;
  }
  if(selection.kind==='ordinals'&&(!Number.isSafeInteger(selection.first)||!Number.isSafeInteger(selection.last)||selection.first<1||selection.first>selection.last||selection.last>editing.memberCount)){setError(t('bookPlan.invalidRange'));return;}
  const requestKey=key;setBusy(true);setError(null);
  const outcome=await settleReconciledOperation(()=>learningSystem.execute({kind:'change_book_plan',operationId:crypto.randomUUID(),enrollmentId:editing.enrollmentId,expectedRevision:editing.revision,languageContext:context,mode,selection}),async()=>{
   const next=await learningSystem.read({kind:'book_plans',languageContext:context});
   if(current.current===requestKey){setState({key,books:next,error:false});setEditing(next.find(book=>book.enrollmentId===editing.enrollmentId)??editing);}
  });
  if(current.current!==requestKey)return;
  saved.current=outcome.kind==='committed';
  if(outcome.kind==='committed'&&outcome.projection==='current')setEditing(null);
  else if(outcome.projection==='stale'){setState({key,books:null,error:true});setNeedsRead(true);setError(saved.current?t('bookPlanFeedback.savedReadFailed'):localFlowText('progressReadFailed'));}
  else setError(t('bookPlanFeedback.unconfirmed'));
  setBusy(false);
 };
 return <>
  {state.key===key&&state.error?<div role="alert" className="mt-7"><p>{localFlowText('progressReadFailed')}</p><button className={button+' mt-3'} onClick={()=>retry.current()}>{t('reliability.retry')}</button></div>:books===null?<p role="status" aria-busy="true" className="mt-7 text-sm text-fg-tertiary">{localFlowText('loadingSensa')}</p>:<section className="mt-7 rounded-overlay border border-border-subtle bg-surface-panel p-6" aria-labelledby="study-books-title">
   <h2 id="study-books-title" className="text-lg font-medium">{t('bookPlanHeading.title')}</h2>
   {books.length===0&&<p className="mt-3 text-sm text-fg-secondary">{t('bookPlanHeading.empty')}</p>}
   <ul className="mt-3 divide-y divide-border-subtle">{books.map(book=><li key={book.enrollmentId} className="flex flex-wrap items-center justify-between gap-4 py-4">
    <div className="min-w-0 flex-1"><h3 className="font-medium">{title(book)}</h3><p className="mt-1 text-sm text-fg-secondary">v{book.bookVersionNumber} · {t('bookPlan.'+book.mode)} · {range(book)}</p></div>
    <button className={button} onClick={()=>edit(book)} aria-label={t('bookPlan.editNamed',{title:title(book)})}>{t('bookPlan.edit')}</button>
   </li>)}</ul>
  </section>}
  {editing&&<SensaOverlayLayout variant="sheet" measure="compact" className="z-[150]" labelledBy="book-plan-title" onDismiss={()=>{if(!busy)setEditing(null);}} dismissOnBackdrop regions={{
   header:<div className="flex items-center justify-between gap-4"><div className="min-w-0 flex-1"><h2 id="book-plan-title" className="break-words text-lg font-medium">{title(editing)}</h2><p className="text-sm text-fg-tertiary">v{editing.bookVersionNumber}</p></div><button className={button} disabled={busy} onClick={()=>setEditing(null)}>{t('bookPlan.cancel')}</button></div>,
   primary:<div className="space-y-6">
    <label className="flex flex-col gap-2 text-sm font-medium">{t('bookPlanHeading.mode')}<select autoFocus className={inputControl} disabled={busy||needsRead} value={mode} onChange={event=>setMode(event.target.value as LearningBookMode)}>{(['active','maintenance','paused'] as const).map(value=><option key={value} value={value}>{t('bookPlan.'+value)}</option>)}</select></label>
    <label className="flex flex-col gap-2 text-sm font-medium">{t('bookPlan.range')}<select className={inputControl} disabled={busy||needsRead} value={selection.kind} onChange={event=>setSelection(event.target.value==='all'?{kind:'all'}:{kind:'ordinals',first:1,last:editing.memberCount})}>
     <option value="all">{t('bookPlan.all')}</option><option value="ordinals">{t('bookPlan.ordinals')}</option>{selection.kind==='senses'&&<option value="senses" disabled>{t('bookPlan.selectedLabel',{count:selection.senseVersionIds.length})}</option>}
    </select></label>
    {selection.kind==='ordinals'&&<div className="grid grid-cols-2 gap-4">{(['first','last'] as const).map(field=><label key={field} className="flex min-w-0 flex-col gap-2 text-sm font-medium">{t('bookPlan.'+field)}<input className={inputControl} disabled={busy||needsRead} type="number" inputMode="numeric" min={1} max={editing.memberCount} value={selection[field]} onChange={event=>setSelection({...selection,[field]:Number(event.target.value)})}/></label>)}</div>}
    {error&&<p role="alert" className="text-sm text-feedback-danger">{error}</p>}
   </div>,
   controls:<button disabled={busy||(state.error&&!needsRead)} className={button+' w-full bg-action-primary text-action-on-primary hover:bg-action-primary-hover'} onClick={()=>void save()}>{t(needsRead?'reliability.retry':'bookPlan.save')}</button>,
  }}/>}
 </>;
}
