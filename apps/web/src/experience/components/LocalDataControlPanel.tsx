import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {inspectLocalClear,clearLocalLibrary,type LocalClearPreview} from '../../data/library/dataControl';
import {localFlowErrorKey} from '../../i18n/localFlowText';
import {setupButton} from './learning/LearningSetupFrame';
export function LocalDataControlPanel(){
 const {t}=useTranslation();const [preview,setPreview]=useState<LocalClearPreview|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
 const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(e){setError(localFlowErrorKey(e,'localFlow.retryOperation'));setPreview(null);setConfirmed(false);}finally{setBusy(false);}};
 return <section className="mt-8 rounded-2xl border border-[#e3e5ea] bg-white p-6" aria-labelledby="local-clear-heading">
  <h2 id="local-clear-heading" className="text-lg font-medium">{t('localFlow.clearTitle')}</h2>
  <p className="mt-3 text-sm leading-6 text-[#68748d]">{t('localFlow.clearIntro')}</p>
  {!done&&!preview&&<button className={setupButton+' mt-4 border'} disabled={busy} onClick={()=>void run(async()=>{setPreview(await inspectLocalClear());})}>{t(busy?'localFlow.processing':'localFlow.clearInspect')}</button>}
  {preview&&!done&&<div className="mt-4 space-y-4 rounded-xl bg-red-50 p-4 text-sm"><p>{t('localFlow.clearSummary',preview)}</p>{preview.pending>0&&<p>{t('localFlow.clearPending',{count:preview.pending})}</p>}<label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{t('localFlow.clearConfirm')}</label><div className="flex gap-3"><button className={setupButton+' bg-red-700 text-white'} disabled={!confirmed||busy} onClick={()=>void run(async()=>{await clearLocalLibrary(preview);setDone(true);})}>{t(busy?'localFlow.processing':'localFlow.clearAction')}</button><button className={setupButton} disabled={busy} onClick={()=>{setPreview(null);setConfirmed(false);}}>{t('localFlow.cancel')}</button></div></div>}
  {error&&<p role="alert" className="mt-3 text-sm text-red-800">{t(error)}</p>}
  {done&&<div className="mt-4"><p role="status">{t('localFlow.clearDone')}</p><button className={setupButton+' mt-3 border'} onClick={()=>location.reload()}>{t('libraryBackup.reopen')}</button></div>}
 </section>;
}
