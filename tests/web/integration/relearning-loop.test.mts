import {afterAll,test,expect,vi} from 'vitest';
import type {Database} from '@sqlite.org/sqlite-wasm';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {openLibrary,readLibrary,libraryTables} from '../../../apps/web/src/data/library/store';
import type {LocalLearningTarget,LocalLearningRun} from '../../../apps/web/src/learning/runtime/localProtocol';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://relearning.fixture.invalid/')});
const database=await useNodeLearningCapacityStorage(),raw=Reflect.get(database,'database') as Database;
afterAll(()=>database.close());await openLibrary();
const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
const id=()=>crypto.randomUUID(),context=sensaPinnedLanguageContext(defaultSensaLanguageRoute),at='2026-09-01T08:00:00.000Z';
const snapshot=()=>readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)])))) as Promise<BackupRows>;
const runtime=async(clock:string)=>{const value=(await learningSystem.read({kind:'runtime',languageContext:context,clock:Date.parse(clock)})).runtime!;if(value.kind!=='lightweight')throw Error('Expected lightweight Run');return value;};
const action=async(clock:string,action:{kind:'reveal'}|{kind:'rate';rating:'again'|'good'})=>{const run=await runtime(clock);return {kind:'act' as const,operationId:id(),runId:run.runId,expectedRevision:run.revision,action,at:clock};};
let targetId:string,due:string,reviewMemory:LocalLearningTarget['memory'],reviewId:string,failedRepairId:string;

test('a repeated failure is durable Relearning progress, not completion or another Review outcome',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);
 try{
  const fixture=portablePackageFixture({packageId:id(),expression:'retain'});
  const pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
  targetId=(await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext:context}))[0]!;
 }finally{vi.useRealTimers();}
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:1});
 await learningSystem.execute({kind:'start',operationId:id(),targetId,languageContext:context,dailyLimit:1,at});
 await learningSystem.execute(await action(at,{kind:'reveal'}));await learningSystem.execute(await action(at,{kind:'rate',rating:'good'}));
 await learningSystem.execute({kind:'finish',operationId:id(),runId:(await runtime(at)).runId});
 due=await readLibrary(async tx=>(await tx.get<LocalLearningTarget>('learningTargets',targetId))!.memory!.dueAt.toISOString());
 await learningSystem.execute({kind:'start',operationId:id(),targetId,languageContext:context,dailyLimit:1,sessionIntent:'review_only',at:due});
 reviewId=(await runtime(due)).runId;
 await learningSystem.execute(await action(due,{kind:'reveal'}));await learningSystem.execute(await action(due,{kind:'rate',rating:'again'}));
 reviewMemory=await readLibrary(async tx=>(await tx.get<LocalLearningTarget>('learningTargets',targetId))!.memory);
 await learningSystem.execute({kind:'advance',operationId:id(),runId:reviewId,languageContext:context,dailyLimit:1,at:due});
 failedRepairId=(await runtime(due)).runId;expect(failedRepairId).not.toBe(reviewId);
 await learningSystem.execute(await action(due,{kind:'reveal'}));
 const again=await action(due,{kind:'rate',rating:'again'}),before=await snapshot();
 raw.exec(`CREATE TRIGGER reject_relearning_event BEFORE INSERT ON sensa_records WHEN NEW.table_name='learningEvents' AND NEW.record_key='${again.operationId}' BEGIN SELECT RAISE(ABORT,'fixture_relearning_write_failed'); END`);
 try{await expect(learningSystem.execute(again)).rejects.toThrow();expect(await snapshot()).toEqual(before);}finally{raw.exec('DROP TRIGGER reject_relearning_event');}
 await learningSystem.execute(again);const settled=await snapshot();await learningSystem.execute(again);expect(await snapshot()).toEqual(settled);
 const target=settled.learningTargets.find(row=>row.key===targetId)!.value as LocalLearningTarget;
 expect(target.memoryRevision).toBe(2);expect(target.memory).toEqual(reviewMemory);expect(target.relearnAt).toBe(due);
 const run=settled.learningRuns.find(row=>row.key===failedRepairId)!.value as LocalLearningRun;
 expect(run.completionKind).toBe('wait_relearning');expect(run.targetCompletions).toEqual({});
 expect(settled.learningEvents.filter(row=>row.value.detail.transition.retention?.kind==='memory_outcome')).toHaveLength(1);
 expect(database.learningHistoryProjection().map(record=>record.kind).sort()).toEqual(['initial_learning','retention_review']);
 const waiting=await runtime(due);expect(waiting.completed).toBe(true);expect(waiting.needsRelearning).toBe(true);
 settled.packageCache=[];settled.operations=[];validateBackupRows(settled);
});

test('an explicit same-target continuation retains review-only intent and completes without rescheduling its parent Review',async()=>{
 const retry={kind:'continue' as const,operationId:id(),runId:failedRepairId,targetId,languageContext:context,dailyLimit:1,at:due,requiredPurpose:'relearning' as const};
 await learningSystem.execute(retry);await learningSystem.execute(retry);
 const next=await runtime(due);expect(next.runId).not.toBe(failedRepairId);expect(next.purpose).toBe('relearning');expect(next.needsRelearning).toBe(false);
 const run=await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',next.runId));expect(run!.sessionIntent).toBe('review_only');expect(run!.continuedFromRunId).toBe(failedRepairId);
 await learningSystem.execute(await action(due,{kind:'reveal'}));await learningSystem.execute(await action(due,{kind:'rate',rating:'good'}));
 const complete=await runtime(due);expect(complete.completed).toBe(true);expect(complete.needsRelearning).toBe(false);
 const rows=await snapshot(),target=rows.learningTargets.find(row=>row.key===targetId)!.value as LocalLearningTarget;
 expect(target.memoryRevision).toBe(2);expect(target.memory).toEqual(reviewMemory);expect(target.relearnAt).toBeNull();
 expect(database.learningHistoryProjection().map(record=>record.kind).sort()).toEqual(['initial_learning','relearning','retention_review']);
 expect(rows.learningEvents.filter(row=>row.value.detail.transition.retention?.kind==='memory_outcome')).toHaveLength(1);
 const beforeReplay=await snapshot();await learningSystem.execute(retry);expect(await snapshot()).toEqual(beforeReplay);
 rows.packageCache=[];rows.operations=[];validateBackupRows(rows);
});

test('an old repair retry cannot reopen the already restored Target as another due Review',async()=>{
 const nextDue=await readLibrary(async tx=>(await tx.get<LocalLearningTarget>('learningTargets',targetId))!.memory!.dueAt.toISOString());
 const before=await snapshot();
 await expect(learningSystem.execute({kind:'continue',operationId:id(),runId:failedRepairId,targetId,languageContext:context,dailyLimit:1,at:nextDue,requiredPurpose:'relearning'})).rejects.toThrow('localFlow.stepChanged');
 expect(await snapshot()).toEqual(before);
});
