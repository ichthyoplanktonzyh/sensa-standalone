/** Scope -> production -> admission -> presentation, without browser/provider calls. */
import assert from 'node:assert/strict';
import {resolveRevealResourcePlan,REVEAL_RESOURCE_CATEGORIES,sensaLightweightInitialMaterializationContentSchema,generationResourceContracts,makeRequest,makeBundle,SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND} from '@sensa/contracts/sensa';
import {provisionLightweightInitialContent} from '../../../apps/web/src/contentSupply/provisioning/lightweightInitialContent.ts';
import {syntheticSound,withBindingFixture} from '../../../scripts/support/lightweightMaterialFixture.mts';
import {prepareLearningResourceFacts} from '../../../apps/api/src/sensa/resources/supplements.ts';
const id=()=>crypto.randomUUID(),now=new Date();
assert.equal(REVEAL_RESOURCE_CATEGORIES.length,8);
const category=(plan:any,key:string)=>plan.categories.find((c:any)=>c.category===key);
for(const kind of ['word','phrase','construction','utterance','sentence','unspecified'] as const){
 const expression={surface:kind==='construction'?'Would you mind if …?':'fixture',languageTag:'en',expressionKind:kind,...(kind==='construction'?{spokenForm:'Would you mind if I opened the window?'}:{})};
 const plan=resolveRevealResourcePlan(expression);
 assert.equal(category(plan,'pronunciation').applicability,'applicable');
 assert.equal(category(plan,'pronunciation').preparation,'unprepared');
 if(['construction','sentence'].includes(kind))assert.equal(category(plan,'etymology').applicability,'not_applicable');
 if(kind==='unspecified')assert.equal(category(plan,'word_formation').applicability,'undetermined');
 const raw=withBindingFixture({learnerUserId:id(),learningTargetId:id(),senseId:id(),senseVersionId:id(),senseExpressionBindingId:id(),resolvedLearningPlanRevisionId:'fixture',expressionSourceVersion:'1',senseSourceVersion:'1',expression,sense:{meaning:'固定测试义项',supportLanguageTag:'zh-CN'},originExperience:{source:'other_authoritative_source',sourceVersion:'1',personalAnchorUseGrantId:null,experience:{scene:'一个具体测试情境',senseFocus:'测试义项',featureLabels:[]}},referenceFacts:[],requestedAt:now.toISOString()});
 const spoken=expression.spokenForm??expression.surface;
 raw.referenceFacts=raw.referenceFacts.filter(r=>r.fact.factKind!=='pronunciation');
 raw.referenceFacts.push({source:'pronunciation_lexicon',sourceVersion:'fixture',fact:{factKind:'pronunciation',...syntheticSound(spoken,'en')}});
 raw.originExperience!.experience.sceneRealization={example:spoken,targetStart:0,targetEnd:spoken.length};
 const output=provisionLightweightInitialContent(raw);
 assert.equal(output.status,'ready',kind);
 if(output.status!=='ready')throw Error(kind);
 const content=output.materialization.content;
 assert.equal(content.resourcePlan!.expression.expressionKind,kind);
 assert.equal(category(content.resourcePlan,'pronunciation').preparation,'ready');
 assert.equal(category(content.resourcePlan,'etymology').preparation,kind==='word'?'blocked':'not_needed');
 assert.equal(content.resources.some(r=>r.materialRoleKey==='etymology'),false);
 const corrupt=structuredClone(content);corrupt.resourcePlan!.categories[0].resourceKeys=[];
 assert.equal(sensaLightweightInitialMaterializationContentSchema.safeParse(corrupt).success,false);
 const sourced=provisionLightweightInitialContent({...raw,referenceFacts:[...raw.referenceFacts,{source:'dictionary',sourceVersion:'fixture',fact:{factKind:'word_formation',explanation:'Synthetic modern structure',source:'Fixture',sourceUrl:'https://fixture.invalid'}},{source:'other_authoritative_source',sourceVersion:'fixture',fact:{factKind:'mnemonic',kind:'teaching_aid',text:'Synthetic teaching cue'}}]});
 assert.equal(sourced.status,'ready');
 if(sourced.status==='ready'){
  assert.equal(sourced.materialization.content.resources.some(r=>r.materialRoleKey==='word_formation'),['word','unspecified'].includes(kind));
  assert.equal(sourced.materialization.content.resources.some(r=>r.materialRoleKey==='mnemonic'),true);
 }
}
const unknown=await prepareLearningResourceFacts({expression:{surface:'unknown-fixture',languageTag:'en',expressionKind:'word'},supportLanguageTag:'zh-CN',meaning:'测试'});
assert.deepEqual(unknown.references,[]);
const sourced=await prepareLearningResourceFacts({expression:{surface:'borrow',languageTag:'en',expressionKind:'word'},supportLanguageTag:'zh-CN',meaning:'借入'});
assert.equal(sourced.references[0].fact.factKind,'etymology');
const request=await makeRequest({id:id(),learner_user_id:id(),learning_target_id:id(),fixed_input:{targetLanguageTag:'en',supportLanguageTag:'zh-CN',senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),planRevision:'test',expression:'A complete sentence.',expressionKind:'sentence',meaning:'测试',prototype:'情境',demand:SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,pronunciation:syntheticSound('A complete sentence.','en')}},id(),now);
assert(!generationResourceContracts(request).some(r=>r.role==='language_structure'));
await assert.rejects(makeBundle(request,{cue:{resources:[{role:'language_structure',payload:{expressionKind:'sentence',expressionTypeLabel:null,partOfSpeech:null,usagePattern:'invented'}}]},provider:'fixture',model:'fixture'},now),/undeclared/);
console.log('PASS: eight-category matrix, all six expression kinds, shared preparation/admission, missing vs excluded, source acquisition, forged plan and out-of-scope model output rejection. No browser/model/TTS.');
