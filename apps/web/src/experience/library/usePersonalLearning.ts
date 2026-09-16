import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {useEffect,useRef,useState} from 'react';
import {personalLearningSnapshot,requestPersonalResourceUpdate,enrollPersonal,preparePersonal,stopPersonalPreparation,type PersonalLearning} from '../../data/library/personalLearning';
import {readLearning,type LocalLearningTarget} from '../../data/library/learning';
import {observeLibrary} from '../../data/library/store';
import {selectedProvider,selectedReviewProvider,type Provider} from '../../data/library/providers';
import {useLanguageRoutes} from './useLanguageRoutes';
import {journeyGateway} from '../personalMeaningJourney';
import {
 personalLearningSourceKey,
 type PersonalMeaningLearningSource,
} from '../../data/library/personalLearningSource';
export function usePersonalLearning(){
 useTranslation();
 const [tasks,setTasks]=useState<PersonalLearning[]>([]),[providers,setProviders]=useState<{content:Provider;review:Provider|null}|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[clock,setClock]=useState(Date.now());
 const [targets,setTargets]=useState<LocalLearningTarget[]>([]);
 const abort=useRef<AbortController|null>(null);
 const {context:languageContext}=useLanguageRoutes();
 const batchLock=useRef(false),batchStop=useRef(false);
 const [batch,setBatch]=useState<{id:string;status:'waiting'|'working'|'ready'|'failed';notice:string}[]>([]);
 const refresh=async()=>{setTargets((await readLearning()).targets);setTasks(await personalLearningSnapshot());const [content,review]=await Promise.all([selectedProvider('content'),selectedReviewProvider()]);setProviders({content,review});};
 useEffect(()=>{const read=()=>void refresh().catch(()=>setNotice(localFlowText('preparationReadFailed')));read();const stop=observeLibrary(read);const timer=setInterval(()=>setClock(Date.now()),1000);return()=>{stop();clearInterval(timer);batchStop.current=true;abort.current?.abort();};},[]);
 const perform=async<T,>(work:()=>Promise<T>)=>{if(batchLock.current)return null;setBusy(true);setNotice('');try{const result=await work();await refresh();return result;}catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:localFlowText('preparationPreserved'));return null;}finally{setBusy(false);}};
 const sourceForTask=(task:PersonalLearning)=>journeyGateway.getLearningSources(task.source.personalMeaningId,task.source.personalMeaningAlignmentId).find(source=>source.reference.bindingVersionId===task.source.bindingVersionId)??null;
 const prepare=async(id:string,source?:PersonalMeaningLearningSource)=>{if(!providers)throw new Error('localFlow.checkModels');const task=tasks.find(candidate=>candidate.id===id)??(await personalLearningSnapshot()).find(candidate=>candidate.id===id),current=source??(task?sourceForTask(task):null);if(!current)throw new Error('localFlow.meaningChanged');const controller=new AbortController();abort.current=controller;try{await preparePersonal(id,current,providers.content,providers.review,controller.signal,()=>void refresh());}finally{if(abort.current===controller)abort.current=null;}};
 const enrollBatch=async(sources:PersonalMeaningLearningSource[],useContext:boolean)=>{
  if(batchLock.current||busy)return;batchLock.current=true;batchStop.current=false;setBusy(true);setNotice('');
  const unique=[...new Map(sources.map(source=>[personalLearningSourceKey(source.reference),source])).values()];setBatch(unique.map(source=>({id:personalLearningSourceKey(source.reference),status:'waiting',notice:''})));
  const mark=(id:string,status:'waiting'|'working'|'ready'|'failed',notice='')=>setBatch(rows=>rows.map(r=>r.id===id?{id,status,notice}:r));
  const queued:{source:PersonalMeaningLearningSource;taskId:string}[]=[];
  try{
   // Persist every explicit learning intention before generating any material.
   for(const source of unique){if(batchStop.current)break;const id=personalLearningSourceKey(source.reference);try{const task=await enrollPersonal(crypto.randomUUID(),source,languageContext,useContext);queued.push({source,taskId:task.id});}catch(e){mark(id,'failed',e instanceof Error&&e.message.startsWith('localFlow.')?e.message:'localFlow.preparationPreserved');}}
   await refresh();
   for(const {source,taskId} of queued){
    if(batchStop.current)break;
    const sourceId=personalLearningSourceKey(source.reference);mark(sourceId,'working');
    try{
     let task=(await personalLearningSnapshot()).find(t=>t.id===taskId)!;
     if(task.status!=='ready'){
      if(task.languageContext.languageRouteRevision!==languageContext.languageRouteRevision||task.languageContext.supportLanguageTag!==languageContext.supportLanguageTag)await requestPersonalResourceUpdate(crypto.randomUUID(),task.id,source,languageContext,task.useContext);
      await prepare(taskId,source);task=(await personalLearningSnapshot()).find(t=>t.id===taskId)!;
     }
     mark(sourceId,task.status==='ready'?'ready':'failed',task.status==='ready'?'':task.notice);
    }catch(e){mark(sourceId,'failed',e instanceof Error&&e.message.startsWith('localFlow.')?e.message:'localFlow.preparationPreserved');}
   }
  }catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:'localFlow.preparationPreserved');}finally{batchLock.current=false;setBusy(false);await refresh().catch(()=>{});}
 };
 return {batch,enrollBatch,sourceForTask,stopBatch:()=>{batchStop.current=true;abort.current?.abort();},tasks,targets,providers,notice:localFlowNotice(notice),busy,clock,languageContext,
  enroll:(source:PersonalMeaningLearningSource,useContext:boolean)=>perform(async()=>{const task=await enrollPersonal(crypto.randomUUID(),source,languageContext,useContext);await refresh();if(task.status!=='ready')await prepare(task.id,source);}),
  update:(taskId:string,source:PersonalMeaningLearningSource,useContext:boolean)=>perform(async()=>{await requestPersonalResourceUpdate(crypto.randomUUID(),taskId,source,languageContext,useContext);await refresh();await prepare(taskId,source);}),
  prepare:(id:string)=>perform(()=>prepare(id)),
  stop:(id:string)=>{if(batchLock.current)batchStop.current=true;abort.current?.abort();void perform(()=>stopPersonalPreparation(crypto.randomUUID(),id));},
 };
}
