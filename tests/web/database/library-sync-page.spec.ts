import {test,expect,type Page} from '@playwright/test';
import {createLibrarySyncPageFixture,loginSyncPage,syncPanel} from '../support/librarySyncPageFixture.mts';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {semanticLookupPayload} from '../support/semanticLookupFixtures';
test.setTimeout(180000);
const checkpoint=(page:Page)=>page.evaluate(()=>window.__sensaBrowserSmoke!.cloudCheckpointForTest());
const facts=(page:Page)=>page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());

test('real pages publish a native artifact, restore, edit, sync incrementally and reopen without rebuilding the artifact',async({browser},info)=>{
 const f=await createLibrarySyncPageFixture(browser);
 try{const account=await f.api.createAccount(),source=await f.client(account);await source.goto(f.origin+'/profile');await expect(source.locator('#s-profile')).toBeVisible();
  const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
  await source.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
  await loginSyncPage(source,f.origin);await expect.poll(()=>source.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus())).toBe('synced');
  const panel=await syncPanel(source,f.origin);await panel.getByRole('button',{name:'为新设备准备资料',exact:true}).click();await expect(panel.getByText('已为新设备准备好账号资料。',{exact:true})).toBeVisible({timeout:60000});
  const target=await f.client(account);await loginSyncPage(target,f.origin);await expect.poll(()=>target.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus()),{timeout:60000}).toBe('synced');
  const before=await checkpoint(source),restored=await checkpoint(target);expect(restored.state).toMatchObject({restore:{path:'native-v2'},status:'synced'});expect(restored.refs.length).toBeGreaterThan(0);expect(restored.refs).toEqual(before.refs);expect(await facts(target)).toEqual(await facts(source));
  await target.goto(f.origin+'/content');await target.locator('.sensa-world-row').first().click();await target.getByRole('button',{name:'编辑场景',exact:true}).click();await target.getByRole('textbox',{name:'场景',exact:true}).fill('I asked to borrow an umbrella and returned it that evening.');await target.getByRole('button',{name:'保存场景',exact:true}).click();await expect(target.getByRole('textbox',{name:'场景',exact:true})).toHaveCount(0);
  f.api.clearRequests();const targetPanel=await syncPanel(target,f.origin);await targetPanel.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(async()=>(await checkpoint(target)).state?.revision).toBeGreaterThan(before.state!.revision);
  const sourcePanel=await syncPanel(source,f.origin);await sourcePanel.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(async()=>(await checkpoint(source)).state?.revision).toBe((await checkpoint(target)).state!.revision);
  expect((await checkpoint(source)).state?.receive).toMatchObject({mode:'incremental',changedRecords:4,baselineBuildRecords:0});
  expect(f.api.requests().some(row=>row.path.endsWith('/compact'))).toBe(false);expect(await facts(target)).toEqual(await facts(source));expect((await checkpoint(target)).refs).toEqual((await checkpoint(source)).refs);
  const stable=await facts(target);await target.reload();await expect.poll(()=>target.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus())).toBe('synced');expect(await facts(target)).toEqual(stable);
  await info.attach('real-page-checkpoint.json',{body:JSON.stringify({auth:'synthetic HTTP; real SDK',source:before.state,receiver:restored.state,nonemptyRefs:restored.refs.length,incrementalRevision:(await checkpoint(target)).state?.revision,requests:f.api.requests()}),contentType:'application/json'});
 }finally{await f.close();}
});

test('real page source cancellation preserves confirmed facts and retry prepares the current head',async({browser})=>{
 const f=await createLibrarySyncPageFixture(browser);
 try{const account=await f.api.createAccount(),source=await f.client(account);await source.goto(f.origin+'/profile');await expect(source.locator('#s-profile')).toBeVisible();await source.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));await loginSyncPage(source,f.origin);await expect.poll(()=>source.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus())).toBe('synced');
  const before=await facts(source),panel=await syncPanel(source,f.origin);let held=false,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await source.route('**/sensa/library-sync/blocks/store',async route=>{held=true;await gate;await route.fallback();});
  await panel.getByRole('button',{name:'为新设备准备资料',exact:true}).click();await expect.poll(()=>held).toBe(true);await panel.getByRole('button',{name:'停止本次同步',exact:true}).click();release();
  await expect(panel.getByText('已停止新设备的资料准备。已同步的资料仍在。',{exact:true})).toBeVisible();expect(await source.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus())).toBe('synced');expect(await facts(source)).toEqual(before);
  await source.unroute('**/sensa/library-sync/blocks/store');await panel.getByRole('button',{name:'为新设备准备资料',exact:true}).click();await expect(panel.getByText('已为新设备准备好账号资料。',{exact:true})).toBeVisible({timeout:60000});
 }finally{await f.close();}
});

test('real page cancels an initial native receive, reopens honestly and retries through unavailable-artifact refs fallback',async({browser},info)=>{
 const f=await createLibrarySyncPageFixture(browser);
 try{const account=await f.api.createAccount(),source=await f.client(account);await source.goto(f.origin+'/profile');await expect(source.locator('#s-profile')).toBeVisible();await source.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));await loginSyncPage(source,f.origin);await expect.poll(()=>source.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus())).toBe('synced');
  const sourcePanel=await syncPanel(source,f.origin);await sourcePanel.getByRole('button',{name:'为新设备准备资料',exact:true}).click();await expect(sourcePanel.getByText('已为新设备准备好账号资料。',{exact:true})).toBeVisible({timeout:60000});
  const target=await f.client(account);let held=false,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await target.route('**/sensa/library-sync/blocks/fetch',async route=>{held=true;await gate;await route.fallback();});
  await loginSyncPage(target,f.origin);await target.locator('#settings-data').click();await expect.poll(()=>held).toBe(true);const panel=target.locator('.sensa-cloud-sync');await panel.getByRole('button',{name:'停止本次同步',exact:true}).click();release();await expect(panel.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();
  await target.unroute('**/sensa/library-sync/blocks/fetch');await target.reload();await expect(target.locator('#s-profile')).toBeVisible();await target.locator('#settings-data').click();expect(await target.evaluate(()=>window.__sensaBrowserSmoke!.draftCount())).toBe(0);expect((await checkpoint(target)).state?.status).not.toBe('synced');
  let unavailable=0;await target.route('**/sensa/library-sync/blocks/fetch',async route=>{if(unavailable++===0){await route.fulfill({status:404,json:{code:'library_sync_missing_block'}});return;}await route.fallback();});
  await target.locator('.sensa-cloud-sync').getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(()=>target.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus()),{timeout:60000}).toBe('synced');const result=await checkpoint(target);expect(result.state).toMatchObject({restore:{path:'refs',snapshotFailure:expect.stringContaining('library_sync_missing_block')}});expect(result.refs.length).toBeGreaterThan(0);expect(result.refs).toEqual((await checkpoint(source)).refs);expect(await facts(target)).toEqual(await facts(source));
  await info.attach('cancel-reopen-fallback.json',{body:JSON.stringify({state:result.state,nonemptyRefs:result.refs.length,unavailableRequests:unavailable}),contentType:'application/json'});
 }finally{await f.close();}
});
