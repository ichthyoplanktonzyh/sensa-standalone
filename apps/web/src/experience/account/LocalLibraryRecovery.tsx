import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice,localFlowErrorKey} from '../../i18n/localFlowText';
import {LibraryBackupPanel} from '../components/LibraryBackupPanel';
import {setupButton} from '../components/learning/LearningSetupFrame';
import {SensaLogo} from '../brand/SensaLogo';
import {LanguageSwitch} from '../../i18n/LanguageSwitch';

/** Recovery and explicit fresh start are separate intents, outside learner-fact screens. */
export default function LocalLibraryRecovery({onLogin,notice='localFlow.libraryMissing'}:{onLogin:()=>void;notice?:string}){
 const {t}=useTranslation();const [busy,setBusy]=useState(false),[confirmStart,setConfirmStart]=useState(false),[error,setError]=useState('');
 const start=async()=>{setBusy(true);setError('');try{await import('../../data/library/startSeparateLocalLibrary').then(module=>module.startSeparateLocalLibrary());location.assign('/');}catch(cause){setError(localFlowErrorKey(cause,'localFlow.storageOpen'));setBusy(false);}};
 return <main className="min-h-screen bg-surface-canvas px-6 py-10 font-product text-fg-primary"><div className="mx-auto max-w-2xl">
  <div className="mb-10 flex items-center justify-between"><SensaLogo/><LanguageSwitch/></div>
  <h1 className="text-3xl font-medium">{localFlowText('libraryRecovery')}</h1>
  <p role="alert" className="mt-4 text-sm leading-6">{localFlowNotice(notice)}</p>
  <div className="mt-6 flex flex-wrap gap-3"><button className={setupButton} disabled={busy} onClick={()=>location.reload()}>{t('libraryBackup.reopen')}</button><button className={setupButton} disabled={busy} onClick={onLogin}>{localFlowText('libraryRecoveryLogin')}</button></div>
  {!confirmStart&&<LibraryBackupPanel restoreOnly onBusyChange={setBusy}/>}
  <div className="mt-6 border-t border-border-subtle pt-6">{confirmStart?<>
   <p className="text-sm leading-6">{localFlowText('libraryRestartConfirm')}</p>
   <div className="mt-4 flex flex-wrap gap-3"><button className={setupButton} disabled={busy} onClick={()=>void start()}>{localFlowText('libraryCreateSeparate')}</button><button className={setupButton} disabled={busy} onClick={()=>{setError('');setConfirmStart(false);}}>{localFlowText('cancel')}</button></div>
  </>:<button className={setupButton} disabled={busy} onClick={()=>setConfirmStart(true)}>{localFlowText('libraryRestart')}</button>}
  {error&&<p role="alert" className="mt-4 text-sm">{localFlowNotice(error)}</p>}</div>
 </div></main>;
}
