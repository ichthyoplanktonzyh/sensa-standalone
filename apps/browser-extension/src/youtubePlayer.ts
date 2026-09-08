/** Runs in the authorized page's main world. Returns source data only, never credentials. */
export async function readYoutubePlayer(expectedVideoId:string){
  const currentId=()=>location.pathname==='/watch'?new URL(location.href).searchParams.get('v'):location.pathname.split('/')[2];
  if(!['www.youtube.com','youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(location.hostname)||currentId()!==expectedVideoId)return {error:'video_changed'};
  type Player={getPlayerResponse?:()=>any;getOption?:(module:string,key:string)=>any;setOption?:(module:string,key:string,value:unknown)=>void;getAudioTrack?:()=>any;toggleSubtitles?:()=>void;getWebPlayerContextConfig?:()=>any};
  const player=document.querySelector('#movie_player') as (Element & Player)|null;
  const data=player?.getPlayerResponse?.()??(window as typeof window & {ytInitialPlayerResponse?:any}).ytInitialPlayerResponse;
  if(data?.videoDetails?.videoId!==expectedVideoId)return {error:'player_not_ready'};
  if(data.videoDetails?.isLiveContent)return {error:'live_unsupported'};
  const tracks=data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if(!Array.isArray(tracks))return {error:'no_captions'};
  const selected=player?.getOption?.('captions','track');
  const track=tracks.find(t=>/^en(?:-|$)/u.test(t.languageCode)&&t.vssId===(selected?.vssId??selected?.vss_id))
    ??tracks.find(t=>/^en(?:-|$)/u.test(t.languageCode)&&t.kind!=='asr')??tracks.find(t=>/^en(?:-|$)/u.test(t.languageCode));
  if(!track)return {error:'no_english_captions'};
  const captionButton=document.querySelector('.ytp-subtitles-button');
  if(captionButton?.getAttribute('aria-pressed')==='false')player?.toggleSubtitles?.();
  if(selected?.languageCode&&!/^en(?:-|$)/u.test(selected.languageCode))player?.setOption?.('captions','track',{languageCode:track.languageCode});
  try{
    const url=new URL(track.baseUrl,location.origin);
    const isCaptionUrl=(candidate:URL)=>candidate.protocol==='https:'&&['www.youtube.com','youtube.com'].includes(candidate.hostname)&&candidate.pathname==='/api/timedtext'&&candidate.searchParams.get('v')===expectedVideoId;
    if(!isCaptionUrl(url))return {error:'caption_source_invalid'};
    // Protocol parameters are supplied by the current player. Keep the selected
    // track's signed URL; audio-track URLs supply proof tokens, not another track.
    const audio=player?.getAudioTrack?.()?.captionTracks;
    const candidates:{url:URL;rank:number}[]=[];
    if(Array.isArray(audio))for(const entry of audio){
      try{const candidate=new URL(entry.url,location.origin);if(isCaptionUrl(candidate)&&candidate.searchParams.has('pot'))candidates.push({url:candidate,rank:entry.vssId===track.vssId?0:candidate.searchParams.get('lang')===track.languageCode?(entry.kind===track.kind?1:2):3});}catch{/* Ignore malformed player entries. */}
    }
    for(const entry of performance.getEntriesByType('resource').slice().reverse()){
      try{const candidate=new URL(entry.name);if(isCaptionUrl(candidate)&&candidate.searchParams.has('pot'))candidates.push({url:candidate,rank:4});}catch{/* Non-URL resource names are irrelevant. */}
    }
    const tokenSource=candidates.sort((a,b)=>a.rank-b.rank)[0]?.url;
    for(const key of ['pot','potc']){const value=tokenSource?.searchParams.get(key);if(value)url.searchParams.set(key,value);}
    const config=(window as typeof window & {ytcfg?:{get?:(key:string)=>unknown}}).ytcfg;
    const device=config?.get?.('DEVICE');
    if(typeof device==='string')for(const [key,value] of new URLSearchParams(device))if(['cbrand','cbr','cbrver','cos','cosver','cplatform'].includes(key))url.searchParams.set(key,value);
    const version=player?.getWebPlayerContextConfig?.()?.innertubeContextClientVersion;
    if(typeof version==='string')url.searchParams.set('cver',version);
    for(const [key,value] of Object.entries({fmt:'json3',xorb:'2',xobt:'3',xovt:'3',c:'WEB',cplayer:'UNIPLAYER'}))url.searchParams.set(key,value);
    const response=await fetch(url,{credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!response.ok||!response.body)return {error:'captions_unavailable',language:track.languageCode};
    const reader=response.body.getReader();let length=0;const chunks:Uint8Array[]=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2000000)return {error:'captions_too_large'};chunks.push(value);}}
    finally{await reader.cancel().catch(()=>undefined);}
    if(currentId()!==expectedVideoId)return {error:'video_changed'};
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    if(!length)return {error:'captions_unavailable',language:String(track.languageCode)};
    return {json:new TextDecoder().decode(bytes),language:String(track.languageCode)};
  }catch{return {error:'captions_unavailable',language:track.languageCode};}
}
