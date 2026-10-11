/** Real React UI, controlled reads; no account or cloud requests. */
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {build as viteBuild} from 'vite';
import {test,expect} from '@playwright/test';
import type * as Entry from '../support/cloudSyncPanelBrowserEntry';
declare global{interface Window{syncPanelFixture:typeof Entry}}
let server:Server,origin:string;
test.beforeAll(async()=>{
 const entry=resolve('tests/web/support/cloudSyncPanelBrowserEntry.tsx');
 const built=await viteBuild({configFile:false,worker:{format:'es'},root:process.cwd(),logLevel:'silent',base:'/',esbuild:{jsx:'automatic'},plugins:[{name:'controlled-sync-panel-ports',enforce:'pre',resolveId(source,importer){if(importer?.endsWith('/CloudSyncPanel.tsx')&&(source==='./cloudSyncPanelRead'||source==='../../data/library/cloudSyncService'))return entry;}}],build:{write:false,minify:false,target:'es2022',rollupOptions:{preserveEntrySignatures:'strict',input:entry,output:{entryFileNames:'core.js',chunkFileNames:'assets/[name]-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'}}}});
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
