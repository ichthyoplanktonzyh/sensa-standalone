/** Installed extension -> shipped Web -> real OPFS. Source-platform data and
 * model HTTP replies are controlled; capture, transport and receipts are real.
 * Pregranted fixture origins do not prove native permission or live YouTube. */
import {test,expect,chromium,type Page,type BrowserContext} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {canonicalConsumerJson,semanticProposalSchema,type SensaBrowserIntakeReceipt} from '@sensa/contracts/sensa';
import {semanticLookupSpec} from '../support/semanticLookupFixtures';
import {extensionPanelUi as panelUi,extensionPanelButton as panelButton} from '../support/extensionReadingPanel.mts';

let directory:string,server:Server,origin:string,sourceOrigin:string,lookupRequests=0;
type ReadingRecord={system:string;input:{text:string;context:string};cancelled:boolean};
const readingRequests:ReadingRecord[]=[];
let heldReadingText:string|null=null;
const heldReadingReplies:Array<()=>void>=[];
const sentence='May asked to borrow an umbrella.';
const nativeEnglish='She took her time and looked up at the sky before answering the question that had been waiting for her all afternoon.';
const nativeFrench="Bonjour à tous. Aujourd'hui nous allons prendre le train ensemble parce que la pluie est trop forte pour rentrer à pied. Nous retrouverons nos amis à la gare.";
const proposal=semanticProposalSchema.parse({explanation:'这里 borrow 表示临时借用并准备归还。',semanticSpec:semanticLookupSpec,expression:{surface:'borrow',type:'word',language:'en'}});
const snapshot={format:'sensa-learning-content-registry-v3',publishedAt:'2026-10-05T00:00:00Z',items:[]};
const registry={...snapshot,revision:createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex')};
const mime:Record<string,string>={'.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.png':'image/png'};
test.setTimeout(90_000);
test.beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'sensa-extension-intake-'));const dist=join(directory,'web');
 server=createServer(async(req,res)=>{
  const url=new URL(req.url??'/',origin||'http://127.0.0.1');
  if(url.pathname==='/native-language.html'){res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="en"><title>Reading languages</title><body style="margin:64px;font:24px/2 system-ui"><p id="source">${nativeEnglish}</p><p id="foreign">${nativeFrench}</p></body></html>`);return;}
  if(url.pathname==='/source.html'||url.pathname==='/glossary.html'){res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="en"><title>Borrowing an umbrella</title><body style="margin:64px;font:24px/2 system-ui"><p id="source">${sentence}</p>${url.pathname==='/glossary.html'?'<p id="continued">She will return it after the rain stops.</p>':''}<textarea id="reply">我明天会把雨伞还给你。</textarea><input id="ordinary" value="我把会议改到了周四。"><input id="secret" type="password" value="private fixture"></body></html>`);return;}
  if(url.pathname==='/v1/chat/completions'){
   let text='';for await(const chunk of req)text+=chunk.toString();const body=JSON.parse(text);
   if(body.stream!==false){res.writeHead(400);res.end('This fixture only supplies extension lookup');return;}
   let content:string,record:ReadingRecord|undefined;
   if(body.response_format?.type==='json_object'){lookupRequests++;content=JSON.stringify({proposal});}
   else{record={system:body.messages[0].content,input:JSON.parse(body.messages[1].content),cancelled:false};readingRequests.push(record);content=record.system.includes('input text into natural English')?'I will return the umbrella tomorrow.':record.system.includes('into natural French')?'Elle a demandé à emprunter un parapluie.':record.input.text.startsWith('Bonjour')?'大家好。':record.input.text.startsWith('Nous allons')?'我们将一起坐火车。':record.input.text.includes('return it')?'雨停后她会归还雨伞。':record.system.includes('暂借一下')?'她向同事暂借一下雨伞。':'她向同事暂借雨伞，并准备归还。';}
   res.setHeader('content-type','application/json');
   if(record){const observed=record;res.on('close',()=>{if(!res.writableEnded)observed.cancelled=true;});}
   const reply=()=>{if(!res.destroyed&&!res.writableEnded)res.end(JSON.stringify({choices:[{message:{content}}]}));};
   if(record?.input.text===heldReadingText)heldReadingReplies.push(reply);else reply();return;
  }
  if(url.pathname==='/sensa/packages'){res.setHeader('content-type','application/json');res.end(JSON.stringify(registry));return;}
  if(url.pathname.startsWith('/sensa/')||url.pathname.startsWith('/auth/')){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({code:'authentication_required'}));return;}
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  const path=resolve(dist,`.${url.pathname}`);
  if(path!==dist&&!path.startsWith(dist+'/')){res.writeHead(404);res.end();return;}
  try{const extension=extname(path);res.setHeader('content-type',mime[extension]??'text/html');res.end(await readFile(extension?path:join(dist,'index.html')));}catch{res.writeHead(404);res.end();}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;
 origin=`http://127.0.0.1:${port}`;sourceOrigin=`http://localhost:${port}`;
 execFileSync('npm',['run','build','-w','@sensa/web','--','--outDir',dist,'--emptyOutDir'],{env:{...process.env,VITE_SENSA_MODE:'production',VITE_SENSA_BROWSER_SMOKE:'true',VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-public-key',VITE_SENSA_API_URL:origin},stdio:'pipe'});
 execFileSync(process.execPath,['build.mjs'],{cwd:resolve('apps/browser-extension'),env:{...process.env,SENSA_EXTENSION_WEB_URL:origin,SENSA_EXTENSION_API_URL:sourceOrigin,SENSA_EXTENSION_OUT_DIR:join(directory,'extension'),SENSA_EXTENSION_NAME:'Sensa intake acceptance'},stdio:'pipe'});
 const manifestPath=join(directory,'extension','manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 // This origin supplies intercepted fixture platform data, never a live video.
 manifest.host_permissions.push('https://www.youtube.com/*');await writeFile(manifestPath,JSON.stringify(manifest));
});
test.afterAll(async()=>{if(server?.listening)await new Promise<void>(done=>server.close(()=>done()));if(directory)await rm(directory,{recursive:true,force:true});});

async function launch(profile:string){return chromium.launchPersistentContext(profile,{headless:true,locale:'zh-CN',viewport:{width:1280,height:900},args:[`--disable-extensions-except=${join(directory,'extension')}`,`--load-extension=${join(directory,'extension')}`],...(process.env.SENSA_CHROMIUM_PATH?{executablePath:process.env.SENSA_CHROMIUM_PATH}:{channel:'chromium' as const})});}
async function popup(context:BrowserContext){
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const extensionOrigin=`chrome-extension://${new URL(worker.url()).hostname}`,page=await context.newPage();await page.goto(`${extensionOrigin}/popup.html`);
 await expect(page.locator('#status')).not.toHaveAttribute('aria-busy','true');return {page,extensionOrigin};
}
async function configureReading(context:BrowserContext,extensionOrigin:string,features:string[]){
 const options=await context.newPage();await options.goto(`${extensionOrigin}/options.html`);
 await options.locator('#add').click();const fields=options.locator('#providers fieldset').last();
 await fields.locator('[name=name]').fill('Controlled reading');await fields.locator('[name=baseUrl]').fill(sourceOrigin+'/v1');await fields.locator('[name=model]').fill('fixture-reading');await fields.locator('[name=apiKey]').fill('fixture-reading-device-key');
 for(const feature of features)await options.locator('#feature-'+feature).selectOption({label:'Controlled reading'});
 await options.locator('#save').click();await expect(options.locator('#feedback')).toContainText(/已保存|saved/iu);await expect(fields.locator('[name=apiKey]')).toHaveValue('');await options.close();
}
async function selectBorrow(page:Page){
 const rect=await page.locator('#source').evaluate(element=>{const text=element.firstChild!,value=text.textContent!,start=value.indexOf('borrow');const range=document.createRange();range.setStart(text,start);range.setEnd(text,start+5);const r=range.getBoundingClientRect();return {left:r.left,right:r.right,y:r.top+r.height/2};});
 await page.mouse.move(rect.left+.1,rect.y);await page.mouse.down();await page.mouse.move(rect.right-.1,rect.y,{steps:8});await page.mouse.up();
 expect(await page.evaluate(()=>getSelection()?.toString())).toBe('borro');
 await expect.poll(()=>panelButton(page,'句中解释')).toBe(true);
 await page.keyboard.press('Shift+ArrowRight');
 expect(await page.evaluate(()=>getSelection()?.toString())).toBe('borrow');
 await expect.poll(()=>panelButton(page,'句中解释')).toBe(true);
}

test('extension acceptance saves directly, unfinished capture stays in Inbox, and receipts survive restart',async()=>{
 const profile=join(directory,'profile');let context=await launch(profile);
 try{
  let web=context.pages()[0]??await context.newPage();await web.goto(origin);await web.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
  await expect(web.getByRole('navigation',{name:'主要导航'})).toBeVisible();
  const extension=await popup(context),options=await context.newPage();await options.goto(`${extension.extensionOrigin}/options.html`);
  await options.locator('#add').click();const fields=options.locator('#providers fieldset').last();
  await fields.locator('[name=name]').fill('Controlled semantic lookup');await fields.locator('[name=baseUrl]').fill(sourceOrigin+'/v1');await fields.locator('[name=model]').fill('fixture-semantic');await fields.locator('[name=apiKey]').fill('fixture-not-a-secret');
  await options.locator('#feature-meaning').selectOption({label:'Controlled semantic lookup'});await options.locator('#save').click();
  await expect(options.locator('#feedback')).toContainText(/已保存|saved/iu);await options.close();
  await expect.poll(()=>extension.page.evaluate(async()=>(await chrome.storage.local.get('sensaLocalWebLibrary')).sensaLocalWebLibrary??null)).not.toBeNull();
  await web.close();
  const source=await context.newPage();await source.goto(sourceOrigin+'/source.html');await source.bringToFront();
  // The real popup click handler activates the current source tab. A popup
  // document is used because browser-toolbar chrome is outside Playwright.
  await extension.page.evaluate(()=>document.querySelector<HTMLButtonElement>('#toggle')!.click());
  await expect(extension.page.locator('#status')).toContainText(/已开启|enabled/iu);
  await selectBorrow(source);expect(await panelButton(source,'句中解释',true)).toBe(true);
  await expect.poll(()=>panelButton(source,'保存到我的语义世界')).toBe(true);
  expect(lookupRequests).toBe(1);expect(await panelButton(source,'保存到我的语义世界',true)).toBe(true);
  const queue=()=>extension.page.evaluate(async()=>((await chrome.storage.local.get('sensaLocalIntake')).sensaLocalIntake??[]) as Array<{operationId:string;receipt?:SensaBrowserIntakeReceipt;snapshot:{sentence:string;expression:{text:string;start:number;end:number}}}>);
  await expect.poll(async()=>(await queue()).length).toBe(1);
  const queued=(await queue())[0]!;expect(queued.receipt).toBeUndefined();expect(queued.snapshot.expression.text).toBe('borrow');
  await expect.poll(async()=>(await panelUi(source))?.feedback??'').toContain('已暂存在插件');
  expect(Array.from(queued.snapshot.sentence).slice(queued.snapshot.expression.start,queued.snapshot.expression.end).join('')).toBe('borrow');
  web=await context.newPage();await web.goto(origin);
  await expect.poll(async()=>(await queue())[0]?.receipt?.result.route,{timeout:30_000}).toBe('fast_track');
  const applied=(await queue())[0]!.receipt!;expect(applied.operationId).toBe(queued.operationId);
  await web.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
  await web.getByRole('button',{name:/^borrow(?:\s|$)/u}).click();await expect(web.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
  const savedDetail=web.getByRole('article',{name:'表达详情'});
  await expect(savedDetail).toContainText(sentence);
  await savedDetail.locator('summary').filter({hasText:'Borrowing an umbrella'}).click();
  await expect(savedDetail.getByRole('link')).toHaveAttribute('href',sourceOrigin+'/source.html');
  await expect(web.getByRole('button',{name:'就是这个意思',exact:true})).toHaveCount(0);
  expect(await web.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);
  expect((await web.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
  const detailUrl=web.url();await context.close();context=await launch(profile);web=context.pages()[0]??await context.newPage();await web.goto(detailUrl);
  await expect(web.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();await web.reload();await expect(web.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
  await expect(web.getByRole('article',{name:'表达详情'}).locator('summary')).toContainText('Borrowing an umbrella');
  const reopened=await popup(context);
  expect(await reopened.page.evaluate(async()=>(await chrome.storage.local.get('sensaLocalIntake')).sensaLocalIntake.map((entry:{receipt:unknown})=>entry.receipt))).toEqual([applied]);
  expect(await web.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);expect(lookupRequests).toBe(1);
  const unfinished=await context.newPage();await unfinished.goto(sourceOrigin+'/source.html');await unfinished.bringToFront();
  await reopened.page.evaluate(()=>document.querySelector<HTMLButtonElement>('#toggle')!.click());
  await expect(reopened.page.locator('#status')).toContainText(/已开启|enabled/iu);await selectBorrow(unfinished);
  expect(await panelButton(unfinished,'保存…',true)).toBe(true);await expect.poll(()=>panelButton(unfinished,'保存待处理')).toBe(true);
  expect(await panelButton(unfinished,'保存待处理',true)).toBe(true);
  const receipts=()=>reopened.page.evaluate(async()=>(await chrome.storage.local.get('sensaLocalIntake')).sensaLocalIntake.map((entry:{receipt?:SensaBrowserIntakeReceipt})=>entry.receipt??null) as Array<SensaBrowserIntakeReceipt|null>);
  await expect.poll(async()=>(await receipts()).map(receipt=>receipt?.result.route),{timeout:30_000}).toEqual(['fast_track','inbox']);
  const settled=await receipts();await web.bringToFront();
  await web.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的语义世界',exact:true}).click();
  await expect(web.locator('.sensa-world.active .sensa-world-row')).toHaveCount(1);
  await web.getByRole('button',{name:/^收件箱/u}).click();
  const inbox=web.locator('.sensa-intake-inbox').getByRole('dialog');
  await expect(inbox.getByRole('button',{name:'继续对话',exact:true})).toBeEnabled();
  await expect(inbox).toContainText('Borrowing an umbrella');
  expect(await web.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(1);
  expect((await web.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
  await web.reload();await expect(web.getByRole('navigation',{name:'主要导航'})).toBeVisible();
  expect(await web.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(1);expect(await receipts()).toEqual(settled);expect(lookupRequests).toBe(1);
 }finally{await context.close();}
});

test('installed extension page translation and writing stay temporary and require explicit text replacement',async()=>{
 const context=await launch(join(directory,'reading-profile'));
 try{
  const web=context.pages()[0]??await context.newPage();await web.goto(origin);await web.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
  await expect(web.getByRole('navigation',{name:'主要导航'})).toBeVisible();
  const extension=await popup(context);await configureReading(context,extension.extensionOrigin,['page','selection','writing']);
  const source=await context.newPage();await source.goto(sourceOrigin+'/source.html');
  expect(readingRequests).toHaveLength(0);await expect(source.locator('[data-sensa-ui]')).toHaveCount(0);
  await source.bringToFront();await extension.page.evaluate(()=>document.querySelector<HTMLButtonElement>('#toggle')!.click());await expect(extension.page.locator('#status')).toContainText(/已开启|enabled/iu);
  await source.getByRole('button',{name:'翻译页面',exact:true}).click();await expect(source.locator('#source + [data-sensa-ui="translation"]')).toHaveText('她向同事暂借雨伞，并准备归还。');
  expect(readingRequests[0]!.system).toContain('into natural Chinese (Simplified)');expect(readingRequests[0]!.input.context).toContain('Borrowing an umbrella');
  const setSupport=async(language:string)=>{
   await web.bringToFront();await web.goto(origin+'/profile');await web.locator('#settings-preferences').click();await web.locator('#account-languages').click();
   await web.getByLabel('默认辅助语言').first().selectOption(language);await web.getByRole('button',{name:'完成',exact:true}).click();
   await source.bringToFront();
  };
  await setSupport('fr');await expect(source.locator('[data-sensa-ui="translation"]')).toHaveCount(0);
  await source.getByRole('button',{name:'翻译页面',exact:true}).click();await expect(source.locator('#source + [data-sensa-ui="translation"]')).toHaveText('Elle a demandé à emprunter un parapluie.');
  expect(readingRequests.at(-1)!.system).toContain('into natural French');
  await setSupport('zh-CN');await expect(source.locator('[data-sensa-ui="translation"]')).toHaveCount(0);
  await source.getByRole('button',{name:'恢复原文',exact:true}).click();await expect(source.locator('#source')).toHaveText(sentence);await expect(source.locator('[data-sensa-ui="translation"]')).toHaveCount(0);
  await source.locator('#reply').press('Alt+t');const writing=source.locator('[data-sensa-ui="writing"]');await expect(writing.getByRole('button',{name:'替换输入框内容',exact:true})).toBeVisible();
  await expect(source.locator('#reply')).toHaveValue('我明天会把雨伞还给你。');await expect(writing.getByRole('status')).toHaveText('I will return the umbrella tomorrow.');
  await writing.getByRole('button',{name:'替换输入框内容',exact:true}).click();await expect(source.locator('#reply')).toHaveValue('I will return the umbrella tomorrow.');
  await source.locator('#ordinary').press('Alt+t');await expect(writing.getByRole('button',{name:'替换输入框内容',exact:true})).toBeVisible();await source.keyboard.press('Escape');await expect(source.locator('#ordinary')).toHaveValue('我把会议改到了周四。');
  const beforeSecret=readingRequests.length;await source.locator('#secret').press('Alt+t');await expect(writing).toHaveCount(0);expect(readingRequests).toHaveLength(beforeSecret);
  expect(await web.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(await web.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);
  const learning=await web.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(learning.targetIds).toEqual([]);expect(learning.records).toEqual([]);
 }finally{await context.close();}
});

test('Web glossary edits abort installed background HTTP work and invalidate completed page translations without creating semantic facts',async()=>{
 const context=await launch(join(directory,'glossary-profile')),start=readingRequests.length;
 try{
  const web=context.pages()[0]??await context.newPage();await web.goto(origin);await web.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await expect(web.getByRole('navigation',{name:'主要导航'})).toBeVisible();
  const extension=await popup(context);await configureReading(context,extension.extensionOrigin,['page']);
  const source=await context.newPage();await source.goto(sourceOrigin+'/glossary.html');await source.bringToFront();
  heldReadingText='She will return it after the rain stops.';
  await extension.page.evaluate(()=>document.querySelector<HTMLButtonElement>('#toggle')!.click());await expect(extension.page.locator('#status')).toContainText(/已开启|enabled/iu);
  await source.getByRole('button',{name:'翻译页面',exact:true}).click();
  await expect(source.locator('#source + [data-sensa-ui="translation"]')).toHaveText('她向同事暂借雨伞，并准备归还。');
  await expect.poll(()=>readingRequests.slice(start).filter(request=>request.input.text===heldReadingText).length).toBe(1);
  const pending=readingRequests.slice(start).find(request=>request.input.text===heldReadingText)!;expect(pending.cancelled).toBe(false);
  console.info('Installed glossary: completed translation and pending HTTP observed');
  await web.bringToFront();await web.goto(origin+'/profile');await web.locator('#settings-preferences').click();await web.locator('#account-glossary').click();
  await web.getByLabel('原文语言').selectOption('en');await web.getByLabel('译文语言').selectOption('zh-CN');
  await web.getByLabel('原文里的词',{exact:true}).fill('borrow');await web.getByLabel('你希望看到的说法',{exact:true}).fill('暂借一下');await web.getByRole('button',{name:'添加',exact:true}).click();
  await expect(web.getByRole('status')).toContainText('术语表已保存');
  console.info('Installed glossary: explicit Web edit saved');
  await expect.poll(()=>pending.cancelled).toBe(true);
  await expect(source.locator('[data-sensa-ui="translation"]')).toHaveCount(0);
  console.info('Installed glossary: HTTP aborted and previous translation removed');
  expect(await extension.page.evaluate(async()=>(await chrome.storage.local.get('readingGlossary')).readingGlossary)).toEqual([{inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'borrow',rendering:'暂借一下'}]);
  heldReadingText=null;heldReadingReplies.splice(0).forEach(reply=>reply());
  await source.bringToFront();await source.getByRole('button',{name:'翻译页面',exact:true}).click();
  await expect(source.locator('#source + [data-sensa-ui="translation"]')).toHaveText('她向同事暂借一下雨伞。');
  const fresh=readingRequests.slice(start).filter(request=>request.input.text===sentence).at(-1)!;expect(fresh.system).toContain('暂借一下');expect(fresh.system).toContain('"borrow"');
  await web.bringToFront();await web.getByRole('button',{name:'删除「borrow」',exact:true}).click();await expect(web.getByRole('status')).toContainText('术语表已保存');
  await expect(source.locator('[data-sensa-ui="translation"]')).toHaveCount(0);await source.bringToFront();await source.getByRole('button',{name:'翻译页面',exact:true}).click();
  await expect(source.locator('#source + [data-sensa-ui="translation"]')).toHaveText('她向同事暂借雨伞，并准备归还。');expect(readingRequests.slice(start).filter(request=>request.input.text===sentence).at(-1)!.system).not.toContain('暂借一下');
  await extension.page.evaluate(()=>document.querySelector<HTMLButtonElement>('#stop')!.click());await expect(source.locator('[data-sensa-ui="page"]')).toHaveCount(0);
  const stopped=readingRequests.length;await web.bringToFront();await web.getByLabel('原文里的词',{exact:true}).fill('borrow');await web.getByLabel('你希望看到的说法',{exact:true}).fill('暂借一下');await web.getByRole('button',{name:'添加',exact:true}).click();await expect(web.getByRole('status')).toContainText('术语表已保存');
  await expect.poll(()=>extension.page.evaluate(async()=>(await chrome.storage.local.get('readingGlossary')).readingGlossary?.length)).toBe(1);await expect(source.locator('[data-sensa-ui="page"]')).toHaveCount(0);expect(readingRequests).toHaveLength(stopped);
  expect(await web.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(await web.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);
  const learning=await web.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(learning.targetIds).toEqual([]);expect(learning.records).toEqual([]);
 }finally{heldReadingText=null;heldReadingReplies.splice(0).forEach(reply=>reply());await context.close();}
});

test('installed extension reads the selected French platform track, cancels obsolete subtitle HTTP and accepts an own-language file without learning writes',async()=>{
 const context=await launch(join(directory,'subtitle-profile')),start=readingRequests.length,id='abcdefghijk';
 let captionUrl:URL|undefined;
 try{
  const web=context.pages()[0]??await context.newPage();await web.goto(origin);await web.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await expect(web.getByRole('navigation',{name:'主要导航'})).toBeVisible();
  const extension=await popup(context);await configureReading(context,extension.extensionOrigin,['subtitles']);
  const source=await context.newPage();
  await source.route('https://www.youtube.com/watch?**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="en"><title>Taking the train</title><body><div id="movie_player"><video class="html5-main-video"></video></div><script>
   const player=document.querySelector('#movie_player');
   window.ytInitialPlayerResponse={videoDetails:{videoId:'${id}'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'en',vssId:'.en',baseUrl:'https://www.youtube.com/api/timedtext?v=${id}&lang=en'},{languageCode:'fr',vssId:'.fr',baseUrl:'https://www.youtube.com/api/timedtext?v=${id}&lang=fr&signature=french-fixture'}]}}};
   player.getPlayerResponse=()=>window.ytInitialPlayerResponse;player.getOption=()=>({languageCode:'fr',vssId:'.fr'});
  </script></body></html>`}));
  await source.route('https://www.youtube.com/api/timedtext**',route=>{captionUrl=new URL(route.request().url());return route.fulfill({json:{events:[{tStartMs:0,dDurationMs:2000,segs:[{utf8:'Bonjour à tous.'}]},{tStartMs:3000,dDurationMs:2000,segs:[{utf8:'Nous allons prendre le train ensemble.'}]}]}});});
  await source.goto('https://www.youtube.com/watch?v='+id);await source.bringToFront();await extension.page.evaluate(()=>document.querySelector<HTMLButtonElement>('#toggle')!.click());await expect(extension.page.locator('#status')).toContainText(/已开启|enabled/iu);
  const panel=source.locator('[data-sensa-ui="youtube"]'),original=panel.getByLabel('当前原字幕',{exact:true}),translated=panel.getByLabel('当前字幕译文',{exact:true});
  await panel.getByRole('button',{name:'加载字幕',exact:true}).click();await expect(original).toHaveText('Bonjour à tous.');await expect(original).toHaveAttribute('lang','fr');
  await expect(panel.getByRole('status')).toContainText('法语');await expect(panel.locator('details')).not.toContainText('云端 AI 转录');
  expect(captionUrl?.searchParams.get('lang')).toBe('fr');expect(captionUrl?.searchParams.get('signature')).toBe('french-fixture');
  heldReadingText='Bonjour à tous.';await panel.getByRole('button',{name:'翻译本句',exact:true}).click();await expect.poll(()=>readingRequests.slice(start).filter(request=>request.input.text==='Bonjour à tous.').length).toBe(1);
  const first=readingRequests.slice(start).find(request=>request.input.text==='Bonjour à tous.')!;expect(first.system).toContain('quoted French text into natural Chinese (Simplified)');
  await panel.getByRole('button',{name:'下一句',exact:true}).click();await expect(original).toHaveText('Nous allons prendre le train ensemble.');await expect.poll(()=>first.cancelled).toBe(true);
  heldReadingText=null;heldReadingReplies.splice(0).forEach(reply=>reply());await panel.getByRole('button',{name:'翻译本句',exact:true}).click();await expect(translated).toHaveText('我们将一起坐火车。');
  await panel.getByRole('button',{name:'加载字幕',exact:true}).click();await source.evaluate(()=>{document.querySelector('video')!.currentTime=0;});await expect(original).toHaveText('Bonjour à tous.');
  heldReadingText='Bonjour à tous.';await panel.getByRole('button',{name:'翻译本句',exact:true}).click();await expect.poll(()=>readingRequests.slice(start).filter(request=>request.input.text==='Bonjour à tous.').length).toBe(2);
  const second=readingRequests.slice(start).filter(request=>request.input.text==='Bonjour à tous.').at(-1)!;
  const fileText="Bonjour à tous. Aujourd'hui nous allons prendre le train ensemble parce que la pluie est trop forte pour rentrer à pied. Nous retrouverons nos amis à la gare.";
  await panel.locator('input[type=file]').setInputFiles({name:'own-captions.vtt',mimeType:'text/vtt',buffer:Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:30.000\n'+fileText+'\n')});
  await expect(original).toHaveText(fileText);await expect(original).toHaveAttribute('lang','fr');await expect.poll(()=>second.cancelled).toBe(true);
  heldReadingText=null;heldReadingReplies.splice(0).forEach(reply=>reply());await panel.getByRole('button',{name:'翻译本句',exact:true}).click();await expect(translated).toHaveText('大家好。');expect(readingRequests.at(-1)!.system).toContain('quoted French text into natural Chinese (Simplified)');expect(readingRequests.at(-1)!.input.text).toBe(fileText);
  await panel.locator('input[type=file]').setInputFiles({name:'oversized.vtt',mimeType:'text/vtt',buffer:Buffer.alloc(2_000_001,120)});await expect(panel.getByRole('status')).toContainText('字幕文件超过 2 MB');await expect(original).toHaveText(fileText);
  await source.evaluate(()=>{history.pushState({},'', '/watch?v=lmnopqrstuv');document.dispatchEvent(new Event('yt-navigate-start'));});await expect(panel).toHaveCount(0);
  expect(await web.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(await web.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);
  const learning=await web.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(learning.targetIds).toEqual([]);expect(learning.records).toEqual([]);
 }finally{heldReadingText=null;heldReadingReplies.splice(0).forEach(reply=>reply());await context.close();}
});

test('installed native language detection keeps ordinary English and a third-language paragraph distinct without changing the reading Route',async()=>{
 const context=await launch(join(directory,'native-language-profile')),start=readingRequests.length;
 try{
  const extension=await popup(context);await configureReading(context,extension.extensionOrigin,['selection']);
  const source=await context.newPage();await source.goto(sourceOrigin+'/native-language.html');await source.bringToFront();
  await extension.page.evaluate(()=>document.querySelector<HTMLButtonElement>('#toggle')!.click());await expect(extension.page.locator('#status')).toContainText(/已开启|enabled/iu);
  const route=await extension.page.locator('#language-route').inputValue();
  for(const [selector,text,language]of [['#source',nativeEnglish,'English'],['#foreign',nativeFrench,'French']] as const){
   const before=readingRequests.length;await source.locator(selector).click({clickCount:3});expect(await source.evaluate(()=>getSelection()?.toString().trim())).toBe(text);
   await expect.poll(()=>panelButton(source,'翻译')).toBe(true);expect(await panelButton(source,'翻译',true)).toBe(true);
   await expect.poll(()=>readingRequests.length).toBe(before+1);expect(readingRequests.at(-1)!.input.text).toBe(text);
   expect(readingRequests.at(-1)!.system).toContain(`quoted ${language} text into natural Chinese (Simplified)`);
   await source.keyboard.press('Escape');
  }
  expect(readingRequests).toHaveLength(start+2);await extension.page.locator('#sync').click();await expect(extension.page.locator('#status')).not.toHaveAttribute('aria-busy','true');expect(await extension.page.locator('#language-route').inputValue()).toBe(route);
  expect(await extension.page.evaluate(async()=>((await chrome.storage.local.get('sensaLocalIntake')).sensaLocalIntake??[]).length)).toBe(0);
 }finally{await context.close();}
});
