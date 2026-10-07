import '../../i18n/contentResources';
import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {learningSystem,type LearningSemanticMemoryProjection} from '../../learning/system';
import {personalContentSystem} from '../../personalContent/system';
import {localFlowText} from '../../i18n/localFlowText';
import {uiText} from '../../i18n/uiText';
import {SensaDetailWorkspaceLayout} from '../ui/SensaPageLayouts';
import {contentNavigationClass,contentNavigationBackClass,slideScreenClass,iconClass} from '../ui/primitives';

/** Browse real saved learning content without starting a Run or inventing a Word/Example. */
export function ContentLearningDetailScreen({active,targetId,onBack,onEditNote,toast}:{active:boolean;targetId:string;onBack:()=>void;onEditNote:(word:string,senseId:string,meaning:string)=>void;toast:(text:string)=>void}){
 useTranslation();
 const [item,setItem]=useState<LearningSemanticMemoryProjection['targets'][number]|null>(null),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[retry,setRetry]=useState(0),[,redraw]=useState(0),[busy,setBusy]=useState(false);
 useEffect(()=>{
  let generation=0,cancelled=false;
  const load=async()=>{const current=++generation;setStatus('loading');try{const value=await learningSystem.read({kind:'semantic_memory',targetId});if(!cancelled&&current===generation){setItem(value.targets[0]??null);setStatus('ready');}}catch{if(!cancelled&&current===generation)setStatus('error');}};
  const stop=learningSystem.subscribe({kind:'semantic_memory',targetId},()=>void load());void load();return()=>{cancelled=true;stop();};
 },[targetId,retry]);
 useEffect(()=>personalContentSystem.subscribe({kind:'snapshot'},()=>redraw(value=>value+1)),[]);
 const personal=item?personalContentSystem.read({kind:'sense',senseId:item.senseId}):null;
 const save=async()=>{
  if(!item||!personal||personal.status!=='ready'||busy||status!=='ready')return;setBusy(true);
  try{const saved=await personalContentSystem.execute({kind:'set_saved_sense',operationId:crypto.randomUUID(),senseId:item.senseId,saved:!personal.saved});toast(uiText(saved?'meaningSaved':'meaningRemovedFromSaved'));}
  catch{toast(uiText('saveFailed'));}finally{setBusy(false);}
 };
 return <SensaDetailWorkspaceLayout id="s-content-sense" className={slideScreenClass(active)} aria-hidden={!active} regions={{
  header:<div className={contentNavigationClass}><button className={contentNavigationBackClass} onClick={onBack} aria-label={uiText('back2')}><svg className={iconClass} aria-hidden="true"><use href="#i-chev-l"/></svg></button><span>{uiText('meaning3')}</span>{item&&<button disabled={busy||status!=='ready'||personal?.status!=='ready'} className={'grid size-11 place-items-center rounded-control text-action-primary '+(personal?.status==='ready'&&personal.saved?'bg-accent-soft':'')} aria-pressed={personal?.status==='ready'?personal.saved:undefined} aria-label={uiText(personal?.status==='ready'&&personal.saved?'unsaveThisMeaning':'saveThisMeaning')} onClick={()=>void save()}><svg className={iconClass+(personal?.status==='ready'&&personal.saved?' fill-current':'')} aria-hidden="true"><use href="#i-star"/></svg></button>}</div>,
  primary:status!=='ready'?<div role={status==='error'?'alert':'status'} className="p-5">{localFlowText(status==='error'?'progressReadFailed':'loadingSensa')}{status==='error'&&<button className="ml-3 min-h-11 underline" onClick={()=>setRetry(value=>value+1)}>{uiText('retry')}</button>}</div>
   :!item?<p role="status">{localFlowText('targetMissing')}</p>:<article className="space-y-6 py-5" aria-label={localFlowText('expressionDetails')}>
    <h1 className="font-language text-4xl font-medium">{item.presentation.expression}</h1><p className="text-xl leading-8">{item.presentation.meaning}</p>
    {item.presentation.scene&&<section><h2 className="text-body-support text-fg-secondary">{localFlowText('context')}</h2><p className="mt-2 whitespace-pre-wrap leading-7">{item.presentation.scene}</p></section>}
    <button className="min-h-14 w-full rounded-card border border-border-subtle p-4 text-left" onClick={()=>onEditNote(item.presentation.expression,item.senseId,item.presentation.meaning)}><b>{uiText(personal?.status!=='ready'||personal.note?'myNotes':'writeANoteOnThisMeaning')}</b>{personal?.status==='ready'&&personal.note&&<p className="mt-2 whitespace-pre-wrap text-body-support">{personal.note}</p>}</button>
    {personal?.status!=='ready'&&<p role={personal?.status==='error'?'alert':'status'}>{localFlowText(personal?.status==='error'?'progressReadFailed':'loadingSensa')}{personal?.status==='error'&&<button className="ml-3 min-h-11 underline" onClick={()=>void personalContentSystem.refresh().catch(()=>undefined)}>{uiText('retry')}</button>}</p>}
   </article>,
 }}/>
}
