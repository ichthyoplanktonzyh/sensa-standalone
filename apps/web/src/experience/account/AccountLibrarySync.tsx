import {useEffect} from 'react';
import {readCloudSync} from '../../data/library/cloudSync';
import {cloudCheckpointRequestEvent,observeLibrary} from '../../data/library/store';
import {accountLibrarySyncFinishedEvent,syncAccountLibrary} from '../../data/library/cloudSyncService';

export const cloudCheckpointSchedule={idleMs:120000,maxDirtyMs:300000,pullStaleMs:300000,retryMs:300000} as const;

export function AccountLibrarySync({online}:{online:boolean}){
 useEffect(()=>{if(!online)return;let active=true,running=false,timer:ReturnType<typeof setTimeout>|undefined,dirtySince:number|null=null,lastDirtyAt:number|null=null,lastCheckedAt=0,retryAt=0;
  const clearTimer=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;}};
  const arm=()=>{clearTimer();if(!active||running||dirtySince===null||lastDirtyAt===null)return;const now=Date.now(),due=Math.min(lastDirtyAt+cloudCheckpointSchedule.idleMs,dirtySince+cloudCheckpointSchedule.maxDirtyMs);timer=setTimeout(()=>void run(),Math.max(0,due-now));};
  const refresh=async()=>{const state=await readCloudSync();lastCheckedAt=Math.max(lastCheckedAt,Date.parse(state?.lastCheckedAt??state?.lastSyncedAt??'')||0);if(state?.status==='pending'){dirtySince??=Date.now();lastDirtyAt??=dirtySince;if(document.visibilityState==='hidden')void run();else arm();return;}if(state?.status==='failed'&&navigator.onLine){clearTimer();timer=setTimeout(()=>void run(),Math.max(0,retryAt-Date.now()));return;}if(state?.status==='synced'||state?.status==='conflict'){dirtySince=null;lastDirtyAt=null;retryAt=0;}clearTimer();};
  const run=async()=>{if(!active||running)return;clearTimer();running=true;try{await syncAccountLibrary();retryAt=0;}catch{retryAt=Date.now()+cloudCheckpointSchedule.retryMs;}finally{running=false;if(active)void refresh().catch(()=>{});}};
  const changed=()=>{const now=Date.now();dirtySince??=now;lastDirtyAt=now;arm();};
  const checkpoint=()=>{void readCloudSync().then(state=>{if(dirtySince!==null||state?.status==='pending')void run();}).catch(()=>{});};
  const connectionRestored=()=>{if(navigator.onLine)void run();};
  const visibilityChanged=()=>{if(document.visibilityState==='hidden'){checkpoint();return;}if(Date.now()-lastCheckedAt>=cloudCheckpointSchedule.pullStaleMs)void run();};
  const syncFinished=()=>{void refresh().catch(()=>{});};
  // Account connection performs one background pull. Thereafter local writes only arm
  // an idle/deadline Checkpoint; a quiet, current tab performs no account requests.
  void run();const stop=observeLibrary(changed);window.addEventListener('online',connectionRestored);window.addEventListener(cloudCheckpointRequestEvent,checkpoint);window.addEventListener(accountLibrarySyncFinishedEvent,syncFinished);document.addEventListener('visibilitychange',visibilityChanged);
  return()=>{active=false;clearTimer();stop();window.removeEventListener('online',connectionRestored);window.removeEventListener(cloudCheckpointRequestEvent,checkpoint);window.removeEventListener(accountLibrarySyncFinishedEvent,syncFinished);document.removeEventListener('visibilitychange',visibilityChanged);};
 },[online]);return null;
}
