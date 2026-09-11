import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,cp,mkdir,unlink} from 'node:fs/promises';
import {tmpdir,homedir,platform} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {localIntakeRequestSchema,localIntakeReceiptSchema} from '../packages/contracts/src/sensa/consumer/localIntake.ts';
const root=await mkdtemp(join(tmpdir(),'sensa-intake-smoke-')),binary=resolve('target/debug/sensa-intake'),library=join(root,'library.sqlite');await writeFile(library,'');
const extension=join(root,'extension');await cp(resolve('apps/browser-extension/dist'),extension,{recursive:true});
const host='app.sensa.intake_test_'+randomUUID().replaceAll('-','');
const background=join(extension,'background.js');await writeFile(background,(await readFile(background,'utf8')).replaceAll('app.sensa.intake',host).replaceAll('http://127.0.0.1:4319','http://127.0.0.1:4323').replaceAll('http://127.0.0.1:8081','http://127.0.0.1:4323'));
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://127.0.0.1:4323/*','https://www.youtube.com/*');await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
const sample=JSON.parse(await readFile('integrations/codex/sensa-intake/request-example.json','utf8'));
const server=createServer((req,res)=>{if(req.url==='/sensa/semantic/lookups/stream'){assert.equal(req.headers.authorization,'Bearer synthetic-reading-token');res.setHeader('content-type','application/x-ndjson');res.end(JSON.stringify({type:'result',value:{status:'ready',proposal:sample.resolution.proposal}})+'\n');return;}res.setHeader('content-type','text/html');res.end('<!doctype html><title>Intake fixture</title><p>May I borrow your umbrella?</p>');});await new Promise<void>(r=>server.listen(4323,'127.0.0.1',r));
const launch=()=>chromium.launchPersistentContext(join(root,'profile'),{channel:'chromium',executablePath:process.env.SENSA_CHROMIUM_PATH,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
let context=await launch();
const manifests:string[]=[];
try {
 let worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const extensionId=new URL(worker.url()).host;
 const setup=spawnSync(binary,['--setup','--library',library,'--label','Synthetic intake library','--extension',extensionId,'--directory',join(root,'connection')],{encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);const configuration=JSON.parse(setup.stdout),config=configuration.connection;
 const registered=JSON.parse(await readFile(configuration.manifest,'utf8'));registered.name=host;
 const dirs=platform()==='darwin'?['Chromium','Google/Chrome for Testing','Google/Chrome'].map(p=>join(homedir(),'Library/Application Support',p,'NativeMessagingHosts')):[join(homedir(),'.config/chromium/NativeMessagingHosts'),join(homedir(),'.config/google-chrome/NativeMessagingHosts')];
 dirs.push(join(root,'profile','NativeMessagingHosts'));
 for(const d of dirs){await mkdir(d,{recursive:true});const p=join(d,host+'.json');await writeFile(p,JSON.stringify(registered),{flag:'wx'});manifests.push(p);}
 const cli=(body:unknown,accept=false)=>{const r=spawnSync(binary,['--config',config,...accept?['--allow-accept']:[]],{input:JSON.stringify(body),encoding:'utf8'});if(!r.stdout)throw new Error(r.stderr);return {status:r.status,...JSON.parse(r.stdout)};};
 const hello=cli({kind:'hello'}).value;assert.equal(hello.libraryId,configuration.libraryId);
 let request=localIntakeRequestSchema.parse({...JSON.parse(await readFile('integrations/codex/sensa-intake/request-example.json','utf8')),libraryId:hello.libraryId,clientId:hello.clientId,operationId:randomUUID(),acceptance:{kind:'delegated',consent:'accept_context_expression_sense',authorization:'synthetic user acceptance'}});
 assert.equal(cli({kind:'submit',request}).error,'explicit_acceptance_required');
 const accepted=localIntakeReceiptSchema.parse(cli({kind:'submit',request},true).value);assert.equal(accepted.status,'confirmed');assert.deepEqual(cli({kind:'submit',request},true).value,accepted);
 assert.deepEqual(cli({kind:'receipt',libraryId:hello.libraryId,clientId:hello.clientId,operationId:request.operationId}).value,accepted);
 assert.equal(cli({kind:'submit',request:{...request,libraryId:randomUUID()}},true).error,'connection_mismatch');
 const frame=Buffer.from(JSON.stringify({kind:'hello'})),prefix=Buffer.alloc(4);prefix.writeUInt32LE(frame.length);
 const framed=spawnSync(binary,['--config',config,'--native',`chrome-extension://${extensionId}/`],{input:Buffer.concat([prefix,frame])});assert.equal(framed.status,0,framed.stderr.toString());assert.equal(JSON.parse(framed.stdout.subarray(4).toString()).value.clientId,hello.clientId);
 const denied=spawnSync(binary,['--config',config,'--native','chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'],{input:Buffer.concat([prefix,frame])});assert.notEqual(denied.status,0);
 const nativeProbe=await worker.evaluate(async(host)=>{try{return await chrome.runtime.sendNativeMessage(host,{kind:'hello'});}catch(e){return {transportError:String(e)};}},host);assert(nativeProbe.value,JSON.stringify(nativeProbe));
 let popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html`);
 await popup.locator('#native-discover').click();await expect(popup.locator('#native-candidate')).toContainText('Synthetic intake library');await popup.locator('#native-select').click();await expect(popup.locator('#status')).toContainText('接收库：Synthetic');
 let page=await context.newPage();await page.goto('http://127.0.0.1:4323/');
 await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'toggle'}));
 await page.evaluate(()=>{const node=document.querySelector('p')!.firstChild!;const range=document.createRange();range.setStart(node,6);range.setEnd(node,12);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new PointerEvent('pointerup'));});
 let cdp=await context.newCDPSession(page);
 async function click(text:string){const tree=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});function find(n:any):any{if(n.nodeName==='BUTTON'&&!n.attributes?.includes('hidden')&&n.children?.some((c:any)=>c.nodeValue===text))return n;for(const c of [...n.children??[],...n.shadowRoots??[]]){const found=find(c);if(found)return found;}}const n=find(tree.root);assert(n,`button ${text}`);const {model}=await cdp.send('DOM.getBoxModel',{nodeId:n.nodeId});const q=model.content;await page.mouse.click((q[0]+q[2])/2,(q[1]+q[5])/2);}
 await click('保存…');await click('保存待处理');
 await expect.poll(async()=>{const r=await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'status'}));return r.value.recent.length;}).toBe(1);
 const state=await worker.evaluate(async()=>(await chrome.storage.local.get('sensaNative')).sensaNative as any);const entry=state.connections[hello.clientId].entries[0];assert.equal(entry.receipt.status,'pending');assert.equal(entry.request.snapshot.source.url,'http://127.0.0.1:4323/');assert.deepEqual(cli({kind:'receipt',libraryId:hello.libraryId,clientId:hello.clientId,operationId:entry.request.operationId}).value,entry.receipt);
 // Actual host loss keeps the queue, restored registration replays the same operation.
 for(const p of manifests)await unlink(p);
 await page.reload();await page.waitForTimeout(300);await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'toggle'}));
 // Queue/retry module is exercised with a second real toolbar capture below.
 await page.evaluate(()=>{const n=document.querySelector('p')!.firstChild!;const r=document.createRange();r.setStart(n,6);r.setEnd(n,12);getSelection()!.removeAllRanges();getSelection()!.addRange(r);document.dispatchEvent(new PointerEvent('pointerup'));});await click('保存…');await click('保存待处理');
 await expect.poll(async()=>{const r=await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'status'}));return r.value.pending;}).toBe(1);
 await context.close();context=await launch();worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 assert.equal(await worker.evaluate(async()=>Object.keys((await chrome.storage.session.get('modes')).modes??{}).length),0);
 popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html`);page=await context.newPage();await page.goto('http://127.0.0.1:4323/');cdp=await context.newCDPSession(page);
 assert.equal((await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'status'}))).value.pending,1);
 for(const p of manifests)await writeFile(p,JSON.stringify(registered),{flag:'wx'});
 await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'sync'}));
 await expect.poll(async()=>{const r=await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'status'}));return r.value.pending;}).toBe(0);
 // Model service account is independent from the already selected native destination.
 const accountId=randomUUID(),installationId=randomUUID(),replicaId=randomUUID();
 await worker.evaluate(async({accountId,installationId,replicaId})=>chrome.storage.local.set({sensa:{version:1,active:accountId,accounts:{[accountId]:{accountId,installationId,replicaId,token:'synthetic-reading-token',epoch:'1',queue:[],recent:[],savedOperations:{}}}}}),{accountId,installationId,replicaId});
 await page.reload();await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'toggle'}));
 await page.evaluate(()=>{const n=document.querySelector('p')!.firstChild!;const r=document.createRange();r.setStart(n,6);r.setEnd(n,12);getSelection()!.removeAllRanges();getSelection()!.addRange(r);document.dispatchEvent(new PointerEvent('pointerup'));});
 await click('句中解释');await expect.poll(async()=>await worker.evaluate(async()=>Object.keys((await chrome.storage.session.get('nativeLookups')).nativeLookups??{}).length)).toBe(1);await click('加入 Sensa');
 await expect.poll(async()=>{const r=await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'status'}));return r.value.recent.some((x:any)=>x.status==='confirmed');}).toBe(true);
 // A changed host connection cannot consume the old library's request, and Web selection preserves receipts.
 const wrong=cli({kind:'submit',request:{...request,clientId:randomUUID()}},true);assert.equal(wrong.error,'connection_mismatch');
 await popup.locator('#web-select').click();await expect(popup.locator('#status')).toContainText('Web 接收');
 await popup.locator('#native-discover').click();await expect(popup.locator('#native-candidate')).toContainText('Synthetic intake library');await popup.locator('#native-select').click();await expect(popup.locator('#status')).toContainText('接收库：Synthetic');
 // Real extension main-world caption extraction and timestamped local save, with no online account.
 await worker.evaluate(()=>chrome.storage.local.remove('sensa'));
 await context.route('https://www.youtube.com/**',route=>new URL(route.request().url()).pathname==='/api/timedtext'?route.fulfill({json:{events:[{tStartMs:12500,dDurationMs:3000,segs:[{utf8:'May I borrow your umbrella?'}]}]}}):route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic video</title><div id="movie_player"><video class="html5-main-video"></video></div>'}));
 await page.goto('https://www.youtube.com/watch?v=abcdefghijk');
 await page.evaluate(()=>{(document.querySelector('#movie_player') as any).getPlayerResponse=()=>({videoDetails:{videoId:'abcdefghijk'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'en',vssId:'.en',baseUrl:'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en'}]}}});Object.defineProperty(document.querySelector('video'),'currentTime',{value:13,writable:true});});
 await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'toggle'}));await page.getByRole('button',{name:'加载英文字幕',exact:true}).click();await expect(page.getByText('已加载 1 段英文字幕。选择文字即可解释与保存。',{exact:true})).toBeVisible();await page.getByRole('button',{name:'重听本句',exact:true}).click();await expect(page.getByLabel('当前原字幕',{exact:true})).toHaveText('May I borrow your umbrella?');
 const points=await page.getByLabel('当前原字幕',{exact:true}).evaluate(element=>{const node=element.firstChild!;const range=document.createRange();range.setStart(node,6);range.setEnd(node,12);const box=range.getBoundingClientRect();return {x:box.left,y:box.top+box.height/2,width:box.width};});
 await page.mouse.move(points.x,points.y);await page.mouse.down();await page.mouse.move(points.x+points.width,points.y,{steps:6});await page.mouse.up();await click('保存…');await click('保存待处理');
 await expect.poll(async()=>{const r=await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'status'}));return r.value.recent.some((x:any)=>x.snapshot.source.video?.startMs===12500);}).toBe(true);
 const agentSetup=spawnSync(binary,['--setup','--library',library,'--label','Agent only','--directory',join(root,'agent-connection')],{encoding:'utf8'});assert.equal(agentSetup.status,0,agentSetup.stderr);assert.equal(JSON.parse(agentSetup.stdout).manifest,null);
 console.log('PASS actual CLI + Native Messaging process + Chromium toolbar → Rust local library; acceptance, scoped receipt, offline queue, browser restart, retry, independent model account and fast native acceptance and account-free YouTube caption capture.');
 console.log('Synthetic fixture directory: '+root);
} finally {await context.close();server.close();for(const p of manifests)await unlink(p).catch(()=>undefined);}
