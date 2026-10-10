import { useCallback, useEffect, useRef, useState } from 'react';
import {decodeYouglishCaption} from './youglishCaption';

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
  speed?: number;
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
  /** The provider can accept commands; this does not prove a media frame loaded. */
  controlsReady: boolean;
  /** Confirmed by onSpeedChange, not inferred from a requested setting. */
  speed: number;
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
  const [controlsReady,setControlsReady]=useState(false);
  const [speed,setSpeedState]=useState(1);
  const widgetRef=useRef<YouglishWidget|null>(null);
  const isPlayingRef=useRef(false);
  const mountedRef=useRef(true);
  const controlsReadyRef=useRef(false);
  const failureRef=useRef<(()=>void)|null>(null);
  const waitForMediaRef=useRef<(()=>void)|null>(null);

  useEffect(()=>{mountedRef.current=true;return()=>{mountedRef.current=false;};},[]);

  useEffect(()=>{
    setCaption(null);setTotalResults(0);setIsPlaying(false);setSpeedState(1);setControlsReady(false);
    isPlayingRef.current=false;controlsReadyRef.current=false;
    if(!active||!query){setStatus('idle');return;}
    const host=mountRef.current;if(!host)return;
    let disposed=false,playerReady=false,hasResults=false,mediaReady=false;
    let widget:YouglishWidget|null=null,timer:number|undefined;
    const retire=()=>{
      controlsReadyRef.current=false;setControlsReady(false);
      if(widgetRef.current===widget)widgetRef.current=null;
      try{widget?.pause();}catch{}
      try{widget?.close();}catch{}
      widget=null;host.replaceChildren();
    };
    const fail=()=>{
      if(disposed||!mountedRef.current)return;
      disposed=true;window.clearTimeout(timer);retire();
      isPlayingRef.current=false;setIsPlaying(false);setStatus('error');
    };
    const markReady=()=>{
      if(disposed||!mountedRef.current||!hasResults||!playerReady)return;
      controlsReadyRef.current=true;setControlsReady(true);
      if(!mediaReady)return;
      window.clearTimeout(timer);timer=undefined;setStatus('ready');
    };
    const waitForMedia=()=>{
      if(disposed||!mountedRef.current)return;
      mediaReady=false;setStatus('loading');
      // Repeated unstarted/buffering events cannot postpone the same deadline.
      timer??=window.setTimeout(fail,15000);
    };
    waitForMediaRef.current=waitForMedia;
    failureRef.current=fail;setStatus('loading');
    loadYouglishApi().then(YG=>{
      if(disposed||!mountedRef.current)return;
      const inner=document.createElement('div');
      inner.id=`yg-widget-${crypto.randomUUID()}`;
      host.appendChild(inner);
      timer=window.setTimeout(fail,15000);
      widget=new YG.Widget(inner.id,{
        width:Math.round(host.clientWidth)||360,
        components:components===0?'0':components,
        events:{
          onFetchDone:(event:WidgetEvent)=>{
            if(disposed||!mountedRef.current)return;
            const total=event.totalResult??0;setTotalResults(total);hasResults=total>0;
            if(hasResults)markReady();else{
              disposed=true;window.clearTimeout(timer);retire();
              isPlayingRef.current=false;setIsPlaying(false);setCaption(null);setStatus('empty');
            }
          },
          onPlayerReady:()=>{if(disposed)return;playerReady=true;markReady();},
          onVideoChange:()=>{if(disposed)return;setCaption(null);waitForMedia();},
          onCaptionChange:(event:WidgetEvent)=>{if(disposed||!mountedRef.current)return;setCaption(event.caption?decodeYouglishCaption(event.caption):null);},
          onPlayerStateChange:(event:WidgetEvent)=>{
            if(disposed||!mountedRef.current)return;
            const playing=event.state===PLAYER_STATE_PLAYING;isPlayingRef.current=playing;setIsPlaying(playing);
            if(event.state===-1||event.state===3)waitForMedia();
            else if(event.state===0||event.state===1||event.state===2||event.state===5){mediaReady=true;markReady();}
          },
          onSpeedChange:(event:WidgetEvent)=>{if(!disposed&&mountedRef.current&&typeof event.speed==='number'&&Number.isFinite(event.speed)&&event.speed>=0)setSpeedState(event.speed);},
          onError:fail,
        },
      });
      if(disposed||!mountedRef.current){retire();return;}
      widgetRef.current=widget;
      widget.fetch(query,lang,accent);
    }).catch(fail);
    return()=>{disposed=true;window.clearTimeout(timer);if(failureRef.current===fail)failureRef.current=null;if(waitForMediaRef.current===waitForMedia)waitForMediaRef.current=null;retire();};
  },[active,query,lang,accent,components,mountRef]);

  const perform=useCallback((action:(widget:YouglishWidget)=>void,awaitMedia=false)=>{
    if(!controlsReadyRef.current||!widgetRef.current)return;
    if(awaitMedia)waitForMediaRef.current?.();
    try{action(widgetRef.current);}catch{failureRef.current?.();}
  },[]);
  const next=useCallback(()=>perform(widget=>widget.next(),true),[perform]);
  const previous=useCallback(()=>perform(widget=>widget.previous(),true),[perform]);
  const replay=useCallback(()=>perform(widget=>widget.replay(),true),[perform]);
  const toggle=useCallback(()=>perform(widget=>isPlayingRef.current?widget.pause():widget.play(),!isPlayingRef.current),[perform]);
  const move=useCallback((seconds:number)=>perform(widget=>widget.move(seconds)),[perform]);
  const setSpeed=useCallback((rate:number)=>perform(widget=>widget.setSpeed(rate)),[perform]);
  return {status,totalResults,caption,isPlaying,controlsReady,speed,toggle,move,replay,next,previous,setSpeed};
};
