import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Play, Pause, SkipBack, SkipForward, RotateCcw, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PracticeScopeTarget } from '../practiceScope';
import { useYouglishWidget } from '../useYouglishWidget';
import { useLanguageProfile } from '../library/useLanguageProfile';
import { clipAccentsFor, clipLanguageFor, speechLocaleFor } from '../services/speechLanguage';
import { practiceButton, practiceSurface } from './SensaFreePracticeScreen';
export interface YouGlishListeningScreenProps {
 active:boolean;targets:readonly PracticeScopeTarget[];onBack:()=>void;toast:(message:string)=>void;
}
export const YouGlishListeningScreen=(props:YouGlishListeningScreenProps)=>{
 const [attempt,setAttempt]=useState(0);
 return <section id="s-real-world-listening" className={practiceSurface(props.active)}>
  {props.active&&<ListeningPlayer key={attempt} {...props} retry={()=>setAttempt(value=>value+1)}/>}
 </section>;
};
function ListeningPlayer({targets,onBack,retry}:YouGlishListeningScreenProps&{retry:()=>void}) {
 const {t}=useTranslation();
 const {profile}=useLanguageProfile();
 const languageTag=profile.activeTargetLanguageTag;
 const accents=clipAccentsFor(languageTag);
 const listableLocale=speechLocaleFor(languageTag);
 const listenable=useMemo(()=>{const seen=new Set<string>();return targets.filter(target=>{const form=target.expression.surfaceForm.trim().toLocaleLowerCase(listableLocale);if(!form||seen.has(form))return false;seen.add(form);return true;});},[targets,listableLocale]);
 const [targetId,setTargetId]=useState(listenable[0]?.targetId??'');
 const current=listenable.find(target=>target.targetId===targetId)??listenable[0];
 const [accent,setAccent]=useState('all');
 const [rate,setRate]=useState(1);
 // A filter the target language does not offer is never sent to the provider.
 const activeAccent=accents.includes(accent)?accent:'all';
 const mountRef=useRef<HTMLDivElement>(null);
 const widget=useYouglishWidget({mountRef,components:0,query:current?.expression.surfaceForm,lang:clipLanguageFor(languageTag),accent:activeAccent==='all'?undefined:activeAccent,active:!!current});
 const ready=widget.status==='ready';
 useEffect(()=>{if(ready)widget.setSpeed(rate);},[ready,rate,widget.setSpeed]);
 return <main className="mx-auto w-full max-w-[1040px] px-4 py-5 sm:px-8 sm:py-8 lg:px-10">
  <header className="mb-7 flex items-center gap-3">
   <button onClick={onBack} className="grid size-11 shrink-0 place-items-center rounded-full text-[#68748d] hover:bg-[#edf0f7]" aria-label={t('practice.back')}><ArrowLeft size={19}/></button>
   <h1 className="text-sm font-medium text-[#68748d]">{t('practice.names.listening')}</h1>
  </header>
  {!current?<p className="py-24 text-center text-[#788398]">{t('practice.empty')}</p>:<>
   <div className="mb-6 flex flex-wrap items-end justify-between gap-4 px-1">
    <label className="flex min-w-0 flex-col gap-1.5 text-xs text-[#788398]">{t('practice.expression')}
     <select value={current.targetId} onChange={event=>setTargetId(event.target.value)} className="min-h-12 max-w-full cursor-pointer rounded-lg border-0 bg-transparent pr-8 text-3xl font-medium tracking-tight text-[#222631] outline-offset-4 sm:text-4xl">{listenable.map(target=><option key={target.targetId} value={target.targetId}>{target.expression.surfaceForm}</option>)}</select>
    </label>
    <span className="pb-2 text-xs tabular-nums text-[#788398]">{ready?t('practice.results',{count:widget.totalResults}):'YouGlish'}</span>
   </div>
   <div className="overflow-hidden rounded-[20px] border border-[#e1e5ec] bg-white shadow-[0_12px_40px_-24px_rgba(32,39,56,0.3)] sm:rounded-3xl">
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
     {accents.length>1&&<><span className="text-xs text-[#788398]">{t('practice.accent')}</span>
     <div className="flex flex-wrap gap-1" role="group" aria-label={t('practice.accent')}>{accents.map(code=><button key={code} aria-pressed={activeAccent===code} onClick={()=>setAccent(code)} className={`min-h-10 rounded-lg px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-[#5268a9] ${activeAccent===code?'bg-[#edf0f7] font-medium text-[#303f76]':'text-[#788398] hover:bg-[#f5f6f8]'}`}>{t('practice.accents.'+code)}</button>)}</div></>}
    </div>
    <div className="relative aspect-video overflow-hidden bg-[#202738]">
     {/* Caption events come from the API subscription. Keep provider-owned UI
         disabled so only Sensa's controlled caption surface is visible. */}
     <div ref={mountRef} className="absolute inset-0 overflow-hidden [&_iframe]:absolute [&_iframe]:left-0 [&_iframe]:top-0 [&_iframe]:w-full! [&_iframe]:border-0"/>
     {!ready&&<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#202738] p-6 text-center text-sm text-[#d6ddeb]" role="status"><p>{t(widget.status==='error'?'practice.error':widget.status==='empty'?'practice.noClips':'practice.loading')}</p>{widget.status==='error'&&<button className={`${practiceButton} border border-white/25 text-white hover:bg-white/10`} onClick={retry}>{t('practice.retry')}</button>}</div>}
    </div>
    <div className="px-5 py-6 sm:px-9 sm:py-8">
     <span className="text-[11px] font-medium tracking-wide text-[#8b94a5]">{t('practice.captions')}</span>
     <p className="mt-3 min-h-16 break-words text-lg leading-relaxed text-[#343c4d] sm:text-[22px]" aria-live="polite">{ready&&widget.caption?widget.caption.split(/\[\[\[|\]\]\]/).map((part,index)=>index%2?<mark className="rounded bg-[#e9edf8] px-1 py-0.5 font-medium text-[#3f5293]" key={index}>{part}</mark>:<span key={index}>{part}</span>):<span className="text-sm text-[#8b94a5]">{t('practice.captionEmpty')}</span>}</p>
    </div>
    <div className="grid grid-cols-1 items-center gap-3 border-t border-[#edf0f4] bg-[#fafbfc] px-4 py-4 sm:grid-cols-[1fr_auto_1fr] sm:px-6">
     <button disabled={!ready} onClick={widget.replay} aria-label={t('practice.replay')} className={`${practiceButton} hidden justify-self-start text-[#68748d] sm:inline-flex`}><RotateCcw size={17}/></button>
     <div className="flex items-center justify-center gap-1 sm:gap-2">
      <button disabled={!ready} onClick={widget.previous} aria-label={t('practice.previous')} className={`${practiceButton} px-3 text-[#68748d]`}><SkipBack size={18}/></button>
      <button disabled={!ready} onClick={()=>widget.move(-5)} aria-label={t('practice.rewind')} className={`${practiceButton} px-3 text-xs tabular-nums text-[#68748d]`}>−5s</button>
      <button disabled={!ready} onClick={widget.toggle} aria-label={t(widget.isPlaying?'practice.pause':'practice.play')} className={`${practiceButton} mx-2 size-14 rounded-full bg-[#2f3b70] text-white shadow-sm hover:bg-[#25305c]`}>{widget.isPlaying?<Pause size={21}/>:<Play size={21}/>}</button>
      <button disabled={!ready} onClick={()=>widget.move(5)} aria-label={t('practice.forward')} className={`${practiceButton} px-3 text-xs tabular-nums text-[#68748d]`}>+5s</button>
      <button disabled={!ready} onClick={widget.next} aria-label={t('practice.next')} className={`${practiceButton} px-3 text-[#68748d]`}><SkipForward size={18}/></button>
     </div>
     <div className="flex items-center justify-center gap-4 sm:justify-end">
      <button disabled={!ready} onClick={widget.replay} aria-label={t('practice.replay')} className={`${practiceButton} text-[#68748d] sm:hidden`}><RotateCcw size={16}/></button>
      <select aria-label={t('practice.speed')} disabled={!ready} value={rate} onChange={event=>setRate(Number(event.target.value))} className="min-h-11 rounded-lg bg-transparent px-2 text-xs tabular-nums text-[#68748d]">{[0.5,0.75,1,1.25].map(value=><option value={value} key={value}>{value}×</option>)}</select>
     </div>
    </div>
   </div>
   <footer className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-[11px] leading-6 text-[#8b94a5]">
    <p>{t('practice.boundary')}</p>
    <a href="https://youglish.com" target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-1.5 hover:text-[#5268a9]">{t('practice.provider')}<ExternalLink size={12}/></a>
   </footer>
  </>}
 </main>;
}
