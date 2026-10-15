import {test,expect,type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createLibraryCloudBrowserFixture} from '../support/libraryCloudBrowserFixture.mts';
import {encodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {purgeExpiredLibraryCloudBlocks} from '../../../apps/api/src/sensa/library/retention';
import {resolve} from 'node:path';

test.setTimeout(120000);

test('bounded request maintenance retires payload/history across three rounds while leased H and durable witnesses survive',async({browser},info)=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),other=await f.createAccount(),libraryId=crypto.randomUUID(),learnerId=crypto.randomUUID();
  const call=async(path:string,body?:unknown,token=account.token)=>{const r=await fetch(f.origin+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
  const put=async(text:string)=>{const data=encodeLibrarySyncBlock(text),hash=createHash('sha256').update(data).digest('hex');expect((await call('/blocks/store',{blocks:[{hash,data}]})).status).toBe(200);return hash;};
  const prefix=await put('["string","'),shared=await put('界🙂'),suffix=await put('"]'),identity=await put(JSON.stringify({libraryId,learnerId}));
  const refs=[prefix,...Array<string>(128).fill(shared),suffix];
  const rows=[{table:'meta',key:'identity',blocks:[identity]},...Array.from({length:192},(_,i)=>({table:'drafts',key:`draft-${String(i).padStart(3,'0')}-${['界','é','🙂'][i%3]}`,blocks:refs}))];
  const begin={operationId:crypto.randomUUID(),baseRevision:0,libraryId,learnerId,incarnation:crypto.randomUUID(),localRevision:1};
  expect((await call('/staging/begin',begin)).status).toBe(200);
  const pages=[];let digest='';
  for(let at=0;at<rows.length;at+=24){const page={operationId:begin.operationId,page:pages.length,rows:rows.slice(at,at+24)},ack=await call('/staging/page',page);expect(ack.status).toBe(200);digest=ack.value.digest;pages.push({page,ack});}
  expect(pages.length).toBeGreaterThanOrEqual(3);expect((await call('/staging/page',pages[1]!.page))).toEqual(pages[1]!.ack);
  const commit={operationId:begin.operationId,baseRevision:0,staging:{pages:pages.length,records:rows.length,digest}};
  const receipt=await call('/commit',commit);expect(receipt.status).toBe(200); // Treat this ACK as lost; recover it after payload retirement.
  const count=async(table:string,where='true')=>Number((await f.pool.query(`SELECT count(*) n FROM sensa_consumer.${table} WHERE account_id=$1 AND ${where}`,[account.accountId])).rows[0].n);
  const measure=async(label:string)=>({label,staging:await count('library_cloud_staging_rows'),snapshots:await count('library_cloud_snapshots'),log:await count('library_cloud_log'),pins:await count('library_cloud_membership'),blocks:await count('library_cloud_blocks'),physical:(await f.pool.query(`SELECT c.relname,pg_relation_size(c.oid)::bigint heap,pg_indexes_size(c.oid)::bigint indexes,pg_total_relation_size(c.oid)::bigint total FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sensa_consumer' AND c.relname LIKE 'library_cloud%' AND c.relkind='r' ORDER BY c.relname`)).rows});
  const measurements=[await measure('initial-publication-peak')];expect(measurements[0]!.staging).toBe(193);
  await f.pool.query("CREATE FUNCTION sensa_consumer.retention_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated maintenance interruption'; END $$");
  await f.pool.query('CREATE TRIGGER retention_test_fault BEFORE DELETE ON sensa_consumer.library_cloud_staging_rows FOR EACH ROW EXECUTE FUNCTION sensa_consumer.retention_test_fault()');
  try{expect((await call('/head')).status).toBe(503);}finally{await f.pool.query('DROP TRIGGER retention_test_fault ON sensa_consumer.library_cloud_staging_rows');await f.pool.query('DROP FUNCTION sensa_consumer.retention_test_fault()');}
  expect(await count('library_cloud_staging_rows')).toBe(193);expect(await count('library_cloud_reads')).toBe(0);
  const old=(await call('/head')).value;expect(await count('library_cloud_staging_rows')).toBe(65);
  await call('/head');expect(await count('library_cloud_staging_rows')).toBe(0);expect(await count('library_cloud_staging_pages')).toBe(pages.length);
  expect((await f.pool.query('SELECT pages,records,prepared_pages,prepared_records,retiring FROM sensa_consumer.library_cloud_staging WHERE account_id=$1',[account.accountId])).rows[0]).toEqual({pages:pages.length,records:193,prepared_pages:pages.length,prepared_records:193,retiring:false});
  expect(await call('/commit',commit)).toEqual(receipt);expect((await call('/commit',{...commit,staging:{...commit.staging,digest:'f'.repeat(64)}})).value.code).toBe('operation_conflict');
  expect((await call('/staging/page',{...pages[1]!.page,rows:pages[1]!.page.rows.slice(1)})).value.code).toBe('operation_conflict');
  await f.pool.query("UPDATE sensa_consumer.library_cloud_staging SET expires_at='2000-01-01' WHERE account_id=$1",[account.accountId]);
  expect(await call('/staging/page',pages[1]!.page)).toEqual(pages[1]!.ack);expect((await call('/staging/page',pages[1]!.page,other.token)).status).toBe(409);
  const first=(await call('/snapshot',{snapshotRevision:1,after:null,readLease:old.readLease})).value;expect(first.done).toBe(false);
  const nextBody=await put(JSON.stringify(['string','replacement']));
  const change=rows.slice(1).map((row,i)=>({...row,blocks:i===0?null:[nextBody]}));
  const patch=await put(JSON.stringify({version:1,libraryId,learnerId,changes:change}));
  expect((await call('/commit',{operationId:crypto.randomUUID(),baseRevision:1,patch:[patch]})).status).toBe(200);
  // Queue lease acquisition behind an actual head-row lock, then queue compact
  // behind its account lock. The new reader must be installed before retirement.
  const gate=await f.pool.connect();let tailHead:any;
  try{
   await gate.query('BEGIN');await gate.query('SELECT account_id FROM sensa_consumer.library_cloud WHERE account_id=$1 FOR UPDATE',[account.accountId]);
   const pid=(await gate.query('SELECT pg_backend_pid() pid')).rows[0].pid,lease=call('/head');
   await expect.poll(async()=>Number((await f.pool.query('SELECT count(*) n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).rows[0].n)).toBeGreaterThan(0);
   const compact=call('/compact',{baseRevision:2});await gate.query('COMMIT');
   const acquired=await lease;expect(acquired.status).toBe(200);tailHead=acquired.value;expect(tailHead.manifest.snapshotRevision).toBe(1);expect(tailHead.revision).toBe(2);expect((await compact).status).toBe(200);
  }finally{await gate.query('ROLLBACK');gate.release();}
  // Hold H=1 midway through paging while the current checkpoint advances.
  await call('/head');
  expect(await count('library_cloud_membership',"owner_kind='staging'")).toBeGreaterThan(0);
  const downloaded=[...first.rows];let after=first.next,done=false;
  while(!done){const reply=await call('/snapshot',{snapshotRevision:1,after,readLease:old.readLease});expect(reply.status).toBe(200);downloaded.push(...reply.value.rows);after=reply.value.next;done=reply.value.done;}
  const sorted=[...rows].sort((a,b)=>Buffer.compare(Buffer.from(a.table+'\0'+a.key),Buffer.from(b.table+'\0'+b.key)));expect(downloaded).toEqual(sorted);
  const tail=await call('/pull',{after:{revision:1,offset:0},toRevision:2,readLease:tailHead.readLease});expect(tail.status).toBe(200);expect(tail.value.changes).toEqual(change);expect(tail.value.done).toBe(true);
  expect((await call('/pull',{after:{revision:1,offset:0},toRevision:2,readLease:(await call('/head')).value.readLease})).value.code).toBe('library_sync_snapshot_required');
  // Expire only this synthetic account's leases, retaining a leased current reader.
  await f.pool.query("UPDATE sensa_consumer.library_cloud_reads SET expires_at='2000-01-01' WHERE account_id=$1 AND snapshot_revision=1",[account.accountId]);
  expect((await call('/snapshot',{snapshotRevision:1,after:first.next,readLease:old.readLease})).value.code).toBe('library_sync_snapshot_required');
  await call('/head');expect(await count('library_cloud_log')).toBe(64);expect(await count('library_cloud_snapshots')).toBe(257);
  for(let round=0;round<3;round++){
   for(let i=0;i<5;i++)await call('/head');
   const h=(await call('/head')).value;expect(h.manifest.snapshotRevision).toBe(2+round);
   expect(await count('library_cloud_snapshots')).toBe(192);expect(await count('library_cloud_log')).toBe(0);expect(await count('library_cloud_membership',"owner_kind='staging'")).toBe(0);
   measurements.push(await measure('steady-'+round));
   if(round===2)break;
   const changes=[{...rows[2],blocks:[await put(JSON.stringify(['string','round '+round]))]}],patch=await put(JSON.stringify({version:1,libraryId,learnerId,changes}));
   expect((await call('/commit',{operationId:crypto.randomUUID(),baseRevision:h.revision,patch:[patch]})).status).toBe(200);
   expect((await call('/compact',{baseRevision:h.revision+1})).status).toBe(200);measurements.push(await measure('peak-'+(round+1)));
   await f.pool.query("UPDATE sensa_consumer.library_cloud_reads SET expires_at='2000-01-01' WHERE account_id=$1 AND snapshot_revision<$2",[account.accountId,h.revision+1]);
  }
  // GC only expires derived state belonging to this new fixture, never retained owner data.
  const freshUpload=await put(JSON.stringify(['string','active upload']));
  await f.pool.query("UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at='2000-01-01' WHERE account_id=$1 AND hash<>$2",[account.accountId,freshUpload]);
  const db=await f.pool.connect();try{await db.query('BEGIN');await purgeExpiredLibraryCloudBlocks(db,new Date(),1000,account.accountId);await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  expect((await call('/blocks/fetch',{hashes:[shared]})).value.missing).toEqual([shared]);expect((await call('/blocks/fetch',{hashes:[identity,nextBody,freshUpload]})).value.missing).toEqual([]);
  expect(await call('/commit',commit)).toEqual(receipt);expect((await call('/receipt/'+commit.operationId)).value.head).toEqual(receipt.value);
  for(const table of ['library_cloud_staging_rows','library_cloud_snapshots','library_cloud_log','library_cloud_membership','library_cloud_blocks'])await f.pool.query(`VACUUM (TRUNCATE false, ANALYZE) sensa_consumer.${table}`);
  measurements.push(await measure('after-ordinary-vacuum-no-truncation'));
  await info.attach('retention-lifecycle-space.json',{body:JSON.stringify({facts:rows.length,pages:pages.length,measurements,scope:'Synthetic transport facts; repeated ordered refs and Unicode. Ordinary VACUUM only; allocated pages may be reused, no physical shrink claim.'},null,2),contentType:'application/json'});
 }finally{await f.close();}
});

const reopen=async(page:Page,account:{token:string})=>{await page.reload();await page.evaluate(async({token})=>{const w=window as any,path='/core.js';w.core=await import(path);await w.core.openLibrary();w.request=async(path:string,body?:unknown)=>{const r=await fetch('/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),v=await r.json();if(!r.ok)throw Error(v.code);return v;};w.sync=()=>w.core.synchronizeLibrary(w.request);},account);};

test('an old OPFS client with pending learning and edits merges a reclaimed checkpoint and reopens with exact history',async({browser},info)=>{
 const f=await createLibraryCloudBrowserFixture(browser,resolve('scripts/assessment/capacityBrowserEntry.ts'));
 try{
  const account=await f.createAccount(),a=await f.createClient(account),b=await f.createClient(account),pack=portablePackageFixture({packageId:crypto.randomUUID()});
  const ids=await a.evaluate(async bytes=>{const c=(window as any).core,id=()=>crypto.randomUUID(),context=(await c.languageRoutesSnapshot()).context,payload=new Uint8Array(bytes),preview=await c.contentSupplySystem.execute({kind:'preview_portable_package',bytes:payload}),pack=await c.contentSupplySystem.execute({kind:'install_portable_package',bytes:payload,expectedArchiveDigest:preview.archiveDigest}),[target]=await c.enrollPackage(id(),pack.key,context);await c.confirmLearningQuantity(id(),context,20);for(let i=0;i<130;i++)await c.saveDraft(id(),{id:id(),expectedRevision:0,text:'共享 Unicode 界🙂 '+i});await (window as any).sync();return {target,context};},Array.from(pack.bytes));
  await b.evaluate(()=>(window as any).sync());
  const initial=(await f.pool.query('SELECT record_count FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0].record_count;expect(initial).toBeLessThanOrEqual(256);expect((await f.pool.query('SELECT pages FROM sensa_consumer.library_cloud_staging WHERE account_id=$1',[account.accountId])).rows[0].pages).toBeGreaterThanOrEqual(3);
  // A remains offline on the old common baseline; real commands create its Run and Events.
  await a.evaluate(async({target,context})=>{const w=window as any,c=w.core,id=()=>crypto.randomUUID();w.offline=true;let run=await c.startLearning(id(),target,context,20,new Date().toISOString());run=await c.actLearning(id(),run.id,run.revision,{kind:'reveal'},new Date().toISOString());run=await c.actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'},new Date().toISOString());await c.finishLearning(id(),run.id);const draft=(await c.listDrafts()).find((d:any)=>d.text==='共享 Unicode 界🙂 1');await c.saveDraft(id(),{id:draft.id,expectedRevision:draft.revision,text:'unsent existing draft edit'});await c.saveDraft(id(),{id:id(),expectedRevision:0,text:'unsent after floor'});},ids);
  const localLearning=await a.evaluate(()=>(window as any).core.readLearning());expect(localLearning.events.length).toBeGreaterThan(0);
  await b.evaluate(async()=>{const w=window as any,c=w.core;const consumed=(await c.listDrafts()).find((d:any)=>d.text==='共享 Unicode 界🙂 0');await c.command({id:crypto.randomUUID(),kind:'fixture.consume-draft',input:{id:consumed.id}},(tx:any)=>tx.delete('drafts',consumed.id));await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'remote after floor'});await w.sync();const head=await w.request('/head');await w.request('/compact',{baseRevision:head.revision});await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'remote tail after compact'});await w.sync();});
  await f.pool.query("UPDATE sensa_consumer.library_cloud_reads SET expires_at='2000-01-01' WHERE account_id=$1",[account.accountId]);
  for(let i=0;i<5;i++)await b.evaluate(()=>(window as any).request('/head'));
  expect((await f.pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_log WHERE account_id=$1',[account.accountId])).rows[0].n).toBe(1); // The H=2 → head=3 tail remains readable.
  await reopen(a,account);await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
  const inspect=(page:Page)=>page.evaluate(async()=>{const c=(window as any).core;return {learning:await c.readLearning(),drafts:(await c.listDrafts()).map((d:any)=>d.text).sort(),state:await c.readCloudSync(),base:await c.readLibrary((tx:any)=>tx.syncBaseReferences())};});
  const left=await inspect(a),right=await inspect(b);expect(left.learning).toEqual(localLearning);expect(right.learning).toEqual(localLearning);expect(left.drafts).toEqual(right.drafts);expect(left.drafts).toEqual(expect.arrayContaining(['unsent after floor','unsent existing draft edit','remote after floor','remote tail after compact']));expect(left.drafts).not.toContain('共享 Unicode 界🙂 0');expect(left.state.pending).toBeUndefined();expect(left.base).toEqual(right.base);
  await reopen(a,account);await a.evaluate(()=>(window as any).sync());expect((await inspect(a)).learning).toEqual(localLearning);
  await info.attach('offline-floor-history.json',{body:JSON.stringify({initialFacts:initial,nonemptyEvents:localLearning.events.length,runs:localLearning.runs.length,finalFacts:(await inspect(a)).base.length,drafts:left.drafts.length,status:left.state.status,scope:'Real Chromium/OPFS + Hono/local PG, lawful package learn/reveal/rate/finish; controlled authentication, no provider or physical-device claim.'}),contentType:'application/json'});
 }finally{await f.close();}
});

test('a manifest receipt sharing an unpublished stage ID cannot retire that private payload or extend its lease',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),libraryId=crypto.randomUUID(),learnerId=crypto.randomUUID(),operationId=crypto.randomUUID();
  const call=async(path:string,body?:unknown)=>{const r=await fetch(f.origin+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
  const put=async(value:unknown)=>{const data=encodeLibrarySyncBlock(JSON.stringify(value)),hash=createHash('sha256').update(data).digest('hex');expect((await call('/blocks/store',{blocks:[{hash,data}]})).status).toBe(200);return hash;};
  const body=await put(['string','private upload']),rows=[{table:'meta',key:'identity',blocks:[body]}];
  const begin={operationId,baseRevision:0,libraryId,learnerId,incarnation:crypto.randomUUID(),localRevision:1};expect((await call('/staging/begin',begin)).status).toBe(200);
  const page={operationId,page:0,rows};expect((await call('/staging/page',page)).status).toBe(200);
  const manifest=await put({version:8,libraryId,learnerId,rows});expect((await call('/commit',{operationId,baseRevision:0,manifest:[manifest]})).status).toBe(200);
  await call('/head');expect((await f.pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_staging_rows WHERE account_id=$1',[account.accountId])).rows[0].n).toBe(1);
  await f.pool.query("UPDATE sensa_consumer.library_cloud_staging SET expires_at='2000-01-01' WHERE account_id=$1",[account.accountId]);expect((await call('/staging/page',page)).value.code).toBe('library_sync_staging_expired');
  // Expired private work is reclaimable through the existing account sweep,
  // despite the unrelated durable receipt; current default-generation data stays.
  await put(['string','trigger account maintenance']);
  expect((await f.pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_staging WHERE account_id=$1',[account.accountId])).rows[0].n).toBe(0);
  expect((await f.pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_rows WHERE account_id=$1',[account.accountId])).rows[0].n).toBe(1);
  expect((await call('/receipt/'+operationId)).value.head.revision).toBe(1);
 }finally{await f.close();}
});
