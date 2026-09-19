import {lazy,useCallback,useMemo,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {sensaLanguageDisplayName} from '@sensa/contracts/sensa';
import i18n from '../../i18n';
import {localFlowText} from '../../i18n/localFlowText';
import {localTargetPolicy} from '../../learning/runtime/localRuntimeBindings';
import {useShellNavigation} from '../router/useShellNavigation';
import {useOverlayStore} from '../stores/overlayStore';
import {usePackageLearning} from './usePackageLearning';
import {usePersonalLearning} from './usePersonalLearning';
import {useLanguageRoutes} from './useLanguageRoutes';
import {usePracticeScope} from '../usePracticeScope';
import {createPracticeScopeSnapshot,type PracticeScopeSnapshot} from '../practiceScope';
import {contentSenseForId,type ContentSectionId} from '../contentProjection';
import type {PracticeSenseItem} from '../practiceData';
import {JourneyAlignmentLearningControls,PersonalPreparationTarget,pendingPersonalTargetView} from './PersonalLearningControls';
import {LearningSetupFrame} from '../components/learning/LearningSetupFrame';
import {LearningPreferencesPanel} from '../components/learning/LearningPreferencesPanel';
import {PackageEntry,PackageTarget} from './PackageLearningViews';
import {localTargetView} from './localTargetView';
import {ScreenHost} from '../ui/ScreenHost';
import {screenInstanceKey} from '../router/shellLocation';

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

/** Full learning controllers live behind this bounded screen-lifecycle seam. */
export function LearningWorkspace({active=true}:{active?:boolean}){
 const {t}=useTranslation();
 const {viewMode,mainStack,params,setViewMode,goMain,backMain,resetMain,returnHome,setMainStack}=useShellNavigation();
 const packageLearning=usePackageLearning(viewMode==='main'&&mainStack.includes('s-learning-entry'));
 const personalLearning=usePersonalLearning();
 const {activeRoute}=useLanguageRoutes();
 const toast=useOverlayStore(state=>state.toast);
 const pendingPersonal=personalLearning.tasks.filter(task=>!packageLearning.targets.some(target=>target.id===task.targetId&&target.curriculumMemberships.some(membership=>membership.id===task.curriculumMembershipId)));
 const activePendingPersonal=pendingPersonal.filter(task=>task.languageContext.languageRouteId===activeRoute.id);
 const selectedPersonalTask=activePendingPersonal.find(task=>task.targetId===params.targetId);
 const localSelectedTarget=packageLearning.activeTargets.find(target=>target.id===params.targetId);
 const localSelectedMembership=localSelectedTarget?packageLearning.membershipByTarget[localSelectedTarget.id]:undefined;
 const openLocalTarget=(id:string)=>goMain('s-learning-target',{targetId:id});
 const practiceStudyTargets=useMemo(()=>packageLearning.activeTargets.flatMap(target=>{
  const membership=packageLearning.membershipByTarget[target.id];
  return membership?[{target,membership}]:[];
 }),[packageLearning.activeTargets,packageLearning.membershipByTarget]);
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
 const startSensaConversation=useCallback(()=>goMain('s-personal-meaning',{meaningId:undefined,focusId:undefined}),[goMain]);
 const openPersonalLearningSource=useCallback((task:typeof personalLearning.tasks[number])=>goMain('s-confirmed-sense',{meaningId:task.source.personalMeaningId,focusId:task.source.meaningFocusId??task.source.personalMeaningAlignmentId}),[goMain]);
 const [studyTab,setStudyTab]=useState<'a'|'b'>('a');
 const dailyNewCount=packageLearning.dailyLimit??20;
 const [quantityTarget,setQuantityTarget]=useState<string|null>(null);
 const [quantityChoice,setQuantityChoice]=useState(20);
 const quantityTargetRecord=quantityTarget?packageLearning.targets.find(target=>target.id===quantityTarget):undefined;
 const updateLocalQuantity=(value:number)=>{void packageLearning.confirmQuantity(value);};
 const startLocalLearning=async(id?:string,reviewOnly=false)=>{
  const targetId=id??packageLearning.run?.targetId??packageLearning.due[0]?.id??(!reviewOnly?packageLearning.initialReady[0]?.id:undefined);
  if(!targetId){goMain('s-learning-entry');return;}
  if(packageLearning.dailyLimit===undefined){setQuantityChoice(dailyNewCount);setQuantityTarget(targetId);return;}
  if(await packageLearning.start(targetId,dailyNewCount))setViewMode('lightweight');
 };
 const personalMeaningId=params.meaningId??null,meaningFocusId=params.focusId??null;
 const currentScreen=viewMode==='lightweight'?'s-lightweight-runtime':mainStack.at(-1)??'s-study';
 const renderScreen=(screenActive:boolean)=>{
  switch(currentScreen){
   case 's-academy': return <AcademyScreen active={screenActive} onBack={backMain} onOpenPracticeScope={()=>goMain('s-practice-scope')} onOpenRealWorldListening={openRealWorldListening} practiceScope={practiceScopeCatalog.currentScope}/>;
   case 's-practice-scope': return <PracticeScopeScreen active={screenActive} catalog={practiceScopeCatalog} onBack={backMain} onSelectScope={selectScope}/>;
   case 's-content':
   case 's-semantic-world': return <ContentScreen
    bulkLearning={(items,list)=><BatchPersonalLearning items={items} c={personalLearning}>{list}</BatchPersonalLearning>}
    active={screenActive} screenId={currentScreen}
    initialAction={params.worldAction==='create'||params.worldAction==='inbox'?params.worldAction:undefined}
    onStartConversation={startSensaConversation}
    onBrowseExisting={()=>goMain('s-learning-entry')} onOpenPersonalMeaning={openPersonalMeaning}
    onOpenConfirmedSense={openConfirmedSense} onOpenSense={openSemanticWorldSense}
    onOpenSection={openContentSection} toast={toast}/>;
   case 's-confirmed-sense': return <ConfirmedSenseDetailScreen active={screenActive} personalMeaningId={personalMeaningId} meaningFocusId={meaningFocusId} onBack={backMain} onOpenBinding={()=>goMain('s-expression-binding')} learningControls={(detail,alignment)=><JourneyAlignmentLearningControls detail={detail} alignment={alignment} c={personalLearning} onStart={id=>void startLocalLearning(id)}/>}/>;
   case 's-real-world-listening': return <YouGlishListeningScreen active={screenActive} targets={(activePracticeScope??practiceScopeCatalog.currentScope).targets} onBack={backMain} toast={toast}/>;
   case 's-study': return <StudyScreen
    policySummary={[...new Set(packageLearning.targets.map(localTargetPolicy))].map(policy=>t('learningPreferences.policies.'+policy)).join(' · ')||undefined}
    active={screenActive} tab={studyTab} onTabChange={setStudyTab} onAddLearning={()=>goMain('s-learning-entry')}
    onOpenTargetLibrary={()=>goMain('s-learning-library')} onOpenTarget={openLocalTarget}
    onPolicyChange={()=>{}} defaultPolicy="lightweight" fixedPolicy
    learningTargetCount={packageLearning.activeTargets.length+activePendingPersonal.length}
    languageLabel={sensaLanguageDisplayName(activeRoute.targetLanguageTag,i18n.language==='en'?'en':'zh-CN')}
    readyInitialCount={packageLearning.initialReady.length} reviewCount={packageLearning.due.length}
    dailyNewCount={dailyNewCount} learningRecords={packageLearning.records}
    onOpenStats={()=>goMain('s-stats')} onDailyNewCountChange={updateLocalQuantity}/>;
   case 's-learning-library': return <LearningTargetLibraryScreen active={screenActive}
    targets={Object.fromEntries([...packageLearning.activeTargets.map(target=>[target.id,localTargetView(target,packageLearning.membershipByTarget[target.id]!,packageLearning.readinessByTarget[target.id]??'blocked')]),...activePendingPersonal.map(task=>[task.targetId,pendingPersonalTargetView(task,personalLearning.sourceForTask(task))])])}
    targetIds={[...packageLearning.activeTargets.map(target=>target.id),...activePendingPersonal.map(task=>task.targetId)]}
    policyByTarget={Object.fromEntries([...packageLearning.activeTargets.map(target=>[target.id,localTargetPolicy(target)]),...activePendingPersonal.map(task=>[task.targetId,'lightweight' as const])])}
    preparationByTarget={Object.fromEntries([...packageLearning.activeTargets.map(target=>[target.id,packageLearning.readinessByTarget[target.id]??'blocked']),...activePendingPersonal.map(task=>[task.targetId,task.status==='failed'||task.status==='rejected'?'blocked' as const:'preparing' as const])])}
    committedTargetIds={new Set(packageLearning.activeTargets.filter(target=>target.startedAt).map(target=>target.id))}
    completedTargetIds={new Set(packageLearning.activeTargets.filter(target=>target.completedAt).map(target=>target.id))}
    reviewDueTargetIds={new Set(packageLearning.due.map(target=>target.id))}
    relearningTargetIds={new Set(packageLearning.activeTargets.filter(target=>target.relearnAt).map(target=>target.id))}
    reviewingTargetIds={new Set()} relearningRepairTargetIds={new Set()} relearningRetestTargetIds={new Set()} declaredMasteryTargetIds={new Set()}
    onBack={backMain} onAddLearning={()=>goMain('s-learning-entry')} onOpenTarget={openLocalTarget}/>;
   case 's-learning-entry': return <PackageEntry active={screenActive} c={packageLearning} onBack={backMain} onLearning={()=>setMainStack(['s-study'])} onTarget={openLocalTarget}/>;
   case 's-learning-target':
    if(localSelectedTarget&&localSelectedMembership)return <PackageTarget active={screenActive} target={localSelectedTarget} c={packageLearning} onSource={()=>{const provenance=localSelectedMembership.material.snapshot.provenance;if('personalMeaningId' in provenance&&typeof provenance.personalMeaningId==='string')openPersonalMeaning(provenance.personalMeaningId);else backMain();}} onBack={backMain} onHome={resetMain} onStart={()=>void startLocalLearning(localSelectedTarget.id)}/>;
    if(selectedPersonalTask)return <PersonalPreparationTarget task={selectedPersonalTask} c={personalLearning} onSource={()=>openPersonalLearningSource(selectedPersonalTask)} active={screenActive} onBack={backMain} onHome={resetMain} onStart={id=>void startLocalLearning(id)}/>;
    return <LearningSetupFrame id="s-learning-target" active={screenActive} title={localFlowText('learningTarget')} onBack={backMain}><p role="status">{packageLearning.loaded?localFlowText('targetMissing'):localFlowText('targetLoading')}</p></LearningSetupFrame>;
   case 's-stats': return <StatsScreen active={screenActive} onBack={backMain} records={packageLearning.records} onOpenTarget={openLocalTarget}/>;
   case 's-profile': return <ProfileScreen localLibrary fixedLearningPolicy modelSettings={<ProviderPanel/>} active={screenActive} onGoStudyPlan={()=>{setStudyTab('a');goMain('s-study');}} defaultPolicy="lightweight" dailyNewCount={dailyNewCount} onPolicyChange={()=>{}} onDailyNewCountChange={updateLocalQuantity}/>;
   case 's-lightweight-runtime': return <PackageRuntime active={screenActive} c={packageLearning} onExit={returnHome} onViewLearningLibrary={()=>setMainStack(['s-study','s-learning-library'])} onFinish={()=>void (async()=>{const next=packageLearning.nextTarget;if(next){await packageLearning.continueWith(next.id,dailyNewCount);return;}if(await packageLearning.finish())returnHome();})()}/>;
   default: return null;
  }
 };
 const fallback=<section id={currentScreen} className="screen active absolute inset-0 grid place-content-center bg-surface-canvas text-fg-primary" role="status">{localFlowText('loadingSensa')}</section>;
 return <>
  <ScreenHost screenKey={screenInstanceKey(currentScreen,params)} active={active} fallback={fallback}>{renderScreen}</ScreenHost>
  {quantityTarget&&quantityTargetRecord&&<LearningPreferencesPanel
   fixedPolicy defaultPolicy={localTargetPolicy(quantityTargetRecord)}
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
