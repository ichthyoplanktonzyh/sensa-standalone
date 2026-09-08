import {runProvisioningChecks,mockContentGenerator,mockContentReviewer} from './support/consumerProvisioningChecks.mts';
import {runSemanticChecks,mockSemanticResolver} from './support/consumerSemanticChecks.mts';
import {runIntakeChecks} from './support/consumerIntakeChecks.mts';
import {runCheckInChecks} from './support/consumerCheckInChecks.mts';
import {runRetentionChecks} from './support/consumerRetentionChecks.mts';
import {computeReviewSchedule,createEmptyReviewableCardScheduleState,defaultWorkspaceSchedulerConfig,consumerInitialStepId} from '@sensa/learning-kernel';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fixtureIds} from './support/consumerTargetFixture.mts';
import pg from 'pg';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createConsumerRoutes } from '../apps/api/dist/sensa/access/consumer.js';
import { createConsumerVerifier } from '../apps/api/dist/sensa/access/auth.js';
import type { DatabaseExecutor } from '../apps/api/src/database/index.js';
import { canonicalConsumerJson } from '@sensa/contracts/sensa';

const url=process.env.SENSA_TEST_DATABASE_URL;
if(!url || !['127.0.0.1','localhost'].includes(new URL(url).hostname) || !new URL(url).pathname.startsWith('/sensa_m1a_'))throw new Error('An isolated loopback sensa_m1a_ test database is required');
const pool=new pg.Pool({connectionString:url,max:4});
const issuer='http://127.0.0.1:4319/auth/v1';
const keys=await generateKeyPair('ES256');const jwk=await exportJWK(keys.publicKey);jwk.kid='local-smoke';jwk.alg='ES256';
let injectCheckInFailure=false;let injectDecisionFailure=false;let injectFailure=false;let hideMedia=false;let testNow=new Date();
async function transaction<T>(work:(db:DatabaseExecutor)=>Promise<T>):Promise<T> {
  const client=await pool.connect();await client.query('BEGIN');
  try {
    const result=await work({query:async(text,params)=>{
      if(hideMedia&&text.startsWith('SELECT source_text_digest FROM sensa_consumer.published_media'))return client.query('SELECT source_text_digest FROM sensa_consumer.published_media WHERE false');
      if(injectCheckInFailure&&text.startsWith('INSERT INTO sensa_consumer.checkins'))throw new Error('Injected check-in failure');
      if(injectDecisionFailure&&text.startsWith('INSERT INTO sensa_consumer.scheduling_decisions'))throw new Error('Injected decision failure');
      if(injectFailure&&text.startsWith('INSERT INTO sensa_consumer.operations'))throw new Error('Injected ledger failure');
      return client.query(text,params as unknown[]);
    }});await client.query('COMMIT');return result;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
const subject=crypto.randomUUID(), second=crypto.randomUUID();
await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2),($1,$3)',[issuer,subject,second]);
async function token(sub=subject,session=crypto.randomUUID(),aud='authenticated'){
  return new SignJWT({session_id:session,email:'test@sensa.invalid'}).setProtectedHeader({alg:'ES256',kid:'local-smoke'}).setIssuer(issuer).setSubject(sub).setAudience(aud).setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
}
let mediaUnavailable=false;
const mediaReader=async(digest:string)=>{if(mediaUnavailable)return null;try{const bytes=await readFile(process.env.SENSA_TEST_MEDIA_DIR?process.env.SENSA_TEST_MEDIA_DIR+'/'+digest+'.mp3':'/tmp/sensa-m1b-tactful.mp3');return createHash('sha256').update(bytes).digest('hex')===digest?bytes:null;}catch{return null;}};
const app=new Hono();app.use('*',cors({origin:['http://127.0.0.1:3001','http://localhost:3001'],allowHeaders:['authorization','content-type','apikey','x-client-info','x-supabase-api-version','x-installation-id']}));
app.route('',createConsumerRoutes({verify:createConsumerVerifier(issuer,createLocalJWKSet({keys:[jwk]})),transaction,mediaReader,semanticResolver:mockSemanticResolver,contentGenerator:mockContentGenerator,contentReviewer:mockContentReviewer,clock:()=>testNow}));
const bearer=await token();const install=crypto.randomUUID();
async function request(path:string,body?:unknown,bearerToken=bearer){
  const response=await app.request(path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+bearerToken,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:response.headers.get('content-type')==='audio/mpeg'?{digest:createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex')}:await response.json() as any};
}
async function bootstrap(installationId=install,bearerToken=bearer){return (await request('/sensa/sync/bootstrap',{wireVersion:'sensa-sync-v3',installationId,replicaId:null},bearerToken)).body;}
async function initialize(installationId=install,bearerToken=bearer,clockSessionId=crypto.randomUUID()){return request('/sensa/account/session',{installationId,clockSessionId,platform:'web',timeZone:'Asia/Shanghai'},bearerToken);}
function operation(replicaId:string,revision:string|null,quantity:number,planId?:string,installationId=install){return {
  operationId:crypto.randomUUID(),occurredAt:'2026-09-07T08:00:00.000Z',installationId,replicaId,dependsOn:[] as string[],
  kind:planId?'plan.set_quantity':'plan.confirm_quantity',payload:planId?{planId,expectedRevision:revision,dailyNewLimit:quantity}:{expectedRevision:revision,dailyNewLimit:quantity,timeZone:'Asia/Shanghai'},
};}
async function push(boot:any,operations:any[],bearerToken=bearer){return request('/sensa/sync/push',{wireVersion:'sensa-sync-v3',canonicalizerVersion:'sensa-sync-v3-canonical-1',scopeEpoch:boot.scopeEpoch,replicaId:boot.replicaId,operations},bearerToken);}

assert.equal(canonicalConsumerJson({z:1,a:['句子',true,null]}),'{"a":["句子",true,null],"z":1}');
assert.throws(()=>canonicalConsumerJson(-0));assert.throws(()=>canonicalConsumerJson(Number.MAX_SAFE_INTEGER+1));
assert.equal((await initialize(crypto.randomUUID(),await token(crypto.randomUUID()))).status,403);
assert.equal((await initialize(crypto.randomUUID(),await token(subject,crypto.randomUUID(),'wrong'))).status,401);
const inits=await Promise.all([initialize(),initialize()]);assert.equal(inits[0].status,200);assert.equal(inits[0].body.data.accountId,inits[1].body.data.accountId);
assert.equal(inits[0].body.data.quantityConfirmed,false);const boot=await bootstrap();
assert.equal((await push(boot,[],await token(crypto.randomUUID()))).status,403);
assert.equal((await push({...boot,scopeEpoch:'2'},[])).status,409);
assert.equal((await push({...boot,replicaId:crypto.randomUUID()},[])).status,403);
assert.equal((await push(boot,[])).status,200);
assert.equal((await push(boot,[{...operation(boot.replicaId,null,5),kind:'activity.start_or_resume',payload:{mode:'mixed',expectedScopeRevision:'1',activityId:null,clockSessionId:crypto.randomUUID()}}])).body.results[0].error.code,'onboarding_required');
assert.equal((await push(boot,[{kind:'run.start'}])).body.code,'unsupported_operation');
const confirm=operation(boot.replicaId,null,5);const accepted=await push(boot,[confirm]);assert.equal(accepted.status,200);assert.equal(accepted.body.results[0].status,'accepted');
const planId=accepted.body.results[0].value.plan.id;
assert.equal((await push(boot,[confirm])).body.results[0].status,'replayed');
assert.equal((await push(boot,[{...confirm,payload:{...confirm.payload,dailyNewLimit:10}}])).body.results[0].error.code,'operation_id_reuse');
assert.equal((await push(boot,[operation(boot.replicaId,'1',0,planId)])).status,400);
const contenders=await Promise.all([push(boot,[operation(boot.replicaId,'1',10,planId)]),push(boot,[operation(boot.replicaId,'1',20,planId)])]);
assert.deepEqual(contenders.map(x=>x.body.results[0].status).sort(),['accepted','conflict']);
const current=(await request('/sensa/home')).body.data.plan;assert.equal(current.revision,'2');
injectFailure=true;const retried=operation(boot.replicaId,'2',30,planId);assert.equal((await push(boot,[retried])).status,503);injectFailure=false;
assert.equal((await request('/sensa/home')).body.data.plan.revision,'2');assert.equal((await push(boot,[retried])).body.results[0].status,'accepted');
const pulled=await request('/sensa/sync/pull',{wireVersion:'sensa-sync-v3',scopeEpoch:'1',replicaId:boot.replicaId,cursor:boot.syncCursor,limit:1});
assert.equal(pulled.body.hasMore,true);assert.equal(pulled.body.changes.length,1);
assert.equal((await request('/sensa/operations/'+retried.operationId)).body.state,'known');
const otherToken=await token(second);const otherInstall=crypto.randomUUID();await initialize(otherInstall,otherToken);
assert.equal((await initialize(install,otherToken)).status,403);
assert.equal((await request('/sensa/operations/'+retried.operationId,undefined,otherToken)).body.state,'not_found');
assert.equal((await push(boot,[operation(boot.replicaId,'3',5,planId)],otherToken)).status,403);
assert.equal((await request('/sensa/sync/pull',{wireVersion:'sensa-sync-v3',scopeEpoch:'2',replicaId:boot.replicaId,cursor:boot.syncCursor})).status,409);
const cycle=operation(boot.replicaId,'3',5,planId);cycle.dependsOn=[cycle.operationId];assert.equal((await push(boot,[cycle])).status,400);
const catalog=(await request('/sensa/catalog/targets?limit=1')).body.data;
if(process.argv.includes('--targets'))assert.ok(catalog.items.length,'Target smoke requires the isolated curriculum fixture');
if(catalog.items.length){
 assert.ok(catalog.nextCursor);
 const selected=(await request('/sensa/catalog/targets/'+fixtureIds.candidate)).body.data;
 assert.equal(selected.membership,null);
 const add=(candidate:any,scopeRevision='1')=>({...operation(boot.replicaId,'3',5,planId),kind:'curriculum.add_target',payload:{planId,expectedScopeRevision:scopeRevision,candidateId:candidate.candidateId,source:candidate.source}});
 const firstAdd=add(selected.candidate);const addResult=await push(boot,[firstAdd]);
 assert.equal(addResult.body.results[0].status,'accepted',JSON.stringify(addResult.body));
 const target=addResult.body.results[0].value.target;assert.equal(target.plan.readiness,'ready');
 assert.equal((await push(boot,[firstAdd])).body.results[0].status,'replayed');
 const book=(await request('/sensa/catalog/targets/'+fixtureIds.book)).body.data.candidate;
 const duplicate=(await push(boot,[add(book)])).body.results[0];assert.equal(duplicate.value.disposition,'already_in_scope');
 assert.equal(duplicate.value.target.learningTarget.learningTargetId,target.learningTarget.learningTargetId);
 assert.equal(duplicate.value.target.membership.provenances.length,2);
 const invalid=(await request('/sensa/catalog/targets/'+fixtureIds.invalid)).body.data.candidate;
 assert.equal((await push(boot,[add(invalid)])).body.results[0].error.code,'invalid_binding');
 const reference=(await request('/sensa/catalog/targets/'+fixtureIds.reference)).body.data.candidate;
 assert.equal((await push(boot,[add(reference)])).body.results[0].error.code,'target_unavailable');
 assert.equal((await push(boot,[add({...book,source:{...book.source,version:'forged'}})])).body.results[0].error.code,'invalid_source');
 const material=await request('/sensa/materializations/'+target.plan.materializationId);assert.equal(material.status,200);
 assert.equal((await request('/sensa/materializations/'+target.plan.materializationId,undefined,otherToken)).status,404);
 const audioReference=material.body.data.content.resources.find((r:any)=>r.materialRoleKey==='pronunciation')?.contentPayload.audioUrl;
 if(audioReference){
  const path='/sensa/materializations/'+target.plan.materializationId+'/media/'+audioReference.slice(12);
  const audio=await app.request(path,{headers:{authorization:'Bearer '+bearer}});assert.equal(audio.status,200);assert.equal(audio.headers.get('content-type'),'audio/mpeg');assert.ok((await audio.arrayBuffer()).byteLength>100);
  assert.equal((await app.request(path,{headers:{authorization:'Bearer '+otherToken}})).status,404);
  mediaUnavailable=true;assert.equal((await app.request(path,{headers:{authorization:'Bearer '+bearer}})).status,503);mediaUnavailable=false;
  const otherBoot=await bootstrap(otherInstall,otherToken);
  const otherPlan=(await push(otherBoot,[operation(otherBoot.replicaId,null,5,undefined,otherInstall)],otherToken)).body.results[0].value.plan;
  const mediaAdd={...operation(otherBoot.replicaId,'1',5,otherPlan.id,otherInstall),kind:'curriculum.add_target',payload:{planId:otherPlan.id,expectedScopeRevision:'1',candidateId:selected.candidate.candidateId,source:selected.candidate.source}};
  hideMedia=true;const waiting=(await push(otherBoot,[mediaAdd],otherToken)).body.results[0].value.target;hideMedia=false;
  assert.equal(waiting.plan.reason,'media_missing');assert.equal(waiting.plan.retryAllowed,true);
  const retryMedia={...operation(otherBoot.replicaId,'1',5,otherPlan.id,otherInstall),kind:'learning.retry_preparation',payload:{learningTargetId:waiting.learningTarget.learningTargetId,expectedPlanRevision:waiting.plan.revision}};
  const prepared=(await push(otherBoot,[retryMedia],otherToken)).body.results[0].value.target;
  assert.equal(prepared.plan.readiness,'ready');assert.equal(prepared.plan.id,waiting.plan.id);assert.equal(prepared.membership.id,waiting.membership.id);

 }

 assert.equal((await request('/sensa/learning-targets/'+target.learningTarget.learningTargetId,undefined,otherToken)).status,404);
 const blocked=(await request('/sensa/catalog/targets/'+fixtureIds.blocked)).body.data.candidate;
 assert.equal((await push(boot,[add(blocked)])).body.results[0].error.code,'revision_conflict');
 const blockOp=add(blocked,'2');injectFailure=true;assert.equal((await push(boot,[blockOp])).status,503);injectFailure=false;
 assert.equal((await request('/sensa/catalog/targets/'+fixtureIds.blocked)).body.data.membership,null);
 const blockTarget=(await push(boot,[blockOp])).body.results[0].value.target;
 assert.equal(blockTarget.plan.readiness,'blocked');assert.ok(blockTarget.membership);assert.equal(blockTarget.plan.materializationId,null);
 const retry={...operation(boot.replicaId,'3',5,planId),kind:'learning.retry_preparation',payload:{learningTargetId:blockTarget.learningTarget.learningTargetId,expectedPlanRevision:blockTarget.plan.revision}};
 assert.equal((await push(boot,[retry])).body.results[0].error.code,'retry_not_allowed');
 const home=(await request('/sensa/home')).body.data;assert.equal(home.targets.length,2);assert.equal(home.counts.newAvailable,1);
 const rebuilt=await bootstrap();assert.equal(rebuilt.targets.length,2);
 const sync=(await request('/sensa/sync/pull',{wireVersion:'sensa-sync-v3',scopeEpoch:'1',replicaId:boot.replicaId,cursor:boot.syncCursor})).body;
 assert.ok(sync.changes.some((x:any)=>x.entityType==='target'));
 const mastery=(active:boolean,revision:string)=>({...operation(boot.replicaId,'3',5,planId),kind:'declared_mastery.set',payload:{retentionTargetId:target.retentionTarget.retentionTargetId,expectedRevision:revision,active}});
 assert.equal((await push(boot,[mastery(true,'0')])).body.results[0].value.target.declaredMastery.active,true);
 assert.equal((await request('/sensa/home')).body.data.counts.newAvailable,0);
 assert.equal((await push(boot,[add(selected.candidate)])).body.results[0].error.code,'declared_mastery_active');
 const restored=(await push(boot,[mastery(false,'1')])).body.results[0].value.target;
 assert.equal(restored.declaredMastery.active,false);assert.equal(restored.plan.materializationId,target.plan.materializationId);
 assert.equal((await request('/sensa/home')).body.data.counts.newAvailable,1);
 const facts=await pool.query('SELECT count(*)::int AS n FROM sensa_consumer.target_memberships WHERE learner_user_id=$1',[inits[0].body.data.learnerUserId]);assert.equal(facts.rows[0].n,2);
 console.log('M1-B catalog/target/material smoke passed: identity, duplicate provenance, invalid binding/source, scope CAS, blocked membership, atomic rollback, private material, bootstrap/feed.');
}
if(process.argv.includes('--initial')){
 assert.equal(consumerInitialStepId('b1000000-0000-4000-8000-000000000001',1,'recall'),'5e047dc1-8208-4641-ad4e-fa15f9fba0cc');
 const anchor=new Date('2026-09-07T08:00:00Z');
 for(const [rating,minutes,state] of [[0,1,'learning'],[1,6,'learning'],[2,10,'learning'],[3,8*1440,'review']] as const){const schedule=computeReviewSchedule(createEmptyReviewableCardScheduleState('fixture'),{...defaultWorkspaceSchedulerConfig,enableFuzz:false},rating,anchor);assert.equal(schedule.dueAt.getTime()-anchor.getTime(),minutes*60000);assert.equal(schedule.fsrsCardState,state);}

 const clockId=crypto.randomUUID();
 const home=async()=> (await request('/sensa/home')).body.data;
 const cmd=(kind:string,payload:any,installationId=install,replicaId=boot.replicaId)=>({...operation(replicaId,'1',5,planId,installationId),kind,payload});
 const start=async(activityId:string|null=null)=>cmd('activity.start_or_resume',{mode:'mixed',expectedScopeRevision:(await home()).plan.scopeRevision,activityId,clockSessionId:clockId});
 const val=(response:any)=>{assert.equal(response.status,200,JSON.stringify(response));const r=response.body.results[0];assert.equal(r.status,'accepted',JSON.stringify(r));return r.value.runtime;};
 const action=(run:any,kind:string,rating?:string)=>cmd('run.record_action',{runId:run.id,expectedRevision:run.revision,stepId:run.currentStep.id,ordinal:run.currentStep.ordinal,materialDigest:run.materialDigest,grantId:run.offlineGrant.id,clock:{sessionId:clockId,elapsedMs:0},action:kind==='rate'?{kind,rating}:{kind}});
 const actOp=(run:any,kind:string,rating?:string)=>({...action(run,kind,rating),occurredAt:run.offlineGrant.issuedAt});
 let h=await home();val(await push(boot,[cmd('activity.start_or_resume',{mode:'mixed',expectedScopeRevision:h.plan.scopeRevision,activityId:null,clockSessionId:clockId})]));
 h=await home();assert.equal(h.plan.newStartedToday,1);assert.equal(h.runs.length,1);assert.equal(h.targets.find((t:any)=>t.phase==='acquiring')?.phase,'acquiring');
 const starts=await Promise.all([push(boot,[await start()]),push(boot,[await start()])]);
 let runtime=val(starts[1]);let run=runtime.run;assert.equal(val(starts[0]).run.id,run.id);assert.equal((await home()).plan.newStartedToday,1);
 assert.equal((await request('/sensa/runs/'+run.id,undefined,otherToken)).status,404);
 assert.equal((await push(boot,[cmd('declared_mastery.set',{retentionTargetId:run.retentionTargetId,expectedRevision:'2',active:true})])).body.results[0].error.code,'pending_result');
 const invalidClock=actOp(run,'reveal');invalidClock.payload.clock.sessionId=crypto.randomUUID();assert.equal((await push(boot,[invalidClock])).body.results[0].error.code,'clock_untrusted');
 const invalidMaterial=actOp(run,'reveal');invalidMaterial.payload.materialDigest='wrong';assert.equal((await push(boot,[invalidMaterial])).body.results[0].error.code,'material_mismatch');
 const secondInstall=crypto.randomUUID();await initialize(secondInstall);const secondBoot=await bootstrap(secondInstall);
 const wrongDevice={...actOp(run,'reveal'),installationId:secondInstall,replicaId:secondBoot.replicaId};assert.equal((await push(secondBoot,[wrongDevice])).body.results[0].error.code,'offline_grant_invalid');
 const reveal=actOp(run,'reveal');run=val(await push(boot,[reveal])).run;
 assert.equal(run.currentStep.phase,'reveal');assert.equal((await push(boot,[reveal])).body.results[0].status,'replayed');
 assert.equal((await push(boot,[{...reveal,operationId:crypto.randomUUID()}])).body.results[0].error.code,'stale_step');
 const firstRevealId=run.currentStep.id;run=val(await push(boot,[actOp(run,'rate','again')])).run;assert.equal(run.currentStep.phase,'recall');
 run=val(await push(boot,[actOp(run,'reveal')])).run;assert.notEqual(run.currentStep.id,firstRevealId);
 const finish=actOp(run,'rate','hard');injectDecisionFailure=true;assert.equal((await push(boot,[finish])).status,503);injectDecisionFailure=false;
 assert.equal((await request('/sensa/runs/'+run.id)).body.data.completion,null);
 const secondRuntime=val(await push(secondBoot,[{...await start(runtime.activity.id),installationId:secondInstall,replicaId:secondBoot.replicaId}]));
 const competing={...finish,operationId:crypto.randomUUID(),installationId:secondInstall,replicaId:secondBoot.replicaId,payload:{...finish.payload,grantId:secondRuntime.run.offlineGrant.id}};const finishes=await Promise.all([push(boot,[finish]),push(secondBoot,[competing])]);
 assert.deepEqual(finishes.map(x=>x.body.results[0].status).sort(),['accepted','conflict']);
 runtime=val(finishes.find(x=>x.body.results[0].status==='accepted'));run=runtime.run;
 assert.equal(run.completion.kind,'study_completion');assert.equal(run.completion.outcomeId,null);
 assert.equal(Date.parse(run.completion.dueAt)-Date.parse(finish.occurredAt),2*86400000);
 const replay=await push(finishes[0].body.results[0].status==='accepted'?boot:secondBoot,[finishes[0].body.results[0].status==='accepted'?finish:competing]);assert.equal(replay.body.results[0].status,'replayed');assert.equal(replay.body.results[0].value.runtime.run.completion.completionId,run.completion.completionId);
 const facts=await pool.query('SELECT (SELECT count(*) FROM sensa_consumer.completions WHERE retention_target_id=$1)::int AS c,(SELECT count(*) FROM sensa_consumer.scheduling_handoffs WHERE retention_target_id=$1)::int AS h,(SELECT count(*) FROM sensa_consumer.retention_memory WHERE retention_target_id=$1)::int AS m',[run.retentionTargetId]);assert.deepEqual(facts.rows[0],{c:1,h:1,m:1});
 const sync=(await request('/sensa/sync/pull',{wireVersion:'sensa-sync-v3',scopeEpoch:boot.scopeEpoch,replicaId:boot.replicaId,cursor:boot.syncCursor,limit:500})).body;
 assert.ok(sync.changes.filter((x:any)=>x.entityType==='run').every((x:any)=>x.snapshot.offlineGrant===null));
 // Fill the remaining daily slots with separate synthetic stable bindings.
 for(let n=6;n<=10;n++){
  const candidate=(await request('/sensa/catalog/targets/b1000000-0000-4000-8000-'+String(n).padStart(12,'0'))).body.data.candidate;h=await home();
  const added=await push(boot,[cmd('curriculum.add_target',{planId,expectedScopeRevision:h.plan.scopeRevision,candidateId:candidate.candidateId,source:candidate.source})]);assert.equal(added.body.results[0].value.target.plan.readiness,'ready');
 }
 h=await home();assert.equal((await push(boot,[operation(boot.replicaId,h.plan.revision,5,planId)])).body.results[0].status,'accepted');
 for(let i=1;i<5;i++){
  const next=cmd('activity.next',{activityId:runtime.activity.id,expectedRevision:runtime.activity.revision,mode:'mixed',allowEarlyRelearning:false,clockSessionId:clockId});
  if(i===4){const both=await Promise.all([push(boot,[next]),push(boot,[{...next,operationId:crypto.randomUUID()}])]);assert.deepEqual(both.map(x=>x.body.results[0].status).sort(),['accepted','conflict']);runtime=val(both.find(x=>x.body.results[0].status==='accepted'));}else runtime=val(await push(boot,[next]));
  run=runtime.run;assert.ok(run);run=val(await push(boot,[actOp(run,'reveal')])).run;runtime=val(await push(boot,[actOp(run,'rate','good')]));
 }
 assert.equal((await home()).plan.newStartedToday,5);
 runtime=val(await push(boot,[cmd('activity.next',{activityId:runtime.activity.id,expectedRevision:runtime.activity.revision,mode:'mixed',allowEarlyRelearning:false,clockSessionId:clockId})]));assert.equal(runtime.reason,'daily_limit');assert.equal(runtime.run,null);assert.equal(runtime.summary.immediateAvailable,false);assert.equal(runtime.summary.initialTargetIds.length,5);
 testNow=new Date(testNow.getTime()+86400000);runtime=val(await push(boot,[await start()]));run=runtime.run;assert.equal((await home()).plan.newStartedToday,1);
 const pause=cmd('activity.pause',{activityId:runtime.activity.id,expectedRevision:runtime.activity.revision,runId:run.id,afterOperationId:null});runtime=val(await push(boot,[pause]));assert.equal(runtime.activity.status,'paused');
 testNow=new Date(testNow.getTime()+86400000);runtime=val(await push(boot,[await start(runtime.activity.id)]));run=runtime.run;assert.equal((await home()).plan.newStartedToday,0);
 const late=actOp(run,'reveal');testNow=new Date(testNow.getTime()+8*86400000);run=val(await push(boot,[late])).run;
 const expired=actOp(run,'rate','good');expired.occurredAt=testNow.toISOString();expired.payload.clock.elapsedMs=8*86400000;assert.equal((await push(boot,[expired])).body.results[0].error.code,'clock_untrusted');
 runtime=val(await push(boot,[await start()]));run=runtime.run;runtime=val(await push(boot,[actOp(run,'rate','good')]));
 runtime=val(await push(boot,[cmd('activity.end',{activityId:runtime.activity.id,expectedRevision:runtime.activity.revision})]));assert.equal(runtime.summary.status,'ended');
 console.log('M1-C initial runtime passed: grant/clock/scope, local action protocol, fresh steps, atomic settlement, completion/handoff uniqueness, quota concurrency, next-day continuation, late upload, pause/end, private feed.');
}
if(process.argv.includes('--retention'))await runRetentionChecks({pool,issuer,token,initialize,bootstrap,request,push,now:()=>testNow,setNow:(at:Date)=>{testNow=at;},failDecision:(yes:boolean)=>{injectDecisionFailure=yes;}});
if(process.argv.includes('--checkin'))await runCheckInChecks({pool,issuer,token,initialize,bootstrap,request,push,now:()=>testNow,setNow:(at:Date)=>{testNow=at;},failCheckIn:(yes:boolean)=>{injectCheckInFailure=yes;}});
if(process.argv.includes('--crash')){const {runCrashChecks}=await import('./support/consumerCrashChecks.mts');await runCrashChecks({request,initialize,bootstrap,push,token,pool,issuer,jwk,now:()=>testNow});}
if(process.argv.includes('--provisioning'))await runProvisioningChecks({request,initialize,bootstrap,push,token,pool,issuer,now:()=>testNow,setNow:(at:Date)=>{testNow=at;},restartRequest:async(path:string,body:unknown,bearerToken:string)=>{const restarted=createConsumerRoutes({verify:createConsumerVerifier(issuer,createLocalJWKSet({keys:[jwk]})),transaction,semanticResolver:mockSemanticResolver,contentGenerator:mockContentGenerator,contentReviewer:mockContentReviewer,clock:()=>testNow});const response=await restarted.request(path,{method:'POST',headers:{authorization:'Bearer '+bearerToken,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}});
if(process.argv.includes('--semantic'))await runSemanticChecks({request,initialize,bootstrap,push,token,pool,issuer,failLedger:(yes:boolean)=>{injectFailure=yes;}});
if(process.argv.includes('--intake')){const intakeSubject=crypto.randomUUID();await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2)',[issuer,intakeSubject]);await runIntakeChecks({request,initialize,bootstrap,push,token,subject:intakeSubject,pool,issuer,failLedger:(yes:boolean)=>{injectFailure=yes;}});}
assert.equal((await request('/sensa/account/session/revoke',{operationId:crypto.randomUUID()})).status,200);
assert.equal((await request('/sensa/account/session/revoke',{operationId:crypto.randomUUID()})).status,200);
assert.equal((await request('/sensa/home')).status,401);
assert.equal((await push(boot,[])).status,401);
console.log('M1-A PostgreSQL/JWT/quantity/sync smoke passed: invitation, signature, idempotence, concurrency, atomic rollback, scope, cursor, revocation.');

if(process.argv.includes('--serve')) {
  const serverPackage='@hono/node-server';
  const {serve}=await import(serverPackage);
  let browserClockOffset=0;const browserApp=new Hono();
  browserApp.use('*',cors({origin:'http://127.0.0.1:3001',allowHeaders:['authorization','content-type','apikey','x-client-info','x-supabase-api-version']}));
  browserApp.route('',createConsumerRoutes({verify:createConsumerVerifier(issuer,createLocalJWKSet({keys:[jwk]})),transaction,mediaReader,semanticResolver:mockSemanticResolver,contentGenerator:mockContentGenerator,contentReviewer:mockContentReviewer,clock:()=>new Date(Date.now()+browserClockOffset)}));
  browserApp.get('/__test/environment',c=>c.json({semantic:'mock',content:'mock',auth:'synthetic'}));
  // Synthetic Auth API only in this explicitly launched loopback test harness.
  // This is NOT real Supabase mail delivery and is never imported by production.
  const browserUsers=new Map([['test@sensa.invalid',crypto.randomUUID()],['second@sensa.invalid',crypto.randomUUID()]]);
  for(const subject of browserUsers.values())await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2)',[issuer,subject]);
  async function session(email='test@sensa.invalid'){const subject=browserUsers.get(email)!,sessionId=crypto.randomUUID();return {access_token:await token(subject,sessionId),refresh_token:'local-only-test:'+email,token_type:'bearer',expires_in:3600,user:{id:subject,aud:'authenticated',role:'authenticated',email,email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()}};}
  browserApp.post('/__test/revoke-session',async c=>{const {email}=await c.req.json();const subject=browserUsers.get(email);if(!subject)return c.json({},400);await pool.query('UPDATE sensa_consumer.sessions SET revoked=true WHERE account_id IN (SELECT account_id FROM sensa_consumer.accounts WHERE issuer=$1 AND subject=$2)',[issuer,subject]);return c.json({revoked:true});});
  browserApp.post('/__test/checkin-failure',async c=>{const {enabled}=await c.req.json();injectCheckInFailure=enabled===true;return c.json({enabled:injectCheckInFailure});});
  browserApp.post('/__test/advance',async c=>{const input=await c.req.json();if(!Number.isSafeInteger(input.ms)||input.ms<0||input.ms>7*86400000)return c.json({error:'invalid'},400);browserClockOffset+=input.ms;return c.json({now:new Date(Date.now()+browserClockOffset).toISOString()});});
  browserApp.post('/auth/v1/otp',async c=>{const input=await c.req.json();return browserUsers.has(input.email)?c.json({}):c.json({msg:'Not invited'},403);});
  browserApp.post('/auth/v1/verify',async c=>{const input=await c.req.json();return input.token==='123456'&&browserUsers.has(input.email)?c.json(await session(input.email)):c.json({msg:'Invalid OTP'},400);});
  browserApp.post('/auth/v1/token',async c=>{const input=await c.req.json();const email=String(input.refresh_token).replace('local-only-test:','');return browserUsers.has(email)?c.json(await session(email)):c.json({msg:'Invalid token'},401);});
  browserApp.post('/auth/v1/logout',c=>c.json({}));
  serve({fetch:browserApp.fetch,hostname:'127.0.0.1',port:4319});console.log('Synthetic browser harness: 127.0.0.1:4319; test@sensa.invalid / 123456. Local PostgreSQL only.');
} else await pool.end();
