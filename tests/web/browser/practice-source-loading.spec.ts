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
 const built=await viteBuild({configFile:false,root:process.cwd(),logLevel:'silent',base:'/',esbuild:{jsx:'automatic'},build:{write:false,minify:false,target:'es2022',rollupOptions:{preserveEntrySignatures:'strict',
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

test('a saved Personal scope cannot start from a loading or unavailable Current Study fallback',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.waitForFunction(()=>!!window.practiceScopeFixture);
 const preference=await page.evaluate(()=>window.practiceScopeFixture.prepare());
 await page.evaluate(()=>window.practiceScopeFixture.holdAndMount());
 const availability=page.getByTestId('scope-availability');
 await expect(availability).toHaveText('loading');
 const listening=page.locator('.sensa-practice-activities').getByRole('button').first();
 await expect(listening).toBeDisabled();await expect(page.getByText('study-only',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.practiceScopeFixture.preference())).toEqual(preference);
 expect(await page.evaluate(()=>window.practiceScopeFixture.snapshot())).toBeNull();
 await page.evaluate(()=>window.practiceScopeFixture.releaseRead());
 await expect(availability).toHaveText('ready');await expect(listening).toBeEnabled();
 await listening.click();const session=await page.evaluate(()=>window.practiceScopeFixture.snapshot());
 expect(session?.sourceId).toBe(preference.sourceId);expect(session?.targets.map(target=>target.expression.surfaceForm)).toEqual(['borrow']);
 await page.evaluate(()=>window.practiceScopeFixture.breakVersion());
 await expect(availability).toHaveText('unavailable');await expect(listening).toBeDisabled();
 await expect(page.getByRole('alert')).toBeVisible();
 expect(await page.evaluate(()=>window.practiceScopeFixture.preference())).toEqual(preference);
 expect(await page.evaluate(()=>window.practiceScopeFixture.snapshot())).toEqual(session);
 // Retry while still broken must stay unavailable, not launch the fallback.
 await page.getByRole('button',{name:'重试',exact:true}).click();
 await expect(availability).toHaveText('unavailable');await expect(listening).toBeDisabled();
 await page.evaluate(()=>window.practiceScopeFixture.repairVersion());
 // A real storage notification may recover before a manual retry is needed.
 await expect(availability).toHaveText('ready');await expect(listening).toBeEnabled();
 expect(await page.evaluate(()=>window.practiceScopeFixture.preference())).toEqual(preference);
 await page.evaluate(()=>window.practiceScopeFixture.dispose());
});

test('initial Learning workspace failure exposes retry and cannot leave Personal practice permanently loading',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.waitForFunction(()=>!!window.practiceScopeFixture);
 const preference=await page.evaluate(()=>window.practiceScopeFixture.prepare());
 await page.evaluate(()=>window.practiceScopeFixture.breakLearningAndMount());
 const availability=page.getByTestId('scope-availability'),listening=page.locator('.sensa-practice-activities').getByRole('button').first();
 await expect(availability).toHaveText('unavailable');await expect(listening).toBeDisabled();
 await expect(page.getByRole('alert')).toBeVisible();
 expect(await page.evaluate(()=>window.practiceScopeFixture.preference())).toEqual(preference);
 expect(await page.evaluate(()=>window.practiceScopeFixture.snapshot())).toBeNull();
 await page.evaluate(()=>window.practiceScopeFixture.repairLearning());
 await page.getByRole('button',{name:'重试',exact:true}).click();
 await expect(availability).toHaveText('ready');await expect(listening).toBeEnabled();
 await listening.click();expect((await page.evaluate(()=>window.practiceScopeFixture.snapshot()))?.sourceId).toBe(preference.sourceId);
 expect(await page.evaluate(()=>window.practiceScopeFixture.preference())).toEqual(preference);
 await page.evaluate(()=>window.practiceScopeFixture.dispose());
});

test('a Route revision is not ready with the preceding workspace even before reload effects finish',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.waitForFunction(()=>!!window.practiceScopeFixture);
 const preference=await page.evaluate(()=>window.practiceScopeFixture.prepare());
 await page.evaluate(()=>window.practiceScopeFixture.mountLearning());
 const availability=page.getByTestId('scope-availability'),listening=page.locator('.sensa-practice-activities').getByRole('button').first();
 await expect(availability).toHaveText('ready');await expect(listening).toBeEnabled();
 const route=await page.evaluate(()=>window.practiceScopeFixture.changeRouteWhileHoldingRead());
 await expect.poll(()=>page.evaluate(()=>window.practiceScopeFixture.readIsHeld())).toBe(true);
 console.log('Route transition read failure diagnostics:',JSON.stringify(await page.evaluate(()=>window.practiceScopeFixture.observedLearningFailures())));
 await expect(availability).toHaveText('loading').catch(async error=>{
  console.log('Failed route load diagnostics:',JSON.stringify(await page.evaluate(()=>window.practiceScopeFixture.observedLearningFailures())));throw error;
 });await expect(listening).toBeDisabled();
 const frames=await page.evaluate(()=>window.practiceScopeFixture.observedRouteFrames());
 console.log('Route-bound scope readiness frames:',JSON.stringify(frames));
 console.log('Route-bound learning diagnostics:',JSON.stringify(await page.evaluate(()=>window.practiceScopeFixture.observedLearningFailures())));
 expect(frames.filter(frame=>frame.revision===route.revision)).not.toHaveLength(0);
 expect(frames.filter(frame=>frame.revision===route.revision).every(frame=>frame.status==='loading')).toBe(true);
 expect(await page.evaluate(()=>window.practiceScopeFixture.snapshot())).toBeNull();
 expect(await page.evaluate(()=>window.practiceScopeFixture.preference())).toEqual(preference);
 await page.evaluate(()=>window.practiceScopeFixture.releaseWorkspaceRead());
 await expect(availability).toHaveText('ready');await expect(listening).toBeEnabled();
 await page.evaluate(()=>window.practiceScopeFixture.dispose());
});
