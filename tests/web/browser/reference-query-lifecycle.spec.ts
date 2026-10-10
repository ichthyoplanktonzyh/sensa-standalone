/** Real query hook/popup with a deliberately non-cooperating async adapter.
 * Complements native Fetch abort; not HTTP, OPFS or live provider evidence. */
import {createServer,type Server} from 'node:http';
import {build} from 'esbuild';
import {test,expect} from '@playwright/test';
let server:Server,origin:string;
test.beforeAll(async()=>{
 const code=(await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import i18n from './apps/web/src/i18n';
import {useImmediateDictionaryLookup} from './apps/web/src/experience/components/useImmediateDictionaryLookup';
import {QuickDictPopup} from './apps/web/src/experience/components/QuickDictPopup';
import {LearningExampleLookup} from './apps/web/src/experience/components/examples/LearningExampleLookup';
await i18n.changeLanguage('zh-CN');const fixture={pending:[]};window.fixture=fixture;
function QuerySurface(){const {activeLookup,openLookup,clearLookup}=useImmediateDictionaryLookup();
 const open=()=>openLookup({tokenIdx:0,displayWord:'borrow',load:signal=>new Promise(resolve=>fixture.pending.push({signal,resolve:label=>resolve({word:'borrow',phonetic:'',senses:[{pos:'verb',text:label,languageTag:'en'}],hasFullDetail:true})}))});
 return <><button onClick={open}>打开 borrow 查询</button>{activeLookup&&(new URL(location.href).searchParams.get('surface')==='quick'?<QuickDictPopup entry={activeLookup.entry} onClose={clearLookup} toast={()=>{}}/>:<LearningExampleLookup entry={activeLookup.entry} onClose={clearLookup} toast={()=>{}}/>)}</>;
}createRoot(document.getElementById('root')).render(<QuerySurface/>);
`},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'}})).outputFiles[0]!.text;
 server=createServer((request,response)=>{response.setHeader('content-type',request.url==='/bundle.js'?'text/javascript':'text/html');response.end(request.url==='/bundle.js'?code:'<!doctype html><html><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
test.afterAll(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));});
for(const surface of ['quick','learning'] as const)test.describe(surface,()=>{
 test('a closed and reopened same-word lookup ignores old answers even when the adapter ignores abort',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await page.goto(`${origin}/?surface=${surface}`);
  const open=page.getByRole('button',{name:'打开 borrow 查询',exact:true});await open.click();await expect.poll(()=>page.evaluate(()=>(window as any).fixture.pending.length)).toBe(1);
  await page.getByRole('button',{name:'关闭快速查词',exact:true}).click();expect(await page.evaluate(()=>(window as any).fixture.pending[0].signal.aborted)).toBe(true);
  await open.click();await expect.poll(()=>page.evaluate(()=>(window as any).fixture.pending.length)).toBe(2);await page.evaluate(()=>(window as any).fixture.pending[1].resolve('Current borrow Context'));
  await expect(page.getByText('Current borrow Context')).toBeVisible();await page.evaluate(()=>(window as any).fixture.pending[0].resolve('Obsolete borrow Context'));await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
  await expect(page.getByText('Current borrow Context')).toBeVisible();await expect(page.getByText('Obsolete borrow Context')).toHaveCount(0);
  await page.getByRole('button',{name:'关闭快速查词',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(errors).toEqual([]);
 });
});
