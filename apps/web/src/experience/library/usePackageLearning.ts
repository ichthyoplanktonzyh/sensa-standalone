import {useEffect,useRef,useState} from 'react';
import {learningPackageCatalogSchema,type LearningPackageDescriptor} from '@sensa/contracts/sensa';
import {auth} from '../../data/consumer/client';
import {openLibrary,observeLibrary,readLibrary,command} from '../../data/library/store';
import {installedPackages,downloadPackage,installPackage,type InstalledPackage} from '../../data/library/packages';
import {readLearning,enrollPackage,startLearning,actLearning,finishLearning,confirmLearningQuantity,type LocalLearningTarget,type LocalLearningRun} from '../../data/library/learning';
import type {LearningRecordView} from '../learningJourney/learningHistory';
export function usePackageLearning(entryOpen:boolean){
 const [packages,setPackages]=useState<InstalledPackage[]>([]),[catalog,setCatalog]=useState<LearningPackageDescriptor[]>([]),[targets,setTargets]=useState<LocalLearningTarget[]>([]),[runs,setRuns]=useState<LocalLearningRun[]>([]),[activeId,setActiveId]=useState<string|undefined>();
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState<number|null>(null),[loaded,setLoaded]=useState(false);
 const [dailyLimit,setDailyLimit]=useState<number|undefined>();
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{const tick=()=>setClock(Date.now());const timer=setInterval(tick,30000);window.addEventListener('focus',tick);return()=>{clearInterval(timer);window.removeEventListener('focus',tick);};},[]);
 const transfer=useRef<AbortController|null>(null),generation=useRef(0);
 const refresh=async()=>{const [p,l]=await Promise.all([installedPackages(),readLearning()]);setPackages(p);setTargets(l.targets);setRuns(l.runs);setActiveId(l.active);setDailyLimit(l.dailyLimit);setLoaded(true);};
 useEffect(()=>{void openLibrary().then(refresh).catch(()=>setNotice('无法读取本机学习资料，请重试。'));const stop=observeLibrary(()=>void refresh().catch(()=>setNotice('读取进度失败，已保存的资料仍保留。')));return()=>{generation.current++;stop();transfer.current?.abort();};},[]);
 const perform=async<T,>(work:()=>Promise<T>)=>{setBusy(true);setNotice('');try{const result=await work();await refresh();return result;}catch(e){setNotice(e instanceof Error&&/[\u4e00-\u9fff]/u.test(e.message)?e.message:'操作未完成，原资料仍保留，请重试。');return null;}finally{setBusy(false);setProgress(null);}};
 const reloadCatalog=async()=>{
  const gen=++generation.current;
  try{const cached=await readLibrary(tx=>tx.get<LearningPackageDescriptor[]>('meta','package-catalog'));if(gen!==generation.current)return;setCatalog(cached??[]);
  const session=(await auth?.getSession())?.data.session,endpoint=import.meta.env.VITE_SENSA_API_URL;if(!session||!endpoint)throw Error();
   const r=await fetch(endpoint.replace(/\/+$/u,'')+'/sensa/packages',{headers:{authorization:'Bearer '+session.access_token},signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error();const c=learningPackageCatalogSchema.parse(await r.json());
   if(gen!==generation.current||(await auth?.getSession())?.data.session?.user.id!==session.user.id)return;
   await command({id:crypto.randomUUID(),kind:'package.catalog',input:{items:c.items}},async tx=>{tx.put('meta','package-catalog',c.items);});if(gen===generation.current){setCatalog(c.items);setNotice('');}
  }catch{if(gen===generation.current)setNotice('暂时无法更新目录。已下载内容可继续使用；可以联网后重试。');}
 };
 useEffect(()=>{if(entryOpen)void reloadCatalog();},[entryOpen]);
 const run=runs.find(r=>r.id===activeId)??null;
 const records:LearningRecordView[]=runs.filter(r=>r.completedAt&&r.completionKind!=='wait_relearning').map(r=>({recordId:r.id,targetId:r.targetId,expression:targets.find(t=>t.id===r.targetId)?.expression??'',meaning:targets.find(t=>t.id===r.targetId)?.meaning,occurredAt:r.completedAt!,kind:r.purpose,label:r.purpose==='initial_learning'?'完成首次学习':r.purpose==='retention_review'?'完成复习':'完成再学习',detail:'本机学习记录'})).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
 const due=targets.filter(t=>t.relearnAt?Date.parse(t.relearnAt)<=clock:t.memory&&t.memory.dueAt.getTime()<=clock);
 const startedToday=targets.filter(t=>t.startedAt&&new Date(t.startedAt).toDateString()===new Date(clock).toDateString()).length;
 const remaining=Math.max(0,(dailyLimit??20)-startedToday);
 const initialReady=[...targets.filter(t=>!t.completedAt&&t.startedAt),...targets.filter(t=>!t.completedAt&&!t.startedAt).slice(0,remaining)];
 const nextTarget=[...due,...initialReady].find(t=>t.id!==run?.targetId);
 return {nextTarget,initialReady,packages,catalog,targets,runs,run,records,due,notice,busy,progress,loaded,reloadCatalog,refresh,dailyLimit,confirmQuantity:(n:number)=>perform(()=>confirmLearningQuantity(crypto.randomUUID(),n)),
  download:(d:LearningPackageDescriptor)=>perform(async()=>{const c=new AbortController();transfer.current=c;try{return await downloadPackage(d,AbortSignal.any([c.signal,AbortSignal.timeout(120000)]),n=>setProgress(Math.round(100*n/d.byteLength)));}finally{if(transfer.current===c)transfer.current=null;}}),
  cancelDownload:()=>transfer.current?.abort(),importFile:(file:File)=>perform(async()=>{if(file.size>8*1024*1024)throw new Error('学习包超过当前大小限制。');return installPackage(new Uint8Array(await file.arrayBuffer()));}),
  enroll:(key:string)=>perform(()=>enrollPackage(crypto.randomUUID(),key)),
  start:(id:string,limit:number)=>perform(()=>startLearning(crypto.randomUUID(),id,limit)),
  act:(action:Parameters<typeof actLearning>[3])=>run?perform(()=>actLearning(crypto.randomUUID(),run.id,run.revision,action)):Promise.resolve(null),
  finish:()=>run?perform(()=>finishLearning(crypto.randomUUID(),run.id)):Promise.resolve(null),
 };
}
