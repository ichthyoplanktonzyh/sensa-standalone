import {chromium,expect} from '@playwright/test';
import {build} from 'esbuild';
import {mkdtemp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
/** Real extension background -> HTTP -> API -> Postgres; only model completion is injected. */
export async function browserPortNativeChecks(app:Hono,account:{accountId:string;installationId:string;replicaId:string;epoch:string},checkSaved:()=>Promise<boolean>){
  const host=new Hono();host.get('/article',c=>c.html('<!doctype html><title>Sensa native integration fixture</title><main style="margin:80px;font:26px/1.8 system-ui"><h1>Read in context</h1><p>She <span id="expression">took</span> her time.</p></main>'));host.all('*',c=>app.fetch(c.req.raw));
  const server=serve({fetch:host.fetch,hostname:'127.0.0.1',port:4327});
  const dir=await mkdtemp('/tmp/sensa-browser-native-'),extension=resolve(dir,'extension');await mkdir(extension);
  await build({entryPoints:['background','content','popup','options'].map(name=>resolve('apps/browser-extension/src',name+'.ts')),bundle:true,outdir:extension,format:'iife',target:'chrome120',define:{SENSA_WEB_URL:JSON.stringify('http://127.0.0.1:3001'),SENSA_API_URL:JSON.stringify('http://127.0.0.1:4327')}});
  for(const name of ['popup.html','options.html'])await copyFile(resolve('apps/browser-extension',name),resolve(extension,name));
  const manifest=JSON.parse(await readFile('apps/browser-extension/dist/manifest.json','utf8'));manifest.host_permissions=['http://127.0.0.1:4327/*'];await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  const context=await chromium.launchPersistentContext(resolve(dir,'profile'),{executablePath:process.env.SENSA_CHROMIUM_PATH,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try{
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
    await worker.evaluate(async a=>{await chrome.storage.local.set({sensa:{version:1,active:a.accountId,accounts:{[a.accountId]:{...a,token:'fixture-first',queue:[],recent:[],savedOperations:{}}}}});},account);
    const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);await expect(settings.getByRole('status')).toHaveText('模型设置已加载。');
    await settings.getByLabel('模型标识',{exact:true}).fill('native-fixture-model');await settings.getByRole('button',{name:'保存模型设置',exact:true}).click();await expect(settings.getByRole('status')).toContainText('已保存');
    await settings.reload();await expect(settings.getByLabel('模型标识',{exact:true})).toHaveValue('native-fixture-model');await expect(settings.locator('input[type="password"]')).toHaveValue('');
    const hasSecret=await worker.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null)).includes('fixture-secret-key'));expect(hasSecret).toBe(false);
    const page=await context.newPage();await page.goto('http://127.0.0.1:4327/article');
    await worker.evaluate(async a=>{const [tab]=await chrome.tabs.query({url:'http://127.0.0.1:4327/article'});await chrome.storage.session.set({modes:{[tab.id!]:{accountId:a.accountId}}});await chrome.scripting.executeScript({target:{tabId:tab.id!},files:['content.js']});await chrome.tabs.sendMessage(tab.id!,{kind:'reading',enabled:true,accountId:a.accountId});},account);
    await page.locator('#expression').dblclick();const cdp=await context.newCDPSession(page);
    async function panel(){const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});function find(n:any):any{if(n.nodeName==='SECTION'&&n.attributes?.includes('Sensa 阅读'))return n;for(const child of [...n.children??[],...n.shadowRoots??[]]){const result=find(child);if(result)return result;}}const node=find(root);return node?(await cdp.send('DOM.resolveNode',{nodeId:node.nodeId})).object.objectId:null;}
    await expect.poll(panel).not.toBeNull();const objectId=(await panel())!;
    async function click(label:string){await cdp.send('Runtime.callFunctionOn',{objectId,functionDeclaration:'function(label){Array.from(this.querySelectorAll("button")).find(b=>b.textContent===label).click();}',arguments:[{value:label}]});}
    await click('翻译');await expect.poll(async()=>{const result=await cdp.send('Runtime.callFunctionOn',{objectId,functionDeclaration:'function(){return this.textContent;}',returnByValue:true});return result.result.value;}).toContain('这是一段阅读译文。');
    await click('保存待处理');await expect.poll(checkSaved,{timeout:15000}).toBe(true);
    await page.screenshot({path:'/tmp/sensa-browser-native-saved.png'});
    console.log('PASS: installed extension settings and reading panel -> real background sender checks -> HTTP/API -> isolated Postgres save; no secret in extension storage.');
  }finally{await context.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
