import {useCallback,useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {WorldSnapshotReader,WorldWindowReader} from './personalMeaningJourney/worldReaders';
import {practiceMaterialsRepository,type PracticeMaterialSelection} from './practiceMaterials';
import type {PracticeExpression,PracticeExpressionQuery,PracticeMaterialSource} from '../data/library/practiceExpressionProjection';
import {previewStorage} from './services/previewStorage';
const key=(language:string)=>`sensa.practice.materials.v4:${language}`;
const emptySelection:PracticeMaterialSelection={source:'books',expressionIds:null};
export function readPracticeMaterialSelection(language:string):PracticeMaterialSelection|null{
 try{const value=JSON.parse(previewStorage.getItem(key(language))??'null');
  if(value&&['books','personal'].includes(value.source)&&(value.expressionIds===null||Array.isArray(value.expressionIds)&&value.expressionIds.every((id:unknown)=>typeof id==='string')))return value;
 }catch{/* A damaged device preference is not a material or learning fact. */}return null;
}
const noSubscription=()=>()=>{};
export function usePracticeMaterials(languageTag:string|null){
 const [chosen,setChosen]=useState<{language:string;selection:PracticeMaterialSelection}|null>(null);
 const selection=useMemo(()=>languageTag?(chosen?.language===languageTag?chosen.selection:readPracticeMaterialSelection(languageTag)??emptySelection):emptySelection,[languageTag,chosen]);
 const reader=useMemo(()=>new WorldSnapshotReader({subscribe:practiceMaterialsRepository.subscribe,read:async signal=>{
  const language=languageTag!;signal.throwIfAborted();
  let selected=selection;
  let page=await practiceMaterialsRepository.page({source:selected.source,languageTag:language,query:'',offset:0,limit:4,selectedIds:selected.expressionIds??undefined});signal.throwIfAborted();
  // Choose an available default only before the learner has saved a preference.
  if(chosen?.language!==language&&!readPracticeMaterialSelection(language)&&selected.source==='books'&&page.total===0){
   selected={source:'personal',expressionIds:null};page=await practiceMaterialsRepository.page({source:'personal',languageTag:language,query:'',offset:0,limit:4});signal.throwIfAborted();
  }
  return {selection:selected,page};
 }}),[languageTag,selection]);
 const snapshot=useSyncExternalStore(languageTag?reader.subscribe:noSubscription,reader.read);
 const ready=!!languageTag&&snapshot.status.ok&&!snapshot.status.loading;
 const resolved=ready?snapshot.value?.selection??selection:selection;
 const select=useCallback((next:PracticeMaterialSelection)=>{if(!languageTag)return;setChosen({language:languageTag,selection:next});try{previewStorage.setItem(key(languageTag),JSON.stringify(next));}catch{/* In-memory selection still works. */}},[languageTag]);
 useEffect(()=>{if(ready&&snapshot.value&&JSON.stringify(selection)!==JSON.stringify(snapshot.value.selection))setChosen({language:languageTag!,selection:snapshot.value.selection});},[ready,snapshot.value,selection,languageTag]);
 return {selection:resolved,preview:ready?snapshot.value?.page.items??[]:[],count:ready?snapshot.value?.page.total??0:null,
  availability:!languageTag||snapshot.status.loading?'loading' as const:!snapshot.status.ok?'unavailable' as const:'ready' as const,select,reload:reader.reload};
}
export function usePracticeExpressionWindow(source:PracticeMaterialSource,languageTag:string|null,query:string,enabled:boolean,selectedIds?:readonly string[]){
 const selectionKey=JSON.stringify(selectedIds??null);
 const reader=useMemo(()=>new WorldWindowReader<PracticeExpression,Pick<PracticeExpressionQuery,'source'|'languageTag'|'query'|'selectedIds'>>({subscribe:practiceMaterialsRepository.subscribe,page:input=>practiceMaterialsRepository.page(input)},
  {source,languageTag:languageTag??'',query,selectedIds}),[source,languageTag,query,selectionKey]);
 const snapshot=useSyncExternalStore(enabled&&languageTag?reader.subscribe:noSubscription,reader.read);
 return {...snapshot,request:reader.request,reload:reader.reload};
}
export function usePracticeExpressionCount(source:PracticeMaterialSource,languageTag:string|null,selectedIds?:readonly string[],excludedIds?:readonly string[]){
 const inputKey=JSON.stringify([selectedIds??null,excludedIds??null]);
 const reader=useMemo(()=>new WorldSnapshotReader({subscribe:practiceMaterialsRepository.subscribe,read:()=>practiceMaterialsRepository.page({source,languageTag:languageTag!,query:'',offset:0,limit:0,selectedIds,excludedIds})}),[source,languageTag,inputKey]);
 const snapshot=useSyncExternalStore(languageTag?reader.subscribe:noSubscription,reader.read);
 return {...snapshot,reload:reader.reload};
}
