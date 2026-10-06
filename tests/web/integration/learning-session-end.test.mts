import {afterAll,afterEach,expect,test,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {openLibrary,readLibrary,libraryTables} from '../../../apps/web/src/data/library/store';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';
import type {LocalLearningRun,LocalLearningTarget} from '../../../apps/web/src/learning/runtime/localProtocol';
import type {LocalLearningSession,LocalStudyScope} from '../../../apps/web/src/data/library/studyScopes';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('https://session-end.fixture.invalid/')});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());await openLibrary();
afterEach(()=>vi.useRealTimers());
const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute),id=()=>randomUUID();
const rows=()=>readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))) as BackupRows);
const focus=()=>readLibrary(async tx=>{
 const sessionId=await tx.get<string>('meta','learning-session-active'),runId=await tx.get<string>('meta','learning-active');
 return {session:sessionId?await tx.get<LocalLearningSession>('learningSessions',sessionId):null,run:runId?await tx.get<LocalLearningRun>('learningRuns',runId):null};
});
const install=async(expressions:string[])=>{
 const fixture=portableBookDeliveryFixture({packageId:id(),memberExpressions:expressions}),fetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(new Uint8Array(fixture.bookBytes).buffer);
 try{await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:fixture.descriptor,signal:new AbortController().signal});}finally{globalThis.fetch=fetch;}
 await learningSystem.execute({kind:'enroll_book',operationId:id(),languageContext:context,publicationArchiveSha256:fixture.descriptor.sha256});
 return (await learningSystem.read({kind:'book_plans',languageContext:context})).find(book=>book.mode==='active')!;
};

test('explicit activity end is atomic and replayable without completion; later start captures the future arrangement and resumes the original material',async()=>{
 const clock=Date.parse('2026-10-06T00:00:00+08:00');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(clock);
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:20});
 const book=await install(['end-alpha','end-beta']);
 const alpha=(await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'))).find(target=>target.expression==='end-alpha')!;
 await learningSystem.execute({kind:'start',operationId:id(),targetId:alpha.id,languageContext:context,dailyLimit:20});
 const first=await focus();
 vi.setSystemTime(clock+10_000);
 await learningSystem.execute({kind:'act',operationId:id(),runId:first.run!.id,expectedRevision:first.run!.revision,action:{kind:'reveal'}});
 const original=await focus(),originalScope=await readLibrary(tx=>tx.get<LocalStudyScope>('studyScopes',original.session!.scopeRevisionId));
 expect(await readLibrary(tx=>tx.latestLearningActionAt(original.run!.id))).toBe(new Date(clock+10_000).toISOString());
 vi.setSystemTime(clock+20_000);
 await learningSystem.execute({kind:'change_book_plan',operationId:id(),enrollmentId:book.enrollmentId,expectedRevision:book.revision,languageContext:context,mode:'paused',selection:{kind:'all'}});
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:30});
 await install(['end-later']);
 const before=await rows();
 await expect(learningSystem.execute({kind:'end_session',operationId:id(),runId:original.run!.id,expectedRevision:first.run!.revision})).rejects.toThrow('localFlow.stepChanged');
 await expect(learningSystem.execute({kind:'end_session',operationId:id(),runId:original.run!.id,expectedRevision:original.run!.revision,at:new Date(Date.now()+60_000).toISOString()})).rejects.toThrow();
 await expect(learningSystem.execute({kind:'end_session',operationId:id(),runId:original.run!.id,expectedRevision:original.run!.revision,at:new Date(clock+5_000).toISOString()})).rejects.toThrow('localFlow.clockChanged');
 expect(await rows()).toEqual(before);
 const adapter=await sqliteRecordAdapter(),commit=adapter.commit.bind(adapter);let failed=false;
 adapter.commit=async mutation=>{if(!failed&&mutation.deletes.some(row=>row.table==='meta'&&row.key==='learning-active')){failed=true;throw Error('fixture end commit failed');}return commit(mutation);};
 try{await expect(learningSystem.execute({kind:'end_session',operationId:id(),runId:original.run!.id,expectedRevision:original.run!.revision})).rejects.toThrow('localFlow.storageWrite');}
 finally{adapter.commit=commit;}
 expect(failed).toBe(true);expect(await rows()).toEqual(before);
 const ending={kind:'end_session',operationId:id(),runId:original.run!.id,expectedRevision:original.run!.revision,at:new Date().toISOString()} as const;
 expect(await learningSystem.execute(ending)).toBe(true);
 const ended=await rows();expect(await focus()).toEqual({session:null,run:null});
 const home=await learningSystem.read({kind:'home',languageContext:context});expect(home.activeRunId).toBeNull();expect(home.dailyLimit).toBe(30);
 expect(ended.learningTargets).toEqual(before.learningTargets);expect(ended.studyScopes).toEqual(before.studyScopes);expect(ended.learningEvents).toEqual(before.learningEvents);
 const session=ended.learningSessions.find(row=>row.key===original.session!.id)!.value;
 expect(session).toEqual({...original.session,revision:original.session!.revision+1,activeRunId:null,endedAt:ending.at,endedByOperationId:ending.operationId,endReason:'learner_ended'});
 const run=ended.learningRuns.find(row=>row.key===original.run!.id)!.value as LocalLearningRun;
 expect(run).toEqual({...original.run,revision:original.run!.revision+1,lifecycleEvents:[...original.run!.lifecycleEvents,expect.objectContaining({kind:'paused_for_session_end',learningSessionId:original.session!.id,runRevision:original.run!.revision,operationId:ending.operationId,at:ending.at})]});
 expect(await learningSystem.execute(ending)).toBe(true);expect(await rows()).toEqual(ended);
 await expect(learningSystem.execute({...ending,operationId:id()})).rejects.toThrow('localFlow.stepChanged');
 await expect(learningSystem.execute({kind:'finish',operationId:id(),runId:run.id})).rejects.toThrow('localFlow.finishFirst');
 const cacheless=structuredClone(ended);cacheless.packageCache=[];cacheless.operations=[];expect(()=>validateBackupRows(cacheless)).not.toThrow();
 const backdated=structuredClone(cacheless),backdatedAt=new Date(clock+5_000).toISOString();
 backdated.learningRuns.find(row=>row.key===run.id)!.value.lifecycleEvents.at(-1).at=backdatedAt;backdated.learningSessions.find(row=>row.key===session.id)!.value.endedAt=backdatedAt;
 expect(()=>validateBackupRows(backdated)).toThrow();
 const forged=structuredClone(cacheless);forged.learningRuns.find(row=>row.key===run.id)!.value.lifecycleEvents.at(-1).learningSessionId=id();expect(()=>validateBackupRows(forged)).toThrow();
 const falseCompletion=structuredClone(cacheless);falseCompletion.learningSessions.find(row=>row.key===session.id)!.value.endReason='learner_finished';expect(()=>validateBackupRows(falseCompletion)).toThrow();
 await expect(learningSystem.execute({kind:'start',operationId:id(),targetId:alpha.id,languageContext:context,dailyLimit:30})).rejects.toThrow('localFlow.routeMembershipMissing');
 expect(await rows()).toEqual(ended);
 const paused=(await learningSystem.read({kind:'book_plans',languageContext:context})).find(plan=>plan.enrollmentId===book.enrollmentId)!;
 await learningSystem.execute({kind:'change_book_plan',operationId:id(),enrollmentId:paused.enrollmentId,expectedRevision:paused.revision,languageContext:context,mode:'active',selection:{kind:'ordinals',first:1,last:1}});
 const restart={kind:'start',operationId:id(),targetId:alpha.id,languageContext:context,dailyLimit:30,at:new Date().toISOString()} as const;
 await learningSystem.execute(restart);
 const resumed=await focus(),scope=await readLibrary(tx=>tx.get<LocalStudyScope>('studyScopes',resumed.session!.scopeRevisionId));
 expect(resumed.session!.id).not.toBe(original.session!.id);expect(resumed.session!.dailyNewSenseLimit).toBe(30);expect(scope!.members.map(member=>member.targetId)).toEqual([alpha.id]);
 expect(resumed.run!.id).toBe(run.id);expect(resumed.run!.learningSessionId).toBe(original.session!.id);expect(resumed.run!.studyScopeRevisionId).toBe(originalScope!.id);
 expect(resumed.run!.participants).toEqual(run.participants);expect(resumed.run!.protocolState).toEqual(run.protocolState);
 expect(resumed.run!.lifecycleEvents.at(-1)).toMatchObject({kind:'resumed_after_session_end',interruptionEventId:run.lifecycleEvents.at(-1)!.eventId});
 expect((await learningSystem.read({kind:'runtime',languageContext:context})).runtime!.completed).toBe(false);
 await learningSystem.execute({kind:'act',operationId:id(),runId:run.id,expectedRevision:resumed.run!.revision,action:{kind:'rate',rating:'good'}});
 const completed=await learningSystem.read({kind:'runtime',languageContext:context});expect(completed.nextTargetId).toBeNull();
 await learningSystem.execute({kind:'finish',operationId:id(),runId:run.id});
 // Resume receipt remains valid even after its Run completed in a later Session.
 expect(await learningSystem.execute(restart)).toBe(true);
 const final=await rows();final.packageCache=[];final.operations=[];expect(()=>validateBackupRows(final)).not.toThrow();
 expect((await readLibrary(tx=>tx.get<LocalLearningTarget>('learningTargets',alpha.id)))!.startedAt).toBe(alpha.startedAt??original.run!.startedAt);
});

test('concurrent end and Action against one reviewed revision settle only one intent',async()=>{
 const book=await install(['end-race']);
 expect(book.mode).toBe('active');
 const target=(await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'))).find(target=>target.expression==='end-race')!;
 await learningSystem.execute({kind:'start',operationId:id(),targetId:target.id,languageContext:context,dailyLimit:30});
 const {run}=await focus();
 const results=await Promise.allSettled([
  learningSystem.execute({kind:'end_session',operationId:id(),runId:run!.id,expectedRevision:run!.revision}),
  learningSystem.execute({kind:'act',operationId:id(),runId:run!.id,expectedRevision:run!.revision,action:{kind:'reveal'}}),
 ]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 const after=await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',run!.id));expect(after!.revision).toBe(run!.revision+1);expect(after!.completedAt).toBeNull();
 expect((await readLibrary(tx=>tx.get<LocalLearningTarget>('learningTargets',target.id)))!.memoryRevision).toBe(0);
 const current=await rows();current.packageCache=[];current.operations=[];expect(()=>validateBackupRows(current)).not.toThrow();
});
