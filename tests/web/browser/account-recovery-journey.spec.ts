/** Relocated account assertions: real Chromium/OPFS, controlled services. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {cpus,tmpdir} from 'node:os';
import {extname,join,resolve} from 'node:path';
import {chromium,expect,test as base,type Page,type BrowserContext,type TestInfo} from '@playwright/test';
import {unzipSync,zipSync} from 'fflate';
import {assertInteractionBudget} from '../support/interactionBudget';
import {portableBookMemberPath,readSensaPortableBook} from '@sensa/content-validator/portable-book';
import {canonicalConsumerJson,sensaPortableBookManifestSchema} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {cors} from 'hono/cors';
import {localSensaCorsOptions} from '../../../scripts/local/localCors.mts';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {semanticLookupPayload,syntheticSemanticWorld} from '../support/semanticLookupFixtures';
import type {JourneyState} from '../../../apps/web/src/experience/personalMeaningJourney/store';
import {createPackageCenterFixture} from './packageCenterFixture';
const fixture=createPackageCenterFixture('account');
const test=fixture.test;

test('checking an admitted service after same-page email login preserves the page and automatic sync through repeated checks and failures',async({page,context},testInfo)=>{
 fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 let sends=0,checks=0,hold=false,fail=false,release=()=>{};
 const paused=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/auth/v1/otp*',async route=>{sends++;expect(route.request().postDataJSON().create_user).toBe(false);await route.fulfill({json:{user:null,session:null}});});
 await page.route('**/auth/v1/verify*',route=>route.fulfill({json:fixture.session()}));
 await page.route('**/sensa/web/access/session',async route=>{checks++;if(hold)await paused;await route.fulfill(fail?{status:503,json:{code:'synthetic_service_unavailable'}}:{json:{authorized:true,accountId:fixture.account,capabilities:{publishLearningContent:false}}});});
 await page.goto(fixture.origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'登录 Sensa',exact:true}).click();
 await page.getByRole('button',{name:'继续使用已有本机内容',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'登录 Sensa',exact:true}).click();
 await page.getByLabel('邮箱',{exact:true}).fill('package-center@sensa.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();
 await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 await expect(page.getByText('已连接账号',{exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus())).toBe('synced');expect(fixture.cloudRevision).toBeGreaterThan(0);
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.locator('#settings-security').click();
 const check=page.getByRole('button',{name:'检查在线服务',exact:true});
 for(let attempt=0;attempt<2;attempt++){
  const before=checks;await check.click();await expect.poll(()=>checks).toBeGreaterThan(before);await expect(check).toBeEnabled();
  await expect(page.locator('#s-profile')).toBeVisible();await expect(page.getByRole('heading',{name:'输入邮箱验证码',exact:true})).toHaveCount(0);
 }
 const before=checks;hold=true;await check.click();await expect.poll(()=>checks).toBe(before+1);await expect(check).toBeDisabled();
 await check.dispatchEvent('click');expect(checks).toBe(before+1);
 await page.locator('#s-profile').getByRole('button',{name:'账号与设置',exact:true}).click();await page.locator('#settings-data').click();release();hold=false;
 await expect(page.getByText('已同步到账号',{exact:true})).toBeVisible();await page.locator('.sensa-cloud-sync summary').click();await expect(page.getByText(/连接账号后自动开始同步/)).toBeVisible();
 const screenshot=testInfo.outputPath('automatic-sync-after-service-check.png');await page.screenshot({path:screenshot});await testInfo.attach('automatic-sync-after-service-check',{path:screenshot,contentType:'image/png'});
 await page.locator('#s-profile').getByRole('button',{name:'账号与设置',exact:true}).click();await page.locator('#settings-security').click();fail=true;await check.click();
 await expect(page.getByRole('status').filter({hasText:'在线服务暂时不可用，请稍后重试。'})).toBeVisible();
 await expect(page.locator('#s-profile')).toBeVisible();expect(sends).toBe(1);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 fail=false;await page.getByRole('button',{name:'登录 Sensa',exact:true}).click();await expect(page.getByRole('heading',{name:'输入邮箱验证码',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'重新检查登录',exact:true}).click();await expect(page.getByText('已连接账号',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByText('已连接账号',{exact:true})).toBeVisible();expect(sends).toBe(1);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
});

test('invited email code login rejects unopened emails, admits the invited owner and keeps the session after reload',async({page,context})=>{
 fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 let sends=0,verifications=0;
 await page.route('**/auth/v1/otp*',async route=>{
  sends++;const body=route.request().postDataJSON();expect(body.create_user).toBe(false);
  await route.fulfill(body.email==='uninvited@sensa.invalid'?{status:422,headers:{'x-supabase-api-version':'2024-01-01'},json:{code:'otp_disabled',msg:'Signups not allowed for otp'}}:{json:{user:null,session:null}});
 });
 await page.route('**/auth/v1/verify*',async route=>{
  verifications++;expect(route.request().postDataJSON()).toMatchObject({email:'package-center@sensa.invalid',token:'123456',type:'email'});
  await route.fulfill({json:fixture.session()});
 });
 await page.goto(fixture.origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'登录 Sensa',exact:true}).click();
 await expect(page.getByText(/Sensa 正在邀请测试/)).toBeVisible();
 await page.getByLabel('邮箱',{exact:true}).fill('uninvited@sensa.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('该邮箱尚未开通邀请测试');expect(verifications).toBe(0);
 await expect(page.getByLabel('验证码',{exact:true})).toHaveCount(0);
 await page.getByLabel('邮箱',{exact:true}).fill('package-center@sensa.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();
 const code=page.getByLabel('验证码',{exact:true});await expect(code).toBeFocused();await expect(code).toHaveAttribute('autocomplete','one-time-code');
 await expect(page.getByRole('button',{name:'稍后可重新发送',exact:true})).toBeDisabled();
 await code.fill('12345');await page.getByRole('button',{name:'验证并继续',exact:true}).click();expect(verifications).toBe(0);
 await code.fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 await expect(page.getByText('已连接账号',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(before);
 await page.reload();await expect(page.getByText('已连接账号',{exact:true})).toBeVisible();expect(sends).toBe(2);expect(verifications).toBe(1);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(before);
 const runtime=await fixture.startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
});

test('previously issued email links still use a persisted PKCE challenge and preserve local facts after admission',async({page,context})=>{
 fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 let sent=0,exchanged=0,challenge='';
 await page.route('**/auth/v1/otp*',async route=>{
  const body=route.request().postDataJSON();sent++;
  expect(body.email).toBe('package-center@sensa.invalid');expect(body.code_challenge_method).toBe('s256');
  expect(body.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);challenge=body.code_challenge;
  const redirect=new URL(route.request().url()).searchParams.get('redirect_to');expect(redirect).toBe(fixture.origin+'/profile');
  await route.fulfill({json:{user:null,session:null}});
 });
 await page.route('**/auth/v1/token*',async route=>{
  exchanged++;expect(new URL(route.request().url()).searchParams.get('grant_type')).toBe('pkce');
  const body=route.request().postDataJSON();expect(body.auth_code).toBe('ordinary-login-code');
  expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(challenge);
  await route.fulfill({json:fixture.session()});
 });
 await page.goto(fixture.origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'登录 Sensa',exact:true}).click();
 await page.getByLabel('邮箱',{exact:true}).fill('package-center@sensa.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();
 await expect(page.getByRole('heading',{name:'输入邮箱验证码',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'稍后可重新发送',exact:true})).toBeDisabled();
 expect(sent).toBe(1);expect(exchanged).toBe(0);
 // Full navigation discards component memory: the SDK must recover its own
 // browser-stored verifier. The synthetic provider still does not send mail.
 await page.goto(fixture.origin+'/profile?code=ordinary-login-code');await expect(page.locator('#s-profile')).toBeVisible();
 await expect(page.getByRole('heading',{name:'当前账号',exact:true})).toBeVisible();await expect(page.getByText('已连接账号',{exact:true})).toBeVisible();expect(exchanged).toBe(1);
 expect(new URL(page.url()).search).toBe('');
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(before);
 await page.reload();await expect(page.getByRole('heading',{name:'当前账号',exact:true})).toBeVisible();expect(exchanged).toBe(1);
 const runtime=await fixture.startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
});

test('ordinary email rate limits, invalid codes and missing invitations preserve usable guest content',async({page,context})=>{
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 let sends=0,verifications=0;
 await page.route('**/auth/v1/otp*',async route=>{sends++;await route.fulfill(sends===1?{status:429,json:{msg:'fixture_rate_limit'}}:{json:{user:null,session:null}});});
 await page.route('**/auth/v1/verify*',async route=>{verifications++;const body=route.request().postDataJSON();expect(body.email).toBe('package-center@sensa.invalid');expect(body.type).toBe('email');await route.fulfill(verifications===1?{status:403,json:{msg:'fixture_expired'}}:{json:fixture.session()});});
 await page.route('**/sensa/web/access/session',route=>route.fulfill({status:403,json:{code:'invite_required'}}));
 await page.goto(fixture.origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'登录 Sensa',exact:true}).click();await page.getByLabel('邮箱',{exact:true}).fill('package-center@sensa.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('发送过于频繁');expect(sends).toBe(1);
 await page.getByRole('button',{name:'发送验证码',exact:true}).click();
 await page.getByLabel('验证码',{exact:true}).fill('000000');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('验证码不正确或已过期');
 await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 await expect(page.locator('#s-profile')).toBeVisible();await expect(page.getByRole('status').filter({hasText:'当前账号尚未获得服务访问权限，请联系 Sensa 支持。'})).toBeVisible();
 await expect(page.getByText('已连接账号',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);expect(verifications).toBe(2);
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'退出账号',exact:true}).click();
 await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),fixture.storageKey)).toBeNull();
 await page.reload();await expect(page.locator('#s-profile')).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
});

test('an ordinary mail callback without this browser PKCE verifier fails visibly and keeps local content',async({page,context})=>{
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 let admissions=0;
 await page.route('**/sensa/web/access/session',async route=>{admissions++;await route.fulfill({status:403,json:{code:'invite_required'}});});
 await page.goto(fixture.origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.goto(fixture.origin+'/profile?code=another-browser-code');await expect(page.locator('#s-profile')).toBeVisible();
 await expect(page.getByRole('status')).toContainText('登录链接已失效，或未在发起登录的浏览器中打开');expect(new URL(page.url()).search).toBe('');
 expect(admissions).toBe(0);expect(await page.evaluate(key=>localStorage.getItem(key),fixture.storageKey)).toBeNull();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'登录 Sensa',exact:true}).click();
 await expect(page.getByRole('button',{name:'发送验证码',exact:true})).toBeEnabled();
});

test('a missing local identity opens recovery without an empty replacement, and explicit backup restore preserves personal facts',async({page})=>{
 test.setTimeout(90_000);
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.locator('#s-home')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
 // Synthetic accepted source setup, not a claim of manual/model authoring.
 expect(await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load())).toBe(1);
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 const password='isolated-recovery-password';
 await page.goto(fixture.origin+'/profile');await page.locator('#settings-data').click();await page.locator('#settings-backup').click();
 const originalPanel=page.getByRole('region',{name:'本机库备份与恢复',exact:true});
 await originalPanel.getByLabel('备份密码',{exact:true}).fill(password);
 const pendingDownload=page.waitForEvent('download');await originalPanel.getByRole('button',{name:'导出加密备份',exact:true}).click();
 const downloaded=await pendingDownload,path=await downloaded.path();if(!path)throw new Error('backup_download_missing');
 const backup=await readFile(path);
 // Only this isolated test origin is cleared, after a real recoverable export.
 await page.evaluate(()=>window.__sensaBrowserSmoke!.discardLibraryForRecoveryTest());await page.reload();
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'导出加密备份',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).toEqual({identity:null,creationReceipt:null,settings:0});
 await page.getByRole('button',{name:'登录原账号',exact:true}).click();
 await page.getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).toEqual({identity:null,creationReceipt:null,settings:0});
 await page.getByRole('button',{name:/重新打开/u}).click();
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).toEqual({identity:null,creationReceipt:null,settings:0});
 const panel=page.getByRole('region',{name:'本机库备份与恢复',exact:true});
 await panel.getByLabel('备份密码',{exact:true}).fill('incorrect-test-password');
 await panel.getByLabel('选择备份文件',{exact:true}).setInputFiles({name:'synthetic-personal.sensa-backup',mimeType:'application/octet-stream',buffer:backup});
 await panel.getByRole('button',{name:'检查备份',exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toBeNull();
 await panel.getByLabel('备份密码',{exact:true}).fill(password);await panel.getByRole('button',{name:'检查备份',exact:true}).click();
 await expect(panel.getByRole('button',{name:'确认恢复到当前空本机库',exact:true})).toBeEnabled();
 await expect(panel).toContainText('1 个意思');
 await panel.getByRole('button',{name:'确认恢复到当前空本机库',exact:true}).click();
 await expect(panel.getByRole('button',{name:/重新打开/u})).toBeVisible();
 const after=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 expect(after.identity).toMatchObject({id:(before.identity as {id:string}).id});
 await panel.getByRole('button',{name:/重新打开/u}).click();await expect(page.locator('#s-profile')).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
 await page.goto(fixture.origin+'/content');await expect(page.locator('.sensa-world-row').first()).toBeVisible();
 await page.locator('.sensa-world-row').first().click();await expect(page.getByText('Private source: May asked to borrow an umbrella.',{exact:true}).first()).toBeVisible();
});

test('an encrypted backup restores exact personal facts and genuine learning history in a fresh browser without overwriting an occupied library',async({page,browser},testInfo)=>{
 test.setTimeout(120_000);
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 const runtime=await fixture.startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
 if(await runtime.getByRole('button',{name:'暂停',exact:true}).isVisible())await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
 await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 // Real owner Draft commands carry a synthetic private image; provider quality
 // and manual authorship are covered separately from the backup transport.
 await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,1));
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 const learning=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 const password='isolated-roundtrip-password';
 const backupPanel=async(target:Page)=>{await target.goto(fixture.origin+'/profile');await target.locator('#settings-data').click();await target.locator('#settings-backup').click();return target.getByRole('region',{name:'本机库备份与恢复',exact:true});};
 const sourcePanel=await backupPanel(page);await sourcePanel.getByLabel('备份密码',{exact:true}).fill(password);
 const pendingDownload=page.waitForEvent('download');await sourcePanel.getByRole('button',{name:'导出加密备份',exact:true}).click();
 const downloaded=await pendingDownload,downloadPath=await downloaded.path();if(!downloadPath)throw Error('backup_download_missing');
 const backup=await readFile(downloadPath),file={name:'roundtrip.sensa-backup',mimeType:'application/octet-stream',buffer:backup};
 await sourcePanel.getByLabel('选择备份文件',{exact:true}).setInputFiles(file);await sourcePanel.getByRole('button',{name:'检查备份',exact:true}).click();
 await expect(sourcePanel.getByRole('alert')).toContainText('当前本机库已有资料');await expect(sourcePanel.getByRole('button',{name:'确认恢复到当前空本机库',exact:true})).toHaveCount(0);
 await expect(sourcePanel).toContainText('1 个意思');
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 const receiver=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN'});
 try{
  await receiver.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const restoredPage=await receiver.newPage();await restoredPage.goto(fixture.origin);await restoredPage.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await expect(restoredPage.locator('#s-home')).toBeVisible();
  const destination=await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
  const destinationFacts=await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true));
  const destinationPath=testInfo.outputPath('fresh-destination-facts.json');await writeFile(destinationPath,JSON.stringify(destinationFacts));await testInfo.attach('fresh-destination-facts',{path:destinationPath,contentType:'application/json'});
  const panel=await backupPanel(restoredPage);await panel.getByLabel('选择备份文件',{exact:true}).setInputFiles(file);await panel.getByLabel('备份密码',{exact:true}).fill('incorrect-roundtrip-password');
  await panel.getByRole('button',{name:'检查备份',exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();
  expect(await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).toEqual(destination);
  const corrupted=JSON.parse(backup.toString('utf8'));corrupted.data=(corrupted.data[0]==='A'?'B':'A')+corrupted.data.slice(1);
  await panel.getByLabel('备份密码',{exact:true}).fill(password);await panel.getByLabel('选择备份文件',{exact:true}).setInputFiles({...file,buffer:Buffer.from(JSON.stringify(corrupted))});await panel.getByRole('button',{name:'检查备份',exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();
  expect(await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).toEqual(destination);
  await panel.getByLabel('选择备份文件',{exact:true}).setInputFiles(file);
  await panel.getByLabel('备份密码',{exact:true}).fill(password);await panel.getByRole('button',{name:'检查备份',exact:true}).click();
  await expect(panel).toContainText('1 个意思');await expect(panel).toContainText('1 次运行');
  const started=Date.now();await panel.getByRole('button',{name:'确认恢复到当前空本机库',exact:true}).click();await expect(panel.getByRole('button',{name:/重新打开/u})).toBeVisible();
  await testInfo.attach('backup-roundtrip-conditions',{body:JSON.stringify({privateDraftImages:1,personalMeanings:1,learningRecords:1,fileBytes:backup.byteLength,restoreMs:Date.now()-started,viewport:'390x844',cpu:'1x',provider:'synthetic low-media publication; no paid calls'}),contentType:'application/json'});
  await panel.getByRole('button',{name:/重新打开/u}).click();await expect(restoredPage.locator('#s-profile')).toBeVisible();
  const after=await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
  expect(after.identity).toMatchObject({id:(before.identity as {id:string}).id,learnerId:(before.identity as {learnerId:string}).learnerId});
  expect((after.identity as {deviceId:string}).deviceId).not.toBe((before.identity as {deviceId:string}).deviceId);
  expect(await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
  expect(await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(learning);
  await restoredPage.reload();await expect(restoredPage.locator('#s-profile')).toBeVisible();
  expect(await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
  await restoredPage.goto(fixture.origin+'/content');await restoredPage.locator('.sensa-world-row').first().click();await expect(restoredPage.getByText('Private source: May asked to borrow an umbrella.',{exact:true}).first()).toBeVisible();
 }finally{await receiver.close();}
 const racing=await browser.newContext({locale:'zh-CN'});
 try{
  await racing.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const restoring=await racing.newPage();await restoring.goto(fixture.origin);await restoring.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await expect(restoring.locator('#s-home')).toBeVisible();
  const panel=await backupPanel(restoring);await panel.getByLabel('备份密码',{exact:true}).fill(password);await panel.getByLabel('选择备份文件',{exact:true}).setInputFiles(file);await panel.getByRole('button',{name:'检查备份',exact:true}).click();await expect(panel.getByRole('button',{name:'确认恢复到当前空本机库',exact:true})).toBeEnabled();
  const writer=await racing.newPage();await writer.goto(fixture.origin);await expect(writer.locator('#s-home')).toBeVisible();await writer.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
  const concurrent=await writer.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
  await panel.getByRole('button',{name:'确认恢复到当前空本机库',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('当前本机库已有资料');
  expect(await writer.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(concurrent);
  await writer.reload();await expect(writer.locator('#s-home')).toBeVisible();expect(await writer.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(concurrent);
 }finally{await racing.close();}
});

test('signout keeps local facts available while the auth service is stalled and reconnecting cannot cancel that intent',async({page,context})=>{
 fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:fixture.storageKey,value:fixture.session()});
 await page.goto(fixture.origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 const runtime=await fixture.startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 const beforeLearning=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());await page.goto(fixture.origin+'/profile');
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 let release!:()=>void,logoutRequests=0;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/auth/v1/logout*',async route=>{logoutRequests++;await held;await route.fulfill({status:503,json:{message:'synthetic unavailable logout'}});});
 try{
  await page.locator('#settings-security').click();await page.getByRole('button',{name:'退出账号',exact:true}).click();await expect.poll(()=>logoutRequests).toBe(1);
  await expect(page.locator('#s-profile')).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.locator('.sensa-world-row').first().click();await expect(page.getByText('Private source: May asked to borrow an umbrella.',{exact:true}).first()).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
  const metadata=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true));expect(metadata.meta!.find(row=>row.key==='signed-out')?.value).toEqual(['boolean',true]);
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'今日',exact:true}).click();await page.locator('#s-home').getByRole('button',{name:/继续学习/}).click();
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(beforeLearning.runtime);
  await page.locator('#s-lightweight-runtime').getByRole('button',{name:/已经连上/}).click();await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
 }finally{release();}
 await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key)===null,fixture.storageKey),{timeout:20_000}).toBe(true);
});

test('a different account cannot open an owned library and can sign out without replacing its facts',async({page,context})=>{
 fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:fixture.storageKey,value:fixture.session()});
 await page.goto(fixture.origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest()),identity=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 // Controlled auth change: real account/runtime/OPFS handling, not provider login.
 await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:fixture.storageKey,value:fixture.session(randomUUID())});await page.reload();
 await page.evaluate(()=>{(window as any).__fixtureExtensionSignouts=[];window.addEventListener('message',event=>{if(event.data?.kind==='web-session-ended')(window as any).__fixtureExtensionSignouts.push(event.data);});});
 await expect(page.locator('.sensa-account-entry')).toBeVisible();await expect(page.locator('#s-profile')).toHaveCount(0);await expect(page.getByText('Private source: May asked to borrow an umbrella.',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 await page.getByRole('button',{name:'退出当前登录，使用原账号重新登录',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__fixtureExtensionSignouts)).toEqual([]);
 await page.locator('#settings-security').click();await expect(page.getByRole('button',{name:'退出账号',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'登录 Sensa',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toEqual(identity.identity);
});

test('a delayed account admission in another tab cannot reopen online services after a committed logout',async({page,context})=>{
 fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:fixture.storageKey,value:fixture.session()});
 await page.goto(fixture.origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.evaluate(()=>window.__sensaBrowserSmoke!.holdNextAccountSignoutForTest());
 const other=await context.newPage();let resume!:()=>void,requests=0;const paused=new Promise<void>(resolve=>{resume=resolve;});
 await other.route('**/sensa/web/access/session',async route=>{requests++;await paused;await route.fulfill({status:200,json:{authorized:true,accountId:fixture.account,capabilities:{publishLearningContent:false}}});});
 await other.goto(fixture.origin+'/profile');await expect.poll(()=>requests).toBe(1);await expect(other.locator('#s-profile')).toBeVisible();
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'退出账号',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.accountSignoutWaitingForTest())).toBe(true);
 const unwanted=other.waitForRequest(request=>new URL(request.url()).pathname.startsWith('/sensa/intake/'),{timeout:1500}).then(()=>true,()=>false);
 try{
  const response=other.waitForResponse(response=>new URL(response.url()).pathname==='/sensa/web/access/session');resume();await response;
  expect(await unwanted).toBe(false);await expect(other.locator('#s-profile').getByText('本机使用',{exact:true})).toBeVisible();
  const metadata=await other.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true));expect(metadata.meta!.find(row=>row.key==='signed-out')?.value).toEqual(['boolean',true]);
  expect(await other.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 }finally{resume();await page.evaluate(()=>window.__sensaBrowserSmoke!.releaseAccountSignoutForTest());await other.close();}
});

test('a 10000-Meaning local clear uses a bounded preview and leaves an empty reopened library',{tag:'@capacity'},async({},testInfo)=>{
 const profile=await mkdtemp(join(tmpdir(),'sensa-lj19-clear-'));
 const context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900},locale:'zh-CN'}),page=await context.newPage();
 let completed=false;
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());fixture.semanticScaleFixture=syntheticSemanticWorld(await repository.load(),10_000);
 const fixtureBytes=Buffer.byteLength(JSON.stringify(fixture.semanticScaleFixture));
 try{
  await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await expect(page.locator('#s-home')).toBeVisible();
  expect(await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await(await fetch('/semantic-scale-fixture')).json()))).toBe(10_000);
  await page.goto(fixture.origin+'/profile');await page.locator('#settings-data').click();await page.locator('#settings-storage').click();
  const start=await page.evaluate(()=>performance.now());await page.getByRole('button',{name:'检查要清除的资料',exact:true}).click();await expect(page.getByText(/10000 个意思/)).toBeVisible();
  const previewMs=await page.evaluate(start=>performance.now()-start,start);assertInteractionBudget(previewMs,1500,'10k local-clear preview');
  await page.getByLabel('我已保存需要的备份，确认清除以上本机资料。').check();const clearStart=await page.evaluate(()=>performance.now());
  await page.getByRole('button',{name:'确认清除本机资料',exact:true}).click();await expect(page.getByText('本机资料已清除。重新打开应用可开始使用空资料库。',{exact:true})).toBeVisible({timeout:20_000});
  const clearMs=await page.evaluate(start=>performance.now()-start,clearStart);assertInteractionBudget(clearMs,15_000,'10k local-clear completion');
  await page.getByRole('button',{name:'重新打开应用',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(Object.values(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).every(rows=>rows.length===0)).toBe(true);
  const measurement={meanings:10_000,fixtureJsonBytes:fixtureBytes,media:0,learningHistory:0,previewMs,clearMs,browser:'Chromium OPFS persistent profile',cpu:cpus()[0]?.model,network:'loopback fixture setup; preview/clear are local',scope:'synthetic confirmed text Meaning/Registry facts; one destructive clear, not p95, physical file reclamation or heavy Learning/Media capacity'};
  console.info('LJ19 local clear capacity:',JSON.stringify(measurement));const evidence=testInfo.outputPath('local-clear-capacity.json');await writeFile(evidence,JSON.stringify(measurement));await testInfo.attach('local-clear-capacity',{contentType:'application/json',path:evidence});completed=true;
 }finally{fixture.semanticScaleFixture=undefined;await context.close();if(completed)await rm(profile,{recursive:true,force:true});else await testInfo.attach('retained-clear-profile',{contentType:'text/plain',body:profile});}
});

test('the shipped account deletion verifies a magic link without deleting and clears only after explicit confirmation',async({page,context})=>{
 fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(fixture.origin);await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:fixture.storageKey,value:fixture.session()});await page.goto(fixture.origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());let deletionCalls=0,otpInput:any;
 await context.route('**/auth/v1/otp*',async route=>{otpInput=route.request().postDataJSON();await route.fulfill({json:{}});});
 await context.route('**/auth/v1/token*',route=>route.fulfill({json:fixture.session()}));await context.route('**/auth/v1/logout*',route=>route.fulfill({status:204}));
 await context.route('**/sensa/account/deletion',async route=>{deletionCalls++;await route.fulfill({json:{state:'deleted',operationId:route.request().postDataJSON().operationId}});});
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'删除账号',exact:true}).click();await expect(page.getByText(/删除后不能再用原账号恢复备份/)).toBeVisible();
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'发送删除验证邮件',exact:true}).click();await expect(page.getByLabel('邮箱验证码',{exact:true})).toBeVisible();expect(otpInput.create_user).toBe(false);
 const receipt=await page.evaluate(()=>JSON.parse(localStorage.getItem('sensa:account-deletion')!));expect(receipt.phase).toBe('verifying');expect(otpInput.code_challenge).toBeTruthy();
 await page.goto(fixture.origin+'/profile?error=access_denied&error_code=otp_expired&error_description=synthetic');await expect(page.getByRole('alert')).toHaveText(/登录链接已失效/);await expect(page).toHaveURL(fixture.origin+'/profile');expect(deletionCalls).toBe(0);
 await page.goto(fixture.origin+'/profile?code=synthetic-fresh-deletion-code');await expect(page.getByRole('status')).toHaveText('已验证邮箱。请再次确认后删除账号。');expect(deletionCalls).toBe(0);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(before);
 const erase=page.getByRole('button',{name:'验证并删除账号',exact:true});await expect(erase).toBeDisabled();await page.getByRole('checkbox').check();await erase.click();await expect(page.getByRole('status')).toHaveText('账号已删除，当前浏览器资料已清除。');expect(deletionCalls).toBe(1);
 await page.getByRole('button',{name:'返回登录',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('sensa:account-deletion'))).toBeNull();
 await page.reload();await expect(page.locator('#s-profile')).toBeVisible();expect(Object.values(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).every(rows=>rows.length===0)).toBe(true);
});

test('the shipped deletion recovers a lost response through the same receipt after reload',async({page,context})=>{
 fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(fixture.origin);await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:fixture.storageKey,value:fixture.session()});await page.goto(fixture.origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,1));
 await context.route('**/auth/v1/otp*',route=>route.fulfill({json:{}}));await context.route('**/auth/v1/verify',route=>route.fulfill({json:fixture.session()}));await context.route('**/auth/v1/logout*',route=>route.fulfill({status:204}));
 let operationId='',calls=0;await context.route('**/sensa/account/deletion',async route=>{calls++;operationId=route.request().postDataJSON().operationId;await route.abort('failed');});
 await context.route('**/sensa/account/deletion/status',async route=>{expect(route.request().postDataJSON().operationId).toBe(operationId);await route.fulfill({json:{state:'deletion_pending',operationId}});});
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'删除账号',exact:true}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'发送删除验证邮件',exact:true}).click();await page.getByLabel('邮箱验证码', {exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();await expect(page.getByRole('status')).toHaveText('已验证邮箱。请再次确认后删除账号。');
 await page.getByRole('button',{name:'验证并删除账号',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'检查删除进度',exact:true})).toBeVisible();await page.getByRole('button',{name:'检查删除进度',exact:true}).click();await expect(page.getByRole('status')).toHaveText(/账号访问已停止/);expect(calls).toBe(1);
 await page.getByRole('button',{name:'暂时离开',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();expect(Object.values(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).every(rows=>rows.length===0)).toBe(true);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sensa:account-deletion')!).operationId)).toBe(operationId);
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'检查删除进度',exact:true}).click();await expect(page.getByRole('button',{name:'检查删除进度',exact:true})).toBeVisible();
 await context.route('**/sensa/account/deletion/status',route=>route.fulfill({json:{state:'deleted',operationId}}));await page.getByRole('button',{name:'检查删除进度',exact:true}).click();await expect(page.getByRole('status')).toContainText('账号已删除');expect(calls).toBe(1);await page.getByRole('button',{name:'返回登录',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('sensa:account-deletion'))).toBeNull();
});

test('the shipped account pages clear only this browser and offline reload stays empty until explicit sync',async({page,context},testInfo)=>{
 fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(fixture.origin);await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:fixture.storageKey,value:fixture.session()});
 await page.goto(fixture.origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,1));
 // Establish the confirmed source before creating later learning facts.
 await page.locator('#settings-data').click();await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已同步到账号'})).toBeVisible();
 const runtime=await fixture.startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
 await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();await runtime.getByRole('button',{name:'完成并回到首页',exact:true}).click();
 // Same-page navigation keeps the active sync coordinator through confirmation.
 await page.getByRole('button',{name:'账号与设置',exact:true}).first().click();await page.locator('#settings-data').click();await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已同步到账号'})).toBeVisible();
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest()),original=(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity;
 expect(original).toBeTruthy();const cloudBefore={revision:fixture.cloudRevision,manifest:fixture.cloudManifest,blocks:[...fixture.cloudBlocks]};
 await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 await page.locator('#settings-storage').click();await page.getByRole('button',{name:'检查要清除的资料',exact:true}).click();
 await expect(page.locator('[data-local-clear-sync]')).toHaveCount(0);await page.getByLabel('我已保存需要的备份，确认清除以上本机资料。').check();
 await page.getByRole('button',{name:'确认清除本机资料',exact:true}).click();await expect(page.getByText('本机资料已清除。重新打开应用可开始使用空资料库。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重新打开应用',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();
 const cleared=(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity as {id:string;deviceId:string};expect(cleared.id).not.toBe((original as {id:string}).id);
 const empty=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());expect(Object.values(empty).every(rows=>rows.length===0)).toBe(true);
 let requests=0;context.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/sensa/library-sync/'))requests++;});
 await context.setOffline(true);
 try{await page.reload();await expect(page.locator('#s-profile')).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(empty);}finally{await context.setOffline(false);}
 await page.reload();await expect(page.locator('#s-profile')).toBeVisible();await page.locator('#settings-data').click();await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();
 expect(requests).toBe(0);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(empty);expect({revision:fixture.cloudRevision,manifest:fixture.cloudManifest,blocks:[...fixture.cloudBlocks]}).toEqual(cloudBefore);
 await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已同步到账号'})).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
 await page.reload();await expect(page.locator('#s-profile')).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toEqual({...original as object,deviceId:cleared.deviceId});expect(requests).toBeGreaterThan(0);
 await testInfo.attach('local-clear-journey',{contentType:'application/json',body:JSON.stringify({scope:'shipped AccountExperience/ProfileScreen, genuine learning rating, private Draft image, accepted synthetic Meaning, OPFS and native offline reload; controlled Auth/HTTP',original,cleared,paidCalls:0})});
});

test('a signed-out owner can explicitly discard pending local content without reconnecting its account',async({page,context})=>{
 const bridgeReady=()=>expect.poll(()=>page.evaluate(()=>typeof window.__sensaBrowserSmoke?.libraryBootstrapFactsForTest==='function')).toBe(true);
 fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(fixture.origin);await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:fixture.storageKey,value:fixture.session()});
 await page.goto(fixture.origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();await bridgeReady();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 const runtime=await fixture.startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
 await page.goto(fixture.origin+'/profile');await bridgeReady();const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 await page.route('**/auth/v1/logout*',route=>route.fulfill({status:204}));
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'退出账号',exact:true}).click();
 await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),fixture.storageKey)).toBeNull();await page.goto(fixture.origin+'/profile');await bridgeReady();
 // Completion may checkpoint earlier facts. This genuine local save occurs
 // after logout, so the pending branch cannot depend on scheduler timing.
 await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,1));
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.locator('#settings-data').click();await page.locator('#settings-storage').click();
 await page.getByRole('button',{name:'检查要清除的资料',exact:true}).click();await expect(page.locator('[data-local-clear-sync]')).toHaveAttribute('data-local-clear-sync','unavailable');
 await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeDisabled();
 const erase=page.getByRole('button',{name:'确认清除本机资料',exact:true});await expect(erase).toBeDisabled();
 await page.getByLabel('我已保存需要的备份，确认清除以上本机资料。').check();await expect(erase).toBeDisabled();
 await page.getByLabel(/丢弃这个浏览器中的 .* 项未同步账号修改/).check();await expect(erase).toBeEnabled();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 const cloudBefore={revision:fixture.cloudRevision,manifest:fixture.cloudManifest,blocks:[...fixture.cloudBlocks]};
 const metadata=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true)),epoch=metadata.meta!.find(row=>row.key==='service-signout-epoch');
 await erase.click();await expect(page.getByText('本机资料已清除。重新打开应用可开始使用空资料库。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重新打开应用',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();await bridgeReady();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).not.toEqual(before.identity);
 const cleared=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());expect(Object.values(cleared).every(rows=>rows.length===0)).toBe(true);
 const after=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true));expect(after.meta!.find(row=>row.key==='signed-out')?.value).toEqual(['boolean',true]);expect(after.meta!.find(row=>row.key==='service-signout-epoch')).toEqual(epoch);
 await page.reload();await expect(page.locator('#s-profile')).toBeVisible();await bridgeReady();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(cleared);
 expect({revision:fixture.cloudRevision,manifest:fixture.cloudManifest,blocks:[...fixture.cloudBlocks]}).toEqual(cloudBefore);expect(await page.evaluate(key=>localStorage.getItem(key),fixture.storageKey)).toBeNull();
});

test('a signed-out library opens locally while an expired cached token is stuck refreshing',async({page,context})=>{
 fixture.cloudManifest=null;fixture.cloudRevision=0;fixture.cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:fixture.storageKey,value:fixture.session()});
 await page.goto(fixture.origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.evaluate(()=>window.__sensaBrowserSmoke!.holdNextAccountSignoutForTest());await page.locator('#settings-security').click();await page.getByRole('button',{name:'退出账号',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.accountSignoutWaitingForTest())).toBe(true);
 let resume!:()=>void,refreshRequests=0;const paused=new Promise<void>(resolve=>{resume=resolve;});
 await context.route('**/auth/v1/token*',async route=>{refreshRequests++;await paused;await route.fulfill({status:400,json:{error:'invalid_grant',error_description:'synthetic expired refresh'}});});
 const expired={...fixture.session(),access_token:fixture.jwt(-3600),expires_at:Math.floor(Date.now()/1000)-3600};await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:fixture.storageKey,value:expired});
 const reopened=await context.newPage();
 try{
  await reopened.goto(fixture.origin+'/content');await expect.poll(()=>refreshRequests).toBeGreaterThan(0);
  await expect(reopened.locator('.sensa-world-row').first()).toBeVisible();await reopened.locator('.sensa-world-row').first().click();await expect(reopened.getByText('Private source: May asked to borrow an umbrella.',{exact:true}).first()).toBeVisible();
  expect(await reopened.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 }finally{resume();await page.evaluate(()=>window.__sensaBrowserSmoke!.releaseAccountSignoutForTest());await reopened.close();}
});

test('an empty signed-in device keeps account data unknown after http-error preflight and explicitly retries',fixture.emptySignedInPreflightRetry('http-error'));

test('an empty signed-in device keeps account data unknown after network-error preflight and explicitly retries',fixture.emptySignedInPreflightRetry('network-error'));

test('a saved normalized personal Meaning remains usable when optional account preflight fails',async({page,context})=>{
 test.setTimeout(90_000);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.locator('#s-home')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
 expect(await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load())).toBe(1);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.localReplicaContentPresentForTest())).toBe(true);
 const bootstrap=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 expect(bootstrap.identity).not.toBeNull();
 await context.route(fixture.apiOrigin+'/sensa/library-sync/head',route=>route.fulfill({status:503,json:{code:'fixture_preflight_unavailable'}}));
 await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:fixture.storageKey,value:fixture.session()});await page.reload();
 await expect.poll(()=>page.evaluate(()=>!!window.__sensaBrowserSmoke)).toBe(true);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).toEqual(bootstrap);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.localReplicaContentPresentForTest())).toBe(true);
 await expect(page.locator('#s-home')).toBeVisible();await expect(page.locator('#s-home').getByRole('button',{name:'重试恢复',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'我的语义世界',exact:true}).first().click();await expect(page.locator('.sensa-world-row')).toHaveCount(1);
 await page.locator('.sensa-world-row').first().click();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
});

test('an annotation-only local library remains usable when optional account preflight fails',async({page,context})=>{
 test.setTimeout(90_000);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await expect(page.locator('#s-home')).toBeVisible();
 const bookmark=await page.evaluate(()=>window.__sensaBrowserSmoke!.retainExampleForTest(true));
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
 await context.route(fixture.apiOrigin+'/sensa/library-sync/head',route=>route.fulfill({status:503,json:{code:'fixture_preflight_unavailable'}}));
 await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:fixture.storageKey,value:fixture.session()});await page.reload();
 await expect(page.locator('#s-home')).toBeVisible();await expect(page.getByRole('button',{name:'重试恢复',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'我的语义世界',exact:true}).first().click();await expect(page.getByRole('button',{name:'重试恢复',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.retainedExampleIdsForTest())).toEqual([bookmark.exampleId]);
});

test('initial sync failure after admission actually reruns sync on the restoration retry',async({page,context})=>{
 test.setTimeout(90_000);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:fixture.storageKey,value:fixture.session()});
 let failSync=true,heads=0;
 await context.route(fixture.apiOrigin+'/sensa/library-sync/head',route=>{
  heads++;
  // Admission sees nonempty remote data, but the actual sync fails before fetching it.
  // A later confirmed empty head exercises manual retry, not cloud payload restoration.
  if(heads===1)return route.fulfill({json:{revision:1,manifest:{libraryId:'00000000-0000-4000-8000-000000000011',learnerId:'00000000-0000-4000-8000-000000000012',snapshotRevision:1,floor:1,records:1}}});
  return !failSync?route.fulfill({json:{revision:2,manifest:null}}):route.fulfill({json:{revision:'invalid controlled head',manifest:null}});
 });
 await page.goto(fixture.origin);await expect(page.getByRole('button',{name:'重试恢复',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus())).toBe('failed');
 const failedHeads=heads;failSync=false;await page.getByRole('button',{name:'重试恢复',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus())).toBe('synced');
 await expect(page.getByRole('heading',{name:'还没有加入学习内容',exact:true})).toBeVisible();expect(heads).toBeGreaterThan(failedHeads);
});

test('explicit fresh start uses a separate OPFS pool, fences old tabs, and preserves the old files and facts',async({page,context},testInfo)=>{
 test.setTimeout(90_000);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.locator('#s-home')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
 expect(await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load())).toBe(1);
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 const oldTab=await context.newPage();await oldTab.goto(fixture.origin+'/content');await expect(oldTab.locator('.sensa-world-row').first()).toBeVisible();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.removeLibraryIdentityForRecoveryTest());await page.reload();
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重新开始',exact:true}).click();await expect(page.getByText(/旧文件会保留/u)).toBeVisible();
 await testInfo.attach('explicit-fresh-start-confirmation',{body:await page.screenshot(),contentType:'image/png'});
 await page.getByRole('button',{name:'取消',exact:true}).click();
 expect(await page.evaluate(()=>localStorage.getItem('sensa:local-library-selection:v1'))).toBeNull();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
 await page.getByRole('button',{name:'重新开始',exact:true}).click();
 await page.getByRole('button',{name:'确认创建新本机库',exact:true}).click();await expect(page.locator('#s-home')).toBeVisible();
 const binding=await page.evaluate(()=>JSON.parse(localStorage.getItem('sensa:local-library-selection:v1')!)) as {namespace:string;preservedNamespaces:unknown[]};
 expect(binding.namespace).toMatch(/^[0-9a-f-]{36}$/u);expect(binding.preservedNamespaces).toEqual([null]);
 const after=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 expect((after.identity as {id:string}).id).not.toBe((before.identity as {id:string}).id);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
 await expect(oldTab.locator('[data-sensa-version-guard="selection"]')).toBeVisible();
 const staleRead=await oldTab.evaluate(async()=>{try{await window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest();return 'unexpected success';}catch(cause){return cause instanceof Error?cause.message:String(cause);}});
 expect(staleRead).toBe('localFlow.libraryReplaced');await oldTab.close();
 const digestOldFiles=()=>page.evaluate(async()=>{
  const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('sensa-local-library-v12'),opaque=await directory.getDirectoryHandle('.opaque');
  const rows:Array<{name:string;bytes:number;sha256:string}>=[];
  for await(const [name,entry] of (opaque as FileSystemDirectoryHandle&{entries:()=>AsyncIterableIterator<[string,FileSystemHandle]>}).entries()){
   if(entry.kind!=='file')continue;const bytes=await (await (entry as FileSystemFileHandle).getFile()).arrayBuffer(),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
   rows.push({name,bytes:bytes.byteLength,sha256:Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('')});
  }
  return rows.sort((a,b)=>a.name.localeCompare(b.name));
 });
 const oldFiles=await digestOldFiles();expect(oldFiles.length).toBeGreaterThan(0);expect(oldFiles.some(row=>row.bytes>4096)).toBe(true);
 const newPool=`sensa-local-library-v12-${binding.namespace}`;
 expect(await page.evaluate(async name=>{await (await navigator.storage.getDirectory()).getDirectoryHandle(name);return true;},newPool)).toBe(true);
 await page.reload();await expect(page.locator('#s-home')).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toEqual(after.identity);
 expect(await digestOldFiles()).toEqual(oldFiles);
 // Only the isolated synthetic profile is pointed back for a retained-fact check.
 await page.evaluate(async()=>{await window.__sensaBrowserSmoke!.closeLibraryStorageForRecoveryTest();localStorage.removeItem('sensa:local-library-selection:v1');});
 await page.reload();await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).creationReceipt).toEqual(before.creationReceipt);
});

test('a damaged device selection opens recovery and explicit fresh start retains the damaged pointer',async({page})=>{
 test.setTimeout(60_000);
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(fixture.origin);
 await page.evaluate(()=>localStorage.setItem('sensa:local-library-selection:v1','{isolated broken pointer'));await page.reload();
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重新开始',exact:true}).click();
 await Promise.all([page.waitForEvent('domcontentloaded'),page.getByRole('button',{name:'确认创建新本机库',exact:true}).click()]);
 await expect(page.locator('#s-home')).toBeVisible();
 const original=await page.evaluate(()=>{const binding=JSON.parse(localStorage.getItem('sensa:local-library-selection:v1')!);return localStorage.getItem(binding.unreadableSelectionKey);});
 expect(original).toBe('{isolated broken pointer');
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toBeTruthy();
});

test.describe('new-pool failure exit',()=>{
test.use({serviceWorkers:'block'});
test('the first new-pool startup failure stays in recovery and reopening retries the same selected pool',async({page,context})=>{
 test.setTimeout(90_000);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.locator('#s-home')).toBeVisible();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.removeLibraryIdentityForRecoveryTest());await page.reload();
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 // Controlled Worker denial tests the UI failure exit, not native OPFS corruption.
 let denyNewPool=true,denials=0;
 await context.route('**/assets/sqliteWorker-*.js',route=>{if(!denyNewPool)return route.continue();denials++;return route.fulfill({contentType:'text/javascript',body:`self.onmessage=event=>{const request=event.data;self.postMessage(request.kind==='close'?{id:request.id,ok:true,value:null}:{id:request.id,ok:false,error:'sqlite_fixture_startup_denied'});};`});});
 await page.getByRole('button',{name:'重新开始',exact:true}).click();
 await Promise.all([page.waitForEvent('domcontentloaded'),page.getByRole('button',{name:'确认创建新本机库',exact:true}).click()]);
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'重新开始',exact:true})).toBeVisible();
 expect(denials).toBeGreaterThan(0);
 const namespace=await page.evaluate(()=>JSON.parse(localStorage.getItem('sensa:local-library-selection:v1')!).namespace) as string;
 expect(await page.evaluate(namespace=>localStorage.getItem('sensa:local-library-present:v1:'+namespace),namespace)).toBeNull();
 denyNewPool=false;await page.getByRole('button',{name:/重新打开/u}).click();await expect(page.locator('#s-home')).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sensa:local-library-selection:v1')!).namespace)).toBe(namespace);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toBeTruthy();
});
});
