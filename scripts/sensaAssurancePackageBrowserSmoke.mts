/** Package discovery/download/enrollment UI. Synthetic identity and content; no provider calls. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {assuranceView} from '../apps/web/src/data/library/assurance.ts';
import {packageKey} from '../apps/web/src/data/library/packages.ts';
const id=()=>crypto.randomUUID();
const descriptor=JSON.parse(await readFile('release-candidate/assurance-catalog.json','utf8')).items[0];
const bytes=await readFile('release-candidate/learning-packages/'+descriptor.url.split('/').at(-1));
const bundle=JSON.parse(bytes.toString());descriptor.url='http://127.0.0.1:4399/package.json';
const pack={key:packageKey(bundle),bundle,digest:descriptor.sha256,installedAt:new Date().toISOString()};
const origin=process.env.SENSA_LOCAL_WEB_URL??'http://127.0.0.1:3014';
if(new URL(origin).hostname!=='127.0.0.1')throw Error('Loopback required');
const browser=await chromium.launch({headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH});
const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
page.setDefaultTimeout(10000);
const subject=id(),errors:string[]=[];let failDownload=false,downloads=0;
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
 if(u.pathname==='/sensa/packages')return json({items:[descriptor]});
 if(u.pathname==='/package.json'){downloads++;await new Promise(r=>setTimeout(r,300));if(failDownload){failDownload=false;return route.fulfill({status:503,body:''});}return route.fulfill({body:bytes,contentType:'application/json'});}
 await route.fulfill({status:503,json:{code:'fixture_unavailable'}});
});
const count=(table:string)=>page.evaluate(async table=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('sensa:local-library:v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise<number>((resolve,reject)=>{const r=db.transaction(table).objectStore(table).count();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}},table);
const rows=(table:string)=>page.evaluate(async table=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('sensa:local-library:v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise<any[]>((resolve,reject)=>{const r=db.transaction(table).objectStore(table).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}},table);
try{
 await page.goto(origin+'/profile');await page.getByLabel('邮箱',{exact:true}).fill('packages@sensa.invalid');await page.getByRole('button',{name:'发送登录邮件',exact:true}).click();await page.getByRole('button',{name:'邮件中有验证码？',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 await page.getByRole('button',{name:'我的内容',exact:true}).click();await page.goto(origin+'/study/learning-entry');const screen=page.locator('#s-learning-entry');await screen.getByRole('button',{name:/Borrow & lend/}).click();await screen.getByRole('button',{name:'下载学习包',exact:true}).click();await expect(screen.getByRole('button',{name:'加入学习',exact:true})).toBeVisible();assert.equal(await count('learningTargets'),0);await screen.getByRole('button',{name:'加入学习',exact:true}).click();await screen.getByRole('button',{name:'查看 borrow 的详情',exact:true}).click();
 const details=page.locator('#s-learning-target');await expect(details.getByRole('heading',{name:'高保证学习',exact:true})).toBeVisible();await expect(details.locator('audio')).toHaveCount(5);
 await details.locator('audio').first().evaluate(async(a:HTMLAudioElement)=>{await a.play();a.pause();if(!Number.isFinite(a.duration)||a.duration<=0)throw Error('Audio did not decode');});
 await details.getByRole('button',{name:'开始 / 继续学习',exact:true}).click();await page.getByRole('button',{name:'确认数量并开始',exact:true}).click();
 const runtime=page.locator('#s-lightweight-runtime');await expect(runtime.getByRole('heading',{name:'建立经验',exact:true})).toBeVisible();await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toHaveCount(0);
 await mkdir('/tmp/sensa-assurance',{recursive:true});await page.screenshot({path:'/tmp/sensa-assurance/experience.png'});
 let steps=0;const gates=new Set();
 while(steps++<80){
  const runs=await rows('learningRuns');const run=runs.find(r=>r.assurance&&!r.completedAt)??runs.at(-1);if(run?.completedAt)break;if(!run)throw Error('Missing run');
  const view=assuranceView(run,pack)!;
  if(steps===6){await page.reload();await expect(runtime).toBeVisible();assert.equal((await rows('learningRuns'))[0].revision,run.revision);}
  if(view.introduction){await runtime.getByRole('button',{name:run.assurance.revealed?'继续检验':'看看如何表达',exact:true}).click();}
  else if(run.assurance.feedback)await runtime.getByRole('button',{name:'继续',exact:true}).click();
  else{const r=view.resource!;gates.add(view.action.capability);if(r.kind==='meaning_to_form_recall'){await runtime.getByRole('textbox',{name:'输入表达',exact:true}).fill(r.primaryForm);await runtime.getByRole('button',{name:'提交答案',exact:true}).click();}else{const label=r.kind==='novel_context_transfer'?r.scenario.options.find(o=>o.isCorrect)!.labelL1:r.options.find(o=>o.isCorrect)!.textL1;await runtime.getByRole('button',{name:label,exact:true}).click();}}
  await expect.poll(async()=>((await rows('learningRuns')).find(r=>r.id===run.id)?.revision)).toBe(run.revision+1);
 }
 await expect(runtime.getByRole('heading',{name:'本次学习已完成',exact:true})).toBeVisible();assert.equal(gates.size,4);assert.equal((await rows('learningTargets')).find(t=>t.expression==='borrow').memoryRevision,1);
 await page.setViewportSize({width:390,height:844});assert(await runtime.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:'/tmp/sensa-assurance/completion-mobile.png'});
 await runtime.getByRole('button',{name:'继续学习',exact:true}).click();await expect(runtime.getByRole('heading',{name:'建立经验',exact:true})).toBeVisible();assert.equal((await rows('learningRuns')).length,2);
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('banner').getByLabel('界面语言',{exact:true}).selectOption('en');await page.goto(origin+'/?flow=lightweight');await expect(runtime.getByText('High-assurance learning',{exact:true})).toBeVisible();await expect(runtime.getByRole('heading',{name:'Build experience',exact:true})).toBeVisible();
 assert.deepEqual(errors,[]);console.log('PASS: real assurance bundle/download, audio decode, fixed high-assurance entry, hidden initial expression, four checks, reload, graduation, next target, pause/resume, English and mobile layout. No model calls.');
}finally{await browser.close();}
