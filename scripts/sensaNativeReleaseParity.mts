import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {sensaRuntimeLearningReleaseSchema} from '../packages/contracts/src/sensa/runtimeLearningRelease.ts';
import {runtimeLearningRelease as release} from '../apps/web/src/experience/content/learningCatalog.ts';
import {validateRuntimeLearningRelease} from '../packages/content-validator/src/runtimeLearningReleaseValidator.ts';
assert.deepEqual(JSON.parse(readFileSync('crates/sensa-core/schema/runtime-learning-release-v1.json','utf8')),z.toJSONSchema(sensaRuntimeLearningReleaseSchema),'Native schema must match the TS contract');
const cases:any[]=[release];const labels=['installed release'];
function add(label:string,mutate:(v:any)=>void){const v=structuredClone(release);mutate(v);cases.push(v);labels.push(label);}
for(const [key,val] of Object.entries(release.release))if(typeof val==='string')add(`release.${key}`,v=>v.release[key]='wrong');
for(const field of ['media','lexemes','relations','packages']){add(`${field} duplicate`,v=>v[field].push(structuredClone(v[field][0])));add(`${field} empty`,v=>v[field]=[]);}
// Systematic nested mutations exercise schema and cross-reference constraints.
const paths:(string|number)[][]=[];
function walk(v:any,p:(string|number)[]){if(Array.isArray(v)){paths.push(p);v.slice(0,1).forEach((c,i)=>walk(c,[...p,i]));}else if(v&&typeof v==='object'){for(const k of Object.keys(v))walk(v[k],[...p,k]);}else paths.push(p);}
walk(release,[]);
for(const path of paths){const at=(v:any)=>{for(const k of path.slice(0,-1))v=v[k];return v;};const key=path.at(-1)!;let old:any=release;for(const k of path)old=old[k];add(path.join('.')+' invalid',v=>at(v)[key]=Array.isArray(old)?[]:typeof old==='boolean'?!old:typeof old==='number'?-1:old===null?'missing':typeof old==='string'?'missing':null);}
for(const family of ['contextualRecognition','meaningToFormRecall','novelContextTransfer','boundaryContrast']){
 add(`${family} no purposes`,v=>v.packages[0].assessmentInventory[family].forEach((t:any)=>t.eligiblePurposes=[]));
}
add('trim whitespace',v=>v.packages[0].sense.guideLabelL1='   ');
add('trim surrounding',v=>v.packages[0].sense.guideLabelL1='  '+v.packages[0].sense.guideLabelL1+'  ');
add('recall leakage',v=>v.packages[0].assessmentInventory.meaningToFormRecall[0].cue.bodyL1=v.lexemes[0].forms[0]);
add('transfer leakage',v=>v.packages[0].assessmentInventory.novelContextTransfer[0].scene.setupL2=v.lexemes[0].forms[0]);
add('span supplementary prefix',v=>{const e=v.packages[0].examples[0];e.textL2='😀'+e.textL2;e.target.start+=2;e.target.end+=2;});
const expected=cases.map(v=>{const r=validateRuntimeLearningRelease(v);return [...new Set(r.issues.map(i=>i.code.startsWith('schema.')?'schema.invalid':i.code))].sort();});
const r=spawnSync('cargo',['run','--quiet','--locked','-p','sensa-core','--example','runtime_release_runner'],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:256*1024*1024});assert.equal(r.status,0,r.stderr);const actual=JSON.parse(r.stdout);for(let i=0;i<cases.length;i++)assert.deepEqual(actual[i],expected[i],labels[i]);console.log(`Native runtime release admission: ${cases.length} TS/Rust schema and semantic error-code sets match`);
