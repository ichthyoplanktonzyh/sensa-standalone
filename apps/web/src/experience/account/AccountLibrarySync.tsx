import {useEffect} from 'react';
import {readCloudSync,readCloudReconnectRequired} from '../../data/library/cloudSync';
import {automaticCloudSyncRetryAt,blocksAutomaticCloudSync} from '../../data/library/cloudSyncPolicy';
import {cloudCheckpointRequestEvent,observeLibrary} from '../../data/library/store';
import {accountLibrarySyncFinishedEvent,syncAccountLibrary} from '../../data/library/cloudSyncService';

export const cloudCheckpointSchedule={idleMs:120000,maxDirtyMs:300000,pullStaleMs:300000} as const;

export type LibraryAvailability='restoring'|'authoritative'|'failed';

export function AccountLibrarySync({online,onAvailabilityChange}:{online:boolean;onAvailabilityChange?:(value:LibraryAvailability)=>void}){
 useEffect(()=>{if(!online)return;let active=true,running=false,timer:ReturnType<typeof setTimeout>|undefined,dirtySince:number|null=null,lastDirtyAt:number|null=null,lastCheckedAt=0;
  const clearTimer=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;}};
  const pauseForLocalReset=async()=>{const paused=await readCloudReconnectRequired();if(!active)return true;if(!paused)return false;clearTimer();dirtySince=null;lastDirtyAt=null;onAvailabilityChange?.('authoritative');return true;};
  const arm=()=>{clearTimer();if(!active||running||dirtySince===null||lastDirtyAt===null)return;const now=Date.now(),due=Math.min(lastDirtyAt+cloudCheckpointSchedule.idleMs,dirtySince+cloudCheckpointSchedule.maxDirtyMs);timer=setTimeout(()=>void runAutomatically(),Math.max(0,due-now));};
  const refresh=async()=>{if(await pauseForLocalReset())return;const state=await readCloudSync();if(!active)return;lastCheckedAt=Math.max(lastCheckedAt,Date.parse(state?.lastCheckedAt??state?.lastSyncedAt??'')||0);if(state?.status==='pending'){dirtySince??=Date.now();lastDirtyAt??=dirtySince;if(document.visibilityState==='hidden')void runAutomatically();else arm();return;}const retryAt=automaticCloudSyncRetryAt(state);if(retryAt!==null&&navigator.onLine){clearTimer();timer=setTimeout(()=>void runAutomatically(),Math.max(0,retryAt-Date.now()));return;}if(state?.status==='synced'||state?.status==='conflict'||state?.status==='failed'){dirtySince=null;lastDirtyAt=null;}clearTimer();};
  const run=async()=>{if(!active||running)return;clearTimer();running=true;try{await syncAccountLibrary();if(active)onAvailabilityChange?.('authoritative');}catch{if(active)onAvailabilityChange?.('failed');}finally{running=false;if(active)void refresh().catch(()=>{});}};
  const runAutomatically=async()=>{if(await pauseForLocalReset())return;const state=await readCloudSync();if(!active)return;if(blocksAutomaticCloudSync(state)){onAvailabilityChange?.('failed');clearTimer();return;}const retryAt=automaticCloudSyncRetryAt(state);if(retryAt!==null&&retryAt>Date.now()){await refresh();return;}await run();};
  const changed=()=>{void (async()=>{if(await pauseForLocalReset())return;const state=await readCloudSync();if(!active)return;if(blocksAutomaticCloudSync(state)){clearTimer();return;}const now=Date.now();dirtySince??=now;lastDirtyAt=now;arm();})().catch(()=>{});};
  const checkpoint=()=>{void readCloudSync().then(state=>{if(dirtySince!==null||state?.status==='pending')void runAutomatically();}).catch(()=>{});};
  const connectionRestored=()=>{if(navigator.onLine)void runAutomatically();};
  const visibilityChanged=()=>{if(document.visibilityState==='hidden'){checkpoint();return;}if(Date.now()-lastCheckedAt>=cloudCheckpointSchedule.pullStaleMs)void runAutomatically();};
  const syncFinished=()=>{void refresh().catch(()=>{});void (async()=>{if(await pauseForLocalReset())return;const state=await readCloudSync();if(!active)return;
   if(state?.status==='synced')onAvailabilityChange?.('authoritative');
   else if(state?.status==='failed'||state?.status==='conflict')onAvailabilityChange?.('failed');
  })().catch(()=>{});};
  // Account connection performs one background pull. Thereafter local writes only arm
  // an idle/deadline Checkpoint; a quiet, current tab performs no account requests.
  void runAutomatically();const stop=observeLibrary(changed);window.addEventListener('online',connectionRestored);window.addEventListener(cloudCheckpointRequestEvent,checkpoint);window.addEventListener(accountLibrarySyncFinishedEvent,syncFinished);document.addEventListener('visibilitychange',visibilityChanged);
  return()=>{active=false;clearTimer();stop();window.removeEventListener('online',connectionRestored);window.removeEventListener(cloudCheckpointRequestEvent,checkpoint);window.removeEventListener(accountLibrarySyncFinishedEvent,syncFinished);document.removeEventListener('visibilitychange',visibilityChanged);};
 },[online,onAvailabilityChange]);return null;
}
