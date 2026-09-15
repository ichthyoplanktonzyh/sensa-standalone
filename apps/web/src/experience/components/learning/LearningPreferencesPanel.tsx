import {localFlowText} from '../../../i18n/localFlowText';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../../../i18n/LanguageSwitch';
import { learningPolicyProfileRegistry } from '../../../learning/runtime/policyProfiles';
import type { LearningPolicyId } from '../../../learning/runtime/policyProfiles';
import { runtimePrimary } from './RuntimeFrame';

interface Props {
  allowedPolicies?:readonly LearningPolicyId[];
  showDailyQuantity?:boolean;
  onConfirm?:()=>void;
  closeLabel?: string;
  fixedPolicy?: boolean;
  busy?: boolean;
  status?: import('react').ReactNode;
  defaultPolicy: LearningPolicyId;
  dailyNewCount: number;
  onPolicyChange: (policy:LearningPolicyId)=>void;
  onDailyNewCountChange: (count:number)=>void;
  onClose: ()=>void;
}
export function LearningPreferencesPanel({allowedPolicies,showDailyQuantity=true,onConfirm,closeLabel,fixedPolicy,busy,status,defaultPolicy,dailyNewCount,onPolicyChange,onDailyNewCountChange,onClose}:Props) {
  const {t}=useTranslation();
  const [error,setError]=useState(false);
  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
    };
    document.addEventListener('keydown',escape,true);
    return ()=>document.removeEventListener('keydown',escape,true);
  },[onClose]);
  const change=(action:()=>void)=>{
    try {action();setError(false);} catch {setError(true);}
  };
  const counts=[...new Set([5,10,15,20,30,dailyNewCount])].sort((a,b)=>a-b);
  return <div className="fixed inset-0 z-[150] flex items-end justify-end bg-overlay sm:items-stretch" onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section role="dialog" aria-modal="true" aria-labelledby="learning-preferences-title"
      className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-overlay bg-surface-canvas text-fg-primary shadow-overlay sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none">
      <header className="flex shrink-0 items-center justify-between border-b border-border-subtle px-6 py-5">
        <h2 id="learning-preferences-title" className="text-lg font-medium">{t(showDailyQuantity?'learningPreferences.title':'learningSetup.method')}</h2>
        <button autoFocus type="button" className="grid size-11 place-items-center rounded-control text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" onClick={onClose} aria-label={t('learningPreferences.close')}><X size={20}/></button>
      </header>
      <div className="space-y-7 overflow-y-auto px-6 py-7">
        {showDailyQuantity&&<div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">{t('language.label')}</span><LanguageSwitch/>
        </div>}
        {showDailyQuantity&&<p className="text-xs leading-6 text-fg-tertiary">{t('learningPreferences.immediate')}</p>}
        <div className="border-t border-border-subtle pt-6">
          <h3 className="text-sm font-medium">{t(showDailyQuantity?'learningPreferences.defaultPolicy':'learningSetup.method')}</h3>
          <div className="mt-4 grid gap-2" role="radiogroup" aria-label={t(showDailyQuantity?'learningPreferences.defaultPolicy':'learningSetup.method')}>
            {learningPolicyProfileRegistry.list().filter(profile=>(!allowedPolicies||allowedPolicies.includes(profile.profileId))&&(!fixedPolicy||profile.profileId===defaultPolicy)).map(profile=><button key={profile.profileId} disabled={fixedPolicy||busy} type="button" role="radio" aria-checked={profile.profileId===defaultPolicy}
              onClick={()=>change(()=>onPolicyChange(profile.profileId))}
              className={`min-h-12 rounded-control border px-4 text-left text-sm focus-visible:outline-2 focus-visible:outline-focus ${profile.profileId===defaultPolicy?'border-border-strong bg-surface-selected text-action-primary':'border-border-subtle bg-surface-panel text-fg-secondary hover:bg-surface-subtle'}`}>
              {t('learningPreferences.policies.'+profile.profileId)}
            </button>)}
          </div>
        </div>
        {showDailyQuantity&&<label className="flex items-center justify-between gap-4 text-sm font-medium">
          {t('learningPreferences.daily')}
          <select disabled={busy} aria-label={localFlowText('dailyNewQuantity')} className="min-h-12 rounded-control border border-border-subtle bg-surface-panel px-4 text-sm text-fg-secondary focus-visible:outline-2 focus-visible:outline-focus" value={dailyNewCount} onChange={event=>change(()=>onDailyNewCountChange(Number(event.target.value)))}>
            {counts.map(count=><option value={count} key={count}>{t('learningPreferences.count',{count})}</option>)}
          </select>
        </label>}
        {showDailyQuantity&&<p className="text-xs leading-6 text-fg-tertiary">{t('learningPreferences.future')}</p>}
        {status}
        {error&&<p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{t('runtime.saveError')}</p>}
      </div>
      <footer className="mt-auto shrink-0 border-t border-border-subtle px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button type="button" disabled={busy} className={`${runtimePrimary} w-full`} onClick={onConfirm??onClose}>{closeLabel ?? t('learningPreferences.resume')}</button>
      </footer>
    </section>
  </div>;
}
