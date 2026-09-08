import assert from 'node:assert/strict';
import type {ContentGenerator,ContentReviewer} from '../../apps/api/src/sensa/provisioning/material.js';
export const provisioningFaults:{generate?:ContentGenerator;review?:ContentReviewer}={};
export const mockContentGenerator:ContentGenerator=async request=>provisioningFaults.generate?provisioningFaults.generate(request):({cue:{scene:'你有充足的时间完成一件事，先观察、再慢慢行动，没有人催促你。',senseFocus:'从容地按自己的节奏完成事情。'},provider:'deterministic-fixture',model:'no-cost-content-v1'});
export const mockContentReviewer:ContentReviewer=async(request,cue)=>provisioningFaults.review?provisioningFaults.review(request,cue):({accepted:true,provider:'independent-fixture',model:'no-cost-review-v1',reason:'fixed fixture matches the accepted sense'});
export async function runProvisioningChecks({request,initialize,bootstrap,push,token,pool,issuer,now,setNow,restartRequest}:any){
 const subject=crypto.randomUUID();await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2)',[issuer,subject]);const bearer=await token(subject),installationId=crypto.randomUUID();await initialize(installationId,bearer);const boot=await bootstrap(installationId,bearer);
 const cmd=(kind:string,payload:any)=>({operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId,replicaId:boot.replicaId,dependsOn:[],kind,payload});
 const plan=(await push(boot,[cmd('plan.confirm_quantity',{expectedRevision:null,dailyNewLimit:5,timeZone:'Asia/Shanghai'})],bearer)).body.results[0].value.plan;
 const snapshot={sentence:'😀 She took her time, then took a seat.',language:'en',source:{url:'https://example.org/provisioning',title:'Task fixture',capturedAt:new Date().toISOString()},expression:{text:'took',start:6,end:10}},lookupId=crypto.randomUUID();
 await request('/sensa/semantic/lookups',{id:lookupId,snapshot},bearer);const meaning=(await push(boot,[cmd('semantic.accept',{lookupId:lookupId,expectedRevision:'1',intakeId:null,consent:'accept_context_expression_sense'})],bearer)).body.results[0].value.meaning;
 const add=cmd('personal.add_to_learning',{meaningId:meaning.id,expectedRevision:'1',planId:plan.id,expectedScopeRevision:plan.scopeRevision});const added=await push(boot,[add],bearer);assert.equal(added.status,200,JSON.stringify(added.body));const target=added.body.results[0].value?.target;assert.ok(target,JSON.stringify(added.body));assert.equal(target.plan.readiness,'preparing');
 assert.equal((await push(boot,[add],bearer)).body.results[0].status,'replayed');
 assert.equal((await request('/sensa/catalog/targets?q=took',undefined,bearer)).body.data.items.length,0);
 const id=target.learningTarget.learningTargetId;
 const ready=await request('/sensa/provisioning/'+id+'/advance',{},bearer);assert.equal(ready.status,200,JSON.stringify(ready.body));assert.equal(ready.body.data.plan.readiness,'ready',JSON.stringify(ready.body));
 const materialId=ready.body.data.plan.materializationId,material=await request('/sensa/materializations/'+materialId,undefined,bearer);assert.equal(material.status,200);assert.equal(material.body.data.content.resources.length,3);assert.ok(!JSON.stringify(material.body.data.content.resources[0].contentPayload).includes('took'));
 assert.equal((await request('/sensa/provisioning/'+id+'/advance',{},bearer)).body.data.plan.materializationId,materialId);
 const task=(await pool.query('SELECT * FROM sensa_consumer.provisioning_tasks WHERE learning_target_id=$1',[id])).rows[0];assert.equal(task.attempt_count,1);assert.equal(task.active_attempt_id,null);assert.equal(task.fixed_input.demand.contentDemandKey,'lightweight-initial-content');
 const attempt=(await pool.query('SELECT * FROM sensa_consumer.provisioning_attempts WHERE task_id=$1',[task.id])).rows[0];assert.equal(attempt.status,'submitted');assert.equal(attempt.request.contextArtifacts.some((a:any)=>a.source==='personal_anchor'),false);assert.ok(attempt.validation.review.accepted);assert.equal(attempt.bundle.usage.modelTurns,1);
 const otherSubject=crypto.randomUUID();await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2)',[issuer,otherSubject]);const other=await token(otherSubject);await initialize(crypto.randomUUID(),other);assert.equal((await request('/sensa/catalog/targets/'+meaning.id,undefined,other)).status,404);assert.equal((await request('/sensa/provisioning/'+id+'/advance',{},other)).status,404);assert.equal((await request('/sensa/materializations/'+materialId,undefined,other)).status,404);
 const started=await push(boot,[cmd('activity.start_or_resume',{mode:'mixed',expectedScopeRevision:added.body.results[0].value.plan.scopeRevision,activityId:null,clockSessionId:crypto.randomUUID()})],bearer);assert.equal(started.body.results[0].status,'accepted',JSON.stringify(started.body));assert.equal(started.body.results[0].value.runtime.run.learningTargetId,id);
 await runFaultChecks({request,initialize,bootstrap,push,token,pool,issuer,now,setNow,restartRequest});
 console.log('M2-C provisioning passed: explicit admission, private target, fixed task/demand, separate bundle/validation, frozen material, one generation on replay, private access and M1 Run.');
}

async function runFaultChecks({request,initialize,bootstrap,push,token,pool,issuer,now,setNow,restartRequest}:any){
 const originalNow=now();
 async function setup(){
  const subject=crypto.randomUUID();await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2)',[issuer,subject]);const bearer=await token(subject),installationId=crypto.randomUUID();await initialize(installationId,bearer);const boot=await bootstrap(installationId,bearer);
  const cmd=(kind:string,payload:any)=>({operationId:crypto.randomUUID(),occurredAt:now().toISOString(),installationId,replicaId:boot.replicaId,dependsOn:[],kind,payload});
  const send=async(kind:string,payload:any)=>(await push(boot,[cmd(kind,payload)],bearer)).body.results[0];
  const plan=(await send('plan.confirm_quantity',{expectedRevision:null,dailyNewLimit:5,timeZone:'Asia/Shanghai'})).value.plan;
  const lookupId=crypto.randomUUID();await request('/sensa/semantic/lookups',{id:lookupId,snapshot:{sentence:'😀 She took her time, then took a seat.',language:'en',source:{url:'https://example.org/fault',title:'Synthetic fault case',capturedAt:now().toISOString()},expression:{text:'took',start:6,end:10}}},bearer);
  const meaning=(await send('semantic.accept',{lookupId,expectedRevision:'1',intakeId:null,consent:'accept_context_expression_sense'})).value.meaning;
  const added=await send('personal.add_to_learning',{meaningId:meaning.id,expectedRevision:'1',planId:plan.id,expectedScopeRevision:plan.scopeRevision});const id=added.value.target.learningTarget.learningTargetId;
  const view=async()=>(await request('/sensa/learning-targets/'+id,undefined,bearer)).body.data;
  const advance=async(fresh=false)=>(await (fresh?restartRequest:request)('/sensa/provisioning/'+id+'/advance',{},bearer));
  const command=async(kind:string)=>send(kind,{learningTargetId:id,expectedPlanRevision:(await view()).plan.revision});
  const task=async()=>(await pool.query('SELECT * FROM sensa_consumer.provisioning_tasks WHERE learning_target_id=$1 AND superseded_at IS NULL',[id])).rows[0];
  return {id,bearer,boot,installationId,view,advance,command,task,send,meaning};
 }
 function gate(){let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);return {release,entered,run:async()=>{started();await waiting;}};}
 try{
  // A failed independent review retains membership and requires an explicit new attempt.
  const rejected=await setup();provisioningFaults.review=async()=>({accepted:false,provider:'independent-fixture',model:'reject',reason:'wrong sense'});
  assert.equal((await rejected.advance()).body.data.plan.reason,'material_rejected');assert.equal((await rejected.task()).attempt_count,1);
  delete provisioningFaults.review;assert.equal((await rejected.advance(true)).body.data.plan.readiness,'blocked');assert.equal((await rejected.task()).attempt_count,1);
  assert.equal((await rejected.command('learning.retry_preparation')).status,'accepted');assert.equal((await rejected.advance(true)).body.data.plan.readiness,'ready');assert.equal((await rejected.task()).attempt_count,2);
  const frozen=await rejected.task();await assert.rejects(pool.query("UPDATE sensa_consumer.provisioning_tasks SET fixed_input='{}' WHERE id=$1",[frozen.id]));
  await assert.rejects(pool.query("UPDATE sensa_consumer.provisioning_attempts SET bundle='{}' WHERE task_id=$1 AND bundle IS NOT NULL",[frozen.id]));
  // No progress/feed churn when a ready task is checked again after route reconstruction.
  const before=await bootstrap(rejected.installationId,rejected.bearer);await rejected.advance(true);const after=await bootstrap(rejected.installationId,rejected.bearer);assert.equal(before.syncCursor,after.syncCursor);
  // Failed provider calls are bounded; polling never automatically buys another attempt.
  const failed=await setup();provisioningFaults.generate=async()=>{throw new Error('synthetic provider unavailable');};
  for(let n=1;n<=3;n++){assert.equal((await failed.advance()).body.data.plan.reason,'generation_failed');assert.equal((await failed.task()).attempt_count,n);await failed.advance(true);assert.equal((await failed.task()).attempt_count,n);const retry=await failed.command('learning.retry_preparation');assert.equal(retry.status,n<3?'accepted':'rejected');if(n===3)assert.equal(retry.error.code,'preparation_budget_exhausted');}
  delete provisioningFaults.generate;
  // Cancellation during model I/O prevents a late successful response from becoming ready.
  const cancelled=await setup(),g=gate();let generated=0;provisioningFaults.generate=async()=>{generated++;await g.run();return {cue:{scene:'你不着急，慢慢完成手头的事情，没有人催促。',senseFocus:'从容地行动'},provider:'fixture',model:'gated'};};
  const running=cancelled.advance();await g.entered;assert.equal((await cancelled.advance(true)).body.data.plan.readiness,'preparing');assert.equal(generated,1);assert.equal((await cancelled.command('learning.cancel_preparation')).status,'accepted');g.release();await running;assert.equal((await cancelled.view()).plan.reason,'cancelled');assert.equal((await cancelled.task()).materialization_id,null);delete provisioningFaults.generate;
  assert.equal((await cancelled.command('learning.retry_preparation')).status,'accepted');assert.equal((await cancelled.advance(true)).body.data.plan.readiness,'ready');
  // Process loss while independent validation is pending: lease expiration is persisted.
  const timed=await setup(),v=gate();provisioningFaults.review=async()=>{await v.run();return {accepted:true,provider:'fixture',model:'late-review',reason:'synthetic'};};
  const validating=timed.advance();await v.entered;assert.equal((await timed.task()).status,'validating');setNow(new Date(now().getTime()+76000));assert.equal((await timed.advance(true)).body.data.plan.reason,'attempt_timed_out');v.release();await validating;assert.equal((await timed.task()).materialization_id,null);delete provisioningFaults.review;
  assert.equal((await timed.command('learning.retry_preparation')).status,'accepted');assert.equal((await timed.advance(true)).body.data.plan.readiness,'ready');
  // Explicit grants pin only the sentence. Revocation while generating stops the review call.
  const privateCase=await setup();let privateMeaning=(await privateCase.send('personal.set_anchor_use',{meaningId:privateCase.meaning.id,expectedRevision:'1',enabled:true,policy:'original-context-v1'})).value.meaning;
  assert.ok(privateMeaning.anchorUseGrantId);assert.equal(privateMeaning.revision,'2');
  const pg=gate();let reviewCalls=0;provisioningFaults.generate=async req=>{const anchor=req.contextArtifacts.find(x=>x.source==='personal_anchor')!;assert.equal(anchor.personalAnchorUseGrantId,privateMeaning.anchorUseGrantId);assert.equal(anchor.payload.scene,privateCase.meaning.snapshot.sentence);assert.ok(!JSON.stringify(req).includes('example.org/fault'));await pg.run();return {cue:{scene:'你慢慢完成手头的事情，不着急行动。',senseFocus:'从容地行动'},provider:'fixture',model:'private-context'};};
  provisioningFaults.review=async()=>{reviewCalls++;return {accepted:true,provider:'fixture',model:'independent',reason:'ok'};};
  const privateRunning=privateCase.advance();await pg.entered;const originalTask=await privateCase.task();
  const revokeResult=await privateCase.send('personal.set_anchor_use',{meaningId:privateMeaning.id,expectedRevision:'2',enabled:false,policy:'original-context-v1'});assert.equal(revokeResult.status,'accepted',JSON.stringify(revokeResult));privateMeaning=revokeResult.value.meaning;assert.equal(privateMeaning.anchorUseGrantId,null);
  assert.notEqual((await privateCase.task()).id,originalTask.id);assert.equal((await privateCase.task()).fixed_input.anchor,null);pg.release();await privateRunning;assert.equal(reviewCalls,0);assert.equal((await privateCase.task()).materialization_id,null);
  const revoked=(await pool.query('SELECT * FROM sensa_consumer.anchor_use_grants WHERE id=$1',[originalTask.fixed_input.anchor.grantId])).rows[0];assert.ok(revoked.revoked_at);await assert.rejects(pool.query('UPDATE sensa_consumer.anchor_use_grants SET revoked_at=NULL WHERE id=$1',[revoked.id]));
  delete provisioningFaults.generate;delete provisioningFaults.review;await privateCase.advance();assert.equal((await privateCase.view()).plan.readiness,'ready');
  // Revocation while an independent validator is already in flight cannot freeze a late bundle.
  privateMeaning=(await privateCase.send('personal.set_anchor_use',{meaningId:privateMeaning.id,expectedRevision:'3',enabled:true,policy:'original-context-v1'})).value.meaning;
  assert.notEqual(privateMeaning.anchorUseGrantId,revoked.id);const vg=gate();provisioningFaults.review=async()=>{await vg.run();return {accepted:true,provider:'fixture',model:'late',reason:'ok'};};
  const privateValidating=privateCase.advance();await vg.entered;
  const archive=await privateCase.send('content.set_membership',{entity:'meaning',id:privateMeaning.id,expectedRevision:'4',active:false});assert.equal(archive.status,'accepted');assert.equal(archive.value.meaning.anchorUseGrantId,null);
  vg.release();await privateValidating;assert.equal((await privateCase.task()).materialization_id,null);delete provisioningFaults.review;
  const restored=await privateCase.send('content.set_membership',{entity:'meaning',id:privateMeaning.id,expectedRevision:'5',active:true});assert.equal(restored.value.meaning.anchorUseGrantId,null);assert.equal((await privateCase.task()).fixed_input.anchor,null);
  assert.equal((await privateCase.send('personal.set_anchor_use',{meaningId:privateMeaning.id,expectedRevision:'4',enabled:true,policy:'original-context-v1'})).error.code,'revision_conflict');
  // An already-started run retains its immutable material; future retention reuses the new generic plan.
  const historical=await setup();await historical.send('personal.set_anchor_use',{meaningId:historical.meaning.id,expectedRevision:'1',enabled:true,policy:'original-context-v1'});provisioningFaults.generate=async()=>({cue:{scene:'一个人放慢脚步，按照自己的节奏完成原先安排的事情。',senseFocus:'从容地行动'},provider:'fixture',model:'private-history'});await historical.advance();delete provisioningFaults.generate;const oldMaterial=(await historical.view()).plan.materializationId;
  const clockSessionId=crypto.randomUUID(),home=async()=>(await request('/sensa/home',undefined,historical.bearer)).body.data;
  const start=async(mode='mixed')=>(await historical.send('activity.start_or_resume',{mode,activityId:null,expectedScopeRevision:(await home()).plan.scopeRevision,clockSessionId})).value.runtime;
  const act=async(run:any,kind:string)=>{const action=kind==='rate'?{kind,rating:'good'}:{kind};const op={operationId:crypto.randomUUID(),occurredAt:run.offlineGrant.issuedAt,installationId:historical.installationId,replicaId:historical.boot.replicaId,dependsOn:[],kind:'run.record_action',payload:{runId:run.id,expectedRevision:run.revision,stepId:run.currentStep.id,ordinal:run.currentStep.ordinal,materialDigest:run.materialDigest,grantId:run.offlineGrant.id,clock:{sessionId:clockSessionId,elapsedMs:0},action}};const result=(await push(historical.boot,[op],historical.bearer)).body.results[0];assert.equal(result.status,'accepted',JSON.stringify(result));return result.value.runtime;};
  let runtime=await start();assert.equal(runtime.run.materializationId,oldMaterial);
  await historical.send('personal.set_anchor_use',{meaningId:historical.meaning.id,expectedRevision:'2',enabled:false,policy:'original-context-v1'});
  assert.equal((await request('/sensa/materializations/'+oldMaterial,undefined,historical.bearer)).status,200);
  runtime=await act(runtime.run,'reveal');runtime=await act(runtime.run,'rate');assert.equal(runtime.run.completion.kind,'study_completion');
  setNow(new Date(now().getTime()+4*86400000));
  const blockedRuntime=await start('review_only');assert.equal(blockedRuntime.run,null);
  await historical.advance();const newMaterial=(await historical.view()).plan.materializationId;assert.notEqual(newMaterial,oldMaterial);
  runtime=await start('review_only');assert.equal(runtime.run.purpose,'retention_review');const generic=(await request('/sensa/materializations/'+newMaterial,undefined,historical.bearer)).body.data,previous=(await request('/sensa/materializations/'+oldMaterial,undefined,historical.bearer)).body.data;assert.notEqual(generic.digest,previous.digest);assert.equal(runtime.run.materialDigest,generic.digest);assert.notEqual(runtime.run.materializationId,newMaterial);
  // Another learner cannot change the grant even knowing the Meaning ID.
  assert.equal((await privateCase.send('personal.set_anchor_use',{meaningId:historical.meaning.id,expectedRevision:'3',enabled:true,policy:'original-context-v1'})).error.code,'not_found');
  console.log('M2 anchor authorization passed: explicit sentence-only grant, generation/review revocation races, removal/restore, immutable revoked grants, stale/cross-account rejection, preserved active run and generic future retention.');
  console.log('M2-C failure matrix passed: independent rejection, immutable snapshots, provider failure/three-attempt budget, concurrent polling, cancel/late response, reconstructed routes and expired validation lease.');
 }finally{delete provisioningFaults.generate;delete provisioningFaults.review;setNow(originalNow);}
}
