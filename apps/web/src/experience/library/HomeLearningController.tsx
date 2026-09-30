import {lazy,Suspense,useEffect,useState} from 'react';
import '../../i18n/accountResources';
import {useTranslation} from 'react-i18next';
import {HomeScreen} from '../components/HomeScreen';
import {openLibrary} from '../../data/library/store';
import type {LearningHomeProjection} from '../../learning/system';
import {useLanguageRoutes} from './useLanguageRoutes';
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
 const {context:languageContext}=useLanguageRoutes();
 const [projection,setProjection]=useState<LearningHomeProjection|null>(null);
 const [summaryReady,setSummaryReady]=useState(false);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [quantityTarget,setQuantityTarget]=useState<string|null>(null);
 const [quantityChoice,setQuantityChoice]=useState(20);
 const refresh=async()=>{
  const learningSystem=await loadLearningSystem();
  const next=await learningSystem.read({kind:'home',languageRouteId:languageContext.languageRouteId,clock:Date.now()});
  setProjection(next);
  setSummaryReady(true);
 };
 useEffect(()=>{
  let current=true;
  setSummaryReady(false);
  setNotice('');
  const coordinator=createRefreshCoordinator(refresh);
  const read=()=>void coordinator.request().catch(()=>{if(current)setNotice(localFlowText('learningReadFailed'));});
  const prepare=async()=>{
   const learningSystem=await loadLearningSystem();
   await learningSystem.execute({kind:'prepare_queue',languageContext,at:new Date().toISOString()});
   await coordinator.request();
  };
  let stop=()=>{};
  void loadLearningSystem().then(system=>{
   if(!current)return;
   stop=system.subscribe({kind:'home',languageRouteId:languageContext.languageRouteId},read);
   return openLibrary().then(prepare);
  }).catch(()=>{if(current)setNotice(localFlowText('learningReadFailed'));});
  const focus=()=>void prepare().catch(()=>{if(current)setNotice(localFlowText('learningReadFailed'));});
  window.addEventListener('focus',focus);
  return()=>{current=false;stop();window.removeEventListener('focus',focus);};
 },[languageContext.languageRouteId,languageContext.languageRouteRevision]);
 useEffect(()=>{
  if(projection?.nextChangeAt==null)return;
  const timer=window.setTimeout(()=>void loadLearningSystem().then(async learningSystem=>{
   await learningSystem.execute({kind:'prepare_queue',languageContext,at:new Date().toISOString()});
   await refresh();
  }).catch(()=>setNotice(localFlowText('learningReadFailed'))),Math.min(2_147_483_647,Math.max(20,projection.nextChangeAt-Date.now()+20)));
  return()=>window.clearTimeout(timer);
 },[projection?.nextChangeAt,languageContext.languageRouteId,languageContext.languageRouteRevision]);
 const perform=async(work:()=>Promise<unknown>)=>{
  setBusy(true);setNotice('');
  try{
   const outcome=await settleOperation(work,refresh);
   if(outcome.kind==='rejected'){
    const error=outcome.error;
    setNotice(error instanceof Error&&error.message.startsWith('localFlow.')?error.message:localFlowText('retryOperation'));
    return false;
   }
   if(outcome.projection==='stale')setNotice(localFlowText('progressReadFailed'));
   return true;
  }finally{setBusy(false);}
 };
 const begin=async(targetId:string,limit:number)=>{
  const learningSystem=await loadLearningSystem();
  const ok=await perform(()=>learningSystem.execute({kind:'start',operationId:crypto.randomUUID(),targetId,languageContext,dailyLimit:limit}));
  if(ok)setViewMode('lightweight');
 };
 const start=async(reviewOnly=false)=>{
  const targetId=reviewOnly?projection?.nextReviewTargetId:projection?.nextTargetId;
  if(!targetId){goMain('s-learning-entry');return;}
  if(projection?.dailyLimit==null){setQuantityChoice(20);setQuantityTarget(targetId);return;}
  await begin(targetId,projection.dailyLimit);
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
   const targetId=quantityTarget;setQuantityTarget(null);await begin(targetId,quantityChoice);
  })()}
  /></Suspense>}
 </>;
}
