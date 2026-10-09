import {auth} from '../account/auth';
import {readLibrary,assertCurrentLibrary} from './store';
import {synchronizeLibrary,readCloudReconnectRequired,type LibrarySyncOptions} from './cloudSync';
let running:Promise<void>|undefined;
export const accountLibrarySyncFinishedEvent='sensa-account-library-sync-finished';
export function syncAccountLibrary(options:LibrarySyncOptions={}):Promise<void>{
 // An explicit connection must not be swallowed by a concurrent ordinary empty pull.
 const explicit=options.publishEmptyIdentity||options.restoreAfterLocalClear;
 if(running&&!explicit)return running;
 const previous=running;
 // Capture before either queue, and verify inside the cross-tab lock. An old
 // click cannot authorize a world cleared while it was waiting for that lock.
 const scope=explicit?readLibrary(async tx=>({owner:await tx.get<{subject:string;accountId:string}>('meta','service-owner'),incarnation:await assertCurrentLibrary(tx)})):undefined;
 let expected:Awaited<NonNullable<typeof scope>>|undefined;
 const work=async()=>{
  const intent=expected;
  if(intent)await readLibrary(async tx=>{const owner=await tx.get<{subject:string;accountId:string}>('meta','service-owner');if(!owner||owner.subject!==intent.owner?.subject||owner.accountId!==intent.owner.accountId||(await assertCurrentLibrary(tx))!==intent.incarnation)throw Error('account_changed');});
  if(!options.restoreAfterLocalClear&&await readCloudReconnectRequired())return;
  const owner=await readLibrary(tx=>tx.get<{subject:string;accountId:string}>('meta','service-owner'));
  if(!owner)throw new Error('authentication_required');
  const passSignal=AbortSignal.timeout(90000);
  await synchronizeLibrary(async(path,body)=>{
   const current=await readLibrary(async tx=>({owner:await tx.get<{subject:string;accountId:string}>('meta','service-owner'),signedOut:await tx.get('meta','signed-out')}));
   const session=(await auth?.getSession())?.data.session;
   if(!session||session.user.id!==owner.subject||current.signedOut||current.owner?.accountId!==owner.accountId||current.owner.subject!==owner.subject)throw new Error('authentication_required');
   const endpoint=import.meta.env.VITE_SENSA_API_URL;
   if(!endpoint)throw new Error('library_sync_unavailable');
   let response:Response;try{response=await fetch(endpoint.replace(/\/+$/,'')+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([passSignal,AbortSignal.timeout(15000)]),redirect:'error',cache:'no-store'});}catch{throw new Error('library_sync_network');}
   if(response.status===429)throw new Error('library_sync_rate_limited');if(response.status>=500)throw new Error('library_sync_server_error');
   let value:any;try{value=await response.json();}catch{throw new Error('library_sync_format');}
   if(!response.ok)throw new Error(value.code??'library_sync_unavailable');return value;
  },options);
  // Checkpoint convergence is independent from public artifact delivery. Try
  // the device catalog after sync, but leave unavailable artifacts honestly
  // blocked instead of turning a healthy learner-data sync into a failure.
  const {contentSupplySystem}=await import('../../contentSupply/system/contentSupplySystem');
  // Restoring a large Library may finish after the transfer deadline. Public
  // artifacts are a separate phase, not a request on that expired signal.
  await contentSupplySystem.execute({kind:'rehydrate',signal:AbortSignal.timeout(90000)}).catch(()=>undefined);
 };
 const start=async()=>{
  if(scope)expected=await scope;
  if(previous)await previous.catch(()=>undefined);
  await (navigator.locks?navigator.locks.request('sensa-account-library-sync',work):work());
 };
 const task=start().finally(()=>{if(running===task)running=undefined;window.dispatchEvent(new Event(accountLibrarySyncFinishedEvent));});running=task;return task;
}
