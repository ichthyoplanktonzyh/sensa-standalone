import {useTranslation} from 'react-i18next';
import {useEffect,useRef,useState} from 'react';

import {
 contentSupplySystem,
 type ContentSupplyCatalogItem,
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
import {useLanguageRoutes} from './useLanguageRoutes';

const emptyWorkspace:LearningWorkspaceProjection={
 targets:[],
 queue:{activeTargetIds:[],dueTargetIds:[],initialReadyTargetIds:[],nextTargetId:null,nextChangeAt:null},
 runtime:null,
 activeRunId:null,
 dailyLimit:null,
 records:[],
 policyOptions:[],
};

export function usePackageLearning(entryOpen:boolean){
 useTranslation();
 const [packages,setPackages]=useState<InstalledPackage[]>([]);
 const [catalog,setCatalog]=useState<ContentSupplyCatalogItem[]>([]);
 const [workspace,setWorkspace]=useState<LearningWorkspaceProjection>(emptyWorkspace);
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const [progress,setProgress]=useState<number|null>(null);
 const [loaded,setLoaded]=useState(false);
 const [catalogBusy,setCatalogBusy]=useState(false);
 const transfer=useRef<AbortController|null>(null);
 const catalogRequest=useRef<AbortController|null>(null);
 const generation=useRef(0);
 const actInFlight=useRef(false);
 const {context:languageContext}=useLanguageRoutes();

 const refresh=async()=>{
  const [projection,supply]=await Promise.all([
   learningSystem.read({kind:'workspace',languageContext,clock:Date.now()}),
   contentSupplySystem.read({kind:'workspace'}),
  ]);
  setWorkspace(projection);
  setPackages([...supply.packages]);
  setCatalog([...supply.catalog]);
  setLoaded(true);
 };

 useEffect(()=>{
  void contentSupplySystem.execute({kind:'rehydrate'}).then(refresh).catch(()=>setNotice(localFlowText('learningReadFailed')));
  const reload=()=>void refresh().catch(()=>setNotice(localFlowText('progressReadFailed')));
  const stopLearning=learningSystem.subscribe({kind:'workspace',languageContext},reload);
  const stopSupply=contentSupplySystem.subscribe({kind:'workspace'},reload);
  const focus=()=>void refresh();
  window.addEventListener('focus',focus);
  return()=>{
   generation.current++;
   stopLearning();
   stopSupply();
   transfer.current?.abort();
   catalogRequest.current?.abort();
   window.removeEventListener('focus',focus);
  };
 },[languageContext.languageRouteId,languageContext.languageRouteRevision]);

 useEffect(()=>{
  if(workspace.queue.nextChangeAt===null)return;
  const timer=window.setTimeout(
   ()=>void refresh(),
   Math.min(2_147_483_647,Math.max(20,workspace.queue.nextChangeAt-Date.now()+20)),
  );
  return()=>window.clearTimeout(timer);
 },[workspace.queue.nextChangeAt]);

 const perform=async<T,>(work:()=>Promise<T>)=>{
  setBusy(true);setNotice('');
  try{const result=await work();await refresh();return result;}
  catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:localFlowText('retryOperation'));return null;}
  finally{setBusy(false);setProgress(null);}
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
  try{
   const local=await contentSupplySystem.read({kind:'workspace'});
   if(gen!==generation.current)return;
   setCatalog([...local.catalog]);setCatalogBusy(true);
   const result=await contentSupplySystem.execute({kind:'refresh_catalog',force:notify,signal:request.signal});
   if(gen===generation.current){
    await refresh();setCatalog([...result.items]);
    if(notify)setNotice(localFlowText(result.status==='current'?'catalogCurrent':'catalogUpdated'));
    else setNotice(current=>current==='localFlow.audioIncomplete'?'':current);
   }
  }catch{if(gen===generation.current&&notify)setNotice(localFlowText('catalogFailed'));}
  finally{
   if(catalogRequest.current===request)catalogRequest.current=null;
   if(gen===generation.current)setCatalogBusy(false);
  }
 };
 useEffect(()=>{if(entryOpen)void reloadCatalog();},[entryOpen]);

 const targetById=new Map(workspace.targets.map(target=>[target.targetId,target]));
 const initialReady=workspace.queue.initialReadyTargetIds.flatMap(id=>targetById.get(id)??[]);
 const due=workspace.queue.dueTargetIds.flatMap(id=>targetById.get(id)??[]);
 const nextTarget=workspace.queue.nextTargetId?targetById.get(workspace.queue.nextTargetId)??null:null;
 const runtime=workspace.runtime;
 const dailyLimit=workspace.dailyLimit;

 return {
  languageContext,
  packages,catalog,
  targets:workspace.targets,
  activeTargets:workspace.targets,
  initialReady,due,nextTarget,runtime,
  records:workspace.records,
  policyOptions:workspace.policyOptions,
  dailyLimit:dailyLimit??undefined,
  notice:localFlowNotice(notice),busy,progress,loaded,catalogBusy,reloadCatalog,refresh,
  confirmQuantity:(n:number)=>perform(()=>learningSystem.execute({kind:'confirm_quantity',operationId:crypto.randomUUID(),languageContext,dailyLimit:n})),
  download:(d:ContentSupplyCatalogItem)=>perform(async()=>{
   const c=new AbortController();transfer.current=c;
   try{setProgress(0);return await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:d,signal:AbortSignal.any([c.signal,AbortSignal.timeout(120000)]),onProgress:n=>setProgress(Math.round(100*n))});}
   finally{if(transfer.current===c)transfer.current=null;}
  }),
  cancelDownload:()=>transfer.current?.abort(),
  previewImport:(file:File):Promise<PortablePackagePreview|null>=>inspect(async()=>{
   if(file.size>64*1024*1024)throw new Error('localFlow.packageTooLarge');
   return contentSupplySystem.execute({kind:'preview_portable_package',bytes:new Uint8Array(await file.arrayBuffer())});
  }),
  installImport:async(file:File,expectedArchiveDigest:string)=>{
   const installed=await perform(async()=>{
    if(file.size>64*1024*1024)throw new Error('localFlow.packageTooLarge');
    return contentSupplySystem.execute({kind:'install_portable_package',bytes:new Uint8Array(await file.arrayBuffer()),expectedArchiveDigest});
   });
   if(installed)setNotice(installed.content.targetLanguage!==languageContext.targetLanguageTag
    ?'localFlow.routeLanguageMismatch'
    :installed.content.supportLanguage!==languageContext.supportLanguageTag
      ?'localFlow.routeSupportMismatch'
      :'localFlow.packageSaved');
   return installed;
  },
  exportPackage:(packageKey:string)=>inspect(()=>contentSupplySystem.execute({kind:'export_portable_package',packageKey})),
  selectPolicy:(targetId:string,profileId:LearningPolicy)=>perform(()=>learningSystem.execute({kind:'select_policy',operationId:crypto.randomUUID(),targetId,languageContext,profileId})),
  enroll:(packageKey:string,publicationManifestSha256?:string)=>perform(()=>learningSystem.execute({kind:'enroll_package',operationId:crypto.randomUUID(),packageKey,languageContext,publicationManifestSha256})),
  enrollBook:(packageKeys:readonly string[],publicationManifestSha256:string)=>perform(async()=>{
   const targetIds:string[]=[];
   for(const packageKey of packageKeys){
    targetIds.push(...await learningSystem.execute({kind:'enroll_package',operationId:crypto.randomUUID(),packageKey,languageContext,publicationManifestSha256}));
   }
   return targetIds;
  }),
  start:(targetId:string,dailyLimit:number)=>perform(()=>learningSystem.execute({kind:'start',operationId:crypto.randomUUID(),targetId,languageContext,dailyLimit})),
  act:async(action:LearningAction)=>{
   if(!runtime||actInFlight.current)return null;
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
  declareKnown:(targetId:string,active=true)=>perform(()=>learningSystem.execute({kind:'set_declared_mastery',operationId:crypto.randomUUID(),targetId,active})),
  advance:()=>runtime&&dailyLimit!==null?perform(()=>learningSystem.execute({kind:'advance',operationId:crypto.randomUUID(),runId:runtime.runId,languageContext,dailyLimit})):Promise.resolve(null),
 };
}
