import assert from 'node:assert/strict';
import pg from 'pg';
import {createConsumerRoutes} from '../apps/api/dist/sensa/access/consumer.js';
import {semanticDigest} from '../apps/api/dist/sensa/personal/nativeSemantic.js';
import type {DatabaseExecutor} from '../apps/api/src/database/index.js';
const url=process.env.SENSA_TEST_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||!new URL(url).pathname.startsWith('/sensa_native_semantic_'))throw new Error('Isolated native semantic test database required');
const pool=new pg.Pool({connectionString:url});
async function transaction<T>(work:(db:DatabaseExecutor)=>Promise<T>){const c=await pool.connect();await c.query('BEGIN');try{const r=await work({query:(s,p)=>c.query(s,p as unknown[])});await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
const subject=crypto.randomUUID(),session=crypto.randomUUID();let calls=0,revoke=false,now=new Date();
const issuer='native-semantic-smoke';
const app=createConsumerRoutes({transaction,clock:()=>now,verify:async()=>({issuer,subject,sessionId:session,email:null}),semanticResolver:async()=>{
 calls++;if(revoke)await pool.query('UPDATE sensa_consumer.invitations SET revoked=true WHERE issuer=$1 AND subject=$2',[issuer,subject]);
 return {proposal:null,provider:'fixture',model:'no-cost',policyVersion:'consumer-semantic-v4'};
}});
const post=async(path:string,body:unknown)=>{const r=await app.request(path,{method:'POST',headers:{Authorization:'Bearer native-test','Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
const input=async()=>{const payload={version:'sensa-native-semantic-v1',id:crypto.randomUUID(),snapshot:{sentence:'The crane moved.',language:'en',source:{url:null,title:'private fixture',capturedAt:now.toISOString()},expression:{text:'crane',start:4,end:9}},focus:null};return {...payload,inputDigest:await semanticDigest(payload)};};
try{
 await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2)',[issuer,subject]);
 assert.equal((await post('/sensa/account/session',{installationId:crypto.randomUUID(),platform:'web',timeZone:'Asia/Shanghai'})).status,200);
 const first=await input();const concurrent=await Promise.all([post('/sensa/native/semantic/resolve',first),post('/sensa/native/semantic/resolve',first)]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 assert.equal((await post('/sensa/native/semantic/resolve',first)).body.code,'native_request_consumed');assert.equal(calls,1);
 assert.equal((await post('/sensa/native/semantic/resolve',{...first,inputDigest:'a'.repeat(64)})).status,400);assert.equal(calls,1);
 const altered={...first,focus:'another meaning'};const {inputDigest:_digest,...payload}=altered;altered.inputDigest=await semanticDigest(payload);assert.equal((await post('/sensa/native/semantic/resolve',altered)).body.code,'native_request_id_reuse');assert.equal(calls,1);
 for(let i=1;i<30;i++)assert.equal((await post('/sensa/native/semantic/resolve',await input())).status,200);
 assert.equal((await post('/sensa/native/semantic/resolve',await input())).body.code,'native_semantic_daily_budget');assert.equal(calls,30);
 const account=(await pool.query('SELECT account_id FROM sensa_consumer.accounts WHERE issuer=$1 AND subject=$2',[issuer,subject])).rows[0].account_id;
 const usage=(await pool.query('SELECT * FROM sensa_consumer.native_semantic_usage WHERE account_id=$1',[account])).rows;
 assert.equal(usage.length,30);assert.deepEqual(Object.keys(usage[0]).sort(),['account_id','created_at','input_digest','request_id']);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1',[account])).rows[0].n,0);
 now=new Date(now.getTime()+86400001);revoke=true;
 assert.equal((await post('/sensa/native/semantic/resolve',await input())).status,403);assert.equal(calls,31);
 console.log('PASS: real Postgres quota, replay prevention, day rollover, revocation during resolution; no personal payload persisted by native service.');
}finally{await pool.end();}
