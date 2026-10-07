import {useEffect,useState} from 'react';
import {personalContentSystem,type PersonalLearningScene} from '../../personalContent/system';

type SceneRead={key:string;scene:PersonalLearningScene|null;status:'loading'|'ready'|'error'};

/** One exact target×route read, independent of the global annotation list. */
export function usePersonalLearningScene(learningTargetId:string,languageRouteId:string){
 const key=learningTargetId+':'+languageRouteId;
 const [value,setValue]=useState<SceneRead>({key,scene:null,status:'loading'}),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let cancelled=false,generation=0;
  const load=()=>{
   const current=++generation;
   setValue(previous=>({key,scene:previous.key===key?previous.scene:null,status:'loading'}));
   void personalContentSystem.readScene({kind:'learning_scene',learningTargetId,languageRouteId}).then(scene=>{
    if(!cancelled&&current===generation)setValue({key,scene,status:'ready'});
   },()=>{if(!cancelled&&current===generation)setValue({key,scene:null,status:'error'});});
  };
  const stop=personalContentSystem.subscribe({kind:'snapshot'},load);load();
  return()=>{cancelled=true;stop();};
 },[learningTargetId,languageRouteId,attempt]);
 const current=value.key===key?value:{key,scene:null,status:'loading' as const};
 return {...current,retry:()=>setAttempt(value=>value+1)};
}
