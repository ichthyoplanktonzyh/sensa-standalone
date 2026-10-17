import {auth} from '../account/auth';
import {isAuthRetryableFetchError} from '@supabase/supabase-js';
import {captureAccountSessionBoundary,assertAccountSessionBoundary,readAccountSignoutEpoch} from '../account/accountSessionBoundary';
import {readLibrary,writeLibraryState,readLocalLibraryRevision,readLocalArtifactRevision,assertCurrentLibrary} from './store';
import {synchronizeLibrary,type LibrarySyncOptions,type CloudSyncState} from './cloudSync';
import * as control from './cloudSyncActivity';
import {freshCheckpoint,validatedCheckpoint} from './cloudSyncCheckpoint';
import {cloudCheckpointSchedule,blocksAutomaticCloudSync,automaticCloudSyncRetryAt} from './cloudSyncPolicy';
import {prepareCloudCheckpoint} from './cloudCheckpointPreparation';
import {CloudSyncDeadline} from './cloudSyncDeadline';
import {librarySyncCheckpointProtocol,type LibrarySyncPreparation} from '@sensa/contracts/sensa';
let running:Promise<void>|undefined;
let runningAutomatic=false;
let checkpointJob:{controller:AbortController;task:Promise<unknown>}|undefined;
let recoveredArtifacts:{subject:string;accountId:string;incarnation:string;generation:number}|undefined;
export const accountLibrarySyncFinishedEvent='sensa-account-library-sync-finished';
import type {AccountLibrarySyncActivity} from './cloudSyncActivity';
export type AccountLibrarySyncOptions=LibrarySyncOptions&{automatic?:boolean;recovery?:boolean;prepareForAnotherDevice?:boolean};
const captureIntent=()=>readLibrary(async tx=>({owner:await tx.get<{subject:string;accountId:string}>('meta','service-owner'),incarnation:await assertCurrentLibrary(tx),state:await tx.get<CloudSyncState>('meta','cloud-sync'),epoch:await readAccountSignoutEpoch(tx),localRevision:await readLocalLibraryRevision(tx)}));
type SyncIntent=Awaited<ReturnType<typeof captureIntent>>;
const currentAuthSession=async()=>{
 const result=await auth?.getSession();
 // An expired token can temporarily lack a session while the SDK retries
 // refresh after an outage. Preserve that network failure's retry policy.
 if(result?.error&&isAuthRetryableFetchError(result.error))throw new Error('library_sync_network');
 return result?.data.session;
};
export function syncAccountLibrary(options:AccountLibrarySyncOptions={}):Promise<void>{return synchronizeAccountLibrary(options);}
function synchronizeAccountLibrary(options:AccountLibrarySyncOptions,intent?:SyncIntent):Promise<void>{
 if(options.prepareForAnotherDevice){
  // Release the ordinary sync queue before a potentially long derived build.
  return (intent?Promise.resolve(intent):captureIntent()).then(captured=>synchronizeAccountLibrary({...options,prepareForAnotherDevice:false},captured).then(async()=>{
   const after=await captureIntent();
   if(after.owner?.accountId!==captured.owner?.accountId||after.owner?.subject!==captured.owner?.subject||after.epoch!==captured.epoch||after.incarnation!==captured.incarnation)throw Error('account_changed');
   if(!validatedCheckpoint(after.state)||after.state?.status!=='synced'||after.state.syncedLocalRevision!==after.localRevision)throw Error('library_sync_local_changed');
   return synchronizeAccountLibrary({publishSnapshot:true,signal:options.signal,onProgress:options.onProgress},after);
  }));
 }
 const separatePreparation=!!options.publishSnapshot;
 // An explicit connection must not be swallowed by a concurrent ordinary empty pull.
 const explicit=options.publishEmptyIdentity||options.restoreAfterLocalClear||options.publishSnapshot||options.prepareForAnotherDevice;
 // A manual check cannot be absorbed by an automatic pass that may skip a
 // recently confirmed head. Automatic callers can join actual manual work.
 if(running&&!separatePreparation&&!explicit&&(options.automatic||!runningAutomatic))return running;
 const previous=separatePreparation?undefined:running;
 let resumeCheckpoint:(()=>void)|undefined;
 let operation:ReturnType<typeof control.beginAccountLibrarySyncActivity>,signal:AbortSignal;
 const update=(value:Partial<AccountLibrarySyncActivity>)=>control.updateAccountLibrarySyncActivity(operation.id,value);
 const onProgress:NonNullable<LibrarySyncOptions['onProgress']>=progress=>{update({phase:progress.phase,completed:progress.completed});options.onProgress?.(progress);};
 // Capture before either queue, and verify inside the cross-tab lock. An old
 // click cannot authorize a world cleared while it was waiting for that lock.
 const scope=intent?Promise.resolve(intent):captureIntent();
 let expected:Awaited<typeof scope>;
 const perform=async()=>{
  const intent=expected;
  const before=await readLibrary(async tx=>({owner:await tx.get<{subject:string;accountId:string}>('meta','service-owner'),incarnation:await assertCurrentLibrary(tx),epoch:await readAccountSignoutEpoch(tx),localRevision:await readLocalLibraryRevision(tx),artifactRevision:await readLocalArtifactRevision(tx),state:await tx.get<CloudSyncState>('meta','cloud-sync'),signedOut:!!await tx.get('meta','signed-out'),reconnect:await tx.get('meta','local-reset')==='local-clear'}));
  const owner=before.owner;
  if(!owner)throw new Error('authentication_required');
  if(owner.subject!==intent.owner?.subject||owner.accountId!==intent.owner.accountId||before.incarnation!==intent.incarnation||before.epoch!==intent.epoch)throw Error('account_changed');
  if(before.reconnect&&!options.restoreAfterLocalClear)return;
  const boundary=await captureAccountSessionBoundary(owner.subject);
  let requestIncarnation=before.incarnation,checkpoint:LibrarySyncPreparation|undefined,checkpointDue:number|undefined;
  if(options.automatic&&!explicit){
   if(blocksAutomaticCloudSync(before.state))return;
   const retryAt=automaticCloudSyncRetryAt(before.state);
   if(retryAt!==null&&retryAt>Date.now()){
    // Claim one early recovery attempt per unsuccessful checkpoint chain.
    // Older queued wake-ups cannot bypass a newer failure's backoff.
    if(!options.recovery||before.state?.retryAt!==intent.state?.retryAt)return;
    const session=await currentAuthSession();
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
   const session=await currentAuthSession();
   if(!session||session.user.id!==owner.subject)fresh=false;
   else await assertAccountSessionBoundary(boundary);
  }
  const request:Parameters<typeof synchronizeLibrary>[0]=async(path,body,signal)=>{
   const current=await readLibrary(async tx=>({owner:await tx.get<{subject:string;accountId:string}>('meta','service-owner'),signedOut:await tx.get('meta','signed-out'),incarnation:await assertCurrentLibrary(tx)}));
   const session=await currentAuthSession();
   if(!session||session.user.id!==owner.subject||current.signedOut||current.owner?.accountId!==owner.accountId||current.owner.subject!==owner.subject)throw new Error('authentication_required');
   if(current.incarnation!==requestIncarnation)throw Error('account_changed');
   await assertAccountSessionBoundary(boundary);
   const endpoint=import.meta.env.VITE_SENSA_API_URL;
   if(!endpoint)throw new Error('library_sync_unavailable');
   let response:Response;try{response=await fetch(endpoint.replace(/\/+$/,'')+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json','x-sensa-snapshot-format':'sensa-own-cloud-db-v2','x-sensa-sync-protocol':librarySyncCheckpointProtocol},body:body===undefined?undefined:JSON.stringify(body),signal,redirect:'error',cache:'no-store'});}catch{throw new Error('library_sync_network');}
   await assertAccountSessionBoundary(boundary);
   if(response.status===429)throw new Error('library_sync_rate_limited');if(response.status>=500)throw new Error('library_sync_server_error');
   let value:any;try{value=await response.json();}catch{throw new Error('library_sync_format');}
   await readLibrary(async tx=>{const latest=await tx.get<{subject:string;accountId:string}>('meta','service-owner');if(latest?.subject!==owner.subject||latest.accountId!==owner.accountId||await tx.get('meta','signed-out')||await assertCurrentLibrary(tx)!==requestIncarnation)throw Error('account_changed');});
   if(!response.ok)throw new Error(value.code??'library_sync_unavailable');return value;
  };
  const captureRequest:typeof request=async(path,body,requestSignal)=>{const value=await request(path,body,requestSignal);if(value?.preparation)checkpoint=value.preparation;if(value?.checkpointDue&&Number.isSafeInteger(value.revision))checkpointDue=value.revision;return value;};
  // Actual facts work gets priority; a fresh automatic pass sends no request
  // and must not repeatedly pause an otherwise progressing checkpoint loop.
  if(!fresh)checkpointJob?.controller.abort();
  const result=!fresh?await synchronizeLibrary(captureRequest,{...options,signal,onProgress,backgroundVerification:options.automatic===true}):undefined;
  // Checkpoint convergence is independent from public artifact delivery. Try
  // the device catalog after sync, but leave unavailable artifacts honestly
  // blocked instead of turning a healthy learner-data sync into a failure.
  const after=await readLibrary(async tx=>({owner:await tx.get<{subject:string;accountId:string}>('meta','service-owner'),incarnation:await assertCurrentLibrary(tx),localRevision:await readLocalLibraryRevision(tx),artifactRevision:await readLocalArtifactRevision(tx),reconnect:await tx.get('meta','local-reset')==='local-clear',state:await tx.get<CloudSyncState>('meta','cloud-sync')}));
  if(after.owner?.subject!==owner.subject||after.owner.accountId!==owner.accountId||after.incarnation!==before.incarnation&&!(result?.activated?.fromIncarnation===before.incarnation&&result.activated.incarnation===after.incarnation))throw Error('account_changed');
  await assertAccountSessionBoundary(boundary);
  requestIncarnation=after.incarnation;
  update({incarnation:after.incarnation});
  if(after.reconnect)return;
  if(!options.publishSnapshot&&!options.prepareForAnotherDevice&&(checkpoint||checkpointDue!==undefined)){
   const input=checkpoint?{baseRevision:checkpoint.revision,operationId:checkpoint.operationId,page:checkpoint.page}:{baseRevision:checkpointDue!};
   resumeCheckpoint=()=>{
    const controller=new AbortController(),deadline=new CloudSyncDeadline(controller.signal);deadline.beginInitial();
    const pageRequest:typeof request=(path,body)=>deadline.request(signal=>request(path,body,signal));
    const task=prepareCloudCheckpoint(pageRequest,input,deadline).catch(()=>undefined).finally(()=>{deadline.close();if(checkpointJob?.task===task)checkpointJob=undefined;});
    checkpointJob={controller,task};
   };
  }
  const notePublished=(value:Awaited<ReturnType<typeof synchronizeLibrary>>)=>{
   if(value&&'checkpointPublished'in value&&value.checkpointPublished){update({preparing:true,status:'ready',phase:'prepared',revision:value.checkpointPublished.manifest?.snapshotRevision});return true;}
   const snapshot=value&&('snapshotPublished'in value?value.snapshotPublished?.nativeSnapshot:'snapshotAlreadyPublished'in value?value.snapshotAlreadyPublished:undefined);
   if(snapshot)update({preparing:true,status:'ready',phase:'prepared',revision:snapshot.revision});
   return !!snapshot;
  };
  if(options.publishSnapshot)notePublished(result);
  // Only the first source publication adds this bounded post-step. Daily
  // edits/polls keep their existing facts-only path; later refreshes are explicit.
  const initialPublication=!options.publishSnapshot&&result&&'initialPublicationConfirmed'in result&&result.initialPublicationConfirmed===true;
  if(initialPublication&&validatedCheckpoint(after.state)&&after.state?.status==='synced'&&after.state.syncedLocalRevision===after.localRevision){
   resumeCheckpoint=()=>{void syncAccountLibrary({publishSnapshot:'if-large',signal:options.signal,onProgress:options.onProgress}).catch(()=>undefined);};
  }
  if(options.publishSnapshot||signal.aborted)return;
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
 const work=async()=>{
  if(!expected.owner)throw Error('authentication_required');
  operation=control.beginAccountLibrarySyncActivity(expected.owner,expected.incarnation,!!options.publishSnapshot,options.automatic===true);signal=options.signal?AbortSignal.any([options.signal,operation.controller.signal]):operation.controller.signal;
  try{await perform();}
  catch(error){update({...(options.prepareForAnotherDevice?{preparing:true}:{}),status:signal.aborted?'cancelled':'failed',phase:'stopped'});throw error;}
  finally{control.finishAccountLibrarySyncActivity(operation.id);}
 };
 const start=async()=>{
  expected=await scope;
  if(previous)await previous.catch(()=>undefined);
  await (!separatePreparation&&navigator.locks?navigator.locks.request('sensa-account-library-sync',work):work());
 };
 const task=start().finally(()=>{if(running===task){running=undefined;runningAutomatic=false;if(!signal?.aborted)resumeCheckpoint?.();}window.dispatchEvent(new Event(accountLibrarySyncFinishedEvent));});
 if(!separatePreparation){running=task;runningAutomatic=options.automatic===true;}return task;
}
