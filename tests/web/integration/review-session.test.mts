import {test,expect,vi} from 'vitest';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portablePackageFixture,portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {command,openLibrary,readLibrary,libraryTables} from '../../../apps/web/src/data/library/store';
import type {LocalLearningRun,LocalLearningTarget} from '../../../apps/web/src/learning/runtime/localProtocol';
import {executeLocalProtocolTransition,localRunSessionIntent} from '../../../apps/web/src/learning/runtime/localProtocol';
import {localExecutionForRun} from '../../../apps/web/src/learning/runtime/runtimeCoordinator';
import {localExecutableTargetForParticipant} from '../../../apps/web/src/learning/runtime/localCurriculum';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:{origin:'http://127.0.0.1:4319'}});
const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
const id=()=>crypto.randomUUID(),context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
const at='2026-09-01T08:00:00.000Z';
await openLibrary();
await command({id:id(),kind:'fixture.owner',input:{}},async tx=>tx.put('meta','service-owner',{subject:id(),accountId:id()}));
const enroll=async(expression:string)=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);
 try{
 const fixture=portablePackageFixture({packageId:id(),expression});
 const pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
 return (await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext:context}))[0]!;
 }finally{vi.useRealTimers();}
};
const runtime=()=>learningSystem.read({kind:'runtime',languageContext:context,clock:Date.parse(at)});
const act=async(action:{kind:'reveal'}|{kind:'rate';rating:'again'|'hard'|'good'},time:string)=>{
 const current=(await runtime()).runtime!;
 const command={kind:'act' as const,operationId:id(),runId:current.runId,expectedRevision:current.revision,action,at:time};
 await learningSystem.execute(command);
 return command;
};
const backupRows=()=>readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))) as BackupRows);

test('review-only switches away from a paused initial Run, retains its exact Step, and stops before new learning',async()=>{
 const retained=await enroll('fragile'),initial=await enroll('borrow');
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:20});
 await learningSystem.execute({kind:'start',operationId:id(),targetId:retained,languageContext:context,dailyLimit:20,at});
 await act({kind:'reveal'},at);await act({kind:'rate',rating:'good'},at);
 await learningSystem.execute({kind:'finish',operationId:id(),runId:(await runtime()).runtime!.runId});
 const due=await readLibrary(async tx=>(await tx.get<LocalLearningTarget>('learningTargets',retained))!.memory!.dueAt.toISOString());
 await learningSystem.execute({kind:'start',operationId:id(),targetId:initial,languageContext:context,dailyLimit:20,at});
 await act({kind:'reveal'},at);
 const paused=(await runtime()).runtime!;
 if(paused.kind!=='lightweight')throw new Error('Expected lightweight initial fixture');
 const home=await learningSystem.read({kind:'home',languageContext:context,clock:Date.parse(due)});
 expect(home.reviewDueCount).toBe(1);expect(home.nextReviewTargetId).toBe(retained);
 await learningSystem.execute({kind:'start',operationId:id(),targetId:retained,languageContext:context,dailyLimit:20,sessionIntent:'review_only',at:due});
 expect((await runtime()).runtime!.currentTargetId).toBe(retained);
 await act({kind:'reveal'},due);
 const rating=await act({kind:'rate',rating:'hard'},due);
 await learningSystem.execute(rating);
 await expect(learningSystem.execute({...rating,operationId:id()})).rejects.toThrow('localFlow.stepChanged');
 const complete=await runtime();
 expect(complete.runtime!.completed).toBe(true);expect(complete.nextTargetId).toBeNull();
 expect(await learningSystem.execute({kind:'advance',operationId:id(),runId:complete.runtime!.runId,languageContext:context,dailyLimit:20,at:due})).toBe(false);
 const state=await readLibrary(async tx=>({target:await tx.get<LocalLearningTarget>('learningTargets',retained),events:await tx.all<any>('learningEvents'),paused:await tx.get<LocalLearningRun>('learningRuns',paused.runId)}));
 expect(state.target!.memoryRevision).toBe(2);
 const outcomes=state.events.filter(event=>event.targetId===retained&&event.detail.transition.retention?.kind==='memory_outcome');
 expect(outcomes).toHaveLength(1);expect(outcomes[0].detail.transition.retention.outcome.grade).toBe('hard');
 expect(state.paused!.completedAt).toBeNull();
 const rows=await backupRows();rows.packageCache=[];
 expect(()=>validateBackupRows(rows)).not.toThrow();
 const tampered=structuredClone(rows);
 tampered.learningTargets.find(row=>row.key===retained)!.value.memoryRevision++;
 expect(()=>validateBackupRows(tampered)).toThrow('libraryBackup.errors.inconsistent');
 const changedGrade=structuredClone(rows);
 changedGrade.learningEvents.find(row=>row.key===rating.operationId)!.value.detail.transition.retention.outcome.grade='good';
 expect(()=>validateBackupRows(changedGrade)).toThrow('libraryBackup.errors.inconsistent');
 await learningSystem.execute({kind:'start',operationId:id(),targetId:initial,languageContext:context,dailyLimit:20,at:due});
 const resumed=(await runtime()).runtime!;
 if(resumed.kind!=='lightweight')throw new Error('Expected lightweight resumed fixture');
 expect(resumed.runId).toBe(paused.runId);expect(resumed.currentTargetId).toBe(initial);
 expect(resumed.phase).toBe(paused.phase);expect(resumed.step).toEqual(paused.step);
 const replica=await backupRows();replica.packageCache=[];replica.operations=[];validateBackupRows(replica);
 for(const patch of [{requestedLanguageContext:{...context,supportLanguageTag:'fr'}},{continuedFromRunId:paused.runId},{continuedFromRunId:id()},{continuedFromRunId:''},{continuedFromRunId:null},{continuedFromRunId:undefined}]){
  const changed=structuredClone(replica),run=changed.learningRuns.find(row=>row.key===paused.runId)!.value;
  Object.assign(run.lifecycleEvents.at(-1),patch);
  expect(()=>validateBackupRows(changed)).toThrow('libraryBackup.errors.inconsistent');
 }
 const reversed=structuredClone(replica),run=reversed.learningRuns.find(row=>row.key===paused.runId)!.value;
 Object.assign(run.lifecycleEvents.at(-1),{continuedFromRunId:complete.runtime!.runId,at});
 expect(()=>validateBackupRows(reversed)).toThrow('libraryBackup.errors.inconsistent');
});

test('Again creates one Review outcome and hands off a separate review-only Relearning Run, without another FSRS update',async()=>{
 for(const target of (await learningSystem.read({kind:'workspace',languageContext:context})).targets){
  await learningSystem.execute({kind:'set_declared_mastery',operationId:id(),targetId:target.targetId,active:true,languageContext:context,at:'2026-09-10T08:00:00.000Z'});
 }
 const retained=await enroll('sustain');
 await learningSystem.execute({kind:'start',operationId:id(),targetId:retained,languageContext:context,dailyLimit:20,at});
 await act({kind:'reveal'},at);await act({kind:'rate',rating:'good'},at);
 await learningSystem.execute({kind:'finish',operationId:id(),runId:(await runtime()).runtime!.runId});
 const due=await readLibrary(async tx=>(await tx.get<LocalLearningTarget>('learningTargets',retained))!.memory!.dueAt.toISOString());
 await learningSystem.execute({kind:'start',operationId:id(),targetId:retained,languageContext:context,dailyLimit:20,sessionIntent:'review_only',at:due});
 const reviewId=(await runtime()).runtime!.runId;
 await act({kind:'reveal'},due);const rating=await act({kind:'rate',rating:'again'},due);
 await learningSystem.execute(rating);
 const target=await readLibrary(async tx=>(await tx.get<LocalLearningTarget>('learningTargets',retained))!);
 expect(target.memoryRevision).toBe(2);expect(target.relearnAt).toBeTruthy();
 const repairedAt=target.relearnAt!;
 const next=await learningSystem.read({kind:'runtime',languageContext:context,clock:Date.parse(repairedAt)});
 expect(next.nextTargetId).toBe(retained);
 expect(await learningSystem.execute({kind:'advance',operationId:id(),runId:reviewId,languageContext:context,dailyLimit:20,at:repairedAt})).toBe(true);
 const repair=(await runtime()).runtime!;expect(repair.runId).not.toBe(reviewId);expect(repair.purpose).toBe('relearning');
 await act({kind:'reveal'},repairedAt);await act({kind:'rate',rating:'good'},repairedAt);
 const completed=(await runtime()).runtime!;
 expect(await learningSystem.execute({kind:'advance',operationId:id(),runId:completed.runId,languageContext:context,dailyLimit:20,at:repairedAt})).toBe(false);
 const rows=await backupRows(),finalTarget=rows.learningTargets.find(row=>row.key===retained)!.value as LocalLearningTarget;
 expect(finalTarget.memoryRevision).toBe(2);expect(finalTarget.memory).toEqual(target.memory);expect(finalTarget.relearnAt).toBeNull();
 const outcomes=rows.learningEvents.filter(row=>row.value.targetId===retained&&row.value.detail.transition.retention?.kind==='memory_outcome');
 expect(outcomes).toHaveLength(1);expect(outcomes[0]!.value.detail.transition.retention.outcome.grade).toBe('again');
 rows.packageCache=[];validateBackupRows(rows);
});

test('the public command boundary rejects future time and review-only initial work without writing facts',async()=>{
 const initial=await enroll('unintroduced');
 const before=await backupRows();
 await expect(learningSystem.execute({kind:'start',operationId:id(),targetId:initial,languageContext:context,dailyLimit:20,sessionIntent:'review_only',at})).rejects.toThrow('localFlow.notDue');
 await expect(learningSystem.execute({kind:'start',operationId:id(),targetId:initial,languageContext:context,dailyLimit:20,at:new Date(Date.now()+86400_000).toISOString()})).rejects.toThrow('localFlow.clockChanged');
 const after=await backupRows();
 expect(after.learningRuns).toEqual(before.learningRuns);expect(after.learningEvents).toEqual(before.learningEvents);expect(after.learningTargets).toEqual(before.learningTargets);
});

test('review-only quantity confirmation and Book enrollment do not advance new eligibility or consume new quota',async()=>{
 const workspace=await learningSystem.read({kind:'workspace',languageContext:context});
 const retained=workspace.targets.find(target=>target.presentation.expression==='sustain')!;
 await learningSystem.execute({kind:'start',operationId:id(),targetId:retained.targetId,languageContext:context,dailyLimit:20,sessionIntent:'review_only'});
 const before=await backupRows();
 const book=portableBookDeliveryFixture({packageId:id(),memberExpressions:['window-a','window-b','window-c']});
 const fetchBefore=globalThis.fetch;
 try{
  globalThis.fetch=async input=>new Response(Uint8Array.from(book.responses.get(String(input))!).buffer);
  await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:book.descriptor,signal:new AbortController().signal});
 }finally{globalThis.fetch=fetchBefore;}
 await learningSystem.execute({kind:'enroll_book',operationId:id(),languageContext:context,publicationArchiveSha256:book.descriptor.sha256});
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:40});
 await learningSystem.execute({kind:'prepare_queue',languageContext:context});
 const after=await backupRows();
 expect(after.learningTargets).toEqual(before.learningTargets);expect(after.learningRuns).toEqual(before.learningRuns);expect(after.learningEvents).toEqual(before.learningEvents);
 expect(after.curriculumEnrollments).toHaveLength(before.curriculumEnrollments.length+1);
 expect((await learningSystem.read({kind:'preferences',languageContext:context})).dailyLimit).toBe(40);
 expect((await learningSystem.read({kind:'runtime',languageContext:context})).dailyLimit).toBe(20);
});

test('a protocol adapter cannot change persisted Session intent or pinned language context',async()=>{
 const {run,target}=await readLibrary(async tx=>{const run=(await tx.get<LocalLearningRun>('learningRuns',(await tx.get<string>('meta','learning-active'))!))!;return {run,target:(await tx.get<LocalLearningTarget>('learningTargets',run.targetId))!};});
 const execution=localExecutionForRun(run),executable=localExecutableTargetForParticipant(target,run.participants[target.id]!);
 for(const mutate of [(changed:LocalLearningRun)=>{changed.sessionIntent='mixed';},(changed:LocalLearningRun)=>{changed.languageContext={...changed.languageContext,supportLanguageTag:'en'};}]){
  expect(()=>executeLocalProtocolTransition({execution:{...execution,unsafeTransition:(target,changed,resource,action,at)=>{const transition=execution.unsafeTransition(target,changed,resource,action,at);mutate(changed);return transition;}},target:executable,run,resource:undefined,action:{kind:'reveal'},at:new Date().toISOString()})).toThrow('Protocol adapter changed a pinned Run contract.');
 }
 expect((await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',run.id)))).toEqual(run);
});

test('explicit Mixed resume after a planning exclusion keeps the old Review Step and records the new Session intent',async()=>{
 const before=(await runtime()).runtime!;
 await learningSystem.execute({kind:'set_declared_mastery',operationId:id(),targetId:before.currentTargetId,active:true,languageContext:context});
 await learningSystem.execute({kind:'set_declared_mastery',operationId:id(),targetId:before.currentTargetId,active:false,languageContext:context});
 await learningSystem.execute({kind:'start',operationId:id(),targetId:before.currentTargetId,languageContext:context,dailyLimit:40,sessionIntent:'mixed'});
 const run=await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',before.runId));
 expect(localRunSessionIntent(run!)).toBe('mixed');expect((await runtime()).runtime!.runId).toBe(before.runId);
 const rows=await backupRows();rows.packageCache=[];validateBackupRows(rows);
});
