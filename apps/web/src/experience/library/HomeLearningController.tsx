import {useEffect,useRef,useState} from 'react';
import '../../i18n/accountResources';
import {useTranslation} from 'react-i18next';
import {HomeScreen} from '../components/HomeScreen';
import type {LearningHomeProjection} from '../../learning/system';
import {useActiveLanguageContext} from './useActiveLanguageContext';
import {useShellNavigation} from '../router/useShellNavigation';
import {localFlowNotice,localFlowText} from '../../i18n/localFlowText';
import {useAccountExperience} from '../account/AccountContext';
import {settleOperation} from './operationSettlement';
import {createRefreshCoordinator} from './refreshCoordinator';
import {homeLearningState} from './homeLearningState';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';

const loadLearningSystem=()=>import('../../learning/system/learningSystem').then(module=>module.learningSystem);

export function HomeLearningController({active=true}:{active?:boolean}){
 const {t,i18n}=useTranslation();
 const {libraryAvailability}=useAccountExperience();
 const {goMain,setViewMode}=useShellNavigation();
 const languageContext=useActiveLanguageContext();
 const routeKey=`${languageContext.languageRouteId}:${languageContext.languageRouteRevision}`;
 const [projectionState,setProjection]=useState<{routeKey:string;value:LearningHomeProjection}|null>(null);
 const projection=projectionState?.routeKey===routeKey?projectionState.value:null;
 const viewKey=`${active}:${routeKey}`;
 const viewEpoch=useRef({key:viewKey,version:0});
 if(viewEpoch.current.key!==viewKey)viewEpoch.current={key:viewKey,version:viewEpoch.current.version+1};
 const [summaryEpoch,setSummaryEpoch]=useState<number|null>(null);
 const summaryReady=summaryEpoch===viewEpoch.current.version;
 const [busy,setBusy]=useState(false);
 const operationInFlight=useRef(false);
 const [notice,setNotice]=useState('');
 const refresh=async()=>{
  const version=viewEpoch.current.version;
  if(!active||viewEpoch.current.key!==viewKey)return;
  try{
   const learningSystem=await loadLearningSystem();
   const next=await learningSystem.read({kind:'home',languageContext,clock:Date.now()});
   if(version!==viewEpoch.current.version)return;
   setProjection({routeKey,value:next});
   setSummaryEpoch(version);
   setNotice('');
  }catch(error){if(version===viewEpoch.current.version)setSummaryEpoch(null);throw error;}
 };
 useEffect(()=>{
  if(!active)return;
  let current=true;
  setSummaryEpoch(null);
  setNotice('');
  const coordinator=createRefreshCoordinator(refresh);
  const read=()=>void coordinator.request().catch(()=>{if(current){setSummaryEpoch(null);setNotice(localFlowText('learningReadFailed'));}});
  const prepare=async()=>{
   const learningSystem=await loadLearningSystem();
   if(!current)return;
   await learningSystem.execute({kind:'prepare_queue',languageContext,at:new Date().toISOString()});
   if(!current)return;
   await coordinator.request();
  };
  let stop=()=>{};
  void loadLearningSystem().then(system=>{
   if(!current)return;
   stop=system.subscribe({kind:'home',languageContext},read);
   return import('../../data/library/store').then(module=>module.openLibrary()).then(prepare);
  }).catch(()=>{if(current){setSummaryEpoch(null);setNotice(localFlowText('learningReadFailed'));}});
  const focus=()=>void prepare().catch(()=>{if(current){setSummaryEpoch(null);setNotice(localFlowText('learningReadFailed'));}});
  window.addEventListener('focus',focus);
  return()=>{current=false;stop();window.removeEventListener('focus',focus);};
 },[active,languageContext.languageRouteId,languageContext.languageRouteRevision]);
 useEffect(()=>{
  // Keep the already-planned due/day preparation deadline, including while a
  // Session is visible. Hidden Home never rereads or renders queue summaries.
  if(projection?.nextChangeAt==null)return;
  const version=viewEpoch.current.version;
  const timer=window.setTimeout(()=>void loadLearningSystem().then(async learningSystem=>{
   if(version!==viewEpoch.current.version)return;
   await learningSystem.execute({kind:'prepare_queue',languageContext,at:new Date().toISOString()});
   await refresh();
  }).catch(()=>{if(version===viewEpoch.current.version){setSummaryEpoch(null);setNotice(localFlowText('learningReadFailed'));}}),Math.min(2_147_483_647,Math.max(20,projection.nextChangeAt-Date.now()+20)));
  return()=>window.clearTimeout(timer);
 },[active,projection?.nextChangeAt,languageContext.languageRouteId,languageContext.languageRouteRevision]);
 const perform=async(work:()=>Promise<unknown>)=>{
  if(operationInFlight.current)return false;
  operationInFlight.current=true;
  const version=viewEpoch.current.version;
  setBusy(true);setNotice('');
  try{
   const outcome=await settleOperation(work,refresh);
   if(version!==viewEpoch.current.version)return false;
   if(outcome.kind==='rejected'){
    const error=outcome.error;
    setNotice(error instanceof Error&&error.message.startsWith('localFlow.')?error.message:localFlowText('retryOperation'));
    return false;
   }
   if(outcome.projection==='stale'){setSummaryEpoch(null);setNotice(localFlowText('progressReadFailed'));}
   return true;
  }finally{operationInFlight.current=false;if(version===viewEpoch.current.version)setBusy(false);}
 };
 const begin=async(targetId:string,limit:number,sessionIntent:'mixed'|'review_only'='mixed')=>{
  const version=viewEpoch.current.version;
  const learningSystem=await loadLearningSystem();
  if(version!==viewEpoch.current.version)return;
  const ok=await perform(()=>learningSystem.execute({kind:'start',operationId:crypto.randomUUID(),targetId,languageContext,dailyLimit:limit,sessionIntent}));
  if(ok)setViewMode('lightweight');
 };
 const start=async(reviewOnly=false)=>{
  const targetId=reviewOnly?projection?.nextReviewTargetId:projection?.nextTargetId;
  if(!targetId){goMain('s-learning-entry');return;}
  const intent=reviewOnly?'review_only':'mixed';
  await begin(targetId,projection?.dailyLimit??20,intent);
 };
 const authoritativeSummary=summaryReady&&libraryAvailability==='authoritative';
 const state=homeLearningState(projection,authoritativeSummary);
 const resumeContext=projection?.activeLanguageContext;
 const resumeRoute=resumeContext&&(resumeContext.languageRouteId!==languageContext.languageRouteId||resumeContext.targetLanguageTag!==languageContext.targetLanguageTag||resumeContext.supportLanguageTag!==languageContext.supportLanguageTag)
  ?`${interfaceLanguageDisplayName(resumeContext.targetLanguageTag,resolveInterfaceLocale(i18n.language))} · ${interfaceLanguageDisplayName(resumeContext.supportLanguageTag,resolveInterfaceLocale(i18n.language))}`:undefined;
 const status=notice
  ? <div role="alert"><p>{localFlowNotice(notice)}</p><button disabled={busy} onClick={()=>void perform(refresh)}>{t('reliability.retry')}</button></div>
  : libraryAvailability==='failed'
    ? <p role="alert">{t('cloudSync.openFailed')}</p>
    : libraryAvailability==='restoring'
      ? <p role="status">{t('cloudSync.opening')}</p>
      : null;
 return <>
  <HomeScreen active={active} onGo={goMain}
   currentTask={authoritativeSummary?projection?.currentTask:undefined}
   state={state} nextReviewAt={projection?.nextReviewAt} resumeRoute={authoritativeSummary?resumeRoute:undefined}
   onOpenTargets={filter=>goMain('s-learning-library',{learningFilter:filter,learningQuery:undefined,learningSort:undefined,learningPage:undefined})}
   busy={busy} summaryReady={authoritativeSummary} status={status}
   onResume={authoritativeSummary&&projection?.activeRunId?()=>setViewMode('lightweight'):undefined}
   onStartMixed={()=>void start()} onStartReview={()=>void start(true)}
   reviewDueN={projection?.reviewDueCount??0} newAvailable={projection?.readyInitialCount??0}
   onRecordContext={()=>goMain('s-semantic-world',{worldAction:'add'})}
   mixedReadyN={projection?.mixedReadyCount??0}/>
 </>;
}
