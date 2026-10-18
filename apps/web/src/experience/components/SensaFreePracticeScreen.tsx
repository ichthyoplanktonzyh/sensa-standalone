import {useBrowserOnline} from '../useBrowserOnline';
import { ArrowRight, Headphones, Mic, BookOpen, PenLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {localFlowText} from '../../i18n/localFlowText';
import type { AcademyScreenProps } from './AcademyScreen';
export const practiceButton='inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40';
export const practiceSurface=(active:boolean)=>`screen absolute inset-0 z-20 overflow-y-auto bg-surface-canvas font-product text-fg-primary ${active?'active':'invisible pointer-events-none'}`;
export const practiceBody='mx-auto max-w-[1280px] px-6 py-8 sm:px-10 lg:px-14 lg:py-14';
export const SensaFreePracticeScreen=({active,onOpenPracticeScope,onOpenRealWorldListening,onBrowseContent,onRecordContext,selection,preview,count,scopeAvailability='ready',onRetryScope,starting=false,onCancelStart,startError,recentPlaybackCount}:AcademyScreenProps)=>{
 const {t,i18n}=useTranslation();
 const quantity=(key:string,count:number)=>t(key,{count,formattedCount:new Intl.NumberFormat(i18n.language).format(count)});
 const scopeReady=scopeAvailability==='ready',online=useBrowserOnline();
 const icons={listening:Headphones,speaking:Mic,reading:BookOpen,writing:PenLine};
 const forms=preview;
 return <section id="s-academy" className={practiceSurface(active)}><main className={practiceBody}>
  <h1 className="text-3xl font-medium tracking-tight lg:text-4xl">{t('practice.title')}</h1><p className="mt-3 text-sm text-fg-secondary">{t('practice.note')}</p>
  <button aria-label={t('practice.scope')} aria-describedby="practice-material-summary practice-material-count" onClick={onOpenPracticeScope} className="my-6 flex w-full flex-wrap items-center gap-3 border-y border-border-subtle py-4 text-left focus-visible:outline-2 focus-visible:outline-focus sm:p-8">
   <span id="practice-material-summary" className="min-w-0 flex-1">{scopeReady?<><span className="text-xs text-fg-secondary">{t('practice.scope')} · {t(selection.source==='books'?'practice.sources.current_study':'practice.sources.personal_semantic_world')}</span><strong className="mt-3 block text-xl font-medium">{forms.length?forms.map((expression,index)=><span key={expression.id}>{index>0?' · ':''}<bdi lang={expression.languageTag} dir="auto">{expression.text}</bdi></span>):t('practice.empty')}{(count??0)>forms.length?' …':''}</strong></>:scopeAvailability==='loading'?<span role="status" aria-busy="true">{localFlowText('loadingSensa')}</span>:<span role="alert">{t('content.loadError')}</span>}</span>
   <span id="practice-material-count" className="flex items-center gap-3 text-sm text-fg-secondary">{scopeReady&&quantity('practice.count',count??0)}<ArrowRight size={18}/></span>
  </button>
  {scopeReady&&!count&&<div className="mb-9 flex flex-wrap gap-3">
   <button onClick={onBrowseContent} className={`${practiceButton} bg-action-primary text-action-on-primary hover:bg-action-primary-hover`}>{localFlowText('packageCenterCatalog')}</button>
   <button onClick={onRecordContext} className={`${practiceButton} text-fg-secondary hover:bg-surface-selected`}>{t('home.personal')}</button>
  </div>}
  {scopeAvailability==='unavailable'&&onRetryScope&&<button onClick={onRetryScope} className={practiceButton}>{t('content.retry')}</button>}
  <div className="mb-4 text-sm text-fg-secondary"><p>{t('practice.serviceRequirement')}</p>{!online&&<p className="mt-2" role="status">{t('practice.offline')}</p>}<details className="mt-1"><summary className="min-h-11 cursor-pointer py-3">{t('practice.serviceDetails')}</summary>{online&&<p className="pb-2" role="status">{t('practice.serviceUnchecked')}</p>}<p className="pb-2">{t('practice.boundary')}</p>{scopeReady&&<p className="pb-2">{t(selection.expressionIds===null?'practice.entireSource':'practice.selectedMaterials')}</p>}</details></div>
  {starting&&<div className="mb-5 flex flex-wrap items-center gap-3" role="status" aria-busy="true"><span>{t('practice.starting')}</span><button className={practiceButton} onClick={onCancelStart}>{t('practice.cancelStart')}</button></div>}
  {startError&&<div className="mb-5" role="alert"><p>{startError}</p><button className={practiceButton} onClick={onOpenRealWorldListening}>{t('practice.retry')}</button></div>}
  {recentPlaybackCount!==null&&recentPlaybackCount!==undefined&&<section className="mb-6 border-b border-border-subtle py-4" aria-label={t('practice.recentSession')}><h2 className="font-medium">{t('practice.recentSession')}</h2><p className="mt-2 text-sm" role="status">{quantity(recentPlaybackCount?'practice.playbackObserved':'practice.playbackUnconfirmed',recentPlaybackCount)}</p></section>}
  <div className="sensa-practice-activities grid gap-5">{[{id:'real_world_speech_variation',primaryArea:'listening' as const,status:count?'available':'unavailable_in_scope'}].map(activity=>{
   const Icon=icons[activity.primaryArea],available=scopeReady&&online&&activity.status==='available';
   return <button key={activity.id} disabled={!available} onClick={onOpenRealWorldListening} className={`flex min-h-60 flex-col items-start rounded-overlay border p-7 text-left focus-visible:outline-2 focus-visible:outline-focus ${available?'border-border-strong bg-surface-panel hover:border-focus':'border-border-subtle bg-surface-subtle text-fg-secondary'}`}>
    <span className="flex w-full items-center justify-between"><Icon size={24}/><span className="text-xs">{t('practice.areas.'+activity.primaryArea)}</span></span>
    <h2 className="mt-3 text-xl font-medium">{t('practice.names.'+activity.primaryArea)}</h2><p className="mt-2 text-sm text-fg-secondary">{t('practice.cues.'+activity.primaryArea)}</p>
    <span className="mt-4 flex items-center gap-2 text-sm">{scopeReady&&t('practice.status.'+activity.status)}{available&&<ArrowRight size={15}/>}</span>
   </button>;
  })}</div>
 </main></section>;
};
