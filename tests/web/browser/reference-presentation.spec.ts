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
import './apps/web/src/i18n/learningResources';
import {ReferenceDictionaryScreen} from './apps/web/src/experience/components/ReferenceDictionaryScreen';
import {ReferenceExampleViewer} from './apps/web/src/experience/components/ReferenceExampleViewer';
import {QuickDictPopup} from './apps/web/src/experience/components/QuickDictPopup';
import {LearningExampleLookup} from './apps/web/src/experience/components/examples/LearningExampleLookup';
import {projectReferenceEntryToQuick} from './apps/web/src/experience/reference/referenceDictionary';
const sourceOnly=new URL(location.href).searchParams.has('sourceOnly');
const sense={referenceSenseId:'fixture-sense',order:1,partOfSpeech:'interjection',glossL1:sourceOnly?undefined:'打招呼用语',definition:{text:'hello or hi',languageTag:'en'},examples:[{exampleId:'fixture-example',textL2:'¡Hola! ¿Cómo estás?',textL1:'你好！你怎么样？',sourceLabel:'Fixture'}]};
const release={releaseId:'fixture-release',provider:'Fixture',edition:'2026',targetLanguage:'es',learnerLocale:'zh-CN',rightsLabel:'Fixture only',status:'prototype'};
const result={release,entry:{referenceLexicalUnitId:'fixture-entry',releaseId:release.releaseId,headword:'hola',visibility:'reference_visible',pronunciations:[{pronunciationId:'fixture-pronunciation',accent:'es',ipa:'/ˈola/'}],forms:['hola','holas'],senses:[sense],usageNotes:[{noteId:'fixture-note',title:'用法',bodyL1:'用于友好问候。',sourceLabel:'Fixture'}],attribution:'Fixture'}};
await i18n.changeLanguage('zh-CN');
const surface=new URL(location.href).searchParams.get('surface');
if(surface){
 const fixture={spoken:[],utterances:[],played:[],paused:0,voices:[{name:'English local',lang:'en-US',localService:true},{name:'Spanish local',lang:'es-ES',localService:true}],mediaFails:true,mediaHeld:false};window.fixture=fixture;
 window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}lang='';voice=null;};
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:Object.assign(new EventTarget(),{getVoices:()=>fixture.voices,cancel:()=>{},speak:utterance=>{fixture.spoken.push({text:utterance.text,lang:utterance.lang});fixture.utterances.push(utterance);}})});
 window.Audio=class{constructor(src){fixture.played.push(src);}play(){if(fixture.mediaFails)return Promise.reject(new Error('controlled broken recording'));if(!fixture.mediaHeld)queueMicrotask(()=>this.onended?.());return Promise.resolve();}pause(){fixture.paused++;}};
 const supplied=surface==='dictionary'?{...result,entry:{...result.entry,pronunciations:[{...result.entry.pronunciations[0],audioUrl:'https://media.fixture.invalid/hola.mp3'}]}}:result;
 const wordData={word:'hola',referenceLookup:supplied};
 function PronunciationSurface(){const [open,setOpen]=React.useState(true),[active,setActive]=React.useState(true),[notice,setNotice]=React.useState('');const close=React.useCallback(()=>setOpen(false),[]);
  return <>{open&&(surface==='quick'?<QuickDictPopup entry={projectReferenceEntryToQuick(supplied)} onClose={close} toast={setNotice}/>:surface==='learning'?<LearningExampleLookup entry={projectReferenceEntryToQuick(supplied)} onClose={close} toast={setNotice}/>:surface==='viewer'?<ReferenceExampleViewer active deck={{headword:'hola',forms:['hola','holas'],sense,release}} onClose={close}/>:<ReferenceDictionaryScreen active={active} wordData={wordData} onClose={close} onOpenExamples={()=>setActive(false)}/>)}{!active&&<button onClick={()=>setActive(true)}>返回词典夹具</button>}{notice&&<p role="status">{notice}</p>}</>;
 }
 createRoot(document.getElementById('root')!).render(<PronunciationSurface/>);
}else createRoot(document.getElementById('root')!).render(<>
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
  await expect(dictionary.getByText('hello or hi',{exact:true})).toHaveAttribute('lang','en');
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

for(const surface of ['quick','learning','dictionary','viewer'] as const)test.describe(surface,()=>{
 test('English source definitions stay English for a Spanish headword when no learner gloss is available',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${port}/?surface=${surface}&sourceOnly=1`);
  await expect(page.getByRole('heading',{name:'hola',exact:true})).toHaveAttribute('lang','es');
  const definition=surface==='viewer'?page.locator('p').filter({hasText:'hello or hi'}):page.getByText('hello or hi',{exact:true});
  await expect(definition).toHaveAttribute('lang','en');await expect(page.getByText('打招呼用语',{exact:true})).toHaveCount(0);
 });
});

for(const surface of ['quick','learning'] as const)test.describe(surface,()=>{
 test('Reference source-language playback stays local, can stop and reports missing or failed speech',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${port}/?surface=${surface}`);
  const play=page.getByRole('button',{name:/播放西班牙语发音/u});await expect(play).toBeVisible();await expect(page.getByRole('button',{name:/美式/u})).toHaveCount(0);await play.click();
  await expect.poll(()=>page.evaluate(()=>(window as any).fixture.spoken)).toEqual([{text:'hola',lang:'es-ES'}]);await page.getByRole('button',{name:'停止发音',exact:true}).click();await expect(play).toBeVisible();
  await page.evaluate(()=>{(window as any).fixture.voices=[{name:'English only',lang:'en-US',localService:true}];});await play.click();await expect(page.getByRole('status')).toContainText('发音暂时无法播放');
  expect(await page.evaluate(()=>(window as any).fixture.spoken.length),'no English fallback answers for Spanish').toBe(1);
  await page.evaluate(()=>{(window as any).fixture.voices=[{name:'Spanish local',lang:'es-ES',localService:true}];});await play.click();await expect(page.getByRole('button',{name:'停止发音',exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).fixture.utterances.at(-1).onerror());await expect(play).toBeVisible();await expect(page.getByRole('status')).toContainText('发音暂时无法播放');
  expect(await page.evaluate(()=>(window as any).fixture.played)).toEqual([]);expect(errors).toEqual([]);
 });
});

test('Reference source recording failure is visible and never silently replaced by a device voice',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());await page.goto(`http://127.0.0.1:${port}/?surface=dictionary`);
 const play=page.locator('#s-reference-dictionary').getByRole('button',{name:/西班牙语/u});await play.click();await expect(page.getByRole('status')).toContainText('发音暂时无法播放');
 expect(await page.evaluate(()=>(window as any).fixture.played)).toEqual(['https://media.fixture.invalid/hola.mp3']);expect(await page.evaluate(()=>(window as any).fixture.spoken)).toEqual([]);
 await page.evaluate(()=>{(window as any).fixture.mediaFails=false;});await play.click();await expect(page.getByRole('status')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).fixture.played.length)).toBe(2);expect(await page.evaluate(()=>(window as any).fixture.spoken)).toEqual([]);expect(errors).toEqual([]);
});

test('suspending the dictionary stops its recording and returning does not retain a playing control',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:${port}/?surface=dictionary`);
 await page.evaluate(()=>{Object.assign((window as any).fixture,{mediaFails:false,mediaHeld:true});});
 const play=page.getByRole('button',{name:/播放西班牙语发音/u});await play.click();await expect(page.getByRole('button',{name:'停止发音',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/例句/u}).click();await expect.poll(()=>page.evaluate(()=>(window as any).fixture.paused)).toBe(1);
 await page.getByRole('button',{name:'返回词典夹具',exact:true}).click();await expect(play).toBeVisible();await expect(page.getByRole('button',{name:'停止发音',exact:true})).toHaveCount(0);
 await play.click();await page.getByRole('button',{name:'停止发音',exact:true}).click();await expect(play).toBeVisible();expect(await page.evaluate(()=>(window as any).fixture.paused)).toBe(2);
 expect(await page.evaluate(()=>(window as any).fixture.spoken)).toEqual([]);
});

test('closing quick lookup while local voices load prevents late pronunciation',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:${port}/?surface=quick`);
 await page.evaluate(()=>{(window as any).fixture.voices=[];});
 await page.getByRole('button',{name:/播放西班牙语发音/u}).click();await expect(page.getByRole('button',{name:'停止发音',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'关闭快速查词',exact:true}).click();
 await page.evaluate(()=>{(window as any).fixture.voices=[{name:'Spanish local',lang:'es-ES',localService:true}];window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));});
 expect(await page.evaluate(()=>(window as any).fixture.spoken)).toEqual([]);await expect(page.getByRole('status')).toHaveCount(0);
});
