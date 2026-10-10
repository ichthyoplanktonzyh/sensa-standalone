import {test,expect} from 'vitest';
import {statisticsCalendar,statisticsTrend,statisticsCount} from '../../../apps/web/src/experience/learningJourney/statisticsCalendar';
import {learningHistoryPageFromRecords,type StoredLearningRecord} from '../../../apps/web/src/data/library/learningHistoryProjection';
import {learningHistoryWindow,type LearningHistoryRequest} from '../../../apps/web/src/learning/system/learningHistoryModel';
const base:LearningHistoryRequest={surface:'statistics',range:'year',year:2024,start:'',end:'',kind:'all',languageChoice:'all',activeLanguageTag:'en',clock:Date.parse('2024-12-31T23:59:59Z'),cursor:null,limit:1};
const row=(id:string,at:string,kind:StoredLearningRecord['kind']='initial_learning',languageTag='en'):StoredLearningRecord=>({recordId:id,targetId:'same-target',expression:'same',occurredAt:at,kind,languageTag});

test('calendar, trend, whole-range totals and record drilldown count the same unique completion identities across leap day and languages',()=>{
 const previous=process.env.TZ;process.env.TZ='UTC';try{
 const records=[row('a','2024-02-29T10:00:00Z'),row('a','2024-02-29T10:00:00Z'),row('b','2024-02-29T11:00:00Z','retention_review'),row('c','2024-03-01T10:00:00Z','relearning','fr'),row('old','2023-12-31T10:00:00Z'),row('future','2025-01-01T10:00:00Z')];
 const summary=learningHistoryPageFromRecords(records,base),calendar=statisticsCalendar(summary,2024),trend=statisticsTrend(summary);
 expect(summary.total).toBe(3);expect(summary.records).toHaveLength(1);expect(calendar).toHaveLength(366);expect(calendar.find(day=>day.day==='2024-02-29')!.total).toBe(2);expect(calendar.reduce((sum,day)=>sum+day.total,0)).toBe(3);expect(trend.rows).toHaveLength(12);expect(trend.rows.reduce((sum,row)=>sum+statisticsCount(row.counts),0)).toBe(3);
 const day=learningHistoryPageFromRecords(records,{...base,range:'custom',start:'2024-02-29',end:'2024-02-29',limit:20});expect(day.total).toBe(2);expect(day.records.map(row=>row.recordId)).toEqual(['b','a']);
 const filtered=learningHistoryPageFromRecords(records,{...base,languageChoice:'fr',kind:'relearning'});expect(statisticsCalendar(filtered,2024).reduce((sum,day)=>sum+day.total,0)).toBe(filtered.total);
 }finally{process.env.TZ=previous;}
});

test('local day boundaries include DST spring/fall and UTC date crossings without fixed 24-hour arithmetic',()=>{
 const previous=process.env.TZ;try{
 for(const [zone,date,hours] of [['America/New_York','2026-03-08',23],['America/New_York','2026-11-01',25],['Asia/Tokyo','2026-11-01',24],['Pacific/Kiritimati','2026-01-01',24]] as const){
 process.env.TZ=zone;const now=new Date(date+'T23:59:59'),request={...base,clock:now.getTime(),year:2026,range:'custom' as const,start:date,end:date},window=learningHistoryWindow(request);expect((window.until!-window.from!)/3600000).toBe(hours);
 const records=[row('before',new Date(window.from!-1).toISOString()),row('first',new Date(window.from!).toISOString()),row('last',new Date(window.until!-1).toISOString()),row('after',new Date(window.until!).toISOString())];
 request.clock=window.until!-1;const summary=learningHistoryPageFromRecords(records,request);expect(summary.total).toBe(2);expect(summary.days.every(row=>row.day===date)).toBe(true);expect(statisticsCalendar(summary,2026).find(day=>day.day===date)!.total).toBe(2);expect(statisticsTrend(summary).rows).toHaveLength(1);
 }
 }finally{process.env.TZ=previous;}
});

test('long-range trends remain bounded while retaining old years, zero days and exact totals',()=>{
 const previous=process.env.TZ;process.env.TZ='UTC';try{
 const records=Array.from({length:50},(_,i)=>row(String(i),`${1976+i}-01-01T12:00:00Z`));const summary=learningHistoryPageFromRecords(records,{...base,range:'all',clock:Date.parse('2026-01-31T23:59:59Z')});const trend=statisticsTrend(summary);expect(trend.rows.length).toBeLessThanOrEqual(24);expect(trend.rows.reduce((sum,row)=>sum+statisticsCount(row.counts),0)).toBe(50);
 const week=learningHistoryPageFromRecords([row('one','2026-01-30T12:00:00Z')],{...base,range:'week',clock:Date.parse('2026-01-31T23:59:59Z')});expect(statisticsTrend(week).rows).toHaveLength(7);expect(statisticsTrend(week).rows.filter(row=>statisticsCount(row.counts)===0)).toHaveLength(6);
 }finally{process.env.TZ=previous;}
});
