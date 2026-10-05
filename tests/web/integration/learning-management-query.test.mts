import {afterAll,test,expect,vi} from 'vitest';
import sqlite3InitModule,{type Database} from '@sqlite.org/sqlite-wasm';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {openLibrary,readLibrary} from '../../../apps/web/src/data/library/store';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import type {LocalLearningTarget} from '../../../apps/web/src/learning/runtime/localProtocol';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});
const database=await useNodeLearningCapacityStorage();
const raw=Reflect.get(database,'database') as Database;
afterAll(()=>database.close());
await openLibrary();
const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute),id=()=>crypto.randomUUID(),at='2026-09-01T08:00:00.000Z';
const runtime=async()=>{const projection=await learningSystem.read({kind:'runtime',languageContext:context,clock:Date.parse(at)});return projection.runtime!;};
const action=async(action:{kind:'reveal'}|{kind:'rate';rating:'again'|'good'},time=at)=>{
 const current=await runtime();return {kind:'act' as const,operationId:id(),runId:current.runId,expectedRevision:current.revision,action,at:time};
};
let targetId:string;

test('compact management matches actual completed records and rejects partial index writes without enumerating Target or Run payloads',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);
 const fixture=portablePackageFixture({packageId:id(),expression:'retain'});
 const pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
 targetId=(await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext:context}))[0]!;
 vi.useRealTimers();
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:20});
 await learningSystem.execute({kind:'start',operationId:id(),targetId,languageContext:context,dailyLimit:20,at});
 await learningSystem.execute(await action({kind:'reveal'}));
 await learningSystem.execute(await action({kind:'rate',rating:'again'}));
 const filter={surface:'study' as const,range:'all' as const,start:'',end:'',kind:'all' as const,languageChoice:null};
 expect((await learningSystem.read({kind:'history',languageContext:context,filter})).records).toEqual([]);
 await learningSystem.execute(await action({kind:'reveal'}));
 const grade=await action({kind:'rate',rating:'good'}),sourceBefore=database.entries('learningRuns');
 const targetsBefore=database.entries('learningTargets');
 raw.exec("CREATE TRIGGER reject_runtime_plan BEFORE INSERT ON sensa_runtime_learning_candidates BEGIN SELECT RAISE(ABORT,'fixture_plan_write_rejected'); END");
 try{
  await expect(learningSystem.execute(grade)).rejects.toThrow();
  expect(database.entries('learningTargets')).toEqual(targetsBefore);expect(database.entries('learningRuns')).toEqual(sourceBefore);
  expect(database.get('learningEvents',grade.operationId)).toBeNull();expect(database.get('operations',grade.operationId)).toBeNull();expect(database.learningHistoryProjection()).toEqual([]);
 }finally{raw.exec('DROP TRIGGER reject_runtime_plan');}
 raw.exec("CREATE TRIGGER reject_history BEFORE INSERT ON sensa_learning_history BEGIN SELECT RAISE(ABORT,'fixture_history_write_rejected'); END");
 try{
  await expect(learningSystem.execute(grade)).rejects.toThrow();
  expect(database.entries('learningRuns')).toEqual(sourceBefore);
  expect(database.get('learningEvents',grade.operationId)).toBeNull();
  expect(database.get('operations',grade.operationId)).toBeNull();
  expect(database.learningHistoryProjection()).toEqual([]);
 }finally{raw.exec('DROP TRIGGER reject_history');}
 await learningSystem.execute(grade);
 const first=await learningSystem.read({kind:'workspace',languageContext:context,clock:Date.parse(at)});
 expect(first.records).toHaveLength(1);
 await learningSystem.execute({kind:'finish',operationId:id(),runId:(await runtime()).runId});
 const due=await readLibrary(async tx=>(await tx.get<LocalLearningTarget>('learningTargets',targetId))!.memory!.dueAt.toISOString());
 await learningSystem.execute({kind:'start',operationId:id(),targetId,languageContext:context,dailyLimit:20,sessionIntent:'review_only',at:due});
 await learningSystem.execute(await action({kind:'reveal'},due));
 await learningSystem.execute(await action({kind:'rate',rating:'again'},due));
 // An Again Review is a real Review attempt; it is not initial completion or
 // Relearning success. Retain the same history semantics as the full view.
 expect(database.learningHistoryProjection().map(record=>record.kind).sort()).toEqual(['initial_learning','retention_review']);
 const repairAt=await readLibrary(async tx=>(await tx.get<LocalLearningTarget>('learningTargets',targetId))!.relearnAt!);
 await learningSystem.execute({kind:'advance',operationId:id(),runId:(await runtime()).runId,languageContext:context,dailyLimit:20,at:repairAt});
 await learningSystem.execute(await action({kind:'reveal'},repairAt));
 await learningSystem.execute(await action({kind:'rate',rating:'good'},repairAt));
 const expected=await learningSystem.read({kind:'workspace',languageContext:context,clock:Date.parse(repairAt)});
 expect(expected.records.map(record=>record.kind).sort()).toEqual(['initial_learning','relearning','retention_review']);
 const adapter=await sqliteRecordAdapter(),entries=adapter.entries.bind(adapter),page=adapter.entriesPage.bind(adapter),get=adapter.get.bind(adapter);
 const forbidden=new Set(['learningTargets','learningRuns','learningEvents','packageCache']);
 adapter.entries=async table=>{if(forbidden.has(table))throw new Error('management enumerated full facts');return entries(table);};
 adapter.entriesPage=async(table,after,limit)=>{if(forbidden.has(table))throw new Error('management paged full facts');return page(table,after,limit);};
 adapter.get=async(table,key)=>{if(forbidden.has(table))throw new Error('management hydrated full facts');return get(table,key);};
 try{
  const compact=await learningSystem.read({kind:'management',languageContext:context,clock:Date.parse(repairAt)});
  const historyPage=await learningSystem.read({kind:'history',languageContext:context,filter,clock:Date.parse(repairAt)});
  expect(historyPage.records).toEqual(expected.records);expect(historyPage.total).toBe(expected.records.length);expect(compact.targetIds).toEqual(expected.queue.activeTargetIds);
  expect(compact.reviewDueCount).toBe(expected.queue.dueTargetIds.length);expect(compact.readyInitialCount).toBe(expected.queue.initialReadyTargetIds.length);
  expect(compact.dailyLimit).toBe(expected.dailyLimit);expect(compact.policyOptions).toEqual(expected.policyOptions);
  const history=adapter.learningHistoryPage.bind(adapter),home=adapter.homeLearningProjection.bind(adapter);
  adapter.learningHistoryPage=async()=>{throw new Error('preferences read history');};adapter.homeLearningProjection=async()=>{throw new Error('management/preferences read Target collection');};
  try{expect(await learningSystem.read({kind:'preferences',languageContext:context})).toEqual({dailyLimit:expected.dailyLimit,policyOptions:expected.policyOptions});expect((await learningSystem.read({kind:'management',languageContext:context,clock:Date.parse(repairAt)})).targetIds).toEqual(expected.queue.activeTargetIds);}finally{adapter.learningHistoryPage=history;adapter.homeLearningProjection=home;}
 }finally{adapter.entries=entries;adapter.entriesPage=page;adapter.get=get;}
});

test('history presentation indexes rebuild from the same genuine facts, preserve source rows, and do not rewrite an unchanged open',()=>{
 const sources={targets:database.entries('learningTargets'),runs:database.entries('learningRuns'),events:database.entries('learningEvents')};
 const reopen=()=>new SqliteRecordDatabase(Reflect.get(database,'sqlite3'),raw,'memory').initialize();
 const expected=database.learningHistoryProjection();expect(expected).toHaveLength(3);
 raw.exec('DROP TABLE sensa_learning_history');reopen();
 expect(database.learningHistoryProjection()).toEqual(expected);
 raw.exec('DROP INDEX sensa_learning_history_date');reopen();
 expect(raw.exec({sql:"SELECT name FROM sqlite_schema WHERE name='sensa_learning_history_date'",rowMode:0,returnValue:'resultRows'})).toEqual(['sensa_learning_history_date']);
 expect(database.learningHistoryProjection()).toEqual(expected);
 expect({targets:database.entries('learningTargets'),runs:database.entries('learningRuns'),events:database.entries('learningEvents')}).toEqual(sources);
 const changes=raw.changes(true);reopen();expect(raw.changes(true)).toBe(changes);
 const query={languageContext:context,clock:Date.parse(at),dailyLimit:20,supportedPolicies:['lightweight'],currentTargetIds:[],retryTargetIds:[]};
 const candidates=database.runtimeLearningCandidates(query);
 raw.exec('DROP TABLE sensa_runtime_learning_candidates');reopen();
 expect(database.runtimeLearningCandidates(query)).toEqual(candidates);
 expect({targets:database.entries('learningTargets'),runs:database.entries('learningRuns'),events:database.entries('learningEvents')}).toEqual(sources);
 // A read error must not turn into a verified empty-history response.
 raw.exec('DROP TABLE sensa_learning_history');expect(()=>database.learningHistoryProjection()).toThrow();reopen();
 expect(database.learningHistoryProjection()).toEqual(expected);
});

test('fresh-device replica order admits Runs before Targets without losing genuine history summaries',async()=>{
 const sqlite=await sqlite3InitModule(),destination=new SqliteRecordDatabase(sqlite,new sqlite.oo1.DB(':memory:','c'),'memory');
 try{
  destination.initialize();
  const rows=[...database.entries('learningRuns').map(row=>({table:'learningRuns' as const,...row})),...database.entries('learningTargets').map(row=>({table:'learningTargets' as const,...row}))];
  destination.commit({clears:[],deletes:[],puts:rows});
  expect(destination.learningHistoryProjection()).toEqual(database.learningHistoryProjection());
  expect(destination.entries('learningRuns')).toEqual(database.entries('learningRuns'));expect(destination.entries('learningTargets')).toEqual(database.entries('learningTargets'));
 }finally{destination.close();}
});
