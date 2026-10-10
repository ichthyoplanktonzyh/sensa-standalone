/** Real Chromium selection/content script; controlled extension transport, no model. */
import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
let bundle:string;
test.use({locale:'zh-CN',viewport:{width:1200,height:850}});
test.beforeAll(async()=>{
  const built=await build({entryPoints:['apps/browser-extension/src/content.ts'],bundle:true,write:false,platform:'browser',format:'iife'});
  bundle=built.outputFiles[0]!.text;
});
for(const detectionDelay of [0,200])test(`keyboard adjustment saves the latest occurrence with ${detectionDelay}ms detector latency`,async({page})=>{
  // No source language declaration: this short block must actually use the
  // detector, rather than legitimately taking the declared-language fast path.
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><title>Selection fixture</title><body style="margin:60px;font:24px system-ui"><p id="source">They backed out of the deal.</p></body></html>'}));
  await page.goto('https://source.fixture.invalid/article');
  await page.addScriptTag({content:'window.__name=value=>value;'});
  await page.evaluate(()=>{
    const fixture={receive:null as null|((value:unknown)=>void),detectionDelay:0,detectionCount:0,
      detectorGate:null as Promise<void>|null,releaseDetection:null as (()=>void)|null,
      saves:[] as Array<{snapshot:{expression:{text:string};sentence:string}}>} ;
    Object.assign(window,{selectionFixture:fixture,chrome:{runtime:{onMessage:{addListener:(handler:typeof fixture.receive)=>{fixture.receive=handler;}},sendMessage:async(message:{kind:string;snapshot?:unknown})=>{
      if(message.kind==='detect-language'){
        fixture.detectionCount++;
        if(fixture.detectorGate)await fixture.detectorGate;
        if(fixture.detectionDelay)await new Promise(resolve=>setTimeout(resolve,fixture.detectionDelay));
        return {value:{language:{code:'eng',confidence:1}}};
      }
      if(message.kind==='save')fixture.saves.push(message as unknown as typeof fixture.saves[number]);
      return {value:{savedLocally:true}};
    }}}});
  });
  await page.addScriptTag({content:bundle});
  await page.evaluate(()=>(window as unknown as {selectionFixture:{receive:(value:unknown)=>void}}).selectionFixture.receive({kind:'reading',enabled:true,accountId:'fixture-local-scope'}));
  const bounds=await page.locator('#source').evaluate(element=>{
    const range=document.createRange();range.setStart(element.firstChild!,5);range.setEnd(element.firstChild!,14);
    const rect=range.getBoundingClientRect();return {left:rect.left,right:rect.right,y:rect.top+rect.height/2};
  });
  await page.mouse.move(bounds.left+.1,bounds.y);await page.mouse.down();await page.mouse.move(bounds.right-.1,bounds.y,{steps:8});await page.mouse.up();
  expect(await page.evaluate(()=>getSelection()?.toString())).toBe('backed ou');
  const cdp=await page.context().newCDPSession(page);
  async function panel(){
    const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
    function find(node:typeof root):typeof root|undefined{
      if(node.nodeName==='SECTION'&&node.attributes?.includes('Sensa 阅读'))return node;
      for(const child of [...node.children??[],...node.shadowRoots??[]]){const found=find(child);if(found)return found;}
    }
    const node=find(root);return node?(await cdp.send('DOM.resolveNode',{nodeId:node.nodeId})).object.objectId:null;
  }
  await expect.poll(panel).not.toBeNull();
  const initialDetections=await page.evaluate(delay=>{
    const fixture=(window as unknown as {selectionFixture:{detectionDelay:number;detectionCount:number;detectorGate:Promise<void>|null;releaseDetection:(()=>void)|null}}).selectionFixture;
    fixture.detectionDelay=delay;
    if(delay)fixture.detectorGate=new Promise<void>(resolve=>{fixture.releaseDetection=resolve;});
    return fixture.detectionCount;
  },detectionDelay);
  expect(initialDetections,'the fixture must exercise language detection').toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Shift+ArrowRight');
  expect(await page.evaluate(()=>getSelection()?.toString())).toBe('backed out');
  if(detectionDelay){
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {selectionFixture:{detectionCount:number}}).selectionFixture.detectionCount)).toBeGreaterThan(initialDetections);
    expect(await panel(),'the prior snapshot must not remain saveable during detection').toBeNull();
    // Release only after observing the pending boundary. Runner/CDP speed must
    // not turn a legitimately completed replacement panel into a false failure.
    await page.evaluate(()=>{
      const fixture=(window as unknown as {selectionFixture:{detectorGate:Promise<void>|null;releaseDetection:(()=>void)|null}}).selectionFixture;
      fixture.detectorGate=null;fixture.releaseDetection!();fixture.releaseDetection=null;
    });
  }
  await expect.poll(panel).not.toBeNull();
  const target=await panel();expect(target).not.toBeNull();
  expect(await page.evaluate(()=>(window as unknown as {selectionFixture:{detectionCount:number}}).selectionFixture.detectionCount),'the adjusted selection must also be detected').toBeGreaterThan(initialDetections);
  await cdp.send('Runtime.callFunctionOn',{objectId:target!,functionDeclaration:'function(){Array.from(this.querySelectorAll("button")).find(button=>button.textContent==="保存…").click();}'});
  await cdp.send('Runtime.callFunctionOn',{objectId:(await panel())!,functionDeclaration:'function(){Array.from(this.querySelectorAll("button")).find(button=>button.textContent==="保存待处理").click();}'});
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {selectionFixture:{saves:unknown[]}}).selectionFixture.saves.length)).toBe(1);
  const saved=await page.evaluate(()=>(window as unknown as {selectionFixture:{saves:Array<{snapshot:{expression:{text:string;start:number;end:number};sentence:string}}>}}).selectionFixture.saves[0]!.snapshot);
  expect(saved.expression.text).toBe('backed out');expect(saved.sentence.slice(saved.expression.start,saved.expression.end)).toBe('backed out');
  await cdp.detach();
});
