import {InterleavedFourStageRuntimeScreen} from '../components/learning/InterleavedFourStageRuntimeScreen';
import {InterleavedFourStageReviewScreen} from '../components/learning/InterleavedFourStageReviewScreen';
import {InterleavedFourStageQueue,InterleavedFourStageReviewQueue} from '../../learning/runtime/interleavedFourStageProtocol';
import {fourStageQueue,fourStageContent,type FourStageAction} from '../../learning/protocols/fourStage';
import {learningPolicyProfileRegistry} from '../../learning/runtime/policyProfiles';
import {LearningPreferencesPanel} from '../components/learning/LearningPreferencesPanel';
import {localRunTargetIds} from '../../data/library/learning';
import {assuranceContent,localAssuranceState} from '../../learning/protocols/assurance';
import {cardText} from '../../i18n/originalCards';
import {RuntimeTools} from '../components/learning/RuntimeTools';
import {localRunBinding,localTargetPolicy} from '../../learning/runtime/localRuntimeBindings';
import {learningRuntimeCoordinator,localExecutionForRun} from '../../learning/runtime/runtimeCoordinator';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';
import {
 LocalRuntimePresentationRegistry,
 immutablePresentationSnapshot,
 localRuntimePresentationContractVersion,
 localRuntimePresentationRequest,
 type LocalRuntimePresentationBinding,
 type LocalRuntimePresentationPlugin,
} from '../learningRuntime/localRuntimePresentations';
import type {AssuranceSupportHost} from './AssuranceLearningViews';
import {AssuranceRuntime,StudyResources} from './AssuranceLearningViews';
import {LearningResourceDetails} from '../components/learning/LearningResourceDetails';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import i18n from '../../i18n/index';
import {useState,useRef,useEffect,useMemo} from 'react';
import {ArrowRight,BookOpen,Search,RefreshCw,Upload,Check,Download} from 'lucide-react';
import {learningBundleBookId,learningBundleBookVersionId,learningBundleContentReleaseId,learningBundleVersionNumber,learningBundleTitle,learningBundleDescription,learningDescriptorBookId,learningDescriptorVersionNumber,learningDescriptorTitle,learningDescriptorDescription} from '@sensa/contracts/sensa';
import {stableUuid} from '@sensa/learning-kernel';
import {LearningTargetDetailScreen} from '../components/learning/LearningTargetDetailScreen';
import {LightweightRuntimeStartScreen} from '../components/learning/LightweightRuntimeStartScreen';
import {localLightweightPhase,localLightweightStep} from '../../learning/runtime/lightweightInitialProtocol';
import {packageKey,type InstalledPackage} from '../../data/library/packages';
import type {LocalLearningRun,LocalLearningTarget} from '../../data/library/learning';
import {localProtocolActiveTargetId,localProtocolStepId,type LocalCurriculumMembership,type LocalExecutableLearningTarget,type LocalLearningAction} from '../../learning/runtime/localProtocol';
import {localCurriculumMeaning,localExecutableTargetForParticipant,localLastPresentedMaterial,localPresentedMaterial} from '../../learning/runtime/localCurriculum';
import type {usePackageLearning} from './usePackageLearning';
import {LearningSetupFrame,setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {contentAnnotations} from '../../data/library/contentAnnotations';
import {useJourneyGateway} from '../personalMeaningJourney';
type Controller=ReturnType<typeof usePackageLearning>;
export const localTargetView=(t:LocalLearningTarget,membership:LocalCurriculumMembership,readiness:'ready'|'blocked'='ready')=>({targetId:t.id,expression:t.expression,meaning:localCurriculumMeaning(membership),targetLanguageTag:t.targetLanguageTag,supportLanguageTag:membership.languageContext.supportLanguageTag,example:String(membership.material.content.resources.find(r=>r.materialRoleKey==='usage_guidance')?.contentPayload.example??''),partOfSpeech:'',expressionTypeLabel:localFlowText('expression'),sourceKind:membership.packageKey?'book' as const:'personal_semantic_world' as const,sourceLabel:membership.packageKey?localFlowText('downloadedPackages'):localFlowText('semanticWorld'),runtimeSenseId:null,personalExperienceGrounding:null,policy:localTargetPolicy(t),lightweightReadiness:{status:readiness,label:readiness==='ready'?localFlowText('downloaded'):localFlowText('prepareResources'),detail:readiness==='ready'?localFlowText('resourcesLocal'):localFlowText('resourceInvalid')}});
export function PackageEntry({active,c,onBack,onLearning,onTarget}:{active:boolean;c:Controller;onBack:()=>void;onLearning:()=>void;onTarget:(id:string)=>void}){
 useTranslation();
 const [selected,setSelected]=useState<string|null>(null),[query,setQuery]=useState(''),[downloadKey,setDownloadKey]=useState<string|null>(null);
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
type PackageRuntimeProps={active:boolean;c:Controller;host:AssuranceSupportHost;onExit:()=>void;onFinish:()=>void};
type RuntimePresentationProps={
 active:boolean;
 run:LocalLearningRun;
 targets:readonly LocalExecutableLearningTarget[];
 packages:readonly InstalledPackage[];
 busy:boolean;
 notice:string;
 hasNextTarget:boolean;
 host:Partial<AssuranceSupportHost>;
 dispatch:(action:LocalLearningAction)=>void;
 declareMastery:(targetId:string,active?:boolean)=>Promise<unknown>;
 onExit:()=>void;
 onFinish:()=>void;
};
export function PackageRuntime(props:PackageRuntimeProps){
 const run=props.c.run;
 const snapshot=useMemo(()=>{
  if(!run)return immutablePresentationSnapshot({run:run!,targets:[],packages:[]});
  const execution=localExecutionForRun(run),activeTargetId=localProtocolActiveTargetId(execution,run),stepId=run.completedAt?null:localProtocolStepId(execution,run);
  const targets=props.c.targets.filter(target=>localRunTargetIds(run).includes(target.id)).map(target=>{
   const participant=run.participants[target.id]!;
   const material=run.completedAt?localLastPresentedMaterial(participant):target.id===activeTargetId&&stepId?localPresentedMaterial(participant,stepId):participant.material;
   return localExecutableTargetForParticipant(target,participant,material);
  });
  return immutablePresentationSnapshot({run,targets,packages:props.c.packages.filter(pack=>targets.some(target=>target.packageKey===pack.key))});
 },[run,props.c.targets,props.c.packages]);
 if(!run)return <LightweightRuntimeStartScreen active={props.active} target={null} materialization={null} step={null} completed={false} hasNextTarget={false} onExit={props.onExit} onReveal={()=>{}} onRate={()=>{}} onFinish={props.onFinish}/>;
 const surface=learningRuntimeCoordinator.adapterForBinding(localRunBinding(run)).surfaceFor(run.purpose);
 const request=localRuntimePresentationRequest(run,surface);
 const plugin=localRuntimePresentationRegistry.resolve(request);
 const Surface=plugin.render;
 const capabilities=new Set(plugin.manifest.capabilities);
 const host:Partial<AssuranceSupportHost>={
  ...(capabilities.has('toast')?{toast:props.host.toast}:{}),
  ...(capabilities.has('dictionary')?{openDict:props.host.openDict,lookupDictionary:props.host.lookupDictionary}:{}),
  ...(capabilities.has('notes')?{openNoteEditor:props.host.openNoteEditor}:{}),
  ...(capabilities.has('personal_scenes')?{openSceneEditor:props.host.openSceneEditor}:{}),
  ...(capabilities.has('personal_content_menu')?{onOpenMenuMore:props.host.onOpenMenuMore}:{}),
 };
 const declareMastery=capabilities.has('declared_mastery')
  ?(targetId:string,active=true)=>props.c.declareKnown(targetId,active)
  :async()=>{throw new Error('Presentation plugin did not declare declared_mastery.');};
 return <Surface active={props.active} {...snapshot} busy={props.c.busy} notice={props.c.notice} hasNextTarget={!!props.c.nextTarget} host={host} dispatch={action=>{if(!props.c.busy)void props.c.act(action);}} declareMastery={declareMastery} onExit={props.onExit} onFinish={props.onFinish}/>;
}
function requireHost(host:Partial<AssuranceSupportHost>,capability:string):AssuranceSupportHost{
 if(!host.toast||!host.openDict||!host.openNoteEditor||!host.openSceneEditor||!host.lookupDictionary||!host.onOpenMenuMore)throw new Error(`Presentation capability ${capability} is unavailable.`);
 return host as AssuranceSupportHost;
}
function StructuredPackageRuntime({active,run,targets,packages,busy,notice,dispatch,declareMastery,onExit,onFinish,host}:RuntimePresentationProps){
 const target=targets.find(t=>t.id===run.targetId),pack=packages.find(p=>p.key===target?.packageKey);
 if(!target||!pack)throw new Error('Missing structured runtime resources');
 localAssuranceState(run);
 return <AssuranceRuntime host={requireHost(host,'structured_support')} key={run.id+':'+run.revision} active={active} run={run} target={target} pack={pack} busy={busy} notice={notice} onMarkKnown={()=>void declareMastery(target.id).then(ok=>{if(ok)onExit();})} onAction={dispatch} onExit={onExit} onFinish={onFinish}/>;
}
function LightweightPackageRuntime({active,run,targets,packages,busy,notice,hasNextTarget,dispatch,declareMastery,onExit,onFinish,host}:RuntimePresentationProps){
 useTranslation();
 const journeyGateway=useJourneyGateway();
 const [,setAnnotationRevision]=useState(0),[savingWorld,setSavingWorld]=useState(false);
 useEffect(()=>contentAnnotations.subscribe(()=>setAnnotationRevision(value=>value+1)),[]);
 const target=targets.find(t=>t.id===run.targetId);
 if(!target)throw new Error('Missing lightweight runtime target');
 // Reuse the existing role-based card presentations; formal transitions remain in the local core.
 const material=target.material;
 const phase=localLightweightPhase(run);
 const step=localLightweightStep(run,target,material);
 const content={senseKey:String(material.snapshot.provenance.senseId),lemma:target.expression,guideLabelL1:target.meaning};
 const lightweightHost=host as Pick<AssuranceSupportHost,'onOpenMenuMore'|'openSceneEditor'|'toast'>;
 if(!lightweightHost.onOpenMenuMore||!lightweightHost.openSceneEditor||!lightweightHost.toast)throw new Error('Presentation capability lightweight_support is unavailable.');
 const scene=contentAnnotations.getLearningScene(target.id,target.curriculumMembership.languageContext.languageRouteId),sceneRevision=scene?contentAnnotations.getLearningSceneRevision(scene):null;
 const pack=target.packageKey?packages.find(candidate=>candidate.key===target.packageKey):undefined;
 const bookBundle=pack?.bundle.format==='sensa-book-release-bundle-v1'?pack.bundle:null;
 const entry=bookBundle?.entries.find(candidate=>candidate.senseVersionId===target.identity.senseVersionId&&candidate.bindingVersionId===target.identity.bindingVersionId);
 const canAccept=!!scene&&!!sceneRevision&&!!pack&&!!bookBundle&&!!entry;
 const worldState=!canAccept?null:savingWorld?'saving':scene.acceptedRevisionId===sceneRevision.revisionId?'saved':scene.acceptedPersonalMeaningId?'update':'available';
 const openPersonalScene=()=>lightweightHost.openSceneEditor(content,undefined,{learningTargetId:target.id,languageRouteId:target.curriculumMembership.languageContext.languageRouteId,curriculumMembershipId:target.curriculumMembership.id,senseId:target.identity.senseId,senseVersionId:target.identity.senseVersionId,bindingVersionId:target.identity.bindingVersionId});
 const acceptPersonalScene=async()=>{
  if(!canAccept||!scene||!sceneRevision||!pack||!bookBundle||!entry)return;
  const bookVersionId=learningBundleBookVersionId(bookBundle),contentReleaseId=learningBundleContentReleaseId(bookBundle);
  if(!bookVersionId||!contentReleaseId)return;
  setSavingWorld(true);
  try{
   const operationId=stableUuid(`learning-scene-semantic-acceptance:${sceneRevision.revisionId}`),result=await journeyGateway.acceptPublishedLearningScene({operationId,existingPersonalMeaningId:scene.acceptedPersonalMeaningId,source:{packageKey:pack.key,bookId:learningBundleBookId(bookBundle),bookVersionId,contentReleaseId,publishedAt:bookBundle.publishedAt,title:learningBundleTitle(bookBundle)},target:{learningTargetId:target.id,curriculumMembershipId:target.curriculumMembership.id,senseId:target.identity.senseId,senseVersionId:target.identity.senseVersionId,bindingId:target.identity.senseExpressionBindingId,bindingVersionId:target.identity.bindingVersionId,expression:target.expression,targetLanguageTag:target.targetLanguageTag},semantic:entry.semantic,scene:{...sceneRevision,sceneId:scene.sceneId}});
   await contentAnnotations.markLearningSceneAccepted({operationId:stableUuid(`learning-scene-semantic-link:${sceneRevision.revisionId}`),sceneId:scene.sceneId,revisionId:sceneRevision.revisionId,personalMeaningId:result.personalMeaningId});
   lightweightHost.toast(i18n.t('runtime.semanticWorldSaved'));
  }catch{lightweightHost.toast(i18n.t('runtime.semanticWorldSaveFailed'));}finally{setSavingWorld(false);}
 };
 return <><LightweightRuntimeStartScreen tools={!run.completedAt&&<RuntimeTools content={content} personalContent={phase==='reveal'?content:null} showSave={phase==='reveal'} onMarkKnown={()=>void declareMastery(target.id).then(ok=>{if(ok)onExit();})} onOpenMenuMore={lightweightHost.onOpenMenuMore} toast={lightweightHost.toast} busy={busy||savingWorld}/>} active={active} target={localTargetView(target,target.curriculumMembership)} materialization={material} step={run.completedAt?null:step} completed={!!run.completedAt} hasNextTarget={hasNextTarget} onExit={onExit} onReveal={()=>dispatch({kind:'reveal'})} onRate={rating=>dispatch({kind:'rate',rating})} onFinish={onFinish} personalScene={sceneRevision} onOpenPersonalScene={run.purpose==='initial_learning'?openPersonalScene:undefined} semanticWorldState={phase==='reveal'?worldState:null} onSaveToSemanticWorld={acceptPersonalScene} purpose={run.purpose} completionDetail={target.relearnAt?localFlowText('nextRelearning',{date:new Date(target.relearnAt).toLocaleString(i18n.language)}):target.memory?localFlowText('nextReview',{date:target.memory.dueAt.toLocaleString(i18n.language)}):localFlowText('progressSaved')} completionLabel={run.purpose==='initial_learning'?localFlowText('initialCompleted'):run.purpose==='retention_review'?localFlowText('reviewCompleted'):localFlowText('relearningCompleted')}/>{active&&notice&&<p role="status" className="fixed bottom-4 left-4 right-4 z-[100] rounded-xl bg-accent-soft p-3">{localFlowNotice(notice)}</p>}</>;
}

function fourStagePresentation(props:RuntimePresentationProps){
 const {run}=props;
 const queue=fourStageQueue(run),session=queue.getCurrentSession();
 const target=props.targets.find(t=>t.id===session?.targetId);
 const pack=props.packages.find(p=>p.key===target?.packageKey);
 const content=target?fourStageContent(target,pack):null;
 return {run,queue,session,content,target:target&&content?{expression:target.expression,meaning:target.meaning,example:content.learningExamples[0]?.textL2??'',partOfSpeech:''}:null};
}
function FourStageInitialPackageRuntime(props:RuntimePresentationProps){
 const {active,busy,notice,dispatch,onExit,onFinish}=props;
 const {queue,target,content}=fourStagePresentation(props);
 if(!(queue instanceof InterleavedFourStageQueue))throw new Error('Invalid initial queue');
 const act=(response:FourStageAction['response'])=>dispatch({kind:'protocol',response});
 return <InterleavedFourStageRuntimeScreen active={active} onExit={onExit} onFinish={onFinish} execution={{session:queue.getCurrentSession(),projection:queue.getProjection(),target,content,busy,notice:notice&&<p role="alert">{notice}</p>,onChoice:optionId=>act({kind:'choice',optionId}),onSelfReport:known=>act({kind:'self_report',known}),onContinue:()=>act({kind:'continue'})}}/>;
}
function FourStageReviewPackageRuntime(props:RuntimePresentationProps){
 const {active,busy,notice,dispatch,onExit,onFinish}=props;
 const {run,queue,target}=fourStagePresentation(props);
 if(!(queue instanceof InterleavedFourStageReviewQueue))throw new Error('Invalid review queue');
 const act=(response:FourStageAction['response'])=>dispatch({kind:'protocol',response});
 return <InterleavedFourStageReviewScreen active={active} onExit={onExit} onFinish={onFinish} execution={{session:queue.getCurrentSession(),target,done:!!run.completedAt,targetCount:localRunTargetIds(run).length,busy,notice:notice&&<p role="alert">{notice}</p>,onAnswer:answer=>act({kind:'review',answer}),onContinue:()=>act({kind:'continue'})}}/>;
}

const LIGHTWEIGHT_PRESENTATION_BINDINGS=Object.freeze([
 {surface:'lightweight_initial',runtimeAdapterId:'lightweight',purpose:'initial_learning',protocolId:'lightweight-study',protocolVersion:'v2',localProtocolVersion:'sensa-lightweight-initial-v1'},
 {surface:'lightweight_retention',runtimeAdapterId:'lightweight',purpose:'retention_review',protocolId:'learner-rated-retention-review',protocolVersion:'v1',localProtocolVersion:'sensa-lightweight-review-v1'},
 {surface:'lightweight_retention',runtimeAdapterId:'lightweight',purpose:'relearning',protocolId:'lightweight-rebinding',protocolVersion:'v1',localProtocolVersion:'sensa-lightweight-relearning-v1'},
] as const satisfies readonly LocalRuntimePresentationBinding[]);

const STRUCTURED_PRESENTATION_BINDINGS=Object.freeze([
 {surface:'structured_session',runtimeAdapterId:'structured',purpose:'initial_learning',protocolId:'structured-acquisition',protocolVersion:'v1',localProtocolVersion:'sensa-high-assurance-v1'},
 {surface:'structured_session',runtimeAdapterId:'structured',purpose:'retention_review',protocolId:'evidence-oriented-retention-review',protocolVersion:'v1',localProtocolVersion:'sensa-high-assurance-v1'},
 {surface:'structured_session',runtimeAdapterId:'structured',purpose:'relearning',protocolId:'targeted-structured-relearning',protocolVersion:'v1',localProtocolVersion:'sensa-high-assurance-v1'},
] as const satisfies readonly LocalRuntimePresentationBinding[]);

const FOUR_STAGE_PRESENTATION_BINDINGS=Object.freeze([
 {surface:'interleaved_four_stage',runtimeAdapterId:'interleaved_four_stage',purpose:'initial_learning',protocolId:'interleaved-four-stage-acquisition',protocolVersion:'v1',localProtocolVersion:'sensa-four-stage-v1'},
 {surface:'interleaved_four_stage_review',runtimeAdapterId:'interleaved_four_stage',purpose:'retention_review',protocolId:'interleaved-four-stage-retention',protocolVersion:'v1',localProtocolVersion:'sensa-four-stage-v1'},
 {surface:'interleaved_four_stage_review',runtimeAdapterId:'interleaved_four_stage',purpose:'relearning',protocolId:'interleaved-four-stage-relearning',protocolVersion:'v1',localProtocolVersion:'sensa-four-stage-v1'},
] as const satisfies readonly LocalRuntimePresentationBinding[]);

const lightweightPresentationPlugin:LocalRuntimePresentationPlugin<RuntimePresentationProps>={
 manifest:{contractVersion:localRuntimePresentationContractVersion,pluginId:'sensa.web.lightweight',pluginVersion:'v1',displayName:'Sensa Lightweight Runtime',capabilities:['toast','personal_scenes','personal_content_menu','declared_mastery'],bindings:[...LIGHTWEIGHT_PRESENTATION_BINDINGS]},
 render:LightweightPackageRuntime,
};
const structuredPresentationPlugin:LocalRuntimePresentationPlugin<RuntimePresentationProps>={
 manifest:{contractVersion:localRuntimePresentationContractVersion,pluginId:'sensa.web.structured',pluginVersion:'v1',displayName:'Sensa Structured Runtime',capabilities:['toast','dictionary','notes','personal_scenes','personal_content_menu','declared_mastery'],bindings:[...STRUCTURED_PRESENTATION_BINDINGS]},
 render:StructuredPackageRuntime,
};
const fourStagePresentationPlugin:LocalRuntimePresentationPlugin<RuntimePresentationProps>={
 manifest:{contractVersion:localRuntimePresentationContractVersion,pluginId:'sensa.web.interleaved-four-stage',pluginVersion:'v1',displayName:'Sensa Interleaved Four-stage Runtime',capabilities:[],bindings:[...FOUR_STAGE_PRESENTATION_BINDINGS]},
 render:props=>props.run.purpose==='initial_learning'?<FourStageInitialPackageRuntime {...props}/>:<FourStageReviewPackageRuntime {...props}/>,
};

export const localRuntimePresentationRegistry=new LocalRuntimePresentationRegistry<RuntimePresentationProps>([
 lightweightPresentationPlugin,
 structuredPresentationPlugin,
 fourStagePresentationPlugin,
]);
