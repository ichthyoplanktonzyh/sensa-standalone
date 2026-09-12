import {useEffect} from 'react';
import {observeLibrary} from '../../data/library/store';
import {syncAccountLibrary} from '../../data/library/cloudSyncService';
export function AccountLibrarySync({online}:{online:boolean}){
 useEffect(()=>{if(!online)return;let active=true,running=false,pending=false,timer:ReturnType<typeof setTimeout>|undefined;
  const run=async()=>{if(running||!active)return;running=true;try{await syncAccountLibrary();}catch{/* Persistent status is shown in account settings. */}finally{running=false;if(pending&&active){pending=false;schedule();}}};
  // A change that arrives during a pass must still be published; dropping it would leave
  // local work unsynced until the next focus.
  const schedule=()=>{if(!active)return;if(running){pending=true;return;}clearTimeout(timer);timer=setTimeout(()=>void run(),1200);};
  void run();const stop=observeLibrary(schedule);window.addEventListener('online',schedule);window.addEventListener('focus',schedule);
  // Local-first steady state: sync after a local change and when the browser comes
  // back online or regains focus, plus once when the account connects. An idle tab
  // makes no requests, so an untouched library is not re-read from the cloud.
  return()=>{active=false;clearTimeout(timer);stop();window.removeEventListener('online',schedule);window.removeEventListener('focus',schedule);};
 },[online]);return null;
}
