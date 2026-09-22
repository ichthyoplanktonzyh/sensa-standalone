import {declareKnownAndContinue} from './declareKnownAndContinue';
import {useTranslation} from 'react-i18next';
import {useLanguageRoutes} from './useLanguageRoutes';
import {advanceInterleavedLearningRetries,nextLearningQueueChangeAt,resolveLearningQueue,selectInterleavedLearningTarget,type InterleavedLearningRetry} from './learningQueue';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {useEffect,useRef,useState} from 'react';
import type {LearningPackageDescriptor} from '@sensa/contracts/sensa';
import {contentSupplySystem,type ContentSupplyPackage as InstalledPackage} from '../../contentSupply/system';
import {learningRunTargetIds,learningSystem,type LearningAction,type LearningPolicy,type LearningRunView,type LearningTargetView} from '../../learning/system';
import type {LearningRecordView} from '../learningJourney/learningHistory';
import {inspectLocalTargetReadiness} from '../../learning/runtime/runtimeCoordinator';
import {localCurriculumMembershipForContext,localLastPresentedMaterial} from '../../learning/runtime/localCurriculum';
export function usePackageLearning(entryOpen:boolean){
 useTranslation();
 const [packages,setPackages]=useState<InstalledPackage[]>([]),[catalog,setCatalog]=useState<LearningPackageDescriptor[]>([]),[targets,setTargets]=useState<LearningTargetView[]>([]),[runs,setRuns]=useState<LearningRunView[]>([]),[activeId,setActiveId]=useState<string|undefined>();
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState<number|null>(null),[loaded,setLoaded]=useState(false),[catalogBusy,setCatalogBusy]=useState(false);
 const [dailyLimit,setDailyLimit]=useState<number|undefined>();
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{const tick=()=>setClock(Date.now());window.addEventListener('focus',tick);return()=>window.removeEventListener('focus',tick);},[]);
 const transfer=useRef<AbortController|null>(null),catalogRequest=useRef<AbortController|null>(null),generation=useRef(0),actInFlight=useRef(false);
 const [interleavedRetries,setInterleavedRetries]=useState<InterleavedLearningRetry[]>([]);
 const {activeRoute,context:languageContext}=useLanguageRoutes();
 const refresh=async()=>{const [snapshot,supply]=await Promise.all([learningSystem.read({kind:'overview'}),contentSupplySystem.read({kind:'workspace'})]);setPackages([...supply.packages]);setCatalog([...supply.catalog]);setTargets(snapshot.targets);setRuns(snapshot.runs);setActiveId(snapshot.active);setDailyLimit(snapshot.studyPlans[languageContext.languageRouteId]?.dailyNewSenseLimit);setLoaded(true);};
 useEffect(()=>{void contentSupplySystem.execute({kind:'rehydrate'}).then(refresh).catch(()=>setNotice(localFlowText('learningReadFailed')));const reload=()=>void refresh().catch(()=>setNotice(localFlowText('progressReadFailed'))),stopLearning=learningSystem.subscribe({kind:'overview'},reload),stopSupply=contentSupplySystem.subscribe({kind:'workspace'},reload);return()=>{generation.current++;stopLearning();stopSupply();transfer.current?.abort();catalogRequest.current?.abort();};},[languageContext.languageRouteId,languageContext.languageRouteRevision]);
 const perform=async<T,>(work:()=>Promise<T>)=>{setBusy(true);setNotice('');try{const result=await work();await refresh();return result;}catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:localFlowText('retryOperation'));return null;}finally{setBusy(false);setProgress(null);}};
 const reloadCatalog=async(notify=false)=>{
  const gen=++generation.current;
  catalogRequest.current?.abort();const request=new AbortController();catalogRequest.current=request;
  try{const local=await contentSupplySystem.read({kind:'workspace'});if(gen!==generation.current)return;setCatalog([...local.catalog]);setCatalogBusy(true);
   const result=await contentSupplySystem.execute({kind:'refresh_catalog',force:notify,signal:request.signal});if(gen===generation.current){await refresh();setCatalog([...result.items]);if(notify)setNotice(localFlowText(result.status==='current'?'catalogCurrent':'catalogUpdated'));else setNotice(current=>current==='localFlow.audioIncomplete'?'':current);}
  }catch{if(gen===generation.current&&notify)setNotice(localFlowText('catalogFailed'));}finally{if(catalogRequest.current===request)catalogRequest.current=null;if(gen===generation.current)setCatalogBusy(false);}
 };
 useEffect(()=>{if(entryOpen)void reloadCatalog();},[entryOpen]);
 const run=runs.find(r=>r.id===activeId)??null;
 const records:LearningRecordView[]=runs.filter(r=>r.completedAt&&r.completionKind!=='wait_relearning').flatMap(r=>learningRunTargetIds(r).map(targetId=>{const target=targets.find(t=>t.id===targetId),participant=r.participants[targetId],material=participant?localLastPresentedMaterial(participant):undefined,meaning=material?.content.resources.find(resource=>resource.materialRoleKey==='sense_confirmation')?.contentPayload.meaning;return {recordId:r.id+':'+targetId,targetId,expression:target?.expression??'',languageTag:target?.targetLanguageTag??'',meaning:typeof meaning==='string'?meaning:undefined,occurredAt:r.targetCompletions?.[targetId]?.at??r.completedAt!,kind:r.purpose,label:r.purpose==='initial_learning'?localFlowText('initialRecord'):r.purpose==='retention_review'?localFlowText('reviewRecord'):localFlowText('relearningRecord'),detail:localFlowText('localRecord')}})).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
 const membershipByTarget=Object.fromEntries(targets.flatMap(target=>{const membership=localCurriculumMembershipForContext(target,languageContext);return membership?[[target.id,membership]]:[];}));
 const readinessByTarget=Object.fromEntries(targets.map(target=>{const membership=membershipByTarget[target.id];return [target.id,inspectLocalTargetReadiness(target,membership,membership?.packageKey?packages.find(pack=>pack.key===membership.packageKey):undefined).status];})) as Readonly<Record<string,'ready'|'blocked'>>;
 const {activeTargets,due,initialReady}=resolveLearningQueue({targets,languageRouteId:activeRoute.id,readiness:readinessByTarget,clock,dailyLimit});
 const nextQueueChangeAt=nextLearningQueueChangeAt({targets,languageRouteId:activeRoute.id,readiness:readinessByTarget,clock,dailyLimit});
 useEffect(()=>{
  if(nextQueueChangeAt===null)return;
  const timer=window.setTimeout(()=>setClock(Date.now()),Math.min(2_147_483_647,Math.max(20,nextQueueChangeAt-Date.now()+20)));
  return()=>window.clearTimeout(timer);
 },[nextQueueChangeAt]);
 const nextTarget=selectInterleavedLearningTarget({due,initialReady,currentRunTargetIds:run?learningRunTargetIds(run):[],retries:interleavedRetries});
 return {nextTarget,initialReady,readinessByTarget,membershipByTarget,languageContext,packages,catalog,targets,activeTargets,runs,run,records,due,notice:localFlowNotice(notice),busy,progress,loaded,catalogBusy,reloadCatalog,refresh,dailyLimit,confirmQuantity:(n:number)=>perform(()=>learningSystem.execute({kind:'confirm_quantity',operationId:crypto.randomUUID(),languageContext,dailyLimit:n})),
  download:(d:LearningPackageDescriptor)=>perform(async()=>{const c=new AbortController();transfer.current=c;try{setProgress(0);return await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:d,signal:AbortSignal.any([c.signal,AbortSignal.timeout(120000)]),onProgress:n=>setProgress(Math.round(100*n))});}finally{if(transfer.current===c)transfer.current=null;}}),
  cancelDownload:()=>transfer.current?.abort(),importFile:(file:File)=>perform(async()=>{if(file.size>64*1024*1024)throw new Error('localFlow.packageTooLarge');return contentSupplySystem.execute({kind:'import_package',bytes:new Uint8Array(await file.arrayBuffer())});}),
  selectPolicy:(targetId:string,profileId:LearningPolicy)=>perform(()=>learningSystem.execute({kind:'select_policy',operationId:crypto.randomUUID(),targetId,languageContext,profileId})),
  enroll:(packageKey:string)=>perform(()=>learningSystem.execute({kind:'enroll_package',operationId:crypto.randomUUID(),packageKey,languageContext})),
  start:(targetId:string,dailyLimit:number)=>perform(()=>learningSystem.execute({kind:'start',operationId:crypto.randomUUID(),targetId,languageContext,dailyLimit})),
  act:async(action:LearningAction)=>{
   if(!run||actInFlight.current)return null;
   actInFlight.current=true;
   const previousInterleavedRetries=interleavedRetries;
   if(action.kind==='rate'){
    const targetId=run.targetId;
    setInterleavedRetries(retries=>advanceInterleavedLearningRetries(retries,targetId,action.rating==='again'));
   }
   try{
    const result=await perform(()=>learningSystem.execute({kind:'act',operationId:crypto.randomUUID(),runId:run.id,expectedRevision:run.revision,action}));
    if(!result&&action.kind==='rate')setInterleavedRetries(previousInterleavedRetries);
    return result;
   }finally{actInFlight.current=false;}
  },
  declareKnownAndContinue:async(id:string)=>{
   if(actInFlight.current)return null;
   actInFlight.current=true;
   try{return await perform(async()=>{
    const result=await declareKnownAndContinue(id,languageContext,dailyLimit,interleavedRetries);
    setInterleavedRetries(result.remainingRetries);
    if(!result.nextRun)setNotice('localFlow.runtimeKnownSaved');
    return true;
   });}finally{actInFlight.current=false;}
  },
  declareKnown:(targetId:string,active=true)=>perform(()=>learningSystem.execute({kind:'set_declared_mastery',operationId:crypto.randomUUID(),targetId,active})),
  continueWith:(targetId:string,dailyLimit:number)=>run?perform(()=>learningSystem.execute({kind:'continue',operationId:crypto.randomUUID(),runId:run.id,targetId,languageContext,dailyLimit})):Promise.resolve(null),
  finish:()=>run?perform(()=>learningSystem.execute({kind:'finish',operationId:crypto.randomUUID(),runId:run.id})):Promise.resolve(null),
 };
}
