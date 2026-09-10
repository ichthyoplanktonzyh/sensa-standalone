/** Direct multimodal conversation: isolated browser, synthetic Auth and model. */
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const origin=process.env.SENSA_LOCAL_WEB_URL??'http://127.0.0.1:3014';
if(new URL(origin).hostname!=='127.0.0.1')throw Error('Isolated loopback required');
const browser=await chromium.launch({headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH});
const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
const subject=crypto.randomUUID(),errors:string[]=[],requests:any[]=[];page.on('pageerror',e=>errors.push(e.message));
let fail=true;
const proposal={contextSummary:'Riding home in rain while wearing a raincoat.',explanation:'Raincoat is a coat that keeps rain off. I wore a raincoat on my ride home.',expression:{surface:'raincoat',type:'word',language:'en'},semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'A coat worn to protect the body from rain.',prototypeScenes:[{summary:'Someone wears a coat to stay dry in rain.',participantRoles:['wearer'],states:['raining'],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]}};
await context.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.origin===origin){await route.continue();return;}
 if(u.origin!=='http://127.0.0.1:4399'){await route.abort();return;}
 if(u.pathname==='/auth/v1/otp'){await route.fulfill({json:{}});return;}
 if(u.pathname==='/auth/v1/verify'){
  const token=[{}, {sub:subject,exp:Math.floor(Date.now()/1000)+3600},'fixture'].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  await route.fulfill({json:{access_token:token,refresh_token:'fixture',token_type:'bearer',expires_in:3600,user:{id:subject,email:'chat@sensa.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}});return;
 }
 if(u.pathname==='/sensa/web/access/session'){await route.fulfill({json:{authorized:true,accountId:subject}});return;}
 if(u.pathname==='/sensa/service/status'){await route.fulfill({json:{authorized:true,explanationAvailable:true,checkedAt:new Date().toISOString(),windowHours:24,usage:[]}});return;}
 if(u.pathname==='/sensa/native/agent/turn'){
  const input=route.request().postDataJSON();requests.push(input);await new Promise(r=>setTimeout(r,250));
  if(fail){fail=false;await route.fulfill({status:503,json:{code:'provider_unavailable'}});return;}
  for(const m of input.body.messages)for(const t of m.tool_calls??[])assert(!('index' in t),'Provider metadata must not leak into follow-up requests');
  await route.fulfill({json:{id:input.id,inputDigest:input.inputDigest,response:{model:'deepseek-flash',choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{index:0,id:crypto.randomUUID(),type:'function',function:{name:'propose_meaning',arguments:JSON.stringify(proposal)}}]}}]}}});return;
 }
 await route.fulfill({status:503,json:{code:'fixture_unavailable'}});
});
const rows=(table:string)=>page.evaluate(async table=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open('sensa:local-library:v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});try{return await new Promise<any[]>((resolve,reject)=>{const q=db.transaction(table).objectStore(table).getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}finally{db.close();}},table);
try{
 await page.goto(origin+'/profile');await page.getByLabel('邮箱',{exact:true}).fill('chat@sensa.invalid');await page.getByRole('button',{name:'发送登录邮件',exact:true}).click();await page.getByRole('button',{name:'邮件中有验证码？',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 await page.getByRole('button',{name:'我的内容',exact:true}).click();await page.getByRole('button',{name:'找个表达',exact:true}).click();
 await expect(page.getByRole('heading',{name:'找个表达',exact:true})).toBeVisible();assert.equal(requests.length,0);assert.equal((await rows('drafts')).length,0);
 const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const c=canvas.getContext('2d')!;c.fillStyle='blue';c.fillRect(0,0,32,32);return canvas.toDataURL('image/png').split(',')[1];});
 await page.getByLabel('添加图片',{exact:true}).setInputFiles({name:'coat.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await expect(page.getByRole('img',{name:'coat.png'})).toBeVisible();await page.getByLabel('你想表达什么？',{exact:true}).fill('What is this called?');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.getByText(/服务暂时|模型暂时|服务或网络|模型服务/).filter({visible:true}).last()).toBeVisible();
 await expect.poll(()=>requests.length).toBe(1);const first=requests[0].body.messages[1].content;assert(first.some((p:any)=>p.type==='image_url'&&p.image_url.url.startsWith('data:image/jpeg;base64,')));assert(first.some((p:any)=>p.type==='text'&&p.text.includes('What is this called?')));
 await page.reload();await expect(page.getByRole('button',{name:'继续对话',exact:true})).toBeVisible();assert.equal(requests.length,1);await expect(page.getByRole('img',{name:'coat.png'})).toBeVisible();
 await page.getByRole('button',{name:'继续对话',exact:true}).click();await expect(page.getByRole('button',{name:'保存这个表达',exact:true})).toBeVisible();assert.equal(requests.length,2);
 await page.getByRole('complementary').getByLabel('界面语言',{exact:true}).selectOption('en');await expect(page.getByRole('heading',{name:'Find an expression',exact:true})).toBeVisible();
 await page.getByLabel('What would you like to express?',{exact:true}).fill('Yes, for riding in rain.');await page.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(()=>requests.length).toBe(3);await expect(page.getByRole('button',{name:'Save this expression',exact:true})).toBeEnabled();assert(requests[2].body.messages[0].content.includes('Respond in en'));
 await expect(page.getByRole('region',{name:'Expression to save'})).toContainText(proposal.contextSummary);await page.getByRole('button',{name:'Save this expression',exact:true}).click();
 await expect.poll(async()=> (await rows('meanings')).length).toBe(1);assert.equal((await rows('meanings'))[0].context,proposal.contextSummary);assert.equal((await rows('drafts'))[0].images.length,1);assert.equal((await rows('learningTargets')).length,0);
 await expect(page.getByRole('heading',{name:'Content details',exact:true})).toBeVisible();await expect(page.getByLabel('What would you like to express?',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'My content',exact:true}).click();await page.getByRole('button').filter({hasText:'raincoat'}).last().click();await expect(page.getByRole('heading',{name:'Content details',exact:true})).toBeVisible();await expect(page.getByRole('article',{name:'Expression details'})).toContainText(proposal.contextSummary);
 await page.reload();assert.equal(requests.length,3);await expect(page.getByRole('img',{name:'coat.png'})).toBeVisible();
 await mkdir('/tmp/sensa-expression-chat',{recursive:true});for(const width of [390,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`/tmp/sensa-expression-chat/saved-${width}.png`});}
 await page.goto(origin+'/personal-meaning?meaningId=new');
 await page.getByLabel('Add images',{exact:true}).setInputFiles({name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('not an image')});
 await expect(page.getByText('Choose a JPG, PNG, or WebP image.',{exact:true})).toBeVisible();assert.equal(requests.length,3);
 await page.getByLabel('Add images',{exact:true}).setInputFiles({name:'image-only.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(()=>requests.length).toBe(4);await expect(page.getByRole('button',{name:'Save this expression',exact:true})).toBeEnabled();
 assert((await rows('drafts')).some(d=>d.text===''&&d.images?.length===1));
 await page.reload();await expect(page.getByRole('img',{name:'image-only.png'})).toBeVisible();assert.equal(requests.length,4);
 assert.deepEqual(errors,[]);console.log('PASS: direct chat, text+image wire format, failure/retry and reload without repeats, DeepSeek tool index compatibility, bilingual follow-up, confirmed context/sense/expression, images persisted and no implicit learning enrollment.');
}finally{await browser.close();}
