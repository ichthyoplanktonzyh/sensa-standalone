import {test} from 'vitest';
/** Real generation/admission seams, synthetic sources only; no model or network calls. */
import assert from 'node:assert/strict';
import {canonicalJsonDigest} from '@sensa/learning-kernel';
import {learningSupportMeaning} from '@sensa/contracts/sensa';
import {SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,LEARNING_RESOURCE_DEFINITIONS,LIGHTWEIGHT_RESOURCE_PROFILE,makeRequest,makeBundle,validateBundle,validateBundleSnapshot,generationResourceContracts,sensaLightweightInitialMaterializationContentSchema,lightweightStepRequirements} from '@sensa/contracts/sensa';
import {syntheticSound,withBindingFixture} from '../../../scripts/support/lightweightMaterialFixture.mts';
import {provisionLightweightInitialContent} from '../../../apps/web/src/contentSupply/provisioning/lightweightInitialContent.ts';

test("resource-contracts", async () => {
const id=()=>crypto.randomUUID(),now=new Date('2026-09-20T00:00:00Z');
const fixed={targetLanguageTag:'en',supportLanguageTag:'zh-CN',senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),planRevision:'test-v1',expression:'borrow',expressionKind:'word',meaning:'暂时取得物品并准备归还。',prototype:'向朋友借一把伞，稍后归还。',demand:SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,pronunciation:syntheticSound('borrow','en')};
const request=await makeRequest({id:id(),learner_user_id:id(),learning_target_id:id(),fixed_input:fixed},id(),now);
const generated={resources:[
 {role:'experience_recall_cue',payload:{scene:'向朋友借一把伞，稍后归还。',senseFocus:'临时使用并归还'}},
 {role:'scene_bridge',payload:{text:'从取得者视角表达临时使用并准备归还。',meaningRendering:{meaning:'暂时取得物品并准备归还。',languageTag:'zh-CN'}}},
 {role:'scene_realization',payload:{example:'May asked to borrow an umbrella.',targetStart:13,targetEnd:19,experienceResourceKey:'experience_recall_cue:0'}},
 {role:'usage_guidance',payload:{example:'Can I borrow your pen?',translation:'我能借用你的笔吗？'}},
]};
const produce=(output:unknown,req=request)=>makeBundle(req,{cue:output,provider:'fixture',model:'fixture'},now);
const bundle=await produce(generated);
// Model output omits bookkeeping; incorrect legacy offsets cannot influence it.
const minimal=structuredClone(generated);delete (minimal.resources[2]!.payload as any).targetStart;delete (minimal.resources[2]!.payload as any).targetEnd;delete (minimal.resources[2]!.payload as any).experienceResourceKey;
const scenePayload=(b:any)=>b.candidates.find((c:any)=>c.materialRoleKey==='scene_realization').contentPayload;
assert.deepEqual(scenePayload(await produce(minimal)),scenePayload(bundle));
const contract=generationResourceContracts(request).find(r=>r.role==='scene_realization')!.schema as any;
assert(!contract.properties.targetStart&&!contract.properties.experienceResourceKey);
assert(!(generationResourceContracts(request).find(r=>r.role==='experience_recall_cue')!.schema as any).properties.imageIds);
const locate=async(example:string,extra:any={})=>scenePayload(await produce({resources:[{role:'scene_realization',payload:{example,...extra}}]}));
assert.equal((await locate('😀 I BORROW an umbrella.')).targetStart,5);
assert.equal((await locate('I borrow an umbrella.',{targetStart:0,targetEnd:1,experienceResourceKey:'wrong'})).targetStart,2);
assert.equal((await locate('I borrowed an umbrella.',{targetText:'borrowed'})).targetEnd,10);
await assert.rejects(locate('I borroweded an umbrella.'),/target text not found/);
await assert.rejects(locate('borrow then borrow'),/multiple matches/);
assert.equal((await locate('borrow then borrow',{targetText:'borrow',targetOccurrence:2})).targetStart,12);
await assert.rejects(locate('borrow',{targetOccurrence:2}),/exceeds/);
assert.equal((await locate('borrowed',{targetText:'borrowed'})).targetEnd,8);
await assert.rejects(locate('borrowed',{targetText:'missing'}),/target text not found/);
const past=structuredClone(generated);past.resources[2]!.payload.example='Yesterday I borrowed an umbrella.';(past.resources[2]!.payload as any).targetText='borrowed';
const pastBundle=await produce(past);assert((await validateBundle(request,pastBundle,null,now)).content);
assert.equal(pastBundle.candidates.find(c=>c.materialRoleKey==='target_expression')!.contentPayload.surface,'borrow');
assert.equal(pastBundle.candidates.find(c=>c.materialRoleKey==='pronunciation')!.contentPayload.surface,'borrow');
for(const [surface,example,start,end] of [
 ['on the left','The circle is on the left.',14,25],
 ['Would you mind if I opened the window?','Would you mind if I opened the window?',0,38],
 ['借','我借一把伞。',1,2],
] as const){
 const req=await makeRequest({id:id(),learner_user_id:id(),learning_target_id:id(),fixed_input:{...fixed,expression:surface}},id(),now);
 const payload=scenePayload(await produce({resources:[{role:'scene_realization',payload:{example}}]},req));
 assert.equal(payload.targetStart,start);assert.equal(payload.targetEnd,end);
}
// Unlisted irregular forms use explicit occurrence text, without a vocabulary table.
const goRequest=await makeRequest({id:id(),learner_user_id:id(),learning_target_id:id(),fixed_input:{...fixed,expression:'go'}},id(),now);
const went=scenePayload(await produce({resources:[{role:'scene_realization',payload:{example:'I went home.',targetText:'went'}}]},goRequest));
assert.equal(went.targetStart,2);assert.equal(went.targetEnd,6);
// Tampering after assembly still fails persisted admission.
for(const fields of [{targetStart:0,targetEnd:999},{experienceResourceKey:'another:0'}]){
 const tampered=structuredClone(bundle),candidate=tampered.candidates.find(c=>c.materialRoleKey==='scene_realization')!;
 Object.assign(candidate.contentPayload,fields);candidate.contentDigest=canonicalJsonDigest(candidate.contentPayload);
 assert.equal((await validateBundle(request,tampered,null,now)).content,null);
 assert.equal(validateBundleSnapshot(request,tampered,null,now).content,null);
}
const accepted=await validateBundle(request,bundle,null,now);
const restored=validateBundleSnapshot(request,bundle,null,now);
assert.deepEqual(restored.content,accepted.content);
assert.deepEqual(restored.validations.map(({materialCandidateValidationId,...fact})=>fact),accepted.validations.map(({materialCandidateValidationId,...fact})=>fact));
assert(accepted.content,'core binding resources admit through the real shared seam');
const japaneseRequest=await makeRequest({id:id(),learner_user_id:id(),learning_target_id:id(),fixed_input:{...fixed,supportLanguageTag:'ja'}},id(),now);
const japaneseOutput=structuredClone(generated);
japaneseOutput.resources[0]!.payload.scene='友人の傘を一時的に使い、後で返す。';
japaneseOutput.resources[1]!.payload={text:'受け取る側から一時的な使用と返却の予定を表す。',meaningRendering:{meaning:'他人の物を一時的に借り、後で返すこと。',languageTag:'ja'}};
const japaneseBundle=await produce(japaneseOutput,japaneseRequest),japanese=await validateBundle(japaneseRequest,japaneseBundle,null,now);
assert(japanese.content);
assert.equal(learningSupportMeaning(japanese.content.resources,'ja'),'他人の物を一時的に借り、後で返すこと。');
assert.equal(japanese.content.resources.find(resource=>resource.materialRoleKey==='sense_confirmation')!.contentPayload.meaning,fixed.meaning,'rendering must not rewrite the confirmed semantic source');
assert.equal(japaneseRequest.contextArtifacts.find(artifact=>artifact.contextKind==='sense_snapshot')!.payload.meaning,fixed.meaning);
assert.throws(()=>learningSupportMeaning(japanese.content!.resources,'zh-CN'),/language_mismatch/);
const downgradedRequest={...japaneseRequest,generatorPolicyVersion:'v3'},mismatchedPolicy=structuredClone(japaneseBundle);
mismatchedPolicy.inputSnapshotDigest=canonicalJsonDigest(downgradedRequest);
await assert.rejects(()=>validateBundle(downgradedRequest,mismatchedPolicy,null,now),/generator_policy_mismatch/);
assert.throws(()=>validateBundleSnapshot(downgradedRequest,mismatchedPolicy,null,now),/generator_policy_mismatch/);
// Saved v4 evidence remains readable and must keep its required meaning rendering.
const previousRequest={...japaneseRequest,generatorPolicyVersion:'v4'};
const previousBundle=await produce(japaneseOutput,previousRequest);
assert((await validateBundle(previousRequest,previousBundle,null,now)).content);
assert(validateBundleSnapshot(previousRequest,previousBundle,null,now).content);
const missingPreviousRendering=structuredClone(previousBundle),previousBridge=missingPreviousRendering.candidates.find(value=>value.materialRoleKey==='scene_bridge')!;
delete previousBridge.contentPayload.meaningRendering;previousBridge.contentDigest=canonicalJsonDigest(previousBridge.contentPayload);
assert.equal((await validateBundle(previousRequest,missingPreviousRendering,null,now)).content,null);
assert.equal(validateBundleSnapshot(previousRequest,missingPreviousRendering,null,now).content,null);
for(const corruption of ['missing','wrong-language','rewrite-source'] as const){
 const invalid=structuredClone(japaneseBundle),candidate=invalid.candidates.find(value=>value.materialRoleKey===(corruption==='rewrite-source'?'sense_confirmation':'scene_bridge'))!;
 if(corruption==='missing')delete candidate.contentPayload.meaningRendering;
 else if(corruption==='wrong-language')(candidate.contentPayload.meaningRendering as any).languageTag='zh-CN';
 else candidate.contentPayload.meaning='source must not be replaced by a translation';
 candidate.contentDigest=canonicalJsonDigest(candidate.contentPayload);
 assert.equal((await validateBundle(japaneseRequest,invalid,null,now)).content,null,corruption);
 assert.equal(validateBundleSnapshot(japaneseRequest,invalid,null,now).content,null,`restore: ${corruption}`);
}
assert.equal(accepted.content.resources.find(r=>r.materialRoleKey==='target_expression')?.contentPayload.expressionKind,'word');
assert.equal(generationResourceContracts(request).some(r=>r.role==='usage_guidance'),true);
assert.equal(generationResourceContracts(request).some(r=>r.role==='etymology'),false,'source facts never become model generation tasks');
assert.equal(LIGHTWEIGHT_RESOURCE_PROFILE.etymology.phase,'post_reveal');
assert(!lightweightStepRequirements('pre_reveal').some(r=>r.materialRoleKey==='etymology'));
assert.equal((await validateBundle(request,bundle,{accepted:false,provider:'fixture',model:'review',reason:'Wrong scene'},now)).content,null);
for(const role of ['pronunciation','scene_bridge','scene_realization']){
 const bad=structuredClone(accepted.content);bad.resources=bad.resources.filter(r=>r.materialRoleKey!==role);
 assert(!sensaLightweightInitialMaterializationContentSchema.safeParse(bad).success,`missing ${role} must block readiness`);
}
for(const mutate of [
 (x:any)=>{x.resources[0].payload.scene='borrow';},
 (x:any)=>{x.resources[3].payload.audioUrl='https://invented.invalid/audio.mp3';},
]){
 const bad=structuredClone(generated);mutate(bad);
 assert.equal((await validateBundle(request,await produce(bad),null,now)).content,null);
}
await assert.rejects(produce({resources:[...generated.resources,{role:'etymology',payload:{explanation:'Invented',source:'Invented',sourceUrl:'https://invented.invalid'}}]}),/undeclared/);
await assert.rejects(produce({resources:[...generated.resources,{role:'unknown',payload:{}}]}),/undeclared/);
const noSound=await makeRequest({id:id(),learner_user_id:id(),learning_target_id:id(),fixed_input:{...fixed,pronunciation:undefined}},id(),now);
assert.equal((await validateBundle(noSound,await produce(generated,noSound),null,now)).content,null);
const wrongLanguage=structuredClone(accepted.content);wrongLanguage.resources.find(r=>r.materialRoleKey==='pronunciation')!.contentPayload.languageTag='es';
assert(!sensaLightweightInitialMaterializationContentSchema.safeParse(wrongLanguage).success);
const unbound=structuredClone(bundle);unbound.candidates.find(c=>c.materialRoleKey==='scene_realization')!.sourceMaterialCandidateIds=[];
assert.equal((await validateBundle(request,unbound,null,now)).content,null);
// Optional sourced additions flow through the same producer, validator and profile.
const input=withBindingFixture({learnerUserId:id(),learningTargetId:id(),senseId:id(),senseVersionId:id(),senseExpressionBindingId:id(),resolvedLearningPlanRevisionId:'fixture',expressionSourceVersion:'fixture',senseSourceVersion:'fixture',expression:{surface:'borrow',languageTag:'en',expressionKind:'word'},sense:{meaning:'临时使用并归还',supportLanguageTag:'zh-CN'},originExperience:{source:'other_authoritative_source',sourceVersion:'fixture',personalAnchorUseGrantId:null,experience:{scene:'向朋友借伞，稍后归还。',senseFocus:'临时使用并归还',featureLabels:[]}},referenceFacts:[],requestedAt:now.toISOString()});
const source={factKind:'etymology' as const,explanation:'Synthetic source quotation, not a linguistic assertion.',source:'Fixture dictionary',sourceUrl:'https://fixture.invalid/entry'};
const ready=provisionLightweightInitialContent({...input,referenceFacts:[...input.referenceFacts,{source:'dictionary',sourceVersion:'fixture',fact:source}]});
assert.equal(ready.status,'ready');
if(ready.status==='ready'){
 const etymology=ready.materialization.content.resources.find(r=>r.materialRoleKey==='etymology')!;
 assert.equal(etymology.contentPayload.source,source.source);
 assert.equal(etymology.contentDigest,canonicalJsonDigest(etymology.contentPayload));
 assert.equal(LEARNING_RESOURCE_DEFINITIONS.etymology.schema.safeParse(etymology.contentPayload).success,true);
}
console.log('PASS: core resource coverage, sourced optional extension, unknown/model-authored fact rejection, exact sound language, scene binding/span, disclosure and independent rejection. No paid calls.');

});
