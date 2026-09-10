import {LocalDataControlPanel} from './LocalDataControlPanel';
import {LibraryBackupPanel} from './LibraryBackupPanel';
import {useAccountExperience} from '../account/AccountExperience';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, BookOpen, SlidersHorizontal, UserRound, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { LearningPreferencesPanel } from './learning/LearningPreferencesPanel';
import type { PrototypeLearningPolicy } from '../learningJourney/prototypeLearning';

interface ProfileScreenProps {
  fixedLearningPolicy?: boolean;
  active: boolean;
  account?: {email: string; pending: number; busy: boolean; onSync: () => void; onLogout: () => void};
  status?: ReactNode;
  modelSettings?: ReactNode;
  localLibrary?: boolean;
  onOpenPreferences?: () => void;
  onGoStudyPlan: () => void;
  defaultPolicy: PrototypeLearningPolicy;
  dailyNewCount: number;
  onPolicyChange: (policy: PrototypeLearningPolicy) => void;
  onDailyNewCountChange: (count: number) => void;
}

/** Only the current preview's namespace; other applications and media are excluded. */
export function localPreviewBytes(storage: Storage): number {
  let bytes = 0;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key && (key.startsWith('sensa:web-ui:v1:') || key === 'sensa:interface-language:v1')) {
      bytes += (key.length + (storage.getItem(key)?.length ?? 0)) * 2;
    }
  }
  return bytes;
}

export const ProfileScreen = (props: ProfileScreenProps) => {
  const { t, i18n } = useTranslation();
  const serviceAccount=useAccountExperience();
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [offlineShell,setOfflineShell]=useState(document.documentElement.dataset.offlineShell??'development');
  useEffect(()=>{const update=()=>setOfflineShell(document.documentElement.dataset.offlineShell??'development');window.addEventListener('sensa-offline-shell',update);return()=>window.removeEventListener('sensa-offline-shell',update);},[]);
  const [bytes, setBytes] = useState<number | null>(null);
  const refreshStorage = () => {
    try { setBytes(localPreviewBytes(window.localStorage)); }
    catch { setBytes(null); }
  };
  useEffect(() => {
    if (!props.active) { setPreferencesOpen(false); return; }
    if (!props.account&&!props.localLibrary) refreshStorage();
    const updateNetwork = () => setOnline(navigator.onLine);
    updateNetwork();
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    if (!props.account) window.addEventListener('storage', refreshStorage);
    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
      window.removeEventListener('storage', refreshStorage);
    };
  }, [props.active, i18n.language]);
  const closePreferences = () => {
    setPreferencesOpen(false);
    refreshStorage();
    requestAnimationFrame(() => document.getElementById('account-learning-preferences')?.focus());
  };
  const usage = bytes === null ? t('account.unknown') : new Intl.NumberFormat(i18n.language, {
    style: 'unit', unit: bytes >= 1024 * 1024 ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1,
  }).format(bytes / (bytes >= 1024 * 1024 ? 1024 * 1024 : 1024));
  return <section id="s-profile" className={`screen absolute inset-0 z-10 overflow-y-auto bg-[#fbfbfa] text-[#222631] ${props.active ? 'active' : 'invisible pointer-events-none'}`}>
    <main className="mx-auto max-w-[1280px] px-6 py-8 sm:px-10 lg:px-14 lg:py-14">
      <h1 className="mb-10 text-3xl font-medium tracking-tight lg:text-4xl">{t('account.title')}</h1>
      <section aria-labelledby="account-identity" className="flex flex-wrap items-center gap-5 rounded-3xl bg-[#edf0f7] p-6 sm:p-8">
        <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white text-[#5268a9]"><UserRound size={25}/></span>
        <div className="min-w-0 flex-1"><h2 id="account-identity" className="text-lg font-medium">{props.account || serviceAccount.email ? t('account.localWeb.current') : t('account.identity')}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[#68748d]">{props.account?.email ?? serviceAccount.email ?? t('account.identityNote')}</p></div>
        <span className="rounded-full border border-[#cfd7e6] px-3 py-1.5 text-xs text-[#546582]">{props.account||serviceAccount.onlineService ? t('account.localWeb.connected') : t('account.local')}</span>
      </section>
      {!props.account&&<div className="mt-5 flex flex-wrap gap-3"><button className="min-h-11 rounded-xl bg-[#edf0f7] px-5 text-sm" onClick={serviceAccount.login}>{serviceAccount.onlineService?t('account.localWeb.check'):t('account.localWeb.login')}</button>{serviceAccount.email&&<button className="min-h-11 rounded-xl border px-5 text-sm" onClick={()=>void serviceAccount.logout().catch(()=>{})}>{t('account.localWeb.logout')}</button>}</div>}
      {!props.account&&serviceAccount.notice&&<p role="status" className="mt-3 text-sm">{serviceAccount.notice}</p>}
      {props.status}
      {props.localLibrary&&offlineShell==='failed'&&<p role="status" className="mt-3 text-sm text-[#68748d]">{t('account.localWeb.offlineFailed')}</p>}
      <div className="mt-9 grid items-start gap-8 lg:grid-cols-2">
        <section aria-labelledby="account-preferences">
          <h2 id="account-preferences" className="mb-4 text-lg font-medium">{t('account.preferences')}</h2>
          <div className="divide-y divide-[#e3e5ea] rounded-2xl border border-[#e3e5ea] bg-white px-5 sm:px-6">
            <div className="flex min-h-20 flex-wrap items-center justify-between gap-3 py-3"><span className="text-sm">{t('account.language')}</span><LanguageSwitch/></div>
            <button id="account-learning-preferences" onClick={() => props.onOpenPreferences ? props.onOpenPreferences() : setPreferencesOpen(true)} className="flex min-h-24 w-full items-center gap-4 py-5 text-left hover:text-[#5268a9] focus-visible:outline-2 focus-visible:outline-[#5268a9]">
              <SlidersHorizontal size={19} className="shrink-0 text-[#788398]"/><span className="flex-1"><span className="block text-sm font-medium">{t('account.learning')}</span><span className="mt-1 block text-xs leading-5 text-[#788398]">{t('account.learningNote')}</span></span><ArrowRight size={17}/>
            </button>
            <button onClick={props.onGoStudyPlan} className="flex min-h-24 w-full items-center gap-4 py-5 text-left hover:text-[#5268a9] focus-visible:outline-2 focus-visible:outline-[#5268a9]">
              <BookOpen size={19} className="shrink-0 text-[#788398]"/><span className="flex-1"><span className="block text-sm font-medium">{t('account.plan')}</span><span className="mt-1 block text-xs leading-5 text-[#788398]">{t('account.planNote')}</span></span><ArrowRight size={17}/>
            </button>
          </div>
        </section>
        <section aria-labelledby="account-data">
          <h2 id="account-data" className="mb-4 text-lg font-medium">{t('account.data')}</h2>
          <div className="rounded-2xl border border-[#e3e5ea] bg-white px-5 sm:px-6">
            <dl className="divide-y divide-[#e3e5ea] text-sm">
              <div className="flex flex-wrap justify-between gap-3 py-5"><dt>{t('account.network')}</dt><dd aria-live="polite" className="text-[#68748d]">{t(online ? 'account.online' : 'account.offline')}</dd></div>
              <div className="flex flex-wrap justify-between gap-3 py-5"><dt>{t('account.sync')}</dt><dd className="text-[#788398]">{props.account ? (props.account.pending ? t('account.localWeb.pending',{count:props.account.pending}) : t('account.localWeb.synced')) : t('account.unavailable')}</dd></div>
              {!props.account&&!props.localLibrary && <div className="py-5"><dt>{t('account.storage')}</dt><dd className="mt-2 flex items-center justify-between gap-3"><span className="text-2xl tabular-nums" aria-live="polite">{usage}</span><button aria-label={t('account.refresh')} onClick={refreshStorage} className="grid size-11 place-items-center rounded-lg text-[#68748d] hover:bg-[#edf0f7]"><RefreshCw size={17}/></button></dd></div>}
            </dl>
            <p className="pb-5 text-xs leading-6 text-[#788398]">{props.account ? t('account.localWeb.cloudNote') : props.localLibrary ? t('account.localWeb.localNote') : t('account.storageNote')}</p>
          </div>
          {!props.localLibrary&&<p className="mt-3 text-xs leading-6 text-[#788398]">{props.account?t('account.localWeb.controls'):t('account.controls')}</p>}
        </section>
      </div>
      {props.account && <div className="mt-8 flex flex-wrap gap-3"><button className="min-h-11 rounded-xl bg-[#edf0f7] px-5 text-sm text-[#303f76]" disabled={props.account.busy} onClick={props.account.onSync}>{t('account.localWeb.syncResults')}</button><button className="min-h-11 rounded-xl border border-[#e3e5ea] px-5 text-sm" disabled={props.account.busy || props.account.pending > 0} onClick={props.account.onLogout}>{t('account.localWeb.signout')}</button>{props.account.pending > 0 && <p className="w-full text-sm text-[#68748d]">{t('account.localWeb.pendingLogout')}</p>}</div>}
      {props.localLibrary&&<><LibraryBackupPanel/><LocalDataControlPanel/></>}
      {props.modelSettings&&<section aria-label={t('modelService.title')} className="mt-10">{props.modelSettings}</section>}
      <section aria-labelledby="account-support" className="mt-10">
        <h2 id="account-support" className="mb-4 text-lg font-medium">{t('account.support')}</h2>
        <div className="divide-y divide-[#e3e5ea] border-y border-[#e3e5ea]">
          {(['about', 'privacy', 'feedback'] as const).map(key => <details key={key} className="group py-1">
            <summary className="cursor-pointer py-5 text-sm font-medium marker:text-[#788398]">{t('account.' + key)}</summary>
            <p className="max-w-2xl pb-5 text-sm leading-7 text-[#68748d]">{props.account && key === 'privacy' ? t('account.localWeb.privacy') : props.localLibrary&&key==='privacy'?t('account.localWeb.localNote'):t('account.' + key + 'Text')}</p>
          </details>)}
        </div>
      </section>
    </main>
    {props.active && preferencesOpen && <LearningPreferencesPanel fixedPolicy={props.fixedLearningPolicy} defaultPolicy={props.defaultPolicy} dailyNewCount={props.dailyNewCount} onPolicyChange={props.onPolicyChange} onDailyNewCountChange={props.onDailyNewCountChange} onClose={closePreferences} closeLabel={t('account.done')}/>}
  </section>;
};
