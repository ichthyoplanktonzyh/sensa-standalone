import {attachLegacyBinaryCheckpoint} from '../support/legacyBinaryCheckpointFixture.mts';
import {semanticLookupPayload} from '../support/semanticLookupFixtures';
import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createLibraryCloudBrowserFixture} from '../support/libraryCloudBrowserFixture.mts';
import {encodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');

for(const cancelled of [false,true])test(`refs first publication keeps reads responsive without whole export (${cancelled?'cancel':'confirm'})`,async({browser},info)=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),source=await f.createClient(account);
  await source.evaluate(async()=>{const w=window as any,c=w.core;for(let i=0;i<70;i++)await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Refs-only source '+i});
   const adapter=await c.sqliteRecordAdapter();w.wholeExports=0;adapter.exportOwnCloudSnapshot=async()=>{w.wholeExports++;throw Error('whole_export_must_not_run');};
   w.transferAbort=new AbortController();w.progress=[];w.transferGate=new Promise<void>(resolve=>{w.releaseTransfer=resolve;});let paused=false;
   w.transfer=c.synchronizeLibrary(async(path:string,body:any,signal:AbortSignal)=>{if(path==='/staging/page'&&!paused){paused=true;w.transferHeld=true;await w.transferGate;}return w.request(path,body,signal);},{signal:w.transferAbort.signal,onProgress:(value:any)=>w.progress.push(value)}).then(()=>({ok:true}),(error:unknown)=>({ok:false,error:String(error)}));
  });
  await source.waitForFunction(()=>(window as any).transferHeld);
  const read=await source.evaluate(async()=>{const at=performance.now(),drafts=await(window as any).core.listDrafts();return {count:drafts.length,ms:performance.now()-at};});expect(read.count).toBe(70);expect(read.ms).toBeLessThan(5000);
  if(cancelled)await source.evaluate(()=>(window as any).transferAbort.abort());
  await source.evaluate(()=>(window as any).releaseTransfer());const result=await source.evaluate(()=>(window as any).transfer);
  const evidence=await source.evaluate(()=>{const w=window as any;return {wholeExports:w.wholeExports,progress:w.progress};});expect(evidence.wholeExports).toBe(0);expect(evidence.progress.some((p:any)=>p.phase==='publication-capture'&&p.completed>0)).toBe(true);
  const state=await source.evaluate(()=>(window as any).core.readCloudSync()),remote=(await f.pool.query('SELECT revision,binary_snapshot FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0];
  if(cancelled){expect(result.error).toContain('library_sync_cancelled');expect(state.status).toBe('pending');expect(remote.revision).toBe(0);expect(await source.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.syncBaseReferences()))).toHaveLength(0);}
  else{expect(result).toEqual({ok:true});expect(state.status).toBe('synced');expect(remote.revision).toBe(1);expect(remote.binary_snapshot).toBeNull();const receiver=await f.createClient(account);await receiver.evaluate(()=>(window as any).sync());expect(await receiver.evaluate(()=>(window as any).core.listDrafts())).toEqual(await source.evaluate(()=>(window as any).core.listDrafts()));}
  expect((await source.evaluate(()=>(window as any).core.listDrafts()))).toHaveLength(70);await info.attach('refs-first.json',{body:JSON.stringify({cancelled,result,read,...evidence,remote}),contentType:'application/json'});
 }finally{await f.close();}
});

test('cancelled first transfers never confirm a late CAS or activate a closed private generation; retry uses receipt',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),a=await f.createClient(account),b=await f.createClient(account);
  await a.evaluate(async()=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Cancelled transfer'});});
  for(const cancelAt of ['/staging/page','mutation']){
   await expect(a.evaluate(async cancelAt=>{const w=window as any,controller=new AbortController();if(cancelAt==='mutation'){const prototype=w.core.LibraryTransaction.prototype,original=prototype.mutation;prototype.mutation=async function(){const result=await original.call(this);if(result.initialPublication){prototype.mutation=original;controller.abort();}return result;};}await w.core.synchronizeLibrary(async(path:string,body:any,signal:AbortSignal)=>{const result=await w.request(path,body,signal);if(path===cancelAt)controller.abort();return result;},{signal:controller.signal});},cancelAt)).rejects.toThrow('library_sync_cancelled');
   expect(await a.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.syncBaseReferences()))).toHaveLength(0);expect((await a.evaluate(()=>(window as any).core.readCloudSync())).failureKind).toBeUndefined();
   expect(Number((await f.pool.query('SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0].revision)).toBe(cancelAt==='mutation'?1:0);
  }
  f.clearRequests();await a.evaluate(()=>(window as any).sync());expect(f.requests().some(r=>r.path.includes('/receipt/'))).toBe(true);expect(f.requests().some(r=>r.path.endsWith('/commit'))).toBe(false);expect((await a.evaluate(()=>(window as any).core.readCloudSync())).status).toBe('synced');
  const before=await b.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.get('meta','identity')));
  await expect(b.evaluate(async()=>{const w=window as any,controller=new AbortController(),NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(url:string|URL,options?:WorkerOptions){super(url,options);}postMessage(message:any,options?:any){if(message.kind==='close'){const stop=(event:MessageEvent)=>{if(event.data?.id===message.id){this.removeEventListener('message',stop);controller.abort();}};this.addEventListener('message',stop);}super.postMessage(message,options);}};await w.core.synchronizeLibrary(w.request,{signal:controller.signal});})).rejects.toThrow('library_sync_cancelled');
  expect(await b.evaluate(()=>localStorage.getItem('sensa:local-library-selection:v1'))).toBeNull();expect(await b.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.get('meta','identity')))).toEqual(before);expect(await b.evaluate(()=>(window as any).core.listDrafts())).toHaveLength(0);
  await b.reload();await b.evaluate(async account=>{const w=window as any,path='/core.js';w.core=await import(path);await w.core.openLibrary();await w.core.synchronizeLibrary(async(path:string,body:any)=>{const r=await fetch('/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(value.code);return value;});},account);expect(await b.evaluate(()=>(window as any).core.listDrafts())).toHaveLength(1);
 }finally{await f.close();}
});

for(const mode of ['advanced','unchanged','local-write'] as const)test(`a missing binary block reacquires an advanced checkpoint without losing source fences (${mode})`,async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 const save=(page:import('@playwright/test').Page,text:string)=>page.evaluate(text=>(window as any).core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text}),text);
 const inspect=(page:import('@playwright/test').Page)=>page.evaluate(async()=>{const c=(window as any).core;return c.readLibrary(async(tx:any)=>({identity:await tx.get('meta','identity'),drafts:await tx.entries('drafts'),base:await tx.syncBaseReferences()}));});
 try{
  const account=await f.createAccount(),source=await f.createClient(account),target=await f.createClient(account);
  await save(source,'Original protected body');await source.evaluate(()=>(window as any).sync());await attachLegacyBinaryCheckpoint(f,source,account);const head=await source.evaluate(()=>(window as any).request('/head'));expect(head.binarySnapshot).toBeTruthy();
  const before=await inspect(target);await target.evaluate(()=>{const w=window as any,send=w.request;w.headRevisions=[];w.request=async(path:string,body:any)=>{const reply=await send(path,body);if(path==='/head')w.headRevisions.push(reply.revision);return reply;};});
  let injected=false;await target.route('**/sensa/library-sync/blocks/fetch',async route=>{
   if(injected){await route.continue();return;}injected=true;
   if(mode!=='unchanged'){await save(source,'Tail committed during snapshot fetch');await source.evaluate(()=>(window as any).sync());}
   if(mode==='local-write')await save(target,'Unsent local edit must survive');
   await route.fulfill({status:200,json:{blocks:[],missing:route.request().postDataJSON().hashes,deferred:[]}});
  });
  if(mode==='advanced'){
   await target.evaluate(()=>(window as any).sync());expect(await target.evaluate(()=>(window as any).headRevisions)).toEqual([1,2,2]);
   expect((await inspect(target)).drafts).toEqual((await inspect(source)).drafts);expect((await target.evaluate(()=>(window as any).core.readCloudSync())).status).toBe('synced');
   expect((await source.evaluate(()=>(window as any).request('/head'))).revision,'recovery must not publish another commit').toBe(2);
  }else{
   await expect(target.evaluate(()=>(window as any).sync())).rejects.toThrow(mode==='unchanged'?'library_sync_missing_block':'library_sync_local_changed');
   const after=await inspect(target);expect(after.identity).toEqual(before.identity);expect(after.base).toEqual(before.base);
   expect(after.drafts.map((r:any)=>r.value.text)).toEqual(mode==='unchanged'?[]:['Unsent local edit must survive']);
   expect(await target.evaluate(()=>localStorage.getItem('sensa:local-library-selection:v1'))).toBeNull();
  }
  expect(injected).toBe(true);
 }finally{await f.close();}
});

test('own binary checkpoint restores into a retained generation after tail and continues genuine learning',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser,resolve('scripts/assessment/capacityBrowserEntry.ts'));
 try{
  const account=await f.createAccount(),a=await f.createClient(account),b=await f.createClient(account),pack=portablePackageFixture({packageId:crypto.randomUUID()});
  const source=await a.evaluate(async(bytes)=>{const c=(window as any).core,languageContext=(await c.languageRoutesSnapshot()).context,id=()=>crypto.randomUUID(),payload=new Uint8Array(bytes),preview=await c.contentSupplySystem.execute({kind:'preview_portable_package',bytes:payload}),pack=await c.contentSupplySystem.execute({kind:'install_portable_package',bytes:payload,expectedArchiveDigest:preview.archiveDigest}),[targetId]=await c.enrollPackage(id(),pack.key,languageContext);await c.confirmLearningQuantity(id(),languageContext,20);let run=await c.startLearning(id(),targetId,languageContext,20,new Date().toISOString());run=await c.actLearning(id(),run.id,run.revision,{kind:'reveal'},new Date().toISOString());run=await c.actLearning(id(),run.id,run.revision,{kind:'rate',rating:'again'},new Date().toISOString());return {targetId,runId:run.id,learning:await c.readLearning()};},Array.from(pack.bytes));
  await a.evaluate(()=>(window as any).sync());
  await attachLegacyBinaryCheckpoint(f,a,account);const head=await a.evaluate(()=>(window as any).request('/head'));expect(head.binarySnapshot.revision).toBe(1);expect(head.binarySnapshot.accountId).toBe(account.accountId);
  await a.evaluate(async()=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Tail after snapshot H'});await (window as any).sync();});
  expect((await a.evaluate(()=>(window as any).request('/head'))).revision).toBe(2);
  const oldTab=await b.context().newPage();await oldTab.goto(f.origin);await oldTab.evaluate(async()=>{const w=window as any,path='/core.js';w.core=await import(path);await w.core.openLibrary();});
  await b.evaluate(async()=>{const w=window as any,c=w.core;w.installation=crypto.randomUUID();await c.writeLibraryState((tx:any)=>tx.put('meta','service-installation',w.installation));const send=w.request;w.request=async(path:string,body:any)=>{if(path==='/pull'&&localStorage.getItem('sensa:local-library-selection:v1')!==null)throw Error('generation_activated_before_tail');return send(path,body);};const store=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='sensa:local-library-selection:v1')w.staleQueued=c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Stale queued draft'}).then(()=>'accepted',(error:any)=>error.message);return store.call(this,key,value);};});
  const result=await b.evaluate(()=>(window as any).sync());expect(result.activated.namespace).toBeTruthy();
  const bootstrap=await b.evaluate(async()=>{const c=(window as any).core,read=()=>c.readLibrary(async(tx:any)=>({identity:await tx.get('meta','identity'),receipt:await tx.get('operations','00000000-0000-4000-8000-000000000001'),revision:await tx.get('meta','local-content-revision')})),before=await read();await c.openLibrary();return {before,after:await read()};});expect(bootstrap.before.receipt.result).toEqual(bootstrap.before.identity);expect(bootstrap.after).toEqual(bootstrap.before);
  const recovered=await b.evaluate(async()=>{const c=(window as any).core;return {learning:await c.readLearning(),drafts:await c.listDrafts(),state:await c.readCloudSync(),selection:JSON.parse(localStorage.getItem('sensa:local-library-selection:v1')!)};});
  expect(recovered.learning).toEqual(source.learning);expect(recovered.drafts).toHaveLength(1);expect(recovered.state.revision).toBe(2);expect(recovered.state.status).toBe('synced');expect(recovered.selection.preservedNamespaces).toContain(null);expect(recovered.selection.namespace).toBe(result.activated.namespace);
  expect(await b.evaluate(()=>(window as any).staleQueued)).toBe('localFlow.libraryReplaced');expect(await b.evaluate(async()=>await (window as any).core.readLibrary((tx:any)=>tx.get('meta','service-installation'))===(window as any).installation)).toBe(true);expect(await b.evaluate(()=>document.documentElement.dataset.librarySelection)).toBeUndefined();await expect(oldTab.evaluate(()=>(window as any).core.listDrafts())).rejects.toThrow('localFlow.libraryReplaced');
  await b.evaluate(async({runId})=>{const c=(window as any).core;let run=(await c.readLearning()).runs.find((run:any)=>run.id===runId);run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'reveal'},new Date().toISOString());run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'rate',rating:'good'},new Date().toISOString());await c.finishLearning(crypto.randomUUID(),run.id);},{runId:source.runId});
  const learned=await b.evaluate(()=>(window as any).core.readLearning());expect(learned.targets[0].memoryRevision).toBeGreaterThan(source.learning.targets[0].memoryRevision);expect(learned.events.length).toBeGreaterThan(source.learning.events.length);
  await b.evaluate(()=>(window as any).sync());await a.evaluate(()=>(window as any).sync());expect(await a.evaluate(()=>(window as any).core.readLearning())).toEqual(learned);
 }finally{await f.close();}
});

test('own snapshot transport refuses account/digest/version and failed tail leaves the old generation active',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),source=await f.createClient(account);await source.evaluate(async()=>{const w=window as any,c=w.core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'H draft'});await w.sync();});await attachLegacyBinaryCheckpoint(f,source,account);await source.evaluate(async()=>{const w=window as any,c=w.core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Tail draft'});await w.sync();});
  for(const mode of ['account','digest','version','tail'] as const){
   const receiver=await f.createClient(account),before=await receiver.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.get('meta','identity')));
   await receiver.evaluate(mode=>{const w=window as any,send=w.request;w.request=async(path:string,body:any)=>{if(mode==='tail'&&path==='/pull')throw Error('injected_tail_loss');const r=await send(path,body);if(path==='/head'){if(mode==='account')r.binarySnapshot.accountId=crypto.randomUUID();if(mode==='digest')r.binarySnapshot.sha256='f'.repeat(64);if(mode==='version')r.binarySnapshot.schemaVersion=20;}return r;};},mode);
   await expect(receiver.evaluate(()=>(window as any).sync())).rejects.toThrow(mode==='account'?'checkpoint_binding':mode==='digest'?'sqlite_snapshot_envelope':mode==='version'?'sqlite_snapshot_envelope':'injected_tail_loss');
   expect(await receiver.evaluate(()=>localStorage.getItem('sensa:local-library-selection:v1'))).toBeNull();expect(await receiver.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.get('meta','identity')))).toEqual(before);expect(await receiver.evaluate(()=>(window as any).core.listDrafts())).toHaveLength(0);expect(await receiver.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('sensa:isolated-snapshot-generation:v1:')))).toHaveLength(0);
   if(mode==='tail'){await receiver.reload();await receiver.evaluate(async(account)=>{const w=window as any,path='/core.js';w.core=await import(path);w.request=async(path:string,body:any)=>{const r=await fetch('/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(value.code);return value;};await w.core.synchronizeLibrary(w.request);},account);expect(await receiver.evaluate(()=>(window as any).core.listDrafts())).toHaveLength(2);expect(await receiver.evaluate(()=>JSON.parse(localStorage.getItem('sensa:local-library-selection:v1')!).preservedNamespaces)).toContain(null);}
  }
 }finally{await f.close();}
});

test('bounded block batches deduplicate, serialize concurrent retries and roll back partial inserts with leases',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),other=await f.createAccount(),values=['已有🙂','new one','new two','fail this batch'].map(data=>({hash:hash(data),data}));
  const call=async(blocks:typeof values,token=account.token)=>fetch(f.origin+'/sensa/library-sync/blocks/store',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({blocks})});
  expect((await call([values[0]!])).status).toBe(200);
  const batch=[values[0]!,values[1]!,values[2]!,values[1]!];
  expect((await Promise.all([call(batch),call(batch)])).map(r=>r.status)).toEqual([200,200]);
  const stored=async()=> (await f.pool.query('SELECT hash,data,logical_bytes,upload_lease_expires_at FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 ORDER BY hash',[account.accountId])).rows;
  const rows=await stored();expect(rows).toHaveLength(3);for(const row of rows)expect(Number(row.logical_bytes)).toBe(Buffer.byteLength(row.data));
  expect((await call([values[1]!],other.token)).status).toBe(200);expect((await f.pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[other.accountId])).rows[0].n).toBe(1);
  await f.pool.query('UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=$3 WHERE account_id=$1 AND hash=$2',[account.accountId,values[0]!.hash,new Date(Date.now()+60000)]);
  const before=await stored();
  // A real PostgreSQL failure after earlier rows in the one statement must
  // roll back both its rows and the preceding existing-block lease renewal.
  await f.pool.query(`CREATE OR REPLACE FUNCTION sensa_consumer.batch_store_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.data='fail this batch' THEN RAISE EXCEPTION 'isolated batch fault'; END IF; RETURN NEW; END $$`);
  await f.pool.query('CREATE TRIGGER batch_store_test_fault BEFORE INSERT ON sensa_consumer.library_cloud_blocks FOR EACH ROW EXECUTE FUNCTION sensa_consumer.batch_store_test_fault()');
  try{expect((await call([values[0]!,{hash:hash('insert before failure'),data:'insert before failure'},values[3]!])).status).toBe(503);}finally{await f.pool.query('DROP TRIGGER batch_store_test_fault ON sensa_consumer.library_cloud_blocks');}
  expect(await stored()).toEqual(before);
  await f.pool.query('UPDATE sensa_consumer.library_cloud_blocks SET data=$3 WHERE account_id=$1 AND hash=$2',[account.accountId,values[0]!.hash,'controlled same-ID corruption']);
  expect((await call([values[0]!,values[3]!])).status).toBe(409);expect((await stored()).some(row=>row.hash===values[3]!.hash)).toBe(false);
 }finally{await f.close();}
});

test('private initial pages reject gaps/replays/cross-account payloads and final CAS/receipt is atomic',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const a=await f.createAccount(),b=await f.createAccount();
  const call=async(path:string,body?:unknown,token=a.token)=>{const r=await fetch(f.origin+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
  const data=encodeLibrarySyncBlock(JSON.stringify(['object',[]])),block={hash:hash(data),data};expect((await call('/blocks/store',{blocks:[block,block]})).status).toBe(200);expect(Number((await f.pool.query('SELECT count(*) AS n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[a.accountId])).rows[0].n)).toBe(1);
  const begin={operationId:crypto.randomUUID(),baseRevision:0,libraryId:crypto.randomUUID(),learnerId:crypto.randomUUID(),incarnation:crypto.randomUUID(),localRevision:12};
  expect((await call('/staging/begin',begin)).status).toBe(200);expect((await call('/staging/begin',begin)).status).toBe(200);
  expect((await call('/staging/begin',{...begin,localRevision:13})).value.code).toBe('operation_conflict');
  const rows=Array.from({length:600},(_,i)=>({table:i===0?'meta':'drafts',key:i===0?'identity':'draft-'+i,blocks:[block.hash]}));
  const p0={operationId:begin.operationId,page:0,rows:rows.slice(0,400)},p1={operationId:begin.operationId,page:1,rows:rows.slice(400)};
  expect((await call('/staging/page',{...p0,rows:[rows[1],rows[1]]})).status).toBe(400);
  expect((await call('/staging/page',p1)).status).toBe(409);
  const first=await call('/staging/page',p0);expect(first.status).toBe(200);expect((await call('/staging/page',p0)).value).toEqual(first.value);
  expect((await call('/staging/page',{...p0,rows:[rows[0]]})).value.code).toBe('operation_conflict');
  expect((await call('/staging/page',{...p1,rows:[rows[1]]})).value.code).toBe('operation_conflict');
  expect((await call('/staging/page',p1,b.token)).status).toBe(409);
  expect((await call('/head')).value.manifest).toBeNull();expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_rows r JOIN sensa_consumer.library_cloud h ON h.account_id=r.account_id AND h.rows_generation=r.generation WHERE r.account_id=$1',[a.accountId])).rowCount).toBe(0);expect((await f.pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_rows WHERE account_id=$1 AND generation=$2',[a.accountId,begin.operationId])).rows[0].n).toBe(400);
  const second=await call('/staging/page',p1);expect(second.status).toBe(200);
  expect((await f.pool.query('SELECT prepared_version,pages,records,prepared_pages,prepared_records FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[a.accountId,begin.operationId])).rows[0]).toEqual({prepared_version:2,pages:2,records:600,prepared_pages:2,prepared_records:600});
  expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_staging_rows WHERE account_id=$1 AND operation_id=$2',[a.accountId,begin.operationId])).rowCount).toBe(0);
  expect((await f.pool.query('SELECT count(*)::int AS n FROM sensa_consumer.library_cloud_snapshots WHERE account_id=$1 AND generation=$2',[a.accountId,begin.operationId])).rows[0].n).toBe(600);
  const commit={operationId:begin.operationId,baseRevision:0,staging:{pages:2,records:600,digest:second.value.digest}};
  expect((await call('/commit',{...commit,staging:{...commit.staging,pages:1}})).status).toBe(409);
  for(const table of ['library_cloud','library_cloud_commits']){
   await f.pool.query(`CREATE OR REPLACE FUNCTION sensa_consumer.initial_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated initial fault'; END $$`);
   await f.pool.query(`CREATE TRIGGER initial_test_fault BEFORE ${table==='library_cloud'?'UPDATE':'INSERT'} ON sensa_consumer.${table} FOR EACH ROW EXECUTE FUNCTION sensa_consumer.initial_test_fault()`);
   try{expect((await call('/commit',commit)).status).toBe(503);}finally{await f.pool.query(`DROP TRIGGER initial_test_fault ON sensa_consumer.${table}`);}
   expect((await call('/head')).value.manifest).toBeNull();expect((await call('/receipt/'+begin.operationId)).value.head).toBeNull();
  }
  const competing={...begin,operationId:crypto.randomUUID()};expect((await call('/staging/begin',competing)).status).toBe(200);
  const competitorPage=await call('/staging/page',{operationId:competing.operationId,page:0,rows:[rows[0]]});
  const raced=await Promise.all([call('/commit',commit),call('/commit',{operationId:competing.operationId,baseRevision:0,staging:{pages:1,records:1,digest:competitorPage.value.digest}})]);expect(raced.map(r=>r.status).sort()).toEqual([200,409]);
  const winner=raced[0].status===200?commit:{operationId:competing.operationId,baseRevision:0,staging:{pages:1,records:1,digest:competitorPage.value.digest}};
  const receipt=(await call('/receipt/'+winner.operationId)).value.head;expect(receipt.revision).toBe(1);expect((await call('/commit',winner)).value).toEqual(receipt);expect((await call('/receipt/'+winner.operationId,undefined,b.token)).value.head).toBeNull();
 }finally{await f.close();}
});

test('source edits and logout fence initial publish; failed pages restart; lost final ACK confirms only captured baseline',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser,resolve('scripts/assessment/capacityBrowserEntry.ts'));
 try{
  const account=await f.createAccount(),a=await f.createClient(account),b=await f.createClient(account);
  const seed=async(page:any)=>page.evaluate(async()=>{const c=(window as any).core;for(let i=0;i<150;i++)await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Initial draft '+i});});
  await seed(a);
  await a.evaluate(()=>{const w=window as any,send=w.request;let failed=false;w.request=async(path:string,body:any)=>{if(path==='/staging/page'&&body.page===1&&!failed){failed=true;throw Error('injected_page_failure');}return send(path,body);};});
  await expect(a.evaluate(()=>(window as any).sync())).rejects.toThrow('injected_page_failure');
  expect((await f.pool.query('SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0].revision).toBe(0);
  await a.evaluate(()=>{(window as any).failAck=true;});await expect(a.evaluate(()=>(window as any).sync())).rejects.toThrow('lost_ack');
  await a.evaluate(async()=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'After lost ACK'});});
  // A physical page reload opens the retained private generation; no reupload or stale-head commit is needed.
  await a.reload();await a.evaluate(async({token})=>{const w=window as any;const path='/core.js';w.core=await import(path);w.token=token;await w.core.openLibrary();w.request=async(path:string,body?:unknown)=>{const r=await fetch('/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(value.code);return value;};w.sync=()=>w.core.synchronizeLibrary(w.request);},account);
  f.clearRequests();await a.evaluate(()=>(window as any).sync());expect(f.requests().some(r=>r.path.includes('/receipt/'))).toBe(true);expect(f.requests().some(r=>r.path.endsWith('/commit'))).toBe(false);
  expect((await a.evaluate(()=>(window as any).core.readCloudSync())).status).toBe('pending');
  await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
  expect(await b.evaluate(async()=>(await (window as any).core.listDrafts()).length)).toBe(151);
  const source=await f.createAccount(),edited=await f.createClient(source);await seed(edited);
  await edited.evaluate(async()=>{const w=window as any,adapter=await w.core.sqliteRecordAdapter(),send=adapter.replicaCandidate.bind(adapter);let once=false;adapter.replicaCandidate=async(input:any)=>{const r=await send(input);if(input.kind==='publicationPage'&&!r.done&&!once){once=true;await w.core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Concurrent source edit'});}return r;};});
  await expect(edited.evaluate(()=>(window as any).sync())).rejects.toThrow('library_sync_local_changed');
  expect((await f.pool.query('SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[source.accountId])).rows[0].revision).toBe(0);
  const signed=await f.createAccount(),out=await f.createClient(signed);await seed(out);
  await out.evaluate(()=>{const w=window as any,send=w.request;let once=false;w.request=async(path:string,body:any)=>{const r=await send(path,body);if(path==='/staging/page'&&!once){once=true;await w.core.writeLibraryState((tx:any)=>tx.put('meta','signed-out',true));}return r;};});
  await expect(out.evaluate(()=>(window as any).sync())).rejects.toThrow('account_changed');
  expect((await f.pool.query('SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[signed.accountId])).rows[0].revision).toBe(0);
 }finally{await f.close();}
});


test('a concurrent first-publication loser and an expired staged commit recover without a stale pending loop',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),a=await f.createClient(account),b=await f.createClient(account);
  await a.evaluate(async()=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Same initial source'});});
  const source=await a.evaluate(()=>(window as any).core.readLibrary(async(tx:any)=>({identity:await tx.get('meta','identity'),drafts:await tx.entries('drafts')})));
  await b.evaluate(async(source)=>{const c=(window as any).core;await c.restoreLibraryTransaction(async(tx:any)=>{const current=await tx.get('meta','identity');tx.put('meta','identity',{...source.identity,deviceId:current.deviceId});for(const row of source.drafts)tx.put('drafts',row.key,row.value);});},source);
  let arrived=0,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  for(const page of [a,b]){await page.exposeFunction('firstCAS',async()=>{if(++arrived===2)release();await gate;});await page.evaluate(()=>{const w=window as any,send=w.request;w.request=async(path:string,body:any)=>{if(path==='/commit')await w.firstCAS();return send(path,body);};});}
  const result=await Promise.allSettled([a.evaluate(()=>(window as any).sync()),b.evaluate(()=>(window as any).sync())]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const loser=result[0].status==='rejected'?a:b;await loser.evaluate(()=>(window as any).sync());expect((await loser.evaluate(()=>(window as any).core.readCloudSync())).pending).toBeUndefined();expect((await loser.evaluate(()=>(window as any).core.readCloudSync())).status).toBe('synced');
  const expiryAccount=await f.createAccount(),expired=await f.createClient(expiryAccount);
  await expired.evaluate(async()=>{const w=window as any,c=w.core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Expired upload'});const send=w.request;let once=false;w.request=async(path:string,body:any)=>{if(path==='/commit'&&!once){once=true;throw Error('before_commit_network_loss');}return send(path,body);};});
  await expect(expired.evaluate(()=>(window as any).sync())).rejects.toThrow('before_commit_network_loss');
  await f.pool.query("UPDATE sensa_consumer.library_cloud_staging SET expires_at='2000-01-01' WHERE account_id=$1",[expiryAccount.accountId]);
  await expired.evaluate(()=>(window as any).sync());expect((await expired.evaluate(()=>(window as any).core.readCloudSync())).status).toBe('synced');expect((await expired.evaluate(()=>(window as any).core.readCloudSync())).pending).toBeUndefined();
 }finally{await f.close();}
});

test('sealed source publishes its captured baseline while edits complete before the remote CAS ACK',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),a=await f.createClient(account);
  await a.evaluate(async()=>{const w=window as any,c=w.core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Captured'});const send=w.request;w.request=async(path:string,body:any)=>{if(path==='/commit'){w.editPromise=c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Edit after source sealed'});await w.editPromise;}return send(path,body);};});
  await a.evaluate(()=>(window as any).sync());await a.evaluate(()=>(window as any).editPromise);const state=await a.evaluate(()=>(window as any).core.readCloudSync());expect(state.status).toBe('pending');expect(await a.evaluate(async()=>(await (window as any).core.listDrafts()).length)).toBe(2);
  expect(Number((await f.pool.query("SELECT count(*) AS n FROM sensa_consumer.library_cloud_rows WHERE account_id=$1 AND table_name='drafts'",[account.accountId])).rows[0].n)).toBe(1);
 }finally{await f.close();}
});

test('edits after validation stay pending and a lost local pending ACK retains its sealed recovery source',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser,resolve('scripts/assessment/capacityBrowserEntry.ts'));
 try{
  const account=await f.createAccount(),a=await f.createClient(account),b=await f.createClient(account);
  await a.evaluate(async()=>{const w=window as any,c=w.core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Captured before validation'});
   const adapter=await c.sqliteRecordAdapter(),candidate=adapter.replicaCandidate.bind(adapter),commit=adapter.commit.bind(adapter);let edited=false,lost=false;
   adapter.replicaCandidate=async(input:any)=>{const result=await candidate(input);if(input.kind==='admitOwnPublication'&&!input.confirmed&&!edited){edited=true;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'After sealed validation before pending'});}return result;};
   adapter.commit=async(mutation:any)=>{await commit(mutation);if(!lost&&mutation.puts.some((row:any)=>row.table==='meta'&&row.key==='cloud-sync'&&c.decodeBackupValue(JSON.parse(row.encodedValue)).pending?.staging)){lost=true;w.lostPendingAck=true;throw Error('lost_local_pending_ack');}};
  });
  await expect(a.evaluate(()=>(window as any).sync())).rejects.toThrow('localFlow.storageWrite');expect(await a.evaluate(()=>(window as any).lostPendingAck)).toBe(true);
  expect((await a.evaluate(()=>(window as any).core.readCloudSync())).pending.staging.records).toBeGreaterThan(1);
  expect((await f.pool.query('SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0].revision).toBe(0);
  await a.evaluate(()=>(window as any).sync());expect((await a.evaluate(()=>(window as any).core.readCloudSync())).status).toBe('pending');
  await b.evaluate(()=>(window as any).sync());expect((await b.evaluate(()=>(window as any).core.listDrafts())).length).toBe(1);
  await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());expect((await b.evaluate(()=>(window as any).core.listDrafts())).length).toBe(2);
 }finally{await f.close();}
});


test('finite stage budgets measure decoded blocks, count all workspaces, and reject overage before atomic page writes',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),call=async(path:string,body:unknown)=>{const response=await fetch(f.origin+'/sensa/library-sync'+path,{method:'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};};
  const data=encodeLibrarySyncBlock('x'.repeat(262144)),block={hash:hash(data),data};expect((await call('/blocks/store',{blocks:[block]})).status).toBe(200);
  expect(Number((await f.pool.query('SELECT logical_bytes FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[account.accountId,block.hash])).rows[0].logical_bytes)).toBe(262144);
  const begin=(operationId=crypto.randomUUID())=>({operationId,baseRevision:0,libraryId:crypto.randomUUID(),learnerId:crypto.randomUUID(),incarnation:crypto.randomUUID(),localRevision:1}),first=begin();expect((await call('/staging/begin',first)).status).toBe(200);
  const row={table:'drafts',key:'compressed',blocks:Array.from({length:361},()=>block.hash)};
  expect((await call('/staging/page',{operationId:first.operationId,page:0,rows:[row]})).value.code).toBe('library_sync_capacity');
  expect((await f.pool.query('SELECT pages,records,logical_bytes FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[account.accountId,first.operationId])).rows[0]).toMatchObject({pages:0,records:0,logical_bytes:'0'});
  // Seed budget counters and their matching prepared witness to reach an exact edge without a large fixture.
  await f.pool.query('UPDATE sensa_consumer.library_cloud_staging SET records=599999,prepared_records=599999,logical_bytes=$3 WHERE account_id=$1 AND operation_id=$2',[account.accountId,first.operationId,1024*1024*1024-262144]);
  const page={operationId:first.operationId,page:0,rows:[{...row,blocks:[block.hash]}]},accepted=await call('/staging/page',page);expect(accepted.status).toBe(200);expect(await call('/staging/page',page)).toEqual(accepted);
  const prior=(await f.pool.query('SELECT pages,records,logical_bytes,metadata_bytes,digest FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[account.accountId,first.operationId])).rows[0];
  expect((await call('/staging/page',{operationId:first.operationId,page:1,rows:[{...page.rows[0],key:'over'}]})).value.code).toBe('library_sync_capacity');
  expect((await f.pool.query('SELECT pages,records,logical_bytes,metadata_bytes,digest FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[account.accountId,first.operationId])).rows[0]).toEqual(prior);
  const second=begin();expect((await call('/staging/begin',second)).status).toBe(200);
  await f.pool.query('UPDATE sensa_consumer.library_cloud_staging SET metadata_bytes=$3 WHERE account_id=$1 AND operation_id=$2',[account.accountId,first.operationId,128*1024*1024-1]);
  expect((await call('/staging/page',{operationId:second.operationId,page:0,rows:[page.rows[0]]})).value.code).toBe('library_sync_capacity');
  expect(Number((await f.pool.query('SELECT count(*) AS n FROM sensa_consumer.library_cloud_staging_rows WHERE account_id=$1 AND operation_id=$2',[account.accountId,second.operationId])).rows[0].n)).toBe(0);
  expect((await f.pool.query('SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0].revision).toBe(0);expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_commits WHERE account_id=$1',[account.accountId])).rowCount).toBe(0);
 }finally{await f.close();}
});


for(const version of [1,2])test(`pre-counter staging v${version} resumes with measured old rows instead of trusting zero bytes`,async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),call=async(path:string,body:unknown)=>{const response=await fetch(f.origin+'/sensa/library-sync'+path,{method:'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};};
  const data=encodeLibrarySyncBlock('["string","retained compressed input"]'),block={hash:hash(data),data};await call('/blocks/store',{blocks:[block]});
  const begin={operationId:crypto.randomUUID(),baseRevision:0,libraryId:crypto.randomUUID(),learnerId:crypto.randomUUID(),incarnation:crypto.randomUUID(),localRevision:1};await call('/staging/begin',begin);
  if(version===1)await f.pool.query('UPDATE sensa_consumer.library_cloud_staging SET prepared_version=1 WHERE account_id=$1',[account.accountId]);
  const page={operationId:begin.operationId,page:0,rows:[{table:'meta',key:'identity',blocks:[block.hash]}]},first=await call('/staging/page',page);expect(first.status).toBe(200);
  expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_staging_rows WHERE account_id=$1',[account.accountId])).rowCount).toBe(version===1?1:0);
  await f.pool.query('UPDATE sensa_consumer.library_cloud_blocks SET logical_bytes=NULL WHERE account_id=$1',[account.accountId]);await f.pool.query('UPDATE sensa_consumer.library_cloud_staging_rows SET logical_bytes=NULL WHERE account_id=$1',[account.accountId]);if(version===2)await f.pool.query('UPDATE sensa_consumer.library_cloud_rows SET logical_bytes=NULL WHERE account_id=$1',[account.accountId]);await f.pool.query('UPDATE sensa_consumer.library_cloud_staging SET logical_bytes=NULL WHERE account_id=$1',[account.accountId]);
  expect(await call('/staging/begin',begin)).toEqual({status:200,value:{staged:true}});expect(await call('/staging/page',page)).toEqual(first);
  const committed=await call('/commit',{operationId:begin.operationId,baseRevision:0,staging:{pages:1,records:1,digest:first.value.digest}});expect(committed.status).toBe(200);
  expect(Number((await f.pool.query('SELECT logical_bytes FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0].logical_bytes)).toBe(Buffer.byteLength('["string","retained compressed input"]'));
  expect(Number((await f.pool.query('SELECT logical_bytes FROM sensa_consumer.library_cloud_rows WHERE account_id=$1',[account.accountId])).rows[0].logical_bytes)).toBe(Buffer.byteLength('["string","retained compressed input"]'));
 }finally{await f.close();}
});


test('refs-only product restoration seals nonempty facts and projections, cleans late cancellation and preserves the old generation',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser,resolve('scripts/assessment/capacityBrowserEntry.ts'));
 try{
  const account=await f.createAccount(),source=await f.createClient(account);await source.evaluate(async payload=>{const w=window as any;await w.core.createJourneyModules().semanticIntake.submit(payload);await w.sync();},semanticLookupPayload());
  const inspect=(page:import('@playwright/test').Page)=>page.evaluate(async()=>{const c=(window as any).core;return c.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(['semanticState','semanticMeanings','semanticContexts','semanticRegistry','semanticReceipts'].map(async table=>[table,(await tx.entries(table)).map((row:any)=>({key:row.key,value:c.encodeBackupValue(row.value)})).sort((a:any,b:any)=>a.key.localeCompare(b.key))]))));});
  const expected=await inspect(source);expect(expected.semanticMeanings.length).toBeGreaterThan(0);
  const receiver=await f.createClient(account),identity=await receiver.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.get('meta','identity')));
  await receiver.evaluate(()=>{const w=window as any,send=w.request;w.request=async(path:string,body:any)=>{const head=await send(path,body);if(path==='/head')delete head.binarySnapshot;return head;};});
  await expect(receiver.evaluate(async()=>{const w=window as any,controller=new AbortController(),NativeWorker=window.Worker;window.Worker=class extends NativeWorker{postMessage(message:any,options?:any){if(message.kind==='initialize'){const stop=(event:MessageEvent)=>{if(event.data?.id===message.id){this.removeEventListener('message',stop);controller.abort();}};this.addEventListener('message',stop);}super.postMessage(message,options);}};try{await w.core.synchronizeLibrary(w.request,{signal:controller.signal});}finally{window.Worker=NativeWorker;}})).rejects.toThrow('library_sync_cancelled');
  await expect.poll(async()=>receiver.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('sensa:isolated-snapshot-generation:v1:')).length)).toBe(0);
  expect(await receiver.evaluate(()=>localStorage.getItem('sensa:local-library-selection:v1'))).toBeNull();expect(await receiver.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.get('meta','identity')))).toEqual(identity);
  const restored=await receiver.evaluate(()=>(window as any).sync());expect(restored.activated.namespace).toBeTruthy();expect(await inspect(receiver)).toEqual(expected);
  const projections=await receiver.evaluate(async()=>{const c=(window as any).core,adapter=await c.sqliteRecordAdapter();return {lookup:await adapter.lookupMeanings('borrow'),practice:await adapter.practiceExpressions({source:'personal',languageTag:'en',query:'',offset:0,limit:20}),state:await c.readCloudSync(),selection:JSON.parse(localStorage.getItem('sensa:local-library-selection:v1')!)};});
  expect(projections.lookup.meanings.length).toBeGreaterThan(0);expect(projections.practice.total).toBeGreaterThan(0);expect(projections.state.status).toBe('synced');expect(projections.selection.preservedNamespaces).toContain(null);
  await receiver.reload();await receiver.evaluate(async account=>{const w=window as any,path='/core.js';w.core=await import(path);await w.core.openLibrary();w.token=account.token;},account);expect(await inspect(receiver)).toEqual(expected);
 }finally{await f.close();}
});
