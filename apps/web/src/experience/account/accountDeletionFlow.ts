import type {Session} from '@supabase/supabase-js';
import {auth} from '../../data/account/auth';
import {accountSignoutEpoch} from '../../data/account/accountSessionBoundary';
import {completeEmailLink,emailLinkRedirect,emailLinkSignoutEpoch,emailLinkCallbackPresent} from '../../data/consumer/emailLink';
import {accountDeletionLocalScope,eraseDeletedAccount} from '../../data/library/dataControl';
import {readLibrary} from '../../data/library/store';
import {clearPendingAccountDeletion,pendingAccountDeletion,storePendingAccountDeletion,type PendingAccountDeletion} from './accountDeletionState';

export type DeletionOutcome={state:'deleted'|'deletion_pending';localCleared:boolean};
/** Owns fresh verification and the durable, idempotent request. Neither an
 * email callback nor a status check is permission to submit a new deletion. */
export function accountDeletionFlow(){
 let receipt=pendingAccountDeletion(),proof:Session|null=null;
 const callbackPresent=emailLinkCallbackPresent();
 const active=()=>{
  const current=pendingAccountDeletion();
  if(!receipt||current?.operationId!==receipt.operationId)throw Error('localFlow.deleteRetry');
  receipt=current;return current;
 };
 const sameLibrary=async(expected:PendingAccountDeletion)=>{
  const scope=await accountDeletionLocalScope(expected.subject);
  if(scope.libraryId!==expected.localScope.libraryId||scope.incarnation!==expected.localScope.incarnation)throw Error('localFlow.libraryReplaced');
  if(await accountSignoutEpoch()!==expected.signoutEpoch)throw Error('localFlow.deleteVerificationExpired');
 };
 const sessionFor=async(expected:PendingAccountDeletion)=>{
  await sameLibrary(expected);
  const session=(await auth?.getSession())?.data.session;
  if(!session||session.user.id!==expected.subject)throw Error('localFlow.wrongAccount');
  return session;
 };
 const persist=async(next:PendingAccountDeletion,create=false)=>{receipt=await storePendingAccountDeletion(next,{create});};
 const request=async(path:string,body:unknown,token?:string)=>{
  const endpoint=import.meta.env.VITE_SENSA_API_URL?.replace(/\/$/,'');
  if(!endpoint)throw Error('localFlow.onlineUnavailable');
  return fetch(endpoint+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});
 };
 const apply=async(response:Response,expected:PendingAccountDeletion):Promise<DeletionOutcome>=>{
  if(!response.ok){
   const failure=await response.json().catch(()=>({}));
   if(failure.code==='reauthentication_required'){proof=null;throw Error('localFlow.deleteVerificationExpired');}
   if(['account_deletion_not_configured','legacy_account_erasure_required'].includes(failure.code))throw Error('localFlow.deleteUnavailable');
   throw Error('localFlow.deleteRetry');
  }
  const result=await response.json();
  if(result.operationId!==expected.operationId||!['deleted','deletion_pending'].includes(result.state))throw Error('localFlow.deleteRetry');
  let localCleared=false;
  try{await eraseDeletedAccount(expected.subject,expected.localScope);localCleared=true;}
  catch(error){if(!(error instanceof Error)||!['localFlow.wrongAccount','localFlow.libraryReplaced'].includes(error.message))throw error;}
  // The service has revoked this account and local erasure sets signed-out.
  // An asynchronous SDK signOut would also remove a later account's shared
  // browser session after its HTTP response; never do that from a late result.
  if(result.state==='deleted'){await clearPendingAccountDeletion(expected.operationId);receipt=null;}
  return {state:result.state,localCleared};
 };
 return {
  get receipt(){return receipt;},
  hasEmailCallback:callbackPresent,
  async send(){
   if(!auth)throw Error('localFlow.onlineUnavailable');
   proof=null;
   const creating=!receipt;
   if(!receipt){
    const owner=await readLibrary(tx=>tx.get<{subject:string;email:string}>('meta','service-owner'));
    if(!owner)throw Error('localFlow.wrongAccount');
    receipt={...owner,operationId:crypto.randomUUID(),phase:'verifying',localScope:await accountDeletionLocalScope(owner.subject),signoutEpoch:await accountSignoutEpoch()};
   }
   const stored=pendingAccountDeletion();
   if(stored&&stored.operationId!==receipt.operationId)throw Error('localFlow.deleteRetry');
   const expected=stored??receipt;await sessionFor(expected);
   // A magic-link redirect reopens this exact intent. A prior submitted
   // request keeps its identity even when its response was lost.
   await persist({...expected,dismissed:false},creating);
   const result=await auth.signInWithOtp({email:expected.email,options:{shouldCreateUser:false,emailRedirectTo:emailLinkRedirect()}});
   if(result.error)throw Error(result.error.status===429?'localFlow.otpRateLimit':'localFlow.emailLinkSendFailed');
  },
  async verify(code?:string){
   const expected=active();
   if(!auth)throw Error('localFlow.onlineUnavailable');
   let session:Session|null;
   if(code!==undefined){
    await sameLibrary(expected);
    const result=await auth.verifyOtp({email:expected.email,token:code.trim(),type:'email'});
    if(result.error||!result.data.session)throw Error('localFlow.otpInvalid');session=result.data.session;
   }else{
    if(!callbackPresent||await completeEmailLink(expected.signoutEpoch)!=='signed-in'||emailLinkSignoutEpoch()!==expected.signoutEpoch)throw Error('localFlow.emailLinkInvalid');
    session=(await auth.getSession()).data.session;
   }
   await sameLibrary(expected);
   if(!session||session.user.id!==expected.subject)throw Error('localFlow.wrongAccount');
   proof=session;
  },
  async submit(){
   const expected=active(),session=await sessionFor(expected);
   if(!proof||proof.user.id!==session.user.id||proof.access_token!==session.access_token)throw Error('localFlow.deleteVerificationExpired');
   const access=await request('/sensa/web/access/session',{installationId:crypto.randomUUID()},session.access_token);
   if(!access.ok)throw Error('localFlow.deleteRetry');
   await sameLibrary(expected);active();
   await persist({...expected,phase:'submitted',dismissed:false});
   return apply(await request('/sensa/account/deletion',{operationId:expected.operationId,confirmation:'delete-account'},session.access_token),expected);
  },
  async check(){
   const expected=active();
   const response=await request('/sensa/account/deletion/status',{operationId:expected.operationId});
   // 404 cannot cancel an in-flight request. Reverification retries its UUID.
   if(response.status===404)return null;
   return apply(response,expected);
  },
  async leave(){
   if(!receipt)return;
   const current=pendingAccountDeletion();
   if(current?.operationId!==receipt.operationId)return;
   if(current.phase==='verifying')await clearPendingAccountDeletion(current.operationId,true);
   else await persist({...current,dismissed:true});
   proof=null;
  },
 };
}
