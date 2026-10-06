import {afterAll,expect,test,vi} from 'vitest';
import type {Database} from '@sqlite.org/sqlite-wasm';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {openLibrary,readLibrary,libraryTables} from '../../../apps/web/src/data/library/store';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {readStudyPlans} from '../../../apps/web/src/data/library/studyPlans';
import {selectLocalLearningPolicy} from '../../../apps/web/src/data/library/learning';
import {LEARNING_PROTOCOL_PURPOSES,learningPolicyProfileRegistry} from '../../../apps/web/src/learning/runtime/policyProfiles';
import {inspectLocalTargetReadiness,inspectLocalTargetPurposeReadiness,learningRuntimeCoordinator} from '../../../apps/web/src/learning/runtime/runtimeCoordinator';
import type {LocalLearningTarget,LocalLearningRun} from '../../../apps/web/src/learning/runtime/localProtocol';
import type {LocalLearningSession,LocalStudyScope} from '../../../apps/web/src/data/library/studyScopes';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('https://session-queue.fixture.invalid/')});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());await openLibrary();
const raw=Reflect.get(database,'database') as Database,adapter=await sqliteRecordAdapter(),context=sensaPinnedLanguageContext(defaultSensaLanguageRoute),id=()=>crypto.randomUUID();
const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
const snapshot=()=>readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))) as BackupRows);
const state=()=>readLibrary(async tx=>{
 const sessionId=await tx.get<string>('meta','learning-session-active'),runId=await tx.get<string>('meta','learning-active');
 const session=sessionId?await tx.get<LocalLearningSession>('learningSessions',sessionId):null,run=runId?await tx.get<LocalLearningRun>('learningRuns',runId):null;
 return {session,run,originScope:session?await tx.get<LocalStudyScope>('studyScopes',session.scopeRevisionId):null,scope:run?.studyScopeRevisionId?await tx.get<LocalStudyScope>('studyScopes',run.studyScopeRevisionId):null};
});
const act=async(action:{kind:'reveal'}|{kind:'rate';rating:'good'})=>{
 const runtime=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
 await learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action});
};
const install=async(expressions:string[])=>{
 const fixture=portableBookDeliveryFixture({packageId:id(),memberExpressions:expressions}),fetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(new Uint8Array(fixture.bookBytes).buffer);
 try{await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:fixture.descriptor,signal:new AbortController().signal});}finally{globalThis.fetch=fetch;}
 await learningSystem.execute({kind:'enroll_book',operationId:id(),languageContext:context,publicationArchiveSha256:fixture.descriptor.sha256});
};

function readinessGuards(target:LocalLearningTarget){
 const membership=target.curriculumMemberships[0]!,oracle=()=>Object.fromEntries(LEARNING_PROTOCOL_PURPOSES.map(purpose=>[purpose,inspectLocalTargetReadiness(target,membership,undefined,purpose)]));
 const resolve=vi.spyOn(learningPolicyProfileRegistry,'resolve');
 try{expect(inspectLocalTargetPurposeReadiness(target,membership,undefined)).toEqual(oracle());resolve.mockClear();inspectLocalTargetPurposeReadiness(target,membership,undefined);expect(resolve).toHaveBeenCalledTimes(1);}finally{resolve.mockRestore();}
 const failed=vi.spyOn(learningPolicyProfileRegistry,'resolve').mockImplementation(()=>{throw Error('controlled_profile_failure');});
 try{expect(Object.values(inspectLocalTargetPurposeReadiness(target,membership,undefined)).every(value=>value.status==='blocked'&&value.reason==='controlled_profile_failure')).toBe(true);expect(failed).toHaveBeenCalledTimes(1);}finally{failed.mockRestore();}
 const corrupt=structuredClone(membership);corrupt.material.snapshot.contentDigest='0'.repeat(64);
 for(const source of [undefined,corrupt])expect(Object.values(inspectLocalTargetPurposeReadiness(target,source,undefined)).every(value=>value.status==='blocked')).toBe(true);
 const execution=learningRuntimeCoordinator.localExecutionForBinding.bind(learningRuntimeCoordinator),probe=vi.spyOn(learningRuntimeCoordinator,'localExecutionForBinding').mockImplementation((binding,purpose)=>{
  const adapter=execution(binding,purpose);return purpose==='retention_review'?{...adapter,validate:input=>{input.expression='mutated detached input';throw Error('controlled_review_requirement');}}:adapter;
 });
 try{const before=structuredClone(target),result=inspectLocalTargetPurposeReadiness(target,membership,undefined);expect(result.retention_review).toMatchObject({status:'blocked',reason:'controlled_review_requirement'});expect(result.initial_learning.status).toBe('ready');expect(result.relearning.status).toBe('ready');expect(target).toEqual(before);}finally{probe.mockRestore();}
}

test('dynamic future sources select per-Run scopes without collection capture, while the activity keeps its quota and saved work',async()=>{
 await install(['queue-alpha','queue-beta']);
 const targets=await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets')),alpha=targets.find(target=>target.expression==='queue-alpha')!,beta=targets.find(target=>target.expression==='queue-beta')!;
 readinessGuards(alpha);
 const ordered=[alpha,beta].sort((a,b)=>a.id.localeCompare(b.id));
 const fullHome=adapter.homeLearningProjection.bind(adapter);adapter.homeLearningProjection=async()=>{throw Error('Home enumerated the collection');};
 try{expect((await learningSystem.read({kind:'home',languageContext:context})).readyInitialCount).toBe(2);}finally{adapter.homeLearningProjection=fullHome;}
 const execution=learningRuntimeCoordinator.localExecutionForBinding.bind(learningRuntimeCoordinator),invalidCandidate=vi.spyOn(learningRuntimeCoordinator,'localExecutionForBinding').mockImplementation((binding,purpose)=>{
  const runner=execution(binding,purpose);return {...runner,validate:(input,resource)=>{if(input.expression===ordered[0]!.expression)throw Error('controlled_candidate_not_ready');runner.validate?.(input,resource);}};
 });
 const candidateQueries=vi.spyOn(adapter,'runtimeLearningCandidates');
 try{
  expect((await learningSystem.read({kind:'runtime',languageContext:context})).nextTargetId).toBe(ordered[1]!.id);
  expect(candidateQueries.mock.calls.some(([query])=>query.excludedTargetIds?.includes(ordered[0]!.id))).toBe(true);
 }finally{invalidCandidate.mockRestore();candidateQueries.mockRestore();}
 const before=await snapshot();expect(await readLibrary(readStudyPlans)).toEqual({});
 await expect(learningSystem.execute({kind:'start',operationId:id(),targetId:alpha.id,languageContext:context,dailyLimit:10})).rejects.toThrow('localFlow.confirmNewQuantity');
 const commit=adapter.commit.bind(adapter);let atomic=false;
 adapter.commit=async mutation=>{atomic=['settings','studyScopes','learningSessions','learningRuns'].every(table=>mutation.puts.some(row=>row.table===table));throw Error('controlled start write failure');};
 try{await expect(learningSystem.execute({kind:'start',operationId:id(),targetId:alpha.id,languageContext:context,dailyLimit:20})).rejects.toThrow('localFlow.storageWrite');}finally{adapter.commit=commit;}
 expect(atomic).toBe(true);expect(await snapshot()).toEqual(before);
 const body=raw.exec({sql:"SELECT body.digest,body.value_json FROM sensa_shared_record_content_owners AS owner JOIN sensa_shared_record_content AS body ON body.digest=owner.digest WHERE owner.owner_kind='record' AND owner.table_name='learningTargets' AND owner.record_key=? LIMIT 1",bind:[beta.id],rowMode:'object',returnValue:'resultRows'}) as {digest:string;value_json:string}[];
 expect(body).toHaveLength(1);raw.exec({sql:'UPDATE sensa_shared_record_content SET value_json=? WHERE digest=?',bind:['["string","bad unrelated material"]',body[0]!.digest]});
 const entries=adapter.entries.bind(adapter),page=adapter.entriesPage.bind(adapter),collections=new Set(['learningTargets','studyScopes','curriculumEnrollments','supplementalMembershipStates']);
 adapter.entries=async table=>{if(collections.has(table))throw Error('start enumerated '+table);return entries(table);};
 adapter.entriesPage=async(table,key,limit)=>{if(collections.has(table))throw Error('start paged '+table);return page(table,key,limit);};
 try{await learningSystem.execute({kind:'start',operationId:id(),targetId:alpha.id,languageContext:context,dailyLimit:20});}
 finally{adapter.entries=entries;adapter.entriesPage=page;raw.exec({sql:'UPDATE sensa_shared_record_content SET value_json=? WHERE digest=?',bind:[body[0]!.value_json,body[0]!.digest]});}
 const original=await state();expect(original.scope!.members.map(member=>member.targetId)).toEqual([alpha.id]);expect(original.session!.dailyNewSenseLimit).toBe(20);
 expect(original.run!.studyScopeRevisionId).toBe(original.scope!.id);
 await expect(selectLocalLearningPolicy(id(),alpha.id,context,'interleaved_four_stage')).rejects.toThrow('localFlow.stepChanged');
 // Unstarted candidates are not frozen, but unsupported resources still fail.
 await expect(selectLocalLearningPolicy(id(),beta.id,context,'interleaved_four_stage')).rejects.toThrow('localFlow.resourceInvalid');
 let first=(await learningSystem.read({kind:'book_plans',languageContext:context}))[0]!;
 await learningSystem.execute({kind:'change_book_plan',operationId:id(),enrollmentId:first.enrollmentId,expectedRevision:first.revision,languageContext:context,mode:'paused',selection:{kind:'ordinals',first:2,last:2}});
 expect(await state()).toEqual(original);expect((await learningSystem.read({kind:'management',languageContext:context})).readyInitialCount).toBe(0);
 await install(['queue-gamma']);
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:5});
 expect((await learningSystem.read({kind:'home',languageContext:context})).dailyLimit).toBe(20);
 expect(await learningSystem.read({kind:'runtime',languageContext:context})).toMatchObject({dailyLimit:20,preferencesDailyLimit:5});
 expect(await state()).toEqual(original);
 await act({kind:'reveal'});await act({kind:'rate',rating:'good'});
 const completed=await state();
 expect(await learningSystem.execute({kind:'advance',operationId:id(),runId:completed.run!.id,languageContext:context,dailyLimit:20})).toBe(true);
 const next=await state();
 expect(next.session!.id).toBe(original.session!.id);expect(next.session!.dailyNewSenseLimit).toBe(20);
 expect(next.session!.scopeRevisionId).toBe(original.session!.scopeRevisionId);expect(next.originScope).toEqual(original.originScope);
 expect(next.run!.targetId).not.toBe(beta.id);expect(next.run!.studyScopeRevisionId).not.toBe(original.scope!.id);
 expect(next.scope!.members.map(member=>member.targetId)).toEqual(next.run!.targetIds);
 expect((await readLibrary(tx=>tx.get<LocalLearningTarget>('learningTargets',next.run!.targetId)))!.expression).toBe('queue-gamma');
 expect((await readLibrary(tx=>tx.get<LocalLearningTarget>('learningTargets',beta.id)))!.startedAt).toBeNull();
 validateBackupRows(await snapshot());
 await act({kind:'reveal'});await act({kind:'rate',rating:'good'});
 await learningSystem.execute({kind:'finish',operationId:id(),runId:next.run!.id});
 expect((await state()).session).toBeNull();
 first=(await learningSystem.read({kind:'book_plans',languageContext:context})).find(book=>book.enrollmentId===first.enrollmentId)!;
 await learningSystem.execute({kind:'change_book_plan',operationId:id(),enrollmentId:first.enrollmentId,expectedRevision:first.revision,languageContext:context,mode:'active',selection:first.selection});
 await learningSystem.execute({kind:'start',operationId:id(),targetId:beta.id,languageContext:context,dailyLimit:5});
 const later=await state();expect(later.session!.id).not.toBe(original.session!.id);expect(later.session!.dailyNewSenseLimit).toBe(5);expect(later.scope!.members.map(member=>member.targetId)).toEqual([beta.id]);
 const rows=await snapshot();validateBackupRows(rows);rows.packageCache=[];validateBackupRows(rows);
 const drift=structuredClone(rows),saved=drift.studyScopes.find(row=>row.key===later.scope!.id)!;saved.value.members[0]!.policy.profileVersion='forged';expect(()=>validateBackupRows(drift)).toThrow();
 // A real unfinished Run keeps its original selection while a new activity
 // captures today's source and quota. Another genuine, older Scope is not a
 // valid origin simply because it has the same Route and quota.
 await learningSystem.execute({kind:'end_session',operationId:id(),runId:later.run!.id,expectedRevision:later.run!.revision});
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:20});
 await learningSystem.execute({kind:'start',operationId:id(),targetId:beta.id,languageContext:context,dailyLimit:20});
 const resumed=await state();expect(resumed.run!.id).toBe(later.run!.id);expect(resumed.run!.studyScopeRevisionId).toBe(later.scope!.id);
 expect(resumed.session!.dailyNewSenseLimit).toBe(20);expect(resumed.originScope!.members.map(member=>member.targetId)).toEqual([beta.id]);
 const resumedRows=await snapshot();validateBackupRows(resumedRows);
 const unrelatedOrigin=structuredClone(resumedRows);unrelatedOrigin.learningSessions.find(row=>row.key===resumed.session!.id)!.value.scopeRevisionId=original.scope!.id;
 expect(()=>validateBackupRows(unrelatedOrigin)).toThrow();
});
