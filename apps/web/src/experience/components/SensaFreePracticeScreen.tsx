import { ArrowRight, Headphones, Mic, BookOpen, PenLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {localFlowText} from '../../i18n/localFlowText';
import { resolvePracticeActivities } from '../practiceInventory';
import type { AcademyScreenProps } from './AcademyScreen';
export const practiceButton='inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40';
export const practiceSurface=(active:boolean)=>`screen absolute inset-0 z-20 overflow-y-auto bg-surface-canvas font-product text-fg-primary ${active?'active':'invisible pointer-events-none'}`;
export const practiceBody='mx-auto max-w-[1280px] px-6 py-8 sm:px-10 lg:px-14 lg:py-14';
export const SensaFreePracticeScreen=({active,onOpenPracticeScope,onOpenRealWorldListening,onBrowseContent,onRecordContext,practiceScope,scopeAvailability='ready',onRetryScope}:AcademyScreenProps)=>{
 const {t}=useTranslation();
 const scopeReady=scopeAvailability==='ready';
 const icons={listening:Headphones,speaking:Mic,reading:BookOpen,writing:PenLine};
 const forms=[...new Set(practiceScope.targets.map(target=>target.expression.surfaceForm))];
 return <section id="s-academy" className={practiceSurface(active)}><main className={practiceBody}>
  <h1 className="text-3xl font-medium tracking-tight lg:text-4xl">{t('practice.title')}</h1><p className="mt-3 text-sm text-fg-tertiary">{t('practice.note')}</p>
  <button onClick={onOpenPracticeScope} className="my-9 flex w-full flex-wrap items-center gap-5 rounded-overlay bg-surface-subtle p-6 text-left focus-visible:outline-2 focus-visible:outline-focus sm:p-8">
   <span className="min-w-0 flex-1">{scopeReady?<><span className="text-xs text-fg-secondary">{t('practice.scope')} · {t('practice.sources.'+practiceScope.sourceId)}</span><strong className="mt-3 block text-xl font-medium">{forms.slice(0,4).join(' · ')||t('practice.empty')}{forms.length>4?' …':''}</strong></>:scopeAvailability==='loading'?<span role="status" aria-busy="true">{localFlowText('loadingSensa')}</span>:<span role="alert">{t('content.loadError')}</span>}</span>
   <span className="flex items-center gap-3 text-sm text-fg-secondary">{scopeReady&&t('practice.count',{count:practiceScope.targets.length})}<ArrowRight size={18}/></span>
  </button>
  {scopeReady&&!practiceScope.targets.length&&<div className="mb-9 flex flex-wrap gap-3">
   <button onClick={onBrowseContent} className={`${practiceButton} bg-action-primary text-action-on-primary hover:bg-action-primary-hover`}>{localFlowText('packageCenterCatalog')}</button>
   <button onClick={onRecordContext} className={`${practiceButton} text-fg-secondary hover:bg-surface-selected`}>{t('home.personal')}</button>
  </div>}
  {scopeAvailability==='unavailable'&&onRetryScope&&<button onClick={onRetryScope} className={practiceButton}>{t('content.retry')}</button>}
  <div className="sensa-practice-activities grid gap-5">{resolvePracticeActivities(practiceScope).map(activity=>{
   const Icon=icons[activity.primaryArea],available=scopeReady&&activity.status==='available';
   return <button key={activity.id} disabled={!available} onClick={onOpenRealWorldListening} className={`flex min-h-60 flex-col items-start rounded-overlay border p-7 text-left focus-visible:outline-2 focus-visible:outline-focus ${available?'border-border-strong bg-surface-panel hover:border-focus':'border-border-subtle bg-surface-subtle text-fg-tertiary'}`}>
    <span className="flex w-full items-center justify-between"><Icon size={24}/><span className="text-xs">{t('practice.areas.'+activity.primaryArea)}</span></span>
    <h2 className="mt-6 text-xl font-medium">{t('practice.names.'+activity.primaryArea)}</h2><p className="mt-2 text-sm text-fg-tertiary">{t('practice.cues.'+activity.primaryArea)}</p>
    <span className="mt-6 flex items-center gap-2 text-xs">{scopeReady&&t('practice.status.'+activity.status)}{available&&<ArrowRight size={15}/>}</span>
   </button>;
  })}</div>
 </main></section>;
};
