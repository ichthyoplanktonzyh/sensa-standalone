import {useMemo,useSyncExternalStore} from 'react';
import {worldReadRepository} from './worldRepository';
import {WorldWindowReader,WorldDetailReader,WorldSnapshotReader,type WorldDetailRead} from './worldReaders';
import type {WorldBrowseQuery,WorldLearningChoiceQuery,WorldLearningChoice} from './worldRead';
import {normalizeMeaningQuery} from './meaningLookupFacts';

const noSubscription=()=>()=>{};
export function useWorldInbox(enabled:boolean){
 // Every opening starts unverified: a detached snapshot must not flash stale
 // actions or a false empty state before its subscription checks storage.
 const reader=useMemo(()=>new WorldSnapshotReader({subscribe:worldReadRepository.subscribe,read:()=>worldReadRepository.inbox()}),[enabled]);
 const snapshot=useSyncExternalStore(enabled?reader.subscribe:noSubscription,reader.read);
 return {...snapshot,reload:reader.reload};
}
export function useWorldWindow(query:Pick<WorldBrowseQuery,'query'|'filter'|'expressionLanguages'|'referenceFilter'>,enabled:boolean){
 const normalized=normalizeMeaningQuery(query.query);
 const languages=JSON.stringify(query.expressionLanguages??[]);
 const reader=useMemo(()=>new WorldWindowReader<import('./worldRead').WorldBrowseItem,Pick<WorldBrowseQuery,'query'|'filter'|'expressionLanguages'|'referenceFilter'>>(worldReadRepository,{query:normalized,filter:query.filter,expressionLanguages:query.expressionLanguages,referenceFilter:query.referenceFilter}),[normalized,query.filter,languages,query.referenceFilter]);
 const snapshot=useSyncExternalStore(enabled?reader.subscribe:noSubscription,reader.read);
 return {...snapshot,request:reader.request,reload:reader.reload};
}
export function useWorldLearningChoices(query:Omit<WorldLearningChoiceQuery,'offset'|'limit'>,enabled:boolean){
 const normalized=normalizeMeaningQuery(query.query);
 const languages=JSON.stringify(query.expressionLanguages??[]);
 const reader=useMemo(()=>new WorldWindowReader<WorldLearningChoice,Omit<WorldLearningChoiceQuery,'offset'|'limit'>>({subscribe:worldReadRepository.subscribe,page:worldReadRepository.learningChoices},{query:normalized,filter:query.filter,targetLanguageTag:query.targetLanguageTag,expressionLanguages:query.expressionLanguages,referenceFilter:query.referenceFilter}),[normalized,query.filter,query.targetLanguageTag,languages,query.referenceFilter]);
 const snapshot=useSyncExternalStore(enabled?reader.subscribe:noSubscription,reader.read);
 return {...snapshot,request:reader.request,reload:reader.reload};
}
const details=new Map<string,WorldDetailReader>();
const empty:WorldDetailRead={value:null,status:{ok:true,error:null,errorKind:null,loading:false}};
const readEmpty=()=>empty;
export function useWorldDetail(id:string|null){
 const reader=useMemo(()=>{
  if(!id)return null;
  let current=details.get(id);
  if(!current){current=new WorldDetailReader(worldReadRepository,id,()=>{if(details.get(id)===current)details.delete(id);});details.set(id,current);}
  return current;
 },[id]);
 const snapshot=useSyncExternalStore(reader?.subscribe??noSubscription,reader?.read??readEmpty);
 return {...snapshot,reload:reader?.reload??(()=>{})};
}
