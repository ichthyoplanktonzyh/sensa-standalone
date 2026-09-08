import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {runtimeLearningRelease,PROTOTYPE_INTRODUCTION_PACKAGES,materializeReviewRepairContent} from '../apps/web/src/experience/content/learningCatalog.ts';
import {PROTOTYPE_RUNTIME_PACKAGES} from '../apps/web/src/experience/learningRuntime/prototypeRuntimeFixtures.ts';
import {materializeAssessmentResource,assessmentKindForCapability} from '../apps/web/src/experience/content/assessmentResources.ts';
const requests:any[]=[],expected:any[]=[],evaluations:any[]=[],evaluated:any[]=[];
// Execute the actual Web submit closure, with its host/draft dependencies supplied.
const source=readFileSync('apps/web/src/experience/components/learning/AssuranceCard.tsx','utf8');
const start=source.indexOf('    const submit = () => {');const end=source.indexOf('\n    body = (',start);
const closure=source.slice(start,end).replace('const submit =','return');
const submit=new Function('recall','draft','reviewing','options','settle','patch',closure);
for(const p of PROTOTYPE_RUNTIME_PACKAGES){
 for(const a of [...p.actions,...p.reviewActions]){
  if(!a.taskKey||!a.capability||a.intent==='repair')continue;
  const req={package:p.packageId,sense:p.senseId,task:a.taskKey,capability:a.capability};
  const resource=materializeAssessmentResource({packageIdentity:{packageKey:p.packageId,senseKey:p.senseId},content:p.content,taskKey:a.taskKey,kind:assessmentKindForCapability(a.capability),capability:a.capability});requests.push(req);expected.push({ok:resource});
  const recall=resource.kind==='meaning_to_form_recall'?resource:null;
  const opts=recall?recall.choiceOptions.map(o=>({id:o.id,isCorrect:o.isTarget})):resource.kind==='novel_context_transfer'?resource.scenario.options:resource.options;
  for(const support of recall?['independent','first_letter','choice']:['independent'])for(const reviewing of [false,true]){
   const answers=recall&&support!=='choice'?[{text:`  ${recall.acceptedForms[0]!.toUpperCase()}  `,optionId:null},{text:'deliberately wrong',optionId:null}]:opts.map(o=>({text:null,optionId:o.id}));
   for(const answer of answers){let outcome:string|null=null,nextSupport=support,response=answer.optionId??answer.text!.trim().toLocaleLowerCase();const settle=(o:string,id:string)=>{outcome=o;response=id;};const patch=(v:any)=>{nextSupport=v.mode??support;};submit(recall,{mode:support,answer:answer.text,selected:answer.optionId},reviewing,opts,settle,patch)();evaluations.push({resource,support,reviewing,answer});evaluated.push({ok:{outcome,nextSupport,responseId:response}});}
  }
 }
}
const repairs=PROTOTYPE_RUNTIME_PACKAGES.flatMap(p=>p.repairActions.map(a=>({package:p.packageId,reference:a.repairResourceRef})));
const repairExpected=repairs.map(r=>materializeReviewRepairContent(PROTOTYPE_INTRODUCTION_PACKAGES.find(p=>p.packageKey===r.package)!,r.reference));
repairs.push({...repairs[0]!,reference:{...repairs[0]!.reference!,key:'not-owned'}});
const bad=[{...requests[0],task:'not-a-task'},{...requests[0],sense:'other-sense'},{...requests[0],capability:'boundary_discrimination'},{...requests[0],task:''}];
const r=spawnSync('cargo',['run','--quiet','--locked','-p','sensa-core','--example','assurance_material_runner'],{input:JSON.stringify({release:runtimeLearningRelease,requests:[...requests,...bad],evaluations,repairs}),encoding:'utf8',maxBuffer:128*1024*1024});assert.equal(r.status,0,r.stderr);const actual=JSON.parse(r.stdout);assert.deepEqual(actual.resources.slice(0,requests.length),JSON.parse(JSON.stringify(expected)));assert.deepEqual(actual.evaluations,evaluated);assert.deepEqual(actual.inventories,JSON.parse(JSON.stringify(PROTOTYPE_RUNTIME_PACKAGES.map(p=>({requiredCapabilities:p.requiredCapabilities,actions:p.actions,reviewActions:p.reviewActions,repairActions:p.repairActions})))));for(const b of actual.resources.slice(requests.length))assert.equal(typeof b.error,'string');
console.log(`Native assurance material: ${requests.length} exact task projections; ${evaluations.length} Web submit/Rust evaluation cases; ${bad.length} invalid task bindings rejected`);

for(let i=0;i<repairExpected.length;i++){
 assert.ok(repairExpected[i]);
 assert.equal(actual.repairs[i].ok.studyExample.exampleKey,repairExpected[i]!.studyExample.exampleKey);
 assert.equal(actual.repairs[i].ok.studyExample.textL2,repairExpected[i]!.studyExample.textL2);
 assert.equal(actual.repairs[i].ok.l1Bridge,repairExpected[i]!.l1Bridge);
}
assert.equal(typeof actual.repairs.at(-1).error,'string');
console.log(`Native repair material: ${repairExpected.length} exact Web package-owned resource bindings; invalid binding rejected`);
