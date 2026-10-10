/** Real Meaning commands over SQLite/Wasm, no provider or fabricated outcome. */
import {afterAll,expect,test} from 'vitest';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {openLibrary,readLibrary,libraryTables} from '../../../apps/web/src/data/library/store';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {LibraryJourneyRepository,semanticJourneyTables} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {manualMeaningPayload,newManualMeaningDraft} from '../../../apps/web/src/experience/intake/manualMeaning';
import {assertPersonalSemanticWorldState,assertPersonalSemanticWorldTransition} from '../../../apps/web/src/experience/personalMeaningJourney/authority';
import {mergeLibraryReplicas} from '../../../apps/web/src/data/library/replication/libraryReplica';
import {encodeBackupValue,decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import type {MeaningJourneyRecord} from '../../../apps/web/src/experience/personalMeaningJourney/store';
import {worldReadRepository} from '../../../apps/web/src/experience/personalMeaningJourney/worldRepository';
import {assertMeaningLifecycleReceipts} from '../../../apps/web/src/experience/personalMeaningJourney/meaningLifecycle';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {personalContentSystem} from '../../../apps/web/src/personalContent/system';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import type {LocalLearningTarget} from '../../../apps/web/src/learning/runtime/localProtocol';
import type {InstalledPackage} from '../../../apps/web/src/data/library/packageRecords';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://meaning-lifecycle.fixture.invalid')});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());await openLibrary();
const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
const id=()=>crypto.randomUUID(),clock=createSeededClock('2026-10-06T10:00:00Z');
const modules=()=>createJourneyModules({repository:new LibraryJourneyRepository(),clock,languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
const record=(key:string)=>readLibrary(tx=>tx.get<MeaningJourneyRecord>('semanticMeanings',key));
const snapshot=()=>readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))));
const entry=(value:MeaningJourneyRecord)=>({table:'semanticMeanings' as const,key:value.personalMeaning.personalMeaningId,value:encodeBackupValue(value)});
const replicas=async(value:MeaningJourneyRecord)=>[entry(value),...await Promise.all(value.personalMeaningRevisions.filter(row=>row.lifecycle).map(async row=>{
 const key=row.provenance.createdByOperationId,receipt=await readLibrary(tx=>tx.get('semanticReceipts',key));
 return {table:'semanticReceipts' as const,key,value:encodeBackupValue(receipt)};
}))];

test('explicit recycle-bin operations preserve identity and original facts, reject stale edits, and cannot be forged by an old replica',async()=>{
 const initial=modules(),payload=manualMeaningPayload({...newManualMeaningDraft(),context:'I forgot my wallet at the cafe and asked to borrow money.',occurrence:'borrow',canonicalForm:'borrow',languageTag:'en',meaning:'暂时借用他人的东西，之后归还。',usage:'向朋友暂借物品或钱，并会归还。'});
 const accepted=await initial.semanticIntake.submit(payload);if(accepted.route!=='fast_track')throw Error('Fixture must explicitly accept a complete Meaning');
 const meaningId=accepted.personalMeaningId,before=(await record(meaningId))!,adapter=await sqliteRecordAdapter();
 const beforeFailure=await snapshot(),commit=adapter.commit.bind(adapter);
 adapter.commit=async()=>{throw Error('controlled_lifecycle_commit_failure');};
 try{await expect(modules().personalMeaningJourney.changeMeaningLifecycle({operationId:id(),personalMeaningId:meaningId,expectedRevision:1,action:'delete'})).rejects.toThrow();}
 finally{adapter.commit=commit;}
 expect(await snapshot()).toEqual(beforeFailure);
 const entries=adapter.entries.bind(adapter),page=adapter.entriesPage.bind(adapter);
 adapter.entries=async table=>{if(table.startsWith('semantic'))throw Error('Lifecycle enumerated the World');return entries(table);};
 adapter.entriesPage=async(table,after,limit)=>{if(table.startsWith('semantic'))throw Error('Lifecycle paged the World');return page(table,after,limit);};
 const request={operationId:id(),personalMeaningId:meaningId,expectedRevision:1,action:'delete' as const};
 try{
  const removed=await modules().personalMeaningJourney.changeMeaningLifecycle(request);
  expect(removed).toMatchObject({personalMeaningId:meaningId,revision:2,lifecycleRevision:2,status:'deleted',replayed:false});
  expect(await modules().personalMeaningJourney.changeMeaningLifecycle(request)).toEqual({...removed,replayed:true});
  await expect(modules().personalMeaningJourney.changeMeaningLifecycle({...request,action:'restore'})).rejects.toThrow();
  const deleted=(await record(meaningId))!;
  const query={query:'',filter:'all' as const,offset:0,limit:64};
  expect((await worldReadRepository.page(query)).total).toBe(0);
  expect((await worldReadRepository.page({...query,filter:'deleted'})).items).toMatchObject([{personalMeaningId:meaningId,status:'deleted'}]);
  expect((await worldReadRepository.detail(meaningId)).detail).toMatchObject({personalMeaningId:meaningId,status:'deleted',revision:2});
  expect((await worldReadRepository.detail(meaningId)).sources).toEqual([]);
  expect(deleted.personalMeaningRevisions[0]).toEqual(before.personalMeaningRevisions[0]);
  expect(deleted.personalMeaningRevisions[1]!.lifecycle).toEqual({kind:'delete',revision:2});
  for(const key of Object.keys(before) as (keyof MeaningJourneyRecord)[])if(key!=='personalMeaning'&&key!=='personalMeaningRevisions')expect(deleted[key]).toEqual(before[key]);
  await expect(modules().personalMeaningJourney.reviseContext({operationId:id(),personalMeaningId:meaningId,expectedRevision:1,blocks:[{kind:'text',bodyText:'stale edit'}]})).rejects.toThrow('localFlow.meaningChanged');
  await expect(modules().personalMeaningJourney.addMaterialBlock({operationId:id(),personalMeaningId:meaningId,block:{kind:'text',bodyText:'tombstone cannot receive material'}})).rejects.toThrow('localFlow.meaningChanged');
  const encodedReceipt=(await adapter.get('semanticReceipts',request.operationId))!;
  await commit({clears:[],deletes:[{table:'semanticReceipts',key:request.operationId}],puts:[]});
  try{
   await expect(modules().personalMeaningJourney.changeMeaningLifecycle({operationId:id(),personalMeaningId:meaningId,expectedRevision:2,action:'restore'})).rejects.toThrow();
   expect((await record(meaningId))!.personalMeaning.status).toBe('deleted');
  }finally{await commit({clears:[],deletes:[],puts:[{table:'semanticReceipts',key:request.operationId,encodedValue:encodedReceipt}]});}
  const restored=await modules().personalMeaningJourney.changeMeaningLifecycle({operationId:id(),personalMeaningId:meaningId,expectedRevision:2,action:'restore'});
  expect(restored).toMatchObject({personalMeaningId:meaningId,revision:3,lifecycleRevision:3,status:'active'});
  const current=(await record(meaningId))!;expect(current.personalMeaningRevisions.slice(0,2)).toEqual(deleted.personalMeaningRevisions);
  expect((await worldReadRepository.page(query)).items).toMatchObject([{personalMeaningId:meaningId,status:'active'}]);
  expect((await worldReadRepository.page({...query,filter:'deleted'})).total).toBe(0);
  expect(current.personalMeaningRevisions[2]!.lifecycle).toEqual({kind:'restore',revision:3});
  expect(current.semanticAcceptances).toEqual(before.semanticAcceptances);
  const senseId=current.alignments[0]!.senseId;
  expect(await worldReadRepository.references([senseId])).toMatchObject([{personalMeaningId:meaningId,senseIds:[senseId]}]);
  expect(await worldReadRepository.references([id()])).toEqual([]);
  await expect(modules().personalMeaningJourney.changeMeaningLifecycle({operationId:id(),personalMeaningId:meaningId,expectedRevision:1,action:'delete'})).rejects.toThrow('localFlow.meaningChanged');
  const baseReplica=await replicas(before),deletedReplica=await replicas(deleted),currentReplica=await replicas(current);
  const oldReplica=mergeLibraryReplicas({base:baseReplica,local:deletedReplica,remote:baseReplica});
  expect(oldReplica.conflicts).toEqual([]);expect((decodeBackupValue(oldReplica.entries[0]!.value) as MeaningJourneyRecord).personalMeaning.status).toBe('deleted');
  const restoreReplica=mergeLibraryReplicas({base:deletedReplica,local:currentReplica,remote:deletedReplica});
  expect(restoreReplica.conflicts).toEqual([]);expect((decodeBackupValue(restoreReplica.entries[0]!.value) as MeaningJourneyRecord).personalMeaning.status).toBe('active');
  const forged=structuredClone(current);delete forged.personalMeaningRevisions[2]!.lifecycle;
  expect(mergeLibraryReplicas({base:deletedReplica,local:[entry(forged),...currentReplica.slice(1)],remote:deletedReplica}).conflicts).toContain(JSON.stringify(['semanticMeanings',meaningId]));
  // A correctly shaped restore is still not an explicit operation if its
  // exact durable receipt is absent or points at another identity/status.
  expect(mergeLibraryReplicas({base:deletedReplica,local:[entry(current),...deletedReplica.slice(1)],remote:deletedReplica}).conflicts).toHaveLength(1);
  const mismatched=structuredClone(currentReplica),restoreReceipt=mismatched.at(-1)!;
  const receipt=decodeBackupValue(restoreReceipt.value) as any;receipt.result.status='deleted';restoreReceipt.value=encodeBackupValue(receipt);
  expect(mergeLibraryReplicas({base:deletedReplica,local:mismatched,remote:deletedReplica}).conflicts).toContain(JSON.stringify(['semanticMeanings',meaningId]));
 }finally{adapter.entries=entries;adapter.entriesPage=page;}
 const state=await new LibraryJourneyRepository().load();assertPersonalSemanticWorldState(state);
 assertMeaningLifecycleReceipts(state.meanings,state.commandReceipts);
 const missingReceipt=state.commandReceipts.filter(receipt=>receipt.operationId!==state.meanings[0]!.personalMeaningRevisions.at(-1)!.provenance.createdByOperationId);
 expect(()=>assertMeaningLifecycleReceipts(state.meanings,missingReceipt)).toThrow();
 const orphan={...state.commandReceipts.find(receipt=>receipt.command==='ChangeMeaningLifecycle')!,operationId:id()};
 const forgedReceiptState={...state,commandReceipts:[...state.commandReceipts,orphan]};
 expect(()=>assertMeaningLifecycleReceipts(forgedReceiptState.meanings,forgedReceiptState.commandReceipts)).toThrow();
 expect(()=>assertPersonalSemanticWorldTransition(state,forgedReceiptState)).toThrow();
 const receiptAdapter=await sqliteRecordAdapter(),encoded=JSON.stringify(encodeBackupValue(orphan));
 await receiptAdapter.commit({clears:[],deletes:[],puts:[{table:'semanticReceipts',key:orphan.operationId,encodedValue:encoded}]});
 try{await expect(new LibraryJourneyRepository().readReceipt(orphan.operationId)).rejects.toThrow();}
 finally{await receiptAdapter.commit({clears:[],deletes:[{table:'semanticReceipts',key:orphan.operationId}],puts:[]});}
 const validReceipt=state.commandReceipts.find(receipt=>receipt.command==='ChangeMeaningLifecycle')!,alias=id(),validEncoded=(await receiptAdapter.get('semanticReceipts',validReceipt.operationId))!;
 await receiptAdapter.commit({clears:[],deletes:[{table:'semanticReceipts',key:validReceipt.operationId}],puts:[{table:'semanticReceipts',key:alias,encodedValue:validEncoded}]});
 try{
  await expect(new LibraryJourneyRepository().readReceipt(alias)).rejects.toThrow();
  await expect(new LibraryJourneyRepository().load()).rejects.toThrow();
 }finally{await receiptAdapter.commit({clears:[],deletes:[{table:'semanticReceipts',key:alias}],puts:[{table:'semanticReceipts',key:validReceipt.operationId,encodedValue:validEncoded}]});}
 const forgedState=structuredClone(state);delete forgedState.meanings[0]!.personalMeaningRevisions[2]!.lifecycle;
 expect(()=>assertPersonalSemanticWorldState(forgedState)).toThrow();
 expect(await readLibrary(tx=>tx.count('learningTargets'))).toBe(0);expect(await readLibrary(tx=>tx.count('learningRuns'))).toBe(0);
});

test('deleting and restoring an accepted personal learning scene does not cascade into real saved learning outcomes',async()=>{
 const fixture=portableBookDeliveryFixture({packageId:id(),expression:'borrow-linked'}),fetch=globalThis.fetch,context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
 globalThis.fetch=async()=>new Response(new Uint8Array(fixture.bookBytes).buffer);
 try{await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:fixture.descriptor,signal:new AbortController().signal});}finally{globalThis.fetch=fetch;}
 await learningSystem.execute({kind:'enroll_book',operationId:id(),languageContext:context,publicationArchiveSha256:fixture.descriptor.sha256});
 const target=(await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'))).find(target=>target.expression==='borrow-linked')!;
 await learningSystem.execute({kind:'start',operationId:id(),targetId:target.id,languageContext:context,dailyLimit:20});
 const runtime=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
 if(runtime.kind!=='lightweight')throw Error('Fixture must use the shipped lightweight policy');
 const selected=runtime.target,pack=await readLibrary(tx=>tx.get<InstalledPackage>('packageCache',selected.packageKey!));
 const entry=pack!.content.entries.find(entry=>entry.senseVersionId===selected.identity.senseVersionId&&entry.bindingVersionId===selected.identity.bindingVersionId)!,publication=pack!.portableOrigin.publications[0]!;
 const {scene}=await personalContentSystem.execute({kind:'save_learning_scene',operationId:id(),learningTargetId:target.id,languageRouteId:context.languageRouteId,curriculumMembershipId:selected.curriculumMembershipId,senseId:selected.identity.senseId,senseVersionId:selected.identity.senseVersionId,bindingVersionId:selected.identity.bindingVersionId,body:'忘带钱包时，向朋友借钱，并约定归还。',media:[],expected:null});
 const sceneRead={kind:'learning_scene' as const,learningTargetId:target.id,languageRouteId:context.languageRouteId},sceneAdapter=await sqliteRecordAdapter(),sceneEntries=sceneAdapter.entries.bind(sceneAdapter);
 try{
  sceneAdapter.entries=async table=>{if(table==='annotations')throw Error('exact scene editor must not scan annotations/media');return sceneEntries(table);};
  expect(await personalContentSystem.readScene(sceneRead)).toEqual(scene);
 }finally{sceneAdapter.entries=sceneEntries;}
 const revision=scene.revisions.at(-1)!;
 const accepted=await modules().personalMeaningJourney.acceptPublishedLearningScene({operationId:id(),existingPersonalMeaningId:null,source:{packageKey:pack!.key,bookId:publication.book.bookId,bookVersionId:publication.book.bookVersionId,contentReleaseId:publication.contentRelease.contentReleaseId,publishedAt:publication.publishedAt,title:publication.book.title},target:{learningTargetId:target.id,curriculumMembershipId:selected.curriculumMembershipId,...selected.identity,expression:selected.presentation.expression,targetLanguageTag:selected.presentation.targetLanguageTag},semantic:entry.semantic!,scene:{...revision,sceneId:scene.sceneId}});
 await personalContentSystem.execute({kind:'mark_learning_scene_accepted',operationId:id(),sceneId:scene.sceneId,revisionId:revision.revisionId,personalMeaningId:accepted.personalMeaningId});
 for(const action of [{kind:'reveal'} as const,{kind:'rate',rating:'good'} as const]){
  const current=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
  await learningSystem.execute({kind:'act',operationId:id(),runId:current.runId,expectedRevision:current.revision,action});
 }
 const before=await snapshot() as BackupRows;validateBackupRows(before);
 expect(before.learningTargets).toHaveLength(1);expect(before.learningRuns).toHaveLength(1);expect(before.learningEvents.length).toBeGreaterThan(0);
 expect(before.learningTargets[0]!.value.memory).not.toBeNull();expect(before.learningTargets[0]!.value.memoryRevision).toBeGreaterThan(0);
 const frozen=['learningTargets','learningRuns','learningEvents','learningSessions','studyScopes','curriculumEnrollments','supplementalMembershipStates','annotations','personalLearning'] as const;
 const original=(await record(accepted.personalMeaningId))!;
 const deleted=await modules().personalMeaningJourney.changeMeaningLifecycle({operationId:id(),personalMeaningId:accepted.personalMeaningId,expectedRevision:original.personalMeaning.currentRevision,action:'delete'});
 const removed=await snapshot() as BackupRows;validateBackupRows(removed);
 for(const table of frozen)expect(removed[table]).toEqual(before[table]);
 await modules().personalMeaningJourney.changeMeaningLifecycle({operationId:id(),personalMeaningId:accepted.personalMeaningId,expectedRevision:deleted.revision,action:'restore'});
 const restored=await snapshot() as BackupRows;validateBackupRows(restored);
 for(const table of frozen)expect(restored[table]).toEqual(before[table]);
 expect((await record(accepted.personalMeaningId))!.semanticAcceptances).toEqual(original.semanticAcceptances);
 const semanticReplica=(rows:BackupRows)=>semanticJourneyTables.flatMap(table=>rows[table].map(row=>({table,key:row.key,value:encodeBackupValue(row.value)})));
 expect(mergeLibraryReplicas({base:semanticReplica(before),local:semanticReplica(restored),remote:semanticReplica(before)}).conflicts,'receipts are partitioned by Meaning, not mistaken for orphan witnesses on another Meaning').toEqual([]);
});
