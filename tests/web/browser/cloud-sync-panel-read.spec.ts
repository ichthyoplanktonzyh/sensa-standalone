/** Real React UI, controlled reads; no account or cloud requests. */
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {build as viteBuild} from 'vite';
import {test,expect} from '@playwright/test';
import type * as Entry from '../support/cloudSyncPanelBrowserEntry';
declare global{interface Window{syncPanelFixture:typeof Entry}}
let server:Server,origin:string;
test.beforeAll(async()=>{
 const entry=resolve('tests/web/support/cloudSyncPanelBrowserEntry.tsx');
 const built=await viteBuild({configFile:false,worker:{format:'es'},root:process.cwd(),logLevel:'silent',base:'/',define:{__SENSA_RELEASE__:JSON.stringify('isolated-sync-panel-fixture')},esbuild:{jsx:'automatic'},plugins:[{name:'controlled-sync-panel-ports',enforce:'pre',resolveId(source,importer){if(importer?.endsWith('/CloudSyncPanel.tsx')&&(source==='./cloudSyncPanelRead'||source==='../../data/library/cloudSyncService'))return entry;}}],build:{write:false,minify:false,target:'es2022',rollupOptions:{preserveEntrySignatures:'strict',input:entry,output:{entryFileNames:'core.js',chunkFileNames:'assets/[name]-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'}}}});
 if(Array.isArray(built)||!('output'in built))throw Error('expected one bundle');const files=new Map(built.output.map(file=>[file.fileName,file.type==='chunk'?file.code:file.source]));
 server=createServer((req,res)=>{const path=(req.url??'/').split('?')[0]!.slice(1),asset=files.get(path);if(asset===undefined){res.setHeader('content-type','text/html');res.end('<!doctype html><div id="root"></div><script type="module">import * as fixture from "/core.js";window.syncPanelFixture=fixture;await fixture.mount();</script>');return;}res.setHeader('content-type',path.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(typeof asset==='string'?asset:Buffer.from(asset));});
 server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
test.afterAll(async()=>{if(server?.listening)await new Promise<void>(done=>server.close(()=>done()));});
test('sync panel removes old success and storage on read failure and read retry never invokes synchronization',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await page.goto(origin);
 await expect(page.locator('time')).toHaveAttribute('datetime','2026-10-10T12:00:00Z');await expect(page.getByText(/1 MiB/)).toBeVisible();
 await page.evaluate(()=>window.syncPanelFixture.fail());await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('time')).toHaveCount(0);await expect(page.getByText(/1 MiB/)).toHaveCount(0);await expect(page.getByRole('button',{name:'立即同步',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(()=>window.syncPanelFixture.commands())).toBe(0);
 await page.evaluate(()=>window.syncPanelFixture.repair());await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.locator('time')).toHaveAttribute('datetime','2026-10-10T12:00:00Z');await expect(page.getByRole('alert')).toHaveCount(0);expect(await page.evaluate(()=>window.syncPanelFixture.commands())).toBe(0);
});
for(const status of ['conflict','failed'] as const)test(`permanent ${status} without a comparison offers recovery without an imaginary choice`,async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await page.goto(origin);
 await page.evaluate(status=>window.syncPanelFixture.block(status),status);
 await expect(page.getByText('同步需要检查后才能继续。本地资料仍在。请先备份并下载诊断，再联系支持。',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'保留本机版本',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'使用云端版本',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'备份本机资料',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'下载诊断文件',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'备份本机资料',exact:true}).click();
 await expect(page.getByText('备份只保存本机资料，不会解决同步问题，也不包含尚未下载的云端更改。',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'选择备份文件',exact:true})).toHaveCount(0);
 await page.getByLabel('备份密码',{exact:true}).fill('sync-recovery-backup-password');
 await page.evaluate(()=>window.syncPanelFixture.fail());await expect(page.getByRole('alert')).toBeVisible();
 await expect(page.getByLabel('备份密码',{exact:true})).toHaveValue('sync-recovery-backup-password');
 await page.evaluate(()=>window.syncPanelFixture.repair());await page.getByRole('button',{name:'重试',exact:true}).click();
 await expect(page.getByLabel('备份密码',{exact:true})).toHaveValue('sync-recovery-backup-password');
 const backupDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出加密备份',exact:true}).click();
 const backup=await backupDownload;expect(backup.suggestedFilename()).toMatch(/\.sensa-backup$/u);const backupBytes=await readFile((await backup.path())!);
 expect((await page.evaluate(bytes=>window.syncPanelFixture.inspectExport(bytes),[...backupBytes])).events).toBe(0);
 await expect(page.getByRole('status').filter({hasText:'备份已生成，请确认下载文件已保存。'})).toBeVisible();
 await expect(page.getByText('备份只保存本机资料，不会解决同步问题，也不包含尚未下载的云端更改。',{exact:true})).toBeVisible();
 const diagnosticsDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载诊断文件',exact:true}).click();
 const diagnostics=await diagnosticsDownload;expect(diagnostics.suggestedFilename()).toMatch(/^sensa-diagnostics-.*\.json$/u);expect(JSON.parse(await readFile((await diagnostics.path())!,'utf8')).release).toBe('isolated-sync-panel-fixture');
 await expect(page.getByText('诊断文件已下载。',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.syncPanelFixture.commands())).toBe(0);
});
