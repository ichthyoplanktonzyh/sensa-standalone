/** Closed-beta email OTP configuration. Never print the fetched Auth config. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {desiredAuthRedirectConfig,authRedirectConfigMatches} from './supabaseAuthConfig.mjs';

class BetaAuthConfigError extends Error {}

export const betaAuthConfig=Object.freeze({
 disable_signup:true,
 mailer_autoconfirm:false,
 mailer_otp_exp:600,
 mailer_otp_length:6,
 smtp_max_frequency:60,
 mailer_subjects_magic_link:'Sensa login code / 登录验证码',
 mailer_templates_magic_link_content:'<h2>Sensa</h2><p>登录验证码 / Your login code:</p><p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p><p>10 分钟内有效。请在 Sensa 中输入，勿转发给他人。<br>Valid for 10 minutes. Enter it in Sensa. Do not share this code.</p><p>如果不是你发起的请求，请忽略此邮件。<br>If you did not request this email, you can ignore it.</p>',
});

export async function assertBetaInvitations(db,projectRef){
 const result=await db.query(`SELECT count(*)::int AS blocked FROM sensa_consumer.invitations i
 LEFT JOIN auth.users u ON u.id::text=i.subject
 WHERE i.issuer=$1 AND NOT i.revoked AND
 (u.id IS NULL OR u.email_confirmed_at IS NULL OR u.deleted_at IS NOT NULL OR u.banned_until>now())`,[`https://${projectRef}.supabase.co/auth/v1`]);
 if(result.rows[0]?.blocked!==0)throw new BetaAuthConfigError('Existing invited identities need review before closing signup; no Auth configuration was changed');
}

export async function reconcileBetaAuth({mode='check',environment=process.env,fetchImpl=fetch,db}={}){
 if(!['check','apply'].includes(mode))throw new BetaAuthConfigError('Expected --check or --apply');
 const desired=desiredAuthRedirectConfig(environment);
 if(!environment.SUPABASE_ACCESS_TOKEN)throw new BetaAuthConfigError('Supabase access token required');
 const request=async(init={})=>{
  const response=await fetchImpl(`https://api.supabase.com/v1/projects/${desired.projectRef}/config/auth`,{...init,headers:{authorization:`Bearer ${environment.SUPABASE_ACCESS_TOKEN}`,'content-type':'application/json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new BetaAuthConfigError(`Supabase beta Auth configuration request failed (${response.status})`);
  return response.json();
 };
 let current=await request();
 if(!authRedirectConfigMatches(current,desired))throw new BetaAuthConfigError('Fix the production Auth redirect boundary before switching beta login');
 if(current.external_email_enabled!==true)throw new BetaAuthConfigError('Email authentication must be enabled before switching beta login');
 if(current.hook_send_email_enabled===true)throw new BetaAuthConfigError('An active send-email hook needs a separate OTP delivery review');
 if(![current.smtp_host,current.smtp_admin_email,current.smtp_user].every(value=>typeof value==='string'&&value.trim()))throw new BetaAuthConfigError('Custom SMTP is required for invited external email addresses; verify delivery before release');
 const smtpPort=Number(current.smtp_port);
 if(!Number.isInteger(smtpPort)||smtpPort<1||smtpPort>65535)throw new BetaAuthConfigError('A valid custom SMTP port is required before switching beta login');
 if(mode==='apply'){
  if(!db)throw new BetaAuthConfigError('Invitation database preflight is required before applying beta Auth');
  await assertBetaInvitations(db,desired.projectRef);
 }
 const matches=()=>Object.entries(betaAuthConfig).every(([key,value])=>current[key]===value);
 if(mode==='apply'&&!matches()){
  await request({method:'PATCH',body:JSON.stringify(betaAuthConfig)});
  current=await request();
 }
 if(!matches()||!authRedirectConfigMatches(current,desired))throw new BetaAuthConfigError('Supabase beta Auth configuration does not match the email-code invitation policy');
 return {projectRef:desired.projectRef,signupDisabled:true,codeLength:6,expirySeconds:600,resendSeconds:60};
}

async function main(){
 const arg=process.argv[2];
 if(arg&&arg!=='--check'&&arg!=='--apply')throw new BetaAuthConfigError('Expected --check or --apply');
 const mode=arg==='--apply'?'apply':'check';
 let db;
 if(mode==='apply'){
  const ref=desiredAuthRedirectConfig().projectRef;
  try{
   const target=new URL(process.env.SENSA_FIRST_USER_DATABASE_URL);
   if(!['postgres:','postgresql:'].includes(target.protocol)||!['require','verify-full','verify-ca'].includes(target.searchParams.get('sslmode'))||!(target.hostname===`db.${ref}.supabase.co`||decodeURIComponent(target.username).endsWith('.'+ref)))throw new BetaAuthConfigError();
  }catch{throw new BetaAuthConfigError('Invitation database must match the Supabase project and require TLS');}
  db=new pg.Client({connectionString:process.env.SENSA_FIRST_USER_DATABASE_URL});
  await db.connect();
 }
 try{console.log(JSON.stringify(await reconcileBetaAuth({mode,db})));}finally{await db?.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error instanceof BetaAuthConfigError?error.message:'Beta Auth configuration could not be verified or applied. Review project credentials and invited identities; fetched config is never logged.');process.exitCode=1;});
