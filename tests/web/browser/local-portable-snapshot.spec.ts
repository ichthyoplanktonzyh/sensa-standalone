import {test,expect} from '@playwright/test';
import {createLocalSnapshotBrowserFixture} from '../support/localSnapshotBrowserFixture.mts';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import initSqlite from '@sqlite.org/sqlite-wasm';
import {createHash} from 'node:crypto';
test('actual Worker/SAHPool exports and imports a completed learning lineage into an isolated generation',async({browser},testInfo)=>{
 test.setTimeout(60000);const fixture=await createLocalSnapshotBrowserFixture(browser),report:any={browser:browser.version(),conditions:'fresh Chromium context, protected dev Worker, loopback only, controlled public artifact, no active-pointer switch'};
 try{
  const page=await fixture.createPage(),at='2026-10-12T08:00:00.000Z';await page.clock.setFixedTime(new Date(at));
  const bytes=portablePackageFixture({packageId:crypto.randomUUID()}).bytes;
  const seeded=await page.evaluate(({bytes,at})=>(window as any).snapshotApi.seedLearning(bytes,at),{bytes:[...bytes],at});
  const expected=await page.evaluate(()=>(window as any).snapshotApi.hashes());
  const selectionBefore=await page.evaluate(()=>localStorage.getItem('sensa:local-library-selection:v1'));
  report.export=await page.evaluate(()=>(window as any).snapshotApi.exportSnapshot());
  // Forge only a disposable cache in a synthetic copy, keeping all source
  // facts valid. The actual Worker rejects it after rebuilding inside its tx.
  const data=await page.evaluate(()=>(window as any).snapshotApi.snapshotData()),sqlite=await initSqlite(),file='/synthetic-cache-'+crypto.randomUUID();
  sqlite.capi.sqlite3_js_posix_create_file(file,new Uint8Array(data.bytes));const bad=new sqlite.oo1.DB(file,'c');
  bad.exec("INSERT INTO sensa_learning_semantic_memory VALUES('fabricated',NULL,'{}',1,'{}')");
  const corrupted=sqlite.capi.sqlite3_js_db_export(bad.pointer);bad.close();
  report.cacheTransactionFailure=await page.evaluate(data=>(window as any).snapshotApi.refuseSnapshotData(data),{...data,bytes:[...corrupted],sha256:createHash('sha256').update(corrupted).digest('hex')});
  expect(report.cacheTransactionFailure.accepted).toBe(false);expect(report.cacheTransactionFailure.error).toContain('sqlite_snapshot_projection_values');
  expect(await page.evaluate(()=>(window as any).snapshotApi.hashes())).toEqual(expected);
  expect(await page.evaluate(()=>localStorage.getItem('sensa:local-library-selection:v1'))).toBe(selectionBefore);
  report.truncation=await page.evaluate(()=>(window as any).snapshotApi.rejectTruncatedSnapshot());
  expect(report.truncation.accepted).toBe(false);
  const missing=await page.evaluate(()=>(window as any).snapshotApi.refusedReopen(crypto.randomUUID()));
  expect(missing.error).toContain('sqlite_snapshot_generation_unregistered');
  const stale=await page.evaluate(async()=>{
   const namespace=crypto.randomUUID(),key='sensa:isolated-snapshot-generation:v1:'+namespace;
   localStorage.setItem(key,'admitted');
   try{return await (window as any).snapshotApi.refusedReopen(namespace);}finally{localStorage.removeItem(key);}
  });
  expect(stale.error).toContain('sqlite_snapshot_generation_missing');
  report.import=await page.evaluate(()=>(window as any).snapshotApi.importSnapshot());
  expect(await page.evaluate(()=>(window as any).snapshotApi.hashes(true))).toEqual(expected);
  expect(await page.evaluate(()=>(window as any).snapshotApi.hashes())).toEqual(expected);
  expect(await page.evaluate(()=>localStorage.getItem('sensa:local-library-selection:v1'))).toBe(selectionBefore);
  for(const retained of [false,true]){
   const refusal=await page.evaluate(async({namespace,retained})=>{
    const key='sensa:local-library-selection:v1',old=localStorage.getItem(key);
    try{localStorage.setItem(key,JSON.stringify({namespace:retained?crypto.randomUUID():namespace,preservedNamespaces:retained?[namespace]:[]}));return {reopen:await (window as any).snapshotApi.refusedReopen(namespace),initial:await (window as any).snapshotApi.initialSnapshotRead()};}
    finally{if(old===null)localStorage.removeItem(key);else localStorage.setItem(key,old);}
   },{namespace:report.import.namespace,retained});
   expect(refusal.reopen.error).toContain('sqlite_snapshot_owner_namespace');expect(refusal.initial.error).toContain('sqlite_snapshot_owner_namespace');
  }
  report.reopen=await page.evaluate(()=>(window as any).snapshotApi.reopenSnapshot());
  expect(report.reopen.targets).toBe(1);expect(report.reopen.runs).toBe(1);expect(report.reopen.events).toBe(2);
  await page.evaluate(()=>(window as any).snapshotApi.close());
  const learner=await fixture.createPage();await learner.clock.setFixedTime(new Date(at));
  await learner.evaluate(namespace=>(window as any).snapshotApi.attachForLearning(namespace),report.import.namespace);
  await learner.evaluate(bytes=>(window as any).snapshotApi.install(bytes),[...bytes]);
  const due=await learner.evaluate(id=>(window as any).snapshotApi.targetClock(id),seeded.targetId);await learner.clock.setFixedTime(new Date(due));
  report.review=await learner.evaluate(({id,at})=>(window as any).snapshotApi.settle(id,at),{id:seeded.targetId,at:due});
  expect((await learner.evaluate(()=>(window as any).snapshotApi.counts(true))).events).toBe(4);
  await learner.evaluate(()=>(window as any).snapshotApi.close());expect(fixture.externalRequests).toEqual([]);
  report.status='passed';
 }catch(error){report.status='failed';report.error=String(error);throw error;}
 finally{await testInfo.attach('snapshot-roundtrip.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});await fixture.close();}
});
