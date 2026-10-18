import {measureLibraryRows,stagingLibraryLogicalBytes} from './logicalBudget.js';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {librarySyncLogicalByteLimit,librarySyncRecordLimit,librarySyncStageMetadataByteLimit,librarySyncStageBegin,librarySyncStagePage,librarySyncMetadataPageBytes,librarySyncMetadataPageRefs,type LibrarySyncCommit} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/core.js';
import {ConsumerError} from '../access/auth.js';
import {pinLibraryCloudBlocks} from './membership.js';
import {libraryCloudUploadLeaseMs} from './retention.js';
import {libraryCloudRowOwner,discardPreparedLibraryGeneration,requirePrivateLibraryGeneration} from './generation.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const initialStageDigest=hash('sensa-initial-publication-v1');
const conflict=(code='library_sync_conflict'):never=>{throw new ConsumerError(409,code);};
const requirePreparedStage=(stage:any)=>{if(stage.purpose!=='initial'||![1,2].includes(stage.prepared_version)||stage.prepared_pages!==stage.pages||stage.prepared_records!==stage.records)conflict('library_sync_staging_unprepared');if(stage.retiring)conflict('library_sync_staging_expired');};

/** Callers hold the existing account lock and outer publication transaction. */
export async function beginInitialPublication(db:DatabaseExecutor,id:string,head:any,raw:unknown,now:Date){
 const input=librarySyncStageBegin.parse(raw),digest=hash(JSON.stringify(input));requirePrivateLibraryGeneration(input.operationId);
 let prior:any=(await db.query('SELECT * FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[id,input.operationId])).rows[0];
 if(prior&&new Date(prior.expires_at)<=now){if(!await discardInitialPublication(db,id,input.operationId))conflict('library_sync_staging_expired');prior=undefined;}
 if(prior){if(head.library_id||head.revision!==prior.descriptor.baseRevision)conflict();requirePreparedStage(prior);if(prior.request_digest!==digest)conflict('operation_conflict');return {staged:true};}
 if((await db.query('SELECT 1 FROM sensa_consumer.library_cloud_commits WHERE account_id=$1 AND operation_id=$2',[id,input.operationId])).rowCount)conflict('operation_conflict');
 if(head.library_id||head.revision!==input.baseRevision)conflict();
 // Only expired private workspaces are retired; committed heads/receipts are untouched.
 const expired=(await db.query('SELECT operation_id FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND expires_at<=$2 LIMIT 4',[id,now])).rows;
 for(const row of expired)await discardInitialPublication(db,id,row.operation_id);
 if(Number((await db.query('SELECT count(*) AS n FROM sensa_consumer.library_cloud_staging WHERE account_id=$1',[id])).rows[0].n)>=4)throw new ConsumerError(413,'library_sync_capacity');
 // Version 2 keeps refs only in the unpublished application generation and its
 // immutable snapshot. Older handlers reject it instead of expecting a third copy.
 await db.query('INSERT INTO sensa_consumer.library_cloud_staging(account_id,operation_id,request_digest,descriptor,digest,expires_at,logical_bytes,prepared_version) VALUES($1,$2,$3,$4::jsonb,$5,$6,0,2)',[id,input.operationId,digest,JSON.stringify(input),initialStageDigest,new Date(now.getTime()+libraryCloudUploadLeaseMs)]);
 return {staged:true};
}
export async function appendInitialPublication(db:DatabaseExecutor,id:string,head:any,raw:unknown,now:Date){
 const input=librarySyncStagePage.parse(raw),text=JSON.stringify(input),bytes=Buffer.byteLength(text),refs=input.rows.reduce((sum,row)=>sum+row.blocks.length,0);requirePrivateLibraryGeneration(input.operationId);
 if(bytes>librarySyncMetadataPageBytes||refs>librarySyncMetadataPageRefs)throw new ConsumerError(413,'library_sync_capacity');
 const stage=(await db.query('SELECT * FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2 FOR UPDATE',[id,input.operationId])).rows[0];
 if(!stage)conflict('library_sync_staging_expired');
 const committed=(await db.query('SELECT 1 FROM sensa_consumer.library_cloud_commits c JOIN sensa_consumer.library_cloud h ON h.account_id=c.account_id AND h.rows_generation=c.operation_id WHERE c.account_id=$1 AND c.operation_id=$2 AND c.result IS NOT NULL',[id,input.operationId])).rowCount;
 if(!committed&&(new Date(stage.expires_at)<=now||stage.retiring))conflict('library_sync_staging_expired');requirePreparedStage(stage);
 const requestDigest=hash(text),prior=(await db.query('SELECT request_digest,digest FROM sensa_consumer.library_cloud_staging_pages WHERE account_id=$1 AND operation_id=$2 AND page=$3',[id,input.operationId,input.page])).rows[0];
 if(prior){if(prior.request_digest!==requestDigest)conflict('operation_conflict');return {digest:prior.digest};}
 if(committed||head.library_id||head.revision!==stage.descriptor.baseRevision||input.page!==stage.pages)conflict();
 const metadata=Number((await db.query('SELECT COALESCE(sum(metadata_bytes),0) AS n FROM sensa_consumer.library_cloud_staging WHERE account_id=$1',[id])).rows[0].n);
 if(stage.records+input.rows.length>librarySyncRecordLimit||metadata+bytes>librarySyncStageMetadataByteLimit)throw new ConsumerError(413,'library_sync_capacity');
 const hashes=[...new Set(input.rows.flatMap(row=>row.blocks))];
 if((await db.query('SELECT hash FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[id,hashes])).rowCount!==hashes.length)conflict('library_sync_missing_block');
 // A key can appear only once across the whole workspace, even under another page.
 if((await db.query(`SELECT 1 FROM sensa_consumer.library_cloud_rows AS old JOIN jsonb_to_recordset($3::jsonb) AS new("table" text,key text,blocks jsonb)
 ON old.table_name=new."table" AND old.record_key=new.key WHERE old.account_id=$1 AND old.generation=$2 LIMIT 1`,[id,input.operationId,JSON.stringify(input.rows)])).rowCount)conflict('operation_conflict');
 const measured=await measureLibraryRows(db,id,input.rows),logical=measured.reduce((sum,bytes)=>sum+bytes,0);
 if(await stagingLibraryLogicalBytes(db,id,input.operationId,stage.logical_bytes,stage.prepared_version)+logical>librarySyncLogicalByteLimit)throw new ConsumerError(413,'library_sync_capacity');
 const digest=hash(stage.digest+requestDigest);
 const measuredRows=JSON.stringify(input.rows.map((row,index)=>({...row,logical_bytes:measured[index]})));
 // Finish an already-open v1 upload without changing its storage contract.
 if(stage.prepared_version===1)await db.query(`INSERT INTO sensa_consumer.library_cloud_staging_rows(account_id,operation_id,table_name,record_key,refs,logical_bytes) SELECT $1,$2,r."table",r.key,r.blocks,r.logical_bytes FROM jsonb_to_recordset($3::jsonb) AS r("table" text,key text,blocks jsonb,logical_bytes bigint)`,[id,input.operationId,measuredRows]);
 // Prepare the application rows and immutable snapshot inside this bounded
 // page. Neither generation is reachable through an unpublished head.
 await db.query(`INSERT INTO sensa_consumer.library_cloud_rows(account_id,generation,table_name,record_key,refs,logical_bytes)
  SELECT $1,$2,r."table",r.key,r.blocks,r.logical_bytes FROM jsonb_to_recordset($3::jsonb) AS r("table" text,key text,blocks jsonb,logical_bytes bigint)`,[id,input.operationId,measuredRows]);
 await db.query(`INSERT INTO sensa_consumer.library_cloud_snapshots(account_id,generation,revision,table_name,record_key,refs)
  SELECT account_id,generation,$4,table_name,record_key,refs FROM sensa_consumer.library_cloud_rows
  WHERE account_id=$1 AND generation=$2 AND (table_name,record_key) IN(SELECT r."table",r.key FROM jsonb_to_recordset($3::jsonb) AS r("table" text,key text))`,[id,input.operationId,JSON.stringify(input.rows),stage.descriptor.baseRevision+1]);
 await pinLibraryCloudBlocks(db,id,[...input.rows.map(row=>({kind:'row' as const,owner:libraryCloudRowOwner(input.operationId,row.table,row.key),hashes:row.blocks})),{kind:'staging',owner:input.operationId.toLowerCase(),hashes}]);
 await db.query('INSERT INTO sensa_consumer.library_cloud_staging_pages(account_id,operation_id,page,request_digest,digest) VALUES($1,$2,$3,$4,$5)',[id,input.operationId,input.page,requestDigest,digest]);
 await db.query('UPDATE sensa_consumer.library_cloud_staging SET pages=pages+1,records=records+$3,prepared_pages=prepared_pages+1,prepared_records=prepared_records+$3,metadata_bytes=metadata_bytes+$4,digest=$5,expires_at=$6,logical_bytes=logical_bytes+$7 WHERE account_id=$1 AND operation_id=$2',[id,input.operationId,input.rows.length,bytes,digest,new Date(now.getTime()+libraryCloudUploadLeaseMs),logical]);
 return {digest};
}
export async function commitInitialPublication(db:DatabaseExecutor,id:string,head:any,input:Extract<LibrarySyncCommit,{staging:unknown}>,now:Date){
 requirePrivateLibraryGeneration(input.operationId);
 const stage=(await db.query('SELECT * FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2 FOR UPDATE',[id,input.operationId])).rows[0];
 if(!stage||new Date(stage.expires_at)<=now)conflict('library_sync_staging_expired');requirePreparedStage(stage);
 if(head.library_id||stage.descriptor.baseRevision!==input.baseRevision)conflict();
 if(stage.pages!==input.staging.pages||stage.records!==input.staging.records||stage.digest!==input.staging.digest)conflict('operation_conflict');
 if(!(await db.query("SELECT 1 FROM sensa_consumer.library_cloud_rows WHERE account_id=$1 AND generation=$2 AND table_name='meta' AND record_key='identity'",[id,input.operationId])).rowCount)conflict('library_sync_identity');
 stage.logical_bytes=await stagingLibraryLogicalBytes(db,id,input.operationId,stage.logical_bytes,stage.prepared_version);
 const revision=head.revision+1;
 await db.query('UPDATE sensa_consumer.library_cloud SET revision=$2,library_id=$3,learner_id=$4,record_count=$5,logical_bytes=$6,rows_generation=$7,snapshot_generation=$7,snapshot_revision=$2,retention_floor=$2,tail_bytes=0,tail_commits=0,updated_at=now() WHERE account_id=$1',[id,revision,stage.descriptor.libraryId,stage.descriptor.learnerId,stage.records,stage.logical_bytes,input.operationId]);
 return {revision,libraryId:stage.descriptor.libraryId,learnerId:stage.descriptor.learnerId,records:stage.records};
}
export async function discardInitialPublication(db:DatabaseExecutor,id:string,operationId:string,committed=false){
 if(committed){
  // The receipt makes duplicate staging rows eligible for bounded request
  // maintenance. Keep header/pages/prepared witnesses and the initial snapshot
  // union pin; final CAS never performs a library-sized cleanup.
  return true;
 }
 if((await db.query('SELECT 1 FROM sensa_consumer.library_cloud_commits c JOIN sensa_consumer.library_cloud h ON h.account_id=c.account_id AND h.rows_generation=c.operation_id WHERE c.account_id=$1 AND c.operation_id=$2 AND c.result IS NOT NULL',[id,operationId])).rowCount)return true;
 if(!(await db.query('SELECT 1 FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2 FOR UPDATE',[id,operationId])).rowCount)return true;
 const cleanup=await discardPreparedLibraryGeneration(db,id,operationId);if(cleanup.selected)conflict('operation_conflict');
 if(cleanup.complete)await db.query('DELETE FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[id,operationId]);
 return cleanup.complete;
}
