import { useEffect, useState } from 'react';
import { Check, LockKeyhole } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isPolicyAvailableForTarget, type PrototypeLearningPolicy, type PrototypeLearningTargetView } from '../../learningJourney/prototypeLearning';
import { learningPolicyProfileRegistry } from '../../learningRuntime/policyProfiles';
import { LearningSetupFrame, setupButton, setupPrimary } from './LearningSetupFrame';

interface LearningPolicyScreenProps {
  active:boolean;
  target:PrototypeLearningTargetView|null;
  selectedPolicy:PrototypeLearningPolicy;
  onBack:()=>void;
  onSelect:(policy:PrototypeLearningPolicy)=>void;
}
export const LearningPolicyScreen=({active,target,selectedPolicy,onBack,onSelect}:LearningPolicyScreenProps)=>{
  const {t}=useTranslation();
  const [draft,setDraft]=useState(selectedPolicy);
  const [error,setError]=useState(false);
  useEffect(()=>{setDraft(selectedPolicy);setError(false);},[active,target?.targetId,selectedPolicy]);
  const profiles=learningPolicyProfileRegistry.list();
  const allowed=(policy:PrototypeLearningPolicy)=>!target||isPolicyAvailableForTarget(target,policy);
  const save=()=>{
    if(!allowed(draft))return;
    try {onSelect(draft);setError(false);onBack();} catch {setError(true);}
  };
  return <LearningSetupFrame id="s-learning-policy" active={active} onBack={onBack} title={t('learningSetup.method')}>
    <div className="max-w-2xl">
      <p className="text-xs font-medium text-[#68748d]">{t(target?'learningSetup.scopeTarget':'learningSetup.scopeDefault')}</p>
      <h2 className="mt-3 text-3xl font-medium tracking-tight">{t('learningSetup.choose')}</h2>
      <p className="mt-4 text-sm leading-7 text-[#68748d]">{t('learningSetup.chooseHint')}</p>
      {target&&<div className="mt-6 border-l-2 border-[#a5b2d0] pl-4"><strong className="text-xl font-medium">{target.expression}</strong><p className="mt-2 text-sm leading-6 text-[#68748d]">{target.meaning}</p></div>}
    </div>
    <fieldset className="mt-8 grid gap-4">
      <legend className="sr-only">{t('learningSetup.choose')}</legend>
      {profiles.map(profile=>{
        const available=allowed(profile.profileId);
        const selected=draft===profile.profileId;
        return <label key={profile.profileId} className={`flex items-start gap-4 rounded-2xl border p-5 sm:p-6 ${selected?'border-[#5268a9] bg-[#edf0f7]':'border-[#e0e5ee] bg-white'} ${available?'cursor-pointer':'opacity-60'}`}>
          <input type="radio" name="learning-setup-policy" value={profile.profileId} checked={selected} disabled={!available} onChange={()=>{setDraft(profile.profileId);setError(false);}} className="mt-1 size-5 shrink-0 accent-[#303f76]"/>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center justify-between gap-3"><strong className="font-medium">{t('learningPreferences.policies.'+profile.profileId,{defaultValue:profile.presentation.label})}</strong>{selected?<Check size={18} className="text-[#5268a9]" aria-hidden="true"/>:!available?<LockKeyhole size={16} aria-hidden="true"/>:null}</span>
            <span className="mt-3 block text-sm leading-7 text-[#68748d]">{t('learningSetup.descriptions.'+profile.profileId,{defaultValue:profile.presentation.description})}</span>
            {!available&&<span className="mt-3 block text-xs leading-6 text-[#835c45]">{t('learningSetup.blockedHint')}</span>}
          </span>
        </label>;
      })}
    </fieldset>
    <footer className="mt-8 border-t border-[#e0e5ee] pt-6 pb-8">
      <p className="text-sm leading-6 text-[#68748d]">{t('learningSetup.draftHint')}</p>
      {error&&<p role="alert" className="mt-4 text-sm text-red-700">{t('learningSetup.saveError')}</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" className={setupPrimary} disabled={!allowed(draft)} onClick={save}>{t('learningSetup.confirm')}</button>
        <button type="button" className={setupButton+' text-[#68748d] hover:bg-[#edf0f7]'} onClick={onBack}>{t('learningSetup.back')}</button>
      </div>
    </footer>
  </LearningSetupFrame>;
};
