/** Real Chromium + shared OPFS; deterministic synthetic facts, no paid services. */
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {join,resolve} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {test as base,expect,chromium,type Page} from '@playwright/test';
import {build as viteBuild} from 'vite';
import type * as Entry from '../support/semanticLookupBrowserEntry';
import {semanticLookupPayload} from '../support/semanticLookupFixtures';
import {digestOf} from '../../../apps/web/src/experience/personalMeaningJourney/digest';

declare global {interface Window{semanticLookupFixture:typeof Entry}}
let server:Server,origin:string;
const test=base.extend<{preparedScalePage:Page}>({
  // Keep the ordinary isolated page/context and failure trace. Only synthetic
  // generation + bulk commit has this separate watchdog, not measured queries.
  preparedScalePage:[async({page},use)=>{
    page.on('console',message=>{if(message.text().startsWith('semantic-lookup phase:'))console.log(message.text());});
    const started=performance.now();
    await enter(page);expect(await page.evaluate(()=>window.semanticLookupFixture.seed(10_000))).toBe(10_000);
    console.log('Chromium / synthetic 10k OPFS fixture preparation (not user interaction):',JSON.stringify({preparedMs:performance.now()-started}));
    await use(page);
  },{timeout:300_000}],
});
test.setTimeout(120_000);
test.beforeAll(async()=>{
  test.setTimeout(120_000);
  const built=await viteBuild({configFile:false,worker:{format:'es'},root:process.cwd(),logLevel:'silent',base:'/',build:{write:false,minify:false,target:'es2022',rollupOptions:{preserveEntrySignatures:'strict',
    input:resolve('tests/web/support/semanticLookupBrowserEntry.ts'),output:{entryFileNames:'core.js',chunkFileNames:'assets/[name]-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'}}}});
  if(Array.isArray(built)||!('output' in built))throw new Error('Expected one browser fixture bundle');
  const files=new Map(built.output.map(file=>[file.fileName,file.type==='chunk'?file.code:file.source]));
  server=createServer((request,response)=>{
    const path=(request.url??'/').split('?')[0]!.replace(/^\//u,''),asset=files.get(path);
    if(asset===undefined){response.setHeader('content-type','text/html');response.end('<!doctype html><title>Semantic lookup OPFS fixture</title><script type="module">import * as fixture from "/core.js"; window.semanticLookupFixture=fixture;</script>');return;}
    response.setHeader('content-type',path.endsWith('.wasm')?'application/wasm':'text/javascript');response.end(typeof asset==='string'?asset:Buffer.from(asset));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
test.afterAll(async()=>{if(server?.listening)await new Promise<void>(done=>server.close(()=>done()));});
async function enter(page:Page){await page.goto(origin);await page.waitForFunction(()=>!!window.semanticLookupFixture);await page.evaluate(()=>window.semanticLookupFixture.initialize());}

test('direct stable Sense enrollment converges across OPFS tabs and reloads without a duplicate Meaning or ready Target',async({page,context})=>{
 await enter(page);await page.evaluate(()=>window.semanticLookupFixture.seed(1000));
 const item=(await page.evaluate(()=>window.semanticLookupFixture.worldPage({query:'borrow-999',filter:'all',offset:0,limit:40}))).items[0]!;
 const {selection,languageContext}=await page.evaluate(id=>window.semanticLookupFixture.directSourceForTest(id),item.personalMeaningId);
 const command={kind:'enroll_direct' as const,operationId:crypto.randomUUID(),reference:selection.reference,expectedDigest:selection.sourceDigest,languageContext};
 const other=await context.newPage();await enter(other);
 await page.evaluate(()=>window.semanticLookupFixture.trackCommandReads());
 const [left,right]=await Promise.all([page.evaluate(input=>window.semanticLookupFixture.enrollDirectForTest(input),command),other.evaluate(input=>window.semanticLookupFixture.enrollDirectForTest(input),command)]);
 expect(left).toEqual(right);expect(left.status).toBe('awaiting_content');
 expect((await page.evaluate(()=>window.semanticLookupFixture.commandReadSnapshot())).some(row=>row.table==='semanticMeanings')).toBe(false);
 await page.evaluate(()=>window.semanticLookupFixture.stopTrackingCommandReads());
 expect(await other.evaluate(input=>window.semanticLookupFixture.enrollDirectForTest({...input,operationId:crypto.randomUUID()}),command)).toEqual(left);
 expect(await page.evaluate(()=>window.semanticLookupFixture.directCountsForTest())).toEqual({meanings:1000,enrollments:1,targets:0,runs:0});
 await page.reload();await page.waitForFunction(()=>!!window.semanticLookupFixture);
 expect(await page.evaluate(input=>window.semanticLookupFixture.enrollDirectForTest(input),command)).toEqual(left);
 expect(await page.evaluate(id=>window.semanticLookupFixture.directEnrollmentForTest(id),left.enrollmentId!)).toEqual(left);
 await other.close();
});

test('cold Inbox creation appends only this draft and converges on the exact receipt across OPFS tabs',async({page,context})=>{
 await enter(page);await page.evaluate(()=>window.semanticLookupFixture.seed(1000));
 const other=await context.newPage();await enter(other);
 await page.evaluate(()=>window.semanticLookupFixture.trackCommandReads());
 const text='a fresh learner capture without reading 1000 confirmed Meanings',operationId=crypto.randomUUID();
 const created=await page.evaluate(({text,operationId})=>window.semanticLookupFixture.createColdDraft(text,operationId),{text,operationId});
 expect(created).toMatchObject({status:'pending_expression',replayed:false});
 expect((await page.evaluate(()=>window.semanticLookupFixture.commandReadSnapshot())).some(row=>['semanticMeanings','semanticRegistry'].includes(row.table))).toBe(false);
 expect(await page.evaluate(({text,operationId})=>window.semanticLookupFixture.createColdDraft(text,operationId),{text,operationId})).toEqual({...created,replayed:true});
 await page.evaluate(()=>window.semanticLookupFixture.holdCommit());
 const sameOperation=crypto.randomUUID(),pending=page.evaluate(({text,operationId})=>window.semanticLookupFixture.createColdDraft(text,operationId),{text,operationId:sameOperation});
 await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.commitEntered())).toBe(true);
 const winner=await other.evaluate(({text,operationId})=>window.semanticLookupFixture.createColdDraft(text,operationId),{text,operationId:sameOperation});
 const unrelated=await other.evaluate(()=>window.semanticLookupFixture.createColdDraft('an unrelated capture while another write is pending'));
 await page.evaluate(()=>window.semanticLookupFixture.releaseCommit());expect(await pending).toEqual({...winner,replayed:true});
 const detail=await page.evaluate(id=>window.semanticLookupFixture.worldDetail(id),winner.intakeId);expect(detail.draft?.materialBlocks[0]?.bodyText).toBe(text);
 await page.evaluate(()=>window.semanticLookupFixture.stopTrackingCommandReads());
 const saved=await page.evaluate(()=>window.semanticLookupFixture.checkpoint());expect(saved.inboxIds).toEqual([created.intakeId,winner.intakeId,unrelated.intakeId].sort());expect(saved.draftIds).toEqual(saved.inboxIds);
 await page.reload();await page.waitForFunction(()=>!!window.semanticLookupFixture);
 expect(await page.evaluate(()=>window.semanticLookupFixture.checkpoint())).toEqual(saved);
 expect(await page.evaluate(({text,operationId})=>window.semanticLookupFixture.createColdDraft(text,operationId),{text,operationId:sameOperation})).toEqual({...winner,replayed:true});
 await other.close();
});

test('cold Inbox acceptance and dismissal fence reviewed material and replay one receipt across OPFS tabs',async({page,context})=>{
 await enter(page);await page.evaluate(()=>window.semanticLookupFixture.seed(1000));
 const pending={...semanticLookupPayload(),acceptance:null};
 const queued=await page.evaluate(payload=>window.semanticLookupFixture.submitPayload(payload),pending);if(queued.route!=='inbox')throw new Error('fixture must queue');
 const item=(await page.evaluate(()=>window.semanticLookupFixture.worldInbox())).items.find(item=>item.intakeId===queued.intakeId)!;
 const command={operationId:crypto.randomUUID(),intakeId:item.intakeId,expectedItemDigest:digestOf(item),sense:item.payload.sense!};
 const other=await context.newPage();await enter(other);
 await page.evaluate(()=>window.semanticLookupFixture.trackCommandReads());await page.evaluate(()=>window.semanticLookupFixture.holdCommit());
 const own=page.evaluate(command=>window.semanticLookupFixture.resolveColdInbox(command),command);await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.commitEntered())).toBe(true);
 const winner=await other.evaluate(command=>window.semanticLookupFixture.resolveColdInbox(command),command);
 const unrelated=await other.evaluate(()=>window.semanticLookupFixture.createColdDraft('keep this unrelated material'));
 await page.evaluate(()=>window.semanticLookupFixture.releaseCommit());expect(await own).toEqual({...winner,replayed:true});
 const reads=await page.evaluate(()=>window.semanticLookupFixture.commandReadSnapshot());expect(reads.filter(row=>row.table==='semanticMeanings').every(row=>winner.route==='fast_track'&&row.key===winner.personalMeaningId)).toBe(true);
 await page.evaluate(()=>window.semanticLookupFixture.stopTrackingCommandReads());
 const remaining=(await page.evaluate(()=>window.semanticLookupFixture.worldInbox())).items;expect(remaining.map(item=>item.intakeId)).toEqual([unrelated.intakeId]);
 const discard={operationId:crypto.randomUUID(),intakeId:unrelated.intakeId,expectedItemDigest:digestOf(remaining[0])};
 await page.evaluate(()=>window.semanticLookupFixture.trackCommandReads());await page.evaluate(()=>window.semanticLookupFixture.holdCommit());
 const deleting=page.evaluate(command=>window.semanticLookupFixture.dismissColdInbox(command),discard);await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.commitEntered())).toBe(true);
 await other.evaluate(command=>window.semanticLookupFixture.dismissColdInbox(command),discard);await page.evaluate(()=>window.semanticLookupFixture.releaseCommit());await deleting;
 expect((await page.evaluate(()=>window.semanticLookupFixture.commandReadSnapshot())).some(row=>['semanticMeanings','semanticRegistry'].includes(row.table))).toBe(false);
 await page.evaluate(()=>window.semanticLookupFixture.stopTrackingCommandReads());await page.reload();await page.waitForFunction(()=>!!window.semanticLookupFixture);
 expect(await page.evaluate(command=>window.semanticLookupFixture.resolveColdInbox(command),command)).toEqual({...winner,replayed:true});await page.evaluate(command=>window.semanticLookupFixture.dismissColdInbox(command),discard);
 expect((await page.evaluate(()=>window.semanticLookupFixture.worldInbox())).items).toEqual([]);await other.close();
});

test('cold scoped Context writes use exact rows and survive cross-tab races and replay in real OPFS',async({page,context})=>{
 await enter(page);await page.evaluate(()=>window.semanticLookupFixture.submit());
 const before=await page.evaluate(()=>window.semanticLookupFixture.worldPage({query:'',filter:'all',offset:0,limit:64})),id=before.items[0]!.personalMeaningId;
 const other=await context.newPage();await enter(other);
 await page.evaluate(()=>window.semanticLookupFixture.trackCommandReads());
 const operationId=crypto.randomUUID(),result=await page.evaluate(({id,operationId})=>window.semanticLookupFixture.reviseContext(id,1,'first isolated OPFS scene',operationId),{id,operationId});
 expect(result).toMatchObject({revision:2,replayed:false});
 const reads=await page.evaluate(()=>window.semanticLookupFixture.commandReadSnapshot());expect(reads.filter(row=>row.table==='semanticMeanings').every(row=>row.key===id)).toBe(true);expect(reads.filter(row=>row.table==='semanticMeanings').length).toBeLessThan(4);expect(reads.filter(row=>row.table==='semanticRegistry').length).toBeLessThan(30);
 expect(await page.evaluate(({id,operationId})=>window.semanticLookupFixture.reviseContext(id,1,'first isolated OPFS scene',operationId),{id,operationId})).toEqual({...result,replayed:true});
 await page.evaluate(()=>window.semanticLookupFixture.holdCommit());
 const own=page.evaluate(id=>window.semanticLookupFixture.reviseContext(id,2,'concurrent Inbox must not get lost'),id);await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.commitEntered())).toBe(true);
 const inbox=await other.evaluate(()=>window.semanticLookupFixture.draft('foreign Inbox while a scoped scene save is waiting'));
 await page.evaluate(()=>window.semanticLookupFixture.releaseCommit());expect(await own).toMatchObject({revision:3});
 await page.evaluate(()=>window.semanticLookupFixture.holdCommit());const staleId=crypto.randomUUID();
 const stale=page.evaluate(async({id,operationId})=>{try{await window.semanticLookupFixture.reviseContext(id,3,'must not overwrite the foreign scene',operationId);return 'unexpected success';}catch(cause){return cause instanceof Error?cause.message:String(cause);}},{id,operationId:staleId});
 await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.commitEntered())).toBe(true);
 await other.evaluate(id=>window.semanticLookupFixture.reviseContext(id,3,'foreign scene wins the exact revision'),id);
 await page.evaluate(()=>window.semanticLookupFixture.releaseCommit());expect(await stale).toContain('meaningChanged');expect(await page.evaluate(id=>window.semanticLookupFixture.receipt(id),staleId)).toBeNull();
 const detail=await page.evaluate(id=>window.semanticLookupFixture.worldDetail(id),id),senseVersion=detail.detail!.directAlignments[0]!.senseVersionId;
 await page.evaluate(()=>window.semanticLookupFixture.holdCommit());const missingOp=crypto.randomUUID();
 const waiting=page.evaluate(async({id,operationId})=>{try{await window.semanticLookupFixture.reviseContext(id,4,'cannot replace the scene with a missing fixed version',operationId);return 'unexpected success';}catch(cause){return cause instanceof Error?cause.message:String(cause);}},{id,operationId:missingOp});
 await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.commitEntered())).toBe(true);await other.evaluate(id=>window.semanticLookupFixture.removeVersion(id),senseVersion);
 await page.evaluate(()=>window.semanticLookupFixture.releaseCommit());expect(await waiting).toContain('meaningChanged');await other.evaluate(()=>window.semanticLookupFixture.restoreVersion());
 expect(await page.evaluate(id=>window.semanticLookupFixture.receipt(id),missingOp)).toBeNull();
 await page.evaluate(()=>window.semanticLookupFixture.stopTrackingCommandReads());const saved=await page.evaluate(()=>window.semanticLookupFixture.checkpoint());expect(saved.inboxIds).toContain(inbox.intakeId);
 await page.reload();await page.waitForFunction(()=>!!window.semanticLookupFixture);const reloaded=await page.evaluate(id=>window.semanticLookupFixture.worldDetail(id),id);
 expect(reloaded.detail?.revision).toBe(4);expect(reloaded.detail?.materialBlocks[0]?.bodyText).toBe('foreign scene wins the exact revision');expect(await page.evaluate(()=>window.semanticLookupFixture.checkpoint())).toEqual(saved);
 await other.close();
});

test('cold confirmation preserves unrelated OPFS writes, converges on an exact receipt and rejects missing fixed pins',async({page,context})=>{
 await enter(page);await page.evaluate(()=>window.semanticLookupFixture.seed(1000));const other=await context.newPage();await enter(other);
 const match=(await page.evaluate(()=>window.semanticLookupFixture.lookup('borrow-999'))).meanings[0]!;
 const draft=await page.evaluate(()=>window.semanticLookupFixture.createColdDraft('first cold confirmation with an independent writer'));
 const source=await page.evaluate(id=>window.semanticLookupFixture.captureSource(id),draft.intakeId),operationId=crypto.randomUUID();
 await page.evaluate(()=>window.semanticLookupFixture.trackCommandReads());await page.evaluate(()=>window.semanticLookupFixture.holdCommit());
 const own=page.evaluate(({id,match,source,operationId})=>window.semanticLookupFixture.coldConfirm(id,match,source,operationId),{id:draft.intakeId,match,source,operationId});
 await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.commitEntered())).toBe(true);
 const unrelated=await other.evaluate(()=>window.semanticLookupFixture.createColdDraft('this foreign draft must remain after confirmation'));
 await page.evaluate(()=>window.semanticLookupFixture.releaseCommit());const saved=await own;
 const reads=await page.evaluate(()=>window.semanticLookupFixture.commandReadSnapshot());expect(reads.filter(row=>row.table==='semanticMeanings').every(row=>row.key===saved.personalMeaningId)).toBe(true);
 expect(await page.evaluate(({id,match,source,operationId})=>window.semanticLookupFixture.coldConfirm(id,match,source,operationId),{id:draft.intakeId,match,source,operationId})).toEqual({...saved,replayed:true});
 const duplicate=await page.evaluate(()=>window.semanticLookupFixture.createColdDraft('same-operation two-tab confirmation'));
 const duplicateSource=await page.evaluate(id=>window.semanticLookupFixture.captureSource(id),duplicate.intakeId),sameOperation=crypto.randomUUID();
 await page.evaluate(()=>window.semanticLookupFixture.holdCommit());
 const pending=page.evaluate(({id,match,source,operationId})=>window.semanticLookupFixture.coldConfirm(id,match,source,operationId),{id:duplicate.intakeId,match,source:duplicateSource,operationId:sameOperation});
 await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.commitEntered())).toBe(true);
 const winner=await other.evaluate(({id,match,source,operationId})=>window.semanticLookupFixture.coldConfirm(id,match,source,operationId),{id:duplicate.intakeId,match,source:duplicateSource,operationId:sameOperation});
 await page.evaluate(()=>window.semanticLookupFixture.releaseCommit());expect(await pending).toEqual({...winner,replayed:true});
 const broken=await page.evaluate(()=>window.semanticLookupFixture.createColdDraft('missing version must leave this source intact'));
 const brokenSource=await page.evaluate(id=>window.semanticLookupFixture.captureSource(id),broken.intakeId),brokenOperation=crypto.randomUUID();
 await page.evaluate(()=>window.semanticLookupFixture.holdCommit());
 const rejected=page.evaluate(async({id,match,source,operationId})=>{try{await window.semanticLookupFixture.coldConfirm(id,match,source,operationId);return 'unexpected success';}catch(cause){return cause instanceof Error?cause.message:String(cause);}},{id:broken.intakeId,match,source:brokenSource,operationId:brokenOperation});
 await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.commitEntered())).toBe(true);await other.evaluate(id=>window.semanticLookupFixture.removeVersion(id),match.senseVersionId);
 await page.evaluate(()=>window.semanticLookupFixture.releaseCommit());expect(await rejected).toContain('meaningChanged');expect(await page.evaluate(id=>window.semanticLookupFixture.receipt(id),brokenOperation)).toBeNull();await other.evaluate(()=>window.semanticLookupFixture.restoreVersion());
 await page.evaluate(()=>window.semanticLookupFixture.stopTrackingCommandReads());
 const checkpoint=await page.evaluate(()=>window.semanticLookupFixture.checkpoint());expect(checkpoint.inboxIds).toEqual([unrelated.intakeId,broken.intakeId].sort());
 await page.reload();await page.waitForFunction(()=>!!window.semanticLookupFixture);expect(await page.evaluate(()=>window.semanticLookupFixture.checkpoint())).toEqual(checkpoint);await other.close();
});

test('World repository distinguishes an empty Library from a missing version root and preserves exact detail pins',async({page})=>{
 await enter(page);const query={query:'',filter:'all' as const,offset:0,limit:40};
 expect((await page.evaluate(query=>window.semanticLookupFixture.worldPage(query),query)).total).toBe(0);
 await page.evaluate(()=>window.semanticLookupFixture.submit());
 const before=await page.evaluate(query=>window.semanticLookupFixture.worldPage(query),query),id=before.items[0]!.personalMeaningId;
 const detail=await page.evaluate(id=>window.semanticLookupFixture.worldDetail(id),id);
 const pinned=detail.detail!.directAlignments[0]!.senseVersionId;
 await page.evaluate(()=>window.semanticLookupFixture.advanceHeads());
 expect((await page.evaluate(id=>window.semanticLookupFixture.worldDetail(id),id)).detail!.directAlignments[0]!.senseVersionId).toBe(pinned);
 await page.evaluate(()=>window.semanticLookupFixture.removeVersionRoot());
 const failure=await page.evaluate(async query=>{try{await window.semanticLookupFixture.worldPage(query);return 'unexpected empty Library';}catch(error){return error instanceof Error?error.message:String(error);}},query);
 expect(failure).toContain('缺少版本记录');
 await page.evaluate(()=>window.semanticLookupFixture.restoreVersionRoot());
 expect((await page.evaluate(query=>window.semanticLookupFixture.worldPage(query),query)).items).toEqual(before.items);
});

test('foreign writes refresh lookup, merge a stale command, and preserve old version pins across deletion',async({page,context})=>{
  await enter(page);const other=await context.newPage();await enter(other);
  await other.evaluate(()=>window.semanticLookupFixture.submit());
  const foreign=await other.evaluate(()=>window.semanticLookupFixture.draft('foreign Inbox'));
  const own=await page.evaluate(()=>window.semanticLookupFixture.draft('own Inbox'));
  expect(await page.evaluate(()=>window.semanticLookupFixture.visible())).toHaveLength(1);
  expect((await page.evaluate(()=>window.semanticLookupFixture.checkpoint())).inboxIds).toEqual([foreign.intakeId,own.intakeId].sort());
  const match=(await page.evaluate(()=>window.semanticLookupFixture.lookup())).meanings[0]!;
  const sourceId=(await page.evaluate(()=>window.semanticLookupFixture.checkpoint())).meaningStatuses[0]!.id;
  await other.evaluate(()=>window.semanticLookupFixture.advanceHeads());
  expect((await page.evaluate(()=>window.semanticLookupFixture.lookup())).meanings[0]!.senseVersionId).toBe(match.senseVersionId);
  expect(await page.evaluate(id=>window.semanticLookupFixture.learning(id),sourceId)).toMatchObject([{sense:match.senseVersionId,expression:'borrow'}]);
  await page.evaluate(()=>window.semanticLookupFixture.holdCommit());
  const confirmation=page.evaluate(({intakeId,match})=>window.semanticLookupFixture.confirm(intakeId,match),{intakeId:own.intakeId,match});
  await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.commitEntered())).toBe(true);
  await other.evaluate(()=>window.semanticLookupFixture.deleteSource());
  await page.evaluate(()=>window.semanticLookupFixture.releaseCommit());const saved=await confirmation;
  const after=await page.evaluate(()=>window.semanticLookupFixture.checkpoint());
  expect(after.meaningStatuses.find(row=>row.id===sourceId)!.status).toBe('deleted');
  expect(after.meaningStatuses.find(row=>row.id===saved.personalMeaningId)!.status).toBe('active');
  expect(saved.senseVersionId).toBe(match.senseVersionId);
  expect(after.inboxIds).toEqual([foreign.intakeId]);
  expect(await page.evaluate(()=>window.semanticLookupFixture.visible())).toEqual([saved.personalMeaningId]);
  await page.reload();await page.waitForFunction(()=>!!window.semanticLookupFixture);await page.evaluate(()=>window.semanticLookupFixture.initialize());
  expect(await page.evaluate(()=>window.semanticLookupFixture.checkpoint())).toEqual(after);
  await page.evaluate(()=>window.semanticLookupFixture.watch());
  await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.visible())).toEqual([saved.personalMeaningId]);
  await page.evaluate(()=>window.semanticLookupFixture.unwatch());
  await other.close();
});

test('a selected version disappearing before commit rejects atomically and preserves the original draft',async({page,context})=>{
  await enter(page);await page.evaluate(()=>window.semanticLookupFixture.submit());
  const match=(await page.evaluate(()=>window.semanticLookupFixture.lookup())).meanings[0]!;
  const draft=await page.evaluate(()=>window.semanticLookupFixture.draft());
  const before=await page.evaluate(()=>window.semanticLookupFixture.checkpoint());
  const other=await context.newPage();await enter(other);
  await page.evaluate(()=>window.semanticLookupFixture.holdCommit());
  const confirmation=page.evaluate(async({intakeId,match})=>{try{await window.semanticLookupFixture.confirm(intakeId,match);return 'unexpected success';}catch(error){return error instanceof Error?error.message:String(error);}},{intakeId:draft.intakeId,match});
  await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.commitEntered())).toBe(true);
  await other.evaluate(id=>window.semanticLookupFixture.removeVersion(id),match.senseVersionId);
  await page.evaluate(()=>window.semanticLookupFixture.releaseCommit());expect(await confirmation).toContain('meaningChanged');
  await other.evaluate(()=>window.semanticLookupFixture.restoreVersion());
  expect(await other.evaluate(()=>window.semanticLookupFixture.checkpoint())).toEqual(before);
  await page.reload();await page.waitForFunction(()=>!!window.semanticLookupFixture);await page.evaluate(()=>window.semanticLookupFixture.initialize());
  expect((await page.evaluate(()=>window.semanticLookupFixture.checkpoint())).draftIds).toContain(draft.intakeId);
  await other.close();
});

test('a stale proposal source and a material change during held commit both reject without dropping the original Inbox',async({page,context})=>{
 await enter(page);const other=await context.newPage();await enter(other);await page.evaluate(()=>window.semanticLookupFixture.submit());
 const match=(await page.evaluate(()=>window.semanticLookupFixture.lookup())).meanings[0]!;
 const draft=await page.evaluate(()=>window.semanticLookupFixture.draft('original source before model generation'));
 const source=await page.evaluate(id=>window.semanticLookupFixture.captureSource(id),draft.intakeId);
 await other.evaluate(id=>window.semanticLookupFixture.appendDraftMaterial(id,'foreign source change after model result'),draft.intakeId);
 const before=await page.evaluate(()=>window.semanticLookupFixture.checkpoint());
 const stale=await page.evaluate(async args=>{try{await window.semanticLookupFixture.confirm(args.id,args.match,args.source);return 'unexpected success';}catch(error){return error instanceof Error?error.message:String(error);}},
  {id:draft.intakeId,match,source});
 expect(stale).toContain('clarificationSourceChanged');expect(await page.evaluate(()=>window.semanticLookupFixture.checkpoint())).toEqual(before);
 // Detach/load the command view so this second attempt really reaches the
 // held commit, rather than failing solely on its previous in-memory frame.
 await page.reload();await page.waitForFunction(()=>!!window.semanticLookupFixture);
 const current=await page.evaluate(id=>window.semanticLookupFixture.captureSource(id),draft.intakeId),operationId=crypto.randomUUID();
 await page.evaluate(()=>window.semanticLookupFixture.holdCommit());
 const waiting=page.evaluate(async args=>{try{await window.semanticLookupFixture.confirm(args.id,args.match,args.source,args.operationId);return 'unexpected success';}catch(error){return error instanceof Error?error.message:String(error);}},
  {id:draft.intakeId,match,source:current,operationId});
 await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.commitEntered())).toBe(true);
 await other.evaluate(id=>window.semanticLookupFixture.appendDraftMaterial(id,'foreign source change after the command checked its witness'),draft.intakeId);
 const latest=await other.evaluate(()=>window.semanticLookupFixture.checkpoint());
 await page.evaluate(()=>window.semanticLookupFixture.releaseCommit());expect(await waiting).toContain('meaningChanged');
 expect(await page.evaluate(()=>window.semanticLookupFixture.checkpoint())).toEqual(latest);expect(latest.inboxIds).toContain(draft.intakeId);expect(latest.receiptIds).not.toContain(operationId);
 await page.reload();await page.waitForFunction(()=>!!window.semanticLookupFixture);
 expect(await page.evaluate(()=>window.semanticLookupFixture.checkpoint())).toEqual(latest);await other.close();
});

test('cross-tab concurrent and stale intake retries return the same durable receipt without duplicate facts',async({page,context})=>{
  await enter(page);const other=await context.newPage();await enter(other);
  const payload=semanticLookupPayload();
  await page.evaluate(()=>window.semanticLookupFixture.holdCommit());
  const waiting=page.evaluate(payload=>window.semanticLookupFixture.submitPayload(payload),payload);
  await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.commitEntered())).toBe(true);
  const winner=await other.evaluate(payload=>window.semanticLookupFixture.submitPayload(payload),payload);
  await page.evaluate(()=>window.semanticLookupFixture.releaseCommit());const replay=await waiting;
  expect(replay).toEqual({...winner,replayed:true});
  const stored=await page.evaluate(()=>window.semanticLookupFixture.checkpoint());expect(stored.meaningStatuses).toHaveLength(1);expect(stored.receiptIds).toEqual([payload.operationId]);
  const stale=await context.newPage();await enter(stale);
  expect(await stale.evaluate(payload=>window.semanticLookupFixture.submitPayload(payload),payload)).toEqual(replay);
  const changed={...payload,context:{...payload.context!,source:{client:'fixture',title:'Different input with the same operation',url:null,sourceReferenceId:null,domSelector:null,paragraphContext:null}}};
  const failure=await stale.evaluate(async payload=>{try{await window.semanticLookupFixture.submitPayload(payload);return 'unexpected success';}catch(error){return error instanceof Error?error.message:String(error);}},changed);
  expect(failure).toContain('operationId');expect(await stale.evaluate(()=>window.semanticLookupFixture.checkpoint())).toEqual(stored);
  await other.close();await stale.close();
});

test('an independent Inbox read follows cross-tab creation and dismissal while its command gateway stays cold',async({page,context})=>{
 await enter(page);await page.evaluate(()=>window.semanticLookupFixture.seed(1000));
 await page.evaluate(()=>window.semanticLookupFixture.watchInboxRead());
 await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.inboxReadState())).toMatchObject({status:{ok:true,loading:false},ids:[]});
 expect((await page.evaluate(()=>window.semanticLookupFixture.status())).loading).toBe(true);
 const other=await context.newPage();await enter(other);
 const saved=await other.evaluate(()=>window.semanticLookupFixture.createColdDraft('foreign capture for independent Inbox'));
 await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.inboxReadState())).toMatchObject({status:{ok:true,loading:false},ids:[saved.intakeId]});
 await other.evaluate(id=>window.semanticLookupFixture.dismissInbox(id),saved.intakeId);
 await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.inboxReadState())).toMatchObject({status:{ok:true,loading:false},ids:[]});
 expect((await page.evaluate(()=>window.semanticLookupFixture.status())).loading).toBe(true);
 await page.evaluate(()=>window.semanticLookupFixture.unwatchInboxRead());
 const missed=await other.evaluate(()=>window.semanticLookupFixture.createColdDraft('captured while drawer closed'));
 await page.evaluate(()=>window.semanticLookupFixture.watchInboxRead());
 await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.inboxReadState())).toMatchObject({status:{ok:true,loading:false},ids:[missed.intakeId]});
 await page.reload();await page.waitForFunction(()=>!!window.semanticLookupFixture);
 expect((await page.evaluate(()=>window.semanticLookupFixture.worldInbox())).items.map(item=>item.intakeId)).toEqual([missed.intakeId]);
 const orphan=await page.evaluate(()=>window.semanticLookupFixture.injectOrphanDraftHint());
 const corrupted=await page.evaluate(async()=>{try{await window.semanticLookupFixture.worldInbox();return 'unexpected valid Inbox';}catch(cause){return cause instanceof Error?cause.message:String(cause);}});
 expect(corrupted).toContain('会话记录');
 await page.evaluate(id=>window.semanticLookupFixture.removeDraftHint(id),orphan);
 expect((await page.evaluate(()=>window.semanticLookupFixture.worldInbox())).items.map(item=>item.intakeId)).toEqual([missed.intakeId]);
 await other.close();
});

test('an open subscribed World and Inbox follow foreign commits without requiring a lookup or another command',async({page,context})=>{
  await enter(page);await page.evaluate(()=>window.semanticLookupFixture.watch());
  const other=await context.newPage();await enter(other);
  const saved=await other.evaluate(()=>window.semanticLookupFixture.submit());
  if(saved.route!=='fast_track')throw new Error('fixture must enter World');
  await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.visible())).toEqual([saved.personalMeaningId]);
  const pending=await other.evaluate(()=>window.semanticLookupFixture.draft('foreign pending material'));
  await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.inbox())).toEqual([pending.intakeId]);
  await page.evaluate(()=>window.semanticLookupFixture.unwatch());
  await other.evaluate(()=>window.semanticLookupFixture.deleteSource());
  await page.evaluate(()=>window.semanticLookupFixture.watch());
  await expect.poll(()=>page.evaluate(()=>window.semanticLookupFixture.visible())).toEqual([]);
  await page.evaluate(()=>window.semanticLookupFixture.unwatch());await other.close();
});

test('a cached exact operation cannot replay into a replaced Library before a notification is observed',async({page,context})=>{
  await enter(page);const payload=semanticLookupPayload();await page.evaluate(payload=>window.semanticLookupFixture.submitPayload(payload),payload);
  expect(await page.evaluate(()=>window.semanticLookupFixture.visible())).toHaveLength(1);
  const other=await context.newPage();await enter(other);await other.evaluate(()=>window.semanticLookupFixture.replaceIncarnation());
  const failure=await page.evaluate(async payload=>{try{await window.semanticLookupFixture.submitPayload(payload);return 'unexpected success';}catch(error){return error instanceof Error?error.message:String(error);}},payload);
  expect(failure).toContain('libraryReplaced');expect((await page.evaluate(()=>window.semanticLookupFixture.status())).ok).toBe(false);
  expect(await page.evaluate(()=>window.semanticLookupFixture.visible())).toEqual([]);await other.close();
});

test('10k OPFS connections keep first-after-write and warm lookup bounded without blocking the browser heartbeat',async({preparedScalePage:page})=>{
  const measured=await page.evaluate(()=>window.semanticLookupFixture.measureQueries());
  console.log('Chromium / real OPFS / synthetic 10k connections / no model latency:',JSON.stringify(measured));
  expect(measured.count).toBe(1);expect(measured.warmP95Ms).toBeLessThan(100);
  expect(measured.firstQueryMs).toBeLessThan(500);
  expect(measured.maxTimerGapMs).toBeLessThan(100);
  for(const query of ['临','临时','龘','😀']){
    const short=await page.evaluate(query=>window.semanticLookupFixture.measureQueries(query,query==='龘'||query==='😀'),query);
    console.log('Chromium / real OPFS / synthetic 10k / short query:',JSON.stringify({query,...short}));
    const matching=query==='临'||query==='临时';expect(short.count).toBe(matching?5:0);expect(short.truncated).toBe(matching);
    expect(short.firstQueryMs).toBeLessThan(500);expect(short.warmP95Ms).toBeLessThan(100);expect(short.maxTimerGapMs).toBeLessThan(100);
  }
  const worldRead=await page.evaluate(()=>window.semanticLookupFixture.measureWorldRead());
  console.log('Chromium / already-open real OPFS / synthetic 10k / first private World read (not UI paint):',JSON.stringify(worldRead));
  expect(worldRead.total).toBe(10_000);expect(worldRead.rows).toBe(40);
  expect(worldRead.firstPageMs).toBeLessThan(500);expect(worldRead.searchMs).toBeLessThan(100);expect(worldRead.detailMs).toBeLessThan(100);
  // Common and absent short terms both exercise the compact SQL text scan;
  // a LIMIT-only common-term test would hide the worst case for lookup.
  for(const query of ['临','临时','龘','😀']){
    const short=await page.evaluate(async query=>{
      const samples:number[]=[];let total=0;
      for(let sample=0;sample<12;sample++){
        const started=performance.now();const result=await window.semanticLookupFixture.worldPage({query,filter:'all',offset:0,limit:40});
        samples.push(performance.now()-started);total=result.total;
      }
      const firstMs=samples.shift()!;samples.sort((a,b)=>a-b);return {firstMs,warmP95Ms:samples[Math.ceil(samples.length*.95)-1]!,total};
    },query);
    console.log('Chromium / real OPFS / synthetic 10k / private World short query:',JSON.stringify({query,...short}));
    expect(short.total).toBe(query==='临'||query==='临时'?10_000:0);expect(short.firstMs).toBeLessThan(500);expect(short.warmP95Ms).toBeLessThan(100);
  }
  expect((await page.evaluate(()=>window.semanticLookupFixture.worldPage({query:'ＭＡＹ',filter:'all',offset:0,limit:40}))).total).toBe(10_000);
  const confirmation=await page.evaluate(()=>window.semanticLookupFixture.measureColdConfirmation());
  console.log('Chromium / real OPFS / synthetic 10k / first semantic acceptance / no model:',JSON.stringify(confirmation));
  expect(confirmation).toMatchObject({revision:2,expression:'borrow',sourceRemoved:true});expect(confirmation.receipt?.command).toBe('CompleteClarificationDraft');
  expect(confirmation.saveMs,'first confirmation must not hydrate all existing Meanings').toBeLessThan(500);expect(confirmation.maxTimerGapMs).toBeLessThan(100);
});

test('100/1k/10k persisted facts remain queryable after closing and relaunching Chromium, with separate open and lookup budgets',async()=>{
  for(const count of [100,1000,10_000]){
    const profile=await mkdtemp(join(tmpdir(),'sensa-meaning-reopen-'));
    const options={headless:true,...(process.env.SENSA_CHROMIUM_PATH?{executablePath:process.env.SENSA_CHROMIUM_PATH}:{})};
    let context=await chromium.launchPersistentContext(profile,options);
    try{
      let page=context.pages()[0]!;await enter(page);
      expect(await page.evaluate(count=>window.semanticLookupFixture.seed(count),count)).toBe(count);
      const query=`borrow-${count-1}`,identity=(await page.evaluate(query=>window.semanticLookupFixture.lookup(query),query)).meanings[0]!;
      await context.close();
      context=await chromium.launchPersistentContext(profile,options);page=context.pages()[0]!;
      const navigationStart=performance.now();await page.goto(origin);await page.waitForFunction(()=>!!window.semanticLookupFixture);
      // Deliberately do not initialize first: this read includes fresh Worker/OPFS open.
      const measured=await page.evaluate(query=>window.semanticLookupFixture.measureQueries(query),query);
      const navigationAndProbeMs=performance.now()-navigationStart;
      const diagnostics=await page.evaluate(()=>window.semanticLookupFixture.storageDiagnostics());
      console.log('Relaunched Chromium / existing real OPFS / synthetic facts / no model:',JSON.stringify({senseCount:count,navigationAndProbeMs,kernelInitialization:diagnostics.initializationTimingsMs,workerStartup:diagnostics.workerStartupTimingsMs,...measured}));
      expect(measured.firstQueryMs).toBeLessThan(500);expect(measured.warmP95Ms).toBeLessThan(100);expect(measured.maxTimerGapMs).toBeLessThan(100);
      expect((await page.evaluate(query=>window.semanticLookupFixture.lookup(query),query)).meanings[0]).toEqual(identity);
      for(const short of ['临','临时'])expect((await page.evaluate(query=>window.semanticLookupFixture.lookup(query),short)).meanings).toHaveLength(5);
    }finally{
      await context.close();await rm(profile,{recursive:true,force:true});
    }
  }
});
