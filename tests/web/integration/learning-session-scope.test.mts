import {afterAll,expect,test,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {openLibrary,readLibrary,libraryTables} from '../../../apps/web/src/data/library/store';
import type {LocalLearningTarget,LocalLearningRun} from '../../../apps/web/src/learning/runtime/localProtocol';
import type {LocalLearningSession,LocalStudyScope} from '../../../apps/web/src/data/library/studyScopes';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';
import {selectLocalLearningPolicy} from '../../../apps/web/src/data/library/learning';
import {learningPolicyProfileRegistry} from '../../../apps/web/src/learning/runtime/policyProfiles';
import {encodeBackupValue,decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {isReplicatedLibraryEntry,mergeLibraryReplicas,partitionLibraryReplicaConflicts} from '../../../apps/web/src/data/library/replication/libraryReplica';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('https://session-scope.fixture.invalid/')});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());await openLibrary();
const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
const id=()=>randomUUID();
const state=()=>readLibrary(async tx=>{
 const sessionId=await tx.get<string>('meta','learning-session-active');
 const session=sessionId?await tx.get<LocalLearningSession>('learningSessions',sessionId):null;
 const runId=await tx.get<string>('meta','learning-active');
 return {session,scope:session?await tx.get<LocalStudyScope>('studyScopes',session.scopeRevisionId):null,run:runId?await tx.get<LocalLearningRun>('learningRuns',runId):null};
});
const act=async(action:{kind:'reveal'}|{kind:'rate';rating:'good'})=>{
 const current=await learningSystem.read({kind:'runtime',languageContext:context});
 await learningSystem.execute({kind:'act',operationId:id(),runId:current.runtime!.runId,expectedRevision:current.runtime!.revision,action});
};
const install=async(expressions:string[])=>{
 const fixture=portableBookDeliveryFixture({packageId:id(),memberExpressions:expressions});
 const before=globalThis.fetch;globalThis.fetch=async()=>new Response(new Uint8Array(fixture.bookBytes).buffer);
 try{await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:fixture.descriptor,signal:new AbortController().signal});}finally{globalThis.fetch=before;}
 await learningSystem.execute({kind:'enroll_book',operationId:id(),languageContext:context,publicationArchiveSha256:fixture.descriptor.sha256});
};

test('a Session pins its complete admitted Scope and quota across continuation; new sources affect the next Session only',async()=>{
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:20});
 await install(['scope-alpha','scope-beta']);
 const targets=await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'));
 const alpha=targets.find(target=>target.expression==='scope-alpha')!,beta=targets.find(target=>target.expression==='scope-beta')!;
 const beforeSession=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))) as BackupRows);
 await learningSystem.execute({kind:'start',operationId:id(),targetId:alpha.id,languageContext:context,dailyLimit:20});
 const original=await state();
 expect(original.scope!.members.map(member=>member.targetId).sort()).toEqual([alpha.id,beta.id].sort());
 expect(original.scope!.members.every(member=>member.sources.some(source=>source.plans.some(plan=>plan.purpose==='initial_learning'&&plan.readiness==='ready')))).toBe(true);
 expect(original.run!.studyScopeRevisionId).toBe(original.scope!.id);
 expect(original.run!.learningSessionId).toBe(original.session!.id);
 await expect(selectLocalLearningPolicy(id(),beta.id,context,'interleaved_four_stage')).rejects.toThrow('localFlow.stepChanged');
 expect((await readLibrary(tx=>tx.get<LocalLearningTarget>('learningTargets',beta.id)))!.policyAssignment).toEqual(beta.policyAssignment);
 const activeRows=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))) as BackupRows);
 // A stale foreign writer must not sneak a future assignment into another
 // device's active arrangement just because these are different record keys.
 const staleAssignment=structuredClone(activeRows),changedBeta=staleAssignment.learningTargets.find(row=>row.key===beta.id)!.value;
 changedBeta.policyAssignment={...changedBeta.policyAssignment,revision:changedBeta.policyAssignment.revision+1,profileId:'interleaved_four_stage',assignedByOperationId:id()};
 expect(()=>validateBackupRows(staleAssignment)).toThrow();
 const replicaEntries=(rows:BackupRows)=>Object.entries(rows).flatMap(([table,records])=>records.filter(row=>isReplicatedLibraryEntry(table,row.key)).map(row=>({table:table as import('../../../apps/web/src/data/library/replication/libraryReplica').LibraryReplicaEntry['table'],key:row.key,value:encodeBackupValue(row.value)})));
 const foreign=structuredClone(beforeSession);foreign.learningTargets.find(row=>row.key===beta.id)!.value.policyAssignment=changedBeta.policyAssignment;
 const replicas={base:replicaEntries(beforeSession),local:replicaEntries(activeRows),remote:replicaEntries(foreign)},merged=mergeLibraryReplicas(replicas);
 expect(merged.conflicts).toContain(JSON.stringify(['learningTargets',beta.id]));
 const partition=partitionLibraryReplicaConflicts({...replicas,merged:merged.entries,conflicts:merged.conflicts});
 expect(decodeBackupValue(partition.local.find(row=>row.table==='learningTargets'&&row.key===beta.id)!.value).policyAssignment).toEqual(beta.policyAssignment);
 expect(decodeBackupValue(partition.upload.find(row=>row.table==='learningTargets'&&row.key===beta.id)!.value).policyAssignment).toEqual(changedBeta.policyAssignment);
 expect(partition.local.some(row=>row.table==='learningSessions'&&row.key===original.session!.id)).toBe(true);
 expect(partition.upload.some(row=>row.table==='learningSessions'&&row.key===original.session!.id)).toBe(false);
 await install(['scope-later']);
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:30});
 expect((await state()).scope).toEqual(original.scope);
 expect((await state()).run).toEqual(original.run);
 await act({kind:'reveal'});await act({kind:'rate',rating:'good'});
 const boundary=await learningSystem.read({kind:'runtime',languageContext:context});
 expect(boundary.runtime!.completed).toBe(true);expect(boundary.nextTargetId).toBe(beta.id);expect(boundary.dailyLimit).toBe(20);

 // Roll the current registry forward while retaining the explicit old version.
 // Rebuild the candidate row under that new default to avoid a stale-index pass.
 const profileGet=learningPolicyProfileRegistry.get.bind(learningPolicyProfileRegistry);
 const frozenVersion=original.scope!.members.find(member=>member.targetId===beta.id)!.policy.profileVersion;
 const profileSpy=vi.spyOn(learningPolicyProfileRegistry,'get').mockImplementation((profileId,version)=>{
  const profile=profileGet(profileId,version);return !version&&profileId==='lightweight'?{...profile,profileVersion:'scope-test-next-version'}:profile;
 });
 database.commit({clears:[],deletes:[],puts:[{table:'learningTargets',key:beta.id,encodedValue:JSON.stringify(encodeBackupValue(beta))}]});

 const get=database.get.bind(database),entries=database.entries.bind(database),page=database.entriesPage.bind(database);
 database.get=(table,key)=>{if(table==='studyScopes')throw new Error('Continuation decoded the whole Scope');return get(table,key);};
 database.entries=table=>{if(['learningTargets','learningRuns','learningEvents','studyScopes'].includes(table))throw new Error('Continuation enumerated collection facts');return entries(table);};
 database.entriesPage=(table,after,limit)=>{if(['learningTargets','learningRuns','learningEvents','studyScopes'].includes(table))throw new Error('Continuation paged collection facts');return page(table,after,limit);};
 try{
  expect(await learningSystem.execute({kind:'advance',operationId:id(),runId:boundary.runtime!.runId,languageContext:context,dailyLimit:20})).toBe(true);
 }finally{database.get=get;database.entries=entries;database.entriesPage=page;profileSpy.mockRestore();}
 const second=await state();
 expect(second.run!.targetId).toBe(beta.id);expect(second.session!.id).toBe(original.session!.id);
 expect(second.run!.policyProfileVersion).toBe(frozenVersion);
 expect(second.session!.runIds).toEqual([original.run!.id,second.run!.id]);expect(second.scope).toEqual(original.scope);
 await act({kind:'reveal'});await act({kind:'rate',rating:'good'});
 const end=await learningSystem.read({kind:'runtime',languageContext:context});
 expect(end.nextTargetId).toBeNull();
 await learningSystem.execute({kind:'finish',operationId:id(),runId:end.runtime!.runId});
 const closed=await readLibrary(tx=>tx.get<LocalLearningSession>('learningSessions',original.session!.id));
 expect(closed!.endedAt).not.toBeNull();expect(closed!.endReason).toBe('learner_finished');expect((await state()).session).toBeNull();
 const later=(await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'))).find(target=>target.expression==='scope-later')!;
 await learningSystem.execute({kind:'start',operationId:id(),targetId:later.id,languageContext:context,dailyLimit:30});
 const next=await state();expect(next.session!.id).not.toBe(original.session!.id);expect(next.session!.dailyNewSenseLimit).toBe(30);
 expect(next.scope!.members.some(member=>member.targetId===later.id)).toBe(true);
 const rows=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))) as BackupRows);
 expect(()=>validateBackupRows(rows)).not.toThrow();
 const cacheless=structuredClone(rows);cacheless.packageCache=[];cacheless.operations=[];expect(()=>validateBackupRows(cacheless)).not.toThrow();
 const drift=structuredClone(cacheless);drift.learningSessions.find(row=>row.key===original.session!.id)!.value.scopeRevisionId=next.scope!.id;
 expect(()=>validateBackupRows(drift)).toThrow();
 const premature=structuredClone(cacheless),currentSession=premature.learningSessions.find(row=>row.key===next.session!.id)!.value;
 Object.assign(currentSession,{revision:currentSession.revision+1,activeRunId:null,endedAt:currentSession.startedAt,endedByOperationId:id(),endReason:'learner_finished'});
 premature.meta=premature.meta.filter(row=>!['learning-session-active','learning-active'].includes(row.key));
 expect(()=>validateBackupRows(premature)).toThrow();
 const orphaned=structuredClone(cacheless);orphaned.meta=orphaned.meta.filter(row=>row.key!=='learning-session-active');
 expect(()=>validateBackupRows(orphaned)).toThrow();
});
