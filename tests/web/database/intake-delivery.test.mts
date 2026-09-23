/** Durable remote mailbox over real disposable Postgres; no model or external calls. */
import assert from 'node:assert/strict';
import pg from 'pg';

import {createConsumerRoutes} from '../../../apps/api/src/sensa/access/consumer.ts';
import {
  sensaAgentConnectionContractVersion,
  sensaAgentConnectionCredentialSchema,
  sensaAgentConnectionSetupSchema,
  sensaAgentIntakeContractVersion,
  sensaIntakeDeliveryContractVersion,
  sensaIntakeDeliveryReceiptSchema,
} from '../../../packages/contracts/src/sensa/index.ts';

const url=process.env.SENSA_ADMIN_TEST_DATABASE_URL??process.env.SENSA_TEST_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||!new URL(url).pathname.startsWith('/sensa_m1a_'))throw Error('Disposable loopback database required');
const pool=new pg.Pool({connectionString:url,max:4});
const subjects=[crypto.randomUUID(),crypto.randomUUID()],sessions=subjects.map(()=>crypto.randomUUID());
const app=createConsumerRoutes({telemetry:()=>{},verify:async request=>{const index=request.headers.get('authorization')==='Bearer second'?1:0;return {issuer:'https://fixture.supabase.co/auth/v1',subject:subjects[index]!,sessionId:sessions[index]!,email:`intake-${index}@example.invalid`};},transaction:async work=>{const db=await pool.connect();await db.query('BEGIN');try{await db.query('SET LOCAL ROLE backend_app');const result=await work(db);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}});
const request=async(path:string,token='first',body?:unknown)=>{const response=await app.request('http://fixture'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};};
const connect=async(token:string,connectionId:string,label='Codex',replacesConnectionId:string|null=null)=>{
 const setup=sensaAgentConnectionSetupSchema.parse((await request('/sensa/agent/connection-setups',token,{contractVersion:sensaAgentConnectionContractVersion,setupId:crypto.randomUUID(),connectionId,clientKind:'codex',label,replacesConnectionId})).body);
 assert.equal('token' in setup,false,'Web receives only a short-lived setup code');
 assert.equal((await request('/sensa/agent/connection-setups/exchange',token,{contractVersion:sensaAgentConnectionContractVersion,setupId:setup.setupId,setupCode:'sensa_setup_wrongwrongwrongwrongwrong'})).status,401);
 const credential=sensaAgentConnectionCredentialSchema.parse((await request('/sensa/agent/connection-setups/exchange',token,{contractVersion:sensaAgentConnectionContractVersion,setupId:setup.setupId,setupCode:setup.setupCode})).body);
 assert.equal((await request('/sensa/agent/connection-setups/exchange',token,{contractVersion:sensaAgentConnectionContractVersion,setupId:setup.setupId,setupCode:setup.setupCode})).status,409,'a setup code cannot be replayed');
 return credential;
};
const saved=process.env.SENSA_REGISTRATION_POLICY;process.env.SENSA_REGISTRATION_POLICY='registered';
try{
 const accounts=[];for(const token of ['first','second'])accounts.push((await request('/sensa/web/access/session',token,{installationId:crypto.randomUUID()})).body.accountId);
 const libraryId=crypto.randomUUID(),otherLibraryId=crypto.randomUUID(),clientId=crypto.randomUUID(),operationId=crypto.randomUUID();
 const context='I backed out.';
 const intake={contractVersion:'sensa-intake-v3',operationId,capturedAt:'2026-09-13T08:00:00.000Z',context:{modality:'text',textSegment:context,mediaReferenceIds:[],languageTag:'en',source:{client:'codex',url:null,title:'GPT Live conversation',sourceReferenceId:'conversation-1',domSelector:null,paragraphContext:null}},expression:{surfaceForm:'back out',languageTag:'en',occurrence:{surfaceForm:'backed out',locator:{kind:'text_span',start:2,end:12}},expressionTypeHint:'phrase'},sense:{senseKey:null,semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'原本准备做某事，后来决定退出或取消',prototypeScenes:[{summary:context,participantRoles:[],states:[],directionOrCausality:null}],includedCases:[context],excludedCases:[],neighborContrasts:[],openQuestions:[]},wordingSource:'llm_suggested',resolutionProvenance:{resolverKind:'language_model',provider:'codex',model:'fixture',policyVersion:'sensa-agent-intake-v1',sourceReferenceIds:['conversation-1']}}};
 const agentRequest={contractVersion:sensaAgentIntakeContractVersion,intake};
 const connection=await connect('first',clientId);
 const expiredSetup=sensaAgentConnectionSetupSchema.parse((await request('/sensa/agent/connection-setups','first',{contractVersion:sensaAgentConnectionContractVersion,setupId:crypto.randomUUID(),connectionId:crypto.randomUUID(),clientKind:'cursor',label:'Expired setup',replacesConnectionId:null})).body);
 await pool.query('UPDATE sensa_consumer.agent_connection_setups SET expires_at=created_at+interval \'1 millisecond\' WHERE setup_id=$1',[expiredSetup.setupId]);
 assert.equal((await request('/sensa/agent/connection-setups/exchange','first',{contractVersion:sensaAgentConnectionContractVersion,setupId:expiredSetup.setupId,setupCode:expiredSetup.setupCode})).status,410,'expired setup codes cannot activate a connection');
 assert.equal((await request('/sensa/agent/intakes',connection.token,agentRequest)).status,409,'an account with no local destination cannot claim storage success');
 const channel={contractVersion:sensaIntakeDeliveryContractVersion,libraryId};
 assert.deepEqual((await request('/sensa/intake/channel','first',channel)).body,{registered:true,libraryId});
 assert.equal((await request('/sensa/intake/channel','first',{...channel,libraryId:otherLibraryId})).status,409,'one account cannot silently replace its delivery library');
 assert.deepEqual((await request('/sensa/intake/channel','second',{...channel,libraryId:otherLibraryId})).body,{registered:true,libraryId:otherLibraryId});
 const queued=await request('/sensa/agent/intakes',connection.token,agentRequest);assert.equal(queued.status,200);assert.equal(sensaIntakeDeliveryReceiptSchema.parse(queued.body).deliveryState,'queued');
 assert.deepEqual((await request('/sensa/agent/intakes',connection.token,agentRequest)).body,queued.body,'a lost submit response replays the same queued receipt');
 const oldLimit=process.env.SENSA_AGENT_INTAKE_HOURLY_LIMIT;process.env.SENSA_AGENT_INTAKE_HOURLY_LIMIT='1';
 assert.equal((await request('/sensa/agent/intakes',connection.token,{...agentRequest,intake:{...intake,operationId:crypto.randomUUID()}})).status,429,'new operations are limited per connection');
 if(oldLimit===undefined)delete process.env.SENSA_AGENT_INTAKE_HOURLY_LIMIT;else process.env.SENSA_AGENT_INTAKE_HOURLY_LIMIT=oldLimit;
 assert.equal((await request('/sensa/agent/intakes',connection.token,{...agentRequest,intake:{...intake,capturedAt:'2026-09-13T08:01:00.000Z'}})).status,409,'one operation id cannot name changed content');
 const pulled=await request('/sensa/intake/deliveries/pull','first',{...channel,limit:20});assert.equal(pulled.body.deliveries.length,1);
 assert.deepEqual(pulled.body.deliveries[0].submission.client,{clientId,kind:'agent',label:'Codex'});
 assert.deepEqual(pulled.body.deliveries[0].submission.intake.acceptance,{mode:'delegated_agent',actorId:`agent:${clientId}`,basis:'explicit_user_request',authorizationReference:null},'trusted connection identity supplies delegated acceptance');
 const {acceptance:_acceptance,...deliveredFacts}=pulled.body.deliveries[0].submission.intake;assert.deepEqual(deliveredFacts,intake);
 assert.deepEqual((await request('/sensa/intake/deliveries/pull','second',{contractVersion:sensaIntakeDeliveryContractVersion,libraryId:otherLibraryId,limit:20})).body.deliveries,[],'another account cannot see the queue');
 const acknowledgement={contractVersion:sensaIntakeDeliveryContractVersion,libraryId,deliveryId:operationId,result:{route:'fast_track',personalMeaningId:crypto.randomUUID()},appliedAt:'2026-09-13T08:02:00.000Z'};
 const applied=await request('/sensa/intake/deliveries/ack','first',acknowledgement);assert.equal(applied.body.deliveryState,'applied');assert.deepEqual(applied.body.result,acknowledgement.result);
 assert.deepEqual((await request('/sensa/intake/deliveries/ack','first',acknowledgement)).body,applied.body,'a lost acknowledgement replays exactly');
 assert.equal((await request('/sensa/intake/deliveries/ack','first',{...acknowledgement,result:{route:'inbox',intakeId:crypto.randomUUID(),status:'pending_sense'}})).status,409);
 assert.equal((await request('/sensa/agent/intakes/'+operationId,connection.token)).body.deliveryState,'applied');
 assert.equal((await request('/sensa/agent/intakes/'+operationId,'first')).status,403,'a Web session is not an Agent connection');
 assert.deepEqual((await request('/sensa/intake/deliveries/pull','first',{...channel,limit:20})).body.deliveries,[]);
 assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.intake_envelopes WHERE account_id=$1',[accounts[0]])).rows[0].n,1);
 const listed=await request('/sensa/agent/connections','first');assert.equal(listed.body.connections[0].connectionId,clientId);assert.equal(listed.body.connections[0].state,'active');assert(listed.body.connections[0].lastUsedAt,'credential use is auditable without storing content');
 const replacementSetup=sensaAgentConnectionSetupSchema.parse((await request('/sensa/agent/connection-setups','first',{contractVersion:sensaAgentConnectionContractVersion,setupId:crypto.randomUUID(),connectionId:crypto.randomUUID(),clientKind:'codex',label:'Codex replacement',replacesConnectionId:clientId})).body);
 assert.equal((await request('/sensa/agent/intakes/'+operationId,connection.token)).status,200,'creating a replacement does not revoke the working connection');
 const replacement=sensaAgentConnectionCredentialSchema.parse((await request('/sensa/agent/connection-setups/exchange','first',{contractVersion:sensaAgentConnectionContractVersion,setupId:replacementSetup.setupId,setupCode:replacementSetup.setupCode})).body);
 assert.equal((await request('/sensa/agent/intakes/'+operationId,connection.token)).status,401,'successful replacement atomically revokes the previous credential');
 assert.equal((await request('/sensa/agent/intakes/'+operationId,replacement.token)).status,404,'a replacement connection cannot read another connection’s receipt');
 const audit=await request('/sensa/agent/connection-events','first');assert.deepEqual(new Set(audit.body.events.map((entry:any)=>entry.eventType)),new Set(['setup_created','activated','replaced']));
 assert.equal((await request('/sensa/agent/connections/revoke','first',{contractVersion:sensaAgentConnectionContractVersion,connectionId:replacement.connectionId})).status,200);
 assert.equal((await request('/sensa/agent/intakes/'+operationId,replacement.token)).status,401,'revocation immediately removes Agent intake access');
 console.log('PASS: one-time Agent setup, atomic replacement, derived acceptance, durable/idempotent/rate-limited intake, isolation, last-use audit, truthful apply status, and revocation all hold.');
}finally{if(saved===undefined)delete process.env.SENSA_REGISTRATION_POLICY;else process.env.SENSA_REGISTRATION_POLICY=saved;await pool.end();}
