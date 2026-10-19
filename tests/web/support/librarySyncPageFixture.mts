import {once} from 'node:events';
import {createServer} from 'node:http';
import {readFile,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {expect,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {createLibraryCloudBrowserFixture,type LibraryCloudAccount} from './libraryCloudBrowserFixture.mts';
import {webTestBuild,createWebTestBuildCache} from './webTestBuild';
import {observeLibrarySmoke,type SmokeRead} from './librarySmokeObservation';

/** Shipped React pages and Supabase SDK; only external Auth HTTP is synthetic.
 * Facts, artifacts, receipts and OPFS cross the real loopback API/PG boundary. */
export async function createLibrarySyncPageFixture(browser:Browser,options:{singleBook?:boolean}={}){
 const started=performance.now();
 const api=await createLibraryCloudBrowserFixture(browser);let directory='';
 const server=createServer(async(req,res)=>{
  try{const pathname=new URL(req.url??'/','http://fixture').pathname;if(pathname.includes('..'))throw Error('invalid_path');
   const asset=pathname==='/'?'index.html':pathname.slice(1);let bytes:Buffer;
   try{bytes=await readFile(join(directory,asset));}catch{bytes=await readFile(join(directory,'index.html'));}
   const extension=asset.split('.').pop();res.setHeader('content-type',({js:'text/javascript',css:'text/css',wasm:'application/wasm',svg:'image/svg+xml',json:'application/json'} as Record<string,string>)[extension??'']??'text/html');res.end(bytes);
  }catch{res.writeHead(404);res.end();}
 });server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('loopback_required');const origin=`http://127.0.0.1:${address.port}`;
 const build=options.singleBook?createWebTestBuildCache():webTestBuild;
 directory=await build({VITE_SENSA_MODE:'production',VITE_SENSA_BROWSER_SMOKE:'true',VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable-key',VITE_SENSA_API_URL:api.origin});
 const book=options.singleBook?portableBookDeliveryFixture({baseUrl:api.origin+'/published/',expression:'borrow',title:'雨天借伞'}):undefined;
 const snapshot={format:'sensa-learning-content-registry-v3',publishedAt:'2026-10-03T00:00:00Z',items:book?[book.descriptor]:[]};
 const registry={...snapshot,revision:createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex')};
 console.info(JSON.stringify({stage:'page_fixture',elapsedMs:Math.round(performance.now()-started),books:book?1:0,bookMembers:book?1:0,historyRecords:0,externalAuth:'controlled HTTP',sync:'real API/PostgreSQL'}));
 const contexts:BrowserContext[]=[];
 function session(account:LibraryCloudAccount){
  const now=Math.floor(Date.now()/1000);
  const token=[{alg:'HS256',typ:'JWT'},{sub:account.subject,aud:'authenticated',exp:now+3600,amr:[{method:'otp',timestamp:now}]}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).concat('fixture-signature').join('.');
  return {access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,expires_at:now+3600,user:{id:account.subject,email:'sync@sensa.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},identities:[],created_at:new Date().toISOString()}};
 }
 async function client(account?:LibraryCloudAccount){
  const context=await browser.newContext({locale:'zh-CN',viewport:{width:1280,height:900}});contexts.push(context);
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===origin&&url.pathname.startsWith('/auth/v1/')){
    if(!account){await route.fulfill({status:401,json:{code:'fixture_guest'}});return;}
    if(url.pathname==='/auth/v1/otp'){await route.fulfill({json:{}});return;}
    if(url.pathname==='/auth/v1/verify'||url.pathname==='/auth/v1/token'){await route.fulfill({json:session(account)});return;}
    await route.fulfill({status:503,json:{code:'fixture_auth_unavailable'}});return;
   }
   if(url.origin===api.origin){
    if(options.singleBook&&url.pathname==='/sensa/packages'){await route.fulfill({json:registry});return;}
    const asset=book?.responses.get(url.href);
    if(asset){await route.fulfill({body:Buffer.from(asset),contentType:url.href.endsWith('.sensa-book')?'application/zip':'application/json'});return;}
    if(url.pathname.startsWith('/sensa/library-sync')||url.pathname==='/sensa/web/access/session'){
     if(!account){await route.fulfill({status:401,json:{code:'fixture_guest'}});return;}
     const reply=await fetch(api.origin+url.pathname+url.search,{method:request.method(),headers:{authorization:'Bearer '+account.token,'content-type':'application/json',...(request.headers()['x-sensa-snapshot-format']?{'x-sensa-snapshot-format':request.headers()['x-sensa-snapshot-format']!}:{}),...(request.headers()['x-sensa-sync-protocol']?{'x-sensa-sync-protocol':request.headers()['x-sensa-sync-protocol']!}:{})},...(request.postData()?{body:request.postData()!}:{})});
     try{await route.fulfill({status:reply.status,contentType:'application/json',body:await reply.text()});}catch(error){if(!(error instanceof Error)||!(/Route is already handled|Target.*closed/u.test(error.message)))throw error;}return;
    }
    await route.fulfill({status:503,json:{code:'fixture_unavailable'}});return;
   }
   if(url.origin===origin){await route.continue();return;}await route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(20000);return page;
 }
 return {api,origin,client,session,storageKey:`sb-${new URL(origin).hostname.split('.')[0]}-auth-token`,async close(){await Promise.all(contexts.map(async context=>{await context.unrouteAll({behavior:'ignoreErrors'});await context.close();}));await new Promise<void>(resolve=>server.close(()=>resolve()));await api.close();if(options.singleBook)await rm(dirname(directory),{recursive:true,force:true});}};
}
export async function loginSyncPage(page:Page,origin:string){
 await page.goto(origin+'/profile');await waitForSyncPageBridge(page);await expect(page.locator('#s-profile')).toBeVisible();await page.locator('#settings-security').click();await page.getByRole('button',{name:'登录 Sensa',exact:true}).click();
 await page.getByLabel('邮箱',{exact:true}).fill('sync@sensa.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible({timeout:60000});
}
export async function syncPanel(page:Page,origin:string){await page.goto(origin+'/profile');await waitForSyncPageBridge(page);await expect(page.locator('#s-profile')).toBeVisible();await page.locator('#settings-data').click();return page.locator('.sensa-cloud-sync');}
type Bridge=NonNullable<Window['__sensaBrowserSmoke']>;
async function readSyncPageValue<Value>(page:Page,operation:SmokeRead):Promise<Value>{
 let value:Value|undefined;
 await expect.poll(async()=>{const result=await page.evaluate(observeLibrarySmoke,{operation});if(result.state==='ready')value=result.value as Value;return result.state;}).toBe('ready');
 return value!;
}
export const waitForSyncPageBridge=(page:Page)=>readSyncPageValue<true>(page,'ready');
export const syncPageFacts=(page:Page)=>readSyncPageValue<Awaited<ReturnType<Bridge['durableBackupFactsForTest']>>>(page,'facts');
export const syncPageCheckpoint=(page:Page)=>readSyncPageValue<Awaited<ReturnType<Bridge['cloudCheckpointForTest']>>>(page,'checkpoint');
export async function syncPageStatus(page:Page,allowNativeReplacement=false){
 const result=await page.evaluate(observeLibrarySmoke,{operation:'status' as const,allowNativeReplacement});
 return result.state==='ready'?result.value as string:result.state;
}
export const restoringSyncStatus=(page:Page)=>syncPageStatus(page,true);
