import {test,expect,type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createLibraryCloudBrowserFixture} from '../support/libraryCloudBrowserFixture.mts';
import {librarySyncNativeDescriptorText} from '@sensa/contracts/sensa';
test.setTimeout(180000);
const save=(page:Page,text:string)=>page.evaluate(async text=>(window as any).core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text}),text);
const inspect=(page:Page)=>page.evaluate(async()=>{const c=(window as any).core;return {drafts:await c.listDrafts(),base:await c.readLibrary((tx:any)=>tx.syncBaseReferences()),state:await c.readCloudSync(),identity:await c.readLibrary((tx:any)=>tx.get('meta','identity'))};});
async function seed(f:Awaited<ReturnType<typeof createLibraryCloudBrowserFixture>>){const account=await f.createAccount(),source=await f.createClient(account);await save(source,'retained native snapshot draft');await source.evaluate(()=>(window as any).sync());await source.evaluate(()=>(window as any).core.synchronizeLibrary((window as any).request,{publishSnapshot:true}));return {account,source};}

test('the production preparation command waits for bounded source retirement while facts remain readable',async({browser},info)=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{const account=await f.createAccount(),source=await f.createClient(account);await save(source,'retained preparation scheduling draft');
  await source.route('https://service.fixture.invalid/**',async route=>{const target=new URL(route.request().url()),response=await route.fetch({url:f.origin+target.pathname+target.search});await route.fulfill({response});});
  await source.evaluate(async account=>{const w=window as any,c=w.core,a=await c.sqliteRecordAdapter();w.__fixtureAuthSession={access_token:account.token,user:{id:account.subject}};w.sourceBegins=0;w.beganBeforeRetirement=false;w.retirementComplete=false;w.retirementHeld=false;w.preparationPhase=false;w.rpc=[];
   const gate=new Promise<void>(resolve=>{w.releaseRetirement=resolve;}),candidate=a.replicaCandidate.bind(a),snapshot=a.snapshotSource.bind(a);
   a.replicaCandidate=async(input:any,onProgress:any)=>{if(input.kind==='retirePublication'){w.retirementHeld=true;await gate;}const result=await candidate(input,onProgress);if(input.kind==='retirePublication'){w.rpc.push({kind:input.kind,done:result.done});if(result.done)w.retirementComplete=true;}return result;};
   a.snapshotSource=async(input:any)=>{if(input.action==='begin'){w.sourceBegins++;w.beganBeforeRetirement||=!w.retirementComplete;}w.rpc.push({kind:'snapshotSource',action:input.action});return snapshot(input);};
   window.addEventListener('sensa-account-library-sync-activity',()=>{if(c.readAccountLibrarySyncActivity()?.phase==='preparing')w.preparationPhase=true;});
  },account);
  const preparing=source.evaluate(()=>(window as any).core.syncAccountLibrary({prepareForAnotherDevice:true})).then(()=>({ok:true}),error=>({ok:false,error:String(error)}));
  await source.waitForFunction(()=>(window as any).retirementHeld&&(window as any).preparationPhase);
  expect((await source.evaluate(()=>(window as any).core.listDrafts())).map((row:any)=>row.text)).toEqual(['retained preparation scheduling draft']);
  // Give the preparation task a real scheduling window while retirement is paused.
  await source.waitForTimeout(100);expect(await source.evaluate(()=>(window as any).sourceBegins)).toBe(0);
  await source.evaluate(()=>(window as any).releaseRetirement());expect(await preparing).toEqual({ok:true});
  const evidence=await source.evaluate(()=>{const w=window as any;return {beganBeforeRetirement:w.beganBeforeRetirement,retirementComplete:w.retirementComplete,sourceBegins:w.sourceBegins,rpc:w.rpc,activity:w.core.readAccountLibrarySyncActivity()};});
  expect(evidence).toMatchObject({beganBeforeRetirement:false,retirementComplete:true,sourceBegins:1,activity:{status:'ready',revision:1}});
  const before=await inspect(source),head=await source.evaluate(()=>(window as any).core.readCloudSync());expect(before.drafts).toHaveLength(1);expect(before.base.length).toBeGreaterThan(1);expect(head.status).toBe('synced');
  const remote=(await f.pool.query('SELECT native_snapshot FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0];expect(remote.native_snapshot.revision).toBe(1);
  await source.reload();await source.evaluate(async()=>{const path='/core.js';(window as any).core=await import(path);await(window as any).core.openLibrary();});expect(await inspect(source)).toEqual(before);
  await info.attach('source-retirement-order.json',{body:JSON.stringify({...evidence,records:before.base.length,reloadDurable:true}),contentType:'application/json'});
 }finally{await f.close();}
});

for(const cancel of [false,true])test(`another page's retirement ${cancel?'can outlive cancelled preparation without publishing':'finishes before the production source opens'}`,async({browser},info)=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{const account=await f.createAccount(),source=await f.createClient(account);await save(source,'retained cross-page scheduling draft');
  await source.evaluate(async()=>{const w=window as any,a=await w.core.sqliteRecordAdapter(),candidate=a.replicaCandidate.bind(a),gate=new Promise<void>(resolve=>{w.releaseRetirement=resolve;});w.retirementHeld=false;w.retirementComplete=false;a.replicaCandidate=async(input:any,onProgress:any)=>{if(input.kind==='retirePublication'){w.retirementHeld=true;await gate;}const result=await candidate(input,onProgress);if(input.kind==='retirePublication'&&result.done)w.retirementComplete=true;return result;};});
  expect(await source.evaluate(()=>(window as any).sync())).toMatchObject({initialPublicationConfirmed:true});await source.waitForFunction(()=>(window as any).retirementHeld);
  const other=await source.context().newPage();await other.goto(f.origin);
  await other.route('https://service.fixture.invalid/**',async route=>{const target=new URL(route.request().url()),response=await route.fetch({url:f.origin+target.pathname+target.search});await route.fulfill({response});});
  await other.evaluate(async account=>{const w=window as any,path='/core.js',c=await import(path);w.core=c;w.__fixtureAuthSession={access_token:account.token,user:{id:account.subject}};await c.openLibrary();const a=await c.sqliteRecordAdapter(),snapshot=a.snapshotSource.bind(a);w.sourceBegins=0;w.preparationPhase=false;w.preparationAbort=new AbortController();a.snapshotSource=async(input:any)=>{if(input.action==='begin')w.sourceBegins++;return snapshot(input);};window.addEventListener('sensa-account-library-sync-activity',()=>{if(c.readAccountLibrarySyncActivity()?.phase==='preparing')w.preparationPhase=true;});},account);
  const preparing=other.evaluate(()=>(window as any).core.syncAccountLibrary({prepareForAnotherDevice:true,signal:(window as any).preparationAbort.signal})).then(()=>({ok:true,error:''}),error=>({ok:false,error:String(error)}));
  await other.waitForFunction(()=>(window as any).preparationPhase);expect((await other.evaluate(()=>(window as any).core.listDrafts()))).toHaveLength(1);await other.waitForTimeout(100);expect(await other.evaluate(()=>(window as any).sourceBegins)).toBe(0);
  if(cancel){await other.evaluate(()=>(window as any).preparationAbort.abort());expect((await preparing).error).toContain('library_sync_cancelled');}
  await source.evaluate(()=>(window as any).releaseRetirement());await source.waitForFunction(()=>(window as any).retirementComplete);
  if(!cancel)expect(await preparing).toEqual({ok:true,error:''});
  const before=await inspect(other),begins=await other.evaluate(()=>(window as any).sourceBegins),remote=(await f.pool.query('SELECT native_snapshot FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0];
  expect(begins).toBe(cancel?0:1);expect(before.state.status).toBe('synced');expect(before.drafts.map((row:any)=>row.text)).toEqual(['retained cross-page scheduling draft']);expect(before.base.length).toBeGreaterThan(1);if(cancel)expect(remote.native_snapshot).toBeNull();else expect(remote.native_snapshot.revision).toBe(1);
  await other.reload();await other.evaluate(async()=>{const path='/core.js';(window as any).core=await import(path);await(window as any).core.openLibrary();});expect(await inspect(other)).toEqual(before);await info.attach('cross-page-retirement.json',{body:JSON.stringify({cancel,begins,records:before.base.length,reloadDurable:true,nativeAttached:!!remote.native_snapshot}),contentType:'application/json'});
 }finally{await f.close();}
});

test('own-cloud v2 uploads, coexists with v1, atomically activates and reopens admitted facts and ordered refs',async({browser},info)=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{const {account,source}=await seed(f),target=await f.createClient(account),before=await inspect(source);
  const head=await source.evaluate(()=>(window as any).request('/head'));expect(head.nativeSnapshot.records).toBeGreaterThan(1);expect(head.binarySnapshot).toBeTruthy();
  const legacy=await source.evaluate(async()=>{const r=await fetch('/sensa/library-sync/head',{headers:{authorization:'Bearer '+(window as any).token}});return r.json();});expect(legacy.nativeSnapshot).toBeUndefined();expect(legacy.binarySnapshot).toEqual(head.binarySnapshot);
  const result=await target.evaluate(()=>(window as any).sync());expect(result.restore.path).toBe('native-v2');expect(result.nativeReport.stats).toMatchObject({admissionReused:true,decodedRecords:0});
  const after=await inspect(target);expect(after.drafts).toEqual(before.drafts);expect(after.base).toEqual(before.base);expect(after.base.length).toBeGreaterThan(1);expect(after.identity.id).toBe(before.identity.id);expect(after.identity.deviceId).not.toBe(before.identity.deviceId);expect(after.state.restore.path).toBe('native-v2');expect(after.state.status).toBe('synced');
  await target.reload();await target.evaluate(async()=>{const path='/core.js';(window as any).core=await import(/* @vite-ignore */ path);await(window as any).core.openLibrary();});const reopened=await inspect(target);expect(reopened).toEqual(after);
  await info.attach('native-small-lifecycle.json',{body:JSON.stringify({head,result,records:after.drafts.length,baseline:after.base.length}),contentType:'application/json'});
 }finally{await f.close();}
});

test('a corrupt artifact records a same-H refs recovery rather than snapshot success',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{const {account,source}=await seed(f),target=await f.createClient(account);let corrupted=false;
  await target.route('**/sensa/library-sync/blocks/fetch',async route=>{const response=await route.fetch();if(corrupted){await route.fulfill({response});return;}corrupted=true;const value=await response.json();value.blocks[0].data+=' ';await route.fulfill({response,json:value});});
  await target.evaluate(()=>(window as any).sync());const state=await inspect(target);expect(corrupted).toBe(true);expect(state.state.restore).toMatchObject({path:'refs',revision:1});expect(state.state.restore.snapshotFailure).toContain('library_sync_hash');expect(state.drafts).toEqual((await inspect(source)).drafts);expect(state.base).toEqual((await inspect(source)).base);
 }finally{await f.close();}
});

test('a real local write during native receipt preserves the old selected library and rejects activation',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{const {account}=await seed(f),target=await f.createClient(account),before=await inspect(target);let wrote=false;
  await target.route('**/sensa/library-sync/blocks/fetch',async route=>{const response=await route.fetch();if(!wrote){wrote=true;await save(target,'local write during native receipt');}await route.fulfill({response});});
  await expect(target.evaluate(()=>(window as any).sync())).rejects.toThrow('library_sync_local_changed');const after=await inspect(target);expect(wrote).toBe(true);expect(after.identity).toEqual(before.identity);expect(after.base).toEqual(before.base);expect(after.drafts.map((draft:any)=>draft.text)).toEqual(['local write during native receipt']);expect(after.state.restore).toBeUndefined();
 }finally{await f.close();}
});

test('native attachment uses exact same-H idempotence, account binding and atomic missing-block rejection',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{const {account,source}=await seed(f),head=await source.evaluate(()=>(window as any).request('/head')),native=head.nativeSnapshot;
  expect((await source.evaluate(body=>(window as any).request('/compact',body),{baseRevision:1,nativeSnapshot:native})).nativeSnapshot).toEqual(native);
  const changed={...native,sha256:'c'.repeat(64)};changed.manifestHash=createHash('sha256').update(librarySyncNativeDescriptorText(changed)).digest('hex');
  await expect(source.evaluate(body=>(window as any).request('/compact',body),{baseRevision:1,nativeSnapshot:changed})).rejects.toThrow('operation_conflict');
  const other=await f.createAccount(),otherPage=await f.createClient(other);await save(otherPage,'other retained draft');await otherPage.evaluate(()=>(window as any).sync());
  await expect(otherPage.evaluate(body=>(window as any).request('/compact',body),{baseRevision:1,nativeSnapshot:native})).rejects.toThrow('library_sync_identity');
  const otherHead=await otherPage.evaluate(()=>(window as any).request('/head')),missing={...native,accountId:other.accountId,libraryId:otherHead.manifest.libraryId,learnerId:otherHead.manifest.learnerId,records:otherHead.manifest.records,blocks:['d'.repeat(64)]};missing.manifestHash=createHash('sha256').update(librarySyncNativeDescriptorText(missing)).digest('hex');
  const pins=(await f.pool.query('SELECT * FROM sensa_consumer.library_cloud_membership WHERE account_id=$1 ORDER BY owner_kind,owner_id,hash',[other.accountId])).rows;
  await expect(otherPage.evaluate(body=>(window as any).request('/compact',body),{baseRevision:1,nativeSnapshot:missing})).rejects.toThrow('library_sync_missing_block');
  expect((await otherPage.evaluate(()=>(window as any).request('/head'))).nativeSnapshot).toBeUndefined();expect((await f.pool.query('SELECT * FROM sensa_consumer.library_cloud_membership WHERE account_id=$1 ORDER BY owner_kind,owner_id,hash',[other.accountId])).rows).toEqual(pins);
  expect((await source.evaluate(()=>(window as any).request('/head'))).nativeSnapshot).toEqual(native);expect(account.accountId).not.toBe(other.accountId);
  const large={...native,blocks:Array.from({length:24576},()=>native.blocks[0])};large.manifestHash=createHash('sha256').update(librarySyncNativeDescriptorText(large)).digest('hex');
  await expect(source.evaluate(body=>(window as any).request('/compact',body),{baseRevision:1,nativeSnapshot:large})).rejects.toThrow('operation_conflict');
  await expect(source.evaluate(body=>(window as any).request('/compact',body),{baseRevision:1,padding:'x'.repeat(2*1024*1024)})).rejects.toThrow('body_too_large');
 }finally{await f.close();}
});

test('head advance after a corrupt native response prevents refs fallback and preserves the target',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{const {account,source}=await seed(f),target=await f.createClient(account),before=await inspect(target);let advanced=false;
  await target.route('**/sensa/library-sync/blocks/fetch',async route=>{const response=await route.fetch();if(advanced){await route.fulfill({response});return;}advanced=true;await save(source,'real later head');await source.evaluate(()=>(window as any).sync());const value=await response.json();value.blocks[0].data+=' ';await route.fulfill({response,json:value});});
  await expect(target.evaluate(()=>(window as any).sync())).rejects.toThrow('library_sync_head_changed');const after=await inspect(target);expect(advanced).toBe(true);expect(after.identity).toEqual(before.identity);expect(after.base).toEqual(before.base);expect(after.drafts).toEqual(before.drafts);expect(after.state.restore).toBeUndefined();
 }finally{await f.close();}
});

test('cancellation during native download preserves the old selected library',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{const {account}=await seed(f),target=await f.createClient(account),before=await inspect(target);
  await expect(target.evaluate(async()=>{const c=new AbortController();await(window as any).core.synchronizeLibrary((window as any).request,{signal:c.signal,onProgress:(value:any)=>{if(value.phase==='snapshot-download'&&value.completed>0)c.abort();}});})).rejects.toThrow('library_sync_cancelled');
  const after=await inspect(target);expect(after.identity).toEqual(before.identity);expect(after.base).toEqual(before.base);expect(after.drafts).toEqual(before.drafts);expect(after.state.restore).toBeUndefined();
 }finally{await f.close();}
});

test('a native receiver keeps sparse single-change and unchanged synchronization',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{const {account,source}=await seed(f),target=await f.createClient(account);await target.evaluate(()=>(window as any).sync());await save(target,'one real change after native restore');await target.evaluate(()=>(window as any).sync());await source.evaluate(()=>(window as any).sync());
  const left=await inspect(source),right=await inspect(target);expect(left.drafts).toEqual(right.drafts);expect(left.drafts).toHaveLength(2);expect(left.base).toEqual(right.base);expect(left.state.revision).toBe(2);expect(right.state.revision).toBe(2);
  f.clearRequests();await target.evaluate(()=>(window as any).core.synchronizeLibrary((window as any).request,{backgroundVerification:true}));expect(f.requests().map(row=>row.path)).toEqual(['/sensa/library-sync/head']);const unchanged=await inspect(target);expect(unchanged.drafts).toEqual(right.drafts);expect(unchanged.base).toEqual(right.base);expect(unchanged.state.status).toBe('synced');
 }finally{await f.close();}
});

test('source preparation can be skipped or cancelled without making confirmed facts dirty',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{const account=await f.createAccount(),source=await f.createClient(account);await save(source,'facts remain synced when source preparation stops');expect(await source.evaluate(()=>(window as any).sync())).toMatchObject({initialPublicationConfirmed:true});const before=await inspect(source);
  f.clearRequests();await source.evaluate(()=>(window as any).core.synchronizeLibrary((window as any).request,{publishSnapshot:'if-large'}));expect(f.requests().map(row=>row.path)).toEqual(['/sensa/library-sync/head']);
  await expect(source.evaluate(async()=>{const controller=new AbortController();await(window as any).core.synchronizeLibrary((window as any).request,{publishSnapshot:true,signal:controller.signal,onProgress:(p:any)=>{if(p.phase==='snapshot-source-copy')controller.abort();}});})).rejects.toThrow('library_sync_cancelled');
  expect(await inspect(source)).toEqual(before);expect((await source.evaluate(()=>(window as any).request('/head'))).nativeSnapshot).toBeUndefined();
  await source.evaluate(()=>(window as any).core.synchronizeLibrary((window as any).request,{publishSnapshot:true}));const again=await source.evaluate(()=>(window as any).core.synchronizeLibrary((window as any).request,{publishSnapshot:true}));expect(again.snapshotAlreadyPublished.revision).toBe(1);expect((await inspect(source)).state.status).toBe('synced');
 }finally{await f.close();}
});
