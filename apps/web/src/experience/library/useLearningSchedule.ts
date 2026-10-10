import {useEffect,useRef,useState} from 'react';
import {learningSystem} from '../../learning/system';
import {languageRoutesSnapshot} from '../../data/library/language';
import {observeLibrary} from '../../data/library/store';
import {createRefreshCoordinator} from './refreshCoordinator';
import type {LearningScheduleProjection} from '../../learning/system/learningScheduleModel';
import type {SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import type {LearningHistoryKind} from '../../learning/system/learningHistoryModel';
export function useLearningSchedule(input:{days:7|30;kind:'all'|LearningHistoryKind;languageScope:string;day:string|null;offset:number;clock:number},active:boolean){
 const key=JSON.stringify([input,active]),latest=useRef({key,active});latest.current={key,active};const generation=useRef(0),retry=useRef(()=>{});
 const [state,setState]=useState<{key:string;status:'loading'|'ready'|'unavailable';data:LearningScheduleProjection|null;context:SensaFormalPinnedLanguageContext|null;reason:'language'|'initial'|null}>({key,status:'loading',data:null,context:null,reason:null});
 useEffect(()=>{
  if(!active)return;let alive=true;
  const coordinator=createRefreshCoordinator(async()=>{
   const token=++generation.current;setState({key,status:'loading',data:null,context:null,reason:null});
   const valid=()=>alive&&latest.current.active&&latest.current.key===key&&token===generation.current;
   try{
    const {context}=await languageRoutesSnapshot();
    const reason=input.kind==='initial_learning'?'initial':input.languageScope!=='all'&&input.languageScope!==context.targetLanguageTag?'language':null;
    if(reason){if(valid())setState({key,status:'ready',data:null,context,reason});return;}
    const data=await learningSystem.read({kind:'schedule',languageContext:context,clock:input.clock,days:input.days,recordKind:input.kind as 'all'|'retention_review'|'relearning',day:input.day,offset:input.offset});
    if(valid())setState({key,status:'ready',data,context,reason:null});
   }catch{if(valid())setState({key,status:'unavailable',data:null,context:null,reason:null});}
  });
  const refresh=()=>{generation.current++;void coordinator.request();};retry.current=refresh;refresh();
  const stop=observeLibrary(refresh,['learningTargets','curriculumEnrollments','supplementalMembershipStates','packageCache','settings','meta']);
  return()=>{alive=false;generation.current++;stop();retry.current=()=>{};};
 },[key,active]);
 return {...(state.key===key?state:{key,status:'loading' as const,data:null,context:null,reason:null}),retry:()=>retry.current()};
}
