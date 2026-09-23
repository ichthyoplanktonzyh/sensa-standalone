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

console.log('PASS: a published Learning Target accepts one learner scene into the exact pinned Sense/Expression/Binding, replays safely, and updates the same Personal Meaning only after explicit re-acceptance.');

});
