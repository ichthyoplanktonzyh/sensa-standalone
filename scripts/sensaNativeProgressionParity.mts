import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import * as kernel from '../packages/learning-kernel/src/runtime/protocolProgression.ts';
import {protocolPolicyRegistry} from '../apps/web/src/experience/learningRuntime/protocolPolicies.ts';
import {learningPolicyProfileRegistry} from '../apps/web/src/experience/learningRuntime/policyProfiles.ts';
import {learningRuntimeCoordinator} from '../apps/web/src/experience/learningRuntime/runtimeCoordinator.ts';
import {orchestrationRegistry} from '../apps/web/src/experience/learningRuntime/orchestrations.ts';
import {runtimeSurfaceRegistry} from '../apps/web/src/experience/learningRuntime/runtimeSurfaces.ts';
import {retentionStoreRegistry} from '../apps/web/src/experience/learningRuntime/retentionStores.ts';
import {retentionScopeRegistry} from '../apps/web/src/experience/learningRuntime/retentionScopes.ts';


// Execute the actual pure TS validator without importing its browser singleton root.
// This is a source extraction, not a second implementation of the validator.
const source=readFileSync('apps/web/src/experience/learningRuntime/runtimeComposition.ts','utf8');
const pure=source.slice(source.indexOf('const requireReference ='),source.indexOf('/**\n * Composition root'));
assert.ok(pure.includes('export const validateLearningRuntimeComposition'));
const code=transformSync(pure,{loader:'ts',format:'cjs',target:'es2022'}).code;
const module:any={exports:{}};new Function('module',code)(module);
const validate=module.exports.validateLearningRuntimeComposition;
const cases:any[]=[],expected:any[]=[];
function add(c:any,fn:()=>any){cases.push(c);try{expected.push({ok:JSON.parse(JSON.stringify(fn()))});}catch(e){expected.push({error:(e as Error).message});}}
const definition:kernel.ProtocolProgressDefinition={protocolId:'structured',protocolVersion:'v1',checkpoints:['a','b','c'].map(checkpointId=>({checkpointId,capabilityObjectiveIds:['recall'],requiredForCompletion:checkpointId!=='c'})),completionPolicy:{kind:'all_required_checkpoints',requireSameProgressEpoch:true}};
const initial=kernel.createProtocolProgressState('run',definition);
add({kind:'create',run:'run',definition},()=>initial);
for(const run of ['', ' ', '\ufeff'])add({kind:'create',run,definition},()=>kernel.createProtocolProgressState(run,definition));
for(const d of [{...definition,protocolId:''},{...definition,protocolVersion:''},{...definition,checkpoints:[definition.checkpoints[0],definition.checkpoints[0]]}])add({kind:'create',run:'run',definition:d},()=>kernel.createProtocolProgressState('run',d));
const apply=(state:any,effects:any[],id:string,extra:any={})=>{
 const decision={decisionId:id,observationId:`obs-${id}`,progressionPolicyId:'run-reset-v1',effects,...extra};
 add({kind:'apply',definition,state,decision},()=>kernel.applyProtocolTransitionDecision(definition,state,decision));
};
apply(initial,[{kind:'complete'}],'incomplete');
apply(initial,[{kind:'credit_checkpoint',checkpointId:'a'},{kind:'credit_checkpoint',checkpointId:'missing'}],'atomic');
apply(initial,[{kind:'reset_progress',scope:'declared_set',checkpointIds:[]}],'empty-reset');
apply(initial,[{kind:'reset_progress',scope:'declared_set',checkpointIds:['a','a','b']}],'dedup-reset');
for(const key of ['decisionId','observationId','progressionPolicyId'])apply(initial,[],`blank-${key}`,{[key]:''});
const decision:kernel.ProtocolTransitionDecision={decisionId:'replay',observationId:'obs',progressionPolicyId:'run-reset-v1',effects:[{kind:'credit_checkpoint',checkpointId:'a'}]};
const applied=kernel.applyProtocolTransitionDecision(definition,initial,decision).state;
add({kind:'apply',definition,state:applied,decision},()=>kernel.applyProtocolTransitionDecision(definition,applied,decision));
apply(applied,[],'replay');
for(const state of [{...initial,protocolVersion:'v2'},{...initial,checkpointCredits:{}}])apply(state,[],'mismatch');
// Deterministic diverse stateful sequences compare decisions, epochs, credit,
// repairs, reassessment order, terminal correction and fingerprint receipts.
let seed=7919;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
for(const policyId of ['structured-current-checkpoint-reset-v1','run-reset-v1','completion-only-v1']){
 for(const sameEpoch of [true,false]){
  const d=policyId==='completion-only-v1'?{...definition,checkpoints:[],completionPolicy:{kind:'protocol_completion'} as const}:{...definition,completionPolicy:{kind:'all_required_checkpoints',requireSameProgressEpoch:sameEpoch} as const};
  let state=kernel.createProtocolProgressState(`run-${policyId}`,d);
  for(let i=0;i<180;i++){
   const kind=state.completed?(i%3===0?'checkpoint_satisfied':'checkpoint_not_satisfied'):['checkpoint_satisfied','checkpoint_not_satisfied','repair_completed','instruction_completed','practice_completed','protocol_completed'][random()%6];
   const observation={observationId:`obs-${i}`,attemptId:`attempt-${i}`,actionId:`action-${i}`,kind,checkpointId:d.checkpoints.length?['a','b','c'][random()%3]:null,evidenceIds:[]};
   const c={kind:'decide',definition:d,state,observation,decisionId:`d-${i}`,policyId};
   const before=JSON.stringify(state);
   add(c,()=>kernel.decideAndApplyProtocolTransition({definition:d,state,observation:observation as any,decisionId:c.decisionId,policy:protocolPolicyRegistry.getProgression(policyId)}));
   assert.equal(JSON.stringify(state),before,'TS mutated source state');
   if(expected.at(-1).ok)state=expected.at(-1).ok.state;
   if(i%13===0){for(const effect of [{kind:'invalidate_checkpoint',checkpointId:'a'},{kind:'reset_progress',scope:'run'},{kind:'reset_progress',scope:'current',checkpointId:'b'},{kind:'require_reassessment',checkpointId:'c'}]){
    const decision={decisionId:`extra-${i}-${effect.kind}`,observationId:`extra-obs-${i}`,progressionPolicyId:policyId,effects:[effect]};
    add({kind:'apply',definition:d,state,decision},()=>kernel.applyProtocolTransitionDecision(d,state,decision as any));
   }}
  }
 }
}
// Required checkpoints, repair cannot credit, optional checkpoints and all effect ordering.
for(const effects of [
 [{kind:'credit_checkpoint',checkpointId:'a'},{kind:'credit_checkpoint',checkpointId:'b'},{kind:'complete'}],
 [{kind:'schedule_repair',checkpointId:'a',failedActionId:'action'},{kind:'require_reassessment',checkpointId:'a'},{kind:'complete'}],
 [{kind:'reset_progress',scope:'run'},{kind:'credit_checkpoint',checkpointId:'a'}],
 [{kind:'credit_checkpoint',checkpointId:'a'},{kind:'reset_progress',scope:'run'}],
])apply(initial,effects,`ordered-${cases.length}`);
const binding={runtimeAdapterId:'adapter',orchestrationId:'orchestration',evaluationPolicyId:'learner-rating-v1',progressionPolicyId:'completion-only-v1',completionPolicyId:'study-completion-v1',repairPolicyId:'lightweight-retry-v1',memoryOutcomePolicyId:null,checkpointDefinitionIds:[],contentRequirement:['text']};
const graph={profiles:[{profileId:'arbitrary-new-profile',lifecycle:{provisioningFallback:{behavior:'blocked'}},protocols:{initial_learning:structuredClone(binding),retention_review:structuredClone(binding),relearning:structuredClone(binding)}}],adapters:[{adapterId:'adapter',retentionStoreId:'store',surfaces:{initial_learning:'surface',retention_review:'surface',relearning:'surface'}}],orchestrations:[{orchestrationId:'orchestration',requiredStepKinds:['recall'],initialCompletion:{kind:'study_completion'}}],surfaces:['surface'],retentionStores:['store'],contentCapabilityIds:['text'],stepKinds:['recall'],retentionScopes:[{scopeId:'primary',contentRequirement:['text']}]};
function composition(g:any){add({kind:'composition',graph:g},()=>validate({...g,protocolPolicies:protocolPolicyRegistry,adapters:g.adapters.map((a:any)=>({...a,surfaceFor:(p:string)=>a.surfaces[p]})),surfaces:g.surfaces.map((surface:string)=>({surface})),retentionStores:g.retentionStores.map((storeId:string)=>({storeId}))}));}
composition(graph);
for(const key of Object.keys(graph))composition({...graph,[key]:[]});
for(const purpose of ['initial_learning','retention_review','relearning']){
 for(const key of ['runtimeAdapterId','orchestrationId','evaluationPolicyId','progressionPolicyId','completionPolicyId','repairPolicyId','memoryOutcomePolicyId']){const g:any=structuredClone(graph);g.profiles[0].protocols[purpose][key]='missing';composition(g);}
 for(const mutate of [(b:any)=>b.checkpointDefinitionIds=['a','a'],(b:any)=>b.contentRequirement=['missing'],(b:any)=>b.completionPolicyId='all-required-current-epoch-v1']){const g:any=structuredClone(graph);mutate(g.profiles[0].protocols[purpose]);composition(g);}
}
for(const mutate of [(g:any)=>g.profiles[0].lifecycle.provisioningFallback={behavior:'learner_explicit_downgrade',targetProfileId:'missing'},(g:any)=>g.adapters[0].retentionStoreId='missing',(g:any)=>g.adapters[0].surfaces.relearning='missing',(g:any)=>g.orchestrations[0].requiredStepKinds=['missing'],(g:any)=>g.orchestrations[0].initialCompletion=null,(g:any)=>g.retentionScopes[0].contentRequirement=['missing']]){const g=structuredClone(graph);mutate(g);composition(g);}

// Real Web profiles/adapters/orchestrations/scopes are inputs too. Only renderer
// IDs and content-provider IDs are projected from their literal registrations;
// loading React renderers or package material is unnecessary for this validator.
const rendererSource=readFileSync('apps/web/src/experience/learningRuntime/stepRenderers.tsx','utf8');
const renderers=rendererSource.slice(rendererSource.indexOf('export const BUILTIN_STEP_RENDERERS'),rendererSource.indexOf('export class StepRendererRegistry'));
const providerSource=readFileSync('apps/web/src/experience/learningJourney/prototypeLearning.ts','utf8');
const realGraph={
 profiles:learningPolicyProfileRegistry.list(),
 adapters:learningRuntimeCoordinator.listAdapters().map(a=>({adapterId:a.adapterId,retentionStoreId:a.retentionStoreId,surfaces:Object.fromEntries(['initial_learning','retention_review','relearning'].map(p=>[p,a.surfaceFor(p as any)]))})),
 orchestrations:orchestrationRegistry.list(),surfaces:runtimeSurfaceRegistry.list().map(s=>s.surface),
 retentionStores:retentionStoreRegistry.list().map(s=>s.storeId),
 retentionScopes:retentionScopeRegistry.list(),
 stepKinds:[...renderers.matchAll(/stepKind:\s*["']([^"']+)["']/g)].map(m=>m[1]),
 contentCapabilityIds:[...providerSource.matchAll(/capabilityId:\s*["']([^"']+)["']/g)].map(m=>m[1]),
};
assert.equal(realGraph.stepKinds.length,9,'Review renderer inventory projection if registration style changes');
assert.equal(realGraph.contentCapabilityIds.length,2,'Review provider inventory projection if registration style changes');
composition(realGraph);
for(const initialCompletion of [false,0,'']){const g:any=structuredClone(graph);g.orchestrations[0].initialCompletion=initialCompletion;composition(g);}
for(const profile of realGraph.profiles){
 const d:any=structuredClone(realGraph);d.profiles.find((p:any)=>p.profileId===profile.profileId).protocols.initial_learning.progressionPolicyId='missing';composition(d);
}
const result=spawnSync('cargo',['run','--quiet','--locked','-p','sensa-core','--example','progression_runner'],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:64*1024*1024});
assert.equal(result.status,0,result.stderr);
const actual=JSON.parse(result.stdout);assert.equal(actual.length,expected.length);
for(let i=0;i<cases.length;i++)assert.deepEqual(actual[i],expected[i],`Case ${i}: ${JSON.stringify(cases[i])}`);
console.log(`Native progression/registry/composition parity: ${cases.length} exact TS/Rust cases passed`);
