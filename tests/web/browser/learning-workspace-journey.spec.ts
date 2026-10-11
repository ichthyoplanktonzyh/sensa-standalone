/** Relocated workspace assertions: real Chromium/OPFS, controlled services. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {cpus,tmpdir} from 'node:os';
import {extname,join,resolve} from 'node:path';
import {chromium,expect,test as base,type Page,type BrowserContext,type TestInfo} from '@playwright/test';
import {unzipSync,zipSync} from 'fflate';
import {assertInteractionBudget} from '../support/interactionBudget';
import {portableBookMemberPath,readSensaPortableBook} from '@sensa/content-validator/portable-book';
import {canonicalConsumerJson,sensaPortableBookManifestSchema} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {cors} from 'hono/cors';
import {localSensaCorsOptions} from '../../../scripts/local/localCors.mts';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {semanticLookupPayload,syntheticSemanticWorld} from '../support/semanticLookupFixtures';
import type {JourneyState} from '../../../apps/web/src/experience/personalMeaningJourney/store';
import {createPackageCenterFixture} from './packageCenterFixture';
const fixture=createPackageCenterFixture('workspace');
const test=fixture.test;

test('nonbundled Book favorites and notes remain findable without a Personal Meaning or rating, then real learning appears after OPFS reload',async({page})=>{
 const providers:string[]=[];page.on('request',request=>{if(/\/model\/|chat\/completions|\/speech\//.test(request.url()))providers.push(request.url());});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 const runtime=await fixture.startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),targetId=before.runtime!.targetId;
 await runtime.getByRole('button',{name:'收藏',exact:true}).click();await expect(runtime.getByRole('button',{name:'收藏',exact:true})).toHaveAttribute('aria-pressed','true');
 await runtime.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('dialog',{name:'更多',exact:true}).getByRole('button',{name:'笔记',exact:true}).click();
 const note=page.locator('.sensa-note-editor');await note.locator('textarea').fill('下雨时向朋友暂借雨伞，用完归还。');await note.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(note).toHaveCount(0);
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();
 await expect(page.getByRole('button',{name:/^收藏的意思\s+1$/u})).toBeVisible();await expect(page.getByRole('button',{name:'我的笔记 1',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/^收藏的意思\s+1$/u}).click();const list=page.locator('#s-content-library');await list.getByRole('button',{name:/borrow/}).click();
 const detail=page.locator('#s-content-sense');await expect(detail.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('targetId')).toBe(targetId);
 await expect(detail.getByText('下雨时向朋友暂借雨伞，用完归还。',{exact:true})).toBeVisible();await expect(detail.getByRole('button',{name:'取消收藏这个意思',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.reload();await expect(detail.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('targetId')).toBe(targetId);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(before.runtime);expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toEqual([]);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
 await detail.getByRole('button',{name:'返回上一页',exact:true}).click();await expect(list.getByRole('button',{name:/borrow/})).toBeVisible();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.getByRole('button',{name:'收藏与笔记',exact:true}).click();await page.getByRole('button',{name:'我的笔记 1',exact:true}).click();
 await list.getByRole('button',{name:/borrow.*下雨时/u}).click();await expect(note.locator('textarea')).toHaveValue('下雨时向朋友暂借雨伞，用完归还。');await note.locator('textarea').press('Escape');
 await page.goto(fixture.origin);await page.locator('#s-home').getByRole('button',{name:/继续学习/}).click();
 await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
 if(await runtime.getByRole('button',{name:'暂停',exact:true}).isVisible())await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'学习连接',exact:true}).click();await page.getByRole('button',{name:/borrow/}).click();await expect(detail.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('targetId')).toBe(targetId);
 await page.reload();await expect(detail.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toHaveLength(1);expect(providers).toEqual([]);
});

test('personal learning scene updates remain explicit while stale editors preserve drafts and annotation read retry restores owned scenes',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});
 const providers:string[]=[];page.on('request',request=>{if(/\/model\/|chat\/completions|\/speech\//.test(request.url()))providers.push(request.url());});
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 const home=page.locator('#s-home');await expect(home.locator('.sensa-today-start')).toBeEnabled();await home.getByRole('button',{name:'学习包目录',exact:true}).click();
 await page.locator('#s-catalog').last().getByRole('button',{name:/雨天借伞/}).click();const book=page.locator('#s-catalog-book').last();
 await book.getByRole('button',{name:'下载学习包',exact:true}).click();await expect(book.getByText('已下载',{exact:true})).toBeVisible();
 await book.getByRole('button',{name:'加入学习',exact:true}).click();await book.getByRole('button',{name:'去学习',exact:true}).click();
 await home.getByRole('button',{name:'开始学习',exact:true}).click();
 const runtime=page.locator('#s-lightweight-runtime');
 const editorOf=(tab:import('@playwright/test').Page)=>tab.getByRole('dialog').filter({has:tab.getByRole('heading',{name:'我的场景',exact:true})});
 await runtime.getByRole('button',{name:'添加我的场景',exact:true}).click();const editor=editorOf(page);
 const firstBody='昨天向同事借了一把雨伞，约好第二天归还。';await editor.locator('textarea').fill(firstBody);
 await editor.locator('input[type="file"]').first().setInputFiles({name:'private-scene.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=','base64')});
 await expect(editor.getByRole('img')).toHaveCount(1);await editor.getByRole('button',{name:'保存我的场景',exact:true}).click();await expect(editor).toHaveCount(0);
 const scenes=()=>page.evaluate(()=>window.__sensaBrowserSmoke!.personalLearningScenesForTest());
 const first=(await scenes())[0]!;expect(first.revisions).toHaveLength(1);expect(first.revisions[0]!.media).toHaveLength(1);
 await runtime.getByRole('button',{name:/查看表达/}).click();await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 const originalLearning=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),runtimeUrl=page.url();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failNextSceneLinkCommitForTest());
 await runtime.getByRole('button',{name:'存入我的语义世界',exact:true}).click();
 await expect(page.getByText('未能确认存入，请重试',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
 const partial=(await scenes())[0]!;expect(partial.acceptedPersonalMeaningId).toBeNull();expect(partial.acceptedRevisionId).toBeNull();
 const committedMeaningId=await page.evaluate(()=>window.__sensaBrowserSmoke!.firstMeaningId());
 // Reopening loses the in-memory intent ID. A fresh explicit intent confirms
 // the committed scene instead of creating another Meaning or Anchor revision.
 await page.reload();await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await runtime.getByRole('button',{name:'存入我的语义世界',exact:true}).click();await expect(runtime.getByRole('button',{name:'已存入我的语义世界',exact:true})).toBeVisible();
 const meaningId=await page.evaluate(()=>window.__sensaBrowserSmoke!.firstMeaningId());expect(meaningId).toBeTruthy();expect(meaningId).toBe(committedMeaningId);
 const other=await context.newPage();await other.goto(runtimeUrl);await expect(other.locator('#s-lightweight-runtime').getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await runtime.getByRole('button',{name:'编辑我的场景',exact:true}).click();const draft='我的旧编辑草稿：向邻居借梯子，用完归还。';await editor.locator('textarea').fill(draft);
 await other.locator('#s-lightweight-runtime').getByRole('button',{name:'编辑我的场景',exact:true}).click();const otherEditor=editorOf(other),newer=firstBody,newCaption='另一页新保存的雨伞图片说明';await otherEditor.getByRole('textbox',{name:'图片 private-scene.png 的说明',exact:true}).fill(newCaption);await otherEditor.getByRole('button',{name:'保存我的场景',exact:true}).click();await expect(otherEditor).toHaveCount(0);
 await expect(editor.locator('textarea')).toHaveValue(draft);await editor.getByRole('button',{name:'保存我的场景',exact:true}).click();
 await expect(editor.getByRole('alert')).toContainText('场景已在别处更新');await expect(editor.getByRole('alert')).toContainText(newer);await expect(editor.locator('textarea')).toHaveValue(draft);
 await expect(editor.getByRole('alert').getByRole('img',{name:newCaption,exact:true})).toBeVisible();await expect(editor.getByRole('alert')).toContainText(newCaption);
 expect((await scenes())[0]!.revisions).toHaveLength(2);
 await editor.getByRole('button',{name:'保存我的版本',exact:true}).click();await expect(editor).toHaveCount(0);
 const replacement=(await scenes())[0]!;expect(replacement.sceneId).toBe(first.sceneId);expect(replacement.revisions).toHaveLength(3);expect(replacement.acceptedRevisionId).toBe(first.revisions[0]!.revisionId);
 await runtime.getByRole('button',{name:'编辑我的场景',exact:true}).click();await editor.getByRole('button',{name:'保存我的场景',exact:true}).click();await expect(editor).toHaveCount(0);expect((await scenes())[0]!.revisions).toHaveLength(3);
 await runtime.getByRole('button',{name:'更新到我的语义世界',exact:true}).click();await expect(runtime.getByRole('button',{name:'已存入我的语义世界',exact:true})).toBeVisible();
 const accepted=(await scenes())[0]!;expect(accepted.acceptedRevisionId).toBe(accepted.revisions[2]!.revisionId);expect(accepted.acceptedPersonalMeaningId).toBe(meaningId);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.firstMeaningId())).toBe(meaningId);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failAnnotationReadsForTest(true));await expect(runtime.getByRole('button',{name:'编辑我的场景',exact:true})).toBeEnabled();await expect(runtime.getByRole('alert')).toHaveCount(0);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failAnnotationReadsForTest(false));
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningSceneReadsForTest(true));await expect(runtime.getByRole('alert')).toBeVisible();await expect(runtime.getByRole('button',{name:/^(添加|编辑)我的场景$/})).toHaveCount(0);await expect(runtime.getByRole('button',{name:/已经连上/})).toBeDisabled();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningSceneReadsForTest(false));await runtime.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();await expect(runtime.getByRole('alert')).toHaveCount(0);expect(await scenes()).toEqual([accepted]);
 await page.reload();await expect(runtime.getByRole('button',{name:'已存入我的语义世界',exact:true})).toBeVisible();expect(await scenes()).toEqual([accepted]);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(originalLearning);expect(providers).toEqual([]);
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.getByRole('button',{name:/borrow/}).click();
 expect(new URL(page.url()).searchParams.get('meaningId')).toBe(meaningId);await expect(page.getByText(draft,{exact:true}).first()).toBeVisible();
 // Independent World authoring retires the original accepted scene anchor.
 // Reaccepting the learning scene must remain useful without erasing that
 // separately authored Context or reviving the retired anchor.
 const worldContext='在语义详情独立整理的借伞情境，需要保留。';
 await page.getByRole('button',{name:'编辑场景',exact:true}).click();await page.getByRole('textbox',{name:'场景',exact:true}).fill(worldContext);
 await page.getByRole('button',{name:'保存场景',exact:true}).click();await expect(page.getByRole('textbox',{name:'场景',exact:true})).toHaveCount(0);
 await page.goto(runtimeUrl);await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await runtime.getByRole('button',{name:'编辑我的场景',exact:true}).click();const afterWorld='学习页第三次明确加入的归还雨伞经历。';await editor.locator('textarea').fill(afterWorld);
 await editor.getByRole('button',{name:'保存我的场景',exact:true}).click();await expect(editor).toHaveCount(0);
 await runtime.getByRole('button',{name:'更新到我的语义世界',exact:true}).click();await expect(runtime.getByRole('button',{name:'已存入我的语义世界',exact:true})).toBeVisible();
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.getByRole('button',{name:/borrow/}).click();
 expect(new URL(page.url()).searchParams.get('meaningId')).toBe(meaningId);const currentDetail=page.getByRole('article',{name:'表达详情',exact:true});await expect(currentDetail).toContainText(worldContext);await expect(currentDetail).toContainText(afterWorld);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await other.close();
});

test('explicit personal scene acceptance and update stay bounded with 10000 unrelated Meanings',{tag:'@capacity'},async({preparedScenePage:page},testInfo)=>{
 await page.goto(`${fixture.origin}/content`);
 await expect(page.locator('.sensa-world.active').last().locator('.sensa-world-row').first()).toBeVisible();
 const runtime=await fixture.startOrdinaryBook(page),editor=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'我的场景',exact:true})});
 const original=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 await runtime.getByRole('button',{name:'添加我的场景',exact:true}).click();await editor.getByRole('textbox').fill('我向同事借了雨伞，明天归还。');
 await editor.getByRole('button',{name:'保存我的场景',exact:true}).click();await expect(editor).toHaveCount(0);
 await runtime.getByRole('button',{name:/查看表达/}).click();
 const timings:Array<{action:string;elapsedMs:number;phases:Array<{name:string;durationMs:number}>}>=[];
 const accept=async(action:string,label:string)=>{
  const start=await page.evaluate(()=>performance.now());await runtime.getByRole('button',{name:label,exact:true}).click();
  await expect(runtime.getByRole('button',{name:'已存入我的语义世界',exact:true})).toBeVisible();
  timings.push(await page.evaluate(({start,action})=>({action,elapsedMs:performance.now()-start,phases:performance.getEntriesByType('measure').filter(entry=>entry.startTime>=start&&entry.name.startsWith('sensa.journey.')).map(entry=>({name:entry.name,durationMs:entry.duration}))}),{start,action}));
 };
 await accept('firstAcceptance','存入我的语义世界');
 const first=(await page.evaluate(()=>window.__sensaBrowserSmoke!.personalLearningScenesForTest()))[0]!;
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(10_001);
 await runtime.getByRole('button',{name:'编辑我的场景',exact:true}).click();await editor.getByRole('textbox').fill('后来我把雨伞还给了同事，仍是借用后归还的场景。');
 await editor.getByRole('button',{name:'保存我的场景',exact:true}).click();await expect(editor).toHaveCount(0);await accept('explicitUpdate','更新到我的语义世界');
 const updated=(await page.evaluate(()=>window.__sensaBrowserSmoke!.personalLearningScenesForTest()))[0]!;
 expect(updated.acceptedPersonalMeaningId).toBe(first.acceptedPersonalMeaningId);expect(updated.sceneId).toBe(first.sceneId);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(10_001);
 const current=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(current.runtime?.runId).toBe(original.runtime?.runId);expect(current.runtime?.targetId).toBe(original.runtime?.targetId);expect(current.records).toEqual(original.records);
 console.log('Personal Scene explicit acceptance / Chromium+OPFS / synthetic 10k unrelated Meanings / 1x CPU / loopback / text-only / no model:',JSON.stringify(timings));
 await testInfo.attach('scene-acceptance-10000-meanings.json',{body:JSON.stringify(timings,null,2),contentType:'application/json'});
 for(const timing of timings){assertInteractionBudget(timing.elapsedMs,1500,timing.action);expect(timing.phases.filter(phase=>['sensa.journey.records','sensa.journey.authority'].includes(phase.name))).toEqual([]);}
});

test('a personal scene and its separate accepted revision survive actual persistent Chromium close and reopen',async({},testInfo)=>{
 const profile=testInfo.outputPath('scene-persistent-profile');await mkdir(profile,{recursive:true});
 const options={headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH,locale:'zh-CN',viewport:{width:390,height:844}};
 let context=await chromium.launchPersistentContext(profile,options);
 try{
  let page=context.pages()[0]!;await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
  let runtime=await fixture.startOrdinaryBook(page);
  const first='关闭浏览器之前明确保存的借伞经历。',later='稍后在学习页编辑，但还没有更新到长期意义。';
  const edit=async(body:string)=>{await runtime.getByRole('button',{name:/^(添加|编辑)我的场景$/}).click();const editor=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'我的场景',exact:true})});await editor.getByRole('textbox').fill(body);await editor.getByRole('button',{name:'保存我的场景',exact:true}).click();await expect(editor).toHaveCount(0);};
  await edit(first);await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:'存入我的语义世界',exact:true}).click();await expect(runtime.getByRole('button',{name:'已存入我的语义世界',exact:true})).toBeVisible();
  await edit(later);await expect(runtime.getByRole('button',{name:'更新到我的语义世界',exact:true})).toBeEnabled();
  const scenes=await page.evaluate(()=>window.__sensaBrowserSmoke!.personalLearningScenesForTest()),learning=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),meaningId=scenes[0]!.acceptedPersonalMeaningId;
  await context.close();context=await chromium.launchPersistentContext(profile,options);page=context.pages()[0]!;
  await page.goto(fixture.origin);await page.locator('#s-home').getByRole('button',{name:'继续学习',exact:true}).click();runtime=page.locator('#s-lightweight-runtime');await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
  await expect(runtime.getByRole('button',{name:'更新到我的语义世界',exact:true})).toBeEnabled();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.personalLearningScenesForTest())).toEqual(scenes);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(learning);
  await runtime.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.getByRole('button',{name:/borrow/}).click();
  expect(new URL(page.url()).searchParams.get('meaningId')).toBe(meaningId);await expect(page.getByText(first,{exact:true}).first()).toBeVisible();await expect(page.getByText(later,{exact:true})).toHaveCount(0);
 }finally{await context.close();}
});

test('a personal meaning created from a learning scene reuses its Book target without generation or replacing the active material',async({page})=>{
 const providerRequests:string[]=[];
 page.on('request',request=>{if(/\/model\/|chat\/completions|\/speech\//.test(request.url()))providerRequests.push(request.url());});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 const home=page.locator('#s-home');
 await expect(home.getByRole('heading',{name:'还没有加入学习内容',exact:true})).toBeVisible();
 await home.getByRole('button',{name:'学习包目录',exact:true}).click();
 await page.locator('#s-catalog').last().getByRole('button',{name:/雨天借伞/}).click();const book=page.locator('#s-catalog-book').last();
 await book.getByRole('button',{name:'下载学习包',exact:true}).click();await expect(book.getByText('已下载',{exact:true})).toBeVisible();
 await book.getByRole('button',{name:'加入学习',exact:true}).click();await book.getByRole('button',{name:'去学习',exact:true}).click();
 await home.getByRole('button',{name:'开始学习',exact:true}).click();await expect(page.getByRole('dialog',{name:'学习偏好',exact:true})).toHaveCount(0);
 const runtime=page.locator('#s-lightweight-runtime');await runtime.getByRole('button',{name:/查看表达/}).click();await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 const original=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 await runtime.getByRole('button',{name:'添加我的场景',exact:true}).click();
 const editor=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'我的场景',exact:true})});
 await editor.getByRole('textbox').fill('昨天我向同事借了一把雨伞，并约好今天归还。');await editor.getByRole('button',{name:'保存我的场景',exact:true}).click();
 await runtime.getByRole('button',{name:'存入我的语义世界',exact:true}).click();await expect(runtime.getByRole('button',{name:'已存入我的语义世界',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:/borrow/}).click();
 const preparation=page.getByRole('region',{name:'个人内容学习准备',exact:true});
 await expect(preparation.getByRole('checkbox'),'existing Book material must not offer an unused generation consent').toHaveCount(0);
 await preparation.getByRole('button',{name:'加入学习',exact:true}).click();
 await expect(preparation.getByRole('heading')).toContainText('已加入学习');
 await expect(preparation.getByRole('button',{name:'开始 / 继续学习',exact:true})).toBeEnabled();
 const tasks=await page.evaluate(()=>window.__sensaBrowserSmoke!.provisioningCheckpoint());expect(tasks).toHaveLength(1);expect(tasks[0]!.status).toBe('covered');
 const after=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(after.targetIds).toEqual(original.targetIds);expect(after.runtime).toEqual(original.runtime);expect(after.records).toEqual([]);expect(providerRequests).toEqual([]);
 await page.reload();await expect(preparation.getByRole('button',{name:'开始 / 继续学习',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.provisioningCheckpoint())).toEqual(tasks);
 await preparation.getByRole('button',{name:'开始 / 继续学习',exact:true}).click();await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(original.runtime);expect(providerRequests).toEqual([]);
 // A covered personal request must not hide a failed formal Target read behind
 // a preparation screen or its unrelated retry action.
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
 await page.locator('#s-study').getByRole('button',{name:'查看内容',exact:true}).click();
 await page.locator('#s-learning-library').getByRole('button',{name:/borrow/}).click();
 const target=page.locator('#s-learning-target');await expect(target.getByRole('heading',{name:'borrow',level:2,exact:true})).toBeVisible();
 await page.evaluate(async()=>{await window.__sensaBrowserSmoke!.failLearningTargetReadsForTest(true);window.dispatchEvent(new Event('sensa-library-changed'));});
 await expect(target.getByRole('alert')).toBeVisible();await expect(target.locator('summary')).toHaveCount(0);
 await expect(target.getByRole('button',{name:'重试',exact:true})).toBeEnabled();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningTargetReadsForTest(false));await target.getByRole('button',{name:'重试',exact:true}).click();
 await expect(target.getByRole('heading',{name:'borrow',level:2,exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.provisioningCheckpoint())).toEqual(tasks);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(after);expect(providerRequests).toEqual([]);
});

test('repeated Web preference and resume lifecycles preserve pinned learning and exact media in isolated and persistent contexts',async({browser},testInfo)=>{
 const idleMs=Number(process.env.SENSA_WEB_IDLE_MS??2000);
 if(!Number.isSafeInteger(idleMs)||idleMs<0||idleMs>30*60_000)throw new Error('invalid_web_idle_duration');
 test.setTimeout(360_000+idleMs);
 fixture.setRegistry([fixture.scaleDelivery.descriptor]);
 const evidence:Record<string,unknown>[]=[];
 try{
  for(const mode of ['isolated','persistent'] as const){
   const profile=mode==='persistent'?await mkdtemp(resolve('.tmp/web-media-lifecycle-profile-')):null;
   const headless=testInfo.project.use.headless!==false;
   const context=profile?await chromium.launchPersistentContext(profile,{headless,executablePath:process.env.SENSA_CHROMIUM_PATH,viewport:{width:1280,height:900},locale:'zh-CN'}):await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});
   const page=await context.newPage(),errors:string[]=[];
   page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
   page.on('pageerror',error=>errors.push(error.message));
   const report:Record<string,unknown>={mode,profile,headless,browserVersion:context.browser()!.version(),iterations:0,bookMembers:100,mediaBytes:fixture.scaleDelivery.fixtureMetrics.mediaBytes,hmr:false,faultInjection:false,paidCalls:0};
   evidence.push(report);
   try{
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const runtime=await fixture.startOrdinaryBook(page,/English route essentials/);
    await runtime.getByRole('button',{name:/查看表达/}).click();
    await expect(runtime.getByRole('button',{name:/已经连上/})).toBeEnabled();
    const expression=(await runtime.getByRole('heading').first().textContent())!.trim();
    await expect(runtime.getByRole('heading',{name:expression,exact:true})).toBeVisible();
    const pinned=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
    const arrangement=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
    expect(pinned.records).toHaveLength(0);expect(arrangement.session!.dailyNewSenseLimit).toBe(20);
    const member=fixture.scaleDelivery.bookArchive!.members.find(member=>member.archive.package.targetExpression.text===expression)!;
    expect(member).toBeDefined();
    const pack=(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).find(pack=>pack.packageId===member.member.packageId&&pack.version===member.member.version)!;
    expect(pack).toBeDefined();const key=pack.key;
    const expectedMedia={sha256:member.archive.archiveDigest,byteLength:member.bytes.byteLength};
    expect(await page.evaluate(key=>window.__sensaBrowserSmoke!.portablePackageDigestForTest(key),key)).toEqual(expectedMedia);
    for(let round=0;round<12;round++)await test.step(`${mode} pause / preferences / reload / resume ${round+1}`,async()=>{
     await runtime.getByRole('button',{name:'暂停',exact:true}).click();
     const nav=page.getByRole('navigation',{name:'主要导航',exact:true});
     await nav.getByRole('button',{name:'我的学习',exact:true}).click();
     const study=page.locator('#s-study');
     await study.getByRole('button',{name:'学习偏好',exact:true}).click();
     const preferences=page.getByRole('dialog',{name:'学习偏好',exact:true});
     const quantity=preferences.getByRole('combobox',{name:'每日新学数量',exact:true});
     const next=round%2===0?'5':'20';
     await quantity.selectOption(next);await expect(quantity).toHaveValue(next);
     await preferences.getByRole('button',{name:'完成',exact:true}).click();
     if(mode==='persistent'&&round===0&&idleMs){
      await nav.getByRole('button',{name:'今日',exact:true}).click();
      const observe=()=>page.evaluate(async()=>{
       const files:string[]=[];
       const visit=async(directory:FileSystemDirectoryHandle,parent:string):Promise<void>=>{
        for await(const [name,handle] of (directory as FileSystemDirectoryHandle&{entries():AsyncIterable<[string,FileSystemHandle]>}).entries()){
         const path=`${parent}/${name}`;if(handle.kind==='directory')await visit(handle as FileSystemDirectoryHandle,path);else files.push(path);
        }
       };
       await visit(await navigator.storage.getDirectory(),'');
       return {timeOrigin:performance.timeOrigin,capturedAt:new Date().toISOString(),files:files.sort(),estimate:await navigator.storage.estimate(),locks:await navigator.locks.query()};
      });
      const before=await observe();expect(before.files.filter(path=>path.includes('/.opaque/'))).toHaveLength(6);
      console.info(JSON.stringify({stage:'web_idle_started',mode,requestedIdleMs:idleMs,capturedAt:before.capturedAt}));
      const begin=performance.now();await new Promise(resolve=>setTimeout(resolve,idleMs));
      const after=await observe();report.idle={requestedMs:idleMs,actualMs:performance.now()-begin,before,after};
      expect(after.timeOrigin).toBe(before.timeOrigin);expect(after.files).toEqual(before.files);
      await nav.getByRole('button',{name:'我的学习',exact:true}).click();
     }
     await page.reload();
     await study.getByRole('button',{name:'学习偏好',exact:true}).click();
     await expect(quantity).toHaveValue(next);
     await preferences.getByRole('button',{name:'完成',exact:true}).click();
     await nav.getByRole('button',{name:'今日',exact:true}).click();
     await page.locator('#s-home').getByRole('button',{name:'继续学习',exact:true}).click();
     await expect(runtime.getByRole('heading',{name:expression,exact:true})).toBeVisible();
     await page.reload();
     await expect(runtime.getByRole('heading',{name:expression,exact:true})).toBeVisible({timeout:15_000});
     expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(pinned);
     expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual(arrangement);
     expect(await page.evaluate(key=>window.__sensaBrowserSmoke!.portablePackageDigestForTest(key),key)).toEqual(expectedMedia);
     expect(errors).toEqual([]);report.iterations=round+1;
    });
    const diagnostics=await page.evaluate(()=>window.__sensaBrowserSmoke!.storageDiagnostics({verifyIntegrity:true}));
    expect(diagnostics.integrityCheck!.status).toBe('ok');report.integrity='ok';report.consoleErrors=errors;
   }catch(cause){report.failure=cause instanceof Error?cause.message:String(cause);report.consoleErrors=errors;throw cause;}
   finally{await context.close();}
  }
 }finally{
  const evidencePath=testInfo.outputPath('web-media-lifecycle-evidence.json');
  await writeFile(evidencePath,JSON.stringify({scope:'Production-build UI lifecycle with synthetic media and actual OPFS; no score, completion or schedule creation. Persistent-mode first preference change includes an explicitly reported idle duration (default two seconds), with no scripted SQL, navigation or CLI storage restore during the wait. Not HMR or a diagnosis of the independent UAT corruption; short idle cannot claim long-idle proof.',contexts:evidence},null,2));
  await testInfo.attach('web-media-lifecycle-evidence',{path:evidencePath,contentType:'application/json'});
 }
});

test('a failed Statistics code module recovers after reconnect without losing saved learning records',async({browser})=>{
 // Bypass shell caching only for this deliberate first-load module failure.
 // Real offline shell behavior is verified by the existing offline journeys.
 const context=await browser.newContext({locale:'zh-CN',serviceWorkers:'block'});
 const page=await context.newPage();
 try{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const runtime=await fixture.startOrdinaryBook(page);
  await runtime.getByRole('button',{name:/查看表达/}).click();
  await runtime.getByRole('button',{name:/已经连上/}).click();
  await runtime.getByRole('button',{name:/完成并回到首页/}).click();
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
  const study=page.locator('#s-study');
  await study.locator('summary').filter({hasText:'最近记录'}).click();
  await expect(study.locator('ol').getByRole('button',{name:/borrow/})).toHaveCount(1);
  const saved=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
  const blockedModule='**/assets/StatsScreen-*.js';let blockedRequests=0;
  await page.route(blockedModule,route=>{blockedRequests++;return route.abort('internetdisconnected');});
  await study.getByRole('button',{name:'学习统计',exact:true}).click();
  const recovery=page.locator('[data-sensa-product-recovery="error"]');
  await expect(recovery).toBeVisible();expect(blockedRequests).toBeGreaterThan(0);
  await expect(recovery.getByRole('button',{name:'重新加载',exact:true})).toBeEnabled();
  await page.unroute(blockedModule);
  await recovery.getByRole('button',{name:'重新加载',exact:true}).click();
  const stats=page.locator('#s-stats');
  await expect(stats.getByRole('list',{name:'所选范围的记录',exact:true}).getByRole('button',{name:/borrow/})).toHaveCount(1,{timeout:15_000});
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(saved);
 }finally{await context.close();}
});
