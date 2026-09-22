import {RuntimeFrame,runtimePrimary} from '../components/learning/RuntimeFrame';
import {useEffect,useMemo,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {learningBundleBookId,learningBundleBookVersionId,learningBundleContentReleaseId,learningBundleTitle} from '@sensa/contracts/sensa';
import {InterleavedFourStageRuntimeScreen} from '../components/learning/InterleavedFourStageRuntimeScreen';
import {InterleavedFourStageReviewScreen} from '../components/learning/InterleavedFourStageReviewScreen';
import {RuntimeTools} from '../components/learning/RuntimeTools';
import {LightweightRuntimeStartScreen} from '../components/learning/LightweightRuntimeStartScreen';
import {InterleavedFourStageQueue,InterleavedFourStageReviewQueue} from '../../learning/runtime/interleavedFourStageProtocol';
import {fourStageQueue,fourStageContent,type FourStageAction} from '../../learning/protocols/fourStage';
import {localAssuranceState} from '../../learning/protocols/assurance';
import {localRunBinding,localRunPolicy} from '../../learning/runtime/localRuntimeBindings';
import {learningRuntimeCoordinator,localExecutionForRun} from '../../learning/runtime/runtimeCoordinator';
import {localLightweightPhase,localLightweightStep} from '../../learning/runtime/lightweightInitialProtocol';
import {localProtocolActiveTargetId,localProtocolStepId,type LocalExecutableLearningTarget,type LocalLearningAction} from '../../learning/runtime/localProtocol';
import {localExecutableTargetForParticipant,localLastPresentedMaterial,localPresentedMaterial} from '../../learning/runtime/localCurriculum';
import {learningRunTargetIds as localRunTargetIds,learningSceneSemanticOperationIds,type LearningRunView as LocalLearningRun} from '../../learning/system';
import type {ContentSupplyPackage as InstalledPackage} from '../../contentSupply/system';
import {contentAnnotations} from '../../data/library/contentAnnotations';
import {useJourneyGateway} from '../personalMeaningJourney';
import type {AssuranceSupportHost} from './AssuranceLearningViews';
import {AssuranceRuntime} from './AssuranceLearningViews';
import type {usePackageLearning} from './usePackageLearning';
import {localTargetView} from './localTargetView';
import {LearningPreferencesPanel} from '../components/learning/LearningPreferencesPanel';
import {SensaOverlayLayout} from '../ui/SensaComponents';
import {iconClass} from '../ui/primitives';
import {useOverlayStore} from '../stores/overlayStore';
import {composeLocalLearningRuntime} from '../learningRuntime/runtimeComposition';
import {
 LocalRuntimePresentationRegistry,
 immutablePresentationSnapshot,
 localRuntimePresentationContractVersion,
 localRuntimePresentationRequest,
 type LocalRuntimePresentationBinding,
 type LocalRuntimePresentationPlugin,
} from '../learningRuntime/localRuntimePresentations';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import i18n from '../../i18n';

type Controller=ReturnType<typeof usePackageLearning>;
type PackageRuntimeProps={active:boolean;c:Controller;onExit:()=>void;onFinish:()=>void;onViewLearningLibrary:()=>void};
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
  openSceneEditor:(content,anchorId,learningTarget)=>openSceneEditor({content,anchorId,learningTarget}),
  lookupDictionary:lookupRuntimeDictionary,
  onOpenMenuMore:(event,content)=>{
   event.stopPropagation();
   closeMenus();
   setMenuPersonalContent(content);
   setMenuMoreOpen(true);
  },
 }),[toast,openDict,openNoteEditor,openSceneEditor,closeMenus,setMenuPersonalContent,setMenuMoreOpen]);
}

function RuntimeOverlays({c,run,onViewLearningLibrary}:{c:Controller;run:LocalLearningRun;onViewLearningLibrary:()=>void}){
 const {t}=useTranslation();
 const [learningPreferencesOpen,setLearningPreferencesOpen]=useState(false);
 const [,setAnnotationRevision]=useState(0);
 const menuMoreOpen=useOverlayStore(state=>state.menuMoreOpen);
 const menuBookOpen=useOverlayStore(state=>state.menuBookOpen);
 const menuPersonalContent=useOverlayStore(state=>state.menuPersonalContent);
 const closeMenus=useOverlayStore(state=>state.closeMenus);
 const openDict=useOverlayStore(state=>state.openDictModal);
 const openNoteEditor=useOverlayStore(state=>state.openNoteEditor);
 const openSceneEditor=useOverlayStore(state=>state.openSceneEditor);
 const toast=useOverlayStore(state=>state.toast);
 useEffect(()=>contentAnnotations.subscribe(()=>setAnnotationRevision(value=>value+1)),[]);
 useEffect(()=>()=>closeMenus(),[closeMenus]);
 const anchors=menuPersonalContent?contentAnnotations.getSemanticAnchors(menuPersonalContent.senseKey):[];
 const closeLearningPreferences=()=>{
  setLearningPreferencesOpen(false);
  requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.screen.active [data-learning-more]')?.focus());
 };
 return <>
  {menuMoreOpen&&<SensaOverlayLayout variant="popover" measure="compact" className="z-[80]" id="menu-more" label={t('assurance.preferences')} onDismiss={closeMenus} dismissOnBackdrop regions={{primary:
   <div className="p-2 [&>button]:flex [&>button]:min-h-12 [&>button]:w-full [&>button]:items-center [&>button]:gap-3 [&>button]:rounded-control [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-3 [&>button]:text-left [&>button]:text-control-label [&>button]:hover:bg-surface-subtle [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-focus">
    {menuPersonalContent&&<>
     <div className="mb-2 rounded-control bg-accent-soft p-3">
      <span className="block text-metadata text-fg-tertiary">{t('assurance.currentMeaning')}</span>
      <strong className="mt-1 block font-language text-lg text-action-primary">{menuPersonalContent.lemma}</strong>
      <small>{menuPersonalContent.guideLabelL1}</small>
     </div>
     <button onClick={()=>{const content=menuPersonalContent;closeMenus();openNoteEditor(content.lemma,content.senseKey,content.guideLabelL1);}}><svg className={iconClass} aria-hidden="true"><use href="#i-pen"/></svg>{t('assurance.note')}</button>
     <button onClick={()=>{const content=menuPersonalContent;closeMenus();openSceneEditor({content,anchorId:anchors[0]?.anchorId});}}><svg className={iconClass} aria-hidden="true"><use href="#i-bulb"/></svg>{t('assurance.personalScene')}</button>
     {anchors.length>0&&<button onClick={()=>{const content=menuPersonalContent;closeMenus();openSceneEditor({content});}}><svg className={iconClass} aria-hidden="true"><use href="#i-penplus"/></svg>{t('assurance.addScene')}</button>}
     <button onClick={()=>{const content=menuPersonalContent;closeMenus();openDict(content.lemma);}}><svg className={iconClass} aria-hidden="true"><use href="#i-search"/></svg>{t('originalCards.dictionary')}</button>
     <div className="my-2 border-t border-border-subtle"/>
    </>}
    <button onClick={()=>{closeMenus();setLearningPreferencesOpen(true);}}><svg className={iconClass} aria-hidden="true"><use href="#i-sliders"/></svg>{t('assurance.preferences')}</button>
   </div>}}/>}
  {learningPreferencesOpen&&<LearningPreferencesPanel fixedPolicy busy={c.busy} defaultPolicy={localRunPolicy(run)} dailyNewCount={c.dailyLimit??20} onPolicyChange={()=>{}} onDailyNewCountChange={value=>void c.confirmQuantity(value)} onClose={closeLearningPreferences}/>}
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

export function PackageRuntime(props:PackageRuntimeProps){
 const runtimeHost=useRuntimeHost();
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
 if(!run)return <RuntimeFrame id="s-lightweight-runtime" active={props.active} title={i18n.t('runtime.learning')} stepLabel={localFlowText(props.c.busy?'runtimeSwitching':props.c.nextTarget?'startLearning':'runtimeNoPending')} progress={0} onExit={props.onExit}><section className="py-10 text-center"><h1 role="status" className="text-2xl">{localFlowText(props.c.busy?'runtimeSwitching':props.c.nextTarget?'startLearning':'runtimeNoPending')}</h1>{props.c.notice&&<p role="status" className="mt-4">{props.c.notice}</p>}{!props.c.busy&&<button className={`${runtimePrimary} mt-8`} onClick={()=>{if(props.c.nextTarget)void props.c.start(props.c.nextTarget.id,props.c.dailyLimit??20);else props.onExit();}}>{props.c.nextTarget?localFlowText('startLearning'):i18n.t('runtime.home')}</button>}</section></RuntimeFrame>;
 const surface=learningRuntimeCoordinator.adapterForBinding(localRunBinding(run)).surfaceFor(run.purpose);
 const request=localRuntimePresentationRequest(run,surface);
 const plugin=localRuntimePresentationRegistry.resolve(request);
 const Surface=plugin.render;
 const capabilities=new Set(plugin.manifest.capabilities);
 const host:Partial<AssuranceSupportHost>={
  ...(capabilities.has('toast')?{toast:runtimeHost.toast}:{}),
  ...(capabilities.has('dictionary')?{openDict:runtimeHost.openDict,lookupDictionary:runtimeHost.lookupDictionary}:{}),
  ...(capabilities.has('notes')?{openNoteEditor:runtimeHost.openNoteEditor}:{}),
  ...(capabilities.has('personal_scenes')?{openSceneEditor:runtimeHost.openSceneEditor}:{}),
  ...(capabilities.has('personal_content_menu')?{onOpenMenuMore:runtimeHost.onOpenMenuMore}:{}),
 };
 const declareMastery=capabilities.has('declared_mastery')
  ?(targetId:string,active=true)=>active?props.c.declareKnownAndContinue(targetId):props.c.declareKnown(targetId,false)
  :async()=>{throw new Error('Presentation plugin did not declare declared_mastery.');};
 return <><Surface active={props.active} {...snapshot} busy={props.c.busy} notice={props.c.notice} hasNextTarget={!!props.c.nextTarget} host={host} dispatch={action=>{if(!props.c.busy)void props.c.act(action);}} declareMastery={declareMastery} onExit={props.onExit} onFinish={props.onFinish}/><RuntimeOverlays c={props.c} run={run} onViewLearningLibrary={props.onViewLearningLibrary}/></>;
}

function requireHost(host:Partial<AssuranceSupportHost>,capability:string):AssuranceSupportHost{
 if(!host.toast||!host.openDict||!host.openNoteEditor||!host.openSceneEditor||!host.lookupDictionary||!host.onOpenMenuMore)throw new Error(`Presentation capability ${capability} is unavailable.`);
 return host as AssuranceSupportHost;
}

function StructuredPackageRuntime({active,run,targets,packages,busy,notice,dispatch,declareMastery,onExit,onFinish,host}:RuntimePresentationProps){
 const target=targets.find(t=>t.id===run.targetId),pack=packages.find(p=>p.key===target?.packageKey);
 if(!target||!pack)throw new Error('Missing structured runtime resources');
 localAssuranceState(run);
 return <AssuranceRuntime host={requireHost(host,'structured_support')} key={run.id+':'+run.revision} active={active} run={run} target={target} pack={pack} busy={busy} notice={notice} onMarkKnown={()=>void declareMastery(target.id)} onAction={dispatch} onExit={onExit} onFinish={onFinish}/>;
}

function LightweightPackageRuntime({active,run,targets,packages,busy,notice,hasNextTarget,dispatch,declareMastery,onExit,onFinish,host}:RuntimePresentationProps){
 useTranslation();
 const journeyGateway=useJourneyGateway();
 const [,setAnnotationRevision]=useState(0),[savingWorld,setSavingWorld]=useState(false);
 useEffect(()=>contentAnnotations.subscribe(()=>setAnnotationRevision(value=>value+1)),[]);
 const target=targets.find(t=>t.id===run.targetId);
 if(!target)throw new Error('Missing lightweight runtime target');
 const material=target.material;
 const phase=localLightweightPhase(run);
 const step=localLightweightStep(run,target,material);
 const content={senseKey:String(material.snapshot.provenance.senseId),lemma:target.expression,guideLabelL1:target.meaning};
 const lightweightHost=host as Pick<AssuranceSupportHost,'onOpenMenuMore'|'openSceneEditor'|'openDict'|'lookupDictionary'|'toast'>;
 if(!lightweightHost.onOpenMenuMore||!lightweightHost.openSceneEditor||!lightweightHost.openDict||!lightweightHost.lookupDictionary||!lightweightHost.toast)throw new Error('Presentation capability lightweight_support is unavailable.');
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
   const operationIds=learningSceneSemanticOperationIds(sceneRevision.revisionId),operationId=operationIds.accept,result=await journeyGateway.acceptPublishedLearningScene({operationId,existingPersonalMeaningId:scene.acceptedPersonalMeaningId,source:{packageKey:pack.key,bookId:learningBundleBookId(bookBundle),bookVersionId,contentReleaseId,publishedAt:bookBundle.publishedAt,title:learningBundleTitle(bookBundle)},target:{learningTargetId:target.id,curriculumMembershipId:target.curriculumMembership.id,senseId:target.identity.senseId,senseVersionId:target.identity.senseVersionId,bindingId:target.identity.senseExpressionBindingId,bindingVersionId:target.identity.bindingVersionId,expression:target.expression,targetLanguageTag:target.targetLanguageTag},semantic:entry.semantic,scene:{...sceneRevision,sceneId:scene.sceneId}});
   await contentAnnotations.markLearningSceneAccepted({operationId:operationIds.link,sceneId:scene.sceneId,revisionId:sceneRevision.revisionId,personalMeaningId:result.personalMeaningId});
   lightweightHost.toast(i18n.t('runtime.semanticWorldSaved'));
  }catch{lightweightHost.toast(i18n.t('runtime.semanticWorldSaveFailed'));}finally{setSavingWorld(false);}
 };
 return <><LightweightRuntimeStartScreen tools={!run.completedAt&&<RuntimeTools content={content} personalContent={phase==='reveal'?content:null} showSave={phase==='reveal'} onMarkKnown={()=>void declareMastery(target.id)} onOpenMenuMore={lightweightHost.onOpenMenuMore} toast={lightweightHost.toast} busy={busy||savingWorld}/>} active={active} busy={busy||savingWorld} completionKey={run.completedAt?`${run.id}:${run.revision}`:null} target={localTargetView(target,target.curriculumMembership)} materialization={material} step={run.completedAt?null:step} completed={!!run.completedAt} hasNextTarget={hasNextTarget} onExit={onExit} onReveal={()=>dispatch({kind:'reveal'})} onRate={rating=>dispatch({kind:'rate',rating})} onFinish={onFinish} personalScene={sceneRevision} onOpenPersonalScene={run.purpose==='initial_learning'?openPersonalScene:undefined} semanticWorldState={phase==='reveal'?worldState:null} onSaveToSemanticWorld={acceptPersonalScene} onOpenDictionary={lightweightHost.openDict} lookupDictionary={lightweightHost.lookupDictionary} toast={lightweightHost.toast} purpose={run.purpose}/>{active&&notice&&<p role="status" className="fixed bottom-4 left-4 right-4 z-[100] rounded-xl bg-accent-soft p-3">{localFlowNotice(notice)}</p>}</>;
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
 {surface:'lightweight_initial',runtimeAdapterId:'lightweight',purpose:'initial_learning',protocolId:'lightweight-study',protocolVersion:'v3',localProtocolVersion:'sensa-lightweight-initial-v1'},
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

const localRuntimePresentationRegistry=new LocalRuntimePresentationRegistry<RuntimePresentationProps>([
 {manifest:{contractVersion:localRuntimePresentationContractVersion,pluginId:'sensa.web.lightweight',pluginVersion:'v1',displayName:'Sensa Lightweight Runtime',capabilities:['toast','dictionary','personal_scenes','personal_content_menu','declared_mastery'],bindings:[...LIGHTWEIGHT_PRESENTATION_BINDINGS]},render:LightweightPackageRuntime},
 {manifest:{contractVersion:localRuntimePresentationContractVersion,pluginId:'sensa.web.structured',pluginVersion:'v1',displayName:'Sensa Structured Runtime',capabilities:['toast','dictionary','notes','personal_scenes','personal_content_menu','declared_mastery'],bindings:[...STRUCTURED_PRESENTATION_BINDINGS]},render:StructuredPackageRuntime},
 {manifest:{contractVersion:localRuntimePresentationContractVersion,pluginId:'sensa.web.interleaved-four-stage',pluginVersion:'v1',displayName:'Sensa Interleaved Four-stage Runtime',capabilities:[],bindings:[...FOUR_STAGE_PRESENTATION_BINDINGS]},render:props=>props.run.purpose==='initial_learning'?<FourStageInitialPackageRuntime {...props}/>:<FourStageReviewPackageRuntime {...props}/>},
] satisfies readonly LocalRuntimePresentationPlugin<RuntimePresentationProps>[]);

// This composition root is paid only when a formal Runtime opens. It still
// closes every Protocol/presentation binding before the first Step is shown.
const localLearningRuntimeComposition=composeLocalLearningRuntime(localRuntimePresentationRegistry);
void localLearningRuntimeComposition;
