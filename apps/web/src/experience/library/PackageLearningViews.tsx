import {LearningPreferencesPanel} from '../components/learning/LearningPreferencesPanel';
import {cardText} from '../../i18n/originalCards';
import {StudyResources} from '../components/learning/StudyResources';
import {LearningResourceDetails} from '../components/learning/LearningResourceDetails';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import i18n from '../../i18n/index';
import {useState,useRef,useEffect} from 'react';
import {ArrowRight,BookOpen,Search,RefreshCw,Upload,Check,Download} from 'lucide-react';
import {LearningTargetDetailScreen} from '../components/learning/LearningTargetDetailScreen';
import type {PortablePackagePreview} from '../../contentSupply/system';
import type {LearningTargetProjection} from '../../learning/system';
import type {usePackageLearning} from './usePackageLearning';
import {LearningSetupFrame,setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {useScreenState} from '../ui/ScreenHost';
type Controller=ReturnType<typeof usePackageLearning>;
export function PackageEntry({active,c,onBack,onLearning,onTarget}:{active:boolean;c:Controller;onBack:()=>void;onLearning:()=>void;onTarget:(id:string)=>void}){
 useTranslation();
 const [selected,setSelected]=useState<string|null>(null),[query,setQuery]=useScreenState('learning-entry:query',''),[downloadKey,setDownloadKey]=useState<string|null>(null),[importCandidate,setImportCandidate]=useState<{file:File;preview:PortablePackagePreview}|null>(null);
 const importInput=useRef<HTMLInputElement>(null),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(!active){setSelected(null);setImportCandidate(null);}},[active]);
 useEffect(()=>{if(active)heading.current?.focus({preventScroll:true});},[selected,active]);
 const enrolledFor=(p:Controller['packages'][number])=>p.content.entries.map(e=>c.targets.find(t=>e.senseVersionId===t.identity.senseVersionId&&e.bindingVersionId===t.identity.bindingVersionId&&t.packageKey===p.key));
 const packageEnrolled=(p:Controller['packages'][number])=>enrolledFor(p).every(Boolean);
 const routeDescriptor=(descriptor:Controller['catalog'][number])=>descriptor.route.targetLanguage===c.languageContext.targetLanguageTag&&descriptor.route.supportLanguage===c.languageContext.supportLanguageTag;
 const routePackage=(pack:Controller['packages'][number])=>pack.content.targetLanguage===c.languageContext.targetLanguageTag&&pack.content.supportLanguage===c.languageContext.supportLanguageTag;
 const routePackages=c.packages.filter(routePackage);
 const officialItems=c.catalog.filter(routeDescriptor).map(descriptor=>{
  const releases=new Map<string,{version:number;memberCount:number;packages:Controller['packages']}>();
  for(const pack of routePackages){
   for(const publication of pack.portableOrigin.publications){
    if(publication.book.bookId!==descriptor.book.bookId)continue;
    const group=releases.get(publication.manifestSha256)??{version:publication.book.versionNumber,memberCount:publication.memberCount,packages:[]};
    if(!group.packages.some(candidate=>candidate.key===pack.key))group.packages.push(pack);
    releases.set(publication.manifestSha256,group);
   }
  }
  const complete=[...releases.entries()].filter(([,group])=>group.packages.length===group.memberCount);
  const exact=releases.get(descriptor.sha256),exactComplete=exact?.packages.length===descriptor.memberCount;
  const latest=complete.sort((left,right)=>right[1].version-left[1].version)[0];
  const installed=exactComplete?exact!.packages:latest?.[1].packages??[];
  const active=complete.find(([,group])=>group.packages.every(packageEnrolled));
  const baselineVersion=active?.[1].version??latest?.[1].version??null;
  const updateAvailable=baselineVersion!==null&&descriptor.book.versionNumber>baselineVersion;
  return {
   key:descriptor.book.bookId,
   title:descriptor.book.title,
   description:descriptor.book.description,
   count:descriptor.memberCount,
   descriptor,
   installed,
   updateAvailable,
   updateDownloaded:updateAvailable&&exactComplete,
   enrolled:!!active&&active[1].version>=descriptor.book.versionNumber,
  };
 });
 const catalogBookIds=new Set(officialItems.map(item=>item.key));
 const orphanGroups=new Map<string,Map<string,{publication:Controller['packages'][number]['portableOrigin']['publications'][number];packages:Controller['packages']}>>();
 for(const pack of routePackages){
  for(const publication of pack.portableOrigin.publications){
   if(catalogBookIds.has(publication.book.bookId))continue;
   const releases=orphanGroups.get(publication.book.bookId)??new Map();
   const group=releases.get(publication.manifestSha256)??{publication,packages:[]};
   if(!group.packages.some((candidate:Controller['packages'][number])=>candidate.key===pack.key))group.packages.push(pack);
   releases.set(publication.manifestSha256,group);
   orphanGroups.set(publication.book.bookId,releases);
  }
 }
 const orphanItems=[...orphanGroups.entries()].flatMap(([bookId,releases])=>{
  const latest=[...releases.values()]
   .filter(group=>group.packages.length===group.publication.memberCount)
   .sort((left,right)=>right.publication.book.versionNumber-left.publication.book.versionNumber)[0];
  return latest?[{
   key:bookId,
   title:latest.publication.book.title,
   description:latest.publication.book.description,
   count:latest.publication.memberCount,
   descriptor:undefined,
   installed:latest.packages,
   updateAvailable:false,
   updateDownloaded:false,
   enrolled:latest.packages.every(packageEnrolled),
  }]:[];
 });
 const localItems=routePackages.filter(pack=>
  !pack.portableOrigin.publications.length
  &&!catalogBookIds.has(pack.portableOrigin.manifest.metadata.packageId),
 ).map(pack=>({
  key:pack.portableOrigin.manifest.metadata.packageId,
  title:pack.portableOrigin.manifest.metadata.title,
  description:pack.portableOrigin.manifest.metadata.description,
  count:pack.content.entries.length,
  descriptor:undefined,
  installed:[pack],
  updateAvailable:false,
  updateDownloaded:false,
  enrolled:packageEnrolled(pack),
 }));
 const items=[...officialItems,...orphanItems,...localItems];
 const item=selected?items.find(candidate=>candidate.key===selected):undefined,installed=item?.installed??[],descriptor=item?.descriptor;
 const installedEntries=installed.flatMap(pack=>pack.content.entries.map((entry,index)=>({pack,entry,enrolled:enrolledFor(pack)[index]})));
 const normalized=query.trim().toLocaleLowerCase();
 const results=items.filter(p=>[p.title,p.description].join(' ').toLocaleLowerCase().includes(normalized));
 const stateLabel=(p:typeof items[number])=>localFlowText(p.updateDownloaded?'packageUpdateDownloaded':p.updateAvailable?'packageUpdateAvailable':p.enrolled?'enrolled':p.installed.length?'downloaded':'packageNotDownloaded');
 const importStateLabel=(preview:PortablePackagePreview)=>preview.status==='installed'
  ?localFlowText('downloaded')
  :preview.status==='update_available'
   ?localFlowText('packageUpdateAvailable')
   :preview.status==='version_conflict'
    ?localFlowNotice('localFlow.packageVersionChanged')
    :localFlowText('packageNotDownloaded');
 const notice=c.notice&&<p role="status" className="rounded-xl border border-border-subtle bg-surface-subtle p-4 text-sm leading-6">{localFlowNotice(c.notice)}</p>;
 const enrollInstalled=()=>{
  if(!installed.length)return;
  if(descriptor)void c.enrollBook(installed.map(pack=>pack.key),descriptor.sha256);
  else void c.enroll(installed[0]!.key);
 };
 return <LearningSetupFrame key={importCandidate?.preview.archiveDigest??selected??'catalog'} id="s-learning-entry" active={active} onBack={()=>importCandidate?setImportCandidate(null):selected?setSelected(null):onBack()} title={item||importCandidate?localFlowText('packageCatalogTitle'):undefined}>
  {importCandidate?<>
   <div className="mb-8 space-y-4">
    <span className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-action-primary"><Upload size={16}/>{importStateLabel(importCandidate.preview)}</span>
    <h2 ref={heading} tabIndex={-1} className="break-words text-3xl font-medium tracking-tight outline-none sm:text-4xl">{importCandidate.preview.package.metadata.title}</h2>
    {importCandidate.preview.package.metadata.description&&<p className="max-w-xl text-sm leading-7 text-fg-secondary">{importCandidate.preview.package.metadata.description}</p>}
    <p className="text-sm text-fg-secondary">{importCandidate.preview.package.route.targetLanguage} → {importCandidate.preview.package.route.supportLanguage}</p>
   </div>
   <section aria-label={localFlowText('packageContents')} className="mb-8 space-y-5 rounded-2xl border border-border-strong bg-surface-panel p-5 sm:p-6">
    <div><p className="break-words text-xl font-medium">{importCandidate.preview.package.targetExpression.text}</p><p className="mt-2 text-sm leading-6 text-fg-secondary">{importCandidate.preview.package.sense.meaning}</p></div>
    <p className="text-sm leading-6 text-fg-secondary">{importCandidate.preview.package.metadata.author.name} · {importCandidate.preview.package.metadata.license.name}</p>
    <p className="text-sm leading-6 text-fg-secondary">{localFlowText('packageExpressionCount',{count:1})}</p>
   </section>
   <section aria-label={localFlowText('packageActions')} className="space-y-4 rounded-2xl border border-border-strong bg-surface-panel p-5 sm:p-6">
    {notice}
    <p className="text-sm leading-6 text-fg-secondary">{localFlowText('importPackageHint')}</p>
    <div className="flex flex-wrap gap-3">
     <button className={setupButton} disabled={c.busy} onClick={()=>setImportCandidate(null)}>{localFlowText('cancel')}</button>
     <button className={setupPrimary} disabled={c.busy||importCandidate.preview.status==='version_conflict'} onClick={()=>void c.installImport(importCandidate.file,importCandidate.preview.archiveDigest).then(pack=>{if(!pack)return;setImportCandidate(null);if(pack.content.targetLanguage===c.languageContext.targetLanguageTag&&pack.content.supportLanguage===c.languageContext.supportLanguageTag)setSelected(pack.portableOrigin.manifest.metadata.packageId);})}><Upload size={18}/>{localFlowText(c.busy?'processing':'importPackage')}</button>
    </div>
   </section>
  </>:item?<>
   <div className="mb-8 space-y-4">
    <span className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-action-primary">{item.enrolled?<Check size={16}/>:<BookOpen size={16}/>} {stateLabel(item)}</span>
    <h2 ref={heading} tabIndex={-1} className="break-words text-3xl font-medium tracking-tight outline-none sm:text-4xl">{item.title}</h2>
    {item.description&&<p className="max-w-xl text-sm leading-7 text-fg-secondary">{item.description}</p>}
    <p className="text-sm text-fg-secondary">{localFlowText('packageExpressionCount',{count:item.count})}</p>
    {item.updateAvailable&&descriptor?.changeSummary&&<p className="max-w-xl text-sm leading-6 text-fg-secondary">{descriptor.changeSummary}</p>}
   </div>
   <section aria-label={localFlowText('packageActions')} className="mb-8 space-y-4 rounded-2xl border border-border-strong bg-surface-panel p-5 sm:p-6">
    {notice}
    {c.progress!==null&&downloadKey===item.key?<>
     <p role="status" className="text-sm">{localFlowText('downloading')}{c.progress}%</p>
     <progress aria-label={localFlowText('downloadPackage')} max={100} value={c.progress} className="h-2 w-full accent-action-primary"/>
     <button className={setupButton} onClick={c.cancelDownload}>{localFlowText('cancelDownload')}</button>
    </>:<>
     <p className="text-sm leading-6 text-fg-secondary">{localFlowText(item.updateDownloaded?'packageUpdateDownloadedHint':item.updateAvailable?'packageUpdateHint':item.enrolled?'packageReadyHint':installed[0]?.content.assurance?'assuranceMethodHint':installed.length?'packageJoinHint':'packageDownloadHint')}</p>
     <button className={setupPrimary+' w-full sm:w-auto'} disabled={c.busy||c.catalogBusy||(!installed.length&&!descriptor)} onClick={()=>{if(item.updateDownloaded&&installed.length)enrollInstalled();else if(item.updateAvailable&&descriptor){setDownloadKey(item.key);void c.download(descriptor).finally(()=>setDownloadKey(null));}else if(item.enrolled)onLearning();else if(installed.length)enrollInstalled();else if(descriptor){setDownloadKey(item.key);void c.download(descriptor).finally(()=>setDownloadKey(null));}}}>
      {item.enrolled?<ArrowRight size={18}/>:item.updateAvailable&&!item.updateDownloaded?<Download size={18}/>:item.updateDownloaded||installed.length?<Check size={18}/>:<Download size={18}/>}{localFlowText(c.busy?'processing':item.updateDownloaded?'applyPackageUpdate':item.updateAvailable?'downloadPackageUpdate':item.enrolled?'packageGoLearning':installed.length?'enroll':'downloadPackage')}
     </button>
     {installed.length===1&&<button className={setupButton+' w-full sm:w-auto'} disabled={c.busy} onClick={()=>void c.exportPackage(installed[0]!.key).then(result=>{if(!result)return;const url=URL.createObjectURL(new Blob([result.bytes.slice().buffer],{type:'application/vnd.sensa.package+zip'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=result.fileName;anchor.click();URL.revokeObjectURL(url);})}><Download size={18}/>{localFlowText('downloadPackage')}</button>}
    </>}
   </section>
   <section aria-label={localFlowText('packageContents')}>
    <h3 className="mb-4 text-lg font-medium">{localFlowText('packageContents')}</h3>
    {installedEntries.length?<ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-surface-panel">{installedEntries.map(({entry,enrolled:target})=><li key={`${entry.bindingVersionId}:${entry.senseVersionId}`} className="flex flex-wrap items-center justify-between gap-4 p-5">
     <div className="min-w-0 flex-1"><p className="break-words text-xl font-medium">{entry.expression}</p><p className="mt-2 text-sm leading-6 text-fg-secondary">{entry.meaning}</p></div>
     {target&&<button className={setupButton+' shrink-0'} aria-label={localFlowText('packageViewExpression',{expression:entry.expression})} onClick={()=>onTarget(target.targetId)}>{localFlowText('packageViewDetails')}<ArrowRight size={16}/></button>}
    </li>)}</ul>:<p className="rounded-2xl border border-dashed border-border-strong p-6 text-sm leading-6 text-fg-secondary">{localFlowText('packageContentsAfterDownload')}</p>}
   </section>
  </>:<>
   <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
    <h1 ref={heading} tabIndex={-1} className="text-3xl font-medium tracking-tight outline-none sm:text-4xl">{localFlowText('packageCatalogTitle')}</h1>
    <div className="flex flex-wrap gap-2">
     <button className={setupButton} disabled={c.catalogBusy} aria-busy={c.catalogBusy} onClick={()=>void c.reloadCatalog(true)}><RefreshCw size={16}/>{localFlowText(c.catalogBusy?'refreshingCatalog':'packageRefresh')}</button>
     <button className={setupButton} disabled={c.busy} onClick={()=>importInput.current?.click()}><Upload size={16}/>{localFlowText(c.busy?'processing':'importPackage')}</button>
    </div>
   </div>
   <div className="mb-6">{notice}</div>
   <div className="mb-8 flex min-h-14 items-center gap-3 rounded-2xl border border-border-strong bg-surface-panel px-4 focus-within:ring-2 focus-within:ring-focus">
    <Search size={20} className="shrink-0 text-fg-secondary" aria-hidden="true"/>
    <input type="search" aria-label={localFlowText('packageSearch')} placeholder={localFlowText('packageSearch')} value={query} onChange={e=>setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent py-4 text-sm outline-none"/>
    {query&&<button className={setupButton} onClick={()=>setQuery('')}>{localFlowText('packageClearSearch')}</button>}
   </div>
   <ul className="grid gap-4 sm:grid-cols-2">{results.map(p=><li key={p.key}><button onClick={()=>setSelected(p.key)} className="group flex h-full w-full flex-col gap-5 rounded-2xl border border-border-strong bg-surface-panel p-6 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
    <div className="flex w-full items-center justify-between gap-4"><BookOpen size={24} className="text-action-primary" aria-hidden="true"/><span className="rounded-lg bg-accent-soft px-3 py-1 text-xs text-action-primary">{downloadKey===p.key&&c.progress!==null?localFlowText('downloading')+c.progress+'%':stateLabel(p)}</span></div>
    <div className="min-w-0 w-full flex-1"><h3 className="break-words text-xl font-medium">{p.title}</h3>{p.description&&<p className="mt-3 line-clamp-3 text-sm leading-6 text-fg-secondary">{p.description}</p>}</div>
    <div className="flex w-full items-center justify-between gap-3 text-sm text-fg-secondary"><span>{localFlowText('packageExpressionCount',{count:p.count})}</span><ArrowRight size={18} aria-hidden="true"/></div>
   </button></li>)}</ul>
   {!results.length&&<div role="status" className="rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center"><BookOpen size={32} className="mx-auto mb-4 text-fg-tertiary" aria-hidden="true"/><h3 className="text-lg font-medium">{localFlowText(c.catalogBusy&&!items.length?'packageLoading':query?'packageNoResults':'packageEmpty')}</h3></div>}
  </>}
  <input ref={importInput} hidden tabIndex={-1} aria-label={localFlowText('importPackage')} type="file" accept=".sensa,application/zip,application/octet-stream" disabled={c.busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void c.previewImport(file).then(preview=>{if(preview){setSelected(null);setImportCandidate({file,preview});}});}}/>
 </LearningSetupFrame>;
}
export function PackageTarget({active,target,c,onBack,onHome,onStart,onSource}:{active:boolean;target:LearningTargetProjection;c:Controller;onBack:()=>void;onHome:()=>void;onStart:()=>void;onSource?:()=>void}){
 useTranslation();
 const [editingPolicy,setEditingPolicy]=useState(false);
 const canSelectPolicy=target.allowedPolicies.length>1&&!target.started;
 const inActiveRun=!!c.runtime?.targetIds.includes(target.targetId);
 return <><LearningTargetDetailScreen active={active} target={target.presentation} selectedPolicy={target.policy} fixedPolicy={!canSelectPolicy} preparation={target.preparation} committedPolicy={target.committedPolicy} initialCompletionKind={target.completed?'study_completion':null} reviewDue={target.reviewDue} relearning={target.relearning} retentionRuntimeState={null} nextReviewLabel={target.nextReviewAt?new Date(target.nextReviewAt).toLocaleString(i18n.language):null} declaredMastery={target.declaredMastery} isAdded onBack={onBack} onAdd={()=>{}} onOpenPolicy={()=>setEditingPolicy(true)} onOpenSource={onSource??onBack} onRefreshPreparation={()=>void c.refresh()} onGoHome={onHome} onStartReview={onStart} onContinueRetentionRuntime={onStart} onContinueRuntime={onStart} onRevokeDeclaredMastery={()=>void c.declareKnown(target.targetId,false)} notice={c.notice&&<p role="status">{localFlowNotice(c.notice)}</p>} actions={<><LearningResourceDetails material={target.material}/>{target.studyContent&&<StudyResources content={target.studyContent}/>}{target.declaredMastery?<button className={setupPrimary} disabled={c.busy} onClick={()=>void c.declareKnown(target.targetId,false)}>{cardText('revokeKnown')}</button>:<button className={setupPrimary} disabled={c.busy||target.preparation!=='ready'||target.completed&&!target.reviewDue&&!inActiveRun} onClick={onStart}>{target.completed?localFlowText('startReview'):localFlowText('startLearning')}</button>}</>}/>{editingPolicy&&canSelectPolicy&&<LearningPreferencesPanel policyOptions={c.policyOptions} closeLabel={i18n.t('learningPreferences.finishSelection')} allowedPolicies={target.allowedPolicies} showDailyQuantity={false} defaultPolicy={target.policy} dailyNewCount={c.dailyLimit??20} onDailyNewCountChange={()=>{}} onPolicyChange={value=>{void c.selectPolicy(target.targetId,value);}} busy={c.busy} status={c.notice&&<p role="status">{c.notice}</p>} onClose={()=>setEditingPolicy(false)}/>}</>;
}
