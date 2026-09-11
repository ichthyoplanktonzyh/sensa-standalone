/** Account/settings navigation and existing panel reuse. Synthetic identity and content; no provider calls. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
const id=()=>crypto.randomUUID();
const origin=process.env.SENSA_LOCAL_WEB_URL??'http://127.0.0.1:3016';
if(new URL(origin).hostname!=='127.0.0.1')throw Error('Loopback required');
const browser=await chromium.launch({headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH});
const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
const subject=id(),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.origin===origin){await route.continue();return;}
 if(u.origin!=='http://127.0.0.1:4399'){await route.abort();return;}
 const json=async(value:unknown)=>route.fulfill({json:value});
 if(u.pathname==='/auth/v1/otp')return json({});
 if(u.pathname==='/auth/v1/verify')return json({access_token:[{},{sub:subject,exp:Math.floor(Date.now()/1000)+3600},'fixture'].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.'),refresh_token:'fixture',token_type:'bearer',expires_in:3600,user:{id:subject,email:'packages@sensa.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}});
 if(u.pathname==='/sensa/web/access/session')return json({authorized:true,accountId:subject});
 if(u.pathname==='/sensa/service/status')return json({authorized:true,explanationAvailable:true,checkedAt:new Date().toISOString(),windowHours:24,usage:[]});
 if(u.pathname==='/sensa/packages')return json({items:[]});
 await route.fulfill({status:503,json:{code:'fixture_unavailable'}});
});
try {
 await page.goto(origin+'/profile');await page.getByLabel('邮箱',{exact:true}).fill('packages@sensa.invalid');await page.getByRole('button',{name:'发送登录邮件',exact:true}).click();await page.getByRole('button',{name:'邮件中有验证码？',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 const screen=page.locator('#s-profile');
 await expect(screen.locator('#settings-security')).toBeVisible();
 await expect(screen.getByLabel('备份密码',{exact:true})).toBeHidden();
 await expect(screen.getByRole('button',{name:'退出账号',exact:true})).toBeHidden();
 await mkdir('/tmp/sensa-settings',{recursive:true});
 await page.screenshot({path:'/tmp/sensa-settings/home.png'});
 const home=async()=>{for(let i=0;i<2;i++){if(await screen.locator('#settings-security').isVisible())return;await screen.getByRole('button',{name:/^(账号与设置|设备与数据|Account & settings|Device & data)$/}).click();}};
 await screen.locator('#settings-security').click();await expect(screen.getByRole('button',{name:'退出账号',exact:true})).toBeVisible();await home();
 await screen.locator('#settings-data').click();await expect(screen.getByText('本机保存，未启用云端同步',{exact:true})).toBeVisible();
 await screen.locator('#settings-backup').click();await screen.getByLabel('备份密码',{exact:true}).fill('settings-test-password');await home();
 await screen.locator('#settings-data').click();await screen.locator('#settings-backup').click();await expect(screen.getByLabel('备份密码',{exact:true})).toHaveValue('settings-test-password');await home();
 await screen.locator('#settings-data').click();await screen.locator('#settings-storage').click();await expect(screen.getByRole('button',{name:'检查要清除的资料',exact:true})).toBeVisible();await home();
 await screen.locator('#settings-models').click();await expect(screen.getByRole('heading',{name:'Sensa 服务',exact:true})).toBeVisible();await home();
 await screen.locator('#settings-preferences').click();await screen.locator('#account-learning-preferences').click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'完成',exact:true}).click();
 await screen.getByLabel('界面语言',{exact:true}).selectOption('en');await home();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/sensa-settings/home-mobile-en.png'});
 for(const section of ['security','preferences','models','data','support']){
  await screen.locator('#settings-'+section).click();
  assert(!/[\u4e00-\u9fff]/u.test((await screen.innerText()).replace('简体中文','').replace('中文','')),'Visible settings must be localized: '+section);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
  await home();
 }
 await page.reload();await expect(screen.locator('#settings-security')).toBeVisible();
 assert.deepEqual(errors,[]);
 console.log('PASS settings: grouped navigation, account actions, local sync status, retained backup input, existing preferences panel, model settings, bilingual mobile layout, refresh. Synthetic network only.');
} finally {await browser.close();}
