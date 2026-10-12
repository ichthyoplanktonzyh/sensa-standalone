import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {librarySyncStageBegin,librarySyncStagePage,librarySyncMetadataPageBytes,librarySyncMetadataPageRefs,type LibrarySyncCommit} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/core.js';
import {ConsumerError} from '../access/auth.js';
import {libraryCloudUploadLeaseMs} from './retention.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const initialStageDigest=hash('sensa-initial-publication-v1');
const conflict=(code='library_sync_conflict'):never=>{throw new ConsumerError(409,code);};

/** Callers hold the existing account lock and outer publication transaction. */
export async function beginInitialPublication(db:DatabaseExecutor,id:string,head:any,raw:unknown,now:Date){
 const input=librarySyncStageBegin.parse(raw),digest=hash(JSON.stringify(input));
 let prior:any=(await db.query('SELECT request_digest,expires_at FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[id,input.operationId])).rows[0];
 if(prior&&new Date(prior.expires_at)<=now){await discardInitialPublication(db,id,input.operationId);prior=undefined;}
 if(prior){if(prior.request_digest!==digest)conflict('operation_conflict');return {staged:true};}
 if((await db.query('SELECT 1 FROM sensa_consumer.library_cloud_commits WHERE account_id=$1 AND operation_id=$2',[id,input.operationId])).rowCount)conflict('operation_conflict');
 if(head.library_id||head.revision!==input.baseRevision)conflict();
 // Only expired private workspaces are retired; committed heads/receipts are untouched.
 const expired=(await db.query('SELECT operation_id FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND expires_at<=$2 LIMIT 4',[id,now])).rows;
 for(const row of expired){await db.query("DELETE FROM sensa_consumer.library_cloud_membership WHERE account_id=$1 AND owner_kind='staging' AND owner_id=$2",[id,row.operation_id]);await db.query('DELETE FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[id,row.operation_id]);}
 if(Number((await db.query('SELECT count(*) AS n FROM sensa_consumer.library_cloud_staging WHERE account_id=$1',[id])).rows[0].n)>=4)throw new ConsumerError(413,'library_sync_capacity');
 await db.query('INSERT INTO sensa_consumer.library_cloud_staging(account_id,operation_id,request_digest,descriptor,digest,expires_at) VALUES($1,$2,$3,$4::jsonb,$5,$6)',[id,input.operationId,digest,JSON.stringify(input),initialStageDigest,new Date(now.getTime()+libraryCloudUploadLeaseMs)]);
 return {staged:true};
}
export async function appendInitialPublication(db:DatabaseExecutor,id:string,head:any,raw:unknown,now:Date){
 const input=librarySyncStagePage.parse(raw),text=JSON.stringify(input),bytes=Buffer.byteLength(text),refs=input.rows.reduce((sum,row)=>sum+row.blocks.length,0);
 if(bytes>librarySyncMetadataPageBytes||refs>librarySyncMetadataPageRefs)throw new ConsumerError(413,'library_sync_capacity');
 const stage=(await db.query('SELECT * FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[id,input.operationId])).rows[0];
 if(!stage||new Date(stage.expires_at)<=now)conflict('library_sync_staging_expired');
 const requestDigest=hash(text),prior=(await db.query('SELECT request_digest,digest FROM sensa_consumer.library_cloud_staging_pages WHERE account_id=$1 AND operation_id=$2 AND page=$3',[id,input.operationId,input.page])).rows[0];
 if(prior){if(prior.request_digest!==requestDigest)conflict('operation_conflict');return {digest:prior.digest};}
 if(head.library_id||head.revision!==stage.descriptor.baseRevision||input.page!==stage.pages)conflict();
 const metadata=Number((await db.query('SELECT COALESCE(sum(metadata_bytes),0) AS n FROM sensa_consumer.library_cloud_staging WHERE account_id=$1',[id])).rows[0].n);
 if(stage.records+input.rows.length>200000||metadata+bytes>64*1024*1024)throw new ConsumerError(413,'library_sync_capacity');
 const hashes=[...new Set(input.rows.flatMap(row=>row.blocks))];
 if((await db.query('SELECT hash FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[id,hashes])).rowCount!==hashes.length)conflict('library_sync_missing_block');
 // A key can appear only once across the whole workspace, even under another page.
 if((await db.query(`SELECT 1 FROM sensa_consumer.library_cloud_staging_rows AS old JOIN jsonb_to_recordset($3::jsonb) AS new("table" text,key text,blocks jsonb)
 ON old.table_name=new."table" AND old.record_key=new.key WHERE old.account_id=$1 AND old.operation_id=$2 LIMIT 1`,[id,input.operationId,JSON.stringify(input.rows)])).rowCount)conflict('operation_conflict');
 const digest=hash(stage.digest+requestDigest);
 await db.query(`INSERT INTO sensa_consumer.library_cloud_staging_rows SELECT $1,$2,r."table",r.key,r.blocks FROM jsonb_to_recordset($3::jsonb) AS r("table" text,key text,blocks jsonb)`,[id,input.operationId,JSON.stringify(input.rows)]);
 await db.query("INSERT INTO sensa_consumer.library_cloud_membership SELECT $1,'staging',$2,hash FROM unnest($3::text[]) hash ON CONFLICT DO NOTHING",[id,input.operationId,hashes]);
 await db.query('INSERT INTO sensa_consumer.library_cloud_staging_pages VALUES($1,$2,$3,$4,$5)',[id,input.operationId,input.page,requestDigest,digest]);
 await db.query('UPDATE sensa_consumer.library_cloud_staging SET pages=pages+1,records=records+$3,metadata_bytes=metadata_bytes+$4,digest=$5,expires_at=$6 WHERE account_id=$1 AND operation_id=$2',[id,input.operationId,input.rows.length,bytes,digest,new Date(now.getTime()+libraryCloudUploadLeaseMs)]);
 return {digest};
}
export async function commitInitialPublication(db:DatabaseExecutor,id:string,head:any,input:Extract<LibrarySyncCommit,{staging:unknown}>,now:Date){
 const stage=(await db.query('SELECT * FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[id,input.operationId])).rows[0];
 if(!stage||new Date(stage.expires_at)<=now)conflict('library_sync_staging_expired');
 if(head.library_id||stage.descriptor.baseRevision!==input.baseRevision)conflict();
 if(stage.pages!==input.staging.pages||stage.records!==input.staging.records||stage.digest!==input.staging.digest)conflict('operation_conflict');
 if(!(await db.query("SELECT 1 FROM sensa_consumer.library_cloud_staging_rows WHERE account_id=$1 AND operation_id=$2 AND table_name='meta' AND record_key='identity'",[id,input.operationId])).rowCount)conflict('library_sync_identity');
 const revision=head.revision+1;
 await db.query('INSERT INTO sensa_consumer.library_cloud_rows SELECT account_id,table_name,record_key,refs FROM sensa_consumer.library_cloud_staging_rows WHERE account_id=$1 AND operation_id=$2',[id,input.operationId]);
 await db.query(`INSERT INTO sensa_consumer.library_cloud_membership
 SELECT r.account_id,'row',concat('[',to_json(r.table_name)::text,',',to_json(r.record_key)::text,']'),b.value FROM sensa_consumer.library_cloud_staging_rows r CROSS JOIN LATERAL jsonb_array_elements_text(r.refs) b(value)
 WHERE r.account_id=$1 AND r.operation_id=$2 ON CONFLICT DO NOTHING`,[id,input.operationId]);
 await db.query('UPDATE sensa_consumer.library_cloud SET revision=$2,library_id=$3,learner_id=$4,record_count=$5,updated_at=now() WHERE account_id=$1',[id,revision,stage.descriptor.libraryId,stage.descriptor.learnerId,stage.records]);
 return {revision,libraryId:stage.descriptor.libraryId,learnerId:stage.descriptor.learnerId,records:stage.records};
}
export async function discardInitialPublication(db:DatabaseExecutor,id:string,operationId:string){
 await db.query("DELETE FROM sensa_consumer.library_cloud_membership WHERE account_id=$1 AND owner_kind='staging' AND owner_id=$2",[id,operationId]);
 await db.query('DELETE FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[id,operationId]);
}
