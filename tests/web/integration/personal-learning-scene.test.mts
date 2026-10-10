/** Actual admitted Book and SQLite/Wasm commands; no provider or fabricated outcomes. */
import {afterAll,expect,test} from 'vitest';
import {canonicalJsonDigest} from '@sensa/learning-kernel';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {openLibrary,readLibrary} from '../../../apps/web/src/data/library/store';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {libraryTables} from '../../../apps/web/src/data/library/store';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {personalContentSystem,currentPersonalLearningSceneRevision,type PersonalLearningScene} from '../../../apps/web/src/personalContent/system';
import type {LocalLearningTarget} from '../../../apps/web/src/learning/runtime/localProtocol';
import {createJourneyGateway} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {LibraryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import type {PublishedLearningSceneAcceptanceInput} from '../../../apps/web/src/experience/personalMeaningJourney/types';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://personal-learning-scene.fixture.invalid')});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());await openLibrary();
const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
const id=()=>crypto.randomUUID(),context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
const editBase=(scene:PersonalLearningScene|null)=>{
 const revision=scene&&currentPersonalLearningSceneRevision(scene);
 return revision?{revisionId:revision.revisionId,contentDigest:canonicalJsonDigest({body:revision.body,media:revision.media})}:null;
};
async function startedBook(){
 const expression='borrow-scene-'+id(),fixture=portableBookDeliveryFixture({packageId:id(),expression}),fetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(new Uint8Array(fixture.bookBytes).buffer);
 try{await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:fixture.descriptor,signal:new AbortController().signal});}finally{globalThis.fetch=fetch;}
 await learningSystem.execute({kind:'enroll_book',operationId:id(),languageContext:context,publicationArchiveSha256:fixture.descriptor.sha256});
 const target=(await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'))).find(target=>target.expression===expression)!;
 await learningSystem.execute({kind:'start',operationId:id(),targetId:target.id,languageContext:context,dailyLimit:20});
 const runtime=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
 if(runtime.kind!=='lightweight')throw Error('Fixture requires the public lightweight path');
 const selected=runtime.target;
 return {selected,query:{kind:'learning_scene' as const,learningTargetId:target.id,languageRouteId:context.languageRouteId},
  input:{kind:'save_learning_scene' as const,learningTargetId:target.id,languageRouteId:context.languageRouteId,curriculumMembershipId:selected.curriculumMembershipId,senseId:selected.identity.senseId,senseVersionId:selected.identity.senseVersionId,bindingVersionId:selected.identity.bindingVersionId,media:[]}};
}
const learningFacts=()=>readLibrary(async tx=>Object.fromEntries(await Promise.all((['learningTargets','learningRuns','learningEvents','learningSessions','studyScopes'] as const).map(async table=>[table,await tx.entries(table)]))));

test('scene edits require the actual read version; stale drafts cannot replace the current scene or change learning',async()=>{
 const {input,query}=await startedBook(),before=await learningFacts();
 expect(await personalContentSystem.readScene(query)).toBeNull();
 const {scene:first}=await personalContentSystem.execute({...input,operationId:id(),body:'昨天向同事借伞，第二天归还。',expected:null});
 const original=currentPersonalLearningSceneRevision(first)!,base=editBase(first);
 const {scene:second}=await personalContentSystem.execute({...input,operationId:id(),body:'下雨时向同事借了一把蓝色雨伞，并约好明天归还。',expected:base});
 const stale={...input,operationId:id(),body:'旧编辑器里还没保存的借伞经历。',expected:base};
 await expect(personalContentSystem.execute(stale)).rejects.toThrow('sceneChanged');
 expect(await personalContentSystem.readScene(query)).toEqual(second);
 expect(await readLibrary(tx=>tx.get('operations',stale.operationId))).toBeUndefined();
 expect(second.sceneId).toBe(first.sceneId);
 expect(second.revisions[0]).toEqual(original);
 expect(await learningFacts()).toEqual(before);
 const {scene:explicit}=await personalContentSystem.execute({...stale,operationId:id(),expected:editBase(second)});
 expect(explicit.sceneId).toBe(first.sceneId);
 expect(explicit.revisions.slice(0,2)).toEqual(second.revisions);
 expect(currentPersonalLearningSceneRevision(explicit)?.body).toBe(stale.body);
 expect(await learningFacts()).toEqual(before);

 const adapter=await sqliteRecordAdapter(),commit=adapter.commit.bind(adapter),entries=adapter.entries.bind(adapter);
 const retry={...input,operationId:id(),body:'保存响应丢失时仍保留的场景。',expected:editBase(explicit)};
 try{
  adapter.commit=async()=>{throw Error('controlled_scene_commit_failure');};
  await expect(personalContentSystem.execute(retry)).rejects.toThrow();
 }finally{adapter.commit=commit;}
 expect(await personalContentSystem.readScene(query)).toEqual(explicit);
 expect(await readLibrary(tx=>tx.get('operations',retry.operationId))).toBeUndefined();
 try{
  adapter.commit=async mutation=>{await commit(mutation);throw Error('controlled_scene_receipt_loss');};
  await expect(personalContentSystem.execute(retry)).rejects.toThrow();
 }finally{adapter.commit=commit;}
 const committed=(await personalContentSystem.readScene(query))!;
 const later=await personalContentSystem.execute({...input,operationId:id(),body:'在另一个编辑器确认后保存的新场景。',expected:editBase(committed)});
 expect((await personalContentSystem.execute(retry)).scene).toEqual(committed);
 expect(await personalContentSystem.readScene(query)).toEqual(later.scene);
 await expect(personalContentSystem.execute({...retry,body:'改变原重试内容'})).rejects.toThrow('operationConflict');

 let readFailure;
 try{
  adapter.entries=async table=>{if(table==='annotations')throw Error('controlled_scene_list_read_failure');return entries(table);};
  readFailure=await personalContentSystem.execute({...input,operationId:id(),body:'已提交，但列表暂时无法重读的场景。',expected:editBase(later.scene)});
  expect(readFailure.projectionUpdated).toBe(false);
  expect(personalContentSystem.read({kind:'snapshot'}).status).toBe('error');
  expect(await personalContentSystem.readScene(query)).toEqual(readFailure.scene);
 }finally{adapter.entries=entries;}
 await personalContentSystem.refresh();
 expect(personalContentSystem.read({kind:'snapshot'}).status).toBe('ready');
 expect(await learningFacts()).toEqual(before);

 // Historical references already exist in the action authority. Editing the
 // private scaffold must not require a second Run/material snapshot mechanism.
 const act=async(action:{kind:'reveal'}|{kind:'rate';rating:'good'})=>{
  const runtime=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
  return learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action});
 };
 await act({kind:'reveal'});
 const revealedEvents=await readLibrary(tx=>tx.entries<{detail:{personalLearningScene:unknown}}>('learningEvents'));
 const revealedPin={sceneId:readFailure!.scene.sceneId,revisionId:currentPersonalLearningSceneRevision(readFailure!.scene)!.revisionId,revision:readFailure!.scene.currentRevision};
 expect(revealedEvents.some(row=>canonicalJsonDigest(row.value.detail.personalLearningScene)===canonicalJsonDigest(revealedPin))).toBe(true);
 const learningBeforeEdit=await learningFacts();
 const next=await personalContentSystem.execute({...input,operationId:id(),body:'下一次动作前，明确改写的新私人场景。',expected:editBase(readFailure!.scene)});
 expect(await learningFacts()).toEqual(learningBeforeEdit);
 await act({kind:'rate',rating:'good'});
 const afterEvents=await readLibrary(tx=>tx.entries<{detail:{personalLearningScene:unknown}}>('learningEvents'));
 for(const old of revealedEvents)expect(afterEvents.find(row=>row.key===old.key)).toEqual(old);
 const nextPin={sceneId:next.scene.sceneId,revisionId:currentPersonalLearningSceneRevision(next.scene)!.revisionId,revision:next.scene.currentRevision};
 expect(afterEvents.some(row=>canonicalJsonDigest(row.value.detail.personalLearningScene)===canonicalJsonDigest(nextPin))).toBe(true);
 const snapshot=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))));
 validateBackupRows(snapshot as BackupRows);
});

test('published scene acceptance reads only its indexed owner and fixed facts, including missing-link recovery and competing saves',async()=>{
 const {input,query,selected}=await startedBook();
 const {scene}=await personalContentSystem.execute({...input,operationId:id(),body:'借了朋友的伞，约好明天还。',expected:null});
 const pack=(await contentSupplySystem.read({kind:'workspace'})).packages.find(pack=>pack.key===selected.packageKey)!;
 const publication=pack.portableOrigin.publications.find(item=>item.bookArchiveSha256===selected.publicationArchiveSha256)!;
 const entry=pack.content.entries.find(item=>item.senseVersionId===selected.identity.senseVersionId&&item.bindingVersionId===selected.identity.bindingVersionId)!;
 const request:PublishedLearningSceneAcceptanceInput={operationId:id(),existingPersonalMeaningId:null,
  source:{packageKey:pack.key,bookId:publication.book.bookId,bookVersionId:publication.book.bookVersionId,contentReleaseId:publication.contentRelease.contentReleaseId,publishedAt:publication.publishedAt,title:publication.book.title},
  target:{learningTargetId:selected.targetId,curriculumMembershipId:selected.curriculumMembershipId,senseId:selected.identity.senseId,senseVersionId:selected.identity.senseVersionId,bindingId:selected.identity.bindingId,bindingVersionId:selected.identity.bindingVersionId,expression:selected.presentation.expression,targetLanguageTag:selected.presentation.targetLanguageTag},
  semantic:entry.semantic!,scene:{...currentPersonalLearningSceneRevision(scene)!,sceneId:scene.sceneId}};
 const adapter=await sqliteRecordAdapter(),page=adapter.entriesPage.bind(adapter),commit=adapter.commit.bind(adapter),factsBefore=await learningFacts();
 const gateway=()=>createJourneyGateway({repository:new LibraryJourneyRepository()});
 let result:Awaited<ReturnType<ReturnType<typeof gateway>['acceptPublishedLearningScene']>>;
 try{
  adapter.entriesPage=async(table,...args)=>{if(table.startsWith('semantic'))throw Error('must_not_enumerate_the_world');return page(table,...args);};
  const competing=await Promise.allSettled([gateway().acceptPublishedLearningScene(request),gateway().acceptPublishedLearningScene(request)]);
  expect(competing.filter(row=>row.status==='fulfilled')).toHaveLength(2);
  result=(competing[0] as PromiseFulfilledResult<typeof result>).value;
  expect((competing[1] as PromiseFulfilledResult<typeof result>).value.personalMeaningId).toBe(result.personalMeaningId);
  expect(await adapter.worldSceneMeaning(scene.sceneId)).toBe(result.personalMeaningId);
  const retry=await gateway().acceptPublishedLearningScene(request);expect(retry.replayed).toBe(true);expect(retry.personalMeaningId).toBe(result.personalMeaningId);
  // The first owner commit is real, but the independent annotation link has
  // deliberately not been submitted. A later version still finds that owner.
  expect((await personalContentSystem.readScene(query))!.acceptedPersonalMeaningId).toBeNull();
  const next=await personalContentSystem.execute({...input,operationId:id(),body:'把借来的雨伞用完后归还给朋友。',expected:editBase(scene)});
  const update={...request,operationId:id(),scene:{...currentPersonalLearningSceneRevision(next.scene)!,sceneId:scene.sceneId}};
  const updated=await gateway().acceptPublishedLearningScene(update);expect(updated.personalMeaningId).toBe(result.personalMeaningId);expect(updated.personalSemanticAnchorId).toBe(result.personalSemanticAnchorId);
  const beforeConfirm=await readLibrary(tx=>tx.get('semanticMeanings',result.personalMeaningId)),confirm={...update,operationId:id()};
  const confirmed=await gateway().acceptPublishedLearningScene(confirm);expect(confirmed.personalSemanticAnchorRevisionId).toBe(updated.personalSemanticAnchorRevisionId);expect(confirmed.acceptedByOperationId).toBe(update.operationId);
  expect(await readLibrary(tx=>tx.get('semanticMeanings',result.personalMeaningId))).toEqual(beforeConfirm);expect((await gateway().acceptPublishedLearningScene(confirm)).replayed).toBe(true);
  expect(await learningFacts()).toEqual(factsBefore);
  const failure={...update,operationId:id(),scene:{...update.scene,revisionId:id(),revision:3,body:'提交失败的第三版场景'}};
  const old=await readLibrary(tx=>tx.get('semanticMeanings',result.personalMeaningId));
  try{adapter.commit=async()=>{throw Error('controlled_scene_world_write_failure');};await expect(gateway().acceptPublishedLearningScene(failure)).rejects.toThrow();}finally{adapter.commit=commit;}
  expect(await readLibrary(tx=>tx.get('semanticMeanings',result.personalMeaningId))).toEqual(old);
  expect(await readLibrary(tx=>tx.get('semanticReceipts',failure.operationId))).toBeUndefined();
  expect(await adapter.worldSceneMeaning(scene.sceneId)).toBe(result.personalMeaningId);
  // Same admitted public facts, but a new supplied Scene identity and two
  // different operations/versions. This is the command seam race, not another
  // public Scene-creation or rating action.
  const raceSceneId=id(),raceRequests=[1,2].map(revision=>({...request,operationId:id(),scene:{...request.scene,sceneId:raceSceneId,revisionId:id(),revision,body:`同时明确接受的版本 ${revision}`}}));
  const race=await Promise.allSettled(raceRequests.map(request=>gateway().acceptPublishedLearningScene(request)));
  expect(race.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  expect(race.filter(result=>result.status==='rejected')).toHaveLength(1);
  const won=(race.find(result=>result.status==='fulfilled') as PromiseFulfilledResult<typeof result>).value;
  expect(await adapter.worldSceneMeaning(raceSceneId)).toBe(won.personalMeaningId);
  const loser=raceRequests[race.findIndex(result=>result.status==='rejected')]!;expect(await readLibrary(tx=>tx.get('semanticReceipts',loser.operationId))).toBeUndefined();
  const owned=await readLibrary(tx=>tx.get<any>('semanticMeanings',result.personalMeaningId));
  await gateway().changeMeaningLifecycle({operationId:id(),personalMeaningId:result.personalMeaningId,expectedRevision:owned.personalMeaning.currentRevision,action:'delete'});
  const deleted=await readLibrary(tx=>tx.get('semanticMeanings',result.personalMeaningId));
  await expect(gateway().acceptPublishedLearningScene({...update,operationId:id()})).rejects.toThrow();
  expect(await readLibrary(tx=>tx.get('semanticMeanings',result.personalMeaningId))).toEqual(deleted);
  expect(await adapter.worldSceneMeaning(scene.sceneId)).toBe(result.personalMeaningId);
 }finally{adapter.entriesPage=page;adapter.commit=commit;}
 const snapshot=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))));validateBackupRows(snapshot as BackupRows);
});
