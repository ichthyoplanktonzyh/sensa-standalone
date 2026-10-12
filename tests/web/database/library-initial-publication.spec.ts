import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createLibraryCloudBrowserFixture} from '../support/libraryCloudBrowserFixture.mts';
import {encodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');

test('private initial pages reject gaps/replays/cross-account payloads and final CAS/receipt is atomic',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const a=await f.createAccount(),b=await f.createAccount();
  const call=async(path:string,body?:unknown,token=a.token)=>{const r=await fetch(f.origin+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
  const data=encodeLibrarySyncBlock(JSON.stringify(['object',[]])),block={hash:hash(data),data};expect((await call('/blocks/store',{blocks:[block]})).status).toBe(200);
  const begin={operationId:crypto.randomUUID(),baseRevision:0,libraryId:crypto.randomUUID(),learnerId:crypto.randomUUID(),incarnation:crypto.randomUUID(),localRevision:12};
  expect((await call('/staging/begin',begin)).status).toBe(200);expect((await call('/staging/begin',begin)).status).toBe(200);
  expect((await call('/staging/begin',{...begin,localRevision:13})).value.code).toBe('operation_conflict');
  const rows=Array.from({length:600},(_,i)=>({table:i===0?'meta':'drafts',key:i===0?'identity':'draft-'+i,blocks:[block.hash]}));
  const p0={operationId:begin.operationId,page:0,rows:rows.slice(0,400)},p1={operationId:begin.operationId,page:1,rows:rows.slice(400)};
  expect((await call('/staging/page',p1)).status).toBe(409);
  const first=await call('/staging/page',p0);expect(first.status).toBe(200);expect((await call('/staging/page',p0)).value).toEqual(first.value);
  expect((await call('/staging/page',{...p0,rows:[rows[0]]})).value.code).toBe('operation_conflict');
  expect((await call('/staging/page',{...p1,rows:[rows[1]]})).value.code).toBe('operation_conflict');
  expect((await call('/staging/page',p1,b.token)).status).toBe(409);
  expect((await call('/head')).value.manifest).toBeNull();expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_rows WHERE account_id=$1',[a.accountId])).rowCount).toBe(0);
  const second=await call('/staging/page',p1);expect(second.status).toBe(200);
  const commit={operationId:begin.operationId,baseRevision:0,staging:{pages:2,records:600,digest:second.value.digest}};
  expect((await call('/commit',{...commit,staging:{...commit.staging,pages:1}})).status).toBe(409);
  for(const table of ['library_cloud_rows','library_cloud_snapshots','library_cloud_commits']){
   await f.pool.query(`CREATE OR REPLACE FUNCTION sensa_consumer.initial_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated initial fault'; END $$`);
   await f.pool.query(`CREATE TRIGGER initial_test_fault BEFORE INSERT ON sensa_consumer.${table} FOR EACH ROW EXECUTE FUNCTION sensa_consumer.initial_test_fault()`);
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
 const f=await createLibraryCloudBrowserFixture(browser);
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
  await edited.evaluate(()=>{const w=window as any,send=w.request;let once=false;w.request=async(path:string,body:any)=>{const r=await send(path,body);if(path==='/staging/page'&&!once){once=true;await w.core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Concurrent source edit'});}return r;};});
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
   adapter.replicaCandidate=async(input:any)=>{const result=await candidate(input);if(input.kind==='validatePublication'&&!input.confirmed&&!edited){edited=true;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'After sealed validation before pending'});}return result;};
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
