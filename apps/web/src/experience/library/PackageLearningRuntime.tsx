import {RuntimeFrame,runtimePrimary} from '../components/learning/RuntimeFrame';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';

import {InterleavedFourStageRuntimeScreen} from '../components/learning/InterleavedFourStageRuntimeScreen';
import {InterleavedFourStageReviewScreen} from '../components/learning/InterleavedFourStageReviewScreen';
import {RuntimeTools} from '../components/learning/RuntimeTools';
import {LightweightRuntimeStartScreen} from '../components/learning/LightweightRuntimeStartScreen';
import {LearningQuestion} from '../components/learning/LearningQuestion';
import {learningQuestionScope} from '../../learning/system/learningQuestion';
import {
 type LearningFourStageInitialRuntimeProjection,
 type LearningFourStageReviewRuntimeProjection,
 type LearningLightweightRuntimeProjection,
 type LearningLightweightRating,
 type LearningPolicy,
 type LearningStructuredRuntimeProjection,
} from '../../learning/system';
import {currentPersonalLearningSceneRevision,personalContentSystem} from '../../personalContent/system';
import {usePersonalLearningScene} from './usePersonalLearningScene';
import {createJourneyGateway} from '../personalMeaningJourney/gateway';
import {AssuranceRuntime,type AssuranceSupportHost} from './AssuranceLearningViews';
import type {usePackageLearning} from './usePackageLearning';
import {LearningPreferencesPanel} from '../components/learning/LearningPreferencesPanel';
import {SensaOverlayLayout} from '../ui/SensaComponents';
import {iconClass} from '../ui/primitives';
import {useOverlayStore} from '../stores/overlayStore';
import {localFlowNotice,localFlowText} from '../../i18n/localFlowText';
import i18n from '../../i18n';
import type {SensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {projectPackageSource,type PackageCenterItem} from './packageCenterProjection';

type Controller=ReturnType<typeof usePackageLearning>;
type PackageRuntimeProps={active:boolean;c:Controller;onExit:()=>void;onFinish:()=>void;onViewRecords:()=>void;onViewLearningLibrary:()=>void};
const runtimeLookupLanguages=(runtime:Controller['runtime']):SensaPinnedLanguageContext|undefined=>runtime&&(runtime.kind==='lightweight'||runtime.kind==='structured')?runtime.target.languageContext:undefined;

const lookupRuntimeDictionary:AssuranceSupportHost['lookupDictionary']=async(input,options)=>{
 const {lookupDictionaryEntry}=await import('../services/quickDict');
 return lookupDictionaryEntry(input,options);
};

function useRuntimeHost(languages:SensaPinnedLanguageContext|undefined):AssuranceSupportHost{
 const toast=useOverlayStore(state=>state.toast);
 const openDict=useOverlayStore(state=>state.openDictModal);
 const openNoteEditor=useOverlayStore(state=>state.openNoteEditor);
 const openSceneEditor=useOverlayStore(state=>state.openSceneEditor);
 const setMenuMoreOpen=useOverlayStore(state=>state.setMenuMoreOpen);
 const setMenuPersonalContent=useOverlayStore(state=>state.setMenuPersonalContent);
 const closeMenus=useOverlayStore(state=>state.closeMenus);
 return useMemo(()=>({
  toast,
  openDict:word=>openDict(word,languages),
  openNoteEditor,
  openSceneEditor:(content,contextId,learningTarget)=>openSceneEditor({content,contextId,learningTarget}),
  lookupDictionary:(input,options)=>lookupRuntimeDictionary(input,{...options,languages:languages??options?.languages}),
  onOpenMenuMore:(event,content)=>{
   event.stopPropagation();
   closeMenus();
   setMenuPersonalContent(content);
   setMenuMoreOpen(true);
  },
 }),[toast,openDict,openNoteEditor,openSceneEditor,closeMenus,setMenuPersonalContent,setMenuMoreOpen,languages]);
}

function RuntimeOverlays({c,policy,onViewLearningLibrary,onExit}:{c:Controller;policy:LearningPolicy;onViewLearningLibrary:()=>void;onExit:()=>void}){
 const {t}=useTranslation();
 const [learningPreferencesOpen,setLearningPreferencesOpen]=useState(false);
 const [sourceReference,setSourceReference]=useState<{target:LearningLightweightRuntimeProjection['target'];item:PackageCenterItem|undefined}|null>(null);
 const sourceBack=useRef<HTMLButtonElement>(null);
 const [ending,setEnding]=useState<{runId:string;revision:number}|null>(null);
 const [,setAnnotationRevision]=useState(0);
 const menuMoreOpen=useOverlayStore(state=>state.menuMoreOpen);
 const menuBookOpen=useOverlayStore(state=>state.menuBookOpen);
 const menuPersonalContent=useOverlayStore(state=>state.menuPersonalContent);
 const closeMenus=useOverlayStore(state=>state.closeMenus);
 const openDictModal=useOverlayStore(state=>state.openDictModal);
 const openDict=(word:string)=>openDictModal(word,runtimeLookupLanguages(c.runtime));
 const openNoteEditor=useOverlayStore(state=>state.openNoteEditor);
 const openSceneEditor=useOverlayStore(state=>state.openSceneEditor);
 const toast=useOverlayStore(state=>state.toast);
 const sourceTarget=c.runtime?.kind==='lightweight'&&c.runtime.phase==='reveal'?c.runtime.target:null;
 const closeSource=useCallback(()=>{
  setSourceReference(null);
  requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.screen.active [data-learning-more]')?.focus());
 },[]);
 useEffect(()=>{
  if(!sourceReference)return;
  const frame=requestAnimationFrame(()=>sourceBack.current?.focus());
  const dismiss=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();closeSource();}};
  document.addEventListener('keydown',dismiss);
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('keydown',dismiss);};
 },[sourceReference,closeSource]);
 useEffect(()=>personalContentSystem.subscribe({kind:'snapshot'},()=>setAnnotationRevision(value=>value+1)),[]);
 useEffect(()=>()=>closeMenus(),[closeMenus]);
 useEffect(()=>{
  if(!menuMoreOpen&&!menuBookOpen)return;
  const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const frame=requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`${menuMoreOpen?'#menu-more':'#menu-book'} button:not(:disabled)`)?.focus());
  const dismiss=(event:KeyboardEvent)=>{
   if(event.key!=='Escape'||event.defaultPrevented)return;
   event.preventDefault();closeMenus();if(trigger?.isConnected)trigger.focus();
  };
  document.addEventListener('keydown',dismiss);
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('keydown',dismiss);};
 },[menuMoreOpen,menuBookOpen,closeMenus]);
 const contexts=menuPersonalContent?personalContentSystem.read({kind:'sense',senseId:menuPersonalContent.senseKey}).contexts:[];
 const closeLearningPreferences=()=>{
  setLearningPreferencesOpen(false);
  requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.screen.active [data-learning-more]')?.focus());
 };
 return <>
  {menuMoreOpen&&<SensaOverlayLayout variant="popover" measure="compact" className="z-[80]" id="menu-more" label={t('assurance.more')} onDismiss={closeMenus} dismissOnBackdrop regions={{primary:
   <div className="p-2 [&>button]:flex [&>button]:min-h-12 [&>button]:w-full [&>button]:items-center [&>button]:gap-3 [&>button]:rounded-control [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-3 [&>button]:text-left [&>button]:text-control-label [&>button]:hover:bg-surface-subtle [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-focus">
    {menuPersonalContent&&<>
     <div className="mb-2 rounded-control bg-accent-soft p-3"><span className="block text-metadata text-fg-tertiary">{t('assurance.currentMeaning')}</span><strong className="mt-1 block font-language text-lg text-action-primary">{menuPersonalContent.lemma}</strong><small>{menuPersonalContent.guideLabelL1}</small></div>
     <button onClick={()=>{const content=menuPersonalContent;closeMenus();openNoteEditor(content.lemma,content.senseKey,content.guideLabelL1);}}><svg className={iconClass} aria-hidden="true"><use href="#i-pen"/></svg>{t('assurance.note')}</button>
     <button onClick={()=>{const content=menuPersonalContent;closeMenus();openSceneEditor({content,contextId:contexts[0]?.contextId});}}><svg className={iconClass} aria-hidden="true"><use href="#i-bulb"/></svg>{t('assurance.personalScene')}</button>
     {contexts.length>0&&<button onClick={()=>{const content=menuPersonalContent;closeMenus();openSceneEditor({content});}}><svg className={iconClass} aria-hidden="true"><use href="#i-penplus"/></svg>{t('assurance.addScene')}</button>}
     <button onClick={()=>{const content=menuPersonalContent;closeMenus();openDict(content.lemma);}}><svg className={iconClass} aria-hidden="true"><use href="#i-search"/></svg>{t('originalCards.dictionary')}</button>
     {sourceTarget?.packageKey&&<button disabled={c.busy} onClick={()=>{closeMenus();setSourceReference({target:sourceTarget,item:projectPackageSource(c,sourceTarget.packageKey,sourceTarget.publicationArchiveSha256??undefined)});}}><svg className={iconClass} aria-hidden="true"><use href="#i-list"/></svg>{t('learningSetup.source')}</button>}
     <div className="my-2 border-t border-border-subtle"/>
    </>}
    <button onClick={()=>{closeMenus();setLearningPreferencesOpen(true);}}><svg className={iconClass} aria-hidden="true"><use href="#i-sliders"/></svg>{t('assurance.preferences')}</button>
    {c.runtime&&!c.runtime.completed&&<button disabled={c.busy} onClick={()=>{const runtime=c.runtime!;closeMenus();setEnding({runId:runtime.runId,revision:runtime.revision});}}>{t('sessionEnd.action')}</button>}
   </div>}}/>}
  {ending&&<SensaOverlayLayout variant="sheet" measure="compact" className="z-[160] [&_[data-sensa-overlay-region=primary]:empty]:hidden" labelledBy="session-end-title" onDismiss={()=>{if(!c.busy)setEnding(null);}} dismissOnBackdrop regions={{
   header:<h2 id="session-end-title" className="text-lg font-medium">{t('sessionEnd.title')}</h2>,
   primary:c.notice?<p role="alert">{c.notice}</p>:null,
   controls:<div className="flex flex-wrap gap-3"><button className={runtimePrimary} disabled={c.busy} onClick={()=>void c.endSession(ending.runId,ending.revision).then(ended=>{if(ended)onExit();})}>{t('sessionEnd.action')}</button><button className="min-h-11 rounded-control px-4 text-sm focus-visible:outline-2 focus-visible:outline-focus" disabled={c.busy} onClick={()=>setEnding(null)}>{t('sessionEnd.cancel')}</button></div>,
  }}/>}
  {learningPreferencesOpen&&<LearningPreferencesPanel policyOptions={c.policyOptions} fixedPolicy busy={c.busy||c.loadStatus!=='ready'} status={c.notice&&<p role="alert">{localFlowNotice(c.notice)}</p>} defaultPolicy={policy} dailyNewCount={c.preferencesDailyLimit??20} onPolicyChange={()=>{}} onDailyNewCountChange={value=>void c.confirmQuantity(value)} onClose={closeLearningPreferences}/>}
  {sourceReference&&<SensaOverlayLayout variant="sheet" measure="compact" className="z-[140]" id="learning-source-reference" labelledBy="learning-source-title" onDismiss={closeSource} dismissOnBackdrop regions={{
   header:<h2 id="learning-source-title" className="text-lg font-medium">{t('learningSetup.source')}</h2>,
   primary:sourceReference.item?<div className="space-y-4"><h3 className="text-xl font-medium">{sourceReference.item.title}</h3><p className="text-metadata text-fg-secondary">v{sourceReference.item.sourceVersion}</p><p className="font-language text-xl" lang={sourceReference.target.presentation.targetLanguageTag} dir="auto">{sourceReference.target.presentation.expression}</p><p className="text-body-support" lang={sourceReference.target.languageContext.supportLanguageTag} dir="auto">{sourceReference.target.presentation.meaning}</p></div>:<p role="status">{t('reliability.errorTitle')}</p>,
   controls:<button type="button" ref={sourceBack} className={runtimePrimary} onClick={closeSource}>{t('learningSetup.back')}</button>,
  }}/>}
  {menuBookOpen&&<SensaOverlayLayout variant="popover" measure="compact" className="z-[80]" id="menu-book" label={localFlowText('chooseRange')} onDismiss={closeMenus} dismissOnBackdrop regions={{primary:
   <div className="p-2 [&>button]:flex [&>button]:min-h-12 [&>button]:w-full [&>button]:items-center [&>button]:gap-3 [&>button]:rounded-control [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-3 [&>button]:text-left [&>button]:text-control-label [&>button]:hover:bg-surface-subtle [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-focus">
    <button onClick={()=>{closeMenus();toast(localFlowText('chooseRangeHint'));}}><svg className={iconClass} aria-hidden="true"><use href="#i-filter"/></svg>{localFlowText('chooseRange')}</button>
    <button onClick={()=>{closeMenus();onViewLearningLibrary();}}><svg className={iconClass} aria-hidden="true"><use href="#i-list"/></svg>{localFlowText('viewContent')}</button>
    <button onClick={()=>{closeMenus();toast(localFlowText('downloadingWords'));}}><svg className={iconClass} aria-hidden="true"><use href="#i-dl"/></svg>{localFlowText('downloadWords')}</button>
    <button onClick={()=>{closeMenus();toast(localFlowText('resetBookWarning'));}}><svg className={iconClass} aria-hidden="true"><use href="#i-relearn"/></svg>{localFlowText('relearnBook')}</button>
    <button disabled><svg className={iconClass} aria-hidden="true"><use href="#i-refresh"/></svg>{localFlowText('updateBook')}</button>
   </div>}}/>}
 </>;
}

function LightweightPackageRuntime({active,runtime,c,host,onExit,onFinish,onViewRecords}:{active:boolean;runtime:LearningLightweightRuntimeProjection;c:Controller;host:AssuranceSupportHost;onExit:()=>void;onFinish:()=>void;onViewRecords:()=>void}){
 useTranslation();
 // This command frame must not inherit a previously opened global World or
 // Practice read snapshot. SQLite receipts/indexed dependencies own races.
 const journeyGateway=useMemo(()=>createJourneyGateway(),[]);
 const pendingWorldIntent=useRef<{signature:string;operations:{accept:string;link:string}}|null>(null);
 const [savingWorld,setSavingWorld]=useState(false);
 const target=runtime.target;
 const {scene,status:sceneStatus,retry:retryScene}=usePersonalLearningScene(target.targetId,target.languageContext.languageRouteId);
 const rate=async(rating:LearningLightweightRating)=>{
  if(sceneStatus!=='ready')return;
  await c.act({kind:'rate',rating});
 };
 const material=target.material;
 const content={senseKey:target.identity.senseId,lemma:target.presentation.expression,guideLabelL1:target.presentation.meaning};
 const sceneRevision=scene?currentPersonalLearningSceneRevision(scene):null;
 const pack=target.packageKey?c.packages.find(candidate=>candidate.key===target.packageKey):undefined;
 const entry=pack?.content.entries.find(candidate=>candidate.senseVersionId===target.identity.senseVersionId&&candidate.bindingVersionId===target.identity.bindingVersionId);
 const publication=target.publicationArchiveSha256
  ?pack?.portableOrigin.publications.find(candidate=>candidate.bookArchiveSha256===target.publicationArchiveSha256)
  :[...(pack?.portableOrigin.publications??[])].sort((left,right)=>right.book.versionNumber-left.book.versionNumber)[0];
 const publishedSource=publication?{
  bookId:publication.book.bookId,
  bookVersionId:publication.book.bookVersionId,
  contentReleaseId:publication.contentRelease.contentReleaseId,
  publishedAt:publication.publishedAt,
  title:publication.book.title,
 }:null;
 const canAccept=sceneStatus==='ready'&&!!scene&&!!sceneRevision&&!!pack&&!!publishedSource&&!!entry?.semantic;
 const worldState=!canAccept?null:savingWorld?'saving':scene.acceptedRevisionId===sceneRevision.revisionId?'saved':scene.acceptedPersonalMeaningId?'update':'available';
 const openPersonalScene=()=>host.openSceneEditor(content,undefined,{learningTargetId:target.targetId,languageRouteId:target.languageContext.languageRouteId,curriculumMembershipId:target.curriculumMembershipId,senseId:target.identity.senseId,senseVersionId:target.identity.senseVersionId,bindingVersionId:target.identity.bindingVersionId});
 const acceptPersonalScene=async()=>{
  if(!canAccept||!scene||!sceneRevision||!pack||!publishedSource||!entry?.semantic)return;
  setSavingWorld(true);
  try{
   const signature=JSON.stringify([scene.sceneId,sceneRevision.revisionId,scene.acceptedPersonalMeaningId,pack.key,publishedSource.bookVersionId,target.curriculumMembershipId]);
   if(pendingWorldIntent.current?.signature!==signature)pendingWorldIntent.current={signature,operations:{accept:crypto.randomUUID(),link:crypto.randomUUID()}};
   const operationIds=pendingWorldIntent.current.operations;
   const result=await journeyGateway.acceptPublishedLearningScene({operationId:operationIds.accept,existingPersonalMeaningId:scene.acceptedPersonalMeaningId,source:{packageKey:pack.key,...publishedSource},target:{learningTargetId:target.targetId,curriculumMembershipId:target.curriculumMembershipId,senseId:target.identity.senseId,senseVersionId:target.identity.senseVersionId,bindingId:target.identity.bindingId,bindingVersionId:target.identity.bindingVersionId,expression:target.presentation.expression,targetLanguageTag:target.presentation.targetLanguageTag},semantic:entry.semantic,scene:{...sceneRevision,sceneId:scene.sceneId,contextCreatedAt:scene.createdAt}});
   await personalContentSystem.execute({kind:'mark_learning_scene_accepted',operationId:operationIds.link,sceneId:scene.sceneId,revisionId:sceneRevision.revisionId,personalMeaningId:result.personalMeaningId});
   pendingWorldIntent.current=null;
   host.toast(i18n.t('runtime.semanticWorldSaved'));
  }catch(cause){if(cause instanceof Error&&cause.name==='JourneyConflictError')pendingWorldIntent.current=null;host.toast(i18n.t('runtime.semanticWorldSaveFailed'));}
  finally{setSavingWorld(false);}
 };
 const markKnown=()=>{if(sceneStatus==='ready')void c.declareKnownAndContinue(target.targetId).then(continued=>{if(continued===false)onExit();});};
 const sceneBusy=c.busy||savingWorld||sceneStatus!=='ready';
 const support=<>
  {active&&sceneStatus!=='ready'&&<section role={sceneStatus==='error'?'alert':'status'} className="space-y-3 py-4">
   <p>{sceneStatus==='error'?i18n.t('sceneEditor.readFailed'):localFlowText('loadingSensa')}</p>
   {sceneStatus==='error'&&<button className="min-h-11 underline" onClick={retryScene}>{i18n.t('reliability.retry')}</button>}
  </section>}
  {active&&!c.busy&&sceneStatus==='ready'&&runtime.phase==='reveal'&&<LearningQuestion key={`${learningQuestionScope(runtime)}:${sceneRevision?.revisionId??''}`} runtime={runtime} personalScene={sceneRevision?.body}/>}
 </>;
 return <LightweightRuntimeStartScreen sessionSummary={c.sessionSummary} repeatCount={runtime.repeatCount} notice={active?c.notice:undefined} onViewRecords={onViewRecords} support={support} tools={!runtime.completed&&<RuntimeTools content={content} personalContent={runtime.phase==='reveal'?content:null} showSave={runtime.phase==='reveal'} onMarkKnown={markKnown} onOpenMenuMore={host.onOpenMenuMore} toast={host.toast} busy={sceneBusy}/>} active={active} busy={sceneBusy} completionKey={runtime.completed?`${runtime.runId}:${runtime.revision}`:null} target={target.presentation} materialization={material} step={runtime.completed?null:runtime.step} completed={runtime.completed} needsRelearning={runtime.needsRelearning} onRetryRelearning={()=>void c.retryRelearning()} hasNextTarget={!!c.nextTarget} onExit={onExit} onReveal={()=>{if(sceneStatus==='ready')void c.act({kind:'reveal'});}} onRate={rating=>void rate(rating)} onFinish={onFinish} personalScene={sceneRevision} onOpenPersonalScene={runtime.purpose==='initial_learning'&&sceneStatus==='ready'?openPersonalScene:undefined} semanticWorldState={runtime.phase==='reveal'?worldState:null} onSaveToSemanticWorld={acceptPersonalScene} onOpenDictionary={host.openDict} lookupDictionary={host.lookupDictionary} toast={host.toast} purpose={runtime.purpose}/>;
}

function FourStageInitialPackageRuntime({active,runtime,c,onExit,onFinish}:{active:boolean;runtime:LearningFourStageInitialRuntimeProjection;c:Controller;onExit:()=>void;onFinish:()=>void}){
 const act=(response:unknown)=>void c.act({kind:'protocol',response});
 return <InterleavedFourStageRuntimeScreen active={active} onExit={onExit} onFinish={onFinish} execution={{session:runtime.session,target:runtime.target,content:runtime.content,targetCount:runtime.targetCount,completedTargetCount:runtime.completedTargetCount,currentTargetCheckpointCredits:runtime.currentTargetCheckpointCredits,busy:c.busy,notice:c.notice&&<p role="alert">{c.notice}</p>,onChoice:optionId=>act({kind:'choice',optionId}),onSelfReport:known=>act({kind:'self_report',known}),onContinue:()=>act({kind:'continue'})}}/>;
}

function FourStageReviewPackageRuntime({active,runtime,c,onExit,onFinish}:{active:boolean;runtime:LearningFourStageReviewRuntimeProjection;c:Controller;onExit:()=>void;onFinish:()=>void}){
 const act=(response:unknown)=>void c.act({kind:'protocol',response});
 return <InterleavedFourStageReviewScreen active={active} onExit={onExit} onFinish={onFinish} execution={{session:runtime.session,target:runtime.target,done:runtime.completed,targetCount:runtime.targetCount,busy:c.busy,notice:c.notice&&<p role="alert">{c.notice}</p>,onAnswer:answer=>act({kind:'review',answer}),onContinue:()=>act({kind:'continue'})}}/>;
}

function StructuredPackageRuntime({active,runtime,c,host,onExit,onFinish}:{active:boolean;runtime:LearningStructuredRuntimeProjection;c:Controller;host:AssuranceSupportHost;onExit:()=>void;onFinish:()=>void}){
 return <AssuranceRuntime host={host} key={`${runtime.runId}:${runtime.revision}`} active={active} runtime={runtime} busy={c.busy} notice={c.notice} onMarkKnown={()=>void c.declareKnownAndContinue(runtime.target.targetId)} onAction={action=>void c.act(action)} onExit={onExit} onFinish={onFinish}/>;
}

export function PackageRuntime(props:PackageRuntimeProps){
 const host=useRuntimeHost(runtimeLookupLanguages(props.c.runtime));
 const runtime=props.c.runtime;
 if(props.c.loadStatus==='unavailable'||props.c.endedStateNeedsRead)return <RuntimeFrame id="s-lightweight-runtime" active={props.active} title={i18n.t('runtime.learning')} stepLabel={localFlowText('progressReadFailed')} progress={null} onExit={props.onExit}><section role="alert" className="space-y-5 py-10"><p>{props.c.notice||localFlowText('progressReadFailed')}</p><button className={runtimePrimary} onClick={()=>void (props.c.endedStateNeedsRead?props.c.retryEndedStateRead():props.c.retryInitialLoad())}>{i18n.t('reliability.retry')}</button></section></RuntimeFrame>;
 if(!runtime)return <RuntimeFrame id="s-lightweight-runtime" active={props.active} title={i18n.t('runtime.learning')} stepLabel={localFlowText(props.c.busy?'runtimeSwitching':props.c.nextTarget?'startLearning':'runtimeNoPending')} progress={null} onExit={props.onExit}><section className="py-10 text-center"><h1 role="status" className="text-2xl">{localFlowText(props.c.busy?'runtimeSwitching':props.c.nextTarget?'startLearning':'runtimeNoPending')}</h1>{props.c.notice&&<p role="status" className="mt-4">{props.c.notice}</p>}{!props.c.busy&&<button className={`${runtimePrimary} mt-8`} onClick={()=>{if(props.c.nextTarget)void props.c.start(props.c.nextTarget.targetId,props.c.dailyLimit??20);else props.onExit();}}>{props.c.nextTarget?localFlowText('startLearning'):i18n.t('runtime.home')}</button>}</section></RuntimeFrame>;
 const surface=runtime.kind==='lightweight'
  ?<LightweightPackageRuntime active={props.active} runtime={runtime} c={props.c} host={host} onExit={props.onExit} onFinish={props.onFinish} onViewRecords={props.onViewRecords}/>
  :runtime.kind==='structured'
   ?<StructuredPackageRuntime active={props.active} runtime={runtime} c={props.c} host={host} onExit={props.onExit} onFinish={props.onFinish}/>
   :runtime.kind==='four_stage_initial'
    ?<FourStageInitialPackageRuntime active={props.active} runtime={runtime} c={props.c} onExit={props.onExit} onFinish={props.onFinish}/>
    :<FourStageReviewPackageRuntime active={props.active} runtime={runtime} c={props.c} onExit={props.onExit} onFinish={props.onFinish}/>;
 return <>{surface}<RuntimeOverlays c={props.c} policy={runtime.policy} onViewLearningLibrary={props.onViewLearningLibrary} onExit={props.onExit}/></>;
}
