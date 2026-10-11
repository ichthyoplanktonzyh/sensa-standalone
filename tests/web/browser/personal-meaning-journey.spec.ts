/** Shipped UI + real OPFS, controlled compatible-model HTTP stream. No paid calls. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {extname,join,resolve} from 'node:path';
import {test as base,expect,type Page,type Locator,type TestInfo} from '@playwright/test';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {semanticLookupPayload,syntheticSemanticWorld} from '../support/semanticLookupFixtures';
import type {JourneyState} from '../../../apps/web/src/experience/personalMeaningJourney/store';
import {assertInteractionBudget} from '../support/interactionBudget';

declare global{interface Window{semanticDetailPaint?:{startedAt:number;elapsedMs:number|null}}}

let server:Server,origin:string,output:string;
type Plan={value:unknown;hold?:boolean;fail?:boolean};
let plans:Plan[]=[],requests:Array<{messages:Array<{role:string;content:string}>;tools:Array<{function:{name:string}}>}> = [];
let releaseStream:(()=>void)|undefined;
let scaleFixture:JourneyState|undefined;
const proposal={context:'上班前，学习者给家里的植物浇水。',sense:'给植物供水的动作。',senseKey:'water_plants',scene:'学习者用水壶给家里的植物浇水。',expression:'water',expressionType:'word',relation:'realizes',coverage:'exact',reason:'water 可以作动词表示给植物浇水。'};
const answer={reply:'这里可以说 water，表示给植物浇水。你看这个表达合适吗？',clarity:{context:true,sense:true,expression:true},proposal};
const snapshot={format:'sensa-learning-content-registry-v3',publishedAt:'2026-10-03T00:00:00Z',items:[]};
const registry={...snapshot,revision:createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex')};
const types:Record<string,string>={'.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const practicePreference={source:'personal',expressionIds:['pending-source-selection']};
const test=base.extend<{meaningSetup:{size:number;world:boolean};preparedMeaningPage:{page:Page;modelCalls:string[]}}>({
 meaningSetup:[{size:0,world:false},{option:true}],
 preparedMeaningPage:[async({page,meaningSetup},use)=>{
  const started=performance.now(),modelCalls:string[]=[];requests=[];plans=[];
  page.on('request',request=>{if(/chat\/completions|semantic-agent|\/tts|model.*execute/.test(request.url()))modelCalls.push(request.url());});
  if(meaningSetup.world)await page.addInitScript(preference=>{
   const key='sensa:web-ui:v1:sensa.practice.materials.v4:en';
   if(localStorage.getItem(key)===null)localStorage.setItem(key,JSON.stringify(preference));
  },practicePreference);
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
  const worldButton=page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true});
  await expect(worldButton).toBeVisible();
  if(!meaningSetup.world)await worldButton.click();
  if(meaningSetup.size){
   const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
   await modules.semanticIntake.submit(semanticLookupPayload());scaleFixture=syntheticSemanticWorld(await repository.load(),meaningSetup.size);
   if(meaningSetup.world){
    await modules.personalMeaningJourney.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'尚待确认的材料'}]});
    const pending=await repository.load();scaleFixture.inboxItems=pending.inboxItems;scaleFixture.clarificationDrafts=pending.clarificationDrafts;
   }
   await page.waitForFunction(()=>!!window.__sensaBrowserSmoke);
   expect(await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await (await fetch('/semantic-scale-fixture')).json()))).toBe(meaningSetup.size);
   if(!meaningSetup.world)await page.reload();
  }
  console.log('Personal Meaning fixture preparation (not user interaction):',JSON.stringify({size:meaningSetup.size,world:meaningSetup.world,preparedMs:performance.now()-started}));
  await use({page,modelCalls});
 },{timeout:300_000}],
});
test.setTimeout(90_000);
test.use({locale:'zh-CN',viewport:{width:1280,height:900}});

test.beforeAll(async()=>{
 test.setTimeout(180_000);
 await mkdir('.tmp',{recursive:true});output=await mkdtemp(resolve('.tmp/personal-meaning-journey-'));
 const dist=join(output,'dist');
 server=createServer(async(req,res)=>{
  const url=new URL(req.url??'/',origin||'http://127.0.0.1');
  if(url.pathname==='/semantic-scale-fixture'&&scaleFixture){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(scaleFixture));return;}
  if(url.pathname==='/v1/chat/completions'){
   let body='';for await(const chunk of req)body+=chunk.toString();
   const request=JSON.parse(body);requests.push(request);const plan=plans.shift();
   if(!plan){res.writeHead(500);res.end('fixture plan exhausted');return;}
   if(request.stream!==true){
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({model:'fixture-teacher',choices:[{finish_reason:'stop',message:{content:JSON.stringify(plan.value)}}]}));return;
   }
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});
   const delta=(content:string)=>res.write('data: '+JSON.stringify({model:'fixture-teacher',choices:[{index:0,delta:{content},finish_reason:null}]})+'\n\n');
   const raw=JSON.stringify(plan.value),prefix=raw.slice(0,raw.indexOf('water')+5);
   delta(prefix);
   if(plan.hold)await new Promise<void>(done=>{releaseStream=done;res.on('close',done);});
   if(res.destroyed)return;
   if(plan.fail){res.end();return;}
   delta(raw.slice(prefix.length));
   res.end('data: '+JSON.stringify({model:'fixture-teacher',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;
  }
  if(url.pathname==='/sensa/packages'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(registry));return;}
  if(url.pathname==='/sensa/resource-facts'){
   let body='';for await(const chunk of req)body+=chunk.toString();
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({input:JSON.parse(body),references:[]}));return;
  }
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/sensa/')||url.pathname.startsWith('/auth/')){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({code:'authentication_required'}));return;}
  const path=resolve(dist,`.${url.pathname}`);
  if(!path.startsWith(dist+'/')&&path!==dist){res.writeHead(404);res.end();return;}
  try{const extension=extname(path);res.writeHead(200,{'content-type':types[extension]??'text/html','cache-control':'no-store'});res.end(await readFile(extension?path:join(dist,'index.html')));}
  catch{res.writeHead(404);res.end();}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 execFileSync('npm',['run','build','-w','@sensa/web','--','--outDir',dist,'--emptyOutDir'],{
  env:{...process.env,VITE_SENSA_MODE:'production',VITE_SENSA_BROWSER_SMOKE:'true',VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-public-key',VITE_SENSA_API_URL:origin},stdio:'pipe',
 });
});
test.afterEach(()=>{releaseStream?.();releaseStream=undefined;});
test.afterAll(async()=>{releaseStream?.();if(server?.listening)await new Promise<void>(done=>server.close(()=>done()));if(output)await rm(output,{recursive:true,force:true});});

async function enterAndConfigureTeacher(page:Page,content=false){
 requests=[];plans=[];
 await page.addInitScript(()=>{(window as unknown as {__name:(value:unknown)=>unknown}).__name=value=>value;});
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await configureTeacher(page,content);
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'和 Sensa 聊聊',exact:true}).click();
}
async function configureTeacher(page:Page,content=false){
 await page.getByRole('button',{name:'账号与设置',exact:true}).click();
 await page.locator('#s-profile').getByRole('button',{name:/模型服务/}).click();
 await page.getByRole('button',{name:'添加本机连接',exact:true}).click();
 const form=page.locator('form').filter({has:page.getByRole('heading',{name:'添加本机连接',exact:true})});
 await form.getByLabel('名称',{exact:true}).fill('旅程测试教师');
 await form.getByLabel('服务地址',{exact:true}).fill(origin+'/v1');
 await form.getByLabel('模型名称',{exact:true}).fill('fixture-teacher');
 await form.getByLabel('密钥（可稍后填写）',{exact:true}).fill('fixture-not-a-secret');
 await form.getByRole('button',{name:'保存连接',exact:true}).click();
 await page.getByLabel('澄清与解释',{exact:true}).selectOption({label:'旅程测试教师 · fixture-teacher'});
 if(content)await page.getByLabel('学习材料生成',{exact:true}).selectOption({label:'旅程测试教师 · fixture-teacher'});
 await expect(page.getByLabel('澄清与解释',{exact:true})).toBeEnabled();
}
const facts=async(page:Page)=>{
 await page.waitForFunction(()=>!!window.__sensaBrowserSmoke);
 return page.evaluate(async()=>({contains:await window.__sensaBrowserSmoke!.semanticWorldContainsExpression('water'),inbox:await window.__sensaBrowserSmoke!.intakeInboxCount(),provisioning:await window.__sensaBrowserSmoke!.provisioningCheckpoint(),learning:await window.__sensaBrowserSmoke!.learningCheckpoint()}));
};
const input=(page:Page)=>page.getByLabel('你想表达什么？',{exact:true});
async function send(page:Page){await input(page).fill('上班前我给家里的植物浇水，这个动作英语怎么说？');await page.getByRole('button',{name:'发送',exact:true}).click();}

test('Today personal-content entry offers non-AI recording without reopening the consumed chooser',async({page})=>{
 requests=[];plans=[];
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await page.getByRole('button',{name:'添加个人内容',exact:true}).click();
 await expect(page.getByRole('heading',{name:'添加内容',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'手动创建',exact:true})).toBeVisible();
 const chooser=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'添加内容',exact:true})});
 await expect(chooser.getByRole('button',{name:/和 Sensa 聊聊/})).toBeVisible();
 await expect(chooser.getByRole('button',{name:/记录场景/})).toBeVisible();
 await page.getByRole('button',{name:'手动创建',exact:true}).click();
 const form=page.locator('.sensa-manual-meaning');
 await expect(form.getByLabel('情境或原句',{exact:true})).toBeEnabled();
 await form.getByRole('button',{name:'关闭',exact:true}).click();
 await expect(page.getByRole('heading',{name:'添加内容',exact:true})).toHaveCount(0);
 await page.reload();
 await expect(page.getByRole('heading',{name:'我的语义世界',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'添加内容',exact:true})).toHaveCount(0);
 expect(requests).toEqual([]);
});

for(const size of [0,10_000])test.describe(`manual Meaning fixture ${size}`,{tag:size?'@capacity':[]},()=>{
test.use({meaningSetup:{size,world:false}});
test(`manual authoring at ${size} Meanings needs Context and explicit acceptance, stays offline, and reopens`,async({preparedMeaningPage:{page,modelCalls}},testInfo)=>{
 test.setTimeout(180_000);
 page.setDefaultTimeout(15_000);
 const open=async()=>{await page.getByRole('button',{name:'添加内容',exact:true}).click();await page.getByRole('button',{name:'手动创建',exact:true}).click();};
 await open();const form=page.locator('.sensa-manual-meaning');
 await expect(form.getByLabel('情境或原句',{exact:true})).toBeEnabled();
 await form.getByLabel('原文中的表达（可在上方选中）',{exact:true}).fill('backed out');
 await form.getByRole('button',{name:'确认并保存',exact:true}).click();
 if(!size)expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticWorldContainsExpression('back out'))).toBe(false);
 await form.getByLabel('情境或原句',{exact:true}).fill('She backed out of the trip. I backed out too.');
 await form.getByLabel('表达语言',{exact:true}).selectOption('en');
 await form.getByLabel('表达类型',{exact:true}).selectOption('phrase');
 await form.getByLabel('这里表达的意思',{exact:true}).fill('退出已经答应参加的活动。');
 await form.getByLabel('这个意思适用的典型场景',{exact:true}).fill('有人答应参加活动，后来改变主意不再参加。');
 await form.getByText('表达原形（可选）',{exact:true}).click();
 await form.getByLabel('表达原形（可选）',{exact:true}).fill('back out');
 await form.getByRole('button',{name:'确认并保存',exact:true}).click();await expect(form.getByRole('alert')).toContainText('准确位置');
 await form.getByRole('radio').last().check();
 if(!size){
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('manual-meaning-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});
 }
 await form.getByRole('button',{name:'关闭',exact:true}).click();
 if(!size)expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticWorldContainsExpression('back out'))).toBe(false);
 await page.reload();await open();
 await expect(form.getByLabel('这里表达的意思',{exact:true})).toHaveValue('退出已经答应参加的活动。');
 await expect(form.getByRole('radio').last()).toBeChecked();
 if(!size){
  // Fail only this editing draft's durable retry write, then exercise the UI retry.
  await page.evaluate(()=>{
   const original=Storage.prototype.setItem;
   Storage.prototype.setItem=function(key,value){if(key.includes('manual-meaning:')){Storage.prototype.setItem=original;throw new DOMException('fixture quota exceeded','QuotaExceededError');}return original.call(this,key,value);};
  });
  await form.getByRole('button',{name:'确认并保存',exact:true}).click();
  await expect(form.getByRole('alert')).toContainText('内容已保留');
  await expect(form.getByLabel('这里表达的意思',{exact:true})).toHaveValue('退出已经答应参加的活动。');
 }
 await page.context().setOffline(true);
 const started=await page.evaluate(()=>performance.now());
 const readyMs=await clickToMeaningReady(page,form.getByRole('button',{name:'确认并保存',exact:true}),'back out');
 await expect(form).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'back out',exact:true})).toBeVisible();
 await expect(page.getByText('退出已经答应参加的活动。',{exact:true}).first()).toBeVisible();
 const timing=await page.evaluate(started=>({durationMs:performance.now()-started,phases:performance.getEntriesByType('measure').filter(entry=>entry.startTime>=started&&entry.name.startsWith('sensa.journey.')).map(entry=>entry.name)}),started);
 console.log('Manual click to readable stable actionable detail / Chromium+OPFS / no model',JSON.stringify({size,readyMs,...timing}));
 expect(timing.phases).not.toContain('sensa.journey.records');expect(timing.phases).not.toContain('sensa.journey.authority');
 assertInteractionBudget(readyMs,1000,'manual meaning confirmation');
 const savedUrl=page.url();
 const learning=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(learning.targetIds).toEqual([]);expect(learning.records).toEqual([]);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);
 await page.context().setOffline(false);await page.reload();
 await expect(page.getByRole('heading',{name:'back out',exact:true})).toBeVisible();
 expect(page.url()).toBe(savedUrl);
 if(!size)expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticWorldContainsExpression('back out'))).toBe(true);
 expect(modelCalls).toEqual([]);expect(requests).toEqual([]);
 await page.screenshot({path:testInfo.outputPath('manual-meaning-detail.png'),fullPage:true});
});
});

test('empty example favorites stay out of the default World while retained examples remain findable and cancellable after OPFS reload',async({page})=>{
 requests=[];plans=[];await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 const worldButton=page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true});
 await worldButton.click();await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();
 const examples=page.getByRole('button',{name:/^收藏的例句\s/u});
 await expect(page.getByRole('button',{name:/^收藏的意思\s+0$/u})).toBeVisible();await expect(examples).toHaveCount(0);
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 const retained=await page.evaluate(()=>window.__sensaBrowserSmoke!.retainExampleForTest());if(!retained.text)throw Error('Missing actual bundled Example');
 await expect(examples).toHaveText('收藏的例句1');await page.evaluate(()=>window.__sensaBrowserSmoke!.failAnnotationReadsForTest(true));await expect(examples).toHaveText('收藏的例句—');await examples.click();
 const library=page.locator('#s-content-library');await expect(library.getByRole('alert')).toBeVisible();await expect(library.getByText('还没有收藏例句',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failAnnotationReadsForTest(false));await library.getByRole('button',{name:'重试',exact:true}).click();await expect(library.getByRole('button').filter({hasText:retained.text})).toBeVisible();
 await worldButton.click();await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();await expect(examples).toHaveText('收藏的例句1');await page.reload();await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();await expect(examples).toHaveText('收藏的例句1');await examples.click();
 await library.getByRole('button').filter({hasText:retained.text}).click();
 const detail=page.locator('#s-content-example');await expect(detail.locator('blockquote')).toHaveText(retained.text);
 await page.reload();await expect(detail.locator('blockquote')).toHaveText(retained.text);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.retainedExampleIdsForTest())).toEqual([retained.exampleId]);
 await detail.getByRole('button',{name:'取消收藏例句',exact:true}).click();await expect(detail.getByRole('button',{name:'收藏例句',exact:true}).first()).toBeEnabled();
 await worldButton.click();await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();await expect(examples).toHaveCount(0);
 await page.reload();await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();await expect(examples).toHaveCount(0);await expect(page.getByRole('button',{name:/^收藏的意思\s+0$/u})).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.retainedExampleIdsForTest())).toEqual([]);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(requests).toEqual([]);
});

test('a retained Example with unavailable source stays visible as owned data and never becomes a false empty collection',async({page})=>{
 requests=[];plans=[];await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();await expect(page.getByRole('button',{name:/^收藏的意思\s+0$/u})).toBeVisible();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),retained=await page.evaluate(()=>window.__sensaBrowserSmoke!.retainExampleForTest(true));
 const examples=page.getByRole('button',{name:/^收藏的例句\s/u});await expect(examples).toHaveText('收藏的例句1');await examples.click();
 const library=page.locator('#s-content-library');await expect(library.getByRole('alert')).toContainText('语义材料无法读取');await expect(library.getByText('还没有收藏例句',{exact:true})).toHaveCount(0);
 await page.reload();await expect(library.getByRole('alert')).toContainText('语义材料无法读取');await library.getByRole('button',{name:'重试',exact:true}).click();await expect(library.getByRole('alert')).toContainText('语义材料无法读取');expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.retainedExampleIdsForTest())).toEqual([retained.exampleId]);
 const available=await page.evaluate(()=>window.__sensaBrowserSmoke!.retainExampleForTest());if(!available.text)throw Error('Missing actual bundled Example');
 await expect(library.getByRole('alert')).toContainText('语义材料无法读取');await library.getByRole('button').filter({hasText:available.text}).click();await expect(page.locator('#s-content-example blockquote')).toHaveText(available.text);
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();await expect(examples).toHaveText('收藏的例句2');expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.retainedExampleIdsForTest())).toEqual([retained.exampleId,available.exampleId].sort());
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);expect(requests).toEqual([]);
});

test('confirmed Context image limits preserve editing input and saved sources, then valid images persist without learning',async({page})=>{
 requests=[];plans=[];
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'添加内容',exact:true}).click();await page.getByRole('button',{name:'手动创建',exact:true}).click();
 const form=page.locator('.sensa-manual-meaning'),originalText='I water the plants before work.';
 await form.getByLabel('情境或原句',{exact:true}).fill(originalText);await form.getByLabel('原文中的表达（可在上方选中）',{exact:true}).fill('water');
 await form.getByLabel('表达语言',{exact:true}).selectOption('en');await form.getByLabel('这里表达的意思',{exact:true}).fill('给植物供水。');
 await form.getByLabel('这个意思适用的典型场景',{exact:true}).fill('上班前给家中的植物浇水。');await form.getByRole('button',{name:'确认并保存',exact:true}).click();
 await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();
 const meaningId=await page.evaluate(()=>window.__sensaBrowserSmoke!.firstMeaningId()),pins=await page.evaluate(id=>window.__sensaBrowserSmoke!.meaningPinsForTest(id!),meaningId);
 const before=await facts(page);await page.getByRole('button',{name:'编辑场景',exact:true}).click();
 const editor=page.locator('.pmw-screen.active form'),input=editor.locator('input[type="file"][multiple]'),text=editor.getByRole('textbox',{name:'场景',exact:true}),editedText='编辑中的场景，图片被拒绝时仍应保留这段文字。';
 await text.fill(editedText);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=','base64');
 // A decodable PNG with trailing bytes exercises the raw 8 MiB policy before
 // compression, not a malformed-image failure masquerading as a size guard.
 const oversized=Buffer.concat([png,Buffer.alloc(8*1024*1024+1-png.length)]);
 await input.setInputFiles({name:'oversized-valid.png',mimeType:'image/png',buffer:oversized});
 await expect(editor.getByRole('status')).toContainText('8 MB');await expect(editor.locator('img')).toHaveCount(0);await expect(text).toHaveValue(editedText);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMediaCheckpoint())).toEqual([]);expect(await facts(page)).toEqual(before);
 await input.setInputFiles({name:'not-an-image.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic unsupported content')});
 await expect(editor.getByRole('status')).toContainText('JPG、PNG');await expect(editor.locator('img')).toHaveCount(0);await expect(text).toHaveValue(editedText);
 const images=Array.from({length:4},(_,index)=>({name:`scene-${index+1}.png`,mimeType:'image/png',buffer:png}));
 await input.setInputFiles(images);await expect(editor.getByRole('status')).toContainText('最多添加 3 张');await expect(editor.locator('img')).toHaveCount(0);
 expect(await facts(page)).toEqual(before);await input.setInputFiles(images.slice(0,3));await expect(editor.locator('img')).toHaveCount(3);
 await editor.getByRole('button',{name:'保存场景',exact:true}).click();await expect(editor).toHaveCount(0);
 const detail=page.getByRole('article',{name:'表达详情'});await expect(detail.getByText(editedText,{exact:true})).toBeVisible();await expect(detail.locator('img')).toHaveCount(3);
 const media=await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMediaCheckpoint());expect(media).toHaveLength(3);
 await page.reload();await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();await expect(detail.getByText(editedText,{exact:true})).toBeVisible();await expect(detail.locator('img')).toHaveCount(3);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMediaCheckpoint())).toEqual(media);expect(await page.evaluate(id=>window.__sensaBrowserSmoke!.meaningPinsForTest(id!),meaningId)).toEqual(pins);
 await detail.locator('details').first().locator('summary').click();await expect(detail.getByText(originalText,{exact:true})).toBeVisible();
 expect(requests).toEqual([]);expect((await facts(page)).learning).toEqual(before.learning);
});

test('personal meaning favorites and notes survive explicit recycle-bin deletion and same-identity restoration through OPFS reload',async({page,context})=>{
 requests=[];plans=[];
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'添加内容',exact:true}).click();await page.getByRole('button',{name:'手动创建',exact:true}).click();
 const form=page.locator('.sensa-manual-meaning');
 await form.getByLabel('情境或原句',{exact:true}).fill('I forgot my wallet and asked to borrow money.');
 await form.getByLabel('原文中的表达（可在上方选中）',{exact:true}).fill('borrow');
 await form.getByLabel('表达语言',{exact:true}).selectOption('en');await form.getByLabel('表达类型',{exact:true}).selectOption('word');
 await form.getByLabel('这里表达的意思',{exact:true}).fill('暂时借用他人的东西，之后归还。');
 await form.getByLabel('这个意思适用的典型场景',{exact:true}).fill('向朋友暂借钱，并会归还。');
 await form.getByRole('button',{name:'确认并保存',exact:true}).click();
 await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();const originalUrl=page.url();
 const more=page.getByRole('button',{name:'更多',exact:true}),menu=page.getByRole('dialog',{name:'更多',exact:true});
 await more.click();await menu.getByRole('button',{name:'收藏',exact:true}).click();
 await more.click();await expect(menu.getByRole('button',{name:'取消收藏',exact:true})).toBeVisible();
 await menu.getByRole('button',{name:'写笔记',exact:true}).click();
 const note=page.locator('.sensa-note-editor');await note.locator('textarea').fill('忘带钱包时，向朋友暂借钱；之后归还。');
 await note.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(note).toHaveCount(0);
 await page.reload();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await more.click();await expect(menu.getByRole('button',{name:'取消收藏',exact:true})).toBeVisible();
 await menu.getByRole('button',{name:'写笔记',exact:true}).click();await expect(note.locator('textarea')).toHaveValue('忘带钱包时，向朋友暂借钱；之后归还。');
 await note.locator('textarea').press('Escape');await expect(note).toHaveCount(0);
 // An already-open delete confirmation retains its original intent. A real
 // Context edit in another tab must reject it, dismiss the stale confirmation,
 // and leave an actionable notice rather than an endless old-request retry.
 const other=await context.newPage();await other.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await other.goto(originalUrl);await expect(other.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await more.click();await menu.getByRole('button',{name:'删除内容',exact:true}).click();
 const staleDelete=page.getByRole('dialog',{name:'删除这条内容？',exact:true});await expect(staleDelete).toBeVisible();
 await other.getByRole('button',{name:'编辑场景',exact:true}).click();await other.getByRole('textbox',{name:'场景',exact:true}).fill('I forgot my wallet and asked to borrow money. I will return it tomorrow.');
 await other.getByRole('button',{name:'保存场景',exact:true}).click();await expect(other.getByRole('textbox',{name:'场景',exact:true})).toHaveCount(0);
 await expect(staleDelete.getByRole('button',{name:'删除内容',exact:true})).toBeEnabled();await staleDelete.getByRole('button',{name:'删除内容',exact:true}).click();
 await expect(staleDelete).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('原内容已改变，请重新打开最新内容后再操作。');await expect(more).toBeEnabled();
 await expect(page.getByRole('button',{name:'恢复内容',exact:true})).toHaveCount(0);
 await other.getByRole('button',{name:'编辑场景',exact:true}).click();await other.getByRole('textbox',{name:'场景',exact:true}).fill('I forgot my wallet and asked to borrow money.');
 await other.getByRole('button',{name:'保存场景',exact:true}).click();await expect(other.getByRole('textbox',{name:'场景',exact:true})).toHaveCount(0);await other.close();
 // Detail state alone is insufficient: a user must be able to find the saved
 // meaning and note through their actual collection entry points after reload.
 await page.getByRole('button',{name:'返回我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();
 const saved=page.getByRole('button',{name:/^收藏的意思\s+1$/u});await expect(saved).toBeVisible();await saved.click();
 const library=page.locator('#s-content-library');await expect(library.getByRole('button',{name:/borrow/u})).toBeVisible();
 await library.getByRole('button',{name:/borrow/u}).click();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('meaningId')).toBe(new URL(originalUrl).searchParams.get('meaningId'));
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();
 await page.getByRole('button',{name:'我的笔记 1',exact:true}).click();
 await expect(library.getByRole('button',{name:/borrow.*忘带钱包/u})).toBeVisible();await library.getByRole('button',{name:/borrow.*忘带钱包/u}).click();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('meaningId')).toBe(new URL(originalUrl).searchParams.get('meaningId'));
 await more.click();await menu.getByRole('button',{name:'删除内容',exact:true}).click();
 const confirmation=page.getByRole('dialog',{name:'删除这条内容？',exact:true});await confirmation.getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await more.click();await menu.getByRole('button',{name:'删除内容',exact:true}).click();await confirmation.getByRole('button',{name:'删除内容',exact:true}).click();
 await expect(page.getByRole('button',{name:'恢复内容',exact:true})).toBeEnabled();
 await page.reload();await expect(page.getByRole('button',{name:'恢复内容',exact:true})).toBeEnabled();
 await expect(page.getByText('I forgot my wallet and asked to borrow money.',{exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();
 await expect(page.getByRole('button',{name:/^收藏的意思\s+0$/u})).toBeVisible();await expect(page.getByRole('button',{name:'我的笔记 0',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'我的意思',exact:true}).click();
 await expect(page.locator('.sensa-world-row').filter({hasText:'borrow'})).toHaveCount(0);
 await page.getByRole('combobox',{name:'按状态筛选',exact:true}).selectOption('deleted');await page.locator('.sensa-world-row').filter({hasText:'borrow'}).click();
 expect(new URL(page.url()).pathname).toBe(new URL(originalUrl).pathname);expect(new URL(page.url()).searchParams.get('meaningId')).toBe(new URL(originalUrl).searchParams.get('meaningId'));expect(new URL(page.url()).searchParams.get('worldFilter')).toBe('deleted');await page.getByRole('button',{name:'恢复内容',exact:true}).click();
 await expect(more).toBeEnabled();await page.reload();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await more.click();await expect(menu.getByRole('button',{name:'取消收藏',exact:true})).toBeVisible();
 await menu.getByRole('button',{name:'写笔记',exact:true}).click();await expect(note.locator('textarea')).toHaveValue('忘带钱包时，向朋友暂借钱；之后归还。');
 await note.locator('textarea').press('Escape');await expect(note).toHaveCount(0);
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();
 await expect(page.getByRole('button',{name:/^收藏的意思\s+1$/u})).toBeVisible();await expect(page.getByRole('button',{name:'我的笔记 1',exact:true})).toBeVisible();
 expect(requests).toEqual([]);expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toEqual([]);
});

test('personal correction preserves the Meaning and original capture, blocks an unreviewed cross-tab Context, and saves offline with a readable history after reload',async({page,context})=>{
 page.setDefaultTimeout(15_000);
 await context.addInitScript(()=>{
  const trace={page:sessionStorage.getItem('correction-diagnostic-page')??crypto.randomUUID(),events:[] as Array<{id:number;phase:string;at:number;mode:string;visible:string;name:string;stack?:string}>,messages:[] as Array<Record<string,unknown>>};
  sessionStorage.setItem('correction-diagnostic-page',trace.page);Object.assign(window,{__correctionLockTrace:trace});
  let sequence=0;const record=(id:number,phase:string,mode:string,name:string,stack?:string)=>{trace.events.push({id,phase,at:performance.timeOrigin+performance.now(),mode,visible:document.visibilityState,name,...(stack?{stack}:{})});if(trace.events.length>256)trace.events.shift();};
  navigator.locks.request=new Proxy(navigator.locks.request,{apply(target,receiver,args){
   const name=String(args[0]);if(!/sensa-library-transaction-v1|sensa-sqlite-owner-v1/u.test(name))return Reflect.apply(target,receiver,args);
   const index=typeof args[1]==='function'?1:2,callback=args[index],id=++sequence,mode=index===1?'exclusive':args[1]?.mode??'exclusive';
   record(id,'requested',mode,name,new Error().stack);args[index]=async(lock:Lock|null)=>{
    record(id,lock?'granted':'not-granted',mode,name);
    try{return await callback(lock);}finally{record(id,'released',mode,name);}
   };
   return Reflect.apply(target,receiver,args);
  }});
  const message=(direction:string,value:unknown)=>{
   if(!value||typeof value!=='object')return;
   const row=value as {kind?:string;sender?:string;recipient?:string;requestId?:string;input?:{kind?:string};ok?:boolean};
   trace.messages.push({at:performance.timeOrigin+performance.now(),direction,kind:row.kind,sender:row.sender,recipient:row.recipient,requestId:row.requestId,requestKind:row.input?.kind,ok:row.ok});
   if(trace.messages.length>256)trace.messages.shift();
  };
  // Metadata only: never record SQLite values, request keys, auth or prose.
  globalThis.BroadcastChannel=new Proxy(BroadcastChannel,{construct(target,args){
   const channel=Reflect.construct(target,args) as BroadcastChannel;
   if(channel.name.includes('sensa-sqlite-coordinator-v1')){
    const post=channel.postMessage.bind(channel);channel.postMessage=value=>{message('sent',value);post(value);};
    channel.addEventListener('message',event=>message('received',event.data));
   }
   return channel;
  }});
 });
 page.on('pageerror',error=>console.log('Correction browser page error:',error.message));
 page.on('console',message=>{if(message.type()==='error')console.log('Correction browser console error:',message.text());});
 requests=[];plans=[];
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'添加内容',exact:true}).click();await page.getByRole('button',{name:'手动创建',exact:true}).click();
 const initial=page.locator('.sensa-manual-meaning'),capture='Jo asked to borrow my umbrella. I gave it to her.';
 await initial.getByLabel('情境或原句',{exact:true}).fill(capture);await initial.getByLabel('原文中的表达（可在上方选中）',{exact:true}).fill('borrow');
 await initial.getByLabel('表达语言',{exact:true}).selectOption('en');await initial.getByLabel('这里表达的意思',{exact:true}).fill('暂时取得别人的物品，之后归还。');await initial.getByLabel('这个意思适用的典型场景',{exact:true}).fill('向朋友暂借雨伞。');
 await initial.getByRole('button',{name:'确认并保存',exact:true}).click();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 const meaningId=new URL(page.url()).searchParams.get('meaningId'),originalUrl=page.url();
 await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('dialog',{name:'更多',exact:true}).getByRole('button',{name:'收藏',exact:true}).click();
 await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('dialog',{name:'更多',exact:true}).getByRole('button',{name:'写笔记',exact:true}).click();
 const note=page.locator('.sensa-note-editor');await note.locator('textarea').fill('起初理解为从别人那里借入。');await note.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(note).toHaveCount(0);
 const open=async()=>{await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('dialog',{name:'更多',exact:true}).getByRole('button',{name:'修改意思和表达',exact:true}).click();};
 await open();const editor=page.locator('.sensa-meaning-correction');await expect(editor.getByLabel('表达',{exact:true})).toHaveValue('borrow');await expect(editor.getByText(capture,{exact:true})).toBeVisible();
 const write=async()=>{await editor.getByLabel('表达',{exact:true}).fill('lend');await editor.getByLabel('这里表达的意思',{exact:true}).fill('把自己的物品暂时交给别人使用，之后收回。');await editor.getByLabel('这个意思适用的典型场景',{exact:true}).fill('把雨伞暂借给同事，用完后收回。');};
 await write();await editor.getByRole('button',{name:'关闭',exact:true}).click();
 // A corrupt UI-only pending request must not lock the valid typed draft into
 // an endless retry. Recovery is explicit and cannot accept the old request.
 await page.evaluate(meaningId=>{const key=Object.keys(localStorage).find(key=>key.includes('meaning-correction:')&&key.includes(meaningId!));if(!key)throw Error('correction draft missing');const stored=JSON.parse(localStorage.getItem(key)!);localStorage.setItem(key,JSON.stringify({...stored,pending:{payload:null}}));},meaningId);
 await page.reload();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await open();await expect(editor.getByRole('alert')).toBeVisible();await expect(editor.getByLabel('表达',{exact:true})).toHaveValue('lend');await expect(editor.getByLabel('表达',{exact:true})).toBeDisabled();await editor.getByRole('button',{name:'重试读取',exact:true}).click();await expect(editor.getByLabel('表达',{exact:true})).toBeEnabled();await expect(editor.getByLabel('表达',{exact:true})).toHaveValue('lend');await editor.getByRole('button',{name:'关闭',exact:true}).click();
 await open();await expect(editor.getByLabel('表达',{exact:true})).toHaveValue('lend');await expect(editor.getByLabel('这里表达的意思',{exact:true})).toHaveValue('把自己的物品暂时交给别人使用，之后收回。');
 const other=await context.newPage();await other.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await other.goto(originalUrl);
 await other.getByRole('button',{name:'编辑场景',exact:true}).click();const revised='Jo asked to borrow my umbrella. I gave it to her and expect it back tomorrow.';
 await other.getByRole('textbox',{name:'场景',exact:true}).fill(revised);await other.getByRole('button',{name:'保存场景',exact:true}).click();await expect(other.getByRole('textbox',{name:'场景',exact:true})).toHaveCount(0);
 await editor.getByRole('button',{name:'确认并保存',exact:true}).click();await expect(editor.getByRole('alert')).toContainText('原内容已改变');await expect(editor.getByLabel('表达',{exact:true})).toHaveValue('lend');await expect(other.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await editor.getByRole('button',{name:'重试读取',exact:true}).click();await expect(editor.getByText(revised,{exact:true})).toBeVisible();await expect(editor.getByLabel('表达',{exact:true})).toBeEnabled();await expect(editor.getByLabel('表达',{exact:true})).toHaveValue('lend');await expect(editor.getByLabel('这里表达的意思',{exact:true})).toHaveValue('把自己的物品暂时交给别人使用，之后收回。');
 await write();await page.setViewportSize({width:390,height:844});await editor.getByText('语言与表达类型',{exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('correction-mobile.png'),fullPage:true});
 await editor.getByRole('button',{name:'关闭',exact:true}).click();await expect(editor).toHaveCount(0);await open();await expect(editor.getByLabel('表达',{exact:true})).toHaveValue('lend');
 await context.setOffline(true);await editor.getByRole('button',{name:'确认并保存',exact:true}).click();await expect(editor).toHaveCount(0);await expect(page.getByRole('heading',{name:'lend',exact:true})).toBeVisible();await context.setOffline(false);
 expect(new URL(page.url()).searchParams.get('meaningId')).toBe(meaningId);await page.reload();
 try{await expect(page.getByRole('heading',{name:'lend',exact:true})).toBeVisible();}
 catch(error){
  console.log('Correction reload DOM state:',await page.evaluate(()=>({url:location.href,inert:document.querySelector<HTMLElement>('[data-sensa-page-layout="application-shell"]')?.inert,visible:document.visibilityState,status:document.querySelector('main[role="status"]')?.outerHTML,headings:[...document.querySelectorAll('h1,h2')].map(row=>row.textContent)})));
  console.log('Correction reload lock state:',await page.evaluate(()=>navigator.locks.query()));
  console.log('Correction reload lock requests:',JSON.stringify(await page.evaluate(()=>(window as any).__correctionLockTrace)));
  console.log('Correction peer lock requests:',JSON.stringify(await other.evaluate(()=>(window as any).__correctionLockTrace)));
  const probes=[['storage',page.evaluate(()=>window.__sensaBrowserSmoke!.storageDiagnostics())],['meaning',page.evaluate(()=>window.__sensaBrowserSmoke!.firstMeaningId())]] as const;
  console.log('Correction reload storage state:',await Promise.all(probes.map(async([kind,probe])=>({kind,result:await Promise.race([probe.catch(error=>({error:String(error)})),new Promise(resolve=>setTimeout(()=>resolve('bounded diagnostic did not settle'),2000))])}))));
  throw error;
 }
 await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('dialog',{name:'更多',exact:true}).getByRole('button',{name:'过去的意思和表达',exact:true}).click();
 const history=page.getByRole('dialog',{name:'过去的意思和表达',exact:true});await expect(history.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();await expect(history.getByText('暂时取得别人的物品，之后归还。',{exact:true})).toBeVisible();await expect(history.getByRole('button',{name:/加入学习|修改意思/})).toHaveCount(0);await history.getByRole('button',{name:'关闭',exact:true}).click();
 await page.locator('summary').filter({hasText:'查看来源'}).click();await expect(page.getByText(capture,{exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();
 await page.getByRole('button',{name:/^收藏的意思\s+1$/u}).click();await page.locator('#s-content-library').getByRole('button',{name:/borrow/u}).click();
 await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();await expect(page.getByText('暂时取得别人的物品，之后归还。',{exact:true})).toBeVisible();
 expect(new URL(page.url()).searchParams.get('meaningId')).toBe(meaningId);expect(new URL(page.url()).searchParams.get('alignmentId')).toBeTruthy();
 const historicalUrl=page.url();await page.reload();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();expect(page.url()).toBe(historicalUrl);
 await page.locator('#s-content-sense').getByRole('button',{name:/我的笔记/u}).click();await expect(note.locator('textarea')).toHaveValue('起初理解为从别人那里借入。');await note.locator('textarea').fill('旧笔记仍属于借入这个意思。');await note.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(note).toHaveCount(0);
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();await page.getByRole('button',{name:'我的笔记 1',exact:true}).click();
 await page.locator('#s-content-library').getByRole('button',{name:/borrow.*旧笔记仍属于/u}).click();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await page.goto(originalUrl);await expect(page.getByRole('heading',{name:'lend',exact:true})).toBeVisible();await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('dialog',{name:'更多',exact:true}).getByRole('button',{name:'写笔记',exact:true}).click();await expect(note.locator('textarea')).toHaveValue('');await note.getByRole('button',{name:'关闭',exact:true}).click();
 expect(requests).toEqual([]);expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toEqual([]);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);await other.close();
});

test('note editors preserve stale drafts and require an explicit choice after another tab updates or clears the note',async({page,context})=>{
 requests=[];plans=[];
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'添加内容',exact:true}).click();await page.getByRole('button',{name:'手动创建',exact:true}).click();
 const form=page.locator('.sensa-manual-meaning');
 await form.getByLabel('情境或原句',{exact:true}).fill('I forgot my wallet and asked to borrow money.');
 await form.getByLabel('原文中的表达（可在上方选中）',{exact:true}).fill('borrow');
 await form.getByLabel('表达语言',{exact:true}).selectOption('en');await form.getByLabel('表达类型',{exact:true}).selectOption('word');
 await form.getByLabel('这里表达的意思',{exact:true}).fill('暂时借用他人的东西，之后归还。');
 await form.getByLabel('这个意思适用的典型场景',{exact:true}).fill('向朋友暂借钱，并会归还。');
 await form.getByRole('button',{name:'确认并保存',exact:true}).click();
 await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();const url=page.url();
 const openNote=async(tab:Page)=>{
  await tab.getByRole('button',{name:'更多',exact:true}).click();
  await tab.getByRole('dialog',{name:'更多',exact:true}).getByRole('button',{name:'写笔记',exact:true}).click();
  const editor=tab.locator('.sensa-note-editor');await expect(editor.locator('textarea')).toBeEnabled();return editor;
 };
 let editor=await openNote(page);await editor.locator('textarea').fill('最初的笔记');
 await editor.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(editor).toHaveCount(0);
 const other=await context.newPage();await other.goto(url);await expect(other.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 editor=await openNote(page);const otherEditor=await openNote(other);
 await expect(editor.locator('textarea')).toHaveValue('最初的笔记');await expect(otherEditor.locator('textarea')).toHaveValue('最初的笔记');
 await editor.locator('textarea').fill('尚未保存的本机草稿');await otherEditor.locator('textarea').fill('另一窗口更新后的笔记');
 await otherEditor.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(otherEditor).toHaveCount(0);
 await editor.getByRole('button',{name:'保存笔记',exact:true}).click();
 await expect(editor.getByRole('alert')).toContainText('另一窗口更新后的笔记');await expect(editor.locator('textarea')).toHaveValue('尚未保存的本机草稿');
 await expect(editor.getByRole('button',{name:'保存笔记',exact:true})).toBeDisabled();
 await editor.getByRole('button',{name:'使用最新笔记',exact:true}).click();await expect(editor.locator('textarea')).toHaveValue('另一窗口更新后的笔记');
 await editor.locator('textarea').press('Escape');await expect(editor).toHaveCount(0);
 editor=await openNote(page);await editor.locator('textarea').fill('明确选择保留的本机版本');
 const clearing=await openNote(other);await clearing.locator('textarea').fill('');await clearing.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(clearing).toHaveCount(0);
 await editor.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(editor.getByRole('alert')).toContainText('笔记已清空');
 await expect(editor.locator('textarea')).toHaveValue('明确选择保留的本机版本');
 await editor.getByRole('button',{name:'保存我的版本',exact:true}).click();await expect(editor).toHaveCount(0);
 await other.reload();await expect(other.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 const persisted=await openNote(other);await expect(persisted.locator('textarea')).toHaveValue('明确选择保留的本机版本');
 await persisted.getByRole('button',{name:'保存笔记',exact:true}).dblclick();await expect(persisted).toHaveCount(0);
 await other.close();await page.reload();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 editor=await openNote(page);await expect(editor.locator('textarea')).toHaveValue('明确选择保留的本机版本');
 await page.setViewportSize({width:390,height:844});await expect(editor.getByRole('button',{name:'关闭',exact:true})).toBeInViewport();
 await expect(editor.getByRole('button',{name:'保存笔记',exact:true})).toBeInViewport();await editor.getByRole('button',{name:'关闭',exact:true}).click();await expect(editor).toHaveCount(0);
 expect(requests).toEqual([]);expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toEqual([]);
});

async function manualInboxCompletion(page:Page,missing:'context'|'expression'|'sense'|'image'){
 page.setDefaultTimeout(15_000);requests=[];plans=[];
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await expect(page.getByRole('navigation',{name:'主要导航'})).toBeVisible();await page.waitForFunction(()=>!!window.__sensaBrowserSmoke);
 const base=semanticLookupPayload(),mediaId=crypto.randomUUID(),png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=';
 const original={...base,acceptance:null,context:missing==='context'?null:{...base.context!,source:{client:'codex',url:'https://example.test/original',title:'原始网页',sourceReferenceId:'source-manual-completion',domSelector:null,paragraphContext:null},...(missing==='sense'?{modality:'mixed' as const,mediaReferenceIds:[mediaId]}:{}),...(missing==='image'?{modality:'image' as const,textSegment:null,mediaReferenceIds:[mediaId]}:{})},expression:missing==='expression'?null:{...base.expression!,...(missing==='context'?{occurrence:null}:{}),...(missing==='image'?{languageTag:'en-US',occurrence:{surfaceForm:'borrow',locator:{kind:'media_region' as const,mediaReferenceId:mediaId,x:0,y:0,width:1,height:1}}}:{})},sense:['sense','image'].includes(missing)?null:base.sense};
 const id=await page.evaluate(({original,media})=>window.__sensaBrowserSmoke!.seedInboxForTest(original,original.context?.mediaReferenceIds.length?media:undefined),{original,media:{mediaId,mediaKind:'image' as const,mimeType:'image/png',dataUrl:'data:image/png;base64,'+png,sizeBytes:Buffer.from(png,'base64').byteLength,createdAt:'2026-10-05T00:00:00Z'}});
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 const inbox=page.locator('.sensa-intake-inbox'),form=page.locator('.sensa-manual-meaning');
 const open=async()=>{await page.getByRole('button',{name:/^收件箱/u}).click();await inbox.getByRole('button',{name:'手动补全',exact:true}).click();};
 await open();await expect(form.getByLabel('情境或原句',{exact:true})).toBeEnabled();
 if(missing==='context')await form.getByLabel('情境或原句',{exact:true}).fill('I asked to borrow an umbrella on a rainy day.');
 if(missing==='expression'){await form.getByLabel('原文中的表达（可在上方选中）',{exact:true}).fill('borrow');await form.getByLabel('表达语言',{exact:true}).selectOption('en');}
 const fillSense=async()=>{await form.getByLabel('这里表达的意思',{exact:true}).fill('临时取得物品使用，之后归还。');await form.getByLabel('这个意思适用的典型场景',{exact:true}).fill('下雨时向同事借伞，回家后再把伞还给同事。');};
 if(missing==='sense'||missing==='image')await fillSense();
 if(missing==='image')await expect(form.getByLabel('表达语言',{exact:true})).toHaveValue('en-US');
 await form.getByRole('button',{name:'关闭',exact:true}).click();await expect(inbox.getByRole('article')).toHaveCount(1);
 await page.reload();await open();await expect(form.getByLabel('这里表达的意思',{exact:true})).not.toHaveValue('');
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticWorldContainsExpression('borrow'))).toBe(false);
 let capturedText=original.context?.textSegment??null;
 if(missing==='sense'){
  await page.evaluate(id=>window.__sensaBrowserSmoke!.appendInboxContextForTest(id,'原材料新增的一行。'),id);
  await form.getByRole('button',{name:'确认并保存',exact:true}).click();await expect(form.getByRole('alert')).toContainText('材料已发生变化');
  await expect(form.getByLabel('这里表达的意思',{exact:true})).toHaveValue('临时取得物品使用，之后归还。');
  await form.getByRole('button',{name:'关闭',exact:true}).click();await inbox.getByRole('button',{name:'手动补全',exact:true}).click();
  await expect(form.getByRole('button',{name:'确认并保存',exact:true})).toBeDisabled();
  await expect(form.getByLabel('这里表达的意思',{exact:true})).toHaveValue('临时取得物品使用，之后归还。');
  await form.getByRole('button',{name:'从最新材料重新填写',exact:true}).click();await fillSense();
  capturedText=await form.getByLabel('情境或原句',{exact:true}).inputValue();
  await form.getByLabel('情境或原句',{exact:true}).fill(capturedText+' 我的现场补充。');
 }
 let competing:Page|undefined;
 if(missing==='context'){
  competing=await page.context().newPage();
  await competing.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await competing.goto(page.url());await competing.getByRole('button',{name:/^收件箱/u}).click();
  await competing.locator('.sensa-intake-inbox').getByRole('button',{name:'手动补全',exact:true}).click();
  await competing.locator('.sensa-manual-meaning').getByLabel('这里表达的意思',{exact:true}).fill('另一窗口尚未确认的填写。');
 }
 await page.context().setOffline(true);
 if(missing==='context'){
  await page.evaluate(id=>window.__sensaBrowserSmoke!.loseNextInboxResolveResponseForTest(id),id);
  await form.getByRole('button',{name:'确认并保存',exact:true}).click();await expect(form.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
  await expect(form.getByLabel('情境或原句',{exact:true})).toHaveValue('I asked to borrow an umbrella on a rainy day.');
 }
 await form.getByRole('button',{name:'确认并保存',exact:true}).click();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
 if(competing){
  const otherForm=competing.locator('.sensa-manual-meaning');
  await otherForm.getByRole('button',{name:'确认并保存',exact:true}).click();await expect(otherForm.getByRole('alert')).toContainText('材料已发生变化');
  await expect(otherForm.getByLabel('这里表达的意思',{exact:true})).toHaveValue('另一窗口尚未确认的填写。');
  await otherForm.getByRole('button',{name:'关闭',exact:true}).click();await expect(competing.locator('.sensa-intake-inbox').getByRole('article')).toHaveCount(0);
  expect(await competing.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);await competing.close();
 }
 if(missing==='sense'||missing==='image')await expect(page.getByRole('article',{name:'表达详情'}).getByRole('img')).toBeVisible();
 if(missing==='sense')await expect(page.getByRole('article',{name:'表达详情'})).toContainText('我的现场补充。');
 await page.context().setOffline(false);await page.reload();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 if(original.context){const source=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Codex · 原始网页'})});await source.locator('summary').click();await expect(source.getByRole('link')).toHaveAttribute('href','https://example.test/original');if(capturedText)await expect((missing==='sense'?source:page.getByRole('article',{name:'表达详情'})).getByText(capturedText,{exact:true})).toBeVisible();}
 if(missing==='sense'||missing==='image')await expect(page.getByRole('article',{name:'表达详情'}).getByRole('img')).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);expect(requests).toEqual([]);
}
test('manual Inbox completion fills missing context without AI and preserves its original capture',async({page})=>manualInboxCompletion(page,'context'));
test('manual Inbox completion fills missing expression without AI and preserves its original capture',async({page})=>manualInboxCompletion(page,'expression'));
test('manual Inbox completion fills missing sense without AI and preserves its original capture',async({page})=>manualInboxCompletion(page,'sense'));
test('manual Inbox completion preserves a located image occurrence without requiring invented text',async({page})=>manualInboxCompletion(page,'image'));

test('Inbox manual completion can review and reuse a local meaning without accepting it merely by selection',async({page})=>{
 page.setDefaultTimeout(15_000);requests=[];plans=[];
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await expect(page.getByRole('navigation',{name:'主要导航'})).toBeVisible();await page.waitForFunction(()=>!!window.__sensaBrowserSmoke);
 const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock()});await modules.semanticIntake.submit(semanticLookupPayload());scaleFixture=await repository.load();
 const selected=scaleFixture.registry.senses[0]!;
 await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await (await fetch('/semantic-scale-fixture')).json()));
 await page.evaluate(payload=>window.__sensaBrowserSmoke!.seedInboxForTest(payload),{...semanticLookupPayload(),operationId:crypto.randomUUID(),sense:null,acceptance:null});
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 const open=async()=>{await page.getByRole('button',{name:/^收件箱/u}).click();await page.locator('.sensa-intake-inbox').getByRole('button',{name:'手动补全',exact:true}).click();};
 await open();const form=page.locator('.sensa-manual-meaning');await expect(form.getByLabel('情境或原句',{exact:true})).toBeEnabled();
 await form.getByText('选择已有意思',{exact:true}).click();await form.getByLabel('按意思或表达查找',{exact:true}).fill('no-such-expression');await form.getByRole('button',{name:'查找',exact:true}).click();await expect(form.getByRole('status')).toContainText('没有匹配');
 await form.getByLabel('按意思或表达查找',{exact:true}).fill('borrow');await form.getByRole('button',{name:'查找',exact:true}).click();
 await form.getByText('场景与边界',{exact:true}).click();await expect(form.getByText('永久赠送',{exact:true})).toBeVisible();
 await form.getByRole('button',{name:'使用这个意思',exact:true}).click();
 await expect(form.getByLabel('这里表达的意思',{exact:true})).toHaveAttribute('readonly','');
 await form.getByRole('button',{name:'关闭',exact:true}).click();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(1);
 await page.reload();await open();await expect(form.getByRole('button',{name:'自己填写',exact:true})).toBeVisible();
 await page.context().setOffline(true);await form.getByRole('button',{name:'确认并保存',exact:true}).click();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 const id=new URL(page.url()).searchParams.get('meaningId')!;expect(await page.evaluate(id=>window.__sensaBrowserSmoke!.meaningPinsForTest(id),id)).toEqual([{senseId:selected.senseId,senseVersionId:selected.currentSenseVersionId}]);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);expect(requests).toEqual([]);
});

test('Inbox shows original material and media, confirms complete facts offline, and discards only after explicit confirmation',async({page},testInfo)=>{
 page.setDefaultTimeout(15_000);requests=[];plans=[];
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.getByRole('navigation',{name:'主要导航'})).toBeVisible();await page.waitForFunction(()=>!!window.__sensaBrowserSmoke);
 const base=semanticLookupPayload(),mediaId=crypto.randomUUID(),png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=';
 const source={client:'browser-extension',url:'https://example.test/reading',title:'原文来源',sourceReferenceId:null,domSelector:null,paragraphContext:null};
 const imageText=base.context!.textSegment+' '+('原始材料。'.repeat(40))+'完整原文尾部';
 const pending=[
  {...base,operationId:crypto.randomUUID(),acceptance:null,context:{...base.context!,source,textSegment:base.context!.textSegment+' 等待明确确认'}},
  {...base,operationId:crypto.randomUUID(),acceptance:null,sense:null,context:{...base.context!,source,textSegment:imageText,modality:'mixed' as const,mediaReferenceIds:[mediaId]}},
  {...base,operationId:crypto.randomUUID(),acceptance:null,context:null,expression:{...base.expression!,occurrence:null}},
  {...base,operationId:crypto.randomUUID(),acceptance:null,expression:null},
 ];
 const ids=await page.evaluate(async({pending,media})=>{const ids:string[]=[];for(const payload of pending)ids.push(await window.__sensaBrowserSmoke!.seedInboxForTest(payload,payload.context?.mediaReferenceIds.length?media:undefined));return ids;},{pending,media:{mediaId,mediaKind:'image' as const,mimeType:'image/png',dataUrl:'data:image/png;base64,'+png,sizeBytes:Buffer.from(png,'base64').byteLength,createdAt:'2026-10-05T00:00:00Z'}});
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.getByRole('button',{name:/^收件箱/u}).click();
 const inbox=page.locator('.sensa-intake-inbox'),rows=inbox.getByRole('article');await expect(rows).toHaveCount(4);
 for(const state of ['待接纳','待确认词义','待补充语境','待圈定表达'])await expect(inbox.getByText(state,{exact:true})).toBeVisible();
 const imageItem=rows.filter({has:page.getByText('待确认词义',{exact:true})});
 await expect(imageItem.getByText(imageText,{exact:true})).toBeVisible();await expect(imageItem.getByRole('link')).toHaveAttribute('href','https://example.test/reading');
 await imageItem.locator('summary').click();await expect(imageItem.getByRole('img')).toBeVisible();
 expect(await imageItem.getByRole('img').evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true);
 await page.evaluate(mediaId=>window.__sensaBrowserSmoke!.hideInboxMediaForTest(mediaId),mediaId);
 await expect(imageItem.getByRole('alert')).toBeVisible();await imageItem.getByRole('button',{name:'重试',exact:true}).click();await expect(imageItem.getByRole('alert')).toBeVisible();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.restoreInboxMediaForTest());await expect(imageItem.getByRole('img')).toBeVisible();
 await imageItem.getByRole('button',{name:'丢弃',exact:true}).click();await imageItem.getByRole('button',{name:'取消',exact:true}).click();await expect(rows).toHaveCount(4);
 await imageItem.getByRole('button',{name:'丢弃',exact:true}).click();
 await page.evaluate(id=>window.__sensaBrowserSmoke!.appendInboxContextForTest(id,'另一窗口补充了原材料。'),ids[1]!);
 await expect(imageItem.getByText(/另一窗口补充了原材料/u)).toBeVisible();await imageItem.getByRole('button',{name:'确认',exact:true}).click();
 await expect(imageItem.getByRole('alert')).toContainText('材料已发生变化');await expect(rows).toHaveCount(4);await imageItem.getByRole('button',{name:'取消',exact:true}).click();
 const ready=rows.filter({has:page.getByText('待接纳',{exact:true})});await expect(ready.getByRole('button',{name:'确认保存',exact:true})).toBeEnabled();
 await page.evaluate(id=>window.__sensaBrowserSmoke!.failNextInboxCommitForTest(id),ids[0]!);
 await ready.getByRole('button',{name:'确认保存',exact:true}).click();await expect(ready.getByRole('alert')).toBeVisible();await expect(rows).toHaveCount(4);
 await page.context().setOffline(true);await ready.getByRole('button',{name:'确认保存',exact:true}).click();
 await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
 await page.getByRole('button',{name:'返回我的语义世界',exact:true}).click();await page.getByRole('button',{name:/^收件箱/u}).click();await expect(rows).toHaveCount(3);
 await imageItem.locator('summary').click();await expect(imageItem.getByRole('img')).toBeVisible();
 await imageItem.getByRole('button',{name:'丢弃',exact:true}).click();await page.evaluate(id=>window.__sensaBrowserSmoke!.failNextInboxCommitForTest(id),ids[1]!);
 await imageItem.getByRole('button',{name:'确认',exact:true}).click();await expect(imageItem.getByRole('alert')).toBeVisible();await expect(rows).toHaveCount(3);
 await imageItem.getByRole('button',{name:'确认',exact:true}).click();await expect(rows).toHaveCount(2);
 await expect(inbox.getByText('待补充语境',{exact:true})).toBeVisible();await expect(inbox.getByText('待圈定表达',{exact:true})).toBeVisible();
 await page.context().setOffline(false);await page.reload();await page.getByRole('button',{name:/^收件箱/u}).click();await expect(rows).toHaveCount(2);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticWorldContainsExpression('borrow'))).toBe(true);expect(requests).toEqual([]);
 await page.screenshot({path:testInfo.outputPath('inbox-after-explicit-actions.png'),fullPage:true});
});

test('a saved draft can explicitly continue with a newly configured teacher after its initial provider is unavailable',async({page})=>{
 requests=[];plans=[];
 await page.addInitScript(()=>{(window as unknown as {__name:(value:unknown)=>unknown}).__name=value=>value;});
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.getByRole('button',{name:'和 Sensa 聊聊',exact:true}).click();await send(page);
 await expect(page.getByRole('alert')).toContainText('请先登录');const threadUrl=page.url();
 await configureTeacher(page);plans=[{value:answer}];
 // BYOK credentials belong to this page session, not a durable model-secret
 // store. Return through the actual SPA/Inbox flow, not a document reload.
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.holdWorldInboxReadsForTest());
 await page.getByRole('button',{name:/^收件箱/u}).click();
 const inbox=page.locator('.sensa-intake-inbox').getByRole('dialog');
 await expect(inbox.getByRole('status')).toContainText('正在读取 Sensa');
 await page.evaluate(()=>window.__sensaBrowserSmoke!.releaseWorldInboxReadsForTest(true));
 await expect(inbox.getByRole('alert')).toBeVisible();await inbox.getByRole('button',{name:'重试',exact:true}).click();
 await expect(inbox.getByRole('button',{name:'继续对话',exact:true})).toBeEnabled();
 await inbox.getByRole('button',{name:'关闭',exact:true}).click();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.holdWorldInboxReadsForTest());
 await page.getByRole('button',{name:/^收件箱/u}).click();
 await expect(inbox.getByRole('status')).toContainText('正在读取 Sensa');
 await expect(inbox.getByRole('button',{name:'继续对话',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.releaseWorldInboxReadsForTest());
 await inbox.getByRole('button',{name:'继续对话',exact:true}).click();expect(page.url()).toBe(threadUrl);
 await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeEnabled().catch(async cause=>{console.log('Explicit provider-recovery diagnosis:',JSON.stringify({alerts:await page.getByRole('alert').allTextContents(),requests:requests.length,assistant:await page.locator('.pmw-message.is-assistant').allTextContents()}));throw cause;});
 expect(requests).toHaveLength(1);await page.getByRole('button',{name:'就是这个意思',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();
});
/** Start at the actual browser click, not Playwright's preceding stability
 * wait. Require readable, stable detail and a reachable editing action. */
async function clickToMeaningReady(page:Page,action:Locator,label:string,readyAction='编辑场景'){
 await page.evaluate(({label,readyAction})=>{
  window.semanticDetailPaint={startedAt:0,elapsedMs:null};
  document.addEventListener('click',()=>{
   const measure=window.semanticDetailPaint!;measure.startedAt=performance.now();
   let previousGeometry:string|null=null;
   const painted=()=>{
    const heading=document.querySelector<HTMLElement>('.pmw-screen.active article[aria-label="表达详情"] h2');
    const article=heading?.closest('article');
    const edit=[...article?.parentElement?.querySelectorAll<HTMLButtonElement>('button')??[]].find(button=>button.textContent?.trim()===readyAction);
    const readable=(element:HTMLElement|undefined)=>{
     if(!element||element.closest('[inert],[aria-hidden="true"]')||!element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;
     const rect=element.getBoundingClientRect();
     if(rect.width<=0||rect.height<=0||rect.left<0||rect.right>innerWidth||rect.top<0||rect.bottom>innerHeight)return false;
     for(let ancestor:HTMLElement|null=element;ancestor;ancestor=ancestor.parentElement)if(ancestor.getAnimations().some(animation=>animation.playState==='running'))return false;
     const top=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
     return !!top&&(top===element||element.contains(top));
    };
    const ready=heading?.textContent===label&&readable(heading)&&readable(edit)&&!edit!.disabled;
    const geometry=ready?JSON.stringify([heading!.getBoundingClientRect().toJSON(),edit!.getBoundingClientRect().toJSON()]):null;
    if(geometry!==null&&geometry===previousGeometry){measure.elapsedMs=performance.now()-measure.startedAt;return;}
    previousGeometry=geometry;
    if(performance.now()-measure.startedAt<30_000)requestAnimationFrame(painted);
   };
   requestAnimationFrame(painted);
  },{once:true,capture:true});
 },{label,readyAction});
 await action.click();await expect(page.getByRole('heading',{name:label,exact:true})).toBeVisible({timeout:30_000});
 await expect.poll(()=>page.evaluate(()=>window.semanticDetailPaint?.elapsedMs)).not.toBeNull();
 return (await page.evaluate(()=>window.semanticDetailPaint!.elapsedMs))!;
}

test('reply streams before candidate disclosure, explicit acceptance persists, and the learning bridge stays optional',async({page})=>{
 await enterAndConfigureTeacher(page);plans=[{value:answer,hold:true}];await send(page);
 const workspace=page.locator('.pmw-screen.active'),originalSkin=await page.evaluate(()=>document.documentElement.getAttribute('data-sensa-skin'));
 // Exercise the shipped CSS adapters in the live conversation. Preference
 // persistence/switch controls remain the separate Skin Lab boundary.
 try{
  for(const skin of ['quiet','clear'])for(const width of [1280,390]){
   await page.evaluate(skin=>document.documentElement.setAttribute('data-sensa-skin',skin),skin);await page.setViewportSize({width,height:900});
   const workspaceBox=await workspace.boundingBox(),headerBox=await workspace.locator(':scope > [data-sensa-page-region="header"]').boundingBox();
   expect(workspaceBox).not.toBeNull();expect(headerBox).not.toBeNull();
   expect(Math.abs(headerBox!.x-workspaceBox!.x),`${skin}/${width}: conversation must not reserve an empty backdrop column`).toBeLessThan(2);
   expect(headerBox!.width).toBeGreaterThan(workspaceBox!.width-2);
  }
 }finally{await page.evaluate(skin=>{if(skin)document.documentElement.setAttribute('data-sensa-skin',skin);else document.documentElement.removeAttribute('data-sensa-skin');},originalSkin);await page.setViewportSize({width:1280,height:900});}
 await expect(page.locator('.pmw-message.is-assistant')).toContainText('water');
 await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeDisabled();
 expect((await facts(page)).contains).toBe(false);expect((await facts(page)).learning.targetIds).toEqual([]);
 releaseStream!();await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'就是这个意思',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();
 await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();
 await expect(workspace.getByRole('textbox',{name:'你想表达什么？',exact:true})).toHaveCount(0);
 await expect(workspace.getByRole('button',{name:'就是这个意思',exact:true})).toHaveCount(0);
 await expect(page.getByRole('article',{name:'表达详情'}).getByText(proposal.sense,{exact:true}).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();
 expect((await facts(page)).contains).toBe(true);expect((await facts(page)).inbox).toBe(0);
 const saved=await facts(page);expect(saved.learning.targetIds).toEqual([]);expect(saved.learning.records).toEqual([]);
 await page.reload();await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();expect(await facts(page)).toEqual(saved);
 await page.getByRole('button',{name:'编辑场景',exact:true}).click();
 const unsaved=page.getByRole('textbox',{name:'场景',exact:true});await unsaved.fill('尚未保存的场景修改，不能被后台重读丢弃。');
 await page.evaluate(()=>window.__sensaBrowserSmoke!.holdWorldDetailReadsForTest());
 try{
  await page.evaluate(()=>window.__sensaBrowserSmoke!.notifyWorldReadForTest());
  await expect(page.getByRole('button',{name:'保存场景',exact:true})).toBeDisabled();
  await expect(unsaved).toHaveValue('尚未保存的场景修改，不能被后台重读丢弃。');
 }finally{await page.evaluate(()=>window.__sensaBrowserSmoke!.releaseWorldDetailReadsForTest());}
 await expect(page.getByRole('button',{name:'保存场景',exact:true})).toBeEnabled();
 await expect(unsaved).toHaveValue('尚未保存的场景修改，不能被后台重读丢弃。');
 const editedId=await page.evaluate(()=>window.__sensaBrowserSmoke!.firstMeaningId());expect(editedId).not.toBeNull();
 await page.evaluate(id=>window.__sensaBrowserSmoke!.reviseMeaningContextForTest(id!,'另一写入者保存了新场景，旧编辑不能覆盖。'),editedId);
 await expect(page.getByRole('article',{name:'表达详情'}).getByText('另一写入者保存了新场景，旧编辑不能覆盖。',{exact:true})).toBeVisible();
 await expect(unsaved).toHaveValue('尚未保存的场景修改，不能被后台重读丢弃。');
 await page.getByRole('button',{name:'保存场景',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('原内容已改变');
 await expect(unsaved).toHaveValue('尚未保存的场景修改，不能被后台重读丢弃。');
 await expect(page.getByRole('article',{name:'表达详情'}).getByText('另一写入者保存了新场景，旧编辑不能覆盖。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'取消编辑',exact:true}).click();
 const source=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Sensa · Sensa Web'})});
 await source.locator('summary').click();
 await expect(source.getByText('上班前我给家里的植物浇水，这个动作英语怎么说？',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'加入学习',exact:true}).click();
 await expect(page.getByRole('region',{name:'个人内容学习准备'})).toContainText('请先登录 Sensa 在线服务');
 await expect(page.getByRole('button',{name:'重试 / 恢复准备',exact:true})).toBeVisible();
 expect((await facts(page)).learning.records).toEqual([]);
 expect((await facts(page)).learning.runtime).toBeNull();
 const enrolled=await facts(page);
 expect(enrolled.provisioning,'explicit intent is durable even when its provider is unavailable').toHaveLength(1);
  expect(enrolled.provisioning[0]!.status).toBe('failed');
  const preparation=page.getByRole('region',{name:'个人内容学习准备',exact:true});
  const consent=preparation.getByRole('checkbox',{name:'使用我的场景准备学习内容。',exact:true});
  await expect(consent).not.toBeChecked();await consent.check();
  expect((await facts(page)).provisioning[0]!.useContext,'changing the checkbox alone is not a saved grant').toBe(false);
  await preparation.getByRole('button',{name:'重试 / 恢复准备',exact:true}).click();
  await expect.poll(async()=>(await facts(page)).provisioning[0]).toMatchObject({taskId:enrolled.provisioning[0]!.taskId,status:'failed',useContext:true});
  await consent.uncheck();await page.reload();
  await expect(consent).toBeChecked();
  await consent.uncheck();await preparation.getByRole('button',{name:'重试 / 恢复准备',exact:true}).click();
  await expect.poll(async()=>(await facts(page)).provisioning[0]).toMatchObject({taskId:enrolled.provisioning[0]!.taskId,status:'failed',useContext:false});
  await page.reload();await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();
 expect((await facts(page)).provisioning).toEqual(enrolled.provisioning);
 expect(requests,'joining with unavailable content provider must not call a paid model or invent ready content').toHaveLength(1);
});

test('personal preparation pins explicit Context updates, preserves the active Run and recovers unavailable speech without leaking revoked Context',async({page})=>{
 test.setTimeout(150_000);
 page.setDefaultTimeout(15_000);
 await enterAndConfigureTeacher(page,true);
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'添加内容',exact:true}).click();await page.getByRole('button',{name:'手动创建',exact:true}).click();
 const form=page.locator('.sensa-manual-meaning'),oldContext='Private-A: Every morning I water the plants.',nextContext='Private-B: At dusk I water the flowers on the balcony.';
 await form.getByLabel('情境或原句',{exact:true}).fill(oldContext);
 await form.getByLabel('原文中的表达（可在上方选中）',{exact:true}).fill('water');
 await form.getByLabel('表达语言',{exact:true}).selectOption('en');
 await form.getByLabel('这里表达的意思',{exact:true}).fill('给植物供水。');
 await form.getByLabel('这个意思适用的典型场景',{exact:true}).fill('一个人给植物浇水，让它们获得需要的水分。');
 await form.getByRole('button',{name:'确认并保存',exact:true}).click();await expect(form).toHaveCount(0);
 const meaningId=await page.evaluate(()=>window.__sensaBrowserSmoke!.firstMeaningId());
 const sensePins=await page.evaluate(id=>window.__sensaBrowserSmoke!.meaningPinsForTest(id!),meaningId);
 expect(requests).toHaveLength(0);
 const candidate=(scene:string,example:string)=>({resources:[
  {role:'experience_recall_cue',payload:{scene,senseFocus:'给植物供水'}},
  {role:'scene_bridge',payload:{text:'把给植物供水的动作联系到这个表达。',meaningRendering:{meaning:'给植物供水。',languageTag:'zh-CN'}}},
  {role:'scene_realization',payload:{example,targetStart:example.indexOf('water'),targetEnd:example.indexOf('water')+5,experienceResourceKey:'experience_recall_cue:0'}},
 ]});
 await page.evaluate(()=>window.__sensaBrowserSmoke!.setSpeechFixtureForTest(false));
 plans=[{value:candidate('清晨，一个人用水壶给室内的植物浇水。','Every morning I water the plants.')}];
 const preparation=page.getByRole('region',{name:'个人内容学习准备',exact:true});
 const consent=preparation.getByRole('checkbox',{name:'使用我的场景准备学习内容。',exact:true});
 await consent.check();await preparation.getByRole('button',{name:'加入学习',exact:true}).click();
 await expect(preparation.getByRole('button',{name:'开始 / 继续学习',exact:true})).toBeEnabled();
 expect(requests).toHaveLength(1);expect(JSON.stringify(requests[0])).toContain(oldContext);
 const initial=await facts(page);expect(initial.provisioning[0]).toMatchObject({status:'ready',useContext:true});expect(initial.learning.targetIds).toHaveLength(1);
 await preparation.getByRole('button',{name:'开始 / 继续学习',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'学习偏好',exact:true})).toHaveCount(0);
 await page.locator('#s-lightweight-runtime').getByRole('button',{name:/查看表达/}).click();
 const active=(await facts(page)).learning;expect(active.runtime).not.toBeNull();
 await page.locator('#s-lightweight-runtime').getByRole('button',{name:'暂停',exact:true}).click();
 const suspended=(await facts(page)).learning;
 const operated=await page.evaluate(()=>window.__sensaBrowserSmoke!.operatedStepMaterialsForTest());expect(operated).toHaveLength(1);
 expect(operated[0]!.materializationId).toBe(active.runtime!.materializationId);
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.locator('.sensa-world.active .sensa-world-row').filter({hasText:'water'}).first().click();
 await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'编辑场景',exact:true}).click();await page.getByRole('textbox',{name:'场景',exact:true}).fill(nextContext);
 await page.getByRole('button',{name:'保存场景',exact:true}).click();
 await expect(preparation).toContainText('场景已修改');expect(requests).toHaveLength(1);
 await preparation.getByText('查看学习资源',{exact:true}).click();
 await expect(page.getByRole('dialog',{name:/^学习资源/u}).getByText('清晨，一个人用水壶给室内的植物浇水。',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(preparation.getByRole('button',{name:'查看学习资源',exact:true})).toBeFocused();
 await expect(preparation.getByRole('button',{name:'开始 / 继续学习',exact:true})).toBeEnabled();
 plans=[{value:candidate('傍晚，一个人在阳台上给花浇水。','At dusk I water the flowers on the balcony.')}];
 await preparation.getByRole('button',{name:'使用当前场景设置更新资源',exact:true}).click();
 await expect.poll(async()=>(await facts(page)).learning.runtime?.materializationId).not.toBe(suspended.runtime!.materializationId);
 await expect(preparation.getByRole('button',{name:'开始 / 继续学习',exact:true})).toBeEnabled();
 await preparation.getByRole('button',{name:'查看学习资源',exact:true}).click();
 await expect(page.getByRole('dialog',{name:/^学习资源/u}).getByText('傍晚，一个人在阳台上给花浇水。',{exact:true})).toBeVisible();
 await page.goBack();await expect(page.getByRole('dialog',{name:/^学习资源/u})).toHaveCount(0);
 expect(requests).toHaveLength(2);expect(JSON.stringify(requests[1])).toContain(nextContext);expect(JSON.stringify(requests[1])).not.toContain(oldContext);
 const updated=(await facts(page)).learning;
 expect(updated).toEqual({...suspended,runtime:{...suspended.runtime!,materializationId:updated.runtime!.materializationId}});
 expect(updated.runtime!.materializationId).not.toBe(suspended.runtime!.materializationId);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.operatedStepMaterialsForTest())).toEqual(operated);
 expect(await page.evaluate(id=>window.__sensaBrowserSmoke!.meaningPinsForTest(id!),meaningId)).toEqual(sensePins);
 // Revocation is an explicit fresh preparation. Unavailable speech must not
 // fabricate Ready or replace the previous material, and retry resumes safely.
 await page.evaluate(()=>window.__sensaBrowserSmoke!.setSpeechFixtureForTest(true));
 plans=[{value:candidate('一个人用水壶给植物浇水，让植物获得水分。','I water the plants.')}];
 await consent.uncheck();await preparation.getByRole('button',{name:'使用当前场景设置更新资源',exact:true}).click();
 await expect(preparation.getByRole('button',{name:'重试 / 恢复准备',exact:true})).toBeVisible();
 await expect.poll(async()=>(await facts(page)).provisioning[0]).toMatchObject({status:'failed',useContext:false});
 expect((await facts(page)).learning).toEqual(updated);
 await preparation.getByRole('button',{name:'查看学习资源',exact:true}).click();
 await expect(page.getByRole('dialog',{name:/^学习资源/u}).getByText('傍晚，一个人在阳台上给花浇水。',{exact:true})).toBeVisible();
 await page.goBack();await expect(page.getByRole('dialog',{name:/^学习资源/u})).toHaveCount(0);
 await expect(preparation.getByRole('button',{name:'使用原有资源学习',exact:true})).toBeEnabled();
 expect(JSON.stringify(requests.slice(2))).not.toMatch(/Private-A|Private-B/);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.setSpeechFixtureForTest(false));
 // A speech failure may happen before or after the model, depending on its
 // tool order; provide one bounded fixture response if retry still needs it.
 plans=[{value:candidate('一个人用水壶给植物浇水，让植物获得水分。','I water the plants.')}];
 await preparation.getByRole('button',{name:'重试 / 恢复准备',exact:true}).click();
 await expect.poll(async()=>(await facts(page)).provisioning[0]).toMatchObject({status:'ready',useContext:false});
 expect(JSON.stringify(requests.slice(2))).not.toMatch(/Private-A|Private-B/);
 const finalLearning=(await facts(page)).learning;
 expect(finalLearning).toEqual({...updated,runtime:{...updated.runtime!,materializationId:finalLearning.runtime!.materializationId}});
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.operatedStepMaterialsForTest())).toEqual(operated);
 const completedRequests=requests.length;await page.reload();
 await expect(preparation.getByRole('button',{name:'开始 / 继续学习',exact:true})).toBeEnabled();expect(requests).toHaveLength(completedRequests);
 await preparation.getByRole('button',{name:'开始 / 继续学习',exact:true}).click();
 await expect(page.locator('#s-lightweight-runtime').getByRole('heading',{name:'water',exact:true})).toBeVisible();
 await expect(page.locator('#s-lightweight-runtime').getByRole('button',{name:/查看表达/})).toHaveCount(0);
 expect((await facts(page)).learning).toEqual(finalLearning);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.operatedStepMaterialsForTest())).toEqual(operated);
});

test('field-specific correction recovers a rejected final object without creating duplicate meaning facts',async({page})=>{
 await enterAndConfigureTeacher(page);plans=[{value:{...answer,changeReason:'wrong-level fixture'}},{value:answer}];await send(page);
 await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeEnabled();
 expect(requests).toHaveLength(2);
 expect(requests[1]!.messages.at(-1)!.content).toContain('unrecognized_keys');expect(requests[1]!.messages.at(-1)!.content).toContain('changeReason');
 expect((await facts(page)).contains).toBe(false);
 await page.getByRole('button',{name:'就是这个意思',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();
 await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();expect((await facts(page)).inbox).toBe(0);
 await page.reload();await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();expect((await facts(page)).contains).toBe(true);expect((await facts(page)).learning.targetIds).toEqual([]);
});

test('a proposal generated or reviewed against changed material cannot confirm until the conversation rechecks that source',async({page})=>{
 await enterAndConfigureTeacher(page);plans=[{value:answer,hold:true}];await send(page);
 await expect(page.locator('.pmw-message.is-assistant')).toContainText('water');
 const firstChange='生成期间补充：浇水时植物已经在窗边。';
 const draftId=await page.evaluate(text=>window.__sensaBrowserSmoke!.appendIntakeMaterialForTest(text),firstChange);
 releaseStream!();await expect(page.getByRole('alert')).toContainText('核对当前材料');
 await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeDisabled();
 expect((await facts(page)).contains).toBe(false);expect((await facts(page)).inbox).toBe(1);
 expect(requests).toHaveLength(1);await expect(page.locator('.pmw-message.is-assistant')).toContainText('water');
 // Reload restores the same stale proposal, not an automatic paid retry or
 // a new draft. The explicit continuation must use a fresh coherent material.
 await page.reload();await expect(page.getByRole('alert')).toContainText('核对当前材料');
 await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeDisabled();expect(requests).toHaveLength(1);
 // Local model keys are intentionally page-only. Restore this synthetic key
 // through the actual settings UI, not by persisting a test secret after reload.
 await page.getByRole('button',{name:'账号与设置',exact:true}).click();
 await page.locator('#s-profile').getByRole('button',{name:/模型服务/}).click();
 const connection=page.getByRole('article').filter({has:page.getByRole('heading',{name:'旅程测试教师 · fixture-teacher',exact:true})});
 await connection.getByRole('button',{name:'填写或更换密钥',exact:true}).click();
 await page.getByLabel('旅程测试教师 的密钥',{exact:true}).fill('fixture-not-a-secret');
 await page.getByRole('button',{name:'仅保存在本页',exact:true}).click();
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'收件箱 1',exact:true}).click();await page.getByRole('button',{name:'继续对话',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('核对当前材料');expect(requests).toHaveLength(1);
 plans=[{value:answer}];await page.getByRole('alert').getByRole('button',{name:'再聊聊',exact:true}).click();
 await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeEnabled();expect(requests).toHaveLength(2);
 expect(JSON.stringify(requests[1]!.messages)).toContain(firstChange);
 await page.getByRole('button',{name:'就是这个意思',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'确认',exact:true})).toBeEnabled();
 const reviewChange='审阅期间补充：只浇这一盆植物。';
 expect(await page.evaluate(text=>window.__sensaBrowserSmoke!.appendIntakeMaterialForTest(text),reviewChange)).toBe(draftId);
 await expect(dialog.getByRole('button',{name:'确认',exact:true})).toBeDisabled();await expect(dialog.getByRole('alert')).toContainText('核对当前材料');
 expect((await facts(page)).contains).toBe(false);expect((await facts(page)).inbox).toBe(1);
 plans=[{value:answer}];await dialog.getByRole('alert').getByRole('button',{name:'再聊聊',exact:true}).click();
 await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeEnabled();expect(requests).toHaveLength(3);
 expect(JSON.stringify(requests[2]!.messages)).toContain(firstChange);expect(JSON.stringify(requests[2]!.messages)).toContain(reviewChange);
 await page.getByRole('button',{name:'就是这个意思',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();
 await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();const saved=await facts(page);
 expect(saved.contains).toBe(true);expect(saved.inbox).toBe(0);expect(saved.learning.targetIds).toEqual([]);expect(saved.learning.records).toEqual([]);
 await page.reload();await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();expect(await facts(page)).toEqual(saved);expect(requests).toHaveLength(3);
});

test('an incomplete stream preserves the original draft and continuing from Inbox does not create a copy',async({page})=>{
 await enterAndConfigureTeacher(page);plans=[{value:answer,hold:true,fail:true}];await send(page);
 await expect(page.locator('.pmw-message.is-assistant')).toContainText('water');const draftUrl=page.url();
 releaseStream!();await expect(page.getByRole('alert')).toContainText('模型响应未完成');
 await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeDisabled();
 await expect(page.locator('.pmw-message.is-assistant')).toHaveCount(0);expect(requests).toHaveLength(1);
 expect((await facts(page)).contains).toBe(false);expect((await facts(page)).inbox).toBe(1);
 await page.getByRole('button',{name:'返回我的语义世界',exact:true}).click();await page.getByRole('button',{name:'收件箱 1',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('上班前我给家里的植物浇水');
 plans=[{value:answer}];await page.getByRole('button',{name:'继续对话',exact:true}).click();
 await expect(page).toHaveURL(draftUrl);await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeEnabled();
 expect((await facts(page)).inbox).toBe(1);expect((await facts(page)).contains).toBe(false);expect(requests).toHaveLength(2);
});

test('an appended learner image is read with the same source witness sent to the teacher and retained by acceptance',async({page})=>{
 await enterAndConfigureTeacher(page);plans=[{value:answer}];await send(page);
 await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeEnabled();
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=','base64');
 await page.locator('.pmw-screen.active form input[type="file"][multiple]').setInputFiles({name:'synthetic-scene.png',mimeType:'image/png',buffer:png});
 const thumbnail=page.getByRole('img',{name:'synthetic-scene.png',exact:true});await expect(thumbnail).toBeVisible();
 const prepared=await thumbnail.getAttribute('src');expect(prepared).toMatch(/^data:image\/jpeg;base64,/u);
 plans=[{value:answer}];await page.getByRole('textbox',{name:'你想表达什么？',exact:true}).fill('这是同一个浇水场景，结合图片继续核对。');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeEnabled();expect(requests).toHaveLength(2);
 expect(JSON.stringify(requests[1]!.messages)).toContain(prepared);
 const media=await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMediaCheckpoint());expect(media).toHaveLength(1);expect(media[0]!.dataUrl).toBe(prepared);
 await page.getByRole('button',{name:'就是这个意思',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();
 await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();
 await expect(page.getByRole('article',{name:'表达详情'}).locator('img')).toHaveAttribute('src',prepared!);
 expect((await facts(page)).learning.targetIds).toEqual([]);
 await page.reload();await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();
 await expect(page.getByRole('article',{name:'表达详情'}).locator('img')).toHaveAttribute('src',prepared!);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMediaCheckpoint())).toEqual(media);expect(requests).toHaveLength(2);
});

async function directDiscoveryJourney(page:Page,testInfo:TestInfo,size:number){
 test.setTimeout(180_000);const expression=`borrow-${size-1}`;
 requests=[];plans=[];
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 // Loading the test bridge is not proof that the Shell has opened its Library.
 // Wait for the same usable surface a learner sees before inserting fixtures.
 await expect(page.getByRole('navigation',{name:'主要导航'})).toBeVisible();await page.waitForFunction(()=>!!window.__sensaBrowserSmoke);
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
 scaleFixture=syntheticSemanticWorld(await repository.load(),size);scaleFixture.meanings=[];
 expect(await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await (await fetch('/semantic-scale-fixture')).json()))).toBe(0);
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的学习',exact:true}).click();
 await page.locator('#s-study').getByRole('button',{name:'添加内容',exact:true}).click();
 await page.locator('#s-learning-entry').getByRole('button',{name:'按表达查找',exact:true}).click();
 const screen=page.locator('#s-direct-learning').last(),search=screen.getByRole('searchbox',{name:'搜索表达',exact:true});
 await expect(screen.getByRole('listitem')).toHaveCount(20);await screen.getByRole('button',{name:'下一页',exact:true}).click();await expect(screen.getByRole('button',{name:'上一页',exact:true})).toBeEnabled();
 await search.evaluate((input,expression)=>{input.addEventListener('input',()=>{const started=performance.now();const measure=()=>{const rows=document.querySelectorAll('#s-direct-learning.active li');if(rows.length===1&&rows[0]?.querySelector('strong')?.textContent===expression)(window as any).__directSearchMs=performance.now()-started;else requestAnimationFrame(measure);};requestAnimationFrame(measure);},{once:true});},expression);
 await search.fill(expression);await expect(screen.getByRole('listitem')).toHaveCount(1);
 await expect.poll(()=>page.evaluate(()=>(window as any).__directSearchMs)).toBeGreaterThan(0);
 const searchMs=await page.evaluate(()=>(window as any).__directSearchMs as number);assertInteractionBudget(searchMs,1000,'direct expression search');console.log('Direct expression input to one visible result / Chromium+OPFS / no model',JSON.stringify({size,searchMs}));
 await screen.getByRole('button',{name:new RegExp(expression)}).click();await expect(screen.getByRole('heading',{name:expression,exact:true})).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).enrollments).toEqual([]);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
 await screen.getByRole('button',{name:'取消',exact:true}).click();await expect(search).toHaveValue(expression);await screen.getByRole('button',{name:new RegExp(expression)}).click();
 if(size===250)await page.evaluate(()=>window.__sensaBrowserSmoke!.holdDirectEnrollmentResultForTest());
 await screen.getByRole('button',{name:'确认加入学习',exact:true}).click();
 if(size===250){
  await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).enrollments.length).toBe(1);
  await screen.getByRole('button',{name:'返回',exact:true}).click();const backUrl=page.url();
  await page.evaluate(()=>window.__sensaBrowserSmoke!.releaseDirectEnrollmentResultForTest());
  await expect(page.locator('#s-learning-entry').getByRole('button',{name:'按表达查找',exact:true})).toBeVisible();expect(page.url()).toBe(backUrl);
  await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的学习',exact:true}).click();
  await page.locator('#s-study').getByRole('button',{name:new RegExp(expression)}).click();
 }
 await expect(page).toHaveURL(/enrollmentId=/);await expect(screen.getByRole('button',{name:'准备学习资源',exact:true})).toBeEnabled();
 const accepted=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(accepted.enrollments).toHaveLength(1);expect(accepted.enrollments[0]!.sourceKind).toBe('stable_sense');expect(accepted.targetIds).toEqual([]);expect(accepted.runtime).toBeNull();
 await page.reload();await expect(screen.getByRole('heading',{name:expression,exact:true})).toBeVisible();await screen.getByRole('button',{name:'准备学习资源',exact:true}).click();
 await expect(screen.getByRole('button',{name:'重试 / 恢复准备',exact:true}).last()).toBeEnabled();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).enrollments).toEqual(accepted.enrollments);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的学习',exact:true}).click();
 const library=page.locator('#s-study');await library.getByRole('searchbox',{name:'搜索表达或意思',exact:true}).fill('no-such-expression');await expect(library.getByRole('button',{name:new RegExp(expression)})).toHaveCount(0);
 if(size===250){
  await expect(library.getByText('没有符合条件的内容',{exact:true})).toBeVisible();
  await page.evaluate(async()=>{await window.__sensaBrowserSmoke!.failLearningManagementReadsForTest(true);window.dispatchEvent(new CustomEvent('sensa-library-changed',{detail:{tables:['learningTargets']}}));});await expect(library.getByRole('alert')).toBeVisible();
  await expect(library.getByText('没有符合条件的内容',{exact:true})).toHaveCount(0);
  await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningManagementReadsForTest(false));await library.getByRole('button',{name:'重试',exact:true}).click();await expect(library.getByRole('alert')).toHaveCount(0);
 }
 await library.getByRole('searchbox',{name:'搜索表达或意思',exact:true}).fill(expression);await library.getByRole('button',{name:new RegExp(expression)}).click();await expect(screen.getByRole('heading',{name:expression,exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('direct-preparation-mobile.png'),fullPage:true});
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(requests).toEqual([]);
}
test('direct discovery at 250 connections stays read-only until enrollment and recovers without a Personal Meaning',async({page},testInfo)=>directDiscoveryJourney(page,testInfo,250));
test('direct discovery at 10000 connections stays read-only until enrollment and recovers without a Personal Meaning',{tag:'@capacity'},async({page},testInfo)=>directDiscoveryJourney(page,testInfo,10_000));

test('explicit batch confirmation saves all intentions and failed preparation retries without duplicate enrollments',async({page})=>{
 requests=[];plans=[];
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.getByRole('navigation',{name:'主要导航'})).toBeVisible();await page.waitForFunction(()=>!!window.__sensaBrowserSmoke);
 const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
 await modules.semanticIntake.submit(semanticLookupPayload());scaleFixture=syntheticSemanticWorld(await repository.load(),12);
 expect(await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await (await fetch('/semantic-scale-fixture')).json()))).toBe(12);
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 const world=page.locator('.sensa-world.active').last();
 await world.getByRole('button',{name:'批量选择',exact:true}).click();
 await expect(world.getByRole('button',{name:'全选当前结果',exact:true})).toBeEnabled();
 await world.getByRole('button',{name:'全选当前结果',exact:true}).click();
 await expect(world.getByRole('button',{name:'加入学习（12）',exact:true})).toBeEnabled();
 const search=world.getByRole('textbox',{name:'搜索场景、意思或表达',exact:true});await search.fill('no-matching-batch-candidate');
 await expect(world.getByText('没有匹配的内容',{exact:true})).toBeVisible();await expect(world.getByRole('button',{name:'加入学习（12）',exact:true})).toBeEnabled();await search.fill('');
 await world.getByRole('button',{name:'加入学习（12）',exact:true}).click();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.provisioningCheckpoint())).toEqual([]);
 const confirm=world.getByRole('region',{name:'确认加入学习',exact:true});
 await expect(confirm.getByRole('checkbox')).not.toBeChecked();
 await confirm.getByRole('checkbox').check();await confirm.getByRole('button',{name:'取消编辑',exact:true}).click();
 await world.getByRole('button',{name:'加入学习（12）',exact:true}).click();await expect(confirm.getByRole('checkbox')).not.toBeChecked();
 await confirm.getByRole('button',{name:'确认加入学习',exact:true}).click();
 const progress=world.getByRole('region',{name:'批量学习准备',exact:true});
 await expect(progress.getByRole('status')).toHaveText('已加入 0 / 12，失败 12',{timeout:30_000});
 const saved=await page.evaluate(()=>window.__sensaBrowserSmoke!.provisioningCheckpoint());
 expect(saved).toHaveLength(12);expect(new Set(saved.map(task=>task.taskId)).size).toBe(12);expect(saved.every(task=>task.status==='failed')).toBe(true);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
 await progress.locator('summary').click();await expect(progress.getByRole('listitem').first()).toContainText('失败');
 expect(await progress.getByRole('listitem').count()).toBeLessThan(40);
 await progress.getByRole('button',{name:'仅重试失败项',exact:true}).click();
 await expect(progress.getByRole('status')).toHaveText('已加入 0 / 12，失败 12',{timeout:30_000});
 await expect(progress.getByRole('button',{name:'仅重试失败项',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.provisioningCheckpoint())).toEqual(saved);
 expect(requests,'unavailable default provider must not call a real model or manufacture ready material').toEqual([]);
 await page.reload();await expect(page.getByRole('navigation',{name:'主要导航'})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.provisioningCheckpoint())).toEqual(saved);
 expect(requests).toEqual([]);
});

test.describe('prepared 10k World',{tag:'@capacity'},()=>{
test.use({meaningSetup:{size:10_000,world:true}});
test('10k personal meanings keep the shipped World bounded and searchable, with real detail and refresh recovery',async({preparedMeaningPage:{page}})=>{
 test.setTimeout(180_000);
 page.on('crash',()=>console.log('Semantic scale fixture renderer crashed during browser acceptance'));
 const preference=practicePreference;
 const start=await page.evaluate(()=>performance.now());
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 const world=page.locator('.sensa-world.active').last();
 // A fast indexed read may settle before the driver can observe a loading
 // frame. Held-read cases verify loading states without requiring a delay.
 await expect(world.locator('.sensa-world-row').first()).toBeVisible({timeout:30_000});
 const initial={openMs:await page.evaluate(start=>performance.now()-start,start),renderedRows:await world.locator('.sensa-world-row').count()};
 console.log('Shipped World / real Chromium+OPFS / synthetic 10k / unthrottled / no model:',JSON.stringify(initial));
 const phases=await page.evaluate(start=>performance.getEntriesByType('measure')
  .filter(entry=>entry.name.startsWith('sensa.journey.')&&entry.startTime>=start).map(entry=>({phase:entry.name,durationMs:entry.duration})),start);
 console.log('World load phases / smoke-only diagnostics:',JSON.stringify(phases));
 expect(phases,'ordinary browsing must not hydrate the full journey gateway').toEqual([]);
 // A slow or failed Inbox read must never claim that the Inbox is empty.
 await page.evaluate(()=>window.__sensaBrowserSmoke!.holdWorldInboxReadsForTest());
 await world.getByRole('button',{name:/^收件箱/u}).click();
 const inbox=page.locator('.sensa-intake-inbox').getByRole('dialog');
 await expect(inbox.getByRole('status')).toContainText('正在读取 Sensa');
 await expect(inbox.getByRole('button',{name:'继续对话',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.releaseWorldInboxReadsForTest(true));
 await expect(inbox.getByRole('alert')).toBeVisible();
 await inbox.getByRole('button',{name:'重试',exact:true}).click();
 await expect(inbox.getByText('尚待确认的材料',{exact:true})).toBeVisible();
 await inbox.getByRole('button',{name:'关闭',exact:true}).click();
 const inboxStart=await page.evaluate(()=>performance.now());await world.getByRole('button',{name:/^收件箱/u}).click();
 await expect(inbox.getByRole('button',{name:'继续对话',exact:true})).toBeEnabled();
 const inboxMs=await page.evaluate(start=>performance.now()-start,inboxStart);
 const inboxPhases=await page.evaluate(start=>performance.getEntriesByType('measure').filter(entry=>entry.startTime>=start&&entry.name.startsWith('sensa.journey.')).map(entry=>entry.name),start);
 console.log('Shipped Inbox / 10k confirmed Meanings and one pending material:',JSON.stringify({inboxMs,fullGatewayPhases:inboxPhases}));
 assertInteractionBudget(inboxMs,500,'10k World Inbox');expect(inboxPhases).toEqual([]);
 await inbox.getByRole('button',{name:'关闭',exact:true}).click();
 assertInteractionBudget(initial.openMs,1000,'local unthrottled 10k first World open');
 expect(initial.renderedRows,'a large World must not mount every row into the DOM').toBeLessThan(80);
 await world.evaluate(element=>{element.scrollTop=element.scrollHeight;});
 await expect(world.locator('[role="listitem"][aria-posinset="10000"] .sensa-world-row')).toBeVisible();
 expect(await world.locator('.sensa-world-row').count()).toBeLessThan(80);
 // Header/controls can grow after cross-tab updates without resizing this
 // fixed viewport. The mounted window must follow its new document position.
 const controls=world.locator(':scope > [data-sensa-page-region="controls"]');
 await controls.evaluate(element=>{(element as HTMLElement).style.paddingTop='1800px';});
 await expect.poll(()=>world.evaluate(element=>{
  const viewport=element.getBoundingClientRect();
  return [...element.querySelectorAll('.sensa-world-row')].some(row=>{
   const rect=row.getBoundingClientRect();return rect.top<viewport.bottom&&rect.bottom>viewport.top;
  });
 })).toBe(true);
 await world.evaluate(element=>{element.scrollTop=element.scrollHeight;});
 await expect(world.locator('[role="listitem"][aria-posinset="10000"] .sensa-world-row')).toBeVisible();
 await controls.evaluate(element=>{(element as HTMLElement).style.paddingTop='';});
 await world.evaluate(element=>{element.scrollTop=0;});
 const search=world.locator('input').first();await search.fill('ＢＯＲＲＯＷ-９９９９');
 const coldDetailMs=await clickToMeaningReady(page,world.getByRole('button',{name:/^borrow-9999(?:\s|$)/u}),'borrow-9999');
 expect(await page.evaluate(start=>performance.getEntriesByType('measure').filter(entry=>entry.name.startsWith('sensa.journey.')&&entry.startTime>=start).map(entry=>entry.name),start),
  'first exact detail and its learning controls must not hydrate the full gateway').toEqual([]);
 console.log('Shipped World / 10k / first detail before any batch or command:',JSON.stringify({coldDetailMs}));
 assertInteractionBudget(coldDetailMs,500,'10k first exact detail');
 await page.getByRole('button',{name:'返回我的语义世界',exact:true}).click();await search.fill('');
 const selectionStarted=await page.evaluate(()=>performance.now());
 await world.getByRole('button',{name:'批量选择',exact:true}).click();
 await expect(world.getByRole('checkbox').first()).toBeVisible();
 const selectionOpenMs=await page.evaluate(start=>performance.now()-start,selectionStarted);
 assertInteractionBudget(selectionOpenMs,1000,'10k compact selection opening');
 expect(await world.getByRole('checkbox').count()).toBeLessThan(80);
 await world.getByRole('checkbox').first().check();
 await expect(world.getByRole('checkbox').first()).toBeChecked();
 await world.getByRole('checkbox').first().press('Space');await expect(world.getByRole('checkbox').first()).not.toBeChecked();
 await world.getByRole('checkbox').first().press('Space');await expect(world.getByRole('checkbox').first()).toBeChecked();
 await world.evaluate(element=>{element.scrollTop=element.scrollHeight;});
 const lastChoice=world.locator('[role="listitem"][aria-posinset="10000"]');
 await expect(lastChoice.getByRole('checkbox')).toBeVisible();await expect(lastChoice.locator('strong')).toHaveText(/^borrow-\d+$/u);
 await lastChoice.getByRole('checkbox').check();expect(await world.getByRole('checkbox').count()).toBeLessThan(80);
 await world.evaluate(element=>{element.scrollTop=0;});
 const allStarted=await page.evaluate(()=>performance.now());
 await world.getByRole('button',{name:'全选当前结果',exact:true}).click();
 await expect(world.getByRole('button',{name:'加入学习（10000）',exact:true})).toBeEnabled();
 const selectAllMs=await page.evaluate(start=>performance.now()-start,allStarted);
 expect(await page.evaluate(start=>performance.getEntriesByType('measure').filter(entry=>entry.name.startsWith('sensa.journey.')&&entry.startTime>=start).map(entry=>entry.name),selectionStarted),'opening/selecting the full 10k result must not hydrate the command gateway').toEqual([]);
 console.log('Shipped batch selection / real Chromium+OPFS / synthetic 10k / compact pins only:',JSON.stringify({selectionOpenMs,selectAllMs,mountedChoices:await world.getByRole('checkbox').count()}));
 assertInteractionBudget(selectAllMs,2000,'explicit whole-result 10k selection');
 await search.fill('ＢＯＲＲＯＷ-９９９９');
 await expect(world.getByRole('listitem')).toHaveCount(1);await expect(world.getByRole('checkbox')).toBeChecked();
 await expect(world.getByRole('button',{name:'加入学习（10000）',exact:true})).toBeEnabled();
 await search.fill('');
 await world.getByRole('button',{name:'清空选择',exact:true}).click();
 await world.getByRole('button',{name:'完成选择',exact:true}).click();
 const searchStart=await page.evaluate(()=>performance.now());await search.fill('ＢＯＲＲＯＷ-９９９９');
 const row=world.getByRole('button',{name:/^borrow-9999(?:\s|$)/u});
 await expect(row).toBeVisible();
 const searchMs=await page.evaluate(start=>performance.now()-start,searchStart);
 // Readable, stable detail and an enabled editing action are measured inside
 // the browser, independently of the driver's assertion polling schedule.
 const profiler=process.env.SENSA_UI_PROFILE?await page.context().newCDPSession(page):null;
 if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
 const detailMs=await clickToMeaningReady(page,row,'borrow-9999');
 if(profiler){
  const {profile}=await profiler.send('Profiler.stop');
  const nodes=new Map((profile.nodes as Array<{id:number;callFrame:{functionName:string;url:string}}>).map(node=>[node.id,node.callFrame]));
  const costs=new Map<number,number>();
  (profile.samples as number[]).forEach((id,index)=>costs.set(id,(costs.get(id)??0)+(profile.timeDeltas?.[index]??0)));
  console.log('Diagnostic detail CPU self-time (profiling enabled, not latency baseline):',JSON.stringify([...costs].sort((a,b)=>b[1]-a[1]).slice(0,18).map(([id,micros])=>({...nodes.get(id),ms:micros/1000}))));
  await profiler.detach();
 }
 await page.getByRole('button',{name:'编辑场景',exact:true}).click();
 const context=page.getByRole('textbox',{name:'场景',exact:true});await context.fill('验收修改：借用同伴的雨伞，用完后归还。');
 const saveStart=await page.evaluate(()=>performance.now());await page.getByRole('button',{name:'保存场景',exact:true}).click();
 // A text locator also matches the editor's textarea. Success means the
 // committed read-only article changed and the completed editor disappeared.
 await expect(page.getByRole('article',{name:'表达详情'}).getByText('验收修改：借用同伴的雨伞，用完后归还。',{exact:true})).toBeVisible();
 await expect(context).toHaveCount(0);
 const saveMs=await page.evaluate(start=>performance.now()-start,saveStart);
 console.log('Shipped World / 10k synthetic / UI actions / no model:',JSON.stringify({searchMs,detailMs,saveMs}));
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sensa:web-ui:v1:sensa.practice.materials.v4:en')!))).toEqual(preference);
 await page.reload();await expect(page.getByRole('heading',{name:'borrow-9999',exact:true})).toBeVisible({timeout:30_000});
 await expect(page.getByRole('article',{name:'表达详情'}).getByText('验收修改：借用同伴的雨伞，用完后归还。',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sensa:web-ui:v1:sensa.practice.materials.v4:en')!))).toEqual(preference);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
 assertInteractionBudget(searchMs,500,'10k World search');assertInteractionBudget(detailMs,500,'10k World detail');assertInteractionBudget(saveMs,500,'10k Context save');

 // Lifecycle operations at the same heavy-user scale must touch one Meaning,
 // not hydrate the 10k inventory. Measure actual stable actionable paint.
 const meaningId=new URL(page.url()).searchParams.get('meaningId');
 await page.getByRole('button',{name:'更多',exact:true}).click();
 await page.getByRole('dialog',{name:'更多',exact:true}).getByRole('button',{name:'删除内容',exact:true}).click();
 const lifecycleStart=await page.evaluate(()=>performance.now());
 const deleteMs=await clickToMeaningReady(page,page.getByRole('dialog',{name:'删除这条内容？',exact:true}).getByRole('button',{name:'删除内容',exact:true}),'borrow-9999','恢复内容');
 const deletePhases=await page.evaluate(start=>performance.getEntriesByType('measure').filter(entry=>entry.startTime>=start&&['sensa.journey.records','sensa.journey.authority'].includes(entry.name)).map(entry=>entry.name),lifecycleStart);
 expect(deletePhases).toEqual([]);
 await page.reload();await expect(page.getByRole('button',{name:'恢复内容',exact:true})).toBeEnabled();
 expect(new URL(page.url()).searchParams.get('meaningId')).toBe(meaningId);
 const restoreStart=await page.evaluate(()=>performance.now());
 const restoreMs=await clickToMeaningReady(page,page.getByRole('button',{name:'恢复内容',exact:true}),'borrow-9999');
 const lifecyclePhases=await page.evaluate(start=>performance.getEntriesByType('measure').filter(entry=>entry.startTime>=start&&['sensa.journey.records','sensa.journey.authority'].includes(entry.name)).map(entry=>entry.name),restoreStart);
 console.log('Shipped recycle bin / Chromium+OPFS / synthetic 10k / 1x CPU / loopback / low media / no model:',JSON.stringify({deleteMs,restoreMs,fullGatewayPhases:lifecyclePhases}));
 expect(lifecyclePhases).toEqual([]);assertInteractionBudget(deleteMs,500,'10k Meaning deletion');assertInteractionBudget(restoreMs,500,'10k Meaning restoration');
 await expect(page.getByRole('article',{name:'表达详情'}).getByText('验收修改：借用同伴的雨伞，用完后归还。',{exact:true})).toBeVisible();

 // After a genuine reload, neither a new capture nor its explicit acceptance
 // may hydrate the existing World. Hold the controlled teacher reply so the
 // first learner-message timing measures local persistence, not generation.
 const capture='追加材料：下班后在窗台边给植物浇水。';await configureTeacher(page);
 plans=[{value:{...answer,proposal:{...proposal,context:capture,scene:capture}},hold:true}];
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'添加内容',exact:true}).click();
 // The menu's accessible name includes its action subtitle, unlike the
 // empty-World shortcut; select the same visible action by its title prefix.
 await page.getByRole('button',{name:/^和 Sensa 聊聊(?:\s|$)/u}).click({timeout:10_000});
 await input(page).fill(capture);
 const draftStart=await page.evaluate(()=>performance.now());await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.locator('.pmw-message.is-learner').getByText(capture,{exact:true})).toBeVisible();
 const draftSaveMs=await page.evaluate(start=>performance.now()-start,draftStart);
 const capturePhases=await page.evaluate(start=>performance.getEntriesByType('measure').filter(entry=>entry.startTime>=start&&['sensa.journey.records','sensa.journey.authority'].includes(entry.name)).map(entry=>entry.name),draftStart);
 console.log('Shipped capture / real Chromium+OPFS / existing synthetic 10k / cold gateway / no model reply:',JSON.stringify({draftSaveMs,fullGatewayPhases:capturePhases}));
 expect(capturePhases,'first capture must not enumerate the existing semantic World').toEqual([]);assertInteractionBudget(draftSaveMs,500,'10k first capture');
 await expect(page.locator('.pmw-message.is-assistant')).toContainText('water');releaseStream!();
 await expect(page.getByRole('button',{name:'就是这个意思',exact:true})).toBeEnabled().catch(async cause=>{console.log('Controlled 10k teacher failure:',JSON.stringify({alerts:await page.getByRole('alert').allTextContents(),requests:requests.length,assistant:await page.locator('.pmw-message.is-assistant').allTextContents()}));throw cause;});
 await page.getByRole('button',{name:'就是这个意思',exact:true}).click();
 const acceptanceStart=await page.evaluate(()=>performance.now());
 const acceptanceMs=await clickToMeaningReady(page,page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}),'water').catch(async cause=>{console.log('10k post-governance acceptance diagnostics:',JSON.stringify({alerts:await page.getByRole('alert').allTextContents(),phases:await page.evaluate(start=>performance.getEntriesByType('measure').filter(entry=>entry.startTime>=start&&entry.name.startsWith('sensa.journey.')).map(entry=>({name:entry.name,durationMs:entry.duration})),acceptanceStart)}));throw cause;});
 const automationElapsedMs=await page.evaluate(start=>performance.now()-start,acceptanceStart);
 const acceptancePhases=await page.evaluate(start=>performance.getEntriesByType('measure').filter(entry=>entry.startTime>=start&&['sensa.journey.records','sensa.journey.authority'].includes(entry.name)).map(entry=>entry.name),acceptanceStart);
 console.log('Shipped acceptance / real Chromium+OPFS / existing synthetic 10k / new Sense+Expression / controlled teacher, excluding reply:',JSON.stringify({clickToReadyMs:acceptanceMs,automationElapsedMs,fullGatewayPhases:acceptancePhases,commandPhases:await page.evaluate(start=>performance.getEntriesByType('measure').filter(entry=>entry.startTime>=start&&(entry.name.startsWith('sensa.journey.')||entry.name==='sensa.library.sqlite-commit')).map(entry=>({name:entry.name,durationMs:entry.duration})),acceptanceStart),walMaintenance:(await page.evaluate(()=>window.__sensaBrowserSmoke!.storageDiagnostics({verifyIntegrity:false}))).walMaintenance}));
 expect(acceptancePhases).toEqual([]);assertInteractionBudget(acceptanceMs,500,'10k explicit acceptance');
 await page.reload();await expect(page.getByRole('heading',{name:'water',exact:true})).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
});
});

test('World route learning read failure and cold reload remain unknown until explicit retry confirms membership',async({page},testInfo)=>{
 requests=[];plans=[];
 const {expressionWorldFixture}=await import('../support/expressionWorldFixture');scaleFixture=await expressionWorldFixture();
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 const navigation=page.getByRole('navigation',{name:'主要导航'});await navigation.getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.waitForFunction(()=>!!window.__sensaBrowserSmoke);
 await expect.poll(()=>page.evaluate(async()=>!!(await window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest()).identity)).toBe(true);
 await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await (await fetch('/semantic-scale-fixture')).json()));
 await navigation.getByRole('button',{name:'我的语义世界',exact:true}).click();
 const world=page.locator('.sensa-world.active').last();await world.getByRole('button',{name:'语义世界',exact:true}).click();
 const graph=world.getByRole('region',{name:'词义图谱',exact:true}),point=graph.locator(`[data-expression-id="${scaleFixture.registry.expressions[0]!.expressionId}"]`);
 await point.focus();await point.press('Enter');const detail=graph.getByRole('complementary',{name:'表达预览',exact:true});
 await expect(detail.getByText('尚未加入此路线',{exact:true})).toBeVisible();
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningWorkspaceReadsForTest(true));
 await expect(detail.getByRole('alert')).toContainText('无法读取学习准备状态');await expect(detail.getByText('尚未加入此路线',{exact:true})).toHaveCount(0);
 await detail.getByRole('button',{name:'重试',exact:true}).click();await expect(detail.getByRole('alert')).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('graph-route-read-unavailable.png')});
 await page.evaluate(async()=>{await window.__sensaBrowserSmoke!.failLearningWorkspaceReadsForTest(false);await window.__sensaBrowserSmoke!.holdLearningWorkspaceReadsForTest();});
 await detail.getByRole('button',{name:'重试',exact:true}).click();
 await expect(detail.getByRole('status')).toContainText('正在读取');await expect(detail.getByText('尚未加入此路线',{exact:true})).toHaveCount(0);
 // Retire the held successful read, then create a failure in the new view.
 await navigation.getByRole('button',{name:'我的学习',exact:true}).click();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningWorkspaceReadsForTest(true));
 await navigation.getByRole('button',{name:'我的语义世界',exact:true}).click();await world.getByRole('button',{name:'语义世界',exact:true}).click();
 await point.focus();await point.press('Enter');await expect(detail.getByRole('alert')).toContainText('无法读取学习准备状态');
 await page.evaluate(async()=>{window.__sensaBrowserSmoke!.releaseLearningWorkspaceReadsForTest();await window.__sensaBrowserSmoke!.provisioningCheckpoint();await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
 await expect(detail.getByRole('alert')).toContainText('无法读取学习准备状态');await expect(detail.getByText('尚未加入此路线',{exact:true})).toHaveCount(0);
 await world.getByRole('button',{name:'列表',exact:true}).click();await expect(world.getByRole('status').filter({hasText:'无法读取学习准备状态'})).toBeVisible();
 await world.getByRole('button',{name:'语义世界',exact:true}).click();await point.focus();await point.press('Enter');
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningWorkspaceReadsForTest(false));await detail.getByRole('button',{name:'重试',exact:true}).click();await expect(detail.getByText('尚未加入此路线',{exact:true})).toBeVisible();
 await world.getByRole('button',{name:'列表',exact:true}).click();await expect(world.getByText('无法读取学习准备状态，请重试。',{exact:true})).toHaveCount(0);
 await page.screenshot({path:testInfo.outputPath('world-list-after-read-recovery.png')});
 await world.getByRole('button',{name:'语义世界',exact:true}).click();await point.focus();await point.press('Enter');
 await page.addInitScript(()=>{const timer=setInterval(()=>{if(!window.__sensaBrowserSmoke)return;clearInterval(timer);void window.__sensaBrowserSmoke.failLearningWorkspaceReadsForTest(true);},1);});
 await page.reload();await expect(detail.getByRole('alert')).toContainText('无法读取学习准备状态');await expect(detail.getByText('尚未加入此路线',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningWorkspaceReadsForTest(false));await detail.getByRole('button',{name:'重试',exact:true}).click();
 await expect(detail.getByText('尚未加入此路线',{exact:true})).toBeVisible();
 await world.getByRole('button',{name:'列表',exact:true}).click();await expect(world.getByText('无法读取学习准备状态，请重试。',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(facts);expect(requests).toEqual([]);
});

test('World read recovery removes only its read error and preserves a failed preparation operation notice',async({page},testInfo)=>{
 requests=[];plans=[];
 const {expressionWorldFixture}=await import('../support/expressionWorldFixture');scaleFixture=await expressionWorldFixture();
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 const navigation=page.getByRole('navigation',{name:'主要导航'});await navigation.getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.waitForFunction(()=>!!window.__sensaBrowserSmoke);
 await expect.poll(()=>page.evaluate(async()=>!!(await window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest()).identity)).toBe(true);
 await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await (await fetch('/semantic-scale-fixture')).json()));
 const world=page.locator('.sensa-world.active').last();await world.getByRole('button',{name:'语义世界',exact:true}).click();
 const graph=world.getByRole('region',{name:'词义图谱',exact:true}),point=graph.locator(`[data-expression-id="${scaleFixture.registry.expressions[0]!.expressionId}"]`);
 await point.focus();await point.press('Enter');const detail=graph.getByRole('complementary',{name:'表达预览',exact:true});
 await detail.getByRole('button',{name:'查看详情',exact:true}).click();
 const preparation=page.getByRole('region',{name:'个人内容学习准备',exact:true}).filter({has:page.getByRole('heading',{name:/^borrow ·/u})});
 await preparation.getByRole('button',{name:'加入学习',exact:true}).click();
 await expect(preparation.getByRole('status')).toContainText('请先登录 Sensa 在线服务');
 const operationNotice=(await preparation.getByRole('status').innerText()).trim();
 const saved=await page.evaluate(async()=>({learning:await window.__sensaBrowserSmoke!.learningCheckpoint(),provisioning:await window.__sensaBrowserSmoke!.provisioningCheckpoint()}));
 expect(saved.provisioning).toHaveLength(1);expect(saved.provisioning[0]!.status).toBe('failed');expect(saved.learning.records).toEqual([]);expect(saved.learning.runtime).toBeNull();
 await page.goBack();await expect(detail).toBeVisible();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningWorkspaceReadsForTest(true));await expect(detail.getByRole('alert')).toContainText('无法读取学习准备状态');
 await world.getByRole('button',{name:'列表',exact:true}).click();
 const notice=world.getByRole('status').filter({hasText:operationNotice});await expect(notice).toContainText('无法读取学习准备状态');
 await world.getByRole('button',{name:'语义世界',exact:true}).click();await point.focus();await point.press('Enter');
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningWorkspaceReadsForTest(false));await detail.getByRole('button',{name:'重试',exact:true}).click();await expect(detail.getByRole('alert')).toHaveCount(0);
 await world.getByRole('button',{name:'列表',exact:true}).click();await expect(notice).toHaveText(operationNotice);await expect(world.getByText('无法读取学习准备状态，请重试。',{exact:true})).toHaveCount(0);
 await page.screenshot({path:testInfo.outputPath('world-list-preserved-operation-notice.png')});
 expect(await page.evaluate(async()=>({learning:await window.__sensaBrowserSmoke!.learningCheckpoint(),provisioning:await window.__sensaBrowserSmoke!.provisioningCheckpoint()}))).toEqual(saved);
 expect(requests,'unavailable account must not call a real or paid model').toEqual([]);
});

test('World expression languages combine with search, saved meanings and notes while point details preserve camera and exact identities',async({page},testInfo)=>{
 requests=[];plans=[];
 const {expressionWorldFixture}=await import('../support/expressionWorldFixture');
 scaleFixture=await expressionWorldFixture(80);
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.waitForFunction(()=>!!window.__sensaBrowserSmoke);
 await expect.poll(()=>page.evaluate(async()=>!!(await window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest()).identity)).toBe(true);
 expect(await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await (await fetch('/semantic-scale-fixture')).json()))).toBe(85);
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 const world=page.locator('.sensa-world.active').last(),counts=world.locator('[data-world-counts]'),languages=world.getByRole('group',{name:'表达语言',exact:true}),search=world.getByRole('textbox',{name:'搜索场景、意思或表达',exact:true});
 await expect(counts).toHaveText('86 个表达 · 85 个去重意义');
 await expect(languages.getByRole('button',{name:'全部语言',exact:true})).toHaveAttribute('aria-pressed','true');
 await languages.getByRole('button',{name:'fr',exact:true}).click();await expect(counts).toHaveText('1 个表达 · 1 个去重意义');
 await expect(world.locator('[data-world-meaning]')).toHaveCount(1);await expect(world.locator('[data-matching-expressions]')).toHaveText('法语');
 await world.getByText('此意义的其他语言表达',{exact:true}).click();await expect(world.getByText('take on loan · en',{exact:true})).toBeVisible();
 await world.getByRole('button',{name:'批量选择',exact:true}).click();await expect(world.getByText('当前筛选中，没有可加入 en 学习路线的表达。',{exact:true})).toBeVisible();await expect(world.getByRole('button',{name:'全选当前结果',exact:true})).toBeDisabled();await world.getByRole('button',{name:'完成选择',exact:true}).click();
 await search.fill('Private source');await expect(counts).toHaveText('1 个表达 · 1 个去重意义');
 await search.fill('no such expression fixture');await expect(counts).toHaveText('0 个表达 · 0 个去重意义');await expect(world.getByText('没有匹配的内容',{exact:true})).toBeVisible();
 await search.fill('');await languages.getByRole('button',{name:'en',exact:true}).click();await expect(counts).toHaveText('86 个表达 · 85 个去重意义');
 await world.getByRole('button',{name:'语义世界',exact:true}).click();
 const graph=world.getByRole('region',{name:'词义图谱',exact:true}),points=graph.locator('[data-expression-id]');
 await expect(points).toHaveCount(86);
 await graph.getByRole('button',{name:'显示全部',exact:true}).click();
 await page.screenshot({path:testInfo.outputPath('expression-graph-86-records.png'),animations:'disabled'});
 const polysemous=graph.locator(`[data-expression-id="${scaleFixture.registry.expressions[0]!.expressionId}"]`);await polysemous.focus();await polysemous.press('Enter');
 await expect(graph.getByRole('complementary',{name:'表达预览',exact:true}).getByRole('combobox',{name:'已确认意思',exact:true}).locator('option')).toHaveCount(2);
 const polyPreview=graph.getByRole('complementary',{name:'表达预览',exact:true}),interpretation=polyPreview.getByRole('combobox',{name:'已确认意思',exact:true});await interpretation.selectOption({index:1});const selectedInterpretation=await interpretation.inputValue();
 await expect(polyPreview).toContainText('临时借用编号2的物品。');await expect(polysemous).toHaveAccessibleName('borrow · en · 临时借用编号2的物品。');
 await interpretation.selectOption({index:0});await expect(polyPreview).toContainText('临时取得他人物品，并预期归还。');await expect(polysemous).toHaveAccessibleName('borrow · en · 临时取得他人物品，并预期归还。');
 await interpretation.selectOption({index:1});
 await polyPreview.getByRole('button',{name:'查看详情',exact:true}).click();await expect(page.locator('#s-personal-meaning').getByRole('heading',{name:'borrow',exact:true})).toBeVisible();await page.goBack();await expect(interpretation).toHaveValue(selectedInterpretation);
 await expect(polyPreview).toContainText('临时借用编号2的物品。');await expect(polysemous).toHaveAccessibleName('borrow · en · 临时借用编号2的物品。');
 expect(await graph.locator('[data-graph-edge]').count()).toBe(2);
 await page.screenshot({path:testInfo.outputPath('expression-graph-polysemy-and-real-links.png'),animations:'disabled'});
 await graph.getByRole('complementary',{name:'表达预览',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
 const borrow=scaleFixture.registry.expressionVersions.filter(version=>version.surfaceForm==='borrow');
 expect(new Set(borrow.map(version=>version.expressionId)).size).toBe(3);
 await world.locator('.sensa-world-filters > summary').click();
 for(const version of borrow)await expect(graph.locator(`[data-expression-id="${version.expressionId}"]`)).toHaveCount(1);
 await languages.getByRole('button',{name:'en',exact:true}).click();await expect(points).toHaveCount(1);
 await world.locator('.sensa-world-filters > summary').click();
 await graph.getByRole('button',{name:'显示全部',exact:true}).click();
 const frId=scaleFixture.registry.expressions.find(expression=>expression.languageTag==='fr')!.expressionId,point=graph.locator(`[data-expression-id="${frId}"]`);
 await point.focus();await expect(graph.locator('[data-graph-preview]')).toContainText('emprunter');await point.press('Enter');
 const detail=graph.getByRole('complementary',{name:'表达预览',exact:true});await expect(detail.getByRole('heading',{name:'emprunter',exact:true})).toBeVisible();
 await expect(detail).toContainText('当前视图中没有连线');await expect(detail).toContainText('当前学习路线');await expect(detail).toContainText('尚未加入此路线');
 await detail.getByText('原始来源',{exact:true}).click();await detail.getByText('fixture · 隔离原文来源',{exact:true}).click();await expect(detail.getByRole('link',{name:'查看来源：',exact:true})).toHaveAttribute('href','https://example.test/original');
 const canvas=graph.locator('[data-graph-camera]');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();expect(box).not.toBeNull();
 const beforePan=JSON.parse((await canvas.getAttribute('data-graph-camera'))!);await page.mouse.move(box!.x+box!.width-25,box!.y+box!.height-35);await page.mouse.down();await page.mouse.move(box!.x+box!.width-55,box!.y+box!.height-55,{steps:8});await page.mouse.up();
 await expect.poll(async()=>JSON.parse((await canvas.getAttribute('data-graph-camera'))!).x).not.toBe(beforePan.x);
 await graph.getByRole('button',{name:'放大',exact:true}).click();const camera=await graph.locator('[data-graph-camera]').getAttribute('data-graph-camera');
 await page.screenshot({path:testInfo.outputPath('expression-graph-desktop-fr-preview.png'),animations:'disabled'});
 await detail.getByRole('button',{name:'查看详情',exact:true}).click();
 const meaning=page.locator('#s-personal-meaning');await expect(meaning).toBeVisible();
 const more=meaning.getByRole('button',{name:'更多',exact:true});await more.click();let menu=page.getByRole('dialog',{name:'更多',exact:true});await menu.getByRole('button',{name:'收藏',exact:true}).click();
 await more.click();menu=page.getByRole('dialog',{name:'更多',exact:true});await menu.getByRole('button',{name:'写笔记',exact:true}).click();
 const note=page.locator('.sensa-note-editor');await note.locator('textarea').fill('隔离的图谱详情笔记');
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failNextSenseNoteCommitForTest());await note.getByRole('button',{name:'保存笔记',exact:true}).click();
 await expect(note.getByRole('alert')).toBeVisible();await expect(note.locator('textarea')).toHaveValue('隔离的图谱详情笔记');
 await note.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(note).toHaveCount(0);
 await page.goBack();await expect(detail.getByRole('heading',{name:'emprunter',exact:true})).toBeVisible();
 await expect(graph.locator('[data-graph-camera]')).toHaveAttribute('data-graph-camera',camera!);await expect(world.locator('.sensa-world-filters > summary')).toContainText('法语');
 const changeSkin=async(skin:'Clear'|'Quiet')=>{await page.getByRole('button',{name:'账号与设置',exact:true}).click();await page.locator('#settings-preferences').click();await page.getByRole('radio',{name:new RegExp(`^Sensa ${skin}(?:\\s|$)`,'u')}).click();await expect(page.locator('html')).toHaveAttribute('data-sensa-skin',skin.toLowerCase());await page.goBack();};
 await changeSkin('Clear');await expect(detail.getByRole('heading',{name:'emprunter',exact:true})).toBeVisible();
 expect(await graph.locator('.sensa-expression-graph-workspace').evaluate(element=>getComputedStyle(element).display)).toBe('flex');
 expect((await canvas.boundingBox())!.height).toBeGreaterThanOrEqual(400);const clearCanvas=await canvas.boundingBox(),clearDetail=await detail.boundingBox();expect(clearDetail!.x).toBeGreaterThan(clearCanvas!.x);expect(Math.abs(clearDetail!.y-clearCanvas!.y)).toBeLessThanOrEqual(2);
 await page.screenshot({path:testInfo.outputPath('expression-graph-clear-preview.png'),animations:'disabled'});
 await changeSkin('Quiet');await expect(detail.getByRole('heading',{name:'emprunter',exact:true})).toBeVisible();
 await detail.getByRole('button',{name:'关闭',exact:true}).click();await expect(point).toBeFocused();
 await world.locator('.sensa-world-filters > summary').click();const markers=world.getByRole('combobox',{name:'收藏与笔记',exact:true});await markers.selectOption('saved');await expect(points).toHaveCount(1);await markers.selectOption('notes');await expect(points).toHaveCount(1);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failAnnotationReadsForTest(true));await expect(world.getByRole('alert')).toContainText('读取');await expect(world.locator('[data-world-counts]')).toHaveCount(0);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failAnnotationReadsForTest(false));await world.getByRole('button',{name:'重试',exact:true}).click();await expect(points).toHaveCount(1);
 await page.reload();await expect(points).toHaveCount(1);await world.locator('.sensa-world-filters > summary').click();await expect(markers).toHaveValue('notes');await expect(languages.getByRole('button',{name:'fr',exact:true})).toHaveAttribute('aria-pressed','true');
 await world.getByRole('button',{name:'列表',exact:true}).click();await expect(counts).toHaveText('1 个表达 · 1 个去重意义');
 await markers.selectOption('all');await languages.getByRole('button',{name:'全部语言',exact:true}).click();await expect(counts).toHaveText('86 个表达 · 85 个去重意义');
 await world.getByRole('button',{name:/^收件箱/u}).click();await expect(page.getByRole('dialog')).toContainText('尚待绑定的隔离材料');await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toHaveLength(0);expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.provisioningCheckpoint()))).toHaveLength(0);
 expect(requests).toHaveLength(0);
});

test.describe('World touch preview',()=>{
 test.use({hasTouch:true,viewport:{width:320,height:740}});
 test('expression points open a readable drawer by touch and keyboard without automatic navigation or learning',async({page},testInfo)=>{
  requests=[];plans=[];
  const {expressionWorldFixture}=await import('../support/expressionWorldFixture');scaleFixture=await expressionWorldFixture();
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.waitForFunction(()=>!!window.__sensaBrowserSmoke);
  await expect.poll(()=>page.evaluate(async()=>!!(await window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest()).identity)).toBe(true);
  await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await (await fetch('/semantic-scale-fixture')).json()));
  await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
  const world=page.locator('.sensa-world.active').last(),languages=world.getByRole('group',{name:'表达语言',exact:true});await world.getByText('筛选',{exact:true}).click();await languages.getByRole('button',{name:'fr',exact:true}).click();await world.getByRole('button',{name:'语义世界',exact:true}).click();
  const graph=world.getByRole('region',{name:'词义图谱',exact:true});
  const surfaceBefore=graph.locator('[data-cy-surface]'),gestureBounds=await surfaceBefore.boundingBox();
  const cyBefore=graph.locator('[data-graph-camera]'),zoomBefore=JSON.parse((await cyBefore.getAttribute('data-graph-camera'))!).zoom;
  const cdp=await page.context().newCDPSession(page),cx=gestureBounds!.x+gestureBounds!.width/2,cy=gestureBounds!.y+gestureBounds!.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx-30,y:cy,id:0},{x:cx+30,y:cy,id:1}]});
  for(const spread of [40,50,65])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-spread,y:cy,id:0},{x:cx+spread,y:cy,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(async()=>JSON.parse((await cyBefore.getAttribute('data-graph-camera'))!).zoom).toBeGreaterThan(zoomBefore);await cdp.detach();
  await graph.getByRole('button',{name:'显示全部',exact:true}).click();
  const point=graph.locator('[data-expression-id]');await expect(point).toHaveCount(1);const location=new URL(page.url()).pathname;
  const surface=graph.locator('[data-cy-surface]'),bounds=await surface.boundingBox(),position=JSON.parse((await point.getAttribute('data-graph-position'))!);
  await page.touchscreen.tap(bounds!.x+position.x,bounds!.y+position.y);
  const drawer=page.getByRole('dialog',{name:/^表达预览(?:\s|$)/u});await expect(drawer.getByRole('heading',{name:'emprunter',exact:true})).toBeVisible();expect(new URL(page.url()).pathname).toBe(location);
  expect(await drawer.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);await expect(drawer.getByRole('button',{name:'查看详情',exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('expression-graph-320px-touch-drawer.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0);await expect(point).toBeFocused();await point.press('Enter');await expect(drawer).toBeVisible();
  await drawer.getByRole('button',{name:'查看详情',exact:true}).click();await expect(page.locator('#s-personal-meaning')).toBeVisible();await page.goBack();await expect(drawer.getByRole('heading',{name:'emprunter',exact:true})).toBeVisible();
  await drawer.getByRole('button',{name:'关闭',exact:true}).first().click();await page.reload();await expect(graph.locator('[data-expression-id]')).toHaveCount(1);await expect(world.locator('.sensa-world-filters > summary')).toContainText('法语');await world.locator('.sensa-world-filters > summary').click();await expect(languages.getByRole('button',{name:'fr',exact:true})).toHaveAttribute('aria-pressed','true');
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toHaveLength(0);expect(requests).toHaveLength(0);
 });
});

const localizedWorldSurface=(locale:string)=>async({page}:{page:Page},testInfo:TestInfo)=>{
 requests=[];plans=[];const {expressionWorldFixture}=await import('../support/expressionWorldFixture');scaleFixture=await expressionWorldFixture(80);
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.waitForFunction(()=>!!window.__sensaBrowserSmoke);
 await expect.poll(()=>page.evaluate(async()=>!!(await window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest()).identity)).toBe(true);
 expect(await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await (await fetch('/semantic-scale-fixture')).json()))).toBe(85);
 await page.evaluate(value=>localStorage.setItem('sensa:interface-language:v1',value),locale);await page.reload();
 const content=JSON.parse(await readFile(`apps/web/src/i18n/locales/${locale}/content.json`,'utf8')).content;
 const world=page.locator('.sensa-world.active').last();await expect(world.locator('[data-world-counts]')).toContainText(new Intl.NumberFormat(locale).format(86));await expect(world.locator('[data-world-meaning]').first()).toBeVisible();
 const shot=async(name:string,width:number)=>{await page.setViewportSize({width,height:width<768?844:900});await world.evaluate(element=>element.scrollTo(0,0));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath(`${locale}-world-${name}-${width}.png`),animations:'disabled'});};
 await shot('list',1280);await shot('list',320);await shot('list',390);
 await world.getByRole('button',{name:content.world,exact:true}).click();const graph=world.getByRole('region',{name:content.graph.title,exact:true});await expect(graph.locator('[data-expression-id]')).toHaveCount(86);await world.evaluate(element=>element.scrollTo(0,0));
 await expect.poll(()=>graph.locator('[data-graph-position]').evaluateAll(points=>{const canvas=points[0]?.closest('[data-graph-camera]')?.getBoundingClientRect();return points.filter(point=>{const p=JSON.parse(point.getAttribute('data-graph-position')!);return canvas&&p.x>0&&p.x<canvas.width&&p.y>0&&p.y<canvas.height;}).length;})).toBeGreaterThan(0);
 await shot('graph',390);await shot('graph',320);await shot('graph',1280);
 if(locale==='zh-CN'){
  const appearance=async(skin:'Clear'|'Quiet',mode:'浅色'|'深色')=>{
   await page.getByRole('button',{name:'账号与设置',exact:true}).click();await page.locator('#settings-preferences').click();
   await page.getByRole('radio',{name:new RegExp(`^Sensa ${skin}(?:\\s|$)`,'u')}).click();await page.getByRole('radio',{name:mode,exact:true}).click();await page.goBack();
   await expect(graph).toBeVisible();
  };
  await appearance('Clear','浅色');await shot('graph-clear',1280);await shot('graph-clear',320);
  await appearance('Quiet','深色');await shot('graph-dark',1280);await shot('graph-dark',320);
  await appearance('Quiet','浅色');
 }
 await graph.getByRole('button',{name:content.graph.fit,exact:true}).click();await shot('overview',1280);
 await page.setViewportSize({width:1280,height:900});
 const french=graph.locator(`[data-expression-id="${scaleFixture.registry.expressions.find(row=>row.languageTag==='fr')!.expressionId}"]`);await page.mouse.move(1,1);await french.focus();await french.press('Enter');
 const detail=graph.locator('.sensa-expression-graph-detail');await expect(detail.getByRole('heading',{name:'emprunter',exact:true})).toBeVisible();await expect(detail.locator('h2 bdi')).toHaveAttribute('lang','fr');await expect(graph.locator('[data-graph-preview]')).toHaveCount(0);
 await shot('drawer',1280);await shot('drawer',320);await shot('drawer',390);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toHaveLength(0);expect(requests).toHaveLength(0);
};
test('World content-led list and drawer retain 86 actual expressions in zh-CN UI',localizedWorldSurface('zh-CN'));
test('World content-led list and drawer retain 86 actual expressions in en UI',localizedWorldSurface('en'));
test('World content-led list and drawer retain 86 actual expressions in de UI',localizedWorldSurface('de'));
