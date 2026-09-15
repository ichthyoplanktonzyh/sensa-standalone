import {CloudSyncPanel} from './CloudSyncPanel';
import {providerSnapshot} from '../../data/library/providers';
import {observeLibrary} from '../../data/library/store';
import {LocalDataControlPanel} from './LocalDataControlPanel';
import {LibraryBackupPanel} from './LibraryBackupPanel';
import {LocalAgentPanel} from './LocalAgentPanel';
import {useAccountExperience} from '../account/AccountExperience';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowLeft, BookOpen, SlidersHorizontal, UserRound, RefreshCw, Database, Cpu, Info, Languages, NotebookPen, Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { LearningPreferencesPanel } from './learning/LearningPreferencesPanel';
import { LanguagePanelHost, languageSummary } from './language/LanguagePanel';
import { GlossaryPanelHost } from './language/GlossaryPanel';
import { useReadingGlossary } from '../library/useReadingGlossary';
import { useLanguageRoutes } from '../library/useLanguageRoutes';
import type { LearningPolicyId } from '../../learning/runtime/policyProfiles';
import { AppearanceSettings } from '../appearance/AppearanceSettings';

interface ProfileScreenProps {
  fixedLearningPolicy?: boolean;
  active: boolean;
  account?: {email: string; pending: number; busy: boolean; onSync: () => void; onLogout: () => void};
  status?: ReactNode;
  modelSettings?: ReactNode;
  localLibrary?: boolean;
  onOpenPreferences?: () => void;
  onGoStudyPlan: () => void;
  defaultPolicy: LearningPolicyId;
  dailyNewCount: number;
  onPolicyChange: (policy: LearningPolicyId) => void;
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
  const [page, setPage] = useState<'home'|'security'|'preferences'|'models'|'agent'|'data'|'backup'|'storage'|'support'>('home');
  const openPage = (next: typeof page) => {
    setPage(next);
    requestAnimationFrame(() => { document.getElementById('s-profile')?.scrollTo(0, 0); document.getElementById('settings-heading')?.focus(); });
  };
  const [modelNames, setModelNames] = useState<string[]>([]);
  useEffect(() => {
    if (!props.localLibrary || !props.active) return;
    let live = true;
    const refresh = () => void providerSnapshot().then(({providers, settings}) => {
      if (live) setModelNames([...new Set(['teacher','content','review','reference'].map(purpose => {
        const id = settings.assignments[purpose as 'teacher'|'content'|'review'|'reference'];
        const provider = providers.find(item => item.id === id);
        return provider ? provider.name + ' · ' + provider.model : t('modelService.default');
      }))]);
    }).catch(() => { if (live) setModelNames([t('modelService.readFailed')]); });
    refresh(); const stop = observeLibrary(refresh);
    return () => {live = false; stop();};
  }, [props.active, props.localLibrary, i18n.language]);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const glossary = useReadingGlossary();
  const language = useLanguageRoutes();
  const languageNote = t('account.languagesNote');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [offlineShell,setOfflineShell]=useState(document.documentElement.dataset.offlineShell??'development');
  useEffect(()=>{const update=()=>setOfflineShell(document.documentElement.dataset.offlineShell??'development');window.addEventListener('sensa-offline-shell',update);return()=>window.removeEventListener('sensa-offline-shell',update);},[]);
  const [bytes, setBytes] = useState<number | null>(null);
  const refreshStorage = () => {
    try { setBytes(localPreviewBytes(window.localStorage)); }
    catch { setBytes(null); }
  };
  useEffect(() => {
    if (!props.active) { setPreferencesOpen(false); setLanguagesOpen(false); setGlossaryOpen(false); setPage('home'); return; }
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
  const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border-strong bg-surface-panel px-4 py-2 text-sm font-medium text-action-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50';
  const labels = {home:'account.title', security:'account.security', preferences:'account.preferences', models:'account.models', agent:'account.agent', data:'account.data', backup:'libraryBackup.title', storage:'account.storageActions', support:'account.support'};
  const row = (destination: typeof page, label: string, note: string, icon: ReactNode) => <button id={'settings-'+destination} onClick={() => openPage(destination)} className="flex min-h-24 w-full items-center gap-4 rounded-card border border-border-subtle bg-surface-panel p-5 text-left shadow-raised transition-colors hover:border-border-strong hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
    <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-control bg-surface-subtle text-action-primary">{icon}</span><span className="min-w-0 flex-1"><span className="block text-base font-medium">{t(label)}</span><span className="mt-1 block break-words text-sm leading-6 text-fg-secondary">{note}</span></span><ArrowRight aria-hidden="true" size={18} className="shrink-0 text-action-primary"/>
  </button>;
  return <section id="s-profile" className={`screen absolute inset-0 z-10 overflow-y-auto bg-surface-canvas font-product text-fg-primary ${props.active ? 'active' : 'invisible pointer-events-none'}`}>
    <main className="mx-auto max-w-[960px] px-5 py-8 sm:px-10 lg:py-12">
      {page !== 'home' && <button className={button+' mb-6'} onClick={() => openPage(page==='backup'||page==='storage'?'data':'home')}><ArrowLeft size={17}/>{t(page==='backup'||page==='storage'?'account.data':'account.title')}</button>}
      <h1 id="settings-heading" tabIndex={-1} className="mb-7 text-3xl font-medium tracking-tight outline-none">{t(labels[page])}</h1>
      {page==='home'&&<>
      <section aria-labelledby="account-identity" className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 rounded-overlay bg-surface-subtle p-6 sm:p-8">
        <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-card bg-surface-panel text-action-primary"><UserRound size={25}/></span>
        <div className="min-w-0 flex-1"><h2 id="account-identity" className="text-lg font-medium">{props.account || serviceAccount.email ? t('account.localWeb.current') : t('account.identity')}</h2><p className="mt-2 max-w-xl break-all text-sm leading-6 text-fg-secondary">{props.account?.email ?? serviceAccount.email ?? t('account.identityNote')}</p></div>
        <span className="col-start-2 w-fit rounded-pill border border-border-strong px-3 py-1.5 text-xs text-fg-secondary">{props.account||serviceAccount.onlineService ? t('account.localWeb.connected') : t('account.local')}</span>
      </section>
      <div className="mt-6 space-y-3">
        {row('security','account.security',props.account?.email ?? serviceAccount.email ?? t('account.identity'),<UserRound size={20}/>)}
        {row('preferences','account.preferences',t('account.preferencesSummary'),<SlidersHorizontal size={20}/>)}
        {props.modelSettings&&row('models','account.models',modelNames.join(' / ') || t('account.modelsSummary'),<Cpu size={20}/>)}
        {props.localLibrary&&row('agent','account.agent',t('account.agentSummary'),<Bot size={20}/>)}
        {row('data','account.data',t('account.dataSummary'),<Database size={20}/>)}
        {row('support','account.support',t('account.supportSummary'),<Info size={20}/>)}
      </div>
      </>}
      {page!=='security'&&serviceAccount.notice&&<p role="status" className="mt-4 text-sm">{serviceAccount.notice}</p>}
      {props.status}
      {props.localLibrary&&offlineShell==='failed'&&<p role="status" className="mt-3 text-sm text-fg-secondary">{t('account.localWeb.offlineFailed')}</p>}
      <div hidden={page!=='security'}>
      {!props.account&&<div className="mt-5 flex flex-wrap gap-3"><button className="min-h-11 rounded-control bg-surface-subtle px-5 text-sm" onClick={serviceAccount.login}>{serviceAccount.onlineService?t('account.localWeb.check'):t('account.localWeb.login')}</button>{serviceAccount.email&&<button className="min-h-11 rounded-control border border-border-subtle px-5 text-sm" onClick={()=>void serviceAccount.logout().catch(()=>{})}>{t('account.localWeb.logout')}</button>}</div>}
      {!props.account&&serviceAccount.notice&&<p role="status" className="mt-3 text-sm">{serviceAccount.notice}</p>}

      {props.account && <div className="mt-8 flex flex-wrap gap-3"><button className="min-h-11 rounded-control border border-border-subtle px-5 text-sm" disabled={props.account.busy || props.account.pending > 0} onClick={props.account.onLogout}>{t('account.localWeb.signout')}</button>{props.account.pending > 0 && <p className="w-full text-sm text-fg-secondary">{t('account.localWeb.pendingLogout')}</p>}</div>}
      {props.localLibrary&&<div className="mt-12 border-t border-border-subtle pt-6"><button className={button+' border-feedback-danger text-feedback-danger'} onClick={serviceAccount.deleteAccount}>{t('localFlow.deleteTitle')}</button></div>}
      </div>
      <div hidden={page!=='preferences'}>
        <section aria-labelledby="account-preferences">
          <h2 id="account-preferences" className="mb-4 text-lg font-medium">{t('account.preferences')}</h2>
          <div className="space-y-5">
          <AppearanceSettings/>
          <div className="divide-y divide-border-subtle rounded-card border border-border-subtle bg-surface-panel px-5 sm:px-6">
            <div className="flex min-h-20 flex-wrap items-center justify-between gap-3 py-3"><span className="text-sm">{t('account.language')}</span><LanguageSwitch/></div>
            <button id="account-languages" onClick={() => setLanguagesOpen(true)} className="flex min-h-24 w-full items-center gap-4 py-5 text-left hover:text-action-primary focus-visible:outline-2 focus-visible:outline-focus">
              <Languages size={19} className="shrink-0 text-fg-tertiary"/><span className="flex-1"><span className="block text-sm font-medium">{t('account.languages')}</span><span className="mt-1 block text-xs leading-5 text-fg-tertiary">{language.saved ? languageSummary(language.collection,language.activeRoute,i18n.language) : languageNote}</span></span><ArrowRight size={17}/>
            </button>
            <button id="account-glossary" onClick={() => setGlossaryOpen(true)} className="flex min-h-24 w-full items-center gap-4 py-5 text-left hover:text-action-primary focus-visible:outline-2 focus-visible:outline-focus">
              <NotebookPen size={19} className="shrink-0 text-fg-tertiary"/><span className="flex-1"><span className="block text-sm font-medium">{t('glossary.row')}</span><span className="mt-1 block text-xs leading-5 text-fg-tertiary">{glossary.saved ? (glossary.glossary.length > 0 ? t('glossary.rowSummary',{count:glossary.glossary.length}) : t('glossary.rowEmpty')) : t('glossary.rowNote')}</span></span><ArrowRight size={17}/>
            </button>
            <button id="account-learning-preferences" onClick={() => props.onOpenPreferences ? props.onOpenPreferences() : setPreferencesOpen(true)} className="flex min-h-24 w-full items-center gap-4 py-5 text-left hover:text-action-primary focus-visible:outline-2 focus-visible:outline-focus">
              <SlidersHorizontal size={19} className="shrink-0 text-fg-tertiary"/><span className="flex-1"><span className="block text-sm font-medium">{t('account.learning')}</span><span className="mt-1 block text-xs leading-5 text-fg-tertiary">{t(props.fixedLearningPolicy?'account.dailyLearningNote':'account.learningNote')}</span></span><ArrowRight size={17}/>
            </button>
            <button onClick={props.onGoStudyPlan} className="flex min-h-24 w-full items-center gap-4 py-5 text-left hover:text-action-primary focus-visible:outline-2 focus-visible:outline-focus">
              <BookOpen size={19} className="shrink-0 text-fg-tertiary"/><span className="flex-1"><span className="block text-sm font-medium">{t('account.plan')}</span><span className="mt-1 block text-xs leading-5 text-fg-tertiary">{t('account.planNote')}</span></span><ArrowRight size={17}/>
            </button>
          </div>
          </div>
        </section>
      </div>
      <div hidden={page!=='data'}>
      {props.account&&<div className="mb-5"><button className="min-h-11 rounded-control bg-surface-subtle px-5 text-sm text-action-primary" disabled={props.account.busy} onClick={props.account.onSync}>{t('account.localWeb.syncResults')}</button></div>}
        <section aria-labelledby="account-data">
          <h2 id="account-data" className="mb-4 text-lg font-medium">{t('account.data')}</h2>
          <div className="rounded-card border border-border-subtle bg-surface-panel px-5 sm:px-6">
            <dl className="divide-y divide-border-subtle text-sm">
              <div className="flex flex-wrap justify-between gap-3 py-5"><dt>{t('account.network')}</dt><dd aria-live="polite" className="text-fg-secondary">{t(online ? 'account.online' : 'account.offline')}</dd></div>
              {!props.localLibrary&&<div className="flex flex-wrap justify-between gap-3 py-5"><dt>{t('account.sync')}</dt><dd className="text-fg-tertiary">{props.account ? (props.account.pending ? t('account.localWeb.pending',{count:props.account.pending}) : t('account.localWeb.synced')) : t('account.localSync')}</dd></div>}
              {!props.account&&!props.localLibrary && <div className="py-5"><dt>{t('account.storage')}</dt><dd className="mt-2 flex items-center justify-between gap-3"><span className="text-2xl tabular-nums" aria-live="polite">{usage}</span><button aria-label={t('account.refresh')} onClick={refreshStorage} className="grid size-11 place-items-center rounded-control text-fg-secondary hover:bg-surface-subtle"><RefreshCw size={17}/></button></dd></div>}
            </dl>
            <p className="pb-5 text-xs leading-6 text-fg-tertiary">{props.account ? t('account.localWeb.cloudNote') : props.localLibrary ? t('account.localWeb.localNote') : t('account.storageNote')}</p>
          </div>
          {!props.localLibrary&&<p className="mt-3 text-xs leading-6 text-fg-tertiary">{props.account?t('account.localWeb.controls'):t('account.controls')}</p>}
        </section>
        {props.localLibrary&&<div className="mt-6 space-y-3">
          <CloudSyncPanel/>
          {row('backup','libraryBackup.title',t('account.backupSummary'),<Database size={20}/>)}
          {row('storage','account.storageActions',t('account.storageSummary'),<Database size={20}/>)}
        </div>}
      </div>
      {props.localLibrary&&<><div hidden={page!=='backup'}><LibraryBackupPanel/></div><div hidden={page!=='storage'}><LocalDataControlPanel/></div></>}
      <section hidden={page!=='models'} aria-label={t('modelService.title')}>{props.modelSettings}</section>
      {props.localLibrary&&page==='agent'&&<LocalAgentPanel/>}
      <div hidden={page!=='support'}>
      <section aria-labelledby="account-support" className="mt-10">
        <h2 id="account-support" className="mb-4 text-lg font-medium">{t('account.support')}</h2>
        <div className="divide-y divide-border-subtle border-y border-border-subtle">
          {(['about', 'privacy', 'feedback'] as const).map(key => <details key={key} className="group py-1">
            <summary className="cursor-pointer py-5 text-sm font-medium marker:text-fg-tertiary">{t('account.' + key)}</summary>
            <p className="max-w-2xl pb-5 text-sm leading-7 text-fg-secondary">{props.account && key === 'privacy' ? t('account.localWeb.privacy') : props.localLibrary&&key==='privacy'?t('account.localWeb.localNote'):t('account.' + key + 'Text')}</p>
          </details>)}
        </div>
      </section>
      </div>
    </main>
    {props.active && preferencesOpen && <LearningPreferencesPanel fixedPolicy={props.fixedLearningPolicy} defaultPolicy={props.defaultPolicy} dailyNewCount={props.dailyNewCount} onPolicyChange={props.onPolicyChange} onDailyNewCountChange={props.onDailyNewCountChange} onClose={closePreferences} closeLabel={t('account.done')}/>}
    {props.active && languagesOpen && <LanguagePanelHost onClose={() => setLanguagesOpen(false)}/>}
    {props.active && glossaryOpen && <GlossaryPanelHost onClose={() => setGlossaryOpen(false)}/>}
  </section>;
};
