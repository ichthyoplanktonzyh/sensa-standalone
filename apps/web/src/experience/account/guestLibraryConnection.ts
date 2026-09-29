import {z} from 'zod';
import {librarySyncHead,librarySyncTables} from '@sensa/contracts/sensa';
import {readLibrary,type LibraryTransaction} from '../../data/library/store';
import {isReplicatedLibraryEntry} from '../../data/library/replication/libraryReplica';

export async function hasGuestLibraryContent(tx:LibraryTransaction){
 for(const table of librarySyncTables)for(const row of await tx.entries(table))if(isReplicatedLibraryEntry(table,row.key)&&!(table==='meta'&&row.key==='identity'))return true;
 return false;
}

/** Check both libraries before an account can take ownership of a guest library. */
export async function preflightGuestLibrary(endpoint:string,token:string,installationId:string){
 const base=endpoint.replace(/\/+$/,'');
 const accessResponse=await fetch(base+'/sensa/web/access/session',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({installationId}),signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!accessResponse.ok)return {kind:'access-failed' as const,status:accessResponse.status};
 const access=z.object({
  authorized:z.literal(true),
  accountId:z.string().uuid(),
  capabilities:z.object({publishLearningContent:z.boolean()}).optional(),
 }).parse(await accessResponse.json());
 const headResponse=await fetch(base+'/sensa/library-sync/head',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000),redirect:'error',cache:'no-store'});
 if(!headResponse.ok)return {kind:'head-failed' as const};
 const head=librarySyncHead.parse(await headResponse.json());
 const hasContent=await readLibrary(hasGuestLibraryContent);
 return {
  kind:'ready' as const,
  accountId:access.accountId,
  publisherAccess:access.capabilities?.publishLearningContent??false,
  cloudHasContent:head.manifest!==null,
  localHasContent:hasContent,
 };
}
