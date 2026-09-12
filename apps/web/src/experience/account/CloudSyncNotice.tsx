import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {observeCloudSync,readLibrary} from '../../data/library/store';

type Restore={populated:boolean;status:string};
/** A background account restore must never read as an empty library.
 * The App Shell is already usable, so this only reports restore state. */
export function CloudSyncNotice(){
 const {t}=useTranslation();
 const [restore,setRestore]=useState<Restore|null>(null);
 useEffect(()=>{
  let active=true;
  const read=()=>{void readLibrary(async tx=>({
   populated:!!(await tx.get<{revision:number}>('meta','cloud-sync'))?.revision||(await tx.all('drafts')).length>0||(await tx.all('packages')).length>0||(await tx.all('learningTargets')).length>0,
   status:(await tx.get<{status:string}>('meta','cloud-sync'))?.status??'idle',
  })).then(next=>{if(active)setRestore(next);}).catch(()=>{});};
  read();const stop=observeCloudSync(read);
  return()=>{active=false;stop();};
 },[]);
 if(!restore||restore.populated)return null;
 const restoring=restore.status==='pending'||restore.status==='syncing';
 if(!restoring&&restore.status!=='failed'&&restore.status!=='offline')return null;
 return <div role="status" className="pointer-events-none fixed inset-x-0 top-0 z-[9999] flex justify-center px-4 pt-3">
  <p className="rounded-full border border-[#bec5d5] bg-white/95 px-4 py-2 text-sm text-[#3b466c] shadow-sm">{t(restoring?'cloudSync.restoring':'cloudSync.restoreWaiting')}</p>
 </div>;
}
