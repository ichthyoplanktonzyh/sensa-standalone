import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,Search} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {localFlowText} from '../../i18n/localFlowText';
import {practiceButton,practiceBody,practiceSurface} from './SensaFreePracticeScreen';
import {SensaPagedVirtualList} from '../ui/SensaVirtualList';
import {usePracticeExpressionWindow,usePracticeExpressionCount} from '../usePracticeMaterials';
import {collectPracticeExpressionIds,type PracticeMaterialSelection,type PracticeMaterialSource} from '../practiceMaterials';

export interface PracticeMaterialScreenProps {
 active:boolean;languageTag:string|null;selection:PracticeMaterialSelection;
 mode:'selection'|'expression';onBack:()=>void;
 onSelect:(selection:PracticeMaterialSelection)=>void;onChoose:(id:string)=>Promise<void>;
}
export function PracticeMaterialScreen({active,languageTag,selection,mode,onBack,onSelect,onChoose}:PracticeMaterialScreenProps){
 const {t}=useTranslation();
 const [source,setSource]=useState<PracticeMaterialSource>(selection.source);
 const [query,setQuery]=useState('');
 const [draft,setDraft]=useState<{all:boolean;ids:readonly string[];excluded:readonly string[]}>(()=>({all:selection.expressionIds===null,ids:selection.expressionIds??[],excluded:[]}));
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const pickingExpression=mode==='expression';
 const currentSource=pickingExpression?selection.source:source;
 const window=usePracticeExpressionWindow(currentSource,languageTag,query,active,pickingExpression?selection.expressionIds??undefined:undefined);
 const count=usePracticeExpressionCount(currentSource,languageTag,pickingExpression?selection.expressionIds??undefined:draft.all?undefined:draft.ids,pickingExpression?undefined:draft.all?draft.excluded:undefined);
 const countReady=count.status.ok&&!count.status.loading;
 const selectedCount=countReady?count.value?.total??0:null;
 const checked=(id:string)=>draft.all?!draft.excluded.includes(id):draft.ids.includes(id);
 const sourceLabel=(kind:PracticeMaterialSource)=>t(kind==='books'?'practice.sources.current_study':'practice.sources.personal_semantic_world');
 const changeSource=(kind:PracticeMaterialSource)=>{
  controller.current?.abort();setSource(kind);setQuery('');setError('');setBusy(false);
  setDraft(kind===selection.source?{all:selection.expressionIds===null,ids:selection.expressionIds??[],excluded:[]}:{all:false,ids:[],excluded:[]});
 };
 const commit=async()=>{
  if(!languageTag||!selectedCount||busy)return;
  const operation=new AbortController();controller.current?.abort();controller.current=operation;setBusy(true);setError('');
  try{
   // A whole source is a live selection, not a snapshot of every member.
   const ids=draft.all&&!draft.excluded.length?null:draft.all?await collectPracticeExpressionIds({source,languageTag,query:'',excludedIds:draft.excluded},operation.signal):[...draft.ids];
   operation.signal.throwIfAborted();onSelect({source,expressionIds:ids});
  }catch{if(!operation.signal.aborted)setError(t('content.loadError'));}
  finally{if(controller.current===operation)setBusy(false);}
 };
 const choose=async(id:string)=>{
  if(busy)return;setBusy(true);setError('');
  try{await onChoose(id);}catch{setError(t('content.loadError'));}finally{setBusy(false);}
 };
 return <section id="s-practice-scope" data-sensa-page-layout="collection-browser" className={practiceSurface(active)}><main className={practiceBody}>
  <button onClick={onBack} className={`${practiceButton} -ml-4 text-fg-secondary`}><ArrowLeft size={18}/>{t('practice.back')}</button>
  <h1 className="my-7 text-3xl font-medium">{t(pickingExpression?'practice.expression':'practice.choose')}</h1>
  {!pickingExpression&&<div className="mb-6 flex flex-wrap gap-2" role="group" aria-label={t('practice.scope')}>{(['books','personal'] as const).map(kind=><button key={kind} aria-pressed={source===kind} onClick={()=>changeSource(kind)} className={`${practiceButton} border ${source===kind?'border-focus bg-surface-selected':'border-border-subtle bg-surface-panel'}`}>{sourceLabel(kind)}</button>)}</div>}
  <label className="mb-6 flex max-w-xl items-center gap-3 rounded-control border border-border-subtle bg-surface-panel px-4"><Search size={18} className="text-fg-tertiary"/><input type="search" maxLength={200} aria-label={t('content.search')} value={query} onChange={event=>setQuery(event.target.value)} className="min-h-12 min-w-0 flex-1 bg-transparent outline-none"/></label>
  {!pickingExpression&&<div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-fg-secondary"><span>{selectedCount===null?localFlowText('loadingSensa'):t('practice.count',{count:selectedCount})}</span><button disabled={busy} className={practiceButton} onClick={()=>setDraft(draft.all&&!draft.excluded.length?{all:false,ids:[],excluded:[]}:{all:true,ids:[],excluded:[]})}>{t(draft.all&&!draft.excluded.length?'practice.clear':'practice.all')}</button></div>}
  {(!window.status.ok||!count.status.ok)&&<div role="alert"><p>{t('content.loadError')}</p><button className={practiceButton} onClick={()=>{window.reload();count.reload();}}>{t('content.retry')}</button></div>}
  {window.status.loading&&<p role="status" aria-busy="true">{localFlowText('loadingSensa')}</p>}
  {window.status.ok&&!window.status.loading&&<SensaPagedVirtualList count={window.total} itemAt={index=>window.items.get(index)} itemKey={item=>item.id} label={t('practice.choose')} request={window.request} estimateSize={88} renderItem={item=><button disabled={busy} aria-pressed={pickingExpression?undefined:checked(item.id)} lang={item.languageTag} dir="auto" onClick={()=>pickingExpression?void choose(item.id):setDraft(value=>value.all?{...value,excluded:value.excluded.includes(item.id)?value.excluded.filter(id=>id!==item.id):[...value.excluded,item.id]}:{...value,ids:value.ids.includes(item.id)?value.ids.filter(id=>id!==item.id):[...value.ids,item.id]})} className="flex min-h-20 w-full items-center gap-5 px-1 py-5 text-left text-lg focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40"><span className="min-w-0 flex-1 break-words">{item.text}</span>{!pickingExpression&&<span className={`grid size-6 shrink-0 place-items-center rounded-control border ${checked(item.id)?'border-action-primary bg-action-primary text-action-on-primary':'border-border-strong'}`}>{checked(item.id)&&<Check size={16}/>}</span>}</button>}/>}
  {window.status.ok&&!window.status.loading&&!window.total&&<p className="py-16 text-center text-sm text-fg-tertiary">{t('practice.empty')}</p>}
  {error&&<p role="alert" className="mt-4">{error}</p>}
  {!pickingExpression&&<footer className="sticky bottom-0 mt-6 border-t border-border-subtle bg-surface-canvas py-5"><button disabled={busy||!countReady||!selectedCount} onClick={()=>void commit()} className={`${practiceButton} w-full bg-action-primary text-action-on-primary sm:w-auto`}>{busy||count.status.loading?localFlowText('loadingSensa'):!count.status.ok?t('practice.choose'):t('practice.use',{count:selectedCount??0})}</button></footer>}
 </main></section>;
}
