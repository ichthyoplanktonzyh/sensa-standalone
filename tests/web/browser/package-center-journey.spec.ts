/** Relocated book assertions: real Chromium/OPFS, controlled services. */
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
import {createPortableBookPreview,createSensaPortableBook,portableBookMemberKey,portableBookMemberPath,readSensaPortableBook} from '@sensa/content-validator/portable-book';
import {canonicalConsumerJson,sensaPortableBookDescriptorSchema,sensaPortableBookManifestSchema} from '@sensa/contracts/sensa';
import {portablePackageFixture,portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {cors} from 'hono/cors';
import {localSensaCorsOptions} from '../../../scripts/local/localCors.mts';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {semanticLookupPayload,syntheticSemanticWorld} from '../support/semanticLookupFixtures';
import type {JourneyState} from '../../../apps/web/src/experience/personalMeaningJourney/store';
import type {ContextRecord,StoredMeaningRecord} from '../../../apps/web/src/experience/personalMeaningJourney/contextRecords';
import {decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {createPackageCenterFixture} from './packageCenterFixture';
const fixture=createPackageCenterFixture('book');
const test=fixture.test;

test('complete catalog pages retain URL, scroll and focus through details and recover filters on narrow and zoomed screens',async({page},testInfo)=>{
 const descriptors=Array.from({length:137},(_,index)=>({
  ...fixture.delivery.descriptor,
  book:{...fixture.delivery.descriptor.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:`catalog-fixture-${index}`,title:index===136?'深处的真实检索样本':index===130?'长标题内容'.repeat(28):`目录样本 ${String(index).padStart(3,'0')}`},
  route:{targetLanguage:index%2?'ja':'en',supportLanguage:'zh-Hans'},
  publishedAt:'2026-10-10T00:00:00Z',
 }));
 fixture.setRegistry(descriptors);
 await page.goto(`${fixture.origin}/catalog?page=2&pageSize=24&view=cards&sort=title`);
 const catalog=page.locator('#s-catalog').last(),book=page.locator('#s-catalog-book').last();
 await expect(catalog.getByText('第 25–48 项，共 137 项',{exact:true})).toBeVisible();
 await expect(catalog.locator('[data-package-key]')).toHaveCount(24);
 await page.screenshot({path:testInfo.outputPath('catalog-desktop-toolbar-page-2.png')});
 await expect(catalog.getByRole('button',{name:'第 6 页',exact:true})).toBeVisible();
 const card=catalog.locator('[data-package-key]').nth(12),key=await card.getAttribute('data-package-key');
 await card.scrollIntoViewIfNeeded();await card.focus();
 const scroll=await catalog.evaluate(element=>element.scrollTop);
 await card.press('Enter');
 await expect(book.getByRole('heading',{name:descriptors.find(item=>item.book.bookKey===key)!.book.title,exact:true})).toBeVisible();
 expect(new URL(page.url()).searchParams.get('page')).toBe('2');
 await book.getByRole('button',{name:'返回',exact:true}).click();
 await expect(catalog.locator(`[data-package-key="${key}"]`)).toBeFocused();
 expect(Math.abs(await catalog.evaluate(element=>element.scrollTop)-scroll)).toBeLessThan(3);
 await page.screenshot({path:testInfo.outputPath('catalog-desktop-page-2.png')});
 await catalog.getByRole('button',{name:'第 6 页',exact:true}).click();
 await expect(catalog.getByText('第 121–137 项，共 137 项',{exact:true})).toBeVisible();
 await expect(catalog.locator('[data-package-key]')).toHaveCount(17);
 await expect(catalog.getByRole('button',{name:'下一页',exact:true})).toBeDisabled();
 await catalog.getByRole('searchbox',{name:'搜索学习包'}).pressSequentially('深处',{delay:50});
 await expect(catalog.getByRole('searchbox',{name:'搜索学习包'})).toBeFocused();
 await expect(catalog.getByText('第 1–1 项，共 1 项',{exact:true})).toBeVisible();
 expect(new URL(page.url()).searchParams.get('page')).toBe('1');
 await expect(catalog.getByRole('button',{name:/深处的真实检索样本/})).toBeVisible();
 await catalog.getByRole('searchbox',{name:'搜索学习包'}).fill('不存在的查询');
 await expect(catalog.getByText('没有找到匹配的学习包',{exact:true})).toBeVisible();
 await catalog.getByRole('button',{name:'清除',exact:true}).click();
 await catalog.getByRole('combobox',{name:'目标语言',exact:true}).selectOption('ja');
 await expect(catalog.getByText('第 1–24 项，共 68 项',{exact:true})).toBeVisible();
 await catalog.getByRole('combobox',{name:'辅助语言',exact:true}).selectOption('zh-Hans');
 await catalog.locator('summary').filter({hasText:'浏览选项'}).click();
 await catalog.getByRole('combobox',{name:'每页数量',exact:true}).selectOption('48');
 await catalog.getByRole('combobox',{name:'排序',exact:true}).selectOption('newest');
 await catalog.locator('summary').filter({hasText:'浏览选项'}).click();
 await catalog.getByRole('button',{name:'紧凑列表',exact:true}).click();
 await page.reload();
 await expect(catalog.getByText('第 1–48 项，共 68 项',{exact:true})).toBeVisible();
 await expect(catalog.getByRole('button',{name:'紧凑列表',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(catalog.getByRole('combobox',{name:'目标语言',exact:true})).toHaveValue('ja');
 await catalog.getByRole('combobox',{name:'目标语言',exact:true}).selectOption('');
 await catalog.getByRole('searchbox',{name:'搜索学习包'}).fill('长标题内容');
 await page.setViewportSize({width:390,height:844});
 await expect(catalog.locator('[data-package-key]')).toHaveCount(1);
 expect(await catalog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('catalog-narrow-long-title.png')});
 await page.setViewportSize({width:1280,height:900});
 await page.evaluate(()=>document.documentElement.style.zoom='2');
 expect(await catalog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await catalog.getByRole('searchbox',{name:'搜索学习包'}).focus();await page.keyboard.press('Tab');
 await expect(catalog.getByRole('button',{name:'清除',exact:true})).toBeFocused();
 await page.screenshot({path:testInfo.outputPath('catalog-200-percent-css-zoom.png')});
 const checkpoint=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(checkpoint.enrollments).toEqual([]);expect(checkpoint.records).toEqual([]);
});

test('catalog disclosures and real preview content retain their meaning across Chinese English and German at desktop and narrow widths',async({page},testInfo)=>{
 fixture.setRegistry([fixture.learningDelivery.descriptor]);
 await page.goto(`${fixture.origin}/catalog`);
 const catalog=page.locator('#s-catalog'),book=page.locator('#s-catalog-book');
 const ui=[
  {locale:'zh-CN',search:'搜索学习包',options:'浏览选项',pageSize:'每页数量',download:'下载学习包',join:'加入学习',back:'返回',publication:'发布信息'},
  {locale:'en',search:'Search learning packages',options:'Browse options',pageSize:'Items per page',download:'Download package',join:'Add to learning',back:'Back',publication:'Publication'},
  {locale:'de',search:'Lernpakete durchsuchen',options:'Ansichtsoptionen',pageSize:'Einträge pro Seite',download:'Paket herunterladen',join:'Zum Lernen hinzufügen',back:'Zurück',publication:'Veröffentlichung'},
 ];
 for(const copy of ui){
  await page.getByRole('combobox',{name:/界面语言|Interface language|Oberflächensprache/}).selectOption(copy.locale);
  await expect(catalog.getByRole('searchbox',{name:copy.search,exact:true})).toBeVisible();
  await expect(catalog.getByRole('combobox',{name:copy.pageSize,exact:true})).toBeHidden();
  await catalog.locator('summary').filter({hasText:copy.options}).click();
  await catalog.getByRole('combobox',{name:copy.pageSize,exact:true}).selectOption('96');
  expect(new URL(page.url()).searchParams.get('pageSize')).toBe('96');
  await catalog.locator('summary').filter({hasText:copy.options}).click();
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});
   expect(await catalog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
   await page.screenshot({path:testInfo.outputPath(`catalog-${copy.locale}-${width}.png`)});
  }
  await catalog.getByRole('button',{name:/雨天借伞/}).click();
  await expect(book.getByRole('heading',{name:'雨天借伞',level:1,exact:true})).toBeVisible();
  await expect(book.getByRole('article',{name:'borrow',exact:true})).toBeVisible();
  await expect(book.getByRole('button',{name:copy.download,exact:true})).toBeEnabled();
  await expect(book.getByRole('button',{name:copy.join,exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual([]);
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});
   expect(await book.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
   await page.screenshot({path:testInfo.outputPath(`detail-${copy.locale}-${width}.png`)});
  }
  await book.getByRole('button',{name:copy.back,exact:true}).click();
 }
});

test('catalog failure is distinct from empty results and an interrupted stale response cannot replace a newer retry',async({page,context})=>{
 let requests=0,release!:()=>void;
 const held=new Promise<void>(resolve=>release=resolve);
 const older=fixture.registry;
 await context.route('**/sensa/packages?bookPreview=1',async route=>{
  requests++;
  if(requests===1){await route.fulfill({status:503,headers:{'access-control-allow-origin':fixture.origin},body:'unavailable'});return;}
  if(requests===2){await held;await route.fulfill({headers:{'access-control-allow-origin':fixture.origin,'content-type':'application/json'},body:JSON.stringify(older)}).catch(()=>{});return;}
  await route.continue();
 });
 try{
  await page.goto(`${fixture.origin}/catalog?page=999`);
  const catalog=page.locator('#s-catalog').last();
  await expect(catalog.getByRole('alert')).toContainText('暂时无法更新目录');
  await expect(catalog.getByText('没有找到匹配的学习包',{exact:true})).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('page')).toBe('999');
  await catalog.getByRole('button',{name:'重试',exact:true}).click();
  await expect.poll(()=>requests).toBe(2);
  await expect(catalog.getByRole('button',{name:'正在更新目录…',exact:true})).toBeDisabled();
  fixture.setRegistry([fixture.reviewDelivery.descriptor]);
  await catalog.getByRole('searchbox',{name:'搜索学习包'}).fill(fixture.reviewDelivery.descriptor.book.title);
  await page.reload();
  await expect(catalog.getByText('第 1–1 项，共 1 项',{exact:true})).toBeVisible();
  release();
  await expect(catalog.locator('[data-package-key]')).toHaveCount(1);
  await expect(catalog.getByRole('alert')).toHaveCount(0);
  await page.goto(`${fixture.origin}/catalog?page=999&pageSize=96`);
  await expect(catalog.getByText('第 1–1 项，共 1 项',{exact:true})).toBeVisible();
  await expect.poll(()=>new URL(page.url()).searchParams.get('page')).toBe('1');
  fixture.setRegistry([]);
  await catalog.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(catalog.getByText('第 0–0 项，共 0 项',{exact:true})).toBeVisible();
  await expect(catalog.getByText('暂无学习包',{exact:true})).toBeVisible();
  await page.reload();
  await expect(catalog.getByText('第 0–0 项，共 0 项',{exact:true})).toBeVisible();
 }finally{release();}
});


const previewBeforeDownload=(mode:'legacy'|'lightweight')=>async({page,context}:{page:Page;context:BrowserContext},testInfo:TestInfo)=>{
 const source=[
  {expression:'borrow',scene:'下雨时，Mia 向同事借了一把伞，并约定明天归还。',meaning:'暂时取得他人的物品，预期归还。',example:'Could I borrow your umbrella?'},
  {expression:'lend',scene:'同事把自己的伞暂时交给 Mia 使用，并希望明天收回。',meaning:'把物品暂时交给别人，预期收回。',example:'I can lend you my umbrella.'},
  {expression:'return',scene:'第二天，Mia 把借来的伞交回给同事。',meaning:'把借来的物品交回给原来的人。',example:'I will return your umbrella tomorrow.'},
 ];
 const members=source.map(value=>portablePackageFixture({...value,packageId:randomUUID()}));
 const manifest=sensaPortableBookManifestSchema.parse({...fixture.delivery.manifest,
  book:{...fixture.delivery.manifest.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:`preview-${mode}`,title:`下载前内容预览 ${mode}`},
  members:members.map(member=>({packageId:member.package.metadata.packageId,version:member.package.metadata.version})),
 });
 const bytes=createSensaPortableBook(manifest,new Map(members.map(member=>[portableBookMemberKey(member.package.metadata),member.bytes])));
 const archive=readSensaPortableBook(bytes),previewBytes=Buffer.from(canonicalConsumerJson(createPortableBookPreview(archive)));
 const url=`${fixture.origin}/published/preview-${mode}.sensa-book`,previewUrl=`${fixture.origin}/published/preview-${mode}.preview.json`;
 const {preview:_sourcePreview,...baseDescriptor}=fixture.delivery.descriptor;
 const descriptor=sensaPortableBookDescriptorSchema.parse({...baseDescriptor,book:manifest.book,memberCount:3,byteLength:bytes.byteLength,sha256:archive.archiveDigest,url,
  ...(mode==='lightweight'?{preview:{url:previewUrl,sha256:createHash('sha256').update(previewBytes).digest('hex'),byteLength:previewBytes.byteLength}}:{}),
 });
 fixture.setRegistry([descriptor]);
 let fail=true,previewRequests=0,archiveRequests=0;
 await context.route(url,route=>{archiveRequests++;return mode==='legacy'?(previewRequests++,route.fulfill({status:fail?503:200,body:fail?Buffer.from('unavailable'):Buffer.from(bytes)})):route.fulfill({status:500,body:'preview must not fetch this archive'});});
 if(mode==='lightweight')await context.route(previewUrl,route=>{previewRequests++;return route.fulfill({status:fail?503:200,contentType:'application/json',body:fail?Buffer.from('unavailable'):previewBytes});});
 await page.goto(`${fixture.origin}/catalog`);
 await page.locator('#s-catalog').getByRole('button',{name:new RegExp(manifest.book.title)}).click();
 const book=page.locator('#s-catalog-book'),preview=book.getByRole('region',{name:'查看内容预览',exact:true});
 await expect(preview.getByText('尚未提供',{exact:true})).toHaveCount(0);
 await expect(preview.getByRole('alert')).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual([]);
 await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeDisabled();
 fail=false;
 await preview.getByRole('button',{name:'重试',exact:true}).click();
 await expect(preview.getByRole('article')).toHaveCount(3);
 for(const value of source){
  const sample=preview.getByRole('article',{name:value.expression,exact:true});
  await expect(sample.getByText(value.scene,{exact:true})).toBeVisible();
  await expect(sample.locator('.sensa-package-sample-more').getByText(value.meaning,{exact:true})).not.toBeVisible();
  await expect(sample.getByText(value.example,{exact:true})).toBeVisible();
  await sample.locator('summary').filter({hasText:'补充内容'}).click();
  await expect(sample.locator('.sensa-package-sample-more').getByText(value.meaning,{exact:true})).toBeVisible();
  await sample.locator('summary').filter({hasText:'补充内容'}).click();
 }
 await expect(preview.getByText('内容目录：3 个表达',{exact:true})).toBeVisible();
 await expect(preview.locator('li')).toHaveCount(3);
 await preview.locator('summary').filter({hasText:'发布信息'}).click();
 await expect(preview.getByText('Sensa test fixture',{exact:true})).toBeVisible();
 await expect(preview.getByText('CC0',{exact:true})).toBeVisible();
 await expect(book.getByRole('button',{name:'下载学习包',exact:true})).toBeEnabled();
 await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeDisabled();
 expect(previewRequests).toBe(2);expect(archiveRequests).toBe(mode==='legacy'?2:0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual([]);
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(facts.enrollments).toEqual([]);expect(facts.targetIds).toEqual([]);expect(facts.records).toEqual([]);
 await preview.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`${mode}-preview-three-real-samples.png`)});
 await page.setViewportSize({width:320,height:740});
 expect(await book.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath(`${mode}-preview-320px.png`)});
 await page.reload();
 await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeDisabled();
 await expect(preview.getByRole('article')).toHaveCount(3);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual([]);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(facts);
};
test('before-download legacy preview shows real scenes, meanings and expressions and retries without installation',previewBeforeDownload('legacy'));
test('before-download lightweight preview shows real scenes, meanings and expressions and retries without installation',previewBeforeDownload('lightweight'));

test('leaving a pending legacy preview cancels it and cannot replace another Book preview',async({page,context},testInfo)=>{
 fixture.setRegistry([fixture.delivery.descriptor,fixture.reviewDelivery.descriptor]);
 let started=false,release!:()=>void;
 const held=new Promise<void>(resolve=>release=resolve);
 await context.route(fixture.delivery.descriptor.preview!.url,async route=>{
  started=true;await held;
  await route.fulfill({body:Buffer.from(fixture.delivery.responses.get(fixture.delivery.descriptor.preview!.url)!)}).catch(()=>{});
 });
 try{
  await page.goto(`${fixture.origin}/catalog`);
  const catalog=page.locator('#s-catalog'),book=page.locator('#s-catalog-book');
  await catalog.getByRole('button',{name:/English route essentials/}).click();
  await expect.poll(()=>started).toBe(true);
  await book.getByRole('button',{name:'返回',exact:true}).click();
  await catalog.getByRole('button',{name:/到期复习样本/}).click();
  const preview=book.getByRole('region',{name:'查看内容预览',exact:true});
  await expect(preview.getByRole('article')).toHaveCount(2);
  release();
  await expect(preview.getByText('内容目录：2 个表达',{exact:true})).toBeVisible();
  await expect(preview.getByText('fixture-002',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual([]);
  const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
  expect(facts.enrollments).toEqual([]);expect(facts.targetIds).toEqual([]);expect(facts.records).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('preview-late-old-response-preserves-current-book.png')});
 }finally{release();}
});

test('detail metadata and real samples survive repeated download, cancel, return and retry without enrolling until confirmation',async({page,context},testInfo)=>{
 await page.goto(`${fixture.origin}/catalog?query=English&page=1&pageSize=24&view=list&sort=title`);
 const catalog=page.locator('#s-catalog').last(),book=page.locator('#s-catalog-book').last();
 await catalog.getByRole('button',{name:/English route essentials/}).click();
 await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeDisabled();
 await book.locator('summary').filter({hasText:'发布信息'}).click();
 await expect(book.getByText(fixture.delivery.descriptor.publisher.name,{exact:true})).toBeVisible();
 await expect(book.getByText('v1',{exact:true})).toBeVisible();
 await expect(book.getByText('尚未提供',{exact:true})).toHaveCount(0);
 await expect(book.getByText('下载保存内容；加入学习需另行确认。',{exact:true})).toHaveCount(0);
 await page.screenshot({path:testInfo.outputPath('book-detail-before-download.png')});
 const path=new URL(fixture.delivery.descriptor.url).pathname;
 fixture.heldArchivePath=path;
 await book.getByRole('button',{name:'下载学习包',exact:true}).dblclick();
 await expect(book.getByRole('progressbar',{name:'下载学习包'})).toBeVisible();
 await expect.poll(()=>fixture.delivered.filter(item=>item===path).length).toBe(1);
 await book.getByRole('button',{name:'返回',exact:true}).click();
 await expect(catalog.getByRole('button',{name:/English route essentials.*正在下载/})).toBeVisible();
 await catalog.getByRole('button',{name:/English route essentials/}).click();
 await expect(book.getByRole('button',{name:'取消下载',exact:true})).toBeVisible();
 await book.getByRole('button',{name:'取消下载',exact:true}).click();
 await expect(book.getByRole('button',{name:'下载学习包',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual([]);
 fixture.heldArchivePath=null;
 let corrupt=true;
 await context.route('**/*.sensa-book',route=>corrupt?route.fulfill({status:200,body:'invalid isolated book'}):route.continue());
 await book.getByRole('button',{name:'下载学习包',exact:true}).click();
 await expect(book.getByRole('region',{name:'学习包操作',exact:true}).getByRole('alert')).toBeVisible();
 await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual([]);
 corrupt=false;
 await book.getByRole('button',{name:'下载学习包',exact:true}).click();
 await expect(book.getByText('已下载',{exact:true})).toBeVisible();
 await expect(book.getByRole('button',{name:'已下载到本机',exact:true})).toBeDisabled();
 await book.locator('summary').filter({hasText:'发布信息'}).click();
 await expect(book.getByText('Sensa test fixture',{exact:true})).toBeVisible();
 await expect(book.getByText('CC0',{exact:true})).toBeVisible();
 await expect(book.getByText('以下表达与含义来自已下载的 v1。',{exact:true})).toBeVisible();
 await expect(book.getByRole('region',{name:'包内内容',exact:true}).locator('li')).toHaveCount(3);
 let checkpoint=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(checkpoint.enrollments).toEqual([]);expect(checkpoint.targetIds).toEqual([]);expect(checkpoint.records).toEqual([]);
 await page.screenshot({path:testInfo.outputPath('book-detail-saved-metadata.png')});
 await book.getByRole('region',{name:'包内内容',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:testInfo.outputPath('book-detail-real-samples.png')});
 await page.evaluate(()=>document.documentElement.style.zoom='2');
 expect(await book.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('book-detail-200-percent-css-zoom.png')});
 await page.evaluate(()=>document.documentElement.style.zoom='1');
 await page.setViewportSize({width:320,height:740});
 expect(await book.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await book.getByRole('button',{name:'加入学习',exact:true}).focus();
 await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeFocused();
 await page.screenshot({path:testInfo.outputPath('book-detail-narrow-keyboard.png')});
 await book.getByRole('button',{name:'加入学习',exact:true}).press('Enter');
 await expect(book.getByText('已加入学习',{exact:true})).toBeVisible();
 checkpoint=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(checkpoint.enrollments).toHaveLength(1);expect(checkpoint.records).toEqual([]);
 await page.reload();
 await expect(book.getByRole('button',{name:'去学习',exact:true})).toBeEnabled();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).enrollments).toHaveLength(1);
 await book.getByRole('button',{name:'返回',exact:true}).click();
 await expect(catalog.getByRole('searchbox',{name:'搜索学习包'})).toHaveValue('English');
 await expect(catalog.getByRole('button',{name:'紧凑列表',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('an enrolled Book cold read failure keeps membership unknown and recovery retains usable 320px learning search',async({page},testInfo)=>{
 fixture.setRegistry([fixture.reviewDelivery.descriptor]);
 await page.goto(`${fixture.origin}/catalog`);const catalog=page.locator('#s-catalog'),book=page.locator('#s-catalog-book');
 const key=fixture.reviewDelivery.descriptor.book.bookKey,card=catalog.locator(`[data-package-key="${key}"]`);
 await card.click();await book.getByRole('button',{name:'下载学习包',exact:true}).click();
 await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();await book.getByRole('button',{name:'加入学习',exact:true}).click();
 await expect(book.getByText('已加入学习',{exact:true})).toBeVisible();const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(facts.targetIds).toHaveLength(2);expect(facts.enrollments).toHaveLength(1);
 const durableLearning=()=>page.evaluate(async()=>{const saved=await window.__sensaBrowserSmoke!.durableBackupFactsForTest();return {targets:saved.learningTargets,enrollments:saved.curriculumEnrollments};});
 const storedFacts=await durableLearning();
 await book.getByRole('button',{name:'返回',exact:true}).click();await expect(card.getByText('已加入学习',{exact:true})).toBeVisible();
 await page.addInitScript(()=>{const timer=setInterval(()=>{if(!window.__sensaBrowserSmoke)return;clearInterval(timer);void window.__sensaBrowserSmoke.failLearningWorkspaceReadsForTest(true);},1);});
 await page.reload();await expect(catalog.getByRole('alert')).toContainText('读取');
 await expect(card.getByText('无法读取本机学习资料，请重试。',{exact:true})).toBeVisible();await expect(card.getByText('已下载',{exact:true})).toHaveCount(0);await expect(card.getByText('已加入学习',{exact:true})).toHaveCount(0);
 expect(await durableLearning()).toEqual(storedFacts);
 await page.screenshot({path:testInfo.outputPath('catalog-cold-learning-read-unavailable.png')});
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningWorkspaceReadsForTest(false));await catalog.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();
 await expect(card.getByText('已加入学习',{exact:true})).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(facts);
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的学习',exact:true}).click();
 await page.setViewportSize({width:320,height:740});const library=page.locator('#s-study'),search=library.getByRole('searchbox',{name:'搜索表达或意思',exact:true});
 await search.pressSequentially('borow');await search.press('ArrowLeft');await search.press('ArrowLeft');await search.press('r');await expect(search).toHaveValue('borrow');await expect(search).toBeFocused();
 await expect(library.locator('[data-learning-target]')).toHaveCount(1);await expect(library.locator('[data-learning-target]')).toContainText('borrow');
 await library.locator('.sensa-learning-options > summary').click();
 const searchBox=(await search.boundingBox())!,filter=library.getByRole('combobox',{name:'学习状态',exact:true}),sort=library.getByRole('combobox',{name:'排序',exact:true});
 expect(searchBox.width).toBeGreaterThanOrEqual(200);expect((await filter.boundingBox())!.y).toBeGreaterThanOrEqual(searchBox.y+searchBox.height);expect((await sort.boundingBox())!.y).toBeGreaterThanOrEqual(searchBox.y+searchBox.height);
 await search.press('ControlOrMeta+A');await search.press('Backspace');await expect(library.locator('[data-learning-target]')).toHaveCount(2);
 await filter.selectOption('new');await sort.selectOption('expression');await expect(library.locator('[data-learning-target]')).toHaveCount(2);expect(await library.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await search.fill('borrow');await page.screenshot({path:testInfo.outputPath('learning-search-320px-full-row.png')});expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(facts);
});

test('a missing Book in a cached catalog exposes failed discovery and retries the newly published detail without installing',async({page,context},testInfo)=>{
 await page.goto(`${fixture.origin}/catalog`);
 const catalog=page.locator('#s-catalog').last(),book=page.locator('#s-catalog-book').last();
 await expect(catalog.getByRole('button',{name:/English route essentials/})).toBeVisible();
 let failing=true;
 await context.route('**/sensa/packages?bookPreview=1',route=>failing?route.fulfill({status:503,headers:{'access-control-allow-origin':fixture.origin},body:'unavailable'}):route.continue());
 await catalog.getByRole('button',{name:'刷新',exact:true}).click();
 await expect(catalog.getByRole('alert')).toContainText('暂时无法更新目录');
 const initial=(fixture.registry as {items:typeof fixture.delivery.descriptor[]}).items;
 fixture.setRegistry([...initial,fixture.reviewDelivery.descriptor]);
 await page.evaluate(path=>window.__sensaBrowserSmoke!.navigate(path),`/catalog/${fixture.reviewDelivery.descriptor.book.bookKey}`);
 await expect(book.getByRole('alert')).toContainText('暂时无法更新目录');
 await expect(book.getByText('没有找到匹配的学习包',{exact:true})).toHaveCount(0);
 await page.screenshot({path:testInfo.outputPath('cached-detail-error-retry.png')});
 failing=false;
 await book.getByRole('button',{name:'重试',exact:true}).click();
 await expect(book.getByRole('heading',{name:fixture.reviewDelivery.descriptor.book.title,exact:true})).toBeVisible();
 await expect(book.getByRole('button',{name:'下载学习包',exact:true})).toBeEnabled();
 await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual([]);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).enrollments).toEqual([]);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.navigate('/catalog/unknown-book'));
 await expect(book.getByText('没有找到匹配的学习包',{exact:true})).toBeVisible();
 await book.getByRole('button',{name:'重试',exact:true}).click();
 await expect(book.getByText('没有找到匹配的学习包',{exact:true})).toBeVisible();
 await expect(book.getByRole('button',{name:'重试',exact:true})).toBeEnabled();
});

test('a cached public catalog refreshes across origins with its exact revision',async({page})=>{
  await page.goto(`${fixture.origin}/catalog`);
  const catalog=page.locator('#s-catalog').last();
  await expect(catalog.getByRole('button',{name:/English route essentials/})).toBeVisible({timeout:15_000});
  await catalog.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(catalog.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
  await expect(catalog.getByText('暂时无法更新目录。已下载内容可继续使用；可以联网后重试。',{exact:true})).toHaveCount(0);
  expect(fixture.catalogValidators.at(-1)).toBe(`"${(fixture.registry as {revision:string}).revision}"`);
  await page.reload();
  await expect(catalog.getByRole('button',{name:/English route essentials/})).toBeVisible({timeout:15_000});
});

test('shared Book sources recover their exact Manifest positions through Chromium OPFS without enrolling',async({page})=>{
 const first=fixture.reviewDelivery,files=unzipSync(first.bookBytes);
 const manifest=sensaPortableBookManifestSchema.parse({...first.manifest,book:{...first.manifest.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:'shared-book-recovery',title:'共享表达的另一册'},members:[...first.manifest.members].reverse()});
 files['book.json']=new TextEncoder().encode(JSON.stringify(manifest));
 const bytes=zipSync(files),sha256=createHash('sha256').update(bytes).digest('hex');
 const second={...first.descriptor,book:manifest.book,sha256,byteLength:bytes.byteLength,url:`${fixture.origin}/published/${sha256}.sensa-book`};
 first.responses.set(second.url,bytes);
 fixture.setRegistry([first.descriptor,second]);
 try{
  await page.goto(`${fixture.origin}/catalog`);
  const catalog=page.locator('#s-catalog').last(),book=page.locator('#s-catalog-book').last();
  for(const title of [first.descriptor.book.title,second.book.title]){
   await catalog.getByRole('button',{name:new RegExp(title)}).click();
   await book.getByRole('button',{name:'下载学习包',exact:true}).click();
   await expect(book.getByText('已下载',{exact:true})).toBeVisible();
   await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();
   await book.getByRole('button',{name:'返回',exact:true}).click();
  }
  const original=await page.evaluate(()=>window.__sensaBrowserSmoke!.bookProvenanceCheckpointForTest());
  expect(original.installations).toHaveLength(2);
  for(const installation of original.installations){
   expect(installation.artifact.bookMemberships).toHaveLength(2);
   for(const reference of installation.artifact.bookMemberships!){
    const bookManifest=reference.archiveSha256===first.descriptor.sha256?first.manifest:manifest;
    expect(reference.memberIndex).toBe(bookManifest.members.findIndex(member=>member.packageId===installation.artifact.packageId&&member.version===installation.artifact.version));
   }
  }
  const learning=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
  expect(learning.targetIds).toEqual([]);expect(learning.enrollments).toEqual([]);expect(learning.records).toEqual([]);
  await page.evaluate(()=>window.__sensaBrowserSmoke!.discardPackageCacheForRecoveryTest());
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.bookProvenanceCheckpointForTest())).cache).toEqual([]);
  fixture.delivered.length=0;
  await page.reload();
  await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.bookProvenanceCheckpointForTest())).cache.flatMap(pack=>pack.publications).length).toBe(4);
  const recovered=await page.evaluate(()=>window.__sensaBrowserSmoke!.bookProvenanceCheckpointForTest());
  expect(recovered).toEqual(original);
  expect(fixture.delivered.filter(path=>path.endsWith('.sensa-book')).sort()).toEqual([new URL(first.descriptor.url).pathname,new URL(second.url).pathname].sort());
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(learning);
  fixture.delivered.length=0;
  await page.reload();
  await expect(catalog.getByRole('button',{name:/共享表达的另一册/})).toBeVisible();
  await catalog.getByRole('button',{name:/共享表达的另一册/}).click();
  await expect(book.getByText('已下载',{exact:true})).toBeVisible();
  await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.bookProvenanceCheckpointForTest())).toEqual(original);
  expect(fixture.delivered.filter(path=>path.endsWith('.sensa-book'))).toEqual([]);
 }finally{first.responses.delete(second.url);}
});

test('overlapping Book admissions and an explicit Book upgrade preserve the revealed Run source through offline OPFS reopen',async({page,context})=>{
 const first=fixture.reviewDelivery,files=unzipSync(first.bookBytes);
 const manifest=sensaPortableBookManifestSchema.parse({...first.manifest,book:{...first.manifest.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:'shared-book-admission',title:'另一册共享表达'},members:[...first.manifest.members].reverse()});
 const secondFiles={...files,'book.json':new TextEncoder().encode(JSON.stringify(manifest))};
 const bytes=zipSync(secondFiles),sha256=createHash('sha256').update(bytes).digest('hex');
 const second={...first.descriptor,book:manifest.book,sha256,byteLength:bytes.byteLength,url:`${fixture.origin}/published/${sha256}.sensa-book`};
 const nextManifest=sensaPortableBookManifestSchema.parse({...first.manifest,book:{...first.manifest.book,bookVersionId:randomUUID(),versionNumber:2},contentRelease:{...first.manifest.contentRelease,contentReleaseId:randomUUID(),versionNumber:2}});
 const nextBytes=zipSync({...files,'book.json':new TextEncoder().encode(JSON.stringify(nextManifest))});
 const nextSha=createHash('sha256').update(nextBytes).digest('hex');
 const updated={...first.descriptor,book:nextManifest.book,contentRelease:nextManifest.contentRelease,sha256:nextSha,byteLength:nextBytes.byteLength,url:`${fixture.origin}/published/${nextSha}.sensa-book`};
 first.responses.set(second.url,bytes);first.responses.set(updated.url,nextBytes);
 fixture.setRegistry([first.descriptor,second]);
 try{
  const runtime=await fixture.startOrdinaryBook(page,/到期复习样本/);
  await runtime.getByRole('button',{name:/查看表达/}).click();
  const initial=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
  const original=await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest());
  const selected=original.targets.find(target=>target.id===initial.runtime!.targetId)!;
  const pinned=original.runs.find(run=>run.id===initial.runtime!.runId)!.participants[selected.id]!;
  expect(selected.curriculumMemberships).toHaveLength(1);
  expect(pinned.curriculumMembershipId).toBe(selected.curriculumMemberships[0]!.id);
  await runtime.getByRole('button',{name:'暂停',exact:true}).click();
  await expect(page.locator('#s-home').getByRole('button',{name:'继续学习',exact:true})).toBeVisible();
  const paused=await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest());
  await page.goto(`${fixture.origin}/catalog`);
  const catalog=page.locator('#s-catalog').last(),book=page.locator('#s-catalog-book').last();
  await catalog.getByRole('button',{name:/另一册共享表达/}).click();
  await book.getByRole('button',{name:'下载学习包',exact:true}).click();
  await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();
  await book.getByRole('button',{name:'加入学习',exact:true}).click();
  await expect(book.getByText('已加入学习',{exact:true})).toBeVisible();
  const shared=await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest());
  expect(shared.targets.map(target=>target.id).sort()).toEqual(original.targets.map(target=>target.id).sort());
  expect(shared.runs).toEqual(paused.runs);
  for(const target of shared.targets){
   expect(target.curriculumMemberships).toHaveLength(2);
   expect(new Set(target.curriculumMemberships.map(member=>member.provenance.curriculumEnrollmentId)).size).toBe(2);
   expect(new Set(target.curriculumMemberships.map(member=>member.material.snapshot.learningMaterializationId)).size).toBe(2);
   expect(target.curriculumMemberships.find(member=>member.provenance.publicationArchiveSha256===first.descriptor.sha256)).toEqual(original.targets.find(before=>before.id===target.id)!.curriculumMemberships[0]);
   expect(target.memoryRevision).toBe(0);expect(target.completedAt).toBeNull();
  }
  await book.getByRole('button',{name:'去学习',exact:true}).click();
  await page.locator('#s-home').getByRole('button',{name:'继续学习',exact:true}).click();
  await expect(runtime.getByRole('heading',{name:selected.expression,exact:true})).toBeVisible();
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(initial.runtime);

  // Book selection is a future-plan operation, not a new competing Session.
  await runtime.getByRole('button',{name:'暂停',exact:true}).click();
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
  await fixture.openLearningManagement(page);
  const plans=page.locator('#s-study').getByRole('region',{name:'后续学习计划',exact:true});
  await expect(plans.getByRole('listitem').filter({hasText:'另一册共享表达'})).toContainText('新学与复习');
  await expect(plans.getByRole('listitem').filter({hasText:first.manifest.book.title})).toContainText('仅继续已开始的学习');
  await plans.getByRole('button',{name:`编辑《${first.manifest.book.title}》`,exact:true}).click();
  const planDialog=page.getByRole('dialog',{name:first.manifest.book.title,exact:true});
  await planDialog.getByRole('combobox',{name:'后续学习模式',exact:true}).selectOption('active');
  await planDialog.getByRole('button',{name:'保存计划',exact:true}).click();
  await expect(planDialog).toHaveCount(0);
  await expect(plans.getByRole('listitem').filter({hasText:'另一册共享表达'})).toContainText('仅继续已开始的学习');
  await expect(plans.getByRole('listitem').filter({hasText:first.manifest.book.title})).toContainText('新学与复习');
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'今日',exact:true}).click();
  await page.locator('#s-home').getByRole('button',{name:'继续学习',exact:true}).click();
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(initial.runtime);

  // Download and explicitly apply a new Book version while the original Run
  // remains open. The version reuses identical Portable Package bytes.
  fixture.setRegistry([updated,second]);
  await page.goto(`${fixture.origin}/catalog`);
  await catalog.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(catalog.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
  await catalog.getByRole('button',{name:/到期复习样本/}).click();
  const beforeUpdate=await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest());
  await expect(book.getByRole('button',{name:'去学习',exact:true})).toBeEnabled();
  await book.getByRole('button',{name:'下载更新',exact:true}).click();
  await expect(book.getByText('更新已下载',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest())).toEqual(beforeUpdate);
  await book.getByRole('button',{name:'应用更新',exact:true}).click();
  await expect(book.getByRole('button',{name:'应用更新',exact:true})).toHaveCount(0);
  await expect(book.getByText('已加入学习',{exact:true})).toBeVisible();
  await expect(book.getByRole('button',{name:'去学习',exact:true})).toBeVisible();
  const upgraded=await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest());
  expect(upgraded.runs).toEqual(beforeUpdate.runs);
  expect(upgraded.targets.map(target=>target.id).sort()).toEqual(original.targets.map(target=>target.id).sort());
  for(const target of upgraded.targets)expect(target.curriculumMemberships).toHaveLength(3);
  await book.getByRole('button',{name:'去学习',exact:true}).click();
  await page.locator('#s-home').getByRole('button',{name:'继续学习',exact:true}).click();
  await expect(runtime.getByRole('heading',{name:selected.expression,exact:true})).toBeVisible();
  await context.setOffline(true);
  try{
   await page.reload();
   await expect(runtime.getByRole('heading',{name:selected.expression,exact:true})).toBeVisible();
   expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(initial.runtime);
   await runtime.getByRole('button',{name:/还没连上/}).click();
   await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();
   await runtime.getByRole('button',{name:/查看表达/}).click();
   await expect(runtime.getByRole('heading',{name:selected.expression,exact:true})).toBeVisible();
   const retried=await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest());
   const run=retried.runs.find(candidate=>candidate.id===initial.runtime!.runId)!;
   expect(run.participants[selected.id]!.curriculumMembershipId).toBe(pinned.curriculumMembershipId);
   for(const material of Object.values(run.participants[selected.id]!.materializations))expect(material.snapshot.provenance.publicationArchiveSha256).toBe(first.descriptor.sha256);
   expect(retried.targets.every(target=>target.memoryRevision===0&&target.completedAt===null)).toBe(true);
   expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toEqual([]);
  }finally{await context.setOffline(false);}
 }finally{first.responses.delete(second.url);first.responses.delete(updated.url);}
});

test('a rated Book target keeps its real memory and private Scene when a newer public Sense version is explicitly applied',async({page,context},testInfo)=>{
 const first=fixture.learningDelivery,semantic=structuredClone(first.package.semanticDeclaration!);
 const updatedMeaning='临时借用他人的物品，并在约定之后归还。',updatedScene='向邻居借一把梯子，用完之后按照约定归还。',sceneBody='昨天我向同事借了一把雨伞，并约好今天归还。';
 semantic.sense={...semantic.sense,senseVersionId:randomUUID(),versionNumber:semantic.sense.versionNumber+1,semanticSpec:{...semantic.sense.semanticSpec,coreMeaningFocus:updatedMeaning,prototypeScenes:[{summary:updatedScene,participantRoles:[],states:[],directionOrCausality:null}]}};
 semantic.binding={...semantic.binding,bindingVersionId:randomUUID(),versionNumber:semantic.binding.versionNumber+1};
 const member=portablePackageFixture({packageId:first.package.metadata.packageId,version:2,expression:first.package.targetExpression.text,meaning:updatedMeaning,scene:updatedScene,semanticDeclaration:semantic});
 const manifest=sensaPortableBookManifestSchema.parse({...first.manifest,book:{...first.manifest.book,bookVersionId:randomUUID(),versionNumber:2},contentRelease:{...first.manifest.contentRelease,contentReleaseId:randomUUID(),versionNumber:2},members:[{packageId:member.package.metadata.packageId,version:2}]});
 const bytes=createSensaPortableBook(manifest,new Map([[portableBookMemberKey(manifest.members[0]!),member.bytes]])),sha256=createHash('sha256').update(bytes).digest('hex');
 const updated={...first.descriptor,book:manifest.book,contentRelease:manifest.contentRelease,sha256,byteLength:bytes.byteLength,url:`${fixture.origin}/published/${sha256}.sensa-book`};
 first.responses.set(updated.url,bytes);fixture.setRegistry([first.descriptor]);
 const snapshot=()=>page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest());
 const privateFacts=()=>page.evaluate(async()=>{const rows=await window.__sensaBrowserSmoke!.durableBackupFactsForTest();return Object.fromEntries(['semanticMeanings','semanticContexts','semanticRegistry','annotations','learningEvents','studyScopes','learningSessions'].map(table=>[table,rows[table]]));});
 try{
  const runtime=await fixture.startOrdinaryBook(page,/雨天借伞/);
  await runtime.getByRole('button',{name:/查看表达/}).click();
  const revealed=await snapshot(),target=revealed.targets[0]!;expect(target.memory).toBeNull();
  await runtime.getByRole('button',{name:'添加我的场景',exact:true}).click();
  const editor=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'我的场景',exact:true})});
  await editor.getByRole('textbox').fill(sceneBody);await editor.getByRole('button',{name:'保存我的场景',exact:true}).click();
  await runtime.getByRole('button',{name:'存入我的语义世界',exact:true}).click();await expect(runtime.getByRole('button',{name:'已存入我的语义世界',exact:true})).toBeVisible();
  await runtime.getByRole('button',{name:/已经连上/}).click();await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
  await runtime.getByRole('button',{name:/完成并回到首页/}).click();
  const before=await snapshot(),facts=await privateFacts(),learning=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),learned=before.targets[0]!;
  expect(facts.semanticMeanings).toHaveLength(1);expect(facts.semanticContexts.length).toBeGreaterThanOrEqual(2);expect(learned.memory).not.toBeNull();expect(learned.memoryRevision).toBeGreaterThan(0);expect(learning.records).toHaveLength(1);expect(learning.completedTargets[0]!.nextReviewAt).not.toBeNull();
  const scenes=await page.evaluate(()=>window.__sensaBrowserSmoke!.personalLearningScenesForTest()),scene=scenes.find(row=>row.learningTargetId===learned.id)!;
  expect(scene).toBeDefined();const sceneRevision=scene.revisions.find(row=>row.revisionId===scene.acceptedRevisionId)!;
  expect(sceneRevision.body).toBe(sceneBody);expect(sceneRevision.sourcePin).toEqual(learned.curriculumMemberships[0]!.sourcePin);
  const meaning=decodeBackupValue(facts.semanticMeanings[0]!.value) as StoredMeaningRecord;expect(meaning.personalMeaning.personalMeaningId).toBe(scene.acceptedPersonalMeaningId);
  const contexts=facts.semanticContexts.map(row=>decodeBackupValue(row.value) as ContextRecord),sceneContexts=contexts.filter((row):row is Extract<ContextRecord,{kind:'anchorRevisions'}>=>row.kind==='anchorRevisions'&&row.value.bodyText===sceneBody);
  expect(sceneContexts).toHaveLength(1);const sceneContext=sceneContexts[0]!.value;
  const sceneContextHead=contexts.find(row=>row.kind==='anchors'&&row.value.personalSemanticAnchorId===sceneContext.personalSemanticAnchorId);expect(sceneContextHead?.kind).toBe('anchors');
  if(sceneContextHead?.kind!=='anchors')throw Error('Accepted Scene Context head missing');expect(sceneContextHead.value.currentRevisionId).toBe(sceneContext.personalSemanticAnchorRevisionId);
  expect(sceneContext.structuredPayload.learningScene).toEqual({sceneId:scene.sceneId,revisionId:sceneRevision.revisionId,revision:sceneRevision.revision,learningTargetId:learned.id,curriculumMembershipId:learned.curriculumMemberships[0]!.id});
  expect(meaning.personalSemanticAnchors).toContainEqual(expect.objectContaining({personalSemanticAnchorId:sceneContext.personalSemanticAnchorId,selectedRevisionId:sceneContext.personalSemanticAnchorRevisionId}));
  expect(meaning.personalSemanticAnchorRevisions).toContainEqual({personalSemanticAnchorId:sceneContext.personalSemanticAnchorId,personalSemanticAnchorRevisionId:sceneContext.personalSemanticAnchorRevisionId});
  const stable=(value:typeof learned)=>{const {curriculumMemberships:_,...progress}=value;return progress;};
  fixture.setRegistry([updated]);await page.goto(`${fixture.origin}/catalog`);
  const catalog=page.locator('#s-catalog').last(),book=page.locator('#s-catalog-book').last();
  await catalog.getByRole('button',{name:'刷新',exact:true}).click();await expect(catalog.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
  await catalog.getByRole('button',{name:/雨天借伞/}).click();await book.getByRole('button',{name:'下载更新',exact:true}).click();await expect(book.getByText('更新已下载',{exact:true})).toBeVisible();
  expect(await snapshot()).toEqual(before);expect(await privateFacts()).toEqual(facts);
  await book.getByRole('button',{name:'应用更新',exact:true}).click();await expect(book.getByRole('button',{name:'应用更新',exact:true})).toHaveCount(0);await expect(book.getByText('已加入学习',{exact:true})).toBeVisible();
  const after=await snapshot(),current=after.targets[0]!;
  expect(after.targets).toHaveLength(1);expect(stable(current)).toEqual(stable(learned));expect(after.runs).toEqual(before.runs);expect(await privateFacts()).toEqual(facts);
  expect(current.curriculumMemberships).toHaveLength(2);
  const oldMember=current.curriculumMemberships.find(row=>row.id===learned.curriculumMemberships[0]!.id)!;
  const immutableMembership=(row:typeof oldMember)=>{const {revision:_,status:__,updatedAt:___,...source}=row;return source;};
  expect(immutableMembership(oldMember)).toEqual(immutableMembership(learned.curriculumMemberships[0]!));expect(oldMember.status).toBe('superseded');expect(oldMember.revision).toBe(learned.curriculumMemberships[0]!.revision+1);
  const newMember=current.curriculumMemberships.find(row=>row.provenance.bookVersionId===manifest.book.bookVersionId)!;
  expect(newMember.sourcePin).toEqual({...learned.curriculumMemberships[0]!.sourcePin,senseVersionId:semantic.sense.senseVersionId,bindingVersionId:semantic.binding.bindingVersionId});
  expect(newMember.material.snapshot.provenance).toMatchObject({...newMember.sourcePin,publicationArchiveSha256:sha256,packageVersion:'2'});
  expect(newMember.material.snapshot.learningMaterializationId).not.toBe(learned.curriculumMemberships[0]!.material.snapshot.learningMaterializationId);
  const latest=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(latest.targetIds).toEqual(learning.targetIds);expect(latest.records).toEqual(learning.records);expect(latest.completedTargets).toEqual(learning.completedTargets);
  await context.setOffline(true);try{await page.reload();await expect(book.getByText('已加入学习',{exact:true})).toBeVisible();expect(await snapshot()).toEqual(after);expect(await privateFacts()).toEqual(facts);}finally{await context.setOffline(false);}
  await testInfo.attach('rated-public-upgrade-evidence',{contentType:'application/json',body:JSON.stringify({before,after,learning,latest,scene,sceneContext,oldSenseVersion:first.package.semanticDeclaration!.sense.senseVersionId,newSenseVersion:semantic.sense.senseVersionId,privateFacts:facts,paidCalls:0,scope:'actual UI reveal/rate/learner-owned Scene acceptance and newer Book/Sense material admission; real Chromium/OPFS offline reload; synthetic publication/audio'})});
 }finally{first.responses.delete(updated.url);}
});

test('cancelling admission after complete transfer closes its Worker without installing any members',async({page})=>{
  fixture.setRegistry([fixture.scaleDelivery.descriptor]);
  // Hold the owned Worker before computation so cancellation never races a fast CPU.
  await page.route('**/*portablePreparationWorker*',async route=>{
    const response=await route.fetch(),body=await response.text();
    await route.fulfill({response,body:`self.addEventListener('message',event=>{if(event.data?.kind==='book')event.stopImmediatePropagation();});\n${body}`});
  });
  await page.goto(`${fixture.origin}/catalog`);
  await page.locator('#s-catalog').last().getByRole('button',{name:/English route essentials/}).click();
  const book=page.locator('#s-catalog-book').last();
  await expect(book.getByRole('article')).toHaveCount(3);
  let workerClosed=false;
  let closed:Promise<void>|undefined;
  const admission=page.waitForEvent('worker',{predicate:worker=>worker.url().includes('portablePreparationWorker')}).then(worker=>{
    closed=new Promise<void>(resolve=>worker.once('close',()=>{workerClosed=true;resolve();}));
    return worker;
  });
  await book.getByRole('button',{name:'下载学习包',exact:true}).click();
  await admission;
  await expect(book.getByText('正在准备',{exact:true})).toBeVisible();
  expect(workerClosed,'the admission Worker must still be active when cancelled').toBe(false);
  await book.getByRole('button',{name:'取消下载',exact:true}).click();
  await closed;
  await expect(book.getByText('下载已取消。',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual([]);
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
  await page.reload();
  await expect(book.getByText('未下载',{exact:true})).toBeVisible({timeout:15_000});
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual([]);
});

test('a guest can browse the public package catalog without an account session',async({page})=>{
  await page.addInitScript(()=>{
    (window as unknown as {__name:(value:unknown)=>unknown}).__name=(value:unknown)=>value;
  });
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'
    ?route.continue()
    :route.abort());
  await page.goto(`${fixture.origin}/catalog`);
  const catalog=page.locator('#s-catalog').last();
  await expect(catalog.getByRole('heading',{name:'学习包目录',exact:true})).toBeVisible({timeout:15_000});
  await expect(catalog.getByRole('button',{name:/English route essentials/})).toBeVisible();
  await expect(catalog.getByText('暂时无法更新目录。已下载内容可继续使用；可以联网后重试。',{exact:true})).toHaveCount(0);
  assert.equal(fixture.catalogAuthorizationHeaders.at(-1),undefined,'the public catalog request must not carry account authority');
});

test('discovers, downloads and enrolls a Book with durable local state',async({page})=>{
  const runtimeErrors:string[]=[];
  page.on('console',message=>{
    if(message.type()==='error'&&!message.text().includes('favicon.ico'))runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror',error=>runtimeErrors.push(`pageerror: ${error.message}`));
  await page.addInitScript(({key,value})=>{
    (window as unknown as {__name:(value:unknown)=>unknown}).__name=(value:unknown)=>value;
    localStorage.setItem(key,JSON.stringify(value));
  },{key:fixture.storageKey,value:fixture.session()});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'
    ?route.continue()
    :route.abort());

  await page.goto(fixture.origin);
  await expect(page.locator('[data-sensa-page-layout="application-shell"]')).toBeVisible({timeout:15_000});
  await page.evaluate(()=>window.__sensaBrowserSmoke!.navigate('/catalog'));
  const catalog=page.locator('#s-catalog').last();
  await expect(catalog.getByRole('heading',{name:'学习包目录',exact:true})).toBeVisible({timeout:15_000});

  await expect(catalog.getByRole('button',{name:/English route essentials/})).toBeVisible();
  await catalog.getByRole('button',{name:/English route essentials/}).click();
  await expect(page).toHaveURL(new RegExp(`/catalog/${fixture.delivery.descriptor.book.bookKey}$`));
  const entry=page.locator('#s-catalog-book').last();
  await expect(entry.getByRole('heading',{name:'English route essentials'})).toBeVisible();
  await expect(entry.getByText('未下载',{exact:true})).toBeVisible();
  await expect(entry.getByText(/100 个表达/)).toBeVisible();

  const preview=entry.getByRole('region',{name:'查看内容预览',exact:true});
  await expect(preview.getByRole('article')).toHaveCount(3);
  await expect(preview.locator('li')).toHaveCount(24);
  await preview.getByRole('button',{name:'第 5 页',exact:true}).click();
  await expect(preview.locator('li')).toHaveCount(4);
  await expect(preview.getByText('第 97–100 项，共 100 项',{exact:true})).toBeVisible();
  await preview.getByRole('searchbox',{name:'搜索表达',exact:true}).fill('borrow');
  await expect(preview.locator('li')).toHaveCount(1);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual([]);
  await preview.getByRole('searchbox').fill('');
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    expect(await entry.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath(`book-100-preview-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:900});

  await entry.getByRole('button',{name:'下载学习包',exact:true}).click();
  await expect(entry.getByText('已下载',{exact:true})).toBeVisible({timeout:15_000});
  await expect(entry.locator('section').last().locator('li')).toHaveCount(3);
  await expect(entry.getByRole('button',{name:'加入学习',exact:true})).toBeVisible();
  assert.equal(
    fixture.delivered.filter(path=>path.endsWith('.sensa-book')).length,
    1,
    'the complete Book was not downloaded exactly once',
  );
  assert.equal(fixture.delivered.filter(path=>path.endsWith('.sensa')).length,0,'members must not require separate requests');

  await page.evaluate(()=>{
    const state={learningTargetCommits:0};
    (window as unknown as {__packageEnrollmentCommits:typeof state}).__packageEnrollmentCommits=state;
    window.addEventListener('sensa-library-changed',event=>{
      const tables=(event as CustomEvent<{tables?:unknown}>).detail?.tables;
      if(Array.isArray(tables)&&tables.includes('learningTargets'))state.learningTargetCommits++;
    });
  });
  await entry.getByRole('button',{name:'加入学习',exact:true}).click();
  await expect(entry.getByText('已加入学习',{exact:true})).toBeVisible({timeout:15_000});
  await expect(entry.getByRole('button',{name:'去学习',exact:true})).toBeVisible();
  const contents=entry.locator('section').last();
  await expect(contents.locator('li')).toHaveCount(3);
  await expect(contents.locator('li button')).toHaveCount(3);
  await contents.getByRole('button',{name:'查看更多',exact:true}).click();
  await expect(contents.locator('li')).toHaveCount(24);
  await expect(contents.locator('li button')).toHaveCount(20);
  await contents.getByRole('button',{name:'第 5 页',exact:true}).click();
  await expect(contents.locator('li')).toHaveCount(4);
  await expect(contents.getByText('第 97–100 项，共 100 项',{exact:true})).toBeVisible();
  await contents.getByRole('searchbox',{name:'搜索表达',exact:true}).fill('borrow');
  await expect(contents.locator('li')).toHaveCount(1);
  await expect(contents.getByText('borrow',{exact:true})).toBeVisible();
  await contents.getByRole('searchbox').fill('missing expression');
  await expect(contents.locator('li')).toHaveCount(0);
  await expect(contents.getByText('第 0–0 项，共 0 项',{exact:true})).toBeVisible();
  await contents.getByRole('searchbox').fill('');
  await expect(contents.locator('li')).toHaveCount(24);
  await expect(contents.getByRole('button',{name:'查看更多',exact:true})).toHaveCount(0);
  assert.equal(
    await page.evaluate(()=>(window as unknown as {__packageEnrollmentCommits:{learningTargetCommits:number}}).__packageEnrollmentCommits.learningTargetCommits),
    1,
    'a Book enrollment must publish one atomic bounded-candidate commit',
  );

  await page.reload();
  await expect(page.locator('[data-sensa-page-layout="application-shell"]')).toBeVisible({timeout:15_000});
  await page.evaluate(()=>window.__sensaBrowserSmoke!.navigate('/library'));
  const library=page.locator('#s-library').last();
  await expect(library.getByRole('heading',{name:'我的学习包',exact:true})).toBeVisible({timeout:15_000});
  await expect(library.getByRole('button',{name:/English route essentials/})).toBeVisible();
  await library.getByRole('button',{name:/English route essentials/}).click();
  const restored=page.locator('#s-catalog-book').last();
  await expect(restored.getByRole('heading',{name:'English route essentials'})).toBeVisible({timeout:15_000});
  await expect(restored.getByText('已加入学习',{exact:true})).toBeVisible();
  await restored.getByRole('region',{name:'包内内容',exact:true}).getByRole('button',{name:'查看更多',exact:true}).click();
  await restored.getByRole('searchbox',{name:'搜索表达',exact:true}).fill('borrow');
  await expect(restored.getByText('borrow',{exact:true})).toBeVisible();

  await page.evaluate(()=>window.__sensaBrowserSmoke!.navigate('/publisher'));
  await expect(page.locator('#s-publisher').last().getByRole('alert')).toContainText('当前账号尚未获得服务访问权限');
  fixture.publisherAccess=true;
  await page.reload();
  const publisher=page.locator('#s-publisher').last();
  await expect(publisher.getByRole('heading',{name:'发布后台',exact:true})).toBeVisible({timeout:15_000});
  const bookBytes=[...fixture.delivery.responses.entries()].find(([url])=>url.endsWith('.sensa-book'))?.[1];
  assert(bookBytes,'fixture Book archive missing');
  await publisher.locator('input[type=file]').setInputFiles({name:'candidate.sensa-book',mimeType:'application/vnd.sensa.book+zip',buffer:Buffer.from(bookBytes)});
  await expect(publisher.getByText('English route essentials',{exact:true}).first()).toBeVisible();
  await expect(publisher.getByText(/^[0-9a-f]{64}$/)).toBeVisible();
  assert.deepEqual(runtimeErrors,[]);
});

test('direct published discovery enrolls only the selected expression and resumes its real Runtime without a Personal Meaning',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(fixture.origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的学习',exact:true}).click();await page.locator('#s-study').getByRole('button',{name:'添加内容',exact:true}).click();
 await page.locator('#s-learning-entry').getByRole('button',{name:'学习包',exact:true}).click();
 await page.locator('#s-catalog').last().getByRole('button',{name:/English route essentials/}).click();const book=page.locator('#s-catalog-book').last();
 await book.getByRole('button',{name:'下载学习包',exact:true}).click();await expect(book.getByText('已下载',{exact:true})).toBeVisible({timeout:30_000});
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).length).toBe(100);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).enrollments).toEqual([]);
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'我的学习',exact:true}).click();await page.locator('#s-study').getByRole('button',{name:'添加内容',exact:true}).click();
 await page.locator('#s-learning-entry').getByRole('button',{name:'按表达查找',exact:true}).click();const direct=page.locator('#s-direct-learning').last();
 await direct.getByRole('searchbox',{name:'搜索表达',exact:true}).fill('borrow');await expect(direct.getByRole('listitem')).toHaveCount(1);
 await direct.getByRole('button',{name:/borrow/}).click();await expect(direct.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
 await direct.getByRole('button',{name:'确认加入学习',exact:true}).click();await expect(direct.getByRole('button',{name:'查看学习',exact:true})).toBeEnabled();
 const added=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(added.enrollments).toHaveLength(1);expect(added.enrollments[0]!.sourceKind).toBe('stable_sense');expect(added.targetIds).toHaveLength(1);expect(added.records).toEqual([]);expect(added.runtime).toBeNull();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
 await page.reload();await expect(direct.getByRole('button',{name:'查看学习',exact:true})).toBeEnabled();await direct.getByRole('button',{name:'查看学习',exact:true}).click();
 const targetUrl=page.url(),target=page.locator('#s-learning-target'),resourceTrigger=target.getByRole('button',{name:'查看学习资源',exact:true});
 await resourceTrigger.click();const reader=page.getByRole('dialog',{name:/^学习资源/u});await expect(reader.getByText('borrow',{exact:true}).first()).toBeVisible();
 expect(new URL(page.url()).searchParams.has('resourceMaterialization')).toBe(true);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(added);
 await page.goBack();await expect(reader).toHaveCount(0);await expect(resourceTrigger).toBeFocused();expect(page.url()).toBe(targetUrl);
 await resourceTrigger.click();await expect(reader).toBeVisible();await page.keyboard.press('Escape');await expect(reader).toHaveCount(0);await expect(resourceTrigger).toBeFocused();expect(page.url()).toBe(targetUrl);
 await target.getByRole('button',{name:'开始 / 继续学习',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'学习偏好',exact:true})).toHaveCount(0);
 const runtime=page.locator('#s-lightweight-runtime');await runtime.getByRole('button',{name:/查看表达/}).click();await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 const revealed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(revealed.runtime?.runId).toBeTruthy();expect(revealed.targetIds).toEqual(added.targetIds);expect(revealed.records).toEqual([]);
 await page.reload();await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(revealed);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
 const arrangement=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
 await fixture.openLearningManagement(page);
 const plans=page.locator('#s-study').getByRole('region',{name:'补充学习',exact:true});
 await page.setViewportSize({width:320,height:800});
 await expect(plans.getByRole('button',{name:'移出学习 · borrow',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failNextLearningCommitForTest('supplemental'));
 await plans.getByRole('button',{name:'移出学习 · borrow',exact:true}).click();
 await expect(page.locator('#s-study').getByRole('alert')).toContainText('未能确认保存结果');
 await expect(plans.getByRole('button',{name:'移出学习 · borrow',exact:true})).toBeEnabled();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.supplementalDecisionsForTest())).states).toEqual([]);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.loseNextSupplementalResponseForTest());
 await plans.getByRole('button',{name:'移出学习 · borrow',exact:true}).click();
 await expect(plans.getByRole('button',{name:'重新加入学习 · borrow',exact:true})).toBeEnabled();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.supplementalDecisionsForTest())).states[0]!.revision).toBe(1);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual(arrangement);
 await page.reload();await fixture.openLearningManagement(page);await expect(plans.getByRole('button',{name:'重新加入学习 · borrow',exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'今日',exact:true}).click();
 await page.locator('#s-home').getByRole('button',{name:'继续学习',exact:true}).click();await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(revealed.runtime);
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
 await fixture.openLearningManagement(page);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failSupplementalReadsForTest(true));
 await plans.getByRole('button',{name:'重新加入学习 · borrow',exact:true}).click();
 await expect(page.locator('#s-study').getByRole('alert')).toContainText('修改已保存');
 const saved=await page.evaluate(()=>window.__sensaBrowserSmoke!.supplementalDecisionsForTest());
 expect(saved.states[0]!.status).toBe('active');expect(saved.states[0]!.revision).toBe(2);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failSupplementalReadsForTest(false));
 await page.locator('#s-study').getByRole('button',{name:'重试 / 恢复准备',exact:true}).click();
 await expect(plans.getByRole('button',{name:'移出学习 · borrow',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplementalDecisionsForTest())).toEqual(saved);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual(arrangement);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toEqual([]);
 await plans.getByRole('button',{name:'移出学习 · borrow',exact:true}).click();await expect(plans.getByRole('button',{name:'重新加入学习 · borrow',exact:true})).toBeEnabled();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'今日',exact:true}).click();
 await page.locator('#s-home').getByRole('button',{name:'继续学习',exact:true}).click();
 await runtime.locator('[data-learning-more]').click();await page.getByRole('button',{name:'结束本次学习',exact:true}).click();
 await page.getByRole('dialog',{name:'结束本次学习？',exact:true}).getByRole('button',{name:'结束本次学习',exact:true}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).session).toBeNull();
 await page.goto(targetUrl);const detail=page.locator('#s-learning-target');
 await expect(detail.getByRole('button',{name:'开始 / 继续学习',exact:true})).toBeDisabled();
 await expect(detail.getByRole('status')).toContainText('不在后续学习计划中');
 await detail.getByRole('button',{name:'我的学习',exact:true}).click();
 await fixture.openLearningManagement(page);
 await plans.getByRole('button',{name:'重新加入学习 · borrow',exact:true}).click();
 await expect(plans.getByRole('button',{name:'移出学习 · borrow',exact:true})).toBeEnabled();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.supplementalDecisionsForTest())).states[0]!.revision).toBe(4);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual(added.targetIds);
});

test('a guest learns a Book through the UI and resumes the revealed step after reload',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(fixture.origin);
  await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
  const home=page.locator('#s-home');
  await expect(home.getByRole('heading',{name:'今天',level:1,exact:true})).toBeVisible({timeout:15_000});
  const catalogAction=home.getByRole('button',{name:'学习包目录',exact:true}).and(home.locator('[data-sensa-component="action"][data-sensa-variant="primary"]'));
  await expect(catalogAction).toBeEnabled();
  await expect(home.getByRole('button',{name:'开始学习',exact:true})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('guest-home.png'),fullPage:true});
  await catalogAction.click();
  const catalog=page.locator('#s-catalog').last();
  await catalog.getByRole('button',{name:/雨天借伞/}).click();
  const book=page.locator('#s-catalog-book').last();
  await book.getByRole('button',{name:'下载学习包',exact:true}).click();
  await expect(book.getByText('已下载',{exact:true})).toBeVisible({timeout:15_000});
  await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
  await page.screenshot({path:test.info().outputPath('downloaded-book.png'),fullPage:true});
  // A reload must retain installation without inventing learning membership.
  await page.reload();
  await expect(book.getByText('已下载',{exact:true})).toBeVisible({timeout:15_000});
  await expect(book.getByText('已加入学习',{exact:true})).toHaveCount(0);
  await book.getByRole('button',{name:'加入学习',exact:true}).click();
  await expect(book.getByText('已加入学习',{exact:true})).toBeVisible();
  await book.getByRole('button',{name:'去学习',exact:true}).click();
  await expect(home.getByRole('heading',{name:'今天',level:1,exact:true})).toBeVisible();
  await home.getByRole('button',{name:'开始学习',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'学习偏好',exact:true})).toHaveCount(0);
  const runtime=page.locator('#s-lightweight-runtime');
  await expect(runtime.getByRole('button',{name:/查看表达/})).toBeVisible({timeout:15_000});
  await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toHaveCount(0);
  const firstArrangement=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
  expect(firstArrangement.session!.dailyNewSenseLimit).toBe(20);
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toHaveLength(0);
  const beforeMenu=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
  const more=runtime.getByRole('button',{name:'更多',exact:true});
  await more.click();await expect(page.getByRole('dialog',{name:'更多',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'更多',exact:true})).toHaveCount(0);await expect(more).toBeFocused();
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(beforeMenu.runtime);
  await more.click();await expect(page.getByRole('dialog',{name:'更多',exact:true})).toBeVisible();
  await page.locator('#menu-more [data-sensa-slot="backdrop"]').click({position:{x:4,y:4}});
  await expect(page.getByRole('dialog',{name:'更多',exact:true})).toHaveCount(0);
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(beforeMenu.runtime);
  await runtime.getByRole('button',{name:/查看表达/}).click();
  await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('revealed-expression.png'),fullPage:true});
  // Read-only facts strengthen the UI oracle; no commands are issued through the bridge.
  const revealed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
  expect(revealed.runtime?.runId).toBeTruthy();
  expect(revealed.runtime?.stepId).toBeTruthy();
  expect(revealed.runtime?.materializationId).toBeTruthy();
  expect(revealed.records).toHaveLength(0);
  await page.reload();
  await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible({timeout:15_000});
  await expect(runtime.getByRole('button',{name:/查看表达/})).toHaveCount(0);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(revealed);
  const restoredReads=await page.evaluate(()=>performance.getEntriesByType('measure').map(entry=>entry.name));
  expect(restoredReads).toContain('sensa.workspace.runtime');
  expect(restoredReads).not.toContain('sensa.workspace.rehydrate');
  expect(restoredReads).not.toContain('sensa.workspace.supply');
  expect(restoredReads).not.toContain('sensa.workspace.prepare');
  await runtime.getByRole('button',{name:'暂停',exact:true}).click();
  await expect(home.getByRole('button',{name:'继续学习',exact:true})).toBeVisible();
  await page.reload();
  await expect(home.getByRole('button',{name:'继续学习',exact:true})).toBeVisible({timeout:15_000});
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
  await page.locator('#s-study').getByRole('button',{name:'学习偏好',exact:true}).click();
  const savedPreferences=page.getByRole('dialog',{name:'学习偏好',exact:true});
  await expect(savedPreferences.getByRole('combobox',{name:'每日新学数量',exact:true})).toHaveValue('20');
  await expect(savedPreferences.getByRole('radiogroup')).toHaveCount(0);
  await expect(savedPreferences.getByText('默认学习方式',{exact:true})).toHaveCount(0);
  await savedPreferences.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'今日',exact:true}).click();
  await home.getByRole('button',{name:'继续学习',exact:true}).click();
  await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(revealed);
  await runtime.getByRole('button',{name:/已经连上/}).click();
  await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
  await runtime.getByRole('button',{name:/完成并回到首页/}).click();
  await expect(home.getByRole('heading',{name:'今天',level:1,exact:true})).toBeVisible();
  await expect(home.getByRole('button',{name:'继续学习',exact:true})).toHaveCount(0);
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
  const study=page.locator('#s-study');
  await study.locator('summary').filter({hasText:'最近记录'}).click();
  const history=study.locator('ol');
  await expect(history.getByRole('button',{name:/borrow/})).toHaveCount(1);
  const completed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
  expect(completed.runtime).toBeNull();
  expect(completed.records).toHaveLength(1);
  expect(completed.records[0]!.targetId).toBe(revealed.runtime!.targetId);
  expect(completed.records[0]!.kind).toBe('initial_learning');
  expect(completed.completedTargets).toHaveLength(1);
  expect(completed.completedTargets[0]!.nextReviewAt).not.toBeNull();
  await page.reload();
  await study.locator('summary').filter({hasText:'最近记录'}).click();
  await expect(history.getByRole('button',{name:/borrow/})).toHaveCount(1);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(completed);
  // Move only the browser clock to the due date actually produced by learning.
  // Neither a target nor a scheduling result is seeded by the test.
  await page.clock.setFixedTime(new Date(Date.parse(completed.completedTargets[0]!.nextReviewAt!)+60_000));
  await page.goto(fixture.origin);
  await expect(home.getByRole('button',{name:'开始 / 继续复习',exact:true})).toBeVisible({timeout:15_000});
  await page.context().setOffline(true);
  try{
    await home.getByRole('button',{name:'开始 / 继续复习',exact:true}).click();
    await expect(runtime.getByRole('button',{name:/查看表达/})).toBeVisible();
    const review=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
    expect(review.runtime!.targetId).toBe(completed.records[0]!.targetId);
    expect(review.runtime!.runId).not.toBe(revealed.runtime!.runId);
    await runtime.getByRole('button',{name:/查看表达/}).click();
    await runtime.getByRole('button',{name:/顺利想起/}).click();
    await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
    await runtime.getByRole('button',{name:/完成并回到首页/}).click();
    const reviewed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
    expect(reviewed.records).toHaveLength(2);
    expect(reviewed.records.map(record=>record.kind).sort()).toEqual(['initial_learning','retention_review']);
    expect(reviewed.records.every(record=>record.targetId===completed.records[0]!.targetId)).toBe(true);
    expect(Date.parse(reviewed.completedTargets[0]!.nextReviewAt!)).toBeGreaterThan(Date.parse(completed.completedTargets[0]!.nextReviewAt!));
  }finally{await page.context().setOffline(false);}
});

test('a corrupt Book download remains uninstalled and can be retried through the UI',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  let corrupt=true;
  await page.route('**/*.sensa-book',route=>corrupt?route.fulfill({status:200,body:'corrupt Book archive'}):route.continue());
  await page.goto(`${fixture.origin}/catalog`);
  await page.locator('#s-catalog').last().getByRole('button',{name:/雨天借伞/}).click();
  const book=page.locator('#s-catalog-book').last();
  await book.getByRole('button',{name:'下载学习包',exact:true}).click();
  await expect(book.getByRole('region',{name:'学习包操作',exact:true}).getByRole('alert')).toBeVisible();
  await expect(book.getByText('未下载',{exact:true})).toBeVisible();
  await expect(book.getByText('已下载',{exact:true})).toHaveCount(0);
  await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeDisabled();
  await page.reload();
  await expect(book.getByText('未下载',{exact:true})).toBeVisible({timeout:15_000});
  corrupt=false;
  await book.getByRole('button',{name:'下载学习包',exact:true}).click();
  await expect(book.getByText('已下载',{exact:true})).toBeVisible({timeout:15_000});
  await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();
});

test('a failed final member and a cancelled update leave the complete previous Book usable',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`${fixture.origin}/catalog`);
  const catalog=page.locator('#s-catalog').last();
  await catalog.getByRole('button',{name:/English route essentials/}).click();
  const book=page.locator('#s-catalog-book').last();
  await book.getByRole('button',{name:'下载学习包',exact:true}).click();
  await expect(book.getByText('已下载',{exact:true})).toBeVisible({timeout:15_000});
  const previous=await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint());
  expect(previous).toHaveLength(100);
  expect(previous.every(pack=>pack.version===1)).toBe(true);
  await book.getByRole('button',{name:'加入学习',exact:true}).click();
  await expect(book.getByText('已加入学习',{exact:true})).toBeVisible();
  const learningBefore=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
  expect(learningBefore.enrollments).toHaveLength(1);
  expect(learningBefore.enrollments[0]!.bookVersionNumber).toBe(1);
  expect(learningBefore.enrollments[0]!.bookDigest).toBe(fixture.delivery.descriptor.sha256);
  expect(learningBefore.targetIds).toHaveLength(20);

  fixture.setRegistry([fixture.invalidMemberDelivery.descriptor,fixture.learningDelivery.descriptor]);
  await page.goto(`${fixture.origin}/catalog`);
  await catalog.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(catalog.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
  await catalog.getByRole('button',{name:/English route essentials/}).click();
  await expect(book.getByRole('button',{name:'去学习',exact:true})).toBeEnabled();
  await book.getByRole('button',{name:'下载更新',exact:true}).click();
  await expect(book.getByRole('region',{name:'学习包操作',exact:true}).getByRole('alert')).toHaveText('下载结果与目录版本不一致，请刷新目录后重试。');
  await expect(book.getByText('更新已下载',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual(previous);
  await page.reload();
  const previousContents=book.getByRole('region',{name:'包内内容',exact:true});
  await previousContents.getByRole('button',{name:'查看更多',exact:true}).click();
  await previousContents.getByRole('searchbox',{name:'搜索表达',exact:true}).fill('borrow');
  await expect(previousContents.getByText('borrow',{exact:true})).toBeVisible({timeout:15_000});
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual(previous);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(learningBefore);

  fixture.setRegistry([fixture.updateDelivery.descriptor,fixture.learningDelivery.descriptor]);
  await page.goto(`${fixture.origin}/catalog`);
  await catalog.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(catalog.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
  await catalog.getByRole('button',{name:/English route essentials/}).click();
  fixture.heldArchivePath=new URL(fixture.updateDelivery.descriptor.url).pathname;
  await expect(book.getByRole('button',{name:'去学习',exact:true})).toBeEnabled();
  await book.getByRole('button',{name:'下载更新',exact:true}).click();
  await expect(book.getByRole('progressbar')).toBeVisible();
  await book.getByRole('button',{name:'取消下载',exact:true}).click();
  await expect(book.getByText('下载已取消。',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual(previous);
  await page.reload();

  await previousContents.getByRole('button',{name:'查看更多',exact:true}).click();
  await previousContents.getByRole('searchbox',{name:'搜索表达',exact:true}).fill('borrow');
  await expect(previousContents.getByText('borrow',{exact:true})).toBeVisible({timeout:15_000});
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual(previous);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(learningBefore);
  fixture.heldArchivePath=null;
  await expect(book.getByRole('button',{name:'去学习',exact:true})).toBeEnabled();
  await book.getByRole('button',{name:'下载更新',exact:true}).click();
  await expect(book.getByText('更新已下载',{exact:true})).toBeVisible({timeout:15_000});
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).filter(pack=>pack.version===2)).toHaveLength(100);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(learningBefore);
});

test('the Book journey stays responsive with 342 catalog entries and a 100-member Book at 4x CPU',{tag:'@book-scale-performance'},async({page,context})=>{
  const entries=Array.from({length:340},(_,index)=>({
    ...fixture.learningDelivery.descriptor,
    book:{...fixture.learningDelivery.descriptor.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:`scale-fixture-${index}`,title:`目录规模样本 ${index}`},
  }));
  fixture.setRegistry([fixture.scaleDelivery.descriptor,fixture.learningDelivery.descriptor,...entries]);
  expect(fixture.scaleDelivery.descriptor.byteLength).toBeGreaterThan(5*1024*1024);
  fixture.catalogLatencyMs=fixture.artifactLatencyMs=300;
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.addInitScript(()=>{
    const durations:number[]=[];
    (window as unknown as {__bookJourneyLongTasks:number[]}).__bookJourneyLongTasks=durations;
    new PerformanceObserver(list=>durations.push(...list.getEntries().map(entry=>entry.duration))).observe({entryTypes:['longtask']});
  });
  const timings:Record<string,number>={};
  const measure=async(label:string,budget:number,work:()=>Promise<void>)=>{
    const started=performance.now();await work();timings[label]=Math.round(performance.now()-started);
    assertInteractionBudget(timings[label]!,budget,`${label} controlled CI interaction`);
  };
  try{
    await measure('catalogCold',6000,async()=>{
      await page.goto(`${fixture.origin}/catalog`);
      await page.locator('#s-catalog').last().locator('[data-package-key]').first().waitFor({state:'visible',timeout:15_000});
  });
  const catalog=page.locator('#s-catalog').last();
  const book=page.locator('#s-catalog-book').last();
    await expect(catalog.locator('ul>li')).toHaveCount(24);
    await expect(catalog.getByRole('button',{name:'第 2 页',exact:true})).toBeVisible();
    const catalogExpansionStarted=performance.now();
    await catalog.getByRole('button',{name:'第 2 页',exact:true}).click();
    await expect(catalog.getByText('第 25–48 项，共 342 项',{exact:true})).toBeVisible();
    await expect(catalog.locator('ul>li')).toHaveCount(24);
    timings.catalogPage1To2=Math.round(performance.now()-catalogExpansionStarted);
    await measure('searchAcrossAll342Entries',1500,async()=>{
      await catalog.getByRole('searchbox').fill('目录规模样本 339');
      await expect(catalog.locator('ul>li')).toHaveCount(1);
    });
    const distantBookTitle='目录规模样本 339';
    await measure('open342ndCatalogEntry',2000,async()=>{
      await catalog.getByRole('button',{name:distantBookTitle}).click();
      await expect(book.getByRole('heading',{name:distantBookTitle,exact:true})).toBeVisible();
    });
    await book.getByRole('button',{name:'返回',exact:true}).click();
    await measure('search',1500,async()=>{
      await catalog.getByRole('searchbox').fill('English route essentials');
      await expect(catalog.locator('ul>li')).toHaveCount(1);
    });
    await measure('bookDetail',2000,async()=>{
      await catalog.getByRole('button',{name:/English route essentials/}).click();
      await expect(book.getByRole('button',{name:'下载学习包',exact:true})).toBeEnabled();
    });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
    try{
      await measure('install100',6000,async()=>{
        await book.getByRole('button',{name:'下载学习包',exact:true}).click();
        await book.getByText('已下载',{exact:true}).waitFor({state:'visible',timeout:15_000});
      });
    }finally{
      const {profile}=await cdp.send('Profiler.stop');
      await writeFile(test.info().outputPath('installation-cpu.cpuprofile'),JSON.stringify(profile));
      await test.info().attach('installation-cpu.cpuprofile',{body:JSON.stringify(profile),contentType:'application/json'});
      await cdp.send('Profiler.disable');
    }
    expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toHaveLength(100);
    await measure('explicitEnrollment',4000,async()=>{
      await book.getByRole('button',{name:'加入学习',exact:true}).click();
      await book.getByText('已加入学习',{exact:true}).waitFor({state:'visible',timeout:15_000});
    });
    const initialLongTasks=await page.evaluate(()=>(window as unknown as {__bookJourneyLongTasks:number[]}).__bookJourneyLongTasks);
    await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
    try{
      await measure('restoredDetail',6000,async()=>{
        await page.reload();
        await book.getByText('已加入学习',{exact:true}).waitFor({state:'visible',timeout:15_000});
      });
    }finally{
      const {profile}=await cdp.send('Profiler.stop');
      await writeFile(test.info().outputPath('restoration-cpu.cpuprofile'),JSON.stringify(profile));
      await test.info().attach('restoration-cpu.cpuprofile',{body:JSON.stringify(profile),contentType:'application/json'});
      await cdp.send('Profiler.disable');
    }
    const beforeIdle=fixture.catalogAuthorizationHeaders.length;
    // An explicit observation window, not a wait for UI readiness.
    await page.waitForTimeout(1000);
    expect(fixture.catalogAuthorizationHeaders.length-beforeIdle).toBe(0);
    const restoredLongTasks=await page.evaluate(()=>(window as unknown as {__bookJourneyLongTasks:number[]}).__bookJourneyLongTasks);
    const maximumLongTaskMs=Math.max(0,...initialLongTasks,...restoredLongTasks);
    assertInteractionBudget(maximumLongTaskMs,1000,'main-thread freeze at 4x CPU');
    await test.info().attach('journey-performance.json',{body:JSON.stringify({platform:process.platform,arch:process.arch,cpuModel:cpus()[0]?.model??'unknown',logicalCpus:cpus().length,node:process.versions.node,catalogEntries:342,catalogPageSize:24,catalogPages:15,bookMembers:100,bookBytes:fixture.scaleDelivery.descriptor.byteLength,cpuThrottle:4,fixtureLatencyMs:300,timings,maximumLongTaskMs,idleCatalogRequests:0,scope:'Controlled Chromium regression budgets; catalogCold ends when the first window is interactive; these are not real-device CWV or production backend SLOs.'}),contentType:'application/json'});
    console.log(`Book journey controlled performance: ${JSON.stringify({timings,maximumLongTaskMs})}`);
  }finally{
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
    await cdp.detach();
  }
});

test('the guest Book path keeps its primary actions reachable at 320px',async({page})=>{
  await page.setViewportSize({width:320,height:740});
  const noOverflow=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
  await page.goto(fixture.origin);
  await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
  const home=page.locator('#s-home');
  await expect(home.getByRole('heading',{name:'还没有加入学习内容',exact:true})).toBeVisible({timeout:15_000});
  await expect(home.getByRole('button',{name:'学习包目录',exact:true})).toBeVisible({timeout:15_000});
  await noOverflow();
  await home.getByRole('button',{name:'学习包目录',exact:true}).click();
  await expect(page.locator('#s-catalog').last().getByRole('button',{name:/雨天借伞/})).toBeVisible();
  await noOverflow();
  await page.locator('#s-catalog').last().getByRole('button',{name:/雨天借伞/}).click();
  const book=page.locator('#s-catalog-book').last();
  await noOverflow();
  await book.getByRole('button',{name:'下载学习包',exact:true}).click();
  await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled({timeout:15_000});
  await noOverflow();
  await book.getByRole('button',{name:'加入学习',exact:true}).click();
  await book.getByRole('button',{name:'去学习',exact:true}).click();
  await home.getByRole('button',{name:'开始学习',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'学习偏好',exact:true})).toHaveCount(0);
  const runtime=page.locator('#s-lightweight-runtime');
  await runtime.getByRole('button',{name:/查看表达/}).click();
  await noOverflow();
  await runtime.getByRole('button',{name:/已经连上/}).click();
  await runtime.getByRole('button',{name:/完成并回到首页/}).click();
  await noOverflow();
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toHaveLength(1);
  await expect(home.getByRole('heading',{name:'学习已保存，等待到期复习',exact:true})).toBeVisible();
  await expect(home.getByRole('button',{name:'学习包目录',exact:true})).toBeEnabled();
  await page.screenshot({path:test.info().outputPath('completed-home-320.png'),fullPage:true});
});

test('a route-mismatched Book stays downloaded without silently enrolling',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`${fixture.origin}/catalog`);
  const catalog=page.locator('#s-catalog').last();
  await expect(catalog.getByRole('button',{name:/西班牙语借物/})).toBeVisible({timeout:15_000});
  await catalog.getByRole('combobox',{name:'目标语言',exact:true}).selectOption('en');
  await expect(catalog.getByRole('button',{name:/西班牙语借物/})).toHaveCount(0);
  await catalog.getByRole('combobox',{name:'目标语言',exact:true}).selectOption('es');
  await catalog.getByRole('combobox',{name:'辅助语言',exact:true}).selectOption('zh-CN');
  await catalog.getByRole('button',{name:/西班牙语借物/}).click();
  const book=page.locator('#s-catalog-book').last();
  await book.getByRole('button',{name:'下载学习包',exact:true}).click();
  await expect(book.getByText('已下载',{exact:true})).toBeVisible({timeout:15_000});
  await expect(book.getByRole('status')).toContainText('只能在与其匹配的语言路线中加入学习');
  await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeDisabled();
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
  await page.reload();
  await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeDisabled({timeout:15_000});
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
});
