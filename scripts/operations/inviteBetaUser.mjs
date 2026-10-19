/** Owner-operated single-email provisioning; no email, password, token or session is issued. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import pg from 'pg';

class BetaInvitationError extends Error {}

function checkedUser(user,email){
 if(!user||!/^[-0-9a-f]{36}$/i.test(user.id)||user.email?.toLowerCase()!==email)throw new BetaInvitationError('Auth identity does not match the requested email');
 if(user.banned_until&&Date.parse(user.banned_until)>Date.now())throw new BetaInvitationError('Banned Auth identity requires separate owner review');
 if(!user.email_confirmed_at)throw new BetaInvitationError('Existing unconfirmed identity requires separate owner review; it was not modified');
 return user;
}

export async function inviteBetaUser({email,projectRef,admin,db,apply=false}){
 if(!/^[a-z0-9]{20}$/.test(projectRef??''))throw new BetaInvitationError('Invalid Supabase project ref');
 email=email?.trim().toLowerCase();
 if(!email||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))throw new BetaInvitationError('A single valid email is required');
 const issuer=`https://${projectRef}.supabase.co/auth/v1`;
 let found;
 // Bounded listing is sufficient for this small beta. No user list is logged.
 for(let page=1;page<=100;page++){
  const {data,error}=await admin.listUsers({page,perPage:100});
  if(error)throw new BetaInvitationError('Could not resolve the existing Auth identity');
  const matches=data.users.filter(user=>user.email?.toLowerCase()===email);
  if(matches.length>1)throw new BetaInvitationError('Ambiguous Auth identity');
  if(matches.length){found=checkedUser(matches[0],email);break;}
  if(data.users.length<100)break;
  if(page===100)throw new BetaInvitationError('Auth lookup exceeded the small-beta user bound');
 }
 if(found){
  const row=(await db.query('SELECT revoked FROM sensa_consumer.invitations WHERE issuer=$1 AND subject=$2',[issuer,found.id])).rows[0];
  if(row?.revoked)throw new BetaInvitationError('Invitation was revoked; separate owner review is required');
  if(row)return {status:'already-invited',subject:found.id};
 }
 if(!apply)return {status:found?'would-invite':'would-create-and-invite'};
 if(!found){
  // GoTrue routes unconfirmed identities through signup, which is disabled.
  // This passwordless pre-provision creates no session; the recipient must still
  // prove mailbox possession with the ordinary OTP before using any service.
  const {data,error}=await admin.createUser({email,email_confirm:true});
  if(error)throw new BetaInvitationError('Auth creation failed; retry lookup before granting access');
  found=checkedUser(data.user,email);
 }
 await db.query('BEGIN');
 try{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([issuer,found.id])]);
  await db.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2) ON CONFLICT(issuer,subject) DO NOTHING',[issuer,found.id]);
  const row=(await db.query('SELECT revoked FROM sensa_consumer.invitations WHERE issuer=$1 AND subject=$2 FOR UPDATE',[issuer,found.id])).rows[0];
  if(!row||row.revoked)throw new BetaInvitationError('Invitation is missing or revoked; no access was restored');
  await db.query('COMMIT');
 }catch(error){await db.query('ROLLBACK');throw error;}
 return {status:'invited',subject:found.id};
}

async function main(){
 const args=process.argv.slice(2);
 if(args.includes('--help')){console.log('node scripts/operations/inviteBetaUser.mjs --email=<invited-email> [--apply]\nDefault: read-only preview. Requires SUPABASE_PROJECT_REF, SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY), and SENSA_FIRST_USER_DATABASE_URL.');return;}
 if(args.some(arg=>arg!=='--apply'&&!arg.startsWith('--email='))||args.filter(arg=>arg.startsWith('--email=')).length!==1)throw new BetaInvitationError('Expected one --email=<invited-email> and optional --apply');
 const projectRef=process.env.SUPABASE_PROJECT_REF;
 if(!/^[a-z0-9]{20}$/.test(projectRef??''))throw new BetaInvitationError('Invalid Supabase project ref');
 const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key||!process.env.SENSA_FIRST_USER_DATABASE_URL)throw new BetaInvitationError('Backend Auth key and invitation database credentials are required');
 try{
  const target=new URL(process.env.SENSA_FIRST_USER_DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(target.protocol)||!['require','verify-full','verify-ca'].includes(target.searchParams.get('sslmode'))||!(target.hostname===`db.${projectRef}.supabase.co`||decodeURIComponent(target.username).endsWith('.'+projectRef)))throw new Error();
 }catch{throw new BetaInvitationError('Invitation database must match the Supabase project and require TLS');}
 const admin=createClient(`https://${projectRef}.supabase.co`,key,{auth:{persistSession:false,autoRefreshToken:false}}).auth.admin;
 const db=new pg.Client({connectionString:process.env.SENSA_FIRST_USER_DATABASE_URL});
 await db.connect();
 try{console.log(JSON.stringify(await inviteBetaUser({email:args.find(arg=>arg.startsWith('--email=')).slice(8),projectRef,admin,db,apply:args.includes('--apply')})));}
 finally{await db.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error instanceof BetaInvitationError?error.message:'Invitation database operation failed; an Auth identity may have been pre-created. Run the read-only preview before retrying.');process.exitCode=1;});
