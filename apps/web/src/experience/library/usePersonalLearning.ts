import {backgroundPreparation} from '../../data/library/backgroundPreparation';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {learningSystem,type LearningTargetProjection} from '../../learning/system';
import {
 contentSupplySystem,
 personalLearningSourceKey,
 type PersonalContentProvisioningTask as ContentProvisioningTask,
 isPersonalProvisioningTask,
 type PersonalMeaningLearningSource,
} from '../../contentSupply/system';
import {useActiveLanguageContext} from './useActiveLanguageContext';
import {worldReadRepository} from '../personalMeaningJourney/worldRepository';
import {nextPersonalLearningLeaseExpiry} from './preparationSchedule';
import {settleOperation} from './operationSettlement';
import {createRefreshCoordinator} from './refreshCoordinator';
import {PersonalLearningBatch} from './personalLearningBatch';
import type {WorldLearningChoice} from '../personalMeaningJourney/worldRead';
export function usePersonalLearning(sourceView:{kind:'library'}|{kind:'target';targetId:string}|null=null,enabled=true,compactControl=false){
 useTranslation();
 const [tasks,setTasks]=useState<ContentProvisioningTask[]>([]),[preparationAvailable,setPreparationAvailable]=useState(false),[notice,setNotice]=useState(''),[operationBusy,setBusy]=useState(false),[clock,setClock]=useState(Date.now());
 const [targets,setTargets]=useState<readonly LearningTargetProjection[]>([]);
 const [taskSources,setTaskSources]=useState<ReadonlyMap<string,PersonalMeaningLearningSource>>(new Map());
 const batchRunner=useMemo(()=>new PersonalLearningBatch({
  resolve:choice=>worldReadRepository.resolveLearningChoice(choice),
  enroll:async(source,languageContext,useContext)=>(await learningSystem.execute({kind:'enroll_personal',operationId:crypto.randomUUID(),source,languageContext,useContext})).provisioningTaskId,
  task:taskId=>contentSupplySystem.read({kind:'provisioning_task',taskId}),
  revise:(taskId,source,languageContext,useContext)=>contentSupplySystem.execute({kind:'revise_provisioning',operationId:crypto.randomUUID(),taskId,source,languageContext,useContext}),
  prepare:(taskId,source)=>backgroundPreparation.run(taskId,signal=>contentSupplySystem.execute({kind:'prepare_materialization',taskId,source,signal})),
  cancel:taskId=>backgroundPreparation.cancel(taskId),
  stop:taskId=>contentSupplySystem.execute({kind:'stop_provisioning',operationId:crypto.randomUUID(),taskId}),
 }),[]);
 const batch=useSyncExternalStore(batchRunner.subscribe,batchRunner.read),busy=operationBusy||batch.busy;
 const languageContext=useActiveLanguageContext();
 const sourceViewKey=JSON.stringify([sourceView,enabled,compactControl]),routeKey=JSON.stringify([languageContext,sourceViewKey]),currentRoute=useRef(routeKey),readGeneration=useRef(0);
 currentRoute.current=routeKey;
 const [sourceReadKey,setSourceReadKey]=useState<string|null>(null);
 const [sourceFailureKey,setSourceFailureKey]=useState<string|null>(null);
 const latestRefresh=useRef<()=>Promise<void>>(async()=>{});
 const refresh=async()=>{
  // Batch events have their own bounded progress read. Do not re-read the
  // complete task/workspace projection after each of thousands of intentions.
  if(!enabled||batchRunner.read().busy)return;
  const generation=++readGeneration.current;
  try{
  const [supply,learning]=await Promise.all([contentSupplySystem.read({kind:'provisioning_control'}),compactControl?Promise.resolve({targets:[] as readonly LearningTargetProjection[]}):sourceView?.kind==='target'
   ?learningSystem.read({kind:'target',targetId:sourceView.targetId,languageContext,clock:Date.now()}).then(detail=>({targets:detail.target?[detail.target]:[]}))
   :learningSystem.read({kind:'workspace',languageContext,clock:Date.now()})]);
  const personalTasks=supply.tasks.filter(isPersonalProvisioningTask);
  const pendingTasks=personalTasks.filter(task=>sourceView&&task.languageContext.languageRouteId===languageContext.languageRouteId
    &&(sourceView.kind==='library'||task.targetId===sourceView.targetId)
    &&!learning.targets.some(target=>target.targetId===task.targetId));
  const sources=await Promise.all(pendingTasks.map(task=>contentSupplySystem.read({kind:'personal_provisioning_source',taskId:task.id})));
  if(batchRunner.read().busy||currentRoute.current!==routeKey||generation!==readGeneration.current)return;
  setTaskSources(new Map(sources.flatMap(source=>source?[[personalLearningSourceKey(source.reference),source] as const]:[])));
  setSourceReadKey(routeKey);
  setSourceFailureKey(null);
  setTargets(learning.targets);setTasks(personalTasks);setPreparationAvailable(supply.preparationAvailable);setClock(Date.now());
  for(const task of personalTasks)if(task.curriculumActive===false)backgroundPreparation.cancel(task.id);
  }catch(error){
   if(currentRoute.current===routeKey&&generation===readGeneration.current)failedSourceRead();
   throw error;
  }
 };
 const failedSourceRead=()=>{if(currentRoute.current===routeKey){setNotice(localFlowText('preparationReadFailed'));setSourceFailureKey(routeKey);setSourceReadKey(routeKey);setTaskSources(new Map());}};
 latestRefresh.current=()=>refresh().catch(()=>{});
 useEffect(()=>{if(!enabled)return;const coordinator=createRefreshCoordinator(refresh);const read=()=>void coordinator.request().catch(()=>{});read();const stopSupply=contentSupplySystem.subscribe({kind:'provisioning_control'},read);const stopLearning=learningSystem.subscribe({kind:'workspace',languageContext},read);const stopJourney=worldReadRepository.subscribe(read);const focus=()=>setClock(Date.now());window.addEventListener('focus',focus);return()=>{stopSupply();stopLearning();stopJourney();readGeneration.current++;window.removeEventListener('focus',focus);};},[languageContext.languageRouteId,languageContext.languageRouteRevision,sourceViewKey]);
 const nextLeaseExpiry=nextPersonalLearningLeaseExpiry(tasks,clock);
 useEffect(()=>{
  if(nextLeaseExpiry===null)return;
  const timer=window.setTimeout(()=>setClock(Date.now()),Math.min(2_147_483_647,Math.max(20,nextLeaseExpiry-Date.now()+20)));
  return()=>window.clearTimeout(timer);
 },[nextLeaseExpiry]);
 const perform=async<T,>(work:()=>Promise<T>)=>{if(batchRunner.read().busy)return null;setBusy(true);setNotice('');try{const outcome=await settleOperation(work,refresh);if(outcome.kind==='rejected'){const error=outcome.error;setNotice(error instanceof Error&&error.message.startsWith('localFlow.')?error.message:localFlowText('preparationPreserved'));return null;}if(outcome.projection==='stale')setNotice(localFlowText('preparationReadFailed'));return outcome.value;}finally{setBusy(false);}};
 const sourceForTask=(task:ContentProvisioningTask)=>taskSources.get(personalLearningSourceKey(task.source))??null;
 const prepare=async(id:string,source?:PersonalMeaningLearningSource)=>{if(!preparationAvailable)throw new Error('localFlow.checkModels');const current=source??await contentSupplySystem.read({kind:'personal_provisioning_source',taskId:id});if(!current)throw new Error('localFlow.meaningChanged');await backgroundPreparation.run(id,signal=>contentSupplySystem.execute({kind:'prepare_materialization',taskId:id,source:current,signal}));};
 const enrollBatch=async(choices:readonly WorldLearningChoice[],useContext:boolean)=>{
  if(busy||batchRunner.read().busy)return;setNotice('');
  try{await batchRunner.run(choices,languageContext,useContext);}
  catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:'localFlow.preparationPreserved');}
  finally{await latestRefresh.current();}
 };
 const retryBatch=async(status:'waiting'|'failed')=>{
  const saved=batchRunner.read();
  if(saved.context?.languageRouteId!==languageContext.languageRouteId||saved.context.targetLanguageTag!==languageContext.targetLanguageTag){setNotice('localFlow.routeMembershipMissing');return;}
  await enrollBatch(batchRunner.choices(status),saved.useContext);
 };
 const projectionStatus=sourceReadKey!==routeKey?'loading':sourceFailureKey===routeKey?'unavailable':'ready';
 return {batch,batchRowAt:batchRunner.rowAt,batchIndexForKey:batchRunner.indexForKey,retryBatch,enrollBatch,sourceForTask,projectionStatus,taskSourcesLoading:!!sourceView&&projectionStatus==='loading',taskSourcesUnavailable:!!sourceView&&projectionStatus==='unavailable',retryTaskSources:()=>{setSourceReadKey(null);setSourceFailureKey(null);void refresh().catch(()=>{});},stopBatch:()=>void batchRunner.stop(),tasks,targets,preparationAvailable,notice:localFlowNotice(notice),busy,clock,languageContext,
  enroll:(source:PersonalMeaningLearningSource,useContext:boolean)=>perform(async()=>{const enrollment=await learningSystem.execute({kind:'enroll_personal',operationId:crypto.randomUUID(),source,languageContext,useContext});if(enrollment.provisioningStatus!=='ready')await prepare(enrollment.provisioningTaskId,source);}),
  update:(taskId:string,source:PersonalMeaningLearningSource,useContext:boolean)=>perform(async()=>{const revised=await contentSupplySystem.execute({kind:'revise_provisioning',operationId:crypto.randomUUID(),taskId,source,languageContext,useContext});if(revised.status!=='covered')await prepare(taskId,source);}),
  prepare:(id:string)=>perform(()=>prepare(id)),
  restore:(task:ContentProvisioningTask)=>perform(()=>learningSystem.execute({kind:'change_supplemental_membership',operationId:crypto.randomUUID(),source:{kind:'personal_meaning_alignment',id:task.id},expectedRevision:task.curriculumRevision??0,active:true,languageContext})),
  stop:(taskId:string)=>{backgroundPreparation.cancel(taskId);void contentSupplySystem.execute({kind:'stop_provisioning',operationId:crypto.randomUUID(),taskId}).catch(()=>setNotice(localFlowText('preparationPreserved')));},
  exportPackage:(taskId:string)=>perform(()=>contentSupplySystem.execute({kind:'export_personal_portable_package',taskId})),
 };
}
