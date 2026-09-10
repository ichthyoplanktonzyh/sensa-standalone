/** Local credential preparation only: no database calls, secret output or upload. */
import {readFile,writeFile,chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import {validateTrialConnections} from './trialDatabase.mjs';
const projectRef='kwwmukqzlxxsnviyhwmr';
const ciPath='apps/api/.env.trial-ci',apiPath='apps/api/.env.real-service';
function update(source,key,value){
 if(/[\r\n]/.test(value))throw Error('Multiline credential rejected');
 const line=key+'='+JSON.stringify(value),pattern=new RegExp('^'+key+'=.*$','m');
 return pattern.test(source)?source.replace(pattern,()=>line):source.trimEnd()+'\n'+line+'\n';
}
try{
 for(const path of [ciPath,apiPath])execFileSync('git',['check-ignore','--quiet',path],{stdio:'pipe'});
 const ciSource=await readFile(ciPath,'utf8'),apiSource=await readFile(apiPath,'utf8');
 const ci=parseEnv(ciSource),api=parseEnv(apiSource);
 if(!ci.MIGRATION_DATABASE_URL||/\[YOUR.PASSWORD\]/i.test(ci.MIGRATION_DATABASE_URL))throw Error('Administrator connection missing');
 const admin=new URL(ci.MIGRATION_DATABASE_URL),runtime=new URL(admin);
 runtime.username='sensa_trial_runtime'+(admin.hostname.endsWith('.pooler.supabase.com')?'.'+projectRef:'');
 runtime.password=randomBytes(32).toString('hex');
 // Keep the same runtime credential on retries; never silently rotate a live role.
 const runtimeUrl=ci.SENSA_RUNTIME_DATABASE_URL||api.DATABASE_URL||runtime.toString();
 validateTrialConnections({adminUrl:admin.toString(),runtimeUrl,projectRef});
 if(ci.SENSA_RUNTIME_DATABASE_URL&&api.DATABASE_URL&&ci.SENSA_RUNTIME_DATABASE_URL!==api.DATABASE_URL)throw Error('Conflicting runtime credentials');
 if(api.SUPABASE_URL!==`https://${projectRef}.supabase.co`)throw Error('API project mismatch');
 let next=update(ciSource,'MIGRATION_DATABASE_URL',admin.toString());
 next=update(next,'SENSA_RUNTIME_DATABASE_URL',runtimeUrl);next=update(next,'SUPABASE_PROJECT_REF',projectRef);
 await chmod(ciPath,0o600);await chmod(apiPath,0o600);
 await writeFile(ciPath,next,{mode:0o600});
 await writeFile(apiPath,update(apiSource,'DATABASE_URL',runtimeUrl),{mode:0o600});
 console.log('Prepared matching private CI/API credentials. No database connection, upload or credential output.');
}catch{console.error('Local trial configuration is incomplete or mismatched. Check the ignored environment files; no secret values are printed.');process.exitCode=1;}
