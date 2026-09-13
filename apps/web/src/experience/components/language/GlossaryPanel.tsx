import {useEffect,useState} from 'react';
import {X,Plus,Trash2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {sensaReadingGlossaryLimits,type SensaReadingGlossary} from '@sensa/contracts/sensa';
import {useReadingGlossary} from '../../library/useReadingGlossary';
import {runtimePrimary} from '../learning/RuntimeFrame';

interface Props {
  glossary:SensaReadingGlossary;
  busy:boolean;
  notice:string;
  onAdd:(term:string,rendering:string)=>void;
  onRemove:(term:string)=>void;
  onClose:()=>void;
}

/** Words the learner wants to read their own way are a standing choice, like the
 * language pair: one panel, reachable from the settings page, rather than an
 * editor attached to every translation. */
export function GlossaryPanel({glossary,busy,notice,onAdd,onRemove,onClose}:Props){
  const {t}=useTranslation();
  const [term,setTerm]=useState(''),[rendering,setRendering]=useState('');
  const full=glossary.length>=sensaReadingGlossaryLimits.entries;
  const addable=!busy&&!full&&term.trim().length>0&&rendering.trim().length>0;
  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
    };
    document.addEventListener('keydown',escape,true);
    return ()=>document.removeEventListener('keydown',escape,true);
  },[onClose]);
  return <div className="fixed inset-0 z-[150] flex items-end justify-end bg-[#202738]/30 sm:items-stretch" onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section role="dialog" aria-modal="true" aria-labelledby="glossary-title"
      className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-[#fbfbfa] shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none">
      <header className="flex shrink-0 items-center justify-between border-b border-[#e0e5ee] px-6 py-5">
        <h2 id="glossary-title" className="text-lg font-medium">{t('glossary.title')}</h2>
        <button autoFocus type="button" className="grid size-11 place-items-center rounded-lg text-[#68748d] hover:bg-[#edf0f7]" onClick={onClose} aria-label={t('glossary.close')}><X size={20}/></button>
      </header>
      <div className="space-y-7 overflow-y-auto px-6 py-7">
        <p className="text-xs leading-6 text-[#788398]">{t('glossary.intro')}</p>
        <section>
          {glossary.length===0
            ? <p className="rounded-xl border border-[#e0e5ee] bg-white px-4 py-6 text-sm text-[#788398]">{t('glossary.empty')}</p>
            : <ul className="rounded-xl border border-[#e0e5ee] bg-white px-4">
                {glossary.map(entry=><li key={entry.term} className="flex min-h-16 flex-wrap items-center gap-3 border-b border-[#e0e5ee] py-3 last:border-b-0">
                  <span className="min-w-0 flex-1 text-sm"><span className="block truncate font-medium text-[#303f76]">{entry.term}</span><span className="block truncate text-xs text-[#788398]">{entry.rendering}</span></span>
                  <button type="button" disabled={busy} onClick={()=>onRemove(entry.term)} aria-label={t('glossary.removeLabel',{term:entry.term})}
                    className="grid size-11 shrink-0 place-items-center rounded-lg text-[#68748d] hover:bg-[#edf0f7] focus-visible:outline-2 focus-visible:outline-[#5268a9] disabled:opacity-40"><Trash2 size={17}/></button>
                </li>)}
              </ul>}
        </section>
        <section className="border-t border-[#e0e5ee] pt-6">
          <h3 className="text-sm font-medium">{t('glossary.add')}</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[#788398]">{t('glossary.term')}
              <input value={term} disabled={busy||full} maxLength={sensaReadingGlossaryLimits.term} onChange={event=>setTerm(event.target.value)}
                className="mt-2 min-h-12 w-full rounded-xl border border-[#dce3ef] bg-white px-4 text-sm text-[#303f76]"/></label>
            <label className="text-xs text-[#788398]">{t('glossary.rendering')}
              <input value={rendering} disabled={busy||full} maxLength={sensaReadingGlossaryLimits.rendering} onChange={event=>setRendering(event.target.value)}
                className="mt-2 min-h-12 w-full rounded-xl border border-[#dce3ef] bg-white px-4 text-sm text-[#303f76]"/></label>
          </div>
          <button type="button" disabled={!addable} onClick={()=>{onAdd(term,rendering);setTerm('');setRendering('');}}
            className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-xl border border-[#dce3ef] bg-white px-4 text-sm text-[#303f76] hover:bg-[#edf0f7] focus-visible:outline-2 focus-visible:outline-[#5268a9] disabled:opacity-40"><Plus size={16}/>{t('glossary.addAction')}</button>
          <p className="mt-2 text-xs leading-6 text-[#788398]">{full?t('glossary.limit',{count:sensaReadingGlossaryLimits.entries}):t('glossary.hint')}</p>
        </section>
        {notice&&<p role="status" className="rounded-lg bg-[#edf1fa] p-4 text-sm text-[#303f76]">{notice}</p>}
      </div>
      <footer className="mt-auto shrink-0 border-t border-[#e0e5ee] px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button type="button" disabled={busy} className={`${runtimePrimary} w-full`} onClick={onClose}>{t('glossary.done')}</button>
      </footer>
    </section>
  </div>;
}

/** The panel owns its own glossary read, so the settings page only renders it. */
export function GlossaryPanelHost({onClose}:{onClose:()=>void}){
  const {glossary,busy,notice,add,remove}=useReadingGlossary();
  return <GlossaryPanel glossary={glossary} busy={busy} notice={notice} onAdd={(term,rendering)=>void add(term,rendering)} onRemove={term=>void remove(term)} onClose={onClose}/>;
}
