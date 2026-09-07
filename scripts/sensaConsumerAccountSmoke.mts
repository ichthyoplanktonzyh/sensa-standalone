import assert from 'node:assert/strict';
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
let injectFailure=false;
async function transaction<T>(work:(db:DatabaseExecutor)=>Promise<T>):Promise<T> {
  const client=await pool.connect();await client.query('BEGIN');
  try {
    const result=await work({query:async(text,params)=>{
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
const app=new Hono();app.use('*',cors({origin:['http://127.0.0.1:3001','http://localhost:3001'],allowHeaders:['authorization','content-type','apikey','x-client-info','x-supabase-api-version','x-installation-id']}));
app.route('',createConsumerRoutes({verify:createConsumerVerifier(issuer,createLocalJWKSet({keys:[jwk]})),transaction}));
const bearer=await token();const install=crypto.randomUUID();
async function request(path:string,body?:unknown,bearerToken=bearer){
  const response=await app.request(path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+bearerToken,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json() as any};
}
async function bootstrap(installationId=install,bearerToken=bearer){return (await request('/sensa/sync/bootstrap',{wireVersion:'sensa-sync-v3',installationId,replicaId:null},bearerToken)).body;}
async function initialize(installationId=install,bearerToken=bearer){return request('/sensa/account/session',{installationId,platform:'web',timeZone:'Asia/Shanghai'},bearerToken);}
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
assert.equal((await request('/sensa/account/session/revoke',{operationId:crypto.randomUUID()})).status,200);
assert.equal((await request('/sensa/account/session/revoke',{operationId:crypto.randomUUID()})).status,200);
assert.equal((await request('/sensa/home')).status,401);
assert.equal((await push(boot,[])).status,401);
console.log('M1-A PostgreSQL/JWT/quantity/sync smoke passed: invitation, signature, idempotence, concurrency, atomic rollback, scope, cursor, revocation.');

if(process.argv.includes('--serve')) {
  const serverPackage='@hono/node-server';
  const {serve}=await import(serverPackage);
  const browserApp=new Hono();
  browserApp.use('*',cors({origin:'http://127.0.0.1:3001',allowHeaders:['authorization','content-type','apikey','x-client-info','x-supabase-api-version']}));
  browserApp.route('',createConsumerRoutes({verify:createConsumerVerifier(issuer,createLocalJWKSet({keys:[jwk]})),transaction}));
  // Synthetic Auth API only in this explicitly launched loopback test harness.
  // This is NOT real Supabase mail delivery and is never imported by production.
  const browserSubject=crypto.randomUUID();await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2)',[issuer,browserSubject]);
  async function session(){const sessionId=crypto.randomUUID();return {access_token:await token(browserSubject,sessionId),refresh_token:'local-only-test',token_type:'bearer',expires_in:3600,user:{id:browserSubject,aud:'authenticated',role:'authenticated',email:'test@sensa.invalid',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()}};}
  browserApp.post('/auth/v1/otp',async c=>{const input=await c.req.json();return input.email==='test@sensa.invalid'?c.json({}):c.json({msg:'Not invited'},403);});
  browserApp.post('/auth/v1/verify',async c=>{const input=await c.req.json();return input.token==='123456'&&input.email==='test@sensa.invalid'?c.json(await session()):c.json({msg:'Invalid OTP'},400);});
  browserApp.post('/auth/v1/token',async c=>c.json(await session()));
  browserApp.post('/auth/v1/logout',c=>c.json({}));
  serve({fetch:browserApp.fetch,hostname:'127.0.0.1',port:4319});console.log('Synthetic browser harness: 127.0.0.1:4319; test@sensa.invalid / 123456. Local PostgreSQL only.');
} else await pool.end();
