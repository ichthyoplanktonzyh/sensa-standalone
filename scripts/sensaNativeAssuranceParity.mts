import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { acquisitionOrchestration, retentionOrchestration, reviewAssessmentKindFor } from '../apps/web/src/experience/engine/stepOrchestration.ts';
import { resolveReviewMemoryOutcome } from '../apps/web/src/experience/review/types.ts';
import { PROTOTYPE_RUNTIME_PACKAGES } from '../apps/web/src/experience/learningRuntime/prototypeRuntimeFixtures.ts';
const capabilities = ['contextual_recognition','meaning_to_form_recall','novel_context_transfer','boundary_discrimination'];
const cases: any[] = [], expected: any[] = [];
function add(kind: string, candidates: any[], plan: any) {
  // Source localeCompare is supplied as a host collation contract. Rust does not
  // silently replace this with byte/Unicode scalar ordering.
  const order = [...new Set(candidates.map(c => c.targetKey))].sort((a,b)=>a.localeCompare(b));
  const saved = JSON.stringify(candidates);
  const result = (kind === 'acquisition' ? acquisitionOrchestration : retentionOrchestration).fresh(candidates, plan);
  expected.push(result ? { candidateIndex: candidates.indexOf(result.target), definition: result.definition } : null);
  assert.equal(JSON.stringify(candidates), saved, 'Source selection mutated input');
  cases.push({ kind, candidates, plan, order });
}
const invented = {
  requiredCapabilities: [...capabilities, capabilities[0]],
  actions: [
    { actionKey:'intro',kind:'introduction',intent:'instruction',capability:null,taskKey:null },
    ...capabilities.flatMap(capability=>[0,1].map(i=>({actionKey:`${capability}.${i}`,kind:'acquisition_gate',capability,taskKey:`task.${i}`})))
  ],
  reviewActions: capabilities.flatMap(capability=>['retention_review','relearning_gate'].flatMap(kind=>[0,1].map(i=>({actionKey:`${capability}.${kind}.${i}`,kind,capability,taskKey:`task.${i}`})))),
  repairActions: capabilities.map(capability=>({actionKey:`${capability}.repair`,kind:'acquisition_gate',intent:'repair',capability,taskKey:null,repairResourceRef:{role:'experience_recap',key:`asset.${capability}`,source:'package_declared'}}))
};
const inventories = [invented, ...PROTOTYPE_RUNTIME_PACKAGES.slice(0,3).map(p=>({ requiredCapabilities:p.requiredCapabilities, actions:p.actions, reviewActions:p.reviewActions, repairActions:p.repairActions ?? [] }))];
for (const base of inventories) {
  for (let variant=0; variant<6; variant++) {
    const inventory=structuredClone(base);
    if (variant===1) inventory.repairActions=[];
    if (variant===2) inventory.actions=[];
    if (variant===3) inventory.reviewActions=inventory.reviewActions.filter(a=>a.capability==='boundary_discrimination');
    if (variant===4) inventory.repairActions=inventory.repairActions.map(a=>({...a,repairResourceRef:{role:'experience_recap',key:null,source:'scheduler_fallback',fallbackReason:'repair_binding_not_exposed'}}));
    if (variant===5) inventory.repairActions=inventory.repairActions.map(a=>({...a,actionKey:inventory.actions.find(g=>g.capability===a.capability)?.actionKey??a.actionKey,repairForActionKey:'original-failure',extraBinding:'preserve'}));
    for (let gate=0; gate<5; gate++) for (let repair=0; repair<3; repair++) {
      const capability=capabilities[Math.min(gate,3)];
      const candidate={targetKey:'ä',lastStepOrdinal:3,inventory,introduced:gate>0,gateStatus:Object.fromEntries(capabilities.map((c,i)=>[c,i<gate-1?'passed':'unresolved'])),lastAssessmentActionKey:Object.fromEntries(capabilities.map(c=>[c,`${c}.0`])),transferScenarioIndex:3,repairBasis:repair?{capability,failedActionKey:`${capability}.0`,repairCount:repair}:null};
      const retention={targetKey:'ä',lastStepOrdinal:3,inventory,retaining:repair===0,retest:repair===2?{capability,repairCount:3}:null,repairBasis:repair===1?{capability,failedReviewActionKey:'failed-review',repairCount:2}:null,diagnosticFacts:{preferredCapabilities:gate%2?[capability]:[],lastCapability:capabilities[(gate+1)%4]}};
      for (const plan of [{ordinal:1,minGap:2},{ordinal:6,minGap:2},{ordinal:6,minGap:9}]) {
        add('acquisition',[candidate,{...candidate,targetKey:'z',lastStepOrdinal:gate%2?-1:3}],plan);
        add('retention',[retention,{...retention,targetKey:'z',lastStepOrdinal:gate%2?-1:3}],plan);
      }
    }
  }
}
add('acquisition',[],{ordinal:1,minGap:2});add('retention',[],{ordinal:1,minGap:2});
for(const capability of capabilities)for(const correct of [false,true]){
 cases.push({kind:'outcome',capability,correct});expected.push(resolveReviewMemoryOutcome(reviewAssessmentKindFor(capability as any)!,correct));
}
const result=spawnSync('cargo',['run','--quiet','--locked','-p','sensa-core','--example','assurance_runner'],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:128*1024*1024});
assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout);assert.equal(actual.length,expected.length);
for(let i=0;i<actual.length;i++)assert.deepEqual(actual[i],JSON.parse(JSON.stringify(expected[i])),`Assurance case ${i}: ${JSON.stringify(cases[i])}`);
console.log(`Native high-assurance fresh/repair parity: ${cases.length} exact TS/Rust cases passed, including actual Web material inventories`);
