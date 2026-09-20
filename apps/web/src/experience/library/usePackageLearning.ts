import {useTranslation} from 'react-i18next';
import {useLanguageRoutes} from './useLanguageRoutes';
import {advanceInterleavedLearningRetries,nextLearningQueueChangeAt,resolveLearningQueue,selectInterleavedLearningTarget,type InterleavedLearningRetry} from './learningQueue';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {useEffect,useRef,useState} from 'react';
import {learningPackageCatalogSchema,type LearningPackageDescriptor} from '@sensa/contracts/sensa';
import {auth} from '../../data/account/auth';
import {openLibrary,observeLibrary,readLibrary,writeLibraryState} from '../../data/library/store';
import type {InstalledPackage} from '../../data/library/packageRecords';
import {localRunTargetIds,selectLocalLearningPolicy,setLocalDeclaredMastery,readLearningOverview,enrollPackage,startLearning,actLearning,finishLearning,continueLearning,confirmLearningQuantity,type LocalLearningTarget,type LocalLearningRun} from '../../data/library/learning';
import type {LearningRecordView} from '../learningJourney/learningHistory';
import {inspectLocalTargetReadiness} from '../../learning/runtime/runtimeCoordinator';
import {localCurriculumMembershipForContext,localLastPresentedMaterial} from '../../learning/runtime/localCurriculum';
export function usePackageLearning(entryOpen:boolean){
 useTranslation();
 const [packages,setPackages]=useState<InstalledPackage[]>([]),[catalog,setCatalog]=useState<LearningPackageDescriptor[]>([]),[targets,setTargets]=useState<LocalLearningTarget[]>([]),[runs,setRuns]=useState<LocalLearningRun[]>([]),[activeId,setActiveId]=useState<string|undefined>();
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState<number|null>(null),[loaded,setLoaded]=useState(false),[catalogBusy,setCatalogBusy]=useState(false);
 const [dailyLimit,setDailyLimit]=useState<number|undefined>();
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{const tick=()=>setClock(Date.now());window.addEventListener('focus',tick);return()=>window.removeEventListener('focus',tick);},[]);
 const transfer=useRef<AbortController|null>(null),generation=useRef(0),actInFlight=useRef(false);
 const [interleavedRetries,setInterleavedRetries]=useState<InterleavedLearningRetry[]>([]);
 const {activeRoute,context:languageContext}=useLanguageRoutes();
 const refresh=async()=>{const snapshot=await readLearningOverview();setPackages(snapshot.packages);setTargets(snapshot.targets);setRuns(snapshot.runs);setActiveId(snapshot.active);setDailyLimit(snapshot.studyPlans[languageContext.languageRouteId]?.dailyNewSenseLimit);setLoaded(true);};
 useEffect(()=>{void openLibrary().then(refresh).catch(()=>setNotice(localFlowText('learningReadFailed')));const stop=observeLibrary(()=>void refresh().catch(()=>setNotice(localFlowText('progressReadFailed'))),['packages','learningTargets','learningRuns','learningEvents','settings','meta']);return()=>{generation.current++;stop();transfer.current?.abort();};},[languageContext.languageRouteId,languageContext.languageRouteRevision]);
 const perform=async<T,>(work:()=>Promise<T>)=>{setBusy(true);setNotice('');try{const result=await work();await refresh();return result;}catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:localFlowText('retryOperation'));return null;}finally{setBusy(false);setProgress(null);}};
 const reloadCatalog=async(notify=false)=>{
  const gen=++generation.current;
  let sessionTimer:ReturnType<typeof setTimeout>|undefined;
  try{const stored=await readLibrary(tx=>tx.get<LearningPackageDescriptor[]|{format:'sensa-local-registry-cache-v1';items:LearningPackageDescriptor[];revision:string|null;checkedAt:string}>('meta','package-catalog')),cached=Array.isArray(stored)?{items:stored,revision:null,checkedAt:null}:stored;if(gen!==generation.current)return;setCatalog(cached?.items??[]);
   const localOwnerAcceptance=import.meta.env.VITE_SENSA_MODE==='local-owner-acceptance';
   if(!notify&&!localOwnerAcceptance&&cached?.checkedAt&&Date.now()-Date.parse(cached.checkedAt)<6*60*60*1000)return;
   setCatalogBusy(true);
  const session=(await Promise.race([auth?.getSession(),new Promise<never>((_,reject)=>{sessionTimer=setTimeout(()=>reject(new Error('session unavailable')),3000);})]))?.data.session,endpoint=import.meta.env.VITE_SENSA_API_URL;if(!session||!endpoint)throw Error();
   const headers:Record<string,string>={authorization:'Bearer '+session.access_token};if(cached?.revision)headers['if-none-match']=`"${cached.revision}"`;
   const r=await fetch(endpoint.replace(/\/+$/u,'')+'/sensa/packages',{headers,signal:AbortSignal.timeout(15000),redirect:'error'});if(r.status!==304&&!r.ok)throw Error();const notModified=r.status===304,c=notModified?null:learningPackageCatalogSchema.parse(await r.json()),items=c?.items??cached?.items??[],revision=c&&'format' in c?c.revision:cached?.revision??null;
   if(gen!==generation.current||(await auth?.getSession())?.data.session?.user.id!==session.user.id)return;
   await writeLibraryState(async tx=>{tx.put('meta','package-catalog',{format:'sensa-local-registry-cache-v1',items,revision,checkedAt:new Date().toISOString()});});if(gen===generation.current){setCatalog(items);if(notify)setNotice(localFlowText(notModified?'catalogCurrent':'catalogUpdated'));else setNotice(current=>current==='localFlow.audioIncomplete'?'':current);}
  }catch{if(gen===generation.current&&notify)setNotice(localFlowText('catalogFailed'));}finally{clearTimeout(sessionTimer);if(gen===generation.current)setCatalogBusy(false);}
 };
 useEffect(()=>{if(entryOpen)void reloadCatalog();},[entryOpen]);
 const run=runs.find(r=>r.id===activeId)??null;
 const records:LearningRecordView[]=runs.filter(r=>r.completedAt&&r.completionKind!=='wait_relearning').flatMap(r=>localRunTargetIds(r).map(targetId=>{const target=targets.find(t=>t.id===targetId),participant=r.participants[targetId],material=participant?localLastPresentedMaterial(participant):undefined,meaning=material?.content.resources.find(resource=>resource.materialRoleKey==='sense_confirmation')?.contentPayload.meaning;return {recordId:r.id+':'+targetId,targetId,expression:target?.expression??'',languageTag:target?.targetLanguageTag??'',meaning:typeof meaning==='string'?meaning:undefined,occurredAt:r.targetCompletions?.[targetId]?.at??r.completedAt!,kind:r.purpose,label:r.purpose==='initial_learning'?localFlowText('initialRecord'):r.purpose==='retention_review'?localFlowText('reviewRecord'):localFlowText('relearningRecord'),detail:localFlowText('localRecord')}})).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
 const membershipByTarget=Object.fromEntries(targets.flatMap(target=>{const membership=localCurriculumMembershipForContext(target,languageContext);return membership?[[target.id,membership]]:[];}));
 const readinessByTarget=Object.fromEntries(targets.map(target=>{const membership=membershipByTarget[target.id];return [target.id,inspectLocalTargetReadiness(target,membership,membership?.packageKey?packages.find(pack=>pack.key===membership.packageKey):undefined).status];})) as Readonly<Record<string,'ready'|'blocked'>>;
 const {activeTargets,due,initialReady}=resolveLearningQueue({targets,languageRouteId:activeRoute.id,readiness:readinessByTarget,clock,dailyLimit});
 const nextQueueChangeAt=nextLearningQueueChangeAt({targets,languageRouteId:activeRoute.id,readiness:readinessByTarget,clock,dailyLimit});
 useEffect(()=>{
  if(nextQueueChangeAt===null)return;
  const timer=window.setTimeout(()=>setClock(Date.now()),Math.min(2_147_483_647,Math.max(20,nextQueueChangeAt-Date.now()+20)));
  return()=>window.clearTimeout(timer);
 },[nextQueueChangeAt]);
 const nextTarget=selectInterleavedLearningTarget({due,initialReady,currentRunTargetIds:run?localRunTargetIds(run):[],retries:interleavedRetries});
 return {nextTarget,initialReady,readinessByTarget,membershipByTarget,languageContext,packages,catalog,targets,activeTargets,runs,run,records,due,notice:localFlowNotice(notice),busy,progress,loaded,catalogBusy,reloadCatalog,refresh,dailyLimit,confirmQuantity:(n:number)=>perform(()=>confirmLearningQuantity(crypto.randomUUID(),languageContext,n)),
  download:(d:LearningPackageDescriptor)=>perform(async()=>{const c=new AbortController();transfer.current=c;try{setProgress(0);const {downloadPackage}=await import('../../data/library/packages');return await downloadPackage(d,AbortSignal.any([c.signal,AbortSignal.timeout(120000)]),n=>setProgress(Math.round(100*n/d.byteLength)));}finally{if(transfer.current===c)transfer.current=null;}}),
  cancelDownload:()=>transfer.current?.abort(),importFile:(file:File)=>perform(async()=>{if(file.size>64*1024*1024)throw new Error('localFlow.packageTooLarge');const {installPackage}=await import('../../data/library/packages');return installPackage(new Uint8Array(await file.arrayBuffer()));}),
  selectPolicy:(targetId:string,profileId:Parameters<typeof selectLocalLearningPolicy>[3])=>perform(()=>selectLocalLearningPolicy(crypto.randomUUID(),targetId,languageContext,profileId)),
  enroll:(key:string)=>perform(()=>enrollPackage(crypto.randomUUID(),key,languageContext)),
  start:(id:string,limit:number)=>perform(()=>startLearning(crypto.randomUUID(),id,languageContext,limit)),
  act:async(action:Parameters<typeof actLearning>[3])=>{
   if(!run||actInFlight.current)return null;
   actInFlight.current=true;
   const previousInterleavedRetries=interleavedRetries;
   if(action.kind==='rate'){
    const targetId=run.targetId;
    setInterleavedRetries(retries=>advanceInterleavedLearningRetries(retries,targetId,action.rating==='again'));
   }
   try{
    const result=await perform(()=>actLearning(crypto.randomUUID(),run.id,run.revision,action));
    if(!result&&action.kind==='rate')setInterleavedRetries(previousInterleavedRetries);
    return result;
   }finally{actInFlight.current=false;}
  },
  declareKnown:(id:string,active=true)=>perform(()=>setLocalDeclaredMastery(crypto.randomUUID(),id,active)),
  continueWith:(id:string,limit:number)=>run?perform(()=>continueLearning(crypto.randomUUID(),run.id,id,languageContext,limit)):Promise.resolve(null),
  finish:()=>run?perform(()=>finishLearning(crypto.randomUUID(),run.id)):Promise.resolve(null),
 };
}
