/** Disposable local Postgres integration; never accepts a remote administrator. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {initializeTrialDatabase,inviteTrialAccount,validateTrialConnections} from './release/trialDatabase.mjs';
const source=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(source.hostname))throw Error('Local administrator required');
const suffix=randomBytes(6).toString('hex'),database='sensa_trial_test_'+suffix,role='sensa_trial_'+suffix;
const admin=new pg.Client({connectionString:source.toString()});
const target=new URL(source);target.pathname='/'+database;
const runtime=new URL(target);runtime.username=role;runtime.password=randomBytes(32).toString('hex');
const config={adminUrl:target.toString(),runtimeUrl:runtime.toString(),projectRef:'kwwmukqzlxxsnviyhwmr',localTest:true};
try{
 await admin.connect();await admin.query(`CREATE DATABASE ${database}`);
 const first=[];const result=await initializeTrialDatabase(config,f=>first.push(f));
 assert.equal(result.migrationCount,27);assert.equal(first.length,27);
 const repeated=[];assert.deepEqual(await initializeTrialDatabase(config,f=>repeated.push(f)),result);assert.equal(repeated.length,0);
 const client=new pg.Client({connectionString:runtime.toString()});await client.connect();
 try{
  assert.equal((await client.query('SELECT count(*)::int AS n FROM sensa_consumer.invitations')).rows[0].n,0);
  await assert.rejects(client.query(`CREATE ROLE sensa_trial_unwanted_${suffix}`));
  await assert.rejects(client.query('SELECT * FROM public.sensa_schema_migrations'));
 }finally{await client.end();}
 await admin.query(`ALTER ROLE ${role} CREATEDB`);
 await assert.rejects(initializeTrialDatabase(config),/Unsafe runtime role/);
 await admin.query(`ALTER ROLE ${role} NOCREATEDB`);
 const wrong=new URL(runtime);wrong.password='wrong-password-with-at-least-32-characters';
 await assert.rejects(initializeTrialDatabase({...config,runtimeUrl:wrong.toString()}));
 const ref=config.projectRef;
 const hosted={projectRef:ref,adminUrl:`postgresql://postgres.${ref}:synthetic@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require`,runtimeUrl:`postgresql://sensa_trial_runtime.${ref}:${'a'.repeat(64)}@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require`};
 assert.equal(validateTrialConnections(hosted).role,'sensa_trial_runtime');
 assert.throws(()=>validateTrialConnections({...hosted,runtimeUrl:hosted.runtimeUrl.replace('aws-0-ca-central-1.pooler.supabase.com','attacker.invalid')}));
 assert.throws(()=>validateTrialConnections({...hosted,runtimeUrl:hosted.runtimeUrl.replace('sslmode=require','sslmode=disable')}));
 const setup=new pg.Client({connectionString:target.toString()});await setup.connect();
 try{
  await setup.query('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz,deleted_at timestamptz,is_anonymous boolean,banned_until timestamptz)');
  const subject='a0000000-0000-4000-8000-000000000001';
  await assert.rejects(inviteTrialAccount(config,subject),/not eligible/);
  await setup.query('INSERT INTO auth.users(id,is_anonymous) VALUES($1,false)',[subject]);
  await assert.rejects(inviteTrialAccount(config,subject),/not eligible/);
  await setup.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1',[subject]);
  await inviteTrialAccount(config,subject);await inviteTrialAccount(config,subject);
  assert.equal((await setup.query('SELECT count(*)::int AS n FROM sensa_consumer.invitations')).rows[0].n,1);
  await setup.query('UPDATE sensa_consumer.invitations SET revoked=true');
  await assert.rejects(inviteTrialAccount(config,subject),/must not be restored/);
  assert.equal((await setup.query('SELECT revoked FROM sensa_consumer.invitations')).rows[0].revoked,true);
 }finally{await setup.end();}
 console.log('PASS: 27 migrations, idempotent rerun, restricted login/ledger, unsafe-role/password/project/TLS refusal, verified-only invitation and revocation preservation. Disposable local database with synthetic Auth records only.');
}finally{
 await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(()=>{});
 await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
 await admin.end();
}
