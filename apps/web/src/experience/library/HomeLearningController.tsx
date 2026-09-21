import {lazy,Suspense,useEffect,useMemo,useState} from 'react';
import '../../i18n/accountResources';
import {useTranslation} from 'react-i18next';
import {HomeScreen} from '../components/HomeScreen';
import {openLibrary,observeLibrary} from '../../data/library/store';
import type {HomeLearningStorageProjection,HomeLearningTargetRecord} from '../../data/library/homeLearningRecords';
import {localCurriculumMembershipForContext} from '../../learning/runtime/localCurriculum';
import {nextLearningQueueChangeAt,resolveLearningQueue} from './learningQueue';
import {useLanguageRoutes} from './useLanguageRoutes';
import {readHomeLearningProjection} from './homeLearningProjection';
import {homeTargetPolicy,homeTargetReadiness} from './homeTargetReadiness';
import {useShellNavigation} from '../router/useShellNavigation';
import {localFlowNotice,localFlowText} from '../../i18n/localFlowText';
import {useAccountExperience} from '../account/AccountContext';

const LearningPreferencesPanel=lazy(()=>import('../components/learning/LearningPreferencesPanel').then(module=>({default:module.LearningPreferencesPanel})));

export function HomeLearningController({active=true}:{active?:boolean}){
 const {t}=useTranslation();
 const {libraryAvailability}=useAccountExperience();
 const {goMain,setViewMode}=useShellNavigation();
 const {activeRoute,context:languageContext}=useLanguageRoutes();
 const [targets,setTargets]=useState<readonly HomeLearningTargetRecord[]>([]);
 const [availablePackageKeys,setAvailablePackageKeys]=useState<ReadonlySet<string>>(new Set());
 const [activeRun,setActiveRun]=useState<HomeLearningStorageProjection['activeRun']>(null);
 const [dailyLimit,setDailyLimit]=useState<number|undefined>();
 const [clock,setClock]=useState(Date.now());
 const [summaryReady,setSummaryReady]=useState(false);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [quantityTarget,setQuantityTarget]=useState<string|null>(null);
 const [quantityChoice,setQuantityChoice]=useState(20);
 const refresh=async()=>{
  const projection=await readHomeLearningProjection(languageContext.languageRouteId);
  setTargets(projection.targets);
  setAvailablePackageKeys(projection.availablePackageKeys);
  setActiveRun(projection.activeRun);
  setDailyLimit(projection.dailyLimit);
  setClock(Date.now());
  setSummaryReady(true);
 };
 useEffect(()=>{
  let current=true;
  setSummaryReady(false);
  setNotice('');
  const read=()=>void refresh().catch(()=>{if(current)setNotice(localFlowText('learningReadFailed'));});
  void openLibrary().then(read).catch(()=>{if(current)setNotice(localFlowText('learningReadFailed'));});
  const stop=observeLibrary(read,['packageCache','packageInstallations','learningTargets','learningRuns','settings','meta']);
  const focus=()=>setClock(Date.now());
  window.addEventListener('focus',focus);
  return()=>{current=false;stop();window.removeEventListener('focus',focus);};
 },[languageContext.languageRouteId,languageContext.languageRouteRevision]);
 const membershipByTarget=useMemo(()=>Object.fromEntries(targets.flatMap(target=>{
  const membership=localCurriculumMembershipForContext(target,languageContext);
  return membership?[[target.id,membership]]:[];
 })),[targets,languageContext]);
 const readinessByTarget=useMemo(()=>Object.fromEntries(targets.map(target=>{
  const membership=membershipByTarget[target.id];
  const pack=membership?.packageKey&&availablePackageKeys.has(membership.packageKey)
   ?{key:membership.packageKey}
   :undefined;
  return [target.id,homeTargetReadiness(target,membership,pack)];
 })) as Readonly<Record<string,'ready'|'blocked'>>,[targets,membershipByTarget,availablePackageKeys]);
 const queue=useMemo(()=>resolveLearningQueue({targets,languageRouteId:activeRoute.id,readiness:readinessByTarget,clock,dailyLimit}),[targets,activeRoute.id,readinessByTarget,clock,dailyLimit]);
 const nextQueueChangeAt=useMemo(()=>nextLearningQueueChangeAt({targets,languageRouteId:activeRoute.id,readiness:readinessByTarget,clock,dailyLimit}),[targets,activeRoute.id,readinessByTarget,clock,dailyLimit]);
 useEffect(()=>{
  if(nextQueueChangeAt===null)return;
  const timer=window.setTimeout(()=>setClock(Date.now()),Math.min(2_147_483_647,Math.max(20,nextQueueChangeAt-Date.now()+20)));
  return()=>window.clearTimeout(timer);
 },[nextQueueChangeAt]);
 const perform=async(work:()=>Promise<unknown>)=>{
  setBusy(true);setNotice('');
  try{await work();await refresh();return true;}
  catch(error){setNotice(error instanceof Error&&error.message.startsWith('localFlow.')?error.message:localFlowText('retryOperation'));return false;}
  finally{setBusy(false);}
 };
 const begin=async(targetId:string,limit:number)=>{
  const learning=await import('../../data/library/learning');
  const ok=await perform(()=>learning.startLearning(crypto.randomUUID(),targetId,languageContext,limit));
  if(ok)setViewMode('lightweight');
 };
 const start=async(reviewOnly=false)=>{
  const targetId=activeRun?.targetId??queue.due[0]?.id??(!reviewOnly?queue.initialReady[0]?.id:undefined);
  if(!targetId){goMain('s-learning-entry');return;}
  if(dailyLimit===undefined){setQuantityChoice(20);setQuantityTarget(targetId);return;}
  await begin(targetId,dailyLimit);
 };
 const quantityTargetRecord=quantityTarget?targets.find(target=>target.id===quantityTarget):undefined;
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
   onResume={activeRun?()=>setViewMode('lightweight'):undefined}
   onStartMixed={()=>void start()} onStartReview={()=>void start(true)}
   reviewDueN={queue.due.length} newAvailable={queue.initialReady.length}
   onRecordContext={()=>goMain('s-semantic-world',{worldAction:'create'})}
   mixedReadyN={queue.initialReady.length+queue.due.length}/>
  {quantityTarget&&quantityTargetRecord&&<Suspense fallback={null}><LearningPreferencesPanel fixedPolicy defaultPolicy={homeTargetPolicy(quantityTargetRecord)} dailyNewCount={quantityChoice} onPolicyChange={()=>{}} onDailyNewCountChange={setQuantityChoice} busy={busy} status={notice&&<p role="status">{localFlowNotice(notice)}</p>} onClose={()=>setQuantityTarget(null)} closeLabel={localFlowText('confirmAndStart')} onConfirm={()=>void (async()=>{
   const learning=await import('../../data/library/learning');
   const confirmed=await perform(()=>learning.confirmLearningQuantity(crypto.randomUUID(),languageContext,quantityChoice));
   if(!confirmed)return;
   const targetId=quantityTarget;setQuantityTarget(null);await begin(targetId,quantityChoice);
  })()}
  /></Suspense>}
 </>;
}
