import {afterAll,expect,test} from 'vitest';
import {randomUUID} from 'node:crypto';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {openLibrary,readLibrary,readRuntimeLearningCandidates,libraryTables} from '../../../apps/web/src/data/library/store';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';
import type {LocalLearningTarget} from '../../../apps/web/src/learning/runtime/localProtocol';
import type {LocalStudyScope} from '../../../apps/web/src/data/library/studyScopes';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('https://supplemental.fixture.invalid/')});
const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());await openLibrary();
const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute),fixture=portableBookDeliveryFixture({packageId:randomUUID(),memberExpressions:['retained','pending','overlapping']});
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(new Uint8Array(fixture.bookBytes).buffer);
try{await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:fixture.descriptor,signal:new AbortController().signal});}finally{globalThis.fetch=originalFetch;}
await learningSystem.execute({kind:'confirm_quantity',operationId:randomUUID(),languageContext:context,dailyLimit:20});
async function enroll(expression:string){
 const choice=(await learningSystem.read({kind:'direct_choices',query:expression,targetLanguageTag:'en',page:0})).items.find(item=>item.expression===expression)!;
 const source=await learningSystem.read({kind:'direct_source',reference:choice.reference});
 return learningSystem.execute({kind:'enroll_direct',operationId:randomUUID(),reference:choice.reference,expectedDigest:source.sourceDigest,languageContext:context});
}
const retained=await enroll('retained'),pending=await enroll('pending'),overlapping=await enroll('overlapping');
const sourceFor=(id:string)=>({kind:'stable_sense' as const,id});
const change=(id:string,expectedRevision:number,active:boolean,operationId=randomUUID())=>learningSystem.execute({kind:'change_supplemental_membership',operationId,source:sourceFor(id),expectedRevision,active,languageContext:context});
const targets=()=>readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'));

test('pending accepted source can be removed before materialization; preparation is blocked without fabricating a Target',async()=>{
 expect(await targets()).toEqual([]);
 const operationId=randomUUID();await change(pending.enrollmentId!,0,false,operationId);
 await change(pending.enrollmentId!,0,false,operationId); // Same intent receipt, not another decision.
 expect(await targets()).toEqual([]);
 await expect(learningSystem.execute({kind:'prepare_direct',operationId:randomUUID(),enrollmentId:pending.enrollmentId!})).rejects.toThrow('localFlow.membershipRemoved');
 expect((await learningSystem.read({kind:'direct_enrollment',enrollmentId:pending.enrollmentId!}))!.status).toBe('removed');
 const row=(await learningSystem.read({kind:'supplemental_memberships',languageContext:context})).members.find(item=>item.source.id===pending.enrollmentId)!;
 expect(row).toMatchObject({revision:1,active:false,readiness:'preparing'});
 await expect(change(pending.enrollmentId!,0,true)).rejects.toThrow('localFlow.membershipChanged');
 await change(pending.enrollmentId!,1,true);
 await learningSystem.execute({kind:'prepare_direct',operationId:randomUUID(),enrollmentId:pending.enrollmentId!});
 expect((await targets()).map(target=>target.id)).toEqual([pending.targetId]);
});

test('ready removal affects future candidates, not an active Scope or Target, and restoration resumes original work',async()=>{
 await learningSystem.execute({kind:'prepare_direct',operationId:randomUUID(),enrollmentId:retained.enrollmentId!});
 await learningSystem.execute({kind:'start',operationId:randomUUID(),targetId:retained.targetId,languageContext:context,dailyLimit:20});
 const runtime=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
 const before=await readLibrary(async tx=>({target:await tx.get('learningTargets',retained.targetId),run:await tx.get<any>('learningRuns',runtime.runId),scopes:await tx.all<LocalStudyScope>('studyScopes')}));
 await change(retained.enrollmentId!,0,false);
 expect(await readLibrary(tx=>tx.get('learningTargets',retained.targetId))).toEqual(before.target);
 expect(await readLibrary(tx=>tx.get('learningRuns',runtime.runId))).toEqual(before.run);
 expect(await readLibrary(tx=>tx.all('studyScopes'))).toEqual(before.scopes);
 const workspace=await learningSystem.read({kind:'workspace',languageContext:context});
 expect(workspace.queue.initialReadyTargetIds).not.toContain(retained.targetId);
 const query={languageContext:context,clock:Date.now(),dailyLimit:20,supportedPolicies:['lightweight'],currentTargetIds:[],retryTargetIds:[]};
 expect((await readRuntimeLearningCandidates(query)).initialReady.map(item=>item.id)).not.toContain(retained.targetId);
 expect((await readRuntimeLearningCandidates({...query,scopeRevisionId:before.run.studyScopeRevisionId})).initialReady.map(item=>item.id)).toContain(retained.targetId);
 expect((await learningSystem.read({kind:'home',languageContext:context})).readyInitialCount).toBe(1);
 expect((await learningSystem.read({kind:'runtime',languageContext:context})).runtime!.runId).toBe(runtime.runId);
 await learningSystem.execute({kind:'end_session',operationId:randomUUID(),runId:runtime.runId,expectedRevision:before.run.revision});
 await expect(learningSystem.execute({kind:'start',operationId:randomUUID(),targetId:retained.targetId,languageContext:context,dailyLimit:20})).rejects.toThrow('localFlow.routeMembershipMissing');
 expect((await learningSystem.read({kind:'target',targetId:retained.targetId,languageContext:context})).target?.planningActive).toBe(false);
 await change(retained.enrollmentId!,1,true);
 expect((await learningSystem.read({kind:'target',targetId:retained.targetId,languageContext:context})).target?.planningActive).toBe(true);
 await learningSystem.execute({kind:'start',operationId:randomUUID(),targetId:retained.targetId,languageContext:context,dailyLimit:20});
 expect((await learningSystem.read({kind:'runtime',languageContext:context})).runtime!.runId).toBe(runtime.runId);
 expect(await readLibrary(tx=>tx.get('learningTargets',retained.targetId))).toEqual(before.target);
 const scopes=await readLibrary(tx=>tx.all<LocalStudyScope>('studyScopes'));
 expect(scopes.some(scope=>scope.members.some(member=>member.sources.some(source=>source.supplementalState?.revision===2)))).toBe(true);
});

test('another active Book source preserves coverage; restore never duplicates the shared Target or learning history',async()=>{
 await learningSystem.execute({kind:'prepare_direct',operationId:randomUUID(),enrollmentId:overlapping.enrollmentId!});
 await learningSystem.execute({kind:'enroll_book',operationId:randomUUID(),languageContext:context,publicationArchiveSha256:fixture.descriptor.sha256});
 const before=(await targets()).find(target=>target.id===overlapping.targetId)!;
 expect(before.curriculumMemberships).toHaveLength(2);
 await change(overlapping.enrollmentId!,0,false);
 expect((await learningSystem.read({kind:'workspace',languageContext:context})).queue.initialReadyTargetIds).toContain(overlapping.targetId);
 const direct=await enroll('overlapping');expect(direct.status).toBe('already_in_scope');expect(direct.enrollmentId).toBeNull();
 await change(overlapping.enrollmentId!,1,true);
 expect((await targets()).find(target=>target.id===overlapping.targetId)).toEqual(before);
 expect((await targets()).filter(target=>target.id===overlapping.targetId)).toHaveLength(1);
 const rows=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)])))) as BackupRows;
 expect(()=>validateBackupRows(rows)).not.toThrow();
 const corrupted=structuredClone(rows);corrupted.supplementalMembershipStates[0]!.value.targetId=randomUUID();
 expect(()=>validateBackupRows(corrupted)).toThrow();
});

test('actual supplemental decision/index commit rolls back together and competing stale revisions settle once',async()=>{
 const raw=Reflect.get(database,'database'),exec=raw.exec.bind(raw);
 const before=database.entries('supplementalMembershipStates');
 const beforeIndex=raw.exec({sql:'SELECT * FROM sensa_runtime_supplemental_states ORDER BY source_key',rowMode:'object',returnValue:'resultRows'}),beforeReceipts=database.entries('operations');
 let interrupted=false;
 raw.exec=(input:any)=>{if((typeof input==='string'?input:input.sql).startsWith('INSERT INTO sensa_runtime_supplemental_states')){interrupted=true;throw Error('fixture supplemental index interrupted');}return exec(input);};
 try{await expect(change(pending.enrollmentId!,2,false)).rejects.toThrow('localFlow.storageWrite');}finally{raw.exec=exec;}
 expect(interrupted).toBe(true);
 expect(database.entries('supplementalMembershipStates')).toEqual(before);
 expect(raw.exec({sql:'SELECT * FROM sensa_runtime_supplemental_states ORDER BY source_key',rowMode:'object',returnValue:'resultRows'})).toEqual(beforeIndex);
 expect(database.entries('operations')).toEqual(beforeReceipts);
 const competing=await Promise.allSettled([change(pending.enrollmentId!,2,false),change(pending.enrollmentId!,2,false)]);
 expect(competing.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 expect(competing.filter(result=>result.status==='rejected')).toHaveLength(1);
 expect((await learningSystem.read({kind:'direct_enrollment',enrollmentId:pending.enrollmentId!}))!.membershipRevision).toBe(3);
 await change(pending.enrollmentId!,3,true);
});

test('supplemental management reads bounded pages of real accepted intents without complete table enumeration',async()=>{
 const extra=portableBookDeliveryFixture({packageId:randomUUID(),memberExpressions:Array.from({length:61},(_,index)=>`page-target-${index}`)});
 const fetchBefore=globalThis.fetch;globalThis.fetch=async()=>new Response(new Uint8Array(extra.bookBytes).buffer);
 try{await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:extra.descriptor,signal:new AbortController().signal});}finally{globalThis.fetch=fetchBefore;}
 const choices=[];
 for(let page=0;;page++){const result=await learningSystem.read({kind:'direct_choices',query:'page-target',targetLanguageTag:'en',page});choices.push(...result.items);if(!result.hasMore)break;}
 expect(choices).toHaveLength(61);
 for(const choice of choices){const source=await learningSystem.read({kind:'direct_source',reference:choice.reference});await learningSystem.execute({kind:'enroll_direct',operationId:randomUUID(),reference:choice.reference,expectedDigest:source.sourceDigest,languageContext:context});}
 const adapter=await sqliteRecordAdapter(),entries=adapter.entries.bind(adapter);
 adapter.entries=async table=>{if(['curriculumEnrollments','personalLearning'].includes(table))throw Error('supplemental management enumerated complete intents');return entries(table);};
 try{
  const first=await learningSystem.read({kind:'supplemental_memberships',languageContext:context});
  expect(first.members).toHaveLength(50);expect(first.nextCursor).not.toBeNull();
  const second=await learningSystem.read({kind:'supplemental_memberships',languageContext:context,cursor:first.nextCursor});
  expect(second.members).toHaveLength(14);expect(second.nextCursor).toBeNull();
  expect(new Set([...first.members,...second.members].map(member=>member.id)).size).toBe(64);
  await expect(learningSystem.read({kind:'supplemental_memberships',languageContext:{...context,supportLanguageTag:'ja'},cursor:first.nextCursor})).rejects.toThrow();
 }finally{adapter.entries=entries;}
});
