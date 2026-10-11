/** Real scope hook/screens + real OPFS; no external account, model or TTS calls. */
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {build as viteBuild} from 'vite';
import {test,expect} from '@playwright/test';
import type * as Entry from '../support/practiceScopeBrowserEntry';

declare global{interface Window{practiceScopeFixture:typeof Entry}}
let server:Server,origin:string;
test.setTimeout(45_000);
test.use({locale:'zh-CN'});
test.beforeAll(async()=>{
 const built=await viteBuild({configFile:false,worker:{format:'es'},root:process.cwd(),logLevel:'silent',base:'/',esbuild:{jsx:'automatic'},build:{write:false,minify:false,target:'es2022',rollupOptions:{preserveEntrySignatures:'strict',
  input:resolve('tests/web/support/practiceScopeBrowserEntry.tsx'),output:{entryFileNames:'core.js',chunkFileNames:'assets/[name]-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'}}}});
 if(Array.isArray(built)||!('output'in built))throw new Error('expected one scope fixture bundle');
 const files=new Map(built.output.map(file=>[file.fileName,file.type==='chunk'?file.code:file.source]));
 server=createServer((request,response)=>{
  const path=(request.url??'/').split('?')[0]!.slice(1),asset=files.get(path);
  if(asset===undefined){response.setHeader('content-type','text/html');response.end('<!doctype html><div id="root"></div><script type="module">import * as fixture from "/core.js";window.practiceScopeFixture=fixture;</script>');return;}
  response.setHeader('content-type',path.endsWith('.wasm')?'application/wasm':'text/javascript');response.end(typeof asset==='string'?asset:Buffer.from(asset));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
test.afterAll(async()=>{if(server?.listening)await new Promise<void>(done=>server.close(()=>done()));});

test('saved Expression material selection survives loading, read failure and retry without fallback',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.waitForFunction(()=>!!window.practiceScopeFixture);
 const preference=await page.evaluate(()=>window.practiceScopeFixture.prepare());
 await page.evaluate(()=>window.practiceScopeFixture.holdAndMount());
 const listening=page.locator('.sensa-practice-activities').getByRole('button');
 await expect(listening).toBeDisabled();
 expect(await page.evaluate(()=>window.practiceScopeFixture.preference())).toEqual(preference);
 expect(await page.evaluate(()=>window.practiceScopeFixture.currentExpression())).toBeNull();
 await page.evaluate(()=>window.practiceScopeFixture.releaseRead());await expect(listening).toBeEnabled();
 await page.evaluate(()=>window.practiceScopeFixture.breakExpression());
 await expect(page.getByRole('alert')).toBeVisible();await expect(listening).toBeDisabled();
 expect(await page.evaluate(()=>window.practiceScopeFixture.preference())).toEqual(preference);
 await page.getByRole('button',{name:'重试',exact:true}).click();await expect(listening).toBeDisabled();
 await page.evaluate(()=>window.practiceScopeFixture.repairExpression());await expect(listening).toBeEnabled();
 expect(await page.evaluate(()=>window.practiceScopeFixture.preference())).toEqual(preference);
 expect(await page.evaluate(()=>window.practiceScopeFixture.learningReadCount())).toBe(0);
 await page.evaluate(()=>window.practiceScopeFixture.dispose());
});

test('Expression listening is independent of formal Learning reads and Sense details',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.waitForFunction(()=>!!window.practiceScopeFixture);
 await page.evaluate(async()=>{await window.practiceScopeFixture.prepare();window.practiceScopeFixture.breakLearning();await window.practiceScopeFixture.breakSense();window.practiceScopeFixture.mount();});
 const listening=page.locator('.sensa-practice-activities').getByRole('button');
 await expect(listening).toBeEnabled();await expect(page.getByText('1 个表达',{exact:true})).toBeVisible();
 await listening.click();await expect(page.getByRole('button',{name:'选择表达 · borrow',exact:true})).toBeVisible();
 const current=await page.evaluate(()=>window.practiceScopeFixture.currentExpression());
 expect(current).toEqual({id:await page.evaluate(()=>window.practiceScopeFixture.expressionId()),source:'personal',languageTag:'en'});
 expect(await page.evaluate(()=>window.practiceScopeFixture.learningReadCount())).toBe(0);
 await page.evaluate(()=>window.practiceScopeFixture.dispose());
});

test('a target-language change cannot start the previous English material while the new read is pending',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.waitForFunction(()=>!!window.practiceScopeFixture);
 const preference=await page.evaluate(()=>window.practiceScopeFixture.prepare());await page.evaluate(()=>window.practiceScopeFixture.mount());
 const listening=page.locator('.sensa-practice-activities').getByRole('button');await expect(listening).toBeEnabled();
 await page.evaluate(()=>window.practiceScopeFixture.changeLanguageWhileHoldingRead());
 await expect.poll(()=>page.evaluate(()=>window.practiceScopeFixture.readIsHeld())).toBe(true);await expect(listening).toBeDisabled();
 expect(await page.evaluate(()=>window.practiceScopeFixture.preference())).toEqual(preference);
 expect(await page.evaluate(()=>window.practiceScopeFixture.currentExpression())).toBeNull();
 await page.evaluate(()=>window.practiceScopeFixture.releaseMaterialRead());await expect(page.getByText('当前没有可练内容',{exact:true})).toBeVisible();await expect(listening).toBeDisabled();
 expect(await page.evaluate(()=>window.practiceScopeFixture.preference())).toEqual(preference);
 await page.evaluate(()=>window.practiceScopeFixture.dispose());
});

test('a failed downloaded-content read does not block selected Personal material or switching back to it',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.waitForFunction(()=>!!window.practiceScopeFixture);
 const preference=await page.evaluate(()=>window.practiceScopeFixture.prepare());
 await page.evaluate(()=>{window.practiceScopeFixture.breakBooks();window.practiceScopeFixture.mount();});
 const listening=page.locator('.sensa-practice-activities').getByRole('button');await expect(listening).toBeEnabled();
 await page.getByRole('button',{name:/练习材料/u}).click();const chooser=page.locator('#s-practice-scope');
 await chooser.getByRole('button',{name:'已下载内容',exact:true}).click();await expect(chooser.getByRole('alert')).toBeVisible();
 await expect(chooser.locator('footer').getByRole('button')).toBeDisabled();
 await chooser.getByRole('button',{name:'我的语义世界',exact:true}).click();await expect(chooser.getByRole('alert')).toHaveCount(0);
 await expect(chooser.getByRole('button',{name:'使用 1 个表达',exact:true})).toBeEnabled();await chooser.getByRole('button',{name:'使用 1 个表达',exact:true}).click();
 await expect(listening).toBeEnabled();expect(await page.evaluate(()=>window.practiceScopeFixture.preference())).toEqual(preference);
 expect(await page.evaluate(()=>window.practiceScopeFixture.learningReadCount())).toBe(0);
 await page.evaluate(()=>window.practiceScopeFixture.dispose());
});

test('changing language during the one-expression start read retires its old-language result',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.waitForFunction(()=>!!window.practiceScopeFixture);
 await page.evaluate(async()=>{await window.practiceScopeFixture.prepare();window.practiceScopeFixture.mount();});
 const listening=page.locator('.sensa-practice-activities').getByRole('button');await expect(listening).toBeEnabled();
 await page.evaluate(()=>window.practiceScopeFixture.holdStartRead());await listening.click();
 await expect.poll(()=>page.evaluate(()=>window.practiceScopeFixture.readIsHeld())).toBe(true);
 expect(await page.evaluate(()=>window.practiceScopeFixture.capturedStartQuery())).toMatchObject({limit:1,selectedIds:[await page.evaluate(()=>window.practiceScopeFixture.expressionId())]});
 await page.evaluate(()=>window.practiceScopeFixture.changeLanguage());await expect(listening).toBeDisabled();
 await page.evaluate(()=>window.practiceScopeFixture.releaseMaterialRead());
 await expect(page.locator('#s-real-world-listening')).toHaveCount(0);
 await expect(page.getByText('当前没有可练内容',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.practiceScopeFixture.currentExpression())).toBeNull();
 await page.evaluate(()=>window.practiceScopeFixture.dispose());
});

test('cancelled start and material navigation retire held reads without adopting an expression or retaining a busy state',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await page.goto(origin);await page.waitForFunction(()=>!!window.practiceScopeFixture);
 const preference=await page.evaluate(()=>window.practiceScopeFixture.prepare());await page.evaluate(()=>window.practiceScopeFixture.mount());const activity=page.locator('.sensa-practice-activities').getByRole('button');await expect(activity).toBeEnabled();
 await page.evaluate(()=>window.practiceScopeFixture.holdStartRead());await activity.click();await expect(page.getByRole('button',{name:'取消启动',exact:true})).toBeVisible();await expect(activity).toBeDisabled();
 await page.getByRole('button',{name:'取消启动',exact:true}).click();await expect(activity).toBeEnabled();await page.evaluate(()=>window.practiceScopeFixture.releaseMaterialRead());await expect(page.locator('#s-real-world-listening')).toHaveCount(0);expect(await page.evaluate(()=>window.practiceScopeFixture.currentExpression())).toBeNull();
 await page.evaluate(()=>window.practiceScopeFixture.holdStartRead());await activity.click();await expect(page.getByRole('button',{name:'取消启动',exact:true})).toBeVisible();await page.getByRole('button',{name:'练习材料',exact:true}).click();
 const chooser=page.locator('#s-practice-scope');await expect(chooser).toBeVisible();await page.evaluate(()=>window.practiceScopeFixture.releaseMaterialRead());await expect(chooser).toBeVisible();await chooser.getByRole('button',{name:'使用 1 个表达',exact:true}).click();await expect(activity).toBeEnabled();
 expect(await page.evaluate(()=>window.practiceScopeFixture.currentExpression())).toBeNull();expect(await page.evaluate(()=>window.practiceScopeFixture.preference())).toEqual(preference);expect(await page.evaluate(()=>window.practiceScopeFixture.learningReadCount())).toBe(0);await page.evaluate(()=>window.practiceScopeFixture.dispose());
});

test('offline practice retains selectable local materials and states its actual external service requirement',async({page,context})=>{
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await page.goto(origin);await page.waitForFunction(()=>!!window.practiceScopeFixture);await page.evaluate(async()=>{await window.practiceScopeFixture.prepare();window.practiceScopeFixture.mount();});
 const activity=page.locator('.sensa-practice-activities').getByRole('button');await expect(activity).toBeEnabled();await expect(page.getByText('本模式使用 YouGlish 在线播放，无需模型服务。',{exact:true})).toBeVisible();await page.getByText('聆听说明',{exact:true}).click();await expect(page.getByText('播放器尚未检查；打开聆听后再检查。',{exact:true})).toBeVisible();
 await context.setOffline(true);try{await expect(activity).toBeDisabled();await expect(page.getByText('当前离线；已有材料仍可选择，播放需要联网。',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'练习材料',exact:true})).toBeEnabled();await page.getByRole('button',{name:'练习材料',exact:true}).click();await expect(page.locator('#s-practice-scope')).toBeVisible();}finally{await context.setOffline(false);}
 await page.getByRole('button',{name:'使用 1 个表达',exact:true}).click();await expect(activity).toBeEnabled();expect(await page.evaluate(()=>window.practiceScopeFixture.learningReadCount())).toBe(0);await page.evaluate(()=>window.practiceScopeFixture.dispose());
});
