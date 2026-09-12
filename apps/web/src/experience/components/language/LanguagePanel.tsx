import {useEffect,useState} from 'react';
import {X,Check,Plus,Trash2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {
  sensaLanguageDisplayName,sensaLanguageForRole,sensaLanguage,type SensaLanguageProfile,
} from '@sensa/contracts/sensa';
import {useLanguageProfile} from '../../library/useLanguageProfile';
import {runtimePrimary} from '../learning/RuntimeFrame';

/** Two names per language on purpose: the endonym is what the learner recognises,
 * the interface-language name is what they can read before they know it. */
function languageNames(tag:string,interfaceLanguage:string){
  const language=sensaLanguage(tag);
  if(!language)return {endonym:tag,name:tag};
  return {endonym:language.endonym,name:sensaLanguageDisplayName(tag,interfaceLanguage==='en'?'en':'zh-CN')};
}

/** The settings row shows which languages are being learned without opening the
 * panel. The list separator comes from the locale, so no copy is baked in. */
export function languageSummary(profile:SensaLanguageProfile,interfaceLanguage:string):string{
  const locale=interfaceLanguage==='en'?'en':'zh-CN';
  const targets=new Intl.ListFormat(locale,{style:'long',type:'unit'}).format(profile.targetLanguageTags.map(tag=>languageNames(tag,locale).name));
  return `${languageNames(profile.familiarLanguageTag,locale).name} → ${targets}`;
}

interface Props {
  profile:SensaLanguageProfile;
  busy:boolean;
  notice:string;
  onAdd:(tag:string)=>void;
  onRemove:(tag:string)=>void;
  onSetActive:(tag:string)=>void;
  onClose:()=>void;
}

/** Choosing target languages is a standing decision, so it lives in one panel
 * instead of a control repeated on every content surface. */
export function LanguagePanel({profile,busy,notice,onAdd,onRemove,onSetActive,onClose}:Props){
  const {t,i18n}=useTranslation();
  const [pending,setPending]=useState('');
  const locale=i18n.language==='en'?'en':'zh-CN';
  const addable=sensaLanguageForRole('target').filter(language=>!profile.targetLanguageTags.includes(language.tag)&&language.tag!==profile.familiarLanguageTag);
  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
    };
    document.addEventListener('keydown',escape,true);
    return ()=>document.removeEventListener('keydown',escape,true);
  },[onClose]);
  const familiar=languageNames(profile.familiarLanguageTag,locale);
  return <div className="fixed inset-0 z-[150] flex items-end justify-end bg-[#202738]/30 sm:items-stretch" onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section role="dialog" aria-modal="true" aria-labelledby="languages-title"
      className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-[#fbfbfa] shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none">
      <header className="flex shrink-0 items-center justify-between border-b border-[#e0e5ee] px-6 py-5">
        <h2 id="languages-title" className="text-lg font-medium">{t('languages.title')}</h2>
        <button autoFocus type="button" className="grid size-11 place-items-center rounded-lg text-[#68748d] hover:bg-[#edf0f7]" onClick={onClose} aria-label={t('languages.close')}><X size={20}/></button>
      </header>
      <div className="space-y-7 overflow-y-auto px-6 py-7">
        <section>
          <h3 className="text-sm font-medium">{t('languages.familiar')}</h3>
          <p className="mt-3 flex min-h-12 flex-wrap items-center gap-x-3 rounded-xl border border-[#e0e5ee] bg-white px-4 py-3 text-sm">
            <span className="font-medium text-[#303f76]">{familiar.endonym}</span>
            <span className="text-[#788398]">{familiar.name}</span>
          </p>
          <p className="mt-2 text-xs leading-6 text-[#788398]">{t('languages.familiarNote')} {t('languages.familiarFixed')}</p>
        </section>
        <section className="border-t border-[#e0e5ee] pt-6">
          <h3 className="text-sm font-medium">{t('languages.active')}</h3>
          <p className="mt-2 text-xs leading-6 text-[#788398]">{t('languages.activeNote')}</p>
          <div role="radiogroup" aria-label={t('languages.targets')} className="mt-4 rounded-xl border border-[#e0e5ee] bg-white px-4">
            {profile.targetLanguageTags.map(tag=>{
              const names=languageNames(tag,locale),active=tag===profile.activeTargetLanguageTag;
              return <div key={tag} className="flex min-h-16 flex-wrap items-center gap-3 border-b border-[#e0e5ee] py-3 last:border-b-0">
                <button type="button" role="radio" aria-checked={active} disabled={busy||active} onClick={()=>onSetActive(tag)}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5268a9]">
                  <span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center rounded-full border ${active?'border-[#5268a9] bg-[#5268a9] text-white':'border-[#c8d1e2]'}`}>{active&&<Check size={13}/>}</span>
                  <span className="min-w-0"><span className="block truncate font-medium text-[#303f76]">{names.endonym}</span><span className="block truncate text-xs text-[#788398]">{names.name}</span></span>
                  {active&&<span className="ml-2 shrink-0 rounded-full bg-[#edf1fa] px-2 py-0.5 text-xs text-[#303f76]">{t('languages.activeBadge')}</span>}
                  <span className="sr-only">{active?t('languages.activeBadge'):t('languages.makeActive')}</span>
                </button>
                <button type="button" disabled={busy||profile.targetLanguageTags.length<2} onClick={()=>onRemove(tag)} aria-label={t('languages.removeLabel',{language:names.name})}
                  className="grid size-11 shrink-0 place-items-center rounded-lg text-[#68748d] hover:bg-[#edf0f7] focus-visible:outline-2 focus-visible:outline-[#5268a9] disabled:opacity-40"><Trash2 size={17}/></button>
              </div>;
            })}
          </div>
          <p className="mt-2 text-xs leading-6 text-[#788398]">{t('languages.targetsNote')}</p>
        </section>
        {addable.length>0&&<section className="border-t border-[#e0e5ee] pt-6">
          <h3 className="text-sm font-medium">{t('languages.add')}</h3>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <select aria-label={t('languages.addLabel')} disabled={busy} value={pending} onChange={event=>setPending(event.target.value)}
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#dce3ef] bg-white px-4 text-sm text-[#546582]">
              <option value="">{t('languages.addLabel')}</option>
              {addable.map(language=><option key={language.tag} value={language.tag}>{language.endonym} · {sensaLanguageDisplayName(language.tag,locale)}</option>)}
            </select>
            <button type="button" disabled={busy||!pending} onClick={()=>{onAdd(pending);setPending('');}}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-[#dce3ef] bg-white px-4 text-sm text-[#303f76] hover:bg-[#edf0f7] focus-visible:outline-2 focus-visible:outline-[#5268a9] disabled:opacity-40"><Plus size={16}/>{t('languages.addAction')}</button>
          </div>
        </section>}
        {notice&&<p role="status" className="rounded-lg bg-[#edf1fa] p-4 text-sm text-[#303f76]">{notice}</p>}
      </div>
      <footer className="mt-auto shrink-0 border-t border-[#e0e5ee] px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button type="button" disabled={busy} className={`${runtimePrimary} w-full`} onClick={onClose}>{t('languages.done')}</button>
      </footer>
    </section>
  </div>;
}

/** The panel owns its own profile read, so the settings page only renders it. */
export function LanguagePanelHost({onClose}:{onClose:()=>void}){
  const {profile,busy,notice,addTarget,removeTarget,setActiveTarget}=useLanguageProfile();
  return <LanguagePanel profile={profile} busy={busy} notice={notice} onAdd={tag=>void addTarget(tag)} onRemove={tag=>void removeTarget(tag)} onSetActive={tag=>void setActiveTarget(tag)} onClose={onClose}/>;
}
