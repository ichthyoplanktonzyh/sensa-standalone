import {useEffect,useRef,useState} from 'react';
import {personalLearningSnapshot,enrollPersonal,preparePersonal,stopPersonalPreparation,type PersonalLearning} from '../../data/library/personalLearning';
import {observeLibrary} from '../../data/library/store';
import {selectedProvider,type Provider} from '../../data/library/providers';
export function usePersonalLearning(){
 const [tasks,setTasks]=useState<PersonalLearning[]>([]),[providers,setProviders]=useState<{content:Provider;review:Provider}|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[clock,setClock]=useState(Date.now());
 const abort=useRef<AbortController|null>(null);
 const refresh=async()=>{setTasks(await personalLearningSnapshot());const [content,review]=await Promise.all([selectedProvider('content'),selectedProvider('review')]);setProviders({content,review});};
 useEffect(()=>{const read=()=>void refresh().catch(()=>setNotice('无法读取学习准备状态，请重试。'));read();const stop=observeLibrary(read);const timer=setInterval(()=>setClock(Date.now()),1000);return()=>{stop();clearInterval(timer);abort.current?.abort();};},[]);
 const perform=async<T,>(work:()=>Promise<T>)=>{setBusy(true);setNotice('');try{const result=await work();await refresh();return result;}catch(e){setNotice(e instanceof Error&&/[\u4e00-\u9fff]/u.test(e.message)?e.message:'这次准备未完成，原内容仍然保留。');return null;}finally{setBusy(false);}};
 return {tasks,providers,notice,busy,clock,
  enroll:(id:string,useContext:boolean)=>perform(()=>enrollPersonal(crypto.randomUUID(),id,useContext)),
  prepare:(id:string)=>perform(async()=>{if(!providers)throw new Error('模型服务暂不可用，请检查账号与服务。');const controller=new AbortController();abort.current=controller;try{await preparePersonal(id,providers.content,providers.review,controller.signal,()=>void refresh());}finally{if(abort.current===controller)abort.current=null;}}),
  stop:(id:string)=>{abort.current?.abort();void perform(()=>stopPersonalPreparation(crypto.randomUUID(),id));},
 };
}
