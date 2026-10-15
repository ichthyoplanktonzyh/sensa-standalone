import {librarySyncStoredByteLimit} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/index.js';
import {libraryCloudCleanupRows,libraryCloudCleanupPins,discardPreparedLibraryGeneration} from './generation.js';

export const libraryCloudCapacityBytes=librarySyncStoredByteLimit;
export const libraryCloudUploadLeaseMs=24*60*60*1000;
export const libraryCloudReadLeaseMs=10*60*1000;
export const libraryCloudRetiredGraceMs=2*60*1000;

/** One resumable maintenance slice under the existing account lock/transaction.
 * Current facts and business history are never targets. The oldest live reader
 * bounds snapshot/tail retirement; new readers can only acquire the current H.
 * The boolean preserves the explicit no-reader boundary for maintenance callers;
 * newer readers do not prevent safe work below their protected range. */
export async function pruneLibraryCloudHistory(db:DatabaseExecutor,accountId:string,now:Date):Promise<boolean>{
 const head=(await db.query('SELECT library_id,rows_generation,snapshot_revision,retention_floor FROM sensa_consumer.library_cloud WHERE account_id=$1 FOR UPDATE',[accountId])).rows[0];
 // Legacy checkpoints are retained verbatim and require explicit recovery.
 if(!head?.library_id)return false;
 await db.query(`WITH page AS(SELECT ctid FROM sensa_consumer.library_cloud_reads WHERE account_id=$1 AND expires_at<=$2 LIMIT $3 FOR UPDATE)
  DELETE FROM sensa_consumer.library_cloud_reads r USING page WHERE r.ctid=page.ctid`,[accountId,now,libraryCloudCleanupRows]);
 const readers=(await db.query(`SELECT count(*)::int AS n,min(from_revision) AS floor,min(snapshot_revision) AS snapshot
  FROM sensa_consumer.library_cloud_reads WHERE account_id=$1 AND expires_at>$2`,[accountId,now])).rows[0];
 const floor=Math.min(head.retention_floor,readers.floor??head.retention_floor),snapshot=Math.min(head.snapshot_revision,readers.snapshot??head.snapshot_revision);
 // Payload and witnesses have independent lifetimes: receipt-backed rows can go
 // even while a reader still depends on the stage's initial-snapshot union pin.
 await db.query(`WITH page AS(SELECT r.ctid FROM sensa_consumer.library_cloud_staging_rows r
  WHERE r.account_id=$1 AND r.operation_id=$3 AND EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_commits c WHERE c.account_id=r.account_id AND c.operation_id=r.operation_id AND c.result IS NOT NULL)
  LIMIT $2 FOR UPDATE OF r)
  DELETE FROM sensa_consumer.library_cloud_staging_rows r USING page WHERE r.ctid=page.ctid`,[accountId,libraryCloudCleanupRows,head.rows_generation]);
 await db.query(`WITH page AS(SELECT ctid FROM sensa_consumer.library_cloud_log WHERE account_id=$1 AND revision<=$2 ORDER BY revision,ordinal LIMIT $3 FOR UPDATE)
  DELETE FROM sensa_consumer.library_cloud_log r USING page WHERE r.ctid=page.ctid`,[accountId,floor,libraryCloudCleanupRows]);
 await db.query(`WITH page AS(SELECT ctid FROM sensa_consumer.library_cloud_snapshots WHERE account_id=$1 AND revision<$2 LIMIT $3 FOR UPDATE)
  DELETE FROM sensa_consumer.library_cloud_snapshots r USING page WHERE r.ctid=page.ctid`,[accountId,snapshot,libraryCloudCleanupRows]);
 await db.query(`WITH page AS(SELECT m.ctid FROM sensa_consumer.library_cloud_membership m WHERE m.account_id=$1 AND m.owner_kind IN('log','snapshot','staging') AND
  CASE WHEN owner_kind='log' THEN owner_id::bigint<=$2
   WHEN owner_kind='snapshot' THEN CASE WHEN owner_id~'^[0-9]+$' THEN owner_id::bigint<$3
    WHEN owner_id LIKE '[%' THEN (owner_id::jsonb->>1)::bigint<$3 ELSE false END
   WHEN owner_kind='staging' THEN EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_staging s
    JOIN sensa_consumer.library_cloud_commits c ON c.account_id=s.account_id AND c.operation_id=s.operation_id
    WHERE s.account_id=m.account_id AND s.operation_id=$5 AND m.owner_id IN(s.operation_id::text,s.descriptor->>'operationId') AND c.result IS NOT NULL AND c.revision<$3)
   ELSE false END LIMIT $4 FOR UPDATE OF m)
  DELETE FROM sensa_consumer.library_cloud_membership m USING page WHERE m.ctid=page.ctid`,[accountId,floor,snapshot,libraryCloudCleanupPins,head.rows_generation]);
 return readers.n===0;
}

/**
 * Delete one bounded batch of blocks whose upload lease elapsed and which are
 * not protected by either the current head or a still-readable retired head.
 */
export async function purgeExpiredLibraryCloudBlocks(
  db:DatabaseExecutor,
  now:Date,
  batchSize=1_000,
  accountId?:string,
):Promise<number>{
 if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>10_000)throw new Error('invalid_library_retention_batch');
 // Account-scoped requests already hold the publication lock. The scheduled
 // orphan sweep has no account authority and never retires generations/history.
 if(accountId){
 await pruneLibraryCloudHistory(db,accountId,now);
 const stages=(await db.query(`SELECT stage.account_id,stage.operation_id FROM sensa_consumer.library_cloud_staging stage
  WHERE stage.expires_at<=$1 AND ($2::text IS NULL OR stage.account_id=$2)
  AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud head WHERE head.account_id=stage.account_id AND (head.rows_generation=stage.operation_id OR head.snapshot_generation=stage.operation_id)
   AND NOT(stage.operation_id='00000000-0000-0000-0000-000000000000' AND stage.prepared_version=0 AND head.library_id IS NULL))
  LIMIT $3 FOR UPDATE OF stage SKIP LOCKED`,[now,accountId??null,1])).rows;
 for(const stage of stages){
  const cleanup=await discardPreparedLibraryGeneration(db,stage.account_id,stage.operation_id);
  if(cleanup.complete)await db.query('DELETE FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[stage.account_id,stage.operation_id]);
 }
 }
 for(const [table,predicate,keys] of [
  ['library_cloud_block_refs',"reference_kind='retired' AND expires_at<=$1",['account_id','hash','reference_kind']],
  ['library_cloud_reads','expires_at<=$1',['account_id','id']],
  ['library_cloud_snapshot_leases','expires_at<=$1',['account_id','revision']],
 ] as const)await db.query(`WITH page AS(SELECT ${keys.join(',')} FROM sensa_consumer.${table} WHERE ${predicate} AND ($2::text IS NULL OR account_id=$2) LIMIT $3)
  DELETE FROM sensa_consumer.${table} r USING page WHERE ${keys.map(key=>'r.'+key+'=page.'+key).join(' AND ')}`, [now,accountId??null,batchSize]);
 const result=await db.query(`
  WITH expired AS (
   SELECT blocks.account_id,blocks.hash
   FROM sensa_consumer.library_cloud_blocks AS blocks
   WHERE blocks.upload_lease_expires_at<=$1
    AND ($3::text IS NULL OR blocks.account_id=$3)
    AND NOT EXISTS (SELECT 1 FROM sensa_consumer.library_cloud_membership AS member
     WHERE member.account_id=blocks.account_id AND member.hash=blocks.hash)
    AND NOT EXISTS (
     SELECT 1 FROM sensa_consumer.library_cloud_block_refs AS refs
     WHERE refs.account_id=blocks.account_id AND refs.hash=blocks.hash
      AND (refs.reference_kind='head' OR refs.expires_at>$1)
    )
   ORDER BY blocks.upload_lease_expires_at,blocks.account_id,blocks.hash
   LIMIT $2
   FOR UPDATE OF blocks SKIP LOCKED
  )
  DELETE FROM sensa_consumer.library_cloud_blocks AS blocks
  USING expired
  WHERE blocks.account_id=expired.account_id AND blocks.hash=expired.hash
 `,[now,batchSize,accountId??null]);
 return result.rowCount??0;
}
