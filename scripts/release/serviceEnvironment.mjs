/** CI-only env file. Values never enter command arguments or logs. */
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
async function main(){
if(process.env.GITHUB_ACTIONS!=='true'||!process.env.RUNNER_TEMP)throw Error('Service environment preparation runs in CI only');
const project=process.env.SUPABASE_PROJECT_REF,web=new URL(process.env.SENSA_WEB_ORIGIN),database=new URL(process.env.SENSA_RUNTIME_DATABASE_URL);
if(!['require','verify-full','verify-ca'].includes(database.searchParams.get('sslmode')??'')||!/^[a-z0-9]{20}$/.test(project??'')||web.protocol!=='https:'||!['postgres:','postgresql:'].includes(database.protocol)||!(database.hostname===`db.${project}.supabase.co`||decodeURIComponent(database.username).endsWith('.'+project)))throw Error('Service target mismatch');
if(!process.env.DEEPSEEK_API_KEY||!/^[a-f0-9]{64}$/i.test(process.env.SENSA_PROVIDER_VAULT_KEY??''))throw Error('Managed model and provider vault configuration required');
const db=new pg.Client({connectionString:process.env.SENSA_RUNTIME_DATABASE_URL,connectionTimeoutMillis:15000});
try{await db.connect();const role=(await db.query("SELECT current_user,rolsuper,rolcreaterole,pg_has_role(current_user,'backend_app','MEMBER') AS application_role FROM pg_roles WHERE rolname=current_user")).rows[0];if(!role||!role.application_role||role.rolsuper||role.rolcreaterole||['postgres','supabase_admin'].includes(role.current_user))throw Error('Runtime requires a restricted database role');}catch{throw Error('Restricted runtime database verification failed');}finally{await db.end();}
// Learning-content Registry promotion is an independent protected workflow.
// App deployment must preserve its existing remote/inline Registry secrets.
const values={DATABASE_URL:process.env.SENSA_RUNTIME_DATABASE_URL,DATABASE_POOL_MAX:'4',DATABASE_POOL_ACQUIRE_TIMEOUT_MS:'3000',DATABASE_POOL_IDLE_TIMEOUT_MS:'10000',DATABASE_POOL_MAX_LIFETIME_SECONDS:'120',DATABASE_STATEMENT_TIMEOUT_MS:'15000',DATABASE_LOCK_TIMEOUT_MS:'3000',DATABASE_IDLE_TRANSACTION_TIMEOUT_MS:'10000',ALLOWED_ORIGINS:web.origin,SENSA_SEMANTIC_PROVIDER:'deepseek',DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY,SENSA_PROVIDER_VAULT_KEY:process.env.SENSA_PROVIDER_VAULT_KEY,SENSA_REGISTRATION_POLICY:'invited',SENSA_UNLIMITED_MODEL_USAGE:'false',SENSA_AGENT_INTAKE_HOURLY_LIMIT:'120'};
const lines=Object.entries(values).map(([key,value])=>{if(/[\r\n']/.test(value))throw Error('Unsupported environment value encoding');return `${key}='${value}'`;});
await writeFile(join(process.env.RUNNER_TEMP,'sensa-service.env'),lines.join('\n')+'\n',{mode:0o600});
console.log('Prepared restricted service configuration; registration remains invitation-only.');

}
main().catch(()=>{console.error('Service configuration failed; check target, credentials and restricted role without logging secret values.');process.exitCode=1;});
