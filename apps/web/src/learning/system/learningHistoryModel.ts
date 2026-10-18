export type LearningHistoryKind='initial_learning'|'retention_review'|'relearning';
export type LearningHistoryRange='today'|'week'|'month'|'year'|'all'|'custom';
export type LearningHistoryCounts=Readonly<Record<LearningHistoryKind,number>>;
/** A pagination chain retains its first read clock. A refresh without a cursor
 * observes a new clock; loading more cannot silently change the date window. */
export interface LearningHistoryCursor{readonly occurredAt:number;readonly recordId:string;readonly clock:number;}
export interface LearningHistoryFilter{
 readonly surface:'study'|'statistics';
 readonly range:LearningHistoryRange;
 readonly start:string;readonly end:string;
 readonly kind:'all'|LearningHistoryKind;
 readonly languageChoice:string|null;
 readonly year?:number;
}
export interface LearningHistoryRequest extends LearningHistoryFilter{
 readonly activeLanguageTag:string;readonly clock:number;
 readonly cursor:LearningHistoryCursor|null;readonly limit:number;
 /** Exact Runs belonging to one Session, selected through the history index. */
 readonly runIds?:readonly string[];
}
export interface LearningHistoryDay{readonly day:string;readonly languageTag:string;readonly counts:LearningHistoryCounts;}
export interface LearningHistorySummary{
 readonly clock:number;
 readonly fromDay:string|null;readonly throughDay:string|null;
 readonly total:number;readonly hasRecords:boolean;readonly invalidRange:boolean;
 readonly languages:readonly string[];readonly languageScope:string;
 readonly counts:LearningHistoryCounts;readonly days:readonly LearningHistoryDay[];
 readonly breakdown:readonly Readonly<{tag:string;counts:LearningHistoryCounts}>[];
 readonly nextCursor:LearningHistoryCursor|null;
}
export const emptyLearningHistoryCounts=():Record<LearningHistoryKind,number>=>({initial_learning:0,retention_review:0,relearning:0});
export const localLearningHistoryDay=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

/** Calendar ranges use the device's actual local days, including DST. Study
 * shows stored history; statistics excludes facts later than its read clock. */
export function learningHistoryWindow(request:LearningHistoryRequest){
 if(!Number.isFinite(request.clock)||!Number.isInteger(request.limit)||request.limit<1||request.limit>100)throw new Error('localFlow.resourceInvalid');
 if(request.runIds?.some(id=>typeof id!=='string'||!id.trim()))throw new Error('localFlow.resourceInvalid');
 if(request.cursor&&(!Number.isFinite(request.cursor.occurredAt)||!request.cursor.recordId.trim()||request.cursor.clock!==request.clock))throw new Error('localFlow.resourceInvalid');
 if(!['study','statistics'].includes(request.surface)||!['today','week','month','year','all','custom'].includes(request.range)||!['all','initial_learning','retention_review','relearning'].includes(request.kind))throw new Error('localFlow.resourceInvalid');
 if(request.surface==='study')return {from:null,until:null,availableAt:null,fromDay:null,throughDay:null,invalidRange:false} as const;
 const now=new Date(request.clock),today=localLearningHistoryDay(now),day=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 day.setDate(day.getDate()-(request.range==='week'?6:request.range==='month'?29:0));
 const year=request.year??now.getFullYear();
 if(request.range==='year'&&(!Number.isInteger(year)||year<100||year>9999))throw new Error('localFlow.resourceInvalid');
 const start=request.range==='custom'?request.start:request.range==='all'?'':request.range==='year'?`${year}-01-01`:localLearningHistoryDay(day),end=request.range==='custom'?request.end:request.range==='year'?`${year}-12-31`:today;
 const parse=(value:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/u.test(value))return null;const [year,month,date]=value.split('-').map(Number),parsed=new Date(year!,month!-1,date!);return localLearningHistoryDay(parsed)===value?parsed:null;};
 const from=start?parse(start):null,through=parse(end);
 const invalidRange=request.range==='custom'&&(!from||!through||start>end||end>today);
 if(through)through.setDate(through.getDate()+1);
 return {from:from?.getTime()??null,until:through?.getTime()??null,availableAt:request.clock,fromDay:start||null,throughDay:end||null,invalidRange};
}
