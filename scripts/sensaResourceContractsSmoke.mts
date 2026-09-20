/** Real generation/admission seams, synthetic sources only; no model or network calls. */
import assert from 'node:assert/strict';
import {canonicalJsonDigest} from '@sensa/learning-kernel';
import {SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,LEARNING_RESOURCE_DEFINITIONS,LIGHTWEIGHT_RESOURCE_PROFILE,makeRequest,makeBundle,validateBundle,generationResourceContracts,sensaLightweightInitialMaterializationContentSchema,lightweightStepRequirements} from '@sensa/contracts/sensa';
import {syntheticSound,withBindingFixture} from './support/lightweightMaterialFixture.mts';
import {provisionLightweightInitialContent} from '../apps/web/src/learning/runtime/lightweightInitialContent.ts';
const id=()=>crypto.randomUUID(),now=new Date('2026-09-20T00:00:00Z');
const fixed={targetLanguageTag:'en',supportLanguageTag:'zh-CN',senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),planRevision:'test-v1',expression:'borrow',expressionKind:'word',meaning:'暂时取得物品并准备归还。',prototype:'向朋友借一把伞，稍后归还。',demand:SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,pronunciation:syntheticSound('borrow','en')};
const request=await makeRequest({id:id(),learner_user_id:id(),learning_target_id:id(),fixed_input:fixed},id(),now);
const generated={resources:[
 {role:'experience_recall_cue',payload:{scene:'向朋友借一把伞，稍后归还。',senseFocus:'临时使用并归还'}},
 {role:'scene_bridge',payload:{text:'从取得者视角表达临时使用并准备归还。'}},
 {role:'scene_realization',payload:{example:'May asked to borrow an umbrella.',targetStart:13,targetEnd:19,experienceResourceKey:'experience_recall_cue:0'}},
 {role:'usage_guidance',payload:{example:'Can I borrow your pen?',translation:'我能借用你的笔吗？'}},
]};
const produce=(output:unknown,req=request)=>makeBundle(req,{cue:output,provider:'fixture',model:'fixture'},now);
const bundle=await produce(generated);
const accepted=await validateBundle(request,bundle,null,now);
assert(accepted.content,'core binding resources admit through the real shared seam');
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
 (x:any)=>{x.resources[2].payload.targetStart=0;x.resources[2].payload.targetEnd=3;},
 (x:any)=>{x.resources[2].payload.experienceResourceKey='another:0';},
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
