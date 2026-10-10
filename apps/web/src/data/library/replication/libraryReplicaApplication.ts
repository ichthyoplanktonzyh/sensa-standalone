import {canonicalConsumerJson} from '@sensa/contracts/sensa';

import type {LibraryRecordReader} from '../libraryRecordReader';
import type {LibraryIdentity,LibraryTransaction} from '../store';
import {planLibraryReplicaApply,restoreLibraryReplicaValue,type LibraryReplicaEntry} from './libraryReplica';

const LIBRARY_CREATE_OPERATION='00000000-0000-4000-8000-000000000001';

/** Apply one already-validated convergence plan inside the caller's transaction. */
export function applyLibraryReplicaMutation(input:{
 tx:LibraryTransaction;
 current:LibraryReplicaEntry[];
 desired:LibraryReplicaEntry[];
 records:LibraryRecordReader;
 identity:LibraryIdentity;
}){
 const {tx,current,desired,records,identity}=input;
 const mutation=planLibraryReplicaApply(current,desired);
 for(const row of mutation.deletes)tx.delete(row.table,row.key);
 let restoredIdentity:LibraryIdentity|undefined;
 for(const row of mutation.puts){
  if(!records.has(row.table,row.key))throw Error('libraryBackup.errors.inconsistent');
  const value=restoreLibraryReplicaValue(row,records.get(row.table,row.key),identity);
  if(row.table==='meta'&&row.key==='identity')restoredIdentity=value as LibraryIdentity;
  tx.put(row.table,row.key,value);
 }
 if(restoredIdentity)tx.put('operations',LIBRARY_CREATE_OPERATION,{input:canonicalConsumerJson({kind:'library.create',input:{}}),result:restoredIdentity,committedAt:restoredIdentity.createdAt});
}
