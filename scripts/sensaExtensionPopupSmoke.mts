import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const browser=await chromium.launch({executablePath:process.env.SENSA_CHROMIUM_PATH});
try {
 const page=await browser.newPage();
 await page.route('**/*',route=>route.abort());
 await page.setContent((await readFile('apps/browser-extension/dist/popup.html','utf8')).replace('<script src="popup.js"></script>',''));
 await page.addScriptTag({content:'window.__name = (value) => value;'});
 await page.evaluate(()=>{
  const fixture={calls:[] as string[],finish:null as null|((value:unknown)=>void)};
  Object.assign(window,{fixture,chrome:{runtime:{sendMessage:(message:{kind:string})=>{
   fixture.calls.push(message.kind);
   return new Promise(resolve=>{fixture.finish=resolve;});
  }}}});
 });
 await page.addScriptTag({path:resolve('apps/browser-extension/dist/popup.js')});
 const status=page.getByRole('status');
 const complete=async(error?:string,account=true)=>page.evaluate(({error,account})=>{
  (window as any).fixture.finish(error?{error}:{value:{accountId:account?'fixture-account':null,pending:0,errors:[],recent:[]}});
 },{error,account});
 await expect(status).toHaveText('正在检查账号…');await expect(page.locator('#login')).toBeDisabled();
 await complete();await expect(status).toContainText('已连接账号');
 await expect(page.getByRole('heading',{name:'最近保存'})).toBeVisible();
 await expect(page.locator('#recent-empty')).toHaveText('暂无最近保存的内容。');
 for(const [kind,waiting,done] of [
  ['login','正在连接账号','账号连接成功'],
  ['toggle','正在开启','阅读模式已开启'],
  ['stop','正在关闭','阅读模式已关闭'],
  ['sync','正在检查保存','已检查保存结果'],
  ['disconnect','正在切换','原账号材料已保留'],
 ]){
  await page.locator('#'+kind).click();await expect(status).toContainText(waiting);
  await expect(status).toHaveAttribute('aria-busy','true');
  for(const id of ['login','toggle','stop','sync','disconnect'])await expect(page.locator('#'+id)).toBeDisabled();
  const count=await page.evaluate(()=>(window as any).fixture.calls.length);
  await page.locator('#'+kind).evaluate((button:HTMLButtonElement)=>button.click());
  expect(await page.evaluate(()=>(window as any).fixture.calls.length)).toBe(count);
  await complete(undefined,kind!=='disconnect');await expect(status).toContainText(done);
  await expect(status).toHaveAttribute('aria-busy','false');await expect(page.locator('#'+kind)).toBeEnabled();
 }
 await page.locator('#toggle').click();await complete('unsupported_page');
 await expect(status).toContainText('此页面不支持采集');await expect(page.locator('#toggle')).toBeEnabled();
 await page.locator('#login').click();await complete('authorization_cancelled');
 await expect(status).toContainText('登录已取消');await expect(page.locator('#login')).toHaveText('连接 Sensa 账号');
 await page.setViewportSize({width:352,height:600});
 await page.locator('#sync').click();
 await page.evaluate(()=>{
  (window as any).fixture.finish({value:{accountId:'fixture-account',pending:0,errors:[],recent:Array.from({length:20},(_,i)=>({id:'fixture-'+i,status:'saved',snapshot:{expression:{text:i===0?'a very long expression '.repeat(20):'expression '+i}}}))}});
 });
 await expect(page.locator('#recent a')).toHaveCount(20);
 await expect(page.locator('#recent-count')).toHaveText('20 条');
 await expect(page.locator('#recent-empty')).toBeHidden();
 const geometry=await page.locator('#recent').evaluate(element=>({height:element.clientHeight,content:element.scrollHeight,width:element.clientWidth,contentWidth:element.scrollWidth}));
 expect(geometry.height).toBeLessThanOrEqual(128);expect(geometry.content).toBeGreaterThan(geometry.height);
 expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.width);
 await page.locator('#recent').focus();await page.keyboard.press('End');
 await expect.poll(()=>page.locator('#recent').evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
 await expect(page.locator('#recent a').last()).toHaveAttribute('href',/intake=fixture-19$/);
 await page.screenshot({path:'/tmp/sensa-recent-many.png',fullPage:true});
 await page.locator('#disconnect').click();await complete(undefined,false);
 await expect(page.locator('#recent a')).toHaveCount(0);await expect(page.locator('#recent-count')).toHaveText('0 条');
 await expect(page.locator('#recent-empty')).toHaveText('连接账号后查看最近保存的内容。');
 console.log('PASS: all popup actions show pending/success/error feedback, prevent duplicate clicks and restore controls; no network calls.');
} finally {await browser.close();}
