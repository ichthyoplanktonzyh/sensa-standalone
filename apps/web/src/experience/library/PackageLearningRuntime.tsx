import {RuntimeFrame,runtimePrimary} from '../components/learning/RuntimeFrame';
import {useEffect,useMemo,useState} from 'react';
import {useTranslation} from 'react-i18next';

import {InterleavedFourStageRuntimeScreen} from '../components/learning/InterleavedFourStageRuntimeScreen';
import {InterleavedFourStageReviewScreen} from '../components/learning/InterleavedFourStageReviewScreen';
import {RuntimeTools} from '../components/learning/RuntimeTools';
import {LightweightRuntimeStartScreen} from '../components/learning/LightweightRuntimeStartScreen';
import {LearningQuestion} from '../components/learning/LearningQuestion';
import {learningQuestionScope} from '../../learning/system/learningQuestion';
import {
 learningSceneSemanticOperationIds,
 type LearningFourStageInitialRuntimeProjection,
 type LearningFourStageReviewRuntimeProjection,
 type LearningLightweightRuntimeProjection,
 type LearningLightweightRating,
 type LearningPolicy,
 type LearningStructuredRuntimeProjection,
} from '../../learning/system';
import {currentPersonalLearningSceneRevision,personalContentSystem} from '../../personalContent/system';
import {useJourneyGateway} from '../personalMeaningJourney';
import {AssuranceRuntime,type AssuranceSupportHost} from './AssuranceLearningViews';
import type {usePackageLearning} from './usePackageLearning';
import {LearningPreferencesPanel} from '../components/learning/LearningPreferencesPanel';
import {SensaOverlayLayout} from '../ui/SensaComponents';
import {iconClass} from '../ui/primitives';
import {useOverlayStore} from '../stores/overlayStore';
import {localFlowNotice,localFlowText} from '../../i18n/localFlowText';
import i18n from '../../i18n';

type Controller=ReturnType<typeof usePackageLearning>;
type PackageRuntimeProps={active:boolean;c:Controller;onExit:()=>void;onFinish:()=>void;onViewLearningLibrary:()=>void};

const lookupRuntimeDictionary:AssuranceSupportHost['lookupDictionary']=async(input,options)=>{
 const {lookupDictionaryEntry}=await import('../services/quickDict');
 return lookupDictionaryEntry(input,options);
};

function useRuntimeHost():AssuranceSupportHost{
 const toast=useOverlayStore(state=>state.toast);
 const openDict=useOverlayStore(state=>state.openDictModal);
 const openNoteEditor=useOverlayStore(state=>state.openNoteEditor);
 const openSceneEditor=useOverlayStore(state=>state.openSceneEditor);
 const setMenuMoreOpen=useOverlayStore(state=>state.setMenuMoreOpen);
 const setMenuPersonalContent=useOverlayStore(state=>state.setMenuPersonalContent);
 const closeMenus=useOverlayStore(state=>state.closeMenus);
 return useMemo(()=>({
  toast,
  openDict,
  openNoteEditor,
  openSceneEditor:(content,contextId,learningTarget)=>openSceneEditor({content,contextId,learningTarget}),
  lookupDictionary:lookupRuntimeDictionary,
  onOpenMenuMore:(event,content)=>{
   event.stopPropagation();
   closeMenus();
   setMenuPersonalContent(content);
   setMenuMoreOpen(true);
  },
 }),[toast,openDict,openNoteEditor,openSceneEditor,closeMenus,setMenuPersonalContent,setMenuMoreOpen]);
}

function RuntimeOverlays({c,policy,onViewLearningLibrary,onExit}:{c:Controller;policy:LearningPolicy;onViewLearningLibrary:()=>void;onExit:()=>void}){
 const {t}=useTranslation();
 const [learningPreferencesOpen,setLearningPreferencesOpen]=useState(false);
 const [ending,setEnding]=useState<{runId:string;revision:number}|null>(null);
 const [,setAnnotationRevision]=useState(0);
 const menuMoreOpen=useOverlayStore(state=>state.menuMoreOpen);
 const menuBookOpen=useOverlayStore(state=>state.menuBookOpen);
 const menuPersonalContent=useOverlayStore(state=>state.menuPersonalContent);
 const closeMenus=useOverlayStore(state=>state.closeMenus);
 const openDict=useOverlayStore(state=>state.openDictModal);
 const openNoteEditor=useOverlayStore(state=>state.openNoteEditor);
 const openSceneEditor=useOverlayStore(state=>state.openSceneEditor);
 const toast=useOverlayStore(state=>state.toast);
 useEffect(()=>personalContentSystem.subscribe({kind:'snapshot'},()=>setAnnotationRevision(value=>value+1)),[]);
 useEffect(()=>()=>closeMenus(),[closeMenus]);
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
  {learningPreferencesOpen&&<LearningPreferencesPanel policyOptions={c.policyOptions} fixedPolicy busy={c.busy||c.loadStatus!=='ready'} status={c.notice&&<p role="alert">{localFlowNotice(c.notice)}</p>} defaultPolicy={policy} dailyNewCount={c.dailyLimit??20} onPolicyChange={()=>{}} onDailyNewCountChange={value=>void c.confirmQuantity(value)} onClose={closeLearningPreferences}/>}
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

function LightweightPackageRuntime({active,runtime,c,host,onExit,onFinish}:{active:boolean;runtime:LearningLightweightRuntimeProjection;c:Controller;host:AssuranceSupportHost;onExit:()=>void;onFinish:()=>void}){
 useTranslation();
 const journeyGateway=useJourneyGateway();
 const [,setAnnotationRevision]=useState(0),[savingWorld,setSavingWorld]=useState(false);
 useEffect(()=>personalContentSystem.subscribe({kind:'snapshot'},()=>setAnnotationRevision(value=>value+1)),[]);
 const target=runtime.target;
 const rate=async(rating:LearningLightweightRating)=>{
  const accepted=await c.act({kind:'rate',rating});
  if(accepted&&runtime.purpose==='initial_learning'&&rating!=='again')host.toast(i18n.t('runtime.initialSaved',{expression:target.presentation.expression}));
 };
 const material=target.material;
 const content={senseKey:String(material.snapshot.provenance.senseId),lemma:target.presentation.expression,guideLabelL1:target.presentation.meaning};
 const scene=personalContentSystem.read({kind:'learning_scene',learningTargetId:target.targetId,languageRouteId:target.languageContext.languageRouteId});
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
 const canAccept=!!scene&&!!sceneRevision&&!!pack&&!!publishedSource&&!!entry?.semantic;
 const worldState=!canAccept?null:savingWorld?'saving':scene.acceptedRevisionId===sceneRevision.revisionId?'saved':scene.acceptedPersonalMeaningId?'update':'available';
 const openPersonalScene=()=>host.openSceneEditor(content,undefined,{learningTargetId:target.targetId,languageRouteId:target.languageContext.languageRouteId,curriculumMembershipId:target.curriculumMembershipId,senseId:target.identity.senseId,senseVersionId:target.identity.senseVersionId,bindingVersionId:target.identity.bindingVersionId});
 const acceptPersonalScene=async()=>{
  if(!canAccept||!scene||!sceneRevision||!pack||!publishedSource||!entry?.semantic)return;
  setSavingWorld(true);
  try{
   const operationIds=learningSceneSemanticOperationIds(sceneRevision.revisionId);
   const result=await journeyGateway.acceptPublishedLearningScene({operationId:operationIds.accept,existingPersonalMeaningId:scene.acceptedPersonalMeaningId,source:{packageKey:pack.key,...publishedSource},target:{learningTargetId:target.targetId,curriculumMembershipId:target.curriculumMembershipId,senseId:target.identity.senseId,senseVersionId:target.identity.senseVersionId,bindingId:target.identity.bindingId,bindingVersionId:target.identity.bindingVersionId,expression:target.presentation.expression,targetLanguageTag:target.presentation.targetLanguageTag},semantic:entry.semantic,scene:{...sceneRevision,sceneId:scene.sceneId}});
   await personalContentSystem.execute({kind:'mark_learning_scene_accepted',operationId:operationIds.link,sceneId:scene.sceneId,revisionId:sceneRevision.revisionId,personalMeaningId:result.personalMeaningId});
   host.toast(i18n.t('runtime.semanticWorldSaved'));
  }catch{host.toast(i18n.t('runtime.semanticWorldSaveFailed'));}
  finally{setSavingWorld(false);}
 };
 const markKnown=()=>void c.declareKnownAndContinue(target.targetId).then(continued=>{if(continued===false)onExit();});
 return <><LightweightRuntimeStartScreen support={active&&!c.busy&&runtime.phase==='reveal'&&<LearningQuestion key={`${learningQuestionScope(runtime)}:${sceneRevision?.revisionId??''}`} runtime={runtime} personalScene={sceneRevision?.body}/>} tools={!runtime.completed&&<RuntimeTools content={content} personalContent={runtime.phase==='reveal'?content:null} showSave={runtime.phase==='reveal'} onMarkKnown={markKnown} onOpenMenuMore={host.onOpenMenuMore} toast={host.toast} busy={c.busy||savingWorld}/>} active={active} busy={c.busy||savingWorld} completionKey={runtime.completed?`${runtime.runId}:${runtime.revision}`:null} target={target.presentation} materialization={material} step={runtime.completed?null:runtime.step} completed={runtime.completed} needsRelearning={runtime.needsRelearning} onRetryRelearning={()=>void c.retryRelearning()} hasNextTarget={!!c.nextTarget} onExit={onExit} onReveal={()=>void c.act({kind:'reveal'})} onRate={rating=>void rate(rating)} onFinish={onFinish} personalScene={sceneRevision} onOpenPersonalScene={runtime.purpose==='initial_learning'?openPersonalScene:undefined} semanticWorldState={runtime.phase==='reveal'?worldState:null} onSaveToSemanticWorld={acceptPersonalScene} onOpenDictionary={host.openDict} lookupDictionary={host.lookupDictionary} toast={host.toast} purpose={runtime.purpose}/>{active&&c.notice&&<p role="status" className="fixed bottom-4 left-4 right-4 z-[100] rounded-xl bg-accent-soft p-3">{localFlowNotice(c.notice)}</p>}</>;
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
 const host=useRuntimeHost();
 const runtime=props.c.runtime;
 if(props.c.loadStatus==='unavailable'||props.c.endedStateNeedsRead)return <RuntimeFrame id="s-lightweight-runtime" active={props.active} title={i18n.t('runtime.learning')} stepLabel={localFlowText('progressReadFailed')} progress={0} onExit={props.onExit}><section role="alert" className="space-y-5 py-10"><p>{props.c.notice||localFlowText('progressReadFailed')}</p><button className={runtimePrimary} onClick={()=>void (props.c.endedStateNeedsRead?props.c.retryEndedStateRead():props.c.retryInitialLoad())}>{i18n.t('reliability.retry')}</button></section></RuntimeFrame>;
 if(!runtime)return <RuntimeFrame id="s-lightweight-runtime" active={props.active} title={i18n.t('runtime.learning')} stepLabel={localFlowText(props.c.busy?'runtimeSwitching':props.c.nextTarget?'startLearning':'runtimeNoPending')} progress={0} onExit={props.onExit}><section className="py-10 text-center"><h1 role="status" className="text-2xl">{localFlowText(props.c.busy?'runtimeSwitching':props.c.nextTarget?'startLearning':'runtimeNoPending')}</h1>{props.c.notice&&<p role="status" className="mt-4">{props.c.notice}</p>}{!props.c.busy&&<button className={`${runtimePrimary} mt-8`} onClick={()=>{if(props.c.nextTarget)void props.c.start(props.c.nextTarget.targetId,props.c.dailyLimit??20);else props.onExit();}}>{props.c.nextTarget?localFlowText('startLearning'):i18n.t('runtime.home')}</button>}</section></RuntimeFrame>;
 const surface=runtime.kind==='lightweight'
  ?<LightweightPackageRuntime active={props.active} runtime={runtime} c={props.c} host={host} onExit={props.onExit} onFinish={props.onFinish}/>
  :runtime.kind==='structured'
   ?<StructuredPackageRuntime active={props.active} runtime={runtime} c={props.c} host={host} onExit={props.onExit} onFinish={props.onFinish}/>
   :runtime.kind==='four_stage_initial'
    ?<FourStageInitialPackageRuntime active={props.active} runtime={runtime} c={props.c} onExit={props.onExit} onFinish={props.onFinish}/>
    :<FourStageReviewPackageRuntime active={props.active} runtime={runtime} c={props.c} onExit={props.onExit} onFinish={props.onFinish}/>;
 return <>{surface}<RuntimeOverlays c={props.c} policy={runtime.policy} onViewLearningLibrary={props.onViewLearningLibrary} onExit={props.onExit}/></>;
}
