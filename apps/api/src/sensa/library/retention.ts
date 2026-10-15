import {librarySyncStoredByteLimit} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/index.js';
import {libraryCloudDefaultGeneration,discardPreparedLibraryGeneration,retireLibraryStagingMetadata} from './generation.js';

export const libraryCloudCapacityBytes=librarySyncStoredByteLimit;
export const libraryCloudUploadLeaseMs=24*60*60*1000;
export const libraryCloudReadLeaseMs=10*60*1000;
export const libraryCloudRetiredGraceMs=2*60*1000;

/** Explicit maintenance boundary. Production does not prune retained history
 * yet. A live fixed-upper-bound reader protects all its snapshot/tail owners;
 * receipts remain durable even after their log is retired. The caller must hold
 * one outer database transaction through pruning and any block collection. */
export async function pruneLibraryCloudHistory(db:DatabaseExecutor,accountId:string,now:Date):Promise<boolean>{
 const head=(await db.query('SELECT snapshot_revision,retention_floor,snapshot_generation,rows_generation FROM sensa_consumer.library_cloud WHERE account_id=$1 FOR UPDATE',[accountId])).rows[0];
 if(!head)return false;
 await db.query('DELETE FROM sensa_consumer.library_cloud_reads WHERE account_id=$1 AND expires_at<=$2',[accountId,now]);
 if((await db.query('SELECT 1 FROM sensa_consumer.library_cloud_reads WHERE account_id=$1 AND expires_at>$2 LIMIT 1',[accountId,now])).rowCount)return false;
 await db.query('DELETE FROM sensa_consumer.library_cloud_log WHERE account_id=$1 AND revision<=$2',[accountId,head.retention_floor]);
 await db.query('DELETE FROM sensa_consumer.library_cloud_snapshots WHERE account_id=$1 AND generation=$3 AND revision<$2',[accountId,head.snapshot_revision,head.snapshot_generation]);
 await db.query(`DELETE FROM sensa_consumer.library_cloud_membership WHERE account_id=$1 AND
  CASE WHEN owner_kind='log' THEN owner_id::integer<=$2
   WHEN owner_kind='snapshot' AND $4::uuid=$5::uuid THEN CASE WHEN owner_id~'^[0-9]+$' THEN owner_id::integer<$3 ELSE false END
   WHEN owner_kind='snapshot' THEN CASE WHEN owner_id LIKE $6 THEN (owner_id::jsonb->>1)::integer<$3 ELSE false END
   ELSE false END`,[accountId,head.retention_floor,head.snapshot_revision,head.snapshot_generation,libraryCloudDefaultGeneration,'["'+head.snapshot_generation+'",%']);
 // The original staged union pins its immutable initial snapshot. Release
 // that owner only under the same existing no-reader history boundary.
 const publishedStage=(await db.query('SELECT operation_id,descriptor FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2 FOR UPDATE',[accountId,head.rows_generation])).rows[0];
 if(publishedStage&&publishedStage.descriptor.baseRevision+1<head.snapshot_revision){
  await db.query('UPDATE sensa_consumer.library_cloud_staging SET retiring=true WHERE account_id=$1 AND operation_id=$2',[accountId,publishedStage.operation_id]);
  if(await retireLibraryStagingMetadata(db,accountId,publishedStage.operation_id,String(publishedStage.descriptor.operationId)))await db.query('DELETE FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[accountId,publishedStage.operation_id]);
 }
 return true;
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
 const stages=(await db.query(`SELECT stage.account_id,stage.operation_id FROM sensa_consumer.library_cloud_staging stage
  WHERE stage.expires_at<=$1 AND ($2::text IS NULL OR stage.account_id=$2)
  AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud head WHERE head.account_id=stage.account_id AND (head.rows_generation=stage.operation_id OR head.snapshot_generation=stage.operation_id)
   AND NOT(stage.operation_id='00000000-0000-0000-0000-000000000000' AND stage.prepared_version=0 AND head.library_id IS NULL))
  LIMIT $3 FOR UPDATE OF stage SKIP LOCKED`,[now,accountId??null,1])).rows;
 for(const stage of stages){
  const cleanup=await discardPreparedLibraryGeneration(db,stage.account_id,stage.operation_id);
  if(cleanup.complete)await db.query('DELETE FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[stage.account_id,stage.operation_id]);
 }
 await db.query("DELETE FROM sensa_consumer.library_cloud_block_refs WHERE reference_kind='retired' AND expires_at<=$1 AND ($2::text IS NULL OR account_id=$2)",[now,accountId??null]);
 await db.query('DELETE FROM sensa_consumer.library_cloud_reads WHERE expires_at<=$1 AND ($2::text IS NULL OR account_id=$2)',[now,accountId??null]);
 await db.query('DELETE FROM sensa_consumer.library_cloud_snapshot_leases WHERE expires_at<=$1 AND ($2::text IS NULL OR account_id=$2)',[now,accountId??null]);
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
