import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {inspectLocalClear,attemptLocalClearSync,clearLocalLibrary,type LocalClearPreview} from '../../data/library/dataControl';
import {readLocalStorageBudget,readLocalStoragePersistence,requestLocalStoragePersistence,type LocalStorageBudget,type LocalStoragePersistence} from '../../data/library/storagePersistence';
import {localFlowErrorKey} from '../../i18n/localFlowText';
import {setupButton} from './learning/LearningSetupFrame';
const persistenceMessage:Record<LocalStoragePersistence|'checking',string>={
 checking:'dataControl.persistence_checking',
 persistent:'dataControl.persistence_persistent',
 'best-effort':'dataControl.persistence_best-effort',
 unsupported:'dataControl.persistence_unsupported',
 unavailable:'dataControl.persistence_unavailable',
};
export function LocalDataControlPanel({synchronize}:{synchronize?:()=>Promise<void>}={}){
 const {t}=useTranslation();const [preview,setPreview]=useState<LocalClearPreview|null>(null),[confirmed,setConfirmed]=useState(false),[discardPendingSync,setDiscardPendingSync]=useState(false),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
 const [persistence,setPersistence]=useState<LocalStoragePersistence|'checking'>('checking'),[persistenceBusy,setPersistenceBusy]=useState(false);
 const [storageBudget,setStorageBudget]=useState<LocalStorageBudget|null>(null);
 useEffect(()=>{let active=true;void readLocalStoragePersistence().then(value=>{if(active)setPersistence(value);});void readLocalStorageBudget().then(value=>{if(active)setStorageBudget(value);});return()=>{active=false;};},[]);
 const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(e){setError(localFlowErrorKey(e,'localFlow.retryOperation'));setPreview(null);setConfirmed(false);setDiscardPendingSync(false);}finally{setBusy(false);}};
 const syncBeforeClear=async()=>{if(!preview)return;setBusy(true);setError('');setDiscardPendingSync(false);try{const next=await attemptLocalClearSync(preview,synchronize);setPreview(next);if(next.syncAttempt==='failed')setError('cloudSync.failed');}catch(e){setError(localFlowErrorKey(e,'localFlow.retryOperation'));setPreview(null);setConfirmed(false);}finally{setBusy(false);}};
 return <div className="space-y-6">
 <section className="mt-8 rounded-card border border-border-subtle bg-surface-panel p-6" aria-labelledby="local-storage-persistence-heading">
  <h2 id="local-storage-persistence-heading" className="text-lg font-medium">{t('dataControl.persistenceTitle',{ns:'profile'})}</h2>
  <p className="mt-3 text-sm leading-6 text-fg-secondary">{t('dataControl.persistenceIntro',{ns:'profile'})}</p>
  <p role="status" className="mt-4 text-sm font-medium">{t(persistenceMessage[persistence],{ns:'profile'})}</p>
  {storageBudget&&<p className={'mt-3 text-sm '+(storageBudget.usageBytes/storageBudget.quotaBytes>=.8?'text-feedback-danger':'text-fg-secondary')}>{t(storageBudget.usageBytes/storageBudget.quotaBytes>=.8?'dataControl.storageBudgetWarning':'dataControl.storageBudget',{ns:'profile',used:(storageBudget.usageBytes/1024/1024).toFixed(1),quota:(storageBudget.quotaBytes/1024/1024).toFixed(0)})}</p>}
  {persistence==='best-effort'&&<button className={setupButton+' mt-4 border'} disabled={persistenceBusy} onClick={()=>{setPersistenceBusy(true);void requestLocalStoragePersistence().then(setPersistence).finally(()=>setPersistenceBusy(false));}}>{persistenceBusy?t('localFlow.processing'):t('dataControl.persistenceRequest',{ns:'profile'})}</button>}
 </section>
 <section className="rounded-card border border-border-subtle bg-surface-panel p-6" aria-labelledby="local-clear-heading">
  <h2 id="local-clear-heading" className="text-lg font-medium">{t('dataControl.clearTitle',{ns:'profile'})}</h2>
  <p className="mt-3 text-sm leading-6 text-fg-secondary">{t('dataControl.clearIntro',{ns:'profile'})}</p>
  {!done&&!preview&&<button className={setupButton+' mt-4 border'} disabled={busy} onClick={()=>void run(async()=>{setPreview(await inspectLocalClear());})}>{busy?t('localFlow.processing'):t('dataControl.clearInspect',{ns:'profile'})}</button>}
  {preview&&!done&&<div className="mt-4 space-y-4 rounded-control bg-accent-soft p-4 text-sm"><p>{t('dataControl.clearSummary',{ns:'profile',...preview})}</p>{preview.pending>0&&<p>{t('dataControl.clearPending',{ns:'profile',count:preview.pending})}</p>}{preview.pendingSync>0&&<div className="space-y-3" data-local-clear-sync={preview.syncAttempt}><p className="font-medium">{t('account.localWeb.pending',{count:preview.pendingSync})}</p><p>{t('account.localWeb.privacy')}</p><button className={setupButton+' border'} disabled={busy||!preview.canSync} onClick={()=>void syncBeforeClear()}>{t(busy?'localFlow.processing':'cloudSync.retry')}</button>{preview.syncAttempt==='failed'&&<label className="flex items-start gap-2"><input type="checkbox" checked={discardPendingSync} disabled={busy} onChange={e=>setDiscardPendingSync(e.target.checked)}/><span>{t('dataControl.clearDiscardPending',{ns:'profile',count:preview.pendingSync})}</span></label>}</div>}<label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{t('dataControl.clearConfirm',{ns:'profile'})}</label><div className="flex gap-3"><button className={setupButton+' bg-feedback-danger text-fg-inverse'} disabled={!confirmed||busy||preview.pendingSync>0&&(preview.syncAttempt!=='failed'||!discardPendingSync)} onClick={()=>void run(async()=>{await clearLocalLibrary(preview,{discardPendingSync});setDone(true);})}>{busy?t('localFlow.processing'):t('dataControl.clearAction',{ns:'profile'})}</button><button className={setupButton} disabled={busy} onClick={()=>{setPreview(null);setConfirmed(false);setDiscardPendingSync(false);setError('');}}>{t('localFlow.cancel')}</button></div></div>}
  {error&&<p role="alert" className="mt-3 text-sm text-feedback-danger">{t(error)}</p>}
  {done&&<div className="mt-4"><p role="status">{t('dataControl.clearDone',{ns:'profile'})}</p><button className={setupButton+' mt-3 border'} onClick={()=>location.reload()}>{t('libraryBackup.reopen')}</button></div>}
 </section>
 </div>;
}
