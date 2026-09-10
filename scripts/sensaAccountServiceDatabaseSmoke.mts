/** Disposable local Postgres + real signed JWT, Hono, PKCE and quota SQL. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createConsumerVerifier} from '../apps/api/src/sensa/access/auth.ts';
import {createConsumerRoutes} from '../apps/api/src/sensa/access/consumer.ts';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
const url=process.env.SENSA_TEST_DATABASE_URL;
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname)||!new URL(url).pathname.startsWith('/sensa_m1a_'))throw new Error('Disposable loopback sensa_m1a_ database required');
const pool=new pg.Pool({connectionString:url,max:4});
const issuer='https://fixture.sensa.invalid/auth/v1',subject=crypto.randomUUID(),installationId=crypto.randomUUID();
const keys=await generateKeyPair('ES256'),jwk=await exportJWK(keys.publicKey);jwk.kid='fixture';jwk.alg='ES256';
const token=await new SignJWT({session_id:crypto.randomUUID(),email:'fixture@sensa.invalid'}).setProtectedHeader({alg:'ES256',kid:'fixture'}).setIssuer(issuer).setSubject(subject).setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
const app=createConsumerRoutes({verify:createConsumerVerifier(issuer,createLocalJWKSet({keys:[jwk]})),transaction:async work=>{
 const db=await pool.connect();await db.query('BEGIN');
 try{await db.query('SET LOCAL ROLE backend_app');const value=await work(db);await db.query('COMMIT');return value;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}});
async function request(path:string,body?:unknown,credential=token){const r=await app.request(path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};}
const saved={policy:process.env.SENSA_REGISTRATION_POLICY,provider:process.env.SENSA_SEMANTIC_PROVIDER,key:process.env.DEEPSEEK_API_KEY};
const originalFetch=globalThis.fetch;let providerCalls=0;
try{
 process.env.SENSA_REGISTRATION_POLICY='invited';
 assert.equal((await request('/sensa/web/access/session',{installationId})).status,403);
 process.env.SENSA_REGISTRATION_POLICY='registered';
 const [a,b]=await Promise.all([request('/sensa/web/access/session',{installationId}),request('/sensa/web/access/session',{installationId})]);
 assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(a.body.accountId,b.body.accountId);
 const accountId=a.body.accountId;
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM sensa_consumer.installations WHERE account_id=$1',[accountId])).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM sensa_consumer.plans WHERE learner_user_id=$1',[accountId])).rows[0].n,0);
 const verifier=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),state=verifier;
 const challenge=createHash('sha256').update(verifier).digest('base64url');
 const consent=await request('/sensa/extension/authorize',{installationId,state,challenge,redirectUri:'https://'+'a'.repeat(32)+'.chromiumapp.org/sensa'});assert.equal(consent.status,200);
 const code=new URL(consent.body.redirectUri).searchParams.get('code');
 assert.equal((await request('/sensa/extension/exchange',{installationId,state,verifier:'x'.repeat(64),code})).status,401);
 const exchanged=await request('/sensa/extension/exchange',{installationId,state,verifier,code});assert.equal(exchanged.status,200);assert.equal(exchanged.body.accountId,accountId);
 assert.equal((await request('/sensa/extension/exchange',{installationId,state,verifier,code})).status,401);
 process.env.SENSA_SEMANTIC_PROVIDER='deepseek';delete process.env.DEEPSEEK_API_KEY;
 assert.equal((await request('/sensa/service/status')).body.explanationAvailable,false);
 process.env.DEEPSEEK_API_KEY='synthetic-never-sent';
 globalThis.fetch=async(input,options)=>{
  assert.equal(String(input),'https://api.deepseek.com/chat/completions');
  assert.equal(JSON.parse(String(options?.body)).model,'deepseek-chat');providerCalls++;
  return Response.json({model:'fixture',choices:[{finish_reason:'stop',message:{content:'fixture'}}]});
 };
 const turn={id:crypto.randomUUID(),purpose:'teacher',body:{model:'sensa-managed',messages:[{role:'system',content:'fixture'},{role:'user',content:'fixture'}],max_tokens:100,stream:false}};
 const inputDigest=createHash('sha256').update(canonicalConsumerJson(turn)).digest('hex');
 const answer=await request('/sensa/native/agent/turn',{...turn,inputDigest});assert.equal(answer.status,200,JSON.stringify(answer.body));assert.equal(providerCalls,1);
 assert.equal((await request('/sensa/native/agent/turn',{...turn,inputDigest})).status,409);assert.equal(providerCalls,1);
 const web=await request('/sensa/service/status'),extension=await request('/sensa/service/status',undefined,exchanged.body.token);
 assert.equal(extension.status,200);assert.deepEqual(web.body.usage,extension.body.usage);assert.equal(web.body.usage.find((u:any)=>u.kind==='teacher').used,1);
 await pool.query('UPDATE sensa_consumer.invitations SET revoked=true WHERE issuer=$1 AND subject=$2',[issuer,subject]);
 assert.equal((await request('/sensa/web/access/session',{installationId})).status,403);
 assert.equal((await request('/sensa/service/status',undefined,exchanged.body.token)).status,401);
 assert.equal((await request('/sensa/service/status',undefined,'invalid')).status,401);
 console.log('PASS: real Postgres/restricted role, concurrent verified registration, no learning replica creation, PKCE/replay, default managed turn with intercepted fetch, shared usage and revocation. No browser or paid/network model calls.');
}finally{
 globalThis.fetch=originalFetch;
 for(const [name,value] of [['SENSA_REGISTRATION_POLICY',saved.policy],['SENSA_SEMANTIC_PROVIDER',saved.provider],['DEEPSEEK_API_KEY',saved.key]]){if(value===undefined)delete process.env[name!];else process.env[name!]=value;}
 await pool.end();
}
