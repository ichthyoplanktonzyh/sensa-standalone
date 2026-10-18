import {once} from 'node:events';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {createLibraryCloudBrowserFixture,type LibraryCloudAccount} from './libraryCloudBrowserFixture.mts';
import {webTestBuild} from './webTestBuild';

/** Shipped React pages and Supabase SDK; only external Auth HTTP is synthetic.
 * Facts, artifacts, receipts and OPFS cross the real loopback API/PG boundary. */
export async function createLibrarySyncPageFixture(browser:Browser){
 const api=await createLibraryCloudBrowserFixture(browser);let directory='';
 const server=createServer(async(req,res)=>{
  try{const pathname=new URL(req.url??'/','http://fixture').pathname;if(pathname.includes('..'))throw Error('invalid_path');
   const asset=pathname==='/'?'index.html':pathname.slice(1);let bytes:Buffer;
   try{bytes=await readFile(join(directory,asset));}catch{bytes=await readFile(join(directory,'index.html'));}
   const extension=asset.split('.').pop();res.setHeader('content-type',({js:'text/javascript',css:'text/css',wasm:'application/wasm',svg:'image/svg+xml',json:'application/json'} as Record<string,string>)[extension??'']??'text/html');res.end(bytes);
  }catch{res.writeHead(404);res.end();}
 });server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('loopback_required');const origin=`http://127.0.0.1:${address.port}`;
 directory=await webTestBuild({VITE_SENSA_MODE:'production',VITE_SENSA_BROWSER_SMOKE:'true',VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable-key',VITE_SENSA_API_URL:api.origin});
 const contexts:BrowserContext[]=[];
 async function client(account:LibraryCloudAccount){
  const context=await browser.newContext({locale:'zh-CN'});contexts.push(context);
  const token=[{}, {sub:account.subject,exp:Math.floor(Date.now()/1000)+3600},'fixture'].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===origin&&url.pathname.startsWith('/auth/v1/')){
    if(url.pathname==='/auth/v1/otp'){await route.fulfill({json:{}});return;}
    if(url.pathname==='/auth/v1/verify'||url.pathname==='/auth/v1/token'){await route.fulfill({json:{access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user:{id:account.subject,email:'sync@sensa.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}});return;}
    await route.fulfill({status:503,json:{code:'fixture_auth_unavailable'}});return;
   }
   if(url.origin===api.origin){
    if(url.pathname.startsWith('/sensa/library-sync')||url.pathname==='/sensa/web/access/session'){
     const reply=await fetch(api.origin+url.pathname+url.search,{method:request.method(),headers:{authorization:'Bearer '+account.token,'content-type':'application/json',...(request.headers()['x-sensa-snapshot-format']?{'x-sensa-snapshot-format':request.headers()['x-sensa-snapshot-format']!}:{}),...(request.headers()['x-sensa-sync-protocol']?{'x-sensa-sync-protocol':request.headers()['x-sensa-sync-protocol']!}:{})},...(request.postData()?{body:request.postData()!}:{})});
     try{await route.fulfill({status:reply.status,contentType:'application/json',body:await reply.text()});}catch(error){if(!(error instanceof Error)||!(/Route is already handled|Target.*closed/u.test(error.message)))throw error;}return;
    }
    await route.fulfill({status:503,json:{code:'fixture_unavailable'}});return;
   }
   if(url.origin===origin){await route.continue();return;}await route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(20000);return page;
 }
 return {api,origin,client,async close(){await Promise.all(contexts.map(async context=>{await context.unrouteAll({behavior:'ignoreErrors'});await context.close();}));await new Promise<void>(resolve=>server.close(()=>resolve()));await api.close();}};
}
export async function loginSyncPage(page:Page,origin:string){
 await page.goto(origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();await page.locator('#settings-security').click();await page.getByRole('button',{name:'登录 Sensa',exact:true}).click();
 await page.getByLabel('邮箱',{exact:true}).fill('sync@sensa.invalid');await page.getByRole('button',{name:'发送登录邮件',exact:true}).click();await page.getByRole('button',{name:'邮件中有验证码？',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible({timeout:60000});
}
export async function syncPanel(page:Page,origin:string){await page.goto(origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();await page.locator('#settings-data').click();return page.locator('.sensa-cloud-sync');}
