/** Interactive local-only fixture. Operate the actual toolbar with native UI automation or by hand. */
import {chromium} from '@playwright/test';
import {mkdtemp,cp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
const directory=await mkdtemp(join(tmpdir(),'sensa-native-extension-')),extension=join(directory,'extension');await cp(resolve('apps/browser-extension/dist'),extension,{recursive:true});await writeFile(join(extension,'permission-probe.js'),'void 0;');
const context=await chromium.launchPersistentContext(join(directory,'profile'),{channel:'chromium',executablePath:process.env.SENSA_CHROMIUM_PATH,headless:false,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1100,height:750}});
const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
const server=createServer(async(req,res)=>{
 if(req.url==='/__audit'){
  const audit=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({active:true,currentWindow:true}),tab=tabs[0];if(!tab?.id)return {active:false};let allowed=false,error:string|null=null;try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:['permission-probe.js']});allowed=true;}catch(e){error=e instanceof Error?e.message:String(e);}const modes=(await chrome.storage.session.get('modes')).modes??{};return {url:tab.url??null,windowId:tab.windowId,error,injectionAllowed:allowed,readingIntent:Boolean(modes[tab.id]),badge:await chrome.action.getBadgeText({tabId:tab.id}),storeVersion:((await chrome.storage.local.get('sensa')).sensa as any)?.version??null};});res.setHeader('content-type','application/json');res.end(JSON.stringify(audit));return;
 }
 res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><title>Sensa native permission fixture</title><main style="margin:70px;font:24px/2 system-ui"><h1>原生权限测试页</h1><p>She took her time.</p><a href="/next">同源下一页</a><br><a href="http://localhost:4322/other">切换到另一来源</a></main>');
});await new Promise<void>(r=>server.listen(4322,'127.0.0.1',r));
const page=await context.newPage();await page.goto('http://127.0.0.1:4322/');
console.log('Native fixture ready on 127.0.0.1:4322. Unmodified extension manifest. Read-only audit: /__audit.');
const close=async()=>{server.close();await context.close();process.exit(0);};process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
