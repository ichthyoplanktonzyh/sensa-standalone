import {canonicalConsumerJson} from '@sensa/contracts/sensa';

import type {BackupRows} from '../backupValidation';
import type {LibraryIdentity,LibraryTransaction} from '../store';
import {planLibraryReplicaApply,replicaEntryId,restoreLibraryReplicaValue,type LibraryReplicaEntry} from './libraryReplica';

const LIBRARY_CREATE_OPERATION='00000000-0000-4000-8000-000000000001';

/** Apply one already-validated convergence plan inside the caller's transaction. */
export function applyLibraryReplicaMutation(input:{
 tx:LibraryTransaction;
 current:LibraryReplicaEntry[];
 desired:LibraryReplicaEntry[];
 rows:BackupRows;
 identity:LibraryIdentity;
}){
 const {tx,current,desired,rows,identity}=input;
 const decoded=new Map<string,unknown>();
 for(const table of Object.keys(rows) as (keyof BackupRows)[]){
  for(const row of rows[table])decoded.set(replicaEntryId({table:table as LibraryReplicaEntry['table'],key:row.key}),row.value);
 }
 const mutation=planLibraryReplicaApply(current,desired);
 for(const row of mutation.deletes)tx.delete(row.table,row.key);
 let restoredIdentity:LibraryIdentity|undefined;
 for(const row of mutation.puts){
  const value=restoreLibraryReplicaValue(row,decoded.get(replicaEntryId(row)),identity);
  if(row.table==='meta'&&row.key==='identity')restoredIdentity=value as LibraryIdentity;
  tx.put(row.table,row.key,value);
 }
 if(restoredIdentity)tx.put('operations',LIBRARY_CREATE_OPERATION,{input:canonicalConsumerJson({kind:'library.create',input:{}}),result:restoredIdentity,committedAt:restoredIdentity.createdAt});
}

