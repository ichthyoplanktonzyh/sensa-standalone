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
 type LearningManagementProjection,
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

export function usePackageLearning(entryOpen:boolean,mode:'workspace'|'runtime'|'management'|'preferences'|'target'='workspace',targetId?:string){
 const runtimeOnly=mode==='runtime',managementOnly=mode==='management'||mode==='preferences';
 useTranslation();
 const languageContext=useActiveLanguageContext();
 const routeKey=`${languageContext.languageRouteId}:${languageContext.languageRouteRevision}`;
 const currentRoute=useRef(routeKey);currentRoute.current=routeKey;
 const [packages,setPackages]=useState<InstalledPackage[]>([]);
 const [catalog,setCatalog]=useState<ContentSupplyCatalogItem[]>([]);
 const [workspace,setWorkspace]=useState<LearningWorkspaceProjection>(emptyWorkspace);
 const [sessionSummary,setSessionSummary]=useState<import('../../learning/system/learningReadModels').LearningSessionSummary|null>(null);
 const [management,setManagement]=useState<LearningManagementProjection|null>(null);
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const [progress,setProgress]=useState<number|null>(null);
 const [installation,setInstallation]=useState<{bookKey:string;phase:ContentSupplyInstallationPhase}|null>(null);
 const [downloadFailed,setDownloadFailed]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const runtimeMode=useRef(runtimeOnly);runtimeMode.current=runtimeOnly;
 const managementMode=useRef(managementOnly);managementMode.current=managementOnly;
 const targetSelection=useRef(targetId);targetSelection.current=targetId;
 const viewEpoch=useRef({routeKey,mode,targetId,version:0});
 if(viewEpoch.current.routeKey!==routeKey||viewEpoch.current.mode!==mode||viewEpoch.current.targetId!==targetId)viewEpoch.current={routeKey,mode,targetId,version:viewEpoch.current.version+1};
 const [targetDetail,setTargetDetail]=useState<{activeRunTargetIds:readonly string[];exportPackageKey:string|null}>({activeRunTargetIds:[],exportPackageKey:null});
 const [runtimeNextTargetId,setRuntimeNextTargetId]=useState<string|null>(null);
 const [runtimePreferencesDailyLimit,setRuntimePreferencesDailyLimit]=useState<number|null>(null);
 const [loadState,setLoadState]=useState<{routeKey:string;version:number;status:'loading'|'ready'|'unavailable'}>(()=>({routeKey,version:viewEpoch.current.version,status:'loading'}));
 // A changed Route invalidates readiness during render, before the passive
 // reload effect can run. Old targets cannot become a new Session's scope.
 const loadStatus=loadState.routeKey===routeKey&&loadState.version===viewEpoch.current.version?loadState.status:'loading';
 const setLoadStatus=(status:typeof loadState.status)=>{if(currentRoute.current===routeKey)setLoadState({routeKey,version:viewEpoch.current.version,status});};
 const [unavailablePackageKeys,setUnavailablePackageKeys]=useState<readonly string[]>([]);
 const [catalogBusy,setCatalogBusy]=useState(false);
 const [catalogStatus,setCatalogStatus]=useState<'loading'|'ready'|'unavailable'>('loading');
 const [catalogFailed,setCatalogFailed]=useState(false);
 const transfer=useRef<AbortController|null>(null);
 const catalogRequest=useRef<AbortController|null>(null);
 const generation=useRef(0);
 const lifecycle=useRef(0);
 const initialRead=useRef<{version:number;promise:Promise<void>}|null>(null);
 const actInFlight=useRef(false);

 const refreshLearning=async()=>{
  if(currentRoute.current!==routeKey)return false;
  const current=lifecycle.current,version=viewEpoch.current.version,readingRuntime=runtimeMode.current,readingManagement=managementMode.current;
  if(viewEpoch.current.mode==='target'){
   const selection=targetSelection.current;
   const projection=selection?await measuredWorkspaceRead('target',()=>learningSystem.read({kind:'target',targetId:selection,languageContext,clock:Date.now()})):null;
   if(current!==lifecycle.current||version!==viewEpoch.current.version||currentRoute.current!==routeKey)return false;
   setWorkspace({...emptyWorkspace,targets:projection?.target?[projection.target]:[],dailyLimit:projection?.dailyLimit??null,policyOptions:projection?.policyOptions??[]});
   setTargetDetail({activeRunTargetIds:projection?.activeRunTargetIds??[],exportPackageKey:projection?.exportPackageKey??null});
   setRuntimeNextTargetId(null);setLoadStatus('ready');return true;
  }
  if(viewEpoch.current.mode==='preferences'){
   const projection=await measuredWorkspaceRead('preferences',()=>learningSystem.read({kind:'preferences',languageContext}));
   if(current!==lifecycle.current||version!==viewEpoch.current.version||currentRoute.current!==routeKey)return false;
   setWorkspace({...emptyWorkspace,...projection});setRuntimeNextTargetId(null);setLoadStatus('ready');return true;
  }
  if(readingManagement){
   const projection=await measuredWorkspaceRead('management',()=>learningSystem.read({kind:'management',languageContext,clock:Date.now()}));
   if(current!==lifecycle.current||version!==viewEpoch.current.version||currentRoute.current!==routeKey)return false;
   setManagement(projection);setWorkspace({...emptyWorkspace,dailyLimit:projection.dailyLimit,policyOptions:projection.policyOptions});setRuntimeNextTargetId(null);setLoadStatus('ready');return true;
  }
  if(readingRuntime){
   const projection=await measuredWorkspaceRead('runtime',()=>learningSystem.read({kind:'runtime',languageContext,clock:Date.now()}));
   // The current Run already pins its executable material. Only its current
   // published source is needed for the optional save-to-meaning action;
   // collection recovery and catalog inventory are not Runtime prerequisites.
   const sourceKey=projection.runtime?.kind==='lightweight'?projection.runtime.target.packageKey:null;
   const sources=await measuredWorkspaceRead('runtimeSource',()=>contentSupplySystem.read({kind:'package_summaries',packageKeys:sourceKey?[sourceKey]:[]}));
   if(current!==lifecycle.current||version!==viewEpoch.current.version||currentRoute.current!==routeKey)return false;
   setPackages([...sources]);
   setRuntimePreferencesDailyLimit(projection.preferencesDailyLimit);
   setSessionSummary(projection.sessionSummary);
   setWorkspace(previous=>({...previous,runtime:projection.runtime,activeRunId:projection.runtime?.runId??null,dailyLimit:projection.dailyLimit,policyOptions:projection.policyOptions,
    queue:{...previous.queue,nextTargetId:projection.nextTargetId,nextChangeAt:projection.nextChangeAt}}));
   setRuntimeNextTargetId(projection.nextTargetId);
  }else{
   const projection=await measuredWorkspaceRead('learning',()=>learningSystem.read({kind:'workspace',languageContext,clock:Date.now()}));
   if(current!==lifecycle.current||version!==viewEpoch.current.version||currentRoute.current!==routeKey)return false;
   setWorkspace(projection);setRuntimeNextTargetId(null);
  }
  setLoadStatus('ready');return true;
 };
 const refreshSupply=async()=>{
  const current=lifecycle.current;
  const catalogGeneration=generation.current;
  const supply=await measuredWorkspaceRead('supply',()=>contentSupplySystem.read({kind:'workspace'}));
  if(current!==lifecycle.current)return;
  setPackages([...supply.packages]);
  const available=new Set(supply.packages.map(pack=>pack.key));
  setUnavailablePackageKeys(keys=>keys.filter(key=>!available.has(key)));
  if(catalogGeneration===generation.current)setCatalog([...supply.catalog]);
 };
 const refresh=async()=>{
  const current=lifecycle.current,version=viewEpoch.current.version;
  const [learningApplied]=await Promise.all([refreshLearning(),runtimeMode.current||managementMode.current||viewEpoch.current.mode==='target'?Promise.resolve():refreshSupply()]);
  if(current!==lifecycle.current||version!==viewEpoch.current.version||!learningApplied)return;
  setLoaded(true);
  setLoadStatus('ready');
 };

 const retryInitialLoad=()=>{
  if(initialRead.current?.version===viewEpoch.current.version)return initialRead.current.promise;
  const current=lifecycle.current,version=viewEpoch.current.version;
  setLoadStatus('loading');
  setNotice(current=>[localFlowText('learningReadFailed'),localFlowText('progressReadFailed')].includes(current)?'':current);
  const request=(async()=>{
   try{
    if(runtimeMode.current||managementMode.current||viewEpoch.current.mode==='target'){await refresh();return;}
    const result=await measuredWorkspaceRead('rehydrate',()=>contentSupplySystem.execute({kind:'rehydrate'}));
    if(current!==lifecycle.current||version!==viewEpoch.current.version)return;
    setUnavailablePackageKeys(result.blocked);
    await measuredWorkspaceRead('prepare',()=>learningSystem.execute({kind:'prepare_queue',languageContext,at:new Date().toISOString()}));
    if(current!==lifecycle.current||version!==viewEpoch.current.version)return;
    await refresh();
   }catch{
    if(current!==lifecycle.current||version!==viewEpoch.current.version)return;
    setLoadStatus('unavailable');setNotice(localFlowText('learningReadFailed'));
   }
  })();
  const reading={version,promise:request};initialRead.current=reading;
  void request.finally(()=>{if(initialRead.current===reading)initialRead.current=null;});
  return request;
 };

 useEffect(()=>{
  setLoaded(false);setManagement(null);setBusy(false);setProgress(null);setInstallation(null);setDownloadFailed(false);setNotice('');
  const learningCoordinator=createRefreshCoordinator(async()=>{await refreshLearning();});
  const supplyCoordinator=createRefreshCoordinator(refreshSupply);
  const current=lifecycle.current;
  const readFailed=(version:number)=>{if(current!==lifecycle.current||version!==viewEpoch.current.version)return;setLoadStatus('unavailable');setNotice(previous=>previous==='sessionEnd.savedReadFailed'?previous:localFlowText('progressReadFailed'));};
  const reloadLearning=()=>{const version=viewEpoch.current.version;void learningCoordinator.request().catch(()=>readFailed(version));};
  const reloadSupply=()=>{const version=viewEpoch.current.version;void Promise.all([learningCoordinator.request(),runtimeMode.current||managementMode.current||viewEpoch.current.mode==='target'?Promise.resolve():supplyCoordinator.request()]).catch(()=>readFailed(version));};
  const prepare=async()=>{
   if(runtimeMode.current||managementMode.current||viewEpoch.current.mode==='target'){await learningCoordinator.request();return;}
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
 const selectionKey=JSON.stringify([mode,targetId??null]);
 const lastViewMode=useRef(selectionKey);
 useEffect(()=>{
  if(lastRuntimeMode.current===runtimeOnly&&lastViewMode.current===selectionKey)return;
  lastRuntimeMode.current=runtimeOnly;lastViewMode.current=selectionKey;setLoadStatus('loading');
  // Every screen/Target selection gets its own projection epoch. Hidden
  // inventory/history stays untouched; an old read cannot cross this view.
  const version=viewEpoch.current.version;
  void refresh().catch(()=>{if(version===viewEpoch.current.version){setLoadStatus('unavailable');setNotice(localFlowText('progressReadFailed'));}});
 },[selectionKey]);

 useEffect(()=>{
  if(managementOnly||mode==='target')return;
  if(workspace.queue.nextChangeAt===null)return;
  const timer=window.setTimeout(
   ()=>void (runtimeOnly?Promise.resolve():learningSystem.execute({kind:'prepare_queue',languageContext,at:new Date().toISOString()}))
    .then(refreshLearning)
    .catch(()=>setNotice(localFlowText('progressReadFailed'))),
   Math.min(2_147_483_647,Math.max(20,workspace.queue.nextChangeAt-Date.now()+20)),
  );
  return()=>window.clearTimeout(timer);
 },[workspace.queue.nextChangeAt,languageContext.languageRouteId,languageContext.languageRouteRevision,mode]);

 const perform=async<T,>(work:()=>Promise<T>,refreshAfter:()=>Promise<void>=async()=>{await refreshLearning();},unconfirmedNotice='runtime.actionReceiptUnavailable')=>{
  const current=lifecycle.current;
  setDownloadFailed(false);
  setBusy(true);setNotice('');
  try{
   const outcome=await settleReconciledOperation(work,refreshAfter);
   if(current!==lifecycle.current||currentRoute.current!==routeKey)return null;
   if(outcome.projection==='stale'){setLoadStatus('unavailable');setNotice(localFlowText('progressReadFailed'));}
   if(outcome.kind==='unconfirmed'){
    if(outcome.projection==='stale')return null;
    const error=outcome.error;
    setNotice(error instanceof Error&&error.message.startsWith('localFlow.')?error.message:unconfirmedNotice);
    return null;
   }
   return outcome.value;
  }finally{if(current===lifecycle.current&&currentRoute.current===routeKey){setBusy(false);setProgress(null);}}
 };
 const inspect=async<T,>(work:()=>Promise<T>)=>{
  setDownloadFailed(false);
  setBusy(true);setNotice('');
  try{return await work();}
  catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:localFlowText('retryOperation'));return null;}
  finally{setBusy(false);}
 };

 const reloadCatalog=async(notify=false)=>{
  if(notify)setDownloadFailed(false);
  const gen=++generation.current;
  catalogRequest.current?.abort();
  const request=new AbortController();catalogRequest.current=request;
  setCatalogBusy(true);
  setCatalogFailed(false);
  let cached=false;
  try{
   const local=await contentSupplySystem.read({kind:'catalog_snapshot'});
   if(gen!==generation.current)return;
   cached=local.checkedAt!==null;
   setCatalog([...local.items]);
   setCatalogStatus(cached?'ready':'loading');
   const result=await contentSupplySystem.execute({kind:'refresh_catalog',force:notify,signal:request.signal});
   if(gen===generation.current){
    setCatalog([...result.items]);
    setCatalogStatus('ready');
    try{
     if(notify)setNotice(localFlowText(result.status==='current'?'catalogCurrent':'catalogUpdated'));
     else setNotice(current=>current==='localFlow.audioIncomplete'?'':current);
    }catch{setNotice(localFlowText('progressReadFailed'));}
   }
  }catch{if(gen===generation.current&&!request.signal.aborted){setCatalogFailed(true);setCatalogStatus(cached?'ready':'unavailable');}}
  finally{
   if(catalogRequest.current===request)catalogRequest.current=null;
   if(gen===generation.current)setCatalogBusy(false);
  }
 };
 // Restoring a saved Route aborts the previous catalog request in cleanup.
 // Restart that read even when the Catalog remains the active entry.
 useEffect(()=>{if(entryOpen)void reloadCatalog();},[entryOpen,languageContext.languageRouteId,languageContext.languageRouteRevision]);

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
  management:mode==='management'&&loadStatus==='ready'?management:null,
  targets:mode==='target'&&loadStatus!=='ready'?[]:workspace.targets,
  activeTargets:mode==='target'&&loadStatus!=='ready'?[]:workspace.targets,
  activeRunTargetIds:mode==='target'?targetDetail.activeRunTargetIds:workspace.runtime?.targetIds??[],
  targetExportPackageKey:mode==='target'&&loadStatus==='ready'?targetDetail.exportPackageKey:null,
  initialReady,due,nextTarget,runtime,
  sessionSummary:runtimeOnly&&loadStatus==='ready'?sessionSummary:null,
  records:workspace.records,
  policyOptions:workspace.policyOptions,
  dailyLimit:dailyLimit??undefined,
  preferencesDailyLimit:runtimeOnly?runtimePreferencesDailyLimit:dailyLimit,
  notice:notice==='runtime.actionReceiptUnavailable'||notice==='learningPreferences.quantitySaveUnconfirmed'||notice.startsWith('sessionEnd.')?i18n.t(notice):localFlowNotice(notice),busy:busy||loadStatus!=='ready',progress,installation,downloadFailed,loaded:loaded&&loadStatus==='ready',loadStatus,retryInitialLoad,unavailablePackageKeys,catalogBusy,catalogStatus,catalogFailed,reloadCatalog,refresh,
  endedStateNeedsRead:notice==='sessionEnd.savedReadFailed',
  retryEndedStateRead:async()=>{
   if(actInFlight.current)return;const current=lifecycle.current;actInFlight.current=true;setBusy(true);
   try{if(await refreshLearning()&&current===lifecycle.current&&currentRoute.current===routeKey)setNotice('');}
   catch{if(current===lifecycle.current&&currentRoute.current===routeKey){setLoadStatus('unavailable');setNotice('sessionEnd.savedReadFailed');}}
   finally{actInFlight.current=false;if(current===lifecycle.current&&currentRoute.current===routeKey)setBusy(false);}
  },
  confirmQuantity:(n:number)=>perform(()=>learningSystem.execute({kind:'confirm_quantity',operationId:crypto.randomUUID(),languageContext,dailyLimit:n}),undefined,'learningPreferences.quantitySaveUnconfirmed'),
  download:(d:ContentSupplyCatalogItem,onPhase?:(phase:ContentSupplyInstallationPhase)=>void)=>{
   if(transfer.current)return Promise.resolve(null);
   const c=new AbortController();transfer.current=c;
   const current=lifecycle.current;
   setDownloadFailed(false);
   setInstallation({bookKey:d.book.bookKey,phase:'downloading'});
   return perform(async()=>{
    setProgress(0);
    return contentSupplySystem.execute({kind:'install_catalog_item',descriptor:d,signal:AbortSignal.any([c.signal,AbortSignal.timeout(120000)]),onProgress:n=>{if(transfer.current===c)setProgress(Math.round(100*n));},onPhase:phase=>{if(transfer.current===c){setInstallation({bookKey:d.book.bookKey,phase});onPhase?.(phase);}}});
   },refresh).then(result=>{if(current===lifecycle.current&&result===null&&!c.signal.aborted)setDownloadFailed(true);return result;})
    .finally(()=>{if(transfer.current===c){transfer.current=null;if(current===lifecycle.current)setInstallation(null);}});
  },
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
  start:(targetId:string,dailyLimit:number,sessionIntent:'mixed'|'review_only'='mixed')=>perform(()=>learningSystem.execute({kind:'start',operationId:crypto.randomUUID(),targetId,languageContext,dailyLimit,sessionIntent})),
  retryRelearning:async()=>{
   if(runtime?.kind!=='lightweight'||!runtime.needsRelearning||!runtime.completed||dailyLimit===null||actInFlight.current||loadStatus!=='ready')return null;
   actInFlight.current=true;
   try{return await perform(()=>learningSystem.execute({kind:'continue',operationId:crypto.randomUUID(),runId:runtime.runId,targetId:runtime.currentTargetId,languageContext,dailyLimit,requiredPurpose:'relearning'}));}
   finally{actInFlight.current=false;}
  },
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
  endSession:async(runId:string,expectedRevision:number)=>{
   if(actInFlight.current||loadStatus!=='ready')return null;
   const current=lifecycle.current;actInFlight.current=true;setBusy(true);setNotice('');
   try{
    const outcome=await settleReconciledOperation(()=>learningSystem.execute({kind:'end_session',operationId:crypto.randomUUID(),runId,expectedRevision}),async()=>{await refreshLearning();});
    if(current!==lifecycle.current||currentRoute.current!==routeKey)return null;
    if(outcome.projection==='stale'){setLoadStatus('unavailable');setNotice(outcome.kind==='committed'?'sessionEnd.savedReadFailed':localFlowText('progressReadFailed'));return null;}
    if(outcome.kind==='unconfirmed'){setNotice(outcome.error instanceof Error&&outcome.error.message.startsWith('localFlow.')?outcome.error.message:'sessionEnd.unconfirmed');return null;}
    return true;
   }finally{actInFlight.current=false;if(current===lifecycle.current&&currentRoute.current===routeKey)setBusy(false);}
  },
  advance:async()=>{
   if(!runtime||actInFlight.current||loadStatus!=='ready')return null;
   actInFlight.current=true;
   try{return await perform(()=>learningSystem.execute({kind:'advance',operationId:crypto.randomUUID(),runId:runtime.runId,languageContext,dailyLimit}));}
   finally{actInFlight.current=false;}
  },
 };
}
