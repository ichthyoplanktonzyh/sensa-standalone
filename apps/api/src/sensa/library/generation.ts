import type {DatabaseExecutor} from '../../database/core.js';
import {ConsumerError} from '../access/auth.js';
import {retireEmptyLibraryCloudOwners} from './membership.js';

export const libraryCloudDefaultGeneration='00000000-0000-0000-0000-000000000000';
export const libraryCloudCleanupRows=128;
export const libraryCloudCleanupPins=512;

/** Reserve the legacy generation; it cannot identify a private publication. */
export function requirePrivateLibraryGeneration(generation:string):void{
 if(generation.toLowerCase()===libraryCloudDefaultGeneration)throw new ConsumerError(400,'library_sync_operation_id');
}
/** PostgreSQL UUID columns and TEXT pin owners use the same canonical identity. */
export const libraryCloudRowOwner=(generation:string,table:string,key:string)=>JSON.stringify(
 generation.toLowerCase()===libraryCloudDefaultGeneration?[table,key]:[generation.toLowerCase(),table,key],
);
export const libraryCloudSnapshotOwner=(generation:string,revision:number)=>generation.toLowerCase()===libraryCloudDefaultGeneration
 ?String(revision):JSON.stringify([generation.toLowerCase(),revision]);

/** Retire only this stage's metadata, including its captured pre-canonical owner.
 * Callers hold the stage lock and prove it is private or its snapshot is retired. */
export async function retireLibraryStagingMetadata(db:DatabaseExecutor,id:string,generation:string,rawOwner:string):Promise<boolean>{
 const owners=[...new Set([generation.toLowerCase(),rawOwner])];
 await db.query(`WITH page AS(SELECT ctid FROM sensa_consumer.library_cloud_staging_rows WHERE account_id=$1 AND operation_id=$2 LIMIT $3 FOR UPDATE)
  DELETE FROM sensa_consumer.library_cloud_staging_rows r USING page WHERE r.ctid=page.ctid`,[id,generation,libraryCloudCleanupRows]);
 await db.query(`WITH page AS(SELECT ctid FROM sensa_consumer.library_cloud_staging_pages WHERE account_id=$1 AND operation_id=$2 LIMIT $3 FOR UPDATE)
  DELETE FROM sensa_consumer.library_cloud_staging_pages r USING page WHERE r.ctid=page.ctid`,[id,generation,libraryCloudCleanupRows]);
 await db.query(`WITH page AS(SELECT m.ctid FROM sensa_consumer.library_cloud_membership m
  JOIN sensa_consumer.library_cloud_owners o ON o.account_id=m.account_id AND o.id=m.owner_id
  WHERE m.account_id=$1 AND o.owner_kind='staging' AND o.owner=ANY($2::text[]) LIMIT $3 FOR UPDATE OF m)
  DELETE FROM sensa_consumer.library_cloud_membership m USING page WHERE m.ctid=page.ctid`,[id,owners,libraryCloudCleanupPins]);
 await retireEmptyLibraryCloudOwners(db,id,'staging',owners);
 return (await db.query(`SELECT NOT(
  EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_staging_rows WHERE account_id=$1 AND operation_id=$2) OR
  EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_staging_pages WHERE account_id=$1 AND operation_id=$2) OR
  EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_membership m JOIN sensa_consumer.library_cloud_owners o ON o.account_id=m.account_id AND o.id=m.owner_id
   WHERE m.account_id=$1 AND o.owner_kind='staging' AND o.owner=ANY($3::text[]))) AS complete`,[id,generation,owners])).rows[0].complete;
}

/** Caller holds this stage's lock through the outer transaction. One invocation
 * retires bounded actual pins/rows; the retained stage is the retry witness. */
export async function discardPreparedLibraryGeneration(db:DatabaseExecutor,id:string,generation:string,now=new Date()):Promise<{selected:boolean;complete:boolean}>{
 generation=generation.toLowerCase();
 const stage=(await db.query('SELECT descriptor,prepared_version,published_revision FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2 FOR UPDATE',[id,generation])).rows[0];
 const head=(await db.query('SELECT library_id,rows_generation,snapshot_generation FROM sensa_consumer.library_cloud WHERE account_id=$1',[id])).rows[0];
 const legacyDefaultStage=generation===libraryCloudDefaultGeneration&&stage?.prepared_version===0&&!head?.library_id;
 if(!legacyDefaultStage&&(head?.rows_generation===generation||head?.snapshot_generation===generation))return {selected:true,complete:false};
 // A superseded checkpoint can still be the source of an active reader or
 // another preparation. Published page/receipt witnesses have their own life.
 if(stage?.published_revision!==null&&stage?.published_revision!==undefined)return {selected:true,complete:false};
 if((await db.query('SELECT 1 FROM sensa_consumer.library_cloud_reads WHERE account_id=$1 AND snapshot_generation=$2 AND expires_at>$3 LIMIT 1',[id,generation,now])).rowCount)return {selected:true,complete:false};
 if(!stage)return {selected:false,complete:true};
 const rawOwner=String(stage.descriptor.operationId);if(rawOwner.toLowerCase()!==generation)throw new ConsumerError(409,'operation_conflict');
 await db.query('UPDATE sensa_consumer.library_cloud_staging SET retiring=true,expires_at=LEAST(expires_at,now()) WHERE account_id=$1 AND operation_id=$2',[id,generation]);
 const rows=legacyDefaultStage?[]:(await db.query('SELECT table_name,record_key FROM sensa_consumer.library_cloud_rows WHERE account_id=$1 AND generation=$2 ORDER BY table_name,record_key LIMIT $3',[id,generation,libraryCloudCleanupRows])).rows;
 if(rows.length){
  const owners=rows.flatMap(row=>[libraryCloudRowOwner(generation,row.table_name,row.record_key),JSON.stringify([rawOwner,row.table_name,row.record_key])]);
  await db.query(`WITH page AS(SELECT m.ctid FROM sensa_consumer.library_cloud_membership m
   JOIN sensa_consumer.library_cloud_owners o ON o.account_id=m.account_id AND o.id=m.owner_id
   WHERE m.account_id=$1 AND o.owner_kind='row' AND o.owner=ANY($2::text[]) LIMIT $3 FOR UPDATE OF m)
   DELETE FROM sensa_consumer.library_cloud_membership m USING page WHERE m.ctid=page.ctid`,[id,owners,libraryCloudCleanupPins]);
  await retireEmptyLibraryCloudOwners(db,id,'row',owners);
  await db.query(`DELETE FROM sensa_consumer.library_cloud_rows r USING jsonb_to_recordset($3::jsonb) p(table_name text,record_key text,owners jsonb)
   WHERE r.account_id=$1 AND r.generation=$2 AND r.table_name=p.table_name AND r.record_key=p.record_key
   AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_membership m JOIN sensa_consumer.library_cloud_owners o ON o.account_id=m.account_id AND o.id=m.owner_id
    WHERE m.account_id=$1 AND o.owner_kind='row' AND o.owner IN(SELECT jsonb_array_elements_text(p.owners)))`,[id,generation,JSON.stringify(rows.map(row=>({...row,owners:[libraryCloudRowOwner(generation,row.table_name,row.record_key),JSON.stringify([rawOwner,row.table_name,row.record_key])]})))]);
 }
 if(!legacyDefaultStage)await db.query(`WITH page AS(SELECT ctid FROM sensa_consumer.library_cloud_snapshots WHERE account_id=$1 AND generation=$2 LIMIT $3 FOR UPDATE)
  DELETE FROM sensa_consumer.library_cloud_snapshots r USING page WHERE r.ctid=page.ctid`,[id,generation,libraryCloudCleanupRows]);
 const metadataComplete=await retireLibraryStagingMetadata(db,id,generation,rawOwner);
 const complete=metadataComplete&&(legacyDefaultStage||(await db.query(`SELECT NOT(
  EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_rows WHERE account_id=$1 AND generation=$2) OR
  EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_snapshots WHERE account_id=$1 AND generation=$2)) AS complete`,[id,generation])).rows[0].complete);
 return {selected:false,complete};
}
