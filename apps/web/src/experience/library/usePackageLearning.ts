import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {useEffect,useRef,useState} from 'react';
import {learningPackageCatalogSchema,type LearningPackageDescriptor} from '@sensa/contracts/sensa';
import {auth} from '../../data/consumer/client';
import {openLibrary,observeLibrary,readLibrary,command} from '../../data/library/store';
import {installedPackages,downloadPackage,installPackage,type InstalledPackage} from '../../data/library/packages';
import {localRunTargetIds,selectLocalLearningPolicy,setLocalDeclaredMastery,readLearning,enrollPackage,startLearning,actLearning,finishLearning,confirmLearningQuantity,type LocalLearningTarget,type LocalLearningRun} from '../../data/library/learning';
import type {LearningRecordView} from '../learningJourney/learningHistory';
import {inspectLocalTargetReadiness} from '../learningRuntime/runtimeCoordinator';
export function usePackageLearning(entryOpen:boolean){
 useTranslation();
 const [packages,setPackages]=useState<InstalledPackage[]>([]),[catalog,setCatalog]=useState<LearningPackageDescriptor[]>([]),[targets,setTargets]=useState<LocalLearningTarget[]>([]),[runs,setRuns]=useState<LocalLearningRun[]>([]),[activeId,setActiveId]=useState<string|undefined>();
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState<number|null>(null),[loaded,setLoaded]=useState(false),[catalogBusy,setCatalogBusy]=useState(false);
 const [dailyLimit,setDailyLimit]=useState<number|undefined>();
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{const tick=()=>setClock(Date.now());const timer=setInterval(tick,30000);window.addEventListener('focus',tick);return()=>{clearInterval(timer);window.removeEventListener('focus',tick);};},[]);
 const transfer=useRef<AbortController|null>(null),generation=useRef(0);
 const refresh=async()=>{const [p,l]=await Promise.all([installedPackages(),readLearning()]);setPackages(p);setTargets(l.targets);setRuns(l.runs);setActiveId(l.active);setDailyLimit(l.dailyLimit);setLoaded(true);};
 useEffect(()=>{void openLibrary().then(refresh).catch(()=>setNotice(localFlowText('learningReadFailed')));const stop=observeLibrary(()=>void refresh().catch(()=>setNotice(localFlowText('progressReadFailed'))));return()=>{generation.current++;stop();transfer.current?.abort();};},[]);
 const perform=async<T,>(work:()=>Promise<T>)=>{setBusy(true);setNotice('');try{const result=await work();await refresh();return result;}catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:localFlowText('retryOperation'));return null;}finally{setBusy(false);setProgress(null);}};
 const reloadCatalog=async(notify=false)=>{
  setCatalogBusy(true);
  const gen=++generation.current;
  let sessionTimer:ReturnType<typeof setTimeout>|undefined;
  try{const cached=await readLibrary(tx=>tx.get<LearningPackageDescriptor[]>('meta','package-catalog'));if(gen!==generation.current)return;setCatalog(cached??[]);
  const session=(await Promise.race([auth?.getSession(),new Promise<never>((_,reject)=>{sessionTimer=setTimeout(()=>reject(new Error('session unavailable')),3000);})]))?.data.session,endpoint=import.meta.env.VITE_SENSA_API_URL;if(!session||!endpoint)throw Error();
   const r=await fetch(endpoint.replace(/\/+$/u,'')+'/sensa/packages',{headers:{authorization:'Bearer '+session.access_token},signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error();const c=learningPackageCatalogSchema.parse(await r.json());
   if(gen!==generation.current||(await auth?.getSession())?.data.session?.user.id!==session.user.id)return;
   await command({id:crypto.randomUUID(),kind:'package.catalog',input:{items:c.items}},async tx=>{tx.put('meta','package-catalog',c.items);});if(gen===generation.current){setCatalog(c.items);setNotice(notify?localFlowText('catalogUpdated'):'');}
  }catch{if(gen===generation.current)setNotice(localFlowText('catalogFailed'));}finally{clearTimeout(sessionTimer);if(gen===generation.current)setCatalogBusy(false);}
 };
 useEffect(()=>{if(entryOpen)void reloadCatalog();},[entryOpen]);
 const run=runs.find(r=>r.id===activeId)??null;
 const records:LearningRecordView[]=runs.filter(r=>r.completedAt&&r.completionKind!=='wait_relearning').flatMap(r=>localRunTargetIds(r).map(targetId=>({recordId:r.id+':'+targetId,targetId,expression:targets.find(t=>t.id===targetId)?.expression??'',meaning:targets.find(t=>t.id===targetId)?.meaning,occurredAt:r.targetCompletions?.[targetId]?.at??r.completedAt!,kind:r.purpose,label:r.purpose==='initial_learning'?localFlowText('initialRecord'):r.purpose==='retention_review'?localFlowText('reviewRecord'):localFlowText('relearningRecord'),detail:localFlowText('localRecord')}))).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
 const readinessByTarget=Object.fromEntries(targets.map(target=>[target.id,inspectLocalTargetReadiness(target,target.packageKey?packages.find(pack=>pack.key===target.packageKey):undefined).status])) as Readonly<Record<string,'ready'|'blocked'>>;
 const due=targets.filter(t=>!t.declaredMastery&&readinessByTarget[t.id]==='ready').filter(t=>t.relearnAt?Date.parse(t.relearnAt)<=clock:t.memory&&t.memory.dueAt.getTime()<=clock);
 const startedToday=targets.filter(t=>t.startedAt&&new Date(t.startedAt).toDateString()===new Date(clock).toDateString()).length;
 const remaining=Math.max(0,(dailyLimit??20)-startedToday);
 const initialReady=[...targets.filter(t=>!t.declaredMastery&&!t.completedAt&&t.startedAt&&readinessByTarget[t.id]==='ready'),...targets.filter(t=>!t.declaredMastery&&!t.completedAt&&!t.startedAt&&readinessByTarget[t.id]==='ready').slice(0,remaining)];
 const nextTarget=[...due,...initialReady].find(t=>!run||!localRunTargetIds(run).includes(t.id));
 return {nextTarget,initialReady,readinessByTarget,packages,catalog,targets,runs,run,records,due,notice:localFlowNotice(notice),busy,progress,loaded,catalogBusy,reloadCatalog,refresh,dailyLimit,confirmQuantity:(n:number)=>perform(()=>confirmLearningQuantity(crypto.randomUUID(),n)),
  download:(d:LearningPackageDescriptor)=>perform(async()=>{const c=new AbortController();transfer.current=c;try{setProgress(0);return await downloadPackage(d,AbortSignal.any([c.signal,AbortSignal.timeout(120000)]),n=>setProgress(Math.round(100*n/d.byteLength)));}finally{if(transfer.current===c)transfer.current=null;}}),
  cancelDownload:()=>transfer.current?.abort(),importFile:(file:File)=>perform(async()=>{if(file.size>8*1024*1024)throw new Error('localFlow.packageTooLarge');return installPackage(new Uint8Array(await file.arrayBuffer()));}),
  selectPolicy:(targetId:string,profileId:Parameters<typeof selectLocalLearningPolicy>[2])=>perform(()=>selectLocalLearningPolicy(crypto.randomUUID(),targetId,profileId)),
  enroll:(key:string)=>perform(()=>enrollPackage(crypto.randomUUID(),key)),
  start:(id:string,limit:number)=>perform(()=>startLearning(crypto.randomUUID(),id,limit)),
  act:(action:Parameters<typeof actLearning>[3])=>run?perform(()=>actLearning(crypto.randomUUID(),run.id,run.revision,action)):Promise.resolve(null),
  declareKnown:(id:string,active=true)=>perform(()=>setLocalDeclaredMastery(crypto.randomUUID(),id,active)),
  finish:()=>run?perform(()=>finishLearning(crypto.randomUUID(),run.id)):Promise.resolve(null),
 };
}
