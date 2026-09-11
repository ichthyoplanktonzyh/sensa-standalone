import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {apiUrl,webUrl,assertMockServer,goHome,openPreferences,rate} from './support/consumerBrowserActions.mts';
if(new URL(webUrl).hostname!=='127.0.0.1'||new URL(apiUrl).hostname!=='127.0.0.1')throw new Error('Isolated loopback services required');
const browser=await chromium.launch({headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH});
const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const output=process.env.SENSA_BROWSER_ARTIFACT_DIR??'/tmp/sensa-connected-browser';await mkdir(output,{recursive:true});
const reveal=async()=>{const button=page.getByRole('button',{name:'显示表达',exact:true});await expect(button).toBeVisible();await expect(button).toBeEnabled();await button.dispatchEvent('click');};
try{
 await assertMockServer(page);await page.goto(webUrl);
 await page.getByLabel('邮箱',{exact:true}).fill('test@sensa.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('000000');await page.getByRole('button',{name:'验证并继续'}).click();await expect(page.getByText('验证码不正确或已过期，请重新输入或发送。')).toBeVisible();
 await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续'}).click();await page.getByRole('radio',{name:'10',exact:true}).check();await page.getByRole('button',{name:'确认数量并继续'}).click();await expect(page.getByRole('heading',{name:'今天',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'查看学习计划',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/记录自己的场景/})).toBeVisible();await expect(page.getByText('今天的学习',{exact:true})).toHaveCount(0);
 await openPreferences(page);await context.setOffline(true);await page.getByLabel('每日新学数量',{exact:true}).selectOption('20');await expect(page.getByText(/项请求待同步/)).toBeVisible();await context.setOffline(false);await expect(page.getByText(/项请求待同步/)).toHaveCount(0,{timeout:15000});await expect(page.getByLabel('每日新学数量',{exact:true})).toHaveValue('20');
 await page.route(apiUrl+'/sensa/sync/push',async route=>{await route.fetch();await route.abort('failed');});await page.getByLabel('每日新学数量',{exact:true}).selectOption('30');await expect(page.getByText(/项请求待同步/)).toBeVisible();await page.unroute(apiUrl+'/sensa/sync/push');await page.reload();await page.getByRole('button',{name:'学习偏好',exact:true}).click();await expect(page.getByLabel('每日新学数量',{exact:true})).toHaveValue('30');await expect(page.getByText(/项请求待同步/)).toHaveCount(0);
 await goHome(page);await page.screenshot({path:output+'/home-mobile.png'});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:output+'/home-desktop.png'});
 if(process.env.SENSA_TEST_CURRICULUM==='1'){
  await page.getByRole('button',{name:/从已有内容开始/}).click();await page.getByRole('button',{name:/tactful/}).first().click();
  await page.route(apiUrl+'/sensa/**',route=>route.abort('failed'));await page.getByRole('button',{name:'加入学习',exact:true}).click();await expect(page.getByText('加入请求已保存在本机，等待确认。')).toBeVisible();await page.reload();await expect(page.getByText(/项请求待同步/)).toBeVisible();await page.unroute(apiUrl+'/sensa/**');await page.getByRole('button',{name:'检查本次结果'}).click();await expect(page.getByText('学习内容已准备好',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'标记为已会',exact:true}).click();await expect(page.getByRole('button',{name:'撤销已会声明',exact:true})).toBeVisible();await page.getByRole('button',{name:'撤销已会声明',exact:true}).click();await expect(page.getByRole('button',{name:'标记为已会',exact:true})).toBeVisible();await page.screenshot({path:output+'/target-ready.png'});await page.getByRole('button',{name:'回首页',exact:true}).click();
 }
 if(process.env.SENSA_TEST_INITIAL==='1'){
  await page.getByRole('button',{name:'开始学习',exact:true}).click();await expect(page.getByRole('button',{name:'显示表达',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'tactful',exact:true})).toHaveCount(0);
  await page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(..._args:Parameters<IDBDatabase['transaction']>){IDBDatabase.prototype.transaction=original;throw new DOMException('Injected no space','QuotaExceededError');};});await page.getByRole('button',{name:'显示表达',exact:true}).click();await expect(page.getByRole('button',{name:'显示表达',exact:true})).toBeVisible();
  await context.setOffline(true);await reveal();await expect(page.getByRole('heading',{name:'tactful',exact:true})).toBeVisible();await rate(page,'没想起');await reveal();await page.getByRole('button',{name:'暂停并回首页',exact:true}).click();await expect(page.getByRole('heading',{name:'今天',exact:true})).toBeVisible();await page.getByRole('button',{name:'继续学习',exact:true}).click();await expect(page.getByRole('heading',{name:'tactful',exact:true})).toBeVisible();
  await page.screenshot({path:output+'/recall-reveal-offline.png'});await rate(page,'顺利想起');await expect(page.getByRole('heading',{name:'回答已保存在本机',exact:true})).toBeVisible();await page.getByRole('button',{name:'暂停并回首页',exact:true}).click();await context.setOffline(false);await expect(page.getByText(/项请求待同步/)).toHaveCount(0,{timeout:15000});
  await page.goto(webUrl+'/study');await expect(page.getByRole('button',{name:/tactful/})).toBeVisible();await page.screenshot({path:output+'/study-records.png'});await page.reload();await expect(page.getByRole('button',{name:/tactful/})).toBeVisible();await page.getByRole('button',{name:'学习统计',exact:true}).click();await expect(page.getByRole('heading',{name:'学习统计',exact:true})).toBeVisible();await goHome(page);
 }
 if(process.env.SENSA_TEST_RETENTION==='1'){
  await page.request.post(apiUrl+'/__test/advance',{data:{ms:2*86400000}});await goHome(page);await page.getByRole('button',{name:/只复习/}).click();await page.getByRole('button',{name:'显示表达',exact:true}).click();await rate(page,'没想起');await expect(page.getByRole('heading',{name:'本次复习已记录'})).toBeVisible();await page.getByRole('button',{name:'继续其他内容',exact:true}).click();await expect(page.getByRole('heading',{name:'稍后还有 1 个需要再回想'})).toBeVisible();await page.getByRole('button',{name:'提前继续',exact:true}).click();await page.getByRole('button',{name:'显示表达',exact:true}).click();await rate(page,'顺利想起');await expect(page.getByRole('heading',{name:'这次已重新想起'})).toBeVisible();await page.getByRole('button',{name:'回首页',exact:true}).click();
 }
 if(process.env.SENSA_TEST_CHECKIN==='1'){
  await page.goto(webUrl+'/study');await expect(page.getByRole('grid',{name:'签到日历'})).toBeVisible();await expect(page.getByRole('gridcell',{name:/已签到/}).first()).toBeVisible();await page.getByRole('button',{name:'上个月'}).click();await page.getByRole('button',{name:'下个月'}).click();
 }
 await page.goto(webUrl+'/profile');await expect(page.getByText('test@sensa.invalid',{exact:true}).first()).toBeVisible();await page.screenshot({path:output+'/profile.png'});
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});await goHome(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.goto(webUrl+'/profile');await page.getByRole('button',{name:/^账号与安全/}).click();await page.getByRole('button',{name:'退出登录',exact:true}).click();await expect(page.getByRole('heading',{name:'欢迎来到 Sensa'})).toBeVisible();expect(errors).toEqual([]);
 console.log('Connected confirmed UI passed: desktop/mobile home, account settings, offline and lost-response quantity, catalog/reload/mastery, durable recall/reveal, study records/statistics, review/relearning, calendar and logout. Mock providers only.');
}catch(error){await page.screenshot({path:output+'/failure.png',fullPage:true});console.error(await page.locator('body').innerText());throw error;}finally{await browser.close();}
