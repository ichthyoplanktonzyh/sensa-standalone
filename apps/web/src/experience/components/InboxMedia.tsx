import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {readLibrary,assertCurrentLibrary,observeLibrary} from '../../data/library/store';
import {parseStoredMedia,type StoredMedia} from '../../data/library/media';
import {uiText} from '../../i18n/uiText';
import {localFlowText} from '../../i18n/localFlowText';

/** Load only this expanded capture's media, never the whole personal-media cache. */
export function InboxMedia({ids}:{ids:readonly string[]}){
 const {t}=useTranslation();
 const [open,setOpen]=useState(false),[attempt,setAttempt]=useState(0),[media,setMedia]=useState<StoredMedia[]|null>(null),[failed,setFailed]=useState(false);
 const identity=JSON.stringify(ids);
 useEffect(()=>{
  if(!open)return;
  let active=true,generation=0;
  const load=()=>{
   const current=++generation;setMedia(null);setFailed(false);
   void readLibrary(async tx=>{await assertCurrentLibrary(tx);return Promise.all((JSON.parse(identity) as string[]).map(async id=>{const row=parseStoredMedia(await tx.get('media',id));if(row.mediaId!==id)throw new Error('media_identity_mismatch');return row;}));})
    .then(rows=>{if(active&&current===generation)setMedia(rows);}).catch(()=>{if(active&&current===generation)setFailed(true);});
  };
  const stop=observeLibrary(load,['media','meta'],{media:JSON.parse(identity) as string[],meta:['identity','local-incarnation']});load();
  return()=>{active=false;stop();};
 },[open,identity,attempt]);
 return <details className="mt-4" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary className="cursor-pointer py-2 text-sm">{ids.length} {uiText('images')}</summary>
  {open&&(failed?<div role="alert" className="space-y-2 py-3 text-sm"><p>{uiText('unableToReadThisMaterial')}</p><button type="button" className="min-h-11 rounded-control border border-border-strong px-4" onClick={()=>setAttempt(value=>value+1)}>{t('content.retry')}</button></div>:!media?<p role="status" className="py-3 text-sm">{localFlowText('loadingSensa')}</p>:<div className="space-y-3">{media.map((item,index)=><img key={item.mediaId} src={item.dataUrl} alt={`${uiText('images')} ${index+1}`} onError={()=>setFailed(true)} className="max-h-96 w-full rounded-control object-contain"/>)}</div>)}
 </details>;
}
