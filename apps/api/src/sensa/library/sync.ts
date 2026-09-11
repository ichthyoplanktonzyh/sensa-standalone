import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Hono} from 'hono';
import type {DatabaseExecutor} from '../../database/core.js';
import {librarySyncHash,librarySyncCommit,librarySyncManifest,type LibrarySyncManifest} from '@sensa/contracts/sensa';
import {ConsumerError} from '../access/auth.js';
type Access=<T>(request:Request,work:(db:DatabaseExecutor,a:{accountId:string;installationId?:string;now?:Date})=>Promise<T>)=>Promise<T>;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const conflict=(code='library_sync_conflict')=>new ConsumerError(409,code);
export function registerLibrarySync(app:Hono,access:Access){
 app.use('/sensa/library-sync/*',async(c,next)=>{c.header('Cache-Control','no-store');await next();});
 const use:Access=(request,work)=>access(request,(db,a)=>{if(a.installationId)throw new ConsumerError(403,'web_authorization_required');return work(db,a);});
 const current=async(db:DatabaseExecutor,id:string)=>{await db.query('INSERT INTO sensa_consumer.library_cloud(account_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);return (await db.query('SELECT revision,manifest FROM sensa_consumer.library_cloud WHERE account_id=$1 FOR UPDATE',[id])).rows[0]!;};
 async function manifest(db:DatabaseExecutor,id:string,refs:string[]):Promise<LibrarySyncManifest>{
  const blocks=(await db.query('SELECT hash,data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[id,refs])).rows;
  const byHash=new Map(blocks.map(b=>[b.hash,b.data]));if(refs.some(r=>!byHash.has(r)))throw conflict('library_sync_missing_block');
  return librarySyncManifest.parse(JSON.parse(refs.map(r=>byHash.get(r)).join('')));
 }
 app.get('/sensa/library-sync/head',async c=>c.json(await use(c.req.raw,(db,a)=>current(db,a.accountId))));
 app.post('/sensa/library-sync/blocks/missing',async c=>{const input=z.object({hashes:z.array(librarySyncHash).max(500)}).strict().parse(await c.req.json());return c.json(await use(c.req.raw,async(db,a)=>{const found=(await db.query('SELECT hash FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,input.hashes])).rows;const have=new Set(found.map(r=>r.hash));return {missing:input.hashes.filter(h=>!have.has(h))};}));});
 app.post('/sensa/library-sync/blocks',async c=>{const input=z.object({hash:librarySyncHash,data:z.string().max(32000)}).strict().parse(await c.req.json());if(hash(input.data)!==input.hash)throw new ConsumerError(400,'library_sync_hash');return c.json(await use(c.req.raw,async(db,a)=>{await current(db,a.accountId);const prior=(await db.query('SELECT data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[a.accountId,input.hash])).rows[0];if(prior){if(prior.data!==input.data)throw conflict();return {stored:true};}
 // Bounded storage guard, not a product subscription quota. Includes unattached retry blocks.
 const usage=(await db.query('SELECT COALESCE(sum(octet_length(data)),0)::bigint n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[a.accountId])).rows[0];if(Number(usage.n)+Buffer.byteLength(input.data)>256*1024*1024)throw new ConsumerError(413,'library_sync_capacity');
 await db.query('INSERT INTO sensa_consumer.library_cloud_blocks(account_id,hash,data) VALUES($1,$2,$3)',[a.accountId,input.hash,input.data]);return {stored:true};}));});
 app.get('/sensa/library-sync/blocks/:hash',async c=>c.json(await use(c.req.raw,async(db,a)=>{const key=librarySyncHash.parse(c.req.param('hash'));const row=(await db.query('SELECT data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[a.accountId,key])).rows[0];if(!row)throw new ConsumerError(404,'library_sync_missing_block');return {hash:key,data:row.data};})));
 app.post('/sensa/library-sync/commit',async c=>{const input=librarySyncCommit.parse(await c.req.json()),digest=hash(JSON.stringify(input));return c.json(await use(c.req.raw,async(db,a)=>{
  const head=await current(db,a.accountId);
  const prior=(await db.query('SELECT request_digest,revision FROM sensa_consumer.library_cloud_commits WHERE account_id=$1 AND operation_id=$2',[a.accountId,input.operationId])).rows[0];
  if(prior){if(prior.request_digest!==digest)throw conflict('operation_conflict');return {revision:prior.revision,manifest:input.manifest};}
  if(head.revision!==input.baseRevision)throw conflict();
  const next=await manifest(db,a.accountId,input.manifest);
  const refs=[...new Set(next.rows.flatMap(r=>r.blocks))];
  const present=(await db.query('SELECT hash FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[a.accountId,refs])).rows;
  if(present.length!==refs.length)throw conflict('library_sync_missing_block');
  if(head.manifest){const old=await manifest(db,a.accountId,head.manifest);if(old.libraryId!==next.libraryId||old.learnerId!==next.learnerId)throw conflict('library_sync_identity');
   const byKey=new Map(next.rows.map(r=>[JSON.stringify([r.table,r.key]),r]));
   // Learning facts are never silently deleted or rewritten by snapshot publication.
   for(const row of old.rows)if(row.table==='learningEvents'||row.table==='operations'){const replacement=byKey.get(JSON.stringify([row.table,row.key]));if(!replacement||JSON.stringify(row.blocks)!==JSON.stringify(replacement.blocks))throw conflict('library_sync_history');}
  }
  const revision=head.revision+1;
  await db.query('UPDATE sensa_consumer.library_cloud SET revision=$2,manifest=$3::jsonb,updated_at=now() WHERE account_id=$1',[a.accountId,revision,JSON.stringify(input.manifest)]);
  await db.query('INSERT INTO sensa_consumer.library_cloud_commits(account_id,operation_id,request_digest,revision) VALUES($1,$2,$3,$4)',[a.accountId,input.operationId,digest,revision]);return {revision,manifest:input.manifest};
 }));});
}
