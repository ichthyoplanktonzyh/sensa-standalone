/** Aggregate, read-only operational checks; no learner content or identifiers in logs. */
import pg from 'pg';
const threshold=Number(process.env.SENSA_ALERT_MODEL_CALLS_24H??500);
const failureThreshold=Number(process.env.SENSA_ALERT_MODEL_FAILURES_1H??10);
if(!Number.isSafeInteger(threshold)||threshold<1||!Number.isSafeInteger(failureThreshold)||failureThreshold<1)throw Error('Positive alert thresholds required');
const db=new pg.Client({connectionString:process.env.MONITOR_DATABASE_URL,connectionTimeoutMillis:15000});
try{
 if(!process.env.MONITOR_DATABASE_URL)throw Error('Monitor database not configured');
 await db.connect();await db.query('BEGIN READ ONLY');
 const pending=Number((await db.query("SELECT count(*) n FROM sensa_consumer.accounts a JOIN sensa_consumer.account_deletions d USING(account_id) WHERE a.lifecycle='deletion_pending' AND d.requested_at<now()-interval '1 hour'")).rows[0].n);
 const managed=Number((await db.query("SELECT count(*) n FROM sensa_consumer.model_requests WHERE execution_started_at>now()-interval '24 hours'")).rows[0].n);
 const reading=Number((await db.query("SELECT count(*) n FROM sensa_consumer.reading_requests WHERE created_at>now()-interval '24 hours'")).rows[0].n);
 const modelFailures=Number((await db.query("SELECT count(*) n FROM sensa_consumer.model_requests WHERE state IN ('failed_after_execution','execution_unknown') AND completed_at>now()-interval '1 hour'")).rows[0].n);
 const lockWaits=Number((await db.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND state<>'idle' AND query_start<now()-interval '30 seconds'")).rows[0].n);
 await db.query('COMMIT');const calls=managed+reading;
 console.log(JSON.stringify({event:'sensa.operational_check',pendingDeletionOverOneHour:pending,requests24h:calls,requestAlertThreshold:threshold,modelFailures1h:modelFailures,modelFailureAlertThreshold:failureThreshold,lockWaitsOver30s:lockWaits}));
 if(pending>0||calls>=threshold||modelFailures>=failureThreshold||lockWaits>0){console.error('Operational threshold exceeded. Inspect deletion recovery, database waits, or managed-service health; do not log user payloads.');process.exitCode=1;}
 if(process.env.SENSA_ALERT_DRILL==='true'){console.error('Controlled alert drill requested; no user data was read or emitted.');process.exitCode=1;}
}catch{console.error('Operational check failed. Verify the monitored environment and read-only database access.');process.exitCode=1;}finally{await db.end();}
