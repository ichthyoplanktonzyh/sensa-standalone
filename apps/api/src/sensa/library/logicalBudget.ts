import {Buffer} from 'node:buffer';
import {librarySyncLogicalByteLimit} from '@sensa/contracts/sensa';
import {decodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
import type {DatabaseExecutor} from '../../database/core.js';
import {ConsumerError} from '../access/auth.js';

/** Authoritative block measurements, reused across bounded refs pages. Hashes
 * identify immutable stored payloads; callers hold the existing account lock. */
export async function measureLibraryRows(db:DatabaseExecutor,accountId:string,rows:readonly {blocks:readonly string[]}[]):Promise<number[]>{
 const hashes=[...new Set(rows.flatMap(row=>row.blocks))],sizes=new Map<string,number>();
 for(let at=0;at<hashes.length;at+=16){
  const wanted=hashes.slice(at,at+16),found=(await db.query('SELECT hash,logical_bytes,CASE WHEN logical_bytes IS NULL THEN data END AS data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[accountId,wanted])).rows;
  if(found.length!==wanted.length)throw new ConsumerError(409,'library_sync_missing_block');
  for(const block of found){
   let bytes=block.logical_bytes===null?undefined:Number(block.logical_bytes);
   if(bytes===undefined){try{bytes=Buffer.byteLength(decodeLibrarySyncBlock(block.data));}catch{throw new ConsumerError(400,'library_sync_format');}
    await db.query('UPDATE sensa_consumer.library_cloud_blocks SET logical_bytes=$3 WHERE account_id=$1 AND hash=$2 AND logical_bytes IS NULL',[accountId,block.hash,bytes]);
   }
   sizes.set(block.hash,bytes);
  }
 }
 return rows.map(row=>{const bytes=row.blocks.reduce((sum,hash)=>sum+sizes.get(hash)!,0);if(bytes>90*1024*1024)throw new ConsumerError(413,'library_sync_capacity');return bytes;});
}
/** A retained pre-counter head is measured once in keyset windows. No library
 * body or key inventory is materialized, and no fact/ref is rewritten. */
export async function currentLibraryLogicalBytes(db:DatabaseExecutor,accountId:string,head:Record<string,unknown>):Promise<number>{
 if(head.logical_bytes!==null&&head.logical_bytes!==undefined)return Number(head.logical_bytes);
 let total=0,table='',key='';
 for(;;){
  const rows=(await db.query('SELECT table_name,record_key,refs,logical_bytes FROM sensa_consumer.library_cloud_rows WHERE account_id=$1 AND(table_name COLLATE "C",record_key COLLATE "C")>($2::text COLLATE "C",$3::text COLLATE "C") ORDER BY table_name COLLATE "C",record_key COLLATE "C" LIMIT 16',[accountId,table,key])).rows;
  if(!rows.length)break;
  const sizes=await measureLibraryRows(db,accountId,rows.map(row=>({blocks:row.refs})));
  for(let at=0;at<rows.length;at++){const row=rows[at];total+=sizes[at];if(total>librarySyncLogicalByteLimit)throw new ConsumerError(413,'library_sync_capacity');await db.query('UPDATE sensa_consumer.library_cloud_rows SET logical_bytes=$4 WHERE account_id=$1 AND table_name=$2 AND record_key=$3',[accountId,row.table_name,row.record_key,sizes[at]]);}
  table=rows.at(-1)!.table_name;key=rows.at(-1)!.record_key;
 }
 return total;
}

/** Pre-counter staging stays resumable, with exact old rows measured before any
 * successor page or CAS can claim their aggregate budget. */
export async function stagingLibraryLogicalBytes(db:DatabaseExecutor,accountId:string,operationId:string,value:number|string|null):Promise<number>{
 if(value!==null)return Number(value);
 let total=0,table='',key='';
 for(;;){
  const rows=(await db.query('SELECT table_name,record_key,refs FROM sensa_consumer.library_cloud_staging_rows WHERE account_id=$1 AND operation_id=$2 AND(table_name COLLATE "C",record_key COLLATE "C")>($3::text COLLATE "C",$4::text COLLATE "C") ORDER BY table_name COLLATE "C",record_key COLLATE "C" LIMIT 16',[accountId,operationId,table,key])).rows;
  if(!rows.length)break;const sizes=await measureLibraryRows(db,accountId,rows.map(row=>({blocks:row.refs})));
  for(let at=0;at<rows.length;at++){const row=rows[at];total+=sizes[at];if(total>librarySyncLogicalByteLimit)throw new ConsumerError(413,'library_sync_capacity');await db.query('UPDATE sensa_consumer.library_cloud_staging_rows SET logical_bytes=$5 WHERE account_id=$1 AND operation_id=$2 AND table_name=$3 AND record_key=$4',[accountId,operationId,row.table_name,row.record_key,sizes[at]]);}
  table=rows.at(-1)!.table_name;key=rows.at(-1)!.record_key;
 }
 await db.query('UPDATE sensa_consumer.library_cloud_staging SET logical_bytes=$3 WHERE account_id=$1 AND operation_id=$2',[accountId,operationId,total]);return total;
}
