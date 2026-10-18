/** Scalar projection parity/complexity fixture, not manufactured learning
 * authority or genuine completion/restore evidence. Actual command-generated
 * history is covered separately by learning-management-query and Chromium. */
import {test,expect,afterAll} from 'vitest';
import type {Database} from '@sqlite.org/sqlite-wasm';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {learningHistoryPageFromRecords,type StoredLearningRecord} from '../../../apps/web/src/data/library/learningHistoryProjection';
import type {LearningHistoryRequest} from '../../../apps/web/src/learning/system/learningHistoryModel';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {openLibrary} from '../../../apps/web/src/data/library/store';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});
const database=await useNodeLearningCapacityStorage(),raw=Reflect.get(database,'database') as Database;
afterAll(()=>database.close());await openLibrary();
const records:StoredLearningRecord[]=[],kinds=['initial_learning','retention_review','relearning'] as const,context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
for(let index=0;index<30_000;index++)records.push({recordId:`record-${String(index).padStart(5,'0')}`,targetId:`target-${index}`,expression:`projection-${index}`,languageTag:index%2?'es':'en',kind:kinds[index%3]!,occurredAt:new Date(Date.UTC(2026,9,5)+(index%70)*86_400_000+(index%24)*3_600_000).toISOString()});
records.push({recordId:'dst-first',targetId:'dst-target',expression:'fall-back',languageTag:'en',kind:'retention_review',occurredAt:'2026-11-01T01:30:00-04:00'},{recordId:'dst-second',targetId:'dst-target',expression:'fall-back',languageTag:'en',kind:'retention_review',occurredAt:'2026-11-01T01:30:00-05:00'},{recordId:'future-only',targetId:'future-target',expression:'future',languageTag:'ja',kind:'initial_learning',occurredAt:'2029-01-01T00:00:00Z'});
raw.exec('BEGIN');try{for(const row of records)raw.exec({sql:'INSERT INTO sensa_learning_history(record_key,run_key,occurred_at,language_tag,record_kind,projection_json) VALUES(?,?,?,?,?,?)',bind:[row.recordId,`run-${row.recordId}`,Date.parse(row.occurredAt),row.languageTag,row.kind,JSON.stringify(row)]});raw.exec('COMMIT');}catch(error){raw.exec('ROLLBACK');throw error;}
const base:LearningHistoryRequest={surface:'statistics',range:'all',start:'',end:'',kind:'all',languageChoice:null,activeLanguageTag:'en',clock:Date.parse('2026-11-02T12:00:00Z'),cursor:null,limit:20};

test('bounded pages and whole-range aggregates agree with complete records across filters, future facts, exact language scope and DST',()=>{
 const previous=process.env.TZ;process.env.TZ='America/New_York';
 try{
  for(const request of [base,{...base,range:'year' as const,year:2026},{...base,range:'today' as const},{...base,range:'week' as const},{...base,range:'month' as const,kind:'retention_review' as const},{...base,range:'custom' as const,start:'2026-11-01',end:'2026-11-01',languageChoice:'all'},{...base,range:'custom' as const,start:'2026-02-30',end:'2026-11-01'},{...base,range:'custom' as const,start:'2026-11-03',end:'2026-11-02'},{...base,range:'custom' as const,start:'2026-11-01',end:'2026-11-03'},{...base,languageChoice:'es'},{...base,activeLanguageTag:'fr'},{...base,activeLanguageTag:'ja'},{...base,surface:'study' as const,kind:'initial_learning' as const}]){
   const expected=learningHistoryPageFromRecords(records,request),actual=database.learningHistoryPage(request);
   expect(actual).toEqual(expected);expect(actual.records.length).toBeLessThanOrEqual(request.limit);
   if(actual.nextCursor)expect(database.learningHistoryPage({...request,cursor:actual.nextCursor})).toEqual(learningHistoryPageFromRecords(records,{...request,cursor:actual.nextCursor}));
  }
  const dstRequest={...base,range:'custom' as const,start:'2026-11-01',end:'2026-11-01'},dstRows:StoredLearningRecord[]=[];
  let dst=database.learningHistoryPage(dstRequest);for(;;){dstRows.push(...dst.records);if(!dst.nextCursor)break;dst=database.learningHistoryPage({...dstRequest,cursor:dst.nextCursor});}
  expect(dstRows.filter(row=>row.recordId.startsWith('dst-'))).toHaveLength(2);expect(new Set(dstRows.map(row=>row.recordId)).size).toBe(dstRows.length);
  const full=database.learningHistoryPage({...base,languageChoice:'all'});
  expect(full.languages).toEqual(['en','es','ja']);expect(full.records.some(row=>row.recordId==='future-only')).toBe(false);
  expect(full.breakdown.find(row=>row.tag==='ja')!.counts).toEqual({initial_learning:0,retention_review:0,relearning:0});
  expect(full.days.every(row=>row.languageTag==='en'||row.languageTag==='es')).toBe(true);
  const study=database.learningHistoryPage({...base,surface:'study'});expect(study.total).toBe(records.length);expect(study.records[0]!.recordId).toBe('future-only');
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});

test('the public history projection decodes only a bounded list page; counts and groups do not inspect projection JSON or source facts',async()=>{
 const adapter=await sqliteRecordAdapter(),entries=adapter.entries.bind(adapter),entryPage=adapter.entriesPage.bind(adapter),get=adapter.get.bind(adapter),exec=raw.exec.bind(raw);let decoded=0;
 adapter.entries=async()=>{throw new Error('history enumerated source facts');};adapter.entriesPage=async()=>{throw new Error('history paged source facts');};
 adapter.get=async(table,key)=>{if(['learningTargets','learningRuns','learningEvents','packageCache'].includes(table))throw new Error('history hydrated source facts');return get(table,key);};
 raw.exec=((input:any)=>{const sql=typeof input==='string'?input:input.sql;if(/^SELECT projection_json/u.test(sql)){expect(sql).toContain('LIMIT ?');const result=exec(input) as unknown as unknown[];decoded+=result.length;expect(result.length).toBeLessThanOrEqual(21);return result;}if(/SELECT.*(?:value_json|projection_value_json)/isu.test(sql)&&!sql.includes('table_name=? AND record_key=?'))throw new Error('history scanned source JSON');return exec(input);}) as typeof raw.exec;
 try{
  const filter={surface:'statistics' as const,range:'all' as const,start:'',end:'',kind:'all' as const,languageChoice:'all'};
  const first=await learningSystem.read({kind:'history',languageContext:context,filter,clock:base.clock}),second=await learningSystem.read({kind:'history',languageContext:context,filter,clock:base.clock+86_400_000,cursor:first.nextCursor});
  expect(first.records).toHaveLength(20);expect(first.total).toBe(records.filter(row=>Date.parse(row.occurredAt)<=base.clock).length);expect(first.version).toBe(second.version);
  expect(second.total).toBe(first.total);expect(second.counts).toEqual(first.counts);expect(second.days).toEqual(first.days);expect(second.nextCursor!.clock).toBe(base.clock);
  expect(new Set([...first.records,...second.records].map(row=>row.recordId)).size).toBe(40);expect(decoded).toBe(42);
  await expect(learningSystem.read({kind:'history',languageContext:context,filter,limit:0})).rejects.toThrow();
 }finally{adapter.entries=entries;adapter.entriesPage=entryPage;adapter.get=get;raw.exec=exec;}
});


test('Session aggregates select only exact Run keys, preserve kinds and return true zero for an empty Session selection',()=>{
 const sessionRows:StoredLearningRecord[]=[
  {recordId:'session-a:target-a',targetId:'target-a',expression:'same',languageTag:'en',kind:'retention_review',occurredAt:'2026-10-10T12:00:00Z'},
  {recordId:'session-b:target-a',targetId:'target-a',expression:'same',languageTag:'en',kind:'relearning',occurredAt:'2026-10-10T12:01:00Z'},
 ];
 for(const row of sessionRows)raw.exec({sql:'INSERT INTO sensa_learning_history(record_key,run_key,occurred_at,language_tag,record_kind,projection_json) VALUES(?,?,?,?,?,?)',bind:[row.recordId,row.recordId.split(':')[0]!,Date.parse(row.occurredAt),row.languageTag,row.kind,JSON.stringify(row)]});
 for(const runIds of [['session-a','session-b'],['session-b'],[],['missing-session']]){
  const request={...base,surface:'study' as const,runIds,limit:1};
  expect(database.learningHistoryPage(request)).toEqual(learningHistoryPageFromRecords([...records,...sessionRows],request));
 }
 const actual=database.learningHistoryPage({...base,surface:'study',runIds:['session-a','session-b'],limit:1});
 expect(actual.total).toBe(2);expect(actual.counts).toEqual({initial_learning:0,retention_review:1,relearning:1});expect(actual.records).toHaveLength(1);
});
