import {decodeBackupValue} from '../backupCodec';
import {validateBackupRows,type BackupRows} from '../backupValidation';
import {libraryTables} from '../store';
import {isReplicatedLibraryEntry,type LibraryReplicaEntry} from './libraryReplica';
/** Advance when the complete replica integrity contract changes. Device-only. */
export const libraryReplicaValidationVersion=1 as const;

/** Validate a complete candidate replica before transport publication or apply. */
export function validateLibraryReplica(entries:LibraryReplicaEntry[],packageCache:BackupRows['packageCache']=[]):BackupRows{
 const rows=Object.fromEntries(libraryTables.map(table=>[table,[]])) as unknown as BackupRows;
 for(const row of entries){
  if(!isReplicatedLibraryEntry(row.table,row.key))throw new Error('library_sync_format');
  rows[row.table].push({key:row.key,value:decodeBackupValue(row.value)});
 }
 const installationKeys=new Set(rows.packageInstallations.map(row=>row.key));
 rows.packageCache=packageCache.filter(row=>installationKeys.has(row.key)).map(row=>({key:row.key,value:row.value}));
 validateBackupRows(rows);
 return rows;
}
