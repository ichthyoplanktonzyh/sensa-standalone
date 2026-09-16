/** Durable remote mailbox over real disposable Postgres; no model or external calls. */
import assert from 'node:assert/strict';
import pg from 'pg';

import {createConsumerRoutes} from '../apps/api/src/sensa/access/consumer.ts';
import {
  sensaIntakeDeliveryContractVersion,
  sensaIntakeDeliveryReceiptSchema,
} from '../packages/contracts/src/sensa/index.ts';

const url=process.env.SENSA_ADMIN_TEST_DATABASE_URL??process.env.SENSA_TEST_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||!new URL(url).pathname.startsWith('/sensa_m1a_'))throw Error('Disposable loopback database required');
const pool=new pg.Pool({connectionString:url,max:4});
const subjects=[crypto.randomUUID(),crypto.randomUUID()],sessions=subjects.map(()=>crypto.randomUUID());
const app=createConsumerRoutes({telemetry:()=>{},verify:async request=>{const index=request.headers.get('authorization')==='Bearer second'?1:0;return {issuer:'https://fixture.supabase.co/auth/v1',subject:subjects[index]!,sessionId:sessions[index]!,email:`intake-${index}@example.invalid`};},transaction:async work=>{const db=await pool.connect();await db.query('BEGIN');try{await db.query('SET LOCAL ROLE backend_app');const result=await work(db);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}});
const request=async(path:string,token='first',body?:unknown)=>{const response=await app.request('http://fixture'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};};
const saved=process.env.SENSA_REGISTRATION_POLICY;process.env.SENSA_REGISTRATION_POLICY='registered';
try{
 const accounts=[];for(const token of ['first','second'])accounts.push((await request('/sensa/web/access/session',token,{installationId:crypto.randomUUID()})).body.accountId);
 const libraryId=crypto.randomUUID(),otherLibraryId=crypto.randomUUID(),clientId=crypto.randomUUID(),operationId=crypto.randomUUID();
 const context='I backed out.';
 const submission={contractVersion:sensaIntakeDeliveryContractVersion,client:{clientId,kind:'agent',label:'Codex'},intake:{contractVersion:'sensa-intake-v3',operationId,capturedAt:'2026-09-13T08:00:00.000Z',context:{modality:'text',textSegment:context,mediaReferenceIds:[],languageTag:'en',source:{client:'codex',url:null,title:'GPT Live conversation',sourceReferenceId:'conversation-1',domSelector:null,paragraphContext:null}},expression:{surfaceForm:'back out',languageTag:'en',occurrence:{surfaceForm:'backed out',locator:{kind:'text_span',start:2,end:12}},expressionTypeHint:'phrase'},sense:{senseKey:null,semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'原本准备做某事，后来决定退出或取消',prototypeScenes:[{summary:context,participantRoles:[],states:[],directionOrCausality:null}],includedCases:[context],excludedCases:[],neighborContrasts:[],openQuestions:[]},wordingSource:'llm_suggested',resolutionProvenance:{resolverKind:'language_model',provider:'codex',model:'fixture',policyVersion:'sensa-agent-intake-v1',sourceReferenceIds:['conversation-1']}},acceptance:{mode:'delegated_agent',actorId:'codex',basis:'explicit_user_request',authorizationReference:null}}};
 assert.equal((await request('/sensa/intake/deliveries','first',submission)).status,409,'an account with no local destination cannot claim storage success');
 const channel={contractVersion:sensaIntakeDeliveryContractVersion,libraryId};
 assert.deepEqual((await request('/sensa/intake/channel','first',channel)).body,{registered:true,libraryId});
 assert.equal((await request('/sensa/intake/channel','first',{...channel,libraryId:otherLibraryId})).status,409,'one account cannot silently replace its delivery library');
 assert.deepEqual((await request('/sensa/intake/channel','second',{...channel,libraryId:otherLibraryId})).body,{registered:true,libraryId:otherLibraryId});
 const queued=await request('/sensa/intake/deliveries','first',submission);assert.equal(queued.status,200);assert.equal(sensaIntakeDeliveryReceiptSchema.parse(queued.body).deliveryState,'queued');
 assert.deepEqual((await request('/sensa/intake/deliveries','first',submission)).body,queued.body,'a lost submit response replays the same queued receipt');
 assert.equal((await request('/sensa/intake/deliveries','first',{...submission,intake:{...submission.intake,capturedAt:'2026-09-13T08:01:00.000Z'}})).status,409,'one operation id cannot name changed content');
 const pulled=await request('/sensa/intake/deliveries/pull','first',{...channel,limit:20});assert.equal(pulled.body.deliveries.length,1);assert.deepEqual(pulled.body.deliveries[0].submission,submission);
 assert.deepEqual((await request('/sensa/intake/deliveries/pull','second',{contractVersion:sensaIntakeDeliveryContractVersion,libraryId:otherLibraryId,limit:20})).body.deliveries,[],'another account cannot see the queue');
 const acknowledgement={contractVersion:sensaIntakeDeliveryContractVersion,libraryId,deliveryId:operationId,result:{route:'fast_track',personalMeaningId:crypto.randomUUID()},appliedAt:'2026-09-13T08:02:00.000Z'};
 const applied=await request('/sensa/intake/deliveries/ack','first',acknowledgement);assert.equal(applied.body.deliveryState,'applied');assert.deepEqual(applied.body.result,acknowledgement.result);
 assert.deepEqual((await request('/sensa/intake/deliveries/ack','first',acknowledgement)).body,applied.body,'a lost acknowledgement replays exactly');
 assert.equal((await request('/sensa/intake/deliveries/ack','first',{...acknowledgement,result:{route:'inbox',intakeId:crypto.randomUUID(),status:'pending_sense'}})).status,409);
 assert.equal((await request('/sensa/intake/deliveries/'+operationId,'first')).body.deliveryState,'applied');
 assert.deepEqual((await request('/sensa/intake/deliveries/pull','first',{...channel,limit:20})).body.deliveries,[]);
 assert.equal((await request('/sensa/intake/deliveries/'+operationId,'second')).status,404);
 assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.intake_envelopes WHERE account_id=$1',[accounts[0]])).rows[0].n,1);
 console.log('PASS: remote Agent intake queues durably, replays idempotently, stays account/library isolated, distinguishes queued from applied, and accepts delegated user confirmation without semantic re-evaluation.');
}finally{if(saved===undefined)delete process.env.SENSA_REGISTRATION_POLICY;else process.env.SENSA_REGISTRATION_POLICY=saved;await pool.end();}
