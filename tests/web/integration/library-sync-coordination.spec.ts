/** Real coordinator + React scheduler + OPFS + loopback Hono/PostgreSQL.
 * Auth and failure responses are controlled; no production accounts/providers. */
import {expect,test,type Page,type BrowserContext} from '@playwright/test';
import {createLibraryCloudBrowserFixture,type LibraryCloudAccount,type LibraryCloudBrowserFixture} from '../support/libraryCloudBrowserFixture.mts';
import {cloudCheckpointSchedule} from '../../../apps/web/src/data/library/cloudSyncPolicy';
test.setTimeout(180_000);
const at=new Date('2026-10-11T12:00:00Z');
const clocked=new WeakSet<BrowserContext>();
const state=(page:Page)=>page.evaluate(()=>(window as any).core.readCloudSync());
async function initialize(page:Page,fixture:LibraryCloudBrowserFixture,account:LibraryCloudAccount,automatic=true){
 await page.goto(fixture.origin);
 await page.evaluate(async account=>{const path='/core.js',c=await import(/* @vite-ignore */path);(window as any).core=c;await c.openLibrary();(window as any).__fixtureAuthSession={access_token:account.token,user:{id:account.subject}};(window as any).__finished=0;window.addEventListener('sensa-account-library-sync-finished',()=>{(window as any).__finished++;});},account);
 await page.route('https://service.fixture.invalid/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:fixture.origin+url.pathname+url.search});await route.fulfill({response});});
 if(!clocked.has(page.context())){await page.clock.install({time:at});await page.clock.pauseAt(at);clocked.add(page.context());}
 await page.evaluate(()=>{(window as any).__visible=true;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>(window as any).__visible?'visible':'hidden'});});
 if(automatic)await mount(page);
}
const mount=(page:Page)=>page.evaluate(async()=>{const path='/local-clear.js';(await import(/* @vite-ignore */path)).mountCloudSyncControl();});
const synced=(page:Page)=>expect.poll(()=>state(page),{timeout:60_000}).toMatchObject({status:'synced'});
async function drain(pages:Page[]){
 await expect.poll(async()=>pages[0]!.evaluate(async()=>{const locks=await navigator.locks.query();return [...locks.held??[],...locks.pending??[]].filter(lock=>lock.name==='sensa-account-library-sync').length;}),{timeout:60_000}).toBe(0);
 // Allow actual BroadcastChannel delivery and coherent rereads to settle.
 await new Promise(resolve=>setTimeout(resolve,100));
}
async function advance(pages:Page[],ms:number){await drain(pages);const before=await pages[0]!.evaluate(()=>Date.now());await pages[0]!.clock.fastForward(ms);expect(await pages[0]!.evaluate(()=>Date.now())).toBe(before+ms);for(const page of pages)expect(await page.evaluate(()=>Date.now())).toBe(before+ms);await drain(pages);}
const saveDraft=(page:Page,text:string,id?:string)=>page.evaluate(async({text,id})=>{const c=(window as any).core,old=id?(await c.listDrafts()).find((row:any)=>row.id===id):undefined;return (await c.saveDraft(crypto.randomUUID(),{id:id??crypto.randomUUID(),expectedRevision:old?.revision??0,text})).id;},{text,id});
async function tabs(fixture:LibraryCloudBrowserFixture,account:LibraryCloudAccount,count=3){const first=await fixture.createClient(account),pages=[first];for(let i=1;i<count;i++)pages.push(await first.context().newPage());for(const page of pages)await initialize(page,fixture,account,false);return pages;}
const heads=(fixture:LibraryCloudBrowserFixture)=>fixture.requests().filter(row=>row.path.endsWith('/head')).length;

test('three tabs share confirmed freshness while manual checks and expiry still read the head',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount(),pages=await tabs(fixture,account);
  fixture.clearRequests();await Promise.all(pages.map(mount));await Promise.all(pages.map(page=>expect.poll(()=>page.evaluate(()=>(window as any).__finished)).toBeGreaterThanOrEqual(1)));await drain(pages);
  expect(heads(fixture)).toBe(1);for(const page of pages)await synced(page);
  fixture.clearRequests();await Promise.all(pages.map(page=>page.evaluate(()=>window.dispatchEvent(new Event('focus')))));await drain(pages);expect(heads(fixture)).toBe(0);
  await pages[0]!.getByRole('button',{name:'Sync now',exact:true}).click();await expect.poll(()=>heads(fixture)).toBe(1);await drain(pages);
  fixture.clearRequests();await advance(pages,cloudCheckpointSchedule.pullStaleMs+1);await expect.poll(()=>heads(fixture)).toBe(1);await drain(pages);expect(heads(fixture)).toBe(1);
 }finally{await fixture.close();}
});

test('dirty edits coalesce across tabs and a session boundary clears every old deadline',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount(),pages=await tabs(fixture,account);await Promise.all(pages.map(mount));for(const page of pages)await synced(page);await drain(pages);fixture.clearRequests();
  let id:string|undefined;for(let i=0;i<6;i++){id=await saveDraft(pages[0]!,`Saved edit ${i}`,id);await advance(pages,1000);}
  expect(fixture.requests()).toEqual([]);
  await pages[0]!.evaluate(()=>window.dispatchEvent(new Event('sensa-cloud-checkpoint-requested')));await synced(pages[0]!);await drain(pages);
  expect(fixture.requests().filter(row=>row.path.endsWith('/commit'))).toHaveLength(1);expect(heads(fixture)).toBe(1);
  fixture.clearRequests();await advance(pages,cloudCheckpointSchedule.idleMs+1);expect(fixture.requests()).toEqual([]);
  id=await saveDraft(pages[1]!, 'A later burst starts a new deadline',id);await advance(pages,cloudCheckpointSchedule.idleMs+1);await synced(pages[0]!);await drain(pages);
  expect(fixture.requests().filter(row=>row.path.endsWith('/commit'))).toHaveLength(1);expect(heads(fixture)).toBe(1);
  const receiver=await fixture.createClient(account);await receiver.evaluate(()=>(window as any).sync());expect(await receiver.evaluate(()=>(window as any).core.listDrafts())).toEqual(await pages[0]!.evaluate(()=>(window as any).core.listDrafts()));
 }finally{await fixture.close();}
});

test('confirmed libraries discover remote facts once, hidden tabs wait for foreground recovery',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount(),pages=await tabs(fixture,account);
  // This is a daily pull journey. A first empty-device restore selects a new
  // generation and deliberately retires old tabs, covered by initial-publication.
  await saveDraft(pages[0]!, 'Existing Library baseline');await Promise.all(pages.map(mount));for(const page of pages)await synced(page);await drain(pages);
  const remote=await fixture.createClient(account);await remote.evaluate(()=>(window as any).sync());
  const remoteId=await saveDraft(remote,'Real remote change');await remote.evaluate(()=>(window as any).sync());fixture.clearRequests();
  await advance(pages,cloudCheckpointSchedule.pullStaleMs+1);
  await expect.poll(()=>pages[0]!.evaluate(async id=>(await (window as any).core.listDrafts()).some((row:any)=>row.id===id),remoteId)).toBe(true);await drain(pages);expect(heads(fixture)).toBe(1);
  for(const page of pages)await page.evaluate(()=>{(window as any).__visible=false;document.dispatchEvent(new Event('visibilitychange'));});await drain(pages);
  const hiddenId=await saveDraft(remote,'Change while peers are hidden');await remote.evaluate(()=>(window as any).sync());fixture.clearRequests();
  await advance(pages,cloudCheckpointSchedule.pullStaleMs*3);expect(fixture.requests()).toEqual([]);
  await pages[1]!.evaluate(()=>{(window as any).__visible=true;window.dispatchEvent(new Event('focus'));});
  await expect.poll(()=>pages[0]!.evaluate(async id=>(await (window as any).core.listDrafts()).some((row:any)=>row.id===id),hiddenId)).toBe(true);await drain(pages);expect(heads(fixture)).toBe(1);
 }finally{await fixture.close();}
});

test('network recovery bypasses transient backoff once while terminal failure requires manual retry',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount(),[page]=await tabs(fixture,account,1);let attempts=0;
  await page!.route('**/sensa/library-sync/head',route=>{attempts++;return route.fulfill({status:503,json:{code:'fixture_unavailable'}});});await mount(page!);
  await expect.poll(()=>state(page!)).toMatchObject({status:'failed',failureKind:'transient',retryCount:1});expect(attempts).toBe(1);
  await page!.unroute('**/sensa/library-sync/head');fixture.clearRequests();await page!.evaluate(()=>window.dispatchEvent(new Event('online')));await synced(page!);expect(heads(fixture)).toBe(1);
  await page!.route('**/sensa/library-sync/head',route=>{attempts++;return route.fulfill({status:400,json:{code:'library_sync_format'}});});
  await page!.getByRole('button',{name:'Sync now',exact:true}).click();await expect.poll(()=>state(page!)).toMatchObject({status:'failed',failureKind:'terminal'});const blockedAt=attempts;
  await page!.evaluate(()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});await advance([page!],300_000);expect(attempts).toBe(blockedAt);
  await page!.unroute('**/sensa/library-sync/head');fixture.clearRequests();await page!.getByRole('button',{name:'Sync now',exact:true}).click();await synced(page!);expect(heads(fixture)).toBe(1);
 }finally{await fixture.close();}
});

test('an automatic waiter rereads dirty content after the cross-tab lock',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount(),[page,peer]=await tabs(fixture,account,2);await page!.evaluate(()=>(window as any).core.syncAccountLibrary());
  await page!.evaluate(()=>{void navigator.locks.request('sensa-account-library-sync',()=>new Promise<void>(resolve=>{(window as any).__held=true;(window as any).__release=resolve;}));});await expect.poll(()=>page!.evaluate(()=>(window as any).__held)).toBe(true);
  await peer!.evaluate(()=>{(window as any).__queued=(window as any).core.syncAccountLibrary({automatic:true});});
  await expect.poll(()=>peer!.evaluate(async()=>(await navigator.locks.query()).pending?.filter(lock=>lock.name==='sensa-account-library-sync').length)).toBe(1);
  const id=await saveDraft(page!,'Written after automatic intent queued');fixture.clearRequests();await page!.evaluate(()=>(window as any).__release());await peer!.evaluate(()=>(window as any).__queued);await synced(peer!);
  expect(heads(fixture)).toBe(1);expect(fixture.requests().filter(row=>row.path.endsWith('/commit'))).toHaveLength(1);
  const remote=await fixture.createClient(account);await remote.evaluate(()=>(window as any).sync());expect(await remote.evaluate(async id=>(await (window as any).core.listDrafts()).some((row:any)=>row.id===id),id)).toBe(true);
 }finally{await fixture.close();}
});

test('a manual request is not swallowed by a concurrent automatic verification',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount(),[page]=await tabs(fixture,account,1);await page!.evaluate(()=>(window as any).core.syncAccountLibrary());await page!.clock.runFor(cloudCheckpointSchedule.pullStaleMs+1);
  let entered=false,release:()=>void=()=>{};
  await page!.route('**/sensa/library-sync/head',async route=>{if(!entered){entered=true;await new Promise<void>(resolve=>{release=resolve;});}const response=await route.fetch({url:fixture.origin+'/sensa/library-sync/head'});await route.fulfill({response});});
  fixture.clearRequests();await page!.evaluate(()=>{(window as any).__automatic=(window as any).core.syncAccountLibrary({automatic:true});});await expect.poll(()=>entered).toBe(true);
  await page!.evaluate(()=>{(window as any).__manual=(window as any).core.syncAccountLibrary();});release();await page!.evaluate(()=>Promise.all([(window as any).__automatic,(window as any).__manual]));expect(heads(fixture)).toBe(2);await synced(page!);
 }finally{await fixture.close();}
});

test('continuous edits respect one maximum-dirty deadline across three tabs',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount(),pages=await tabs(fixture,account);await Promise.all(pages.map(mount));for(const page of pages)await synced(page);await drain(pages);fixture.clearRequests();
  let id:string|undefined;for(let i=0;i<24;i++){id=await saveDraft(pages[0]!,`Continuous edit ${i}`,id);await advance(pages,5000);}
  const during=fixture.requests().filter(row=>row.path.endsWith('/commit')).length;expect(during).toBeLessThanOrEqual(2);expect(during).toBeGreaterThanOrEqual(1);
  await advance(pages,cloudCheckpointSchedule.idleMs+1);await synced(pages[0]!);expect(fixture.requests().filter(row=>row.path.endsWith('/commit'))).toHaveLength(2);expect(heads(fixture)).toBe(2);
 }finally{await fixture.close();}
});

test('queued automatic requests obey a peer terminal error, conflict and newly scheduled backoff',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount(),[page,peer]=await tabs(fixture,account,2);await page!.evaluate(()=>(window as any).core.syncAccountLibrary());const confirmed=await state(page!);
  for(const failure of [{status:'failed',failureKind:'terminal',error:'library_sync_format'},{status:'conflict',error:'library_sync_history'},{status:'failed',failureKind:'transient',error:'library_sync_server_error',retryCount:1,retryAt:new Date(at.valueOf()+60_000).toISOString()}]){
   await page!.evaluate(async confirmed=>{await (window as any).core.writeLibraryState((tx:any)=>tx.put('meta','cloud-sync',confirmed));void navigator.locks.request('sensa-account-library-sync',()=>new Promise<void>(resolve=>{(window as any).__held=true;(window as any).__release=resolve;}));},confirmed);await expect.poll(()=>page!.evaluate(()=>(window as any).__held)).toBe(true);
   await peer!.evaluate(()=>{(window as any).__queued=(window as any).core.syncAccountLibrary({automatic:true,recovery:true});});await expect.poll(()=>peer!.evaluate(async()=>(await navigator.locks.query()).pending?.filter(lock=>lock.name==='sensa-account-library-sync').length)).toBe(1);
   await page!.evaluate(async({confirmed,failure})=>{await (window as any).core.writeLibraryState((tx:any)=>tx.put('meta','cloud-sync',{...confirmed,...failure}));}, {confirmed,failure});fixture.clearRequests();await page!.evaluate(()=>{(window as any).__held=false;(window as any).__release();});await peer!.evaluate(()=>(window as any).__queued);
   expect(fixture.requests()).toEqual([]);expect(await state(peer!)).toMatchObject(failure);
  }
 }finally{await fixture.close();}
});

test('repeated foreground and network wake-ups share one early retry per unsuccessful checkpoint chain',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount(),pages=await tabs(fixture,account);let attempts=0;
  for(const page of pages)await page.route('**/sensa/library-sync/head',route=>{attempts++;return route.fulfill({status:503,json:{code:'fixture_unavailable'}});});
  await Promise.all(pages.map(mount));await expect.poll(()=>state(pages[0]!)).toMatchObject({status:'failed',failureKind:'transient',retryCount:1});await drain(pages);expect(attempts).toBe(1);
  await Promise.all(pages.map(page=>page.evaluate(()=>window.dispatchEvent(new Event('online')))));await expect.poll(()=>state(pages[0]!)).toMatchObject({retryCount:2});await drain(pages);expect(attempts).toBe(2);
  for(let i=0;i<3;i++){await Promise.all(pages.map(page=>page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));})));await drain(pages);}expect(attempts).toBe(2);
  await advance(pages,60_001);await expect.poll(()=>state(pages[0]!)).toMatchObject({retryCount:3});expect(attempts).toBe(3);
  for(const page of pages)await page.unroute('**/sensa/library-sync/head');await pages[0]!.getByRole('button',{name:'Sync now',exact:true}).click();await synced(pages[0]!);
 }finally{await fixture.close();}
});

test('warm artifact reuse reads a durable generation and ignores delayed peer notifications',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount(),[page,peer]=await tabs(fixture,account,2);
  await page!.evaluate(()=>{const c=(window as any).core,execute=c.contentSupplySystem.execute.bind(c.contentSupplySystem);(window as any).__rehydrates=0;c.contentSupplySystem.execute=(input:any)=>{if(input.kind==='rehydrate')(window as any).__rehydrates++;return execute(input);};});
  await page!.evaluate(()=>(window as any).core.syncAccountLibrary());expect(await page!.evaluate(()=>(window as any).__rehydrates)).toBe(1);fixture.clearRequests();
  await page!.evaluate(()=>(window as any).core.syncAccountLibrary({automatic:true}));expect(fixture.requests()).toEqual([]);expect(await page!.evaluate(()=>(window as any).__rehydrates)).toBe(1);
  const before=await peer!.evaluate(async()=>{const c=(window as any).core;return c.readLibrary(async(tx:any)=>({content:await c.readLocalLibraryRevision(tx),artifacts:await c.readLocalArtifactRevision(tx)}));});
  await peer!.evaluate(async()=>{const c=(window as any).core;await c.writeLibraryCache((tx:any)=>tx.clear('packageCache'));});
  const after=await page!.evaluate(async()=>{const c=(window as any).core;return c.readLibrary(async(tx:any)=>({content:await c.readLocalLibraryRevision(tx),artifacts:await c.readLocalArtifactRevision(tx)}));});
  expect(after.content).toBe(before.content);expect(after.artifacts).toBeGreaterThan(before.artifacts);
  expect(await page!.evaluate(()=>(window as any).core.isLibraryBackupDestinationEmpty())).toBe(true);
  // Export/inspect rejects any account archive carrying device-only fields.
  expect(await page!.evaluate(async()=>{const c=(window as any).core,backup=await c.exportLibraryBackup('isolated-device-metadata-password');return c.inspectLibraryBackup(backup.file,'isolated-device-metadata-password');})).toMatchObject({events:0,targets:0});
  await page!.evaluate(()=>(window as any).core.syncAccountLibrary({automatic:true}));expect(fixture.requests()).toEqual([]);expect(await page!.evaluate(()=>(window as any).__rehydrates)).toBe(2);
  await page!.evaluate(()=>(window as any).core.syncAccountLibrary());expect(heads(fixture)).toBe(1);expect(await page!.evaluate(()=>(window as any).__rehydrates)).toBe(3);
 }finally{await fixture.close();}
});

test('a queued explicit restore cannot carry its authorization into a newly cleared Library',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount(),[page,peer]=await tabs(fixture,account,2);await saveDraft(page!,'Cloud fact before local clear');await page!.evaluate(()=>(window as any).core.syncAccountLibrary());
  await page!.evaluate(()=>{void navigator.locks.request('sensa-account-library-sync',()=>new Promise<void>(resolve=>{(window as any).__held=true;(window as any).__release=resolve;}));});await expect.poll(()=>page!.evaluate(()=>(window as any).__held)).toBe(true);
  await peer!.evaluate(()=>{(window as any).__queued=(window as any).core.syncAccountLibrary({restoreAfterLocalClear:true}).then(()=>null,(error:any)=>error.message);});await expect.poll(()=>peer!.evaluate(async()=>(await navigator.locks.query()).pending?.filter(lock=>lock.name==='sensa-account-library-sync').length)).toBe(1);
  await page!.evaluate(async()=>{const c=(window as any).core;await c.clearLocalLibrary(await c.inspectLocalClear());});fixture.clearRequests();await page!.evaluate(()=>(window as any).__release());expect(await peer!.evaluate(()=>(window as any).__queued)).toBe('localFlow.libraryReplaced');expect(fixture.requests()).toEqual([]);
  await initialize(page!,fixture,account,false);await page!.evaluate(()=>(window as any).core.syncAccountLibrary({automatic:true}));expect(fixture.requests()).toEqual([]);expect(await page!.evaluate(()=>(window as any).core.listDrafts())).toEqual([]);
  await page!.evaluate(()=>(window as any).core.syncAccountLibrary({restoreAfterLocalClear:true}));expect(await page!.evaluate(()=>(window as any).core.listDrafts())).toHaveLength(1);
 }finally{await fixture.close();}
});
