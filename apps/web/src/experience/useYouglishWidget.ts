import {useCallback,useEffect,useMemo,useRef,useState} from 'react';

const channel='sensa.youglish.v1' as const;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type BridgeEvent=
 |{channel:typeof channel;type:'ready'}
 |{channel:typeof channel;type:'fetched';requestId:string;totalResults:number}
 |{channel:typeof channel;type:'caption';requestId:string;caption:string|null}
 |{channel:typeof channel;type:'playing';requestId:string;playing:boolean}
 |{channel:typeof channel;type:'error';requestId?:string;code:'provider_unavailable'|'invalid_command'};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fields=(value:Record<string,unknown>,count:number)=>Object.keys(value).length===count;
export function parseYouglishBridgeEvent(value:unknown):BridgeEvent|null{
 if(!record(value)||value.channel!==channel||typeof value.type!=='string')return null;
 if(value.type==='ready'&&fields(value,2))return value as BridgeEvent;
 if(value.type==='error'&&(value.code==='provider_unavailable'||value.code==='invalid_command')&&(value.requestId===undefined?fields(value,3):fields(value,4)&&typeof value.requestId==='string'&&uuid.test(value.requestId)))return value as BridgeEvent;
 const requestId=value.requestId;if(typeof requestId!=='string'||!uuid.test(requestId))return null;
 if(value.type==='fetched'&&fields(value,4)&&Number.isInteger(value.totalResults)&&Number(value.totalResults)>=0&&Number(value.totalResults)<=100000)return value as BridgeEvent;
 if(value.type==='caption'&&fields(value,4)&&(value.caption===null||typeof value.caption==='string'&&value.caption.length<=4000))return value as BridgeEvent;
 if(value.type==='playing'&&fields(value,4)&&typeof value.playing==='boolean')return value as BridgeEvent;
 return null;
}

export type YouglishStatus='idle'|'loading'|'ready'|'empty'|'error';
export interface YouglishWidgetHandle {
 status:YouglishStatus;totalResults:number;caption:string|null;isPlaying:boolean;
 toggle():void;move(seconds:number):void;replay():void;next():void;previous():void;setSpeed(rate:number):void;
}
interface UseYouglishWidgetOptions {
 mountRef:React.RefObject<HTMLDivElement|null>;query:string|undefined;lang:string;accent?:string;components?:number;active:boolean;
}

function integrationEndpoint(){
 const configured=import.meta.env.VITE_SENSA_YOUGLISH_ORIGIN as string|undefined;
 if(!configured)return null;
 try{
  const endpoint=new URL(configured,location.origin);
  if(endpoint.origin===location.origin)return null;
  endpoint.pathname='/youglish-player.html';
  endpoint.search='';endpoint.hash='';
  return endpoint;
 }catch{return null;}
}

/**
 * Controls a dedicated-origin player iframe. YouGlish code never executes in the
 * Sensa document; this hook accepts messages only from that exact iframe and
 * exact origin, then validates the complete protocol before updating UI state.
 */
export const useYouglishWidget=({mountRef,query,lang,accent,components=8,active}:UseYouglishWidgetOptions):YouglishWidgetHandle=>{
 const endpoint=useMemo(integrationEndpoint,[]);
 const iframeRef=useRef<HTMLIFrameElement|null>(null);
 const requestRef=useRef<string|null>(null);
 const playingRef=useRef(false);
 const [bridgeReady,setBridgeReady]=useState(false);
 const [status,setStatus]=useState<YouglishStatus>('idle');
 const [totalResults,setTotalResults]=useState(0);
 const [caption,setCaption]=useState<string|null>(null);
 const [isPlaying,setIsPlaying]=useState(false);

 const post=useCallback((message:Record<string,unknown>)=>{
  const frame=iframeRef.current;if(!frame||!endpoint)return;
  frame.contentWindow?.postMessage({channel,...message},endpoint.origin);
 },[endpoint]);

 useEffect(()=>{
  if(!active)return;
  const host=mountRef.current;
  if(!host||!endpoint){setStatus('error');return;}
  const frame=document.createElement('iframe');
  frame.src=endpoint.href;
  frame.title='YouGlish isolated player';
  frame.referrerPolicy='no-referrer';
  frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');
  frame.setAttribute('allow','autoplay; fullscreen');
  host.appendChild(frame);iframeRef.current=frame;setStatus('loading');
  const onMessage=(event:MessageEvent)=>{
   if(event.source!==frame.contentWindow||event.origin!==endpoint.origin)return;
   const message=parseYouglishBridgeEvent(event.data);if(!message)return;
   if(message.type==='ready'){setBridgeReady(true);return;}
   if(message.requestId&&message.requestId!==requestRef.current)return;
   if(message.type==='fetched'){setTotalResults(message.totalResults);setStatus(message.totalResults?'ready':'empty');}
   else if(message.type==='caption')setCaption(message.caption);
   else if(message.type==='playing'){playingRef.current=message.playing;setIsPlaying(message.playing);}
   else if(message.type==='error')setStatus('error');
  };
  window.addEventListener('message',onMessage);
  const timer=window.setTimeout(()=>setStatus(value=>value==='loading'?'error':value),10000);
  return ()=>{window.clearTimeout(timer);window.removeEventListener('message',onMessage);iframeRef.current=null;frame.remove();requestRef.current=null;setBridgeReady(false);};
 },[active,endpoint,mountRef]);

 useEffect(()=>{
  if(!active||!bridgeReady||!query)return;
  const id=crypto.randomUUID();requestRef.current=id;setStatus('loading');setCaption(null);setTotalResults(0);playingRef.current=false;setIsPlaying(false);
  post({type:'configure',requestId:id,query,lang,...(accent?{accent}:{}),components});
  const timer=window.setTimeout(()=>setStatus(value=>value==='loading'?'error':value),15000);
  return ()=>window.clearTimeout(timer);
 },[active,bridgeReady,query,lang,accent,components,post]);

 const command=useCallback((name:string,value?:number)=>{const id=requestRef.current;if(id)post({type:'command',requestId:id,command:name,...(value===undefined?{}:{value})});},[post]);
 const next=useCallback(()=>command('next'),[command]);
 const previous=useCallback(()=>command('previous'),[command]);
 const replay=useCallback(()=>command('replay'),[command]);
 const move=useCallback((seconds:number)=>command('move',seconds),[command]);
 const setSpeed=useCallback((rate:number)=>command('setSpeed',rate),[command]);
 const toggle=useCallback(()=>command(playingRef.current?'pause':'play'),[command]);
 return {status,totalResults,caption,isPlaying,toggle,move,replay,next,previous,setSpeed};
};
