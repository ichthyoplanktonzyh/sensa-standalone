import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Play, Pause, SkipBack, SkipForward, RotateCcw, ExternalLink,ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {PracticeExpression} from '../practiceMaterials';
import { useYouglishWidget } from '../useYouglishWidget';
import { clipAccentsFor, clipLanguageFor } from '../services/speechLanguage';
import { practiceButton, practiceSurface } from './SensaFreePracticeScreen';
import { useScreenState } from '../ui/ScreenHost';
export interface YouGlishListeningScreenProps {
 active:boolean;expression:PracticeExpression|null;onBack:()=>void;onChooseExpression:()=>void;onPlaybackConfirmed?:(expressionId:string)=>void;
}
export const YouGlishListeningScreen=(props:YouGlishListeningScreenProps)=>{
 const [attempt,setAttempt]=useState(0);
 return <section id="s-real-world-listening" className={practiceSurface(props.active)}>
  {props.active&&<ListeningPlayer key={attempt} {...props} retry={()=>setAttempt(value=>value+1)}/>}
 </section>;
};
function ListeningPlayer({expression:current,onBack,onChooseExpression,onPlaybackConfirmed,retry}:YouGlishListeningScreenProps&{retry:()=>void}) {
 const {t}=useTranslation();
 const languageTag=current?.languageTag;
 const accents=languageTag?clipAccentsFor(languageTag):['all'];
 const [accent,setAccent]=useScreenState('real-world-listening:accent','all');
 const [rate,setRate]=useScreenState('real-world-listening:rate',1);
 const preferredRate=useRef(rate);preferredRate.current=rate;
 // A filter the target language does not offer is never sent to the provider.
 const activeAccent=accents.includes(accent)?accent:'all';
 const mountRef=useRef<HTMLDivElement>(null);
 const controlsRef=useRef<HTMLDivElement>(null);
 const confirmPlayback=useCallback(()=>{if(current)onPlaybackConfirmed?.(current.id);},[current?.id,onPlaybackConfirmed]);
 const widget=useYouglishWidget({mountRef,components:0,query:current?.text,lang:languageTag?clipLanguageFor(languageTag):'',accent:activeAccent==='all'?undefined:activeAccent,active:!!current,onPlaybackConfirmed:confirmPlayback});
 const ready=widget.status==='ready';
 const canControl=widget.controlsReady;
 useEffect(()=>{if(canControl)widget.setSpeed(preferredRate.current);},[canControl,widget.setSpeed]);
 return <main className="mx-auto w-full max-w-[1040px] px-4 py-5 sm:px-8 sm:py-8 lg:px-10">
  <header className="mb-7 flex items-center gap-3">
   <button onClick={onBack} className="grid size-11 shrink-0 place-items-center rounded-pill text-fg-secondary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus" aria-label={t('practice.back')}><ArrowLeft size={19}/></button>
   <h1 className="text-sm font-medium text-fg-secondary">{t('practice.names.listening')}</h1>
  </header>
  {current&&<a href="#real-world-listening-controls" onClick={event=>{event.preventDefault();controlsRef.current?.focus();controlsRef.current?.scrollIntoView({block:'nearest'});}} className="sr-only focus:not-sr-only focus:mb-4 focus:inline-block focus:rounded-control focus:p-3 focus:text-action-primary focus:outline-2 focus:outline-focus">{t('practice.skipToControls')}</a>}
  {!current?<p className="py-24 text-center text-fg-tertiary">{t('practice.empty')}</p>:<>
   <div className="mb-6 flex flex-wrap items-end justify-between gap-4 px-1">
    <div className="flex min-w-0 flex-col gap-1.5 text-xs text-fg-tertiary"><span>{t('practice.expression')}</span>
     <button lang={languageTag} dir="auto" onClick={onChooseExpression} aria-label={t('practice.expression')+' · '+current.text} className="flex min-h-12 max-w-full items-center gap-3 break-words rounded-control bg-transparent py-1 text-left text-3xl font-medium tracking-tight text-fg-primary outline-offset-4 focus-visible:outline-2 focus-visible:outline-focus sm:text-4xl"><span className="min-w-0 break-words">{current.text}</span><ChevronDown size={20} aria-hidden="true" className="shrink-0 text-fg-secondary"/></button>
    </div>
    <span className="pb-2 text-xs tabular-nums text-fg-tertiary">{ready?t('practice.results',{count:widget.totalResults}):'YouGlish'}</span>
   </div>
   <div className="overflow-hidden rounded-overlay border border-border-subtle bg-surface-panel shadow-raised">
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
     {accents.length>1&&<><span className="text-xs text-fg-tertiary">{t('practice.accent')}</span>
     <div className="flex flex-wrap gap-1" role="group" aria-label={t('practice.accent')}>{accents.map(code=><button key={code} aria-pressed={activeAccent===code} onClick={()=>setAccent(code)} className={`min-h-10 rounded-control px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-focus ${activeAccent===code?'bg-surface-selected font-medium text-action-primary':'text-fg-tertiary hover:bg-surface-subtle'}`}>{t('practice.accents.'+code)}</button>)}</div></>}
    </div>
    <div className="relative overflow-hidden bg-surface-media">
     {/* The official provider widget mounts here only while this screen is active. */}
     <div ref={mountRef} className="min-h-56 w-full [&_iframe]:max-w-full"/>
     {!ready&&<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface-media p-6 text-center text-sm text-fg-on-media" role={widget.status==='error'?'alert':'status'} aria-busy={widget.status==='loading'}><p>{t(widget.status==='error'?'practice.error':widget.status==='empty'?'practice.noClips':'practice.loading')}</p>{widget.status==='error'&&<button className={`${practiceButton} border border-fg-on-media/25 text-fg-on-media hover:bg-fg-on-media/10`} onClick={retry}>{t('practice.retry')}</button>}</div>}
    </div>
    <div className="px-5 py-6 sm:px-9 sm:py-8">
     <span className="text-[11px] font-medium tracking-wide text-fg-tertiary">{t('practice.captions')}</span>
     <p lang={languageTag} dir="auto" className="mt-3 min-h-16 break-words text-lg leading-relaxed text-fg-primary sm:text-[22px]" aria-live="polite">{ready&&widget.caption?widget.caption.split(/\[\[\[|\]\]\]/).map((part,index)=>index%2?<mark className="rounded-control bg-accent-soft px-1 py-0.5 font-medium text-action-primary" key={index}>{part}</mark>:<span key={index}>{part}</span>):<span className="text-sm text-fg-tertiary">{t('practice.captionEmpty')}</span>}</p>
    </div>
    <div ref={controlsRef} id="real-world-listening-controls" tabIndex={-1} role="group" aria-label={t('practice.play')} className="grid grid-cols-1 items-center gap-3 border-t border-border-subtle bg-surface-subtle px-4 py-4 focus-visible:outline-2 focus-visible:outline-focus sm:grid-cols-[1fr_auto_1fr] sm:px-6">
     <div className="hidden justify-self-start sm:block"><button disabled={!canControl} onClick={widget.replay} aria-label={t('practice.replay')} className={`${practiceButton} text-fg-secondary`}><RotateCcw size={17}/></button></div>
     <div className="flex items-center justify-center gap-1 sm:gap-2">
      <button disabled={!canControl} onClick={widget.previous} aria-label={t('practice.previous')} className={`${practiceButton} px-3 text-fg-secondary`}><SkipBack size={18}/></button>
      <button disabled={!canControl} onClick={()=>widget.move(-5)} aria-label={t('practice.rewind')} className={`${practiceButton} px-3 text-xs tabular-nums text-fg-secondary`}>−5s</button>
      <button disabled={!canControl} onClick={widget.toggle} aria-label={t(widget.isPlaying?'practice.pause':'practice.play')} className={`${practiceButton} mx-2 size-14 rounded-pill bg-action-primary text-action-on-primary shadow-raised hover:bg-action-primary-hover`}>{widget.isPlaying?<Pause size={21}/>:<Play size={21}/>}</button>
      <button disabled={!canControl} onClick={()=>widget.move(5)} aria-label={t('practice.forward')} className={`${practiceButton} px-3 text-xs tabular-nums text-fg-secondary`}>+5s</button>
      <button disabled={!canControl} onClick={widget.next} aria-label={t('practice.next')} className={`${practiceButton} px-3 text-fg-secondary`}><SkipForward size={18}/></button>
     </div>
     <div className="flex items-center justify-center gap-4 sm:justify-end">
      <button disabled={!canControl} onClick={widget.replay} aria-label={t('practice.replay')} className={`${practiceButton} text-fg-secondary sm:hidden`}><RotateCcw size={16}/></button>
      <select aria-label={t('practice.speed')} disabled={!canControl} value={widget.speed} onChange={event=>{const requested=Number(event.target.value);setRate(requested);widget.setSpeed(requested);}} className="min-h-11 rounded-control bg-transparent px-2 text-xs tabular-nums text-fg-secondary focus-visible:outline-2 focus-visible:outline-focus">{[0.5,0.75,1,1.25].includes(widget.speed)?null:<option value={widget.speed}>{widget.speed}×</option>}{[0.5,0.75,1,1.25].map(value=><option value={value} key={value}>{value}×</option>)}</select>
     </div>
    </div>
   </div>
   <footer className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-[11px] leading-6 text-fg-tertiary">
    <p>{t('practice.boundary')}</p>
    <button className={practiceButton} onClick={onBack}>{t('practice.finishListening')}</button>
    <a href="https://youglish.com" target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-1.5 hover:text-action-primary focus-visible:outline-2 focus-visible:outline-focus">{t('practice.provider')}<ExternalLink size={12}/></a>
   </footer>
  </>}
 </main>;
}
