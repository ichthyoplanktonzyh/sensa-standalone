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
 const refresh=async()=>{setTargets((await readLearning()).targets);setTasks(await personalLearningSnapshot());const [content,review]=await Promise.all([selectedProvider('content'),selectedReviewProvider()]);setProviders({content,review});};
 useEffect(()=>{const read=()=>void refresh().catch(()=>setNotice(localFlowText('preparationReadFailed')));read();const stop=observeLibrary(read);const timer=setInterval(()=>setClock(Date.now()),1000);return()=>{stop();clearInterval(timer);abort.current?.abort();};},[]);
 const perform=async<T,>(work:()=>Promise<T>)=>{setBusy(true);setNotice('');try{const result=await work();await refresh();return result;}catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:localFlowText('preparationPreserved'));return null;}finally{setBusy(false);}};
 const prepare=async(id:string)=>{if(!providers)throw new Error('localFlow.checkModels');const controller=new AbortController();abort.current=controller;try{await preparePersonal(id,providers.content,providers.review,controller.signal,()=>void refresh());}finally{if(abort.current===controller)abort.current=null;}};
 return {tasks,targets,providers,notice:localFlowNotice(notice),busy,clock,
  enroll:(id:string,useContext:boolean)=>perform(async()=>{const task=await enrollPersonal(crypto.randomUUID(),id,useContext);await refresh();if(task.status!=='ready')await prepare(task.id);}),
  update:(id:string,useContext:boolean)=>perform(async()=>{await requestPersonalResourceUpdate(crypto.randomUUID(),id,useContext);await refresh();await prepare(id);}),
  prepare:(id:string)=>perform(()=>prepare(id)),
  stop:(id:string)=>{abort.current?.abort();void perform(()=>stopPersonalPreparation(crypto.randomUUID(),id));},
 };
}
