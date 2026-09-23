/** Pool acquisition, statement and lock budgets over disposable Postgres. */
import assert from 'node:assert/strict';
import pg from 'pg';
import {test} from 'vitest';

test('pool acquisition, statement and lock budgets release healthy connections',async()=>{
const url=process.env.SENSA_ADMIN_TEST_DATABASE_URL??process.env.SENSA_TEST_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||!new URL(url).pathname.startsWith('/sensa_m1a_'))throw Error('Disposable loopback database required');
Object.assign(process.env,{
 DATABASE_URL:url,DATABASE_POOL_MAX:'1',DATABASE_POOL_ACQUIRE_TIMEOUT_MS:'150',DATABASE_POOL_IDLE_TIMEOUT_MS:'1000',DATABASE_POOL_MAX_LIFETIME_SECONDS:'30',
 DATABASE_STATEMENT_TIMEOUT_MS:'150',DATABASE_LOCK_TIMEOUT_MS:'100',DATABASE_IDLE_TRANSACTION_TIMEOUT_MS:'2000',
});
const {unsafeTransaction,closeDatabasePool}=await import('../../../apps/api/src/database/core.ts');
const admin=new pg.Client({connectionString:url,connectionTimeoutMillis:1_000});await admin.connect();
const fixture=crypto.randomUUID();
try{
 let entered!:()=>void,release!:()=>void;
 const active=new Promise<void>(resolve=>{entered=resolve;});
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const holding=unsafeTransaction(async db=>{await db.query('SELECT 1');entered();await gate;});
 await active;const acquireStarted=Date.now();
 await assert.rejects(unsafeTransaction(db=>db.query('SELECT 1')),/timeout exceeded/u);
 const acquireElapsed=Date.now()-acquireStarted;assert(acquireElapsed>=100&&acquireElapsed<1_000,`acquisition budget was ${acquireElapsed}ms`);
 release();await holding;

 const statementStarted=Date.now();
 await assert.rejects(unsafeTransaction(db=>db.query('SELECT pg_sleep(0.5)')),/statement timeout|canceling statement/u);
 assert(Date.now()-statementStarted<1_000,'slow SQL exits inside the statement budget');
 assert.equal((await unsafeTransaction(async db=>(await db.query('SELECT 7::int value')).rows[0]!.value)),7,'a timed-out statement does not poison the only pooled connection');

 await admin.query('INSERT INTO core.accounts(account_id,email) VALUES($1,$2)',[fixture,'database-budget@example.invalid']);
 await admin.query('BEGIN');await admin.query('UPDATE core.accounts SET email=email WHERE account_id=$1',[fixture]);
 const lockStarted=Date.now();
 await assert.rejects(unsafeTransaction(db=>db.query('UPDATE core.accounts SET email=$2 WHERE account_id=$1',[fixture,'blocked@example.invalid'])),/lock timeout|canceling statement/u);
 assert(Date.now()-lockStarted<1_000,'lock wait exits inside the lock budget');
 await admin.query('ROLLBACK');
 assert.equal((await unsafeTransaction(async db=>(await db.query('SELECT 9::int value')).rows[0]!.value)),9,'the pool remains healthy after lock timeout and rollback');
 console.log('PASS: pool acquisition, statement and lock waits have explicit budgets; failed transactions release a healthy connection for the next request. Disposable database.');
}finally{
 await admin.query('ROLLBACK').catch(()=>undefined);
 await admin.query('DELETE FROM core.accounts WHERE account_id=$1',[fixture]).catch(()=>undefined);
 await admin.end();await closeDatabasePool();
}
});
