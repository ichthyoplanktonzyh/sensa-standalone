/** Installed extension -> shipped Web -> real OPFS. Only the model HTTP reply
 * is controlled; capture, acceptance, queues, bridge and receipts are real. */
import {test,expect,chromium,type Page,type BrowserContext} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {canonicalConsumerJson,semanticProposalSchema,type SensaBrowserIntakeReceipt} from '@sensa/contracts/sensa';
import {semanticLookupSpec} from '../support/semanticLookupFixtures';

let directory:string,server:Server,origin:string,sourceOrigin:string,lookupRequests=0;
const sentence='May asked to borrow an umbrella.';
const proposal=semanticProposalSchema.parse({explanation:'这里 borrow 表示临时借用并准备归还。',semanticSpec:semanticLookupSpec,expression:{surface:'borrow',type:'word',language:'en'}});
const snapshot={format:'sensa-learning-content-registry-v3',publishedAt:'2026-10-05T00:00:00Z',items:[]};
const registry={...snapshot,revision:createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex')};
const mime:Record<string,string>={'.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.png':'image/png'};
test.setTimeout(90_000);
test.beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'sensa-extension-intake-'));const dist=join(directory,'web');
 server=createServer(async(req,res)=>{
  const url=new URL(req.url??'/',origin||'http://127.0.0.1');
  if(url.pathname==='/source.html'){res.setHeader('content-type','text/html');res.end(`<!doctype html><html lang="en"><title>Borrowing an umbrella</title><body style="margin:64px;font:24px/2 system-ui"><p id="source">${sentence}</p></body></html>`);return;}
  if(url.pathname==='/v1/chat/completions'){
   let text='';for await(const chunk of req)text+=chunk.toString();const body=JSON.parse(text);
   if(body.stream!==false){res.writeHead(400);res.end('This fixture only supplies extension lookup');return;}
   lookupRequests++;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({proposal})}}]}));return;
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
});
test.afterAll(async()=>{if(server?.listening)await new Promise<void>(done=>server.close(()=>done()));if(directory)await rm(directory,{recursive:true,force:true});});

async function launch(profile:string){return chromium.launchPersistentContext(profile,{headless:true,locale:'zh-CN',viewport:{width:1280,height:900},args:[`--disable-extensions-except=${join(directory,'extension')}`,`--load-extension=${join(directory,'extension')}`],...(process.env.SENSA_CHROMIUM_PATH?{executablePath:process.env.SENSA_CHROMIUM_PATH}:{channel:'chromium' as const})});}
async function popup(context:BrowserContext){
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const extensionOrigin=`chrome-extension://${new URL(worker.url()).hostname}`,page=await context.newPage();await page.goto(`${extensionOrigin}/popup.html`);
 await expect(page.locator('#status')).not.toHaveAttribute('aria-busy','true');return {page,extensionOrigin};
}
/** Closed shadow roots are read through CDP. Click the actual rendered button
 * using its box, rather than invoking background save or manufacturing a queue. */
async function panelUi(page:Page):Promise<{buttons:Array<{label:string;x:number;y:number}>;feedback:string}|null>{
 const cdp=await page.context().newCDPSession(page);
 try{
  const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
  const find=(node:typeof root):typeof root|undefined=>{
   if(node.nodeName==='SECTION'&&node.attributes?.includes('Sensa 阅读'))return node;
   for(const child of [...node.children??[],...node.shadowRoots??[]]){const found=find(child);if(found)return found;}
  };
  const panel=find(root);if(!panel)return null;
  const object=(await cdp.send('DOM.resolveNode',{nodeId:panel.nodeId})).object.objectId!;
  const {result}=await cdp.send('Runtime.callFunctionOn',{objectId:object,functionDeclaration:'function(){return {buttons:Array.from(this.querySelectorAll("button")).filter(b=>!b.disabled&&b.getClientRects().length).map(b=>{const r=b.getBoundingClientRect();return {label:b.textContent,x:r.x+r.width/2,y:r.y+r.height/2};}),feedback:Array.from(this.querySelectorAll(".feedback")).filter(e=>e.getClientRects().length).map(e=>e.textContent).join(" ")};}',returnByValue:true});
  return result.value;
 }finally{await cdp.detach();}
}
async function panelButton(page:Page,label:string,click=false){
 const button=(await panelUi(page))?.buttons.find(button=>button.label===label);
 if(!button)return false;if(click)await page.mouse.click(button.x,button.y);return true;
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
