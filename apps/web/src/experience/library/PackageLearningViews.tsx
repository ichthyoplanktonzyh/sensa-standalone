import {learningPolicyProfileRegistry} from '../../learning/runtime/policyProfiles';
import {LearningPreferencesPanel} from '../components/learning/LearningPreferencesPanel';
import {localRunTargetIds} from '../../data/library/learning';
import {assuranceContent} from '../../learning/protocols/assurance';
import {cardText} from '../../i18n/originalCards';
import {localTargetPolicy} from '../../learning/runtime/localRuntimeBindings';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';
import {StudyResources} from '../components/learning/StudyResources';
import {LearningResourceDetails} from '../components/learning/LearningResourceDetails';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import i18n from '../../i18n/index';
import {useState,useRef,useEffect} from 'react';
import {ArrowRight,BookOpen,Search,RefreshCw,Upload,Check,Download} from 'lucide-react';
import {learningBundleBookId,learningBundleVersionNumber,learningBundleTitle,learningBundleDescription,learningDescriptorBookId,learningDescriptorVersionNumber,learningDescriptorTitle,learningDescriptorDescription} from '@sensa/contracts/sensa';
import {LearningTargetDetailScreen} from '../components/learning/LearningTargetDetailScreen';
import {packageKey} from '../../data/library/packageRecords';
import type {LocalLearningTarget} from '../../data/library/learning';
import type {usePackageLearning} from './usePackageLearning';
import {LearningSetupFrame,setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {localTargetView} from './localTargetView';
import {useScreenState} from '../ui/ScreenHost';
type Controller=ReturnType<typeof usePackageLearning>;
export function PackageEntry({active,c,onBack,onLearning,onTarget}:{active:boolean;c:Controller;onBack:()=>void;onLearning:()=>void;onTarget:(id:string)=>void}){
 useTranslation();
 const [selected,setSelected]=useState<string|null>(null),[query,setQuery]=useScreenState('learning-entry:query',''),[downloadKey,setDownloadKey]=useState<string|null>(null);
 const importInput=useRef<HTMLInputElement>(null),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(!active)setSelected(null);},[active]);
 useEffect(()=>{if(active)heading.current?.focus({preventScroll:true});},[selected,active]);
 const enrolledFor=(p:Controller['packages'][number])=>p.bundle.entries.map(e=>c.targets.find(t=>e.senseVersionId===t.identity.senseVersionId&&e.bindingVersionId===t.identity.bindingVersionId&&c.membershipByTarget[t.id]?.packageKey===p.key));
 const routeDescriptor=(descriptor:Controller['catalog'][number])=>!('format' in descriptor)||descriptor.targetLanguage===c.languageContext.targetLanguageTag&&descriptor.supportLanguage===c.languageContext.supportLanguageTag;
 const routePackage=(pack:Controller['packages'][number])=>pack.bundle.targetLanguage===c.languageContext.targetLanguageTag&&pack.bundle.supportLanguage===c.languageContext.supportLanguageTag;
 const bookIds=new Set([...c.catalog.filter(routeDescriptor).map(learningDescriptorBookId),...c.packages.filter(routePackage).map(pack=>learningBundleBookId(pack.bundle))]);
 const items=[...bookIds].map(bookId=>{
  const descriptor=c.catalog.filter(candidate=>routeDescriptor(candidate)&&learningDescriptorBookId(candidate)===bookId).sort((left,right)=>learningDescriptorVersionNumber(right)-learningDescriptorVersionNumber(left))[0];
  const releases=c.packages.filter(pack=>routePackage(pack)&&learningBundleBookId(pack.bundle)===bookId).sort((left,right)=>learningBundleVersionNumber(right.bundle)-learningBundleVersionNumber(left.bundle));
  const exact=descriptor?releases.find(pack=>pack.key===packageKey(descriptor)):undefined,latestInstalled=releases[0],activeRelease=releases.find(pack=>enrolledFor(pack).every(Boolean));
  const installed=exact??latestInstalled,baseline=activeRelease??latestInstalled,updateAvailable=!!descriptor&&!!baseline&&learningDescriptorVersionNumber(descriptor)>learningBundleVersionNumber(baseline.bundle),updateDownloaded=updateAvailable&&!!exact;
  const enrolled=!!activeRelease&&(!descriptor||learningBundleVersionNumber(activeRelease.bundle)>=learningDescriptorVersionNumber(descriptor));
  return {key:bookId,title:descriptor?learningDescriptorTitle(descriptor):learningBundleTitle(installed!.bundle),description:descriptor?learningDescriptorDescription(descriptor):learningBundleDescription(installed!.bundle),count:descriptor?.entryCount??installed!.bundle.entries.length,descriptor,installed,activeRelease,updateAvailable,updateDownloaded,enrolled};
 });
 const item=selected?items.find(candidate=>candidate.key===selected):undefined,installed=item?.installed,descriptor=item?.descriptor;
 const enrolled=installed?enrolledFor(installed):[];
 const normalized=query.trim().toLocaleLowerCase();
 const results=items.filter(p=>[p.title,p.description].join(' ').toLocaleLowerCase().includes(normalized));
 const stateLabel=(p:typeof items[number])=>localFlowText(p.updateDownloaded?'packageUpdateDownloaded':p.updateAvailable?'packageUpdateAvailable':p.enrolled?'enrolled':p.installed?'downloaded':'packageNotDownloaded');
 const notice=c.notice&&<p role="status" className="rounded-xl border border-border-subtle bg-surface-subtle p-4 text-sm leading-6">{localFlowNotice(c.notice)}</p>;
 return <LearningSetupFrame key={selected??'catalog'} id="s-learning-entry" active={active} onBack={()=>selected?setSelected(null):onBack()} title={item?localFlowText('packageCatalogTitle'):undefined}>
  {item?<>
   <div className="mb-8 space-y-4">
    <span className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-action-primary">{item.enrolled?<Check size={16}/>:<BookOpen size={16}/>} {stateLabel(item)}</span>
    <h2 ref={heading} tabIndex={-1} className="break-words text-3xl font-medium tracking-tight outline-none sm:text-4xl">{item.title}</h2>
    {item.description&&<p className="max-w-xl text-sm leading-7 text-fg-secondary">{item.description}</p>}
    <p className="text-sm text-fg-secondary">{localFlowText('packageExpressionCount',{count:item.count})}</p>
    {item.updateAvailable&&descriptor&&'format' in descriptor&&descriptor.changeSummary&&<p className="max-w-xl text-sm leading-6 text-fg-secondary">{descriptor.changeSummary}</p>}
   </div>
   <section aria-label={localFlowText('packageActions')} className="mb-8 space-y-4 rounded-2xl border border-border-strong bg-surface-panel p-5 sm:p-6">
    {notice}
    {c.progress!==null&&downloadKey===item.key?<>
     <p role="status" className="text-sm">{localFlowText('downloading')}{c.progress}%</p>
     <progress aria-label={localFlowText('downloadPackage')} max={100} value={c.progress} className="h-2 w-full accent-action-primary"/>
     <button className={setupButton} onClick={c.cancelDownload}>{localFlowText('cancelDownload')}</button>
    </>:<>
     <p className="text-sm leading-6 text-fg-secondary">{localFlowText(item.updateDownloaded?'packageUpdateDownloadedHint':item.updateAvailable?'packageUpdateHint':item.enrolled?'packageReadyHint':installed?.bundle.assurance?'assuranceMethodHint':installed?'packageJoinHint':'packageDownloadHint')}</p>
     <button className={setupPrimary+' w-full sm:w-auto'} disabled={c.busy||(!installed&&!descriptor)} onClick={()=>{if(item.updateDownloaded&&installed)void c.enroll(installed.key);else if(item.updateAvailable&&descriptor){setDownloadKey(item.key);void c.download(descriptor).finally(()=>setDownloadKey(null));}else if(item.enrolled)onLearning();else if(installed)void c.enroll(installed.key);else if(descriptor){setDownloadKey(item.key);void c.download(descriptor).finally(()=>setDownloadKey(null));}}}>
      {item.enrolled?<ArrowRight size={18}/>:item.updateAvailable&&!item.updateDownloaded?<Download size={18}/>:item.updateDownloaded||installed?<Check size={18}/>:<Download size={18}/>}{localFlowText(c.busy?'processing':item.updateDownloaded?'applyPackageUpdate':item.updateAvailable?'downloadPackageUpdate':item.enrolled?'packageGoLearning':installed?'enroll':'downloadPackage')}
     </button>
    </>}
   </section>
   <section aria-label={localFlowText('packageContents')}>
    <h3 className="mb-4 text-lg font-medium">{localFlowText('packageContents')}</h3>
    {installed?<ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-surface-panel">{installed.bundle.entries.map((e,index)=><li key={e.bindingVersionId} className="flex flex-wrap items-center justify-between gap-4 p-5">
     <div className="min-w-0 flex-1"><p className="break-words text-xl font-medium">{e.expression}</p><p className="mt-2 text-sm leading-6 text-fg-secondary">{e.meaning}</p></div>
     {enrolled[index]&&<button className={setupButton+' shrink-0'} aria-label={localFlowText('packageViewExpression',{expression:e.expression})} onClick={()=>onTarget(enrolled[index]!.id)}>{localFlowText('packageViewDetails')}<ArrowRight size={16}/></button>}
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
  <input ref={importInput} hidden tabIndex={-1} aria-label={localFlowText('importPackage')} type="file" accept="application/json,.json" disabled={c.busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void c.importFile(file).then(p=>{if(p)setSelected(learningBundleBookId(p.bundle));});}}/>
 </LearningSetupFrame>;
}
export function PackageTarget({active,target,c,onBack,onHome,onStart,onSource}:{active:boolean;target:LocalLearningTarget;c:Controller;onBack:()=>void;onHome:()=>void;onStart:()=>void;onSource?:()=>void}){
 useTranslation();
 const membership=c.membershipByTarget[target.id];
 if(!membership)throw new Error('localFlow.routeMembershipMissing');
 const pack=c.packages.find(p=>p.key===membership.packageKey);
 const policy=localTargetPolicy(target);
 const [editingPolicy,setEditingPolicy]=useState(false);
 const readiness=c.readinessByTarget[target.id]??'blocked';
 const canSelectPolicy=!!membership.assurancePackageKey&&!target.startedAt;
 const content=pack&&membership.assurancePackageKey?assuranceContent(pack,membership.assurancePackageKey).template.content:null;
 const declaredMastery=hasDeclaredMasteryOverride(target);
 return <><LearningTargetDetailScreen active={active} target={localTargetView(target,membership,readiness)} selectedPolicy={policy} fixedPolicy={!canSelectPolicy} preparation={readiness} committedPolicy={target.committedPolicy?policy:null} initialCompletionKind={target.completedAt?'study_completion':null} reviewDue={c.due.includes(target)} relearning={!!target.relearnAt} retentionRuntimeState={null} nextReviewLabel={target.memory?.dueAt.toLocaleString(i18n.language)??null} declaredMastery={declaredMastery} isAdded onBack={onBack} onAdd={()=>{}} onOpenPolicy={()=>setEditingPolicy(true)} onOpenSource={onSource??onBack} onRefreshPreparation={()=>void c.refresh()} onGoHome={onHome} onStartReview={onStart} onContinueRetentionRuntime={onStart} onContinueRuntime={onStart} onRevokeDeclaredMastery={()=>void c.declareKnown(target.id,false)} notice={c.notice&&<p role="status">{localFlowNotice(c.notice)}</p>} actions={<><LearningResourceDetails material={membership.material}/>{content&&<StudyResources content={content}/>}{declaredMastery?<button className={setupPrimary} disabled={c.busy} onClick={()=>void c.declareKnown(target.id,false)}>{cardText('revokeKnown')}</button>:<button className={setupPrimary} disabled={c.busy||readiness!=='ready'||!!target.completedAt&&!c.due.includes(target)&&(!c.run||!localRunTargetIds(c.run).includes(target.id))} onClick={onStart}>{target.completedAt?localFlowText('startReview'):localFlowText('startLearning')}</button>}</>}/>{editingPolicy&&canSelectPolicy&&<LearningPreferencesPanel closeLabel={i18n.t('learningPreferences.finishSelection')} allowedPolicies={learningPolicyProfileRegistry.list().filter(p=>p.localSelectable).map(p=>p.profileId)} showDailyQuantity={false} defaultPolicy={policy} dailyNewCount={c.dailyLimit??20} onDailyNewCountChange={()=>{}} onPolicyChange={value=>{void c.selectPolicy(target.id,value);}} busy={c.busy} status={c.notice&&<p role="status">{c.notice}</p>} onClose={()=>setEditingPolicy(false)}/>}</>;
}
