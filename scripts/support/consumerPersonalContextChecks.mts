import assert from 'node:assert/strict';
import {makeRequest,makeBundle,validateBundle} from '../../apps/api/dist/sensa/provisioning/material.js';
/** Authorized personal details support recall; they are not public Sense facts. */
export async function checkPersonalContextContract(task:Record<string,any>){
 const grantId=crypto.randomUUID(),request=await makeRequest({...task,fixed_input:{...task.fixed_input,anchor:{grantId,contextVersion:'synthetic-v1',sentence:'Maya took her time before answering.'}}},crypto.randomUUID(),new Date());
 assert.equal(request.contextArtifacts.find(a=>a.source==='personal_anchor')?.personalAnchorUseGrantId,grantId);
 const bundle=await makeBundle(request,{cue:{scene:'Maya 在回答之前不急着开口，而是按自己的节奏慢慢准备。',senseFocus:'从容地行动'},provider:'fixture',model:'no-cost'},new Date());
 const review={accepted:true,provider:'independent-fixture',model:'no-cost',reason:'Original person and event are preserved in an authorized private cue.'};
 const checked=await validateBundle(request,bundle,review,new Date());assert.ok(checked.content,JSON.stringify(checked.issues));assert.ok(JSON.stringify(checked.content).includes('Maya'));
 const rejected=await validateBundle(request,bundle,{...review,accepted:false,reason:'Synthetic independent fidelity rejection'},new Date());assert.equal(rejected.content,null);
 const leaking=await makeBundle(request,{cue:{scene:'Maya 回答之前用 '+task.fixed_input.expression+' 这个表达描述自己的做法。',senseFocus:'从容地行动'},provider:'fixture',model:'no-cost'},new Date());
 assert.equal((await validateBundle(request,leaking,review,new Date())).content,null);
 console.log('M2 personal context contract passed: authorized names preserved, independent fidelity rejection respected, target expression still hidden before reveal.');
}
