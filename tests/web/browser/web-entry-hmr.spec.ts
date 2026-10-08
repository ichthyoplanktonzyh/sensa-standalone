/** Actual Vite HMR entry replacement, React teardown and OPFS continuity.
 * Synthetic accepted text facts, no account, model, TTS or owner browser profile. */
import {once} from 'node:events';
import {createServer,type Server} from 'node:http';
import {resolve} from 'node:path';
import {test,expect} from '@playwright/test';
import {createServer as createViteServer,type ViteDevServer} from 'vite';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {semanticLookupPayload} from '../support/semanticLookupFixtures';
import type {} from '../../../apps/web/src/browserSmokeBridge';

type HmrWindow=Window&{__hmrUpdates:number;__hmrListeners:()=>Record<string,number>};

test('entry HMR replaces one React root and its listeners while retaining actual local facts',async({browser},testInfo)=>{
 test.setTimeout(90_000);
 let vite:ViteDevServer|undefined,http:Server|undefined;
 const context=await browser.newContext({locale:'zh-CN',viewport:{width:1280,height:900}}),page=await context.newPage();
 const messages:string[]=[],errors:string[]=[];
 page.on('console',message=>{if(['warning','error'].includes(message.type()))messages.push(message.text());});page.on('pageerror',error=>errors.push(error.message));
 try{
  http=createServer((request,response)=>{if(vite)vite.middlewares(request,response,()=>{response.statusCode=404;response.end();});else{response.statusCode=503;response.end();}});
  http.listen(0,'127.0.0.1');await once(http,'listening');
  const address=http.address();if(!address||typeof address==='string')throw new Error('hmr_test_origin_missing');
  const origin=`http://127.0.0.1:${address.port}`;
  vite=await createViteServer({configFile:resolve('apps/web/vite.config.ts'),root:resolve('apps/web'),logLevel:'error',define:{
   'import.meta.env.VITE_SENSA_BROWSER_SMOKE':JSON.stringify('true'),
   'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(''),
   'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify(''),
   'import.meta.env.VITE_SENSA_API_URL':JSON.stringify(origin+'/fixture-api'),
  },server:{middlewareMode:true,hmr:{server:http,host:'127.0.0.1',clientPort:address.port},fs:{allow:[process.cwd()]}}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.fallback():route.abort());
  await context.route(origin+'/fixture-api/**',route=>route.fulfill({status:503,json:{code:'fixture_no_online_service'}}));
  await context.addInitScript(()=>{
   const held=new Map<string,Set<unknown>>(),tracked=new Set(['error','unhandledrejection']);
   const add=window.addEventListener.bind(window),remove=window.removeEventListener.bind(window);
   window.addEventListener=((type:string,listener:EventListenerOrEventListenerObject,options?:AddEventListenerOptions|boolean)=>{if(tracked.has(type)){const set=held.get(type)??new Set();set.add(listener);held.set(type,set);}add(type,listener,options);}) as Window['addEventListener'];
   window.removeEventListener=((type:string,listener:EventListenerOrEventListenerObject,options?:EventListenerOptions|boolean)=>{held.get(type)?.delete(listener);remove(type,listener,options);}) as Window['removeEventListener'];
   const target=window as HmrWindow;target.__hmrUpdates=0;target.__hmrListeners=()=>Object.fromEntries([...held].map(([key,value])=>[key,value.size]));
  });
  await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await expect(page.locator('#s-home')).toBeVisible();
  const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
  expect(await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load())).toBe(1);
  await page.goto(origin+'/content');await page.locator('.sensa-world-row').first().click();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
  // This real navigation created a fresh HMR observer, not a fabricated app result.
  await page.evaluate(async()=>{const client='/@vite/client';const {createHotContext}=await import(/* @vite-ignore */ client);createHotContext('/test-hmr-observer').on('vite:afterUpdate',()=>{(window as HmrWindow).__hmrUpdates++;});});
  const before=await page.evaluate(()=>({timeOrigin:performance.timeOrigin,url:location.href,listeners:(window as HmrWindow).__hmrListeners()}));
  // Promises are awaited inside the page so the identity is an actual OPFS read.
  const identity=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
  expect(before.listeners.error).toBeGreaterThan(0);expect(before.listeners.unhandledrejection).toBeGreaterThan(0);
  for(let index=1;index<=3;index++){
   vite.ws.send({type:'update',updates:[{type:'js-update',path:'/src/main.tsx',acceptedPath:'/src/main.tsx',timestamp:Date.now()+index,explicitImportRequired:false,isWithinCircularImport:false}]});
   await expect.poll(()=>page.evaluate(()=>(window as HmrWindow).__hmrUpdates)).toBe(index);
   await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
   expect(await page.evaluate(()=>performance.timeOrigin)).toBe(before.timeOrigin);expect(page.url()).toBe(before.url);
   expect(await page.evaluate(()=>(window as HmrWindow).__hmrListeners())).toEqual(before.listeners);
   expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).toEqual(identity);
   expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
  }
  expect(messages.filter(message=>/createRoot\(\).*already|unmounted root|ReactDOMClient.createRoot/iu.test(message))).toEqual([]);expect(errors).toEqual([]);
  const screenshot=testInfo.outputPath('retained-context-after-entry-hmr.png');await page.screenshot({path:screenshot});await testInfo.attach('retained-context-after-entry-hmr',{path:screenshot,contentType:'image/png'});
  await testInfo.attach('entry-hmr-scope',{body:JSON.stringify({browser:browser.version(),updates:3,fullDocumentReload:false,sourceFacts:1,listenerCounts:before.listeners,paidCalls:0,scope:'Entry module replacement only; not arbitrary dependency HMR or a root-cause explanation of previous UAT storage failure.'}),contentType:'application/json'});
 }finally{await context.close();await vite?.close();if(http)await new Promise<void>(resolve=>http!.close(()=>resolve()));}
});
