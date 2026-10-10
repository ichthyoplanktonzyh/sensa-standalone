import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {SensaWorkspacePageLayout} from '../ui/SensaPageLayouts';
import {setupPrimary,setupButton} from '../components/learning/LearningSetupFrame';

/** Initial account restoration is unknown, not an empty learner inventory.
 * Keep the shell/settings usable without mounting fact screens or planners. */
export function LibraryRestorationScreen({id,active,failed,onRetry,onSettings}:{id:string;active:boolean;failed:boolean;onRetry:()=>Promise<void>;onSettings:()=>void}){
 const {t}=useTranslation();const [busy,setBusy]=useState(false);
 const retry=async()=>{if(busy)return;setBusy(true);try{await onRetry();}finally{setBusy(false);}};
 return <SensaWorkspacePageLayout id={id} className={`screen z-10 ${active?'active':'invisible pointer-events-none'}`} measure="standard" regions={{
  header:<h1 className="text-2xl font-medium text-fg-primary">{t('cloudSync.restoreTitle')}</h1>,
  primary:<div role={failed?'alert':'status'} aria-busy={!failed} className="space-y-5"><p className="text-sm leading-6 text-fg-secondary">{t(failed?'cloudSync.openFailed':'cloudSync.opening')}</p><div className="flex flex-wrap gap-3">{failed&&<button className={setupPrimary} disabled={busy} onClick={()=>void retry()}>{t('cloudSync.retryOpen')}</button>}<button className={setupButton} onClick={onSettings}>{t('account.title')}</button></div></div>,
 }}/>;
}
