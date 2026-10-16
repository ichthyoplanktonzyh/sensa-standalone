import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createLibraryCloudBrowserFixture} from '../support/libraryCloudBrowserFixture.mts';
import {finishLibraryCheckpoint} from '../support/finishLibraryCheckpoint.mts';
import {encodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
import {discardPreparedLibraryGeneration} from '../../../apps/api/src/sensa/library/generation';

test.setTimeout(120000);

test('paged checkpoint seals exact H while current advances; retries, source expiry and old readers preserve roots',async({browser},info)=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),other=await f.createAccount(),libraryId=crypto.randomUUID(),learnerId=crypto.randomUUID();
  const call=async(path:string,body?:unknown,token=account.token)=>{const r=await fetch(f.origin+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-sensa-sync-protocol':'sensa-checkpoint-pages-v1'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
  const put=async(text:string)=>{const data=encodeLibrarySyncBlock(text),hash=createHash('sha256').update(data).digest('hex');expect((await call('/blocks/store',{blocks:[{hash,data}]})).status).toBe(200);return hash;};
  const prefix=await put('["string","'),shared=await put('界🙂'),suffix=await put('"]'),identity=await put(JSON.stringify({libraryId,learnerId})),body=await put(JSON.stringify(['string','共享 Unicode 界🙂']));
  const rows=[{table:'meta',key:'identity',blocks:[identity]},...Array.from({length:192},(_,i)=>({table:'drafts',key:`draft-${String(i).padStart(3,'0')}-界🙂`,blocks:i===0?[prefix,...Array<string>(2046).fill(shared),suffix]:[body]}))];
  const begin={operationId:crypto.randomUUID(),baseRevision:0,libraryId,learnerId,incarnation:crypto.randomUUID(),localRevision:1};
  expect((await call('/staging/begin',begin)).status).toBe(200);let digest='',pages=0;
  for(let at=0;at<rows.length;at+=24){const r=await call('/staging/page',{operationId:begin.operationId,page:pages++,rows:rows.slice(at,at+24)});expect(r.status).toBe(200);digest=r.value.digest;}
  expect(pages).toBeGreaterThanOrEqual(3);expect((await call('/commit',{operationId:begin.operationId,baseRevision:0,staging:{pages,records:rows.length,digest}})).status).toBe(200);
  const head=async()=>(await call('/head')).value;
  const dbhead=async()=>(await f.pool.query('SELECT * FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0];
  const count=async(table:string,condition='true',values:unknown[]=[])=>Number((await f.pool.query(`SELECT count(*) n FROM sensa_consumer.${table} WHERE account_id=$1 AND ${condition}`,[account.accountId,...values])).rows[0].n);
  const patch=async(baseRevision:number,changes:any[])=>{const p=await put(JSON.stringify({version:1,libraryId,learnerId,changes})),r=await call('/commit',{operationId:crypto.randomUUID(),baseRevision,patch:[p]});expect(r.status).toBe(200);return r.value;};
  const old=await head(),replacement=await put(JSON.stringify(['string','fixed H body']));
  const changes=[{...rows[1],blocks:[replacement]},{...rows[2],blocks:null},{table:'drafts',key:'new-at-H',blocks:[body]}];
  await patch(1,changes);const tailReader=await head();
  const expected=new Map(rows.map(row=>[JSON.stringify([row.table,row.key]),row.blocks]));for(const row of changes)row.blocks?expected.set(JSON.stringify([row.table,row.key]),row.blocks):expected.delete(JSON.stringify([row.table,row.key]));
  const initial=await call('/compact',{baseRevision:2});expect(initial.status).toBe(200);expect(initial.value.preparation.phase).toBe('snapshot');
  const operationId=initial.value.preparation.operationId;
  // Lost page ACK: the singleton 2048-ref row is accepted under the hard row
  // contract even though subsequent rows use the softer 512-ref page target.
  expect(await call('/compact',{baseRevision:2,operationId,page:0})).toEqual(initial);
  expect(await count('library_cloud_snapshots','generation=$2',[operationId])).toBe(1);
  expect((await call('/compact',{baseRevision:2,operationId,page:2})).value.code).toBe('operation_conflict');
  expect((await call('/compact',{baseRevision:3,operationId,page:1})).value.code).toBe('operation_conflict');
  expect((await call('/compact',{baseRevision:2,operationId,page:1},other.token)).value.code).toBe('library_sync_identity');
  await expect(f.pool.query('UPDATE sensa_consumer.library_cloud SET snapshot_generation=$2,snapshot_revision=2,retention_floor=2 WHERE account_id=$1',[account.accountId,operationId])).rejects.toMatchObject({code:'23514'});
  await expect(f.pool.query('UPDATE sensa_consumer.library_cloud SET rows_generation=$2,snapshot_generation=$2,snapshot_revision=revision,retention_floor=revision WHERE account_id=$1',[account.accountId,operationId])).rejects.toMatchObject({code:'23514'});
  // An unrelated data write completes between preparation pages. A second
  // compact caller joins fixed H=2 instead of replacing its source with N=3.
  const n=await patch(2,[{table:'drafts',key:'only-at-N',blocks:[body]}]),before=await dbhead();expect(n.revision).toBe(3);
  let result=await call('/compact',{baseRevision:3}),windows=2;expect(result.value.preparation).toMatchObject({operationId,revision:2});
  while(result.value.preparation?.phase!=='sealed'){
   const p=result.value.preparation;expect(p).toBeTruthy();result=await call('/compact',{baseRevision:p.revision,operationId:p.operationId,page:p.page});expect(result.status).toBe(200);windows++;
  }
  const sealed=result.value.preparation;expect(windows).toBeGreaterThanOrEqual(3);
  const publish={baseRevision:2,operationId,page:sealed.page};
  // A descriptor without the captured counter fence must fail closed, even
  // with an otherwise complete witness. Roll back only this synthetic fault.
  const guard=await f.pool.connect();
  try{await guard.query('BEGIN');await guard.query("UPDATE sensa_consumer.library_cloud_staging SET descriptor=descriptor-'tailBytes',published_revision=2 WHERE account_id=$1 AND operation_id=$2",[account.accountId,operationId]);
   await guard.query(`INSERT INTO sensa_consumer.library_cloud_commits(account_id,operation_id,request_digest,revision,result)
    SELECT account_id,operation_id,request_digest,2,jsonb_build_object('manifest',jsonb_build_object('snapshotRevision',2,'floor',2,'libraryId',$3::text,'learnerId',$4::text),'receipt',jsonb_build_object('operationId',operation_id,'requestDigest',request_digest))
    FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2`,[account.accountId,operationId,libraryId,learnerId]);
   await expect(guard.query('UPDATE sensa_consumer.library_cloud SET snapshot_generation=$2,snapshot_revision=2,retention_floor=2,tail_bytes=0,tail_commits=0 WHERE account_id=$1',[account.accountId,operationId])).rejects.toMatchObject({code:'23514'});
  }finally{await guard.query('ROLLBACK');guard.release();}
  const final=await call('/compact',publish);expect(final.status).toBe(200);expect(final.value).toMatchObject({revision:3,manifest:{snapshotRevision:2,floor:2,records:194}});
  expect(await call('/compact',publish)).toEqual(final);expect(await call('/compact',{baseRevision:2,operationId,page:0})).toEqual(final);
  expect((await call('/compact',{...publish,page:sealed.page+1})).value.code).toBe('operation_conflict');
  expect((await call('/receipt/'+operationId)).value.head).toEqual(final.value);
  const selected=await dbhead();expect(selected.rows_generation).toBe(before.rows_generation);expect(selected.revision).toBe(before.revision);expect(selected.record_count).toBe(before.record_count);expect(selected.logical_bytes).toBe(before.logical_bytes);expect(selected.tail_commits).toBe(1);expect(Number(selected.tail_bytes)).toBeGreaterThan(0);
  const actual=(await f.pool.query('SELECT table_name,record_key,refs FROM sensa_consumer.library_cloud_snapshots WHERE account_id=$1 AND generation=$2',[account.accountId,operationId])).rows;
  expect(new Map(actual.map(row=>[JSON.stringify([row.table_name,row.record_key]),row.refs]))).toEqual(expected);
  const download=async(reader:any)=>{let after=null,done=false;const found:any[]=[];while(!done){const r=await call('/snapshot',{snapshotRevision:reader.manifest.snapshotRevision,after,readLease:reader.readLease});expect(r.status).toBe(200);found.push(...r.value.rows);after=r.value.next;done=r.value.done;}return found;};
  const oldRows=await download(old);expect(new Map(oldRows.map(row=>[JSON.stringify([row.table,row.key]),row.blocks]))).toEqual(new Map(rows.map(row=>[JSON.stringify([row.table,row.key]),row.blocks])));
  expect((await call('/pull',{after:{revision:1,offset:0},toRevision:2,readLease:tailReader.readLease})).value.changes).toEqual(changes);
  const gReader=await head();expect(gReader.manifest.snapshotRevision).toBe(2);
  expect((await finishLibraryCheckpoint(call,{baseRevision:3})).status).toBe(200);
  await f.pool.query("UPDATE sensa_consumer.library_cloud_staging SET expires_at='2000-01-01' WHERE account_id=$1 AND operation_id=$2",[account.accountId,operationId]);
  const db=await f.pool.connect();try{await db.query('BEGIN');await db.query('SELECT account_id FROM sensa_consumer.library_cloud WHERE account_id=$1 FOR UPDATE',[account.accountId]);expect(await discardPreparedLibraryGeneration(db,account.accountId,operationId)).toMatchObject({selected:true,complete:false});await db.query('COMMIT');}finally{await db.query('ROLLBACK');db.release();}
  expect((await download(gReader)).length).toBe(193);expect(await count('library_cloud_membership',"owner_kind='staging' AND owner_id=$2",[operationId])).toBeGreaterThan(0);
  await f.pool.query("UPDATE sensa_consumer.library_cloud_reads SET expires_at='2000-01-01' WHERE account_id=$1",[account.accountId]);
  for(let i=0;i<10;i++)await head();
  expect(await count('library_cloud_snapshots')).toBe(194);expect(await count('library_cloud_log')).toBe(0);
  expect(await count('library_cloud_membership',"owner_kind='staging' AND owner_id=$2",[operationId])).toBe(0);
  expect((await call('/snapshot',{snapshotRevision:2,after:null,readLease:gReader.readLease})).value.code).toBe('library_sync_snapshot_required');
  await patch(3,[{table:'drafts',key:'expire-source',blocks:[body]}]);
  await patch(4,[{table:'drafts',key:'transient-tail-key',blocks:[body]}]);
  await patch(5,[{table:'drafts',key:'transient-tail-key',blocks:null}]);
  await patch(6,[{...rows[3],blocks:null}]);
  await patch(7,[rows[3]]);
  const abandoned=(await call('/compact',{baseRevision:8})).value.preparation;
  await f.pool.query("UPDATE sensa_consumer.library_cloud_reads SET expires_at='2000-01-01' WHERE account_id=$1",[account.accountId]);
  expect((await call('/compact',{baseRevision:8,operationId:abandoned.operationId,page:abandoned.page})).value.code).toBe('library_sync_snapshot_required');
  let restarted=(await call('/compact',{baseRevision:8})).value.preparation;expect(restarted.operationId).not.toBe(abandoned.operationId);
  while(restarted.phase!=='sealed')restarted=(await call('/compact',{baseRevision:8,operationId:restarted.operationId,page:restarted.page})).value.preparation;
  // Here H=N and all prepared counters agree: purpose alone must stop an
  // otherwise admissible initial-publication switch to G's empty current rows.
  await expect(f.pool.query('UPDATE sensa_consumer.library_cloud SET rows_generation=$2,snapshot_generation=$2,snapshot_revision=revision,retention_floor=revision WHERE account_id=$1',[account.accountId,restarted.operationId])).rejects.toMatchObject({code:'23514'});
  expect((await finishLibraryCheckpoint(call,{baseRevision:8,operationId:restarted.operationId,page:restarted.page})).value.manifest.snapshotRevision).toBe(8);
  expect(await count('library_cloud_snapshots',"generation=$2 AND record_key='transient-tail-key'",[restarted.operationId])).toBe(0);
  expect(await count('library_cloud_snapshots','generation=$2',[restarted.operationId])).toBe(195);
  for(let i=0;i<10;i++)await head();
  expect(await count('library_cloud_staging','operation_id=$2',[abandoned.operationId])).toBe(0);
  // Derived-only fault fixture: four interrupted copies of the exact sealed
  // source. Each has enough rows to outlive one maintenance slice. No learner
  // facts, published witnesses or blocks are expired or removed here.
  await patch(8,[{...rows[3],blocks:[body]}]);
  const retired=[];
  for(let i=0;i<4;i++){
   const generation=crypto.randomUUID();retired.push(generation);
   await f.pool.query(`INSERT INTO sensa_consumer.library_cloud_staging(account_id,operation_id,request_digest,descriptor,digest,expires_at,prepared_version,purpose,checkpoint_state,records,prepared_records,pages,prepared_pages,retiring)
    SELECT account_id,$3::uuid,request_digest,jsonb_set(descriptor,'{operationId}',to_jsonb($3::uuid::text)),digest,'2000-01-01',prepared_version,purpose,checkpoint_state,records,prepared_records,pages,prepared_pages,true
    FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2`,[account.accountId,restarted.operationId,generation]);
   await f.pool.query(`INSERT INTO sensa_consumer.library_cloud_snapshots(account_id,generation,revision,table_name,record_key,refs)
    SELECT account_id,$3,revision,table_name,record_key,refs FROM sensa_consumer.library_cloud_snapshots WHERE account_id=$1 AND generation=$2`,[account.accountId,restarted.operationId,generation]);
  }
  const bounded=await call('/compact',{baseRevision:9});expect(bounded).toMatchObject({status:413,value:{code:'library_sync_capacity'}});
  // A capacity response must commit, rather than roll back, its cleanup page.
  expect(await count('library_cloud_snapshots','generation=ANY($2::uuid[])',[retired])).toBe(4*195-128);
  expect(await count('library_cloud_staging','operation_id=ANY($2::uuid[])',[retired])).toBe(4);
  expect((await patch(9,[{...rows[3],blocks:[body]}])).revision).toBe(10);
  expect((await head()).revision).toBe(10);
  expect((await finishLibraryCheckpoint(call,{baseRevision:10})).status).toBe(200);
  await f.pool.query("UPDATE sensa_consumer.library_cloud_reads SET expires_at='2000-01-01' WHERE account_id=$1",[account.accountId]);
  for(let i=0;i<20;i++)await head();
  expect(await count('library_cloud_staging','operation_id=ANY($2::uuid[])',[retired])).toBe(0);
  expect(await count('library_cloud_snapshots')).toBe(195);
  await info.attach('fixed-h-pages.json',{body:JSON.stringify({facts:rows.length,initialPages:pages,preparationWindows:windows,source:1,checkpoint:2,currentAtCAS:3,hardRowRefs:2048,exactHRows:actual.length,lostPageAndCASAck:true,sourceExpiryRestarted:true,oldGenerationRetiredAfterReaderExpiry:true}),contentType:'application/json'});
 }finally{await f.close();}
});

test('automatic byte and commit thresholds acknowledge facts before preparation; another tab resumes after cancellation',async({browser},info)=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),other=await f.createAccount(),source=await f.createClient(account);
  await source.evaluate(async()=>{const w=window as any;await w.core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'retained automatic preparation draft 界🙂'});await w.sync();});
  const call=async(path:string,body?:unknown)=>{const r=await fetch(f.origin+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json','x-sensa-sync-protocol':'sensa-checkpoint-pages-v1'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
  const initial=(await call('/head')).value,row=(await f.pool.query('SELECT table_name,record_key,refs FROM sensa_consumer.library_cloud_rows WHERE account_id=$1 AND table_name=$2 LIMIT 1',[account.accountId,'drafts'])).rows[0];
  const patch={version:1,libraryId:initial.manifest.libraryId,learnerId:initial.manifest.learnerId,changes:[{table:row.table_name,key:row.record_key,blocks:row.refs}]},data=encodeLibrarySyncBlock(JSON.stringify(patch)),hash=createHash('sha256').update(data).digest('hex');
  expect((await call('/blocks/store',{blocks:[{hash,data}]})).status).toBe(200);
  let revision=1,last:any,lastCommit:any;for(let i=0;i<128;i++){lastCommit={operationId:crypto.randomUUID(),baseRevision:revision++,patch:[hash]};last=await call('/commit',lastCommit);expect(last.status).toBe(200);if(i<127)expect(last.value.checkpointDue).toBeUndefined();}
  expect(last.value).toMatchObject({revision:129,checkpointDue:true,manifest:{snapshotRevision:1}});
  expect((await f.pool.query("SELECT count(*)::int n FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND purpose='checkpoint'",[account.accountId])).rows[0].n).toBe(0);
  const oldCall=async(path:string,body?:unknown)=>{const r=await fetch(f.origin+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
  const capable=(await call('/head')).value;expect(capable.preparation.revision).toBe(129);
  const legacyKeys=new Set(['revision','manifest','binarySnapshot','nativeSnapshot','readLease','receipt','storage']);
  const legacyHead=(await oldCall('/head')).value,legacyAck=await oldCall('/commit',lastCommit),legacyReceipt=(await oldCall('/receipt/'+lastCommit.operationId)).value.head;
  for(const value of [legacyHead,legacyAck.value,legacyReceipt])expect(Object.keys(value).filter(key=>!legacyKeys.has(key))).toEqual([]);
  expect(legacyAck.status).toBe(200);expect(legacyAck.value.receipt).toEqual(last.value.receipt);expect(legacyReceipt).toEqual(legacyAck.value);
  expect((await oldCall('/compact',{baseRevision:129})).value.code).toBe('library_sync_checkpoint_upgrade_required');
  expect((await f.pool.query('SELECT pages FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2',[account.accountId,capable.preparation.operationId])).rows[0].pages).toBe(0);
  const before=(await f.pool.query('SELECT record_count,rows_generation FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0];
  let held=false,arrive!:()=>void,release!:()=>void;const arrived=new Promise<void>(resolve=>{arrive=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  await source.route('https://service.fixture.invalid/**',async route=>{const target=new URL(route.request().url()),response=await route.fetch({url:f.origin+target.pathname+target.search});if(target.pathname.endsWith('/compact')&&!held){held=true;arrive();await gate;}await route.fulfill({response}).catch(()=>undefined);});
  await source.evaluate(account=>{(window as any).__fixtureAuthSession={access_token:account.token,user:{id:account.subject}};},account);
  // The normal production service returns with facts confirmed while its
  // separately scheduled checkpoint page response is still held in flight.
  await source.evaluate(()=>(window as any).core.syncAccountLibrary());await arrived;
  expect((await source.evaluate(()=>(window as any).core.readCloudSync())).status).toBe('synced');
  const tab=await source.context().newPage();await tab.goto(f.origin);
  await tab.route('https://service.fixture.invalid/**',async route=>{const target=new URL(route.request().url());if(target.pathname.endsWith('/compact')){await route.abort();return;}const response=await route.fetch({url:f.origin+target.pathname+target.search});await route.fulfill({response});});
  await tab.evaluate(async account=>{const path='/core.js',w=window as any;w.core=await import(path);w.__fixtureAuthSession={access_token:account.token,user:{id:account.subject}};await w.core.openLibrary();},account);
  await tab.evaluate(async()=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'actual write while checkpoint response is held'});await c.syncAccountLibrary();});
  expect((await call('/head')).value.revision).toBe(130);
  // A late preparation ACK cannot write into a replacement account's local
  // state or keep sending pages under its captured account authority.
  const callsBefore=f.requests().filter(r=>r.path.endsWith('/compact')).length;
  await source.evaluate(async other=>(window as any).core.writeLibraryState((tx:any)=>tx.put('meta','service-owner',{subject:other.subject,accountId:other.accountId})),other);
  release();await source.waitForTimeout(100);
  expect(f.requests().filter(r=>r.path.endsWith('/compact')).length).toBe(callsBefore);
  expect(await source.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.get('meta','service-owner')))).toMatchObject({accountId:other.accountId});
  await source.evaluate(async account=>(window as any).core.writeLibraryState((tx:any)=>tx.put('meta','service-owner',{subject:account.subject,accountId:account.accountId})),account);
  // Restart from the persisted server cursor through a new page/module.
  await tab.unroute('https://service.fixture.invalid/**');await tab.route('https://service.fixture.invalid/**',async route=>{const target=new URL(route.request().url()),response=await route.fetch({url:f.origin+target.pathname+target.search});await route.fulfill({response});});
  await tab.reload();await tab.evaluate(async account=>{const path='/core.js',w=window as any;w.core=await import(path);w.__fixtureAuthSession={access_token:account.token,user:{id:account.subject}};await w.core.openLibrary();await w.core.syncAccountLibrary();},account);
  await expect.poll(async()=>(await f.pool.query('SELECT snapshot_revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0].snapshot_revision,{timeout:30000}).toBe(129);
  const after=(await f.pool.query('SELECT revision,record_count,rows_generation,tail_commits FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0];expect(after).toEqual({revision:130,record_count:before.record_count+1,rows_generation:before.rows_generation,tail_commits:1});
  await info.attach('automatic-preparation.json',{contentType:'application/json',body:JSON.stringify({commits:128,selectedH:129,currentN:130,factsAcknowledgedBeforePreparation:true,otherTabWriteWhileHeld:true,reopenedCursorResumed:true,lateAccountResponseStopped:true})});
 }finally{await f.close();}
});

test('the byte threshold and S=0 manifest seed use the same bounded checkpoint path',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),libraryId=crypto.randomUUID(),learnerId=crypto.randomUUID();
  const call=async(path:string,body?:unknown)=>{const r=await fetch(f.origin+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json','x-sensa-sync-protocol':'sensa-checkpoint-pages-v1'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
  const put=async(value:unknown)=>{const data=encodeLibrarySyncBlock(JSON.stringify(value)),hash=createHash('sha256').update(data).digest('hex');expect((await call('/blocks/store',{blocks:[{hash,data}]})).status).toBe(200);return hash;};
  const body=await put(['string','retained small row']),rows=[{table:'meta',key:'identity',blocks:[await put({libraryId,learnerId})]},{table:'drafts',key:'shared',blocks:[body]}];
  const manifest=await put({version:8,libraryId,learnerId,rows});
  expect((await call('/commit',{operationId:crypto.randomUUID(),baseRevision:0,manifest:[manifest]})).value).toMatchObject({revision:1,manifest:{snapshotRevision:0,floor:0}});
  const head=(await call('/head')).value;
  expect((await call('/snapshot',{snapshotRevision:0,after:null,readLease:head.readLease})).value.rows).toEqual([]);
  expect((await call('/pull',{after:{revision:0,offset:0},toRevision:1,readLease:head.readLease})).value.changes).toEqual(rows);
  expect((await finishLibraryCheckpoint(call,{baseRevision:1})).value.manifest.snapshotRevision).toBe(1);
  const patch=await put({version:1,libraryId,learnerId,changes:[{table:'drafts',key:'shared',blocks:Array<string>(2048).fill(body)}]});
  let revision=1,last:any,commits=0;
  do{last=await call('/commit',{operationId:crypto.randomUUID(),baseRevision:revision++,patch:[patch]});expect(last.status).toBe(200);commits++;}while(!last.value.checkpointDue&&commits<64);
  expect(commits).toBeLessThan(128);expect(last.value.checkpointDue).toBe(true);expect(last.value.manifest.snapshotRevision).toBe(1);
  const h=(await call('/head')).value;expect(h.preparation.revision).toBe(revision);
  expect((await finishLibraryCheckpoint(call,{baseRevision:revision,operationId:h.preparation.operationId,page:h.preparation.page})).value.manifest.snapshotRevision).toBe(revision);
 }finally{await f.close();}
});
