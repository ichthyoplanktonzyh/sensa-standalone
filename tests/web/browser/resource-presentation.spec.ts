/** Real card and detail renderers; loopback page and synthetic resources only. */
import {createServer, type Server} from 'node:http';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {resolve} from 'node:path';
import {expect, test} from '@playwright/test';

let server: Server;
let port: number;

test.setTimeout(60_000);

test.beforeAll(async () => {
  // Bundle preparation has its own allowance; interaction assertions stay bounded.
  test.setTimeout(90_000);
  const entry=resolve('.tmp/resource-presentation-entry.tsx');
  const compiled=await build({configFile:false,root:process.cwd(),logLevel:'silent',plugins:[react(),tailwindcss(),{
    name:'resource-renderer-fixture',async resolveId(id,importer){if(id===entry)return entry;if(importer===entry&&id.startsWith('./'))return this.resolve(resolve(id),undefined,{skipSelf:true});},
    load(id){if(id===entry)return `
import React from 'react';
import './apps/web/src/theme.css';
import goldenRelease from './apps/web/src/learning/content/releases/golden-learning-release-v1.json';
import {installLearningRelease} from './apps/web/src/learning/content/learningCatalog';
import {createRoot} from 'react-dom/client';
import {changeInterfaceLanguage} from './apps/web/src/i18n';
import './apps/web/src/i18n/learningResources';
import {LearningResourceDetails} from './apps/web/src/experience/components/learning/LearningResourceDetails';
import {ExpressionRevealCard} from './apps/web/src/experience/components/cards/lightweight/ExpressionRevealCard';
import {assembleLightweightInitialPresentation} from './apps/web/src/experience/learningRuntime/lightweightInitialPresentation';
import {LIGHTWEIGHT_EXPRESSION_REVEAL_STEP,LIGHTWEIGHT_EXPERIENCE_RECALL_STEP} from './apps/web/src/learning/runtime/lightweightInitialProtocol';
import {provisionLightweightInitialContent} from './apps/web/src/contentSupply/provisioning/lightweightInitialContent';
import {withBindingFixture} from './scripts/support/lightweightMaterialFixture.mts';
const id=()=>crypto.randomUUID();
const input=withBindingFixture({learnerUserId:id(),learningTargetId:id(),senseId:id(),senseVersionId:id(),senseExpressionBindingId:id(),resolvedLearningPlanRevisionId:'fixture',expressionSourceVersion:'fixture',senseSourceVersion:'fixture',expression:{surface:'borrow',languageTag:'en',expressionKind:'word'},sense:{meaning:'临时使用并归还',supportLanguageTag:'zh-CN'},originExperience:{source:'other_authoritative_source',sourceVersion:'fixture',personalAnchorUseGrantId:null,experience:{scene:'向朋友借伞，稍后归还。'+ ' 长资源夹具：清晨下雨时，借用朋友的雨伞，照看好物品并约定归还时间。'.repeat(16),senseFocus:'临时使用并归还',featureLabels:[],sceneRealization:{example:'May asked to borrow an umbrella.',targetStart:13,targetEnd:19}}},referenceFacts:[{source:'dictionary',sourceVersion:'fixture',fact:{factKind:'language_structure',expressionTypeLabel:'动词',partOfSpeech:'verb',usagePattern:'borrow something from someone',contrastNote:'Compare the receiver and the giver.'}},{source:'dictionary',sourceVersion:'fixture',fact:{factKind:'etymology',explanation:'Sourced optional explanation fixture',source:'Fixture dictionary',sourceUrl:'https://fixture.invalid/entry'}}],requestedAt:new Date().toISOString()});
const result=provisionLightweightInitialContent(input);
if(result.status!=='ready')throw Error('fixture not ready');
// Renderer-only interactive fixture: Context input does not accept generated HTML.
const base=result.materialization,material=new URLSearchParams(location.search).has('interactive')?{...base,content:{...base.content,resources:base.content.resources.map(resource=>resource.materialRoleKey==='experience_recall_cue'?{...resource,contentPayload:{...resource.contentPayload,html:'<button data-action="increment" data-target="count">Increment</button><span id="count">0</span>'}}:resource)}}:base;
const step=(definition)=>({protocolStepInstanceId:id(),protocolRunId:id(),retentionTargetId:id(),ordinal:1,definition,materialBindings:base.content.resources.filter(r=>definition.materialRequirements.some(q=>q.materialRoleKey===r.materialRoleKey)).map(r=>({materialRoleKey:r.materialRoleKey,resourceKey:r.resourceKey,learningMaterializationId:base.snapshot.learningMaterializationId}))});
const reveal=assembleLightweightInitialPresentation(step(LIGHTWEIGHT_EXPRESSION_REVEAL_STEP),base);
const recall=assembleLightweightInitialPresentation(step(LIGHTWEIGHT_EXPERIENCE_RECALL_STEP),base);
if(JSON.stringify(recall).includes('Sourced optional'))throw Error('pre-reveal resource leakage');
await changeInterfaceLanguage(new URLSearchParams(location.search).get('locale')??'en');
document.documentElement.dataset.sensaSkin=new URLSearchParams(location.search).get('skin')??'quiet';document.documentElement.dataset.sensaColorMode=new URLSearchParams(location.search).get('theme')??'light';
const empty={...material,content:{...material.content,resources:[]}},originalStudy=installLearningRelease(goldenRelease).packages[0].content,study=new URLSearchParams(location.search).has('media')?{...originalStudy,pronunciations:originalStudy.pronunciations.map(p=>({...p,audioUrl:'/audio.wav'}))}:originalStudy;
window.fixtureStudy=study;
createRoot(document.getElementById('root')!).render(<><ExpressionRevealCard active presentation={reveal} onRate={()=>{}} onOpenDictionary={()=>{}} lookupDictionary={async()=>null} toast={()=>{}}/><div id="resource-details"><LearningResourceDetails material={new URLSearchParams(location.search).has('empty')?empty:material} studyContent={new URLSearchParams(location.search).has('study')?study:undefined}/></div></>);
`;},
  }],define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"',__SENSA_RELEASE__:'"fixture"'},worker:{format:'es'},build:{write:false,minify:false,lib:{entry,formats:['es'],fileName:'bundle'},cssCodeSplit:false}});
  const result=Array.isArray(compiled)?compiled[0]!:compiled;
  if(!('output' in result))throw new Error('Fixture build must return completed output');
  const output=result.output;
  const files=new Map<string,string|Uint8Array>(output.map(file=>['/'+file.fileName,file.type==='chunk'?file.code:file.source]));
  const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);files.set('/audio.wav',wav);
  const script=output.find(file=>file.type==='chunk'&&file.isEntry)!.fileName,css=output.find(file=>file.fileName.endsWith('.css'))!.fileName;
  server=createServer((request,response)=>{
    const path=new URL(request.url??'/', 'http://127.0.0.1').pathname,file=files.get(path);
    response.setHeader('content-type',(path.endsWith('.js')||path.endsWith('.mjs'))?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.wav')?'audio/wav':'text/html');
    response.end(file??`<!doctype html><html><body><div id="root"></div><script type="module" src="/${script}"></script><link rel="stylesheet" href="/${css}"></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as {port: number}).port;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('reveal keeps etymology optional while details share complete source fields', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue()
    : route.abort());
  await page.goto(`http://127.0.0.1:${port}`);

  expect(errors).toEqual([]);
  const card = page.locator('.sensa-expression-reveal');
  await expect(card.getByRole('heading', {name: 'borrow', exact: true})).toBeVisible();
  await expect(card.getByText('May asked to borrow an umbrella.', {exact: true})).toBeVisible();
  await expect(card.getByText('Sourced optional explanation fixture')).not.toBeVisible();
  await card.locator('summary').filter({hasText: 'Etymology'}).click();
  await expect(card.getByText('Sourced optional explanation fixture')).toBeVisible();
  await expect(card.getByRole('link', {name: 'https://fixture.invalid/entry'})).toHaveAttribute('href', 'https://fixture.invalid/entry');

  await page.locator('#resource-details').getByRole('button',{name:'View learning resources',exact:true}).click();
  const details=page.getByRole('dialog',{name:/^Learning resources/u});
  await details.locator('summary').filter({hasText:'Language structure'}).click();
  await details.locator('summary').filter({hasText:'Etymology'}).click();
  await expect(details.getByText('borrow something from someone', {exact: true})).toBeVisible();
  await expect(details.getByText('Compare the receiver and the giver.', {exact: true})).toBeVisible();
  await expect(details.getByText('Sourced optional explanation fixture')).toBeVisible();
  expect(errors).toEqual([]);
});

for(const locale of ['zh-CN','en','de'])test(`long learning resources read at desktop and phone widths in ${locale}`,async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:${port}/?locale=${locale}`);
 const trigger=page.locator('#resource-details button');await expect(trigger).toBeVisible();expect(errors).toEqual([]);await trigger.click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:844});
  const panel=await dialog.boundingBox();expect(panel!.width).toBeGreaterThanOrEqual(width>640?700:width-1);
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`${locale}-resource-reader-${width}.png`),animations:'disabled'});
 }
 const reading=dialog.locator('[data-sensa-overlay-region="primary"]');await reading.evaluate(element=>element.scrollTop=element.scrollHeight);
 await page.screenshot({path:testInfo.outputPath(`${locale}-resource-reader-secondary-320.png`),animations:'disabled'});
 await dialog.locator('summary').last().focus();await page.keyboard.press('Tab');expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
 await trigger.click();await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(trigger).toBeFocused();expect(errors).toEqual([]);
});
test('empty resources remain a truthful dismissible reader in dark mode',async({page},testInfo)=>{
 await page.goto(`http://127.0.0.1:${port}/?empty&theme=dark`);const trigger=page.locator('#resource-details button');await trigger.click();
 await expect(page.getByRole('dialog').getByRole('status')).toHaveText('No learning resources are available.');
 await page.screenshot({path:testInfo.outputPath('resource-reader-empty-dark.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
});

test('study resource disclosure retains pronunciation, examples, translations and patterns',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:${port}/?study`);await page.locator('#resource-details button').click();const dialog=page.getByRole('dialog');await dialog.locator('summary').filter({hasText:'Additional learning material'}).click();
 const study=await page.evaluate(()=> (window as unknown as {fixtureStudy:{lemma:string;guideLabelL1:string;definitionL2:string;pronunciations:Array<{ipa:string;audioUrl:string|null}>;learningExamples:Array<{textL2:string;textL1:string;audioUrl:string|null}>;supportTabs:Array<{patterns:Array<{canonicalPattern:string}>}>}}).fixtureStudy);
 for(const text of [study.lemma,study.guideLabelL1,study.definitionL2,...study.learningExamples.flatMap(e=>[e.textL2,e.textL1]),...study.supportTabs.flatMap(t=>t.patterns.map(p=>p.canonicalPattern))])await expect(dialog.getByText(text,{exact:true}).first()).toBeVisible();
 for(const pronunciation of study.pronunciations)await expect(dialog.getByText(pronunciation.ipa,{exact:false})).toBeVisible();
 for(const url of [...study.pronunciations,...study.learningExamples].map(item=>item.audioUrl).filter(Boolean))await expect(dialog.locator(`audio[src="${url}"]`).first()).toHaveCount(1);
});

for(const [skin,theme] of [['clear','light'],['quiet','dark']])test(`long resource reading and folded groups stay readable in ${skin} ${theme}`,async({page},testInfo)=>{
 await page.goto(`http://127.0.0.1:${port}/?skin=${skin}&theme=${theme}`);await page.locator('#resource-details button').click();const dialog=page.getByRole('dialog');
 for(const width of [1280,320]){
  await page.setViewportSize({width,height:844});await page.screenshot({path:testInfo.outputPath(`resource-${skin}-${theme}-${width}.png`),animations:'disabled'});
  await dialog.locator('[data-sensa-overlay-region="primary"]').evaluate(element=>element.scrollTop=element.scrollHeight);
  await expect(dialog.locator('summary').filter({hasText:'Recall hint'})).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath(`resource-${skin}-${theme}-groups-${width}.png`),animations:'disabled'});
  await dialog.locator('[data-sensa-overlay-region="primary"]').evaluate(element=>element.scrollTop=0);
 }
});

test('resource dialog permits native audio Tab stops and interactive frame Escape',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:${port}/?study&media`);const trigger=page.locator('#resource-details button');await trigger.click();let dialog=page.getByRole('dialog');
 await dialog.locator('summary').filter({hasText:'Additional learning material'}).click();const audio=dialog.locator('audio').first();await audio.focus();let nativeStops=0;
 for(let index=0;index<12;index++){await page.keyboard.press('Tab');if(await audio.evaluate(element=>document.activeElement===element))nativeStops++;else break;}
 expect(nativeStops).toBeGreaterThan(1);expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
 await page.goto(`http://127.0.0.1:${port}/?interactive`);await expect(trigger).toBeVisible();expect(errors).toEqual([]);await trigger.click();dialog=page.getByRole('dialog');const iframe=dialog.locator('iframe');await expect(iframe).toHaveAttribute('sandbox','allow-scripts');
 await page.evaluate(()=>window.postMessage({type:'sensa:experience-escape',token:'forged'},'*'));await expect(dialog).toBeVisible();
 const increment=page.frameLocator('iframe').getByRole('button',{name:'Increment',exact:true});await increment.focus();await page.keyboard.press('Enter');await expect(page.frameLocator('iframe').locator('#count')).toHaveText('1');
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
});
