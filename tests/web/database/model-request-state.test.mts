/** Managed-model request lifecycle over disposable Postgres; no model/network calls. */
import assert from 'node:assert/strict';
import pg from 'pg';
import {ConsumerError} from '../../../apps/api/src/sensa/access/auth.ts';
import {failModelRequestAfterExecution,failModelRequestBeforeExecution,markModelRequestRunning,purgeExpiredModelRequests,reserveModelRequest,succeedModelRequest} from '../../../apps/api/src/sensa/models/requests.ts';
import {test} from 'vitest';

test('model request receipts and budgets preserve execution lifecycle',async()=>{
const url=process.env.SENSA_ADMIN_TEST_DATABASE_URL??process.env.SENSA_TEST_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||!new URL(url).pathname.startsWith('/sensa_m1a_'))throw Error('Disposable loopback database required');
const pool=new pg.Pool({connectionString:url,max:3});
const issuer='https://fixture.supabase.co/auth/v1';
const createAccount=async()=>{
 const id=crypto.randomUUID(),subject=crypto.randomUUID();
 await pool.query('INSERT INTO core.accounts(account_id,email) VALUES($1,$2)',[id,'model-state@example.invalid']);
 await pool.query('INSERT INTO core.learners(learner_user_id) VALUES($1)',[id]);
 await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2)',[issuer,subject]);
 await pool.query("INSERT INTO sensa_consumer.accounts(account_id,learner_user_id,issuer,subject,time_zone) VALUES($1,$1,$2,$3,'UTC')",[id,issuer,subject]);
 return id;
};
const tx=async<T>(work:(db:pg.PoolClient)=>Promise<T>)=>{const db=await pool.connect();await db.query('BEGIN');try{await db.query('SET LOCAL ROLE backend_app');const value=await work(db);await db.query('COMMIT');return value;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}};
const expectCode=async(work:()=>Promise<unknown>,code:string)=>assert.rejects(work,error=>error instanceof ConsumerError&&error.code===code);
const now=new Date('2026-09-21T05:00:00.000Z'),digest='a'.repeat(64);
try{
 const accountId=await createAccount(),id=crypto.randomUUID();let validations=0;
 const input={id,inputDigest:digest,purpose:'teacher',budgetKind:'semantic' as const};
 const unavailable={...input,id:crypto.randomUUID()};
 await expectCode(()=>tx(db=>reserveModelRequest(db,accountId,unavailable,now,30,()=>{throw new ConsumerError(409,'provider_not_configured');})),'provider_not_configured');
 assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.model_requests WHERE account_id=$1 AND request_id=$2',[accountId,unavailable.id])).rows[0].n,0,'connection validation happens before a reservation is written');
 assert.deepEqual(await tx(db=>reserveModelRequest(db,accountId,input,now,30,()=>{validations++;})),{kind:'execute'});assert.equal(validations,1);
 await tx(db=>markModelRequestRunning(db,accountId,id,digest,new Date(now.getTime()+1)));
 const response={model:'fixture',choices:[{message:{content:'recoverable'}}]};
 await tx(db=>succeedModelRequest(db,accountId,id,digest,response,new Date(now.getTime()+2)));
 assert.deepEqual(await tx(db=>reserveModelRequest(db,accountId,input,new Date(now.getTime()+3),30,()=>{throw Error('replay must not resolve a provider');})),{kind:'replay',response});
 await expectCode(()=>tx(db=>reserveModelRequest(db,accountId,{...input,inputDigest:'b'.repeat(64)},now,30)),'model_request_conflict');

 const retryAccount=await createAccount(),retryId=crypto.randomUUID(),retry={id:retryId,inputDigest:digest,purpose:'reference',budgetKind:'reference' as const};
 await tx(db=>reserveModelRequest(db,retryAccount,retry,now,1));
 await tx(db=>failModelRequestBeforeExecution(db,retryAccount,retryId,digest,'model_queue_full',new Date(now.getTime()+1)));
 assert.deepEqual(await tx(db=>reserveModelRequest(db,retryAccount,retry,new Date(now.getTime()+2),1)),{kind:'execute'},'a failure before upstream execution releases the daily slot');
 await tx(db=>markModelRequestRunning(db,retryAccount,retryId,digest,new Date(now.getTime()+3)));
 await tx(db=>failModelRequestAfterExecution(db,retryAccount,retryId,digest,'model_request_rejected',false,new Date(now.getTime()+4)));
 await expectCode(()=>tx(db=>reserveModelRequest(db,retryAccount,retry,new Date(now.getTime()+5),1)),'model_request_rejected');
 await expectCode(()=>tx(db=>reserveModelRequest(db,retryAccount,{...retry,id:crypto.randomUUID()},new Date(now.getTime()+5),1)),'model_daily_budget');

 const unknownAccount=await createAccount(),unknownId=crypto.randomUUID(),unknown={id:unknownId,inputDigest:digest,purpose:'content',budgetKind:'content' as const};
 await tx(db=>reserveModelRequest(db,unknownAccount,unknown,now,30));
 await tx(db=>markModelRequestRunning(db,unknownAccount,unknownId,digest,new Date(now.getTime()+1)));
 await tx(db=>failModelRequestAfterExecution(db,unknownAccount,unknownId,digest,'provider_timeout',true,new Date(now.getTime()+2)));
 await expectCode(()=>tx(db=>reserveModelRequest(db,unknownAccount,unknown,new Date(now.getTime()+3),30)),'model_execution_unknown');

 await pool.query('UPDATE sensa_consumer.model_requests SET response_expires_at=$3 WHERE account_id=$1 AND request_id=$2',[accountId,id,new Date(now.getTime()-1)]);
 await expectCode(()=>tx(db=>reserveModelRequest(db,accountId,input,now,30)),'model_request_succeeded');
 await pool.query('UPDATE sensa_consumer.model_requests SET expires_at=$3 WHERE account_id=$1 AND request_id=$2',[accountId,id,new Date(now.getTime()-1)]);
 assert.equal(await tx(db=>purgeExpiredModelRequests(db,now,100)),1);assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.model_requests WHERE account_id=$1 AND request_id=$2',[accountId,id])).rows[0].n,0);
 console.log('PASS: model receipts replay results, reject digest reuse, release only pre-execution failures, retain executed/unknown usage, expire cached results, and purge bounded metadata. Disposable database; no model calls.');
}finally{await pool.end();}
});
