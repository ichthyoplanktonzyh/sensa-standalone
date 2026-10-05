import {afterAll,expect,test} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {createSensaPortableBook,portableBookMemberKey,portableBookMemberPath} from '@sensa/content-validator/portable-book';
import {sensaPortableBookManifestSchema,defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {openLibrary,readLibrary,libraryTables} from '../../../apps/web/src/data/library/store';
import {publishedCurriculumMembershipId,publishedMaterialMembership} from '../../../apps/web/src/data/library/publishedCurriculumSources';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';
import type {LocalLearningTarget,LocalLearningRun} from '../../../apps/web/src/learning/runtime/localProtocol';
import {runMaterialDigest,validateRunMaterialPins} from '../../../apps/web/src/learning/runtime/runMaterialPins';
import {stableUuid} from '@sensa/learning-kernel';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('https://book-sources.fixture.invalid/')});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());await openLibrary();
const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);

test('a shared Target retains independent Book admissions without replacing the active source or admitting a foreign member',async()=>{
 const first=portableBookDeliveryFixture({packageId:randomUUID(),memberExpressions:['shared','another-shared','only-a']});
 const base=portableBookDeliveryFixture({packageId:randomUUID(),memberExpressions:['unused','only-b']});
 const aFiles=unzipSync(first.bookBytes),bFiles=unzipSync(base.bookBytes);
 const manifest=sensaPortableBookManifestSchema.parse({...base.manifest,members:[first.manifest.members[0]!,first.manifest.members[1]!,base.manifest.members[1]!]});
 const bytes=createSensaPortableBook(manifest,new Map(manifest.members.map((member,index)=>[portableBookMemberKey(member),index<2?aFiles[portableBookMemberPath(member)]!:bFiles[portableBookMemberPath(member)]!])));
 const second={...base.descriptor,memberCount:3,book:manifest.book,sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.byteLength,url:'https://content.fixture.invalid/shared-admission.sensa-book'};
 const responses=new Map([[first.descriptor.url,first.bookBytes],[second.url,bytes]]),fetchBefore=globalThis.fetch;
 globalThis.fetch=async input=>{
  const body=responses.get(String(input));if(!body)throw new Error('Unexpected fixture download');
  return new Response(new Uint8Array(body).buffer);
 };
 try{
  for(const descriptor of [first.descriptor,second])await contentSupplySystem.execute({kind:'install_catalog_item',descriptor,signal:new AbortController().signal});
 }finally{globalThis.fetch=fetchBefore;}
 expect(await readLibrary(tx=>tx.count('learningTargets'))).toBe(0);
 await learningSystem.execute({kind:'confirm_quantity',operationId:randomUUID(),languageContext:context,dailyLimit:20});
 await learningSystem.execute({kind:'enroll_book',operationId:randomUUID(),languageContext:context,publicationArchiveSha256:first.descriptor.sha256});
 const originalTargets=await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'));
 const shared=originalTargets.find(target=>target.expression==='shared')!;
 const firstMembership=structuredClone(shared.curriculumMemberships[0]!);
 await learningSystem.execute({kind:'start',operationId:randomUUID(),targetId:shared.id,languageContext:context,dailyLimit:20});
 const opened=await learningSystem.read({kind:'runtime',languageContext:context});
 await learningSystem.execute({kind:'act',operationId:randomUUID(),runId:opened.runtime!.runId,expectedRevision:opened.runtime!.revision,action:{kind:'reveal'}});
 const before=await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',opened.runtime!.runId));
 await learningSystem.execute({kind:'enroll_book',operationId:randomUUID(),languageContext:context,publicationArchiveSha256:second.sha256});
 const workspace=await learningSystem.read({kind:'workspace',languageContext:context});
 expect(workspace.targets).toHaveLength(4);
 const a=workspace.enrollments.find(enrollment=>enrollment.source.kind==='published_book'&&enrollment.source.publicationArchiveSha256===first.descriptor.sha256)!;
 const b=workspace.enrollments.find(enrollment=>enrollment.source.kind==='published_book'&&enrollment.source.publicationArchiveSha256===second.sha256)!;
 const current=(await readLibrary(tx=>tx.get<LocalLearningTarget>('learningTargets',shared.id)))!;
 expect(current.id).toBe(shared.id);expect(current.retentionId).toBe(shared.retentionId);
 expect(current.curriculumMemberships).toHaveLength(2);
 expect(current.curriculumMemberships.find(member=>member.provenance.curriculumEnrollmentId===a.enrollmentId)).toEqual(firstMembership);
 expect(current.curriculumMemberships.map(member=>member.id).sort()).toEqual([a,b].map(enrollment=>publishedCurriculumMembershipId(shared.id,context,enrollment.enrollmentId,firstMembership.packageKey!,enrollment.source.kind==='published_book'?enrollment.source.publicationArchiveSha256:undefined)).sort());
 expect(new Set(current.curriculumMemberships.map(member=>member.material.snapshot.learningMaterializationId)).size).toBe(2);
 expect(await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',before!.id))).toEqual(before);
 expect(workspace.runtime!.runId).toBe(before!.id);
 await learningSystem.execute({kind:'enroll_book',operationId:randomUUID(),languageContext:context,publicationArchiveSha256:second.sha256});
 expect((await readLibrary(tx=>tx.get<LocalLearningTarget>('learningTargets',shared.id)))!.curriculumMemberships).toEqual(current.curriculumMemberships);
 const after=await learningSystem.read({kind:'runtime',languageContext:context});
 await learningSystem.execute({kind:'act',operationId:randomUUID(),runId:after.runtime!.runId,expectedRevision:after.runtime!.revision,action:{kind:'rate',rating:'again'}});
 const retried=await learningSystem.read({kind:'runtime',languageContext:context});
 await learningSystem.execute({kind:'act',operationId:randomUUID(),runId:retried.runtime!.runId,expectedRevision:retried.runtime!.revision,action:{kind:'reveal'}});
 const resumed=(await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',before!.id)))!;
 expect(resumed.participants[shared.id]!.curriculumMembershipId).toBe(firstMembership.id);
 for(const material of Object.values(resumed.participants[shared.id]!.materializations))expect(material.snapshot.provenance.curriculumMembershipId).toBe(firstMembership.id);

 const rows=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)])))) as BackupRows;
 validateBackupRows(rows);rows.packageCache=[];rows.operations=[];validateBackupRows(rows);
 const forged=structuredClone(rows),foreignRow=forged.learningTargets.find(row=>row.value.expression==='only-a')!,foreign=foreignRow.value as LocalLearningTarget;
 const member=foreign.curriculumMemberships[0]!;
 const admittedB=current.curriculumMemberships.find(source=>source.provenance.curriculumEnrollmentId===b.enrollmentId)!;
 const alias=structuredClone(rows),aliasRow=alias.learningTargets.find(row=>row.key===shared.id)!;
 const legacyId=stableUuid(`local-curriculum-membership:${shared.id}:${context.languageRouteId}:sense_learning_package:${admittedB.packageKey}`);
 const aliased={...admittedB,id:legacyId,material:{...admittedB.material,snapshot:{...admittedB.material.snapshot,learningMaterializationId:stableUuid(`sensa-material:${shared.identity.learnerUserId}:${admittedB.packageKey}:${shared.id}:${legacyId}:${admittedB.createdByOperationId}`),provenance:{...admittedB.material.snapshot.provenance,curriculumMembershipId:legacyId}}}};
 aliasRow.value={...aliasRow.value,curriculumMemberships:aliasRow.value.curriculumMemberships.map((source:LocalLearningTarget['curriculumMemberships'][number])=>source.id===admittedB.id?aliased:source)};
 expect(()=>validateBackupRows(alias)).toThrow(/membership identity is invalid/u);
 const forgedId=publishedCurriculumMembershipId(foreign.id,context,b.enrollmentId,member.packageKey!,second.sha256);
 const forgedProvenance={...member.provenance,curriculumEnrollmentId:b.enrollmentId,bookId:manifest.book.bookId,bookVersionId:manifest.book.bookVersionId,contentReleaseId:manifest.contentRelease.contentReleaseId,publicationArchiveSha256:second.sha256};
 foreignRow.value={...foreign,curriculumMemberships:[{...member,id:forgedId,createdAt:admittedB.createdAt,updatedAt:admittedB.updatedAt,createdByOperationId:admittedB.createdByOperationId,provenance:forgedProvenance,material:{...member.material,snapshot:{...member.material.snapshot,createdAt:admittedB.material.snapshot.createdAt,learningMaterializationId:stableUuid(`sensa-material:${foreign.identity.learnerUserId}:${member.packageKey}:${foreign.id}:${forgedId}:${admittedB.createdByOperationId}`),provenance:{...member.material.snapshot.provenance,...forgedProvenance,curriculumMembershipId:forgedId,materializationOperationId:admittedB.createdByOperationId,sourceReadyAt:admittedB.material.snapshot.provenance.sourceReadyAt}}}},...foreign.curriculumMemberships.slice(1)]};
 expect(()=>validateBackupRows(forged)).toThrow(/not in its admitted Book/u);
 expect(rows.learningRuns).toHaveLength(1);
 expect(current.memoryRevision).toBe(0);expect(current.completedAt).toBeNull();
 const another=(await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'))).find(target=>target.expression==='another-shared')!;
 await learningSystem.execute({kind:'start',operationId:randomUUID(),targetId:another.id,languageContext:context,dailyLimit:20});
 const newRun=(await readLibrary(async tx=>tx.get<LocalLearningRun>('learningRuns',(await tx.get<string>('meta','learning-active'))!)))!;
 expect(newRun.participants[another.id]!.curriculumMembershipId).toBe(another.curriculumMemberships.find(source=>source.provenance.curriculumEnrollmentId===b.enrollmentId)!.id);
 const newest=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)])))) as BackupRows;
 validateBackupRows(newest);newest.packageCache=[];newest.operations=[];validateBackupRows(newest);
 const badSource=structuredClone(newest),badRun=badSource.learningRuns.find(row=>row.key===newRun.id)!.value as LocalLearningRun;
 const participant=badRun.participants[another.id]!,oldReference=participant.material;
 const originalMaterial=structuredClone(participant.materializations[oldReference]!);
 const missingSource=structuredClone(originalMaterial);Reflect.deleteProperty(missingSource.snapshot.provenance,'curriculumMembershipId');
 expect(publishedMaterialMembership(another,missingSource,context)).toBeUndefined();
 const misattributed={...originalMaterial,snapshot:{...originalMaterial.snapshot,provenance:{...originalMaterial.snapshot.provenance,bookVersionId:randomUUID()}}};
 const reference=runMaterialDigest(misattributed);
 participant.material=reference;participant.materializations={[reference]:misattributed};
 participant.presentedMaterials=Object.fromEntries(Object.entries(participant.presentedMaterials).map(([step,ref])=>[step,ref===oldReference?reference:ref]));
 expect(()=>validateRunMaterialPins(participant)).not.toThrow();
 expect(()=>validateBackupRows(badSource)).toThrow();

 // A new immutable Book version may reuse exactly the same Package bytes.
 // It is a different source admission, never an in-place provenance rewrite.
 const updatedManifest=sensaPortableBookManifestSchema.parse({...first.manifest,book:{...first.manifest.book,bookVersionId:randomUUID(),versionNumber:2},contentRelease:{...first.manifest.contentRelease,contentReleaseId:randomUUID(),versionNumber:2}});
 const updateBytes=createSensaPortableBook(updatedManifest,new Map(updatedManifest.members.map(member=>[portableBookMemberKey(member),aFiles[portableBookMemberPath(member)]!])));
 const updated={...first.descriptor,book:updatedManifest.book,contentRelease:updatedManifest.contentRelease,sha256:createHash('sha256').update(updateBytes).digest('hex'),byteLength:updateBytes.byteLength,url:'https://content.fixture.invalid/reused-members-v2.sensa-book'};
 const fetchForUpdate=globalThis.fetch;
 globalThis.fetch=async()=>new Response(new Uint8Array(updateBytes).buffer);
 try{await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:updated,signal:new AbortController().signal});}finally{globalThis.fetch=fetchForUpdate;}
 const pinned=structuredClone(newRun.participants[another.id]!);
 const oldBookRun=await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',before!.id));
 await learningSystem.execute({kind:'enroll_book',operationId:randomUUID(),languageContext:context,publicationArchiveSha256:updated.sha256});
 const upgraded=(await readLibrary(tx=>tx.get<LocalLearningTarget>('learningTargets',shared.id)))!;
 expect(upgraded.curriculumMemberships).toHaveLength(3);
 expect(upgraded.curriculumMemberships.find(member=>member.id===firstMembership.id)).toEqual(firstMembership);
 expect(new Set(upgraded.curriculumMemberships.map(member=>member.material.snapshot.learningMaterializationId)).size).toBe(3);
 expect((await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',newRun.id)))!.participants[another.id]).toEqual(pinned);
 expect(await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',before!.id))).toEqual(oldBookRun);
 const upgradedRows=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)])))) as BackupRows;
 validateBackupRows(upgradedRows);upgradedRows.packageCache=[];upgradedRows.operations=[];validateBackupRows(upgradedRows);

 // Upgrade the Book that owns the currently active, unacted Run as well.
 const nextB=sensaPortableBookManifestSchema.parse({...manifest,book:{...manifest.book,bookVersionId:randomUUID(),versionNumber:2},contentRelease:{...manifest.contentRelease,contentReleaseId:randomUUID(),versionNumber:2}});
 const bBytes=createSensaPortableBook(nextB,new Map(nextB.members.map((member,index)=>[portableBookMemberKey(member),index<2?aFiles[portableBookMemberPath(member)]!:bFiles[portableBookMemberPath(member)]!])));
 const bUpdate={...second,book:nextB.book,contentRelease:nextB.contentRelease,sha256:createHash('sha256').update(bBytes).digest('hex'),byteLength:bBytes.byteLength,url:'https://content.fixture.invalid/shared-admission-v2.sensa-book'};
 const beforeBUpgrade=(await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',newRun.id)))!;
 const fetchB=globalThis.fetch;globalThis.fetch=async()=>new Response(new Uint8Array(bBytes).buffer);
 try{await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:bUpdate,signal:new AbortController().signal});}finally{globalThis.fetch=fetchB;}
 await learningSystem.execute({kind:'enroll_book',operationId:randomUUID(),languageContext:context,publicationArchiveSha256:bUpdate.sha256});
 expect(await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',newRun.id))).toEqual(beforeBUpgrade);
 const active=await learningSystem.read({kind:'runtime',languageContext:context});
 await learningSystem.execute({kind:'act',operationId:randomUUID(),runId:active.runtime!.runId,expectedRevision:active.runtime!.revision,action:{kind:'reveal'}});
 const activeAfter=(await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',newRun.id)))!;
 for(const material of Object.values(activeAfter.participants[another.id]!.materializations))expect(material.snapshot.provenance.publicationArchiveSha256).toBe(second.sha256);
 const finalRows=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)])))) as BackupRows;
 validateBackupRows(finalRows);finalRows.packageCache=[];finalRows.operations=[];validateBackupRows(finalRows);

 // Reapplying an earlier source preserves its immutable Ready witness even
 // though the membership update window advances. A rehashed Run cannot move it.
 await learningSystem.execute({kind:'enroll_book',operationId:randomUUID(),languageContext:context,publicationArchiveSha256:second.sha256});
 const reapplied=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)])))) as BackupRows;
 reapplied.packageCache=[];reapplied.operations=[];validateBackupRows(reapplied);
 const drift=structuredClone(reapplied),driftRun=drift.learningRuns.find(row=>row.key===newRun.id)!.value as LocalLearningRun;
 const driftParticipant=driftRun.participants[another.id]!;
 const admitted=(drift.learningTargets.find(row=>row.key===another.id)!.value as LocalLearningTarget).curriculumMemberships.find(source=>source.id===driftParticipant.curriculumMembershipId)!;
 expect(Date.parse(driftRun.startedAt)).toBeGreaterThan(Date.parse(admitted.createdAt));
 expect(Date.parse(driftRun.startedAt)).toBeLessThanOrEqual(Date.parse(admitted.updatedAt));
 const references=new Map<string,string>();
 const moved=Object.entries(driftParticipant.materializations).map(([ref,material])=>{
  const next={...material,snapshot:{...material.snapshot,provenance:{...material.snapshot.provenance,sourceReadyAt:driftRun.startedAt}}};
  expect(publishedMaterialMembership(drift.learningTargets.find(row=>row.key===another.id)!.value as LocalLearningTarget,next,context)).toBeUndefined();
  const key=runMaterialDigest(next);references.set(ref,key);return [key,next] as const;
 });
 driftParticipant.materializations=Object.fromEntries(moved);
 driftParticipant.material=references.get(driftParticipant.material)!;
 driftParticipant.presentedMaterials=Object.fromEntries(Object.entries(driftParticipant.presentedMaterials).map(([step,ref])=>[step,references.get(ref)!]));
 for(const row of drift.learningEvents){
  if(row.value.runId!==driftRun.id)continue;
  const next=row.value.detail.nextPresentation;
  if(next?.targetId===another.id)next.material=references.get(next.material)!;
 }
 expect(()=>validateRunMaterialPins(driftParticipant)).not.toThrow();
 expect(()=>validateBackupRows(drift)).toThrow();
});
