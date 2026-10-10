import {maxPortableBookArchiveBytes} from '@sensa/contracts/sensa';
import type {SensaPortableBookPackage} from '@sensa/content-validator/portable-book';
import {
 ArrowRight,
 BookOpen,
 Check,
 Compass,
 Download,
 FileCheck2,
 LibraryBig,
 RefreshCw,
 Search,
 ShieldCheck,
 Upload,
} from 'lucide-react';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';

import {localFlowNotice,localFlowText} from '../../i18n/localFlowText';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale,type InterfaceLocale} from '../../i18n/localeRegistry';
import {useAccountExperience} from '../account/AccountContext';
import {LearningSetupFrame,setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {useScreenState} from '../ui/ScreenHost';
import {downloadPortablePackage} from './portableDownload';
import type {usePackageLearning} from './usePackageLearning';
import {
 buildPackageCenterItems,
 indexPackageTargets,
 projectPackageContentWindow,
 projectPackageMetadata,
 projectPackageSource,
 type PackageCenterItem,
} from './packageCenterProjection';
import type {ShellParams} from '../router/screenRegistry';
import {browseCatalog,catalogBrowsingParams,parseCatalogBrowsing,type CatalogBrowsing} from './packageCatalogBrowsing';
import {CatalogPagination,PackageCards,PackageRoute,PackageStatus,packageItemState as itemState} from './PackageCenterParts';

type Controller=ReturnType<typeof usePackageLearning>;

const routeNames=(items:readonly PackageCenterItem[],locale:InterfaceLocale)=>new Map(
 [...new Set(items.flatMap(item=>[item.targetLanguage,item.supportLanguage]))]
  .map(tag=>[tag,interfaceLanguageDisplayName(tag,locale)] as const),
);

function CenterNavigation({current,onCatalog,onLibrary,onPublisher}:{
 current:'catalog'|'library'|'publisher';
 onCatalog:()=>void;
 onLibrary:()=>void;
 onPublisher:()=>void;
}){
 const {publisherAccess}=useAccountExperience();
 const items=[
  {id:'catalog' as const,label:localFlowText('packageCenterCatalog'),icon:Compass,action:onCatalog},
  {id:'library' as const,label:localFlowText('packageCenterLibrary'),icon:LibraryBig,action:onLibrary},
  ...(publisherAccess?[{id:'publisher' as const,label:localFlowText('packageCenterPublisher'),icon:ShieldCheck,action:onPublisher}]:[]),
 ];
 return <nav aria-label={localFlowText('packageCatalogTitle')} className="mb-5 flex flex-wrap gap-2">
  {items.map(({id,label,icon:Icon,action})=><button
   key={id}
   type="button"
   aria-current={current===id?'page':undefined}
   className={`${setupButton} ${current===id?'border-action-primary bg-accent-soft text-action-primary underline underline-offset-4':''}`}
   onClick={action}
  ><Icon size={17}/>{label}</button>)}
 </nav>;
}

function PackageDetail({active,item,c,onBack,onLearning,onTarget,screenId='s-catalog-book',referenceOnly=false}:{
 screenId?:string;
 active:boolean;
 item:PackageCenterItem|undefined;
 c:Controller;
 onBack:()=>void;
 onLearning:()=>void;
 onTarget:(id:string)=>void;
 referenceOnly?:boolean;
}){
 const {t,i18n}=useTranslation();
 const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
 const actionInFlight=useRef(false);
 const [contentWindow,setContentWindow]=useScreenState('package-detail:content-window',{itemKey:'',limit:3});
 const contentLimit=item&&contentWindow.itemKey===item.listKey?contentWindow.limit:3;
 const targetByEntry=useMemo(()=>indexPackageTargets(c.targets),[c.targets]);
 const contentProjection=useMemo(()=>item
  ?projectPackageContentWindow(item.installed,targetByEntry,contentLimit)
  :{entries:[],total:0},[item?.installed,targetByEntry,contentLimit]);
 const metadata=useMemo(()=>item?projectPackageMetadata(item):null,[item]);
 const retryDetail=()=>{
  if(referenceOnly||c.loadStatus==='unavailable')void c.retryInitialLoad();
  if(!referenceOnly)void c.reloadCatalog(true);
 };
 if(!item||!metadata)return <LearningSetupFrame id={screenId} active={active} onBack={onBack} title={localFlowText('packageCatalogTitle')}>
  {c.loadStatus==='unavailable'||c.catalogStatus==='unavailable'||c.catalogFailed?<PackageStatus error onRetry={retryDetail}>{c.loadStatus==='unavailable'?c.notice||localFlowText('learningReadFailed'):localFlowText('catalogFailed')}</PackageStatus>:!c.loaded||c.catalogBusy?<PackageStatus>{t('reliability.loading')}</PackageStatus>:<PackageStatus onRetry={retryDetail}>{referenceOnly?t('reliability.errorTitle'):localFlowText('packageNoResults')}</PackageStatus>}
 </LearningSetupFrame>;
 const installedEntryCount=contentProjection.total,installedEntries=contentProjection.entries;
 const installing=c.installation?.bookKey===item.key?c.installation:null;
 const enrollInstalled=()=>{
  if(c.busy||actionInFlight.current||!item.routeMatchesActive||!item.installed.length)return;
  actionInFlight.current=true;
  void (item.publicationArchiveSha256?c.enrollBook(item.publicationArchiveSha256):c.enroll(item.installed[0]!.key))
   .finally(()=>{actionInFlight.current=false;});
 };
 const hasLatest=!!item.installed.length&&(!item.updateAvailable||item.updateDownloaded);
 const downloadDisabled=!c.loaded||c.busy||c.catalogBusy||hasLatest;
 const enrollmentDisabled=!c.loaded||c.busy||!item.installed.length
  ||(!item.routeMatchesActive&&!item.enrolled)||(item.updateAvailable&&!item.updateDownloaded);
 const routeMismatch=item.installed.length>0&&!item.enrolled&&!item.routeMatchesActive;
 const redundantRouteNotice=routeMismatch&&[localFlowText('routeLanguageMismatch'),localFlowText('routeSupportMismatch')].includes(c.notice);
 const safeLink=(value:string|undefined)=>{try{const url=new URL(value??'');return ['http:','https:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}};
 return <LearningSetupFrame id={screenId} active={active} onBack={onBack} title={localFlowText('packageCatalogTitle')}>
  <div className="mb-5 space-y-3">
   {c.loaded?<span className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-action-primary">{item.enrolled?<Check size={16}/>:<BookOpen size={16}/>} {itemState(item,c.installation,c.progress)}</span>:<span role="status" aria-label={t('reliability.loading')} className="inline-block h-9 w-24 animate-pulse rounded-lg bg-surface-subtle"/>}
   <h1 className="break-words text-3xl font-medium tracking-tight outline-none">{item.title}</h1>
   {item.description&&<p className="max-w-3xl break-words text-sm leading-6 text-fg-secondary">{item.description}</p>}
   <PackageRoute target={item.targetLanguage} support={item.supportLanguage}/>
   <p className="text-sm text-fg-secondary">{localFlowText('packageExpressionCount',{count:item.count})}</p>
  </div>
  <section aria-label={localFlowText('packagePublication')} className="mb-5 rounded-xl border border-border-subtle bg-surface-panel p-4 sm:p-5">
   <dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-3">
    {metadata.publisher&&<div><dt className="text-fg-secondary">{localFlowText('packagePublisher')}</dt><dd className="mt-1 break-words">{metadata.publisher.name}</dd></div>}
    {metadata.version!==undefined&&<div><dt className="text-fg-secondary">{localFlowText('packageVersion')}</dt><dd className="mt-1">v{metadata.version}</dd></div>}
    {metadata.publishedAt&&<div><dt className="text-fg-secondary">{localFlowText('packagePublishedAt')}</dt><dd className="mt-1"><time dateTime={metadata.publishedAt}>{new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(new Date(metadata.publishedAt))}</time></dd></div>}
   </dl>
   {metadata.changeSummary&&<div className="mt-4 border-t border-border-subtle pt-3"><h2 className="text-sm font-medium">{localFlowText('packageUpdateSummary')}</h2><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-fg-secondary">{metadata.changeSummary}</p></div>}
  </section>
  {!referenceOnly&&<section aria-label={localFlowText('packageActions')} className="mb-5 space-y-3 rounded-xl border border-border-strong bg-surface-panel p-4 sm:p-5">
   {c.loadStatus==='unavailable'?<PackageStatus error onRetry={()=>void c.retryInitialLoad()}>{c.notice}</PackageStatus>:c.notice&&!redundantRouteNotice&&<PackageStatus error={c.downloadFailed}>{localFlowNotice(c.notice)}</PackageStatus>}
   {routeMismatch&&<PackageStatus>{localFlowText('packageRouteMismatchHint')}</PackageStatus>}
   {item.updateAvailable&&<p className="text-sm leading-6 text-fg-secondary">{localFlowText(item.updateDownloaded?'packageUpdateDownloadedHint':'packageUpdateHint')}</p>}
   {c.loadStatus==='unavailable'?null:!c.loaded?<PackageStatus>{t('reliability.loading')}</PackageStatus>:installing?<>
    <p role="status" className="text-sm">{installing.phase==='committing'?t('composer.saving'):installing.phase==='preparing'?localFlowText('batchWorking'):`${localFlowText('downloading')}${c.progress??0}%`}</p>
    {installing.phase==='downloading'&&<progress aria-label={localFlowText('downloadPackage')} max={100} value={c.progress??0} className="h-2 w-full accent-action-primary"/>}
    {installing.phase!=='committing'&&<button type="button" className={setupButton} onClick={c.cancelDownload}>{localFlowText('cancelDownload')}</button>}
   </>:<div className="flex flex-wrap gap-3">
    {item.descriptor&&<button type="button" className={hasLatest?setupButton:setupPrimary} disabled={downloadDisabled} aria-describedby={`${screenId}-download-hint`} onClick={()=>{if(item.descriptor)void c.download(item.descriptor);}}><Download size={18}/>{localFlowText(hasLatest?'packageDownloadedAction':item.updateAvailable?'downloadPackageUpdate':'downloadPackage')}</button>}
    <button type="button" className={item.installed.length?setupPrimary:setupButton} disabled={enrollmentDisabled} onClick={item.enrolled?onLearning:enrollInstalled}>
     {item.enrolled?<ArrowRight size={18}/>:<Check size={18}/>}{localFlowText(c.busy?'processing':item.updateAvailable?'applyPackageUpdate':item.enrolled?'packageGoLearning':'enroll')}
    </button>
    {item.installed.length===1&&<button type="button" className={setupButton} disabled={c.busy} onClick={()=>void c.exportPackage(item.installed[0]!.key).then(result=>{if(result)downloadPortablePackage(result);})}><Download size={18}/>{localFlowText('exportPortablePackage')}</button>}
   </div>}
   <p id={`${screenId}-download-hint`} className="text-sm leading-6 text-fg-secondary">{localFlowText('packageDownloadHint')}</p>
  </section>}
  {!!item.installed.length&&<section aria-label={localFlowText('packageSource')} className="mb-5 rounded-xl border border-border-subtle bg-surface-panel p-4 sm:p-5">
   <p className="mb-3 text-sm text-fg-secondary">{localFlowText('packageInstalledVersion',{version:metadata.installedVersion})}</p>
   <dl className="grid gap-3 text-sm sm:grid-cols-2">{[
    {label:localFlowText('packageAuthor'),values:metadata.authors},
    {label:localFlowText('packageLicense'),values:metadata.licenses},
   ].filter(group=>group.values.length).map(group=><div key={group.label}><dt className="text-fg-secondary">{group.label}</dt><dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{group.values.map(value=><span key={JSON.stringify(value)} className="break-words">{safeLink(value.url)?<a href={safeLink(value.url)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-focus">{value.name}</a>:value.name}</span>)}</dd></div>)}</dl>
  </section>}
  <section aria-label={localFlowText('packageContents')}>
   <h2 className="mb-3 text-lg font-medium">{localFlowText('packageContents')}</h2>
   {installedEntries.length>0&&<p className="mb-3 text-sm text-fg-secondary">{localFlowText('packageSampleVersion',{version:metadata.installedVersion})}</p>}
   {c.loadStatus==='unavailable'?null:!c.loaded?<div role="status" aria-label={t('reliability.loading')} className="h-40 animate-pulse rounded-2xl bg-surface-subtle"/>:installedEntries.length?<><ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-surface-panel">{installedEntries.map(({pack,entry,target})=><li key={`${pack.key}:${entry.bindingVersionId}:${entry.senseVersionId}`} className="flex flex-wrap items-center justify-between gap-3 p-4">
    <div className="min-w-0 flex-1"><p className="break-words text-xl font-medium">{entry.expression}</p><p className="mt-2 text-sm leading-6 text-fg-secondary">{entry.meaning}</p></div>
    {target&&<button className={setupButton+' shrink-0'} aria-label={localFlowText('packageViewExpression',{expression:entry.expression})} onClick={()=>onTarget(target.targetId)}>{localFlowText('packageViewDetails')}<ArrowRight size={16}/></button>}
   </li>)}</ul>{installedEntries.length<installedEntryCount&&<button type="button" className={setupButton+' mt-4'} onClick={()=>setContentWindow({itemKey:item.listKey,limit:contentLimit<50?50:contentLimit+50})}>{t('study.more')}</button>}</>:<p className="rounded-2xl border border-dashed border-border-strong p-6 text-sm leading-6 text-fg-secondary">{localFlowText('packageContentsAfterDownload')}</p>}
  </section>
 </LearningSetupFrame>;
}

export function PackageCatalogScreen({active,c,params,onParamsChange,onBack,onOpenBook,onLibrary,onPublisher}:{
 active:boolean;c:Controller;params:ShellParams;onParamsChange:(params:ShellParams)=>void;onBack:()=>void;onOpenBook:(bookKey:string)=>void;onLibrary:()=>void;onPublisher:()=>void;
}){
 const {t,i18n}=useTranslation();
 const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
 const state=useMemo(()=>parseCatalogBrowsing(params),[params]);
 const [returnFocus,setReturnFocus]=useScreenState('package-catalog:return-focus','');
 const collection=useRef<HTMLDivElement>(null),summary=useRef<HTMLParagraphElement>(null);
 const requestedPageFocus=useRef(false);
 const projection=useMemo(()=>buildPackageCenterItems(c),[
  c.catalog,c.packages,c.enrollments,
  c.languageContext.targetLanguageTag,c.languageContext.supportLanguageTag,
 ]);
 const items=projection.catalog;
 const names=useMemo(()=>routeNames(items,locale),[items,locale]);
 const results=useMemo(()=>browseCatalog(items,state,names,locale),[items,state,names,locale]);
 const update=(patch:Partial<CatalogBrowsing>,resetPage=false)=>onParamsChange(catalogBrowsingParams({...state,...patch,...(resetPage?{page:1}:{})}));
 useEffect(()=>{
  // Clamp only against a verified snapshot, never an initial empty placeholder.
  if(active&&c.catalogStatus==='ready'&&state.page!==results.page)update({page:results.page});
 },[active,c.catalogStatus,state.page,results.page]);
 useLayoutEffect(()=>{
  if(!active||c.catalogStatus!=='ready')return;
  if(returnFocus){
   const button=[...collection.current?.querySelectorAll<HTMLButtonElement>('[data-package-key]')??[]].find(button=>button.dataset.packageKey===returnFocus);
   (button??summary.current)?.focus({preventScroll:true});
   setReturnFocus('');
  }
  if(requestedPageFocus.current){summary.current?.scrollIntoView({block:'start'});summary.current?.focus({preventScroll:true});requestedPageFocus.current=false;}
 },[active,c.catalogStatus,returnFocus,state.page]);
 const selectClass='mt-1 min-h-11 w-full min-w-0 rounded-control border border-border-strong bg-surface-panel px-3 text-sm text-fg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
 return <LearningSetupFrame id="s-catalog" active={active} onBack={onBack}>
  <CenterNavigation current="catalog" onCatalog={()=>{}} onLibrary={onLibrary} onPublisher={onPublisher}/>
  <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
   <h1 className="text-3xl font-medium tracking-tight">{localFlowText('packageCenterCatalog')}</h1>
   <button type="button" className={setupButton} disabled={c.catalogBusy} aria-busy={c.catalogBusy} onClick={()=>void c.reloadCatalog(true)}><RefreshCw size={16}/>{localFlowText(c.catalogBusy?'refreshingCatalog':'packageRefresh')}</button>
  </div>
  <div className="mb-4 space-y-3">
   {c.catalogFailed&&<PackageStatus error onRetry={()=>void c.reloadCatalog(true)}>{localFlowText('catalogFailed')}</PackageStatus>}
   {c.loadStatus==='unavailable'?<PackageStatus error onRetry={()=>void c.retryInitialLoad()}>{c.notice}</PackageStatus>:c.notice&&<PackageStatus>{localFlowNotice(c.notice)}</PackageStatus>}
  </div>
  <div className="mb-4 rounded-xl border border-border-subtle bg-surface-panel p-3 sm:p-4">
   <div className="flex min-h-11 items-center gap-2 rounded-control border border-border-strong bg-surface-subtle px-3 focus-within:ring-2 focus-within:ring-focus">
    <Search size={18} className="shrink-0 text-fg-secondary" aria-hidden="true"/>
    <input type="search" aria-label={localFlowText('packageSearch')} placeholder={localFlowText('packageSearch')} value={state.query} onChange={event=>update({query:event.target.value},true)} className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"/>
    {state.query&&<button type="button" className="min-h-11 shrink-0 rounded-control px-2 text-sm underline focus-visible:outline-2 focus-visible:outline-focus" onClick={()=>update({query:''},true)}>{localFlowText('packageClearSearch')}</button>}
   </div>
   <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {[
     {label:localFlowText('catalogTargetLanguage'),value:state.target,key:'target' as const,tags:items.map(item=>item.targetLanguage)},
     {label:localFlowText('catalogSupportLanguage'),value:state.support,key:'support' as const,tags:items.map(item=>item.supportLanguage)},
    ].map(filter=><label key={filter.key} className="min-w-0 text-sm text-fg-secondary">
     <span>{filter.label}</span><select aria-label={filter.label} value={filter.value} onChange={event=>update({[filter.key]:event.target.value},true)} className={selectClass}>
      <option value="">{t('statistics.allLanguages')}</option>
      {[...new Set(filter.tags.concat(filter.value?[filter.value]:[]))].sort((a,b)=>(names.get(a)??a).localeCompare(names.get(b)??b,locale)).map(tag=><option key={tag} value={tag}>{names.get(tag)??interfaceLanguageDisplayName(tag,locale)}</option>)}
     </select>
    </label>)}
    <label className="min-w-0 text-sm text-fg-secondary">{localFlowText('catalogSort')}<select aria-label={localFlowText('catalogSort')} value={state.sort} onChange={event=>update({sort:event.target.value as CatalogBrowsing['sort']},true)} className={selectClass}><option value="title">{localFlowText('catalogSortTitle')}</option><option value="newest">{localFlowText('catalogSortNewest')}</option></select></label>
    <label className="min-w-0 text-sm text-fg-secondary">{localFlowText('catalogPageSize')}<select aria-label={localFlowText('catalogPageSize')} value={state.pageSize} onChange={event=>update({pageSize:Number(event.target.value) as CatalogBrowsing['pageSize']},true)} className={selectClass}>{[24,48,96].map(size=><option key={size} value={size}>{size}</option>)}</select></label>
   </div>
  </div>
  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
   <p ref={summary} tabIndex={-1} role="status" aria-live="polite" className="text-sm text-fg-secondary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">{c.catalogStatus==='ready'?localFlowText('catalogResultRange',{start:results.start,end:results.end,total:results.total}):t(c.catalogStatus==='unavailable'?'reliability.errorTitle':'reliability.loading')}</p>
   <div role="group" aria-label={localFlowText('catalogView')} className="flex flex-wrap gap-2">{(['cards','list'] as const).map(view=><button type="button" key={view} aria-pressed={state.view===view} className={`${setupButton} ${state.view===view?'border-action-primary bg-accent-soft text-action-primary':''}`} onClick={()=>update({view})}>{state.view===view&&<Check size={14} aria-hidden="true"/>}{localFlowText(view==='cards'?'catalogCards':'catalogList')}</button>)}</div>
  </div>
  <div ref={collection}>
   {c.catalogStatus==='unavailable'?null:<PackageCards installation={c.installation} progress={c.progress} items={c.catalogStatus==='ready'?results.items:[]} loaded={c.catalogStatus==='ready'} learningStatus={c.loadStatus} view={state.view} onOpen={item=>{setReturnFocus(item.key);onOpenBook(item.key);}} emptyKey={state.query||state.target||state.support?'packageNoResults':'packageEmpty'}/>}
  </div>
  {c.catalogStatus==='ready'&&results.total>0&&<CatalogPagination page={results.page} pages={results.pages} onPage={page=>{if(page!==results.page){requestedPageFocus.current=true;update({page});}}}/>}
 </LearningSetupFrame>;
}

export function PackageBookScreen({active,bookKey,c,onBack,onLearning,onTarget}:{
 active:boolean;bookKey:string|null;c:Controller;onBack:()=>void;onLearning:()=>void;onTarget:(id:string)=>void;
}){
 const projection=useMemo(()=>buildPackageCenterItems(c),[
  c.catalog,c.packages,c.enrollments,
  c.languageContext.targetLanguageTag,c.languageContext.supportLanguageTag,
 ]);
 const item=projection.catalog.find(candidate=>candidate.key===bookKey);
 return <PackageDetail active={active} item={item} c={c} onBack={onBack} onLearning={onLearning} onTarget={onTarget}/>;
}

export function PackageLibraryDetailScreen({active,packageKey,publicationArchiveSha256,c,onBack,onLearning,onTarget}:{
 active:boolean;packageKey:string|null;publicationArchiveSha256?:string;c:Controller;onBack:()=>void;onLearning:()=>void;onTarget:(id:string)=>void;
}){
 const selection=useMemo(()=>{
  if(publicationArchiveSha256)return {item:projectPackageSource(c,packageKey,publicationArchiveSha256),referenceOnly:true};
  const libraryItem=buildPackageCenterItems(c).library.find(item=>item.listKey===packageKey);
  return {item:libraryItem??projectPackageSource(c,packageKey),referenceOnly:!libraryItem};
 },[c.catalog,c.packages,c.enrollments,c.languageContext.targetLanguageTag,c.languageContext.supportLanguageTag,packageKey,publicationArchiveSha256]);
 return <PackageDetail screenId="s-library-package" active={active} {...selection} c={c} onBack={onBack} onLearning={onLearning} onTarget={onTarget}/>;
}

export function PackageLibraryScreen({active,c,onBack,onCatalog,onOpenBook,onOpenPackage,onPublisher}:{
 active:boolean;c:Controller;onBack:()=>void;onCatalog:()=>void;onOpenBook:(bookKey:string)=>void;onOpenPackage:(key:string)=>void;onPublisher:()=>void;onLearning:()=>void;onTarget:(id:string)=>void;
}){
 const {i18n}=useTranslation();
 const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
 const [query,setQuery]=useScreenState('package-library:query','');
 const [candidate,setCandidate]=useState<{file:File;preview:Awaited<ReturnType<Controller['previewImport']>>}|null>(null);
 const input=useRef<HTMLInputElement>(null);
 const projection=useMemo(()=>buildPackageCenterItems(c),[
  c.catalog,c.packages,c.enrollments,
  c.languageContext.targetLanguageTag,c.languageContext.supportLanguageTag,
 ]);
 const items=projection.library;
 const normalized=query.trim().toLocaleLowerCase();
 const results=useMemo(()=>items.filter(item=>[item.title,item.description,item.targetLanguage,item.supportLanguage].join(' ').toLocaleLowerCase().includes(normalized)),[items,normalized]);
 if(candidate?.preview)return <LearningSetupFrame id="s-library" active={active} onBack={()=>setCandidate(null)} title={localFlowText('importPackageTitle')}>
  <div className="mb-5 space-y-4"><h1 className="break-words text-3xl font-medium tracking-tight sm:text-4xl">{candidate.preview.package.metadata.title}</h1><p className="text-sm text-fg-secondary">{interfaceLanguageDisplayName(candidate.preview.package.route.targetLanguage,locale)} / {interfaceLanguageDisplayName(candidate.preview.package.route.supportLanguage,locale)} · v{candidate.preview.package.metadata.version}</p></div>
  <section className="mb-5 space-y-5 rounded-2xl border border-border-strong bg-surface-panel p-5 sm:p-6">
   <h2 className="break-words text-2xl font-medium">{candidate.preview.package.targetExpression.text}</h2>
   <p className="break-words leading-7">{candidate.preview.package.sense.meaning}</p>
   <dl className="grid gap-4 text-sm sm:grid-cols-2">
    <div><dt className="text-fg-secondary">{localFlowText('packageAuthor')}</dt><dd className="mt-1 break-words">{candidate.preview.package.metadata.author.name}</dd></div>
    <div><dt className="text-fg-secondary">{localFlowText('packageLicense')}</dt><dd className="mt-1 break-words">{candidate.preview.package.metadata.license.name}</dd></div>
   </dl>
  </section>
  <section aria-label={localFlowText('packageActions')} className="space-y-4">
   {candidate.preview.status!=='new'&&<p role={candidate.preview.status==='version_conflict'?'alert':'status'} className="text-sm leading-6">{localFlowText(candidate.preview.status==='version_conflict'?'packageVersionChanged':candidate.preview.status==='installed'?'packageAlreadyInstalled':candidate.preview.status==='older_version'?'packageOlderVersion':'packageNewVersion')}</p>}
   {c.notice&&<p role="status">{localFlowNotice(c.notice)}</p>}
   <div className="flex flex-wrap gap-3"><button className={setupButton} disabled={c.busy} onClick={()=>setCandidate(null)}>{localFlowText('cancel')}</button><button className={setupPrimary} disabled={c.busy||candidate.preview.status==='version_conflict'} onClick={()=>void c.installImport(candidate.file,candidate.preview!.archiveDigest).then(installed=>{if(installed){setCandidate(null);if(!installed.portableOrigin.publications.length)onOpenPackage(`local:${installed.portableOrigin.manifest.metadata.packageId}`);}})}><Upload size={18}/>{localFlowText(c.busy?'processing':'confirmPackageImport')}</button></div>
  </section>
 </LearningSetupFrame>;
 return <LearningSetupFrame id="s-library" active={active} onBack={onBack}>
  <CenterNavigation current="library" onCatalog={onCatalog} onLibrary={()=>{}} onPublisher={onPublisher}/>
  <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
   <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{localFlowText('packageCenterLibrary')}</h1>
   <button className={setupButton} disabled={c.busy} onClick={()=>input.current?.click()}><Upload size={16}/>{localFlowText(c.busy?'processing':'importPackage')}</button>
  </div>
  {c.loaded&&c.unavailablePackageKeys.length>0&&<p role="status" className="mb-6 rounded-xl border border-border-strong bg-surface-subtle p-4 text-sm leading-6">{localFlowText('packageFilesUnavailable',{count:c.unavailablePackageKeys.length})}</p>}
  {c.notice&&<p role="status" className="mb-6 rounded-xl border border-border-subtle bg-surface-subtle p-4 text-sm leading-6">{localFlowNotice(c.notice)}</p>}
  <div className="mb-5 flex min-h-11 items-center gap-3 rounded-2xl border border-border-strong bg-surface-panel px-4 focus-within:ring-2 focus-within:ring-focus"><Search size={20} className="shrink-0 text-fg-secondary" aria-hidden="true"/><input type="search" aria-label={localFlowText('packageSearch')} placeholder={localFlowText('packageSearch')} value={query} onChange={event=>setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"/></div>
  <PackageCards items={results} installation={c.installation} progress={c.progress} loaded={c.loaded} learningStatus={c.loadStatus} onOpen={item=>item.kind==='published'?onOpenBook(item.key):onOpenPackage(item.listKey)} emptyKey={query?'packageNoResults':'packageEmpty'}/>
  <input ref={input} hidden tabIndex={-1} aria-label={localFlowText('importPackage')} type="file" accept=".sensa,application/zip,application/octet-stream" disabled={c.busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void c.previewImport(file).then(preview=>{if(preview)setCandidate({file,preview});});}}/>
 </LearningSetupFrame>;
}

export function PackagePublisherScreen({active,c,onBack,onCatalog,onLibrary}:{
 active:boolean;c:Controller;onBack:()=>void;onCatalog:()=>void;onLibrary:()=>void;
}){
 const {publisherAccess}=useAccountExperience();
 const [candidate,setCandidate]=useState<SensaPortableBookPackage|null>(null);
 const [validating,setValidating]=useState(false);
 const [failed,setFailed]=useState(false);
 const input=useRef<HTMLInputElement>(null);
 if(!publisherAccess)return <LearningSetupFrame id="s-publisher" active={active} onBack={onBack} title={localFlowText('packageCenterPublisher')}><p role="alert" className="rounded-2xl border border-feedback-danger bg-surface-panel p-6 text-feedback-danger">{localFlowText('contactSupport')}</p></LearningSetupFrame>;
 const publishers=new Set(c.catalog.map(item=>item.publisher.namespace)).size;
 const routes=new Set(c.catalog.map(item=>`${item.route.targetLanguage}\0${item.route.supportLanguage}`)).size;
 const members=c.catalog.reduce((sum,item)=>sum+item.memberCount,0);
 const inspect=async(file:File)=>{
  setValidating(true);setFailed(false);setCandidate(null);
  try{
   if(file.size>maxPortableBookArchiveBytes)throw new Error('too large');
   const {readSensaPortableBook}=await import('@sensa/content-validator/portable-book');
   setCandidate(readSensaPortableBook(new Uint8Array(await file.arrayBuffer())));
  }catch{setFailed(true);}finally{setValidating(false);}
 };
 return <LearningSetupFrame id="s-publisher" active={active} onBack={onBack}>
  <CenterNavigation current="publisher" onCatalog={onCatalog} onLibrary={onLibrary} onPublisher={()=>{}}/>
  <div className="mb-8 flex flex-wrap items-start justify-between gap-5"><div><h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{localFlowText('packageCenterPublisher')}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-fg-secondary">{localFlowText('packageCenterPublisherHint')}</p></div><button className={setupPrimary} disabled={validating} onClick={()=>input.current?.click()}><FileCheck2 size={18}/>{localFlowText(validating?'processing':'importPackage')}</button></div>
  <section className="mb-8 grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border border-border-strong bg-surface-panel p-5"><p className="text-3xl font-medium">{c.catalog.length}</p><p className="mt-2 text-sm text-fg-secondary">{localFlowText('packageCenterCatalog')}</p></div><div className="rounded-2xl border border-border-strong bg-surface-panel p-5"><p className="text-3xl font-medium">{members}</p><p className="mt-2 text-sm text-fg-secondary">{localFlowText('packageExpressionCount',{count:members})}</p></div><div className="rounded-2xl border border-border-strong bg-surface-panel p-5"><p className="text-3xl font-medium">{publishers} / {routes}</p><p className="mt-2 text-sm text-fg-secondary">{localFlowText('packageCenterPublisher')}</p></div></section>
  <section className="mb-8 space-y-4 rounded-2xl border border-border-strong bg-surface-panel p-5 sm:p-6"><p className="text-sm leading-6 text-fg-secondary">{localFlowText('packagePublisherManagedRelease')}</p>{failed&&<p role="alert" className="text-sm text-feedback-danger">{localFlowText('operationFailed')}</p>}{candidate&&<div role="status" className="rounded-xl bg-accent-soft p-4"><p className="font-medium text-action-primary">{candidate.manifest.book.title}</p><p className="mt-2 text-sm text-fg-secondary">{candidate.manifest.route.targetLanguage} / {candidate.manifest.route.supportLanguage} · v{candidate.manifest.book.versionNumber} · {localFlowText('packageExpressionCount',{count:candidate.members.length})}</p><p className="mt-2 break-all font-mono text-xs text-fg-tertiary">{candidate.archiveDigest}</p></div>}</section>
  <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-surface-panel">{c.catalog.map(item=><li key={`${item.publisher.namespace}:${item.book.bookId}:${item.route.targetLanguage}:${item.route.supportLanguage}`} className="flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="font-medium">{item.book.title}</p><p className="mt-1 text-sm text-fg-secondary">{item.publisher.name} · {item.route.targetLanguage} / {item.route.supportLanguage} · v{item.book.versionNumber}</p></div><code className="text-xs text-fg-tertiary">{item.sha256.slice(0,12)}</code></li>)}</ul>
  <input ref={input} hidden tabIndex={-1} type="file" accept=".sensa-book,application/vnd.sensa.book+zip,application/zip" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void inspect(file);}}/>
 </LearningSetupFrame>;
}
