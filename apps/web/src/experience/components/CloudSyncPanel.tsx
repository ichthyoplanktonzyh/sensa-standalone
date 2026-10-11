import '../../i18n/accountResources';
import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {resolveCloudSyncConflicts,type CloudSyncConflictChoice} from '../../data/library/cloudSync';
import {readCloudSyncPanel,cloudSyncPanelMessage,cloudSyncCanChoose,cloudSyncNeedsRecovery,type CloudSyncPanelRead} from './cloudSyncPanelRead';
import {LibraryBackupPanel} from './LibraryBackupPanel';
import {downloadSupportDiagnostics} from '../../support/supportDiagnostics';
import {syncAccountLibrary} from '../../data/library/cloudSyncService';
import {observeCloudSync} from '../../data/library/store';
import {useAccountExperience} from '../account/AccountContext';
import {setupButton} from './learning/LearningSetupFrame';
import type {ConflictPreview} from '../../data/library/cloudSyncComparison';
function VersionPreview({version,label,images}:{version:ConflictPreview;label:string;images:Record<string,string>}){
 const {t}=useTranslation();
 return <section aria-label={label} className="min-w-0 rounded-control border border-border-subtle bg-surface-panel p-3"><h5 className="font-semibold">{label}</h5>
  {version.removed&&<p className="mt-2">{t('cloudSync.comparison.removed')}</p>}
  {!version.available&&<p className="mt-2">{t('cloudSync.comparison.unavailable')}</p>}
  <dl className="mt-3 space-y-3">{version.fields.map((field,index)=><div key={index}><dt className="text-xs text-fg-secondary">{t('cloudSync.comparison.fields.'+field.label)}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{field.text}</dd></div>)}</dl>
  {version.images.map(id=>images[id]?.startsWith('data:image/')?<img key={id} src={images[id]} alt={t('cloudSync.comparison.fields.context')} className="mt-3 max-h-64 max-w-full object-contain"/>:null)}
 </section>;
}
export function CloudSyncPanel(){
 const {t,i18n}=useTranslation(),account=useAccountExperience();
 const [snapshot,setSnapshot]=useState<CloudSyncPanelRead>({availability:'loading'}),[readAttempt,setReadAttempt]=useState(0),[busy,setBusy]=useState<CloudSyncConflictChoice|null>(null);
 const state=snapshot.availability==='ready'?snapshot.state:undefined;
 const reconnectRequired=snapshot.availability==='ready'&&snapshot.reconnectRequired;
 const [decisionError,setDecisionError]=useState<string|null>(null);
 const [showBackup,setShowBackup]=useState(false),[backupBusy,setBackupBusy]=useState(false),[diagnostics,setDiagnostics]=useState<'idle'|'working'|'ready'|'failed'>('idle');
 useEffect(()=>{let active=true,revision=0;const refresh=()=>{const current=++revision;setSnapshot({availability:'loading'});void readCloudSyncPanel().then(value=>{if(active&&current===revision)setSnapshot(value);});};refresh();const stop=observeCloudSync(refresh);return()=>{active=false;stop();};},[readAttempt]);
 const resolve=async(choice:CloudSyncConflictChoice)=>{if(!state?.conflict)return;setBusy(choice);setDecisionError(null);try{await resolveCloudSyncConflicts(choice,{localRevision:state.conflict.localRevision,remoteRevision:state.conflict.remoteRevision});await syncAccountLibrary();}catch(error){setDecisionError(error instanceof Error&&error.message==='library_sync_conflict_changed'?'cloudSync.comparison.changed':'cloudSync.failed');}finally{setBusy(null);}};
 const storage=state?.storage,usedMiB=storage?new Intl.NumberFormat(i18n.language,{maximumFractionDigits:1}).format(storage.usedBytes/1024/1024):'',capacityMiB=storage?new Intl.NumberFormat(i18n.language,{maximumFractionDigits:0}).format(storage.capacityBytes/1024/1024):'',storageWarning=storage&&storage.usedBytes/storage.capacityBytes>=.8;
 const comparison=state?.conflict?.comparison;
 const canChoose=cloudSyncCanChoose(state),needsRecovery=cloudSyncNeedsRecovery(state);
 if(!account.onlineService)return <section className="rounded-card border border-border-strong bg-surface-panel p-5"><h3 className="text-lg font-semibold">{t('cloudSync.title')}</h3><p className="mt-3 text-sm">{account.connectionConflict?account.notice:t('account.localSync')}</p>{!account.connectionConflict&&<button className={setupButton+' mt-4'} onClick={account.login}>{t('account.localWeb.login')}</button>}</section>;
 return <section className="sensa-cloud-sync border-y border-border-subtle py-5"><h3 className="text-lg font-medium">{t('cloudSync.title')}</h3><p role={snapshot.availability==='error'?'alert':'status'} aria-busy={snapshot.availability==='loading'} className="mt-3 text-sm">{t(cloudSyncPanelMessage(snapshot))}</p>
  {snapshot.availability==='error'&&<button className={setupButton+' mt-3'} onClick={()=>setReadAttempt(value=>value+1)}>{t('reliability.retry')}</button>}
  {!reconnectRequired&&<details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-3 text-fg-secondary">{t('account.sync')}</summary><p className="pb-3 leading-6 text-fg-secondary">{t('account.localWeb.cloudNote')}</p></details>}
  {state?.status==='conflict'&&state.conflict&&<div className="mt-4 rounded-control border border-border-subtle bg-surface-subtle p-4 text-sm">{canChoose&&<p>{t('cloudSync.conflictPrompt')}</p>}
   {comparison?.records.map((record,index)=><article key={record.id} className="mt-4"><h4 className="mb-2 break-words font-semibold">{record.local.title??record.remote.title??t('cloudSync.comparison.item',{number:index+1})}</h4><div className="grid gap-3 md:grid-cols-2"><VersionPreview version={record.local} label={t('cloudSync.comparison.local')} images={comparison.images}/><VersionPreview version={record.remote} label={t('cloudSync.comparison.remote')} images={comparison.images}/></div><details className="mt-2"><summary className="cursor-pointer text-fg-secondary">{t('cloudSync.comparison.base')}</summary><VersionPreview version={record.base} label={t('cloudSync.comparison.base')} images={comparison.images}/></details></article>)}
   {!canChoose&&<p role="alert" className="mt-3">{t(comparison?'cloudSync.comparison.unsupported':'cloudSync.comparison.refresh')}</p>}
   {canChoose&&<><div className="mt-4 flex flex-wrap gap-3"><button className={setupButton} disabled={busy!==null||!account.onlineService} onClick={()=>void resolve('local')}>{t(busy==='local'?'cloudSync.resolving':'cloudSync.keepLocal')}</button><button className={setupButton} disabled={busy!==null||!account.onlineService} onClick={()=>void resolve('remote')}>{t(busy==='remote'?'cloudSync.resolving':'cloudSync.useCloud')}</button></div><p className="mt-3 text-xs leading-5 text-fg-secondary">{t('cloudSync.conflictDecision')}</p></>}</div>}
  {(needsRecovery||showBackup||diagnostics!=='idle')&&<div className="mt-4 text-sm"><p className="leading-6 text-fg-secondary">{t('syncRecovery.hint',{ns:'profile'})}</p><div className="mt-3 flex flex-wrap gap-3"><button className={setupButton} disabled={backupBusy} onClick={()=>setShowBackup(value=>!value)}>{t(showBackup?'syncRecovery.hideBackup':'syncRecovery.backup',{ns:'profile'})}</button><button className={setupButton} disabled={diagnostics==='working'} onClick={()=>{setDiagnostics('working');void downloadSupportDiagnostics().then(()=>setDiagnostics('ready')).catch(()=>setDiagnostics('failed'));}}>{t(diagnostics==='working'?'support.diagnosticsWorking':'support.diagnosticsDownload',{ns:'profile'})}</button></div>{diagnostics==='ready'&&<p role="status" className="mt-3">{t('support.diagnosticsReady',{ns:'profile'})}</p>}{diagnostics==='failed'&&<p role="alert" className="mt-3">{t('support.diagnosticsFailed',{ns:'profile'})}</p>}{showBackup&&<LibraryBackupPanel exportOnly onBusyChange={setBackupBusy}/>}</div>}
  {decisionError&&<p role="alert" className="mt-3 text-sm text-feedback-danger">{t(decisionError)}</p>}
  {storage&&<p className={'mt-3 text-sm '+(storageWarning?'text-feedback-danger':'text-fg-secondary')}>{t(storageWarning?'cloudSync.storageWarning':'cloudSync.storage',{used:usedMiB,capacity:capacityMiB})}</p>}
  {state?.lastSyncedAt&&<p className="mt-2 text-sm text-fg-secondary">{t('cloudSync.last')} <time dateTime={state.lastSyncedAt}>{new Date(state.lastSyncedAt).toLocaleString(i18n.resolvedLanguage??i18n.language)}</time></p>}{snapshot.availability==='ready'&&<button className={setupButton+' mt-4'} disabled={!account.onlineService||state?.status==='syncing'||busy!==null} onClick={()=>void syncAccountLibrary({restoreAfterLocalClear:true}).catch(()=>{})}>{t('cloudSync.retry')}</button>}</section>;
}
