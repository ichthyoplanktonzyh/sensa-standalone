import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {auth} from '../../data/account/auth';
import {eraseDeletedAccount} from '../../data/library/dataControl';
import {readLibrary} from '../../data/library/store';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
const storageKey='sensa:account-deletion';
type Pending={subject:string;email:string;operationId:string};
export function pendingAccountDeletion():Pending|null{try{const p=JSON.parse(localStorage.getItem(storageKey)??'null');return p&&typeof p.subject==='string'&&typeof p.email==='string'&&typeof p.operationId==='string'?p:null;}catch{return null;}}
export function AccountDeletion({onClose}:{onClose:()=>void}){
 const {t}=useTranslation();const [busy,setBusy]=useState(false),[sent,setSent]=useState(false),[code,setCode]=useState(''),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(pendingAccountDeletion),[done,setDone]=useState(false);
 const identity=useRef<Pending|null>(pending),flight=useRef(false),[retryAt,setRetryAt]=useState(0);
 const run=async(work:()=>Promise<void>)=>{if(flight.current)return;flight.current=true;setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:'localFlow.deleteRetry');}finally{flight.current=false;setBusy(false);}};
 const send=async()=>{
  if(!auth)throw Error('localFlow.onlineUnavailable');
  const session=(await auth.getSession()).data.session;const owner=await readLibrary(tx=>tx.get<{subject:string;email:string}>('meta','service-owner'));
  const expected=pending??owner;if(!expected||!session||session.user.id!==expected.subject)throw Error('localFlow.wrongAccount');
  identity.current=pending??pendingAccountDeletion()??{...expected,operationId:crypto.randomUUID()};
  if(identity.current.subject!==expected.subject)throw Error('localFlow.wrongAccount');
  const result=await auth.signInWithOtp({email:expected.email,options:{shouldCreateUser:false}});if(result.error)throw Error('localFlow.otpSendFailed');setSent(true);setRetryAt(Date.now()+60000);
 };
 const recover=async()=>{
  if(!pending)return;
  const endpoint=import.meta.env.VITE_SENSA_API_URL?.replace(/\/$/,'');if(!endpoint)throw Error('localFlow.onlineUnavailable');
  const response=await fetch(endpoint+'/sensa/account/deletion/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationId:pending.operationId}),signal:AbortSignal.timeout(30000),redirect:'error'});
  if(response.status===404){setPending(null);setSent(false);return;}
  if(!response.ok)throw Error('localFlow.deleteRetry');
  const result=await response.json();if(result.operationId!==pending.operationId||!['deleted','deletion_pending'].includes(result.state))throw Error('localFlow.deleteRetry');
  await eraseDeletedAccount(pending.subject);
  if(result.state==='deleted'){localStorage.removeItem(storageKey);setDone(true);}else setError('localFlow.deletePending');
 };
 const submit=async()=>{
  const expected=identity.current;if(!auth||!expected)throw Error('localFlow.deleteRetry');
  const verified=await auth.verifyOtp({email:expected.email,token:code.trim(),type:'email'});if(verified.error||!verified.data.session)throw Error('localFlow.otpInvalid');
  const session=verified.data.session;if(session.user.id!==expected.subject)throw Error('localFlow.wrongAccount');
  const endpoint=import.meta.env.VITE_SENSA_API_URL?.replace(/\/$/,'');if(!endpoint)throw Error('localFlow.onlineUnavailable');
  const call=async(path:string,body:unknown)=>fetch(endpoint+path,{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!pending){const access=await call('/sensa/web/access/session',{installationId:crypto.randomUUID()});if(!access.ok){const receipt=pendingAccountDeletion();if(receipt)setPending(receipt);throw Error('localFlow.deleteRetry');}}
  // Persist the stable operation before sending: lost responses retry the same request.
  localStorage.setItem(storageKey,JSON.stringify(expected));setPending(expected);
  const response=await call('/sensa/account/deletion',{operationId:expected.operationId,confirmation:'delete-account'});
  if(!response.ok){const result=await response.json();if(result.code==='account_deletion_not_configured'||result.code==='legacy_account_erasure_required'){localStorage.removeItem(storageKey);setPending(null);throw Error('localFlow.deleteUnavailable');}throw Error('localFlow.deleteRetry');}
  const result=await response.json();if(!['deleted','deletion_pending'].includes(result.state)||result.operationId!==expected.operationId)throw Error('localFlow.deleteRetry');
  // On reload there may already be an empty library; no foreign library may be cleared.
  await eraseDeletedAccount(expected.subject);
  if(result.state==='deleted'){localStorage.removeItem(storageKey);setDone(true);}else{setError('localFlow.deletePending');setSent(false);}
 };
 return <main className="mx-auto max-w-xl space-y-5 p-8"><h1 className="text-2xl font-medium">{t('localFlow.deleteTitle')}</h1><p className="text-sm leading-6">{t('localFlow.deleteScope')}</p>
 {done?<p role="status">{t('localFlow.deleteDone')}</p>:<><label className="flex items-start gap-3"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{t('localFlow.deleteConfirm')}</label>
 {pending?<button className={setupPrimary} disabled={busy} onClick={()=>void run(recover)}>{t(busy?'localFlow.processing':'localFlow.deleteCheck')}</button>:!sent?<button className={setupPrimary} disabled={busy||!confirmed} onClick={()=>void run(send)}>{t(busy?'localFlow.processing':'localFlow.deleteSend')}</button>:<form className="space-y-4" onSubmit={e=>{e.preventDefault();void run(submit);}}><label className="block">{t('localFlow.deleteCode')}<input className="mt-2 block w-full rounded-xl border p-3" autoComplete="one-time-code" inputMode="numeric" required value={code} onChange={e=>setCode(e.target.value)} disabled={busy}/></label><button className={setupButton+' bg-red-700 text-white'} disabled={busy||!confirmed||!code.trim()}>{t(busy?'localFlow.processing':'localFlow.deleteAction')}</button><button type="button" className={setupButton} disabled={busy} onClick={()=>{if(Date.now()<retryAt){setError('localFlow.otpRateLimit');return;}void run(send);}}>{t('localFlow.deleteResend')}</button></form>}</>}
 {error&&<p role="alert">{t(error)}</p>}{(!pending||done)&&<button className={setupButton} disabled={busy} onClick={()=>{if(done)void auth?.signOut({scope:'local'}).finally(onClose);else onClose();}}>{t(done?'localFlow.deleteExit':'localFlow.cancel')}</button>}</main>;
}
