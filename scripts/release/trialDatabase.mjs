/** Isolated trial bootstrap. The CLI performs remote writes only in authorized CI. */
import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import pg from 'pg';

const migrationDirectory=fileURLToPath(new URL('../../db/migrations/',import.meta.url));
const forbiddenRoles=['postgres','supabase_admin','backend_app','auth_app'];
export function validateTrialConnections({adminUrl,runtimeUrl,projectRef,localTest=false}) {
 if(!/^[a-z0-9]{20}$/.test(projectRef??''))throw Error('Invalid project reference');
 const urls=[adminUrl,runtimeUrl].map(value=>new URL(value));
 for(const url of urls){
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.password)throw Error('Database credentials required');
  if(localTest){
   if(!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/sensa_trial_test_[a-z0-9]+$/.test(url.pathname))throw Error('Disposable local database required');
  }else{
   if(!['require','verify-full','verify-ca'].includes(url.searchParams.get('sslmode')))throw Error('Database TLS required');
   const direct=url.hostname===`db.${projectRef}.supabase.co`;
   const pooler=/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)&&decodeURIComponent(url.username).endsWith('.'+projectRef);
   if(!direct&&!pooler)throw Error('Database does not match the test project');
  }
 }
 const [admin,runtime]=urls;
 if(admin.hostname!==runtime.hostname||admin.port!==runtime.port||admin.pathname!==runtime.pathname)throw Error('Both connections must target the same database endpoint');
 const role=decodeURIComponent(runtime.username).replace(new RegExp('\\.'+projectRef+'$'),'');
 if(!/^sensa_trial_[a-z0-9_]+$/.test(role)||forbiddenRoles.includes(role)||runtime.username===admin.username)throw Error('Dedicated trial runtime role required');
 if(decodeURIComponent(runtime.password).length<32)throw Error('Runtime password must have at least 32 characters');
 return {role};
}

async function verifyRole(db,role){
 const row=(await db.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=$1',[role])).rows[0];
 if(!row||row.rolsuper||row.rolcreatedb||row.rolcreaterole||row.rolreplication||row.rolbypassrls||!row.rolinherit)throw Error('Unsafe runtime role');
 const memberships=(await db.query('SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname=$1',[role])).rows.map(r=>r.rolname);
 if(memberships.length!==1||memberships[0]!=='backend_app')throw Error('Unexpected runtime role membership');
 const inherited=(await db.query("SELECT rolname FROM pg_roles WHERE pg_has_role($1,oid,'MEMBER') AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)",[role])).rows;
 if(inherited.length)throw Error('Runtime inherits privileged access');
 const owned=(await db.query('SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=$1) UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname=$1)',[role])).rows;
 if(owned.length)throw Error('Runtime must not own application objects');
}

export async function initializeTrialDatabase(config,onProgress=()=>{},onStage=()=>{}) {
 const {role}=validateTrialConnections(config);
 const admin=new pg.Client({connectionString:config.adminUrl,connectionTimeoutMillis:15000});
 const runtime=new pg.Client({connectionString:config.runtimeUrl,connectionTimeoutMillis:15000});
 let locked=false;
 try{
  onStage('stage: administrator connection');
  await admin.connect();
  onStage('stage: initialization lock and schema checks');
  const lock=(await admin.query("SELECT pg_try_advisory_lock(hashtextextended('sensa-trial-initialize',0)) AS locked")).rows[0];
  if(!lock.locked)throw Error('Another initialization is running');locked=true;
  const ledger=(await admin.query("SELECT to_regclass('public.sensa_schema_migrations') AS ledger")).rows[0].ledger;
  if(!ledger){
   const existing=(await admin.query("SELECT nspname FROM pg_namespace WHERE nspname=ANY($1::text[])",[['core','org','sync','content','security','sensa','sensa_consumer']])).rows;
   if(existing.length)throw Error('Untracked application schemas; refusing initialization');
  }
  const roleExists=(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount>0;
  if(roleExists){await verifyRole(admin,role);await runtime.connect();}
  // The migration ledger is internal bookkeeping, never a browser Data API table.
  onStage('stage: migration ledger');
  await admin.query(`CREATE TABLE IF NOT EXISTS public.sensa_schema_migrations(filename TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
   ALTER TABLE public.sensa_schema_migrations ENABLE ROW LEVEL SECURITY;
   REVOKE ALL ON public.sensa_schema_migrations FROM PUBLIC;
   DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.sensa_schema_migrations FROM anon; END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.sensa_schema_migrations FROM authenticated; END IF;
   END $$;`);
  const files=(await readdir(migrationDirectory)).filter(f=>/^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const applied=new Set((await admin.query('SELECT filename FROM public.sensa_schema_migrations')).rows.map(r=>r.filename));
  if([...applied].some(f=>!files.includes(f)))throw Error('Database contains migrations outside this revision');
  for(const filename of files){
   if(applied.has(filename))continue;
   await admin.query('BEGIN');
   try{
    await admin.query(await readFile(resolve(migrationDirectory,filename),'utf8'));
    await admin.query('INSERT INTO public.sensa_schema_migrations(filename) VALUES($1)',[filename]);
    await admin.query('COMMIT');onProgress(filename);
   }catch(cause){await admin.query('ROLLBACK');throw Error('Migration failed: '+filename,{cause});}
  }
  if(!roleExists){
   await admin.query('BEGIN');
   try{
    // PostgreSQL quotes both values. Credentials are never shell arguments or output.
    const statement=(await admin.query("SELECT format('CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text,$2::text) AS statement",[role,decodeURIComponent(new URL(config.runtimeUrl).password)])).rows[0].statement;
    await admin.query(statement);
    const grant=(await admin.query("SELECT format('GRANT backend_app TO %I', $1::text) AS statement",[role])).rows[0].statement;
    await admin.query(grant);await admin.query('COMMIT');
   }catch(cause){await admin.query('ROLLBACK');throw Error('Runtime role creation failed',{cause});}
   await runtime.connect();
  }
  await verifyRole(runtime,role);
  const user=(await runtime.query('SELECT current_user')).rows[0].current_user;
  if(user!==role)throw Error('Unexpected runtime identity');
  await runtime.query('BEGIN');
  try{
   await runtime.query('SELECT revoked FROM sensa_consumer.invitations LIMIT 0');
   await runtime.query('SELECT lifecycle FROM sensa_consumer.accounts LIMIT 0');
   await runtime.query('ROLLBACK');
  }catch{await runtime.query('ROLLBACK');throw Error('Runtime schema verification failed');}
  return {migrationCount:files.length,runtimeRole:role};
 }finally{
  if(locked)await admin.query("SELECT pg_advisory_unlock(hashtextextended('sensa-trial-initialize',0))").catch(()=>{});
  await runtime.end().catch(()=>{});await admin.end().catch(()=>{});
 }
}

/** Admit one already verified Auth identity; never create a user or revive access. */
export async function inviteTrialAccount(config,subject){
 validateTrialConnections(config);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subject??''))throw Error('Verified Auth subject required');
 const db=new pg.Client({connectionString:config.adminUrl,connectionTimeoutMillis:15000});
 const issuer=`https://${config.projectRef}.supabase.co/auth/v1`;
 try{
  await db.connect();await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([issuer,subject])]);
  const user=(await db.query('SELECT id FROM auth.users WHERE id=$1::uuid AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL AND NOT COALESCE(is_anonymous,false) AND (banned_until IS NULL OR banned_until < now()) FOR UPDATE',[subject])).rows[0];
  if(!user)throw Error('Auth identity is not eligible');
  const account=(await db.query('SELECT lifecycle FROM sensa_consumer.accounts WHERE issuer=$1 AND subject=$2 FOR UPDATE',[issuer,subject])).rows[0];
  if(account&&account.lifecycle!=='active')throw Error('Account lifecycle prevents admission');
  await db.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2) ON CONFLICT(issuer,subject) DO NOTHING',[issuer,subject]);
  const invitation=(await db.query('SELECT revoked FROM sensa_consumer.invitations WHERE issuer=$1 AND subject=$2 FOR UPDATE',[issuer,subject])).rows[0];
  if(!invitation||invitation.revoked)throw Error('Revoked invitation must not be restored');
  await db.query('COMMIT');
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{await db.end().catch(()=>{});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const config={adminUrl:process.env.MIGRATION_DATABASE_URL,runtimeUrl:process.env.SENSA_RUNTIME_DATABASE_URL,projectRef:process.env.SUPABASE_PROJECT_REF};
 try{
  validateTrialConnections(config);
  if(process.argv.includes('--check'))console.log('Trial database target and credential shape validated. No database connection made.');
  else{
   if(process.env.GITHUB_ACTIONS!=='true')throw Error('Remote changes require authorized CI');
   if(process.argv.includes('--invite')){
    await inviteTrialAccount(config,process.env.SENSA_TRIAL_AUTH_SUBJECT);
    console.log('One verified Auth identity admitted. No account created or revoked access restored.');
   }else{
    if(!process.argv.includes('--apply'))throw Error('Explicit operation required');
    const result=await initializeTrialDatabase(config,file=>console.log('Applied '+file),stage=>console.log(stage));
    console.log(`Trial database verified: ${result.migrationCount} migrations and a restricted runtime role. No accounts invited or application deployed.`);
   }
  }
 }catch(error){
  const code=error?.cause?.code??error?.code;
  const safeCode=typeof code==='string'&&/^[A-Z0-9_]{2,50}$/.test(code)?code:'UNCLASSIFIED';
  console.error(`Trial database preparation failed (${safeCode}). Check the last reported stage. Secret values and database error details are suppressed.`);process.exitCode=1;
 }
}
