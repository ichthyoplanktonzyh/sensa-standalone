import {librarySyncMetadataPageRows,librarySyncMetadataPageRefs,librarySyncMetadataPageBytes} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/core.js';
import {ConsumerError} from '../access/auth.js';

type Row=Record<string,any>;
type Key={table:string;key:string}|null;
type Position={revision:number;offset:number};

/** Selects a metadata window before loading its ordered refs. */
export function selectLibraryMetadataPage(rows:Row[],limit=librarySyncMetadataPageRows,refLimit=librarySyncMetadataPageRefs){
 const selected:Row[]=[];let bytes=0,refs=0;
 for(const row of rows){const size=Number(row.bytes),count=Number(row.ref_count);
  if(selected.length&&(selected.length===limit||bytes+size>librarySyncMetadataPageBytes-32*1024||refs+count>refLimit))break;
  if(size>librarySyncMetadataPageBytes||count>librarySyncMetadataPageRefs)throw new ConsumerError(409,'library_sync_capacity');
  selected.push(row);bytes+=size;refs+=count;
 }
 return selected;
}

/** Reads an immutable generation using the same bounds as restore paging. */
export async function readLibrarySnapshotPage(db:DatabaseExecutor,id:string,revision:number,generation:string,after:Key,limit=librarySyncMetadataPageRows,refs=librarySyncMetadataPageRefs){
 const args=[id,revision,after?.table??null,after?.key??null,limit+1,generation];
 const raw=(await db.query(`SELECT table_name,record_key,jsonb_array_length(refs) AS ref_count,octet_length(refs::text)+octet_length(to_json(table_name)::text)+octet_length(to_json(record_key)::text)+64 AS bytes
  FROM sensa_consumer.library_cloud_snapshots WHERE account_id=$1 AND revision=$2 AND generation=$6
  AND ($3::text IS NULL OR (table_name COLLATE "C",record_key COLLATE "C")>($3::text COLLATE "C",$4::text COLLATE "C"))
  ORDER BY table_name COLLATE "C",record_key COLLATE "C" LIMIT $5`,args)).rows;
 const selected=selectLibraryMetadataPage(raw,limit,refs),last=selected.at(-1);
 const rows=selected.length?(await db.query(`SELECT table_name,record_key,refs FROM sensa_consumer.library_cloud_snapshots
  WHERE account_id=$1 AND revision=$2 AND generation=$6
  AND ($3::text IS NULL OR (table_name COLLATE "C",record_key COLLATE "C")>($3::text COLLATE "C",$4::text COLLATE "C"))
  ORDER BY table_name COLLATE "C",record_key COLLATE "C" LIMIT $5`,[...args.slice(0,4),selected.length,generation])).rows:[];
 return {rows,next:last?{table:last.table_name as string,key:last.record_key as string}:after,done:selected.length===raw.length};
}

/** Reads one contiguous tail window, including deletions and repeated keys. */
export async function readLibraryTailPage(db:DatabaseExecutor,id:string,after:Position,to:number,limit=librarySyncMetadataPageRows,refs=librarySyncMetadataPageRefs){
 if(after.revision===to)return {rows:[] as Row[],next:after,done:true};
 const raw=(await db.query(`SELECT ordinal,table_name,record_key,COALESCE(jsonb_array_length(refs),0) AS ref_count,
  COALESCE(octet_length(refs::text),4)+octet_length(to_json(table_name)::text)+octet_length(to_json(record_key)::text)+64 AS bytes
  FROM sensa_consumer.library_cloud_log WHERE account_id=$1 AND revision=$2 AND ordinal>=$3 ORDER BY ordinal LIMIT $4`,[id,after.revision+1,after.offset,limit+1])).rows;
 if(!raw.length||raw[0].ordinal!==after.offset)throw new ConsumerError(409,'library_sync_snapshot_required');
 const selected=selectLibraryMetadataPage(raw,limit,refs);
 if(selected.some((row,i)=>row.ordinal!==after.offset+i))throw new ConsumerError(409,'library_sync_cursor');
 const rows=(await db.query('SELECT ordinal,table_name,record_key,refs FROM sensa_consumer.library_cloud_log WHERE account_id=$1 AND revision=$2 AND ordinal>=$3 AND ordinal<$4 ORDER BY ordinal',[id,after.revision+1,after.offset,after.offset+selected.length])).rows;
 const next=selected.length===raw.length?{revision:after.revision+1,offset:0}:{revision:after.revision,offset:after.offset+selected.length};
 return {rows,next,done:next.revision===to};
}
