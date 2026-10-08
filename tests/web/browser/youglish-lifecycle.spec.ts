/** Real React and provider interface, not actual online playback or full practice. */
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {build as viteBuild} from 'vite';
import {test,expect,type Page} from '@playwright/test';
import type * as Entry from '../support/youglishBrowserEntry';
declare global{interface Window{youglishFixture:typeof Entry}}
let server:Server,origin:string;
const sdk='https://youglish.com/public/emb/widget.js';
test.setTimeout(45_000);test.use({locale:'zh-CN'});
test.beforeAll(async()=>{
 const built=await viteBuild({configFile:false,root:process.cwd(),logLevel:'silent',base:'/',esbuild:{jsx:'automatic'},build:{write:false,minify:false,target:'es2022',rollupOptions:{preserveEntrySignatures:'strict',input:resolve('tests/web/support/youglishBrowserEntry.tsx'),output:{entryFileNames:'core.js',chunkFileNames:'assets/[name]-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'}}}});
 if(Array.isArray(built)||!('output'in built))throw new Error('expected one listening fixture bundle');
 const files=new Map(built.output.map(file=>[file.fileName,file.type==='chunk'?file.code:file.source]));
 server=createServer((request,response)=>{const path=(request.url??'/').split('?')[0]!.slice(1),asset=files.get(path);
  if(asset===undefined){response.setHeader('content-type','text/html');response.end('<!doctype html><div id="root"></div><script type="module">import * as fixture from "/core.js";window.youglishFixture=fixture;</script>');return;}
  response.setHeader('content-type',path.endsWith('.wasm')?'application/wasm':'text/javascript');response.end(typeof asset==='string'?asset:Buffer.from(asset));
 });server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
test.afterAll(async()=>{if(server?.listening)await new Promise<void>(done=>server.close(()=>done()));});
async function open(page:Page){
 await page.route('**/*',route=>route.request().url()===sdk?route.fulfill({contentType:'text/javascript',body:'window.youglishFixture.installApi();window.onYouglishAPIReady?.();'}):new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.waitForFunction(()=>!!window.youglishFixture);
}
test('inactive listening does not request the external SDK',async({page})=>{
 let requested=false;page.on('request',request=>{if(request.url()===sdk)requested=true;});await open(page);
 await page.evaluate(()=>window.youglishFixture.mountProbe(false));await expect(page.getByTestId('status')).toHaveText('idle');
 expect(requested).toBe(false);expect(await page.evaluate(()=>window.youglishFixture.records())).toEqual([]);
});
test('replacing a listening expression retires all old Widget callbacks and playback',async({page})=>{
 await open(page);await page.evaluate(()=>window.youglishFixture.mountProbe());await expect.poll(()=>page.evaluate(()=>window.youglishFixture.records().length)).toBe(1);
 await page.evaluate(()=>{window.youglishFixture.emit(0,'onFetchDone',{query:'alpha',lang:'english',totalResult:3});window.youglishFixture.emit(0,'onPlayerReady');window.youglishFixture.emit(0,'onCaptionChange',{caption:'alpha caption'});window.youglishFixture.emit(0,'onPlayerStateChange',{state:1});});
 await expect(page.getByTestId('status')).toHaveText('ready');await page.evaluate(()=>window.youglishFixture.setQuery('beta'));
 await expect.poll(()=>page.evaluate(()=>window.youglishFixture.records().length)).toBe(2);
 await page.evaluate(()=>{window.youglishFixture.emit(0,'onFetchDone',{query:'alpha',lang:'english',totalResult:9});window.youglishFixture.emit(0,'onCaptionChange',{caption:'late alpha'});window.youglishFixture.emit(0,'onPlayerStateChange',{state:1});window.youglishFixture.emit(0,'onSpeedChange',{speed:1.25});window.youglishFixture.emit(0,'onError');});
 await expect(page.getByTestId('status')).toHaveText('loading');await expect(page.getByTestId('caption')).toHaveText('');await expect(page.getByTestId('playing')).toHaveText('false');
 expect((await page.evaluate(()=>window.youglishFixture.records()))[0]!.calls.some(call=>call.kind==='close')).toBe(true);
 await page.evaluate(()=>{window.youglishFixture.emit(1,'onFetchDone',{query:'beta',lang:'english',totalResult:2});window.youglishFixture.emit(1,'onPlayerReady');window.youglishFixture.emit(1,'onCaptionChange',{caption:'beta caption'});});
 await expect(page.getByTestId('status')).toHaveText('ready');await expect(page.getByTestId('caption')).toHaveText('beta caption');
});
test('result count alone is not player readiness and speed follows the actual provider event',async({page})=>{
 await open(page);await page.evaluate(()=>window.youglishFixture.mountProbe());await expect.poll(()=>page.evaluate(()=>window.youglishFixture.records().length)).toBe(1);
 await page.evaluate(()=>window.youglishFixture.emit(0,'onFetchDone',{query:'alpha',lang:'english',totalResult:3}));await expect(page.getByTestId('status')).toHaveText('loading');
 await page.evaluate(()=>window.youglishFixture.emit(0,'onPlayerReady'));await expect(page.getByTestId('status')).toHaveText('ready');await expect(page.getByTestId('speed')).toHaveText('1');
 await page.getByRole('button',{name:'Request speed'}).click();await expect(page.getByTestId('speed')).toHaveText('1');
 await page.evaluate(()=>window.youglishFixture.emit(0,'onSpeedChange',{speed:1.25}));await expect(page.getByTestId('speed')).toHaveText('1.25');
});
test('listening uses the selected expression language rather than the global default Route',async({page})=>{
 await open(page);await page.evaluate(()=>window.youglishFixture.mountSpanish());
 await expect.poll(()=>page.evaluate(()=>window.youglishFixture.records().flatMap(widget=>widget.calls).find(call=>call.kind==='fetch')?.args)).toEqual(['banco','spanish',undefined]);
});
test('legacy caption transport is readable and empty or failed playback cannot revive from late events',async({page})=>{
 await open(page);await page.evaluate(()=>window.youglishFixture.mountProbe());await expect.poll(()=>page.evaluate(()=>window.youglishFixture.records().length)).toBe(1);
 await page.evaluate(()=>{window.youglishFixture.emit(0,'onFetchDone',{totalResult:3});window.youglishFixture.emit(0,'onPlayerReady');window.youglishFixture.emit(0,'onCaptionChange',{caption:'Espa%F1a%20%5B%5B%5BBorrow%5D%5D%5D'});});
 await expect(page.getByTestId('caption')).toHaveText('España [[[Borrow]]]');
 await page.evaluate(()=>window.youglishFixture.setQuery('empty'));await expect.poll(()=>page.evaluate(()=>window.youglishFixture.records().length)).toBe(2);
 await page.evaluate(()=>{window.youglishFixture.emit(1,'onFetchDone',{totalResult:0});window.youglishFixture.emit(1,'onPlayerReady');window.youglishFixture.emit(1,'onPlayerStateChange',{state:1});});
 await expect(page.getByTestId('status')).toHaveText('empty');await expect(page.getByTestId('playing')).toHaveText('false');
 await page.evaluate(()=>window.youglishFixture.setQuery('failed'));await expect.poll(()=>page.evaluate(()=>window.youglishFixture.records().length)).toBe(3);
 await page.evaluate(()=>{window.youglishFixture.emit(2,'onError');window.youglishFixture.emit(2,'onFetchDone',{totalResult:4});window.youglishFixture.emit(2,'onPlayerReady');});
 await expect(page.getByTestId('status')).toHaveText('error');expect((await page.evaluate(()=>window.youglishFixture.records()))[2]!.calls.some(call=>call.kind==='close')).toBe(true);
});
