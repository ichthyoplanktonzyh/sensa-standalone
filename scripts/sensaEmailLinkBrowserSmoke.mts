/** Complete Web + real Supabase SDK/PKCE + isolated Chrome; synthetic mail/Auth/API. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,extname,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium,expect,type Browser,type Page} from '@playwright/test';
const root=await mkdtemp(join(tmpdir(),'sensa-email-link-')),output=join(root,'dist');
const subjects=new Map([['owner@sensa.invalid',randomUUID()],['other@sensa.invalid',randomUUID()]]);
type Mail={email:string;challenge:string;redirect:string;code:string;used:boolean};
const inbox:Mail[]=[];const exchanges:string[]=[],admissions:string[]=[],errors:string[]=[];
let browser:Browser|undefined;
const server=createServer(async(req,res)=>{
 const url=new URL(req.url!,'http://localhost');
 const json=(value:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const body=async()=>{const parts=[];for await(const part of req)parts.push(Buffer.from(part));return JSON.parse(Buffer.concat(parts).toString());};
 if(url.pathname==='/auth/v1/otp'){
  const input=await body();assert.equal(input.code_challenge_method,'s256');assert(input.code_challenge);
  const redirect=url.searchParams.get('redirect_to');assert(redirect);assert.equal(new URL(redirect).origin,origin);
  inbox.push({email:input.email,challenge:input.code_challenge,redirect,code:randomUUID(),used:false});json({});return;
 }
 if(url.pathname==='/mail/verify'){
  const mail=inbox.find(m=>m.code===url.searchParams.get('message'))!;
  const destination=new URL(mail.redirect);
  if(url.searchParams.has('expired'))destination.hash='error=access_denied&error_code=otp_expired&error_description=private-provider-detail';
  else destination.searchParams.set('code',mail.code);
  res.writeHead(302,{location:destination.toString()});res.end();return;
 }
 if(url.pathname==='/auth/v1/token'){
  assert.equal(url.searchParams.get('grant_type'),'pkce');const input=await body();exchanges.push(input.auth_code);
  const mail=inbox.find(m=>m.code===input.auth_code);
  if(!mail||mail.used||createHash('sha256').update(input.code_verifier).digest('base64url')!==mail.challenge){json({error:'invalid_grant',error_description:'Invalid test code'},400);return;}
  mail.used=true;const sub=subjects.get(mail.email)!;
  const token=[{alg:'HS256'},{sub,exp:Math.floor(Date.now()/1000)+3600},'fixture'].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  json({access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user:{id:sub,email:mail.email,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}});return;
 }
 if(url.pathname==='/auth/v1/logout'){json({});return;}
 if(url.pathname==='/sensa/web/access/session'){
  const claims=JSON.parse(Buffer.from(req.headers.authorization!.split('.')[1],'base64url').toString());admissions.push(claims.sub);json({authorized:true,accountId:claims.sub});return;
 }
 if(url.pathname==='/sensa/service/status'){json({authorized:true,explanationAvailable:false,checkedAt:new Date().toISOString(),windowHours:24,usage:['reading','teacher','content'].map(kind=>({kind,used:0,limit:30}))});return;}
 if(url.pathname==='/sensa/packages'){json({items:[]});return;}
 if(url.pathname.startsWith('/sensa/')||url.pathname.startsWith('/auth/')){json({code:'fixture_unavailable'},503);return;}
 try{const path=url.pathname.startsWith('/assets/')?resolve(output,'.'+url.pathname):join(output,'index.html');assert(path.startsWith(output+'/'));res.setHeader('content-type',extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'text/html');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const link=(mail:Mail)=>origin+'/mail/verify?message='+mail.code;
async function requestMail(page:Page,email='owner@sensa.invalid'){
 await page.getByLabel('邮箱',{exact:true}).fill(email);
 await page.getByRole('button',{name:'发送登录邮件',exact:true}).click();
 await expect(page.getByRole('heading',{name:'查看登录邮件',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'稍后可重新发送',exact:true})).toBeDisabled();
 return inbox.at(-1)!;
}
async function owner(page:Page){return page.evaluate(async()=>{
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('sensa:local-library:v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const result=await new Promise(resolve=>{const r=db.transaction('meta').objectStore('meta').get('service-owner');r.onsuccess=()=>resolve(r.result);});db.close();return result;
});}
try{
 await promisify(execFile)('npm',['run','build','-w','@sensa/web','--','--outDir',output],{env:{...process.env,VITE_SENSA_MODE:'production',VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-public',VITE_SENSA_API_URL:origin},maxBuffer:8*1024*1024});
 browser=await chromium.launch({headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH});
 const context=await browser.newContext({serviceWorkers:'block'});context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 const page=await context.newPage();await page.goto(origin+'/profile');
 const mail=await requestMail(page);
 assert.equal(mail.redirect,origin+'/profile');
 const otherBrowser=await browser.newContext({serviceWorkers:'block'}),wrong=await otherBrowser.newPage();
 await wrong.goto(link(mail));await expect(wrong.getByRole('status')).toContainText('登录链接已失效');
 assert.equal(exchanges.length,0);assert.equal(new URL(wrong.url()).search,'');await otherBrowser.close();
 const callback=await context.newPage();await callback.goto(link(mail));
 await expect(callback.getByRole('heading',{name:'Sensa 服务',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Sensa 服务',exact:true})).toBeVisible();
 assert.equal(exchanges.length,1);assert.equal(new URL(callback.url()).search,'');
 const saved=await owner(callback);assert(saved);
 await callback.reload();await expect(callback.getByRole('heading',{name:'Sensa 服务',exact:true})).toBeVisible();assert.equal(exchanges.length,1);
 await callback.goto(link(mail));await expect(callback.getByRole('status')).toContainText('登录链接已失效');assert.deepEqual(await owner(callback),saved);
 await callback.getByLabel('界面语言',{exact:true}).selectOption('en');await expect(callback.getByRole('status')).toContainText('sign-in link has expired');
 await callback.goto(origin+'/profile');await expect(callback.getByRole('heading',{name:'Sensa services',exact:true})).toBeVisible();
 await context.close();
 // A fresh flow receives a provider error. Its text/hash must never reach the UI.
 const failedContext=await browser.newContext({serviceWorkers:'block'}),failed=await failedContext.newPage();await failed.goto(origin+'/profile');
 const expired=await requestMail(failed);await failed.goto(link(expired)+'&expired=1');
 await expect(failed.getByRole('status')).toContainText('登录链接已失效');assert.equal(new URL(failed.url()).hash,'');await expect(failed.locator('body')).not.toContainText('private-provider-detail');
 // Resending after failure recovers normally; link destination preserves extension parameters.
 await failed.goto(origin+'/profile?extension=connect&state=test-state');
 const retry=await requestMail(failed);assert.equal(new URL(retry.redirect).searchParams.get('state'),'test-state');
 await failed.goto(link(retry));await expect(failed.getByRole('heading',{name:'连接 Sensa 浏览器插件',exact:true})).toBeVisible();assert(!new URL(failed.url()).searchParams.has('code'));
 const original=await owner(failed);
 await failed.goto(origin+'/profile');
 // Request a different identity without changing the admitted local library.
 await failed.evaluate(async()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('sb-')&&k.endsWith('-auth-token'))!;localStorage.removeItem(key);});
 await failed.reload();
 await failed.getByRole('button',{name:/登录|连接服务/}).first().click();
 const foreign=await requestMail(failed,'other@sensa.invalid');await failed.goto(link(foreign));
 await expect(failed.getByRole('status')).toContainText('此设备的资料属于另一个账号');assert.deepEqual(await owner(failed),original);assert(!admissions.includes(subjects.get('other@sensa.invalid')!));
 await failedContext.close();assert.deepEqual(errors,[]);
 console.log('PASS: real SDK PKCE challenge exchange, same-browser new-tab login, original-tab recovery, reload, replay/wrong-browser/expired errors, bilingual feedback, extension destination and foreign-account isolation. Synthetic mail/Auth/API only.');
}finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
