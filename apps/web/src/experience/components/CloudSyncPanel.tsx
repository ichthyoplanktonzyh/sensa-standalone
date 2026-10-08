import '../../i18n/accountResources';
import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {readCloudSync,readCloudReconnectRequired,resolveCloudSyncConflicts,type CloudSyncConflictChoice} from '../../data/library/cloudSync';
import {syncAccountLibrary} from '../../data/library/cloudSyncService';
import {observeCloudSync} from '../../data/library/store';
import {useAccountExperience} from '../account/AccountContext';
import {setupButton} from './learning/LearningSetupFrame';
export function CloudSyncPanel(){
 const {t,i18n}=useTranslation(),account=useAccountExperience();
 const [state,setState]=useState<Awaited<ReturnType<typeof readCloudSync>>>(),[busy,setBusy]=useState<CloudSyncConflictChoice|null>(null);
 const [reconnectRequired,setReconnectRequired]=useState(false);
 useEffect(()=>{let active=true,revision=0;const refresh=()=>{const current=++revision;void Promise.all([readCloudSync(),readCloudReconnectRequired()]).then(([state,paused])=>{if(active&&current===revision){setState(state);setReconnectRequired(paused);}}).catch(()=>{});};refresh();const stop=observeCloudSync(refresh);return()=>{active=false;stop();};},[]);
 const status=state?.error==='library_sync_identity'?'identity':state?.error==='library_sync_incompatible_checkpoint'?'incompatible':state?.failureKind==='terminal'?'attention':state?.status??'pending';
 const resolve=async(choice:CloudSyncConflictChoice)=>{setBusy(choice);try{await resolveCloudSyncConflicts(choice);await syncAccountLibrary();}finally{setBusy(null);}};
 const storage=state?.storage,usedMiB=storage?(storage.usedBytes/1024/1024).toFixed(1):'',capacityMiB=storage?(storage.capacityBytes/1024/1024).toFixed(0):'',storageWarning=storage&&storage.usedBytes/storage.capacityBytes>=.8;
 const records=state?.conflict?.records.map(record=>{try{const [table,key]=JSON.parse(record.id);return `${table}: ${key}`;}catch{return record.id;}})??[];
 if(!account.onlineService)return <section className="rounded-card border border-border-strong bg-surface-panel p-5"><h3 className="text-lg font-semibold">{t('cloudSync.title')}</h3><p className="mt-3 text-sm">{account.connectionConflict?account.notice:t('account.localSync')}</p>{!account.connectionConflict&&<button className={setupButton+' mt-4'} onClick={account.login}>{t('account.localWeb.login')}</button>}</section>;
 return <section className="rounded-card border border-border-strong bg-surface-panel p-5"><h3 className="text-lg font-semibold">{t('cloudSync.title')}</h3><p role="status" className="mt-3 text-sm">{t(reconnectRequired&&!state?'account.localSync':'cloudSync.'+status)}</p>
  {state?.status==='conflict'&&state.conflict&&<div className="mt-4 rounded-control border border-border-subtle bg-surface-subtle p-4 text-sm"><p>{t('cloudSync.conflictPrompt',{count:state.conflict.records.length,affected:state.conflict.affectedRecordIds.length})}</p><details className="mt-3"><summary className="cursor-pointer font-medium">{t('cloudSync.details')}</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-fg-secondary">{records.map(record=><li key={record}>{record}</li>)}</ul></details><div className="mt-4 flex flex-wrap gap-3"><button className={setupButton} disabled={busy!==null||!account.onlineService} onClick={()=>void resolve('local').catch(()=>{})}>{t(busy==='local'?'cloudSync.resolving':'cloudSync.keepLocal')}</button><button className={setupButton} disabled={busy!==null||!account.onlineService} onClick={()=>void resolve('remote').catch(()=>{})}>{t(busy==='remote'?'cloudSync.resolving':'cloudSync.useCloud')}</button></div><p className="mt-3 text-xs leading-5 text-fg-secondary">{t('cloudSync.conflictDecision')}</p></div>}
  {storage&&<p className={'mt-3 text-sm '+(storageWarning?'text-feedback-danger':'text-fg-secondary')}>{t(storageWarning?'cloudSync.storageWarning':'cloudSync.storage',{used:usedMiB,capacity:capacityMiB})}</p>}
  {state?.lastSyncedAt&&<p className="mt-2 text-sm text-fg-secondary">{t('cloudSync.last')} <time dateTime={state.lastSyncedAt}>{new Date(state.lastSyncedAt).toLocaleString(i18n.resolvedLanguage??i18n.language)}</time></p>}<button className={setupButton+' mt-4'} disabled={!account.onlineService||state?.status==='syncing'||busy!==null} onClick={()=>void syncAccountLibrary({restoreAfterLocalClear:true}).catch(()=>{})}>{t('cloudSync.retry')}</button></section>;
}
