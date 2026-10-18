import '../../../i18n/profileResources';
import {useEffect,useRef,useState} from 'react';
import {Archive,Check,Pause,Play,Plus,RotateCcw,X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {
  sensaLanguageForRole,
  sensaLanguageForDeclaredTag,
  type SensaLanguageLearningRoute,
  type SensaLanguageRouteCollection,
} from '@sensa/contracts/sensa';
import i18n from '../../../i18n';
import {interfaceLanguageDisplayName} from '../../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../../i18n/localeRegistry';
import {useLanguageRoutes, type LanguageRouteAvailability} from '../../library/useLanguageRoutes';
import {SensaOverlayLayout} from '../../ui/SensaComponents';
import {runtimePrimary} from '../learning/RuntimeFrame';

function languageNames(tag:string,interfaceLocale:string){
  const language=sensaLanguageForDeclaredTag(tag);
  if(!language)return {endonym:tag,name:tag};
  return {endonym:language.endonym,name:interfaceLanguageDisplayName(tag,resolveInterfaceLocale(interfaceLocale))};
}

export function languageSummary(collection:SensaLanguageRouteCollection,activeRoute:SensaLanguageLearningRoute,interfaceLocale:string):string{
  const locale=resolveInterfaceLocale(interfaceLocale);
  const target=languageNames(activeRoute.targetLanguageTag,locale).name;
  const support=languageNames(activeRoute.defaultSupportLanguageTag,locale).name;
  const count=collection.routes.filter(route=>route.status!=='archived').length;
  return i18n.getFixedT(locale)('languages.summary',{target,support,count});
}

interface Props {
  collection:SensaLanguageRouteCollection;
  activeRoute:SensaLanguageLearningRoute;
  availabilityFor:(targetLanguageTag:string,supportLanguageTag:string)=>LanguageRouteAvailability|undefined;
  busy:boolean;
  loadStatus?:'loading'|'ready'|'unavailable';
  onRetry?:()=>void;
  notice:string;
  onAdd:(targetLanguageTag:string,supportLanguageTag:string)=>void;
  onUpdateSupport:(routeId:string,supportLanguageTag:string)=>void;
  onArchive:(routeId:string)=>void;
  onPause:(routeId:string)=>void;
  onResume:(routeId:string)=>void;
  onRestore:(routeId:string)=>void;
  onSetActive:(routeId:string)=>void;
  onClose:()=>void;
}

export function LanguagePanel({collection,activeRoute,availabilityFor,busy,loadStatus='ready',notice,onRetry,onAdd,onUpdateSupport,onArchive,onPause,onResume,onRestore,onSetActive,onClose}:Props){
  const {t,i18n}=useTranslation();
  const [pendingTarget,setPendingTarget]=useState('');
  const [pendingSupport,setPendingSupport]=useState(activeRoute.defaultSupportLanguageTag);
  const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
  const targetLanguages=sensaLanguageForRole('target');
  const supportLanguages=sensaLanguageForRole('support');
  const visible=collection.routes.filter(route=>route.status!=='archived');
  const archived=collection.routes.filter(route=>route.status==='archived');
  const activeCount=collection.routes.filter(route=>route.status==='active').length;
  const pendingAvailability=pendingTarget&&pendingSupport?availabilityFor(pendingTarget,pendingSupport):undefined;
  const supportDefault=useRef<string|null>(null);
  useEffect(()=>{if(loadStatus!=='ready')return;const key=JSON.stringify([activeRoute.id,activeRoute.defaultSupportLanguageTag]);if(supportDefault.current!==key){supportDefault.current=key;setPendingSupport(activeRoute.defaultSupportLanguageTag);}},[loadStatus,activeRoute.id,activeRoute.defaultSupportLanguageTag]);
  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}};
    document.addEventListener('keydown',escape,true);
    return()=>document.removeEventListener('keydown',escape,true);
  },[onClose]);
  return <SensaOverlayLayout variant="sheet" measure="compact" className="sensa-language-settings z-[150]" labelledBy="languages-title" onDismiss={onClose} dismissOnBackdrop regions={{
    header: <div className="flex items-center justify-between">
        <h2 id="languages-title" className="text-lg font-medium">{t('languages.title')}</h2>
        <button autoFocus type="button" className="grid size-11 place-items-center rounded-control text-fg-secondary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus" onClick={onClose} aria-label={t('languages.close')}><X size={20}/></button>
      </div>,
    primary: <div className="space-y-7" aria-busy={loadStatus==='loading'}>
        {loadStatus==='loading'?<p role="status" className="text-sm text-fg-secondary">{t('reliability.loading')}</p>:loadStatus==='ready'?<>
        <section>
          <h3 className="text-sm font-medium">{t('languages.routes')}</h3>
          <p className="mt-2 text-xs leading-6 text-fg-tertiary">{t('languages.routesNote')}</p>
          <p className="mt-1 text-xs leading-5 text-fg-tertiary">{t('languages.availabilityNote')}</p>
          <div role="radiogroup" aria-label={t('languages.routes')} className="mt-4 space-y-3">
            {visible.map(route=>{
              const target=languageNames(route.targetLanguageTag,locale),active=route.id===activeRoute.id,routeAvailability=availabilityFor(route.targetLanguageTag,route.defaultSupportLanguageTag);
              return <article key={route.id} className="rounded-card border border-border-subtle bg-surface-panel p-4">
                <div className="flex min-h-11 items-center gap-3">
                  <button type="button" role="radio" aria-checked={active} disabled={busy||active||route.status!=='active'} onClick={()=>onSetActive(route.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                    <span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center rounded-pill border ${active?'border-action-primary bg-action-primary text-action-on-primary':'border-border-strong'}`}>{active&&<Check size={13}/>}</span>
                    <span className="min-w-0"><span className="block truncate font-medium text-action-primary">{target.endonym}</span><span className="block truncate text-xs text-fg-tertiary">{target.name}</span></span>
                    {active&&<span className="ml-auto shrink-0 rounded-pill bg-accent-soft px-2 py-0.5 text-xs text-action-primary">{t('languages.activeBadge')}</span>}
                    {route.status==='paused'&&<span className="ml-auto shrink-0 rounded-pill bg-surface-subtle px-2 py-0.5 text-xs text-fg-secondary">{t('languages.pausedBadge')}</span>}
                  </button>
                  {route.status==='active'
                    ?<button type="button" disabled={busy||activeCount<2} onClick={()=>onPause(route.id)} aria-label={t('languages.pauseLabel',{language:target.name})} className="grid size-11 shrink-0 place-items-center rounded-control text-fg-secondary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40"><Pause size={17}/></button>
                    :<button type="button" disabled={busy} onClick={()=>onResume(route.id)} aria-label={t('languages.resumeLabel',{language:target.name})} className="grid size-11 shrink-0 place-items-center rounded-control text-fg-secondary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40"><Play size={17}/></button>}
                  <button type="button" disabled={busy||(route.status==='active'&&activeCount<2)} onClick={()=>onArchive(route.id)} aria-label={t('languages.archiveLabel',{language:target.name})} className="grid size-11 shrink-0 place-items-center rounded-control text-fg-secondary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40"><Archive size={17}/></button>
                </div>
                <label className="mt-3 block text-xs text-fg-tertiary">
                  <span>{t('languages.support')}</span>
                  <select disabled={busy} value={route.defaultSupportLanguageTag} onChange={event=>onUpdateSupport(route.id,event.target.value)} className="mt-2 min-h-11 w-full rounded-control border border-border-strong bg-surface-panel px-3 text-sm text-fg-secondary focus-visible:outline-2 focus-visible:outline-focus">
                    {supportLanguages.map(language=><option key={language.tag} value={language.tag}>{language.endonym} · {interfaceLanguageDisplayName(language.tag,locale)}</option>)}
                  </select>
                </label>
                {routeAvailability&&<div className="mt-3 space-y-1 text-xs leading-5 text-fg-tertiary" aria-live="polite">
                  <p>{routeAvailability.installedPackageCount>0
                    ?t('languages.availabilityInstalled',{count:routeAvailability.installedPackageCount})
                    :t('languages.availabilityNoInstalled')}</p>
                  <p>{t(routeAvailability.personalVoiceConfigured?'languages.availabilityPersonalReady':'languages.availabilityPersonalUnavailable')}</p>
                </div>}
              </article>;
            })}
          </div>
        </section>
        <section className="border-t border-border-subtle pt-6">
          <h3 className="text-sm font-medium">{t('languages.add')}</h3>
          <div className="mt-4 space-y-3">
            <select aria-label={t('languages.targetLabel')} disabled={busy} value={pendingTarget} onChange={event=>setPendingTarget(event.target.value)} className="min-h-12 w-full rounded-control border border-border-strong bg-surface-panel px-4 text-sm text-fg-secondary focus-visible:outline-2 focus-visible:outline-focus">
              <option value="">{t('languages.targetLabel')}</option>
              {targetLanguages.map(language=><option key={language.tag} value={language.tag}>{language.endonym} · {interfaceLanguageDisplayName(language.tag,locale)}</option>)}
            </select>
            <select aria-label={t('languages.supportLabel')} disabled={busy} value={pendingSupport} onChange={event=>setPendingSupport(event.target.value)} className="min-h-12 w-full rounded-control border border-border-strong bg-surface-panel px-4 text-sm text-fg-secondary focus-visible:outline-2 focus-visible:outline-focus">
              {supportLanguages.map(language=><option key={language.tag} value={language.tag}>{language.endonym} · {interfaceLanguageDisplayName(language.tag,locale)}</option>)}
            </select>
            <button type="button" disabled={busy||!pendingTarget||!pendingSupport} onClick={()=>{onAdd(pendingTarget,pendingSupport);setPendingTarget('');}} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-border-strong bg-surface-panel px-4 text-sm text-action-primary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40"><Plus size={16}/>{t('languages.addAction')}</button>
          </div>
          <p className="mt-2 text-xs leading-6 text-fg-tertiary">{t('languages.sameLanguageNote')}</p>
          {pendingAvailability&&<div className="mt-2 space-y-1 text-xs leading-5 text-fg-tertiary" aria-live="polite">
            <p>{pendingAvailability.installedPackageCount>0
              ?t('languages.availabilityInstalled',{count:pendingAvailability.installedPackageCount})
              :t('languages.availabilityNoInstalled')}</p>
            <p>{t(pendingAvailability.personalVoiceConfigured?'languages.availabilityPersonalReady':'languages.availabilityPersonalUnavailable')}</p>
          </div>}
        </section>
        {archived.length>0&&<section className="border-t border-border-subtle pt-6">
          <h3 className="text-sm font-medium">{t('languages.archived')}</h3>
          <div className="mt-3 space-y-2">{archived.map(route=>{const target=languageNames(route.targetLanguageTag,locale);return <div key={route.id} className="flex items-center gap-3 rounded-card border border-border-subtle bg-surface-panel px-4 py-3 text-sm"><span className="min-w-0 flex-1 truncate">{target.name}</span><button type="button" disabled={busy} onClick={()=>onRestore(route.id)} className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-action-primary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus"><RotateCcw size={16}/>{t('languages.restore')}</button></div>;})}</div>
        </section>}
        </>:null}
        {notice&&<div role="status" className="rounded-control bg-accent-soft p-4 text-sm text-action-primary"><p>{notice}</p>{onRetry&&<button type="button" disabled={busy} onClick={onRetry} className="mt-3 min-h-11 underline focus-visible:outline-2 focus-visible:outline-focus">{t('reliability.retry')}</button>}</div>}
      </div>,
    controls: <button type="button" disabled={busy} className={`${runtimePrimary} w-full`} onClick={onClose}>{t('languages.done')}</button>,
  }} />;
}

export function LanguagePanelHost({onClose}:{onClose:()=>void}){
  const language=useLanguageRoutes();
  return <LanguagePanel collection={language.collection} activeRoute={language.activeRoute} availabilityFor={language.availabilityFor} busy={language.busy} loadStatus={language.loadStatus} onRetry={language.retryable?language.retry:undefined} notice={language.notice} onAdd={(target,support)=>void language.addRoute(target,support)} onUpdateSupport={(id,support)=>void language.updateSupport(id,support)} onArchive={id=>void language.setStatus(id,'archived')} onPause={id=>void language.setStatus(id,'paused')} onResume={id=>void language.setStatus(id,'active')} onRestore={id=>void language.setStatus(id,'active')} onSetActive={id=>void language.setActive(id)} onClose={onClose}/>;
}
