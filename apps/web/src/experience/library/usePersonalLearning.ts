import {backgroundPreparation} from '../../data/library/backgroundPreparation';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {useEffect,useRef,useState} from 'react';
import {learningSystem,type LearningTargetView,type PersonalLearningView} from '../../learning/system';
import {useLanguageRoutes} from './useLanguageRoutes';
import {journeyGateway} from '../personalMeaningJourney';
import {nextPersonalLearningLeaseExpiry} from './preparationSchedule';
import {
 personalLearningSourceKey,
 type PersonalMeaningLearningSource,
} from '../../data/library/personalLearningSource';
export function usePersonalLearning(){
 useTranslation();
 const [tasks,setTasks]=useState<PersonalLearningView[]>([]),[preparationAvailable,setPreparationAvailable]=useState(false),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[clock,setClock]=useState(Date.now());
 const [targets,setTargets]=useState<LearningTargetView[]>([]);
 const batchTaskIds=useRef<string[]>([]);
 const {context:languageContext}=useLanguageRoutes();
 const batchLock=useRef(false),batchStop=useRef(false);
 const [batch,setBatch]=useState<{id:string;status:'waiting'|'working'|'ready'|'failed';notice:string}[]>([]);
 const refresh=async()=>{const snapshot=await learningSystem.read({kind:'personal_control'});setTargets(snapshot.targets);setTasks(snapshot.tasks);setPreparationAvailable(snapshot.preparationAvailable);setClock(Date.now());};
 useEffect(()=>{const read=()=>void refresh().catch(()=>setNotice(localFlowText('preparationReadFailed')));read();const stopLearning=learningSystem.subscribe({kind:'personal_control'},read);const stopJourney=journeyGateway.subscribe(read);const focus=()=>setClock(Date.now());window.addEventListener('focus',focus);return()=>{stopLearning();stopJourney();window.removeEventListener('focus',focus);};},[]);
 const nextLeaseExpiry=nextPersonalLearningLeaseExpiry(tasks,clock);
 useEffect(()=>{
  if(nextLeaseExpiry===null)return;
  const timer=window.setTimeout(()=>setClock(Date.now()),Math.min(2_147_483_647,Math.max(20,nextLeaseExpiry-Date.now()+20)));
  return()=>window.clearTimeout(timer);
 },[nextLeaseExpiry]);
 const perform=async<T,>(work:()=>Promise<T>)=>{if(batchLock.current)return null;setBusy(true);setNotice('');try{const result=await work();await refresh();return result;}catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:localFlowText('preparationPreserved'));return null;}finally{setBusy(false);}};
 const sourceForTask=(task:PersonalLearningView)=>journeyGateway.getLearningSources(task.source.personalMeaningId,task.source.personalMeaningAlignmentId).find(source=>source.reference.bindingVersionId===task.source.bindingVersionId)??null;
 const prepare=async(id:string,source?:PersonalMeaningLearningSource)=>{if(!preparationAvailable)throw new Error('localFlow.checkModels');const task=tasks.find(candidate=>candidate.id===id)??(await learningSystem.read({kind:'personal_tasks'})).find(candidate=>candidate.id===id),current=source??(task?sourceForTask(task):null);if(!current)throw new Error('localFlow.meaningChanged');await backgroundPreparation.run(id,signal=>learningSystem.execute({kind:'prepare_personal',taskId:id,source:current,signal}));};
 const enrollBatch=async(sources:PersonalMeaningLearningSource[],useContext:boolean)=>{
  if(batchLock.current||busy)return;batchLock.current=true;batchStop.current=false;setBusy(true);setNotice('');
  const unique=[...new Map(sources.map(source=>[personalLearningSourceKey(source.reference),source])).values()];setBatch(unique.map(source=>({id:personalLearningSourceKey(source.reference),status:'waiting',notice:''})));
  const mark=(id:string,status:'waiting'|'working'|'ready'|'failed',notice='')=>setBatch(rows=>rows.map(r=>r.id===id?{id,status,notice}:r));
  const queued:{source:PersonalMeaningLearningSource;taskId:string}[]=[];
  try{
   // Persist every explicit learning intention before generating any material.
   for(const source of unique){if(batchStop.current)break;const id=personalLearningSourceKey(source.reference);try{const task=await learningSystem.execute({kind:'enroll_personal',operationId:crypto.randomUUID(),source,languageContext,useContext});queued.push({source,taskId:task.id});}catch(e){mark(id,'failed',e instanceof Error&&e.message.startsWith('localFlow.')?e.message:'localFlow.preparationPreserved');}}
   await refresh();
   batchTaskIds.current=queued.map(item=>item.taskId);
   await Promise.allSettled(queued.map(async({source,taskId})=>{
    if(batchStop.current)return;
    const sourceId=personalLearningSourceKey(source.reference);mark(sourceId,'working');
    try{
     let task=(await learningSystem.read({kind:'personal_tasks'})).find(t=>t.id===taskId)!;
     if(task.status!=='ready'){
      if(task.languageContext.languageRouteRevision!==languageContext.languageRouteRevision||task.languageContext.supportLanguageTag!==languageContext.supportLanguageTag)await learningSystem.execute({kind:'update_personal_resources',operationId:crypto.randomUUID(),taskId:task.id,source,languageContext,useContext:task.useContext});
      await prepare(taskId,source);task=(await learningSystem.read({kind:'personal_tasks'})).find(t=>t.id===taskId)!;
     }
     mark(sourceId,task.status==='ready'?'ready':'failed',task.status==='ready'?'':task.notice);
    }catch(e){mark(sourceId,'failed',e instanceof Error&&e.message.startsWith('localFlow.')?e.message:'localFlow.preparationPreserved');}
   }));
  }catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:'localFlow.preparationPreserved');}finally{batchLock.current=false;setBusy(false);await refresh().catch(()=>{});}
 };
 return {batch,enrollBatch,sourceForTask,stopBatch:()=>{batchStop.current=true;for(const id of batchTaskIds.current){backgroundPreparation.cancel(id);void learningSystem.execute({kind:'stop_personal_preparation',operationId:crypto.randomUUID(),taskId:id}).catch(()=>{});}},tasks,targets,preparationAvailable,notice:localFlowNotice(notice),busy,clock,languageContext,
  enroll:(source:PersonalMeaningLearningSource,useContext:boolean)=>perform(async()=>{const task=await learningSystem.execute({kind:'enroll_personal',operationId:crypto.randomUUID(),source,languageContext,useContext});await refresh();if(task.status!=='ready')await prepare(task.id,source);}),
  update:(taskId:string,source:PersonalMeaningLearningSource,useContext:boolean)=>perform(async()=>{await learningSystem.execute({kind:'update_personal_resources',operationId:crypto.randomUUID(),taskId,source,languageContext,useContext});await refresh();await prepare(taskId,source);}),
  prepare:(id:string)=>perform(()=>prepare(id)),
  stop:(taskId:string)=>{backgroundPreparation.cancel(taskId);void learningSystem.execute({kind:'stop_personal_preparation',operationId:crypto.randomUUID(),taskId}).catch(()=>setNotice(localFlowText('preparationPreserved')));},
 };
}
