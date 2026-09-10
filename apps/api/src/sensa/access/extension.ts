import {z} from 'zod';
import type {DatabaseExecutor} from '../../database/index.js';
import {ConsumerError} from './auth.js';
import type {ConsumerPrincipal,ConsumerVerifier} from './auth.js';
const id=z.string().uuid();
export const extensionAuthorizationSchema=z.object({installationId:id,state:z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),redirectUri:z.string().url().refine(value=>/^https:\/\/[a-p]{32}\.chromiumapp\.org\/sensa$/u.test(value))}).strict();
export const extensionExchangeSchema=z.object({code:z.string().uuid(),installationId:id,state:z.string(),verifier:z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u)}).strict();
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
async function challenge(value:string){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');}
export async function authorizeExtension(db:DatabaseExecutor,a:{account_id:string;session_id:string;epoch:string;now:Date},input:z.infer<typeof extensionAuthorizationSchema>){
 const code=crypto.randomUUID();
 await db.query('INSERT INTO sensa_consumer.extension_codes(code_hash,account_id,session_id,scope_epoch,installation_id,state,challenge,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[await hash(code),a.account_id,a.session_id,a.epoch,input.installationId,input.state,input.challenge,new Date(a.now.getTime()+120000)]);
 const redirect=new URL(input.redirectUri);redirect.searchParams.set('code',code);redirect.searchParams.set('state',input.state);return {redirectUri:redirect.href};
}
export async function exchangeExtension(db:DatabaseExecutor,input:z.infer<typeof extensionExchangeSchema>,now:Date){
 const row=(await db.query(`SELECT c.*,a.issuer,a.subject,a.epoch,a.lifecycle,s.provider_session_id,s.revoked,i.revoked AS invite_revoked FROM sensa_consumer.extension_codes c JOIN sensa_consumer.accounts a USING(account_id) JOIN sensa_consumer.sessions s ON s.id=c.session_id JOIN sensa_consumer.invitations i ON i.issuer=a.issuer AND i.subject=a.subject WHERE code_hash=$1 FOR UPDATE OF c`,[await hash(input.code)])).rows[0];
 if(!row||row.lifecycle!=='active'||row.consumed||row.expires_at<=now||row.revoked||row.invite_revoked||String(row.epoch)!==String(row.scope_epoch)||row.installation_id!==input.installationId||row.state!==input.state||row.challenge!==await challenge(input.verifier))throw new ConsumerError(401,'authorization_expired');
 const token='sensa_ext_'+crypto.randomUUID()+crypto.randomUUID(),expiresAt=new Date(now.getTime()+7*86400000);
 await db.query('UPDATE sensa_consumer.extension_codes SET consumed=true WHERE code_hash=$1',[await hash(input.code)]);
 await db.query('INSERT INTO sensa_consumer.extension_credentials(token_hash,account_id,session_id,scope_epoch,installation_id,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[await hash(token),row.account_id,row.session_id,row.scope_epoch,row.installation_id,expiresAt]);
 return {token,accountId:row.account_id,expiresAt:expiresAt.toISOString()};
}
export function extensionVerifier(base:ConsumerVerifier,transaction:<T>(work:(db:DatabaseExecutor)=>Promise<T>)=>Promise<T>,clock:()=>Date):ConsumerVerifier{
 return async request=>{
  const token=request.headers.get('authorization')?.match(/^Bearer (sensa_ext_\S+)$/u)?.[1];if(!token)return base(request);
  const row=await transaction(async db=>(await db.query(`SELECT c.*,a.issuer,a.subject,a.epoch,a.lifecycle,s.provider_session_id,s.revoked,i.revoked AS invite_revoked FROM sensa_consumer.extension_credentials c JOIN sensa_consumer.accounts a USING(account_id) JOIN sensa_consumer.sessions s ON s.id=c.session_id JOIN sensa_consumer.invitations i ON i.issuer=a.issuer AND i.subject=a.subject WHERE token_hash=$1`,[await hash(token)])).rows[0]);
  if(!row||row.lifecycle!=='active'||row.expires_at<=clock()||row.revoked||row.invite_revoked||String(row.epoch)!==String(row.scope_epoch))throw new ConsumerError(401,'access_revoked');
  return {issuer:row.issuer,subject:row.subject,sessionId:row.provider_session_id,email:null,installationId:row.installation_id} as ConsumerPrincipal;
 };
}
