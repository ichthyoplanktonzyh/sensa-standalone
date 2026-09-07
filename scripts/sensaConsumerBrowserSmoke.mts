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
 if(process.env.SENSA_TEST_INITIAL==='1'){
  await page.getByRole('button',{name:'开始学习',exact:true}).click();
  await expect(page.getByRole('button',{name:'查看表达',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'tactful',exact:true})).toHaveCount(0);
  if(process.env.SENSA_TEST_CHECKIN==='1')await expect(page.getByText('今日已签到',{exact:true})).toBeVisible();
  await page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){IDBDatabase.prototype.transaction=original;throw new DOMException('Injected no space','QuotaExceededError');};});
  await page.getByRole('button',{name:'查看表达',exact:true}).click();
  await expect(page.getByRole('button',{name:'查看表达',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'想起来了',exact:true})).toHaveCount(0);
  let releasePush!:()=>void,handledPush!:()=>void;const heldPush=new Promise<void>(resolve=>{releasePush=resolve;}),pushHandled=new Promise<void>(resolve=>{handledPush=resolve;});
  await page.route('http://127.0.0.1:4319/sensa/sync/push',async route=>{await heldPush;await route.abort('failed');handledPush();});
  await page.getByRole('button',{name:'查看表达',exact:true}).click();await expect(page.getByRole('heading',{name:'tactful',exact:true})).toBeVisible();
  // The network is deliberately unresolved: local durability alone permits pause.
  await page.getByRole('button',{name:'暂停并回首页',exact:true}).click();await expect(page.getByRole('heading',{name:'今天的学习'})).toBeVisible();
  releasePush();await pushHandled;await page.unroute('http://127.0.0.1:4319/sensa/sync/push');await context.setOffline(true);
  await page.getByRole('button',{name:'继续本次学习',exact:true}).click();await expect(page.getByRole('button',{name:'没想起',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'没想起',exact:true}).click();await expect(page.getByRole('button',{name:'查看表达',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'查看表达',exact:true}).click();await expect(page.getByRole('button',{name:'想起来了',exact:true})).toBeVisible();
  await page.screenshot({path:output+'/initial-offline-reveal.png',fullPage:true});
  await page.getByRole('button',{name:'暂停并回首页',exact:true}).click();await expect(page.getByRole('heading',{name:'今天的学习'})).toBeVisible();
  await page.getByRole('button',{name:'继续本次学习',exact:true}).click();await expect(page.getByRole('button',{name:'想起来了',exact:true})).toBeVisible();
  await context.route('http://127.0.0.1:4319/sensa/**',route=>route.abort('failed'));
  await context.setOffline(false);await page.reload();await expect(page.getByRole('heading',{name:'今天的学习'})).toBeVisible();
  await context.setOffline(true);await page.getByRole('button',{name:'继续本次学习',exact:true}).click();await expect(page.getByRole('heading',{name:'请联网恢复学习'})).toBeVisible();
  await context.unroute('http://127.0.0.1:4319/sensa/**');await context.setOffline(false);
  await page.getByRole('button',{name:'联网恢复',exact:true}).click();await expect(page.getByRole('button',{name:'想起来了',exact:true})).toBeVisible();
  if(process.env.SENSA_TEST_AUDIO==='1'){await expect(page.getByLabel('学习表达发音')).toBeVisible();await expect.poll(()=>page.getByLabel('学习表达发音').evaluate((node:HTMLAudioElement)=>node.readyState)).toBeGreaterThan(0);}
  await page.evaluate(()=>{(window as any).__sensaOriginalNow=Date.now;Date.now=()=> (window as any).__sensaOriginalNow()-600000;});
  await page.getByRole('button',{name:'想起来了',exact:true}).click();await expect(page.getByRole('heading',{name:'请联网恢复学习'})).toBeVisible();await expect(page.getByRole('button',{name:'联网恢复',exact:true})).toBeEnabled();
  await page.evaluate(()=>{Date.now=(window as any).__sensaOriginalNow;delete (window as any).__sensaOriginalNow;});
  await page.getByRole('button',{name:'联网恢复',exact:true}).click();await expect(page.getByRole('button',{name:'想起来了',exact:true})).toBeVisible();
  let terminalDone!:()=>void;const terminalHandled=new Promise<void>(resolve=>{terminalDone=resolve;});
  await page.route('http://127.0.0.1:4319/sensa/sync/push',async route=>{const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('failed');terminalDone();});
  await page.getByRole('button',{name:'想起来了',exact:true}).click();await expect(page.getByRole('heading',{name:'回答已保存在本机'})).toBeVisible();await expect(page.getByRole('heading',{name:'已完成首次学习'})).toHaveCount(0);
  await page.screenshot({path:output+'/initial-pending-result.png',fullPage:true});
  await Promise.race([terminalHandled,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Terminal response not intercepted')),15000))]);
  await page.unroute('http://127.0.0.1:4319/sensa/sync/push');await page.getByRole('button',{name:'检查本次结果',exact:true}).click();
  await expect(page.getByRole('heading',{name:'已完成首次学习'})).toBeVisible();await expect(page.getByText(/下次复习：/)).toBeVisible();
  await page.screenshot({path:output+'/initial-completed.png',fullPage:true});
  await page.getByRole('button',{name:'回首页',exact:true}).click();await expect(page.getByText('今天已开始 1 个新目标')).toBeVisible();
  await page.reload();await expect(page.getByText('已完成首次学习，等待复习')).toBeVisible();await expect(page.getByText(/项请求待同步/)).toHaveCount(0);
  console.log('M1-C Chromium passed: no answer leak, IDB failure does not advance, offline multi-step/pause/resume, reload clock guard, audio, lost completion response/replay, authoritative due time.');
 }
 if(process.env.SENSA_TEST_RETENTION==='1'){
  const advance=async(ms:number)=>{const response=await page.request.post('http://127.0.0.1:4319/__test/advance',{data:{ms}});expect(response.ok()).toBe(true);};
  await advance(2*86400000);await page.getByRole('button',{name:'只复习',exact:true}).click();await expect(page.getByRole('heading',{name:'到期复习',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'查看表达',exact:true}).click();await page.getByRole('button',{name:'没想起',exact:true}).click();await expect(page.getByRole('heading',{name:'本次复习已记录'})).toBeVisible();
  await page.getByRole('button',{name:'继续其他内容',exact:true}).click();await expect(page.getByRole('heading',{name:'稍后还有 1 个需要再回想'})).toBeVisible();await expect(page.getByText('首次学习 1 个 · 已复习 1 个')).toHaveCount(0);
  const waiting=await page.getByText(/最近可继续时间：/).innerText();await page.getByRole('button',{name:'结束本次',exact:true}).click();await expect(page.getByRole('button',{name:'继续学习',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'回首页',exact:true}).click();await page.getByRole('button',{name:'只复习',exact:true}).click();await expect(page.getByText(waiting,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'提前继续',exact:true}).click();await expect(page.getByRole('heading',{name:'再次回想',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'查看表达',exact:true}).click();await page.getByRole('button',{name:'没想起',exact:true}).click();await expect(page.getByRole('heading',{name:'稍后再回想这个目标'})).toBeVisible();
  await page.getByRole('button',{name:'继续其他内容',exact:true}).click();await expect(page.getByRole('heading',{name:'稍后还有 1 个需要再回想'})).toBeVisible();
  const repeated=await page.getByText(/最近可继续时间：/).innerText();await page.screenshot({path:output+'/retention-waiting.png',fullPage:true});
  await page.reload();await expect(page.getByRole('heading',{name:'今天的学习'})).toBeVisible();await page.getByRole('button',{name:'只复习',exact:true}).click();await expect(page.getByText(repeated,{exact:true})).toBeVisible();
  await advance(600000);await page.getByRole('button',{name:'检查可继续内容',exact:true}).click();await expect(page.getByRole('heading',{name:'再次回想',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'查看表达',exact:true}).click();await page.getByRole('button',{name:'想起来了',exact:true}).click();await expect(page.getByRole('heading',{name:'这次已重新想起'})).toBeVisible();
  await expect(page.getByText(/原复习评价与复习时间保持原样/)).toBeVisible();await page.getByRole('button',{name:'继续其他内容',exact:true}).click();await expect(page.getByText('重学已恢复 1 个 · 仍需回想 0 个')).toBeVisible();
  await page.screenshot({path:output+'/retention-restored.png',fullPage:true});await page.getByRole('button',{name:'回首页',exact:true}).click();
  console.log('M1-D Chromium passed: due review, recorded again, wait/end/reenter, explicit early recall, repeated wait retained on reload, timed continuation, restored summary.');
 }
 if(process.env.SENSA_TEST_CHECKIN==='1'){
  const testing=async(path:string,data:unknown)=>{const r=await page.request.post('http://127.0.0.1:4319/__test/'+path,{data});expect(r.ok()).toBe(true);};
  const study=async()=>{await page.getByRole('button',{name:'我的学习',exact:true}).click();await expect(page.getByRole('heading',{name:'签到日历'})).toBeVisible();};
  const login=async(email:string)=>{await page.getByLabel('邮箱',{exact:true}).fill(email);await page.getByRole('button',{name:'发送验证码',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续'}).click();};
  await page.reload();await expect(page.getByRole('heading',{name:'今天的学习'})).toBeVisible();await study();await expect(page.getByRole('button',{name:'今日已签到',exact:true})).toBeDisabled();
  await testing('advance',{ms:86400000});await page.reload();await expect(page.getByRole('heading',{name:'今天的学习'})).toBeVisible();await study();
  await context.route('http://127.0.0.1:4319/sensa/**',route=>route.abort('failed'));await page.getByRole('button',{name:'签到',exact:true}).click();await expect(page.getByRole('button',{name:'签到待同步',exact:true})).toBeVisible();
  const pendingLabel=await page.getByRole('gridcell',{name:/待同步/}).getAttribute('aria-label');
  await context.unroute('http://127.0.0.1:4319/sensa/**');await testing('advance',{ms:86400000});await page.reload();await expect(page.getByRole('heading',{name:'今天的学习'})).toBeVisible();await study();await expect(page.getByRole('gridcell',{name:pendingLabel!.replace('待同步','已签到'),exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'签到',exact:true})).toBeEnabled();
  await page.screenshot({path:output+'/checkin-original-date.png',fullPage:true});
  await context.route('http://127.0.0.1:4319/sensa/**',route=>route.abort('failed'));await page.getByRole('button',{name:'签到',exact:true}).click();await expect(page.getByRole('button',{name:'签到待同步',exact:true})).toBeVisible();
  await testing('revoke-session',{email:'test@sensa.invalid'});await context.unroute('http://127.0.0.1:4319/sensa/**');await page.reload();await expect(page.getByRole('heading',{name:'欢迎来到 Sensa'})).toBeVisible();
  await login('second@sensa.invalid');await expect(page.getByRole('heading',{name:'每天想新学多少个？'})).toBeVisible();await page.getByRole('button',{name:'确认数量并继续'}).click();await expect(page.getByText('还没有学习目标',{exact:true})).toBeVisible();await study();await expect(page.getByRole('gridcell',{name:/已签到/})).toHaveCount(0);
  await testing('checkin-failure',{enabled:true});await page.getByRole('button',{name:'签到',exact:true}).click();await expect(page.getByRole('button',{name:'签到待同步',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'选择学习内容',exact:true}).click();await page.getByRole('button',{name:/tactful/}).first().click();await page.getByRole('button',{name:'加入学习',exact:true}).click();await expect(page.getByText('学习内容已准备好',{exact:true})).toBeVisible();await page.getByRole('button',{name:'回首页',exact:true}).click();
  await page.getByRole('button',{name:'开始学习',exact:true}).click();await expect(page.getByRole('button',{name:'查看表达',exact:true})).toBeVisible();await expect(page.getByText('签到待同步',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'查看表达',exact:true}).click();await page.getByRole('button',{name:'想起来了',exact:true}).click();await expect(page.getByRole('heading',{name:'已完成首次学习'})).toBeVisible();
  await testing('checkin-failure',{enabled:false});await page.getByRole('button',{name:'回首页',exact:true}).click();await page.getByRole('button',{name:'检查本次结果',exact:true}).click();await expect(page.getByText(/项请求待同步/)).toHaveCount(0);await study();await expect(page.getByRole('button',{name:'今日已签到',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'退出登录',exact:true}).click();await expect(page.getByRole('heading',{name:'欢迎来到 Sensa'})).toBeVisible();await login('test@sensa.invalid');await expect(page.getByRole('heading',{name:'今天的学习'})).toBeVisible();await expect(page.getByText(/项请求待同步/)).toHaveCount(0);await study();await expect(page.getByRole('button',{name:'今日已签到',exact:true})).toBeDisabled();
  console.log('M1-E Chromium passed: automatic entry, calendar, offline original-date upload, revoked-session guard, account A/B isolation and restoration, failed check-in does not block learning.');
 }
 await page.getByRole('button',{name:'退出登录',exact:true}).click();await expect(page.getByRole('heading',{name:'欢迎来到 Sensa'})).toBeVisible();
 expect(errors).toEqual([]);if(process.env.SENSA_TEST_CURRICULUM==='1')console.log('M1-B Chromium smoke passed: catalog/detail, offline add/reload, ready target, private material/audio, mastery/revoke, return home.');console.log('M1-A Chromium smoke passed: OTP failure/success, explicit quantity, reload, offline outbox/reconnect, failed-network reload, lost accepted response/replay, logout; screenshots '+output);
} catch(error){await page.screenshot({path:output+'/failure.png',fullPage:true});console.log((await page.locator('body').innerText()).slice(0,1700));throw error;}
finally{await browser.close();}
