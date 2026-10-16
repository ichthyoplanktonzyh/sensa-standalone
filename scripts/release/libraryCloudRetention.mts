/** Scheduled cleanup for expired, unreferenced account-sync blocks. */
import pg from 'pg';
import {continueLibraryCloudRetention,purgeExpiredLibraryCloudBlocks} from '../../apps/api/src/sensa/library/retention.ts';

const connectionString=process.env.SENSA_MAINTENANCE_DATABASE_URL;
if(!connectionString)throw new Error('SENSA_MAINTENANCE_DATABASE_URL is required');
const batchSize=1_000,maxBatches=100;
// Enabling this needs separately approved metadata ACLs. The existing restricted
// orphan-sweep credential is intentionally not upgraded by this script.
const historyEnabled=process.env.SENSA_LIBRARY_HISTORY_RETENTION_ENABLED==='true';
const db=new pg.Client({connectionString,connectionTimeoutMillis:15_000,application_name:'sensa-library-retention'});
let deleted=0,batches=0,accountsServiced=0,stopping=false;
const stop=()=>{stopping=true;};process.once('SIGTERM',stop);process.once('SIGINT',stop);
try{
 await db.connect();
 const deadline=performance.now()+90_000;
 while(batches<maxBatches&&!stopping&&performance.now()<deadline){
  await db.query('BEGIN');
  try{
   await db.query("SET LOCAL lock_timeout='5s'");
   await db.query("SET LOCAL statement_timeout='20s'");
   // Keep expiration, eligibility and cursor advancement on the database clock;
   // the text boundary preserves its microseconds across the JS Date boundary.
   const instant=(await db.query('SELECT clock_timestamp() AS at,clock_timestamp()::text AS boundary')).rows[0];
   const now=instant.at as Date,account=historyEnabled?await continueLibraryCloudRetention(db,now,instant.boundary):undefined;
   const count=await purgeExpiredLibraryCloudBlocks(db,now,batchSize);
   await db.query('COMMIT');deleted+=count;batches++;if(account)accountsServiced++;
   if(count<batchSize&&!account)break;
  }catch(error){await db.query('ROLLBACK');throw error;}
 }
 console.log(JSON.stringify({event:'sensa.library_cloud_retention',deleted,batches,accountsServiced,historyEnabled,interrupted:stopping,limitReached:batches===maxBatches||performance.now()>=deadline}));
}catch{
 console.error('Library cloud retention failed. Inspect the maintenance job without logging private payloads.');
 process.exitCode=1;
}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);await db.end();}
