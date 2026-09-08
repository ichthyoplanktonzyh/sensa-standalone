import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {conjoinContentCapabilities} from '../apps/web/src/experience/learningRuntime/contentCapabilities.ts';
import {learningPolicyProfileRegistry} from '../apps/web/src/experience/learningRuntime/policyProfiles.ts';
const profiles=learningPolicyProfileRegistry.list();
assert.deepEqual(JSON.parse(readFileSync('crates/sensa-library/src/web-policy-profiles-v1.json','utf8')),profiles,'Web policy manifest changed: review immutable native metadata/version pins');
const cases:any[]=[],expected:any[]=[];
function add(c:any,run:()=>any){cases.push(c);try{expected.push({ok:JSON.parse(JSON.stringify(run()))});}catch(e){expected.push({error:(e as Error).message});}}
const options=[];
for(const status of ['ready','preparing','blocked'])for(const provisioned of [false,true])for(const hasId of [false,true])options.push({view:{status,label:`${status} label`,detail:`${status} reason`},provisioned,materializationId:hasId?'material':null});
for(const left of options)for(const right of options)for(const requirements of [['a'],['a','b'],['b','a'],['a','a','b']]){
 const provider={a:{...left,view:{...left.view,detail:'a reason'},materializationId:left.materializationId?'a-material':null},b:{...right,view:{...right.view,detail:'b reason'},materializationId:right.materializationId?'b-material':null}};
 add({kind:'conjoin',requirements,provider},()=>conjoinContentCapabilities(requirements as any,id=>provider[id as 'a'|'b'] as any));
}
// Compare all existing purpose-specific Profile bindings and content conjunctions.
// Runtime gates are domain additions; compatible inputs here keep raw ready facts executable.
const valid=options.filter(c=>c.provisioned===(c.materializationId!==null)&&!(c.view.status==='ready'&&!c.provisioned));
for(const profile of profiles)for(const compact of valid)for(const structured of valid){
 const provider={compact_learning_material:compact,structured_learning_package:structured};
 add({kind:'plan',profile,provider},()=>learningPolicyProfileRegistry.resolve(profile.profileId,id=>provider[id as keyof typeof provider] as any));
}
const result=spawnSync('cargo',['run','--quiet','--locked','-p','sensa-core','--example','planning_runner'],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:32*1024*1024});
assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout);assert.equal(actual.length,expected.length);
for(let i=0;i<cases.length;i++)assert.deepEqual(actual[i],expected[i],`Case ${i}: ${JSON.stringify(cases[i])}`);
console.log(`Native content readiness/profile planning parity: ${cases.length} exact TS/Rust cases passed`);
