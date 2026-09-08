import {chromium,expect} from '@playwright/test';
import {mkdtemp,cp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
const directory=await mkdtemp(join(tmpdir(),'sensa-extension-')),extension=join(directory,'extension');await cp(resolve('apps/browser-extension/dist'),extension,{recursive:true});
// Automated harness grants only this fixture origin; manual activeTab toolbar grant remains a separate acceptance vector.
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://127.0.0.1:4321/*');await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
const server=createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><title>Reading fixture</title><main style="margin:80px;font:24px/2 system-ui"><p>😀 She took her time, then took a seat.</p></main>');});await new Promise<void>(r=>server.listen(4321,'127.0.0.1',r));
let context=await chromium.launchPersistentContext(join(directory,'profile'),{channel:'chromium',executablePath:process.env.SENSA_CHROMIUM_PATH,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1280,height:800}});
try{
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const extensionId=new URL(worker.url()).host;
 const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html`);
 await popup.getByRole('button',{name:'连接 Sensa 账号',exact:true}).click();
 const authPage=await context.waitForEvent('page');await authPage.waitForLoadState();await authPage.getByLabel('邮箱', {exact:true}).fill('test@sensa.invalid');await authPage.getByRole('button',{name:'发送验证码',exact:true}).click();await authPage.getByLabel('验证码',{exact:true}).fill('123456');await authPage.getByRole('button',{name:'验证并继续'}).click();await authPage.getByRole('button',{name:'连接当前账号'}).click();
 await expect(popup.locator('#status')).toContainText('已连接账号');
 const reading=await context.newPage();await reading.goto('http://127.0.0.1:4321/');
 // Equivalent popup message, while the reading page is the active tab.
 await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'toggle'}));
 await reading.evaluate(()=>{const node=document.querySelector('p')!.firstChild!;const range=document.createRange();range.setStart(node,7);range.setEnd(node,11);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new PointerEvent('pointerup'));});
 await reading.waitForTimeout(100);
 const cdp=await context.newCDPSession(reading);
 async function clickClosedButton(text:string){const tree=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});function find(node:any):any{if(node.nodeName==='BUTTON'&&node.children?.some((c:any)=>c.nodeValue===text))return node;for(const child of [...node.children??[],...node.shadowRoots??[]]){const found=find(child);if(found)return found;}}const node=find(tree.root);expect(node).toBeTruthy();const box=await cdp.send('DOM.getBoxModel',{nodeId:node.nodeId});const q=box.model.content;await reading.mouse.click((q[0]+q[2])/2,(q[1]+q[5])/2);}
 await reading.screenshot({path:'/tmp/sensa-m2-capture.png'});await clickClosedButton('保存待处理');
 await expect.poll(async()=>{await popup.getByRole('button',{name:'检查保存结果'}).click();return popup.locator('#recent').textContent();}).toContain('已存入收件箱');
 const href=await popup.locator('#recent a').first().getAttribute('href');expect(href).toContain('intake=');
 const web=await context.newPage();await web.goto(href!);
 await expect(web.getByRole('heading',{name:'我的内容',exact:true})).toBeVisible();await expect(web.getByRole('region',{name:'收件箱'}).getByText('😀 She took her time, then took a seat.',{exact:true})).toBeVisible();await web.screenshot({path:'/tmp/sensa-m2-inbox.png'});
 // The Inbox slow path accepts the same fixed relation without adding learning.
 await web.getByRole('button',{name:'查看句中解释',exact:true}).first().click();await web.getByRole('button',{name:'加入 Sensa',exact:true}).click();await expect(web.getByRole('region',{name:'已确认的意思'})).toContainText('从容');
 // Second occurrence remains a different capture and survives a browser restart offline.
 await context.setOffline(true);
 await reading.evaluate(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));const node=document.querySelector('p')!.firstChild!;const range=document.createRange();range.setStart(node,27);range.setEnd(node,31);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new PointerEvent('pointerup'));});
 await reading.waitForTimeout(100);await clickClosedButton('保存待处理');
 await expect.poll(()=>worker.evaluate(async()=>{const data=(await chrome.storage.local.get('sensa')).sensa as any;return data.accounts[data.active].queue.length;})).toBe(1);
 await context.close();
 context=await chromium.launchPersistentContext(join(directory,'profile'),{channel:'chromium',executablePath:process.env.SENSA_CHROMIUM_PATH,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const restored=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const restoredPopup=await context.newPage();await restoredPopup.goto(`chrome-extension://${extensionId}/popup.html`);await restoredPopup.getByRole('button',{name:'检查保存结果'}).click();await expect(restoredPopup.locator('#status')).toContainText('0 项待同步');await expect(restoredPopup.locator('#recent a')).toHaveCount(2);
 expect(await restored.evaluate(async()=>Object.keys((await chrome.storage.session.get('modes')).modes??{}).length)).toBe(0);
 // Fast path: another source is confirmed in the original page, then opened as a Meaning.
 const fast=await context.newPage();await fast.goto('http://127.0.0.1:4321/fast');await restoredPopup.evaluate(()=>chrome.runtime.sendMessage({kind:'toggle'}));
 await fast.evaluate(()=>{const node=document.querySelector('p')!.firstChild!;const range=document.createRange();range.setStart(node,7);range.setEnd(node,11);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new PointerEvent('pointerup'));});
 const fastCdp=await context.newCDPSession(fast);let acceptNode:any;
 await expect.poll(async()=>{const tree=await fastCdp.send('DOM.getDocument',{depth:-1,pierce:true});function find(node:any):any{if(node.nodeName==='BUTTON'&&node.children?.some((c:any)=>c.nodeValue==='加入 Sensa'))return node;for(const child of [...node.children??[],...node.shadowRoots??[]]){const found=find(child);if(found)return found;}}acceptNode=find(tree.root);return Boolean(acceptNode);}).toBe(true);
 const box=await fastCdp.send('DOM.getBoxModel',{nodeId:acceptNode.nodeId}),q=box.model.content;await fast.mouse.click((q[0]+q[2])/2,(q[1]+q[5])/2);
 await expect.poll(async()=>{await restoredPopup.getByRole('button',{name:'检查保存结果'}).click();return restoredPopup.locator('#recent').textContent();}).toContain('已加入 Sensa');
 const meaningLink=await restoredPopup.locator('#recent a').filter({hasText:'已加入 Sensa'}).first().getAttribute('href');const confirmed=await context.newPage();await confirmed.goto(meaningLink!);await expect(confirmed.getByRole('region',{name:'已确认的意思'})).toBeVisible();await confirmed.screenshot({path:'/tmp/sensa-m2-meaning.png'});

 console.log('M2-A/B extension browser passed: real launchWebAuthFlow + Web consent + PKCE exchange, injected selection/Unicode capture, durable queue, server Inbox, Web slow acceptance, in-page fast acceptance, same-account deep links, offline restart. activeTab itself requires manual grant verification.');
}finally{await context.close();server.close();}
