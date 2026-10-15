/** Exact operational ACL/RLS on disposable loopback Postgres; no provider calls. */
import {test,expect} from 'vitest';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {configureOperations} from '../../../scripts/release/operationsAccess.mjs';
import {purgeExpiredLibraryCloudBlocks} from '../../../apps/api/src/sensa/library/retention.ts';
import {purgeExpiredSemanticLookups} from '../../../apps/api/src/sensa/personal/retention.ts';

test('maintenance preserves active heads and unexpired facts while the monitor cannot read payloads or write',async()=>{
 const connection=process.env.SENSA_ADMIN_TEST_DATABASE_URL;
 if(!connection||new URL(connection).hostname!=='127.0.0.1'||!new URL(connection).pathname.startsWith('/sensa_m1a_'))throw Error('Disposable loopback admin database required');
 const db=new pg.Client({connectionString:connection});await db.connect();
 const project='abcdefghijklmnopqrst',base=`postgresql://postgres.${project}:fixture@aws-0.fixture.pooler.supabase.com:5432/postgres`;
 const account=randomUUID(),subject=randomUUID(),activeId=randomUUID(),expiredId=randomUUID(),activeRead=randomUUID(),expiredRead=randomUUID(),hashes=['a','b','c','d'].map(v=>v.repeat(64));
 try{
  await db.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$");
  await configureOperations(db,{project,base,monitorPassword:'a'.repeat(43),retentionPassword:'b'.repeat(43)});
  await db.query('INSERT INTO core.accounts(account_id,email) VALUES($1,$2)',[account,'operations@fixture.invalid']);
  await db.query('INSERT INTO core.learners(learner_user_id) VALUES($1)',[account]);
  await db.query("INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES('https://fixture.invalid/auth/v1',$1)",[subject]);
  await db.query("INSERT INTO sensa_consumer.accounts(account_id,learner_user_id,issuer,subject,time_zone) VALUES($1,$1,'https://fixture.invalid/auth/v1',$2,'UTC')",[account,subject]);
  await db.query('INSERT INTO sensa_consumer.library_cloud(account_id) VALUES($1)',[account]);
  for(const hash of hashes)await db.query("INSERT INTO sensa_consumer.library_cloud_blocks(account_id,hash,data,upload_lease_expires_at) VALUES($1,$2,'private payload',now()-interval '1 day')",[account,hash]);
  await db.query("INSERT INTO sensa_consumer.library_cloud_block_refs(account_id,hash,reference_kind,expires_at) VALUES($1,$2,'head',NULL),($1,$3,'retired',now()+interval '1 day')",[account,hashes[0],hashes[1]]);
  await db.query("INSERT INTO sensa_consumer.library_cloud_membership(account_id,owner_kind,owner_id,hash) VALUES($1,'row','current',$2)",[account,hashes[3]]);
  await db.query("INSERT INTO sensa_consumer.library_cloud_reads(account_id,id,from_revision,to_revision,snapshot_revision,expires_at) VALUES($1,$2,0,0,0,now()+interval '1 day'),($1,$3,0,0,0,now()-interval '1 day')",[account,activeRead,expiredRead]);
  await db.query("INSERT INTO sensa_consumer.semantic_lookups(id,learner_user_id,input_digest,status,created_at,expires_at) VALUES($1,$3,'fixture','ready',now(),now()+interval '1 day'),($2,$3,'fixture','ready',now(),now()-interval '1 day')",[activeId,expiredId,account]);
  await db.query('SET ROLE sensa_operational_monitor');
  expect(Number((await db.query('SELECT count(account_id) n FROM sensa_consumer.accounts')).rows[0].n)).toBeGreaterThan(0);
  expect(Number((await db.query('SELECT sensa_consumer.operational_lock_wait_count() n')).rows[0].n)).toBeGreaterThanOrEqual(0);
  await expect(db.query('SELECT response FROM sensa_consumer.model_requests')).rejects.toMatchObject({code:'42501'});
  await expect(db.query('DELETE FROM sensa_consumer.accounts')).rejects.toMatchObject({code:'42501'});
  await db.query('RESET ROLE');await db.query('SET ROLE sensa_operational_retention');
  // Direct destructive statements are fenced too, not only the approved script.
  expect((await db.query("DELETE FROM sensa_consumer.library_cloud_block_refs WHERE reference_kind='head' AND account_id=$1",[account])).rowCount).toBe(0);
  expect((await db.query('DELETE FROM sensa_consumer.semantic_lookups WHERE id=$1',[activeId])).rowCount).toBe(0);
  await expect(db.query('DELETE FROM sensa_consumer.library_cloud WHERE account_id=$1',[account])).rejects.toMatchObject({code:'42501'});
  expect((await db.query('SELECT account_id,hash FROM sensa_consumer.library_cloud_membership WHERE account_id=$1',[account])).rowCount).toBe(1);
  await expect(db.query('SELECT data FROM sensa_consumer.library_cloud_blocks')).rejects.toMatchObject({code:'42501'});
  await expect(db.query('SELECT owner_id FROM sensa_consumer.library_cloud_membership')).rejects.toMatchObject({code:'42501'});
  await expect(db.query('DELETE FROM sensa_consumer.library_cloud_membership')).rejects.toMatchObject({code:'42501'});
  expect((await db.query('DELETE FROM sensa_consumer.library_cloud_reads WHERE id=$1',[activeRead])).rowCount).toBe(0);
  expect((await db.query('DELETE FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[account,hashes[3]])).rowCount).toBe(0);
  await expect(db.query('SELECT manifest FROM sensa_consumer.library_cloud')).rejects.toMatchObject({code:'42501'});
  // An opaque legacy checkpoint is a retained root even if its old pin metadata
  // is absent. This synthetic head is the only data changed for this boundary.
  await db.query('RESET ROLE');await db.query('UPDATE sensa_consumer.library_cloud SET revision=1 WHERE account_id=$1',[account]);await db.query('SET ROLE sensa_operational_retention');
  expect((await db.query('DELETE FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[account,hashes[2]])).rowCount).toBe(0);
  await db.query('BEGIN');await purgeExpiredLibraryCloudBlocks(db,new Date(),1000);expect((await db.query('SELECT hash FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[account,hashes[2]])).rowCount).toBe(1);await db.query('ROLLBACK');
  await db.query('RESET ROLE');await db.query('UPDATE sensa_consumer.library_cloud SET revision=0 WHERE account_id=$1',[account]);await db.query('SET ROLE sensa_operational_retention');
  await db.query('BEGIN');
  // Global sweep can also see other synthetic fixtures; the exact account set below is the oracle.
  expect(await purgeExpiredLibraryCloudBlocks(db,new Date(),1000)).toBeGreaterThanOrEqual(1);
  expect(await purgeExpiredSemanticLookups(db,new Date(),1000)).toBeGreaterThanOrEqual(1);
  await db.query('COMMIT');await db.query('RESET ROLE');
  expect((await db.query('SELECT hash FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 ORDER BY hash',[account])).rows.map(r=>r.hash)).toEqual([hashes[0],hashes[1],hashes[3]]);
  expect((await db.query('SELECT id FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1',[account])).rows.map(r=>r.id)).toEqual([activeId]);
  expect((await db.query('SELECT id FROM sensa_consumer.library_cloud_reads WHERE account_id=$1',[account])).rows.map(r=>r.id)).toEqual([activeRead]);
  await db.query('SET ROLE backend_app');
  expect((await db.query('SELECT id FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1',[account])).rowCount).toBe(1);
 }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
});
