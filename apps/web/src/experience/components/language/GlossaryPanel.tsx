import '../../../i18n/profileResources';
import {useEffect,useState} from 'react';
import {X,Plus,Trash2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {sensaLanguageDisplayName,sensaLanguages,sensaReadingGlossaryForPair,sensaReadingGlossaryLimits,type SensaReadingGlossary} from '@sensa/contracts/sensa';
import {useReadingGlossary} from '../../library/useReadingGlossary';
import {useLanguageRoutes} from '../../library/useLanguageRoutes';
import {SensaOverlayLayout} from '../../ui/SensaComponents';
import {runtimePrimary} from '../learning/RuntimeFrame';

interface Props {
  glossary:SensaReadingGlossary;
  busy:boolean;
  notice:string;
  initialInputLanguageTag:string;
  initialOutputLanguageTag:string;
  onAdd:(inputLanguageTag:string,outputLanguageTag:string,term:string,rendering:string)=>void;
  onRemove:(inputLanguageTag:string,outputLanguageTag:string,term:string)=>void;
  onClose:()=>void;
}

/** Words the learner wants to read their own way are a standing choice, like the
 * language pair: one panel, reachable from the settings page, rather than an
 * editor attached to every translation. */
export function GlossaryPanel({glossary,busy,notice,initialInputLanguageTag,initialOutputLanguageTag,onAdd,onRemove,onClose}:Props){
  const {t,i18n}=useTranslation();
  const [term,setTerm]=useState(''),[rendering,setRendering]=useState('');
  const [inputLanguageTag,setInputLanguageTag]=useState(initialInputLanguageTag),[outputLanguageTag,setOutputLanguageTag]=useState(initialOutputLanguageTag);
  const visible=sensaReadingGlossaryForPair(glossary,inputLanguageTag,outputLanguageTag);
  const pairFull=visible.length>=sensaReadingGlossaryLimits.entriesPerPair;
  const totalFull=glossary.length>=sensaReadingGlossaryLimits.totalEntries;
  const full=pairFull||totalFull;
  const addable=!busy&&!full&&term.trim().length>0&&rendering.trim().length>0;
  const locale=i18n.language==='en'?'en':'zh-CN';
  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
    };
    document.addEventListener('keydown',escape,true);
    return ()=>document.removeEventListener('keydown',escape,true);
  },[onClose]);
  return <SensaOverlayLayout variant="sheet" measure="compact" className="z-[150]" labelledBy="glossary-title" onDismiss={onClose} dismissOnBackdrop regions={{
    header: <div className="flex items-center justify-between">
        <h2 id="glossary-title" className="text-lg font-medium">{t('glossary.title')}</h2>
        <button autoFocus type="button" className="grid size-11 place-items-center rounded-control text-fg-secondary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus" onClick={onClose} aria-label={t('glossary.close')}><X size={20}/></button>
      </div>,
    primary: <div className="space-y-7">
        <p className="text-xs leading-6 text-fg-tertiary">{t('glossary.intro')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-fg-tertiary">{t('glossary.inputLanguage')}
            <select value={inputLanguageTag} disabled={busy} onChange={event=>setInputLanguageTag(event.target.value)} className="mt-2 min-h-12 w-full rounded-control border border-border-strong bg-surface-panel px-4 text-sm text-action-primary focus-visible:outline-2 focus-visible:outline-focus">
              {sensaLanguages.map(language=><option key={language.tag} value={language.tag}>{language.endonym} · {sensaLanguageDisplayName(language.tag,locale)}</option>)}
            </select>
          </label>
          <label className="text-xs text-fg-tertiary">{t('glossary.outputLanguage')}
            <select value={outputLanguageTag} disabled={busy} onChange={event=>setOutputLanguageTag(event.target.value)} className="mt-2 min-h-12 w-full rounded-control border border-border-strong bg-surface-panel px-4 text-sm text-action-primary focus-visible:outline-2 focus-visible:outline-focus">
              {sensaLanguages.map(language=><option key={language.tag} value={language.tag}>{language.endonym} · {sensaLanguageDisplayName(language.tag,locale)}</option>)}
            </select>
          </label>
        </div>
        <section>
          {visible.length===0
            ? <p className="rounded-card border border-border-subtle bg-surface-panel px-4 py-6 text-sm text-fg-tertiary">{t('glossary.empty')}</p>
            : <ul className="rounded-card border border-border-subtle bg-surface-panel px-4">
                {visible.map(entry=><li key={entry.term} className="flex min-h-16 flex-wrap items-center gap-3 border-b border-border-subtle py-3 last:border-b-0">
                  <span className="min-w-0 flex-1 text-sm"><span className="block truncate font-medium text-action-primary">{entry.term}</span><span className="block truncate text-xs text-fg-tertiary">{entry.rendering}</span></span>
                  <button type="button" disabled={busy} onClick={()=>onRemove(inputLanguageTag,outputLanguageTag,entry.term)} aria-label={t('glossary.removeLabel',{term:entry.term})}
                    className="grid size-11 shrink-0 place-items-center rounded-control text-fg-secondary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40"><Trash2 size={17}/></button>
                </li>)}
              </ul>}
        </section>
        <section className="border-t border-border-subtle pt-6">
          <h3 className="text-sm font-medium">{t('glossary.add')}</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-fg-tertiary">{t('glossary.term')}
              <input value={term} disabled={busy||full} maxLength={sensaReadingGlossaryLimits.term} onChange={event=>setTerm(event.target.value)}
                className="mt-2 min-h-12 w-full rounded-control border border-border-strong bg-surface-panel px-4 text-sm text-action-primary focus-visible:outline-2 focus-visible:outline-focus"/></label>
            <label className="text-xs text-fg-tertiary">{t('glossary.rendering')}
              <input value={rendering} disabled={busy||full} maxLength={sensaReadingGlossaryLimits.rendering} onChange={event=>setRendering(event.target.value)}
                className="mt-2 min-h-12 w-full rounded-control border border-border-strong bg-surface-panel px-4 text-sm text-action-primary focus-visible:outline-2 focus-visible:outline-focus"/></label>
          </div>
          <button type="button" disabled={!addable} onClick={()=>{onAdd(inputLanguageTag,outputLanguageTag,term,rendering);setTerm('');setRendering('');}}
            className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-control border border-border-strong bg-surface-panel px-4 text-sm text-action-primary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40"><Plus size={16}/>{t('glossary.addAction')}</button>
          <p className="mt-2 text-xs leading-6 text-fg-tertiary">{totalFull?t('glossary.totalLimit',{count:sensaReadingGlossaryLimits.totalEntries}):pairFull?t('glossary.limit',{count:sensaReadingGlossaryLimits.entriesPerPair}):t('glossary.hint')}</p>
        </section>
        {notice&&<p role="status" className="rounded-control bg-accent-soft p-4 text-sm text-action-primary">{notice}</p>}
      </div>,
    controls:
        <button type="button" disabled={busy} className={`${runtimePrimary} w-full`} onClick={onClose}>{t('glossary.done')}</button>
  }} />;
}

/** The panel owns its own glossary read, so the settings page only renders it. */
export function GlossaryPanelHost({onClose}:{onClose:()=>void}){
  const {glossary,busy,notice,add,remove}=useReadingGlossary();
  const {activeRoute}=useLanguageRoutes();
  return <GlossaryPanel glossary={glossary} busy={busy} notice={notice} initialInputLanguageTag={activeRoute.targetLanguageTag} initialOutputLanguageTag={activeRoute.defaultSupportLanguageTag} onAdd={(input,output,term,rendering)=>void add(input,output,term,rendering)} onRemove={(input,output,term)=>void remove(input,output,term)} onClose={onClose}/>;
}
