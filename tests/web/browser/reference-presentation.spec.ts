/** Reference language semantics in the real React surfaces. No external calls. */
import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import {build} from 'esbuild';
import {expect,test} from '@playwright/test';

let server:Server;
let port:number;

test.setTimeout(60_000);
test.use({viewport:{width:360,height:740},locale:'zh-CN'});

test.beforeAll(async()=>{
const compiled=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';
import {createRoot} from 'react-dom/client';
import i18n from './apps/web/src/i18n';
import {ReferenceDictionaryScreen} from './apps/web/src/experience/components/ReferenceDictionaryScreen';
import {ReferenceExampleViewer} from './apps/web/src/experience/components/ReferenceExampleViewer';
const sense={referenceSenseId:'fixture-sense',order:1,partOfSpeech:'interjection',glossL1:'打招呼用语',definitionL2:'hello or hi',examples:[{exampleId:'fixture-example',textL2:'¡Hola! ¿Cómo estás?',textL1:'你好！你怎么样？',sourceLabel:'Fixture'}]};
const release={releaseId:'fixture-release',provider:'Fixture',edition:'2026',targetLanguage:'es',learnerLocale:'zh-CN',rightsLabel:'Fixture only',status:'prototype'};
const result={release,entry:{referenceLexicalUnitId:'fixture-entry',releaseId:release.releaseId,headword:'hola',visibility:'reference_visible',pronunciations:[{pronunciationId:'fixture-pronunciation',accent:'es',ipa:'/ˈola/'}],forms:['hola','holas'],senses:[sense],usageNotes:[{noteId:'fixture-note',title:'用法',bodyL1:'用于友好问候。',sourceLabel:'Fixture'}],attribution:'Fixture'}};
await i18n.changeLanguage('zh-CN');
createRoot(document.getElementById('root')!).render(<>
  <ReferenceDictionaryScreen active wordData={{word:'hola',referenceLookup:result}} onClose={()=>{}} onOpenExamples={()=>{}}/>
  <ReferenceExampleViewer active deck={{headword:'hola',forms:['hola','holas'],sense,release}} onClose={()=>{}}/>
</>);
`},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'}});
const code=compiled.outputFiles[0]!.text;
server=createServer((request,response)=>{
  response.setHeader('content-type',request.url==='/bundle.js'?'text/javascript':'text/html');
  response.end(request.url==='/bundle.js'?code:'<!doctype html><html lang="zh-CN"><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
port=(server.address() as {port:number}).port;
});

test.afterAll(async()=>{
  if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
});

test('dictionary and examples expose source and learner languages with accessible focus',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${port}`);
  const dictionary=page.locator('#s-reference-dictionary');
  await expect(dictionary.getByRole('heading',{name:'hola'})).toHaveAttribute('lang','es');
  await expect(dictionary.getByText('打招呼用语',{exact:true})).toHaveAttribute('lang','zh-CN');
  await expect(dictionary.getByText('hello or hi',{exact:true})).toHaveAttribute('lang','es');
  await expect(dictionary.getByText('holas',{exact:true})).toHaveAttribute('lang','es');
  await expect(dictionary.getByText('用于友好问候。',{exact:true})).toHaveAttribute('lang','zh-CN');
  const viewer=page.locator('#s-reference-example');
  await expect(viewer.getByRole('heading',{name:'hola'})).toHaveAttribute('lang','es');
  await expect(viewer.getByText('¡Hola! ¿Cómo estás?',{exact:true})).toHaveAttribute('lang','es');
  await expect(viewer.getByText('你好！你怎么样？',{exact:true})).toHaveAttribute('lang','zh-CN');
  await expect(viewer.locator('p[lang="zh-CN"]').filter({hasText:'打招呼用语'})).toHaveAttribute('lang','zh-CN');
  assert.equal(await viewer.locator('button').first().evaluate(element=>element===document.activeElement),true,'the active detail screen moves focus to its close control');
  assert.deepEqual(errors,[]);
});
