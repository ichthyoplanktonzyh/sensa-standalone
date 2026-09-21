/** Scheduled erasure for expired private semantic lookup snapshots. */
import pg from 'pg';
import {purgeExpiredSemanticLookups} from '../../apps/api/src/sensa/personal/retention.ts';

const connectionString=process.env.SENSA_MAINTENANCE_DATABASE_URL;
if(!connectionString)throw new Error('SENSA_MAINTENANCE_DATABASE_URL is required');
const batchSize=1_000,maxBatches=100;
const db=new pg.Client({connectionString,connectionTimeoutMillis:15_000});
let deleted=0,batches=0;
try{
 await db.connect();
 for(;batches<maxBatches;batches++){
  await db.query('BEGIN');
  try{
   await db.query("SET LOCAL lock_timeout='5s'");
   await db.query("SET LOCAL statement_timeout='20s'");
   const count=await purgeExpiredSemanticLookups(db,new Date(),batchSize);
   await db.query('COMMIT');deleted+=count;
   if(count<batchSize)break;
  }catch(error){await db.query('ROLLBACK');throw error;}
 }
 console.log(JSON.stringify({event:'sensa.semantic_lookup_retention',deleted,batches:batches+1,limitReached:batches===maxBatches}));
}catch{
 console.error('Semantic lookup retention failed. Inspect the maintenance job without logging private payloads.');
 process.exitCode=1;
}finally{await db.end();}
