import {chromium, expect, type CDPSession} from '@playwright/test';
import {resolve} from 'node:path';

// Run the actual closed-shadow content bundle with a local runtime stub. No API/provider calls.
const browser=await chromium.launch({executablePath:process.env.SENSA_CHROMIUM_PATH});
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 await page.route('**/*',route=>route.request().url()==='http://127.0.0.1/dismiss-fixture'?route.fulfill({contentType:'text/html',body:'<main style="margin:80px;font:24px/2 system-ui"><p>Formal knowledge is used in indexing and retrieval.</p><button id="outside">Outside</button></main>'}):route.abort());
 await page.goto('http://127.0.0.1/dismiss-fixture');
 await page.addScriptTag({content:'window.__name = (value) => value;'});
 await page.evaluate(()=>{
  const state={calls:0,mode:'error',pending:null as null|((value:unknown)=>void),receive:null as null|((message:unknown)=>void)};
  Object.assign(window,{fixture:state,chrome:{runtime:{onMessage:{addListener:(fn:typeof state.receive)=>{state.receive=fn;}},sendMessage:async()=>{
   state.calls++;
   if(state.mode==='pending')return new Promise(resolve=>{state.pending=resolve;});
   if(state.mode==='error')throw new Error('fixture offline');
   return {value:{status:'ready',proposal:{explanation:'用于建立索引。',semanticSpec:{coreMeaningFocus:'索引',prototypeScenes:[]}}}};
  }}}});
 });
 await page.addScriptTag({path:resolve('apps/browser-extension/dist/content.js')});
 await page.evaluate(()=>{(window as any).fixture.receive({kind:'reading',enabled:true,accountId:'fixture-account'});});
 const cdp=await page.context().newCDPSession(page);
 async function findButton(client:CDPSession,label:string){
  const {root}=await client.send('DOM.getDocument',{depth:-1,pierce:true});
  function find(node:any):any {
   if(node.nodeName==='BUTTON'&&node.children?.some((child:any)=>child.nodeValue===label))return node;
   for(const child of [...node.children??[],...node.shadowRoots??[]]){const found=find(child);if(found)return found;}
  }
  return find(root);
 }
 async function click(label:string){
  const node=await findButton(cdp,label);expect(node,`button ${label}`).toBeTruthy();
  const {model}=await cdp.send('DOM.getBoxModel',{nodeId:node.nodeId});const q=model.content;
  await page.mouse.click((q[0]+q[2])/2,(q[1]+q[5])/2);
 }
 async function select(mode:string){
  await page.mouse.move(5,5);
  await page.evaluate(mode=>{
   (window as any).fixture.mode=mode;
   const node=document.querySelector('p')!.firstChild!,range=document.createRange();
   const start=node.textContent!.indexOf('indexing');range.setStart(node,start);range.setEnd(node,start+8);
   getSelection()!.removeAllRanges();getSelection()!.addRange(range);
   document.querySelector('p')!.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
  },mode);
  await expect.poll(async()=>Boolean(await findButton(cdp,'关闭'))).toBe(true);
  await click('句中解释');
  await expect.poll(()=>page.evaluate(()=>(window as any).fixture.calls)).toBeGreaterThan(0);
 }
 async function closedWithoutLookup(){
  // Allow the deferred selection handler and async response rendering to run.
  await page.waitForTimeout(150);
  expect(await findButton(cdp,'关闭'),'dismissed panel must stay closed').toBeUndefined();
 }
 for(const mode of ['error','ready','pending']){
  await select(mode);
  const before=await page.evaluate(()=>(window as any).fixture.calls);
  await click('关闭');await closedWithoutLookup();
  expect(await page.evaluate(()=>(window as any).fixture.calls)).toBe(before);
  if(mode==='pending'){
   await page.evaluate(()=>{(window as any).fixture.pending({value:{status:'ready',proposal:{explanation:'迟到结果',semanticSpec:{coreMeaningFocus:'索引',prototypeScenes:[]}}}});});
   await closedWithoutLookup();
  }
 }
 await select('error');await page.keyboard.press('Escape');await closedWithoutLookup();
 await select('error');await page.locator('#outside').click();await closedWithoutLookup();
 await select('ready');
 const beforeSave=await page.evaluate(()=>(window as any).fixture.calls);
 await click('保存待处理');await page.waitForTimeout(150);
 expect(await page.evaluate(()=>(window as any).fixture.calls)).toBe(beforeSave+1);
 expect(await findButton(cdp,'关闭')).toBeTruthy();
 await click('关闭');await closedWithoutLookup();
 console.log('PASS: close in error/ready/loading states, late response, Escape, outside click, reselect, save without recapture; no network calls.');
} finally {await browser.close();}
