import {auth} from '../consumer/client';
import {readLibrary} from './store';
import {synchronizeLibrary} from './cloudSync';
let running:Promise<void>|undefined;
export function syncAccountLibrary(){
 if(running)return running;
 const work=async()=>{
  const owner=await readLibrary(tx=>tx.get<{subject:string;accountId:string}>('meta','service-owner'));
  if(!owner)throw new Error('authentication_required');
  await synchronizeLibrary(async(path,body)=>{
   const current=await readLibrary(async tx=>({owner:await tx.get<{subject:string;accountId:string}>('meta','service-owner'),signedOut:await tx.get('meta','signed-out')}));
   const session=(await auth?.getSession())?.data.session;
   if(!session||session.user.id!==owner.subject||current.signedOut||current.owner?.accountId!==owner.accountId||current.owner.subject!==owner.subject)throw new Error('authentication_required');
   const endpoint=import.meta.env.VITE_SENSA_API_URL;
   if(!endpoint)throw new Error('library_sync_unavailable');
   const response=await fetch(endpoint.replace(/\/+$/,'')+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error',cache:'no-store'});
   const value=await response.json();if(!response.ok)throw new Error(value.code??'library_sync_unavailable');return value;
  });
 };
 running=(navigator.locks?navigator.locks.request('sensa-account-library-sync',work):work()).finally(()=>{running=undefined;});return running;
}
