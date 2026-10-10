import type {SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {localLearningHistoryDay} from './learningHistoryModel';
export type LearningScheduleKind='retention_review'|'relearning';
export interface LearningScheduleQuery{
 readonly languageContext:SensaFormalPinnedLanguageContext;readonly clock:number;readonly days:7|30;
 readonly kind:'all'|LearningScheduleKind;readonly day:string|null;readonly offset:number;readonly limit:number;readonly supportedPolicies:readonly string[];
}
export interface LearningSchedulePage{
 readonly clock:number;readonly total:number;readonly fromDay:string;readonly throughDay:string;
 readonly days:readonly {day:string;retention_review:number;relearning:number}[];
 readonly targets:readonly {targetId:string;dueAt:number;kind:LearningScheduleKind}[];readonly nextOffset:number|null;
}
export interface LearningScheduleProjection extends Omit<LearningSchedulePage,'targets'>{readonly targets:readonly (LearningSchedulePage['targets'][number]&{expression:string})[];readonly version:string;}
/** A current schedule projection, never a promised future completion. Count the
 * next 7/30 local calendar days including the remainder of today; omit overdue
 * work. This query cannot change scheduler state or create initial due dates. */
export function learningScheduleWindow(query:LearningScheduleQuery){
 if(!Number.isFinite(query.clock)||![7,30].includes(query.days)||!['all','retention_review','relearning'].includes(query.kind)||!Number.isInteger(query.offset)||query.offset<0||!Number.isInteger(query.limit)||query.limit<1||query.limit>100)throw Error('localFlow.resourceInvalid');
 const now=new Date(query.clock),end=new Date(now.getFullYear(),now.getMonth(),now.getDate()+query.days),last=new Date(end);last.setDate(last.getDate()-1);
 const fromDay=localLearningHistoryDay(now),throughDay=localLearningHistoryDay(last);
 let from=query.clock,until=end.getTime();
 if(query.day){const day=new Date(query.day+'T00:00:00');if(localLearningHistoryDay(day)!==query.day||query.day<fromDay||query.day>throughDay)throw Error('localFlow.resourceInvalid');const next=new Date(day);next.setDate(next.getDate()+1);from=Math.max(from,day.getTime()-1);until=next.getTime();}
 return {from,until,fromDay,throughDay};
}
export function learningSchedulePageFromTargets(targets:LearningSchedulePage['targets'],query:LearningScheduleQuery):LearningSchedulePage{
 const window=learningScheduleWindow(query),selected=[...new Map(targets.map(target=>[target.targetId,target])).values()].filter(target=>target.dueAt>window.from&&target.dueAt<window.until&&(query.kind==='all'||target.kind===query.kind)).sort((a,b)=>a.dueAt-b.dueAt||a.targetId.localeCompare(b.targetId));
 const days=new Map<string,{day:string;retention_review:number;relearning:number}>();for(const target of selected){const day=localLearningHistoryDay(new Date(target.dueAt)),row=days.get(day)??{day,retention_review:0,relearning:0};row[target.kind]++;days.set(day,row);}
 const page=selected.slice(query.offset,query.offset+query.limit);
 return {clock:query.clock,total:selected.length,fromDay:window.fromDay,throughDay:window.throughDay,days:[...days.values()],targets:page,nextOffset:query.offset+page.length<selected.length?query.offset+page.length:null};
}
