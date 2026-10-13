import {auth} from '../account/auth';
import {captureAccountSessionBoundary,assertAccountSessionBoundary,readAccountSignoutEpoch} from '../account/accountSessionBoundary';
import {readLibrary,writeLibraryState,readLocalLibraryRevision,readLocalArtifactRevision,assertCurrentLibrary} from './store';
import {synchronizeLibrary,type LibrarySyncOptions,type CloudSyncState} from './cloudSync';
import {freshCheckpoint} from './cloudSyncCheckpoint';
import {cloudCheckpointSchedule,blocksAutomaticCloudSync,automaticCloudSyncRetryAt} from './cloudSyncPolicy';
let running:Promise<void>|undefined;
let runningAutomatic=false;
let recoveredArtifacts:{subject:string;accountId:string;incarnation:string;generation:number}|undefined;
export const accountLibrarySyncFinishedEvent='sensa-account-library-sync-finished';
export type AccountLibrarySyncOptions=LibrarySyncOptions&{automatic?:boolean;recovery?:boolean};
export function syncAccountLibrary(options:AccountLibrarySyncOptions={}):Promise<void>{
 // An explicit connection must not be swallowed by a concurrent ordinary empty pull.
 const explicit=options.publishEmptyIdentity||options.restoreAfterLocalClear;
 // A manual check cannot be absorbed by an automatic pass that may skip a
 // recently confirmed head. Automatic callers can join actual manual work.
 if(running&&!explicit&&(options.automatic||!runningAutomatic))return running;
 const previous=running;
 // Capture before either queue, and verify inside the cross-tab lock. An old
 // click cannot authorize a world cleared while it was waiting for that lock.
 const scope=readLibrary(async tx=>({owner:await tx.get<{subject:string;accountId:string}>('meta','service-owner'),incarnation:await assertCurrentLibrary(tx),state:await tx.get<CloudSyncState>('meta','cloud-sync')}));
 let expected:Awaited<typeof scope>;
 const work=async()=>{
  const intent=expected;
  const before=await readLibrary(async tx=>({owner:await tx.get<{subject:string;accountId:string}>('meta','service-owner'),incarnation:await assertCurrentLibrary(tx),localRevision:await readLocalLibraryRevision(tx),artifactRevision:await readLocalArtifactRevision(tx),state:await tx.get<CloudSyncState>('meta','cloud-sync'),signedOut:!!await tx.get('meta','signed-out'),reconnect:await tx.get('meta','local-reset')==='local-clear'}));
  const owner=before.owner;
  if(!owner)throw new Error('authentication_required');
  if(owner.subject!==intent.owner?.subject||owner.accountId!==intent.owner.accountId||before.incarnation!==intent.incarnation)throw Error('account_changed');
  if(before.reconnect&&!options.restoreAfterLocalClear)return;
  const boundary=await captureAccountSessionBoundary(owner.subject);
  if(options.automatic&&!explicit){
   if(blocksAutomaticCloudSync(before.state))return;
   const retryAt=automaticCloudSyncRetryAt(before.state);
   if(retryAt!==null&&retryAt>Date.now()){
    // Claim one early recovery attempt per unsuccessful checkpoint chain.
    // Older queued wake-ups cannot bypass a newer failure's backoff.
    if(!options.recovery||before.state?.retryAt!==intent.state?.retryAt)return;
    const session=(await auth?.getSession())?.data.session;
    if(before.signedOut||!session||session.user.id!==owner.subject)throw Error('authentication_required');
    await assertAccountSessionBoundary(boundary);
    if(!import.meta.env.VITE_SENSA_API_URL)throw Error('library_sync_unavailable');
    const claimed=await writeLibraryState(async tx=>{
     const current=await tx.get<CloudSyncState>('meta','cloud-sync'),claim=await tx.get<{incarnation:string;checkedAt:string|null}>('meta','cloud-sync-recovery');
     const currentOwner=await tx.get<{subject:string;accountId:string}>('meta','service-owner');
     if(await assertCurrentLibrary(tx)!==before.incarnation||currentOwner?.subject!==owner.subject||currentOwner.accountId!==owner.accountId||await tx.get('meta','signed-out')||await readAccountSignoutEpoch(tx)!==boundary.epoch||current?.retryAt!==before.state?.retryAt||blocksAutomaticCloudSync(current))return false;
     const checkedAt=current?.lastCheckedAt??null;
     if(claim?.incarnation===before.incarnation&&claim.checkedAt===checkedAt)return false;
     tx.put('meta','cloud-sync-recovery',{incarnation:before.incarnation,checkedAt});return true;
    });
    if(!claimed)return;
   }
  }
  let fresh=options.automatic&&!explicit&&!before.signedOut&&freshCheckpoint(before.state,{...before,owner},cloudCheckpointSchedule.pullStaleMs);
  if(fresh){
   const session=(await auth?.getSession())?.data.session;
   if(!session||session.user.id!==owner.subject)fresh=false;
   else await assertAccountSessionBoundary(boundary);
  }
  const result=!fresh?await synchronizeLibrary(async(path,body,signal)=>{
   const current=await readLibrary(async tx=>({owner:await tx.get<{subject:string;accountId:string}>('meta','service-owner'),signedOut:await tx.get('meta','signed-out')}));
   const session=(await auth?.getSession())?.data.session;
   if(!session||session.user.id!==owner.subject||current.signedOut||current.owner?.accountId!==owner.accountId||current.owner.subject!==owner.subject)throw new Error('authentication_required');
   await assertAccountSessionBoundary(boundary);
   const endpoint=import.meta.env.VITE_SENSA_API_URL;
   if(!endpoint)throw new Error('library_sync_unavailable');
   let response:Response;try{response=await fetch(endpoint.replace(/\/+$/,'')+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal,redirect:'error',cache:'no-store'});}catch{throw new Error('library_sync_network');}
   await assertAccountSessionBoundary(boundary);
   if(response.status===429)throw new Error('library_sync_rate_limited');if(response.status>=500)throw new Error('library_sync_server_error');
   let value:any;try{value=await response.json();}catch{throw new Error('library_sync_format');}
   if(!response.ok)throw new Error(value.code??'library_sync_unavailable');return value;
  },{...options,backgroundVerification:options.automatic===true}):undefined;
  // Checkpoint convergence is independent from public artifact delivery. Try
  // the device catalog after sync, but leave unavailable artifacts honestly
  // blocked instead of turning a healthy learner-data sync into a failure.
  const after=await readLibrary(async tx=>({owner:await tx.get<{subject:string;accountId:string}>('meta','service-owner'),incarnation:await assertCurrentLibrary(tx),localRevision:await readLocalLibraryRevision(tx),artifactRevision:await readLocalArtifactRevision(tx),reconnect:await tx.get('meta','local-reset')==='local-clear'}));
  if(after.owner?.subject!==owner.subject||after.owner.accountId!==owner.accountId||after.incarnation!==before.incarnation&&!(result?.activated.fromIncarnation===before.incarnation&&result.activated.incarnation===after.incarnation))throw Error('account_changed');
  await assertAccountSessionBoundary(boundary);
  if(after.reconnect)return;
  const warm=options.automatic&&after.localRevision===before.localRevision&&recoveredArtifacts?.subject===owner.subject&&recoveredArtifacts.accountId===owner.accountId&&recoveredArtifacts.incarnation===after.incarnation&&recoveredArtifacts.generation===after.artifactRevision;
  if(warm)return;
  const {contentSupplySystem}=await import('../../contentSupply/system/contentSupplySystem');
  // Restoring a large Library may finish after the transfer deadline. Public
  // artifacts are a separate phase, not a request on that expired signal.
  const recovery=await contentSupplySystem.execute({kind:'rehydrate',signal:AbortSignal.timeout(90000)}).catch(()=>undefined);
  const recoveredGeneration=await readLibrary(async tx=>({incarnation:await assertCurrentLibrary(tx),generation:await readLocalArtifactRevision(tx)}));
  if(recovery&&!recovery.blocked.length&&!recovery.failed.length&&recoveredGeneration.incarnation===after.incarnation&&recoveredGeneration.generation===after.artifactRevision)recoveredArtifacts={subject:owner.subject,accountId:owner.accountId,incarnation:after.incarnation,generation:after.artifactRevision};
  else recoveredArtifacts=undefined;
 };
 const start=async()=>{
  expected=await scope;
  if(previous)await previous.catch(()=>undefined);
  await (navigator.locks?navigator.locks.request('sensa-account-library-sync',work):work());
 };
 const task=start().finally(()=>{if(running===task){running=undefined;runningAutomatic=false;}window.dispatchEvent(new Event(accountLibrarySyncFinishedEvent));});running=task;runningAutomatic=options.automatic===true;return task;
}
