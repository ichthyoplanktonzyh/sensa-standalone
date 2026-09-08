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
 console.log('PASS: all popup actions show pending/success/error feedback, prevent duplicate clicks and restore controls; no network calls.');
} finally {await browser.close();}
