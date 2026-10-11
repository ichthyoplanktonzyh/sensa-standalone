import {decodeBackupValue} from '../backupCodec';
import {validateLibraryRecords,validateLibraryRecordsCooperatively,type BackupRows} from '../backupValidation';
import {sqliteLibraryTables} from '../sqliteProtocol';
import type {LibraryRecordReader} from '../libraryRecordReader';
import type {LibraryIdentity,Table} from '../store';
import {isReplicatedLibraryEntry,type LibraryReplicaEntry} from './libraryReplica';
/** Advance when the complete replica integrity contract changes. Device-only. */
export const libraryReplicaValidationVersion=8 as const;

export type ValidatedLibraryReplica={identity:LibraryIdentity;records:LibraryRecordReader};

/** Validate a complete candidate replica before transport publication or apply. */
function replicaRecords(entries:LibraryReplicaEntry[],packageCache:BackupRows['packageCache']):LibraryRecordReader{
 const index=new Map<Table,Map<string,LibraryReplicaEntry>>(sqliteLibraryTables.map(table=>[table,new Map()]));
 for(const row of entries){
  if(!isReplicatedLibraryEntry(row.table,row.key))throw new Error('library_sync_format');
  const table=index.get(row.table)!;
  if(typeof row.key!=='string'||row.key.length===0||row.key.length>2000||table.has(row.key))throw Error('libraryBackup.errors.inconsistent');
  table.set(row.key,row);
 }
 const cache=new Map<string,BackupRows['packageCache'][number]>();
 for(const row of packageCache)if(index.get('packageInstallations')!.has(row.key)){
  if(cache.has(row.key))throw Error('libraryBackup.errors.inconsistent');cache.set(row.key,row);
 }
 const records:LibraryRecordReader={
  get(table,key){if(table==='packageCache')return cache.get(key)?.value;const row=index.get(table)!.get(key);return row?decodeBackupValue(row.value):undefined;},
  has:(table,key)=>table==='packageCache'?cache.has(key):index.get(table)!.has(key),
  *entries(table){if(table==='packageCache'){yield*cache.values();return;}for(const row of index.get(table)!.values())yield {key:row.key,value:decodeBackupValue(row.value)};},
 };
 return records;
}

export function validateLibraryReplica(entries:LibraryReplicaEntry[],packageCache:BackupRows['packageCache']=[]):ValidatedLibraryReplica{
 const records=replicaRecords(entries,packageCache);return {identity:validateLibraryRecords(records),records};
}
export async function validateLibraryReplicaCooperatively(entries:LibraryReplicaEntry[],packageCache:BackupRows['packageCache']=[]):Promise<ValidatedLibraryReplica>{
 const records=replicaRecords(entries,packageCache);return {identity:await validateLibraryRecordsCooperatively(records),records};
}
