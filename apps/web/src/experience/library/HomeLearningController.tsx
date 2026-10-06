import {lazy,Suspense,useEffect,useRef,useState} from 'react';
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

const LearningPreferencesPanel=lazy(()=>import('../components/learning/LearningPreferencesPanel').then(module=>({default:module.LearningPreferencesPanel})));
const loadLearningSystem=()=>import('../../learning/system/learningSystem').then(module=>module.learningSystem);

export function HomeLearningController({active=true}:{active?:boolean}){
 const {t}=useTranslation();
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
 const [notice,setNotice]=useState('');
 const [quantityTarget,setQuantityTarget]=useState<string|null>(null);
 const [quantityChoice,setQuantityChoice]=useState(20);
 const [quantityIntent,setQuantityIntent]=useState<'mixed'|'review_only'>('mixed');
 const refresh=async()=>{
  const version=viewEpoch.current.version;
  if(!active||viewEpoch.current.key!==viewKey)return;
  const learningSystem=await loadLearningSystem();
  const next=await learningSystem.read({kind:'home',languageContext,clock:Date.now()});
  if(version!==viewEpoch.current.version)return;
  setProjection({routeKey,value:next});
  setSummaryEpoch(version);
 };
 useEffect(()=>{
  if(!active)return;
  let current=true;
  setSummaryEpoch(null);
  setNotice('');
  const coordinator=createRefreshCoordinator(refresh);
  const read=()=>void coordinator.request().catch(()=>{if(current)setNotice(localFlowText('learningReadFailed'));});
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
  }).catch(()=>{if(current)setNotice(localFlowText('learningReadFailed'));});
  const focus=()=>void prepare().catch(()=>{if(current)setNotice(localFlowText('learningReadFailed'));});
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
  }).catch(()=>setNotice(localFlowText('learningReadFailed'))),Math.min(2_147_483_647,Math.max(20,projection.nextChangeAt-Date.now()+20)));
  return()=>window.clearTimeout(timer);
 },[active,projection?.nextChangeAt,languageContext.languageRouteId,languageContext.languageRouteRevision]);
 const perform=async(work:()=>Promise<unknown>)=>{
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
   if(outcome.projection==='stale')setNotice(localFlowText('progressReadFailed'));
   return true;
  }finally{if(version===viewEpoch.current.version)setBusy(false);}
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
  if(projection?.dailyLimit==null){setQuantityChoice(20);setQuantityIntent(intent);setQuantityTarget(targetId);return;}
  await begin(targetId,projection.dailyLimit,intent);
 };
 const authoritativeSummary=summaryReady&&libraryAvailability==='authoritative';
 const status=notice
  ? <p role="status">{localFlowNotice(notice)}</p>
  : libraryAvailability==='failed'
    ? <p role="alert">{t('cloudSync.openFailed')}</p>
    : libraryAvailability==='restoring'
      ? <p role="status">{t('cloudSync.opening')}</p>
      : null;
 return <>
  <HomeScreen active={active} onGo={goMain}
   busy={busy} summaryReady={authoritativeSummary} status={status}
   onResume={projection?.activeRunId?()=>setViewMode('lightweight'):undefined}
   onStartMixed={()=>void start()} onStartReview={()=>void start(true)}
   reviewDueN={projection?.reviewDueCount??0} newAvailable={projection?.readyInitialCount??0}
   onRecordContext={()=>goMain('s-semantic-world',{worldAction:'create'})}
   mixedReadyN={projection?.mixedReadyCount??0}/>
  {quantityTarget&&projection?.nextTargetPolicy&&<Suspense fallback={null}><LearningPreferencesPanel policyOptions={projection.policyOptions} fixedPolicy defaultPolicy={projection.nextTargetPolicy} dailyNewCount={quantityChoice} onPolicyChange={()=>{}} onDailyNewCountChange={setQuantityChoice} busy={busy} status={notice&&<p role="status">{localFlowNotice(notice)}</p>} onClose={()=>setQuantityTarget(null)} closeLabel={localFlowText('confirmAndStart')} onConfirm={()=>void (async()=>{
   const learningSystem=await loadLearningSystem();
   const confirmed=await perform(()=>learningSystem.execute({kind:'confirm_quantity',operationId:crypto.randomUUID(),languageContext,dailyLimit:quantityChoice}));
   if(!confirmed)return;
   const targetId=quantityTarget;setQuantityTarget(null);await begin(targetId,quantityChoice,quantityIntent);
  })()}
  /></Suspense>}
 </>;
}
