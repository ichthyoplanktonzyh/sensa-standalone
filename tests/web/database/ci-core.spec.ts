/** Fixed four-case CI gate. Each case owns an empty browser context; only a
 * one-expression Book and one valid Meaning are prepared. Long specialists
 * retain their original fixtures and assertions in their original files. */
import {test,expect,type Page,type Locator} from '@playwright/test';
import {createLibrarySyncPageFixture,loginSyncPage,syncPanel,restoringSyncStatus} from '../support/librarySyncPageFixture.mts';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {semanticLookupPayload} from '../support/semanticLookupFixtures';
import {assertInteractionBudget} from '../support/interactionBudget';
import type {} from '../../../apps/web/src/browserSmokeBridge';

declare global{interface Window{semanticDetailPaint?:{startedAt:number;elapsedMs:number|null}}}
let fixture:Awaited<ReturnType<typeof createLibrarySyncPageFixture>>;
test.setTimeout(180_000);
test.beforeAll(async({browser})=>{
 test.setTimeout(180_000);
 fixture=await createLibrarySyncPageFixture(browser,{singleBook:true});
});
test.afterAll(async()=>{await fixture?.close();});
const checkpoint=(page:Page)=>page.evaluate(()=>window.__sensaBrowserSmoke!.cloudCheckpointForTest());
const facts=(page:Page)=>page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());

test('manual authoring at 0 Meanings needs Context and explicit acceptance, stays offline, and reopens',async({},testInfo)=>{
 const size=0,modelCalls:string[]=[];
 const page=await fixture.client();
 page.on('request',request=>{if(/chat\/completions|semantic-agent|\/tts|\/sensa\/model\/|model.*execute/.test(request.url()))modelCalls.push(request.url());});
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 test.setTimeout(180_000);
 page.setDefaultTimeout(15_000);
 const open=async()=>{await page.getByRole('button',{name:'添加内容',exact:true}).click();await page.getByRole('button',{name:'手动创建',exact:true}).click();};
 await open();const form=page.locator('.sensa-manual-meaning');
 await expect(form.getByLabel('情境或原句',{exact:true})).toBeEnabled();
 await form.getByLabel('原文中的表达（可在上方选中）',{exact:true}).fill('backed out');
 await form.getByRole('button',{name:'确认并保存',exact:true}).click();
 if(!size)expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticWorldContainsExpression('back out'))).toBe(false);
 await form.getByLabel('情境或原句',{exact:true}).fill('She backed out of the trip. I backed out too.');
 await form.getByLabel('表达语言',{exact:true}).selectOption('en');
 await form.getByLabel('表达类型',{exact:true}).selectOption('phrase');
 await form.getByLabel('这里表达的意思',{exact:true}).fill('退出已经答应参加的活动。');
 await form.getByText('这个意思适用的典型场景',{exact:true}).click();await form.getByLabel('这个意思适用的典型场景',{exact:true}).fill('有人答应参加活动，后来改变主意不再参加。');
 await form.getByText('表达原形（可选）',{exact:true}).click();
 await form.getByLabel('表达原形（可选）',{exact:true}).fill('back out');
 await form.getByRole('button',{name:'确认并保存',exact:true}).click();await expect(form.getByRole('alert')).toContainText('准确位置');
 await form.getByRole('radio').last().check();
 if(!size){
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('manual-meaning-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});
 }
 await form.getByRole('button',{name:'关闭',exact:true}).click();
 if(!size)expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticWorldContainsExpression('back out'))).toBe(false);
 await page.reload();await open();
 await expect(form.getByLabel('这里表达的意思',{exact:true})).toHaveValue('退出已经答应参加的活动。');
 await expect(form.getByRole('radio').last()).toBeChecked();
 if(!size){
  // Fail only this editing draft's durable retry write, then exercise the UI retry.
  await page.evaluate(()=>{
   const original=Storage.prototype.setItem;
   Storage.prototype.setItem=function(key,value){if(key.includes('manual-meaning:')){Storage.prototype.setItem=original;throw new DOMException('fixture quota exceeded','QuotaExceededError');}return original.call(this,key,value);};
  });
  await form.getByRole('button',{name:'确认并保存',exact:true}).click();
  await expect(form.getByRole('alert')).toContainText('内容已保留');
  await expect(form.getByLabel('这里表达的意思',{exact:true})).toHaveValue('退出已经答应参加的活动。');
 }
 await page.context().setOffline(true);
 const started=await page.evaluate(()=>performance.now());
 const readyMs=await clickToMeaningReady(page,form.getByRole('button',{name:'确认并保存',exact:true}),'back out');
 await expect(form).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'back out',exact:true})).toBeVisible();
 await expect(page.getByText('退出已经答应参加的活动。',{exact:true}).first()).toBeVisible();
 const timing=await page.evaluate(started=>({durationMs:performance.now()-started,phases:performance.getEntriesByType('measure').filter(entry=>entry.startTime>=started&&entry.name.startsWith('sensa.journey.')).map(entry=>entry.name)}),started);
 console.log('Manual click to readable stable actionable detail / Chromium+OPFS / no model',JSON.stringify({size,readyMs,...timing}));
 expect(timing.phases).not.toContain('sensa.journey.records');expect(timing.phases).not.toContain('sensa.journey.authority');
 assertInteractionBudget(readyMs,1000,'manual meaning confirmation');
 const savedUrl=page.url();
 const learning=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(learning.targetIds).toEqual([]);expect(learning.records).toEqual([]);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);
 await page.context().setOffline(false);await page.reload();
 await expect(page.getByRole('heading',{name:'back out',exact:true})).toBeVisible();
 expect(page.url()).toBe(savedUrl);
 if(!size)expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticWorldContainsExpression('back out'))).toBe(true);
 expect(modelCalls).toEqual([]);
 await page.screenshot({path:testInfo.outputPath('manual-meaning-detail.png'),fullPage:true});
});

test('a guest learns a Book through the UI and resumes the revealed step after reload',async()=>{
  const page=await fixture.client();
  await page.goto(fixture.origin);
  await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
  const home=page.locator('#s-home');
  await expect(home.getByRole('heading',{name:'今天',level:1,exact:true})).toBeVisible({timeout:15_000});
  const catalogAction=home.getByRole('button',{name:'学习包目录',exact:true}).and(home.locator('[data-sensa-component="action"][data-sensa-variant="primary"]'));
  await expect(catalogAction).toBeEnabled();
  await expect(home.getByRole('button',{name:'开始学习',exact:true})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('guest-home.png'),fullPage:true});
  await catalogAction.click();
  const catalog=page.locator('#s-catalog').last();
  await catalog.getByRole('button',{name:/雨天借伞/}).click();
  const book=page.locator('#s-catalog-book').last();
  await book.getByRole('button',{name:'下载学习包',exact:true}).click();
  await expect(book.getByText('已下载',{exact:true})).toBeVisible({timeout:15_000});
  await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
  await page.screenshot({path:test.info().outputPath('downloaded-book.png'),fullPage:true});
  // A reload must retain installation without inventing learning membership.
  await page.reload();
  await expect(book.getByText('已下载',{exact:true})).toBeVisible({timeout:15_000});
  await expect(book.getByText('已加入学习',{exact:true})).toHaveCount(0);
  await book.getByRole('button',{name:'加入学习',exact:true}).click();
  await expect(book.getByText('已加入学习',{exact:true})).toBeVisible();
  await book.getByRole('button',{name:'去学习',exact:true}).click();
  await expect(home.getByRole('heading',{name:'今天',level:1,exact:true})).toBeVisible();
  await home.getByRole('button',{name:'开始学习',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'学习偏好',exact:true})).toHaveCount(0);
  const runtime=page.locator('#s-lightweight-runtime');
  await expect(runtime.getByRole('button',{name:/查看表达/})).toBeVisible({timeout:15_000});
  await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toHaveCount(0);
  const firstArrangement=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
  expect(firstArrangement.session!.dailyNewSenseLimit).toBe(20);
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toHaveLength(0);
  const beforeMenu=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
  const more=runtime.getByRole('button',{name:'更多',exact:true});
  await more.click();await expect(page.getByRole('dialog',{name:'更多',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'更多',exact:true})).toHaveCount(0);await expect(more).toBeFocused();
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(beforeMenu.runtime);
  await more.click();await expect(page.getByRole('dialog',{name:'更多',exact:true})).toBeVisible();
  await page.locator('#menu-more [data-sensa-slot="backdrop"]').click({position:{x:4,y:4}});
  await expect(page.getByRole('dialog',{name:'更多',exact:true})).toHaveCount(0);
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(beforeMenu.runtime);
  await runtime.getByRole('button',{name:/查看表达/}).click();
  await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('revealed-expression.png'),fullPage:true});
  // Read-only facts strengthen the UI oracle; no commands are issued through the bridge.
  const revealed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
  expect(revealed.runtime?.runId).toBeTruthy();
  expect(revealed.runtime?.stepId).toBeTruthy();
  expect(revealed.runtime?.materializationId).toBeTruthy();
  expect(revealed.records).toHaveLength(0);
  await page.reload();
  await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible({timeout:15_000});
  await expect(runtime.getByRole('button',{name:/查看表达/})).toHaveCount(0);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(revealed);
  const restoredReads=await page.evaluate(()=>performance.getEntriesByType('measure').map(entry=>entry.name));
  expect(restoredReads).toContain('sensa.workspace.runtime');
  expect(restoredReads).not.toContain('sensa.workspace.rehydrate');
  expect(restoredReads).not.toContain('sensa.workspace.supply');
  expect(restoredReads).not.toContain('sensa.workspace.prepare');
  await runtime.getByRole('button',{name:'暂停',exact:true}).click();
  await expect(home.getByRole('button',{name:'继续学习',exact:true})).toBeVisible();
  await page.reload();
  await expect(home.getByRole('button',{name:'继续学习',exact:true})).toBeVisible({timeout:15_000});
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
  await page.locator('#s-study').getByRole('button',{name:'学习偏好',exact:true}).click();
  const savedPreferences=page.getByRole('dialog',{name:'学习偏好',exact:true});
  await expect(savedPreferences.getByRole('combobox',{name:'每日新学数量',exact:true})).toHaveValue('20');
  await expect(savedPreferences.getByRole('radiogroup')).toHaveCount(0);
  await expect(savedPreferences.getByText('默认学习方式',{exact:true})).toHaveCount(0);
  await savedPreferences.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'今日',exact:true}).click();
  await home.getByRole('button',{name:'继续学习',exact:true}).click();
  await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(revealed);
  await runtime.getByRole('button',{name:/已经连上/}).click();
  await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
  await runtime.getByRole('button',{name:/完成并回到首页/}).click();
  await expect(home.getByRole('heading',{name:'今天',level:1,exact:true})).toBeVisible();
  await expect(home.getByRole('button',{name:'继续学习',exact:true})).toHaveCount(0);
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
  const study=page.locator('#s-study');
  await study.locator('summary').filter({hasText:'最近记录'}).click();
  const history=study.locator('ol');
  await expect(history.getByRole('button',{name:/borrow/})).toHaveCount(1);
  const completed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
  expect(completed.runtime).toBeNull();
  expect(completed.records).toHaveLength(1);
  expect(completed.records[0]!.targetId).toBe(revealed.runtime!.targetId);
  expect(completed.records[0]!.kind).toBe('initial_learning');
  expect(completed.completedTargets).toHaveLength(1);
  expect(completed.completedTargets[0]!.nextReviewAt).not.toBeNull();
  await page.reload();
  await study.locator('summary').filter({hasText:'最近记录'}).click();
  await expect(history.getByRole('button',{name:/borrow/})).toHaveCount(1);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(completed);
  // Move only the browser clock to the due date actually produced by learning.
  // Neither a target nor a scheduling result is seeded by the test.
  await page.clock.setFixedTime(new Date(Date.parse(completed.completedTargets[0]!.nextReviewAt!)+60_000));
  await page.goto(fixture.origin);
  await expect(home.getByRole('button',{name:'开始 / 继续复习',exact:true})).toBeVisible({timeout:15_000});
  await page.context().setOffline(true);
  try{
    await home.getByRole('button',{name:'开始 / 继续复习',exact:true}).click();
    await expect(runtime.getByRole('button',{name:/查看表达/})).toBeVisible();
    const review=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
    expect(review.runtime!.targetId).toBe(completed.records[0]!.targetId);
    expect(review.runtime!.runId).not.toBe(revealed.runtime!.runId);
    await runtime.getByRole('button',{name:/查看表达/}).click();
    await runtime.getByRole('button',{name:/顺利想起/}).click();
    await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
    await runtime.getByRole('button',{name:/完成并回到首页/}).click();
    const reviewed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
    expect(reviewed.records).toHaveLength(2);
    expect(reviewed.records.map(record=>record.kind).sort()).toEqual(['initial_learning','retention_review']);
    expect(reviewed.records.every(record=>record.targetId===completed.records[0]!.targetId)).toBe(true);
    expect(Date.parse(reviewed.completedTargets[0]!.nextReviewAt!)).toBeGreaterThan(Date.parse(completed.completedTargets[0]!.nextReviewAt!));
  }finally{await page.context().setOffline(false);}
});

test('an expired access token with a valid refresh token recovers in place on online without replaying offline learning',async({},testInfo)=>{
  const wake='online',account=await fixture.api.createAccount(),page=await fixture.client(account),context=page.context();
  const revision=async()=>{
   const response=await fetch(fixture.api.origin+'/sensa/library-sync/head',{headers:{authorization:'Bearer '+account.token}});
   expect(response.ok).toBe(true);return (await response.json() as {revision:number}).revision;
  };
  const initial=fixture.session(account),entryTime=Date.now();
  let authTime=entryTime,refreshToken=initial.refresh_token,refreshes=0,commits=0,authReachable=true;
  const refreshRequests:{grant:string|null;accepted:boolean}[]=[];
  await page.clock.setFixedTime(entryTime);
  // Setup only: subsequent rotation and persistence are entirely SDK-owned.
  await page.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:fixture.storageKey,value:initial});
  await context.route('**/auth/v1/token*',async route=>{
   if(!authReachable){await route.abort('internetdisconnected');return;}
   const request=route.request(),grant=new URL(request.url()).searchParams.get('grant_type');
   const accepted=grant==='refresh_token'&&request.postDataJSON().refresh_token===refreshToken;
   refreshRequests.push({grant,accepted});
   if(!accepted){await route.fulfill({status:400,json:{code:'refresh_token_not_found',message:'Invalid Refresh Token: Refresh Token Not Found'}});return;}
   refreshes++;refreshToken=`rotated-test-refresh-${refreshes}`;
   const expiresAt=Math.floor(authTime/1000)+3600;
   const [header,payload]=initial.access_token.split('.');
   const claims={...JSON.parse(Buffer.from(payload!,'base64url').toString()),exp:expiresAt};
   const accessToken=[header,Buffer.from(JSON.stringify(claims)).toString('base64url'),'fixture-signature'].join('.');
   const next={...initial,access_token:accessToken,refresh_token:refreshToken,expires_in:3600,expires_at:expiresAt};
   await route.fulfill({json:next});
  });
  page.on('request',request=>{if(new URL(request.url()).pathname==='/sensa/library-sync/commit')commits++;});
  await page.goto(fixture.origin+'/profile');await expect(page.getByText('已连接账号',{exact:true})).toBeVisible();
  const runtime=await startOrdinaryBook(page);
  await runtime.getByRole('button',{name:/查看表达/}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('sensa-cloud-checkpoint-requested')));
  await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus()),{timeout:60_000}).toBe('synced');
  const beforeRevision=await revision(),beforeCommits=commits;
  const documentId=await page.evaluate(()=>{
   const id=crypto.randomUUID();(window as any).__authReconnectDocumentId=id;return id;
  });
  let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  const owner=await page.evaluate(async()=>{const rows=(await window.__sensaBrowserSmoke!.durableBackupFactsForTest(true)).meta!;return rows.find(row=>row.key==='service-owner');});
  authReachable=false;await context.setOffline(true);
  authTime=entryTime+3601_000;
  await page.clock.setFixedTime(authTime);
  await runtime.getByRole('button',{name:/已经连上/}).click();
  await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
  await expect(page.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
  await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
  const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
  const learning=await page.evaluate(()=>window.__sensaBrowserSmoke!.rawLearningFactsForTest());
  const identity=(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity;
  expect(await revision()).toBe(beforeRevision);
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).refresh_token,fixture.storageKey)).toBe(initial.refresh_token);
  authReachable=true;await context.setOffline(false);
  await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus()),{timeout:90_000}).toBe('synced');
  await expect(page.getByRole('button',{name:'完成并回到首页',exact:true})).toBeEnabled();
  expect(refreshes).toBe(1);expect(refreshRequests).toEqual([{grant:'refresh_token',accepted:true}]);
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).refresh_token,fixture.storageKey)).toBe(refreshToken);
  expect(commits-beforeCommits).toBe(1);expect(await revision()).toBe(beforeRevision+1);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.rawLearningFactsForTest())).toEqual(learning);
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toEqual(identity);
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true))).meta!.find(row=>row.key==='service-owner')).toEqual(owner);
  expect(await page.evaluate(()=>(window as any).__authReconnectDocumentId)).toBe(documentId);expect(navigations).toBe(0);
  const checkpoint=await page.evaluate(()=>window.__sensaBrowserSmoke!.cloudSyncStateForTest());
  const evidence={wake,clocks:{realElapsedMs:Date.now()-entryTime,businessAndClientNow:authTime,controlledAuthServerNow:authTime,osClockChanged:false},refreshes,rotatedRefreshTokenPersisted:true,commits:commits-beforeCommits,cloudRevision:await revision(),checkpoint,learning,mainFrameNavigations:navigations,sameDocument:true,limits:'Real SDK/Web/OPFS; controlled external Auth HTTP; real sync API/PostgreSQL; no claim of days of elapsed real time or hosted-provider acceptance.'};
  await testInfo.attach('auth-reconnect-evidence',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
 });

test('real pages publish a native artifact, restore, edit, sync incrementally and reopen without rebuilding the artifact',async({},info)=>{
 const f=fixture;
 const account=await f.api.createAccount(),source=await f.client(account);await source.goto(f.origin+'/profile');await expect(source.locator('#s-profile')).toBeVisible();
  const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
  await source.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
  await loginSyncPage(source,f.origin);await expect.poll(()=>source.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus())).toBe('synced');
  const panel=await syncPanel(source,f.origin);await panel.getByRole('button',{name:'为新设备准备资料',exact:true}).click();await expect(panel.getByText('已为新设备准备好账号资料。',{exact:true})).toBeVisible({timeout:60000});
  const target=await f.client(account);await loginSyncPage(target,f.origin);await expect.poll(()=>restoringSyncStatus(target),{timeout:60000}).toBe('synced');
  const before=await checkpoint(source),restored=await checkpoint(target);expect(restored.state).toMatchObject({restore:{path:'native-v2'},status:'synced'});expect(restored.refs.length).toBeGreaterThan(0);expect(restored.refs).toEqual(before.refs);expect(await facts(target)).toEqual(await facts(source));
  await target.goto(f.origin+'/content');await target.locator('.sensa-world-row').first().click();await target.getByRole('button',{name:'编辑场景',exact:true}).click();await target.getByRole('textbox',{name:'场景',exact:true}).fill('I asked to borrow an umbrella and returned it that evening.');await target.getByRole('button',{name:'保存场景',exact:true}).click();await expect(target.getByRole('textbox',{name:'场景',exact:true})).toHaveCount(0);
  f.api.clearRequests();const targetPanel=await syncPanel(target,f.origin);await targetPanel.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(async()=>(await checkpoint(target)).state?.revision).toBeGreaterThan(before.state!.revision);
  const sourcePanel=await syncPanel(source,f.origin);await sourcePanel.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(async()=>(await checkpoint(source)).state?.revision).toBe((await checkpoint(target)).state!.revision);
  expect((await checkpoint(source)).state?.receive).toMatchObject({mode:'incremental',changedRecords:4,baselineBuildRecords:0});
  expect(f.api.requests().some(row=>row.path.endsWith('/compact'))).toBe(false);expect(await facts(target)).toEqual(await facts(source));expect((await checkpoint(target)).refs).toEqual((await checkpoint(source)).refs);
  const stable=await facts(target);await target.reload();await expect.poll(()=>target.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus())).toBe('synced');expect(await facts(target)).toEqual(stable);
  await info.attach('real-page-checkpoint.json',{body:JSON.stringify({auth:'synthetic HTTP; real SDK',source:before.state,receiver:restored.state,nonemptyRefs:restored.refs.length,incrementalRevision:(await checkpoint(target)).state?.revision,requests:f.api.requests()}),contentType:'application/json'});
});

async function clickToMeaningReady(page:Page,action:Locator,label:string,readyAction='编辑场景'){
 await page.evaluate(({label,readyAction})=>{
  window.semanticDetailPaint={startedAt:0,elapsedMs:null};
  document.addEventListener('click',()=>{
   const measure=window.semanticDetailPaint!;measure.startedAt=performance.now();
   let previousGeometry:string|null=null;
   const painted=()=>{
    const heading=document.querySelector<HTMLElement>('.pmw-screen.active article[aria-label="表达详情"] h2');
    const article=heading?.closest('article');
    const edit=[...article?.parentElement?.querySelectorAll<HTMLButtonElement>('button')??[]].find(button=>button.textContent?.trim()===readyAction);
    const readable=(element:HTMLElement|undefined)=>{
     if(!element||element.closest('[inert],[aria-hidden="true"]')||!element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;
     const rect=element.getBoundingClientRect();
     if(rect.width<=0||rect.height<=0||rect.left<0||rect.right>innerWidth||rect.top<0||rect.bottom>innerHeight)return false;
     for(let ancestor:HTMLElement|null=element;ancestor;ancestor=ancestor.parentElement)if(ancestor.getAnimations().some(animation=>animation.playState==='running'))return false;
     const top=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
     return !!top&&(top===element||element.contains(top));
    };
    const ready=heading?.textContent===label&&readable(heading)&&readable(edit)&&!edit!.disabled;
    const geometry=ready?JSON.stringify([heading!.getBoundingClientRect().toJSON(),edit!.getBoundingClientRect().toJSON()]):null;
    if(geometry!==null&&geometry===previousGeometry){measure.elapsedMs=performance.now()-measure.startedAt;return;}
    previousGeometry=geometry;
    if(performance.now()-measure.startedAt<30_000)requestAnimationFrame(painted);
   };
   requestAnimationFrame(painted);
  },{once:true,capture:true});
 },{label,readyAction});
 await action.click();await expect(page.getByRole('heading',{name:label,exact:true})).toBeVisible({timeout:30_000});
 await expect.poll(()=>page.evaluate(()=>window.semanticDetailPaint?.elapsedMs)).not.toBeNull();
 return (await page.evaluate(()=>window.semanticDetailPaint!.elapsedMs))!;
}

async function startOrdinaryBook(page:Page,title=/雨天借伞/){
 await page.goto(`${fixture.origin}/catalog`);
 await page.locator('#s-catalog').last().getByRole('button',{name:title}).click();
 const book=page.locator('#s-catalog-book').last();
 await book.getByRole('button',{name:'下载学习包',exact:true}).click();
 await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled({timeout:15_000});
 await book.getByRole('button',{name:'加入学习',exact:true}).click();
 await expect(book.getByText('已加入学习',{exact:true})).toBeVisible();
 await book.getByRole('button',{name:'去学习',exact:true}).click();
 await page.locator('#s-home').getByRole('button',{name:'开始学习',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'学习偏好',exact:true})).toHaveCount(0);
 const runtime=page.locator('#s-lightweight-runtime');
 await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();
 await expect(page.locator('#s-home')).toHaveCount(0);
 return runtime;
}
