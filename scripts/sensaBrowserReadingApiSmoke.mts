import assert from 'node:assert/strict';
import pg from 'pg';
import {createConsumerRoutes} from '../apps/api/dist/sensa/access/consumer.js';
import {captureSnapshotSchema,captureIdentity,captureSourceLink} from '@sensa/contracts/sensa';
import {mockSemanticResolver} from './support/consumerSemanticChecks.mts';
import type {DatabaseExecutor} from '../apps/api/src/database/index.js';
const url=process.env.SENSA_TEST_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||!new URL(url).pathname.startsWith('/sensa_m1a_browser_'))throw new Error('Isolated browser test database required');
const pool=new pg.Pool({connectionString:url});
async function transaction<T>(work:(db:DatabaseExecutor)=>Promise<T>){const client=await pool.connect();await client.query('BEGIN');try{const result=await work({query:(sql,params)=>client.query(sql,params as unknown[])});await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
const subjects=[crypto.randomUUID(),crypto.randomUUID()];const sessions=[crypto.randomUUID(),crypto.randomUUID()];
await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2),($1,$3)',['browser-smoke',...subjects]);
let calls=0,failing=false,release:(()=>void)|null=null,now=new Date();
const app=createConsumerRoutes({transaction,clock:()=>now,verify:async request=>{const index=request.headers.get('authorization')==='Bearer second'?1:0;return {issuer:'browser-smoke',subject:subjects[index],sessionId:sessions[index],email:null};},
  readingCompletion:async(connection,messages,json)=>{calls++;assert.equal(connection.apiKey,'fixture-secret-key');if(failing)throw new Error('do not expose provider payload');if(release)await new Promise<void>(resolve=>{release=resolve;});if(json){const input=JSON.parse(messages[1].content);return JSON.stringify({proposal:(await mockSemanticResolver(input,input.learnerFocus?{text:input.learnerFocus}:null)).proposal});}return '这是一段阅读译文。';}});
async function request(path:string,body?:unknown,second=false){const response=await app.request(path,{method:body===undefined?'GET':'POST',headers:{authorization:second?'Bearer second':'Bearer first','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};}
try{
  const installs=[crypto.randomUUID(),crypto.randomUUID()];
  for(let i=0;i<2;i++)assert.equal((await request('/sensa/account/session',{installationId:installs[i],platform:'extension',timeZone:'Asia/Shanghai'},i===1)).status,200);
  const settings=(await request('/sensa/reading/settings')).body;assert.equal(settings.revision,0);
  const id=crypto.randomUUID();const provider={id,name:'测试连接',baseUrl:'https://api.deepseek.com',model:'fixture-model',enabled:true,apiKey:'fixture-secret-key'};
  const assignments={selection:id,page:id,subtitles:id,action:id,meaning:id};
  const saved=await request('/sensa/reading/settings',{expectedRevision:0,providers:[provider],assignments});assert.equal(saved.status,200);assert.equal(saved.body.revision,1);assert.equal(saved.body.providers[0].keyConfigured,true);assert.ok(!JSON.stringify(saved.body).includes('fixture-secret-key'));assert.equal(calls,0);
  const raw=(await pool.query('SELECT encrypted_settings FROM sensa_consumer.reading_settings')).rows;assert.ok(raw.length);assert.ok(raw.every(r=>!r.encrypted_settings.includes('fixture-secret-key')));
  assert.equal((await request('/sensa/reading/settings',undefined,true)).body.providers.length,0);
  assert.equal((await request('/sensa/reading/settings',{expectedRevision:0,providers:[provider],assignments})).body.code,'settings_conflict');
  const {apiKey:_,...withoutKey}=provider;
  assert.equal((await request('/sensa/reading/settings',{expectedRevision:1,providers:[withoutKey],assignments})).body.revision,2);
  assert.equal((await request('/sensa/reading/settings',{expectedRevision:2,providers:[{...provider,baseUrl:'https://127.0.0.1'}],assignments})).body.code,'provider_origin_not_allowed');
  const originalFetch=globalThis.fetch;let modelFetches=0;
  try{globalThis.fetch=async(input,init)=>{assert.equal(String(input),'https://api.deepseek.com/models');assert.equal((init?.headers as Record<string,string>).authorization,'Bearer fixture-secret-key');modelFetches++;return new Response(JSON.stringify({data:[{id:'fixture-model'}]}),{status:200,headers:{'content-type':'application/json'}});};
    assert.deepEqual((await request('/sensa/reading/models',{providerId:id})).body.models,['fixture-model']);
    assert.equal((await request('/sensa/reading/models',{providerId:id},true)).status,404);assert.equal(modelFetches,1);
  }finally{globalThis.fetch=originalFetch;}
  const input={id:crypto.randomUUID(),feature:'selection',text:'She took her time.',context:'',instruction:''};
  assert.equal((await request('/sensa/reading/run',input)).body.text,'这是一段阅读译文。');assert.equal(calls,1);
  assert.equal((await request('/sensa/reading/run',input)).body.status,'ready');assert.equal(calls,1);
  assert.equal((await request('/sensa/reading/run',{...input,text:'Different text'})).body.code,'reading_id_reuse');
  assert.equal((await request('/sensa/reading/run',input,true)).body.code,'provider_not_configured');
  failing=true;const failure={...input,id:crypto.randomUUID()};const failed=await request('/sensa/reading/run',failure);assert.equal(failed.body.error,'provider_unavailable');assert.ok(!JSON.stringify(failed).includes('do not expose'));const before=calls;await request('/sensa/reading/run',failure);assert.equal(calls,before);failing=false;
  const snapshot=captureSnapshotSchema.parse({sentence:'She took her time.',language:'en',expression:{text:'took',start:4,end:8},source:{url:'https://www.youtube.com/watch?v=abcdefghijk',title:'Fixture video',capturedAt:new Date().toISOString(),video:{platform:'youtube',videoId:'abcdefghijk',startMs:12500,endMs:15500}}});
  assert.match(captureSourceLink(snapshot.source)!,/t=12s/u);
  assert.notDeepEqual(captureIdentity(snapshot),captureIdentity({...snapshot,source:{...snapshot.source,video:{...snapshot.source.video!,startMs:13000}}}));
  assert.equal(captureSnapshotSchema.safeParse({...snapshot,source:{...snapshot.source,url:'https://example.com'}}).success,false);
  const lookupId=crypto.randomUUID();const lookup=await request('/sensa/semantic/lookups',{id:lookupId,snapshot});assert.equal(lookup.body.status,'ready',JSON.stringify(lookup.body));assert.equal(lookup.body.provenance.model,'fixture-model');
  const previousCalls=calls;await request('/sensa/semantic/lookups',{id:lookupId,snapshot});assert.equal(calls,previousCalls);
  const boot=(await request('/sensa/sync/bootstrap',{wireVersion:'sensa-sync-v3',installationId:installs[0],replicaId:null})).body;
  const fastSnapshot={...snapshot,source:{...snapshot.source,video:{...snapshot.source.video!,startMs:20000,endMs:23000}}};
  const fastId=crypto.randomUUID();
  const fastLookup=(await request('/sensa/semantic/lookups',{id:fastId,snapshot:fastSnapshot})).body;
  assert.equal(fastLookup.status,'ready');assert.equal(fastLookup.focus,null);assert.equal(fastLookup.provenance.policyVersion,'consumer-semantic-v4');
  const bootstrap=async()=>(await request('/sensa/sync/bootstrap',{wireVersion:'sensa-sync-v3',installationId:installs[0],replicaId:boot.replicaId})).body;
  const queried=await bootstrap();assert.equal(queried.meanings.length,0);assert.equal(queried.intakes.length,0);
  const fastAccept={operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId:installs[0],replicaId:boot.replicaId,dependsOn:[],kind:'semantic.accept',payload:{lookupId:fastId,expectedRevision:'1',intakeId:null,consent:'accept_context_expression_sense'}};
  const fastPush={wireVersion:'sensa-sync-v3',canonicalizerVersion:'sensa-sync-v3-canonical-1',scopeEpoch:boot.scopeEpoch,replicaId:boot.replicaId,operations:[fastAccept]};
  const fastResult=(await request('/sensa/sync/push',fastPush)).body.results[0];
  assert.equal(fastResult.status,'accepted',JSON.stringify(fastResult));assert.equal(fastResult.value.meaning.focus,null);assert.equal(fastResult.value.meaning.acceptanceKind,'direct');assert.equal(fastResult.value.plan,null);
  assert.equal((await request('/sensa/sync/push',fastPush)).body.results[0].status,'replayed');
  const fastState=await bootstrap();assert.equal(fastState.meanings.length,1);assert.equal(fastState.intakes.length,0);assert.equal(fastState.targets.length,0);assert.equal(fastState.runs.length,0);assert.equal(fastState.checkins.length,0);
  const ambiguousId=crypto.randomUUID();const ambiguousSnapshot={...snapshot,sentence:'He waited by the bank.',expression:{text:'bank',start:17,end:21}};
  const ambiguous=(await request('/sensa/semantic/lookups',{id:ambiguousId,snapshot:ambiguousSnapshot})).body;
  assert.equal(ambiguous.status,'unresolved');assert.equal(ambiguous.focus,null);
  const denied=(await request('/sensa/sync/push',{...fastPush,operations:[{...fastAccept,operationId:crypto.randomUUID(),payload:{...fastAccept.payload,lookupId:ambiguousId}}]})).body.results[0];
  assert.equal(denied.error.code,'proposal_not_ready');assert.equal((await bootstrap()).meanings.length,1);
  const clarified=(await request('/sensa/semantic/lookups',{id:crypto.randomUUID(),snapshot:ambiguousSnapshot,clarification:{previousLookupId:ambiguousId,text:'我关注河流边缘的陆地。'}})).body;
  assert.equal(clarified.status,'ready');assert.equal(clarified.focus.previousLookupId,ambiguousId);assert.equal(clarified.focus.text,'我关注河流边缘的陆地。');
  assert.equal((await bootstrap()).meanings.length,1); // Clarification still proposes only.
  console.log('PASS: ready lookup creates no inventory; direct fast-track acceptance preserves null focus, skips Inbox and learning, replays once; unresolved cannot be accepted.');
  const operation={operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId:installs[0],replicaId:boot.replicaId,dependsOn:[],kind:'intake.save',payload:{snapshot}};
  const syncInput={wireVersion:'sensa-sync-v3',canonicalizerVersion:'sensa-sync-v3-canonical-1',scopeEpoch:boot.scopeEpoch,replicaId:boot.replicaId,operations:[operation]};
  const pushed=(await request('/sensa/sync/push',syncInput)).body;assert.equal(pushed.results[0].status,'accepted');const intake=pushed.results[0].value.intake;
  assert.deepEqual((await request('/sensa/intakes/'+intake.id)).body.data.snapshot.source.video,snapshot.source.video);
  assert.equal((await request('/sensa/sync/push',syncInput)).body.results[0].status,'replayed');
  assert.equal((await request('/sensa/intakes/'+intake.id,undefined,true)).status,404);
  const accept={...operation,operationId:crypto.randomUUID(),kind:'semantic.accept',payload:{lookupId,expectedRevision:'1',intakeId:intake.id,consent:'accept_context_expression_sense'}};
  const accepted=(await request('/sensa/sync/push',{...syncInput,operations:[accept]})).body;assert.equal(accepted.results[0].status,'accepted',JSON.stringify(accepted));assert.deepEqual(accepted.results[0].value.meaning.snapshot.source.video,snapshot.source.video);
  console.log('PASS: encrypted provider persistence, redaction, account isolation, revision conflict, endpoint restriction, explicit calls, idempotent reading/errors, video source contract and Postgres intake replay; no paid calls.');
  if(process.argv.includes('--browser')){
    const {browserPortNativeChecks}=await import('./support/browserPortNativeChecks.mts');
    const accountId=(await pool.query('SELECT account_id FROM sensa_consumer.accounts WHERE subject=$1',[subjects[0]])).rows[0].account_id;
    await browserPortNativeChecks(app,{accountId,installationId:installs[0],replicaId:boot.replicaId,epoch:boot.scopeEpoch},async()=>Boolean((await pool.query("SELECT id FROM sensa_consumer.intakes WHERE learner_user_id=$1 AND snapshot->'source'->>'url'=$2",[accountId,'http://127.0.0.1:4327/article'])).rows.length));
  }
  release=()=>{};const held={...input,id:crypto.randomUUID()};const callsBefore=calls;const pending=request('/sensa/reading/run',held);
  for(let i=0;i<100&&calls===callsBefore;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(calls,callsBefore+1);
  assert.equal((await request('/sensa/reading/run',held)).body.status,'running');assert.equal(calls,callsBefore+1);
  now=new Date(now.getTime()+46000);assert.equal((await request('/sensa/reading/run',held)).body.error,'reading_timeout');release!();release=null;assert.equal((await pending).body.error,'reading_timeout');
  release=()=>{};const count=calls;const revokedPending=request('/sensa/reading/run',{...input,id:crypto.randomUUID()});
  for(let i=0;i<100&&calls===count;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(calls,count+1);
  assert.equal((await request('/sensa/account/session/revoke',{operationId:crypto.randomUUID()})).status,200);release!();release=null;assert.equal((await revokedPending).status,401);
  console.log('PASS: model listing stays server-side, concurrent deduplication, late-result timeout and revoked-session result isolation.');
}finally{await pool.end();}
