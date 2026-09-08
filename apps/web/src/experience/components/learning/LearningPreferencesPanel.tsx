import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../../../i18n/LanguageSwitch';
import { learningPolicyProfileRegistry } from '../../learningRuntime/policyProfiles';
import type { PrototypeLearningPolicy } from '../../learningJourney/prototypeLearning';
import { runtimePrimary } from './RuntimeFrame';

interface Props {
  closeLabel?: string;
  fixedPolicy?: boolean;
  busy?: boolean;
  status?: import('react').ReactNode;
  defaultPolicy: PrototypeLearningPolicy;
  dailyNewCount: number;
  onPolicyChange: (policy:PrototypeLearningPolicy)=>void;
  onDailyNewCountChange: (count:number)=>void;
  onClose: ()=>void;
}
export function LearningPreferencesPanel({closeLabel,fixedPolicy,busy,status,defaultPolicy,dailyNewCount,onPolicyChange,onDailyNewCountChange,onClose}:Props) {
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
  return <div className="fixed inset-0 z-[150] flex items-end justify-end bg-[#202738]/30 sm:items-stretch" onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section role="dialog" aria-modal="true" aria-labelledby="learning-preferences-title"
      className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-[#fbfbfa] shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none">
      <header className="flex shrink-0 items-center justify-between border-b border-[#e0e5ee] px-6 py-5">
        <h2 id="learning-preferences-title" className="text-lg font-medium">{t('learningPreferences.title')}</h2>
        <button autoFocus type="button" className="grid size-11 place-items-center rounded-lg text-[#68748d] hover:bg-[#edf0f7]" onClick={onClose} aria-label={t('learningPreferences.close')}><X size={20}/></button>
      </header>
      <div className="space-y-7 overflow-y-auto px-6 py-7">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">{t('language.label')}</span><LanguageSwitch/>
        </div>
        <p className="text-xs leading-6 text-[#788398]">{t('learningPreferences.immediate')}</p>
        <div className="border-t border-[#e0e5ee] pt-6">
          <h3 className="text-sm font-medium">{t('learningPreferences.defaultPolicy')}</h3>
          <div className="mt-4 grid gap-2" role="radiogroup" aria-label={t('learningPreferences.defaultPolicy')}>
            {learningPolicyProfileRegistry.list().filter(profile=>!fixedPolicy||profile.profileId===defaultPolicy).map(profile=><button key={profile.profileId} disabled={fixedPolicy} type="button" role="radio" aria-checked={profile.profileId===defaultPolicy}
              onClick={()=>change(()=>onPolicyChange(profile.profileId))}
              className={`min-h-12 rounded-xl border px-4 text-left text-sm ${profile.profileId===defaultPolicy?'border-[#5268a9] bg-[#edf1fa] text-[#303f76]':'border-[#e0e5ee] bg-white text-[#68748d]'}`}>
              {t('learningPreferences.policies.'+profile.profileId)}
            </button>)}
          </div>
        </div>
        <label className="flex items-center justify-between gap-4 text-sm font-medium">
          {t('learningPreferences.daily')}
          <select disabled={busy} aria-label="每日新学数量" className="min-h-12 rounded-xl border border-[#dce3ef] bg-white px-4 text-sm text-[#546582]" value={dailyNewCount} onChange={event=>change(()=>onDailyNewCountChange(Number(event.target.value)))}>
            {counts.map(count=><option value={count} key={count}>{t('learningPreferences.count',{count})}</option>)}
          </select>
        </label>
        <p className="text-xs leading-6 text-[#788398]">{t('learningPreferences.future')}</p>
        {status}
        {error&&<p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{t('runtime.saveError')}</p>}
      </div>
      <footer className="mt-auto shrink-0 border-t border-[#e0e5ee] px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button type="button" className={`${runtimePrimary} w-full`} onClick={onClose}>{closeLabel ?? t('learningPreferences.resume')}</button>
      </footer>
    </section>
  </div>;
}
