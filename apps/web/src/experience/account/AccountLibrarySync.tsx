import {useEffect} from 'react';
import {observeLibrary} from '../../data/library/store';
import {syncAccountLibrary} from '../../data/library/cloudSyncService';
export function AccountLibrarySync({online}:{online:boolean}){
 useEffect(()=>{if(!online)return;let active=true,running=false,timer:ReturnType<typeof setTimeout>|undefined;
  const run=async()=>{if(running||!active)return;running=true;try{await syncAccountLibrary();}catch{/* Persistent status is shown in account settings. */}finally{running=false;}};
  const schedule=()=>{if(running||!active)return;clearTimeout(timer);timer=setTimeout(()=>void run(),1200);};
  void run();const stop=observeLibrary(schedule);const interval=setInterval(()=>void run(),30000);window.addEventListener('online',schedule);window.addEventListener('focus',schedule);
  return()=>{active=false;clearTimeout(timer);clearInterval(interval);stop();window.removeEventListener('online',schedule);window.removeEventListener('focus',schedule);};
 },[online]);return null;
}
