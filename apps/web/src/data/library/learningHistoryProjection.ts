import type {Database} from '@sqlite.org/sqlite-wasm';
import {decodeBackupValue} from './backupCodec';
import type {LocalLearningRun,LocalLearningTarget} from '../../learning/runtime/localProtocol';
import {localLastPresentedMaterial} from '../../learning/runtime/localCurriculum';
import {learningSupportMeaning} from '@sensa/contracts/sensa';
import {emptyLearningHistoryCounts,learningHistoryWindow,localLearningHistoryDay,type LearningHistoryKind,type LearningHistoryRequest,type LearningHistorySummary} from '../../learning/system/learningHistoryModel';
import {ensureSqliteSchemaIndexes} from './sqliteSchemaIndexes';

export interface StoredLearningRecord{recordId:string;targetId:string;expression:string;languageTag:string;meaning?:string;occurredAt:string;kind:'initial_learning'|'retention_review'|'relearning';}
export interface StoredLearningHistoryPage extends LearningHistorySummary{readonly records:readonly StoredLearningRecord[];}
const schema=`CREATE TABLE IF NOT EXISTS sensa_learning_history(record_key TEXT PRIMARY KEY NOT NULL,run_key TEXT NOT NULL,occurred_at INTEGER NOT NULL,language_tag TEXT NOT NULL,record_kind TEXT NOT NULL,projection_json TEXT NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_learning_history_date ON sensa_learning_history(occurred_at DESC,record_key);
CREATE INDEX IF NOT EXISTS sensa_learning_history_language ON sensa_learning_history(language_tag,occurred_at DESC,record_key);
CREATE INDEX IF NOT EXISTS sensa_learning_history_kind ON sensa_learning_history(record_kind,occurred_at DESC,record_key);
CREATE INDEX IF NOT EXISTS sensa_learning_history_scope ON sensa_learning_history(language_tag,record_kind,occurred_at DESC,record_key);
CREATE INDEX IF NOT EXISTS sensa_learning_history_run ON sensa_learning_history(run_key);
CREATE TABLE IF NOT EXISTS sensa_learning_history_meta(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL) WITHOUT ROWID;`;

/** Controlled in-memory adapter oracle; production performs these selections,
 * counts and calendar/language groups in SQLite without transferring all rows. */
export function learningHistoryPageFromRecords(records:readonly StoredLearningRecord[],request:LearningHistoryRequest):StoredLearningHistoryPage{
 if(request.runIds){const runs=new Set(request.runIds);records=records.filter(row=>runs.has(row.recordId.split(':')[0]!));}
 const window=learningHistoryWindow(request),languages=[...new Set(records.map(row=>row.languageTag))].sort();
 const languageScope=request.surface==='study'?'all':request.languageChoice??(languages.includes(request.activeLanguageTag)?request.activeLanguageTag:'all');
 const available=records.filter(row=>(languageScope==='all'||row.languageTag===languageScope)&&(window.availableAt===null||Date.parse(row.occurredAt)<=window.availableAt));
 const selected=window.invalidRange?[]:available.filter(row=>(window.from===null||Date.parse(row.occurredAt)>=window.from)&&(window.until===null||Date.parse(row.occurredAt)<window.until)&&(request.kind==='all'||row.kind===request.kind)).sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt)||(a.recordId<b.recordId?-1:a.recordId>b.recordId?1:0));
 const counts=emptyLearningHistoryCounts(),groups=new Map<string,{day:string;languageTag:string;counts:Record<LearningHistoryKind,number>}>(),breakdown=new Map(languages.map(tag=>[tag,emptyLearningHistoryCounts()]));
 for(const row of selected){counts[row.kind]++;breakdown.get(row.languageTag)![row.kind]++;const day=localLearningHistoryDay(new Date(row.occurredAt)),key=JSON.stringify([day,row.languageTag]),group=groups.get(key)??{day,languageTag:row.languageTag,counts:emptyLearningHistoryCounts()};group.counts[row.kind]++;groups.set(key,group);}
 const page=selected.filter(row=>!request.cursor||Date.parse(row.occurredAt)<request.cursor.occurredAt||Date.parse(row.occurredAt)===request.cursor.occurredAt&&row.recordId>request.cursor.recordId).slice(0,request.limit+1),more=page.length>request.limit;
 if(more)page.pop();const last=page.at(-1);
 return {records:page,total:selected.length,hasRecords:available.length>0,invalidRange:window.invalidRange,languages,languageScope,counts,days:[...groups.values()].sort((a,b)=>b.day.localeCompare(a.day)||a.languageTag.localeCompare(b.languageTag)),breakdown:languageScope==='all'?[...breakdown].map(([tag,counts])=>({tag,counts})):[],nextCursor:more&&last?{occurredAt:Date.parse(last.occurredAt),recordId:last.recordId,clock:request.clock}:null};
}

/** Rebuildable local presentation index, not learning authority or new facts. */
export class SqliteLearningHistoryProjection{
 constructor(private readonly database:Database,private readonly target:(id:string)=>LocalLearningTarget|undefined,private readonly decodeRun:(encoded:string)=>LocalLearningRun=encoded=>decodeBackupValue(JSON.parse(encoded)) as LocalLearningRun){
  database.createFunction({name:'sensa_learning_history_day',arity:1,innocuous:true,xFunc:(_context,at)=>localLearningHistoryDay(new Date(Number(at)))});
 }
 initialize(){
  const tables=this.database.exec({sql:"SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('sensa_learning_history','sensa_learning_history_meta')",rowMode:0,returnValue:'resultRows'}) as unknown[];
  if(tables.length===2){const version=this.database.exec({sql:"SELECT value FROM sensa_learning_history_meta WHERE key='format'",rowMode:0,returnValue:'resultRows'}) as unknown[];if(String(version[0])==='v3'){
   ensureSqliteSchemaIndexes(this.database,schema);return;
  }}
  // Only the device-local derived cache is replaced. Source facts, receipts,
  // media and the library revision are never rewritten by index rebuilding.
  this.database.exec('DROP TABLE IF EXISTS sensa_learning_history');this.database.exec(schema);this.clear();
  let after='';for(;;){const rows=this.database.exec({sql:"SELECT record_key,value_json FROM sensa_records WHERE table_name='learningRuns' AND record_key>? ORDER BY record_key LIMIT 64",bind:[after],rowMode:'object',returnValue:'resultRows'}) as {record_key:string;value_json:string}[];
   for(const row of rows)this.upsert(row.record_key,this.decodeRun(row.value_json));
   if(rows.length<64)break;after=rows.at(-1)!.record_key;
  }
  this.database.exec("INSERT INTO sensa_learning_history_meta(key,value) VALUES('format','v3') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
 }
 clear(){this.database.exec('DELETE FROM sensa_learning_history');}
 delete(runId:string){this.database.exec({sql:'DELETE FROM sensa_learning_history WHERE run_key=?',bind:[runId]});}
 upsert(runId:string,run:LocalLearningRun){
  this.delete(runId);
  if(!run.completedAt||run.completionKind==='wait_relearning'||!['initial_learning','retention_review','relearning'].includes(run.purpose)||!run.participants)return;
  for(const targetId of run.targetIds){
   const participant=run.participants[targetId],target=this.target(targetId);if(!participant||!target)continue;
   const material=localLastPresentedMaterial(participant),meaning=material?learningSupportMeaning(material.content.resources,participant.languageContext.supportLanguageTag):undefined;
   const row:StoredLearningRecord={recordId:`${run.id}:${targetId}`,targetId,expression:target.expression,languageTag:target.targetLanguageTag,...(typeof meaning==='string'?{meaning}:{}),occurredAt:run.targetCompletions?.[targetId]?.at??run.completedAt,kind:run.purpose};
   this.database.exec({sql:'INSERT INTO sensa_learning_history(record_key,run_key,occurred_at,language_tag,record_kind,projection_json) VALUES(?,?,?,?,?,?)',bind:[row.recordId,runId,Date.parse(row.occurredAt),row.languageTag,row.kind,JSON.stringify(row)]});
  }
 }
 records():StoredLearningRecord[]{const rows=this.database.exec({sql:'SELECT projection_json FROM sensa_learning_history ORDER BY occurred_at DESC,record_key',rowMode:0,returnValue:'resultRows'}) as unknown[];return rows.map(row=>JSON.parse(String(row)) as StoredLearningRecord);}
 page(request:LearningHistoryRequest):StoredLearningHistoryPage{
  const window=learningHistoryWindow(request),runCondition=request.runIds?' WHERE run_key IN (SELECT value FROM json_each(?))':'';
  const languages=(this.database.exec({sql:'SELECT DISTINCT language_tag FROM sensa_learning_history'+runCondition+' ORDER BY language_tag',bind:request.runIds?[JSON.stringify(request.runIds)]:[],rowMode:0,returnValue:'resultRows'}) as unknown[]).map(String);
  const languageScope=request.surface==='study'?'all':request.languageChoice??(languages.includes(request.activeLanguageTag)?request.activeLanguageTag:'all');
  const availableWhere:string[]=[],availableBind:(string|number)[]=[];
  if(request.runIds){availableWhere.push('run_key IN (SELECT value FROM json_each(?))');availableBind.push(JSON.stringify(request.runIds));}
  if(languageScope!=='all'){availableWhere.push('language_tag=?');availableBind.push(languageScope);}
  if(window.availableAt!==null){availableWhere.push('occurred_at<=?');availableBind.push(window.availableAt);}
  const count=(where:string[],bind:(string|number)[])=>Number((this.database.exec({sql:`SELECT COUNT(*) FROM sensa_learning_history${where.length?' WHERE '+where.join(' AND '):''}`,bind,rowMode:0,returnValue:'resultRows'}) as unknown[])[0]??0);
  const hasRecords=count(availableWhere,availableBind)>0,where=[...availableWhere],bind=[...availableBind];
  if(window.invalidRange)where.push('0');
  if(window.from!==null){where.push('occurred_at>=?');bind.push(window.from);}
  if(window.until!==null){where.push('occurred_at<?');bind.push(window.until);}
  if(request.kind!=='all'){where.push('record_kind=?');bind.push(request.kind);}
  const condition=where.length?' WHERE '+where.join(' AND '):'';
  const grouped=this.database.exec({sql:`SELECT sensa_learning_history_day(occurred_at) AS day,language_tag,record_kind,COUNT(*) AS total FROM sensa_learning_history${condition} GROUP BY day,language_tag,record_kind ORDER BY day DESC,language_tag,record_kind`,bind,rowMode:'object',returnValue:'resultRows'}) as {day:string;language_tag:string;record_kind:LearningHistoryKind;total:number}[];
  const counts=emptyLearningHistoryCounts(),days=new Map<string,{day:string;languageTag:string;counts:Record<LearningHistoryKind,number>}>(),breakdown=new Map<string,Record<LearningHistoryKind,number>>(languages.map(tag=>[tag,emptyLearningHistoryCounts()]));let total=0;
  for(const row of grouped){const value=Number(row.total);total+=value;counts[row.record_kind]+=value;breakdown.get(row.language_tag)![row.record_kind]+=value;const key=JSON.stringify([row.day,row.language_tag]),day=days.get(key)??{day:row.day,languageTag:row.language_tag,counts:emptyLearningHistoryCounts()};day.counts[row.record_kind]+=value;days.set(key,day);}
  const pageWhere=[...where],pageBind=[...bind];
  if(request.cursor){pageWhere.push('(occurred_at<? OR (occurred_at=? AND record_key>?))');pageBind.push(request.cursor.occurredAt,request.cursor.occurredAt,request.cursor.recordId);}
  const rows=this.database.exec({sql:`SELECT projection_json FROM sensa_learning_history${pageWhere.length?' WHERE '+pageWhere.join(' AND '):''} ORDER BY occurred_at DESC,record_key LIMIT ?`,bind:[...pageBind,request.limit+1],rowMode:0,returnValue:'resultRows'}) as unknown[];
  const more=rows.length>request.limit;if(more)rows.pop();const records=rows.map(row=>JSON.parse(String(row)) as StoredLearningRecord),last=records.at(-1);
  return {records,total,hasRecords,invalidRange:window.invalidRange,languages,languageScope,counts,days:[...days.values()],breakdown:languageScope==='all'?[...breakdown].map(([tag,counts])=>({tag,counts})):[],nextCursor:more&&last?{occurredAt:Date.parse(last.occurredAt),recordId:last.recordId,clock:request.clock}:null};
 }
}
