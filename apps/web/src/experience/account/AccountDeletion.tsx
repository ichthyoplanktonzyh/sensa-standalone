import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {accountDeletionFlow,type DeletionOutcome} from './accountDeletionFlow';

export function AccountDeletion({onClose}:{onClose:()=>void}){
 const {t}=useTranslation(),[flow]=useState(accountDeletionFlow);
 const [busy,setBusy]=useState(false),[sent,setSent]=useState(flow.receipt?.phase==='verifying'),[verified,setVerified]=useState(false);
 const [code,setCode]=useState(''),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('');
 const [pending,setPending]=useState(flow.receipt?.phase==='submitted'),[outcome,setOutcome]=useState<DeletionOutcome|null>(null);
 const flight=useRef(false),retryAt=useRef(0);
 const codeInput=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(sent&&!busy&&!verified)codeInput.current?.focus();},[sent,busy,verified]);
 const run=async(work:()=>Promise<void>)=>{
  if(flight.current)return;flight.current=true;setBusy(true);setError('');
  try{await work();}catch(e){setError(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:'localFlow.deleteRetry');}
  finally{flight.current=false;setBusy(false);}
 };
 useEffect(()=>{
  if(flow.hasEmailCallback)void run(async()=>{await flow.verify();setVerified(true);setSent(true);setPending(false);});
 },[flow]);
 const send=async()=>{await flow.send();setCode('');setSent(true);setVerified(false);setPending(false);retryAt.current=Date.now()+60000;};
 const finish=(result:DeletionOutcome)=>{setOutcome(result);setPending(result.state==='deletion_pending');setVerified(false);setSent(false);};
 const done=outcome?.state==='deleted';
 return <main className="mx-auto max-w-xl space-y-5 p-8">
  <h1 className="text-2xl font-medium">{t('localFlow.deleteTitle')}</h1>
  {!done&&<><p className="text-sm leading-6">{t('localFlow.deleteScope')}</p>{flow.receipt&&<p>{flow.receipt.email}</p>}</>}
  {outcome&&<p role="status">{t(outcome.state==='deleted'?outcome.localCleared?'localFlow.deleteDone':'localFlow.deleteDonePreserved':'localFlow.deletePending')}{!outcome.localCleared&&outcome.state!=='deleted'&&' '+t('localFlow.deleteLocalPreserved')}</p>}
  {!done&&(!pending?<>
   <label className="flex items-start gap-3"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{t('localFlow.deleteConfirm')}</label>
   {!sent?<button className={setupPrimary} disabled={busy||!confirmed} onClick={()=>void run(send)}>{t(busy?'localFlow.processing':'localFlow.deleteSend')}</button>:<>
    {!verified&&<><p>{t('localFlow.otpSent',{email:flow.receipt?.email})}</p>
     <form className="space-y-4" onSubmit={e=>{e.preventDefault();void run(async()=>{await flow.verify(code);setVerified(true);});}}><label className="block">{t('localFlow.deleteCode')}<input className="mt-2 block w-full rounded-xl border p-3" ref={codeInput} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value)} disabled={busy}/></label><button className={setupPrimary} disabled={busy||!code.trim()}>{t('localFlow.verify')}</button></form>
     <button className={setupButton} disabled={busy} onClick={()=>{if(Date.now()<retryAt.current){setError('localFlow.otpRateLimit');return;}void run(send);}}>{t('localFlow.deleteResend')}</button></>}
    {verified&&<><p role="status">{t('localFlow.deleteVerified')}</p><button className={setupButton+' bg-feedback-danger text-fg-inverse'} disabled={busy||!confirmed} onClick={()=>void run(async()=>{setPending(true);finish(await flow.submit());})}>{t(busy?'localFlow.processing':'localFlow.deleteAction')}</button></>}
   </>}
  </>:<button className={setupPrimary} disabled={busy} onClick={()=>void run(async()=>{const result=await flow.check();if(result)finish(result);else{setPending(false);setSent(false);setVerified(false);setError('localFlow.deleteUnconfirmed');}})}>{t(busy?'localFlow.processing':'localFlow.deleteCheck')}</button>)}
  {error&&<p role="alert">{t(error)}</p>}
  <button className={setupButton} disabled={busy} onClick={()=>void run(async()=>{await flow.leave();onClose();})}>{t(done?'localFlow.deleteExit':pending?'localFlow.deleteLeave':'localFlow.cancel')}</button>
 </main>;
}
