/** No-cost static-media fixture. No model, TTS, owner library or cloud calls. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Hono} from 'hono';
import {createNativeProvisioningRoutes} from '../apps/api/src/sensa/provisioning/native.ts';
import {createNativeSemanticRoutes,semanticDigest} from '../apps/api/src/sensa/personal/nativeSemantic.ts';
import {bytesDigest} from '../apps/api/src/sensa/media/consumer.ts';
import {ConsumerError} from '../apps/api/src/sensa/access/auth.ts';
const temp=mkdtempSync(join(tmpdir(),'sensa-audio-'));
const made=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.3','-codec:a','libmp3lame','-write_xing','0',join(temp,'tone.mp3')],{encoding:'utf8'});assert.equal(made.status,0,made.stderr);
const bytes=new Uint8Array(readFileSync(join(temp,'tone.mp3'))),digest=await bytesDigest(bytes);
const invalid=new Uint8Array(128),invalidDigest=await bytesDigest(invalid);
const hash=(s:string)=>bytesDigest(new TextEncoder().encode(s));
const proposal=(expression:string)=>({explanation:'Synthetic pronunciation example',expression:{surface:expression,type:'word',language:'en'},semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'Care for feelings in communication.',prototypeScenes:[{summary:'A person handles a sensitive conversation with care.',participantRoles:['speaker'],states:[],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]}});
const metadata=async(expression:string)=>({digest:expression==='invalid'?invalidDigest:digest,sourceTextDigest:await hash(expression),mimeType:'audio/mpeg' as const,byteSize:expression==='invalid'?invalid.length:bytes.length});
const authorize=async(r:Request)=>{if(r.headers.get('Authorization')!=='Bearer local-native-test')throw new ConsumerError(401,'access_required');};
const app=new Hono();
app.route('/sensa/native/content',createNativeProvisioningRoutes({authorize,reserve:async()=>{},
 pronunciation:async expression=>{if(expression==='missing')throw Error('Catalog unavailable');return metadata(expression);},
 media:async(d,e)=>{for(const expression of ['tactful','broken','invalid']){const m=await metadata(expression);if(m.digest===d&&m.sourceTextDigest===e)return {metadata:m,bytes:expression==='broken'?new Uint8Array(bytes.length):expression==='invalid'?invalid:bytes};}return null;},
 generate:async()=>({cue:{scene:'你向同事提出建议时顾及对方的感受，用委婉的措辞说明问题。',senseFocus:'顾及感受，表达得体'},provider:'fixture-generator',model:'no-cost'}),
 review:async()=>({accepted:true,provider:'fixture-independent-review',model:'no-cost',reason:'Fixture accepted'}),
}));
app.route('/sensa/native/semantic',createNativeSemanticRoutes(async r=>{await authorize(r);return async snapshot=>({proposal:proposal(snapshot.expression!.text) as any,provider:'fixture',model:'no-cost',policyVersion:'consumer-semantic-v4'});},async()=>{}));
if(process.argv.includes('--serve-only')){
 const {serve}=await import('@hono/node-server');serve({fetch:app.fetch,hostname:'127.0.0.1',port:4326});console.log('No-cost native pronunciation fixture listening on 127.0.0.1:4326');
}else{
 const build=spawnSync('cargo',['build','--locked','--quiet','-p','sensa-library','--example','provisioning_driver'],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const path=join(temp,'library.sqlite');let now:string|undefined;
 const run=(action?:unknown,extra={})=>{const r=spawnSync('target/debug/examples/provisioning_driver',[],{input:JSON.stringify({path,action,now,...extra}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const ok=(v:any)=>{assert.ok(!v.error,v.error);return v;};
 const action=(a:unknown)=>run({kind:'provisioning',action:a});
 const post=(input:unknown)=>app.request('/sensa/native/content/prepare',{method:'POST',headers:{Authorization:'Bearer local-native-test','Content-Type':'application/json'},body:JSON.stringify(input)});
 async function task(expression:string){const id=crypto.randomUUID(),sentence='A person is '+expression,start=sentence.length-expression.length;
 let s=ok(run({kind:'semantic',action:{kind:'begin',id,snapshot:{sentence,language:'en',source:{url:null,title:'fixture',capturedAt:new Date().toISOString()},expression:{text:expression,start,end:sentence.length}},intake_id:null,previous_id:null,clarification:null}}));
 const job=s.personal.lookups.find(v=>v.id===id),p=proposal(expression);
 ok(run({kind:'semantic',action:{kind:'finish',result:{version:'sensa-native-semantic-v1',id,inputDigest:job.request.inputDigest,status:'ready',proposal:p,provenance:{provider:'fixture',model:'no-cost',policyVersion:'consumer-semantic-v4',outputDigest:await semanticDigest(p)}}}}));
 s=ok(run({kind:'semantic',action:{kind:'accept',id,consent:'accept_context_expression_sense'}}));const m=s.personal.meanings.find(v=>v.snapshot.sentence===sentence);
 s=ok(action({kind:'add',meaning_id:m.id,expected_revision:m.revision,policy:{profileId:'lightweight',profileVersion:'v1'}}));const t=s.personal.preparations.find(v=>v.target.proposal.expression.surface===expression);
 s=ok(action({kind:'begin',task_id:t.id,expected_revision:t.revision}));return s.personal.preparations.find(v=>v.id===t.id);}
 ok(run({kind:'confirm_quantity',quantity:5}));
 const t=await task('tactful'),response=await post(t.request);assert.equal(response.status,200);const result=await response.json() as any;assert.equal(result.status,'ready');assert.equal(result.material.pronunciation.digest,digest);
 // Rehashed malicious results must still fail independent Rust source/binding validation.
 for(const mutate of [
  (r:any)=>{r.material.pronunciation.sourceTextDigest='0'.repeat(64);},
  (r:any)=>{r.proof.bundle.candidates.find(v=>v.materialRoleKey==='pronunciation').sourceMaterialCandidateIds=[];},
  (r:any)=>{r.proof.request.contextArtifacts.find(v=>v.contextKind==='reference_fact').sourceVersion='0'.repeat(64);},
  (r:any)=>{r.proof.content.resources.find(v=>v.materialRoleKey==='pronunciation').contentPayload.audioUrl='https://evil.invalid/audio.mp3';},
 ]){const r=structuredClone(result);mutate(r);r.proof.materialDigest=await semanticDigest(r.material);r.proof.contentDigest=await semanticDigest(r.proof.content);r.proof.bundle.inputSnapshotDigest=await semanticDigest(r.proof.request);assert.ok(action({kind:'finish',task_id:t.id,result:r}).error);}
 let s=ok(action({kind:'finish',task_id:t.id,result}));const material=s.material;
 assert.match(run(undefined,{path:join(temp,'other-library.sqlite'),audioMaterialId:material.id}).error,/material_unavailable/);
 const before=run();assert.match(run(undefined,{audioMaterialId:material.id}).error,/not_cached/);
 assert.match(run(undefined,{audioMaterialId:material.id,audioBytes:Buffer.from('wrong').toString('base64')}).error,/digest_mismatch/);
 ok(run(undefined,{audioMaterialId:material.id,audioBytes:Buffer.from(bytes).toString('base64')}));
 assert.equal(run(undefined,{audioMaterialId:material.id}).bytes,Buffer.from(bytes).toString('base64'));assert.deepEqual(run(),before);
 const media=async(expression:string,authorized=true)=>app.request('/sensa/native/content/pronunciation/'+digest+'?expressionDigest='+await hash(expression),{headers:authorized?{Authorization:'Bearer local-native-test'}:{}});
 assert.equal((await media('tactful',false)).status,401);assert.equal((await media('unknown')).status,503);assert.equal((await media('broken')).status,503);assert.deepEqual(new Uint8Array(await (await media('tactful')).arrayBuffer()),bytes);
 // Isolated cache corruption is detected on reopen, then repair is non-domain and idempotent.
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path);db.prepare('UPDATE runtime_media SET bytes=?').run(Buffer.from('corrupt'));
 assert.match(run(undefined,{audioMaterialId:material.id}).error,/digest_mismatch/);ok(run(undefined,{audioMaterialId:material.id,audioBytes:Buffer.from(bytes).toString('base64')}));assert.deepEqual(run(),before);db.close();
 const answer=(a:string)=>{const st=run();return ok(run({kind:'record_action',run_id:st.run.id,ordinal:st.run.ordinal,action:a}));};
 ok(run({kind:'start_or_resume'}));answer('reveal');s=answer('good');assert.equal(s.handoffCount,1);
 now=new Date(s.dueAtMs+1000).toISOString();s=ok(run({kind:'start_retention',early:false}));assert.equal(s.material.pronunciation.digest,digest);answer('reveal');s=answer('again');assert.equal(s.retention.reviewCount,1);
 s=ok(run({kind:'start_retention',early:true}));assert.equal(s.material.pronunciation.digest,digest);answer('reveal');s=answer('good');assert.equal(s.retention.relearningCount,1);assert.equal(s.handoffCount,1);
 // Reset only the driver test clock to its monotonic future for the next task.
 const missing=await task('missing');const noAudio=await (await post(missing.request)).json() as any;assert.equal(noAudio.status,'ready');assert.equal(noAudio.material.pronunciation,undefined);s=ok(action({kind:'finish',task_id:missing.id,result:noAudio}));assert.ok(s.personal.preparations.find(v=>v.id===missing.id).materialId);
 console.log('Native pronunciation: proof binding, optional lookup failure, authenticated static media, digest rejection/repair, cold cache and three-purpose history passed.');
}
