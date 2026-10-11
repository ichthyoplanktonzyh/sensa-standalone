import type {SensaPortableBookDescriptor,SensaPortableBookPreview} from '@sensa/contracts/sensa';
import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {contentSupplySystem} from '../../contentSupply/system';
import {localFlowErrorKey,localFlowNotice,localFlowText} from '../../i18n/localFlowText';
import {setupButton} from '../components/learning/LearningSetupFrame';
import {PackageStatus} from './PackageCenterParts';

type State={key:string;status:'idle'|'loading'|'failed'|'ready';preview?:SensaPortableBookPreview;error?:string;limit:number};

/** Catalog inspection is independent of installation and learning admission. */
export function BookPreview({active,descriptor}:{active:boolean;descriptor:SensaPortableBookDescriptor}){
 const {t}=useTranslation();
 const key=JSON.stringify(descriptor),request=useRef<AbortController|null>(null);
 const [state,setState]=useState<State>({key,status:'idle',limit:24});
 const current=state.key===key?state:{key,status:'idle' as const,limit:24};
 useEffect(()=>{
  request.current?.abort();request.current=null;
  setState({key,status:'idle',limit:24});
  return ()=>{request.current?.abort();request.current=null;};
 },[key,active]);
 const load=()=>{
  if(request.current||!active)return;
  const controller=new AbortController();request.current=controller;
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45_000)]);
  setState({key,status:'loading',limit:24});
  void contentSupplySystem.read({kind:'book_preview',descriptor,signal}).then(preview=>{
   if(request.current===controller&&!controller.signal.aborted)setState({key,status:'ready',preview,limit:24});
  },error=>{
   if(request.current===controller&&!controller.signal.aborted)setState({key,status:'failed',error:(localFlowErrorKey(error,'localFlow.packagePreviewFailed')==='localFlow.packagePreviewUnavailable'?'localFlow.packagePreviewUnavailable':'localFlow.packagePreviewFailed'),limit:24});
  }).finally(()=>{if(request.current===controller)request.current=null;});
 };
 const preview=current.preview;
 return <section aria-label={localFlowText('packagePreviewLoad')} className="mb-5 space-y-4 rounded-xl border border-border-subtle bg-surface-panel p-4 sm:p-5">
  <h2 className="text-lg font-medium">{localFlowText('packagePreviewLoad')}</h2>
  <p className="text-sm leading-6 text-fg-secondary">{localFlowText('packagePreviewHint')}</p>
  {!preview&&<>
   <dl className="grid gap-3 text-sm sm:grid-cols-2">{(['packageAuthor','packageLicense'] as const).map(label=><div key={label}><dt className="text-fg-secondary">{localFlowText(label)}</dt><dd>{localFlowText('packagePreviewUnknown')}</dd></div>)}</dl>
   {!descriptor.preview&&<p className="text-sm leading-6 text-fg-secondary">{localFlowText('packagePreviewLegacyHint',{size:(descriptor.byteLength/1024/1024).toFixed(1)})}</p>}
   {current.status==='loading'?<PackageStatus>{localFlowText('packagePreviewLoading')}</PackageStatus>:current.status==='failed'?<PackageStatus error onRetry={load}>{localFlowNotice(current.error)}</PackageStatus>:<button type="button" className={setupButton} onClick={load}>{localFlowText('packagePreviewLoad')}</button>}
  </>}
  {preview&&<>
   <p className="text-sm text-fg-secondary">{localFlowText('packagePreviewVersion',{version:preview.book.versionNumber})}</p>
   <dl className="grid gap-3 text-sm sm:grid-cols-2">{[
    {label:'packageAuthor' as const,values:preview.authors},{label:'packageLicense' as const,values:preview.licenses},
   ].map(group=><div key={group.label}><dt className="text-fg-secondary">{localFlowText(group.label)}</dt><dd className="break-words">{group.values.map(party=>party.name).join(' · ')}</dd></div>)}</dl>
   <h3 className="font-medium">{localFlowText('packagePreviewSamples')}</h3>
   <div className="space-y-4">{preview.samples.map(sample=><article key={`${sample.packageId}:${sample.version}`} aria-label={sample.expression} className="space-y-3 rounded-xl border border-border-subtle p-4">
    <h4 className="break-words text-xl font-medium">{sample.expression}</h4>
    <dl className="space-y-3 text-sm leading-6">
     <div><dt className="font-medium">{localFlowText('context')}</dt><dd className="whitespace-pre-wrap break-words text-fg-secondary">{sample.scene}{sample.hasVisualCue&&<p>{localFlowText('packagePreviewVisual')}</p>}</dd></div>
     <div><dt className="font-medium">{localFlowText('packagePreviewMeaning')}</dt><dd className="whitespace-pre-wrap break-words text-fg-secondary">{sample.meaning}</dd></div>
     <div><dt className="font-medium">{localFlowText('expression')}</dt><dd className="space-y-2 break-words"><p className="whitespace-pre-wrap text-fg-secondary">{sample.bridge}</p><p className="whitespace-pre-wrap">{sample.example}</p>{sample.translation&&<p className="whitespace-pre-wrap text-fg-secondary">{sample.translation}</p>}</dd></div>
    </dl>
   </article>)}</div>
   <h3 className="font-medium">{localFlowText('packagePreviewDirectory',{count:preview.memberCount})}</h3>
   <ul className="grid gap-2 text-sm sm:grid-cols-2">{preview.entries.slice(0,current.limit).map(entry=><li key={`${entry.packageId}:${entry.version}`} className="break-words rounded-lg bg-surface-subtle px-3 py-2">{entry.expression}</li>)}</ul>
   {current.limit<preview.memberCount&&<button type="button" className={setupButton} onClick={()=>setState(previous=>({...previous,limit:previous.limit+24}))}>{t('study.more')}</button>}
  </>}
 </section>;
}
