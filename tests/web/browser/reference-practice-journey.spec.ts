/** Relocated reference assertions: real Chromium/OPFS, controlled services. */
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
const fixture=createPackageCenterFixture('reference');
const test=fixture.test;

test('an empty practice scope offers content selection and return without loading a player or inventing learner facts',async({page})=>{
 let sdkRequests=0;await page.route('https://youglish.com/public/emb/widget.js',route=>{sdkRequests++;return route.abort();});
 await page.goto(fixture.origin+'/academy');const practice=page.locator('#s-academy').last(),activities=practice.locator('.sensa-practice-activities').getByRole('button');
 await expect(practice.getByText('当前没有可练内容',{exact:true})).toBeVisible();await expect(activities).toHaveCount(1);await expect(activities).toBeDisabled();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());
 await practice.getByRole('button',{name:/练习材料/u}).click();const scope=page.locator('#s-practice-scope').last();
 await expect(scope.getByText('当前没有可练内容',{exact:true})).toBeVisible();await expect(scope.getByRole('button',{name:'使用 0 个表达',exact:true})).toBeDisabled();
 await scope.getByRole('button',{name:'我的语义世界',exact:true}).click();await expect(scope.getByText('当前没有可练内容',{exact:true})).toBeVisible();
 await scope.getByRole('button',{name:'返回',exact:true}).click();await expect(practice).toBeVisible();
 await practice.getByRole('button',{name:'学习包目录',exact:true}).click();await expect(page.locator('#s-catalog').last()).toBeVisible();await page.goBack();await expect(practice).toBeVisible();
 await practice.getByRole('button',{name:'添加个人内容',exact:true}).click();await expect(page.locator('#s-personal-meaning')).toBeVisible();await page.goBack();await expect(practice).toBeVisible();
 expect(sdkRequests).toBe(0);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest())).toEqual(facts);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);
});

test('delivered listening preserves learner facts and provider layout after another tab changes Route',async({page,context},testInfo)=>{
 fixture.setRegistry([fixture.referenceDelivery.descriptor]);await page.route('**/sensa/model/turn',route=>route.fulfill({status:503,json:{code:'fixture_model_unavailable'}}));
 await page.route('https://youglish.com/public/emb/widget.js',route=>route.fulfill({contentType:'text/javascript',body:`
 window.__listeningFixture={requests:[],closed:0};
 window.YG={Widget:class{
  constructor(id,options){this.events=options.events;const root=document.getElementById(id),wrapper=document.createElement('div'),frame=document.createElement('iframe');wrapper.style.cssText='display:flex;flex-direction:column;align-items:center';frame.title='Controlled provider layout';frame.style.cssText='position:static;height:640px;width:'+options.width+'px';frame.srcdoc='<html><body style="margin:0;background:#dddddd">Controlled layout, not real playback</body></html>';wrapper.append(frame);root.append(wrapper);this.root=root;}
  fetch(query,lang,accent){window.__listeningFixture.requests.push({query,lang,accent});queueMicrotask(()=>{this.events.onFetchDone({totalResult:3});this.events.onPlayerReady();this.events.onPlayerStateChange({state:2});this.events.onCaptionChange({caption:'Controlled [[[clip]]]'});});}
  play(){this.events.onPlayerStateChange({state:1});}pause(){this.events.onPlayerStateChange({state:2});}
  next(){}previous(){}replay(){}move(){}setSpeed(speed){this.events.onSpeedChange({speed});}
  close(){window.__listeningFixture.closed++;this.root.replaceChildren();}
 }};window.onYouglishAPIReady();
 `}));
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.locator('#s-home').getByRole('heading',{name:'还没有加入学习内容',exact:true})).toBeVisible();
 await page.locator('#s-home').getByRole('button',{name:'学习包目录',exact:true}).click();await page.locator('#s-catalog').last().getByRole('button',{name:/只读查词样本/}).click();
 const book=page.locator('#s-catalog-book').last();await book.getByRole('button',{name:'下载学习包',exact:true}).click();await expect(book.getByText('已下载',{exact:true})).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
 await page.goto(fixture.origin+'/academy');const practice=page.locator('#s-academy');
 const start=practice.locator('.sensa-practice-activities').getByRole('button').first();await expect(start).toBeEnabled();await start.click();
 const listening=page.locator('#s-real-world-listening');await expect(listening.getByRole('button',{name:'播放',exact:true})).toBeEnabled();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest()),checkpoint=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 const stored=await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest()),arrangement=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
 const peer=await context.newPage();await peer.goto(fixture.origin+'/profile');await peer.locator('#settings-preferences').click();await peer.locator('#account-languages').click();
 const routes=peer.getByRole('dialog',{name:'语言路线',exact:true});await routes.getByLabel('选择目标语言',{exact:true}).selectOption('es');await routes.getByLabel('选择辅助语言',{exact:true}).selectOption('zh-CN');await routes.getByRole('button',{name:'添加路线',exact:true}).click();await routes.getByRole('radio').filter({hasText:'Español'}).click();
 await listening.getByRole('button',{name:'播放',exact:true}).click();await expect(listening.getByRole('button',{name:'暂停',exact:true})).toBeEnabled();await listening.getByRole('button',{name:'暂停',exact:true}).click();
 await listening.getByRole('button',{name:'英式',exact:true}).click();await expect(listening.getByRole('button',{name:'播放',exact:true})).toBeEnabled();
 const geometry=await listening.getByTitle('Controlled provider layout').evaluate(frame=>{const box=frame.getBoundingClientRect(),host=frame.closest('.bg-surface-media')!.getBoundingClientRect();return {height:box.height,contained:box.bottom<=host.bottom+1};});
 expect(geometry.height).toBe(640);expect(geometry.contained).toBe(true);
 const requests=await page.evaluate(()=>(window as unknown as {__listeningFixture:{requests:Array<{lang:string;accent?:string}>}}).__listeningFixture.requests);expect(requests.length).toBeGreaterThan(1);expect(requests.every(request=>request.lang==='english')).toBe(true);
 await listening.locator('header').getByRole('button').click();await expect(practice).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest())).toEqual(before);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest())).toEqual(stored);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual(arrangement);
 // Downloaded expressions are usable without enrollment; exposure creates no Run.
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(checkpoint.runtime);
 await expect(routes.getByRole('radio').filter({hasText:'Español'})).toHaveAttribute('aria-checked','true');
 await routes.getByRole('radio').filter({hasText:'English'}).click();await expect(routes.getByRole('radio').filter({hasText:'English'})).toHaveAttribute('aria-checked','true');
 await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(checkpoint);
 await start.click();await expect(listening.getByRole('button',{name:'重播',exact:true})).toHaveCount(1);await page.setViewportSize({width:390,height:844});await expect(listening.getByRole('button',{name:'重播',exact:true})).toHaveCount(1);
 await listening.getByRole('group',{name:'播放',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('listening-controls-390.png'),animations:'disabled'});await listening.evaluate(element=>element.scrollTo(0,0));await page.screenshot({path:testInfo.outputPath('listening-ready-390.png'),animations:'disabled'});
 await page.setViewportSize({width:320,height:844});expect(await listening.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath('listening-ready-320.png'),animations:'disabled'});
 await listening.getByRole('group',{name:'播放',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('listening-controls-320.png'),animations:'disabled'});
 await page.setViewportSize({width:1280,height:900});await listening.evaluate(element=>element.scrollTo(0,0));await page.screenshot({path:testInfo.outputPath('listening-ready-1280.png'),animations:'disabled'});await listening.getByRole('group',{name:'播放',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('listening-controls-1280.png'),animations:'disabled'});await page.setViewportSize({width:390,height:844});
 const location=page.url(),skip=listening.getByRole('link',{name:'跳到播放控制',exact:true});await skip.focus();await skip.press('Enter');await expect(listening.getByRole('group',{name:'播放',exact:true})).toBeFocused();expect(page.url()).toBe(location);
 await page.keyboard.press('Tab');await expect(listening.getByRole('button',{name:'上一段',exact:true})).toBeFocused();
 await listening.locator('header').getByRole('button').click();await expect(practice).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);await peer.close();
});

test('reference lookup, manual search and example return preserve the same real learning Step and stored learner facts',async({page})=>{
 fixture.setRegistry([fixture.referenceDelivery.descriptor]);const sources=await fixture.referenceProviders(page),runtime=await fixture.startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:/查看表达/}).click();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());
 const location=page.url();await runtime.getByRole('button',{name:'查词：borrow',exact:true}).click();
 const quick=page.getByRole('dialog',{name:/borrow/});await expect(quick.getByText('Fixture definition for borrow.')).toBeVisible();
 await quick.getByRole('button',{name:'查看详细释义',exact:true}).click();
 const dictionary=page.locator('#s-reference-dictionary');await expect(dictionary.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await expect(dictionary.locator('footer')).toContainText('WiktAPI');
 const search=dictionary.getByRole('searchbox');await search.fill('lend');await dictionary.getByRole('button',{name:'搜索',exact:true}).click();
 await expect(dictionary.getByRole('heading',{name:'lend',exact:true})).toBeVisible();
 await dictionary.getByRole('button',{name:/例句/}).click();const examples=page.locator('#s-reference-example');
 await expect(examples.getByText('May asked to lend an umbrella.',{exact:true})).toBeVisible();await expect(examples).toContainText('Controlled reference fixture');
 await examples.locator('header').getByRole('button',{name:'返回词典',exact:true}).click();
 await expect(dictionary.getByRole('heading',{name:'lend',exact:true})).toBeVisible();await expect(search).toHaveValue('lend');
 await dictionary.getByRole('button',{name:'返回上一页',exact:true}).click();
 await expect(runtime.getByRole('button',{name:/已经连上/})).toBeVisible();expect(page.url()).toBe(location);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest())).toEqual(facts);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);
 expect(sources.requests.some(url=>url.includes('/word/lend/definitions'))).toBe(true);
});

test('closing quick or full reference cancels held browser requests and late results cannot replace a newer lookup',async({page})=>{
 fixture.setRegistry([fixture.referenceDelivery.descriptor]);const sources=await fixture.referenceProviders(page),runtime=await fixture.startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:/查看表达/}).click();
 await expect(runtime.getByRole('button',{name:'查词：borrow',exact:true})).toBeVisible();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());sources.holdWord='borrow';
 try{
  await runtime.getByRole('button',{name:'查词：borrow',exact:true}).click();const quick=page.getByRole('dialog',{name:/borrow/});
  await expect.poll(()=>sources.pending.length).toBe(1);await expect(quick.getByRole('status')).toContainText('正在查询词典');await quick.getByRole('button',{name:'关闭快速查词',exact:true}).click();
  await expect.poll(()=>sources.aborted.some(url=>url.includes('/word/borrow/definitions'))).toBe(true);await expect(quick).toHaveCount(0);
  sources.holdWord=null;await runtime.getByRole('button',{name:'查词：umbrella',exact:true}).click();const current=page.getByRole('dialog',{name:/umbrella/});
  await expect(current.getByText('Fixture definition for umbrella.')).toBeVisible();sources.pending.splice(0).forEach(resolve=>resolve());await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
  await expect(current.getByText('Fixture definition for umbrella.')).toBeVisible();await current.getByRole('button',{name:'查看详细释义',exact:true}).click();
  const dictionary=page.locator('#s-reference-dictionary'),search=dictionary.getByRole('searchbox');sources.holdWord='anchor';
  await search.fill('anchor');await dictionary.getByRole('button',{name:'搜索',exact:true}).click();await expect.poll(()=>sources.pending.length).toBe(1);
  await dictionary.getByRole('button',{name:'返回上一页',exact:true}).click();await expect(dictionary).toHaveCount(0);
  await expect.poll(()=>sources.aborted.some(url=>url.includes('/word/anchor/definitions'))).toBe(true);sources.holdWord=null;sources.pending.splice(0).forEach(resolve=>resolve());
  await expect(runtime.getByRole('button',{name:/已经连上/})).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest())).toEqual(before);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
 }finally{sources.pending.splice(0).forEach(resolve=>resolve());}
});

test('another tab selecting a German Route does not change the English material lookup or its stored learning facts',async({page,context})=>{
 fixture.setRegistry([fixture.referenceDelivery.descriptor]);const sources=await fixture.referenceProviders(page),runtime=await fixture.startOrdinaryBook(page,/只读查词样本/);
 await runtime.locator('[data-learning-more]').click();await expect(page.locator('#menu-more').getByRole('button',{name:'内容来源',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');
 await runtime.getByRole('button',{name:/查看表达/}).click();
 await expect(runtime.getByRole('button',{name:'查词：borrow',exact:true})).toBeVisible();const original=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());
 const preferences=await context.newPage();await preferences.goto(fixture.origin+'/profile');await preferences.locator('#settings-preferences').click();await preferences.locator('#account-languages').click();
 const languages=preferences.getByRole('dialog',{name:'语言路线',exact:true});await languages.getByLabel('选择目标语言',{exact:true}).selectOption('de');await languages.getByLabel('选择辅助语言',{exact:true}).selectOption('fr');
 await languages.getByRole('button',{name:'添加路线',exact:true}).click();const german=languages.getByRole('radio',{name:/Deutsch/});await expect(german).toBeEnabled();await german.click();await expect(german).toHaveAttribute('aria-checked','true');
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());expect(before.targets).toEqual(original.targets);expect(before.behavioralEvidenceCount).toBe(original.behavioralEvidenceCount);
 await page.bringToFront();await runtime.getByRole('button',{name:'查词：borrow',exact:true}).click();const quick=page.getByRole('dialog',{name:/borrow/});await expect(quick.getByText('Fixture definition for borrow.')).toBeVisible();
 expect(sources.requests.filter(url=>url.includes('/definitions')).every(url=>new URL(url).searchParams.get('lang')==='en')).toBe(true);
 await quick.getByRole('button',{name:'查看详细释义',exact:true}).click();const dictionary=page.locator('#s-reference-dictionary');await expect(dictionary.getByRole('heading',{name:'borrow',exact:true})).toHaveAttribute('lang','en');
 await dictionary.getByRole('searchbox').fill('lend');await dictionary.getByRole('button',{name:'搜索',exact:true}).click();await expect(dictionary.getByRole('heading',{name:'lend',exact:true})).toHaveAttribute('lang','en');
 expect(sources.requests.filter(url=>url.includes('/definitions'))).toHaveLength(2);
 expect(sources.requests.filter(url=>url.includes('/definitions')).every(url=>new URL(url).searchParams.get('lang')==='en')).toBe(true);await dictionary.getByRole('button',{name:'返回上一页',exact:true}).click();
 await expect(runtime.getByRole('button',{name:/已经连上/})).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest())).toEqual(before);
 const location=page.url(),checkpoint=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 await runtime.locator('[data-learning-more]').click();await page.locator('#menu-more').getByRole('button',{name:'内容来源',exact:true}).click();
 const source=page.locator('#learning-source-reference');await expect(source.getByRole('heading',{name:'只读查词样本',exact:true})).toBeVisible();await expect(source.getByText('borrow',{exact:true})).toHaveAttribute('lang','en');
 await expect(source.getByRole('button',{name:/加入|更新|下载/u})).toHaveCount(0);await expect(source.getByRole('button',{name:'返回',exact:true})).toBeFocused();
 await source.getByRole('button',{name:'返回',exact:true}).click();await expect(source).toHaveCount(0);await expect(runtime.locator('[data-learning-more]')).toBeFocused();expect(page.url()).toBe(location);
 await runtime.locator('[data-learning-more]').click();await page.locator('#menu-more').getByRole('button',{name:'内容来源',exact:true}).click();await expect(source.getByRole('heading',{name:'只读查词样本',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await expect(source).toHaveCount(0);await expect(runtime.locator('[data-learning-more]')).toBeFocused();expect(page.url()).toBe(location);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(checkpoint);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest())).toEqual(before);
 await expect(german).toHaveAttribute('aria-checked','true');expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
});

test('reference quick lookup distinguishes confirmed missing from provider failure and retries without learning writes',async({page})=>{
 fixture.setRegistry([fixture.referenceDelivery.descriptor]);const sources=await fixture.referenceProviders(page),runtime=await fixture.startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:/查看表达/}).click();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());sources.mode='missing';
 await runtime.getByRole('button',{name:'查词：borrow',exact:true}).click();const quick=page.getByRole('dialog',{name:/borrow/});
 await expect(quick.getByRole('status')).toContainText('词典');await expect(quick.getByRole('status')).not.toContainText('暂时不可用');await expect(quick.getByRole('button',{name:'查看详细释义',exact:true})).toBeDisabled();
 await quick.getByRole('button',{name:'关闭快速查词',exact:true}).click();sources.mode='error';await runtime.getByRole('button',{name:'查词：borrow',exact:true}).click();
 await expect(quick.getByRole('status')).toContainText('暂时没有取得');await expect(quick.getByRole('status')).toContainText(/再试|重试/u);
 await quick.getByRole('button',{name:'关闭快速查词',exact:true}).click();sources.mode='ready';await runtime.getByRole('button',{name:'查词：borrow',exact:true}).click();
 await expect(quick.getByText('Fixture definition for borrow.')).toBeVisible();await quick.getByRole('button',{name:'关闭快速查词',exact:true}).click();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
});

test('a downloaded target opens its actual installed source and returns to the same target without changing learning',async({page})=>{
 fixture.setRegistry([fixture.referenceDelivery.descriptor]);const runtime=await fixture.startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());await page.goto(`${fixture.origin}/catalog`);
 await page.locator('#s-catalog').last().getByRole('button',{name:/只读查词样本/}).click();const book=page.locator('#s-catalog-book').last();
 await book.getByRole('button',{name:/borrow/}).click();const target=page.locator('#s-learning-target');
 await expect(target.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();const targetId=new URL(page.url()).searchParams.get('targetId');
 await target.getByRole('button',{name:/内容来源/}).click();const source=page.locator('#s-library-package');
 await expect(source.getByRole('heading',{name:'只读查词样本',exact:true})).toBeVisible();await expect(source.getByRole('button',{name:/borrow/})).toBeVisible();
 await source.getByRole('button',{name:'返回',exact:true}).click();await expect(target.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('targetId')).toBe(targetId);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
});

test('missing source cache stays unavailable offline and returning preserves the revealed learning Step without recovery writes',async({page,context})=>{
 fixture.setRegistry([fixture.referenceDelivery.descriptor]);const runtime=await fixture.startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:/查看表达/}).click();
 await expect(runtime.getByRole('button',{name:'查词：borrow',exact:true})).toBeVisible();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());
 await page.evaluate(()=>window.__sensaBrowserSmoke!.discardPackageCacheForRecoveryTest());await context.setOffline(true);
 try{
  await page.reload();await expect(runtime.getByRole('button',{name:'查词：borrow',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual([]);
  await runtime.locator('[data-learning-more]').click();await page.locator('#menu-more').getByRole('button',{name:'内容来源',exact:true}).click();const source=page.locator('#learning-source-reference');
  await expect(source.getByRole('status')).toHaveText('这里暂时没有正常打开');await expect(source.getByRole('heading',{name:'只读查词样本',exact:true})).toHaveCount(0);
  await expect(source.getByRole('button',{name:/下载|加入|更新/u})).toHaveCount(0);await source.getByRole('button',{name:'返回',exact:true}).click();
  await expect(source).toHaveCount(0);await expect(runtime.getByRole('button',{name:'查词：borrow',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest())).toEqual(facts);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual([]);
  const reads=await page.evaluate(()=>performance.getEntriesByType('measure').map(entry=>entry.name));
  for(const collectionRead of ['sensa.workspace.rehydrate','sensa.workspace.supply','sensa.workspace.prepare'])expect(reads).not.toContain(collectionRead);
 }finally{await context.setOffline(false);}
});

test('offline quick and full dictionary failures remain retryable and never change the current learning Step',async({page,context})=>{
 fixture.setRegistry([fixture.referenceDelivery.descriptor]);const runtime=await fixture.startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:/查看表达/}).click();await expect(runtime.getByRole('button',{name:'查词：borrow',exact:true})).toBeVisible();
 // Native Chromium transport errors rather than synthetic HTTP status errors.
 const transportFailures:string[]=[];page.on('requestfailed',request=>{if(['api.wiktapi.dev','api.dictionaryapi.dev','en.wiktionary.org'].includes(new URL(request.url()).hostname)&&request.failure()?.errorText.includes('ERR_INTERNET_DISCONNECTED'))transportFailures.push(request.url());});
 await page.route('**/sensa/model/turn',route=>route.fulfill({status:503,json:{code:'fixture_model_unavailable'}}));
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());await context.setOffline(true);
 try{
  await runtime.getByRole('button',{name:'查词：borrow',exact:true}).click();const quick=page.getByRole('dialog',{name:/borrow/u});await expect(quick.getByRole('status')).toContainText('暂时没有取得');await expect(quick.getByRole('button',{name:'查看详细释义',exact:true})).toBeDisabled();
  await quick.getByRole('button',{name:'关闭快速查词',exact:true}).click();
  await context.setOffline(false);const sources=await fixture.referenceProviders(page);
  await runtime.getByRole('button',{name:'查词：borrow',exact:true}).click();await expect(quick.getByText('Fixture definition for borrow.')).toBeVisible();await quick.getByRole('button',{name:'查看详细释义',exact:true}).click();
  const dictionary=page.locator('#s-reference-dictionary');await expect(dictionary.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
  await page.unroute('https://api.wiktapi.dev/**');await page.unroute('https://api.dictionaryapi.dev/**');await page.unroute('https://en.wiktionary.org/**');await context.setOffline(true);
  await dictionary.getByRole('searchbox').fill('anchor');await dictionary.getByRole('button',{name:'搜索',exact:true}).click();await expect(dictionary.getByRole('status')).toContainText('词典服务暂时不可用');await expect(dictionary.getByRole('heading',{name:'anchor',exact:true})).toHaveCount(0);
  expect(transportFailures.some(url=>url.includes('anchor')),'native transport failure reaches the actual dictionary host').toBe(true);
  await context.setOffline(false);await fixture.referenceProviders(page);await dictionary.getByRole('button',{name:'搜索',exact:true}).click();await expect(dictionary.getByRole('heading',{name:'anchor',exact:true})).toBeVisible();
  await dictionary.getByRole('button',{name:'返回上一页',exact:true}).click();await expect(runtime.getByRole('button',{name:'查词：borrow',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest())).toEqual(facts);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(sources.requests.some(url=>url.includes('/word/borrow/definitions'))).toBe(true);
 }finally{await context.setOffline(false);}
});

test('target source lookup keeps its exact publication when another Book shares the member and a newer edition is installed',async({page,context})=>{
 const first=fixture.reviewDelivery,files=unzipSync(first.bookBytes);
 const sharedManifest=sensaPortableBookManifestSchema.parse({...first.manifest,book:{...first.manifest.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:'reference-shared-source',title:'另一册来源'},members:[...first.manifest.members].reverse()});
 const nextManifest=sensaPortableBookManifestSchema.parse({...first.manifest,book:{...first.manifest.book,bookVersionId:randomUUID(),versionNumber:2,title:'新版来源'},contentRelease:{...first.manifest.contentRelease,contentReleaseId:randomUUID(),versionNumber:2}});
 const release=(manifest:typeof first.manifest)=>{
  const bytes=zipSync({...files,'book.json':new TextEncoder().encode(JSON.stringify(manifest))}),sha256=createHash('sha256').update(bytes).digest('hex');
  const descriptor={...first.descriptor,book:manifest.book,contentRelease:manifest.contentRelease,sha256,byteLength:bytes.byteLength,url:`${fixture.origin}/published/${sha256}.sensa-book`};
  first.responses.set(descriptor.url,bytes);return descriptor;
 };
 const shared=release(sharedManifest),next=release(nextManifest);
 fixture.setRegistry([shared,first.descriptor]);
 try{
  const runtime=await fixture.startOrdinaryBook(page,/到期复习样本/);await runtime.getByRole('button',{name:'暂停',exact:true}).click();
  const checkpoint=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),targetId=checkpoint.runtime!.targetId;
  await page.goto(`${fixture.origin}/catalog`);const catalog=page.locator('#s-catalog').last(),book=page.locator('#s-catalog-book').last();
  await catalog.getByRole('button',{name:/另一册来源/}).click();await book.getByRole('button',{name:'下载学习包',exact:true}).click();await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();
  const verifySource=async(offline=false)=>{
   await page.goto(`${fixture.origin}/study/learning-target?targetId=${targetId}`);const target=page.locator('#s-learning-target');
   await expect(target.getByRole('button',{name:/内容来源/})).toBeVisible();const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
   if(offline)await context.setOffline(true);
   try{
   await target.getByRole('button',{name:/内容来源/}).click();const source=page.locator('#s-library-package');
   await expect(source.getByRole('heading',{name:first.manifest.book.title,exact:true})).toBeVisible();
   await expect(source.getByText('v1',{exact:true})).toBeVisible();await expect(source.getByRole('button',{name:/加入学习|应用更新|下载更新/u})).toHaveCount(0);
   await source.getByRole('button',{name:'返回',exact:true}).click();await expect(target.getByRole('button',{name:/内容来源/})).toBeVisible();expect(new URL(page.url()).searchParams.get('targetId')).toBe(targetId);
   expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);
   }finally{if(offline)await context.setOffline(false);}
  };
  await verifySource();
  fixture.setRegistry([shared,next]);await page.goto(`${fixture.origin}/catalog`);await catalog.getByRole('button',{name:'刷新',exact:true}).click();await expect(catalog.getByRole('button',{name:/新版来源/})).toBeVisible();
  await catalog.getByRole('button',{name:/新版来源/}).click();await book.getByRole('button',{name:'下载更新',exact:true}).click();await expect(book.getByRole('button',{name:'应用更新',exact:true})).toBeEnabled();
  await verifySource(true);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(checkpoint);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
 }finally{first.responses.delete(shared.url);first.responses.delete(next.url);}
});

test('learning questions are optional, readonly, cancellable and unavailable offline without blocking learning',async({page,context})=>{
 await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:fixture.storageKey,value:fixture.session()});
 let calls=0,release:undefined|(()=>void);
 await page.route('**/sensa/model/turn',async route=>{
  calls++;
  const input=route.request().postDataJSON() as {id:string;inputDigest:string;body:{messages:{content:string}[]}};
  expect(JSON.stringify(input.body.messages)).toContain('borrow');
  expect(JSON.stringify(input.body.messages)).not.toMatch(/data:|audioUrl|imageUrl/);
  if(calls===1)expect(JSON.stringify(input.body.messages)).not.toContain('lj07-private-scene');
  if(calls===2)expect(JSON.stringify(input.body.messages)).toContain('lj07-private-scene');
  if(calls===3)await new Promise<void>(resolve=>{release=resolve;});
  await route.fulfill({json:{id:input.id,inputDigest:input.inputDigest,response:{model:'fixture-model',choices:[{finish_reason:'stop',message:{content:'借入是 borrow；借出是 lend。这里说的是临时借入雨伞。'}}]}}}).catch(()=>{});
 });
 const runtime=await fixture.startOrdinaryBook(page);
 await runtime.getByRole('button',{name:/查看表达/}).click();
 await expect(runtime.getByRole('button',{name:'学习提问',exact:true})).toBeVisible();expect(calls).toBe(0);
 await runtime.getByRole('button',{name:'添加我的场景',exact:true}).click();
 const editor=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'我的场景',exact:true})});
 await editor.getByRole('textbox').fill('lj07-private-scene：我向同事借一把伞，第二天归还。');
 await editor.getByRole('button',{name:'保存我的场景',exact:true}).click();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 await runtime.getByRole('button',{name:'学习提问',exact:true}).click();
 const question=page.getByRole('dialog',{name:'学习提问',exact:true});
 const consent=question.getByRole('checkbox',{name:/向 .*Sensa.* 分享当前个人场景/});await expect(consent).not.toBeChecked();
 await question.getByRole('textbox',{name:'你的问题',exact:true}).fill('这里可以换成 lend 吗？');
 await question.getByRole('button',{name:'提问',exact:true}).click();
 await expect(question.getByRole('log')).toContainText('借入是 borrow');
 expect(calls).toBe(1);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);
 await consent.check();
 await question.getByRole('textbox',{name:'你的问题',exact:true}).fill('在我的场景里可以怎样说？');
 await question.getByRole('button',{name:'提问',exact:true}).click();await expect.poll(()=>calls).toBe(2);
 await expect(consent).toBeEnabled();
 await consent.uncheck();await expect(question.getByRole('log')).toBeEmpty();
 await question.getByRole('textbox',{name:'你的问题',exact:true}).fill('能给我一个更短的例子吗？');
 await question.getByRole('button',{name:'提问',exact:true}).click();await expect.poll(()=>calls).toBe(3);
 await question.getByRole('button',{name:'关闭',exact:true}).click();release?.();
 await expect(question).toHaveCount(0);await expect(runtime.getByRole('button',{name:/还没连上/})).toBeEnabled();
 await context.setOffline(true);
 try{
  await runtime.getByRole('button',{name:'学习提问',exact:true}).click();await expect(question.getByRole('status')).toContainText('离线');
  await expect(question.getByRole('button',{name:'提问',exact:true})).toBeDisabled();
  await question.getByRole('button',{name:'关闭',exact:true}).click();
  await runtime.getByRole('button',{name:/还没连上/}).click();await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toEqual([]);
  await runtime.getByRole('button',{name:/查看表达/}).click();await expect(runtime.getByRole('button',{name:/已经连上/})).toBeEnabled();
  await runtime.getByRole('button',{name:/已经连上/}).click();await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toHaveLength(1);
  await runtime.getByRole('button',{name:/完成并回到首页/}).click();await expect(page.locator('#s-home').getByRole('heading',{name:'今天',level:1,exact:true})).toBeVisible();
 }finally{await context.setOffline(false);}
});

test('practice content selection and listening start stay bounded with 10000 personal Meanings',{tag:'@capacity'},async({page,context,browser},testInfo)=>{
 // Bulk fixture construction is outside the interaction budget below.
 test.setTimeout(300_000);
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
 fixture.semanticScaleFixture=syntheticSemanticWorld(await repository.load(),10_000);fixture.setRegistry([fixture.referenceDelivery.descriptor]);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.route('https://youglish.com/public/emb/widget.js',route=>route.fulfill({contentType:'text/javascript',body:`
 window.YG={Widget:class{
  constructor(id,options){this.events=options.events;}
  fetch(){queueMicrotask(()=>{this.events.onFetchDone({totalResult:2});this.events.onPlayerReady();this.events.onPlayerStateChange({state:2});});}
  pause(){}close(){}play(){this.events.onPlayerStateChange({state:1});}next(){}previous(){}replay(){}move(){}setSpeed(speed){this.events.onSpeedChange({speed});}
 }};window.onYouglishAPIReady();
 `}));
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.locator('#s-home')).toBeVisible();
 expect(await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await(await fetch('/semantic-scale-fixture')).json()))).toBe(10_000);
 const runtime=await fixture.startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());
 const timings:Array<{action:string;elapsedMs:number;phases:Array<{name:string;durationMs:number}>}>=[];
 const timed=async(action:string,work:()=>Promise<void>)=>{
  const start=await page.evaluate(()=>performance.timeOrigin+performance.now());await work();
  timings.push(await page.evaluate(({start,action})=>({action,elapsedMs:performance.timeOrigin+performance.now()-start,phases:performance.getEntriesByType('measure').filter(entry=>performance.timeOrigin+entry.startTime>=start&&entry.name.startsWith('sensa.journey.')).map(entry=>({name:entry.name,durationMs:entry.duration}))}),{start,action}));
  console.log('LJ-15 local interaction:',JSON.stringify(timings.at(-1)));
 };
 const practice=page.locator('#s-academy').last(),scope=page.locator('#s-practice-scope').last(),listening=page.locator('#s-real-world-listening');
 try{
  await timed('openPracticeWithUnrelatedPersonalWorld',async()=>{
   await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'练习',exact:true}).click();
   await expect(practice.locator('.sensa-practice-activities').getByRole('button')).toBeEnabled({timeout:60_000});
  });
  await timed('openPersonalContentSelection',async()=>{
   await practice.getByRole('button',{name:/练习材料/u}).click();await scope.getByRole('button',{name:'我的语义世界',exact:true}).click();
   await expect(scope.getByRole('listitem').first()).toBeVisible({timeout:60_000});
   expect(await scope.getByRole('listitem').count()).toBeLessThan(80);await expect(scope).not.toContainText('May asked');
  });
  await timed('selectAndUseAllPersonalContent',async()=>{
   await scope.getByRole('button',{name:'全选',exact:true}).click();await scope.getByRole('button',{name:'使用 10000 个表达',exact:true}).click();
   await expect(practice.getByText('10000 个表达',{exact:true})).toBeVisible();
   expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sensa:web-ui:v1:sensa.practice.materials.v4:en')!))).toEqual({source:'personal',expressionIds:null});
  });
  await timed('startListeningWithPersonalContent',async()=>{
   await practice.locator('.sensa-practice-activities').getByRole('button').click();await expect(listening.getByRole('button',{name:'播放',exact:true})).toBeEnabled();await expect(listening.getByRole('status')).toHaveCount(0);
   await expect(listening.locator('select')).toHaveCount(1); // playback speed only; no 10k-option expression selector.
  });
  await timed('searchAndChooseOneExpression',async()=>{
   await listening.getByRole('button',{name:/^选择表达 · borrow-/u}).click();await scope.getByRole('searchbox').fill('borrow-9999');
   await scope.getByRole('button',{name:'borrow-9999',exact:true}).click();await expect(listening.getByRole('button',{name:'选择表达 · borrow-9999',exact:true})).toBeVisible();
   await expect(listening.getByRole('button',{name:'播放',exact:true})).toBeEnabled();
  });
  await timed('restoreTheSameExpressionAfterReload',async()=>{
   await page.reload();await expect(listening.getByRole('button',{name:'选择表达 · borrow-9999',exact:true})).toBeVisible();
   await expect(listening.getByRole('button',{name:'播放',exact:true})).toBeEnabled();
  });
  await timed('returnAndContinueTheSameExpression',async()=>{
   await listening.getByRole('button',{name:'返回',exact:true}).click();
   await practice.locator('.sensa-practice-activities').getByRole('button').click();
   await expect(listening.getByRole('button',{name:'选择表达 · borrow-9999',exact:true})).toBeVisible();
   await expect(listening.getByRole('button',{name:'播放',exact:true})).toBeEnabled();
  });
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest())).toEqual(before);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(10_000);
  }finally{
  const report={platform:process.platform,arch:process.arch,cpuModel:cpus()[0]?.model??'unknown',browser:browser.version(),cpuThrottle:1,network:'loopback',provider:'controlled SDK; no online media',personalMeanings:10_000,senses:fixture.semanticScaleFixture.registry.senses.length,fixtureBytes:Buffer.byteLength(JSON.stringify(fixture.semanticScaleFixture)),media:'text-only personal data; one small compiled Book',budgetMs:1500,timings};
  console.log('LJ-15 practice / synthetic 10k personal Meanings / Chromium+OPFS / 1x CPU / loopback / no model:',JSON.stringify(report));
  await testInfo.attach('practice-capacity-10000.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});
 }
 expect(timings).toHaveLength(7);
 for(const timing of timings){assertInteractionBudget(timing.elapsedMs,1500,`${timing.action}: local interaction, not provider latency`);}
});

test('practice preparation, cancel, timeout and player retry report only actual playback confirmations and preserve all learner facts',async({page},testInfo)=>{
 fixture.setRegistry([fixture.referenceDelivery.descriptor]);await page.clock.install();await page.addInitScript(()=>{(window as any).__practiceMode='preparing';});
 await page.route('https://youglish.com/public/emb/widget.js',route=>route.fulfill({contentType:'text/javascript',body:`
 window.__practiceFixture={instances:[],closed:0};window.YG={Widget:class{
 constructor(id,options){this.events=options.events;window.__practiceFixture.instances.push(this);this.root=document.getElementById(id);const frame=document.createElement('iframe');frame.title='Controlled practice player';frame.style.cssText='height:640px;width:'+options.width+'px';frame.srcdoc='<p>Controlled provider; no real playback</p>';this.root.append(frame);}
 fetch(){if(window.__practiceMode==='ready')queueMicrotask(()=>{this.events.onFetchDone({totalResult:2});this.events.onPlayerReady();this.events.onPlayerStateChange({state:2});});}
 play(){this.events.onPlayerStateChange({state:1});}pause(){this.events.onPlayerStateChange({state:2});}setSpeed(speed){this.events.onSpeedChange({speed});}move(){}next(){}previous(){}replay(){}close(){window.__practiceFixture.closed++;this.root.replaceChildren();}
 }};window.onYouglishAPIReady();
 `}));
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await page.locator('#s-home').getByRole('button',{name:'学习包目录',exact:true}).click();await page.locator('#s-catalog').getByRole('button',{name:/只读查词样本/}).click();await page.locator('#s-catalog-book').getByRole('button',{name:'下载学习包',exact:true}).click();await expect(page.locator('#s-catalog-book').getByText('已下载',{exact:true})).toBeVisible();
 await page.goto(fixture.origin+'/academy');const practice=page.locator('#s-academy'),activity=practice.locator('.sensa-practice-activities').getByRole('button'),listening=page.locator('#s-real-world-listening');
 const checkpoint=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest()),sources=await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest());
 await expect(activity).toBeEnabled();await activity.click();await expect(listening.getByRole('button',{name:'播放',exact:true})).toBeDisabled();await expect(listening.getByRole('status').filter({hasText:'正在'})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('practice-player-preparing.png')});await listening.locator('header').getByRole('button',{name:'返回',exact:true}).click();await expect(practice.getByText('本次尚未收到播放确认。',{exact:true})).toBeVisible();
 await page.evaluate(()=>{const old=(window as any).__practiceFixture.instances[0].events;old.onFetchDone({totalResult:2});old.onPlayerReady();old.onPlayerStateChange({state:1});});await expect(practice.getByText('本次尚未收到播放确认。',{exact:true})).toBeVisible();await expect(listening).toHaveCount(0);
 await activity.click();await expect.poll(()=>page.evaluate(()=>(window as any).__practiceFixture.instances.length)).toBe(2);await page.clock.fastForward(16000);await expect(listening.getByRole('alert')).toBeVisible();await expect(listening.getByRole('button',{name:'播放',exact:true})).toBeDisabled();
 await page.evaluate(()=>{(window as any).__practiceMode='ready';});await listening.getByRole('button',{name:'重新加载',exact:true}).click();await expect(listening.getByRole('button',{name:'播放',exact:true})).toBeEnabled();
 await page.evaluate(()=>{const instances=(window as any).__practiceFixture.instances;instances.at(-1).events.onError();});await expect(listening.getByRole('alert')).toBeVisible();await listening.getByRole('button',{name:'重新加载',exact:true}).click();await expect(listening.getByRole('button',{name:'播放',exact:true})).toBeEnabled();
 await listening.getByRole('button',{name:'播放',exact:true}).click();await expect(listening.getByRole('button',{name:'暂停',exact:true})).toBeEnabled();await listening.getByRole('button',{name:'暂停',exact:true}).click();await listening.getByRole('button',{name:'播放',exact:true}).click();
 await page.setViewportSize({width:320,height:740});await listening.getByRole('button',{name:'结束本次聆听',exact:true}).click();const result=practice.getByRole('region',{name:'刚才的聆听',exact:true});await expect(result.getByText('本次收到播放确认的不同表达：1 个。',{exact:true})).toBeVisible();await result.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('practice-session-result-320px.png')});expect(await practice.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
 await activity.click();await expect(listening.getByRole('button',{name:'播放',exact:true})).toBeEnabled();
 // A confirmed play and exit in the same event turn must not rely on a later
 // React effect to preserve the observed result.
 await page.evaluate(()=>{const root=document.getElementById('s-real-world-listening')!;(root.querySelector('button[aria-label="播放"]') as HTMLButtonElement).click();([...root.querySelectorAll('button')].find(button=>button.textContent==='结束本次聆听') as HTMLButtonElement).click();});
 await expect(result.getByText('本次收到播放确认的不同表达：1 个。',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(checkpoint);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest())).toEqual(facts);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest())).toEqual(sources);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);
});
