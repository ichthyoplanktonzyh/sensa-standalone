/** Portable sharing through shipped UI and real OPFS; read-only bridges verify facts. */
import assert from 'node:assert/strict';
import {createHash,randomFillSync} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {mkdir,mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {extname,join,resolve} from 'node:path';
import {expect,test,type Page,type Locator} from '@playwright/test';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {stableUuid} from '@sensa/learning-kernel';
import {createSensaPortableLightweightPackage,readSensaPortableLightweightPackage} from '@sensa/content-validator/portable-lightweight';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';

let server:Server,origin:string,output:string;
const first=portablePackageFixture({title:'借物与归还'});
const nextScene='向邻居借一把梯子，用完后归还。';
const declaration=first.package.semanticDeclaration!;
const next=portablePackageFixture({title:'借物与归还 · 新版',version:2,scene:nextScene,semanticDeclaration:{
 ...declaration,
 sense:{...declaration.sense,senseVersionId:stableUuid('sensa:test-portable-sense-version:borrow:v2'),versionNumber:2,semanticSpec:{...declaration.sense.semanticSpec,prototypeScenes:[{...declaration.sense.semanticSpec.prototypeScenes[0]!,summary:nextScene}]}},
 binding:{...declaration.binding,bindingVersionId:stableUuid('sensa:test-portable-binding-version:borrow:v2'),versionNumber:2},
}});
const conflict=portablePackageFixture({title:'同版本冲突',meaning:'试图用不同的内容替换原版本。'});
const otherRoute=portablePackageFixture({title:'西班牙语分享包',packageId:'08d199f5-e798-48a5-a036-90bc5c4b1c67',targetLanguage:'es',expression:'prestar'});
const snapshot={format:'sensa-learning-content-registry-v3',publishedAt:'2026-10-01T00:00:00Z',items:[]};
const registry={...snapshot,revision:createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex')};
const types:Record<string,string>={'.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
test.setTimeout(60_000);
test.use({locale:'zh-CN',viewport:{width:1280,height:900}});

test.beforeAll(async()=>{
 test.setTimeout(180_000);
 await mkdir('.tmp',{recursive:true});
 output=await mkdtemp(resolve('.tmp/portable-package-journey-'));
 const dist=join(output,'dist');
 server=createServer(async(req,res)=>{
  const url=new URL(req.url??'/',origin||'http://127.0.0.1');
  if(url.pathname==='/sensa/packages'){
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(registry));return;
  }
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/sensa/')||url.pathname.startsWith('/auth/')){
   res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({code:'authentication_required'}));return;
  }
  const path=resolve(dist,`.${url.pathname}`);
  if(!path.startsWith(`${dist}/`)&&path!==dist){res.writeHead(404);res.end();return;}
  try{
   const extension=extname(path);
   const file=extension?path:join(dist,'index.html');
   res.writeHead(200,{'content-type':types[extension]??'text/html','cache-control':'no-store'});
   res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 execFileSync('npm',['run','build','-w','@sensa/web','--','--outDir',dist,'--emptyOutDir'],{
  env:{...process.env,VITE_SENSA_MODE:'production',VITE_SENSA_BROWSER_SMOKE:'true',VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-public-key',VITE_SENSA_API_URL:origin},
  stdio:'pipe',
 });
});
test.afterAll(async()=>{
 if(server?.listening)await new Promise<void>(done=>server.close(()=>done()));
 if(output)await rm(output,{recursive:true,force:true});
});

async function enterLibrary(page:Page){
 await page.addInitScript(()=>{(window as unknown as {__name:(value:unknown)=>unknown}).__name=value=>value;});
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);
 await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.locator('#s-home').getByRole('heading',{name:'还没有加入学习内容',exact:true})).toBeVisible();
 await page.locator('#s-home').getByRole('button',{name:'学习包目录',exact:true}).click();
 await page.locator('#s-catalog').last().getByRole('button',{name:'我的学习包',exact:true}).click();
 await expect(page.locator('#s-library').last().getByRole('heading',{name:'我的学习包',exact:true})).toBeVisible();
}
async function preview(page:Page,bytes:Uint8Array=first.bytes){
 await page.locator('#s-library').last().getByLabel('导入学习包',{exact:true}).setInputFiles({name:'shared.sensa',mimeType:'application/zip',buffer:Buffer.from(bytes)});
}
const facts=(page:Page)=>page.evaluate(async()=>({supply:await window.__sensaBrowserSmoke!.supplyCheckpoint(),learning:await window.__sensaBrowserSmoke!.learningCheckpoint()}));
const detail=(page:Page)=>page.locator('#s-library-package').last();
async function publication(scope:Locator,timeout=5_000){
 const disclosure=scope.locator('details.sensa-package-disclosure');
 await expect(disclosure).toBeVisible({timeout});if(await disclosure.getAttribute('open')===null)await disclosure.locator('summary').click();
}
async function install(page:Page,bytes:Uint8Array=first.bytes){
 await preview(page,bytes);
 await page.locator('#s-library').last().getByRole('button',{name:'确认安装',exact:true}).click();
 await publication(detail(page));
 await expect(detail(page).getByRole('button',{name:'导出 .sensa',exact:true})).toBeEnabled();
}
async function exportBytes(page:Page,scope:Locator=detail(page)){
 if(await scope.locator('details.sensa-package-disclosure').count())await publication(scope);
 const download=page.waitForEvent('download');
 await scope.getByRole('button',{name:'导出 .sensa',exact:true}).click();
 const file=await download;
 expect(file.suggestedFilename()).toMatch(/\.sensa$/u);
 return readFile((await file.path())!);
}

test('a guest previews without writes, confirms installation, and shares an exact package without learner facts',async({page,browser})=>{
 await enterLibrary(page);
 const before=await facts(page);
 await preview(page);
 const panel=page.locator('#s-library').last();
 await expect(panel.getByRole('heading',{name:'借物与归还',exact:true})).toBeVisible();
 await expect(panel.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await expect(panel.getByText(first.package.sense.meaning,{exact:true})).toBeVisible();
 await expect(panel.getByText(first.package.metadata.author.name,{exact:true})).toBeVisible();
  await expect(panel.getByText('CC0',{exact:true})).toBeVisible();
 await expect(panel.getByText('作者',{exact:true})).toBeVisible();
 await expect(panel.getByText('许可',{exact:true})).toBeVisible();
 await expect(panel.getByText(/localFlow\./)).toHaveCount(0);
 await expect(panel.getByText('英语 / 中文（中国） · v1',{exact:true})).toBeVisible();
 expect(await facts(page)).toEqual(before);
 await panel.getByRole('button',{name:'取消',exact:true}).click();
 expect(await facts(page)).toEqual(before);
 await install(page);
 const installed=await facts(page);
 expect(installed.supply).toHaveLength(1);
 expect(installed.learning.targetIds).toEqual([]);
 await detail(page).getByRole('button',{name:'加入学习',exact:true}).click();
 await expect(detail(page).getByRole('button',{name:'去学习',exact:true})).toBeEnabled();
 expect((await facts(page)).learning.targetIds).toHaveLength(1);
 const bytes=await exportBytes(page);
 assert.deepEqual(bytes,Buffer.from(first.bytes),'export remains the exact admitted public content after learner enrollment');
 readSensaPortableLightweightPackage(bytes);
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
 await page.locator('#s-study').locator('[data-learning-target]').filter({has:page.getByText('borrow',{exact:true})}).click();
 assert.deepEqual(await exportBytes(page,page.locator('#s-learning-target')),bytes,'the learning-target export action must remain reachable and export the same admitted snapshot');
 const receiver=await browser.newContext({locale:'zh-CN'});
 try{
  const second=await receiver.newPage();
  await enterLibrary(second);await install(second,bytes);
  const received=await facts(second);
  expect(received.supply).toHaveLength(1);
  expect(received.learning.targetIds).toEqual([]);
  expect(received.learning.records).toEqual([]);
  await second.reload();
  await expect(detail(second).getByRole('heading',{name:'借物与归还',exact:true})).toBeVisible();
  await second.goBack();
  await expect(second.locator('#s-library').last().getByRole('button',{name:/借物与归还/})).toBeVisible();
  await second.goForward();
  await expect(detail(second).getByRole('heading',{name:'借物与归还',exact:true})).toBeVisible();
  expect(await facts(second)).toEqual(received);
 }finally{await receiver.close();}
});

test('reimport is idempotent and corrupt or identity-conflicting input cannot replace installed content',async({page})=>{
 await enterLibrary(page);await install(page);
 const saved=await facts(page);
 await detail(page).getByRole('button',{name:'返回',exact:true}).click();
 await preview(page);
 await expect(page.getByText('已安装此版本',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'确认安装',exact:true}).click();
 await expect(detail(page).getByRole('button',{name:'导出 .sensa',exact:true})).toBeEnabled();
 expect(await facts(page)).toEqual(saved);
 await detail(page).getByRole('button',{name:'返回',exact:true}).click();
 await preview(page,conflict.bytes);
 await expect(page.locator('#s-library').last().getByRole('alert')).toBeVisible();
 await expect(page.getByRole('button',{name:'确认安装',exact:true})).toBeDisabled();
 expect(await facts(page)).toEqual(saved);
 await page.getByRole('button',{name:'取消',exact:true}).click();
 await preview(page,new TextEncoder().encode('corrupt archive'));
 await expect(page.locator('#s-library').last().getByRole('status')).toContainText('学习资源');
 expect(await facts(page)).toEqual(saved);
 await page.reload();
 await expect(page.locator('#s-library').last().getByRole('button',{name:/借物与归还/})).toBeVisible();
 expect(await facts(page)).toEqual(saved);
});

test('a mismatched route can be saved and exported but cannot be enrolled',async({page})=>{
 await enterLibrary(page);await install(page,otherRoute.bytes);
 await expect(detail(page).getByRole('button',{name:'加入学习',exact:true})).toBeDisabled();
 await expect(detail(page).getByRole('status')).toContainText('语言');
 expect((await facts(page)).learning.targetIds).toEqual([]);
 assert.deepEqual(await exportBytes(page),Buffer.from(otherRoute.bytes));
});

test('a newer independent package stays pending until explicit application and older imports never downgrade it',async({page})=>{
 await enterLibrary(page);await install(page);
 await detail(page).getByRole('button',{name:'加入学习',exact:true}).click();
 await expect(detail(page).getByRole('button',{name:'去学习',exact:true})).toBeEnabled();
 const enrolled=await facts(page);
 await detail(page).getByRole('button',{name:'返回',exact:true}).click();
 await install(page,next.bytes);
 await expect(detail(page).getByRole('button',{name:'应用更新',exact:true})).toBeEnabled();
 expect((await facts(page)).learning).toEqual(enrolled.learning);
 await detail(page).getByRole('button',{name:'应用更新',exact:true}).click();
 await expect(detail(page).getByRole('button',{name:'去学习',exact:true})).toBeEnabled();
 expect((await facts(page)).learning.targetIds).toEqual(enrolled.learning.targetIds);
 await detail(page).getByRole('button',{name:'返回',exact:true}).click();
 await expect(page.locator('#s-library').last().getByRole('listitem')).toHaveCount(1);
 const applied=await facts(page);
 await install(page,first.bytes);
 await expect(detail(page).getByRole('heading',{name:'借物与归还 · 新版',exact:true})).toBeVisible();
 expect(await facts(page)).toEqual(applied);
 assert.deepEqual(await exportBytes(page),Buffer.from(next.bytes));
});

test('oversized files are rejected before parsing and a media-bearing preview remains usable at 320px',async({page})=>{
 await enterLibrary(page);
 const before=await facts(page);
 const oversized=join(output,'oversized.sensa');
 const file=await open(oversized,'w');
 try{await file.truncate(64*1024*1024+1);}finally{await file.close();}
 const admissionWorkers:string[]=[];
 const observeWorker=(worker:import('@playwright/test').Worker)=>{if(worker.url().includes('portablePreparationWorker'))admissionWorkers.push(worker.url());};
 page.on('worker',observeWorker);
 await page.locator('#s-library').last().getByLabel('导入学习包',{exact:true}).setInputFiles(oversized);
 await expect(page.locator('#s-library').last().getByText('学习包超过当前大小限制。',{exact:true})).toBeVisible();
 expect(await facts(page)).toEqual(before);
 expect(admissionWorkers).toEqual([]);
 page.off('worker',observeWorker);
 await page.setViewportSize({width:320,height:740});
 const media=portablePackageFixture({title:'带音频的分享包',audioByteLength:1024*1024});
 const started=performance.now();
 await preview(page,media.bytes);
 const panel=page.locator('#s-library').last();
 await expect(panel.getByRole('button',{name:'确认安装',exact:true})).toBeEnabled();
 const previewMs=Math.round(performance.now()-started);
 await expect(panel.getByText('作者',{exact:true})).toBeVisible();
 await expect(panel.getByText('许可',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await facts(page)).toEqual(before);
 await panel.getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.locator('#s-library').last().getByRole('button',{name:'导入学习包',exact:true})).toBeEnabled();
 await test.info().attach('portable-preview-measurement.json',{body:JSON.stringify({archiveBytes:media.bytes.byteLength,mediaBytes:1024*1024,viewport:{width:320,height:740},previewMs,scope:'One loopback Chromium sample including file upload and visible confirmation; not a real-device INP or latency acceptance claim.'}),contentType:'application/json'});
});

test('a personal-style package without publication authority survives repeated reloads with no enrollment',async({page})=>{
 const manifest=structuredClone(first.package);
 delete manifest.semanticDeclaration;
 manifest.metadata.author={name:'Sensa learner'};
 manifest.metadata.license={name:'Private personal use'};
 const archive=readSensaPortableLightweightPackage(first.bytes);
 const bytes=createSensaPortableLightweightPackage(manifest,archive.mediaById);
 await enterLibrary(page);
 const before=await facts(page);
 await install(page,bytes);
 const installed=await facts(page);
 expect(installed.learning).toEqual(before.learning);
 for(let count=0;count<5;count++)await page.reload({waitUntil:'domcontentloaded'});
 await expect(detail(page).getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();
 expect(await facts(page)).toEqual(installed);
 assert.deepEqual(await exportBytes(page),Buffer.from(bytes));
});

test('large media preview and admission execute in owned workers without detaching the confirmation archive',async({page})=>{
 await enterLibrary(page);
 const base=portablePackageFixture({title:'20 MiB 媒体包'});
 const audio=randomFillSync(new Uint8Array(20*1024*1024));
 const manifest={...base.package,media:base.package.media.map(item=>({...item,sizeBytes:audio.byteLength,sha256:createHash('sha256').update(audio).digest('hex')}))};
 const bytes=createSensaPortableLightweightPackage(manifest,new Map([[manifest.media[0]!.mediaId,audio]]));
 const before=await facts(page);
 const previewWorker=page.waitForEvent('worker',{predicate:worker=>worker.url().includes('portablePreparationWorker')});
 const started=performance.now();
 await preview(page,bytes);
 await previewWorker;
 const panel=page.locator('#s-library').last();
 await expect(panel.getByRole('heading',{name:'20 MiB 媒体包',exact:true})).toBeVisible({timeout:30_000});
 const previewMs=Math.round(performance.now()-started);
 expect(await facts(page)).toEqual(before);
 const installWorker=page.waitForEvent('worker',{predicate:worker=>worker.url().includes('portablePreparationWorker')});
 await panel.getByRole('button',{name:'确认安装',exact:true}).click();
 await installWorker;
 await publication(detail(page),30_000);
 await expect(detail(page).getByRole('button',{name:'导出 .sensa',exact:true})).toBeEnabled({timeout:30_000});
 const after=await facts(page);
 expect(after.learning).toEqual(before.learning);
 await test.info().attach('large-portable-admission.json',{body:JSON.stringify({archiveBytes:bytes.byteLength,mediaBytes:audio.byteLength,previewMs,scope:'Worker execution and intact preview-to-install bytes are asserted; wall-clock sample is diagnostic, not a cross-device latency guarantee.'}),contentType:'application/json'});
});

test('unrecoverable local content requests the original file and reimport restores resources without duplicating learning',async({page})=>{
 await enterLibrary(page);await install(page);
 await detail(page).getByRole('button',{name:'加入学习',exact:true}).click();
 await expect(detail(page).getByRole('button',{name:'去学习',exact:true})).toBeEnabled();
 const original=await facts(page);
 await detail(page).getByRole('button',{name:'返回',exact:true}).click();
 // Explicit synthetic failure setup, not a user command or a successful-restore shortcut.
 await page.evaluate(()=>window.__sensaBrowserSmoke!.discardPackageCacheForRecoveryTest());
 await page.reload();
 const panel=page.locator('#s-library').last();
 await expect(panel.getByText('有 1 个学习包缺少本机文件。请重新导入原文件，或从目录重新下载。',{exact:true})).toBeVisible();
 expect((await facts(page)).supply).toEqual([]);
 expect((await facts(page)).learning.targetIds).toEqual(original.learning.targetIds);
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'今日',exact:true}).click();
 await expect(page.locator('#s-home').getByRole('button',{name:'开始学习',exact:true})).toHaveCount(0);
 await page.goBack();
 await expect(panel.getByText(/缺少本机文件/)).toBeVisible();
 await install(page);
 expect(await facts(page)).toEqual(original);
 await detail(page).getByRole('button',{name:'返回',exact:true}).click();
 await expect(panel.getByText(/缺少本机文件/)).toHaveCount(0);
 await page.reload();
 await expect(panel.getByRole('button',{name:/借物与归还/})).toBeVisible();
 expect(await facts(page)).toEqual(original);
 await panel.getByRole('button',{name:/借物与归还/}).click();
 await detail(page).getByRole('button',{name:'去学习',exact:true}).click();
 await expect(page.locator('#s-home').getByRole('button',{name:'开始学习',exact:true})).toBeEnabled();
});
