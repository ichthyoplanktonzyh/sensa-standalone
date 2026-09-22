import { useCallback, useEffect, useRef, useState } from 'react';

/** The provider-owned widget API loaded only while real-world listening is open. */
type YouglishWidget = {
  fetch(query: string, lang: string, accent?: string): void;
  play(): void;
  pause(): void;
  replay(): void;
  move(seconds: number): void;
  next(): void;
  previous(): void;
  setSpeed(rate: number): void;
  close(): void;
};

const PLAYER_STATE_PLAYING = 1;
const API_SRC = 'https://youglish.com/public/emb/widget.js';
const API_TIMEOUT_MS = 8000;

interface WidgetEvent {
  totalResult?: number;
  caption?: string;
  state?: number;
}

declare global {
  interface Window {
    YG?: { Widget: new (element: HTMLElement | string, options: unknown) => YouglishWidget };
    onYouglishAPIReady?: () => void;
  }
}

let apiPromise: Promise<NonNullable<Window['YG']>> | null = null;

function loadYouglishApi(): Promise<NonNullable<Window['YG']>> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YG?.Widget) { resolve(window.YG); return; }
    const timer = window.setTimeout(() => reject(new Error('YouGlish widget API timed out')), API_TIMEOUT_MS);
    const previous = window.onYouglishAPIReady;
    window.onYouglishAPIReady = () => {
      window.clearTimeout(timer);
      previous?.();
      if (window.YG?.Widget) resolve(window.YG);
      else reject(new Error('YouGlish API loaded without a Widget'));
    };
    if (!document.querySelector(`script[src="${API_SRC}"]`)) {
      const script = document.createElement('script');
      script.src = API_SRC;
      script.async = true;
      script.referrerPolicy = 'no-referrer';
      script.onerror = () => { window.clearTimeout(timer); reject(new Error('YouGlish widget API failed to load')); };
      document.head.appendChild(script);
    }
  });
  apiPromise = apiPromise.catch((error) => {
    apiPromise = null;
    document.querySelector(`script[src="${API_SRC}"]`)?.remove();
    throw error;
  });
  return apiPromise;
}

export type YouglishStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
export interface YouglishWidgetHandle {
  status: YouglishStatus;
  totalResults: number;
  caption: string | null;
  isPlaying: boolean;
  toggle(): void;
  move(seconds: number): void;
  replay(): void;
  next(): void;
  previous(): void;
  setSpeed(rate: number): void;
}
interface UseYouglishWidgetOptions {
  mountRef: React.RefObject<HTMLDivElement | null>;
  query: string | undefined;
  lang: string;
  accent?: string;
  components?: number;
  active: boolean;
}

/**
 * Mount the official widget directly into its visible product surface. The
 * provider script is fetched lazily and is never part of application startup.
 * YouGlish searches a surface string and does not establish Sense identity.
 */
export const useYouglishWidget = ({mountRef,query,lang,accent,components=8,active}:UseYouglishWidgetOptions):YouglishWidgetHandle => {
  const [status,setStatus]=useState<YouglishStatus>('idle');
  const [totalResults,setTotalResults]=useState(0);
  const [caption,setCaption]=useState<string|null>(null);
  const [isPlaying,setIsPlaying]=useState(false);
  const [ready,setReady]=useState(false);
  const widgetRef=useRef<YouglishWidget|null>(null);
  const isPlayingRef=useRef(false);
  const mountedRef=useRef(true);

  useEffect(()=>{mountedRef.current=true;return()=>{mountedRef.current=false;};},[]);

  useEffect(()=>{
    if(!active||widgetRef.current)return;
    const host=mountRef.current;if(!host)return;
    let disposed=false;setStatus('loading');
    loadYouglishApi().then(YG=>{
      if(disposed||!mountedRef.current||widgetRef.current)return;
      const inner=document.createElement('div');
      inner.id=`yg-widget-${crypto.randomUUID()}`;
      host.appendChild(inner);
      widgetRef.current=new YG.Widget(inner.id,{
        width:Math.round(host.clientWidth)||360,
        components:components===0?'0':components,
        events:{
          onFetchDone:(event:WidgetEvent)=>{if(!mountedRef.current)return;const total=event.totalResult??0;setTotalResults(total);setStatus(total>0?'ready':'empty');},
          onCaptionChange:(event:WidgetEvent)=>{if(!mountedRef.current)return;let text=event.caption??null;if(text)try{text=decodeURIComponent(text);}catch{}setCaption(text);},
          onPlayerStateChange:(event:WidgetEvent)=>{if(!mountedRef.current)return;const playing=event.state===PLAYER_STATE_PLAYING;isPlayingRef.current=playing;setIsPlaying(playing);},
          onError:()=>{if(mountedRef.current)setStatus('error');},
        },
      });
      if(mountedRef.current)setReady(true);
    }).catch(()=>{if(!disposed&&mountedRef.current)setStatus('error');});
    return()=>{disposed=true;};
  },[active,components,mountRef]);

  useEffect(()=>{
    if(!ready||!query||!widgetRef.current)return;
    setStatus('loading');setCaption(null);setTotalResults(0);
    try{widgetRef.current.fetch(query,lang,accent);}catch{setStatus('error');}
  },[ready,query,lang,accent]);

  useEffect(()=>{
    if(status!=='loading')return;
    const timer=window.setTimeout(()=>setStatus(current=>current==='loading'?'error':current),15000);
    return()=>window.clearTimeout(timer);
  },[status,query,accent]);

  useEffect(()=>{if(!active)try{widgetRef.current?.pause();}catch{}},[active]);
  useEffect(()=>()=>{try{widgetRef.current?.close();}catch{}widgetRef.current=null;},[]);

  const next=useCallback(()=>{try{widgetRef.current?.next();}catch{}},[]);
  const previous=useCallback(()=>{try{widgetRef.current?.previous();}catch{}},[]);
  const replay=useCallback(()=>{try{widgetRef.current?.replay();}catch{}},[]);
  const toggle=useCallback(()=>{try{if(isPlayingRef.current)widgetRef.current?.pause();else widgetRef.current?.play();}catch{}},[]);
  const move=useCallback((seconds:number)=>{try{widgetRef.current?.move(seconds);}catch{}},[]);
  const setSpeed=useCallback((rate:number)=>{try{widgetRef.current?.setSpeed(rate);}catch{}},[]);
  return {status,totalResults,caption,isPlaying,toggle,move,replay,next,previous,setSpeed};
};
