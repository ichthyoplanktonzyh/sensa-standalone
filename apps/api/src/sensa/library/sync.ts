import {createHash} from 'node:crypto';
import type {Hono} from 'hono';
import type {DatabaseExecutor} from '../../database/core.js';
import {librarySyncHash,librarySyncCommit,librarySyncManifest,librarySyncBlockFetch,librarySyncBlockFetchBytes,librarySyncBlockMissing,librarySyncBlockStore,librarySyncBlockStoreChars,type LibrarySyncManifest} from '@sensa/contracts/sensa';
import {decodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
import {ConsumerError} from '../access/auth.js';
import {libraryCloudCapacityBytes,libraryCloudReadLeaseMs,libraryCloudRetiredGraceMs,libraryCloudUploadLeaseMs,purgeExpiredLibraryCloudBlocks} from './retention.js';
type Access=<T>(request:Request,work:(db:DatabaseExecutor,a:{accountId:string;installationId?:string;now?:Date})=>Promise<T>)=>Promise<T>;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const conflict=(code='library_sync_conflict')=>new ConsumerError(409,code);
function blockText(refs:string[],blocks:ReadonlyMap<string,string>){
 const parts:string[]=[];let size=0;
 for(const ref of refs){const data=blocks.get(ref);if(data===undefined)throw conflict('library_sync_missing_block');
  let part:string;try{part=decodeLibrarySyncBlock(data);}catch{throw new ConsumerError(400,'library_sync_format');}
  size+=Buffer.byteLength(part);if(size>90*1024*1024)throw new ConsumerError(413,'library_sync_capacity');parts.push(part);
 }
 return parts.join('');
}
export function registerLibrarySync(app:Hono,access:Access){
 app.use('/sensa/library-sync/*',async(c,next)=>{c.header('Cache-Control','no-store');await next();});
 const use:Access=(request,work)=>access(request,(db,a)=>{if(a.installationId)throw new ConsumerError(403,'web_authorization_required');return work(db,a);});
 const current=async(db:DatabaseExecutor,id:string)=>{await db.query('INSERT INTO sensa_consumer.library_cloud(account_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);return (await db.query('SELECT revision,manifest FROM sensa_consumer.library_cloud WHERE account_id=$1 FOR UPDATE',[id])).rows[0]!;};
 const storage=async(db:DatabaseExecutor,id:string)=>{const usage=(await db.query('SELECT COALESCE(sum(octet_length(data)),0)::bigint n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[id])).rows[0];return {usedBytes:Number(usage.n),capacityBytes:libraryCloudCapacityBytes};};
 async function manifest(db:DatabaseExecutor,id:string,refs:string[]):Promise<LibrarySyncManifest>{
  const blocks=(await db.query('SELECT hash,data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[id,refs])).rows;
  const byHash=new Map(blocks.map(b=>[b.hash,b.data]));if(refs.some(r=>!byHash.has(r)))throw conflict('library_sync_missing_block');
  const value=JSON.parse(blockText(refs,byHash));
  if(value?.version!==6)throw conflict('library_sync_incompatible_checkpoint');
  return librarySyncManifest.parse(value);
 }
 app.get('/sensa/library-sync/head',async c=>c.json(await use(c.req.raw,async(db,a)=>{
  const now=a.now??new Date(),head=await current(db,a.accountId),leaseUntil=new Date(now.getTime()+libraryCloudReadLeaseMs);
  await db.query(`INSERT INTO sensa_consumer.library_cloud_snapshot_leases(account_id,revision,expires_at) VALUES($1,$2,$3)
   ON CONFLICT(account_id,revision) DO UPDATE SET expires_at=GREATEST(sensa_consumer.library_cloud_snapshot_leases.expires_at,EXCLUDED.expires_at)`,[a.accountId,head.revision,leaseUntil]);
  return {...head,storage:await storage(db,a.accountId)};
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
 app.post('/sensa/library-sync/blocks/store',async c=>{const input=librarySyncBlockStore.parse(await c.req.json());if(input.blocks.reduce((total,block)=>total+block.data.length,0)>librarySyncBlockStoreChars)throw new ConsumerError(413,'body_too_large');for(const block of input.blocks)if(hash(block.data)!==block.hash)throw new ConsumerError(400,'library_sync_hash');return c.json(await use(c.req.raw,async(db,a)=>{for(const block of input.blocks){try{decodeLibrarySyncBlock(block.data);}catch{throw new ConsumerError(400,'library_sync_format');}}await current(db,a.accountId);const now=a.now??new Date(),leaseUntil=new Date(now.getTime()+libraryCloudUploadLeaseMs);
  // Reclaim expired orphan uploads before enforcing the bounded account budget.
  await purgeExpiredLibraryCloudBlocks(db,now,1_000,a.accountId);
  const hashes=input.blocks.map(b=>b.hash);
  const stored=new Map((await db.query('SELECT hash,data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,hashes])).rows.map(r=>[r.hash as string,r.data as string]));
  for(const block of input.blocks)if(stored.has(block.hash)&&stored.get(block.hash)!==block.data)throw conflict();
  if(stored.size)await db.query('UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=GREATEST(upload_lease_expires_at,$3) WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,[...stored.keys()],leaseUntil]);
  const added=input.blocks.filter(b=>!stored.has(b.hash)).reduce((total,b)=>total+Buffer.byteLength(b.data),0);
  if(added>0){
   // Bounded storage guard, not a product subscription quota. Includes unattached retry blocks.
   const usage=(await db.query('SELECT COALESCE(sum(octet_length(data)),0)::bigint n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[a.accountId])).rows[0];if(Number(usage.n)+added>libraryCloudCapacityBytes)throw new ConsumerError(413,'library_sync_capacity');
   for(const block of input.blocks)if(!stored.has(block.hash))await db.query('INSERT INTO sensa_consumer.library_cloud_blocks(account_id,hash,data,created_at,upload_lease_expires_at) VALUES($1,$2,$3,$4,$5)',[a.accountId,block.hash,block.data,now,leaseUntil]);
  }
  return {stored:true};}));});
 app.get('/sensa/library-sync/blocks/:hash',async c=>c.json(await use(c.req.raw,async(db,a)=>{const key=librarySyncHash.parse(c.req.param('hash'));const row=(await db.query('SELECT data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[a.accountId,key])).rows[0];if(!row)throw new ConsumerError(404,'library_sync_missing_block');return {hash:key,data:row.data};})));
 app.post('/sensa/library-sync/commit',async c=>{const input=librarySyncCommit.parse(await c.req.json()),digest=hash(JSON.stringify(input));return c.json(await use(c.req.raw,async(db,a)=>{
  const head=await current(db,a.accountId);
  const prior=(await db.query('SELECT request_digest,revision FROM sensa_consumer.library_cloud_commits WHERE account_id=$1 AND operation_id=$2',[a.accountId,input.operationId])).rows[0];
  if(prior){if(prior.request_digest!==digest)throw conflict('operation_conflict');return {revision:prior.revision,manifest:input.manifest,storage:await storage(db,a.accountId)};}
  if(head.revision!==input.baseRevision)throw conflict();
  const next=await manifest(db,a.accountId,input.manifest);
  const refs=[...new Set(next.rows.flatMap(r=>r.blocks))],nextRefs=[...new Set([...input.manifest,...refs])];
  const present=(await db.query('SELECT hash FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,nextRefs])).rows;
  if(present.length!==nextRefs.length)throw conflict('library_sync_missing_block');
  let retiredRefs:string[]=[];
  if(head.manifest){const old=await manifest(db,a.accountId,head.manifest);if(old.libraryId!==next.libraryId||old.learnerId!==next.learnerId)throw conflict('library_sync_identity');
   const byKey=new Map(next.rows.map(r=>[JSON.stringify([r.table,r.key]),r]));
   // Session focus and endings evolve, but their historical identity may not
   // disappear while Runs retain references to the frozen arrangement.
   if(old.rows.some(row=>['learningSessions','learningRuns'].includes(row.table)&&!byKey.has(JSON.stringify([row.table,row.key]))))throw conflict('library_sync_history');
   // Original Events and the decisions that reconcile concurrent histories are
   // durable Personal Library Facts. Neither may be deleted or rewritten by a
   // later materialized checkpoint.
   const protectedRows=old.rows.filter(row=>row.table==='learningEvents'||row.table==='learningReconciliations'||row.table==='studyScopes').map(row=>{const replacement=byKey.get(JSON.stringify([row.table,row.key]));if(!replacement)throw conflict('library_sync_history');return {row,replacement};});
   const changedProtected=protectedRows.filter(({row,replacement})=>JSON.stringify(row.blocks)!==JSON.stringify(replacement.blocks));
   const historyRefs=[...new Set(changedProtected.flatMap(({row,replacement})=>[...row.blocks,...replacement.blocks]))],historyBlocks=new Map<string,string>();
   if(historyRefs.length)for(const block of (await db.query('SELECT hash,data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,historyRefs])).rows)historyBlocks.set(block.hash as string,block.data as string);
   if(historyRefs.some(ref=>!historyBlocks.has(ref)))throw conflict('library_sync_missing_block');
   const historyText=(refs:string[])=>blockText(refs,historyBlocks);
   // Learning facts are never silently deleted or rewritten by snapshot publication.
   for(const {row,replacement} of changedProtected){
    const before=historyText(row.blocks),after=historyText(replacement.blocks);
    if(hash(before)!==hash(after))throw conflict('library_sync_history');}
   const keep=new Set(nextRefs);retiredRefs=[...new Set([...head.manifest,...old.rows.flatMap(row=>row.blocks)])].filter(ref=>!keep.has(ref));
  }
  const now=a.now??new Date(),revision=head.revision+1;
  await db.query('UPDATE sensa_consumer.library_cloud SET revision=$2,manifest=$3::jsonb,updated_at=now() WHERE account_id=$1',[a.accountId,revision,JSON.stringify(input.manifest)]);
  await db.query('INSERT INTO sensa_consumer.library_cloud_commits(account_id,operation_id,request_digest,revision) VALUES($1,$2,$3,$4)',[a.accountId,input.operationId,digest,revision]);
  await db.query("DELETE FROM sensa_consumer.library_cloud_block_refs WHERE account_id=$1 AND reference_kind='head'",[a.accountId]);
  await db.query(`INSERT INTO sensa_consumer.library_cloud_block_refs(account_id,hash,reference_kind,expires_at)
   SELECT $1,hash,'head',NULL FROM unnest($2::text[]) AS hash
   ON CONFLICT(account_id,hash,reference_kind) DO UPDATE SET expires_at=NULL`,[a.accountId,nextRefs]);
  await db.query("DELETE FROM sensa_consumer.library_cloud_block_refs WHERE account_id=$1 AND reference_kind='retired' AND hash=ANY($2::text[])",[a.accountId,nextRefs]);
  if(retiredRefs.length){
   const lease=(await db.query('SELECT expires_at FROM sensa_consumer.library_cloud_snapshot_leases WHERE account_id=$1 AND revision=$2',[a.accountId,head.revision])).rows[0];
   const retiredUntil=new Date(Math.max(now.getTime()+libraryCloudRetiredGraceMs,lease?.expires_at?new Date(lease.expires_at).getTime():0));
   await db.query(`INSERT INTO sensa_consumer.library_cloud_block_refs(account_id,hash,reference_kind,expires_at)
    SELECT $1,hash,'retired',$3 FROM unnest($2::text[]) AS hash
    ON CONFLICT(account_id,hash,reference_kind) DO UPDATE SET expires_at=GREATEST(sensa_consumer.library_cloud_block_refs.expires_at,EXCLUDED.expires_at)`,[a.accountId,retiredRefs,retiredUntil]);
  }
  return {revision,manifest:input.manifest,storage:await storage(db,a.accountId)};
 }));});
}
