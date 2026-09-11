import {listMeanings} from '../../data/library/teacher';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {useEffect,useRef,useState} from 'react';
import {personalLearningSnapshot,requestPersonalResourceUpdate,enrollPersonal,preparePersonal,stopPersonalPreparation,type PersonalLearning} from '../../data/library/personalLearning';
import {readLearning,type LocalLearningTarget} from '../../data/library/learning';
import {observeLibrary} from '../../data/library/store';
import {selectedProvider,selectedReviewProvider,type Provider} from '../../data/library/providers';
export function usePersonalLearning(){
 useTranslation();
 const [tasks,setTasks]=useState<PersonalLearning[]>([]),[providers,setProviders]=useState<{content:Provider;review:Provider|null}|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[clock,setClock]=useState(Date.now());
 const [targets,setTargets]=useState<LocalLearningTarget[]>([]);
 const abort=useRef<AbortController|null>(null);
 const batchLock=useRef(false),batchStop=useRef(false);
 const [batch,setBatch]=useState<{id:string;status:'waiting'|'working'|'ready'|'failed';notice:string}[]>([]);
 const refresh=async()=>{setTargets((await readLearning()).targets);setTasks(await personalLearningSnapshot());const [content,review]=await Promise.all([selectedProvider('content'),selectedReviewProvider()]);setProviders({content,review});};
 useEffect(()=>{const read=()=>void refresh().catch(()=>setNotice(localFlowText('preparationReadFailed')));read();const stop=observeLibrary(read);const timer=setInterval(()=>setClock(Date.now()),1000);return()=>{stop();clearInterval(timer);batchStop.current=true;abort.current?.abort();};},[]);
 const perform=async<T,>(work:()=>Promise<T>)=>{if(batchLock.current)return null;setBusy(true);setNotice('');try{const result=await work();await refresh();return result;}catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:localFlowText('preparationPreserved'));return null;}finally{setBusy(false);}};
 const prepare=async(id:string)=>{if(!providers)throw new Error('localFlow.checkModels');const controller=new AbortController();abort.current=controller;try{await preparePersonal(id,providers.content,providers.review,controller.signal,()=>void refresh());}finally{if(abort.current===controller)abort.current=null;}};
 const enrollBatch=async(ids:string[],useContext:boolean)=>{
  if(batchLock.current||busy)return;batchLock.current=true;batchStop.current=false;setBusy(true);setNotice('');
  const unique=[...new Set(ids)];setBatch(unique.map(id=>({id,status:'waiting',notice:''})));
  const mark=(id:string,status:'waiting'|'working'|'ready'|'failed',notice='')=>setBatch(rows=>rows.map(r=>r.id===id?{id,status,notice}:r));
  const queued:string[]=[];
  try{
   // Persist every explicit learning intention before generating any material.
   for(const id of unique){if(batchStop.current)break;try{await enrollPersonal(crypto.randomUUID(),id,useContext);queued.push(id);}catch(e){mark(id,'failed',e instanceof Error&&e.message.startsWith('localFlow.')?e.message:'localFlow.preparationPreserved');}}
   await refresh();
   for(const id of queued){
    if(batchStop.current)break;
    mark(id,'working');
    try{
     let task=(await personalLearningSnapshot()).find(t=>t.id===id)!;
     if(task.status!=='ready'){
      const meaning=(await listMeanings()).find(m=>m.id===id);
      if(meaning&&(meaning.contextRevision??1)!==(task.meaning.contextRevision??1))await requestPersonalResourceUpdate(crypto.randomUUID(),id,task.useContext);
      await prepare(id);task=(await personalLearningSnapshot()).find(t=>t.id===id)!;
     }
     mark(id,task.status==='ready'?'ready':'failed',task.status==='ready'?'':task.notice);
    }catch(e){mark(id,'failed',e instanceof Error&&e.message.startsWith('localFlow.')?e.message:'localFlow.preparationPreserved');}
   }
  }catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:'localFlow.preparationPreserved');}finally{batchLock.current=false;setBusy(false);await refresh().catch(()=>{});}
 };
 return {batch,enrollBatch,stopBatch:()=>{batchStop.current=true;abort.current?.abort();},tasks,targets,providers,notice:localFlowNotice(notice),busy,clock,
  enroll:(id:string,useContext:boolean)=>perform(async()=>{const task=await enrollPersonal(crypto.randomUUID(),id,useContext);await refresh();if(task.status!=='ready')await prepare(task.id);}),
  update:(id:string,useContext:boolean)=>perform(async()=>{await requestPersonalResourceUpdate(crypto.randomUUID(),id,useContext);await refresh();await prepare(id);}),
  prepare:(id:string)=>perform(()=>prepare(id)),
  stop:(id:string)=>{if(batchLock.current)batchStop.current=true;abort.current?.abort();void perform(()=>stopPersonalPreparation(crypto.randomUUID(),id));},
 };
}
