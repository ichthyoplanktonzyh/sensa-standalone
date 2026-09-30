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
import {useMemo,useRef,useState} from 'react';
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
 type PackageCenterItem,
} from './packageCenterProjection';
import type {ContentSupplyInstallationPhase} from '../../contentSupply/system';

type Controller=ReturnType<typeof usePackageLearning>;

const itemState=(item:PackageCenterItem)=>localFlowText(
 item.updateDownloaded?'packageUpdateDownloaded'
  :item.updateAvailable?'packageUpdateAvailable'
   :item.enrolled?'enrolled'
    :item.installed.length?'downloaded':'packageNotDownloaded',
);

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
 return <nav aria-label={localFlowText('packageCatalogTitle')} className="mb-8 flex flex-wrap gap-2">
  {items.map(({id,label,icon:Icon,action})=><button
   key={id}
   type="button"
   aria-current={current===id?'page':undefined}
   className={`${setupButton} ${current===id?'border-action-primary bg-accent-soft text-action-primary':''}`}
   onClick={action}
  ><Icon size={17}/>{label}</button>)}
 </nav>;
}

function PackageCards({items,onOpen,emptyKey,loaded}:{
 items:readonly PackageCenterItem[];
 onOpen:(item:PackageCenterItem)=>void;
 emptyKey:'packageEmpty'|'packageNoResults';
 loaded:boolean;
}){
 const {t,i18n}=useTranslation();
 const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
 const names=useMemo(()=>routeNames(items,locale),[items,locale]);
 return <>
  <ul className="grid gap-4 sm:grid-cols-2">{items.map(item=><li key={item.listKey}>
   <button onClick={()=>onOpen(item)} className="group flex h-full w-full flex-col gap-5 rounded-2xl border border-border-strong bg-surface-panel p-6 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
    <div className="flex w-full items-center justify-between gap-4"><BookOpen size={24} className="text-action-primary" aria-hidden="true"/>{loaded?<span className="rounded-lg bg-accent-soft px-3 py-1 text-xs text-action-primary">{itemState(item)}</span>:<span role="status" aria-label={t('reliability.loading')} className="h-6 w-20 animate-pulse rounded-lg bg-surface-subtle"/>}</div>
    <div className="min-w-0 w-full flex-1"><h2 className="break-words text-xl font-medium">{item.title}</h2>{item.description&&<p className="mt-3 line-clamp-3 text-sm leading-6 text-fg-secondary">{item.description}</p>}</div>
    <div className="flex w-full flex-wrap items-center justify-between gap-3 text-sm text-fg-secondary"><span>{names.get(item.targetLanguage)} / {names.get(item.supportLanguage)}</span><span>{localFlowText('packageExpressionCount',{count:item.count})}</span><ArrowRight size={18} aria-hidden="true"/></div>
   </button>
  </li>)}</ul>
  {!items.length&&(loaded?<div role="status" className="rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center"><BookOpen size={32} className="mx-auto mb-4 text-fg-tertiary" aria-hidden="true"/><h2 className="text-lg font-medium">{localFlowText(emptyKey)}</h2></div>:<div role="status" aria-label={t('reliability.loading')} className="h-32 animate-pulse rounded-2xl bg-surface-subtle"/>)}
 </>;
}

function PackageDetail({active,item,c,onBack,onLearning,onTarget}:{
 active:boolean;
 item:PackageCenterItem|undefined;
 c:Controller;
 onBack:()=>void;
 onLearning:()=>void;
 onTarget:(id:string)=>void;
}){
 const {t,i18n}=useTranslation();
 const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
 const [downloadKey,setDownloadKey]=useState<string|null>(null);
 const [installationPhase,setInstallationPhase]=useState<ContentSupplyInstallationPhase|null>(null);
 const installationPhaseRef=useRef<ContentSupplyInstallationPhase|null>(null);
 const [contentWindow,setContentWindow]=useState({itemKey:'',limit:50});
 const contentLimit=item&&contentWindow.itemKey===item.listKey?contentWindow.limit:50;
 const targetByEntry=useMemo(()=>indexPackageTargets(c.targets),[c.targets]);
 const contentProjection=useMemo(()=>item
  ?projectPackageContentWindow(item.installed,targetByEntry,contentLimit)
  :{entries:[],total:0},[item?.installed,targetByEntry,contentLimit]);
 if(!item)return <LearningSetupFrame id="s-catalog-book" active={active} onBack={onBack} title={localFlowText('packageCatalogTitle')}>{!c.loaded||c.catalogBusy?<div role="status" aria-label={t('reliability.loading')} className="h-32 animate-pulse rounded-2xl bg-surface-subtle"/>:<p role="status">{localFlowText('packageNoResults')}</p>}</LearningSetupFrame>;
 const installedEntryCount=contentProjection.total;
 const installedEntries=contentProjection.entries;
 const enrollInstalled=()=>{
 if(!item.routeMatchesActive||!item.installed.length)return;
  if(item.publicationArchiveSha256)void c.enrollBook(item.publicationArchiveSha256);
  else void c.enroll(item.installed[0]!.key);
 };
 const reportInstallationPhase=(phase:ContentSupplyInstallationPhase)=>{
  installationPhaseRef.current=phase;
  setInstallationPhase(phase);
 };
 const cancelDownload=()=>{
  if(installationPhaseRef.current==='committing')return;
  c.cancelDownload();
 };
 const download=()=>{
  if(!item.descriptor)return;
  setDownloadKey(item.key);
  reportInstallationPhase('downloading');
  void c.download(item.descriptor,reportInstallationPhase).finally(()=>{
   setDownloadKey(null);
   installationPhaseRef.current=null;
   setInstallationPhase(null);
  });
 };
 const action=()=>{
  if(item.updateDownloaded&&item.installed.length){enrollInstalled();return;}
  if(item.updateAvailable&&item.descriptor){download();return;}
  if(item.enrolled){onLearning();return;}
  if(item.installed.length){enrollInstalled();return;}
  if(item.descriptor)download();
 };
 const disabled=!c.loaded||c.busy||c.catalogBusy||(!item.installed.length&&!item.descriptor)
  ||(item.installed.length>0&&!item.enrolled&&!item.routeMatchesActive);
 return <LearningSetupFrame id="s-catalog-book" active={active} onBack={onBack} title={localFlowText('packageCatalogTitle')}>
  <div className="mb-8 space-y-4">
   {c.loaded?<span className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-action-primary">{item.enrolled?<Check size={16}/>:<BookOpen size={16}/>} {itemState(item)}</span>:<span role="status" aria-label={t('reliability.loading')} className="inline-block h-9 w-24 animate-pulse rounded-lg bg-surface-subtle"/>}
   <h1 className="break-words text-3xl font-medium tracking-tight outline-none sm:text-4xl">{item.title}</h1>
   {item.description&&<p className="max-w-2xl text-sm leading-7 text-fg-secondary">{item.description}</p>}
   <p className="text-sm text-fg-secondary">{interfaceLanguageDisplayName(item.targetLanguage,locale)} / {interfaceLanguageDisplayName(item.supportLanguage,locale)} · {localFlowText('packageExpressionCount',{count:item.count})}{item.descriptor?` · v${item.descriptor.book.versionNumber}`:''}</p>
   {item.updateAvailable&&item.descriptor?.changeSummary&&<p className="max-w-2xl text-sm leading-6 text-fg-secondary">{item.descriptor.changeSummary}</p>}
  </div>
  <section aria-label={localFlowText('packageActions')} className="mb-8 space-y-4 rounded-2xl border border-border-strong bg-surface-panel p-5 sm:p-6">
   {c.notice&&<p role="status" className="rounded-xl border border-border-subtle bg-surface-subtle p-4 text-sm leading-6">{localFlowNotice(c.notice)}</p>}
   {item.installed.length>0&&!item.enrolled&&!item.routeMatchesActive&&<p role="status" className="text-sm leading-6 text-fg-secondary">{localFlowText('packageRouteMismatchHint')}</p>}
   {!c.loaded?<div role="status" aria-label={t('reliability.loading')} className="h-11 w-40 animate-pulse rounded-control bg-surface-subtle"/>:downloadKey===item.key&&installationPhase==='committing'?<p role="status" className="text-sm">{t('composer.saving')}</p>:downloadKey===item.key&&installationPhase==='preparing'?<>
    <p role="status" className="text-sm">{localFlowText('batchWorking')}</p>
    <button className={setupButton} onClick={cancelDownload}>{localFlowText('cancelDownload')}</button>
   </>:downloadKey===item.key&&installationPhase==='downloading'?<>
    <p role="status" className="text-sm">{localFlowText('downloading')}{c.progress??0}%</p>
    <progress aria-label={localFlowText('downloadPackage')} max={100} value={c.progress??0} className="h-2 w-full accent-action-primary"/>
    <button className={setupButton} onClick={cancelDownload}>{localFlowText('cancelDownload')}</button>
   </>:<div className="flex flex-wrap gap-3">
    <button className={setupPrimary} disabled={disabled} onClick={action}>
     {item.enrolled?<ArrowRight size={18}/>:item.updateDownloaded||item.installed.length?<Check size={18}/>:<Download size={18}/>}
     {localFlowText(c.busy?'processing':item.updateDownloaded?'applyPackageUpdate':item.updateAvailable?'downloadPackageUpdate':item.enrolled?'packageGoLearning':item.installed.length?'enroll':'downloadPackage')}
    </button>
    {item.installed.length===1&&<button className={setupButton} disabled={c.busy} onClick={()=>void c.exportPackage(item.installed[0]!.key).then(result=>{if(result)downloadPortablePackage(result);})}><Download size={18}/>{localFlowText('downloadPackage')}</button>}
   </div>}
  </section>
  <section aria-label={localFlowText('packageContents')}>
   <h2 className="mb-4 text-lg font-medium">{localFlowText('packageContents')}</h2>
   {!c.loaded?<div role="status" aria-label={t('reliability.loading')} className="h-40 animate-pulse rounded-2xl bg-surface-subtle"/>:installedEntries.length?<><ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-surface-panel">{installedEntries.map(({pack,entry,target})=><li key={`${pack.key}:${entry.bindingVersionId}:${entry.senseVersionId}`} className="flex flex-wrap items-center justify-between gap-4 p-5">
    <div className="min-w-0 flex-1"><p className="break-words text-xl font-medium">{entry.expression}</p><p className="mt-2 text-sm leading-6 text-fg-secondary">{entry.meaning}</p></div>
    {target&&<button className={setupButton+' shrink-0'} aria-label={localFlowText('packageViewExpression',{expression:entry.expression})} onClick={()=>onTarget(target.targetId)}>{localFlowText('packageViewDetails')}<ArrowRight size={16}/></button>}
   </li>)}</ul>{installedEntries.length<installedEntryCount&&<button type="button" className={setupButton+' mt-4'} onClick={()=>setContentWindow({itemKey:item.listKey,limit:contentLimit+50})}>{t('study.more')}</button>}</>:<p className="rounded-2xl border border-dashed border-border-strong p-6 text-sm leading-6 text-fg-secondary">{localFlowText('packageContentsAfterDownload')}</p>}
  </section>
 </LearningSetupFrame>;
}

export function PackageCatalogScreen({active,c,onBack,onOpenBook,onLibrary,onPublisher}:{
 active:boolean;c:Controller;onBack:()=>void;onOpenBook:(bookKey:string)=>void;onLibrary:()=>void;onPublisher:()=>void;
}){
 const {t,i18n}=useTranslation();
 const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
 const [query,setQuery]=useScreenState('package-catalog:query','');
 const [targetFilter,setTargetFilter]=useScreenState('package-catalog:target','');
 const [supportFilter,setSupportFilter]=useScreenState('package-catalog:support','');
 const [visibleCount,setVisibleCount]=useState(50);
 const projection=useMemo(()=>buildPackageCenterItems(c),[
  c.catalog,c.packages,c.enrollments,
  c.languageContext.targetLanguageTag,c.languageContext.supportLanguageTag,
 ]);
 const items=projection.catalog;
 const names=useMemo(()=>routeNames(items,locale),[items,locale]);
 const normalized=query.trim().toLocaleLowerCase();
 const results=useMemo(()=>items.filter(item=>(!targetFilter||item.targetLanguage===targetFilter)&&(!supportFilter||item.supportLanguage===supportFilter)&&[
  item.title,item.description,item.targetLanguage,item.supportLanguage,item.descriptor?.publisher.name??'',
  names.get(item.targetLanguage),names.get(item.supportLanguage),
 ].join(' ').toLocaleLowerCase().includes(normalized)),[items,targetFilter,supportFilter,names,normalized]);
 const visibleItems=useMemo(()=>results.slice(0,visibleCount),[results,visibleCount]);
 return <LearningSetupFrame id="s-catalog" active={active} onBack={onBack}>
  <CenterNavigation current="catalog" onCatalog={()=>{}} onLibrary={onLibrary} onPublisher={onPublisher}/>
  <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
   <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{localFlowText('packageCenterCatalog')}</h1>
   <button className={setupButton} disabled={c.catalogBusy} aria-busy={c.catalogBusy} onClick={()=>void c.reloadCatalog(true)}><RefreshCw size={16}/>{localFlowText(c.catalogBusy?'refreshingCatalog':'packageRefresh')}</button>
  </div>
  {c.notice&&<p role="status" className="mb-6 rounded-xl border border-border-subtle bg-surface-subtle p-4 text-sm leading-6">{localFlowNotice(c.notice)}</p>}
  <div className="mb-8 flex min-h-14 items-center gap-3 rounded-2xl border border-border-strong bg-surface-panel px-4 focus-within:ring-2 focus-within:ring-focus">
   <Search size={20} className="shrink-0 text-fg-secondary" aria-hidden="true"/>
   <input type="search" aria-label={localFlowText('packageSearch')} placeholder={localFlowText('packageSearch')} value={query} onChange={event=>{setQuery(event.target.value);setVisibleCount(50);}} className="min-w-0 flex-1 bg-transparent py-4 text-sm outline-none"/>
   {query&&<button className={setupButton} onClick={()=>{setQuery('');setVisibleCount(50);}}>{localFlowText('packageClearSearch')}</button>}
  </div>
  <div className="mb-8 grid gap-4 sm:grid-cols-2">
   {[
    {label:localFlowText('catalogTargetLanguage'),value:targetFilter,set:setTargetFilter,tags:items.map(item=>item.targetLanguage)},
    {label:localFlowText('catalogSupportLanguage'),value:supportFilter,set:setSupportFilter,tags:items.map(item=>item.supportLanguage)},
   ].map(filter=><label key={filter.label} className="min-w-0 text-sm text-fg-secondary">
    <span>{filter.label}</span>
    <select aria-label={filter.label} value={filter.value} onChange={event=>{filter.set(event.target.value);setVisibleCount(50);}} className="mt-2 min-h-11 w-full rounded-control border border-border-strong bg-surface-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus">
     <option value="">{t('statistics.allLanguages')}</option>
     {[...new Set(filter.tags.concat(filter.value?[filter.value]:[]))].sort().map(tag=><option key={tag} value={tag}>{names.get(tag)??interfaceLanguageDisplayName(tag,locale)}</option>)}
    </select>
   </label>)}
  </div>
  <PackageCards items={visibleItems} loaded={c.loaded} onOpen={item=>onOpenBook(item.key)} emptyKey={query||targetFilter||supportFilter?'packageNoResults':'packageEmpty'}/>
  {visibleItems.length<results.length&&<button type="button" className={setupButton+' mt-5'} onClick={()=>setVisibleCount(count=>count+50)}>{t('study.more')}</button>}
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

export function PackageLibraryScreen({active,c,onBack,onCatalog,onOpenBook,onPublisher,onLearning,onTarget}:{
 active:boolean;c:Controller;onBack:()=>void;onCatalog:()=>void;onOpenBook:(bookKey:string)=>void;onPublisher:()=>void;onLearning:()=>void;onTarget:(id:string)=>void;
}){
 const [query,setQuery]=useScreenState('package-library:query','');
 const [selected,setSelected]=useState<string|null>(null);
 const [candidate,setCandidate]=useState<{file:File;preview:Awaited<ReturnType<Controller['previewImport']>>}|null>(null);
 const input=useRef<HTMLInputElement>(null);
 const projection=useMemo(()=>buildPackageCenterItems(c),[
  c.catalog,c.packages,c.enrollments,
  c.languageContext.targetLanguageTag,c.languageContext.supportLanguageTag,
 ]);
 const items=projection.library;
 const normalized=query.trim().toLocaleLowerCase();
 const results=useMemo(()=>items.filter(item=>[item.title,item.description,item.targetLanguage,item.supportLanguage].join(' ').toLocaleLowerCase().includes(normalized)),[items,normalized]);
 const selectedItem=selected?items.find(item=>item.listKey===selected):undefined;
 if(selectedItem)return <PackageDetail active={active} item={selectedItem} c={c} onBack={()=>setSelected(null)} onLearning={onLearning} onTarget={onTarget}/>;
 if(candidate?.preview)return <LearningSetupFrame id="s-library" active={active} onBack={()=>setCandidate(null)} title={localFlowText('importPackageTitle')}>
  <div className="mb-8 space-y-4"><span className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-action-primary"><Upload size={16}/>{localFlowText('importPackage')}</span><h1 className="break-words text-3xl font-medium tracking-tight sm:text-4xl">{candidate.preview.package.metadata.title}</h1><p className="text-sm text-fg-secondary">{candidate.preview.package.route.targetLanguage} / {candidate.preview.package.route.supportLanguage}</p></div>
  <section className="space-y-4 rounded-2xl border border-border-strong bg-surface-panel p-5 sm:p-6"><p className="text-sm leading-6 text-fg-secondary">{localFlowText('importPackageHint')}</p>{c.notice&&<p role="status">{localFlowNotice(c.notice)}</p>}<div className="flex flex-wrap gap-3"><button className={setupButton} onClick={()=>setCandidate(null)}>{localFlowText('cancel')}</button><button className={setupPrimary} disabled={c.busy||candidate.preview.status==='version_conflict'} onClick={()=>void c.installImport(candidate.file,candidate.preview!.archiveDigest).then(installed=>{if(installed)setCandidate(null);})}><Upload size={18}/>{localFlowText(c.busy?'processing':'importPackage')}</button></div></section>
 </LearningSetupFrame>;
 return <LearningSetupFrame id="s-library" active={active} onBack={onBack}>
  <CenterNavigation current="library" onCatalog={onCatalog} onLibrary={()=>{}} onPublisher={onPublisher}/>
  <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
   <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{localFlowText('packageCenterLibrary')}</h1>
   <button className={setupButton} disabled={c.busy} onClick={()=>input.current?.click()}><Upload size={16}/>{localFlowText(c.busy?'processing':'importPackage')}</button>
  </div>
  {c.notice&&<p role="status" className="mb-6 rounded-xl border border-border-subtle bg-surface-subtle p-4 text-sm leading-6">{localFlowNotice(c.notice)}</p>}
  <div className="mb-8 flex min-h-14 items-center gap-3 rounded-2xl border border-border-strong bg-surface-panel px-4 focus-within:ring-2 focus-within:ring-focus"><Search size={20} className="shrink-0 text-fg-secondary" aria-hidden="true"/><input type="search" aria-label={localFlowText('packageSearch')} placeholder={localFlowText('packageSearch')} value={query} onChange={event=>setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent py-4 text-sm outline-none"/></div>
  <PackageCards items={results} loaded={c.loaded} onOpen={item=>item.kind==='published'?onOpenBook(item.key):setSelected(item.listKey)} emptyKey={query?'packageNoResults':'packageEmpty'}/>
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
