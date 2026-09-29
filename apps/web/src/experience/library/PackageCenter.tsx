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
import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';

import {localFlowNotice,localFlowText} from '../../i18n/localFlowText';
import {useAccountExperience} from '../account/AccountContext';
import {LearningSetupFrame,setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {useScreenState} from '../ui/ScreenHost';
import {downloadPortablePackage} from './portableDownload';
import type {usePackageLearning} from './usePackageLearning';

type Controller=ReturnType<typeof usePackageLearning>;
type InstalledPackage=Controller['packages'][number];
type Descriptor=Controller['catalog'][number];
type Publication=InstalledPackage['portableOrigin']['publications'][number];

type PackageCenterItem=Readonly<{
 key:string;
 listKey:string;
 kind:'published'|'retired'|'local';
 title:string;
 description:string;
 count:number;
 targetLanguage:string;
 supportLanguage:string;
 descriptor?:Descriptor;
 publicationArchiveSha256?:string;
 installed:InstalledPackage[];
 updateAvailable:boolean;
 updateDownloaded:boolean;
 enrolled:boolean;
 routeMatchesActive:boolean;
}>;

const routeMatches=(
 targetLanguage:string,
 supportLanguage:string,
 c:Controller,
)=>targetLanguage===c.languageContext.targetLanguageTag
 &&supportLanguage===c.languageContext.supportLanguageTag;

const centerItems=(c:Controller):Readonly<{
 catalog:PackageCenterItem[];
 library:PackageCenterItem[];
}>=>{
 const catalog=c.catalog.map((descriptor):PackageCenterItem=>{
  const packages=c.packages.filter(pack=>
   pack.content.targetLanguage===descriptor.route.targetLanguage
   &&pack.content.supportLanguage===descriptor.route.supportLanguage);
  const releases=new Map<string,{version:number;memberCount:number;packages:InstalledPackage[]}>();
  for(const pack of packages){
   for(const publication of pack.portableOrigin.publications){
    if(publication.book.bookId!==descriptor.book.bookId
     ||publication.route.targetLanguage!==descriptor.route.targetLanguage
     ||publication.route.supportLanguage!==descriptor.route.supportLanguage)continue;
    const group=releases.get(publication.bookArchiveSha256)??{
     version:publication.book.versionNumber,
     memberCount:publication.memberCount,
     packages:[],
    };
    if(!group.packages.some(candidate=>candidate.key===pack.key))group.packages.push(pack);
    releases.set(publication.bookArchiveSha256,group);
   }
  }
  const complete=[...releases.entries()].filter(([,group])=>group.packages.length===group.memberCount);
  const exact=releases.get(descriptor.sha256);
  const exactComplete=exact?.packages.length===descriptor.memberCount;
  const latest=complete.sort((left,right)=>right[1].version-left[1].version)[0];
  const installed=exactComplete?exact!.packages:latest?.[1].packages??[];
  const active=c.enrollments.find(enrollment=>enrollment.source.kind==='published_book'
   &&enrollment.source.publisherNamespace===descriptor.publisher.namespace
   &&enrollment.source.bookId===descriptor.book.bookId);
  const baselineVersion=active?.source.kind==='published_book'?active.source.bookVersionNumber:latest?.[1].version??null;
  const updateAvailable=baselineVersion!==null&&descriptor.book.versionNumber>baselineVersion;
  return {
   key:descriptor.book.bookKey,
   listKey:`published:${descriptor.publisher.namespace}:${descriptor.book.bookId}:${descriptor.route.targetLanguage}:${descriptor.route.supportLanguage}`,
   kind:'published',
   title:descriptor.book.title,
   description:descriptor.book.description,
   count:descriptor.memberCount,
   targetLanguage:descriptor.route.targetLanguage,
   supportLanguage:descriptor.route.supportLanguage,
   descriptor,
   publicationArchiveSha256:descriptor.sha256,
   installed,
   updateAvailable,
   updateDownloaded:updateAvailable&&!!exactComplete,
   enrolled:!!active&&active.source.kind==='published_book'&&active.source.bookVersionNumber>=descriptor.book.versionNumber,
   routeMatchesActive:routeMatches(descriptor.route.targetLanguage,descriptor.route.supportLanguage,c),
  };
 });

 const knownBooks=new Set(catalog.map(item=>[
  item.descriptor!.publisher.namespace,
  item.descriptor!.book.bookId,
  item.targetLanguage,
  item.supportLanguage,
 ].join('\0')));
 const orphanGroups=new Map<string,Map<string,{publication:Publication;packages:InstalledPackage[]}>>();
 for(const pack of c.packages){
  for(const publication of pack.portableOrigin.publications){
   const identity=[
    publication.publisher.namespace,
    publication.book.bookId,
    publication.route.targetLanguage,
    publication.route.supportLanguage,
   ].join('\0');
   if(knownBooks.has(identity))continue;
   const releases=orphanGroups.get(identity)??new Map();
   const group:{publication:Publication;packages:InstalledPackage[]}=releases.get(publication.bookArchiveSha256)??{publication,packages:[]};
   if(!group.packages.some(candidate=>candidate.key===pack.key))group.packages.push(pack);
   releases.set(publication.bookArchiveSha256,group);
   orphanGroups.set(identity,releases);
  }
 }
 const retired=[...orphanGroups.entries()].flatMap(([identity,releases]):PackageCenterItem[]=>{
  const latest=[...releases.values()]
   .filter(group=>group.packages.length===group.publication.memberCount)
   .sort((left,right)=>right.publication.book.versionNumber-left.publication.book.versionNumber)[0];
  if(!latest)return [];
  const publication=latest.publication;
  return [{
   key:publication.book.bookKey,
   listKey:`retired:${identity}`,
   kind:'retired',
   title:publication.book.title,
   description:publication.book.description,
   count:publication.memberCount,
   targetLanguage:publication.route.targetLanguage,
   supportLanguage:publication.route.supportLanguage,
   publicationArchiveSha256:publication.bookArchiveSha256,
   installed:latest.packages,
   updateAvailable:false,
   updateDownloaded:false,
   enrolled:c.enrollments.some(enrollment=>enrollment.source.kind==='published_book'
    &&enrollment.source.publisherNamespace===publication.publisher.namespace
    &&enrollment.source.bookId===publication.book.bookId
    &&enrollment.source.bookVersionNumber>=publication.book.versionNumber),
   routeMatchesActive:routeMatches(publication.route.targetLanguage,publication.route.supportLanguage,c),
  }];
 });
 const local=c.packages.filter(pack=>!pack.portableOrigin.publications.length).map((pack):PackageCenterItem=>({
  key:pack.portableOrigin.manifest.metadata.packageId,
  listKey:`local:${pack.key}`,
  kind:'local',
  title:pack.portableOrigin.manifest.metadata.title,
  description:pack.portableOrigin.manifest.metadata.description,
  count:pack.content.entries.length,
  targetLanguage:pack.content.targetLanguage,
  supportLanguage:pack.content.supportLanguage,
  installed:[pack],
  updateAvailable:false,
  updateDownloaded:false,
  enrolled:c.enrollments.some(enrollment=>enrollment.source.kind==='portable_package'
   &&enrollment.source.packageId===pack.portableOrigin.manifest.metadata.packageId
   &&enrollment.source.packageVersion>=pack.portableOrigin.manifest.metadata.version),
  routeMatchesActive:routeMatches(pack.content.targetLanguage,pack.content.supportLanguage,c),
 }));
 return {catalog,library:[...catalog.filter(item=>item.installed.length),...retired,...local]};
};

const itemState=(item:PackageCenterItem)=>localFlowText(
 item.updateDownloaded?'packageUpdateDownloaded'
  :item.updateAvailable?'packageUpdateAvailable'
   :item.enrolled?'enrolled'
    :item.installed.length?'downloaded':'packageNotDownloaded',
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

function PackageCards({items,onOpen,emptyKey}:{
 items:readonly PackageCenterItem[];
 onOpen:(item:PackageCenterItem)=>void;
 emptyKey:'packageEmpty'|'packageNoResults';
}){
 return <>
  <ul className="grid gap-4 sm:grid-cols-2">{items.map(item=><li key={item.listKey}>
   <button onClick={()=>onOpen(item)} className="group flex h-full w-full flex-col gap-5 rounded-2xl border border-border-strong bg-surface-panel p-6 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
    <div className="flex w-full items-center justify-between gap-4"><BookOpen size={24} className="text-action-primary" aria-hidden="true"/><span className="rounded-lg bg-accent-soft px-3 py-1 text-xs text-action-primary">{itemState(item)}</span></div>
    <div className="min-w-0 w-full flex-1"><h2 className="break-words text-xl font-medium">{item.title}</h2>{item.description&&<p className="mt-3 line-clamp-3 text-sm leading-6 text-fg-secondary">{item.description}</p>}</div>
    <div className="flex w-full flex-wrap items-center justify-between gap-3 text-sm text-fg-secondary"><span>{item.targetLanguage} / {item.supportLanguage}</span><span>{localFlowText('packageExpressionCount',{count:item.count})}</span><ArrowRight size={18} aria-hidden="true"/></div>
   </button>
  </li>)}</ul>
  {!items.length&&<div role="status" className="rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center"><BookOpen size={32} className="mx-auto mb-4 text-fg-tertiary" aria-hidden="true"/><h2 className="text-lg font-medium">{localFlowText(emptyKey)}</h2></div>}
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
 const {t}=useTranslation();
 const [downloadKey,setDownloadKey]=useState<string|null>(null);
 const [contentWindow,setContentWindow]=useState({itemKey:'',limit:50});
 if(!item)return <LearningSetupFrame id="s-catalog-book" active={active} onBack={onBack} title={localFlowText('packageCatalogTitle')}><p role="status">{localFlowText('packageNoResults')}</p></LearningSetupFrame>;
 const contentLimit=contentWindow.itemKey===item.listKey?contentWindow.limit:50;
 const targetByEntry=new Map(c.targets.map(target=>[
  `${target.packageKey}\0${target.identity.senseVersionId}\0${target.identity.bindingVersionId}`,
  target,
 ]));
 const installedEntryCount=item.installed.reduce((count,pack)=>count+pack.content.entries.length,0);
 const installedEntries:ReadonlyArray<{
  pack:InstalledPackage;
  entry:InstalledPackage['content']['entries'][number];
  target:Controller['targets'][number]|undefined;
 }>=item.installed.flatMap(pack=>pack.content.entries.map(entry=>({
  pack,
  entry,
  target:targetByEntry.get(`${pack.key}\0${entry.senseVersionId}\0${entry.bindingVersionId}`),
 }))).slice(0,contentLimit);
 const enrollInstalled=()=>{
 if(!item.routeMatchesActive||!item.installed.length)return;
  if(item.publicationArchiveSha256)void c.enrollBook(item.publicationArchiveSha256);
  else void c.enroll(item.installed[0]!.key);
 };
 const action=()=>{
  if(item.updateDownloaded&&item.installed.length){enrollInstalled();return;}
  if(item.updateAvailable&&item.descriptor){setDownloadKey(item.key);void c.download(item.descriptor).finally(()=>setDownloadKey(null));return;}
  if(item.enrolled){onLearning();return;}
  if(item.installed.length){enrollInstalled();return;}
  if(item.descriptor){setDownloadKey(item.key);void c.download(item.descriptor).finally(()=>setDownloadKey(null));}
 };
 const disabled=c.busy||c.catalogBusy||(!item.installed.length&&!item.descriptor)
  ||(item.installed.length>0&&!item.enrolled&&!item.routeMatchesActive);
 return <LearningSetupFrame id="s-catalog-book" active={active} onBack={onBack} title={localFlowText('packageCatalogTitle')}>
  <div className="mb-8 space-y-4">
   <span className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-action-primary">{item.enrolled?<Check size={16}/>:<BookOpen size={16}/>} {itemState(item)}</span>
   <h1 className="break-words text-3xl font-medium tracking-tight outline-none sm:text-4xl">{item.title}</h1>
   {item.description&&<p className="max-w-2xl text-sm leading-7 text-fg-secondary">{item.description}</p>}
   <p className="text-sm text-fg-secondary">{item.targetLanguage} / {item.supportLanguage} · {localFlowText('packageExpressionCount',{count:item.count})}{item.descriptor?` · v${item.descriptor.book.versionNumber}`:''}</p>
   {item.updateAvailable&&item.descriptor?.changeSummary&&<p className="max-w-2xl text-sm leading-6 text-fg-secondary">{item.descriptor.changeSummary}</p>}
  </div>
  <section aria-label={localFlowText('packageActions')} className="mb-8 space-y-4 rounded-2xl border border-border-strong bg-surface-panel p-5 sm:p-6">
   {c.notice&&<p role="status" className="rounded-xl border border-border-subtle bg-surface-subtle p-4 text-sm leading-6">{localFlowNotice(c.notice)}</p>}
   {item.installed.length>0&&!item.enrolled&&!item.routeMatchesActive&&<p role="status" className="text-sm leading-6 text-fg-secondary">{localFlowText('packageRouteMismatchHint')}</p>}
   {c.progress!==null&&downloadKey===item.key?<>
    <p role="status" className="text-sm">{localFlowText('downloading')}{c.progress}%</p>
    <progress aria-label={localFlowText('downloadPackage')} max={100} value={c.progress} className="h-2 w-full accent-action-primary"/>
    <button className={setupButton} onClick={c.cancelDownload}>{localFlowText('cancelDownload')}</button>
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
   {installedEntries.length?<><ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-surface-panel">{installedEntries.map(({pack,entry,target})=><li key={`${pack.key}:${entry.bindingVersionId}:${entry.senseVersionId}`} className="flex flex-wrap items-center justify-between gap-4 p-5">
    <div className="min-w-0 flex-1"><p className="break-words text-xl font-medium">{entry.expression}</p><p className="mt-2 text-sm leading-6 text-fg-secondary">{entry.meaning}</p></div>
    {target&&<button className={setupButton+' shrink-0'} aria-label={localFlowText('packageViewExpression',{expression:entry.expression})} onClick={()=>onTarget(target.targetId)}>{localFlowText('packageViewDetails')}<ArrowRight size={16}/></button>}
   </li>)}</ul>{installedEntries.length<installedEntryCount&&<button type="button" className={setupButton+' mt-4'} onClick={()=>setContentWindow({itemKey:item.listKey,limit:contentLimit+50})}>{t('study.more')}</button>}</>:<p className="rounded-2xl border border-dashed border-border-strong p-6 text-sm leading-6 text-fg-secondary">{localFlowText('packageContentsAfterDownload')}</p>}
  </section>
 </LearningSetupFrame>;
}

export function PackageCatalogScreen({active,c,onBack,onOpenBook,onLibrary,onPublisher}:{
 active:boolean;c:Controller;onBack:()=>void;onOpenBook:(bookKey:string)=>void;onLibrary:()=>void;onPublisher:()=>void;
}){
 const [query,setQuery]=useScreenState('package-catalog:query','');
 const items=centerItems(c).catalog;
 const normalized=query.trim().toLocaleLowerCase();
 const results=items.filter(item=>[
  item.title,item.description,item.targetLanguage,item.supportLanguage,item.descriptor?.publisher.name??'',
 ].join(' ').toLocaleLowerCase().includes(normalized));
 return <LearningSetupFrame id="s-catalog" active={active} onBack={onBack}>
  <CenterNavigation current="catalog" onCatalog={()=>{}} onLibrary={onLibrary} onPublisher={onPublisher}/>
  <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
   <div><h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{localFlowText('packageCenterCatalog')}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-fg-secondary">{localFlowText('packageCenterCatalogHint')}</p></div>
   <button className={setupButton} disabled={c.catalogBusy} aria-busy={c.catalogBusy} onClick={()=>void c.reloadCatalog(true)}><RefreshCw size={16}/>{localFlowText(c.catalogBusy?'refreshingCatalog':'packageRefresh')}</button>
  </div>
  {c.notice&&<p role="status" className="mb-6 rounded-xl border border-border-subtle bg-surface-subtle p-4 text-sm leading-6">{localFlowNotice(c.notice)}</p>}
  <div className="mb-8 flex min-h-14 items-center gap-3 rounded-2xl border border-border-strong bg-surface-panel px-4 focus-within:ring-2 focus-within:ring-focus">
   <Search size={20} className="shrink-0 text-fg-secondary" aria-hidden="true"/>
   <input type="search" aria-label={localFlowText('packageSearch')} placeholder={localFlowText('packageSearch')} value={query} onChange={event=>setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent py-4 text-sm outline-none"/>
   {query&&<button className={setupButton} onClick={()=>setQuery('')}>{localFlowText('packageClearSearch')}</button>}
  </div>
  <PackageCards items={results} onOpen={item=>onOpenBook(item.key)} emptyKey={query?'packageNoResults':'packageEmpty'}/>
 </LearningSetupFrame>;
}

export function PackageBookScreen({active,bookKey,c,onBack,onLearning,onTarget}:{
 active:boolean;bookKey:string|null;c:Controller;onBack:()=>void;onLearning:()=>void;onTarget:(id:string)=>void;
}){
 const item=centerItems(c).catalog.find(candidate=>candidate.key===bookKey);
 return <PackageDetail active={active} item={item} c={c} onBack={onBack} onLearning={onLearning} onTarget={onTarget}/>;
}

export function PackageLibraryScreen({active,c,onBack,onCatalog,onOpenBook,onPublisher,onLearning,onTarget}:{
 active:boolean;c:Controller;onBack:()=>void;onCatalog:()=>void;onOpenBook:(bookKey:string)=>void;onPublisher:()=>void;onLearning:()=>void;onTarget:(id:string)=>void;
}){
 const [query,setQuery]=useScreenState('package-library:query','');
 const [selected,setSelected]=useState<string|null>(null);
 const [candidate,setCandidate]=useState<{file:File;preview:Awaited<ReturnType<Controller['previewImport']>>}|null>(null);
 const input=useRef<HTMLInputElement>(null);
 const items=centerItems(c).library;
 const selectedItem=selected?items.find(item=>item.listKey===selected):undefined;
 if(selectedItem)return <PackageDetail active={active} item={selectedItem} c={c} onBack={()=>setSelected(null)} onLearning={onLearning} onTarget={onTarget}/>;
 if(candidate?.preview)return <LearningSetupFrame id="s-library" active={active} onBack={()=>setCandidate(null)} title={localFlowText('importPackageTitle')}>
  <div className="mb-8 space-y-4"><span className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-action-primary"><Upload size={16}/>{localFlowText('importPackage')}</span><h1 className="break-words text-3xl font-medium tracking-tight sm:text-4xl">{candidate.preview.package.metadata.title}</h1><p className="text-sm text-fg-secondary">{candidate.preview.package.route.targetLanguage} / {candidate.preview.package.route.supportLanguage}</p></div>
  <section className="space-y-4 rounded-2xl border border-border-strong bg-surface-panel p-5 sm:p-6"><p className="text-sm leading-6 text-fg-secondary">{localFlowText('importPackageHint')}</p>{c.notice&&<p role="status">{localFlowNotice(c.notice)}</p>}<div className="flex flex-wrap gap-3"><button className={setupButton} onClick={()=>setCandidate(null)}>{localFlowText('cancel')}</button><button className={setupPrimary} disabled={c.busy||candidate.preview.status==='version_conflict'} onClick={()=>void c.installImport(candidate.file,candidate.preview!.archiveDigest).then(installed=>{if(installed)setCandidate(null);})}><Upload size={18}/>{localFlowText(c.busy?'processing':'importPackage')}</button></div></section>
 </LearningSetupFrame>;
 const normalized=query.trim().toLocaleLowerCase();
 const results=items.filter(item=>[item.title,item.description,item.targetLanguage,item.supportLanguage].join(' ').toLocaleLowerCase().includes(normalized));
 return <LearningSetupFrame id="s-library" active={active} onBack={onBack}>
  <CenterNavigation current="library" onCatalog={onCatalog} onLibrary={()=>{}} onPublisher={onPublisher}/>
  <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
   <div><h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{localFlowText('packageCenterLibrary')}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-fg-secondary">{localFlowText('packageCenterLibraryHint')}</p></div>
   <button className={setupButton} disabled={c.busy} onClick={()=>input.current?.click()}><Upload size={16}/>{localFlowText(c.busy?'processing':'importPackage')}</button>
  </div>
  {c.notice&&<p role="status" className="mb-6 rounded-xl border border-border-subtle bg-surface-subtle p-4 text-sm leading-6">{localFlowNotice(c.notice)}</p>}
  <div className="mb-8 flex min-h-14 items-center gap-3 rounded-2xl border border-border-strong bg-surface-panel px-4 focus-within:ring-2 focus-within:ring-focus"><Search size={20} className="shrink-0 text-fg-secondary" aria-hidden="true"/><input type="search" aria-label={localFlowText('packageSearch')} placeholder={localFlowText('packageSearch')} value={query} onChange={event=>setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent py-4 text-sm outline-none"/></div>
  <PackageCards items={results} onOpen={item=>item.kind==='published'?onOpenBook(item.key):setSelected(item.listKey)} emptyKey={query?'packageNoResults':'packageEmpty'}/>
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
