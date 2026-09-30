import {lazy,useCallback,useMemo,useState,type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import i18n from '../../i18n';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import {localFlowText} from '../../i18n/localFlowText';
import {useShellNavigation} from '../router/useShellNavigation';
import {useOverlayStore} from '../stores/overlayStore';
import {usePackageLearning} from './usePackageLearning';
import {usePersonalLearning} from './usePersonalLearning';
import {usePracticeScope} from '../usePracticeScope';
import {createPracticeScopeSnapshot,type PracticeScopeSnapshot} from '../practiceScope';
import {contentSenseForId,type ContentSectionId} from '../../learnerSemanticProjection/system';
import type {PracticeSenseItem} from '../practiceData';
import {JourneyAlignmentLearningControls,PersonalPreparationTarget,pendingPersonalTargetView} from './PersonalLearningControls';
import {LearningSetupFrame} from '../components/learning/LearningSetupFrame';
import {LearningPreferencesPanel} from '../components/learning/LearningPreferencesPanel';
import {PackageTarget} from './PackageLearningViews';
import {
 PackageBookScreen,
 PackageCatalogScreen,
 PackageLibraryScreen,
 PackagePublisherScreen,
} from './PackageCenter';
import {ScreenHost} from '../ui/ScreenHost';
import {screenInstanceKey} from '../router/shellLocation';
import type {LearningShellScreenId} from '../router/screenRegistry';

const AcademyScreen=lazy(()=>import('../components/AcademyScreen').then(module=>({default:module.AcademyScreen})));
const PracticeScopeScreen=lazy(()=>import('../components/PracticeScopeScreen').then(module=>({default:module.PracticeScopeScreen})));
const YouGlishListeningScreen=lazy(()=>import('../components/YouGlishListeningScreen').then(module=>({default:module.YouGlishListeningScreen})));
const ContentScreen=lazy(()=>import('../components/ContentScreen').then(module=>({default:module.ContentScreen})));
const ConfirmedSenseDetailScreen=lazy(()=>import('../components/ConfirmedSenseDetailScreen').then(module=>({default:module.ConfirmedSenseDetailScreen})));
const StudyScreen=lazy(()=>import('../components/StudyScreen').then(module=>({default:module.StudyScreen})));
const LearningTargetLibraryScreen=lazy(()=>import('../components/learning/LearningTargetLibraryScreen').then(module=>({default:module.LearningTargetLibraryScreen})));
const ProfileScreen=lazy(()=>import('../components/ProfileScreen').then(module=>({default:module.ProfileScreen})));
const StatsScreen=lazy(()=>import('../components/StatsScreen').then(module=>({default:module.StatsScreen})));
const BatchPersonalLearning=lazy(()=>import('./BatchPersonalLearning').then(module=>({default:module.BatchPersonalLearning})));
const ProviderPanel=lazy(()=>import('../components/ProviderPanel').then(module=>({default:module.ProviderPanel})));
const PackageRuntime=lazy(()=>import('./PackageLearningRuntime').then(module=>({default:module.PackageRuntime})));

type LearningWorkspaceScreenId=LearningShellScreenId|'s-lightweight-runtime';

/** Full learning controllers live behind this bounded screen-lifecycle seam. */
export function LearningWorkspace({active=true}:{active?:boolean}){
 const {t}=useTranslation();
 const {viewMode,mainStack,params,setViewMode,goMain,backMain,resetMain,returnHome,setMainStack}=useShellNavigation();
 const packageCenterOpen=viewMode==='main'&&mainStack.some(screen=>[
  's-learning-entry','s-catalog','s-catalog-book','s-library','s-publisher',
 ].includes(screen));
 const packageLearning=usePackageLearning(packageCenterOpen);
 const personalLearning=usePersonalLearning();
 const activeRoute={id:packageLearning.languageContext.languageRouteId,targetLanguageTag:packageLearning.languageContext.targetLanguageTag};
 const toast=useOverlayStore(state=>state.toast);
 const pendingPersonal=personalLearning.tasks.filter(task=>!packageLearning.targets.some(target=>target.targetId===task.targetId&&target.curriculumMembershipId===task.curriculumMembershipId));
 const activePendingPersonal=pendingPersonal.filter(task=>task.languageContext.languageRouteId===activeRoute.id);
 const selectedPersonalTask=activePendingPersonal.find(task=>task.targetId===params.targetId);
 const localSelectedTarget=packageLearning.activeTargets.find(target=>target.targetId===params.targetId);
 const openLocalTarget=(id:string)=>goMain('s-learning-target',{targetId:id});
 const practiceStudyTargets=useMemo(()=>packageLearning.activeTargets.map(target=>({target})),[packageLearning.activeTargets]);
 const {catalog:practiceScopeCatalog,selectScope}=usePracticeScope({studyTargets:practiceStudyTargets,activeLanguageTag:activeRoute.targetLanguageTag});
 const [activePracticeScope,setActivePracticeScope]=useState<PracticeScopeSnapshot|null>(null);
 const openRealWorldListening=useCallback(()=>{
  setActivePracticeScope(createPracticeScopeSnapshot(practiceScopeCatalog.currentScope,crypto.randomUUID(),new Date().toISOString()));
  goMain('s-real-world-listening');
 },[goMain,practiceScopeCatalog.currentScope]);
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
 const [quantityTarget,setQuantityTarget]=useState<string|null>(null);
 const [quantityChoice,setQuantityChoice]=useState(20);
 const quantityTargetRecord=quantityTarget?packageLearning.targets.find(target=>target.targetId===quantityTarget):undefined;
 const updateLocalQuantity=(value:number)=>{void packageLearning.confirmQuantity(value);};
 const startLocalLearning=async(id?:string,reviewOnly=false)=>{
  const targetId=id??packageLearning.runtime?.currentTargetId??packageLearning.due[0]?.targetId??(!reviewOnly?packageLearning.initialReady[0]?.targetId:undefined);
  if(!targetId){setMainStack(['s-catalog']);return;}
  if(packageLearning.dailyLimit===undefined){setQuantityChoice(dailyNewCount);setQuantityTarget(targetId);return;}
  if(await packageLearning.start(targetId,dailyNewCount))setViewMode('lightweight');
 };
 const personalMeaningId=params.meaningId??null,meaningFocusId=params.focusId??null;
 const currentScreen=viewMode==='lightweight'?'s-lightweight-runtime':mainStack.at(-1)??'s-study';
 const renderContentScreen=(screenId:'s-content'|'s-semantic-world',screenActive:boolean)=><ContentScreen
    bulkLearning={(items,list)=><BatchPersonalLearning items={items} c={personalLearning}>{list}</BatchPersonalLearning>}
    active={screenActive} screenId={screenId}
    initialAction={params.worldAction==='create'||params.worldAction==='inbox'?params.worldAction:undefined}
    onStartConversation={startSensaConversation}
    onBrowseExisting={()=>setMainStack(['s-catalog'])} onOpenPersonalMeaning={openPersonalMeaning}
    onOpenConfirmedSense={openConfirmedSense} onOpenSense={openSemanticWorldSense}
    onOpenSection={openContentSection} toast={toast}/>;
 const renderLearningTarget=(screenActive:boolean):ReactNode=>{
  if(localSelectedTarget)return <PackageTarget active={screenActive} target={localSelectedTarget} c={packageLearning} onSource={()=>{const provenance=localSelectedTarget.material.snapshot.provenance;if('personalMeaningId' in provenance&&typeof provenance.personalMeaningId==='string')openPersonalMeaning(provenance.personalMeaningId);else backMain();}} onBack={backMain} onHome={resetMain} onStart={()=>void startLocalLearning(localSelectedTarget.targetId)}/>;
  if(selectedPersonalTask)return <PersonalPreparationTarget task={selectedPersonalTask} c={personalLearning} onSource={()=>openPersonalLearningSource(selectedPersonalTask)} active={screenActive} onBack={backMain} onHome={resetMain} onStart={id=>void startLocalLearning(id)}/>;
  return <LearningSetupFrame id="s-learning-target" active={screenActive} title={localFlowText('learningTarget')} onBack={backMain}><p role="status">{packageLearning.loaded?localFlowText('targetMissing'):localFlowText('targetLoading')}</p></LearningSetupFrame>;
 };
 const learningScreenRenderers:Record<LearningWorkspaceScreenId,(active:boolean)=>ReactNode>={
  's-academy':screenActive=><AcademyScreen active={screenActive} onBack={backMain} onOpenPracticeScope={()=>goMain('s-practice-scope')} onOpenRealWorldListening={openRealWorldListening} practiceScope={practiceScopeCatalog.currentScope}/>,
  's-practice-scope':screenActive=><PracticeScopeScreen active={screenActive} catalog={practiceScopeCatalog} onBack={backMain} onSelectScope={selectScope}/>,
  's-content':screenActive=>renderContentScreen('s-content',screenActive),
  's-semantic-world':screenActive=>renderContentScreen('s-semantic-world',screenActive),
  's-confirmed-sense':screenActive=><ConfirmedSenseDetailScreen active={screenActive} personalMeaningId={personalMeaningId} meaningFocusId={meaningFocusId} onBack={backMain} onOpenBinding={()=>goMain('s-expression-binding')} learningControls={(detail,alignment)=><JourneyAlignmentLearningControls detail={detail} alignment={alignment} c={personalLearning} onStart={id=>void startLocalLearning(id)}/>}/>,
  's-real-world-listening':screenActive=><YouGlishListeningScreen active={screenActive} targets={(activePracticeScope??practiceScopeCatalog.currentScope).targets} onBack={backMain} toast={toast}/>,
  's-study':screenActive=><StudyScreen
    policySummary={[...new Set(packageLearning.targets.map(target=>target.policy))].map(policy=>t('learningPreferences.policies.'+policy)).join(' · ')||undefined}
    active={screenActive} tab={studyTab} onTabChange={setStudyTab} onAddLearning={()=>setMainStack(['s-catalog'])}
    onOpenTargetLibrary={()=>goMain('s-learning-library')} onOpenTarget={openLocalTarget}
    onPolicyChange={()=>{}} defaultPolicy="lightweight" policyOptions={packageLearning.policyOptions} fixedPolicy
    learningTargetCount={packageLearning.activeTargets.length+activePendingPersonal.length}
    languageLabel={interfaceLanguageDisplayName(activeRoute.targetLanguageTag,resolveInterfaceLocale(i18n.language))}
    readyInitialCount={packageLearning.initialReady.length} reviewCount={packageLearning.due.length}
    dailyNewCount={dailyNewCount} learningRecords={packageLearning.records}
    onOpenStats={()=>goMain('s-stats')} onDailyNewCountChange={updateLocalQuantity}/>,
  's-learning-library':screenActive=><LearningTargetLibraryScreen active={screenActive}
    targets={Object.fromEntries([...packageLearning.activeTargets.map(target=>[target.targetId,target.presentation]),...activePendingPersonal.map(task=>[task.targetId,pendingPersonalTargetView(task,personalLearning.sourceForTask(task))])])}
    targetIds={[...packageLearning.activeTargets.map(target=>target.targetId),...activePendingPersonal.map(task=>task.targetId)]}
    policyByTarget={Object.fromEntries([...packageLearning.activeTargets.map(target=>[target.targetId,target.policy]),...activePendingPersonal.map(task=>[task.targetId,'lightweight' as const])])}
    preparationByTarget={Object.fromEntries([...packageLearning.activeTargets.map(target=>[target.targetId,target.preparation]),...activePendingPersonal.map(task=>[task.targetId,task.status==='failed'||task.status==='rejected'?'blocked' as const:'preparing' as const])])}
    committedTargetIds={new Set(packageLearning.activeTargets.filter(target=>target.started).map(target=>target.targetId))}
    completedTargetIds={new Set(packageLearning.activeTargets.filter(target=>target.completed).map(target=>target.targetId))}
    reviewDueTargetIds={new Set(packageLearning.due.map(target=>target.targetId))}
    relearningTargetIds={new Set(packageLearning.activeTargets.filter(target=>target.relearning).map(target=>target.targetId))}
    reviewingTargetIds={new Set()} relearningRepairTargetIds={new Set()} relearningRetestTargetIds={new Set()} declaredMasteryTargetIds={new Set(packageLearning.activeTargets.filter(target=>target.declaredMastery).map(target=>target.targetId))}
    onBack={backMain} onAddLearning={()=>setMainStack(['s-catalog'])} onOpenTarget={openLocalTarget}/>,
  's-catalog':screenActive=><PackageCatalogScreen active={screenActive} c={packageLearning} onBack={backMain}
    onOpenBook={bookKey=>setMainStack(['s-catalog','s-catalog-book'],{bookKey})}
    onLibrary={()=>setMainStack(['s-library'])} onPublisher={()=>setMainStack(['s-publisher'])}/>,
  's-catalog-book':screenActive=><PackageBookScreen active={screenActive} bookKey={params.bookKey??null} c={packageLearning}
    onBack={()=>setMainStack(['s-catalog'])} onLearning={returnHome} onTarget={openLocalTarget}/>,
  's-library':screenActive=><PackageLibraryScreen active={screenActive} c={packageLearning} onBack={backMain}
    onCatalog={()=>setMainStack(['s-catalog'])}
    onOpenBook={bookKey=>setMainStack(['s-catalog','s-catalog-book'],{bookKey})}
    onPublisher={()=>setMainStack(['s-publisher'])} onLearning={returnHome} onTarget={openLocalTarget}/>,
  's-publisher':screenActive=><PackagePublisherScreen active={screenActive} c={packageLearning} onBack={backMain}
    onCatalog={()=>setMainStack(['s-catalog'])} onLibrary={()=>setMainStack(['s-library'])}/>,
  's-learning-entry':screenActive=><PackageCatalogScreen active={screenActive} c={packageLearning} onBack={backMain}
    onOpenBook={bookKey=>setMainStack(['s-catalog','s-catalog-book'],{bookKey})}
    onLibrary={()=>setMainStack(['s-library'])} onPublisher={()=>setMainStack(['s-publisher'])}/>,
  's-learning-target':renderLearningTarget,
  's-stats':screenActive=><StatsScreen active={screenActive} onBack={backMain} records={packageLearning.records} onOpenTarget={openLocalTarget}/>,
  's-profile':screenActive=><ProfileScreen localLibrary fixedLearningPolicy modelSettings={<ProviderPanel/>} active={screenActive} onGoStudyPlan={()=>{setStudyTab('a');goMain('s-study');}} defaultPolicy="lightweight" policyOptions={packageLearning.policyOptions} dailyNewCount={dailyNewCount} onPolicyChange={()=>{}} onDailyNewCountChange={updateLocalQuantity}/>,
  's-lightweight-runtime':screenActive=><PackageRuntime active={screenActive} c={packageLearning} onExit={returnHome} onViewLearningLibrary={()=>setMainStack(['s-study','s-learning-library'])} onFinish={()=>void packageLearning.advance().then(continued=>{if(!continued)returnHome();})}/>,
 };
 const renderScreen=(screenActive:boolean)=>learningScreenRenderers[currentScreen as LearningWorkspaceScreenId]?.(screenActive)??null;
 const fallback=<section id={currentScreen} className="screen active absolute inset-0 grid place-content-center bg-surface-canvas text-fg-primary" role="status">{localFlowText('loadingSensa')}</section>;
 return <>
  <ScreenHost screenKey={screenInstanceKey(currentScreen,params)} active={active} fallback={fallback}>{renderScreen}</ScreenHost>
  {quantityTarget&&quantityTargetRecord&&<LearningPreferencesPanel
   fixedPolicy defaultPolicy={quantityTargetRecord.policy} policyOptions={packageLearning.policyOptions}
   dailyNewCount={quantityChoice} onPolicyChange={()=>{}}
   onDailyNewCountChange={setQuantityChoice} busy={packageLearning.busy}
   status={packageLearning.notice&&<p role="status">{packageLearning.notice}</p>}
   onClose={()=>setQuantityTarget(null)} closeLabel={localFlowText('confirmAndStart')}
   onConfirm={()=>void packageLearning.confirmQuantity(quantityChoice).then(async ok=>{
    if(!ok)return;
    const target=quantityTarget;
    setQuantityTarget(null);
    if(await packageLearning.start(target,quantityChoice))setViewMode('lightweight');
   })}
  />}
 </>;
}
