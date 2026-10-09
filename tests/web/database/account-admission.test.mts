/** Real disposable PostgreSQL + signed identities; no provider or mail calls. */
import assert from 'node:assert/strict';
import pg from 'pg';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {test} from 'vitest';
import {createConsumerRoutes} from '../../../apps/api/src/sensa/access/consumer';
import {createConsumerVerifier} from '../../../apps/api/src/sensa/access/auth';

test('invitation admission rejects uninvited and revoked identities without provisioning or reviving access',async()=>{
 const url=process.env.SENSA_ADMIN_TEST_DATABASE_URL??process.env.SENSA_TEST_DATABASE_URL;
 if(!url||new URL(url).hostname!=='127.0.0.1'||!new URL(url).pathname.startsWith('/sensa_m1a_'))throw Error('Disposable loopback database required');
 const pool=new pg.Pool({connectionString:url,max:4});
 const keys=await generateKeyPair('ES256'),jwk=await exportJWK(keys.publicKey);jwk.kid='admission-fixture';
 const issuer='https://admission.fixture.supabase.co/auth/v1',subject=crypto.randomUUID(),sessionId=crypto.randomUUID();
 const bearer=await new SignJWT({session_id:sessionId,email:'admission@example.invalid',amr:[{method:'magiclink',timestamp:Math.floor(Date.now()/1000)}]})
  .setProtectedHeader({alg:'ES256',kid:jwk.kid}).setIssuer(issuer).setSubject(subject).setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
 const app=createConsumerRoutes({telemetry:()=>{},verify:createConsumerVerifier(issuer,createLocalJWKSet({keys:[jwk]})),transaction:async work=>{
  const db=await pool.connect();await db.query('BEGIN');
  try{await db.query('SET LOCAL ROLE backend_app');const result=await work(db);await db.query('COMMIT');return result;}
  catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
 }});
 const request=async(path:string,body?:unknown)=>{
  const response=await app.request(path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json() as {code?:string;accountId?:string;authorized?:boolean}};
 };
 const access=()=>request('/sensa/web/access/session',{installationId:crypto.randomUUID()});
 const previous=process.env.SENSA_REGISTRATION_POLICY;
 try{
  process.env.SENSA_REGISTRATION_POLICY='invited';
  assert.deepEqual(await access(),{status:403,body:{code:'invite_required'}});
  assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.accounts WHERE issuer=$1 AND subject=$2',[issuer,subject])).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.invitations WHERE issuer=$1 AND subject=$2',[issuer,subject])).rows[0].n,0,'Auth success is not an invitation');
  await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2)',[issuer,subject]);
  const admitted=await access();assert.equal(admitted.status,200);assert.equal(admitted.body.authorized,true);assert.ok(admitted.body.accountId);
  assert.equal((await access()).body.accountId,admitted.body.accountId,'repeated initialization reuses the account');
  assert.equal((await request('/sensa/service/status')).status,200);
  await pool.query('UPDATE sensa_consumer.invitations SET revoked=true WHERE issuer=$1 AND subject=$2',[issuer,subject]);
  assert.deepEqual(await access(),{status:403,body:{code:'invite_required'}});
  assert.equal((await request('/sensa/service/status')).status,403,'the existing signed session cannot bypass revocation');
  assert.equal((await request('/sensa/library-sync/head')).status,403,'the existing signed session cannot restore private content');
  process.env.SENSA_REGISTRATION_POLICY='registered';
  assert.deepEqual(await access(),{status:403,body:{code:'invite_required'}},'registered policy never resurrects a revoked invite');
  const row=(await pool.query('SELECT revoked FROM sensa_consumer.invitations WHERE issuer=$1 AND subject=$2',[issuer,subject])).rows[0];assert.equal(row.revoked,true);
 }finally{
  if(previous===undefined)delete process.env.SENSA_REGISTRATION_POLICY;else process.env.SENSA_REGISTRATION_POLICY=previous;
  await pool.end();
 }
});
