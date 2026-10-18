import {pinLibraryCloudBlocks} from '../../../apps/api/src/sensa/library/membership';
import {createHash} from 'node:crypto';
import {libraryCloudSnapshotOwner} from '../../../apps/api/src/sensa/library/generation';
import type {Page} from '@playwright/test';
import {encodeLibrarySyncBinaryChunk,librarySyncBinaryChunkBytes} from '@sensa/contracts/sensa/library-sync-blocks';
import type {LibraryCloudBrowserFixture,LibraryCloudAccount} from './libraryCloudBrowserFixture.mts';

/** Historical v1 artifact fixture. Ordinary current publishers use refs only.
 * Attach a real bounded producer output to the already confirmed root so legacy
 * receiver tests keep exercising that format without restoring its old writer. */
export async function attachLegacyBinaryCheckpoint(f:LibraryCloudBrowserFixture,page:Page,account:LibraryCloudAccount){
 const snapshot=await page.evaluate(async()=>{
  const c=(window as any).core,source=await c.readLibrary(async(tx:any)=>({owner:await tx.get('meta','service-owner'),identity:await tx.get('meta','identity'),incarnation:await tx.get('meta','local-incarnation')??'initial',localRevision:await tx.get('meta','local-content-revision')??0}));
  const result=await(await c.sqliteRecordAdapter()).exportOwnCloudSnapshot(source);
  return {...result,bytes:Array.from(result.bytes) as number[]};
 });
 const bytes=new Uint8Array(snapshot.bytes),refs:string[]=[],blocks:Array<{hash:string;data:string}>=[];
 for(let at=0;at<bytes.length;at+=librarySyncBinaryChunkBytes){const data=await encodeLibrarySyncBinaryChunk(bytes.subarray(at,at+librarySyncBinaryChunkBytes)),hash=createHash('sha256').update(data).digest('hex');refs.push(hash);blocks.push({hash,data});}
 for(let at=0;at<blocks.length;at+=8){const response=await fetch(f.origin+'/sensa/library-sync/blocks/store',{method:'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json'},body:JSON.stringify({blocks:blocks.slice(at,at+8)})});if(!response.ok)throw Error('legacy binary fixture block storage failed');}
 const db=await f.pool.connect();try{
  await db.query('BEGIN');const head=(await db.query('SELECT * FROM sensa_consumer.library_cloud WHERE account_id=$1 FOR UPDATE',[account.accountId])).rows[0];
  if(!head||head.revision!==head.snapshot_revision||Number(head.revision)<1)throw Error('legacy binary fixture requires a confirmed current root');
  const artifact={sourceRevision:snapshot.sourceRevision,schemaVersion:snapshot.schemaVersion,sha256:snapshot.sha256,byteLength:bytes.length,blocks:refs,accountId:account.accountId,libraryId:head.library_id,learnerId:head.learner_id,revision:head.revision,records:head.record_count};
  await db.query('UPDATE sensa_consumer.library_cloud SET binary_snapshot=$2::jsonb WHERE account_id=$1',[account.accountId,JSON.stringify(artifact)]);
  await pinLibraryCloudBlocks(db,account.accountId,[{kind:'snapshot',owner:libraryCloudSnapshotOwner(head.snapshot_generation,head.snapshot_revision),hashes:refs}]);
  await db.query('COMMIT');
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
