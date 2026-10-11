import {test} from 'vitest';
/**
 * A learner-owned scene can cross from an immutable published Learning Target
 * into the Personal Semantic World without reconstructing its Sense or
 * Expression identities. Editing the scene remains independent until another
 * explicit acceptance appends an Anchor revision.
 */
import assert from 'node:assert/strict';
import {createJourneyGateway} from '../../../apps/web/src/experience/personalMeaningJourney/gateway.ts';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports.ts';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository.ts';
import type {PublishedLearningSceneAcceptanceInput} from '../../../apps/web/src/experience/personalMeaningJourney/types.ts';
import {worldItemFromRegistry} from '../../../apps/web/src/experience/personalMeaningJourney/worldRead';
import {assertPersonalSemanticWorldState} from '../../../apps/web/src/experience/personalMeaningJourney/authority';
import {meaningCorrectionPayload} from '../../../apps/web/src/experience/personalMeaningJourney/meaningCorrection';
import {indexRegistry} from '../../../apps/web/src/experience/personalMeaningJourney/registryRead';
import {directPublishedFixture} from '../support/directPublishedFixture';

test('ordinary published wording is a personal description and preserves all issued semantic facts',async()=>{
 const id=()=>crypto.randomUUID(),repository=new MemoryJourneyRepository(),gateway=createJourneyGateway({repository,clock:createSeededClock('2026-10-11T08:00:00.000Z')}),pack=directPublishedFixture().pack,entry=pack.content.entries[0]!;
 const accepted=await gateway.acceptPublishedLearningScene({operationId:id(),existingPersonalMeaningId:null,source:{packageKey:pack.key,bookId:id(),bookVersionId:id(),contentReleaseId:id(),publishedAt:'2026-10-10T08:00:00.000Z',title:'Borrowing'},target:{learningTargetId:id(),curriculumMembershipId:id(),senseId:entry.senseId,senseVersionId:entry.senseVersionId,bindingId:entry.bindingId,bindingVersionId:entry.bindingVersionId,expression:entry.expression,targetLanguageTag:'en'},semantic:entry.semantic!,scene:{sceneId:id(),revisionId:id(),revision:1,body:'向同事借一把伞。',media:[],createdAt:Date.parse('2026-10-11T07:00:00.000Z')}});
 const before=await repository.load(),record=before.meanings[0]!,alignment=record.alignments[0]!,payload=meaningCorrectionPayload(record,indexRegistry(before.registry),alignment.personalMeaningAlignmentId),operationId=id();
 const changedSceneId=id();
 await assert.rejects(gateway.correctPersonalMeaning({operationId:changedSceneId,personalMeaningId:accepted.personalMeaningId,personalMeaningAlignmentId:alignment.personalMeaningAlignmentId,source:await repository.captureSource('personal_meaning',accepted.personalMeaningId),payload:{...payload,operationId:changedSceneId,acceptance:{mode:'learner_direct'},sense:{...payload.sense!,semanticSpec:{...payload.sense!.semanticSpec,prototypeScenes:[]}}}}),/annotationInvalid/);
 assert.deepEqual(await repository.load(),before);
 await gateway.correctPersonalMeaning({operationId,personalMeaningId:accepted.personalMeaningId,personalMeaningAlignmentId:alignment.personalMeaningAlignmentId,source:await repository.captureSource('personal_meaning',accepted.personalMeaningId),senseEdit:'wording',reuseSense:{senseId:alignment.senseId,senseVersionId:alignment.senseVersionId},payload:{...payload,operationId,acceptance:{mode:'learner_direct'},sense:{...payload.sense!,semanticSpec:{...payload.sense!.semanticSpec,coreMeaningFocus:'我理解为临时借来，用完归还。'}}}});
 const after=await repository.load(),updated=after.meanings[0]!;
 assert.deepEqual(after.registry.senses,before.registry.senses);assert.deepEqual(after.registry.senseVersions,before.registry.senseVersions);
 assert.deepEqual(after.registry.bindings,before.registry.bindings);assert.deepEqual(after.registry.bindingVersions,before.registry.bindingVersions);
 assert.equal(updated.alignments.at(-1)!.senseId,alignment.senseId);assert.equal(updated.alignments.at(-1)!.senseVersionId,alignment.senseVersionId);
 assert.equal(updated.personalMeaningRevisions.at(-1)!.personalSenseWording,'我理解为临时借来，用完归还。');
 assertPersonalSemanticWorldState(after);
});

test("learning-scene-bridge", async () => {

const id=()=>crypto.randomUUID();
const repository=new MemoryJourneyRepository();
const gateway=createJourneyGateway({repository,clock:createSeededClock('2026-09-14T08:00:00.000Z')});
const target={learningTargetId:id(),curriculumMembershipId:id(),senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),expression:'plate',targetLanguageTag:'en'};
const semantic={
 senseKey:'plate-flat-dish',senseVersionNumber:3,semanticPolicyVersion:'editorial-v1',
 semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1' as const,coreMeaningFocus:'用于盛放或食用食物的扁平器皿。',prototypeScenes:[{summary:'餐桌上用盘子盛放晚餐。',participantRoles:['用餐者'],states:['食物放在扁平器皿上'],directionOrCausality:null}],includedCases:['用陶瓷盘盛菜'],excludedCases:['印刷用金属版'],neighborContrasts:[{label:'bowl',distinction:'bowl 通常更深。'}],openQuestions:[]},
 expressionId:id(),expressionVersionId:id(),expressionType:'word' as const,expressionVersionNumber:2,expressionStructure:{lemma:'plate'},bindingVersionNumber:4,relation:'realizes' as const,semanticCoverage:'exact' as const,registerLabel:null,usageConstraints:[],
};
const sceneId=id(),firstRevisionId=id();
const first:PublishedLearningSceneAcceptanceInput={
 operationId:id(),existingPersonalMeaningId:null,
 source:{packageKey:'sha256:fixture',bookId:id(),bookVersionId:id(),contentReleaseId:id(),publishedAt:'2026-09-10T00:00:00.000Z',title:'Everyday objects'},
 target,semantic,
 scene:{sceneId,revisionId:firstRevisionId,revision:1,body:'这是我每天早餐使用的盘子。',media:[{mediaId:id(),kind:'image',dataUrl:'data:image/jpeg;base64,/9j/2Q==',mimeType:'image/jpeg',fileName:'my-plate.jpg',altText:'我的盘子'}],createdAt:Date.parse('2026-09-14T07:00:00.000Z')},
};

const accepted=await gateway.acceptPublishedLearningScene(first);
assert.equal(accepted.replayed,false);
const replayed=await gateway.acceptPublishedLearningScene(first);
assert.equal(replayed.replayed,true,'an exact delivery retry replays the durable acceptance receipt');
assert.equal(replayed.personalMeaningId,accepted.personalMeaningId);

const read=async()=>repository.load() as Promise<any>;
let state=await read(),record=state.meanings[0];
assert.equal(state.meanings.length,1);
assert.equal(record.personalMeaning.status,'active');
assert.equal(record.alignments[0].senseId,target.senseId);
assert.equal(record.alignments[0].senseVersionId,target.senseVersionId);
assert.equal(record.bindingConfirmations[0].bindingVersionId,target.bindingVersionId);
assert.equal(state.registry.senseVersions[0].senseVersionId,target.senseVersionId);
assert.equal(state.registry.expressionVersions[0].expressionVersionId,semantic.expressionVersionId);
assert.equal(state.registry.bindingVersions[0].bindingVersionId,target.bindingVersionId);
assert.equal(record.personalSemanticAnchors[0].currentRevision,1);
assert.equal(record.personalSemanticAnchorRevisions[0].anchorKind,'scene');
assert.equal(record.personalSemanticAnchorRevisions[0].bodyText,first.scene.body);
assert.equal(record.personalSemanticAnchorRevisions[0].structuredPayload.learningScene.revisionId,firstRevisionId);
assert.equal(record.personalSemanticAnchorRevisions[0].structuredPayload.media[0].dataUrl,first.scene.media[0]!.dataUrl);
assert(record.personalMeaningRevisions[0].provenance.sourceReferenceIds.includes(record.personalSemanticAnchors[0].personalSemanticAnchorId),'published-scene acceptance retains the Context introduction as well as its Scene/release provenance');
const existingSingleContext=structuredClone(record);
existingSingleContext.personalMeaningRevisions[0].provenance.sourceReferenceIds=[first.scene.revisionId,first.source.contentReleaseId];
assert.equal(worldItemFromRegistry(existingSingleContext,state.registry).detail.materialBlocks.find(block=>block.kind==='text')?.bodyText,first.scene.body,'the sole Context has an unambiguous birth even when existing Scene provenance does not list its Anchor ID');
let detail=gateway.getDetail(accepted.personalMeaningId)!;
assert.equal(detail.materialBlocks.find(block=>block.kind==='text')?.bodyText,first.scene.body);
assert.equal(detail.materialBlocks.find(block=>block.kind==='image')?.inlineDataUrl,first.scene.media[0]!.dataUrl,'the semantic-world projection renders accepted inline scene media');

const rejectedBindingId=id(),rejectedBindingVersionId=id();
await assert.rejects(gateway.acceptPublishedLearningScene({
 ...first,operationId:id(),existingPersonalMeaningId:accepted.personalMeaningId,
 target:{...target,bindingId:rejectedBindingId,bindingVersionId:rejectedBindingVersionId},
 scene:{...first.scene,revisionId:id(),revision:2},
}),/另一个意思或表达/,'a scene cannot silently move an existing Personal Meaning to another published Binding');

const second:PublishedLearningSceneAcceptanceInput={
 ...first,operationId:id(),existingPersonalMeaningId:null,
 scene:{...first.scene,revisionId:id(),revision:2,body:'这是我每天早餐使用的蓝色盘子。'},
};
const updated=await gateway.acceptPublishedLearningScene(second);
assert.equal(updated.personalMeaningId,accepted.personalMeaningId);
assert.equal(updated.personalSemanticAnchorId,accepted.personalSemanticAnchorId);
state=await read();record=state.meanings[0];
assert.equal(state.meanings.length,1,'the scene identity recovers its Personal Meaning even if the local link marker was not written');
assert.equal(record.personalSemanticAnchors[0].currentRevision,2);
assert.deepEqual(record.personalSemanticAnchorRevisions.map((revision:any)=>revision.bodyText),[first.scene.body,second.scene.body]);
assert.equal(record.personalSemanticAnchorRevisions[1].structuredPayload.learningScene.revisionId,second.scene.revisionId);
assert.equal(state.registry.senses.length,1);
assert.equal(state.registry.expressions.length,1);
assert.equal(state.registry.bindings.length,1);
detail=gateway.getDetail(accepted.personalMeaningId)!;
assert.equal(detail.materialBlocks.find(block=>block.kind==='text')?.bodyText,second.scene.body);
const beforeConfirmation=await read(),confirmationInput={...second,operationId:id()};
const confirmation=await gateway.acceptPublishedLearningScene(confirmationInput);
assert.equal(confirmation.personalSemanticAnchorRevisionId,updated.personalSemanticAnchorRevisionId);
assert.equal(confirmation.acceptedByOperationId,second.operationId);
assert.deepEqual((await read()).meanings,beforeConfirmation.meanings,'a fresh user intent confirms the already-current Scene without another Anchor revision');
assert.equal((await gateway.acceptPublishedLearningScene(confirmationInput)).replayed,true);

const authoredContext='我在语义详情单独整理的早餐经历，应保留。';
await gateway.reviseContext({operationId:id(),personalMeaningId:accepted.personalMeaningId,expectedRevision:detail.revision,blocks:[{kind:'text',bodyText:authoredContext}]});
const beforeReaccept=await read(),retired=beforeReaccept.meanings[0].personalSemanticAnchors.find((anchor:any)=>anchor.personalSemanticAnchorId===accepted.personalSemanticAnchorId);
assert.equal(retired.status,'deleted');
const third={...second,operationId:id(),existingPersonalMeaningId:accepted.personalMeaningId,scene:{...second.scene,revisionId:id(),revision:3,body:'学习页里另一次明确保存的蓝盘子经历。'}};
const reintroduced=await gateway.acceptPublishedLearningScene(third);
assert.equal(reintroduced.personalMeaningId,accepted.personalMeaningId);
assert.notEqual(reintroduced.personalSemanticAnchorId,accepted.personalSemanticAnchorId,'reintroduction preserves the retired association and creates a new Context');
state=await read();record=state.meanings[0];
assert.equal(record.personalSemanticAnchors.find((anchor:any)=>anchor.personalSemanticAnchorId===accepted.personalSemanticAnchorId).status,'deleted');
assert.equal(state.contexts.anchors.find((anchor:any)=>anchor.personalSemanticAnchorId===accepted.personalSemanticAnchorId).status,'active','detaching one Meaning never deletes the independently saved Context');
assert.deepEqual(gateway.getDetail(accepted.personalMeaningId)!.materialBlocks.filter(block=>block.kind==='text').map(block=>block.bodyText),[authoredContext,third.scene.body],'reassociation retains the original Context order and the independently authored material');
const fourth=await gateway.acceptPublishedLearningScene({...third,operationId:id(),scene:{...third.scene,revisionId:id(),revision:4,body:'这次更新同一条新场景锚点。'}});
assert.equal(fourth.personalSemanticAnchorId,reintroduced.personalSemanticAnchorId);
assert.deepEqual(gateway.getDetail(accepted.personalMeaningId)!.materialBlocks.filter(block=>block.kind==='text').map(block=>block.bodyText),[authoredContext,'这次更新同一条新场景锚点。']);

// Scene-managed Context lifecycle advances the canonical lineage independently
// of the Meaning's old pin. A later acceptance extends that exact restored head.
const contextBeforeLifecycle=(await read()).contexts.anchors.find((row:any)=>row.personalSemanticAnchorId===fourth.personalSemanticAnchorId);
const deletedContext=await gateway.changeContextLifecycle({operationId:id(),contextId:fourth.personalSemanticAnchorId,expectedRevisionId:contextBeforeLifecycle.currentRevisionId,action:'delete'});
await assert.rejects(gateway.acceptPublishedLearningScene({...third,operationId:id(),scene:{...third.scene,revisionId:id(),revision:5,body:'回收站中的情境不能被接受。'}}),/meaningChanged/);
const restoredContext=await gateway.changeContextLifecycle({operationId:id(),contextId:fourth.personalSemanticAnchorId,expectedRevisionId:deletedContext.revisionId,action:'restore'});
const afterRestore=await gateway.acceptPublishedLearningScene({...third,operationId:id(),scene:{...third.scene,revisionId:id(),revision:5,body:'恢复后接受的新经历。'}});
state=await read();
const canonical=(state.contexts.anchorRevisions as any[]).find(row=>row.personalSemanticAnchorRevisionId===afterRestore.personalSemanticAnchorRevisionId);
assert.equal(canonical.revision,contextBeforeLifecycle.currentRevision+3);
assert.equal(state.contexts.anchorRevisionParents[canonical.personalSemanticAnchorRevisionId],restoredContext.revisionId);
assertPersonalSemanticWorldState(state);

const foreignRepository=new MemoryJourneyRepository(),foreignGateway=createJourneyGateway({repository:foreignRepository});
await foreignGateway.acceptPublishedLearningScene({...first,operationId:id(),scene:{...first.scene,sceneId:id(),revisionId:id()}});
const forged=(await foreignRepository.load()).meanings[0]!;
(forged.personalSemanticAnchorRevisions[0]!.structuredPayload.learningScene as {sceneId:string}).sceneId=sceneId;
const duplicateOwner={...await read(),meanings:[...(await read()).meanings,forged]};
assert.throws(()=>assertPersonalSemanticWorldState(duplicateOwner),/同一 Personal Learning Scene/,'full owner/restore admission rejects two different Meanings for one Scene, not just later indexed reads');

console.log('PASS: a published Learning Target accepts one learner scene into the exact pinned Sense/Expression/Binding, replays safely, and updates the same Personal Meaning only after explicit re-acceptance.');

});
