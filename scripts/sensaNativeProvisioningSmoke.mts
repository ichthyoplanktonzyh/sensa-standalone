import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Hono} from 'hono';
import {createNativeProvisioningRoutes} from '../apps/api/src/sensa/provisioning/native.ts';
import {createNativeSemanticRoutes,semanticDigest} from '../apps/api/src/sensa/personal/nativeSemantic.ts';
import {ConsumerError} from '../apps/api/src/sensa/access/auth.ts';
import {SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND} from '../packages/contracts/src/sensa/lightweightLearningContent.ts';
assert.deepEqual(JSON.parse(readFileSync('crates/sensa-library/src/lightweight-demand-v1.json','utf8')),SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND);
const proposal=(expression:string)=>({explanation:'PRIVATE EXPLANATION of this occurrence',expression:{surface:expression,type:'word',language:'en'},semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'Care for feelings in communication.',prototypeScenes:[{summary:'A person handles a sensitive conversation with care.',participantRoles:['speaker'],states:[],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]}});
let generations=0,reviews=0;const used=new Set<string>();
const app=new Hono();app.route('/sensa/native/content',createNativeProvisioningRoutes({
 authorize:async r=>{if(r.headers.get('Authorization')!=='Bearer local-native-test')throw new ConsumerError(401,'access_required');},
 reserve:async(_r,input)=>{if(used.has(input.id))throw new ConsumerError(409,'native_request_consumed');used.add(input.id);},
 generate:async request=>{generations++;assert.ok(!JSON.stringify(request).includes('PRIVATE CAPTURE'));
  const expression=request.contextArtifacts.find(a=>a.contextKind==='expression_snapshot')!.payload.surface;
  if(expression==='failure')throw new Error('fixture generation failure');
  if(expression==='delayed')await new Promise(r=>setTimeout(r,1800));
  return {cue:{scene:'你要向同事提出建议，先顾及他的感受，再委婉地说明问题。',senseFocus:'顾及感受，表达得体'},provider:'fixture-generator',model:'no-cost'};
 },
 review:async(request,_cue)=>{reviews++;return {accepted:request.contextArtifacts.find(a=>a.contextKind==='expression_snapshot')!.payload.surface!=='rejected',provider:'fixture-independent-review',model:'no-cost',reason:'Pinned rubric checked'};},
}));
app.route('/sensa/native/semantic',createNativeSemanticRoutes(async r=>{
 if(r.headers.get('Authorization')!=='Bearer local-native-test')throw new ConsumerError(401,'access_required');
 return async snapshot=>({proposal:proposal(snapshot.expression!.text) as any,provider:'fixture',model:'no-cost',policyVersion:'consumer-semantic-v4'});
},async(_r,input)=>{if(used.has(input.id))throw new ConsumerError(409,'native_request_consumed');used.add(input.id);}));
if(!process.argv.includes('--serve-only')){
 const built=spawnSync('cargo',['build','--quiet','--locked','-p','sensa-library','--example','provisioning_driver'],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
 const path=join(mkdtempSync(join(tmpdir(),'sensa-native-provision-')),'test.sqlite');
 const run=(action?:unknown,extra={})=>{const r=spawnSync('target/debug/examples/provisioning_driver',[],{input:JSON.stringify({path,action,...extra}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const action=(a:unknown)=>run({kind:'provisioning',action:a});

 async function meaning(expression:string,sentence=`PRIVATE CAPTURE ${expression}`){const id=crypto.randomUUID();const start=Array.from(sentence).length-Array.from(expression).length;
  let s=run({kind:'semantic',action:{kind:'begin',id,snapshot:{sentence,language:'en',source:{url:null,title:'private source',capturedAt:new Date().toISOString()},expression:{text:expression,start,end:start+expression.length}},intake_id:null,previous_id:null,clarification:null}});assert.ok(!s.error,s.error);
  const p=proposal(expression),job=s.personal.lookups.find(v=>v.id===id);
  s=run({kind:'semantic',action:{kind:'finish',result:{version:'sensa-native-semantic-v1',id,inputDigest:job.request.inputDigest,status:'ready',proposal:p,provenance:{provider:'fixture',model:'no-cost',policyVersion:'consumer-semantic-v4',outputDigest:await semanticDigest(p)}}}});assert.ok(!s.error,s.error);
  s=run({kind:'semantic',action:{kind:'accept',id,consent:'accept_context_expression_sense'}});assert.ok(!s.error,s.error);return s.personal.meanings.find(m=>m.snapshot.sentence===sentence);
 }
 const post=async(input:unknown,token='local-native-test')=>app.request('/sensa/native/content/prepare',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input)});
 run({kind:'confirm_quantity',quantity:5});
 const m=await meaning('tactful');let s=action({kind:'add',meaning_id:m.id,expected_revision:1,policy:{profileId:'lightweight',profileVersion:'v1'}});assert.ok(!s.error,s.error);
 let task=s.personal.preparations[0];assert.equal(task.status,'pending');assert.equal(s.catalog.length,0);assert.equal(s.personal.meanings[0].addedToLearning,true);
 s=action({kind:'begin',task_id:task.id,expected_revision:task.revision});assert.ok(!s.error,s.error);task=s.personal.preparations[0];
 assert.ok(!JSON.stringify(task.request).includes('PRIVATE'));assert.ok(!('proposal' in task.request.target));
 assert.equal((await post(task.request,'wrong')).status,401);assert.equal(generations,0);
 const response=await post(task.request);assert.equal(response.status,200);const result=await response.json() as any;assert.equal(result.status,'ready');assert.equal(generations,1);assert.equal(reviews,1);
 assert.equal((await post(task.request)).status,409);assert.equal(generations,1);
 let tampered=structuredClone(result);tampered.material.expression='wrong';assert.match(action({kind:'finish',task_id:task.id,result:tampered}).error,/invalid_prepared_material/);
 tampered=structuredClone(result);tampered.proof.validation.review.accepted=false;assert.match(action({kind:'finish',task_id:task.id,result:tampered}).error,/invalid_prepared_material/);
 run({kind:'personal',action:{kind:'set_membership',entity:'meaning',id:m.id,expected_revision:1,active:false}});
 const before=run(),operationId=crypto.randomUUID();const finish={kind:'provisioning',action:{kind:'finish',task_id:task.id,result}};
 s=run(finish,{operationId,revision:before.revision});assert.ok(!s.error,s.error);assert.equal(s.personal.preparations[0].status,'ready');assert.equal(s.catalog.length,1);assert.equal(s.completionCount,0);assert.deepEqual(run(finish,{operationId,revision:before.revision}),s);
 assert.equal(s.policyState.selected.plan.effective.policy.profileId,'lightweight');assert.equal(s.policyState.selected.plan.purposes.initial_learning.readiness.status,'ready');
 const m2=await meaning('tactful','SECOND PRIVATE CAPTURE tactful');assert.match(action({kind:'add',meaning_id:m2.id,expected_revision:1,policy:{profileId:'high_assurance',profileVersion:'high-assurance-profile-v1'}}).error,/learning_target_policy_exists/);s=action({kind:'add',meaning_id:m2.id,expected_revision:1,policy:{profileId:'lightweight',profileVersion:'v1'}});assert.equal(s.personal.preparations.length,1);assert.equal(s.catalog.length,1);
 const rejected=await meaning('rejected');s=action({kind:'add',meaning_id:rejected.id,expected_revision:1,policy:{profileId:'lightweight',profileVersion:'v1'}});let rejectedTask=s.personal.preparations.find(v=>v.target.proposal.expression.surface==='rejected');
 for(let i=0;i<3;i++){s=action({kind:'begin',task_id:rejectedTask.id,expected_revision:rejectedTask.revision});rejectedTask=s.personal.preparations.find(v=>v.id===rejectedTask.id);const r=await (await post(rejectedTask.request)).json();s=action({kind:'finish',task_id:rejectedTask.id,result:r});assert.ok(!s.error,s.error);rejectedTask=s.personal.preparations.find(v=>v.id===rejectedTask.id);assert.equal(rejectedTask.status,'blocked');assert.equal(rejectedTask.reason,'material_rejected');}
 assert.match(action({kind:'begin',task_id:rejectedTask.id,expected_revision:rejectedTask.revision}).error,/preparation_budget_exhausted/);
 const delayed=await meaning('delayed');s=action({kind:'add',meaning_id:delayed.id,expected_revision:1,policy:{profileId:'lightweight',profileVersion:'v1'}});let late=s.personal.preparations.find(v=>v.target.proposal.expression.surface==='delayed');s=action({kind:'begin',task_id:late.id,expected_revision:late.revision});late=s.personal.preparations.find(v=>v.id===late.id);
 const pending=post(late.request);s=action({kind:'cancel',task_id:late.id,expected_revision:late.revision});const lateResult=await (await pending).json();assert.match(action({kind:'finish',task_id:late.id,result:lateResult}).error,/preparation_superseded/);assert.equal(run().catalog.length,1);
 const unsupported=await meaning('failure');s=action({kind:'add',meaning_id:unsupported.id,expected_revision:1,policy:{profileId:'high_assurance',profileVersion:'high-assurance-profile-v1'}});assert.ok(!s.error,s.error);let task4=s.personal.preparations.find(v=>v.target.proposal.expression.surface==='failure');assert.equal(task4.status,'blocked');assert.equal(task4.policy.profileId,'high_assurance');assert.match(action({kind:'begin',task_id:task4.id,expected_revision:task4.revision}).error,/unsupported_content_policy/);
 s=action({kind:'set_policy',task_id:task4.id,expected_revision:task4.revision,policy:{profileId:'lightweight',profileVersion:'v1'}});task4=s.personal.preparations.find(v=>v.id===task4.id);s=action({kind:'begin',task_id:task4.id,expected_revision:task4.revision});task4=s.personal.preparations.find(v=>v.id===task4.id);s=action({kind:'finish',task_id:task4.id,result:await (await post(task4.request)).json()});assert.equal(s.personal.preparations.find(v=>v.id===task4.id).reason,'generation_failed');
 // Exercise a real v10 preparation upgrade with existing targets, requests and receipts.
 const {DatabaseSync}=await import('node:sqlite');const upgradeDb=new DatabaseSync(path);
 const preUpgrade=run();const receiptsBefore=upgradeDb.prepare('SELECT id,command,result FROM operations ORDER BY rowid').all();
 upgradeDb.exec('DROP TABLE agent_sessions; DROP TABLE world_bindings; DROP TABLE world_media; DROP TABLE world_drafts; DROP TABLE practice_operations; DROP TABLE practice_turns; DROP TABLE practice_sessions; DROP TABLE practice_state; DROP TABLE curriculum_introduction_sources; DROP TABLE activity_scope_sources; DROP TABLE curriculum_scopes; DROP TABLE curriculum_settings; DROP TABLE curriculum_supplemental; DROP TABLE curriculum_members; DROP TABLE curriculum_enrollments; DROP TABLE curriculum_books; ALTER TABLE activity_scope DROP COLUMN new_eligible; DROP TABLE personal_anchor_revocations; DROP TABLE personal_anchor_grants; DROP TABLE personal_preparation_versions; PRAGMA user_version=10;');
 const {curriculum: _previousCurriculum, ...previousFacts}=preUpgrade;
 const {curriculum: _upgradedCurriculum, ...upgradedFacts}=run();
 assert.deepEqual(upgradedFacts,previousFacts);
 assert.deepEqual(upgradeDb.prepare('SELECT id,command,result FROM operations ORDER BY rowid').all(),receiptsBefore);
 const versions=upgradeDb.prepare('SELECT id,target_id,content FROM personal_preparation_versions').all();
 assert.equal(versions.length,preUpgrade.personal.preparations.length);
 for(const row of versions){const fixed=JSON.parse(row.content as string);assert.equal(fixed.id,row.id);assert.equal(fixed.targetId,row.target_id);assert.ok(fixed.target.senseVersionId);assert.equal(fixed.anchor,null);}
 upgradeDb.close();
 console.log('PASS: actual TS demand/assembler + Rust local admission, immutable material and Profile readiness; no private capture sent, independent rejection, replay, same-target dedup, three attempts and late cancellation.');
}
if(process.argv.includes('--serve')||process.argv.includes('--serve-only')){const name='@hono/node-server';const {serve}=await import(name);serve({fetch:app.fetch,hostname:'127.0.0.1',port:4324});console.log('No-cost provisioning fixture on 127.0.0.1:4324');}
