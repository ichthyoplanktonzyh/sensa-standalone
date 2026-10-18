import {afterAll,expect,test} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {unzipSync,zipSync} from 'fflate';
import type {Database} from '@sqlite.org/sqlite-wasm';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext,sensaPortableBookManifestSchema} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {openLibrary,readLibrary,restoreLibraryTransaction} from '../../../apps/web/src/data/library/store';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {resolveBookPlan,bookPlanSchema} from '../../../apps/web/src/data/library/bookPlans';
import {curriculumEnrollmentId,curriculumEnrollmentSchema,type LocalCurriculumEnrollment} from '../../../apps/web/src/data/library/curriculumEnrollments';
import {SqliteRuntimeLearningCandidates,runtimeLearningCandidatesFromRecords,type RuntimeLearningCandidateQuery} from '../../../apps/web/src/data/library/runtimeLearningCandidates';
import {createHomeLearningStorageProjection} from '../../../apps/web/src/data/library/homeLearningRecords';
import type {LocalLearningTarget} from '../../../apps/web/src/learning/runtime/localProtocol';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('https://book-plan.fixture.invalid/')});
const database=await useNodeLearningCapacityStorage(),raw=Reflect.get(database,'database') as Database;
afterAll(()=>database.close());await openLibrary();
const fixture=portableBookDeliveryFixture({packageId:randomUUID(),memberExpressions:['first','second','third']});
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(new Uint8Array(fixture.bookBytes).buffer);
try{await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:fixture.descriptor,signal:new AbortController().signal});}finally{globalThis.fetch=originalFetch;}
const packages=(await contentSupplySystem.read({kind:'workspace'})).packages;
const at='2026-09-01T08:00:00.000Z',context={...sensaPinnedLanguageContext(defaultSensaLanguageRoute),languageRouteId:randomUUID()};
const plan=resolveBookPlan({operationId:randomUUID(),at,mode:'active',selection:{kind:'ordinals',first:2,last:2},archiveSha256:fixture.descriptor.sha256,packages:[...packages].reverse()});

test('ordinal and Sense selection resolve actual immutable Manifest members, not Package UUID or input order',()=>{
 expect(plan.range.members).toHaveLength(1);expect(plan.range.members[0]!.memberIndex).toBe(1);
 const key=JSON.stringify([fixture.manifest.members[1]!.packageId,String(fixture.manifest.members[1]!.version)]);
 expect(plan.range.members[0]!.packageKey).toBe(key);
 const all=resolveBookPlan({operationId:randomUUID(),at,mode:'active',selection:{kind:'all'},archiveSha256:fixture.descriptor.sha256,packages});
 expect(all.range.members).toEqual([]);expect(all.range.memberCount).toBe(3);expect(all.range.archiveSha256).toBe(fixture.descriptor.sha256);
 const selected=resolveBookPlan({operationId:randomUUID(),at,mode:'active',selection:{kind:'senses',senseVersionIds:[plan.range.members[0]!.senseVersionId]},archiveSha256:fixture.descriptor.sha256,packages});
 expect(selected.range.members).toEqual(plan.range.members);
 const modeOnly=resolveBookPlan({operationId:randomUUID(),at,mode:'paused',selection:plan.range.selection,archiveSha256:fixture.descriptor.sha256,packages,previous:plan});
 expect(modeOnly.range).toEqual(plan.range);expect(modeOnly.revision).toBe(plan.revision+1);
 expect(()=>resolveBookPlan({operationId:randomUUID(),at,mode:'active',selection:{kind:'ordinals',first:2,last:4},archiveSha256:fixture.descriptor.sha256,packages})).toThrow();
 const unknown=structuredClone(packages);for(const pack of unknown)for(const publication of pack.portableOrigin.publications)Reflect.deleteProperty(publication,'memberIndex');
 expect(()=>resolveBookPlan({operationId:randomUUID(),at,mode:'active',selection:{kind:'ordinals',first:1,last:1},archiveSha256:fixture.descriptor.sha256,packages:unknown})).toThrow();
 expect(()=>bookPlanSchema.parse({...plan,range:{...plan.range,members:[{...plan.range.members[0]!,memberIndex:0}]}})).toThrow();
 const wider=resolveBookPlan({operationId:randomUUID(),at,mode:'active',selection:{kind:'ordinals',first:1,last:3},archiveSha256:fixture.descriptor.sha256,packages});
 expect(()=>bookPlanSchema.parse({...wider,range:{...wider.range,members:wider.range.members.slice(0,2)}})).toThrow();
});

test('actual Learning start binds the eligible old Book source, and Range-excluded start cannot switch its open Run',async()=>{
 const learningContext=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
 await learningSystem.execute({kind:'confirm_quantity',operationId:randomUUID(),languageContext:learningContext,dailyLimit:20});
 await learningSystem.execute({kind:'enroll_book',operationId:randomUUID(),languageContext:learningContext,publicationArchiveSha256:fixture.descriptor.sha256});
 const before=await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'));
 const first=before.find(target=>target.expression==='first')!,oldSource=first.curriculumMemberships[0]!;
 const files=unzipSync(fixture.bookBytes);
 const manifest=sensaPortableBookManifestSchema.parse({...fixture.manifest,book:{...fixture.manifest.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:'alternate-planning-book'}});
 const bytes=zipSync({...files,'book.json':new TextEncoder().encode(JSON.stringify(manifest))});
 const descriptor={...fixture.descriptor,book:manifest.book,sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.byteLength,url:'https://content.fixture.invalid/alternate-planning.sensa-book'};
 const fetchBefore=globalThis.fetch;globalThis.fetch=async()=>new Response(new Uint8Array(bytes).buffer);
 try{await contentSupplySystem.execute({kind:'install_catalog_item',descriptor,signal:new AbortController().signal});}finally{globalThis.fetch=fetchBefore;}
 await learningSystem.execute({kind:'enroll_book',operationId:randomUUID(),languageContext:learningContext,publicationArchiveSha256:descriptor.sha256});
 const admitted=(await contentSupplySystem.read({kind:'workspace'})).packages;
 const enrollments=await readLibrary(tx=>tx.all<LocalCurriculumEnrollment>('curriculumEnrollments'));
 const original=enrollments.find(enrollment=>enrollment.source.kind==='published_book'&&enrollment.source.publicationArchiveSha256===fixture.descriptor.sha256)!;
 await learningSystem.execute({kind:'change_book_plan',operationId:randomUUID(),enrollmentId:original.id,expectedRevision:original.revision,languageContext:learningContext,mode:'active',selection:{kind:'ordinals',first:1,last:1}});
 const alternate=(await learningSystem.read({kind:'book_plans',languageContext:learningContext})).find(book=>book.enrollmentId!==original.id)!;
 expect(alternate.mode).toBe('maintenance');
 await learningSystem.execute({kind:'change_book_plan',operationId:randomUUID(),enrollmentId:alternate.enrollmentId,expectedRevision:alternate.revision,languageContext:learningContext,mode:'paused',selection:alternate.selection});
 await learningSystem.execute({kind:'start',operationId:randomUUID(),targetId:first.id,languageContext:learningContext,dailyLimit:20});
 const snapshot=await learningSystem.read({kind:'runtime',languageContext:learningContext});
 const run=await readLibrary(tx=>tx.get<any>('learningRuns',snapshot.runtime!.runId));
 expect(run.participants[first.id].curriculumMembershipId).toBe(oldSource.id);
 const outside=before.find(target=>target.expression==='second')!;
 await expect(learningSystem.execute({kind:'start',operationId:randomUUID(),targetId:outside.id,languageContext:learningContext,dailyLimit:20})).rejects.toThrow('localFlow.routeMembershipMissing');
 expect(await readLibrary(tx=>tx.get('learningRuns',run.id))).toEqual(run);
 expect((await learningSystem.execute({kind:'prepare_queue',languageContext:learningContext}))).toEqual([]);
 expect((await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'))).map(target=>target.id).sort()).toEqual(before.map(target=>target.id).sort());
 const choice=(await learningSystem.read({kind:'direct_choices',query:'second',targetLanguageTag:'en',page:0})).items.find(item=>item.reference.senseId===outside.identity.senseId)!;
 const source=await learningSystem.read({kind:'direct_source',reference:choice.reference});
 const intent=await learningSystem.execute({kind:'enroll_direct',operationId:randomUUID(),reference:choice.reference,expectedDigest:source.sourceDigest,languageContext:learningContext});
 expect(intent.status).toBe('awaiting_content');expect(intent.enrollmentId).not.toBeNull();
 expect(await learningSystem.execute({kind:'prepare_direct',operationId:randomUUID(),enrollmentId:intent.enrollmentId!})).toEqual({targetId:outside.id,status:'ready'});
 expect(await readLibrary(tx=>tx.get('learningRuns',run.id))).toEqual(run);
 await learningSystem.execute({kind:'start',operationId:randomUUID(),targetId:outside.id,languageContext:learningContext,dailyLimit:20});
 const directRun=await readLibrary(async tx=>tx.get<any>('learningRuns',(await tx.get<string>('meta','learning-active'))!));
 const target=await readLibrary(tx=>tx.get<LocalLearningTarget>('learningTargets',outside.id));
 expect(target!.curriculumMemberships.find(member=>member.id===directRun.participants[outside.id].curriculumMembershipId)!.sourceKind).toBe('stable_sense');
});

test('source-index and pure planning preserve started work outside Range, maintenance, pause, alternate coverage and Target deduplication',()=>{
 const source={kind:'published_book' as const,publisherNamespace:fixture.manifest.publisher.namespace,bookId:fixture.manifest.book.bookId,bookVersionId:fixture.manifest.book.bookVersionId,bookVersionNumber:fixture.manifest.book.versionNumber,contentReleaseId:fixture.manifest.contentRelease.contentReleaseId,publicationArchiveSha256:fixture.descriptor.sha256,memberCount:3};
 const learner=randomUUID(),id=curriculumEnrollmentId(learner,context.languageRouteId,source);
 let enrollment=curriculumEnrollmentSchema.parse({format:'sensa-curriculum-enrollment-v1',id,revision:1,learnerUserId:learner,languageContext:context,source,status:'active',createdByOperationId:randomUUID(),createdAt:at,updatedAt:at,bookPlan:plan});
 const candidates=new SqliteRuntimeLearningCandidates(raw),clock=Date.parse(at),targets:LocalLearningTarget[]=packages.map((pack,index)=>({
  id:randomUUID(),curriculumMemberships:[{id:randomUUID(),status:'active',languageContext:context,packageKey:pack.key,provenance:{curriculumEnrollmentId:id,publicationArchiveSha256:fixture.descriptor.sha256,senseVersionId:pack.content.entries[0]!.senseVersionId,bindingVersionId:pack.content.entries[0]!.bindingVersionId},material:{snapshot:{validationStatus:'validated'}}}],policyAssignment:{profileId:'lightweight'},committedPolicy:null,planningOverrides:[],introducedLanguageRouteId:index===0?context.languageRouteId:null,
  startedAt:index===0?'2026-08-01T08:00:00.000Z':null,completedAt:index===0?'2026-08-02T08:00:00.000Z':null,memory:index===0?{dueAt:new Date(clock-1000)}:null,relearnAt:null,
 } as unknown as LocalLearningTarget));
 // Projection-only phase inputs above are not genuine completion or Memory evidence.
 const selected=targets.find(target=>target.curriculumMemberships[0]!.packageKey===plan.range.members[0]!.packageKey)!;
 const due=targets[0]!;
 // Ensure the started source is outside the new Range, irrespective of cache-key order.
 if(due.id===selected.id){const other=targets[1]!;Object.assign(other,{startedAt:due.startedAt,completedAt:due.completedAt,memory:due.memory,introducedLanguageRouteId:due.introducedLanguageRouteId});Object.assign(due,{startedAt:null,completedAt:null,memory:null,introducedLanguageRouteId:null});}
 for(const target of targets)candidates.upsert(target.id,target);
 const query:RuntimeLearningCandidateQuery={languageContext:context,clock,dailyLimit:20,supportedPolicies:['lightweight'],currentTargetIds:[],retryTargetIds:[]};
 const check=(enrollments:LocalCurriculumEnrollment[])=>{
  for(const item of enrollments)candidates.upsertEnrollment(item.id,item);
  const stored=createHomeLearningStorageProjection({targets,availablePackageKeys:packages.map(pack=>pack.key),activeRun:null,studyPlans:{},languageRouteId:context.languageRouteId,clock,enrollments});
  const actual=candidates.read(query);expect(actual).toEqual(runtimeLearningCandidatesFromRecords(stored,query));return actual;
 };
 let actual=check([enrollment]);expect(actual.initialReady.map(target=>target.id)).toEqual([selected.id]);expect(actual.due).toHaveLength(1);
 const other=targets.find(target=>target.id!==selected.id&&!target.startedAt)!;
 const otherPackage=packages.find(pack=>pack.key===other.curriculumMemberships[0]!.packageKey)!;
 const changedRange=resolveBookPlan({operationId:randomUUID(),at,mode:'active',selection:{kind:'senses',senseVersionIds:[otherPackage.content.entries[0]!.senseVersionId]},archiveSha256:fixture.descriptor.sha256,packages});
 const reusedId=curriculumEnrollmentSchema.parse({...enrollment,bookPlan:{...changedRange,range:{...changedRange.range,rangeRevisionId:plan.range.rangeRevisionId}}});
 expect(check([reusedId]).initialReady.map(target=>target.id)).toEqual([other.id]);
 expect(check([enrollment]).initialReady.map(target=>target.id)).toEqual([selected.id]);
 const samePackageOtherSense={...selected,id:randomUUID(),curriculumMemberships:[{...selected.curriculumMemberships[0]!,id:randomUUID(),provenance:{...selected.curriculumMemberships[0]!.provenance,senseVersionId:randomUUID()}}]};
 const samePackageOtherBinding={...selected,id:randomUUID(),curriculumMemberships:[{...selected.curriculumMemberships[0]!,id:randomUUID(),provenance:{...selected.curriculumMemberships[0]!.provenance,bindingVersionId:randomUUID()}}]};
 targets.push(samePackageOtherSense,samePackageOtherBinding);for(const target of [samePackageOtherSense,samePackageOtherBinding])candidates.upsert(target.id,target);
 expect(check([enrollment]).initialReady.map(target=>target.id)).toEqual([selected.id]);
 const retainedId=actual.due[0]!.id;
 enrollment={...enrollment,bookPlan:{...plan,mode:'maintenance'}};actual=check([enrollment]);expect(actual.initialReady).toEqual([]);expect(actual.due.map(target=>target.id)).toEqual([retainedId]);
 enrollment={...enrollment,bookPlan:{...plan,mode:'paused'}};actual=check([enrollment]);expect(actual.initialReady).toEqual([]);expect(actual.due).toEqual([]);expect(actual.nextChangeAt).toBeNull();
 const retained=targets.find(target=>target.id===retainedId)!;
 const pack=packages.find(pack=>pack.key===retained.curriculumMemberships[0]!.packageKey)!;
 const alternateSource={kind:'portable_package' as const,packageId:pack.portableOrigin.manifest.metadata.packageId,packageVersion:pack.portableOrigin.manifest.metadata.version,packageKey:pack.key};
 const alternateId=curriculumEnrollmentId(learner,context.languageRouteId,alternateSource);
 const alternate=curriculumEnrollmentSchema.parse({...enrollment,id:alternateId,source:alternateSource,bookPlan:undefined});
 retained.curriculumMemberships.push({...retained.curriculumMemberships[0]!,id:randomUUID(),provenance:{...retained.curriculumMemberships[0]!.provenance,curriculumEnrollmentId:alternateId}});candidates.upsert(retained.id,retained);
 actual=check([enrollment,alternate]);expect(actual.due.map(target=>target.id)).toEqual([retainedId]);
 retained.curriculumMemberships.push({...retained.curriculumMemberships.at(-1)!,id:randomUUID(),material:{snapshot:{validationStatus:'pending'}}} as any);candidates.upsert(retained.id,retained);
 expect(check([enrollment,alternate]).due.map(target=>target.id)).toEqual([retainedId]);
 const exec=raw.exec.bind(raw),statements:string[]=[];raw.exec=((input:any)=>{statements.push(typeof input==='string'?input:input.sql);return exec(input);}) as typeof raw.exec;
 try{candidates.upsertEnrollment(enrollment.id,{...enrollment,bookPlan:{...plan,mode:'maintenance'}});expect(statements.some(sql=>/^(?:DELETE|INSERT).*sensa_runtime_learning_ranges/u.test(sql))).toBe(false);}finally{raw.exec=exec;}
 candidates.upsertEnrollment(enrollment.id,enrollment);
 candidates.deleteEnrollment(alternateId);expect(candidates.read(query).due).toEqual([]);
});
