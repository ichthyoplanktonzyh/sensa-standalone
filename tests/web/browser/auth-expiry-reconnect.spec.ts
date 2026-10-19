import {expect} from '@playwright/test';
import {createPackageCenterFixture} from './packageCenterFixture';

const fixture=createPackageCenterFixture('auth-expiry');
const test=fixture.test;

for(const wake of ['online','foreground'] as const){
 test(`an expired access token with a valid refresh token recovers in place on ${wake} without replaying offline learning`,async({page,context},testInfo)=>{
  fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
  const initial=fixture.session(),entryTime=Date.now();
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
  const runtime=await fixture.startOrdinaryBook(page);
  await runtime.getByRole('button',{name:/查看表达/}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('sensa-cloud-checkpoint-requested')));
  await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus()),{timeout:60_000}).toBe('synced');
  const beforeRevision=fixture.cloudRevision,beforeCommits=commits;
  const documentId=await page.evaluate(()=>{
   const id=crypto.randomUUID();(window as any).__authReconnectDocumentId=id;return id;
  });
  let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  const owner=await page.evaluate(async()=>{const rows=(await window.__sensaBrowserSmoke!.durableBackupFactsForTest(true)).meta!;return rows.find(row=>row.key==='service-owner');});
  authReachable=false;await context.setOffline(true);
  if(wake==='foreground')await page.evaluate(()=>{
   Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
   document.dispatchEvent(new Event('visibilitychange'));
   // Isolate foreground recovery from the separate online-event branch.
   window.addEventListener('online',event=>event.stopImmediatePropagation(),{capture:true,once:true});
  });
  authTime=entryTime+3601_000;
  await page.clock.setFixedTime(authTime);
  await runtime.getByRole('button',{name:/已经连上/}).click();
  await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
  await expect(page.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
  await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
  const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
  const learning=await page.evaluate(()=>window.__sensaBrowserSmoke!.rawLearningFactsForTest());
  const identity=(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity;
  expect(fixture.cloudRevision).toBe(beforeRevision);
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).refresh_token,fixture.storageKey)).toBe(initial.refresh_token);
  authReachable=true;await context.setOffline(false);
  if(wake==='foreground'){
   expect(refreshes).toBe(0);expect(fixture.cloudRevision).toBe(beforeRevision);
   // Controlled document visibility wakes the application's sync coordinator;
   // its normal SDK getSession call owns refresh.
   await page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
   });
  }
  await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus()),{timeout:90_000}).toBe('synced');
  await expect(page.getByRole('button',{name:'完成并回到首页',exact:true})).toBeEnabled();
  expect(refreshes).toBe(1);expect(refreshRequests).toEqual([{grant:'refresh_token',accepted:true}]);
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).refresh_token,fixture.storageKey)).toBe(refreshToken);
  expect(commits-beforeCommits).toBe(1);expect(fixture.cloudRevision).toBe(beforeRevision+1);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.rawLearningFactsForTest())).toEqual(learning);
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toEqual(identity);
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true))).meta!.find(row=>row.key==='service-owner')).toEqual(owner);
  expect(await page.evaluate(()=>(window as any).__authReconnectDocumentId)).toBe(documentId);expect(navigations).toBe(0);
  const checkpoint=await page.evaluate(()=>window.__sensaBrowserSmoke!.cloudSyncStateForTest());
  const evidence={wake,clocks:{realElapsedMs:Date.now()-entryTime,businessAndClientNow:authTime,controlledAuthServerNow:authTime,osClockChanged:false},refreshes,rotatedRefreshTokenPersisted:true,commits:commits-beforeCommits,cloudRevision:fixture.cloudRevision,checkpoint,learning,mainFrameNavigations:navigations,sameDocument:true,limits:'Real SDK/Web/OPFS; controlled Auth and sync HTTP, controlled visibility events; no claim of days of elapsed real time or hosted-provider acceptance.'};
  await testInfo.attach('auth-reconnect-evidence',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
 });
}

test('a rejected expired refresh token requires login while preserving offline facts and the original owner',async({page,context},testInfo)=>{
 fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 const initial=fixture.session(),entryTime=Date.now();let refreshes=0,authReachable=true;
 await page.clock.setFixedTime(entryTime);
 await page.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:fixture.storageKey,value:initial});
 await context.route('**/auth/v1/token*',async route=>{if(!authReachable){await route.abort('internetdisconnected');return;}refreshes++;await route.fulfill({status:400,json:{code:'refresh_token_not_found',message:'Invalid Refresh Token: Refresh Token Not Found'}});});
 await page.goto(fixture.origin+'/profile');await expect(page.getByText('已连接账号',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
 await page.evaluate(()=>window.dispatchEvent(new Event('sensa-cloud-checkpoint-requested')));
 await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus()),{timeout:60_000}).toBe('synced');
 const owner=(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true))).meta!.find(row=>row.key==='service-owner');
 const identity=(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity;
 const cloudBefore={revision:fixture.cloudRevision,manifest:fixture.cloudManifest,blocks:[...fixture.cloudBlocks]};
 authReachable=false;await context.setOffline(true);await page.clock.setFixedTime(entryTime+3601_000);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 authReachable=true;await context.setOffline(false);
 await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),fixture.storageKey),{timeout:90_000}).toBeNull();
 await page.locator('#settings-security').click();
 await expect(page.getByRole('button',{name:'登录 Sensa',exact:true})).toBeVisible();
 await expect(page.getByText('已连接账号',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'登录 Sensa',exact:true}).click();
 await expect(page.getByRole('button',{name:'发送验证码',exact:true})).toBeEnabled();
 expect(refreshes).toBe(1);
 expect({revision:fixture.cloudRevision,manifest:fixture.cloudManifest,blocks:[...fixture.cloudBlocks]}).toEqual(cloudBefore);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toEqual(identity);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true))).meta!.find(row=>row.key==='service-owner')).toEqual(owner);
 // A different account is the existing wrong-owner regression's independent
 // branch; this test never injects another identity to fake refresh recovery.
 await testInfo.attach('rejected-refresh-evidence',{body:JSON.stringify({refreshes,cloudRevision:fixture.cloudRevision,ownerPreserved:true,offlineFactsPreserved:true,newTokenInjected:false,realElapsedMs:Date.now()-entryTime,controlledClientElapsedMs:3601_000}),contentType:'application/json'});
});

test('a retryable offline refresh failure recovers when the client clock reaches the SDK retry window',async({page,context},testInfo)=>{
 fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 const initial=fixture.session(),entryTime=Date.now();let authTime=entryTime,refreshes=0,offlineRefreshFailures=0,commits=0,authReachable=true;
 let authAssetUrl:string|undefined;
 page.on('response',response=>{if(/\/assets\/auth-[^/]+\.js$/u.test(new URL(response.url()).pathname))authAssetUrl=response.url();});
 const evidence:any={entryTime,scope:'Real SDK/Web/OPFS; native network outage; controlled client/Auth clocks and HTTP, not real elapsed hours.'};
 await page.clock.setFixedTime(entryTime);
 await page.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:fixture.storageKey,value:initial});
 await context.route('**/auth/v1/token*',async route=>{
  if(!authReachable){await route.abort('internetdisconnected');return;}
  expect(route.request().postDataJSON().refresh_token).toBe(initial.refresh_token);refreshes++;
  const expiresAt=Math.floor(authTime/1000)+3600,[header,payload]=initial.access_token.split('.');
  const accessToken=[header,Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(payload!,'base64url').toString()),exp:expiresAt})).toString('base64url'),'fixture-signature'].join('.');
  await route.fulfill({json:{...initial,access_token:accessToken,expires_at:expiresAt,refresh_token:'rotated-after-outage'}});
 });
 page.on('requestfailed',request=>{if(new URL(request.url()).pathname==='/auth/v1/token')offlineRefreshFailures++;});
 page.on('request',request=>{if(new URL(request.url()).pathname==='/sensa/library-sync/commit')commits++;});
 await page.goto(fixture.origin+'/profile');await expect(page.getByText('已连接账号',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
 await page.evaluate(()=>window.dispatchEvent(new Event('sensa-cloud-checkpoint-requested')));
 await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus()),{timeout:60_000}).toBe('synced');
 const revision=fixture.cloudRevision,beforeCommits=commits;
 const owner=(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true))).meta!.find(row=>row.key==='service-owner');
 authReachable=false;await context.setOffline(true);authTime=entryTime+3601_000;await page.clock.setFixedTime(authTime);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 try{
  expect(authAssetUrl).toBeTruthy();
  // Reuse the already loaded production SDK instance. This establishes the
  // same network-failed refresh as a background SDK tick, without asking the
  // account UI to pre-emptively unmount its online sync coordinator.
  evidence.offlineSdkResult=await page.evaluate(async url=>{
   const module=await import(/* @vite-ignore */url!);
   const auth=Object.values(module).find((value:any)=>typeof value?.getSession==='function') as any;
   if(!auth)throw Error('production_auth_export_missing');
   const {data,error}=await auth.getSession();return {subject:data.session?.user.id??null,error:error?.name??null};
  },authAssetUrl);
  expect(evidence.offlineSdkResult).toEqual({subject:null,error:'AuthRetryableFetchError'});
  expect(offlineRefreshFailures).toBeGreaterThan(0);
  await page.locator('#settings-security').click();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).refresh_token,fixture.storageKey)).toBe(initial.refresh_token);
  authReachable=true;await context.setOffline(false);
  await expect(page.getByRole('button',{name:'登录 Sensa',exact:true})).toBeVisible();
  expect(refreshes).toBe(0);expect(fixture.cloudRevision).toBe(revision);
  evidence.frozenClockState=await page.evaluate(()=>window.__sensaBrowserSmoke!.cloudSyncStateForTest());
  // A business-only fixed Date cannot expire a Date-based SDK cooldown. Advance
  // both controlled clocks; real applications get this progression from time.
  authTime+=61_000;await page.clock.setFixedTime(authTime);
  await page.evaluate(()=>{
   Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));
   Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus()),{timeout:30_000}).toBe('synced');
  expect(refreshes).toBe(1);expect(commits-beforeCommits).toBe(1);expect(fixture.cloudRevision).toBe(revision+1);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true))).meta!.find(row=>row.key==='service-owner')).toEqual(owner);
 }finally{
  Object.assign(evidence,{realElapsedMs:Date.now()-entryTime,controlledClientNow:authTime,offlineRefreshFailures,successfulRefreshes:refreshes,commits:commits-beforeCommits,cloudRevision:fixture.cloudRevision,finalState:await page.evaluate(()=>window.__sensaBrowserSmoke!.cloudSyncStateForTest())});
  await testInfo.attach('retryable-refresh-evidence',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
 }
});
