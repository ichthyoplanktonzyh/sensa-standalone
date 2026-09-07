import { useEffect, useRef, useState } from 'react';
import { Volume2, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PrototypePronunciation } from '../../content/learningCatalog';
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#dce3ef] bg-white px-4 text-sm text-[#546582] hover:bg-[#f3f5f9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5268a9]';

/** No native controls layer: the owning learning screen controls media lifetime. */
export function PronunciationButtons({items,onError}:{
  items:readonly PrototypePronunciation[];onError:()=>void;
}) {
  const {t}=useTranslation();
  const audioRef=useRef<HTMLAudioElement|null>(null);
  const [playing,setPlaying]=useState<string|null>(null);
  const stop=()=>{
    const audio=audioRef.current;
    audioRef.current=null;
    if(audio){audio.onended=null;audio.onerror=null;audio.pause();audio.removeAttribute('src');}
  };
  useEffect(()=>()=>stop(),[]);
  const play=(item:PrototypePronunciation)=>{
    if(!item.audioUrl)return;
    const wasPlaying=playing===item.pronunciationKey;
    stop();setPlaying(null);
    if(wasPlaying)return;
    const audio=new Audio(item.audioUrl);
    audioRef.current=audio;
    setPlaying(item.pronunciationKey);
    const failed=()=>{
      if(audioRef.current!==audio)return;
      stop();setPlaying(null);onError();
    };
    audio.onerror=failed;
    audio.onended=()=>{if(audioRef.current===audio){stop();setPlaying(null);}};
    void audio.play().catch(failed);
  };
  return items.filter(item=>item.audioUrl).map(item=><button
    key={item.pronunciationKey} type="button" className={buttonClass}
    aria-pressed={playing===item.pronunciationKey}
    aria-label={t('assurance.audio')+' · '+item.accentLocale}
    onClick={()=>play(item)}
  >
    {playing===item.pronunciationKey?<Square size={14}/>:<Volume2 size={16}/>}
    {item.accentLocale==='en-GB'?t('assurance.uk'):item.accentLocale==='en-US'?t('assurance.us'):item.accentLocale}
  </button>);
}
