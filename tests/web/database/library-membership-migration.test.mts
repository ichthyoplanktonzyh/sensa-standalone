import {test,expect} from 'vitest';
import pg from 'pg';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {libraryCloudMembershipRows} from '../support/libraryCloudMembershipSql.mts';

test('membership normalization preserves populated exact edges and already configured orphan ACLs',async()=>{
 const connection=process.env.SENSA_ADMIN_TEST_DATABASE_URL;
 if(!connection||new URL(connection).hostname!=='127.0.0.1'||!new URL(connection).pathname.startsWith('/sensa_m1a_'))throw Error('Disposable loopback admin database required');
 const name='sensa_m1a_membership_migration_'+randomUUID().replaceAll('-',''),url=new URL(connection),admin=new pg.Client({connectionString:connection});await admin.connect();
 // A new database exercises the real forward migration, never a rollback of a
 // source schema. It remains disposable evidence until the CI host expires.
 try{await admin.query(`CREATE DATABASE ${name}`);}finally{await admin.end();}
 url.pathname='/'+name;const db=new pg.Client({connectionString:url.href});await db.connect();
 try{
  for(const file of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')&&f<'0052').sort()){
   await db.query('BEGIN');try{await db.query(await readFile('db/migrations/'+file,'utf8'));await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}
  }
  const account=randomUUID(),legacy=randomUUID(),hashes=['a','b','c','d','e'].map(v=>v.repeat(64));
  for(const id of [account,legacy]){
   const subject=randomUUID();await db.query("INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES('https://fixture.invalid/auth/v1',$1)",[subject]);
   await db.query('INSERT INTO core.accounts(account_id,email) VALUES($1,$2)',[id,id+'@fixture.invalid']);await db.query('INSERT INTO core.learners(learner_user_id) VALUES($1)',[id]);
   await db.query("INSERT INTO sensa_consumer.accounts(account_id,learner_user_id,issuer,subject,time_zone) VALUES($1,$1,'https://fixture.invalid/auth/v1',$2,'UTC')",[id,subject]);await db.query('INSERT INTO sensa_consumer.library_cloud(account_id) VALUES($1)',[id]);
  }
  for(const id of [account,legacy])for(const hash of hashes)await db.query("INSERT INTO sensa_consumer.library_cloud_blocks(account_id,hash,data,upload_lease_expires_at) VALUES($1,$2,'private body',now()-interval '1 day')",[id,hash]);
  const owners=[['row','界-é-é-🙂-"-\\'],['row','é'],['row','é'],['log','1'],['snapshot','1'],['staging',randomUUID()],['staging',randomUUID().toUpperCase()]];
  for(const id of [account,legacy])for(const [kind,owner] of owners)await db.query('INSERT INTO sensa_consumer.library_cloud_membership VALUES($1,$2,$3,$4)',[id,kind,owner,hashes[3]]);
  await db.query("INSERT INTO sensa_consumer.library_cloud_block_refs VALUES($1,$2,'head',NULL),($1,$3,'retired',now()+interval '1 day')",[account,hashes[0],hashes[1]]);
  await db.query("UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=now()+interval '1 day' WHERE account_id=$1 AND hash=$2",[account,hashes[4]]);
  await db.query('UPDATE sensa_consumer.library_cloud SET revision=3 WHERE account_id=$1',[legacy]);
  // The pre-0052 orphan principal has only the existing metadata projection.
  await db.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sensa_operational_retention') THEN CREATE ROLE sensa_operational_retention NOLOGIN NOINHERIT NOBYPASSRLS; END IF; END $$");
  await db.query('GRANT USAGE ON SCHEMA sensa_consumer TO sensa_operational_retention');
  for(const [table,columns] of [['library_cloud','account_id,library_id,revision'],['library_cloud_membership','account_id,hash'],['library_cloud_block_refs','account_id,hash,reference_kind,expires_at'],['library_cloud_blocks','account_id,hash,upload_lease_expires_at']]){
   await db.query(`GRANT SELECT(${columns}) ON sensa_consumer.${table} TO sensa_operational_retention`);await db.query(`CREATE POLICY sensa_operational_retention_select ON sensa_consumer.${table} FOR SELECT TO sensa_operational_retention USING(true)`);
  }
  await db.query('GRANT DELETE,UPDATE(upload_lease_expires_at) ON sensa_consumer.library_cloud_blocks TO sensa_operational_retention');
  const oldGuard=`upload_lease_expires_at<=now() AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud legacy WHERE legacy.account_id=library_cloud_blocks.account_id AND legacy.library_id IS NULL AND legacy.revision>0)
   AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_membership m WHERE m.account_id=library_cloud_blocks.account_id AND m.hash=library_cloud_blocks.hash)
   AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_block_refs r WHERE r.account_id=library_cloud_blocks.account_id AND r.hash=library_cloud_blocks.hash AND(r.reference_kind='head' OR r.expires_at>now()))`;
  await db.query(`CREATE POLICY sensa_operational_retention_delete ON sensa_consumer.library_cloud_blocks FOR DELETE TO sensa_operational_retention USING(${oldGuard})`);
  await db.query(`CREATE POLICY sensa_operational_retention_update ON sensa_consumer.library_cloud_blocks FOR UPDATE TO sensa_operational_retention USING(${oldGuard}) WITH CHECK(${oldGuard})`);
  const before=(await db.query('SELECT account_id,owner_kind,owner_id,hash FROM sensa_consumer.library_cloud_membership ORDER BY account_id,owner_kind,owner_id COLLATE "C",hash')).rows;
  await db.query('BEGIN');try{await db.query(await readFile('db/migrations/0052_library_membership_ids.sql','utf8'));await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}
  expect((await db.query(`SELECT * FROM ${libraryCloudMembershipRows} ORDER BY account_id,owner_kind,owner_id COLLATE "C",hash`)).rows).toEqual(before);
  const columns=(await db.query("SELECT attname,format_type(atttypid,atttypmod) AS type FROM pg_attribute WHERE attrelid='sensa_consumer.library_cloud_membership'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum")).rows;
  expect(columns).toEqual([{attname:'account_id',type:'text'},{attname:'owner_id',type:'bigint'},{attname:'block_id',type:'bigint'}]);
  await db.query('SET ROLE sensa_operational_retention');
  expect((await db.query('SELECT account_id,block_id FROM sensa_consumer.library_cloud_membership')).rowCount).toBe(before.length);
  await expect(db.query('SELECT owner FROM sensa_consumer.library_cloud_owners')).rejects.toMatchObject({code:'42501'});await expect(db.query('SELECT data FROM sensa_consumer.library_cloud_blocks')).rejects.toMatchObject({code:'42501'});
  for(const hash of [hashes[0],hashes[1],hashes[3],hashes[4]]){
   expect((await db.query('DELETE FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[account,hash])).rowCount).toBe(0);
   expect((await db.query("UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=now()-interval '1 hour' WHERE account_id=$1 AND hash=$2",[account,hash])).rowCount).toBe(0);
  }
  expect((await db.query('DELETE FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[legacy,hashes[2]])).rowCount).toBe(0);
  expect((await db.query("UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=now()-interval '1 hour' WHERE account_id=$1 AND hash=$2",[account,hashes[2]])).rowCount).toBe(1);
  await expect(db.query("UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=now()+interval '1 day' WHERE account_id=$1 AND hash=$2",[account,hashes[2]])).rejects.toMatchObject({code:'42501'});
  expect((await db.query("UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=now()-interval '1 hour' WHERE account_id=$1 AND hash=$2",[legacy,hashes[2]])).rowCount).toBe(0);
  expect((await db.query('DELETE FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[account,hashes[2]])).rowCount).toBe(1);
  await db.query('RESET ROLE');await expect(db.query('DELETE FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[account,hashes[3]])).rejects.toMatchObject({code:'23503'});
 }finally{await db.end();}
},120000);
