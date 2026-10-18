import {maxLegacyBookPreviewArchiveBytes,type SensaPortableBookDescriptor,type SensaPortableBookPreview} from '@sensa/contracts/sensa';
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {contentSupplySystem} from '../../contentSupply/system';
import {localFlowErrorKey,localFlowNotice,localFlowText} from '../../i18n/localFlowText';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import {CatalogPagination,PackageStatus} from './PackageCenterParts';

type State={key:string;status:'idle'|'loading'|'failed'|'ready';preview?:SensaPortableBookPreview;error?:string};

/** Entering a Book reads a bounded, verified text preview. It never installs content. */
export function BookPreview({active,descriptor,publication}:{active:boolean;descriptor:SensaPortableBookDescriptor;publication?:ReactNode}){
 const {i18n}=useTranslation();
 const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language),numbers=new Intl.NumberFormat(locale);
 const key=JSON.stringify(descriptor),request=useRef<AbortController|null>(null);
 const [state,setState]=useState<State>({key,status:'idle'});
 const current=state.key===key?state:{key,status:'idle' as const};
 const [directory,setDirectory]=useState({key,query:'',page:1});
 const browsing=directory.key===key?directory:{key,query:'',page:1};
 const load=()=>{
  if(request.current||!active)return;
  if(!descriptor.preview&&descriptor.byteLength>maxLegacyBookPreviewArchiveBytes){
   setState({key,status:'failed',error:'localFlow.packagePreviewUnavailable'});return;
  }
  const controller=new AbortController();request.current=controller;
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45_000)]);
  setState({key,status:'loading'});
  void contentSupplySystem.read({kind:'book_preview',descriptor,signal}).then(preview=>{
   if(request.current===controller&&!controller.signal.aborted)setState({key,status:'ready',preview});
  },error=>{
   if(request.current===controller&&!controller.signal.aborted)setState({key,status:'failed',error:(localFlowErrorKey(error,'localFlow.packagePreviewFailed')==='localFlow.packagePreviewUnavailable'?'localFlow.packagePreviewUnavailable':'localFlow.packagePreviewFailed')});
  }).finally(()=>{if(request.current===controller)request.current=null;});
 };
 useEffect(()=>{
  request.current?.abort();request.current=null;
  setState({key,status:'idle'});
  setDirectory({key,query:'',page:1});
  if(active)load();
  return ()=>{request.current?.abort();request.current=null;};
 },[key,active]);
 const preview=current.preview;
 const filteredEntries=useMemo(()=>preview?.entries.filter(entry=>entry.expression.toLocaleLowerCase(locale).includes(browsing.query.trim().toLocaleLowerCase(locale)))??[],[preview,browsing.query,locale]);
 const pages=Math.max(1,Math.ceil(filteredEntries.length/24)),page=Math.min(browsing.page,pages);
 const directoryLabel=preview?localFlowText('packagePreviewDirectory',{count:preview.memberCount}):'';

 return <section aria-label={localFlowText('packagePreviewLoad')} className="space-y-6">
  <div className="flex flex-wrap items-baseline justify-between gap-2">
   <h2 className="text-section-title font-medium">{localFlowText('packagePreviewSamples')}</h2>
   {preview&&<p className="text-metadata text-fg-secondary">{localFlowText('packagePreviewVersion',{version:numbers.format(preview.book.versionNumber)})}</p>}
  </div>
  {!preview&&(current.status==='loading'||current.status==='idle'?<div role="status" className="min-h-32 text-body-support text-fg-secondary">{localFlowText('packagePreviewLoading')}</div>:<PackageStatus error={current.error!=='localFlow.packagePreviewUnavailable'} onRetry={current.error==='localFlow.packagePreviewUnavailable'?undefined:load}>{localFlowNotice(current.error)}</PackageStatus>)}
  {preview&&<>
   <div className="sensa-package-samples">{preview.samples.map(sample=>{const extra=[...new Set([sample.senseFocus,sample.meaning,sample.bridge])].filter(text=>text!==(sample.scene??sample.meaning));return <article key={`${sample.packageId}:${sample.version}`} aria-label={sample.expression} className="sensa-package-sample space-y-4">
    <h3 className="break-words font-language text-2xl font-medium"><bdi lang={descriptor.route.targetLanguage}>{sample.expression}</bdi></h3>
    <p className="whitespace-pre-wrap break-words text-body"><bdi lang={descriptor.route.supportLanguage}>{sample.scene??sample.meaning}</bdi></p>
    <div className="space-y-1 border-t border-border-subtle pt-3 text-body-support">
     <p className="whitespace-pre-wrap break-words"><bdi lang={descriptor.route.targetLanguage}>{sample.example}</bdi></p>
     {sample.translation&&<p className="whitespace-pre-wrap break-words text-fg-secondary"><bdi lang={descriptor.route.supportLanguage}>{sample.translation}</bdi></p>}
    </div>
    {(extra.length>0||sample.hasVisualCue)&&<details className="sensa-package-sample-more">
     <summary>{localFlowText('packagePreviewMore')}</summary>
     <div className="space-y-3 pb-2 text-body-support">{extra.map(text=><p key={text} className="whitespace-pre-wrap break-words"><bdi lang={descriptor.route.supportLanguage}>{text}</bdi></p>)}
      {sample.hasVisualCue&&<p className="text-metadata text-fg-secondary">{localFlowText('packagePreviewVisual')}</p>}
     </div>
    </details>}
   </article>;})}</div>
   <section aria-label={directoryLabel} className="border-t border-border-subtle pt-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
     <h3 className="font-medium">{directoryLabel}</h3>
     {preview.memberCount>24&&<input type="search" aria-label={localFlowText('packageDirectorySearch')} placeholder={localFlowText('packageDirectorySearch')} value={browsing.query} onChange={event=>setDirectory({key,query:event.target.value,page:1})} className="min-h-11 w-full min-w-0 rounded-control border border-border-subtle bg-surface-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus sm:w-64"/>}
    </div>
    <ul className="grid grid-cols-2 gap-x-6 gap-y-3 text-body-support sm:grid-cols-3 lg:grid-cols-4">{filteredEntries.slice((page-1)*24,page*24).map(entry=><li key={`${entry.packageId}:${entry.version}`} className="break-words"><bdi lang={descriptor.route.targetLanguage}>{entry.expression}</bdi></li>)}</ul>
    {preview.memberCount>24&&<p role="status" className="mt-4 text-metadata text-fg-secondary">{localFlowText('catalogResultRange',{start:numbers.format(filteredEntries.length?(page-1)*24+1:0),end:numbers.format(Math.min(page*24,filteredEntries.length)),total:numbers.format(filteredEntries.length)})}</p>}
    {pages>1&&<CatalogPagination label={directoryLabel} page={page} pages={pages} onPage={next=>setDirectory({...browsing,page:next})}/>}
   </section>
  </>}
  <details className="sensa-package-disclosure">
   <summary>{localFlowText('packagePublication')}</summary>
   <div className="mt-2 space-y-4">
    {publication}
    <dl className="grid gap-4 text-body-support sm:grid-cols-2">{[
     {label:'packageAuthor' as const,values:preview?.authors},{label:'packageLicense' as const,values:preview?.licenses},
    ].map(group=><div key={group.label}><dt className="text-fg-secondary">{localFlowText(group.label)}</dt><dd className="mt-1 break-words"><bdi>{group.values?group.values.map(party=>party.name).join(' · ')||localFlowText('packagePreviewUnknown'):localFlowText('packagePreviewMetadataPending')}</bdi></dd></div>)}</dl>
   </div>
  </details>
 </section>;
}
