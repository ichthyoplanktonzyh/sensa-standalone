import type {DatabaseExecutor} from '../../database/index.js';
import {ConsumerError} from '../access/auth.js';

export type ModelBudgetKind='semantic'|'content'|'reference';
export type ModelRequestState='reserved'|'running'|'succeeded'|'failed_before_execution'|'failed_after_execution'|'execution_unknown';
export type ModelRequestInput=Readonly<{id:string;inputDigest:string;purpose:string;budgetKind:ModelBudgetKind}>;
export type ModelRequestReservation={kind:'execute'}|{kind:'replay';response:unknown};

export const modelRequestMetadataTtlMs=26*60*60*1000;
export const modelRequestResponseTtlMs=6*60*60*1000;
export const modelRequestCapacity=1_024;
export const modelRequestResponseCapacityBytes=8*1024*1024;
export const modelRequestResponseMaxBytes=2*1024*1024;

const terminalCode=(row:{state:ModelRequestState;error_code?:string|null})=>{
 if(row.state==='reserved'||row.state==='running')return 'model_request_in_progress';
 if(row.state==='succeeded')return 'model_request_succeeded';
 if(row.state==='execution_unknown')return 'model_execution_unknown';
 return row.error_code??'model_request_failed';
};

async function purgeAccountExpiry(db:DatabaseExecutor,accountId:string,now:Date){
 await db.query('DELETE FROM sensa_consumer.model_requests WHERE account_id=$1 AND expires_at<=$2',[accountId,now]);
 await db.query('UPDATE sensa_consumer.model_requests SET response=NULL,response_expires_at=NULL WHERE account_id=$1 AND response_expires_at<=$2',[accountId,now]);
}

async function assertCapacity(db:DatabaseExecutor,accountId:string){
 const count=Number((await db.query('SELECT count(*)::int n FROM sensa_consumer.model_requests WHERE account_id=$1',[accountId])).rows[0]?.n??0);
 if(count>=modelRequestCapacity)throw new ConsumerError(409,'model_request_capacity');
}

async function assertBudget(db:DatabaseExecutor,accountId:string,kind:ModelBudgetKind,now:Date,limit:number){
 if(process.env.SENSA_UNLIMITED_MODEL_USAGE==='true')return;
 const since=new Date(now.getTime()-86_400_000);
 const count=Number((await db.query(`SELECT count(*)::int n FROM sensa_consumer.model_requests
    WHERE account_id=$1 AND budget_kind=$2 AND
      ((state='reserved' AND reserved_at>$3) OR
       (state IN ('running','succeeded','failed_after_execution','execution_unknown') AND execution_started_at>$3))`,[accountId,kind,since])).rows[0]?.n??0);
 if(count>=limit)throw new ConsumerError(409,'model_daily_budget');
}

/** Caller holds the account row lock, serializing quota admission per account. */
export async function reserveModelRequest(db:DatabaseExecutor,accountId:string,input:ModelRequestInput,now:Date,limit:number,beforeReserve:()=>void=()=>{}):Promise<ModelRequestReservation>{
 await purgeAccountExpiry(db,accountId,now);
 const row=(await db.query(`SELECT input_digest,purpose,state,response,error_code,response_expires_at
    FROM sensa_consumer.model_requests WHERE account_id=$1 AND request_id=$2 FOR UPDATE`,[accountId,input.id])).rows[0] as undefined|{input_digest:string;purpose:string;state:ModelRequestState;response?:unknown;error_code?:string|null;response_expires_at?:Date|null};
 if(row){
  if(row.input_digest!==input.inputDigest||row.purpose!==input.purpose)throw new ConsumerError(409,'model_request_conflict');
  if(row.state==='succeeded'&&row.response!==null&&row.response!==undefined&&row.response_expires_at&&new Date(row.response_expires_at)>now)return {kind:'replay',response:row.response};
  if(row.state!=='failed_before_execution')throw new ConsumerError(409,terminalCode(row));
  beforeReserve();
  await assertBudget(db,accountId,input.budgetKind,now,limit);
  await db.query(`UPDATE sensa_consumer.model_requests SET state='reserved',budget_kind=$3,reserved_at=$4,
    execution_started_at=NULL,completed_at=NULL,error_code=NULL,response=NULL,response_expires_at=NULL,
    expires_at=$5 WHERE account_id=$1 AND request_id=$2`,[accountId,input.id,input.budgetKind,now,new Date(now.getTime()+modelRequestMetadataTtlMs)]);
  return {kind:'execute'};
 }
 await assertCapacity(db,accountId);
 beforeReserve();
 await assertBudget(db,accountId,input.budgetKind,now,limit);
 await db.query(`INSERT INTO sensa_consumer.model_requests
   (account_id,request_id,input_digest,purpose,budget_kind,state,created_at,reserved_at,expires_at)
   VALUES($1,$2,$3,$4,$5,'reserved',$6,$6,$7)`,[accountId,input.id,input.inputDigest,input.purpose,input.budgetKind,now,new Date(now.getTime()+modelRequestMetadataTtlMs)]);
 return {kind:'execute'};
}

export async function markModelRequestRunning(db:DatabaseExecutor,accountId:string,requestId:string,digest:string,now:Date){
 const result=await db.query(`UPDATE sensa_consumer.model_requests SET state='running',execution_started_at=$4,error_code=NULL
   WHERE account_id=$1 AND request_id=$2 AND input_digest=$3 AND state='reserved' RETURNING request_id`,[accountId,requestId,digest,now]);
 if(!result.rows.length)throw new ConsumerError(409,'model_request_state_conflict');
}

const encodedBytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;

export async function succeedModelRequest(db:DatabaseExecutor,accountId:string,requestId:string,digest:string,response:unknown,now:Date){
 await db.query('UPDATE sensa_consumer.model_requests SET response=NULL,response_expires_at=NULL WHERE account_id=$1 AND response_expires_at<=$2',[accountId,now]);
 const bytes=encodedBytes(response);
 let saved=bytes<=modelRequestResponseMaxBytes;
 if(saved){
  const rows=(await db.query(`SELECT request_id,pg_column_size(response)::int bytes FROM sensa_consumer.model_requests
    WHERE account_id=$1 AND response IS NOT NULL AND request_id<>$2 ORDER BY completed_at ASC`,[accountId,requestId])).rows as {request_id:string;bytes:number}[];
  let total=rows.reduce((sum,row)=>sum+Number(row.bytes),0);
  const evict:string[]=[];
  for(const row of rows){if(total+bytes<=modelRequestResponseCapacityBytes)break;total-=Number(row.bytes);evict.push(row.request_id);}
  if(evict.length)await db.query('UPDATE sensa_consumer.model_requests SET response=NULL,response_expires_at=NULL WHERE account_id=$1 AND request_id=ANY($2::uuid[])',[accountId,evict]);
  saved=total+bytes<=modelRequestResponseCapacityBytes;
 }
 const result=await db.query(`UPDATE sensa_consumer.model_requests SET state='succeeded',completed_at=$4,error_code=NULL,
   response=$5::jsonb,response_expires_at=$6 WHERE account_id=$1 AND request_id=$2 AND input_digest=$3 AND state='running' RETURNING request_id`,
  [accountId,requestId,digest,now,saved?JSON.stringify(response):null,saved?new Date(now.getTime()+modelRequestResponseTtlMs):null]);
 if(!result.rows.length)throw new ConsumerError(409,'model_request_state_conflict');
}

export async function failModelRequestBeforeExecution(db:DatabaseExecutor,accountId:string,requestId:string,digest:string,errorCode:string,now:Date){
 await db.query(`UPDATE sensa_consumer.model_requests SET state='failed_before_execution',completed_at=$4,error_code=$5,
   expires_at=LEAST(expires_at,$6) WHERE account_id=$1 AND request_id=$2 AND input_digest=$3 AND state='reserved'`,
  [accountId,requestId,digest,now,errorCode,new Date(now.getTime()+60*60*1000)]);
}

export async function failModelRequestAfterExecution(db:DatabaseExecutor,accountId:string,requestId:string,digest:string,errorCode:string,unknown:boolean,now:Date){
 await db.query(`UPDATE sensa_consumer.model_requests SET state=$4,completed_at=$5,error_code=$6
   WHERE account_id=$1 AND request_id=$2 AND input_digest=$3 AND state='running'`,
  [accountId,requestId,digest,unknown?'execution_unknown':'failed_after_execution',now,errorCode]);
}

export async function purgeExpiredModelRequests(db:DatabaseExecutor,now:Date,batchSize:number){
 if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>10_000)throw Error('invalid_model_request_retention_batch');
 const cleared=await db.query(`WITH expired AS (SELECT account_id,request_id FROM sensa_consumer.model_requests
   WHERE response_expires_at<=$1 AND response IS NOT NULL ORDER BY response_expires_at LIMIT $2 FOR UPDATE SKIP LOCKED)
   UPDATE sensa_consumer.model_requests r SET response=NULL,response_expires_at=NULL FROM expired e
   WHERE r.account_id=e.account_id AND r.request_id=e.request_id`,[now,batchSize]);
 const deleted=await db.query(`WITH expired AS (SELECT account_id,request_id FROM sensa_consumer.model_requests
   WHERE expires_at<=$1 ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED)
   DELETE FROM sensa_consumer.model_requests r USING expired e
   WHERE r.account_id=e.account_id AND r.request_id=e.request_id RETURNING r.request_id`,[now,batchSize]);
 return Math.max(cleared.rowCount??0,deleted.rows.length);
}
