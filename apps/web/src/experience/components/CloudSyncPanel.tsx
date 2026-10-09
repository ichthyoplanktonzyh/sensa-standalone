import '../../i18n/accountResources';
import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {readCloudSync,readCloudReconnectRequired,resolveCloudSyncConflicts,type CloudSyncConflictChoice} from '../../data/library/cloudSync';
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
 const [state,setState]=useState<Awaited<ReturnType<typeof readCloudSync>>>(),[busy,setBusy]=useState<CloudSyncConflictChoice|null>(null);
 const [reconnectRequired,setReconnectRequired]=useState(false);
 const [decisionError,setDecisionError]=useState<string|null>(null);
 useEffect(()=>{let active=true,revision=0;const refresh=()=>{const current=++revision;void Promise.all([readCloudSync(),readCloudReconnectRequired()]).then(([state,paused])=>{if(active&&current===revision){setState(state);setReconnectRequired(paused);}}).catch(()=>{});};refresh();const stop=observeCloudSync(refresh);return()=>{active=false;stop();};},[]);
 const status=state?.error==='library_sync_identity'?'identity':state?.error==='library_sync_incompatible_checkpoint'?'incompatible':state?.failureKind==='terminal'?'attention':state?.status??'pending';
 const resolve=async(choice:CloudSyncConflictChoice)=>{if(!state?.conflict)return;setBusy(choice);setDecisionError(null);try{await resolveCloudSyncConflicts(choice,{localRevision:state.conflict.localRevision,remoteRevision:state.conflict.remoteRevision});await syncAccountLibrary();}catch(error){setDecisionError(error instanceof Error&&error.message==='library_sync_conflict_changed'?'cloudSync.comparison.changed':'cloudSync.failed');}finally{setBusy(null);}};
 const storage=state?.storage,usedMiB=storage?(storage.usedBytes/1024/1024).toFixed(1):'',capacityMiB=storage?(storage.capacityBytes/1024/1024).toFixed(0):'',storageWarning=storage&&storage.usedBytes/storage.capacityBytes>=.8;
 const comparison=state?.conflict?.comparison;
 const canChoose=!!comparison&&comparison.records.length>0&&comparison.records.length===state?.conflict?.records.length&&Number.isSafeInteger(state?.conflict?.localRevision)&&comparison.records.every(record=>record.local.available&&record.remote.available);
 if(!account.onlineService)return <section className="rounded-card border border-border-strong bg-surface-panel p-5"><h3 className="text-lg font-semibold">{t('cloudSync.title')}</h3><p className="mt-3 text-sm">{account.connectionConflict?account.notice:t('account.localSync')}</p>{!account.connectionConflict&&<button className={setupButton+' mt-4'} onClick={account.login}>{t('account.localWeb.login')}</button>}</section>;
 return <section className="rounded-card border border-border-strong bg-surface-panel p-5"><h3 className="text-lg font-semibold">{t('cloudSync.title')}</h3><p role="status" className="mt-3 text-sm">{t(reconnectRequired&&!state?'account.localSync':'cloudSync.'+status)}</p>
  {state?.status==='conflict'&&state.conflict&&<div className="mt-4 rounded-control border border-border-subtle bg-surface-subtle p-4 text-sm"><p>{t('cloudSync.conflictPrompt')}</p>
   {comparison?.records.map((record,index)=><article key={record.id} className="mt-4"><h4 className="mb-2 break-words font-semibold">{record.local.title??record.remote.title??t('cloudSync.comparison.item',{number:index+1})}</h4><div className="grid gap-3 md:grid-cols-2"><VersionPreview version={record.local} label={t('cloudSync.comparison.local')} images={comparison.images}/><VersionPreview version={record.remote} label={t('cloudSync.comparison.remote')} images={comparison.images}/></div><details className="mt-2"><summary className="cursor-pointer text-fg-secondary">{t('cloudSync.comparison.base')}</summary><VersionPreview version={record.base} label={t('cloudSync.comparison.base')} images={comparison.images}/></details></article>)}
   {!canChoose&&<p role="alert" className="mt-3">{t(comparison?'cloudSync.comparison.unsupported':'cloudSync.comparison.refresh')}</p>}
   <div className="mt-4 flex flex-wrap gap-3"><button className={setupButton} disabled={!canChoose||busy!==null||!account.onlineService} onClick={()=>void resolve('local')}>{t(busy==='local'?'cloudSync.resolving':'cloudSync.keepLocal')}</button><button className={setupButton} disabled={!canChoose||busy!==null||!account.onlineService} onClick={()=>void resolve('remote')}>{t(busy==='remote'?'cloudSync.resolving':'cloudSync.useCloud')}</button></div><p className="mt-3 text-xs leading-5 text-fg-secondary">{t('cloudSync.conflictDecision')}</p></div>}
  {decisionError&&<p role="alert" className="mt-3 text-sm text-feedback-danger">{t(decisionError)}</p>}
  {storage&&<p className={'mt-3 text-sm '+(storageWarning?'text-feedback-danger':'text-fg-secondary')}>{t(storageWarning?'cloudSync.storageWarning':'cloudSync.storage',{used:usedMiB,capacity:capacityMiB})}</p>}
  {state?.lastSyncedAt&&<p className="mt-2 text-sm text-fg-secondary">{t('cloudSync.last')} <time dateTime={state.lastSyncedAt}>{new Date(state.lastSyncedAt).toLocaleString(i18n.resolvedLanguage??i18n.language)}</time></p>}<button className={setupButton+' mt-4'} disabled={!account.onlineService||state?.status==='syncing'||busy!==null} onClick={()=>void syncAccountLibrary({restoreAfterLocalClear:true}).catch(()=>{})}>{t('cloudSync.retry')}</button></section>;
}
