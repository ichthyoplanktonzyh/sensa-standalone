import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {readCloudSync} from '../../data/library/cloudSync';
import {syncAccountLibrary} from '../../data/library/cloudSyncService';
import {observeLibrary} from '../../data/library/store';
import {useAccountExperience} from '../account/AccountExperience';
import {setupButton} from './learning/LearningSetupFrame';
export function CloudSyncPanel(){
 const {t,i18n}=useTranslation(),account=useAccountExperience();
 const [state,setState]=useState<Awaited<ReturnType<typeof readCloudSync>>>();
 useEffect(()=>{const refresh=()=>{void readCloudSync().then(setState).catch(()=>{});};refresh();return observeLibrary(refresh);},[]);
 const status=state?.error==='library_sync_identity'?'identity':state?.status??'pending';
 return <section className="rounded-2xl border border-[#bec5d5] bg-white p-5"><h3 className="text-lg font-semibold">{t('cloudSync.title')}</h3><p role="status" className="mt-3 text-sm">{t('cloudSync.'+status)}</p>{state?.lastSyncedAt&&<p className="mt-2 text-sm text-[#68748d]">{t('cloudSync.last')} <time dateTime={state.lastSyncedAt}>{new Date(state.lastSyncedAt).toLocaleString(i18n.resolvedLanguage??i18n.language)}</time></p>}<button className={setupButton+' mt-4'} disabled={!account.onlineService||state?.status==='syncing'} onClick={()=>void syncAccountLibrary().catch(()=>{})}>{t('cloudSync.retry')}</button></section>;
}
