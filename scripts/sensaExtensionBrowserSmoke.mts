import {webUrl,apiUrl,assertMockServer,rate} from './support/consumerBrowserActions.mts';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,cp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
const directory=await mkdtemp(join(tmpdir(),'sensa-extension-')),extension=join(directory,'extension');await cp(resolve(process.env.SENSA_EXTENSION_TEST_DIR??'apps/browser-extension/dist'),extension,{recursive:true});
// Automated harness grants only this fixture origin; manual activeTab toolbar grant remains a separate acceptance vector.
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));expect(manifest.host_permissions).toEqual([new URL(apiUrl).origin+'/*']);manifest.host_permissions.push('http://127.0.0.1:4321/*');await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
const server=createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><title>Reading fixture</title><main style="margin:80px;font:24px/2 system-ui"><p>😀 She took her time, then took a seat.</p></main>');});await new Promise<void>(r=>server.listen(4321,'127.0.0.1',r));
let context=await chromium.launchPersistentContext(join(directory,'profile'),{locale:'zh-CN',channel:'chromium',executablePath:process.env.SENSA_CHROMIUM_PATH,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1280,height:800}});
try{
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const extensionId=new URL(worker.url()).host;
 const popup=await context.newPage();await assertMockServer(popup);await popup.goto(`chrome-extension://${extensionId}/popup.html`);
 await popup.getByRole('button',{name:'连接 Sensa 账号',exact:true}).click();
 const authPage=await context.waitForEvent('page');await authPage.waitForLoadState();await authPage.getByLabel('邮箱', {exact:true}).fill('test@sensa.invalid');await authPage.getByRole('button',{name:'发送验证码',exact:true}).click();await authPage.getByLabel('验证码',{exact:true}).fill('123456');await authPage.getByRole('button',{name:'验证并继续'}).click();await authPage.getByRole('button',{name:'连接当前账号'}).click();
 await expect(popup.locator('#status')).toContainText('已连接账号');
 const reading=await context.newPage();await reading.goto('http://127.0.0.1:4321/');
 // Equivalent popup message, while the reading page is the active tab.
 await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'toggle'}));
 await reading.evaluate(()=>{const node=document.querySelector('p')!.firstChild!;const range=document.createRange();range.setStart(node,7);range.setEnd(node,11);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new PointerEvent('pointerup'));});
 await reading.waitForTimeout(100);
 const cdp=await context.newCDPSession(reading);
 async function clickClosedButton(text:string){if(text==='保存待处理')await clickClosedButton('保存…');const tree=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});function find(node:any):any{if(node.nodeName==='BUTTON'&&!node.attributes?.includes('hidden')&&node.children?.some((c:any)=>c.nodeValue===text))return node;for(const child of [...node.children??[],...node.shadowRoots??[]]){const found=find(child);if(found)return found;}}const node=find(tree.root);expect(node).toBeTruthy();const box=await cdp.send('DOM.getBoxModel',{nodeId:node.nodeId});const q=box.model.content;await reading.mouse.click((q[0]+q[2])/2,(q[1]+q[5])/2);}
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
 // Unknown store versions block safely without changing or uploading the queue. Legacy v0 is readable.
 const unsupported=await worker.evaluate(async()=>{const value=(await chrome.storage.local.get('sensa')).sensa as any;value.version=99;await chrome.storage.local.set({sensa:value});return JSON.stringify(value);});
 const blocked=await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'sync'}));expect(blocked.error).toBe('client_update_required');
 expect(await worker.evaluate(async()=>JSON.stringify((await chrome.storage.local.get('sensa')).sensa))).toBe(unsupported);
 await worker.evaluate(async()=>{const value=(await chrome.storage.local.get('sensa')).sensa as any;delete value.version;await chrome.storage.local.set({sensa:value});});
 // Replace the unpacked package version before restart; store-distributed hot update is a separate vector.
 await writeFile(join(extension,'manifest.json'),JSON.stringify({...manifest,version:'0.1.1'}));
 await context.close();
 context=await chromium.launchPersistentContext(join(directory,'profile'),{locale:'zh-CN',channel:'chromium',executablePath:process.env.SENSA_CHROMIUM_PATH,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const restored=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');expect(await restored.evaluate(()=>chrome.runtime.getManifest().version)).toBe('0.1.1');
 const restoredPopup=await context.newPage();await restoredPopup.goto(`chrome-extension://${extensionId}/popup.html`);await restoredPopup.getByRole('button',{name:'检查保存结果'}).click();await expect(restoredPopup.locator('#status')).toContainText('0 项待同步');await expect(restoredPopup.locator('#recent a')).toHaveCount(2);
 expect(await restored.evaluate(async()=>Object.keys((await chrome.storage.session.get('modes')).modes??{}).length)).toBe(0);
 // Fast path: another source is confirmed in the original page, then opened as a Meaning.
 const fast=await context.newPage();await fast.goto('http://127.0.0.1:4321/fast');await restoredPopup.evaluate(()=>chrome.runtime.sendMessage({kind:'toggle'}));
 await fast.evaluate(()=>{const node=document.querySelector('p')!.firstChild!;const range=document.createRange();range.setStart(node,7);range.setEnd(node,11);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new PointerEvent('pointerup'));});
 const fastCdp=await context.newCDPSession(fast);let acceptNode:any;
 async function clickFastButton(label:string){await expect.poll(async()=>Boolean(await closedNode(label))).toBe(true);const node=await closedNode(label),box=await fastCdp.send('DOM.getBoxModel',{nodeId:node.nodeId}),q=box.model.content;await fast.mouse.click((q[0]+q[2])/2,(q[1]+q[5])/2);}
 await clickFastButton('句中解释');
 await expect.poll(async()=>{const tree=await fastCdp.send('DOM.getDocument',{depth:-1,pierce:true});function find(node:any):any{if(node.nodeName==='BUTTON'&&!node.attributes?.includes('hidden')&&node.children?.some((c:any)=>c.nodeValue==='保存到我的内容'))return node;for(const child of [...node.children??[],...node.shadowRoots??[]]){const found=find(child);if(found)return found;}}acceptNode=find(tree.root);return Boolean(acceptNode);}).toBe(true);
 const box=await fastCdp.send('DOM.getBoxModel',{nodeId:acceptNode.nodeId}),q=box.model.content;await fast.mouse.click((q[0]+q[2])/2,(q[1]+q[5])/2);
 await expect.poll(async()=>{await restoredPopup.getByRole('button',{name:'检查保存结果'}).click();return restoredPopup.locator('#recent').textContent();}).toContain('已加入 Sensa');
 const meaningLink=await restoredPopup.locator('#recent a').filter({hasText:'已加入 Sensa'}).first().getAttribute('href');const confirmed=await context.newPage();await confirmed.goto(meaningLink!);await expect(confirmed.getByRole('region',{name:'已确认的意思'})).toBeVisible();await confirmed.screenshot({path:'/tmp/sensa-m2-meaning.png'});

 // Both accepted paths reach the same target and complete the M1 initial-learning protocol.
 await confirmed.goto(webUrl);await confirmed.getByRole('button',{name:'确认数量并继续',exact:true}).click();await expect(confirmed.getByRole('heading',{name:'今天',exact:true})).toBeVisible();
 await confirmed.goto(meaningLink!);await confirmed.getByRole('button',{name:'加入学习',exact:true}).first().click();
 await expect(confirmed.getByRole('button',{name:'准备 / 检查学习内容',exact:true}).first()).toBeVisible();
 await confirmed.getByRole('button',{name:'准备 / 检查学习内容',exact:true}).first().click();await expect(confirmed.getByText('学习内容已准备好',{exact:true}).first()).toBeVisible();
 await confirmed.reload();await expect(confirmed.getByText('学习内容已准备好',{exact:true}).first()).toBeVisible();
 await confirmed.getByRole('button',{name:'回首页',exact:true}).first().click();await confirmed.getByRole('button',{name:'开始学习',exact:true}).click();
 await expect(confirmed.getByRole('button',{name:'显示表达',exact:true})).toBeVisible();await expect(confirmed.getByRole('heading',{name:'took',exact:true})).toHaveCount(0);
 await confirmed.screenshot({path:'/tmp/sensa-m2-personal-recall.png'});await confirmed.getByRole('button',{name:'显示表达',exact:true}).click();await rate(confirmed,'顺利想起');
 await expect(confirmed.getByRole('heading',{name:'已完成首次学习',exact:true})).toBeVisible();await expect(confirmed.getByText(/下次复习：/)).toBeVisible();await confirmed.screenshot({path:'/tmp/sensa-m2-personal-completion.png'});

 // Capture remains owned by A across disconnect, B login, original-session revocation and A reauthorization.
 const originalAccount=await restored.evaluate(async()=>((await chrome.storage.local.get('sensa')).sensa as any).active);
 await fast.bringToFront();await context.setOffline(true);await fast.evaluate(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));const node=document.querySelector('p')!.firstChild!;const range=document.createRange();range.setStart(node,27);range.setEnd(node,31);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new PointerEvent('pointerup'));});
 async function closedNode(label:string){const tree=await fastCdp.send('DOM.getDocument',{depth:-1,pierce:true});function find(node:any):any{if(node.nodeName==='BUTTON'&&!node.attributes?.includes('hidden')&&node.children?.some((c:any)=>c.nodeValue===label))return node;for(const child of [...node.children??[],...node.shadowRoots??[]]){const found=find(child);if(found)return found;}}return find(tree.root);}
 await clickFastButton('保存…');
 await expect.poll(async()=>Boolean(await closedNode('保存待处理'))).toBe(true);const saveNode=await closedNode('保存待处理'),saveBox=await fastCdp.send('DOM.getBoxModel',{nodeId:saveNode.nodeId}),sq=saveBox.model.content;await fast.mouse.click((sq[0]+sq[2])/2,(sq[1]+sq[5])/2);
 await expect.poll(()=>restored.evaluate(async()=>{const s=(await chrome.storage.local.get('sensa')).sensa as any;return s.accounts[s.active].queue.length;})).toBe(1);
 await restoredPopup.evaluate(()=>chrome.runtime.sendMessage({kind:'disconnect'}));await expect.poll(async()=>Boolean(await closedNode('关闭'))).toBe(false);await context.setOffline(false);
 await confirmed.getByRole('button',{name:'回首页',exact:true}).click();await confirmed.goto(webUrl+'/profile');await confirmed.getByRole('button',{name:'退出登录',exact:true}).click();
 async function loginWeb(email:string){await confirmed.getByLabel('邮箱',{exact:true}).fill(email);await confirmed.getByRole('button',{name:'发送验证码',exact:true}).click();await confirmed.getByLabel('验证码',{exact:true}).fill('123456');await confirmed.getByRole('button',{name:'验证并继续'}).click();await expect(confirmed.getByLabel('邮箱',{exact:true})).toBeHidden();}
 async function authorizeCurrent(rounds=1){const before=await restored.evaluate(async()=>((await chrome.storage.local.get('sensa')).sensa as any).active);const pending=context.waitForEvent('page');await restoredPopup.getByRole('button',{name:'连接 Sensa 账号',exact:true}).click();let auth=await pending;for(let i=0;i<rounds;i++){const next=i<rounds-1?context.waitForEvent('page'):null;await auth.getByRole('button',{name:'连接当前账号',exact:true}).click();if(next)auth=await next;}await expect.poll(()=>restored.evaluate(async()=>((await chrome.storage.local.get('sensa')).sensa as any).active)).not.toBe(before);await expect(restoredPopup.locator('#status')).toContainText('已连接账号');}
 await loginWeb('second@sensa.invalid');await confirmed.goto(webUrl);await confirmed.getByRole('button',{name:'确认数量并继续'}).click();await authorizeCurrent();
 const switched=await restored.evaluate(async()=>{const s=(await chrome.storage.local.get('sensa')).sensa as any;return {active:s.active,counts:Object.fromEntries(Object.entries(s.accounts).map(([id,a]:any)=>[id,a.queue.length]))};});expect(switched.active).not.toBe(originalAccount);expect(switched.counts[originalAccount]).toBe(1);expect(switched.counts[switched.active]).toBe(0);
 await fast.bringToFront();await restoredPopup.evaluate(()=>chrome.runtime.sendMessage({kind:'toggle'}));
 const stale=await restored.evaluate(`(async original=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return (await chrome.scripting.executeScript({target:{tabId:tab.id},func:async(accountId)=>chrome.runtime.sendMessage({kind:'save',accountId,operationId:crypto.randomUUID(),snapshot:{sentence:'She took a seat.',language:'en',expression:{text:'took',start:4,end:8},source:{url:location.href,title:'stale preview fixture',capturedAt:new Date().toISOString()}}}),args:[original]}))[0].result;})(${JSON.stringify(originalAccount)})`);expect(stale.error).toBe('account_mismatch');
 await restoredPopup.evaluate(()=>chrome.runtime.sendMessage({kind:'sync'}));expect(await restored.evaluate(async original=>((await chrome.storage.local.get('sensa')).sensa as any).accounts[original].queue.length,originalAccount)).toBe(1);
 await confirmed.goto(webUrl+'/profile');await confirmed.getByRole('button',{name:'退出登录',exact:true}).click();await loginWeb('test@sensa.invalid');await authorizeCurrent(2);await restoredPopup.getByRole('button',{name:'检查保存结果',exact:true}).click();await expect(restoredPopup.locator('#status')).toContainText('0 项待同步');
 expect(await restored.evaluate(async()=>((await chrome.storage.local.get('sensa')).sensa as any).active)).toBe(originalAccount);
 console.log('M2-D extension recovery passed: unknown-version preservation, legacy-store read, unpacked version replacement/restart, account-bound floating preview, disconnect closes modes, A/B queue isolation and original-account reauthorization/replay.');

 console.log('M2-A/B/C extension browser passed: real launchWebAuthFlow + Web consent + PKCE exchange, injected selection/Unicode capture, durable queue, server Inbox, Web slow acceptance, in-page fast acceptance, same-account deep links, offline restart, personal target preparation/reload and M1 completion/handoff. native activeTab evidence is recorded separately with the native fixture.');
}finally{await context.close();server.close();}
