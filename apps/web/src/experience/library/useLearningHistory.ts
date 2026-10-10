import {useEffect,useRef,useState} from 'react';
import {learningSystem,type LearningHistoryProjection} from '../../learning/system';
import type {LearningHistoryFilter} from '../../learning/system/learningHistoryModel';
import {useActiveLanguageContext} from './useActiveLanguageContext';
import {createRefreshCoordinator} from './refreshCoordinator';

/** One coherent, bounded history page at a time. Summary counts belong to the
 * entire selected range, never to the list prefix currently rendered. */
export function useLearningHistory(filter:LearningHistoryFilter,active:boolean,desiredCount:number,clockToken?:number){
 const languageContext=useActiveLanguageContext(),key=JSON.stringify([languageContext,filter]),view=useRef({key,active,epoch:0});
 if(view.current.key!==key||view.current.active!==active)view.current={key,active,epoch:view.current.epoch+1};
 const epoch=view.current.epoch,generation=useRef(0),inFlight=useRef<number|null>(null),current=useRef<LearningHistoryProjection|null>(null);
 const [state,setState]=useState<{key:string;epoch:number;status:'loading'|'ready'|'unavailable';data:LearningHistoryProjection|null;busy:boolean}>(()=>({key,epoch,status:'loading',data:null,busy:false}));
 const refreshRef=useRef<()=>void>(()=>{});
 const valid=(token:number)=>view.current.epoch===epoch&&view.current.active&&token===generation.current;
 const read=async(append=false)=>{
  if(!active||view.current.epoch!==epoch)return;
  const previous=append?current.current:null;if(append&&(!previous?.nextCursor||inFlight.current!==null))return;
  const token=++generation.current;inFlight.current=token;
  setState(value=>({...value,key,epoch,status:append?'ready':'loading',busy:true}));
  try{
   const next=await learningSystem.read({kind:'history',languageContext,filter,clock:Date.now(),cursor:previous?.nextCursor??null,limit:filter.surface==='study'?10:20});
   if(!valid(token))return;
   if(previous&&previous.version!==next.version){inFlight.current=null;await read(false);return;}
   const data=previous?{...next,records:[...previous.records,...next.records.filter(row=>!previous.records.some(existing=>existing.recordId===row.recordId))]}:next;
   current.current=data;setState({key,epoch,status:'ready',data,busy:false});
  }catch{
   if(valid(token)){current.current=null;setState({key,epoch,status:'unavailable',data:null,busy:false});}
  }finally{if(inFlight.current===token)inFlight.current=null;}
 };
 useEffect(()=>{
  current.current=null;generation.current++;inFlight.current=null;
  if(!active)return;
  const coordinator=createRefreshCoordinator(async()=>{await read(false);});
  const refresh=()=>{generation.current++;setState({key,epoch,status:'loading',data:null,busy:true});void coordinator.request();};
  refreshRef.current=refresh;refresh();
  const stop=learningSystem.subscribe({kind:'history',languageContext,filter},refresh);
  return()=>{generation.current++;inFlight.current=null;stop();refreshRef.current=()=>{};};
 },[key,active]);
 const projection=active&&state.key===key&&state.epoch===epoch&&state.status==='ready'?state.data:null;
 const availability=state.key===key&&state.epoch===epoch?state.status:'loading';
 useEffect(()=>{if(projection&&projection.records.length<desiredCount&&projection.nextCursor&&!state.busy)void read(true);},[projection,desiredCount,state.busy]);
 const previousClock=useRef(clockToken);
 useEffect(()=>{if(previousClock.current===clockToken)return;previousClock.current=clockToken;if(active)refreshRef.current();},[clockToken,active]);
 return {projection,availability,busy:state.busy,retry:()=>refreshRef.current()};
}
