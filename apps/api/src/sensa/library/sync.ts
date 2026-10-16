import {measureLibraryRows,currentLibraryLogicalBytes} from './logicalBudget.js';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import type {Hono} from 'hono';
import type {DatabaseExecutor} from '../../database/core.js';
import {librarySyncLogicalByteLimit,librarySyncRecordLimit,librarySyncHash,librarySyncStageBegin,librarySyncPatch,librarySyncPull,librarySyncSnapshotPage,librarySyncMetadataPageBytes,librarySyncCommit,librarySyncManifest,librarySyncBlockFetch,librarySyncBlockFetchBytes,librarySyncBlockMissing,librarySyncBlockStore,librarySyncBlockStoreChars,librarySyncBlockStoreBytes,type LibrarySyncManifest} from '@sensa/contracts/sensa';
import {decodeLibrarySyncBlock,decodeLibrarySyncBinaryChunk} from '@sensa/contracts/sensa/library-sync-blocks';
import {ConsumerError} from '../access/auth.js';
import {pinLibraryCloudBlocks,retireEmptyLibraryCloudOwners} from './membership.js';
import {libraryCloudCapacityBytes,libraryCloudReadLeaseMs,libraryCloudUploadLeaseMs,pruneLibraryCloudHistory,pruneLibraryPrivateGeneration,purgeExpiredLibraryCloudBlocks} from './retention.js';
import {beginInitialPublication,appendInitialPublication,commitInitialPublication,discardInitialPublication} from './initialPublication.js';
import {libraryCloudRowOwner,libraryCloudSnapshotOwner} from './generation.js';
import {readLibrarySnapshotPage,readLibraryTailPage} from './pages.js';
import {ensureLibraryCheckpoint,advanceLibraryCheckpoint} from './checkpointPreparation.js';
import {librarySyncCompact,librarySyncNativeFormat,librarySyncCheckpointProtocol} from '@sensa/contracts/sensa';
type Access=<T>(request:Request,work:(db:DatabaseExecutor,a:{accountId:string;installationId?:string;now?:Date})=>Promise<T>)=>Promise<T>;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const pagedCheckpoint=(request:Request)=>request.headers.get('x-sensa-sync-protocol')===librarySyncCheckpointProtocol;
// Older open bundles parse heads strictly, including durable receipt replays.
const negotiatedHead=(value:any,request:Request)=>{if(!value||pagedCheckpoint(request))return value;const {preparation,checkpointDue,...head}=value;return head;};
const conflict=(code='library_sync_conflict')=>new ConsumerError(409,code);
export function registerLibrarySync(app:Hono,access:Access,storagePolicy:{capacityBytes:number}={capacityBytes:libraryCloudCapacityBytes}){
 const capacityBytes=storagePolicy.capacityBytes;if(!Number.isSafeInteger(capacityBytes)||capacityBytes<1)throw Error('library_sync_storage_policy');
 app.use('/sensa/library-sync/*',async(c,next)=>{c.header('Cache-Control','no-store');await next();});
 const use:Access=(request,work)=>access(request,(db,a)=>{if(a.installationId)throw new ConsumerError(403,'web_authorization_required');return work(db,a);});
 const current=async(db:DatabaseExecutor,id:string)=>{await db.query('INSERT INTO sensa_consumer.library_cloud(account_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);return (await db.query('SELECT * FROM sensa_consumer.library_cloud WHERE account_id=$1 FOR UPDATE',[id])).rows[0]!;};
 const storage=async(db:DatabaseExecutor,id:string)=>{const usage=(await db.query('SELECT COALESCE(sum(octet_length(data)),0)::bigint n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[id])).rows[0];return {usedBytes:Number(usage.n),capacityBytes};};
 app.post('/sensa/library-sync/staging/begin',async c=>{const input=await c.req.json();return c.json(await use(c.req.raw,async(db,a)=>beginInitialPublication(db,a.accountId,await current(db,a.accountId),input,a.now??new Date())));});
 app.post('/sensa/library-sync/staging/page',async c=>{const input=await c.req.json();return c.json(await use(c.req.raw,async(db,a)=>appendInitialPublication(db,a.accountId,await current(db,a.accountId),input,a.now??new Date())));});
 app.post('/sensa/library-sync/staging/discard',async c=>{const input=librarySyncStageBegin.pick({operationId:true}).parse(await c.req.json());return c.json(await use(c.req.raw,async(db,a)=>{const currentHead=await current(db,a.accountId);const receipt=(await db.query('SELECT result FROM sensa_consumer.library_cloud_commits WHERE account_id=$1 AND operation_id=$2',[a.accountId,input.operationId])).rows[0];if(receipt)return {head:negotiatedHead(receipt.result,c.req.raw),currentRevision:currentHead.revision};await discardInitialPublication(db,a.accountId,input.operationId);return {head:null,currentRevision:currentHead.revision};}));});
 app.get('/sensa/library-sync/receipt/:id',async c=>c.json(await use(c.req.raw,async(db,a)=>{const id=librarySyncStageBegin.shape.operationId.parse(c.req.param('id'));const currentHead=await current(db,a.accountId);return {currentRevision:currentHead.revision,head:negotiatedHead((await db.query('SELECT result FROM sensa_consumer.library_cloud_commits WHERE account_id=$1 AND operation_id=$2',[a.accountId,id])).rows[0]?.result??null,c.req.raw)};})));
 async function metadataText(db:DatabaseExecutor,id:string,refs:string[],limit:number):Promise<string>{
  const parts:string[]=[];let bytes=0;
  for(let at=0;at<refs.length;at+=16){const page=refs.slice(at,at+16),rows=(await db.query('SELECT hash,data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[id,page])).rows,byHash=new Map(rows.map(row=>[row.hash,row.data]));
   for(const ref of page){const data=byHash.get(ref);if(data===undefined)throw conflict('library_sync_missing_block');let part:string;try{part=decodeLibrarySyncBlock(data);}catch{throw new ConsumerError(400,'library_sync_format');}bytes+=Buffer.byteLength(part);if(bytes>limit)throw new ConsumerError(413,'library_sync_capacity');parts.push(part);}
  }
  return parts.join('');
 }
 async function manifest(db:DatabaseExecutor,id:string,refs:string[]):Promise<LibrarySyncManifest>{
  const value=JSON.parse(await metadataText(db,id,refs,64*1024*1024));
  if(value?.version!==8)throw conflict('library_sync_incompatible_checkpoint');return librarySyncManifest.parse(value);
 }
 app.get('/sensa/library-sync/head',async c=>c.json(await use(c.req.raw,async(db,a)=>{
  const now=a.now??new Date(),head=await current(db,a.accountId),leaseUntil=new Date(now.getTime()+libraryCloudReadLeaseMs);
  await pruneLibraryCloudHistory(db,a.accountId,now);
  if(head.library_id)await pruneLibraryPrivateGeneration(db,a.accountId,now);
  await db.query(`INSERT INTO sensa_consumer.library_cloud_snapshot_leases(account_id,revision,expires_at) VALUES($1,$2,$3)
   ON CONFLICT(account_id,revision) DO UPDATE SET expires_at=GREATEST(sensa_consumer.library_cloud_snapshot_leases.expires_at,EXCLUDED.expires_at)`,[a.accountId,head.revision,leaseUntil]);
 const preparation=pagedCheckpoint(c.req.raw)?await ensureLibraryCheckpoint(db,a.accountId,head,now,head.snapshot_revision<head.revision&&(Number(head.tail_bytes)>=4*1024*1024||head.tail_commits>=128||head.snapshot_revision===0)):undefined;
  const readLease=crypto.randomUUID();await db.query('INSERT INTO sensa_consumer.library_cloud_reads(account_id,id,from_revision,to_revision,snapshot_revision,expires_at,snapshot_generation) VALUES($1,$2,$3,$4,$5,$6,$7)',[a.accountId,readLease,head.retention_floor,head.revision,head.snapshot_revision,leaseUntil,head.snapshot_generation]);return {...descriptor(head,c.req.header('x-sensa-snapshot-format')===librarySyncNativeFormat),readLease,storage:await storage(db,a.accountId),...(preparation?{preparation}:{})};
 })));
 app.post('/sensa/library-sync/blocks/missing',async c=>{const input=librarySyncBlockMissing.parse(await c.req.json());return c.json(await use(c.req.raw,async(db,a)=>{await current(db,a.accountId);const now=a.now??new Date(),leaseUntil=new Date(now.getTime()+libraryCloudUploadLeaseMs);const found=(await db.query('SELECT hash FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,input.hashes])).rows;const have=new Set(found.map(r=>r.hash));if(found.length)await db.query('UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=GREATEST(upload_lease_expires_at,$3) WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,[...have],leaseUntil]);return {missing:input.hashes.filter(h=>!have.has(h))};}));});
 // Restore reads one bounded page of blocks per request, so a first download is a
 // handful of round trips instead of one HTTP request per content-addressed block.
 app.post('/sensa/library-sync/blocks/fetch',async c=>{const input=librarySyncBlockFetch.parse(await c.req.json());return c.json(await use(c.req.raw,async(db,a)=>{
  // Select the page from inexpensive lengths before loading block bodies. Otherwise a
  // 512-hash request could materialize roughly 128 MiB just to return a 4 MiB page.
  const measured=(await db.query('SELECT hash,octet_length(data)::int bytes FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,input.hashes])).rows;
  const sizes=new Map(measured.map(r=>[r.hash as string,Number(r.bytes)]));
  // A restore is bounded by bytes per response, so a library stored as many small
  // blocks (an older client) costs the same number of round trips as a packed one.
  const selected:string[]=[],missing:string[]=[],deferred:string[]=[];let bytes=0;
  for(const hash of input.hashes){const size=sizes.get(hash);if(size===undefined){missing.push(hash);continue;}if(selected.length&&bytes+size>librarySyncBlockFetchBytes){deferred.push(hash);continue;}selected.push(hash);bytes+=size;}
  const rows=selected.length?(await db.query('SELECT hash,data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,selected])).rows:[];
  const byHash=new Map(rows.map(r=>[r.hash as string,r.data as string]));
  if(selected.some(hash=>!byHash.has(hash)))throw conflict('library_sync_missing_block');
  const blocks=selected.map(hash=>({hash,data:byHash.get(hash)!}));
  // Omit an empty deferred page so an already-open client using the previous strict
  // response schema can keep syncing while the Web and API release rolls forward.
  return deferred.length?{blocks,missing,deferred}:{blocks,missing};}));});
 app.post('/sensa/library-sync/blocks/store',async c=>{const input=librarySyncBlockStore.parse(await c.req.json());if(Buffer.byteLength(JSON.stringify(input))>librarySyncBlockStoreBytes||input.blocks.reduce((total,block)=>total+block.data.length,0)>librarySyncBlockStoreChars)throw new ConsumerError(413,'body_too_large');for(const block of input.blocks)if(hash(block.data)!==block.hash)throw new ConsumerError(400,'library_sync_hash');const blocks=[...new Map(input.blocks.map(block=>[block.hash,block])).values()];return c.json(await use(c.req.raw,async(db,a)=>{const logical=new Map<string,number>();for(const block of blocks){try{logical.set(block.hash,Buffer.byteLength(decodeLibrarySyncBlock(block.data)));}catch{throw new ConsumerError(400,'library_sync_format');}}await current(db,a.accountId);const now=a.now??new Date(),leaseUntil=new Date(now.getTime()+libraryCloudUploadLeaseMs);
  // Reclaim expired orphan uploads before enforcing the bounded account budget.
  await purgeExpiredLibraryCloudBlocks(db,now,1_000,a.accountId);
  const hashes=blocks.map(b=>b.hash);
  const stored=new Map((await db.query('SELECT hash,data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,hashes])).rows.map(r=>[r.hash as string,r.data as string]));
  for(const block of blocks)if(stored.has(block.hash)&&stored.get(block.hash)!==block.data)throw conflict();
  if(stored.size)await db.query('UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=GREATEST(upload_lease_expires_at,$3) WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,[...stored.keys()],leaseUntil]);
  const added=blocks.filter(b=>!stored.has(b.hash)).reduce((total,b)=>total+Buffer.byteLength(b.data),0);
  if(added>0){
   // Bounded storage guard, not a product subscription quota. Includes unattached retry blocks.
   const usage=(await db.query('SELECT COALESCE(sum(octet_length(data)),0)::bigint n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[a.accountId])).rows[0];if(Number(usage.n)+added>capacityBytes)throw new ConsumerError(413,'library_sync_capacity');
   // The route already admits one bounded, deduplicated batch. Store it in a
   // single statement under the same account lock and outer transaction.
   await db.query(`INSERT INTO sensa_consumer.library_cloud_blocks(account_id,hash,data,created_at,upload_lease_expires_at,logical_bytes)
    SELECT $1,b.hash,b.data,$3,$4,b.logical_bytes FROM jsonb_to_recordset($2::jsonb) AS b(hash text,data text,logical_bytes bigint)`,[a.accountId,JSON.stringify(blocks.filter(block=>!stored.has(block.hash)).map(block=>({...block,logical_bytes:logical.get(block.hash)!}))),now,leaseUntil]);
  }
  return {stored:true};}));});
 app.get('/sensa/library-sync/blocks/:hash',async c=>c.json(await use(c.req.raw,async(db,a)=>{const key=librarySyncHash.parse(c.req.param('hash'));const row=(await db.query('SELECT data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[a.accountId,key])).rows[0];if(!row)throw new ConsumerError(404,'library_sync_missing_block');return {hash:key,data:row.data};})));
 const descriptor=(head:Record<string,any>,native=false)=>{
  if(head.manifest&&!head.library_id)throw conflict('library_sync_incompatible_checkpoint');
  return {revision:head.revision,manifest:head.library_id?{libraryId:head.library_id,learnerId:head.learner_id,snapshotRevision:head.snapshot_revision,floor:head.retention_floor,records:head.record_count}:null,...(head.binary_snapshot?.revision===head.snapshot_revision?{binarySnapshot:head.binary_snapshot}:{}),...(native&&head.native_snapshot?.revision===head.snapshot_revision?{nativeSnapshot:head.native_snapshot}:{}),...(head.checkpointDue?{checkpointDue:true}:{})};
 };
 const readLease=async(db:DatabaseExecutor,id:string,token:string|undefined,now:Date)=>token?(await db.query('SELECT from_revision,to_revision,snapshot_revision,snapshot_generation FROM sensa_consumer.library_cloud_reads WHERE account_id=$1 AND id=$2 AND expires_at>$3',[id,token,now])).rows[0]:undefined;
 app.post('/sensa/library-sync/pull',async c=>{const input=librarySyncPull.parse(await c.req.json());return c.json(await use(c.req.raw,async(db,a)=>{
  const head=await current(db,a.accountId),now=a.now??new Date();descriptor(head);
  if(input.toRevision>head.revision||input.after.revision>input.toRevision||input.after.revision===input.toRevision&&input.after.offset!==0)throw conflict('library_sync_cursor');
  const reader=await readLease(db,a.accountId,input.readLease,now);if(!reader)throw conflict('library_sync_snapshot_required');if(reader.to_revision!==input.toRevision)throw conflict('library_sync_cursor');if(input.after.revision<head.retention_floor&&reader.from_revision>input.after.revision)throw conflict('library_sync_snapshot_required');
  if(input.after.revision===input.toRevision)return {from:input.after,next:input.after,toRevision:input.toRevision,changes:[],done:true};
  const part=await readLibraryTailPage(db,a.accountId,input.after,input.toRevision);
  return {from:input.after,next:part.next,toRevision:input.toRevision,changes:part.rows.map(row=>({table:row.table_name,key:row.record_key,blocks:row.refs})),done:part.done};
 }));});
 app.post('/sensa/library-sync/snapshot',async c=>{const input=librarySyncSnapshotPage.parse(await c.req.json());return c.json(await use(c.req.raw,async(db,a)=>{
  const head=await current(db,a.accountId),now=a.now??new Date();descriptor(head);
  const reader=await readLease(db,a.accountId,input.readLease,now);if(!reader||reader.snapshot_revision!==input.snapshotRevision)throw conflict('library_sync_snapshot_required');
  const part=await readLibrarySnapshotPage(db,a.accountId,input.snapshotRevision,reader.snapshot_generation,input.after);
  return {snapshotRevision:input.snapshotRevision,after:input.after,next:part.next,rows:part.rows.map(row=>({table:row.table_name,key:row.record_key,blocks:row.refs})),done:part.done};
 }));});
 app.post('/sensa/library-sync/compact',async c=>{const input=librarySyncCompact.parse(await c.req.json());const result=await use(c.req.raw,async(db,a)=>{
  if(!pagedCheckpoint(c.req.raw))throw conflict('library_sync_checkpoint_upgrade_required');
  const head=await current(db,a.accountId),now=a.now??new Date();descriptor(head);
  await pruneLibraryCloudHistory(db,a.accountId,now);
  if(head.library_id)await pruneLibraryPrivateGeneration(db,a.accountId,now);
  return advanceLibraryCheckpoint(db,a.accountId,head,input,now,value=>descriptor(value,c.req.header('x-sensa-snapshot-format')===librarySyncNativeFormat));
 });return c.json(result,result.code==='library_sync_capacity'?413:200);});
 const recordDigest=async(db:DatabaseExecutor,id:string,refs:string[])=>{
  const digest=createHash('sha256');let bytes=0;
  for(let at=0;at<refs.length;at+=16){const part=refs.slice(at,at+16),rows=(await db.query('SELECT hash,data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[id,part])).rows,blocks=new Map(rows.map(row=>[row.hash,row.data]));
   for(const ref of part){const data=blocks.get(ref);if(data===undefined)throw conflict('library_sync_missing_block');let plain:string;try{plain=decodeLibrarySyncBlock(data);}catch{throw new ConsumerError(400,'library_sync_format');}bytes+=Buffer.byteLength(plain);if(bytes>90*1024*1024)throw new ConsumerError(413,'library_sync_capacity');digest.update(plain);}
  }
  return digest.digest('hex');
 };
 app.post('/sensa/library-sync/commit',async c=>{const input=librarySyncCommit.parse(await c.req.json()),digest=hash(JSON.stringify(input));return c.json(negotiatedHead(await use(c.req.raw,async(db,a)=>{
  const head=await current(db,a.accountId);
  const prior=(await db.query('SELECT request_digest,result FROM sensa_consumer.library_cloud_commits WHERE account_id=$1 AND operation_id=$2',[a.accountId,input.operationId])).rows[0];
  if(prior){if(prior.request_digest!==digest)throw conflict('operation_conflict');if(!prior.result)throw conflict('library_sync_incompatible_checkpoint');return prior.result;}
  descriptor(head);if(head.revision!==input.baseRevision)throw conflict();if(head.revision>=2147483646)throw conflict('library_sync_capacity');
  if('staging' in input){
   const next=await commitInitialPublication(db,a.accountId,head,input,a.now??new Date());
   let binarySnapshot:unknown;
   if(input.staging.binary){
    const artifact=input.staging.binary,fileHash=createHash('sha256');let bytes=0;
    // Only bounded block windows are decoded. The account quota also includes
    // these bytes; an artifact is pinned only by this same final CAS transaction.
    for(let at=0;at<artifact.blocks.length;at+=16){
     const refs=artifact.blocks.slice(at,at+16),found=(await db.query('SELECT hash,data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,refs])).rows,blocks=new Map(found.map(row=>[row.hash,row.data]));
     for(const ref of refs){const data=blocks.get(ref);if(data===undefined)throw conflict('library_sync_missing_block');let chunk:Uint8Array;try{chunk=decodeLibrarySyncBinaryChunk(data);}catch{throw new ConsumerError(400,'library_sync_format');}bytes+=chunk.length;if(bytes>artifact.byteLength)throw new ConsumerError(413,'library_sync_capacity');fileHash.update(chunk);}
    }
    if(bytes!==artifact.byteLength||fileHash.digest('hex')!==artifact.sha256)throw new ConsumerError(400,'library_sync_hash');
    binarySnapshot={...artifact,accountId:a.accountId,libraryId:next.libraryId,learnerId:next.learnerId,revision:next.revision,records:next.records};
    await db.query('UPDATE sensa_consumer.library_cloud SET binary_snapshot=$2::jsonb WHERE account_id=$1',[a.accountId,JSON.stringify(binarySnapshot)]);
    await pinLibraryCloudBlocks(db,a.accountId,[{kind:'snapshot',owner:libraryCloudSnapshotOwner(input.operationId,next.revision),hashes:artifact.blocks}]);
   }
   const result={receipt:{operationId:input.operationId,requestDigest:digest},...descriptor({...head,revision:next.revision,library_id:next.libraryId,learner_id:next.learnerId,record_count:next.records,snapshot_revision:next.revision,retention_floor:next.revision,binary_snapshot:binarySnapshot}),storage:await storage(db,a.accountId)};
   await db.query('INSERT INTO sensa_consumer.library_cloud_commits(account_id,operation_id,request_digest,revision,result) VALUES($1,$2,$3,$4,$5::jsonb)',[a.accountId,input.operationId,digest,next.revision,JSON.stringify(result)]);
   await discardInitialPublication(db,a.accountId,input.operationId,true);return result;
  }
  let libraryId:string,learnerId:string,changes:Array<{table:string;key:string;blocks:string[]|null}>;
  if('manifest' in input){
   if(head.library_id)throw conflict('library_sync_bootstrap_only');const next=await manifest(db,a.accountId,input.manifest);
   libraryId=next.libraryId;learnerId=next.learnerId;changes=next.rows;
   if(!changes.length||!changes.some(row=>row.table==='meta'&&row.key==='identity'))throw conflict('library_sync_identity');
  }else{
   if(!head.library_id)throw conflict('library_sync_identity');
   const patch=librarySyncPatch.parse(JSON.parse(await metadataText(db,a.accountId,input.patch,librarySyncMetadataPageBytes)));
   libraryId=patch.libraryId;learnerId=patch.learnerId;changes=patch.changes;
   if(libraryId!==head.library_id||learnerId!==head.learner_id)throw conflict('library_sync_identity');
  }
  const refs=[...new Set(changes.flatMap(row=>row.blocks??[]))];
  for(let at=0;at<refs.length;at+=512){const part=refs.slice(at,at+512),present=(await db.query('SELECT hash FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,part])).rows;if(present.length!==part.length)throw conflict('library_sync_missing_block');}
  const now=a.now??new Date(),revision=head.revision+1;let recordCount=head.record_count,logicalBytes=await currentLibraryLogicalBytes(db,a.accountId,head);
  const rowPins:Array<{kind:'row';owner:string;hashes:string[]}>=[];
  for(let ordinal=0;ordinal<changes.length;ordinal++){
   const row=changes[ordinal],old=(await db.query('SELECT refs,logical_bytes FROM sensa_consumer.library_cloud_rows WHERE account_id=$1 AND table_name=$2 AND record_key=$3 AND generation=$4',[a.accountId,row.table,row.key,head.rows_generation])).rows[0];
   if(old&&!row.blocks&&['learningSessions','learningRuns','supplementalMembershipStates','learningEvents','learningReconciliations','studyScopes'].includes(row.table))throw conflict('library_sync_history');
   if(old&&['learningEvents','learningReconciliations','studyScopes'].includes(row.table)&&JSON.stringify(old.refs)!==JSON.stringify(row.blocks)){
    if(await recordDigest(db,a.accountId,old.refs)!==await recordDigest(db,a.accountId,row.blocks!))throw conflict('library_sync_history');
   }
   if(row.table==='meta'&&row.key==='identity'&&old){
    if(!row.blocks)throw conflict('library_sync_identity');
    if(await recordDigest(db,a.accountId,old.refs)!==await recordDigest(db,a.accountId,row.blocks))throw conflict('library_sync_identity');
   }
   if(!old&&row.blocks)recordCount++;if(old&&!row.blocks)recordCount--;
   const logical=row.blocks?(await measureLibraryRows(db,a.accountId,[{blocks:row.blocks}]))[0]:0;logicalBytes+=logical-Number(old?.logical_bytes??0);
   const owner=libraryCloudRowOwner(head.rows_generation,row.table,row.key);
   await db.query("DELETE FROM sensa_consumer.library_cloud_membership WHERE account_id=$1 AND owner_id=(SELECT id FROM sensa_consumer.library_cloud_owners WHERE account_id=$1 AND owner_kind='row' AND owner=$2)",[a.accountId,owner]);
   if(row.blocks){
    await db.query('INSERT INTO sensa_consumer.library_cloud_rows(account_id,generation,table_name,record_key,refs,logical_bytes) VALUES($1,$6,$2,$3,$4::jsonb,$5) ON CONFLICT(account_id,generation,table_name,record_key) DO UPDATE SET refs=EXCLUDED.refs,logical_bytes=EXCLUDED.logical_bytes',[a.accountId,row.table,row.key,JSON.stringify(row.blocks),logical,head.rows_generation]);
    rowPins.push({kind:'row',owner,hashes:row.blocks});
   }else{
    await db.query('DELETE FROM sensa_consumer.library_cloud_rows WHERE account_id=$1 AND table_name=$2 AND record_key=$3 AND generation=$4',[a.accountId,row.table,row.key,head.rows_generation]);
    await retireEmptyLibraryCloudOwners(db,a.accountId,'row',[owner]);
   }
   await db.query('INSERT INTO sensa_consumer.library_cloud_log(account_id,revision,ordinal,table_name,record_key,refs) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[a.accountId,revision,ordinal,row.table,row.key,row.blocks?JSON.stringify(row.blocks):null]);
   if(rowPins.length===128){await pinLibraryCloudBlocks(db,a.accountId,rowPins);rowPins.length=0;}
  }
  await pinLibraryCloudBlocks(db,a.accountId,rowPins);
  if(logicalBytes>librarySyncLogicalByteLimit)throw new ConsumerError(413,'library_sync_capacity');
  if(recordCount<1||recordCount>librarySyncRecordLimit)throw conflict('library_sync_capacity');
  await pinLibraryCloudBlocks(db,a.accountId,[{kind:'log',owner:String(revision),hashes:refs}]);
  const bytes=Buffer.byteLength(JSON.stringify(changes));
  await db.query('UPDATE sensa_consumer.library_cloud SET revision=$2,library_id=$3,learner_id=$4,record_count=$5,tail_bytes=tail_bytes+$6,tail_commits=tail_commits+1,logical_bytes=$7,updated_at=now() WHERE account_id=$1',[a.accountId,revision,libraryId,learnerId,recordCount,bytes,logicalBytes]);
  const makeSnapshot=!head.library_id||Number(head.tail_bytes)+bytes>=4*1024*1024||head.tail_commits+1>=128;
  // Preparation is a separate request after the facts receipt commits.
  // A failed derived checkpoint must not roll back this publication.
  const result={receipt:{operationId:input.operationId,requestDigest:digest},...descriptor({...head,revision,library_id:libraryId,learner_id:learnerId,record_count:recordCount,...(makeSnapshot?{checkpointDue:true}:{})}),storage:await storage(db,a.accountId)};
  await db.query('INSERT INTO sensa_consumer.library_cloud_commits(account_id,operation_id,request_digest,revision,result) VALUES($1,$2,$3,$4,$5::jsonb)',[a.accountId,input.operationId,digest,revision,JSON.stringify(result)]);
  return result;
 }),c.req.raw));});
}
