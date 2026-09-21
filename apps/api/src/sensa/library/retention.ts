import type {DatabaseExecutor} from '../../database/index.js';

export const libraryCloudCapacityBytes=256*1024*1024;
export const libraryCloudUploadLeaseMs=24*60*60*1000;
export const libraryCloudReadLeaseMs=10*60*1000;
export const libraryCloudRetiredGraceMs=2*60*1000;

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
 await db.query("DELETE FROM sensa_consumer.library_cloud_block_refs WHERE reference_kind='retired' AND expires_at<=$1 AND ($2::text IS NULL OR account_id=$2)",[now,accountId??null]);
 await db.query('DELETE FROM sensa_consumer.library_cloud_snapshot_leases WHERE expires_at<=$1 AND ($2::text IS NULL OR account_id=$2)',[now,accountId??null]);
 const result=await db.query(`
  WITH expired AS (
   SELECT blocks.account_id,blocks.hash
   FROM sensa_consumer.library_cloud_blocks AS blocks
   WHERE blocks.upload_lease_expires_at<=$1
    AND ($3::text IS NULL OR blocks.account_id=$3)
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
