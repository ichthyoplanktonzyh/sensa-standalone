import {useBrowserOnline} from '../useBrowserOnline';
import { ArrowRight, Headphones, Mic, BookOpen, PenLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {localFlowText} from '../../i18n/localFlowText';
import type { AcademyScreenProps } from './AcademyScreen';
export const practiceButton='inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40';
export const practiceSurface=(active:boolean)=>`screen absolute inset-0 z-20 overflow-y-auto bg-surface-canvas font-product text-fg-primary ${active?'active':'invisible pointer-events-none'}`;
export const practiceBody='mx-auto max-w-[1280px] px-6 py-8 sm:px-10 lg:px-14 lg:py-14';
export const SensaFreePracticeScreen=({active,onOpenPracticeScope,onOpenRealWorldListening,onBrowseContent,onRecordContext,selection,preview,count,scopeAvailability='ready',onRetryScope,starting=false,onCancelStart,startError,recentPlaybackCount}:AcademyScreenProps)=>{
 const {t}=useTranslation();
 const scopeReady=scopeAvailability==='ready',online=useBrowserOnline();
 const icons={listening:Headphones,speaking:Mic,reading:BookOpen,writing:PenLine};
 const forms=preview.map(expression=>expression.text);
 return <section id="s-academy" className={practiceSurface(active)}><main className={practiceBody}>
  <h1 className="text-3xl font-medium tracking-tight lg:text-4xl">{t('practice.title')}</h1><p className="mt-3 text-sm text-fg-tertiary">{t('practice.note')}</p>
  <button aria-label={t('practice.scope')} onClick={onOpenPracticeScope} className="my-9 flex w-full flex-wrap items-center gap-5 rounded-overlay bg-surface-subtle p-6 text-left focus-visible:outline-2 focus-visible:outline-focus sm:p-8">
   <span className="min-w-0 flex-1">{scopeReady?<><span className="text-xs text-fg-secondary">{t('practice.scope')} · {t(selection.source==='books'?'practice.sources.current_study':'practice.sources.personal_semantic_world')}</span><strong className="mt-3 block text-xl font-medium">{forms.join(' · ')||t('practice.empty')}{(count??0)>forms.length?' …':''}</strong></>:scopeAvailability==='loading'?<span role="status" aria-busy="true">{localFlowText('loadingSensa')}</span>:<span role="alert">{t('content.loadError')}</span>}</span>
   <span className="flex items-center gap-3 text-sm text-fg-secondary">{scopeReady&&t('practice.count',{count:count??0})}<ArrowRight size={18}/></span>
  </button>
  {scopeReady&&!count&&<div className="mb-9 flex flex-wrap gap-3">
   <button onClick={onBrowseContent} className={`${practiceButton} bg-action-primary text-action-on-primary hover:bg-action-primary-hover`}>{localFlowText('packageCenterCatalog')}</button>
   <button onClick={onRecordContext} className={`${practiceButton} text-fg-secondary hover:bg-surface-selected`}>{t('home.personal')}</button>
  </div>}
  {scopeAvailability==='unavailable'&&onRetryScope&&<button onClick={onRetryScope} className={practiceButton}>{t('content.retry')}</button>}
  <div className="mb-5 rounded-card border border-border-subtle bg-surface-panel p-5 text-sm">
   <p>{t('practice.serviceRequirement')}</p><p className="mt-2 text-fg-secondary" role="status">{t(online?'practice.serviceUnchecked':'practice.offline')}</p>
   {scopeReady&&<p className="mt-2 text-xs text-fg-secondary">{t(selection.expressionIds===null?'practice.entireSource':'practice.selectedMaterials')}</p>}
  </div>
  {starting&&<div className="mb-5 flex flex-wrap items-center gap-3" role="status" aria-busy="true"><span>{t('practice.starting')}</span><button className={practiceButton} onClick={onCancelStart}>{t('practice.cancelStart')}</button></div>}
  {startError&&<div className="mb-5" role="alert"><p>{startError}</p><button className={practiceButton} onClick={onOpenRealWorldListening}>{t('practice.retry')}</button></div>}
  {recentPlaybackCount!==null&&recentPlaybackCount!==undefined&&<section className="mb-6 rounded-card border border-border-subtle p-5" aria-label={t('practice.recentSession')}><h2 className="font-medium">{t('practice.recentSession')}</h2><p className="mt-2 text-sm" role="status">{t(recentPlaybackCount?'practice.playbackObserved':'practice.playbackUnconfirmed',{count:recentPlaybackCount})}</p><p className="mt-2 text-xs text-fg-secondary">{t('practice.boundary')}</p></section>}
  <div className="sensa-practice-activities grid gap-5">{[{id:'real_world_speech_variation',primaryArea:'listening' as const,status:count?'available':'unavailable_in_scope'}].map(activity=>{
   const Icon=icons[activity.primaryArea],available=scopeReady&&online&&activity.status==='available';
   return <button key={activity.id} disabled={!available} onClick={onOpenRealWorldListening} className={`flex min-h-60 flex-col items-start rounded-overlay border p-7 text-left focus-visible:outline-2 focus-visible:outline-focus ${available?'border-border-strong bg-surface-panel hover:border-focus':'border-border-subtle bg-surface-subtle text-fg-tertiary'}`}>
    <span className="flex w-full items-center justify-between"><Icon size={24}/><span className="text-xs">{t('practice.areas.'+activity.primaryArea)}</span></span>
    <h2 className="mt-6 text-xl font-medium">{t('practice.names.'+activity.primaryArea)}</h2><p className="mt-2 text-sm text-fg-tertiary">{t('practice.cues.'+activity.primaryArea)}</p>
    <span className="mt-6 flex items-center gap-2 text-xs">{scopeReady&&t('practice.status.'+activity.status)}{available&&<ArrowRight size={15}/>}</span>
   </button>;
  })}</div>
 </main></section>;
};
