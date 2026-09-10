import type {DatabaseExecutor} from '../../database/index.js';
import {ConsumerError,type ConsumerPrincipal} from './auth.js';
export type DeleteIdentity=(subject:string,issuer:string)=>Promise<void>;
export function assertDeletionConfigured(){
 if(!process.env.SUPABASE_SERVICE_ROLE_KEY||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(process.env.SUPABASE_URL??''))throw new ConsumerError(503,'account_deletion_not_configured');
}
export const deleteHostedIdentity:DeleteIdentity=async(subject,issuer)=>{
 const url=process.env.SUPABASE_URL?.replace(/\/$/,''),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||issuer!==url+'/auth/v1'||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)||!/^[a-f0-9-]{36}$/i.test(subject))throw new ConsumerError(503,'account_deletion_not_configured');
 const response=await fetch(url+'/auth/v1/admin/users/'+encodeURIComponent(subject),{method:'DELETE',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({should_soft_delete:false}),redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok&&response.status!==404)throw new ConsumerError(503,'account_deletion_pending');
};
type Transaction=<T>(work:(db:DatabaseExecutor)=>Promise<T>)=>Promise<T>;
/** Re-check after taking the same account lock used by every authorized operation. */
export async function requestAccountDeletion(db:DatabaseExecutor,identity:ConsumerPrincipal,operationId:string,now:Date){
 if(identity.installationId)throw new ConsumerError(403,'reauthentication_required');
 const a=(await db.query('SELECT * FROM sensa_consumer.accounts WHERE issuer=$1 AND subject=$2 FOR UPDATE',[identity.issuer,identity.subject])).rows[0];
 if(!a)throw new ConsumerError(401,'authentication_required');
 const prior=(await db.query('SELECT operation_id FROM sensa_consumer.account_deletions WHERE account_id=$1',[a.account_id])).rows[0];
 if(prior){if(prior.operation_id!==operationId)throw new ConsumerError(409,'deletion_already_requested');return a;}
 const session=(await db.query('SELECT revoked FROM sensa_consumer.sessions WHERE account_id=$1 AND provider_session_id=$2',[a.account_id,identity.sessionId])).rows[0];
 if(!session||session.revoked||a.lifecycle!=='active')throw new ConsumerError(401,'access_revoked');
 if(!identity.authenticatedAt||now.getTime()-identity.authenticatedAt*1000>300000||identity.authenticatedAt*1000>now.getTime()+30000)throw new ConsumerError(403,'reauthentication_required');
 // Never erase a migration-era learning store via the Web-local erasure path.
 if((await db.query('SELECT 1 FROM sensa_consumer.installations WHERE account_id=$1 LIMIT 1',[a.account_id])).rows.length||(await db.query('SELECT 1 FROM sensa_consumer.learner_scopes WHERE learner_user_id=$1 LIMIT 1',[a.learner_user_id])).rows.length)throw new ConsumerError(409,'legacy_account_erasure_required');
 await db.query('INSERT INTO sensa_consumer.account_deletions(account_id,operation_id,requested_at) VALUES($1,$2,$3)',[a.account_id,operationId,now]);
 await db.query("UPDATE sensa_consumer.accounts SET lifecycle='deletion_pending',epoch=epoch+1 WHERE account_id=$1",[a.account_id]);
 await db.query('UPDATE sensa_consumer.sessions SET revoked=true WHERE account_id=$1',[a.account_id]);
 for(const table of ['extension_codes','extension_credentials','reading_settings','reading_requests','native_semantic_usage','native_content_usage','native_content_cancellations'])await db.query(`DELETE FROM sensa_consumer.${table} WHERE account_id=$1`,[a.account_id]);
 await db.query('DELETE FROM sensa_consumer.sessions WHERE account_id=$1',[a.account_id]);
 await db.query('UPDATE core.accounts SET email=NULL WHERE account_id=$1',[a.account_id]);
 return {...a,lifecycle:'deletion_pending'};
}
/** Retryable external erasure. A provider failure never reopens the access barrier. */
export async function finishAccountDeletion(transaction:Transaction,identity:{subject:string;issuer:string},operationId:string,erase:DeleteIdentity=deleteHostedIdentity){
 const row=await transaction(async db=>(await db.query('SELECT a.account_id,a.lifecycle FROM sensa_consumer.accounts a JOIN sensa_consumer.account_deletions d USING(account_id) WHERE a.issuer=$1 AND a.subject=$2 AND d.operation_id=$3',[identity.issuer,identity.subject,operationId])).rows[0]);
 if(!row)throw new ConsumerError(404,'deletion_not_found');
 if(row.lifecycle==='deleted')return {state:'deleted' as const,operationId};
 try{await erase(identity.subject,identity.issuer);}catch{return {state:'deletion_pending' as const,operationId};}
 await transaction(async db=>{await db.query("UPDATE sensa_consumer.accounts SET lifecycle='deleted' WHERE account_id=$1 AND lifecycle='deletion_pending'",[row.account_id]);await db.query('UPDATE sensa_consumer.account_deletions SET completed_at=COALESCE(completed_at,now()) WHERE account_id=$1',[row.account_id]);});
 return {state:'deleted' as const,operationId};
}
