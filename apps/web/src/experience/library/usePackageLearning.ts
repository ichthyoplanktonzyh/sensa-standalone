import {useTranslation} from 'react-i18next';
import {useEffect,useRef,useState} from 'react';

import {
 contentSupplySystem,
 type ContentSupplyCatalogItem,
 type ContentSupplyInstallationPhase,
 type ContentSupplyPackage as InstalledPackage,
 type PortablePackagePreview,
} from '../../contentSupply/system';
import {
 learningSystem,
 type LearningAction,
 type LearningPolicy,
 type LearningWorkspaceProjection,
} from '../../learning/system';
import {localFlowNotice,localFlowText} from '../../i18n/localFlowText';
import i18n from '../../i18n';
import {useActiveLanguageContext} from './useActiveLanguageContext';
import {settleReconciledOperation} from './operationSettlement';
import {createRefreshCoordinator} from './refreshCoordinator';

const emptyWorkspace:LearningWorkspaceProjection={
 enrollments:[],
 targets:[],
 queue:{activeTargetIds:[],dueTargetIds:[],initialReadyTargetIds:[],nextTargetId:null,nextChangeAt:null},
 runtime:null,
 activeRunId:null,
 dailyLimit:null,
 records:[],
 policyOptions:[],
};

const measuredWorkspaceRead=async<T,>(name:string,work:()=>Promise<T>):Promise<T>=>{
 const started=performance.now();
 if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.mark(`sensa.workspace.${name}.start`);
 try{return await work();}
 finally{
  if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure(`sensa.workspace.${name}`,{start:started,end:performance.now()});
 }
};

export function usePackageLearning(entryOpen:boolean,runtimeOnly=false){
 useTranslation();
 const languageContext=useActiveLanguageContext();
 const routeKey=`${languageContext.languageRouteId}:${languageContext.languageRouteRevision}`;
 const currentRoute=useRef(routeKey);currentRoute.current=routeKey;
 const [packages,setPackages]=useState<InstalledPackage[]>([]);
 const [catalog,setCatalog]=useState<ContentSupplyCatalogItem[]>([]);
 const [workspace,setWorkspace]=useState<LearningWorkspaceProjection>(emptyWorkspace);
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const [progress,setProgress]=useState<number|null>(null);
 const [loaded,setLoaded]=useState(false);
 const runtimeMode=useRef(runtimeOnly);runtimeMode.current=runtimeOnly;
 const [runtimeNextTargetId,setRuntimeNextTargetId]=useState<string|null>(null);
 const [loadState,setLoadState]=useState<{routeKey:string;runtimeOnly:boolean;status:'loading'|'ready'|'unavailable'}>(()=>({routeKey,runtimeOnly,status:'loading'}));
 // A changed Route invalidates readiness during render, before the passive
 // reload effect can run. Old targets cannot become a new Session's scope.
 const loadStatus=loadState.routeKey===routeKey&&loadState.runtimeOnly===runtimeOnly?loadState.status:'loading';
 const setLoadStatus=(status:typeof loadState.status)=>{if(currentRoute.current===routeKey)setLoadState({routeKey,runtimeOnly:runtimeMode.current,status});};
 const [unavailablePackageKeys,setUnavailablePackageKeys]=useState<readonly string[]>([]);
 const [catalogBusy,setCatalogBusy]=useState(false);
 const transfer=useRef<AbortController|null>(null);
 const catalogRequest=useRef<AbortController|null>(null);
 const generation=useRef(0);
 const lifecycle=useRef(0);
 const initialRead=useRef<Promise<void>|null>(null);
 const actInFlight=useRef(false);

 const refreshLearning=async()=>{
  if(currentRoute.current!==routeKey)return false;
  const current=lifecycle.current,readingRuntime=runtimeMode.current;
  if(readingRuntime){
   const projection=await measuredWorkspaceRead('runtime',()=>learningSystem.read({kind:'runtime',languageContext,clock:Date.now()}));
   if(current!==lifecycle.current||currentRoute.current!==routeKey||runtimeMode.current!==readingRuntime)return false;
   setWorkspace(previous=>({...previous,runtime:projection.runtime,activeRunId:projection.runtime?.runId??null,dailyLimit:projection.dailyLimit,policyOptions:projection.policyOptions,
    queue:{...previous.queue,nextTargetId:projection.nextTargetId,nextChangeAt:projection.nextChangeAt}}));
   setRuntimeNextTargetId(projection.nextTargetId);
  }else{
   const projection=await measuredWorkspaceRead('learning',()=>learningSystem.read({kind:'workspace',languageContext,clock:Date.now()}));
   if(current!==lifecycle.current||currentRoute.current!==routeKey||runtimeMode.current!==readingRuntime)return false;
   setWorkspace(projection);setRuntimeNextTargetId(null);
  }
  setLoadStatus('ready');return true;
 };
 const refreshSupply=async()=>{
  const current=lifecycle.current;
  const supply=await measuredWorkspaceRead('supply',()=>contentSupplySystem.read({kind:'workspace'}));
  if(current!==lifecycle.current)return;
  setPackages([...supply.packages]);
  const available=new Set(supply.packages.map(pack=>pack.key));
  setUnavailablePackageKeys(keys=>keys.filter(key=>!available.has(key)));
  setCatalog([...supply.catalog]);
 };
 const refresh=async()=>{
  const current=lifecycle.current;
  const [learningApplied]=await Promise.all([refreshLearning(),refreshSupply()]);
  if(current!==lifecycle.current||!learningApplied)return;
  setLoaded(true);
  setLoadStatus('ready');
 };

 const retryInitialLoad=()=>{
  if(initialRead.current)return initialRead.current;
  const current=lifecycle.current;
  setLoadStatus('loading');
  setNotice(current=>[localFlowText('learningReadFailed'),localFlowText('progressReadFailed')].includes(current)?'':current);
  const request=(async()=>{
   try{
    const result=await measuredWorkspaceRead('rehydrate',()=>contentSupplySystem.execute({kind:'rehydrate'}));
    if(current!==lifecycle.current)return;
    setUnavailablePackageKeys(result.blocked);
    await measuredWorkspaceRead('prepare',()=>learningSystem.execute({kind:'prepare_queue',languageContext,at:new Date().toISOString()}));
    if(current!==lifecycle.current)return;
    await refresh();
   }catch{
    if(current!==lifecycle.current)return;
    setLoadStatus('unavailable');setNotice(localFlowText('learningReadFailed'));
   }
  })();
  initialRead.current=request;
  void request.finally(()=>{if(initialRead.current===request)initialRead.current=null;});
  return request;
 };

 useEffect(()=>{
  setLoaded(false);setBusy(false);setProgress(null);setNotice('');
  const learningCoordinator=createRefreshCoordinator(async()=>{await refreshLearning();});
  const supplyCoordinator=createRefreshCoordinator(refreshSupply);
  const current=lifecycle.current;
  const readFailed=()=>{if(current!==lifecycle.current)return;setLoadStatus('unavailable');setNotice(localFlowText('progressReadFailed'));};
  const reloadLearning=()=>void learningCoordinator.request().catch(readFailed);
  const reloadSupply=()=>void Promise.all([learningCoordinator.request(),supplyCoordinator.request()]).catch(readFailed);
  const prepare=async()=>{
   await measuredWorkspaceRead('prepare',()=>learningSystem.execute({kind:'prepare_queue',languageContext,at:new Date().toISOString()}));
   await learningCoordinator.request();
  };
  void retryInitialLoad();
  const stopLearning=learningSystem.subscribe({kind:'workspace',languageContext},reloadLearning);
  const stopSupply=contentSupplySystem.subscribe({kind:'workspace'},reloadSupply);
  const focus=()=>void prepare().catch(()=>setNotice(localFlowText('progressReadFailed')));
  window.addEventListener('focus',focus);
  return()=>{
   generation.current++;
   lifecycle.current++;
   initialRead.current=null;
   stopLearning();
   stopSupply();
   transfer.current?.abort();
   catalogRequest.current?.abort();
   window.removeEventListener('focus',focus);
  };
 },[languageContext.languageRouteId,languageContext.languageRouteRevision]);

 const lastRuntimeMode=useRef(runtimeOnly);
 useEffect(()=>{
  if(lastRuntimeMode.current===runtimeOnly)return;
  lastRuntimeMode.current=runtimeOnly;setLoadStatus('loading');
  // Hidden inventory/history remains untouched between Runtime Actions. Once
  // the learner leaves execution, reload the complete management view before
  // exposing its controls; an older asynchronous read cannot cross this mode.
  void refresh().catch(()=>{setLoadStatus('unavailable');setNotice(localFlowText('progressReadFailed'));});
 },[runtimeOnly]);

 useEffect(()=>{
  if(workspace.queue.nextChangeAt===null)return;
  const timer=window.setTimeout(
   ()=>void learningSystem.execute({kind:'prepare_queue',languageContext,at:new Date().toISOString()})
    .then(refreshLearning)
    .catch(()=>setNotice(localFlowText('progressReadFailed'))),
   Math.min(2_147_483_647,Math.max(20,workspace.queue.nextChangeAt-Date.now()+20)),
  );
  return()=>window.clearTimeout(timer);
 },[workspace.queue.nextChangeAt,languageContext.languageRouteId,languageContext.languageRouteRevision]);

 const perform=async<T,>(work:()=>Promise<T>,refreshAfter:()=>Promise<void>=async()=>{await refreshLearning();})=>{
  const current=lifecycle.current;
  setBusy(true);setNotice('');
  try{
   const outcome=await settleReconciledOperation(work,refreshAfter);
   if(current!==lifecycle.current||currentRoute.current!==routeKey)return null;
   if(outcome.projection==='stale'){setLoadStatus('unavailable');setNotice(localFlowText('progressReadFailed'));}
   if(outcome.kind==='unconfirmed'){
    if(outcome.projection==='stale')return null;
    const error=outcome.error;
    setNotice(error instanceof Error&&error.message.startsWith('localFlow.')?error.message:'runtime.actionReceiptUnavailable');
    return null;
   }
   return outcome.value;
  }finally{if(current===lifecycle.current&&currentRoute.current===routeKey){setBusy(false);setProgress(null);}}
 };
 const inspect=async<T,>(work:()=>Promise<T>)=>{
  setBusy(true);setNotice('');
  try{return await work();}
  catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:localFlowText('retryOperation'));return null;}
  finally{setBusy(false);}
 };

 const reloadCatalog=async(notify=false)=>{
  const gen=++generation.current;
  catalogRequest.current?.abort();
  const request=new AbortController();catalogRequest.current=request;
  setCatalogBusy(true);
  try{
   const local=await contentSupplySystem.read({kind:'catalog'});
   if(gen!==generation.current)return;
   setCatalog([...local]);
   const result=await contentSupplySystem.execute({kind:'refresh_catalog',force:notify,signal:request.signal});
   if(gen===generation.current){
    setCatalog([...result.items]);
    try{
     if(notify)setNotice(localFlowText(result.status==='current'?'catalogCurrent':'catalogUpdated'));
     else setNotice(current=>current==='localFlow.audioIncomplete'?'':current);
    }catch{setNotice(localFlowText('progressReadFailed'));}
   }
  }catch{if(gen===generation.current&&!request.signal.aborted)setNotice(localFlowText('catalogFailed'));}
  finally{
   if(catalogRequest.current===request)catalogRequest.current=null;
   if(gen===generation.current)setCatalogBusy(false);
  }
 };
 useEffect(()=>{if(entryOpen)void reloadCatalog();},[entryOpen]);

 const targetById=new Map(workspace.targets.map(target=>[target.targetId,target]));
 const initialReady=workspace.queue.initialReadyTargetIds.flatMap(id=>targetById.get(id)??[]);
 const due=workspace.queue.dueTargetIds.flatMap(id=>targetById.get(id)??[]);
 const nextTarget=runtimeOnly?(runtimeNextTargetId?{targetId:runtimeNextTargetId}:null):workspace.queue.nextTargetId?targetById.get(workspace.queue.nextTargetId)??null:null;
 const runtime=workspace.runtime;
 const dailyLimit=workspace.dailyLimit;

 return {
  languageContext,
  enrollments:workspace.enrollments,
  packages,catalog,
  targets:workspace.targets,
  activeTargets:workspace.targets,
  initialReady,due,nextTarget,runtime,
  records:workspace.records,
  policyOptions:workspace.policyOptions,
  dailyLimit:dailyLimit??undefined,
  notice:notice==='runtime.actionReceiptUnavailable'?i18n.t(notice):localFlowNotice(notice),busy:busy||loadStatus!=='ready',progress,loaded:loaded&&loadStatus==='ready',loadStatus,retryInitialLoad,unavailablePackageKeys,catalogBusy,reloadCatalog,refresh,
  confirmQuantity:(n:number)=>perform(()=>learningSystem.execute({kind:'confirm_quantity',operationId:crypto.randomUUID(),languageContext,dailyLimit:n})),
  download:(d:ContentSupplyCatalogItem,onPhase?:(phase:ContentSupplyInstallationPhase)=>void)=>perform(async()=>{
   const c=new AbortController();transfer.current=c;
   try{setProgress(0);return await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:d,signal:AbortSignal.any([c.signal,AbortSignal.timeout(120000)]),onProgress:n=>setProgress(Math.round(100*n)),onPhase});}
   finally{if(transfer.current===c)transfer.current=null;}
  },refresh),
  cancelDownload:()=>transfer.current?.abort(),
  previewImport:(file:File):Promise<PortablePackagePreview|null>=>inspect(async()=>{
   if(file.size>64*1024*1024)throw new Error('localFlow.packageTooLarge');
   return contentSupplySystem.execute({kind:'preview_portable_package',bytes:new Uint8Array(await file.arrayBuffer())});
  }),
  installImport:async(file:File,expectedArchiveDigest:string)=>{
   const installed=await perform(async()=>{
    if(file.size>64*1024*1024)throw new Error('localFlow.packageTooLarge');
    return contentSupplySystem.execute({kind:'install_portable_package',bytes:new Uint8Array(await file.arrayBuffer()),expectedArchiveDigest});
   },refresh);
   if(installed)setNotice(installed.content.targetLanguage!==languageContext.targetLanguageTag
    ?'localFlow.routeLanguageMismatch'
    :installed.content.supportLanguage!==languageContext.supportLanguageTag
      ?'localFlow.routeSupportMismatch'
      :'localFlow.packageSaved');
   return installed;
  },
  exportPackage:(packageKey:string)=>inspect(()=>contentSupplySystem.execute({kind:'export_portable_package',packageKey})),
  selectPolicy:(targetId:string,profileId:LearningPolicy)=>perform(()=>learningSystem.execute({kind:'select_policy',operationId:crypto.randomUUID(),targetId,languageContext,profileId})),
  enroll:(packageKey:string,publicationArchiveSha256?:string)=>perform(()=>learningSystem.execute({kind:'enroll_package',operationId:crypto.randomUUID(),packageKey,languageContext,publicationArchiveSha256})),
  enrollBook:(publicationArchiveSha256:string)=>perform(()=>learningSystem.execute({kind:'enroll_book',operationId:crypto.randomUUID(),languageContext,publicationArchiveSha256})),
  start:(targetId:string,dailyLimit:number)=>perform(()=>learningSystem.execute({kind:'start',operationId:crypto.randomUUID(),targetId,languageContext,dailyLimit})),
  act:async(action:LearningAction)=>{
   if(!runtime||actInFlight.current||loadStatus!=='ready')return null;
   actInFlight.current=true;
   try{return await perform(()=>learningSystem.execute({kind:'act',operationId:crypto.randomUUID(),runId:runtime.runId,expectedRevision:runtime.revision,action}));}
   finally{actInFlight.current=false;}
  },
  declareKnownAndContinue:async(targetId:string)=>{
   if(actInFlight.current)return null;
   actInFlight.current=true;
   try{
    const result=await perform(()=>learningSystem.execute({kind:'declare_mastery_and_continue',operationId:crypto.randomUUID(),targetId,languageContext,dailyLimit:workspace.dailyLimit}));
    if(result===false)setNotice('localFlow.runtimeKnownSaved');
    return result;
   }finally{actInFlight.current=false;}
  },
  declareKnown:(targetId:string,active=true)=>perform(()=>learningSystem.execute({kind:'set_declared_mastery',operationId:crypto.randomUUID(),targetId,active,languageContext})),
  advance:()=>runtime&&dailyLimit!==null?perform(()=>learningSystem.execute({kind:'advance',operationId:crypto.randomUUID(),runId:runtime.runId,languageContext,dailyLimit})):Promise.resolve(null),
 };
}
