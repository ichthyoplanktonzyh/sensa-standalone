import '../../i18n/contentResources';
import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {worldReadRepository} from '../personalMeaningJourney/worldRepository';
import type {JourneyAlignmentView} from '../personalMeaningJourney/types';
import {personalContentSystem} from '../../personalContent/system';
import {localFlowText} from '../../i18n/localFlowText';
import {uiText} from '../../i18n/uiText';
import {SensaDetailWorkspaceLayout} from '../ui/SensaPageLayouts';
import {contentNavigationClass,contentNavigationBackClass,slideScreenClass,iconClass} from '../ui/primitives';

/** Read an exact retained interpretation, never reinterpret its note through the current Meaning. */
export function ContentPersonalReferenceDetailScreen({active,meaningId,alignmentId,onBack,onEditNote,toast}:{active:boolean;meaningId:string;alignmentId:string;onBack:()=>void;onEditNote:(word:string,senseId:string,meaning:string)=>void;toast:(text:string)=>void}){
 const {t}=useTranslation();
 const [item,setItem]=useState<JourneyAlignmentView|null>(null),[historical,setHistorical]=useState(false),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[retry,setRetry]=useState(0),[,redraw]=useState(0),[busy,setBusy]=useState(false);
 useEffect(()=>{
  let generation=0,cancelled=false;
  const load=async()=>{const current=++generation;setStatus('loading');try{const {detail}=await worldReadRepository.detail(meaningId);const value=detail?.status==='active'?[...detail.directAlignments,...detail.focuses.flatMap(focus=>focus.alignment?[focus.alignment]:[]),...(detail.alignmentHistory??[])].find(row=>row.personalMeaningAlignmentId===alignmentId&&row.confirmedBindings.length)??null:null;if(!cancelled&&current===generation){setItem(value);setHistorical(!!detail?.alignmentHistory?.some(row=>row.personalMeaningAlignmentId===alignmentId));setStatus('ready');}}catch{if(!cancelled&&current===generation)setStatus('error');}};
  const stop=worldReadRepository.subscribe(()=>void load());void load();return()=>{cancelled=true;stop();};
 },[meaningId,alignmentId,retry]);
 useEffect(()=>personalContentSystem.subscribe({kind:'snapshot'},()=>redraw(value=>value+1)),[]);
 const personal=item?personalContentSystem.read({kind:'sense',senseId:item.senseId}):null;
 const save=async()=>{
  if(!item||!personal||personal.status!=='ready'||busy||status!=='ready')return;setBusy(true);
  try{const saved=await personalContentSystem.execute({kind:'set_saved_sense',operationId:crypto.randomUUID(),senseId:item.senseId,saved:!personal.saved});toast(uiText(saved?'meaningSaved':'meaningRemovedFromSaved'));}
  catch{toast(uiText('saveFailed'));}finally{setBusy(false);}
 };
 return <SensaDetailWorkspaceLayout id="s-content-sense" className={slideScreenClass(active)} aria-hidden={!active} regions={{
  header:<div className={contentNavigationClass}><button className={contentNavigationBackClass} onClick={onBack} aria-label={uiText('back2')}><svg className={iconClass} aria-hidden="true"><use href="#i-chev-l"/></svg></button><span>{historical?t('meaningGovernance.history'):uiText('meaning3')}</span>{item&&<button disabled={busy||status!=='ready'||personal?.status!=='ready'} className="grid size-11 place-items-center rounded-control text-action-primary" aria-pressed={personal?.status==='ready'?personal.saved:undefined} aria-label={uiText(personal?.status==='ready'&&personal.saved?'unsaveThisMeaning':'saveThisMeaning')} onClick={()=>void save()}><svg className={iconClass+(personal?.status==='ready'&&personal.saved?' fill-current':'')} aria-hidden="true"><use href="#i-star"/></svg></button>}</div>,
  primary:status!=='ready'?<div role={status==='error'?'alert':'status'} className="p-5">{localFlowText(status==='error'?'progressReadFailed':'loadingSensa')}{status==='error'&&<button className="ml-3 min-h-11 underline" onClick={()=>setRetry(value=>value+1)}>{uiText('retry')}</button>}</div>
   :!item?<p role="status">{localFlowText('targetMissing')}</p>:<article className="space-y-6 py-5">
    <h1 className="break-words font-language text-4xl font-medium">{item.confirmedBindings.map(binding=>binding.surfaceForm).join(' / ')}</h1><p className="whitespace-pre-wrap break-words text-xl leading-8">{item.coreMeaningFocus}</p>
    <button className="min-h-14 w-full rounded-card border border-border-subtle p-4 text-left" onClick={()=>onEditNote(item.confirmedBindings[0]!.surfaceForm,item.senseId,item.coreMeaningFocus)}><b>{uiText(personal?.status!=='ready'||personal.note?'myNotes':'writeANoteOnThisMeaning')}</b>{personal?.status==='ready'&&personal.note&&<p className="mt-2 whitespace-pre-wrap break-words text-body-support">{personal.note}</p>}</button>
    {personal?.status!=='ready'&&<p role={personal?.status==='error'?'alert':'status'}>{localFlowText(personal?.status==='error'?'progressReadFailed':'loadingSensa')}{personal?.status==='error'&&<button className="ml-3 min-h-11 underline" onClick={()=>void personalContentSystem.refresh().catch(()=>undefined)}>{uiText('retry')}</button>}</p>}
   </article>,
 }}/>
}
