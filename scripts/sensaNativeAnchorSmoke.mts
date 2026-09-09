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
let generations=0,reviews=0;const used=new Set<string>(),cancelled=new Set<string>();
let afterGenerate:(()=>Promise<void>)|undefined,afterReview:(()=>Promise<void>)|undefined;
const app=new Hono();app.route('/sensa/native/content',createNativeProvisioningRoutes({
 authorize:async r=>{if(r.headers.get('Authorization')!=='Bearer local-native-test')throw new ConsumerError(401,'access_required');},
 reserve:async(_r,input)=>{if(used.has(input.id))throw new ConsumerError(409,'native_request_consumed');used.add(input.id);},
 cancel:async(_r,input)=>{cancelled.add(input.id);},
 checkActive:async(_r,input)=>{if(cancelled.has(input.id))throw new ConsumerError(409,'native_request_cancelled');},
 generate:async request=>{generations++;assert.ok(!JSON.stringify(request).includes('private source'));assert.ok(!JSON.stringify(request).includes('PRIVATE EXPLANATION'));
 const origin=request.contextArtifacts.find(a=>a.contextKind==='origin_experience')!;
 const expression=request.contextArtifacts.find(a=>a.contextKind==='expression_snapshot')!.payload.surface;
 if(expression==='delayed')await new Promise(r=>setTimeout(r,2000));
 if(afterGenerate)await afterGenerate();
 return {cue:{scene:origin.source==='personal_anchor'?'张琳在谈话中顾及你的感受，委婉地表达了自己的看法。':'你向同事提出建议时顾及对方的感受，用委婉的措辞说明问题。',senseFocus:'顾及感受，表达得体'},provider:'fixture-generator',model:'no-cost'};
 },
 review:async()=>{reviews++;if(afterReview)await afterReview();return {accepted:true,provider:'fixture-independent-review',model:'no-cost',reason:'Source-grounded cue accepted by fixture'};},
}));
app.route('/sensa/native/semantic',createNativeSemanticRoutes(async r=>{
 if(r.headers.get('Authorization')!=='Bearer local-native-test')throw new ConsumerError(401,'access_required');
 return async snapshot=>({proposal:proposal(snapshot.expression!.text) as any,provider:'fixture',model:'no-cost',policyVersion:'consumer-semantic-v4'});
},async(_r,input)=>{if(used.has(input.id))throw new ConsumerError(409,'native_request_consumed');used.add(input.id);}));
if(!process.argv.includes('--serve-only')){
 const built=spawnSync('cargo',['build','--quiet','--locked','-p','sensa-library','--example','provisioning_driver'],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
 const path=join(mkdtempSync(join(tmpdir(),'sensa-native-provision-')),'test.sqlite');
 let testNow:string|undefined;
 const run=(action?:unknown,extra={})=>{const r=spawnSync('target/debug/examples/provisioning_driver',[],{input:JSON.stringify({path,action,now:testNow,...extra}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const action=(a:unknown)=>run({kind:'provisioning',action:a});

 async function meaning(expression:string,sentence=`PRIVATE CAPTURE ${expression}`){const id=crypto.randomUUID();const start=Array.from(sentence).length-Array.from(expression).length;
  let s=run({kind:'semantic',action:{kind:'begin',id,snapshot:{sentence,language:'en',source:{url:null,title:'private source',capturedAt:new Date().toISOString()},expression:{text:expression,start,end:start+expression.length}},intake_id:null,previous_id:null,clarification:null}});assert.ok(!s.error,s.error);
  const p=proposal(expression),job=s.personal.lookups.find(v=>v.id===id);
  s=run({kind:'semantic',action:{kind:'finish',result:{version:'sensa-native-semantic-v1',id,inputDigest:job.request.inputDigest,status:'ready',proposal:p,provenance:{provider:'fixture',model:'no-cost',policyVersion:'consumer-semantic-v4',outputDigest:await semanticDigest(p)}}}});assert.ok(!s.error,s.error);
  s=run({kind:'semantic',action:{kind:'accept',id,consent:'accept_context_expression_sense'}});assert.ok(!s.error,s.error);return s.personal.meanings.find(m=>m.snapshot.sentence===sentence);
 }

 const origin='http://127.0.0.1:4325';
 const post=(path:string,input:unknown)=>app.request('/sensa/native/content/'+path,{method:'POST',headers:{Authorization:'Bearer local-native-test','Content-Type':'application/json'},body:JSON.stringify(input)});
 const ok=(s:any)=>{assert.ok(!s.error,s.error);return s;};
 const meaningNow=(id:string)=>run().personal.meanings.find((m:any)=>m.id===id);
 const taskNow=(id:string)=>run().personal.preparations.find((t:any)=>t.id===id);
 const grant=(id:string,enabled:boolean)=>ok(run({kind:'anchor',action:{kind:'set',meaning_id:id,expected_revision:meaningNow(id).revision,enabled,recipient:enabled?origin:null}}));
 const begin=(id:string)=>{const t=taskNow(id);return ok(action({kind:'begin',task_id:id,expected_revision:t.revision,service_origin:origin})).personal.preparations.find((t:any)=>t.id===id);};
 const finish=async(id:string)=>{const t=begin(id);const response=await post('prepare',t.request);assert.equal(response.status,200);const result=await response.json() as any;assert.equal(result.status,'ready');return ok(action({kind:'finish',task_id:id,result}));};
 run({kind:'confirm_quantity',quantity:5});
 const m=await meaning('tactful','张琳在谈话中很 tactful');
 assert.equal(meaningNow(m.id).anchorGrant,null);
 const grantCommand={kind:'anchor',action:{kind:'set',meaning_id:m.id,expected_revision:m.revision,enabled:true,recipient:origin}};
 const grantBefore=run(),grantOperation=crypto.randomUUID();const grantSaved=ok(run(grantCommand,{operationId:grantOperation,revision:grantBefore.revision}));
 assert.deepEqual(run(grantCommand,{operationId:grantOperation,revision:grantBefore.revision}),grantSaved);
 assert.match(run(grantCommand).error,/revision_conflict/);
 const firstGrant=meaningNow(m.id).anchorGrant;
 let s=ok(action({kind:'add',meaning_id:m.id,expected_revision:meaningNow(m.id).revision,policy:{profileId:'lightweight',profileVersion:'v1'}}));const tid=s.personal.preparations[0].id;
 assert.match(action({kind:'begin',task_id:tid,expected_revision:taskNow(tid).revision,service_origin:'https://another.example'}).error,/anchor_recipient_mismatch/);
 s=await finish(tid);const privateMaterial=s.material;
 assert.ok(privateMaterial.scene.includes('张琳'));assert.equal(s.personal.preparations[0].anchor.grantId,firstGrant.grantId);
 s=ok(run({kind:'start_or_resume'}));const initialId=s.run.id;
 grant(m.id,false);assert.equal(taskNow(tid).status,'pending');assert.equal(taskNow(tid).attemptCount,0);
 assert.equal(meaningNow(m.id).anchorGrant,null);
 s=await finish(tid);const genericId=taskNow(tid).materialId;assert.notEqual(genericId,privateMaterial.id);
 assert.match(run({kind:'select_material',material_id:privateMaterial.id}).error,/historical_material_only/);
 assert.equal(s.run.id,initialId);assert.equal(s.material.id,privateMaterial.id); // Active Run stays pinned.
 const answer=(actionName:string)=>{const s=run();return ok(run({kind:'record_action',run_id:s.run.id,ordinal:s.run.ordinal,action:actionName}));};
 answer('reveal');s=answer('good');assert.equal(s.completionCount,1);assert.equal(s.handoffCount,1);
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path);
 assert.equal((db.prepare('SELECT material_id FROM runs WHERE id=?').get(initialId) as any).material_id,privateMaterial.id);
 const grantRows=db.prepare('SELECT content FROM personal_anchor_grants').all();assert.equal(grantRows.length,1);
 assert.equal(db.prepare('SELECT * FROM personal_anchor_revocations').all().length,1);
 assert.equal(db.prepare('SELECT * FROM personal_preparation_versions').all().length,2);
 // Both revoke races: before reviewer starts, and after reviewer is already in flight.
 const m2=await meaning('careful','张琳在谈话中很 careful');grant(m2.id,true);
 s=ok(action({kind:'add',meaning_id:m2.id,expected_revision:meaningNow(m2.id).revision,policy:{profileId:'lightweight',profileVersion:'v1'}}));const tid2=s.personal.preparations.find((t:any)=>t.target.proposal.expression.surface==='careful').id;
 for(const phase of ['generate','review']){
   if(!meaningNow(m2.id).anchorGrant)grant(m2.id,true);
   const t=begin(tid2);const reviewBefore=reviews;
   let entered!:()=>void,release!:()=>void;const seen=new Promise<void>(r=>entered=r),blocked=new Promise<void>(r=>release=r);
   const hook=async()=>{entered();await blocked;};if(phase==='generate')afterGenerate=hook;else afterReview=hook;
   const pending=post('prepare',t.request);await seen;grant(m2.id,false);
   assert.equal((await post('cancel',{id:t.request.id,inputDigest:t.request.inputDigest})).status,200);
   release();const response=await pending;assert.equal(response.status,409);
   if(phase==='generate')assert.equal(reviews,reviewBefore);
   afterGenerate=undefined;afterReview=undefined;
   assert.equal(taskNow(tid2).status,'pending');
 }
 grant(m2.id,true);const renewed=meaningNow(m2.id).anchorGrant;assert.notEqual(renewed.grantId,firstGrant.grantId);
 const pendingTask=begin(tid2);const readyResponse=await (await post('prepare',pendingTask.request)).json();
 grant(m2.id,false);assert.match(action({kind:'finish',task_id:tid2,result:readyResponse}).error,/preparation_superseded/);
 grant(m2.id,true);const revision=meaningNow(m2.id).revision;
 ok(run({kind:'personal',action:{kind:'set_membership',entity:'meaning',id:m2.id,expected_revision:revision,active:false}}));assert.equal(meaningNow(m2.id).anchorGrant,null);
 ok(run({kind:'personal',action:{kind:'set_membership',entity:'meaning',id:m2.id,expected_revision:revision+1,active:true}}));assert.equal(meaningNow(m2.id).anchorGrant,null);
 // Advance only the isolated driver clock to validate future Review/new material and pinned history.
 const due=(db.prepare('SELECT due_at_ms FROM memory WHERE target_id=?').get(tid) as any).due_at_ms;
 testNow=new Date(due+1000).toISOString();ok(run({kind:'select_material',material_id:genericId}));s=ok(run({kind:'start_retention',early:false}));
 assert.equal(s.material.id,genericId);assert.ok(!s.material.scene.includes('张琳'));
 const reviewId=s.run.id;answer('reveal');s=answer('again');assert.equal(s.retention.reviewCount,1);
 grant(m.id,true);
 assert.match(run({kind:'start_retention',early:true}).error,/learning_material_preparing/);
 assert.match(action({kind:'set_policy',task_id:tid,expected_revision:taskNow(tid).revision,policy:{profileId:'lightweight',profileVersion:'v1'}}).error,/policy_committed/);
 s=await finish(tid);const nextMaterial=taskNow(tid).materialId;
 testNow=new Date(Date.parse(testNow)+20*60*1000).toISOString();s=ok(run({kind:'start_retention',early:false}));assert.equal(s.material.id,nextMaterial);assert.notEqual(s.run.id,reviewId);
 assert.equal((db.prepare('SELECT material_id FROM retention_runs WHERE id=?').get(reviewId) as any).material_id,genericId);
 assert.equal((db.prepare('SELECT count(*) AS n FROM memory WHERE target_id=?').get(tid) as any).n,1);
 db.close();
 const shared=await meaning('tactful','另一段经历：张琳在谈话中很 tactful');grant(shared.id,true);
 const sharedGrant=meaningNow(shared.id).anchorGrant;
 s=ok(action({kind:'add',meaning_id:shared.id,expected_revision:meaningNow(shared.id).revision,policy:{profileId:'lightweight',profileVersion:'v1'}}));
 assert.equal(taskNow(tid).anchor.grantId,sharedGrant.grantId);assert.equal(taskNow(tid).anchor.meaningId,shared.id);
 grant(m.id,false);assert.equal(taskNow(tid).anchor.grantId,sharedGrant.grantId); // Revoking another unused source does not revoke this source.
 console.log('PASS: native grant/revocation/version provenance, recipient pin, private TS assembler + Rust admission, both service cancellation races, local late rejection, remove/restore, immutable active Run and replacement Review/relearning without duplicate memory.');

}
if(process.argv.includes('--serve-only')){const name='@hono/node-server';const {serve}=await import(name);serve({fetch:app.fetch,hostname:'127.0.0.1',port:4325});console.log('No-cost anchor fixture on 127.0.0.1:4325');}
