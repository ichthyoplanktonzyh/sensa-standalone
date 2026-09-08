import assert from 'node:assert/strict';
import {makeRequest,makeBundle,validateBundle} from '../../apps/api/dist/sensa/provisioning/material.js';
import {contentHash} from '../../apps/api/dist/sensa/curriculum/targets.js';
/** No media/provider calls: check objective derivation and rejection of a substituted audio reference. */
export async function checkPronunciationContract(task:Record<string,any>){
 const digest='a'.repeat(64),request=await makeRequest({...task,fixed_input:{...task.fixed_input,pronunciation:{digest,producer:'synthetic-static-fixture'}}},crypto.randomUUID(),new Date());
 const bundle=await makeBundle(request,{cue:{scene:'你放慢动作，从容地完成手头的事情。',senseFocus:'从容地行动'},provider:'synthetic',model:'no-cost'},new Date());
 const review={accepted:true,provider:'independent-fixture',model:'no-cost',reason:'synthetic fixture'};
 const good=await validateBundle(request,bundle,review,new Date());assert.ok(good.content,JSON.stringify(good.issues));assert.equal(good.content.resources.find(r=>r.materialRoleKey==='pronunciation')?.contentPayload.audioUrl,'sensa-media:'+digest);
 const audio=bundle.candidates.find(c=>c.materialRoleKey==='pronunciation')!;audio.contentPayload.audioUrl='sensa-media:'+'b'.repeat(64);audio.contentDigest=await contentHash(audio.contentPayload);
 const substituted=await validateBundle(request,bundle,review,new Date());assert.equal(substituted.validations.find(v=>v.materialCandidateId===audio.materialCandidateId)?.status,'rejected');
 audio.contentPayload.audioUrl='sensa-media:'+digest;audio.contentDigest=await contentHash(audio.contentPayload);audio.sourceMaterialCandidateIds=[];
 const unbound=await validateBundle(request,bundle,review,new Date());assert.equal(unbound.validations.find(v=>v.materialCandidateId===audio.materialCandidateId)?.status,'rejected');
 console.log('M2 pronunciation contract passed: static derivation, exact reference binding, substituted audio and missing expression derivation rejected.');
}
