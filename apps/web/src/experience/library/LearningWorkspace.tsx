import {lazy,useCallback,useState,type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import i18n from '../../i18n';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import {localFlowNotice,localFlowText} from '../../i18n/localFlowText';
import {useShellNavigation} from '../router/useShellNavigation';
import {useOverlayStore} from '../stores/overlayStore';
import {usePackageLearning} from './usePackageLearning';
import {BookPlanPanel} from './BookPlanPanel';
import {SupplementalPlanPanel} from './SupplementalPlanPanel';
import {usePersonalLearning} from './usePersonalLearning';
import {contentSenseForId,type ContentSectionId} from '../../learnerSemanticProjection/system';
import type {PracticeSenseItem} from '../practiceData';
import {JourneyAlignmentLearningControls,PersonalPreparationTarget,pendingPersonalTargetView} from './PersonalLearningControls';
import {LearningSetupFrame,setupButton} from '../components/learning/LearningSetupFrame';
import {PackageTarget} from './PackageLearningViews';
import {ScreenHost} from '../ui/ScreenHost';
import {screenInstanceKey} from '../router/shellLocation';
import type {LearningShellScreenId} from '../router/screenRegistry';

const PersonalMeaningDetailScreen=lazy(()=>import('../components/PersonalMeaningDetailScreen').then(module=>({default:module.PersonalMeaningDetailScreen})));
const ContentScreen=lazy(()=>import('../components/ContentScreen').then(module=>({default:module.ContentScreen})));
const ConfirmedSenseDetailScreen=lazy(()=>import('../components/ConfirmedSenseDetailScreen').then(module=>({default:module.ConfirmedSenseDetailScreen})));
const StudyScreen=lazy(()=>import('../components/StudyScreen').then(module=>({default:module.StudyScreen})));
const LearningTargetLibraryScreen=lazy(()=>import('../components/learning/LearningTargetLibraryScreen').then(module=>({default:module.LearningTargetLibraryScreen})));
const ProfileScreen=lazy(()=>import('../components/ProfileScreen').then(module=>({default:module.ProfileScreen})));
const StatsScreen=lazy(()=>import('../components/StatsScreen').then(module=>({default:module.StatsScreen})));
const BatchPersonalLearning=lazy(()=>import('./BatchPersonalLearning').then(module=>({default:module.BatchPersonalLearning})));
const DirectLearningScreen=lazy(()=>import('./DirectLearningScreen').then(module=>({default:module.DirectLearningScreen})));
const LearningEntryScreen=lazy(()=>import('./DirectLearningScreen').then(module=>({default:module.LearningEntryScreen})));
const ProviderPanel=lazy(()=>import('../components/ProviderPanel').then(module=>({default:module.ProviderPanel})));
const PackageRuntime=lazy(()=>import('./PackageLearningRuntime').then(module=>({default:module.PackageRuntime})));
// Content discovery is a separate screen lifecycle, not a synchronous cost of
// resuming a learner's Run or opening its target/history management view.
const PackageBookScreen=lazy(()=>import('./PackageCenter').then(module=>({default:module.PackageBookScreen})));
const PackageCatalogScreen=lazy(()=>import('./PackageCenter').then(module=>({default:module.PackageCatalogScreen})));
const PackageLibraryScreen=lazy(()=>import('./PackageCenter').then(module=>({default:module.PackageLibraryScreen})));
const PackageLibraryDetailScreen=lazy(()=>import('./PackageCenter').then(module=>({default:module.PackageLibraryDetailScreen})));
const PackagePublisherScreen=lazy(()=>import('./PackageCenter').then(module=>({default:module.PackagePublisherScreen})));

type LearningWorkspaceScreenId=LearningShellScreenId|'s-lightweight-runtime';

/** Full learning controllers live behind this bounded screen-lifecycle seam. */
export function LearningWorkspace({active=true}:{active?:boolean}){
 const {t}=useTranslation();
 const {viewMode,mainStack,params,setViewMode,goMain,backMain,resetMain,returnHome,setMainStack}=useShellNavigation();
 const currentScreen=viewMode==='lightweight'?'s-lightweight-runtime':mainStack.at(-1)??'s-study';
 const packageCenterOpen=viewMode==='main'&&mainStack.some(screen=>[
  's-learning-entry','s-catalog','s-catalog-book','s-library','s-library-package','s-publisher',
 ].includes(screen));
 const executing=currentScreen==='s-lightweight-runtime';
 const managementOnly=['s-study','s-stats','s-profile'].includes(currentScreen);
 const packageLearning=usePackageLearning(packageCenterOpen,currentScreen==='s-profile'||currentScreen==='s-stats'?'preferences':currentScreen==='s-learning-target'?'target':executing?'runtime':managementOnly?'management':'workspace',currentScreen==='s-learning-target'?params.targetId:undefined);
 const personalOpen=active&&['s-study','s-learning-library','s-learning-target','s-content','s-semantic-world','s-personal-meaning','s-confirmed-sense'].includes(currentScreen);
 const personalLearning=usePersonalLearning(currentScreen==='s-learning-library'?{kind:'library'}:currentScreen==='s-learning-target'&&params.targetId?{kind:'target',targetId:params.targetId}:null,personalOpen,managementOnly);
 const activeRoute={id:packageLearning.languageContext.languageRouteId,targetLanguageTag:packageLearning.languageContext.targetLanguageTag};
 const toast=useOverlayStore(state=>state.toast);
 const coveredIds=new Set(packageLearning.management?.targetIds??packageLearning.targets.map(target=>target.targetId));
 const pendingPersonal=personalLearning.tasks.filter(task=>!coveredIds.has(task.targetId));
 const activePendingPersonal=pendingPersonal.filter(task=>task.languageContext.languageRouteId===activeRoute.id);
 const pendingDirect=packageLearning.enrollments.flatMap(enrollment=>{
  const source=enrollment.source;
  return source.kind==='stable_sense'&&enrollment.languageRouteId===activeRoute.id&&!packageLearning.activeTargets.some(target=>target.identity.senseVersionId===source.senseVersionId&&target.identity.bindingVersionId===source.bindingVersionId)
   ?[{enrollmentId:enrollment.enrollmentId,expression:source.expression,meaning:source.meaning}]:[];
 });
 const openDirect=(enrollmentId?:string)=>goMain('s-direct-learning',{enrollmentId});
 const selectedPersonalTask=activePendingPersonal.find(task=>task.targetId===params.targetId);
 const localSelectedTarget=packageLearning.activeTargets.find(target=>target.targetId===params.targetId);
 const openLocalTarget=(id:string)=>goMain('s-learning-target',{targetId:id});
 const openContentSection=useCallback((section:ContentSectionId)=>goMain('s-content-library',{section}),[goMain]);
 const openContentSense=useCallback((item:PracticeSenseItem)=>goMain('s-content-sense',{senseId:item.senseId}),[goMain]);
 const openSemanticWorldSense=useCallback((senseId:string)=>{const item=contentSenseForId(senseId);if(item)openContentSense(item);},[openContentSense]);
 const openPersonalMeaning=useCallback((meaningId:string,focusId?:string)=>goMain('s-personal-meaning',{meaningId,focusId}),[goMain]);
 const openConfirmedSense=useCallback((meaningId:string,focusId:string)=>goMain('s-confirmed-sense',{meaningId,focusId}),[goMain]);
 const startSensaConversation=useCallback(()=>goMain('s-personal-meaning',{
  meaningId:undefined,
  focusId:undefined,
  // `worldAction=create` is a one-shot entry command. Leaving it in the URL
  // reopens this screen as soon as the learner backs out to the semantic world.
  worldAction:undefined,
 }),[goMain]);
 const openPersonalLearningSource=useCallback((task:typeof personalLearning.tasks[number])=>goMain('s-confirmed-sense',{meaningId:task.source.personalMeaningId,focusId:task.source.meaningFocusId??task.source.personalMeaningAlignmentId}),[goMain]);
 const [studyTab,setStudyTab]=useState<'a'|'b'>('a');
 const dailyNewCount=packageLearning.dailyLimit??20;
 const updateLocalQuantity=(value:number)=>{void packageLearning.confirmQuantity(value);};
 const startLocalLearning=async(id?:string,reviewOnly=false)=>{
  const targetId=id??packageLearning.runtime?.currentTargetId??packageLearning.due[0]?.targetId??(!reviewOnly?packageLearning.initialReady[0]?.targetId:undefined);
  if(!targetId){setMainStack(['s-catalog']);return;}
  const intent=reviewOnly?'review_only':'mixed';
  if(await packageLearning.start(targetId,dailyNewCount,intent))setViewMode('lightweight');
 };
 const personalMeaningId=params.meaningId??null,meaningFocusId=params.focusId??null;
 const renderContentScreen=(screenId:'s-content'|'s-semantic-world',screenActive:boolean)=><ContentScreen
    bulkLearning={(items,list,query)=><BatchPersonalLearning items={items} query={query} c={personalLearning}>{list}</BatchPersonalLearning>}
    active={screenActive} screenId={screenId}
    initialAction={params.worldAction==='create'||params.worldAction==='inbox'||params.worldAction==='add'?params.worldAction:undefined}
    onInitialActionConsumed={()=>goMain(screenId,{worldAction:undefined})}
    onStartConversation={startSensaConversation}
    onBrowseExisting={()=>setMainStack(['s-catalog'])} onOpenPersonalMeaning={openPersonalMeaning}
    onOpenConfirmedSense={openConfirmedSense} onOpenSense={openSemanticWorldSense}
    onOpenLearningContent={targetId=>goMain('s-content-sense',{targetId,senseId:undefined})}
    onOpenSection={openContentSection} toast={toast}/>;
 const renderLearningTarget=(screenActive:boolean):ReactNode=>{
  // A failed detail read is not evidence that the Target is absent or that a
  // previously covered personal request needs preparation again.
  if(packageLearning.loadStatus==='unavailable')return <LearningSetupFrame id="s-learning-target" active={screenActive} title={localFlowText('learningTarget')} onBack={backMain}><div role="alert"><p>{packageLearning.notice||localFlowText('progressReadFailed')}</p><button className={setupButton} onClick={()=>{void packageLearning.retryInitialLoad();personalLearning.retryTaskSources();}}>{t('reliability.retry')}</button></div></LearningSetupFrame>;
  if(localSelectedTarget){
   const personalTask=personalLearning.tasks.find(task=>task.status==='ready'&&task.targetId===localSelectedTarget.targetId&&task.curriculumMembershipId===localSelectedTarget.curriculumMembershipId);
   const exportPackageKey=packageLearning.targetExportPackageKey;
   const onExport=personalTask?()=>personalLearning.exportPackage(personalTask.id):exportPackageKey?()=>packageLearning.exportPackage(exportPackageKey):undefined;
   return <PackageTarget active={screenActive} target={localSelectedTarget} c={packageLearning}
    onManage={()=>setMainStack(['s-study'])}
    onExport={onExport} exportBusy={personalTask?personalLearning.busy:packageLearning.busy} exportNotice={personalTask?personalLearning.notice:undefined}
    onSource={()=>{
     const provenance=localSelectedTarget.material.snapshot.provenance;
     if('personalMeaningId' in provenance&&typeof provenance.personalMeaningId==='string')openPersonalMeaning(provenance.personalMeaningId);
     else if(localSelectedTarget.packageKey)goMain('s-library-package',{packageKey:localSelectedTarget.packageKey,publicationArchiveSha256:localSelectedTarget.publicationArchiveSha256??undefined});
     else backMain();
    }} onBack={backMain} onHome={resetMain} onStart={()=>void startLocalLearning(localSelectedTarget.targetId,localSelectedTarget.completed)}/>;
  }
  if(selectedPersonalTask)return <PersonalPreparationTarget task={selectedPersonalTask} c={personalLearning} onSource={()=>openPersonalLearningSource(selectedPersonalTask)} active={screenActive} onBack={backMain} onHome={resetMain} onStart={id=>void startLocalLearning(id)}/>;
  return <LearningSetupFrame id="s-learning-target" active={screenActive} title={localFlowText('learningTarget')} onBack={backMain}><p role="status">{packageLearning.loaded?localFlowText('targetMissing'):localFlowText('targetLoading')}</p></LearningSetupFrame>;
 };
 const managementStatus=packageLearning.loadStatus==='unavailable'?<div role="alert"><p>{packageLearning.notice||localFlowText('progressReadFailed')}</p><button className={setupButton} onClick={()=>void packageLearning.retryInitialLoad()}>{t('reliability.retry')}</button></div>:packageLearning.loadStatus==='loading'?<p role="status" aria-busy="true">{localFlowText('loadingSensa')}</p>:null;
 const preferencesStatus=managementStatus??(packageLearning.notice?<p role="alert">{localFlowNotice(packageLearning.notice)}</p>:null);
 const preferencesBusy=packageLearning.busy||packageLearning.loadStatus!=='ready';
 const learningScreenRenderers:Record<LearningWorkspaceScreenId,(active:boolean)=>ReactNode>={
  's-content':screenActive=>renderContentScreen('s-content',screenActive),
  's-semantic-world':screenActive=>renderContentScreen('s-semantic-world',screenActive),
  's-personal-meaning':screenActive=><PersonalMeaningDetailScreen key={personalMeaningId} active={screenActive} personalMeaningId={personalMeaningId}
    onConversationCreated={openPersonalMeaning} onBack={backMain} onOpenConfirmedSense={openConfirmedSense} toast={toast}
    alignmentLearningControls={(detail,alignment)=><JourneyAlignmentLearningControls detail={detail} alignment={alignment} c={personalLearning} onStart={id=>void startLocalLearning(id)}/>}/>,
  's-confirmed-sense':screenActive=><ConfirmedSenseDetailScreen active={screenActive} personalMeaningId={personalMeaningId} meaningFocusId={meaningFocusId} onBack={backMain} onOpenBinding={()=>goMain('s-expression-binding')} learningControls={(detail,alignment)=><JourneyAlignmentLearningControls detail={detail} alignment={alignment} c={personalLearning} onStart={id=>void startLocalLearning(id)}/>}/>,
  's-study':screenActive=><StudyScreen
    bookPlans={<><BookPlanPanel active={screenActive}/><SupplementalPlanPanel active={screenActive}/></>}
    availability={packageLearning.loadStatus} status={managementStatus}
    preferencesBusy={preferencesBusy} preferencesStatus={preferencesStatus}
    active={screenActive} tab={studyTab} onTabChange={setStudyTab} onAddLearning={()=>goMain('s-learning-entry')}
    onOpenTargetLibrary={()=>goMain('s-learning-library')} onOpenTarget={openLocalTarget}
    onPolicyChange={()=>{}} defaultPolicy="lightweight" policyOptions={packageLearning.policyOptions} fixedPolicy
    learningTargetCount={(packageLearning.management?.targetIds.length??packageLearning.activeTargets.length)+activePendingPersonal.length+(packageLearning.management?.pendingDirectCount??pendingDirect.length)}
    languageLabel={interfaceLanguageDisplayName(activeRoute.targetLanguageTag,resolveInterfaceLocale(i18n.language))}
    readyInitialCount={packageLearning.management?.readyInitialCount??packageLearning.initialReady.length} reviewCount={packageLearning.management?.reviewDueCount??packageLearning.due.length}
    dailyNewCount={dailyNewCount}
    onOpenStats={()=>goMain('s-stats')} onDailyNewCountChange={updateLocalQuantity}/>,
  's-learning-library':screenActive=><LearningTargetLibraryScreen active={screenActive}
    availability={packageLearning.loadStatus}
    notice={packageLearning.loadStatus==='unavailable'?<div role="alert"><p>{packageLearning.notice||localFlowText('preparationReadFailed')}</p><button className={setupButton} onClick={()=>void packageLearning.retryInitialLoad()}>{t('reliability.retry')}</button></div>:packageLearning.loadStatus==='loading'?<p role="status" aria-busy="true">{localFlowText('loadingSensa')}</p>:personalLearning.taskSourcesUnavailable?<div role="alert"><p>{localFlowText('preparationReadFailed')}</p><button className={setupButton} onClick={personalLearning.retryTaskSources}>{localFlowText('retryPreparation')}</button></div>:personalLearning.taskSourcesLoading?<p role="status" aria-busy="true">{localFlowText('loadingSensa')}</p>:null}
    pendingEntries={pendingDirect} onOpenPending={openDirect}
    targets={Object.fromEntries([...packageLearning.activeTargets.map(target=>[target.targetId,target.presentation]),...activePendingPersonal.map(task=>[task.targetId,pendingPersonalTargetView(task,personalLearning.sourceForTask(task),personalLearning.taskSourcesLoading)])])}
    targetIds={[...packageLearning.activeTargets.map(target=>target.targetId),...activePendingPersonal.map(task=>task.targetId)]}
    policyByTarget={Object.fromEntries([...packageLearning.activeTargets.map(target=>[target.targetId,target.policy]),...activePendingPersonal.map(task=>[task.targetId,'lightweight' as const])])}
    preparationByTarget={Object.fromEntries([...packageLearning.activeTargets.map(target=>[target.targetId,target.preparation]),...activePendingPersonal.map(task=>[task.targetId,task.status==='failed'||task.status==='rejected'?'blocked' as const:'preparing' as const])])}
    committedTargetIds={new Set(packageLearning.activeTargets.filter(target=>target.started).map(target=>target.targetId))}
    completedTargetIds={new Set(packageLearning.activeTargets.filter(target=>target.completed).map(target=>target.targetId))}
    reviewDueTargetIds={new Set(packageLearning.due.map(target=>target.targetId))}
    relearningTargetIds={new Set(packageLearning.activeTargets.filter(target=>target.relearning).map(target=>target.targetId))}
    reviewingTargetIds={new Set()} relearningRepairTargetIds={new Set()} relearningRetestTargetIds={new Set()} declaredMasteryTargetIds={new Set(packageLearning.activeTargets.filter(target=>target.declaredMastery).map(target=>target.targetId))}
    onBack={backMain} onAddLearning={()=>goMain('s-learning-entry')} onOpenTarget={openLocalTarget}/>,
  's-catalog':screenActive=><PackageCatalogScreen active={screenActive} c={packageLearning} onBack={backMain}
    onOpenBook={bookKey=>setMainStack(['s-catalog','s-catalog-book'],{bookKey})}
    onLibrary={()=>setMainStack(['s-library'])} onPublisher={()=>setMainStack(['s-publisher'])}/>,
  's-catalog-book':screenActive=><PackageBookScreen active={screenActive} bookKey={params.bookKey??null} c={packageLearning}
    onBack={()=>setMainStack(['s-catalog'])} onLearning={returnHome} onTarget={openLocalTarget}/>,
  's-library':screenActive=><PackageLibraryScreen active={screenActive} c={packageLearning} onBack={backMain}
    onCatalog={()=>setMainStack(['s-catalog'])}
    onOpenBook={bookKey=>setMainStack(['s-catalog','s-catalog-book'],{bookKey})}
    onOpenPackage={packageKey=>setMainStack(['s-library','s-library-package'],{packageKey})}
    onPublisher={()=>setMainStack(['s-publisher'])} onLearning={returnHome} onTarget={openLocalTarget}/>,
  's-library-package':screenActive=><PackageLibraryDetailScreen active={screenActive} packageKey={params.packageKey??null} publicationArchiveSha256={params.publicationArchiveSha256} c={packageLearning}
    onBack={backMain} onLearning={returnHome} onTarget={openLocalTarget}/>,
  's-publisher':screenActive=><PackagePublisherScreen active={screenActive} c={packageLearning} onBack={backMain}
    onCatalog={()=>setMainStack(['s-catalog'])} onLibrary={()=>setMainStack(['s-library'])}/>,
  's-learning-entry':screenActive=><LearningEntryScreen active={screenActive} onBack={backMain} onCatalog={()=>goMain('s-catalog')} onDirect={()=>openDirect()} onWorld={()=>goMain('s-semantic-world')}/>,
  's-direct-learning':screenActive=><DirectLearningScreen active={screenActive} languageContext={packageLearning.languageContext} enrollmentId={params.enrollmentId}
    onEnrolled={enrollmentId=>setMainStack(mainStack,{enrollmentId})} onBack={backMain} onCatalog={()=>goMain('s-catalog')} onSettings={()=>goMain('s-profile')} onTarget={openLocalTarget}/>,
  's-learning-target':renderLearningTarget,
  's-stats':screenActive=><StatsScreen active={screenActive} onBack={backMain} onOpenTarget={openLocalTarget}/>,
  's-profile':screenActive=><ProfileScreen localLibrary fixedLearningPolicy modelSettings={<ProviderPanel/>} active={screenActive} preferencesBusy={preferencesBusy} preferencesStatus={preferencesStatus} onGoStudyPlan={()=>{setStudyTab('a');goMain('s-study');}} defaultPolicy="lightweight" policyOptions={packageLearning.policyOptions} dailyNewCount={dailyNewCount} onPolicyChange={()=>{}} onDailyNewCountChange={updateLocalQuantity}/>,
  's-lightweight-runtime':screenActive=><PackageRuntime active={screenActive} c={packageLearning} onExit={returnHome} onViewLearningLibrary={()=>setMainStack(['s-study','s-learning-library'])} onFinish={()=>void packageLearning.advance().then(continued=>{if(continued===false)returnHome();})}/>,
 };
 const renderScreen=(screenActive:boolean)=>learningScreenRenderers[currentScreen as LearningWorkspaceScreenId]?.(screenActive)??null;
 const fallback=<section id={currentScreen} className="screen active absolute inset-0 grid place-content-center bg-surface-canvas text-fg-primary" role="status">{localFlowText('loadingSensa')}</section>;
 return <>
  <ScreenHost screenKey={screenInstanceKey(currentScreen,params)} active={active} fallback={fallback}>{renderScreen}</ScreenHost>
 </>;
}
