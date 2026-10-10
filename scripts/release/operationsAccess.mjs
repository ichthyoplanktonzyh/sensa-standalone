/** Dedicated operational credentials; never print SQL errors or connection strings. */
import pg from 'pg';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const operationsRoles={monitor:'sensa_operational_monitor',retention:'sensa_operational_retention'};
export function operationsConnection(base,project,kind,password){
 if(!/^[a-z0-9]{20}$/.test(project??'')||!Object.hasOwn(operationsRoles,kind)||!/^[A-Za-z0-9_-]{43}$/.test(password??''))throw Error('invalid_operations_configuration');
 const url=new URL(base);
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.pathname!=='/postgres'||!(url.hostname===`db.${project}.supabase.co`||(url.hostname.endsWith('.pooler.supabase.com')&&url.username.endsWith(`.${project}`))))throw Error('operations_project_mismatch');
 url.username=url.hostname.endsWith('.pooler.supabase.com')?`${operationsRoles[kind]}.${project}`:operationsRoles[kind];url.password=password;
 return url.href;
}
const grants={
 monitor:[
  ['accounts','account_id,lifecycle'],['account_deletions','account_id,requested_at'],
  ['model_requests','execution_started_at,state,completed_at'],['reading_requests','created_at'],
 ],
 retention:[
  ['semantic_lookups','learner_user_id,id,expires_at','expires_at'],
  ['library_cloud_blocks','account_id,hash,upload_lease_expires_at','upload_lease_expires_at'],
  ['library_cloud_block_refs','account_id,hash,reference_kind,expires_at'],
  ['library_cloud_snapshot_leases','account_id,expires_at'],
  ['model_requests','account_id,request_id,response,response_expires_at,expires_at','response,response_expires_at'],
 ],
};
const eligibleDelete={
 semantic_lookups:'expires_at<=now()',
 library_cloud_block_refs:"reference_kind='retired' AND expires_at<=now()",
 library_cloud_snapshot_leases:'expires_at<=now()',
 model_requests:'expires_at<=now()',
 library_cloud_blocks:`upload_lease_expires_at<=now() AND NOT EXISTS (SELECT 1 FROM sensa_consumer.library_cloud_block_refs r
  WHERE r.account_id=library_cloud_blocks.account_id AND r.hash=library_cloud_blocks.hash AND (r.reference_kind='head' OR r.expires_at>now()))`,
};
export async function configureOperations(db,{project,base,monitorPassword,retentionPassword}){
 for(const [kind,password] of [['monitor',monitorPassword],['retention',retentionPassword]])operationsConnection(base,project,kind,password);
 await db.query('BEGIN');
 try{
  await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='20s'");
  // Preserve the established service access before enforcing expiration for
  // the new maintenance identity on this previously non-RLS table.
  await db.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='sensa_consumer' AND tablename='semantic_lookups' AND policyname='semantic_lookups_backend') THEN
   CREATE POLICY semantic_lookups_backend ON sensa_consumer.semantic_lookups TO backend_app USING (true) WITH CHECK (true); END IF; END $$`);
  await db.query('ALTER TABLE sensa_consumer.semantic_lookups ENABLE ROW LEVEL SECURITY');
  for(const [kind,password] of [['monitor',monitorPassword],['retention',retentionPassword]]){
   const role=operationsRoles[kind];
   const existing=await db.query('SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=$1',[role]);
   if(existing.rows.some(r=>r.rolsuper||r.rolcreatedb||r.rolcreaterole||r.rolreplication||r.rolbypassrls||r.rolinherit))throw Error('operations_role_drift');
   const membership=await db.query('SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=$1)',[role]);
   if(membership.rows.length)throw Error('operations_role_membership_drift');
   const options=`LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`;
   await db.query(`${existing.rows.length?'ALTER':'CREATE'} ROLE ${role} ${options}`);
   await db.query(`GRANT CONNECT ON DATABASE postgres TO ${role}; GRANT USAGE ON SCHEMA sensa_consumer TO ${role}`);
   if(kind==='monitor')await db.query(`ALTER ROLE ${role} SET default_transaction_read_only=on`);
   for(const [table,columns,update] of grants[kind]){
    await db.query(`GRANT SELECT (${columns}) ON sensa_consumer.${table} TO ${role}`);
    if(kind==='retention'){
     await db.query(`GRANT DELETE ON sensa_consumer.${table} TO ${role}`);
     if(update)await db.query(`GRANT UPDATE (${update}) ON sensa_consumer.${table} TO ${role}`);
    }
    // These private service tables are not browser Data API authorities. The
    // role's column/table ACL remains the cap even for its cross-account policy.
    await db.query(`DROP POLICY IF EXISTS ${role} ON sensa_consumer.${table}`);
    for(const command of ['SELECT',...(kind==='retention'?['DELETE',...(update?['UPDATE']:[])]:[])]){
     const policy=`${role}_${command.toLowerCase()}`;
     await db.query(`DROP POLICY IF EXISTS ${policy} ON sensa_consumer.${table}`);
     let using='true',check='';
     if(command==='DELETE')using=eligibleDelete[table];
     if(command==='UPDATE'){
      using=table==='model_requests'?'expires_at<=now() OR response_expires_at<=now()':eligibleDelete[table];
      check=` WITH CHECK (${table==='model_requests'?'response IS NULL AND response_expires_at IS NULL':eligibleDelete[table]})`;
     }
     await db.query(`CREATE POLICY ${policy} ON sensa_consumer.${table} FOR ${command} TO ${role} USING (${using})${check}`);
    }
   }
  }
  // Only a count is exposed; do not grant pg_read_all_stats and its query text.
  await db.query(`CREATE OR REPLACE FUNCTION sensa_consumer.operational_lock_wait_count() RETURNS bigint
   LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
   SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=pg_catalog.current_database()
    AND wait_event_type='Lock' AND state<>'idle' AND query_start<pg_catalog.now()-interval '30 seconds' $$`);
  await db.query('REVOKE ALL ON FUNCTION sensa_consumer.operational_lock_wait_count() FROM PUBLIC,anon,authenticated');
  await db.query(`GRANT EXECUTE ON FUNCTION sensa_consumer.operational_lock_wait_count() TO ${operationsRoles.monitor}`);
  await db.query('COMMIT');
 }catch(error){await db.query('ROLLBACK');throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const env=process.env,mode=process.argv[2],project=env.SUPABASE_PROJECT_REF;
 const passwords={monitor:env.SENSA_MONITOR_PASSWORD,retention:env.SENSA_RETENTION_PASSWORD};
 try{
  if(mode==='--apply'){
   if(env.SENSA_OPERATIONS_ACCEPTED!=='true'||env.GITHUB_REF!=='refs/heads/main'||project!=='kwwmukqzlxxsnviyhwmr')throw Error('operations_authority_required');
   const db=new pg.Client({connectionString:env.MIGRATION_DATABASE_URL,connectionTimeoutMillis:15000});
   try{await db.connect();await configureOperations(db,{project,base:env.MIGRATION_DATABASE_URL,monitorPassword:passwords.monitor,retentionPassword:passwords.retention});}finally{await db.end();}
   console.log('Configured dedicated monitor and retention roles. No learner records changed.');
  }else if(['--monitor-env','--retention-env'].includes(mode)){
   const kind=mode==='--monitor-env'?'monitor':'retention';
   if(env.GITHUB_ACTIONS!=='true'||!env.GITHUB_ENV)throw Error('workflow_environment_required');
   const value=operationsConnection(env.SENSA_OPERATIONS_DATABASE_TARGET,project,kind,passwords[kind]);
   console.log(`::add-mask::${value}`);
   appendFileSync(env.GITHUB_ENV,`${kind==='monitor'?'MONITOR_DATABASE_URL':'SENSA_MAINTENANCE_DATABASE_URL'}=${value}\n`);
  }else throw Error('invalid_operations_mode');
 }catch{console.error('Operational access configuration failed; inspect approved credentials and role boundaries without logging secrets.');process.exitCode=1;}
}
