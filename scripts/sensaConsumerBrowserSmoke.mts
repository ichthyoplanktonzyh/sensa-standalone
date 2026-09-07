import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base=process.env.SENSA_BROWSER_TEST_URL??'http://127.0.0.1:3001';
if(new URL(base).hostname!=='127.0.0.1')throw new Error('Browser smoke only targets the isolated loopback harness');
const browser=await chromium.launch({headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH});
const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
const output=process.env.SENSA_BROWSER_ARTIFACT_DIR??'/tmp/sensa-m1a-browser';await mkdir(output,{recursive:true});
try {
 await page.goto(base);await expect(page.getByRole('heading',{name:'欢迎来到 Sensa'})).toBeVisible();
 await page.getByLabel('邮箱',{exact:true}).fill('test@sensa.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();
 await page.getByLabel('验证码',{exact:true}).fill('000000');await page.getByRole('button',{name:'验证并继续'}).click();
 await expect(page.getByText('验证码不正确或已过期，请重新输入或发送。')).toBeVisible();
 await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续'}).click();
 await expect(page.getByRole('heading',{name:'每天想新学多少个？'})).toBeVisible();
 await page.screenshot({path:output+'/quantity-mobile.png',fullPage:true});
 await page.getByRole('radio',{name:'10',exact:true}).check();await page.getByRole('button',{name:'确认数量并继续'}).click();
 await expect(page.getByRole('heading',{name:'今天的学习'})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'今天的学习'})).toBeVisible();
 await page.getByRole('button',{name:'修改数量'}).click();await page.getByRole('radio',{name:'20',exact:true}).check();
 await context.setOffline(true);await page.getByRole('button',{name:'确认数量并继续'}).click();
 await expect(page.getByText(/项设置已保存在本机/)).toBeVisible();
 await context.setOffline(false);await expect(page.getByRole('button',{name:'检查同步结果'})).toHaveCount(0,{timeout:15000});
 // Recovery may remain on the settings surface; returning preserves server-confirmed value.
 if(await page.getByRole('heading',{name:'每天想新学多少个？'}).isVisible())await page.getByRole('button',{name:'返回',exact:true}).click();
 await expect(page.getByRole('heading',{name:'今天的学习'})).toBeVisible();
 await page.screenshot({path:output+'/home-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'修改数量'}).click();
 await page.getByRole('radio',{name:'30',exact:true}).check();
 await context.route('http://127.0.0.1:4319/sensa/**',route=>route.abort('failed'));
 await page.getByRole('button',{name:'确认数量并继续'}).click();
 await expect(page.getByText(/项设置已保存在本机/)).toBeVisible();
 await page.reload();
 await expect(page.getByText(/项请求待同步/)).toBeVisible();
 await context.unroute('http://127.0.0.1:4319/sensa/**');
 await page.getByRole('button',{name:'检查本次结果'}).click();
 await expect(page.getByText(/项请求待同步/)).toHaveCount(0);
 await page.getByRole('button',{name:'修改数量'}).click();
 await page.getByRole('radio',{name:'5',exact:true}).check();
 let finishLostResponse!:()=>void;
 const lostResponse=new Promise<void>(resolve=>{finishLostResponse=resolve;});
 await page.route('http://127.0.0.1:4319/sensa/sync/push',async route=>{
   const response=await route.fetch();expect(response.ok()).toBe(true);
   await route.abort('failed');finishLostResponse();
 });
 await page.getByRole('button',{name:'确认数量并继续'}).click();
 await expect(page.getByText(/项设置已保存在本机/)).toBeVisible();
 await Promise.race([lostResponse,new Promise((_,reject)=>setTimeout(()=>reject(new Error('No committed response intercepted')),15000))]);
 await page.unroute('http://127.0.0.1:4319/sensa/sync/push');
 await page.reload();await expect(page.getByRole('heading',{name:'今天的学习'})).toBeVisible();
 await expect(page.getByText(/项请求待同步/)).toHaveCount(0);
 await page.setViewportSize({width:1280,height:800});await page.screenshot({path:output+'/home-desktop.png',fullPage:true});
 if(process.env.SENSA_TEST_CURRICULUM==='1'){
  await page.getByRole('button',{name:'选择学习内容',exact:true}).click();
  await page.getByRole('button',{name:/tactful/}).first().click();
  await expect(page.getByRole('button',{name:'加入学习',exact:true})).toBeVisible();
  await context.route('http://127.0.0.1:4319/sensa/**',route=>route.abort('failed'));
  await page.getByRole('button',{name:'加入学习',exact:true}).click();
  await expect(page.getByText('加入请求已保存在本机，等待确认。')).toBeVisible();
  await page.reload();await expect(page.getByText(/项请求待同步/)).toBeVisible();
  await context.unroute('http://127.0.0.1:4319/sensa/**');
  await page.getByRole('button',{name:'检查本次结果'}).click();
  await expect(page.getByText('学习内容已准备好',{exact:true})).toBeVisible();
  await expect(page.getByText(/项请求待同步/)).toHaveCount(0);
  await page.getByRole('button',{name:'选择学习内容',exact:true}).click();
  await page.getByRole('button',{name:/tactful/}).first().click();
  await expect(page.getByText('已在学习中',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'检查学习材料'}).click();
  await expect(page.getByText('学习材料已读取，可以返回首页。')).toBeVisible();
  if(process.env.SENSA_TEST_AUDIO==='1'){await expect(page.getByLabel('目标表达发音')).toBeVisible();await expect.poll(()=>page.getByLabel('目标表达发音').evaluate((node:HTMLAudioElement)=>node.readyState)).toBeGreaterThan(0);}
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:output+'/target-ready-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'标记为已会',exact:true}).click();
  await expect(page.getByRole('button',{name:'撤销已会声明',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'撤销已会声明',exact:true}).click();
  await expect(page.getByRole('button',{name:'标记为已会',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'回首页',exact:true}).click();
  await expect(page.getByRole('heading',{name:'今天的学习'})).toBeVisible();
 }
 await page.getByRole('button',{name:'退出登录',exact:true}).click();await expect(page.getByRole('heading',{name:'欢迎来到 Sensa'})).toBeVisible();
 expect(errors).toEqual([]);if(process.env.SENSA_TEST_CURRICULUM==='1')console.log('M1-B Chromium smoke passed: catalog/detail, offline add/reload, ready target, private material/audio, mastery/revoke, return home.');console.log('M1-A Chromium smoke passed: OTP failure/success, explicit quantity, reload, offline outbox/reconnect, failed-network reload, lost accepted response/replay, logout; screenshots '+output);
} catch(error){await page.screenshot({path:output+'/failure.png',fullPage:true});console.log((await page.locator('body').innerText()).slice(0,1700));throw error;}
finally{await browser.close();}
