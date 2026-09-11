/** Package discovery/download/enrollment UI. Synthetic identity and content; no provider calls. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {provisionLightweightInitialContent} from '../apps/web/src/experience/learningRuntime/lightweightInitialContent.ts';
const id=()=>crypto.randomUUID();
const material=provisionLightweightInitialContent({learnerUserId:id(),learningTargetId:id(),senseId:id(),senseVersionId:id(),senseExpressionBindingId:id(),resolvedLearningPlanRevisionId:'fixture-v1',expressionSourceVersion:'fixture-v1',senseSourceVersion:'fixture-v1',expression:{surface:'borrow',languageTag:'en',expressionKind:'word'},sense:{meaning:'临时取得他人物品，并预期归还。',familiarLanguageTag:'zh-CN'},originExperience:{source:'other_authoritative_source',sourceVersion:'fixture-v1',personalAnchorUseGrantId:null,experience:{scene:'下雨了，你向同事要一把伞，约好明天归还。',senseFocus:'临时取得他人的物品',featureLabels:[]}},referenceFacts:[],requestedAt:new Date().toISOString()});
if(material.status!=='ready')throw Error('Invalid fixture');
const bundle={format:'sensa-learning-package-v1',id:id(),version:'1',title:'Everyday conversations',targetLanguage:'en',familiarLanguage:'zh-CN',entries:[{senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),expression:'borrow',meaning:'临时取得他人物品，并预期归还。',content:material.materialization.content}]};
const bytes=Buffer.from(JSON.stringify(bundle));
const descriptor={id:bundle.id,version:'1',title:bundle.title,description:'Expressions for everyday conversations with friends and colleagues.',entryCount:1,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),url:'http://127.0.0.1:4399/package.json'};
const origin=process.env.SENSA_LOCAL_WEB_URL??'http://127.0.0.1:3014';
if(new URL(origin).hostname!=='127.0.0.1')throw Error('Loopback required');
const browser=await chromium.launch({headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH});
const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
const subject=id(),errors:string[]=[];let failDownload=true,downloads=0;
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
try{
 await page.goto(origin+'/profile');await page.getByLabel('邮箱',{exact:true}).fill('packages@sensa.invalid');await page.getByRole('button',{name:'发送登录邮件',exact:true}).click();await page.getByRole('button',{name:'邮件中有验证码？',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 await page.getByRole('button',{name:'我的内容',exact:true}).click();
 await page.goto(origin+'/study/learning-entry');
 const screen=page.locator('#s-learning-entry');
 await expect(screen.getByRole('heading',{name:'学习包',exact:true})).toBeVisible();
 await expect(screen.getByRole('button',{name:/Everyday conversations/})).toBeVisible();
 await expect(screen.getByRole('group')).toHaveCount(0);
 await screen.getByRole('searchbox').fill('absent');await expect(screen.getByText('没有找到匹配的学习包')).toBeVisible();await screen.getByRole('button',{name:'清除',exact:true}).click();
 await mkdir('/tmp/sensa-package-entry',{recursive:true});await page.screenshot({path:'/tmp/sensa-package-entry/catalog-desktop.png'});
 await screen.getByRole('button',{name:/Everyday conversations/}).click();await expect(screen.getByRole('searchbox')).toHaveCount(0);
 await screen.getByRole('button',{name:'下载学习包',exact:true}).click();await expect(screen.getByRole('button',{name:'取消下载'})).toBeVisible();await expect(screen.getByRole('button',{name:'下载学习包',exact:true})).toBeEnabled();assert.equal(await count('packages'),0);
 await screen.getByRole('button',{name:'下载学习包',exact:true}).click();await expect(screen.getByRole('button',{name:'加入学习',exact:true})).toBeVisible();assert.equal(downloads,2);assert.equal(await count('learningTargets'),0);
 await expect(screen.getByText('borrow',{exact:true})).toBeVisible();await page.screenshot({path:'/tmp/sensa-package-entry/details-desktop.png'});
 await screen.getByRole('button',{name:'加入学习',exact:true}).click();await expect(screen.getByRole('button',{name:'去学习',exact:true})).toBeVisible();assert.equal(await count('learningTargets'),1);
 await screen.getByRole('button',{name:'返回',exact:true}).click();await expect(screen.getByRole('searchbox')).toBeVisible();await expect(screen.getByText('已加入学习',{exact:true})).toBeVisible();
 await page.getByRole('complementary').getByLabel('界面语言',{exact:true}).selectOption('en');await page.setViewportSize({width:390,height:844});
 await expect(screen.getByRole('heading',{name:'Learning packages',exact:true})).toBeVisible();await page.screenshot({path:'/tmp/sensa-package-entry/catalog-mobile.png'});
 await screen.getByRole('button',{name:/Everyday conversations/}).click();await expect(screen.getByRole('button',{name:'Go to learning',exact:true})).toBeVisible();
 assert(await screen.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:'/tmp/sensa-package-entry/details-mobile.png'});
 await screen.getByRole('button',{name:'Go to learning',exact:true}).click();await expect(page.locator('#s-study')).toBeVisible();
 await page.goto(origin+'/study/learning-entry');await expect(screen.getByRole('searchbox')).toBeVisible();await expect(screen.getByText('Added to learning',{exact:true})).toBeVisible();
 await screen.getByLabel('Import package',{exact:true}).setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});await expect(screen.getByRole('status')).toBeVisible();assert.equal(await count('packages'),1);assert.equal(await count('learningTargets'),1);
 assert.deepEqual(errors,[]);console.log('PASS: package catalog/detail separation, search/reset, download failure/retry, explicit enrollment, content preview, back navigation, learning handoff, reload, invalid import, bilingual narrow layout. Synthetic network only.');
}finally{await browser.close();}
