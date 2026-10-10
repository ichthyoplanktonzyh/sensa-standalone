/** Real assessment renderers and admitted golden resources; no Library/model.
 * This protects Reference disclosure, not full learning settlement. */
import {createServer,type Server} from 'node:http';
import {build} from 'esbuild';
import {test,expect} from '@playwright/test';

let server:Server,origin:string;
test.use({locale:'zh-CN'});
test.beforeAll(async()=>{
 const code=(await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import i18n from './apps/web/src/i18n';
import {bundledLearningRelease,bundledPackageBySense} from './apps/web/src/learning/content/bundledLearningContent';
import {materializeAssessmentResource} from './apps/web/src/learning/content/assessmentResources';
import {toReviewSpec} from './apps/web/src/learning/content/reviewCards';
import {SensaReviewAssessmentCard} from './apps/web/src/experience/components/cards/review/SensaReviewAssessmentCard';
await i18n.changeLanguage('zh-CN');
const content=bundledPackageBySense('borrow.verb.receive-temporarily').content;
const kind=new URL(location.href).searchParams.get('kind');
const taskKey=kind==='boundary_contrast'?'borrow.assessment.boundary.meter.v2':'borrow.assessment.transfer.lanterns.v2';
const resource=materializeAssessmentResource({packageIdentity:{packageKey:content.packageKey,senseKey:content.senseKey},content,taskKey,kind},bundledLearningRelease);
const spec=toReviewSpec(resource,content);const fixture={lookups:[],opens:[],submits:[],taskKey,kind};window.fixture=fixture;
createRoot(document.getElementById('root')).render(<SensaReviewAssessmentCard content={content} spec={spec} assessmentResource={resource} purpose="acquisition" onSubmit={value=>fixture.submits.push(value)} onOpenDictionary={value=>fixture.opens.push(value)} onOpenExample={()=>{}} onOpenNote={()=>{}} onOpenScene={()=>{}} lookupDictionary={async input=>{fixture.lookups.push(input);return null;}} onViewChange={()=>{}} toast={()=>{}}/>);
`},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'}})).outputFiles[0]!.text;
 server=createServer((request,response)=>{response.setHeader('content-type',request.url==='/bundle.js'?'text/javascript':'text/html');response.end(request.url==='/bundle.js'?code:'<!doctype html><html><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
test.afterAll(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));});

for(const kind of ['novel_context_transfer','boundary_contrast'] as const)test(`${kind} exposes no Reference action before submitting a primary response`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(`${origin}/?kind=${kind}`);await expect(page.getByRole('radiogroup')).toBeVisible();
 await expect(page.getByRole('button',{name:/^查词：/u})).toHaveCount(0);await page.keyboard.press('Alt+t');
 expect(await page.evaluate(()=>(window as any).fixture.lookups)).toEqual([]);expect(await page.evaluate(()=>(window as any).fixture.opens)).toEqual([]);
 await page.getByRole('radio').first().click();await page.getByRole('button',{name:kind==='boundary_contrast'?'提交这次检验':'提交判断',exact:true}).click();
 if(kind==='novel_context_transfer'){
  const words=page.getByRole('button',{name:/^查词：/u});await expect(words.first()).toBeVisible();await words.first().click();
  await expect.poll(()=>page.evaluate(()=>(window as any).fixture.lookups.length)).toBe(1);
  const request=await page.evaluate(()=>(window as any).fixture.lookups[0]);expect(request.textL2.slice(request.clickedStart,request.clickedEnd)).toBe(request.clickedSurface);
 }else{expect(await page.evaluate(()=>(window as any).fixture.submits.length)).toBe(1);expect(await page.evaluate(()=>(window as any).fixture.lookups)).toEqual([]);}
 expect(errors).toEqual([]);
});
