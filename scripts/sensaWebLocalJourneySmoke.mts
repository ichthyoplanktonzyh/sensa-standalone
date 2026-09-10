/** Formal React local surface, real browser storage; synthetic model responses only. */
import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const origin=process.env.SENSA_LOCAL_WEB_URL??'http://127.0.0.1:3014';
if(new URL(origin).hostname!=='127.0.0.1')throw new Error('Use an isolated loopback Vite server');
const browser=await chromium.launch({headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH});
const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const proposal={explanation:'用 tactful 描述顾及他人感受的得体表达。',expression:{surface:'tactful',type:'word',language:'en'},semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'表达时顾及他人感受，避免冒犯',prototypeScenes:[{summary:'指出问题时措辞得体，让对方愿意接受。',participantRoles:['说话者','听者'],states:['指出问题','顾及感受'],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]}};
let subject=crypto.randomUUID();
let serviceAvailable=true;
const token=()=>[{}, {sub:subject,exp:Math.floor(Date.now()/1000)+3600},'synthetic'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
let count=0;const requests:any[]=[];
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.origin==='http://127.0.0.1:4399'&&url.pathname==='/auth/v1/otp'){await route.fulfill({json:{}});return;}
 if(url.origin==='http://127.0.0.1:4399'&&url.pathname==='/auth/v1/verify'){if(route.request().postDataJSON().token!=='123456'){await route.fulfill({status:400,json:{msg:'invalid code'}});return;}await route.fulfill({json:{access_token:token(),refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user:{id:subject,email:'learner@sensa.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}});return;}
 if(url.origin==='http://127.0.0.1:4399'&&url.pathname==='/sensa/native/access/session'){await route.fulfill({status:serviceAvailable?200:503,json:serviceAvailable?{authorized:true}:{code:'unavailable'}});return;}
 if(url.origin==='http://127.0.0.1:4399'&&url.pathname==='/sensa/service/status'){await route.fulfill({json:{authorized:true,explanationAvailable:true,checkedAt:new Date().toISOString(),windowHours:24,usage:[{kind:'reading',used:0,limit:300},{kind:'teacher',used:2,limit:30},{kind:'content',used:0,limit:30}]}});return;}
 if(url.origin==='http://127.0.0.1:4399'&&url.pathname==='/auth/v1/logout'){await route.fulfill({json:{}});return;}
 if(url.origin===origin){await route.continue();return;}
 if(url.pathname==='/sensa/native/agent/turn'||url.origin==='http://127.0.0.1:4398'&&url.pathname==='/v1/chat/completions'){
  const input=route.request().postDataJSON();const body=input.body??input;requests.push(body);count++;
  const call=count===1?{name:'ask_learner',arguments:JSON.stringify({question:'你更想表达说话得体，还是做事谨慎？'})}:{name:'propose_meaning',arguments:JSON.stringify(proposal)};
  const completion={model:'fixture-model',choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',function:call}]}}]};await route.fulfill({headers:{'access-control-allow-origin':origin},json:input.body?{id:input.id,inputDigest:input.inputDigest,response:completion}:completion});return;
 }
 await route.abort('blockedbyclient');
});
async function capture(name:string){
 await mkdir('/tmp/sensa-web-local',{recursive:true});
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/tmp/sensa-web-local/${name}-${width}.png`});}
 await page.setViewportSize({width:390,height:844});
}
try{
 await page.goto(origin+'/profile');
 await expect(page.getByRole('heading',{name:'欢迎来到 Sensa'})).toBeVisible();
 await page.getByLabel('邮箱',{exact:true}).fill('learner@sensa.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();
 await page.getByLabel('验证码',{exact:true}).fill('000000');await page.getByRole('button',{name:'验证并继续',exact:true}).click();await expect(page.getByText('验证码不正确或已过期，请重新输入。')).toBeVisible();
 await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 for(const name of ['今日','我的内容','我的学习','练习'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Sensa 服务',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'学习偏好 学习方式与每日新学数量'}).click();
 await expect(page.getByRole('heading',{name:'默认学习方式',exact:true})).toBeVisible();
 await page.getByLabel('每日新学数量',{exact:true}).selectOption({label:'10 个意思'});
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.reload();
 await page.getByRole('button',{name:'学习偏好 学习方式与每日新学数量'}).click();
 await expect(page.getByLabel('每日新学数量',{exact:true})).toHaveValue('10');
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('button',{name:'学习计划 学习内容与最近记录'}).click();
 await expect(page.getByRole('heading',{name:'我的学习',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'每日新学上限 10 个意思'})).toBeVisible();
 expect(new URL(page.url()).searchParams.has('library')).toBe(false);
 await page.getByRole('button',{name:'我的内容',exact:true}).click();await expect(page.getByRole('heading',{name:'我的内容',exact:true})).toBeVisible();expect(count).toBe(0);
 await page.getByRole('button',{name:'记录场景',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByLabel('发生了什么？你想表达什么？').fill('我想指出同事的问题，但不想让他难堪。');
 await page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){if(args[1]==='readwrite'){IDBDatabase.prototype.transaction=original;throw new DOMException('Injected quota failure','QuotaExceededError');}return original.apply(this,args);};});
 await page.getByRole('button',{name:'先存着',exact:true}).click();await expect(page.getByLabel('发生了什么？你想表达什么？')).toHaveValue('我想指出同事的问题，但不想让他难堪。');await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('button',{name:'先存着',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.reload();await expect(page.getByRole('button').filter({hasText:'我想指出同事的问题，但不想让他难堪。'}).last()).toBeVisible();
 await page.getByRole('button',{name:/设置/}).click();await expect(page.getByRole('heading',{name:'账号与设置',exact:true})).toBeVisible();await expect(page.getByLabel('连接名称',{exact:true})).not.toBeVisible();await page.getByText('高级设置 · 自定义模型服务',{exact:true}).click();await page.getByLabel('连接名称',{exact:true}).fill('本机测试服务');await page.getByLabel('服务地址',{exact:true}).fill('http://127.0.0.1:4398/v1');await page.getByLabel('模型名称',{exact:true}).fill('fixture-model');await page.getByLabel('Key（可稍后填写）').fill('only-in-memory-test-key');await page.getByRole('button',{name:'保存连接',exact:true}).click();await expect(page.getByText('当前页面已填写 Key',{exact:true})).toBeVisible();
 expect(count).toBe(0);
 await page.getByRole('button',{name:'我的内容',exact:true}).last().click();await page.getByRole('button').filter({hasText:'我想指出同事的问题，但不想让他难堪。'}).last().click();
 await expect(page.getByRole('heading',{name:'澄清意思',exact:true})).toBeVisible();expect(count).toBe(0);
 await page.getByRole('button',{name:'继续对话',exact:true}).click();await expect(page.getByText('你更想表达说话得体，还是做事谨慎？',{exact:true})).toBeVisible();
 await page.getByLabel('补充或更正',{exact:true}).fill('是说话得体，顾及他的感受。');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeEnabled();expect(count).toBe(2);expect(requests[1].messages.some((m:any)=>m.content==='是说话得体，顾及他的感受。')).toBe(true);
 await expect(page.getByText('你更想表达说话得体，还是做事谨慎？',{exact:true})).toBeVisible();
 await capture('clarification');
 await page.reload();await expect(page.getByRole('heading',{name:'澄清意思',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeEnabled();expect(count).toBe(2);
 await page.getByRole('button',{name:'就是这个意思',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog').getByText('tactful',{exact:true})).toBeVisible();
 await capture('confirmation');
 await page.getByRole('button',{name:'就是这个意思，保存',exact:true}).click();await expect(page.getByRole('heading',{name:'意思已确认',exact:true})).toBeVisible();expect(count).toBe(2);
 const snapshot=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('sensa:local-library:v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const tx=db.transaction([...db.objectStoreNames],'readonly');const entries=await Promise.all([...db.objectStoreNames].map(name=>new Promise<unknown>(resolve=>{const r=tx.objectStore(name).getAll();r.onsuccess=()=>resolve({name,rows:r.result});})));db.close();return JSON.stringify(entries);});
 expect(snapshot).not.toContain('only-in-memory-test-key');expect(snapshot).toContain('accept_context_expression_sense');expect(snapshot).not.toContain('study_completion');
 await page.getByRole('button',{name:/设置/}).click();await page.getByText('高级设置 · 自定义模型服务',{exact:true}).click();await expect(page.getByText('当前页面尚未填写 Key',{exact:true})).toBeVisible();expect(count).toBe(2);
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await mkdir('/tmp/sensa-web-local',{recursive:true});await page.screenshot({path:'/tmp/sensa-web-local/providers.png'});
 expect(requests.every(r=>r.model==='sensa-managed')).toBe(true);
 await page.getByRole('button',{name:'退出账号',exact:true}).click();
 await expect(page.getByRole('heading',{name:'欢迎来到 Sensa'})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'欢迎来到 Sensa'})).toBeVisible();
 await page.getByLabel('邮箱',{exact:true}).fill('learner@sensa.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 await expect(page.getByRole('heading',{name:'账号与设置',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'我的内容',exact:true}).click();await expect(page.getByRole('button').filter({hasText:'我想指出同事的问题，但不想让他难堪。'}).last()).toBeVisible();
 expect(count).toBe(2);
 serviceAvailable=false;await page.reload();await expect(page.getByRole('heading',{name:'我的内容',exact:true})).toBeVisible();serviceAvailable=true;
 await page.getByRole('button',{name:/设置/}).click();await page.getByRole('button',{name:'退出账号',exact:true}).click();
 await expect(page.getByRole('heading',{name:'欢迎来到 Sensa'})).toBeVisible();subject=crypto.randomUUID();
 await page.getByLabel('邮箱',{exact:true}).fill('other@sensa.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 await expect(page.getByText('此设备的资料属于另一个账号。请使用原账号登录；本机资料没有改变。')).toBeVisible();
 await expect(page.getByRole('heading',{name:'我的内容',exact:true})).not.toBeVisible();
 expect(errors).toEqual([]);console.log('PASS: full App routes/four navigation sections/preferences persistence/study plan, ContentScreen/Composer/MeaningDetail/Profile: local draft save/failure/reload, provider purpose/ephemeral key, teacher clarification/correction, explicit offline confirmation, no automatic calls. Synthetic model, real React and IndexedDB.');
}catch(e){await mkdir('/tmp/sensa-web-local',{recursive:true});await page.screenshot({path:'/tmp/sensa-web-local/failure.png'});console.error(await page.locator('body').innerText());throw e;}finally{await browser.close();}
