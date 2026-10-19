import {checkLearnerProjectionScale} from '../support/learnerProjectionScale.mts';
import {afterAll,expect,test} from 'vitest';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {personalContentSystem} from '../../../apps/web/src/personalContent/system';
import {buildLearnerSemanticProjection,learnerSemanticProjectionSystem} from '../../../apps/web/src/learnerSemanticProjection/system/learnerSemanticProjectionSystem';
import {openLibrary,readLibrary} from '../../../apps/web/src/data/library/store';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {PRACTICE_SENSES} from '../../../apps/web/src/experience/practiceData';
import {materialSourcePin} from '../../../apps/web/src/learning/runtime/learningIdentity';
import type {LocalLearningTarget} from '../../../apps/web/src/learning/runtime/localProtocol';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());
let seed:LocalLearningTarget;

test('real nonbundled learning references and notes are findable before rating without invented learning; saved memory and explicit mastery drive their lists',async()=>{
 const id=()=>crypto.randomUUID(),context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
 expect(personalContentSystem.read({kind:'snapshot'}).status).toBe('loading');
 await openLibrary();const fixture=portablePackageFixture({packageId:id(),expression:'borrow'});
 const pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
 const targetId=(await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext:context}))[0]!;
 const target=await learningSystem.read({kind:'target',targetId,languageContext:context});if(!target.target)throw Error('missing real target');
 const senseId=target.target.identity.senseId;
 await personalContentSystem.execute({kind:'set_saved_sense',operationId:id(),senseId,saved:true});
 await personalContentSystem.execute({kind:'set_sense_note',operationId:id(),senseId,body:'向朋友暂借物品，之后归还。',expected:await personalContentSystem.readSenseNote(senseId)});
 const first=await learningSystem.read({kind:'semantic_memory'}),before=buildLearnerSemanticProjection(first.targets);
 expect(before.savedSenses).toEqual([{kind:'learning_target',targetId,senseId,word:'borrow',meaning:target.target.presentation.meaning}]);
 expect(before.notes[0]).toMatchObject({word:'borrow',body:'向朋友暂借物品，之后归还。',reference:{kind:'learning_target',targetId,senseId}});
 expect(before.recent).toEqual([]);expect(before.learned).toEqual([]);expect(before.known).toEqual([]);expect(before.semanticSenses).toEqual([]);
 expect(await readLibrary(tx=>tx.all('semanticMeanings'))).toEqual([]);
 expect(await readLibrary(tx=>tx.all('learningEvents'))).toEqual([]);
 const statusAdapter=await sqliteRecordAdapter(),statusEntries=statusAdapter.entries.bind(statusAdapter);let stop:()=>void=()=>undefined;
 try{
  statusAdapter.entries=async(table)=>{if(table==='annotations')throw Error('controlled_annotation_read_failure');return statusEntries(table);};
  await expect(personalContentSystem.refresh()).rejects.toThrow('localFlow.storageWrite');
  expect(personalContentSystem.read({kind:'snapshot'}).status).toBe('error');
  expect(buildLearnerSemanticProjection(first.targets).personalReferenceStatus).toBe('error');
  stop=learnerSemanticProjectionSystem.subscribe(()=>undefined);
  await expect.poll(()=>learnerSemanticProjectionSystem.read().learningStatus).toBe('ready');
  await expect.poll(()=>learnerSemanticProjectionSystem.read().personalReferenceStatus).toBe('error');
  statusAdapter.entries=statusEntries;
  learnerSemanticProjectionSystem.retryReferences();
  await expect.poll(()=>learnerSemanticProjectionSystem.read().personalReferenceStatus).toBe('ready');
  expect(learnerSemanticProjectionSystem.read().savedSenses).toEqual(before.savedSenses);
  expect(learnerSemanticProjectionSystem.read().notes).toEqual(before.notes);
  expect(await personalContentSystem.readSenseNote(senseId)).toEqual({body:'向朋友暂借物品，之后归还。',revision:1});
 }finally{statusAdapter.entries=statusEntries;stop();}
 await learningSystem.execute({kind:'start',operationId:id(),targetId,languageContext:context,dailyLimit:20});
 let runtime=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
 await learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'reveal'}});
 runtime=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
 await learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'rate',rating:'good'}});
 const learned=buildLearnerSemanticProjection((await learningSystem.read({kind:'semantic_memory'})).targets);
 seed=(await readLibrary(tx=>tx.get<LocalLearningTarget>('learningTargets',targetId)))!;
 expect(learned.recent).toHaveLength(1);expect(learned.learned).toHaveLength(1);expect(learned.known).toEqual([]);expect(learned.semanticSenses[0]).toMatchObject({senseId,targetId});
 await learningSystem.execute({kind:'finish',operationId:id(),runId:runtime.runId});
 await learningSystem.execute({kind:'set_declared_mastery',operationId:id(),targetId,active:true,languageContext:context});
 const knownHeaders=(await learningSystem.read({kind:'semantic_memory'})).targets;
 const known=buildLearnerSemanticProjection(knownHeaders);
 expect(known.known).toEqual(known.learned);
 const declared=knownHeaders[0]!;
 const newerUnmarked={...declared,targetId:id(),declaredMastery:false,presentation:{...declared.presentation,expression:'a different unmarked expression'},memory:{...declared.memory!,fsrsLastReviewedAt:new Date(Date.now()+60_000)}};
 expect(buildLearnerSemanticProjection([newerUnmarked,...knownHeaders]).known,'pure projection must not transfer a declaration to another Target sharing its Sense').toEqual(known.known);
 const related=buildLearnerSemanticProjection([newerUnmarked,...knownHeaders]);expect(related.learned).toHaveLength(2);expect(related.recent.map(item=>item.kind==='learning_target'?item.targetId:null)).toEqual([newerUnmarked.targetId,declared.targetId]);
 expect(buildLearnerSemanticProjection([{...newerUnmarked,declaredMastery:true},...knownHeaders]).known,'each explicitly known Retention Target must remain findable').toHaveLength(2);
 const adapter=await sqliteRecordAdapter(),get=adapter.get.bind(adapter),entries=adapter.entries.bind(adapter),page=adapter.entriesPage.bind(adapter);
 try{
  adapter.get=async(table,key)=>{if(['learningTargets','learningRuns','learningEvents','packageCache','media'].includes(table))throw Error('header reader hydrated source material');return get(table,key);};
  adapter.entries=async(table)=>{if(['learningTargets','learningRuns','learningEvents','packageCache','media'].includes(table))throw Error('header reader scanned collection/history');return entries(table);};
  adapter.entriesPage=async(table,after,limit)=>{if(['learningTargets','learningRuns','learningEvents','packageCache','media'].includes(table))throw Error('header reader paged source material');return page(table,after,limit);};
  expect((await learningSystem.read({kind:'semantic_memory'})).targets).toHaveLength(1);
  expect((await learningSystem.read({kind:'personal_enrollment_index'})).targets).toEqual([{targetId,identity:{senseId:seed.identity.senseId,expressionId:seed.identity.expressionId},memberships:seed.curriculumMemberships.map(member=>({id:member.id,status:member.status??'active',bindingVersionId:materialSourcePin(member.material).bindingVersionId,languageContext:member.languageContext}))}]);
  expect((await learningSystem.read({kind:'semantic_memory',targetId})).targets[0]?.targetId).toBe(targetId);
  const exact=(await learningSystem.read({kind:'personal_enrollment_index',languageContext:context})).targets;expect(exact).toHaveLength(1);
  expect((await learningSystem.read({kind:'personal_enrollment_index',languageContext:{...context,languageRouteId:id()}})).targets).toEqual([]);
  expect((await learningSystem.read({kind:'personal_enrollment_index',languageContext:{...context,supportLanguageTag:'fr'}})).targets).toEqual([]);
  const readIndex=adapter.personalEnrollmentIndex.bind(adapter),base=exact[0]!;
  try{
   adapter.personalEnrollmentIndex=async()=>({targets:[{...base,memberships:[...base.memberships,{...base.memberships[0]!,id:'other-route',languageContext:{...context,languageRouteId:id()}},{...base.memberships[0]!,id:'other-support',languageContext:{...context,supportLanguageTag:'fr'}},{...base.memberships[0]!,id:'superseded',status:'superseded'}]}]});
   expect((await learningSystem.read({kind:'personal_enrollment_index',languageContext:context})).targets).toEqual(exact);
  }finally{adapter.personalEnrollmentIndex=readIndex;}

 }finally{adapter.get=get;adapter.entries=entries;adapter.entriesPage=page;}
 seed=(await readLibrary(tx=>tx.get<LocalLearningTarget>('learningTargets',targetId)))!;
});

test('retained Example visibility uses owner annotations and preserves an unavailable source without inventing content or learning',async()=>{
 const known=PRACTICE_SENSES[0];if(!known)throw Error('Missing actual bundled Example');
 const missingId=crypto.randomUUID(),before=(await learningSystem.read({kind:'semantic_memory'})).targets;
 await personalContentSystem.execute({kind:'set_saved_example',operationId:crypto.randomUUID(),exampleId:known.example.exampleId,saved:true});
 await personalContentSystem.execute({kind:'set_saved_example',operationId:crypto.randomUUID(),exampleId:missingId,saved:true});
 const retained=await readLibrary(tx=>tx.entries('annotations')),projection=buildLearnerSemanticProjection();
 expect(projection.savedExampleCount).toBe(2);expect(projection.savedExamples).toEqual([{exampleId:known.example.exampleId,sense:known}]);
 await personalContentSystem.refresh();expect(await readLibrary(tx=>tx.entries('annotations'))).toEqual(retained);
 await personalContentSystem.execute({kind:'set_saved_example',operationId:crypto.randomUUID(),exampleId:known.example.exampleId,saved:false});
 const unavailable=buildLearnerSemanticProjection();expect(unavailable.savedExampleCount).toBe(1);expect(unavailable.savedExamples).toEqual([]);
 expect(personalContentSystem.read({kind:'snapshot'}).savedExampleIds).toEqual(new Set([missingId]));
 expect((await learningSystem.read({kind:'semantic_memory'})).targets).toEqual(before);
 await personalContentSystem.execute({kind:'set_saved_example',operationId:crypto.randomUUID(),exampleId:missingId,saved:false});
});

test('bounded read projection preserves exact facts, rebuilds metadata and rolls back failed derived writes',()=>checkLearnerProjectionScale(seed,64));
