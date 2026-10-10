import {emptyLearningHistoryCounts,localLearningHistoryDay,type LearningHistoryCounts,type LearningHistorySummary} from '../../learning/system/learningHistoryModel';

export const statisticsKinds=['initial_learning','retention_review','relearning'] as const;
export const statisticsCount=(counts:LearningHistoryCounts)=>statisticsKinds.reduce((sum,kind)=>sum+counts[kind],0);
/** The year is a bounded reading window over whole-range aggregates, not a
 * second history query or a sum of the rendered record prefix. Local setDate
 * preserves calendar days across 23/25-hour DST transitions. */
export function statisticsCalendar(summary:LearningHistorySummary,year:number){
 const grouped=new Map<string,ReturnType<typeof emptyLearningHistoryCounts>>();
 for(const row of summary.days){const counts=grouped.get(row.day)??emptyLearningHistoryCounts();for(const kind of statisticsKinds)counts[kind]+=row.counts[kind];grouped.set(row.day,counts);}
 const today=localLearningHistoryDay(new Date(summary.clock)),days=[];
 for(let date=new Date(year,0,1);date.getFullYear()===year;date.setDate(date.getDate()+1)){
  const day=localLearningHistoryDay(date),future=day>today,inRange=(!summary.fromDay||day>=summary.fromDay)&&(!summary.throughDay||day<=summary.throughDay);
  const counts=grouped.get(day)??emptyLearningHistoryCounts();
  days.push({day,month:date.getMonth(),date:date.getDate(),weekday:(date.getDay()+6)%7,counts,total:statisticsCount(counts),future,inRange});
 }
 return days;
}
/** Bounded calendar buckets include zero days/months. For long all-time ranges,
 * combine adjacent months into at most 24 labelled intervals without omitting
 * old records from the chart totals. */
export function statisticsTrend(summary:LearningHistorySummary){
 const today=localLearningHistoryDay(new Date(summary.clock));
 const first=summary.fromDay??summary.days.map(row=>row.day).sort()[0]??today,last=summary.throughDay&&summary.throughDay<today?summary.throughDay:today;
 const span=Math.round((Date.parse(last)-Date.parse(first))/86400000),daily=span<=30;
 const start=new Date(first+'T12:00:00'),end=new Date(last+'T12:00:00');
 const months=(end.getFullYear()-start.getFullYear())*12+end.getMonth()-start.getMonth()+1,size=Math.max(1,Math.ceil(months/24));
 const groups=new Map<string,{key:string;counts:ReturnType<typeof emptyLearningHistoryCounts>}>();
 const keyFor=(day:string)=>{if(daily)return day;const date=new Date(day+'T12:00:00'),offset=(date.getFullYear()-start.getFullYear())*12+date.getMonth()-start.getMonth(),bucket=Math.floor(offset/size)*size;
  const from=new Date(start.getFullYear(),start.getMonth()+bucket,1),through=new Date(start.getFullYear(),start.getMonth()+Math.min(bucket+size,months),0);
  const a=localLearningHistoryDay(from).slice(0,7),b=localLearningHistoryDay(through).slice(0,7);return a===b?a:a+'…'+b;
 };
 for(let date=new Date(start);date<=end;daily?date.setDate(date.getDate()+1):date.setMonth(date.getMonth()+size,1)){const key=keyFor(localLearningHistoryDay(date));groups.set(key,{key,counts:emptyLearningHistoryCounts()});}
 for(const row of summary.days){const key=keyFor(row.day),group=groups.get(key);if(!group)continue;for(const kind of statisticsKinds)group.counts[kind]+=row.counts[kind];}
 return {daily,rows:[...groups.values()],bounded:size>1};
}
