import {useEffect} from 'react';
import {readCloudSync,readCloudReconnectRequired} from '../../data/library/cloudSync';
import {automaticCloudSyncRetryAt,blocksAutomaticCloudSync,cloudCheckpointSchedule} from '../../data/library/cloudSyncPolicy';
import {cloudCheckpointRequestEvent,observeLibrary,observeCloudSyncState} from '../../data/library/store';
import {accountLibrarySyncFinishedEvent,syncAccountLibrary} from '../../data/library/cloudSyncService';
export {cloudCheckpointSchedule} from '../../data/library/cloudSyncPolicy';

export type LibraryAvailability='restoring'|'authoritative'|'failed';

/** One coordinator owns upload deadlines, remote freshness and recovery. State
 * notifications only prompt a durable reread; they never claim convergence. */
export function AccountLibrarySync({online,onAvailabilityChange}:{online:boolean;onAvailabilityChange?:(value:LibraryAvailability)=>void}){
 useEffect(()=>{
  if(!online)return;
  let active=true,running=false,timer:ReturnType<typeof setTimeout>|undefined,dirtySince:number|null=null,lastDirtyAt:number|null=null;
  const clearTimer=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;}};
  const arm=(due:number)=>{clearTimer();if(active&&!running&&navigator.onLine)timer=setTimeout(()=>void runAutomatically(),Math.max(0,due-Date.now()));};
  const pauseForLocalReset=async()=>{const paused=await readCloudReconnectRequired();if(!active)return true;if(!paused)return false;clearTimer();dirtySince=null;lastDirtyAt=null;onAvailabilityChange?.('authoritative');return true;};
  const refresh=async()=>{
   if(await pauseForLocalReset())return;
   const state=await readCloudSync();if(!active||running)return;
   if(blocksAutomaticCloudSync(state)){dirtySince=null;lastDirtyAt=null;clearTimer();onAvailabilityChange?.('failed');return;}
   if(!navigator.onLine){clearTimer();return;}
   const retryAt=automaticCloudSyncRetryAt(state);
   if(retryAt!==null){arm(retryAt);return;}
   if(state?.status==='pending'){
    dirtySince??=Date.now();lastDirtyAt??=dirtySince;
    if(document.visibilityState==='hidden'){void runAutomatically();return;}
    arm(Math.min(lastDirtyAt+cloudCheckpointSchedule.idleMs,dirtySince+cloudCheckpointSchedule.maxDirtyMs));return;
   }
   if(state?.status==='syncing'){
    // A peer's durable in-flight hint will be replaced by another notification.
    // If that page dies, the existing two-minute stale-run rule permits retry.
    arm((Date.parse(state.syncStartedAt??'')||Date.now())+120_000);return;
   }
   dirtySince=null;lastDirtyAt=null;
   if(state?.status==='synced')onAvailabilityChange?.('authoritative');
   clearTimer();
   if(document.visibilityState==='visible'){
    const now=Date.now(),checkedAt=Date.parse(state?.lastCheckedAt??'')||0;
    arm(checkedAt>now?now:checkedAt+cloudCheckpointSchedule.pullStaleMs);
   }
  };
  const runAutomatically=async(recover=false)=>{
   if(!active||running||!navigator.onLine||await pauseForLocalReset())return;
   const state=await readCloudSync();if(!active||running)return;
   if(blocksAutomaticCloudSync(state)){clearTimer();onAvailabilityChange?.('failed');return;}
   const retryAt=automaticCloudSyncRetryAt(state);
   if(!recover&&retryAt!==null&&retryAt>Date.now()){await refresh();return;}
   clearTimer();running=true;
   try{await syncAccountLibrary({automatic:true,recovery:recover});}
   catch{if(active)onAvailabilityChange?.('failed');}
   finally{running=false;if(active)void refresh().catch(()=>{});}
  };
  const changed=()=>{void(async()=>{
   if(await pauseForLocalReset())return;
   const state=await readCloudSync();if(!active)return;
   if(state?.status==='pending'){const now=Date.now();dirtySince??=now;lastDirtyAt=now;}
   await refresh();
  })().catch(()=>{});};
  const checkpoint=()=>{void readCloudSync().then(state=>{if(state?.status==='pending'||dirtySince!==null)void runAutomatically();}).catch(()=>{});};
  const connectionRestored=()=>{if(navigator.onLine)void runAutomatically(true);};
  const foreground=()=>{if(document.visibilityState==='visible')void runAutomatically(true);};
  const visibilityChanged=()=>{if(document.visibilityState==='hidden'){clearTimer();checkpoint();}else foreground();};
  const syncFinished=()=>{void refresh().catch(()=>{});};
  void runAutomatically();
  const stop=observeLibrary(changed),stopState=observeCloudSyncState(syncFinished);
  window.addEventListener('online',connectionRestored);window.addEventListener('focus',foreground);
  window.addEventListener(cloudCheckpointRequestEvent,checkpoint);window.addEventListener(accountLibrarySyncFinishedEvent,syncFinished);document.addEventListener('visibilitychange',visibilityChanged);
  return()=>{active=false;clearTimer();stop();stopState();window.removeEventListener('online',connectionRestored);window.removeEventListener('focus',foreground);window.removeEventListener(cloudCheckpointRequestEvent,checkpoint);window.removeEventListener(accountLibrarySyncFinishedEvent,syncFinished);document.removeEventListener('visibilitychange',visibilityChanged);};
 },[online,onAvailabilityChange]);return null;
}
