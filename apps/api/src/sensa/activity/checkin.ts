import {accountClockGrantSchema,checkInViewSchema} from '@sensa/contracts/sensa';
import type {CheckInOperation} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/index.js';
import {accountDate} from '../runtime/initial.js';
import type {RuntimeScope} from '../runtime/initial.js';
import {ConsumerError} from '../access/auth.js';
export async function issueAccountClock(db:DatabaseExecutor,a:RuntimeScope,installationId:string,clockSessionId?:string){
 if(!clockSessionId)return null;
 const install=(await db.query('SELECT replica_id FROM sensa_consumer.installations WHERE id=$1 AND account_id=$2',[installationId,a.account_id])).rows[0]!;
 const id=crypto.randomUUID(),expires=new Date(a.now.getTime()+7*86400000);
 await db.query('INSERT INTO sensa_consumer.account_clock_grants(id,learner_user_id,installation_id,replica_id,scope_epoch,clock_session_id,issued_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,a.learner_user_id,installationId,install.replica_id,a.epoch,clockSessionId,a.now,expires]);
 return accountClockGrantSchema.parse({id,installationId,replicaId:install.replica_id,scopeEpoch:String(a.epoch),issuedAt:a.now.toISOString(),expiresAt:expires.toISOString(),clockSessionId});
}
function view(row:Record<string,any>){return checkInViewSchema.parse({id:row.id,date:row.day,revision:String(row.revision),source:row.source,timeZone:row.time_zone,occurredAt:row.occurred_at.toISOString(),runId:row.run_id,activityEntryOperationId:row.entry_operation_id});}
export async function listCheckIns(db:DatabaseExecutor,a:RuntimeScope){
 const rows=(await db.query("SELECT *,to_char(account_date,'YYYY-MM-DD') AS day FROM sensa_consumer.checkins WHERE learner_user_id=$1 ORDER BY account_date DESC LIMIT 366",[a.learner_user_id])).rows;
 return rows.map(view);
}
export async function recordCheckIn(db:DatabaseExecutor,a:RuntimeScope,op:CheckInOperation){
 const p=op.payload,clock=p.clock;if(!clock)throw new ConsumerError(409,'clock_untrusted');
 let grant:Record<string,any>|undefined;
 if(p.source==='manual'){
  if(p.runId||p.activityEntryOperationId)throw new ConsumerError(400,'invalid_checkin_source');
  grant=(await db.query('SELECT * FROM sensa_consumer.account_clock_grants WHERE id=$1 AND learner_user_id=$2',[clock.grantId,a.learner_user_id])).rows[0];
 }else{
  grant=(await db.query('SELECT g.* FROM sensa_consumer.offline_grants g JOIN sensa_consumer.runs r ON r.id=g.run_id WHERE g.id=$1 AND r.learner_user_id=$2',[clock.grantId,a.learner_user_id])).rows[0];
  if(!grant||grant.run_id!==p.runId||grant.entry_operation_id!==p.activityEntryOperationId)throw new ConsumerError(409,'invalid_checkin_source');
  const entry=(await db.query('SELECT result FROM sensa_consumer.operations WHERE learner_user_id=$1 AND operation_id=$2',[a.learner_user_id,p.activityEntryOperationId])).rows[0];
  if(entry?.result.status!=='accepted'||entry.result.value.runtime?.run?.id!==p.runId)throw new ConsumerError(409,'invalid_checkin_source');
 }
 if(!grant||grant.installation_id!==op.installationId||grant.replica_id!==op.replicaId||String(grant.scope_epoch)!==String(a.epoch))throw new ConsumerError(409,'clock_untrusted');
 const occurred=new Date(op.occurredAt);
 if(clock.sessionId!==grant.clock_session_id||Math.abs(occurred.getTime()-grant.issued_at.getTime()-clock.elapsedMs)>5000||occurred<grant.issued_at||occurred>grant.expires_at||occurred.getTime()>a.now.getTime()+300000)throw new ConsumerError(409,'clock_untrusted');
 const day=accountDate(occurred,a.time_zone);
 const old=(await db.query("SELECT *,to_char(account_date,'YYYY-MM-DD') AS day FROM sensa_consumer.checkins WHERE learner_user_id=$1 AND account_date=$2",[a.learner_user_id,day])).rows[0];
 if(old)return {checkin:view(old),alreadyRecorded:true};
 const row=(await db.query("INSERT INTO sensa_consumer.checkins(id,learner_user_id,account_date,time_zone,source,occurred_at,run_id,entry_operation_id,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *,to_char(account_date,'YYYY-MM-DD') AS day",[crypto.randomUUID(),a.learner_user_id,day,a.time_zone,p.source,occurred,p.runId,p.activityEntryOperationId,op.operationId])).rows[0]!;
 return {checkin:view(row),alreadyRecorded:false};
}
