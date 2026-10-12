import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createLibraryCloudBrowserFixture} from '../support/libraryCloudBrowserFixture.mts';
import {encodeLibrarySyncBlock,splitLibrarySyncText} from '@sensa/contracts/sensa/library-sync-blocks';
import {pruneLibraryCloudHistory,purgeExpiredLibraryCloudBlocks} from '../../../apps/api/src/sensa/library/retention';

test('cursor publication is atomic, idempotent, account fenced and continuously paged with leased snapshots',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),other=await f.createAccount(),libraryId=crypto.randomUUID(),learnerId=crypto.randomUUID();
  const call=async(path:string,body?:unknown,token=account.token)=>{const r=await fetch(f.origin+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
  const put=async(value:unknown)=>{const blocks=splitLibrarySyncText(JSON.stringify(value)).map(text=>{const data=encodeLibrarySyncBlock(text);return {hash:createHash('sha256').update(data).digest('hex'),data};});for(let at=0;at<blocks.length;at+=16)expect((await call('/blocks/store',{blocks:blocks.slice(at,at+16)})).status).toBe(200);return blocks.map(b=>b.hash);};
  const body=await put({valid:'shared fact bytes'}),identity=await put({identity:libraryId});
  const rows=[{table:'meta',key:'identity',blocks:identity},...Array.from({length:600},(_,i)=>({table:'drafts',key:'draft-'+i.toString().padStart(4,'0'),blocks:body}))];
  const bootstrap={operationId:crypto.randomUUID(),baseRevision:0,manifest:await put({version:8,libraryId,learnerId,rows})};
  expect((await call('/commit',bootstrap)).status).toBe(200);
  const first=(await call('/head')).value;expect(first.revision).toBe(1);expect(first.manifest.records).toBe(601);
  expect((await call('/head',undefined,other.token)).value.manifest).toBeNull();
  const page1=(await call('/snapshot',{snapshotRevision:1,after:null,readLease:first.readLease})).value;
  expect(page1.rows.length).toBe(512);expect(page1.done).toBe(false);
  const page2=(await call('/snapshot',{snapshotRevision:1,after:page1.next,readLease:first.readLease})).value;expect(page2.rows.length).toBe(89);expect(page2.done).toBe(true);
  const makePatch=async(changes:unknown[],baseRevision:number)=>({operationId:crypto.randomUUID(),baseRevision,patch:await put({version:1,libraryId,learnerId,changes})});
  const patch=await makePatch(rows.slice(1).map(row=>({...row,key:'new-'+row.key})),1);
  const response=await call('/commit',patch);expect(response.status).toBe(200);expect(response.value.revision).toBe(2);
  const upper=(await call('/head')).value;
  let pos={revision:1,offset:0},count=0;
  while(pos.revision<2){const page=(await call('/pull',{after:pos,toRevision:2,readLease:upper.readLease})).value;expect(page.from).toEqual(pos);expect(page.changes.length).toBeLessThanOrEqual(512);count+=page.changes.length;pos=page.next;}
  expect(count).toBe(600);
  expect((await call('/pull',{after:{revision:1,offset:701},toRevision:2})).status).toBe(409);
  const competing=await Promise.all([makePatch([{table:'drafts',key:'race-a',blocks:body}],2),makePatch([{table:'drafts',key:'race-b',blocks:body}],2)]);
  const race=await Promise.all(competing.map(p=>call('/commit',p)));expect(race.map(r=>r.status).sort()).toEqual([200,409]);
  expect((await call('/commit',patch)).value).toEqual(response.value);
  expect((await call('/commit',{...patch,baseRevision:2})).value.code).toBe('operation_conflict');
  const deletion=await makePatch([{table:'drafts',key:rows[1]!.key,blocks:null}],3);expect((await call('/commit',deletion)).status).toBe(200);
  expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_rows WHERE account_id=$1 AND record_key=$2',[account.accountId,rows[1]!.key])).rowCount).toBe(0);
  expect(Number((await f.pool.query("SELECT count(*) AS n FROM sensa_consumer.library_cloud_membership WHERE account_id=$1 AND owner_kind='row' AND hash=$2",[account.accountId,body[0]])).rows[0].n)).toBeGreaterThan(1);
  const before=(await call('/head')).value;
  // Fail at each atomic publication seam, after earlier writes have happened.
  for(const table of ['library_cloud_rows','library_cloud_log','library_cloud_commits']){
   const attempt=await makePatch([{table:'drafts',key:'fault-'+table,blocks:body}],before.revision);
   await f.pool.query(`CREATE OR REPLACE FUNCTION sensa_consumer.cursor_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated publication fault'; END $$`);
   await f.pool.query(`CREATE TRIGGER cursor_test_fault BEFORE INSERT ON sensa_consumer.${table} FOR EACH ROW EXECUTE FUNCTION sensa_consumer.cursor_test_fault()`);
   try{expect((await call('/commit',attempt)).status).toBe(503);}finally{await f.pool.query(`DROP TRIGGER cursor_test_fault ON sensa_consumer.${table}`);}
   expect((await call('/head')).value.revision).toBe(before.revision);
   expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_rows WHERE account_id=$1 AND record_key=$2',[account.accountId,'fault-'+table])).rowCount).toBe(0);
   expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_log WHERE account_id=$1 AND revision>$2',[account.accountId,before.revision])).rowCount).toBe(0);
   expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_commits WHERE account_id=$1 AND operation_id=$2',[account.accountId,attempt.operationId])).rowCount).toBe(0);
   expect((await f.pool.query("SELECT 1 FROM sensa_consumer.library_cloud_membership WHERE account_id=$1 AND owner_kind='row' AND owner_id=$2",[account.accountId,JSON.stringify(['drafts','fault-'+table])])).rowCount).toBe(0);
  }
  expect((await call('/pull',{after:{revision:1,offset:0},toRevision:before.revision,readLease:upper.readLease})).value.code).toBe('library_sync_cursor');

  const rollback=await makePatch([{table:'drafts',key:'must-rollback',blocks:body},{table:'meta',key:'identity',blocks:null}],before.revision);
  expect((await call('/commit',rollback)).status).toBe(409);
  expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_rows WHERE account_id=$1 AND record_key=$2',[account.accountId,'must-rollback'])).rowCount).toBe(0);
  expect((await call('/head')).value.revision).toBe(before.revision);
  expect((await call('/compact',{baseRevision:2})).status).toBe(409);
  expect((await call('/compact',{baseRevision:before.revision})).status).toBe(200);
  // An old reader still finishes its immutable snapshot and tail, while a new
  // reader below the floor must explicitly recover a complete trusted snapshot.
  expect((await call('/snapshot',{snapshotRevision:1,after:page1.next,readLease:first.readLease})).status).toBe(200);
  expect((await call('/pull',{after:{revision:1,offset:0},toRevision:2,readLease:upper.readLease})).status).toBe(200);
  expect((await call('/pull',{after:{revision:1,offset:0},toRevision:before.revision})).value.code).toBe('library_sync_snapshot_required');
  const db=await f.pool.connect();await db.query('BEGIN');try{expect(await pruneLibraryCloudHistory(db,account.accountId,new Date())).toBe(false);expect(await pruneLibraryCloudHistory(db,account.accountId,new Date(Date.now()+86400000))).toBe(true);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  expect((await call('/commit',patch)).value).toEqual(response.value);
  expect((await call('/pull',{after:{revision:1,offset:0},toRevision:2,readLease:upper.readLease})).value.code).toBe('library_sync_snapshot_required');
  const gc=await f.pool.connect();await gc.query('BEGIN');try{await purgeExpiredLibraryCloudBlocks(gc,new Date(Date.now()+172800000),10000,account.accountId);await gc.query('COMMIT');}catch(e){await gc.query('ROLLBACK');throw e;}finally{gc.release();}
  expect((await call('/blocks/fetch',{hashes:body})).value.missing).toEqual([]);
  expect((await f.pool.query('DELETE FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rowCount).toBe(1);
  expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_membership WHERE account_id=$1',[account.accountId])).rowCount).toBe(0);
  expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[account.accountId])).rowCount).toBe(0);
 }finally{await f.close();}
});

test('two real logical devices recover below the floor after a lost ACK without discarding later local edits',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),a=await f.createClient(account),b=await f.createClient(account);
  const save=(page:import('@playwright/test').Page,text:string)=>page.evaluate(async text=>{const c=(window as any).core;return c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text});},text);
  await save(a,'Initial retained draft');await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
  const committed=await save(a,'Committed before lost ACK');await a.evaluate(()=>(window as any).failAck=true);
  await expect(a.evaluate(()=>(window as any).sync())).rejects.toThrow('lost_ack');
  const later=await save(a,'Local edit after lost ACK');await b.evaluate(()=>(window as any).sync());await save(b,'Independent second device');await b.evaluate(()=>(window as any).sync());
  await b.evaluate(async()=>{const head=await (window as any).request('/head');await (window as any).request('/compact',{baseRevision:head.revision});});
  await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
  const snapshot=(page:import('@playwright/test').Page)=>page.evaluate(async()=>{const c=(window as any).core;return {drafts:(await c.listDrafts()).map((d:any)=>({id:d.id,text:d.text})).sort((a:any,b:any)=>a.id.localeCompare(b.id)),state:await c.readCloudSync(),base:await c.readLibrary((tx:any)=>tx.syncBaseReferences())};});
  const left=await snapshot(a),right=await snapshot(b);expect(left.drafts).toEqual(right.drafts);expect(left.drafts).toHaveLength(4);expect(left.drafts.map(d=>d.id)).toEqual(expect.arrayContaining([committed.id,later.id]));expect(left.state.pending).toBeUndefined();expect(left.state.status).toBe('synced');expect(left.base).toEqual(right.base);
 }finally{await f.close();}
});
