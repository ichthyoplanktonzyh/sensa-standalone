/**
 * Package Center acceptance journey in the shipped Web application.
 *
 * This deliberately crosses the network, `.sensa-book`, `.sensa` admission,
 * OPFS SQLite, Content Supply System and Learning System boundaries. The
 * fixture responses are chunked and omit Content-Length, matching compressed
 * production object delivery rather than an in-memory happy path.
 */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname,join,resolve} from 'node:path';
import {chromium,expect,test,type Page} from '@playwright/test';
import {unzipSync,zipSync} from 'fflate';
import {portableBookMemberPath,readSensaPortableBook} from '@sensa/content-validator/portable-book';
import {canonicalConsumerJson,sensaPortableBookManifestSchema} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {cors} from 'hono/cors';
import {localSensaCorsOptions} from '../../../scripts/local/localCors.mts';

const root=process.cwd();
const output=resolve(root,'.tmp/package-center-journey');
const dist=join(output,'dist');
const subject='4c59833b-a0e2-4bd0-9d27-908ffcd81cf8';
const account='f10b0c0c-0f03-40cb-b989-3dfc2c74d490';
const types:Record<string,string>={
  '.css':'text/css','.html':'text/html','.ico':'image/x-icon','.js':'text/javascript',
  '.json':'application/json','.mjs':'text/javascript','.mp3':'audio/mpeg',
  '.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm','.woff2':'font/woff2',
};

let server:Server;
let apiServer:Server;
let apiOrigin='';
let origin='';
let storageKey='';
let delivery:ReturnType<typeof portableBookDeliveryFixture>;
let learningDelivery:ReturnType<typeof portableBookDeliveryFixture>;
let reviewDelivery:ReturnType<typeof portableBookDeliveryFixture>;
let updateDelivery:ReturnType<typeof portableBookDeliveryFixture>;
let scaleDelivery:ReturnType<typeof portableBookDeliveryFixture>;
let mismatchedDelivery:ReturnType<typeof portableBookDeliveryFixture>;
let invalidMemberDelivery:{descriptor:typeof delivery.descriptor;bytes:Uint8Array};
let heldArchivePath:string|null=null;
let catalogLatencyMs=0,artifactLatencyMs=0;
const heldResponses=new Set<import('node:http').ServerResponse>();
let registry:unknown;
let publisherAccess=false;
const delivered:string[]=[];
const catalogAuthorizationHeaders:(string|string[]|undefined)[]=[];
const catalogValidators:(string|string[]|undefined)[]=[];
const cloudBlocks=new Map<string,string>();
let cloudRevision=0;
let cloudManifest:string[]|null=null;

function setRegistry(items:typeof delivery.descriptor[]){
 const snapshot={format:'sensa-learning-content-registry-v3' as const,publishedAt:'2026-09-28T00:00:00Z',items};
 registry={...snapshot,revision:createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex')};
}

const jwt=(expiresInSeconds:number)=>{
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    encode({alg:'HS256',typ:'JWT'}),
    encode({
      sub:subject,aud:'authenticated',email:'package-center@sensa.invalid',
      session_id:randomUUID(),exp:Math.floor(Date.now()/1000)+expiresInSeconds,
      amr:[{method:'otp',timestamp:Math.floor(Date.now()/1000)}],
    }),
    'fixture-signature',
  ].join('.');
};

const session=()=>({
  access_token:jwt(3600),token_type:'bearer',expires_in:3600,
  expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'fixture-refresh-token',
  user:{
    id:subject,aud:'authenticated',role:'authenticated',
    email:'package-center@sensa.invalid',app_metadata:{},user_metadata:{},
    identities:[],created_at:new Date().toISOString(),
  },
});

test.setTimeout(180_000);
test.use({viewport:{width:1280,height:900},locale:'zh-CN',actionTimeout:15_000});

test.beforeAll(async()=>{
  server=createServer(async(request,response)=>{
    const url=new URL(request.url??'/',origin||'http://127.0.0.1');
    const json=(value:unknown,status=200)=>{
      response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
      response.end(JSON.stringify(value));
    };
    const body=async()=>{
      const parts:Buffer[]=[];
      for await(const part of request)parts.push(Buffer.from(part));
      return parts.length?JSON.parse(Buffer.concat(parts).toString('utf8')):{};
    };
    try{
      if(url.pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
      if(url.pathname==='/auth/v1/user'){
        json({id:subject,aud:'authenticated',email:'package-center@sensa.invalid',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()});return;
      }
      if(url.pathname==='/sensa/web/access/session'){json({authorized:true,accountId:account,capabilities:{publishLearningContent:publisherAccess}});return;}
      if(url.pathname==='/sensa/library-sync/head'){
        json({revision:cloudRevision,manifest:cloudManifest});return;
      }
      if(url.pathname==='/sensa/library-sync/blocks/missing'){
        const input=await body() as {hashes:string[]};
        json({missing:input.hashes.filter(hash=>!cloudBlocks.has(hash))});return;
      }
      if(url.pathname==='/sensa/library-sync/blocks/store'){
        const input=await body() as {blocks:{hash:string;data:string}[]};
        for(const block of input.blocks)cloudBlocks.set(block.hash,block.data);
        json({stored:true});return;
      }
      if(url.pathname==='/sensa/library-sync/blocks/fetch'){
        const input=await body() as {hashes:string[]};
        json({
          blocks:input.hashes.flatMap(hash=>cloudBlocks.has(hash)?[{hash,data:cloudBlocks.get(hash)!}]:[]),
          missing:input.hashes.filter(hash=>!cloudBlocks.has(hash)),
        });return;
      }
      if(url.pathname.startsWith('/sensa/library-sync/blocks/')){
        const hash=url.pathname.slice('/sensa/library-sync/blocks/'.length);
        if(!cloudBlocks.has(hash)){json({code:'missing'},404);return;}
        json({hash,data:cloudBlocks.get(hash)});return;
      }
      if(url.pathname==='/sensa/library-sync/commit'){
        const input=await body() as {baseRevision:number;manifest:string[]};
        if(input.baseRevision!==cloudRevision){json({code:'library_sync_conflict'},409);return;}
        cloudRevision+=1;cloudManifest=input.manifest;
        json({revision:cloudRevision,manifest:cloudManifest});return;
      }
      if(url.pathname==='/sensa/intake/channel'){
        json({registered:true,libraryId:'package-center-fixture-library'});return;
      }
      if(url.pathname==='/sensa/intake/deliveries/pull'){json({deliveries:[]});return;}
      if(url.pathname==='/sensa/service/status'){
        json({authorized:true,explanationAvailable:true,checkedAt:new Date().toISOString(),windowHours:24,usage:[]});return;
      }
      if(url.pathname==='/sensa/packages'){
        if(catalogLatencyMs)await new Promise(resolve=>setTimeout(resolve,catalogLatencyMs));
        catalogAuthorizationHeaders.push(request.headers.authorization);
        catalogValidators.push(request.headers['if-none-match']);
        const revision=(registry as {revision:string}).revision;
        response.setHeader('etag',`"${revision}"`);
        if(request.headers['if-none-match']===`"${revision}"`){response.writeHead(304);response.end();return;}
        json(registry);return;
      }

      const deliveryUrl=new URL(url.pathname,origin).href;
      const bytes=delivery.responses.get(deliveryUrl)??learningDelivery.responses.get(deliveryUrl)??reviewDelivery.responses.get(deliveryUrl)
        ??updateDelivery.responses.get(deliveryUrl)??mismatchedDelivery.responses.get(deliveryUrl)
        ??scaleDelivery.responses.get(deliveryUrl)
        ??(deliveryUrl===invalidMemberDelivery.descriptor.url?invalidMemberDelivery.bytes:undefined);
      if(bytes){
        if(artifactLatencyMs)await new Promise(resolve=>setTimeout(resolve,artifactLatencyMs));
        delivered.push(url.pathname);
        // Force chunked transfer so this acceptance path has no Content-Length.
        response.writeHead(200,{
          'content-type':url.pathname.endsWith('.sensa-book')
            ?'application/vnd.sensa.book+zip'
            :url.pathname.endsWith('.json')?'application/json':'application/octet-stream',
          'cache-control':'no-store','transfer-encoding':'chunked',
        });
        const middle=Math.max(1,Math.floor(bytes.byteLength/2));
        response.write(Buffer.from(bytes.subarray(0,middle)));
        if(url.pathname===heldArchivePath){
          heldResponses.add(response);
          response.once('close',()=>heldResponses.delete(response));
          return;
        }
        response.end(Buffer.from(bytes.subarray(middle)));
        return;
      }
      if(url.pathname.startsWith('/sensa/')){json({code:'not_found'},404);return;}

      const path=join(dist,url.pathname);
      const file=path.startsWith(dist)&&extname(path)?path:join(dist,'index.html');
      try{
        const bytes=await readFile(file);
        response.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream'});
        response.end(bytes);
      }catch{
        const bytes=await readFile(join(dist,'index.html'));
        response.writeHead(200,{'content-type':'text/html'});
        response.end(bytes);
      }
    }catch(error){
      json({code:'fixture_error',message:error instanceof Error?error.message:'unknown'},500);
    }
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  // The public API is deliberately a different origin, like the shipped Web.
  const api=new Hono();
  api.use('*',cors(localSensaCorsOptions([origin])));
  api.all('*',async context=>{
    const url=new URL(context.req.url);
    return fetch(new URL(url.pathname+url.search,origin),{
      method:context.req.method,headers:context.req.raw.headers,
      ...(['GET','HEAD'].includes(context.req.method)?{}:{body:await context.req.arrayBuffer()}),
    });
  });
  apiServer=serve({fetch:api.fetch,hostname:'127.0.0.1',port:0});
  if(!apiServer.listening)await once(apiServer,'listening');
  apiOrigin=`http://127.0.0.1:${(apiServer.address() as {port:number}).port}`;
  storageKey=`sb-${new URL(origin).hostname.split('.')[0]}-auth-token`;
  delivery=portableBookDeliveryFixture({
    baseUrl:`${origin}/published/`,
    expression:'borrow',
    title:'English route essentials',
    memberExpressions:[
      'borrow',
      ...Array.from({length:99},(_,index)=>`fixture-${String(index+2).padStart(3,'0')}`),
    ],
  });
  learningDelivery=portableBookDeliveryFixture({
    baseUrl:`${origin}/published/`,
    packageId:'3c96a144-9447-4d8f-90c1-dfc3f6ed1b45',
    expression:'borrow',
    title:'雨天借伞',
  });
  reviewDelivery=portableBookDeliveryFixture({baseUrl:`${origin}/published/`,packageId:randomUUID(),expression:'borrow',title:'到期复习样本',memberExpressions:['borrow','lend']});
  updateDelivery=portableBookDeliveryFixture({
    baseUrl:`${origin}/published/`,expression:'borrow',title:'English route essentials',
    version:2,memberExpressions:['borrow',...Array.from({length:99},(_,index)=>`fixture-${String(index+2).padStart(3,'0')}`)],
  });
  scaleDelivery=portableBookDeliveryFixture({
    baseUrl:`${origin}/published/`,title:'English route essentials',audioByteLength:52_000,
    memberExpressions:['borrow',...Array.from({length:99},(_,index)=>`fixture-${String(index+2).padStart(3,'0')}`)],
  });
  mismatchedDelivery=portableBookDeliveryFixture({baseUrl:`${origin}/published/`,packageId:'48b61326-4246-4aa6-b94e-f13412f15a93',targetLanguage:'es',expression:'prestar',title:'西班牙语借物'});
  const files=unzipSync(updateDelivery.bookBytes);
  const lastMember=updateDelivery.manifest.members.at(-1)!;
  files[portableBookMemberPath(lastMember)]=new TextEncoder().encode('invalid final .sensa member');
  const invalidBytes=zipSync(files);
  assert.throws(()=>readSensaPortableBook(invalidBytes),/member is invalid/u);
  const invalidDigest=createHash('sha256').update(invalidBytes).digest('hex');
  invalidMemberDelivery={bytes:invalidBytes,descriptor:{...updateDelivery.descriptor,byteLength:invalidBytes.byteLength,sha256:invalidDigest,url:`${origin}/published/${invalidDigest}.sensa-book`}};
  setRegistry([delivery.descriptor,learningDelivery.descriptor,mismatchedDelivery.descriptor]);

  await rm(output,{recursive:true,force:true});
  await mkdir(dist,{recursive:true});
  execFileSync('npm',['run','build','-w','@sensa/web','--','--outDir',dist,'--emptyOutDir'],{
    cwd:root,
    env:{
      ...process.env,
      VITE_SENSA_MODE:'production',
      VITE_SENSA_BROWSER_SMOKE:'true',
      VITE_SUPABASE_URL:origin,
      VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable-key',
      VITE_SENSA_API_URL:apiOrigin,
    },
    stdio:'inherit',
  });
});

test.beforeEach(()=>{
  delivered.length=0;
  setRegistry([delivery.descriptor,learningDelivery.descriptor,mismatchedDelivery.descriptor]);
  heldArchivePath=null;
  catalogLatencyMs=artifactLatencyMs=0;
});

test.afterEach(()=>{
  heldArchivePath=null;
  for(const response of heldResponses)response.destroy();
  heldResponses.clear();
});

test.afterAll(async()=>{
  if(apiServer?.listening)await new Promise<void>(resolve=>apiServer.close(()=>resolve()));
  if(server?.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
  await rm(output,{recursive:true,force:true});
});

async function openLearningManagement(page:Page){
 const details=page.locator('#s-study details').filter({has:page.locator('summary').filter({hasText:/^管理学习内容$/})});
 if(!await details.evaluate(node=>(node as HTMLDetailsElement).open))await details.locator('summary').click();
 await expect(details).toHaveAttribute('open','');
 return details;
}

async function startOrdinaryBook(page:Page,title=/雨天借伞/){
 await page.goto(`${origin}/catalog`);
 await page.locator('#s-catalog').last().getByRole('button',{name:title}).click();
 const book=page.locator('#s-catalog-book').last();
 await book.getByRole('button',{name:'下载学习包',exact:true}).click();
 await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled({timeout:15_000});
 await book.getByRole('button',{name:'加入学习',exact:true}).click();
 await expect(book.getByText('已加入学习',{exact:true})).toBeVisible();
 await book.getByRole('button',{name:'去学习',exact:true}).click();
 await page.locator('#s-home').getByRole('button',{name:'开始学习',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'学习偏好',exact:true})).toHaveCount(0);
 const runtime=page.locator('#s-lightweight-runtime');
 await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();
 await expect(page.locator('#s-home')).toHaveCount(0);
 return runtime;
}

async function startDueReviewWithPausedInitial(page:Page){
 setRegistry([reviewDelivery.descriptor]);
 const runtime=await startOrdinaryBook(page,/到期复习样本/);
 const first=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 await runtime.getByRole('button',{name:/查看表达/}).click();
 await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime?.targetId).not.toBe(first.runtime!.targetId);
 await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();
 await runtime.getByRole('button',{name:/查看表达/}).click();
 const paused=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(paused.records).toHaveLength(1);expect(paused.runtime!.targetId).not.toBe(first.runtime!.targetId);
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 const home=page.locator('#s-home');
 await expect(home.getByRole('button',{name:/只复习/})).toHaveCount(0);
 const due=paused.completedTargets.find(target=>target.targetId===first.runtime!.targetId)!.nextReviewAt!;
 await page.clock.setFixedTime(new Date(Date.parse(due)+60_000));
 await page.reload();await expect(home.getByRole('button',{name:/只复习/})).toBeEnabled();
 await home.getByRole('button',{name:/只复习/}).click();
 await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();
 const review=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(review.runtime!.targetId).toBe(first.runtime!.targetId);expect(review.runtime!.runId).not.toBe(first.runtime!.runId);
 return {runtime,home,paused,review,due};
}

test.describe('history calendar in the actual SQLite Worker',()=>{
 test.use({timezoneId:'America/New_York'});
 test('a real completion near UTC midnight appears on the learner local calendar day',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-11-01T00:30:00Z'));
  setRegistry([reviewDelivery.descriptor]);
  const runtime=await startOrdinaryBook(page,/到期复习样本/);
  await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:/已经连上/}).click();
  await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();await runtime.getByRole('button',{name:'暂停',exact:true}).click();
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
  const study=page.locator('#s-study');await expect(study.locator('ol').getByRole('button')).toHaveCount(1);
  await study.getByRole('button',{name:'学习统计',exact:true}).click();const stats=page.locator('#s-stats');
  await stats.getByRole('button',{name:'今天',exact:true}).click();await expect(stats.locator('ol').getByRole('button')).toHaveCount(1);
  await expect(stats.getByRole('status').filter({hasText:'1 条'})).toBeVisible();
  const localDay=await page.evaluate(()=>new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium'}).format(new Date(2026,9,31)));
  await expect(stats.getByRole('rowheader',{name:localDay,exact:true})).toBeVisible();
  await page.reload();await expect(stats.getByRole('rowheader',{name:localDay,exact:true})).toBeVisible();
 });
});

test('review-only retains a paused initial Step through failed writes, two-tab Hard settlement and offline reload',async({page,context})=>{
 const {runtime,home,paused,review,due}=await startDueReviewWithPausedInitial(page);
 await runtime.getByRole('button',{name:/查看表达/}).click();
 const revealed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 const beforeFacts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failNextLearningCommitForTest());
 await runtime.getByRole('button',{name:/有点印象/}).click();
 await expect(page.getByText(/未能保存到本机/).first()).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(revealed);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest())).toEqual(beforeFacts);
 const second=await context.newPage();await second.clock.setFixedTime(new Date(Date.parse(due)+60_000));await second.goto(page.url());
 const secondRuntime=second.locator('#s-lightweight-runtime');
 await expect(secondRuntime.getByRole('button',{name:/有点印象/})).toBeEnabled();
 await Promise.all([runtime.getByRole('button',{name:/有点印象/}).click(),secondRuntime.getByRole('button',{name:/有点印象/}).click()]);
 await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
 await expect(secondRuntime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
 const saved=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(saved.records.map(record=>record.kind).sort()).toEqual(['initial_learning','retention_review']);
 expect(saved.records.every(record=>record.targetId===review.runtime!.targetId)).toBe(true);
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());
 expect(facts.targets.find(target=>target.targetId===review.runtime!.targetId)!.memoryRevision).toBe(2);expect(facts.behavioralEvidenceCount).toBe(0);
 await second.close();
 await context.setOffline(true);
 try{
  await page.reload();await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(saved);
  await runtime.getByRole('button',{name:/完成并回到首页/}).click();
  await expect(home.getByRole('button',{name:'继续学习',exact:true})).toHaveCount(0);
  await expect(home.getByRole('button',{name:'开始学习',exact:true})).toBeEnabled();
  await home.getByRole('button',{name:'开始学习',exact:true}).click();
  await expect(runtime.getByRole('button',{name:/有点印象/})).toBeEnabled();
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(paused.runtime);
 }finally{await context.setOffline(false);}
});

test('review-only Again survives a lost receipt and reload as a separate Relearning Run without a second FSRS update',async({page})=>{
 const {runtime,home,review}=await startDueReviewWithPausedInitial(page);
 await runtime.getByRole('button',{name:/查看表达/}).click();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.loseNextLearningActionResponseForTest());
 await runtime.getByRole('button',{name:/还没连上/}).click();
 await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();
 const repair=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(repair.runtime!.targetId).toBe(review.runtime!.targetId);expect(repair.runtime!.runId).not.toBe(review.runtime!.runId);
 expect(repair.records.filter(record=>record.kind==='retention_review')).toHaveLength(1);
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());
 expect(facts.targets.find(target=>target.targetId===review.runtime!.targetId)!.memoryRevision).toBe(2);
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();await page.reload();
 await home.getByRole('button',{name:'继续学习',exact:true}).click();
 await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(repair.runtime);
 await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
 const saved=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(saved.records.map(record=>record.kind).sort()).toEqual(['initial_learning','relearning','retention_review']);
 const after=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());
 expect(after.targets).toEqual(facts.targets);expect(after.behavioralEvidenceCount).toBe(0);
 await runtime.getByRole('button',{name:/完成并回到首页/}).click();await expect(home.getByRole('button',{name:'继续学习',exact:true})).toHaveCount(0);await expect(home.getByRole('button',{name:'开始学习',exact:true})).toBeEnabled();
});

test('initial Again retries the same Run, failed writes do not advance, and a lost receipt rereads saved progress',async({page})=>{
 const runtime=await startOrdinaryBook(page);
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 await page.evaluate(()=>window.__sensaBrowserSmoke!.learningReadsForTest(true));
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failNextLearningCommitForTest());
 await runtime.getByRole('button',{name:/查看表达/}).click();
 await expect(page.getByText(/未能保存到本机/).first()).toBeVisible();
 await expect.poll(async()=>((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningReadsForTest())).runtime??0)).toBeGreaterThan(0);
 await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();
 await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toHaveCount(0);
 const failedReads=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningReadsForTest());
 expect(failedReads.workspace??0).toBe(0);expect(failedReads.home??0).toBe(0);expect(failedReads.runtime).toBeGreaterThan(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);
 await runtime.getByRole('button',{name:/查看表达/}).click();
 await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await runtime.getByRole('button',{name:/还没连上/}).click();
 await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();
 const again=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(again.runtime?.runId).toBe(before.runtime!.runId);expect(again.runtime?.targetId).toBe(before.runtime!.targetId);
 expect(again.records).toEqual([]);expect(again.completedTargets).toEqual([]);
 await page.reload();await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(again);
 await runtime.getByRole('button',{name:/查看表达/}).click();
 await expect(runtime.getByRole('button',{name:/已经连上/})).toBeEnabled();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.learningReadsForTest(true));
 await page.evaluate(()=>window.__sensaBrowserSmoke!.loseNextLearningActionResponseForTest());
 await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
 await expect(page.getByRole('status')).toContainText('未收到操作结果');
 const reads=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningReadsForTest());
 expect(reads.workspace??0).toBe(0);expect(reads.home??0).toBe(0);expect(reads.runtime).toBeGreaterThan(0);
 const completed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(completed.records).toHaveLength(1);expect(completed.completedTargets).toHaveLength(1);
 expect(completed.completedTargets[0]!.nextReviewAt).toBeTruthy();
 await page.reload();await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(completed);
});

test('a late Action response from the previous Route cannot overwrite the current learning library',async({page})=>{
 const runtime=await startOrdinaryBook(page);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.holdNextLearningActionResponseForTest());
 await runtime.getByRole('button',{name:/查看表达/}).click();
 await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.navigate('/profile'));
 await page.locator('#s-profile').getByRole('button',{name:/使用偏好/}).click();
 await page.locator('#account-languages').click();
 const languages=page.getByRole('dialog',{name:'语言路线',exact:true});
 await languages.getByRole('combobox',{name:'选择目标语言',exact:true}).selectOption('es');
 await languages.getByRole('button',{name:'添加路线',exact:true}).click();
 const spanish=languages.getByRole('radio',{name:/Español/});await expect(spanish).toBeVisible();
 if(await spanish.getAttribute('aria-checked')!=='true')await spanish.click();
 await expect(spanish).toHaveAttribute('aria-checked','true');
 await languages.getByRole('button',{name:'完成',exact:true}).click();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.navigate('/study/learning-library'));
 const library=page.locator('#s-learning-library');
 await expect(library.getByText('还没有学习内容',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.learningReadsForTest(true));
 await page.evaluate(()=>window.__sensaBrowserSmoke!.releaseLearningActionResponseForTest());
 await expect(library.getByText('还没有学习内容',{exact:true})).toBeVisible();
 await expect(library.getByRole('button',{name:/borrow/})).toHaveCount(0);
 // Wait for the async callback through two rendered frames, not a fixed sleep.
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningReadsForTest())).toEqual({});
});

test('two tabs rating the same revealed initial Step settle once without behavioral evidence',async({page,context})=>{
 const runtime=await startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();
 await expect(runtime.getByRole('button',{name:/已经连上/})).toBeEnabled();
 const second=await context.newPage();
 try{
  await second.goto(page.url());const other=second.locator('#s-lightweight-runtime');
  await expect(other.getByRole('button',{name:/已经连上/})).toBeEnabled();
  const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
  expect(await second.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);
  await Promise.all([runtime.getByRole('button',{name:/已经连上/}).click(),other.getByRole('button',{name:/已经连上/}).click()]);
  await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
  await expect(other.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
  const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());
  expect(facts.actionEventCount).toBe(2);expect(facts.behavioralEvidenceCount).toBe(0);expect(facts.targets.map(target=>target.memoryRevision)).toEqual([1]);
  const settled=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(settled.records).toHaveLength(1);
  expect(await second.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(settled);
  await second.reload();await expect(other.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
  expect(await second.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest())).toEqual(facts);
 }finally{await second.close();}
});

test('an abrupt SQLite Worker termination restores the same adopted initial Step after reload',async({page})=>{
 await page.addInitScript(()=>{
  (window as unknown as {__name:(value:unknown)=>unknown}).__name=value=>value;
  const state=window as unknown as {__lj07Workers:Worker[]};state.__lj07Workers=[];
  const NativeWorker=Worker;
  window.Worker=class extends NativeWorker{
   constructor(url:string|URL,options?:WorkerOptions){super(url,options);if(options?.name==='sensa-sqlite')state.__lj07Workers.push(this);}
  };
 });
 const runtime=await startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();
 await expect(runtime.getByRole('button',{name:/已经连上/})).toBeEnabled();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(await page.evaluate(()=>{const workers=(window as unknown as {__lj07Workers:Worker[]}).__lj07Workers;for(const worker of workers)worker.terminate();return workers.length;})).toBeGreaterThan(0);
 await page.reload();await expect(runtime.getByRole('button',{name:/已经连上/})).toBeEnabled({timeout:30_000});
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);
 await runtime.getByRole('button',{name:/已经连上/}).click();await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
 await expect(page.getByText('borrow · 首次学习已保存',{exact:true})).toBeVisible();
 const saved=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());
 expect(saved.actionEventCount).toBe(2);expect(saved.behavioralEvidenceCount).toBe(0);expect(saved.targets[0]!.memoryRevision).toBe(1);
});

test('learning questions are optional, readonly, cancellable and unavailable offline without blocking learning',async({page,context})=>{
 await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:session()});
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
 const runtime=await startOrdinaryBook(page);
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

test('a cached public catalog refreshes across origins with its exact revision',async({page})=>{
  await page.goto(`${origin}/catalog`);
  const catalog=page.locator('#s-catalog').last();
  await expect(catalog.getByRole('button',{name:/English route essentials/})).toBeVisible({timeout:15_000});
  await catalog.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(catalog.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
  await expect(catalog.getByText('暂时无法更新目录。已下载内容可继续使用；可以联网后重试。',{exact:true})).toHaveCount(0);
  expect(catalogValidators.at(-1)).toBe(`"${(registry as {revision:string}).revision}"`);
  await page.reload();
  await expect(catalog.getByRole('button',{name:/English route essentials/})).toBeVisible({timeout:15_000});
});

test('shared Book sources recover their exact Manifest positions through Chromium OPFS without enrolling',async({page})=>{
 const first=reviewDelivery,files=unzipSync(first.bookBytes);
 const manifest=sensaPortableBookManifestSchema.parse({...first.manifest,book:{...first.manifest.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:'shared-book-recovery',title:'共享表达的另一册'},members:[...first.manifest.members].reverse()});
 files['book.json']=new TextEncoder().encode(JSON.stringify(manifest));
 const bytes=zipSync(files),sha256=createHash('sha256').update(bytes).digest('hex');
 const second={...first.descriptor,book:manifest.book,sha256,byteLength:bytes.byteLength,url:`${origin}/published/${sha256}.sensa-book`};
 first.responses.set(second.url,bytes);
 setRegistry([first.descriptor,second]);
 try{
  await page.goto(`${origin}/catalog`);
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
  delivered.length=0;
  await page.reload();
  await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.bookProvenanceCheckpointForTest())).cache.flatMap(pack=>pack.publications).length).toBe(4);
  const recovered=await page.evaluate(()=>window.__sensaBrowserSmoke!.bookProvenanceCheckpointForTest());
  expect(recovered).toEqual(original);
  expect(delivered.filter(path=>path.endsWith('.sensa-book')).sort()).toEqual([new URL(first.descriptor.url).pathname,new URL(second.url).pathname].sort());
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(learning);
  delivered.length=0;
  await page.reload();
  await expect(catalog.getByRole('button',{name:/共享表达的另一册/})).toBeVisible();
  await catalog.getByRole('button',{name:/共享表达的另一册/}).click();
  await expect(book.getByText('已下载',{exact:true})).toBeVisible();
  await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.bookProvenanceCheckpointForTest())).toEqual(original);
  expect(delivered.filter(path=>path.endsWith('.sensa-book'))).toEqual([]);
 }finally{first.responses.delete(second.url);}
});

test('overlapping Book admissions and an explicit Book upgrade preserve the revealed Run source through offline OPFS reopen',async({page,context})=>{
 const first=reviewDelivery,files=unzipSync(first.bookBytes);
 const manifest=sensaPortableBookManifestSchema.parse({...first.manifest,book:{...first.manifest.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:'shared-book-admission',title:'另一册共享表达'},members:[...first.manifest.members].reverse()});
 const secondFiles={...files,'book.json':new TextEncoder().encode(JSON.stringify(manifest))};
 const bytes=zipSync(secondFiles),sha256=createHash('sha256').update(bytes).digest('hex');
 const second={...first.descriptor,book:manifest.book,sha256,byteLength:bytes.byteLength,url:`${origin}/published/${sha256}.sensa-book`};
 const nextManifest=sensaPortableBookManifestSchema.parse({...first.manifest,book:{...first.manifest.book,bookVersionId:randomUUID(),versionNumber:2},contentRelease:{...first.manifest.contentRelease,contentReleaseId:randomUUID(),versionNumber:2}});
 const nextBytes=zipSync({...files,'book.json':new TextEncoder().encode(JSON.stringify(nextManifest))});
 const nextSha=createHash('sha256').update(nextBytes).digest('hex');
 const updated={...first.descriptor,book:nextManifest.book,contentRelease:nextManifest.contentRelease,sha256:nextSha,byteLength:nextBytes.byteLength,url:`${origin}/published/${nextSha}.sensa-book`};
 first.responses.set(second.url,bytes);first.responses.set(updated.url,nextBytes);
 setRegistry([first.descriptor,second]);
 try{
  const runtime=await startOrdinaryBook(page,/到期复习样本/);
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
  await page.goto(`${origin}/catalog`);
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
  await openLearningManagement(page);
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
  setRegistry([updated,second]);
  await page.goto(`${origin}/catalog`);
  await catalog.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(catalog.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
  await catalog.getByRole('button',{name:/到期复习样本/}).click();
  const beforeUpdate=await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest());
  await book.getByRole('button',{name:'下载更新',exact:true}).click();
  await expect(book.getByText('更新已下载',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest())).toEqual(beforeUpdate);
  await book.getByRole('button',{name:'应用更新',exact:true}).click();
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

test('cancelling admission after complete transfer closes its Worker without installing any members',async({page})=>{
  setRegistry([scaleDelivery.descriptor]);
  await page.goto(`${origin}/catalog`);
  await page.locator('#s-catalog').last().getByRole('button',{name:/English route essentials/}).click();
  const book=page.locator('#s-catalog-book').last();
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
  await page.goto(`${origin}/catalog`);
  const catalog=page.locator('#s-catalog').last();
  await expect(catalog.getByRole('heading',{name:'学习包目录',exact:true})).toBeVisible({timeout:15_000});
  await expect(catalog.getByRole('button',{name:/English route essentials/})).toBeVisible();
  await expect(catalog.getByText('暂时无法更新目录。已下载内容可继续使用；可以联网后重试。',{exact:true})).toHaveCount(0);
  assert.equal(catalogAuthorizationHeaders.at(-1),undefined,'the public catalog request must not carry account authority');
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
  },{key:storageKey,value:session()});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'
    ?route.continue()
    :route.abort());

  await page.goto(origin);
  await expect(page.locator('[data-sensa-page-layout="application-shell"]')).toBeVisible({timeout:15_000});
  await page.evaluate(()=>window.__sensaBrowserSmoke!.navigate('/catalog'));
  const catalog=page.locator('#s-catalog').last();
  await expect(catalog.getByRole('heading',{name:'学习包目录',exact:true})).toBeVisible({timeout:15_000});

  await expect(catalog.getByRole('button',{name:/English route essentials/})).toBeVisible();
  await catalog.getByRole('button',{name:/English route essentials/}).click();
  await expect(page).toHaveURL(new RegExp(`/catalog/${delivery.descriptor.book.bookKey}$`));
  const entry=page.locator('#s-catalog-book').last();
  await expect(entry.getByRole('heading',{name:'English route essentials'})).toBeVisible();
  await expect(entry.getByText('未下载',{exact:true})).toBeVisible();
  await expect(entry.getByText(/100 个表达/)).toBeVisible();

  await entry.getByRole('button',{name:'下载学习包',exact:true}).click();
  await expect(entry.getByText('已下载',{exact:true})).toBeVisible({timeout:15_000});
  await expect(entry.locator('section').last().locator('li')).toHaveCount(50);
  await expect(entry.getByRole('button',{name:'加入学习',exact:true})).toBeVisible();
  assert.equal(
    delivered.filter(path=>path.endsWith('.sensa-book')).length,
    1,
    'the complete Book was not downloaded exactly once',
  );
  assert.equal(delivered.filter(path=>path.endsWith('.sensa')).length,0,'members must not require separate requests');

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
  await expect(contents.locator('li')).toHaveCount(50);
  await expect(contents.locator('li button')).toHaveCount(20);
  await contents.getByRole('button',{name:'查看更多',exact:true}).click();
  await expect(contents.locator('li')).toHaveCount(100);
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
  await restored.getByRole('button',{name:'查看更多',exact:true}).click();
  await expect(restored.getByText('borrow',{exact:true})).toBeVisible();

  await page.evaluate(()=>window.__sensaBrowserSmoke!.navigate('/publisher'));
  await expect(page.locator('#s-publisher').last().getByRole('alert')).toContainText('当前账号尚未获得服务访问权限');
  publisherAccess=true;
  await page.reload();
  const publisher=page.locator('#s-publisher').last();
  await expect(publisher.getByRole('heading',{name:'发布后台',exact:true})).toBeVisible({timeout:15_000});
  const bookBytes=[...delivery.responses.entries()].find(([url])=>url.endsWith('.sensa-book'))?.[1];
  assert(bookBytes,'fixture Book archive missing');
  await publisher.locator('input[type=file]').setInputFiles({name:'candidate.sensa-book',mimeType:'application/vnd.sensa.book+zip',buffer:Buffer.from(bookBytes)});
  await expect(publisher.getByText('English route essentials',{exact:true}).first()).toBeVisible();
  await expect(publisher.getByText(/^[0-9a-f]{64}$/)).toBeVisible();
  assert.deepEqual(runtimeErrors,[]);
});

test('direct published discovery enrolls only the selected expression and resumes its real Runtime without a Personal Meaning',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
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
 const targetUrl=page.url();
 await page.locator('#s-learning-target').getByRole('button',{name:'开始 / 继续学习',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'学习偏好',exact:true})).toHaveCount(0);
 const runtime=page.locator('#s-lightweight-runtime');await runtime.getByRole('button',{name:/查看表达/}).click();await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 const revealed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(revealed.runtime?.runId).toBeTruthy();expect(revealed.targetIds).toEqual(added.targetIds);expect(revealed.records).toEqual([]);
 await page.reload();await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(revealed);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
 const arrangement=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
 await openLearningManagement(page);
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
 await page.reload();await openLearningManagement(page);await expect(plans.getByRole('button',{name:'重新加入学习 · borrow',exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'今日',exact:true}).click();
 await page.locator('#s-home').getByRole('button',{name:'继续学习',exact:true}).click();await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(revealed.runtime);
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
 await openLearningManagement(page);
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
 await openLearningManagement(page);
 await plans.getByRole('button',{name:'重新加入学习 · borrow',exact:true}).click();
 await expect(plans.getByRole('button',{name:'移出学习 · borrow',exact:true})).toBeEnabled();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.supplementalDecisionsForTest())).states[0]!.revision).toBe(4);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual(added.targetIds);
});

test('nonbundled Book favorites and notes remain findable without a Personal Meaning or rating, then real learning appears after OPFS reload',async({page})=>{
 const providers:string[]=[];page.on('request',request=>{if(/\/model\/|chat\/completions|\/speech\//.test(request.url()))providers.push(request.url());});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 const runtime=await startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
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
 await page.goto(origin);await page.locator('#s-home').getByRole('button',{name:/继续学习/}).click();
 await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
 if(await runtime.getByRole('button',{name:'暂停',exact:true}).isVisible())await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的语义世界',exact:true}).click();
 await page.getByRole('button',{name:'学习连接',exact:true}).click();await page.getByRole('button',{name:/borrow/}).click();await expect(detail.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('targetId')).toBe(targetId);
 await page.reload();await expect(detail.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toHaveLength(1);expect(providers).toEqual([]);
});

test('a personal meaning created from a learning scene reuses its Book target without generation or replacing the active material',async({page})=>{
 const providerRequests:string[]=[];
 page.on('request',request=>{if(/\/model\/|chat\/completions|\/speech\//.test(request.url()))providerRequests.push(request.url());});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 const home=page.locator('#s-home');await home.getByRole('button',{name:'学习包目录',exact:true}).click();
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

test('a guest learns a Book through the UI and resumes the revealed step after reload',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(origin);
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
  await expect(history.getByRole('button',{name:/borrow/})).toHaveCount(1);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(completed);
  // Move only the browser clock to the due date actually produced by learning.
  // Neither a target nor a scheduling result is seeded by the test.
  await page.clock.setFixedTime(new Date(Date.parse(completed.completedTargets[0]!.nextReviewAt!)+60_000));
  await page.goto(origin);
  await expect(home.getByRole('button',{name:'开始学习',exact:true})).toBeVisible({timeout:15_000});
  await page.context().setOffline(true);
  try{
    await home.getByRole('button',{name:'开始学习',exact:true}).click();
    await expect(runtime.getByRole('button',{name:/查看表达/})).toBeVisible();
    const review=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
    expect(review.runtime!.targetId).toBe(completed.records[0]!.targetId);
    expect(review.runtime!.runId).not.toBe(revealed.runtime!.runId);
    await runtime.getByRole('button',{name:/查看表达/}).click();
    await runtime.getByRole('button',{name:/已经连上/}).click();
    await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
    await runtime.getByRole('button',{name:/完成并回到首页/}).click();
    const reviewed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
    expect(reviewed.records).toHaveLength(2);
    expect(reviewed.records.map(record=>record.kind).sort()).toEqual(['initial_learning','retention_review']);
    expect(reviewed.records.every(record=>record.targetId===completed.records[0]!.targetId)).toBe(true);
    expect(Date.parse(reviewed.completedTargets[0]!.nextReviewAt!)).toBeGreaterThan(Date.parse(completed.completedTargets[0]!.nextReviewAt!));
  }finally{await page.context().setOffline(false);}
});

test('Runtime restores its pinned Step offline without public-cache recovery or collection reads',async({page,context})=>{
 const runtime=await startOrdinaryBook(page);
 const pinned=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(pinned.records).toHaveLength(0);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.discardPackageCacheForRecoveryTest());
 await context.setOffline(true);
 try{
  await page.reload();
  await expect(runtime.getByRole('button',{name:/查看表达/})).toBeVisible({timeout:15_000});
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(pinned);
  const reads=await page.evaluate(()=>performance.getEntriesByType('measure').map(entry=>entry.name));
  expect(reads).toContain('sensa.workspace.runtime');
  for(const collectionRead of ['sensa.workspace.rehydrate','sensa.workspace.supply','sensa.workspace.prepare'])expect(reads).not.toContain(collectionRead);
  await runtime.getByRole('button',{name:/查看表达/}).click();
  await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
  await runtime.getByRole('button',{name:/已经连上/}).click();
  const after=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
  expect(after.records).toHaveLength(1);expect(after.records[0]!.targetId).toBe(pinned.runtime!.targetId);
  expect(after.records[0]!.kind).toBe('initial_learning');
 }finally{await context.setOffline(false);}
});

test('repeated Web preference and resume lifecycles preserve pinned learning and exact media in isolated and persistent contexts',async({browser},testInfo)=>{
 const idleMs=Number(process.env.SENSA_WEB_IDLE_MS??2000);
 if(!Number.isSafeInteger(idleMs)||idleMs<0||idleMs>30*60_000)throw new Error('invalid_web_idle_duration');
 test.setTimeout(360_000+idleMs);
 setRegistry([scaleDelivery.descriptor]);
 const evidence:Record<string,unknown>[]=[];
 try{
  for(const mode of ['isolated','persistent'] as const){
   const profile=mode==='persistent'?await mkdtemp(resolve('.tmp/web-media-lifecycle-profile-')):null;
   const headless=testInfo.project.use.headless!==false;
   const context=profile?await chromium.launchPersistentContext(profile,{headless,executablePath:process.env.SENSA_CHROMIUM_PATH,viewport:{width:1280,height:900},locale:'zh-CN'}):await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});
   const page=await context.newPage(),errors:string[]=[];
   page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
   page.on('pageerror',error=>errors.push(error.message));
   const report:Record<string,unknown>={mode,profile,headless,browserVersion:context.browser()!.version(),iterations:0,bookMembers:100,mediaBytes:scaleDelivery.fixtureMetrics.mediaBytes,hmr:false,faultInjection:false,paidCalls:0};
   evidence.push(report);
   try{
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const runtime=await startOrdinaryBook(page,/English route essentials/);
    await runtime.getByRole('button',{name:/查看表达/}).click();
    await expect(runtime.getByRole('button',{name:/已经连上/})).toBeEnabled();
    const expression=(await runtime.getByRole('heading').first().textContent())!.trim();
    await expect(runtime.getByRole('heading',{name:expression,exact:true})).toBeVisible();
    const pinned=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
    const arrangement=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
    expect(pinned.records).toHaveLength(0);expect(arrangement.session!.dailyNewSenseLimit).toBe(20);
    const member=scaleDelivery.bookArchive!.members.find(member=>member.archive.package.targetExpression.text===expression)!;
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
  const runtime=await startOrdinaryBook(page);
  await runtime.getByRole('button',{name:/查看表达/}).click();
  await runtime.getByRole('button',{name:/已经连上/}).click();
  await runtime.getByRole('button',{name:/完成并回到首页/}).click();
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
  const study=page.locator('#s-study');
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
  await expect(stats.locator('ol').getByRole('button',{name:/borrow/})).toHaveCount(1,{timeout:15_000});
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(saved);
 }finally{await context.close();}
});

test('a corrupt Book download remains uninstalled and can be retried through the UI',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  let corrupt=true;
  await page.route('**/*.sensa-book',route=>corrupt?route.fulfill({status:200,body:'corrupt Book archive'}):route.continue());
  await page.goto(`${origin}/catalog`);
  await page.locator('#s-catalog').last().getByRole('button',{name:/雨天借伞/}).click();
  const book=page.locator('#s-catalog-book').last();
  await book.getByRole('button',{name:'下载学习包',exact:true}).click();
  await expect(book.getByRole('status')).toBeVisible();
  await expect(book.getByText('未下载',{exact:true})).toBeVisible();
  await expect(book.getByText('已下载',{exact:true})).toHaveCount(0);
  await expect(book.getByRole('button',{name:'加入学习',exact:true})).toHaveCount(0);
  await page.reload();
  await expect(book.getByText('未下载',{exact:true})).toBeVisible({timeout:15_000});
  corrupt=false;
  await book.getByRole('button',{name:'下载学习包',exact:true}).click();
  await expect(book.getByText('已下载',{exact:true})).toBeVisible({timeout:15_000});
  await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();
});

test('a failed final member and a cancelled update leave the complete previous Book usable',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`${origin}/catalog`);
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
  expect(learningBefore.enrollments[0]!.bookDigest).toBe(delivery.descriptor.sha256);
  expect(learningBefore.targetIds).toHaveLength(20);

  setRegistry([invalidMemberDelivery.descriptor,learningDelivery.descriptor]);
  await page.goto(`${origin}/catalog`);
  await catalog.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(catalog.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
  await catalog.getByRole('button',{name:/English route essentials/}).click();
  await book.getByRole('button',{name:'下载更新',exact:true}).click();
  await expect(book.getByRole('status')).toHaveText('下载结果与目录版本不一致，请刷新目录后重试。');
  await expect(book.getByText('更新已下载',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual(previous);
  await page.reload();
  await book.getByRole('button',{name:'查看更多',exact:true}).click();
  await expect(book.getByText('borrow',{exact:true})).toBeVisible({timeout:15_000});
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual(previous);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(learningBefore);

  setRegistry([updateDelivery.descriptor,learningDelivery.descriptor]);
  await page.goto(`${origin}/catalog`);
  await catalog.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(catalog.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
  await catalog.getByRole('button',{name:/English route essentials/}).click();
  heldArchivePath=new URL(updateDelivery.descriptor.url).pathname;
  await book.getByRole('button',{name:'下载更新',exact:true}).click();
  await expect(book.getByRole('progressbar')).toBeVisible();
  await book.getByRole('button',{name:'取消下载',exact:true}).click();
  await expect(book.getByText('下载已取消。',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual(previous);
  await page.reload();
  await book.getByRole('button',{name:'查看更多',exact:true}).click();
  await expect(book.getByText('borrow',{exact:true})).toBeVisible({timeout:15_000});
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).toEqual(previous);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(learningBefore);
  heldArchivePath=null;
  await book.getByRole('button',{name:'下载更新',exact:true}).click();
  await expect(book.getByText('更新已下载',{exact:true})).toBeVisible({timeout:15_000});
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint())).filter(pack=>pack.version===2)).toHaveLength(100);
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(learningBefore);
});

test('the Book journey stays responsive with 342 catalog entries and a 100-member Book at 4x CPU',async({page,context})=>{
  const entries=Array.from({length:340},(_,index)=>({
    ...learningDelivery.descriptor,
    book:{...learningDelivery.descriptor.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:`scale-fixture-${index}`,title:`目录规模样本 ${index}`},
  }));
  setRegistry([scaleDelivery.descriptor,learningDelivery.descriptor,...entries]);
  expect(scaleDelivery.descriptor.byteLength).toBeGreaterThan(5*1024*1024);
  catalogLatencyMs=artifactLatencyMs=300;
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
    expect(timings[label],`${label} controlled CI budget (${budget}ms)`).toBeLessThan(budget);
  };
  try{
    await measure('catalogCold',6000,async()=>{
      await page.goto(`${origin}/catalog`);
      await page.locator('#s-catalog').last().getByRole('button',{name:/English route essentials/}).waitFor({state:'visible',timeout:15_000});
  });
  const catalog=page.locator('#s-catalog').last();
  const book=page.locator('#s-catalog-book').last();
    await expect(catalog.locator('ul>li')).toHaveCount(50);
    await expect(catalog.getByRole('button',{name:'查看更多',exact:true})).toBeVisible();
    const catalogExpansionStarted=performance.now();
    await catalog.getByRole('button',{name:'查看更多',exact:true}).click();
    await expect(catalog.locator('ul>li')).toHaveCount(100);
    timings.catalogWindow50To100=Math.round(performance.now()-catalogExpansionStarted);
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
    const beforeIdle=catalogAuthorizationHeaders.length;
    // An explicit observation window, not a wait for UI readiness.
    await page.waitForTimeout(1000);
    expect(catalogAuthorizationHeaders.length-beforeIdle).toBe(0);
    const restoredLongTasks=await page.evaluate(()=>(window as unknown as {__bookJourneyLongTasks:number[]}).__bookJourneyLongTasks);
    const maximumLongTaskMs=Math.max(0,...initialLongTasks,...restoredLongTasks);
    expect(maximumLongTaskMs,'main-thread freeze at 4x CPU (1000ms controlled regression limit)').toBeLessThan(1000);
    await test.info().attach('journey-performance.json',{body:JSON.stringify({catalogEntries:342,catalogInitialWindow:50,catalogExpandedWindow:100,bookMembers:100,bookBytes:scaleDelivery.descriptor.byteLength,cpuThrottle:4,fixtureLatencyMs:300,timings,maximumLongTaskMs,idleCatalogRequests:0,scope:'Controlled Chromium regression budgets; catalogCold ends when the first window is interactive; these are not real-device CWV or production backend SLOs.'}),contentType:'application/json'});
    console.log(`Book journey controlled performance: ${JSON.stringify({timings,maximumLongTaskMs})}`);
  }finally{
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
    await cdp.detach();
  }
});

test('the guest Book path keeps its primary actions reachable at 320px',async({page})=>{
  await page.setViewportSize({width:320,height:740});
  const noOverflow=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
  await page.goto(origin);
  await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
  const home=page.locator('#s-home');
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
  await expect(home.getByRole('heading',{name:'暂无可开始的学习',exact:true})).toBeVisible();
  await expect(home.getByRole('button',{name:'学习包目录',exact:true})).toBeEnabled();
  await page.screenshot({path:test.info().outputPath('completed-home-320.png'),fullPage:true});
});

test('a route-mismatched Book stays downloaded without silently enrolling',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`${origin}/catalog`);
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

test('finishing a pinned Run after switching to an empty Route clears its resume entry without requiring that Route quantity',async({page})=>{
 setRegistry([reviewDelivery.descriptor]);
 const runtime=await startOrdinaryBook(page,/到期复习样本/);
 await runtime.getByRole('button',{name:/查看表达/}).click();
 await expect(runtime.getByRole('button',{name:/有点印象/})).toBeEnabled();
 const pinned=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.goto(`${origin}/profile`);
 await page.locator('#s-profile').getByRole('button',{name:/使用偏好/}).click();
 await page.locator('#account-languages').click();
 const languages=page.getByRole('dialog',{name:'语言路线',exact:true});
 await languages.getByRole('combobox',{name:'选择目标语言',exact:true}).selectOption('ja');
 await languages.getByRole('button',{name:'添加路线',exact:true}).click();
 const japanese=languages.getByRole('radio',{name:/日本語/});
 if(await japanese.getAttribute('aria-checked')!=='true')await japanese.click();
 await expect(japanese).toHaveAttribute('aria-checked','true');
 await languages.getByRole('button',{name:'完成',exact:true}).click();
 await page.goto(origin);
 const home=page.locator('#s-home');
 await home.getByRole('button',{name:'继续学习',exact:true}).click();
 await expect(runtime.getByRole('button',{name:/有点印象/})).toBeEnabled();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(pinned.runtime);
 await runtime.getByRole('button',{name:/有点印象/}).click();
 await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
 const beforeFinish=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failNextLearningCommitForTest('finish'));
 await runtime.getByRole('button',{name:/完成并回到首页/}).click();
 await expect(page.getByText(/未能保存到本机/).first()).toBeVisible();
 await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(beforeFinish);
 await runtime.getByRole('button',{name:/完成并回到首页/}).click();
 await expect(home.getByRole('heading',{name:'今天',exact:true,level:1})).toBeVisible();
 await expect(home.getByRole('heading',{name:'暂无可开始的学习',exact:true})).toBeVisible();
 await expect(home.getByRole('button',{name:'继续学习',exact:true})).toHaveCount(0);
 const completed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(completed.runtime).toBeNull();expect(completed.records).toHaveLength(1);
 expect(completed.records[0]!.targetId).toBe(pinned.runtime!.targetId);
 expect(completed.targetIds).toEqual([],'the empty Japanese Route must not claim English targets');
 await page.reload();await expect(home.getByRole('button',{name:'继续学习',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(completed);
 await page.goto(`${origin}/profile`);
 await page.locator('#s-profile').getByRole('button',{name:/使用偏好/}).click();
 await page.locator('#account-languages').click();
 await languages.getByRole('radio',{name:/English/}).click();
 await languages.getByRole('button',{name:'完成',exact:true}).click();
 await page.goto(origin);
 await expect(home.getByRole('button',{name:'开始学习',exact:true})).toBeEnabled();
 const english=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(english.runtime).toBeNull();expect(english.targetIds).toEqual(pinned.targetIds);
 expect(english.records).toEqual(completed.records);
});

test('Study separates learning content, management and check-in without manufacturing learning records',async({page},testInfo)=>{
 await page.goto(`${origin}/study`);
 const study=page.locator('#s-study');
 await expect(study.getByRole('heading',{name:'还没有学习内容',exact:true})).toBeVisible();
 await expect(study.getByRole('button',{name:'添加内容',exact:true})).toBeEnabled();
 await expect(study.getByRole('region',{name:'后续学习计划',exact:true})).toHaveCount(0);
 await expect(study.getByRole('button',{name:'签到今天',exact:true})).toHaveCount(0);
 await expect(study.getByText('每日新学上限',{exact:true})).toHaveCount(0);
 await expect(study.getByText('默认学习方式',{exact:true})).toHaveCount(0);
 const original=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 const management=await openLearningManagement(page);
 await expect(management.getByText('尚未加入词书',{exact:true})).toBeVisible();
 await expect(management.getByText('还没有单独加入的内容',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(original);
 await management.locator('summary').click();
 const calendar=study.locator('details').filter({has:page.locator('summary').filter({hasText:/^签到日历$/})});
 await calendar.locator('summary').click();
 await study.getByRole('button',{name:'签到今天',exact:true}).click();
 await expect(study.getByRole('button',{name:'今天已签到',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(original);
 await page.reload();
 await expect(study.getByRole('heading',{name:'还没有学习内容',exact:true})).toBeVisible();
 await expect(study.getByRole('button',{name:'今天已签到',exact:true})).toHaveCount(0);
 await calendar.locator('summary').click();
 await expect(study.getByRole('button',{name:'今天已签到',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(original);
 await calendar.locator('summary').click();
 await page.setViewportSize({width:320,height:800});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('study-empty-320.png'),fullPage:true});
});

test('Book mode and ordinal Range recover from failed writes, preserve the current Run, and change the next candidate through OPFS reload',async({page})=>{
 setRegistry([reviewDelivery.descriptor]);
 const runtime=await startOrdinaryBook(page,/到期复习样本/);
 await runtime.getByRole('button',{name:/查看表达/}).click();
 await page.setViewportSize({width:320,height:800});
 const pause=runtime.getByRole('button',{name:'暂停',exact:true});
 expect(await pause.evaluate(node=>getComputedStyle(node).whiteSpace)).toBe('nowrap');
 await expect(pause.locator('kbd')).toBeHidden();
 expect(await runtime.getByRole('button',{name:'声明已会',exact:true}).evaluate(node=>getComputedStyle(node).whiteSpace)).toBe('nowrap');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.setViewportSize({width:1280,height:900});
 const pinned=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 const arrangement=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
 await openLearningManagement(page);
 const study=page.locator('#s-study'),plans=study.getByRole('region',{name:'后续学习计划',exact:true});
 await expect(plans).toContainText('新学与复习');
 await plans.getByRole('button',{name:'编辑《到期复习样本》',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'到期复习样本',exact:true});
 await dialog.getByRole('combobox',{name:'后续学习模式',exact:true}).selectOption('paused');
 await dialog.getByRole('combobox',{name:'学习范围',exact:true}).selectOption('ordinals');
 await dialog.getByRole('spinbutton',{name:'起始序号',exact:true}).fill('1');
 await dialog.getByRole('spinbutton',{name:'结束序号',exact:true}).fill('1');
 await page.setViewportSize({width:320,height:800});
 expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failNextLearningCommitForTest('book_plan'));
 await dialog.getByRole('button',{name:'保存计划',exact:true}).click();
 await expect(dialog.getByRole('alert')).toBeVisible();
 await expect(dialog.getByRole('combobox',{name:'后续学习模式',exact:true})).toHaveValue('paused');
 await expect(plans).toContainText('新学与复习');
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual(arrangement);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.loseNextBookPlanResponseForTest());
 await dialog.getByRole('button',{name:'保存计划',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('已重新读取计划');
 await dialog.getByRole('button',{name:'取消',exact:true}).click();
 await expect(plans).toContainText('暂停');await expect(plans).toContainText('第 1–1 项');
 await plans.getByRole('button',{name:'编辑《到期复习样本》',exact:true}).click();
 await dialog.getByRole('combobox',{name:'后续学习模式',exact:true}).selectOption('maintenance');
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failBookPlanReadsForTest(true));
 await dialog.getByRole('button',{name:'保存计划',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('计划已保存');
 await expect(dialog.getByRole('combobox',{name:'后续学习模式',exact:true})).toBeDisabled();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failBookPlanReadsForTest(false));
 await dialog.getByRole('button',{name:'重试',exact:true}).click();
 await expect(dialog).toHaveCount(0);await expect(plans).toContainText('仅继续已开始的学习');
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual(pinned.targetIds);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual(arrangement);
 await page.reload();
 await openLearningManagement(page);
 await expect(plans).toContainText('仅继续已开始的学习');await expect(plans).toContainText('第 1–1 项');
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual(arrangement);
 await page.setViewportSize({width:1280,height:900});
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'今日',exact:true}).click();
 await page.locator('#s-home').getByRole('button',{name:'继续学习',exact:true}).click();
 await expect(runtime.getByRole('button',{name:/已经连上/})).toBeEnabled();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(pinned.runtime);
 await runtime.getByRole('button',{name:/已经连上/}).click();
 // Maintenance preserves the already-started work but must not introduce the
 // untouched second Target just because it was once in a Session inventory.
 await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
 const continued=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
 expect(continued.scope).toEqual(arrangement.scope);expect(continued.session!.id).toBe(arrangement.session!.id);
 expect(continued.session!.runIds).toHaveLength(1);expect(continued.runScope).toEqual(arrangement.runScope);
 const saved=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 expect(saved.targetIds).toEqual(pinned.targetIds);expect(saved.completedTargets.map(target=>target.targetId)).toEqual([pinned.runtime!.targetId]);
});

test('explicitly ending unfinished learning preserves its saved Step and uses the future plan only on a new Session, through failure and OPFS reopen',async()=>{
 const profile=await mkdtemp(join(tmpdir(),'sensa-session-end-user-'));
 let context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900},locale:'zh-CN'});
 try{
 let page=context.pages()[0]!;
 setRegistry([reviewDelivery.descriptor]);
 let runtime=await startOrdinaryBook(page,/到期复习样本/);
 await runtime.getByRole('button',{name:/查看表达/}).click();
 const pinned=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 const arrangement=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
 const original=await page.evaluate(runId=>window.__sensaBrowserSmoke!.learningActivityRecordForTest(runId),pinned.runtime!.runId);
 const currentPin=original.run!.participants[pinned.runtime!.targetId]!,packageKey=currentPin.materializations[currentPin.material]!.snapshot.provenance.packageKey;
 const publication=(await page.evaluate(()=>window.__sensaBrowserSmoke!.bookProvenanceCheckpointForTest())).cache.find(pack=>pack.key===packageKey)!.publications.find(publication=>publication.archiveSha256===reviewDelivery.descriptor.sha256)!;
 expect(publication.memberIndex).not.toBeNull();const ordinal=publication.memberIndex!+1;
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
 const study=page.locator('#s-study');await study.getByRole('button',{name:'学习偏好',exact:true}).click();
 const preferences=page.getByRole('dialog',{name:'学习偏好',exact:true});
 await preferences.getByRole('combobox',{name:'每日新学数量',exact:true}).selectOption('30');
 await preferences.getByRole('button',{name:'完成',exact:true}).click();
 await openLearningManagement(page);
 const plans=study.getByRole('region',{name:'后续学习计划',exact:true});
 await plans.getByRole('button',{name:'编辑《到期复习样本》',exact:true}).click();
 const plan=page.getByRole('dialog',{name:'到期复习样本',exact:true});
 await plan.getByRole('combobox',{name:'学习范围',exact:true}).selectOption('ordinals');
 await plan.getByRole('spinbutton',{name:'起始序号',exact:true}).fill(String(ordinal));
 await plan.getByRole('spinbutton',{name:'结束序号',exact:true}).fill(String(ordinal));
 await plan.getByRole('button',{name:'保存计划',exact:true}).click();await expect(plan).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual(arrangement);
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'今日',exact:true}).click();
 await page.locator('#s-home').getByRole('button',{name:/继续学习/}).click();
 const requestEnd=async()=>{await runtime.locator('[data-learning-more]').click();await page.getByRole('button',{name:'结束本次学习',exact:true}).click();};
 let ending=page.getByRole('dialog',{name:'结束本次学习？',exact:true});
 await requestEnd();await ending.getByRole('button',{name:'继续本次学习',exact:true}).click();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(pinned);
 await page.setViewportSize({width:320,height:800});await requestEnd();
 expect(await ending.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failNextLearningCommitForTest('finish'));
 await ending.getByRole('button',{name:'结束本次学习',exact:true}).click();await expect(ending.getByRole('alert')).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(pinned);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual(arrangement);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.loseNextSessionEndResponseForTest());
 await ending.getByRole('button',{name:'结束本次学习',exact:true}).click();
 await expect(runtime.getByRole('status').filter({hasText:'未收到结束确认'})).toBeVisible();
 const ended=await page.evaluate(runId=>window.__sensaBrowserSmoke!.learningActivityRecordForTest(runId),pinned.runtime!.runId);
 expect(ended.run!.completedAt).toBeNull();expect(ended.run!.participants).toEqual(original.run!.participants);expect(ended.run!.protocolState).toEqual(original.run!.protocolState);
 expect(ended.originSession!.endReason).toBe('learner_ended');expect(ended.run!.lifecycleEvents.at(-1)!.kind).toBe('paused_for_session_end');
 const idle=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(idle.runtime).toBeNull();expect(idle.records).toEqual([]);expect(idle.completedTargets).toEqual([]);expect(idle.targetIds).toEqual(pinned.targetIds);
 await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.offlineShell),{timeout:30_000}).toBe('ready');
 await page.context().setOffline(true);await page.reload();
 await expect(runtime).toBeVisible();await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await expect(page.locator('#s-home')).toBeVisible();await expect(page.locator('#s-home').getByRole('button',{name:/继续学习/})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual({session:null,scope:null,runScope:null});
 expect(await page.evaluate(runId=>window.__sensaBrowserSmoke!.learningActivityRecordForTest(runId),pinned.runtime!.runId)).toEqual(ended);
 await context.setOffline(false);await context.close();
 context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:320,height:800},locale:'zh-CN'});
 page=context.pages()[0]!;runtime=page.locator('#s-lightweight-runtime');ending=page.getByRole('dialog',{name:'结束本次学习？',exact:true});await page.goto(origin);
 await expect(page.locator('#s-home').getByRole('button',{name:/继续学习/})).toHaveCount(0);
 expect(await page.evaluate(runId=>window.__sensaBrowserSmoke!.learningActivityRecordForTest(runId),pinned.runtime!.runId)).toEqual(ended);
 await page.locator('#s-home').getByRole('button',{name:'开始学习',exact:true}).click();
 await expect(runtime.getByRole('button',{name:/有点印象/})).toBeEnabled();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(pinned.runtime);
 const resumed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
 expect(resumed.session!.id).not.toBe(arrangement.session!.id);expect(resumed.session!.dailyNewSenseLimit).toBe(30);expect(resumed.scope!.members.map(member=>member.targetId)).toEqual([pinned.runtime!.targetId]);
 const resumedRun=await page.evaluate(runId=>window.__sensaBrowserSmoke!.learningActivityRecordForTest(runId),pinned.runtime!.runId);
 expect(resumedRun.run!.studyScopeRevisionId).toBe(arrangement.scope!.id);expect(resumedRun.run!.lifecycleEvents.at(-1)!.kind).toBe('resumed_after_session_end');
 await requestEnd();await page.evaluate(()=>window.__sensaBrowserSmoke!.failReadsAfterSessionEndForTest());
 await ending.getByRole('button',{name:'结束本次学习',exact:true}).click();
 await expect(runtime.getByRole('alert')).toContainText('本次学习已结束');
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningWorkspaceReadsForTest(false));
 await runtime.getByRole('button',{name:'重试',exact:true}).click();
 await expect(runtime.getByRole('alert')).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.commandsAfterSessionEndForTest())).toEqual([]);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toEqual([]);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual({session:null,scope:null,runScope:null});
 }finally{await context.close();await rm(profile,{recursive:true,force:true});}
});

test('a stale end confirmation cannot end the successor selected by another OPFS tab',async({page})=>{
 setRegistry([reviewDelivery.descriptor]);const runtime=await startOrdinaryBook(page,/到期复习样本/);
 await runtime.getByRole('button',{name:/查看表达/}).click();
 const original=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 const originalActivity=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
 const peer=await page.context().newPage();await peer.addInitScript(()=>{(window as any).__name=(fn:unknown)=>fn;});await peer.goto(`${origin}/?flow=lightweight`);
 const peerRuntime=peer.locator('#s-lightweight-runtime');await expect(peerRuntime.getByRole('button',{name:/有点印象/})).toBeEnabled();
 await runtime.locator('[data-learning-more]').click();await page.getByRole('button',{name:'结束本次学习',exact:true}).click();
 const ending=page.getByRole('dialog',{name:'结束本次学习？',exact:true});
 await peerRuntime.getByRole('button',{name:/有点印象/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime?.targetId).not.toBe(original.runtime!.targetId);
 const successor=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(successor.records).toHaveLength(1);
 await ending.getByRole('button',{name:'结束本次学习',exact:true}).click();await expect(ending.getByRole('alert')).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(successor);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).session!.id).toBe(originalActivity.session!.id);
 await ending.getByRole('button',{name:'继续本次学习',exact:true}).click();
 await runtime.locator('[data-learning-more]').click();await page.getByRole('button',{name:'结束本次学习',exact:true}).click();
 await ending.getByRole('button',{name:'结束本次学习',exact:true}).click();await expect(page.locator('#s-home')).toBeVisible();
 await expect.poll(async()=>(await peer.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toBeNull();
 const preserved=await peer.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());expect(preserved.records).toEqual(successor.records);expect(preserved.completedTargets).toEqual(successor.completedTargets);expect(preserved.targetIds).toEqual(successor.targetIds);
 expect(await peer.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual({session:null,scope:null,runScope:null});await peer.close();
});

test('Study quantity save failure and retry preserve the Session quota and per-Run selections through OPFS reload, continuation and finish',async({page})=>{
 setRegistry([reviewDelivery.descriptor]);
 const runtime=await startOrdinaryBook(page,/到期复习样本/);
 await runtime.getByRole('button',{name:/查看表达/}).click();
 await expect(runtime.getByRole('button',{name:/有点印象/})).toBeEnabled();
 const revealedHeadings=await runtime.getByRole('heading').allTextContents();
 const pinned=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 const arrangement=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
 expect(arrangement.scope!.members.map(member=>member.targetId)).toEqual([pinned.runtime!.targetId]);
 expect(pinned.targetIds).toHaveLength(2);
 expect(arrangement.session!.dailyNewSenseLimit).toBe(20);
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
 const study=page.locator('#s-study');
 await study.getByRole('button',{name:'学习偏好',exact:true}).click();
 const preferences=page.getByRole('dialog',{name:'学习偏好',exact:true});
 const quantity=preferences.getByRole('combobox',{name:'每日新学数量',exact:true});
 await expect(quantity).toHaveValue('20');
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failNextLearningCommitForTest('quantity'));
 await quantity.selectOption('10');
 await expect(preferences.getByRole('alert')).toBeVisible();
 await expect(preferences.getByRole('alert')).not.toContainText('runtime.');
 await expect(quantity).toHaveValue('20');
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(pinned);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.loseNextLearningQuantityResponseForTest());
 await quantity.selectOption('10');
 await expect(quantity).toHaveValue('10');
 await expect(preferences.getByRole('alert')).toHaveText('未能确认保存结果，已重新读取每日数量。请核对后重试。');
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(pinned);
 await quantity.selectOption('5');
 await expect(quantity).toHaveValue('5');
 await expect(preferences.getByRole('alert')).toHaveCount(0);
 await preferences.getByRole('button',{name:'完成',exact:true}).click();
 await study.getByRole('button',{name:'学习偏好',exact:true}).click();
 await expect(quantity).toHaveValue('5');
 await preferences.getByRole('button',{name:'完成',exact:true}).click();
 await page.reload();
 await study.getByRole('button',{name:'学习偏好',exact:true}).click();
 await expect(quantity).toHaveValue('5');
 await preferences.getByRole('button',{name:'完成',exact:true}).click();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(pinned);
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'今日',exact:true}).click();
 await page.locator('#s-home').getByRole('button',{name:'继续学习',exact:true}).click();
 await expect(runtime.getByRole('button',{name:/有点印象/})).toBeEnabled();
 expect(await runtime.getByRole('heading').allTextContents()).toEqual(revealedHeadings);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(pinned.runtime);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual(arrangement);
 await runtime.getByRole('button',{name:'更多',exact:true}).click();
 await page.getByRole('dialog',{name:'更多',exact:true}).getByRole('button',{name:'学习偏好',exact:true}).click();
 await expect(quantity).toHaveValue('5');
 await quantity.selectOption('10');await expect(quantity).toHaveValue('10');
 await quantity.selectOption('5');await expect(quantity).toHaveValue('5');
 await preferences.getByRole('button',{name:'继续学习',exact:true}).click();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).toEqual(arrangement);
 await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime?.targetId).not.toBe(pinned.runtime!.targetId);
 await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();
 const continued=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
 expect(continued.scope).toEqual(arrangement.scope);expect(continued.session!.id).toBe(arrangement.session!.id);
 expect(continued.runScope!.members.map(member=>member.targetId)).toEqual([(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime!.targetId]);
 expect(continued.runScope!.id).not.toBe(arrangement.runScope!.id);
 expect(continued.session!.dailyNewSenseLimit).toBe(20);expect(continued.session!.runIds).toHaveLength(2);
 await runtime.getByRole('button',{name:/查看表达/}).click();
 await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect(runtime.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
 await runtime.getByRole('button',{name:/完成并回到首页/}).click();
 await expect(page.locator('#s-home')).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest())).session).toBeNull();
});

test('repeated Relearning failure requires explicit retry and survives offline reopen without a second Review settlement',async()=>{
  const profile=await mkdtemp(join(tmpdir(),'sensa-relearning-user-'));
  let context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900},locale:'zh-CN'});
  try{
    let page=context.pages()[0]!;
    const {runtime,review}=await startDueReviewWithPausedInitial(page);
    await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:/还没连上/}).click();
    await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled();
    await runtime.getByRole('button',{name:/查看表达/}).click();
    const revealed=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
    const clock=await page.evaluate(()=>Date.now());
    // The Runtime route itself reopens offline at its saved Step; it does not
    // navigate to Home or require another artificial resume click.
    await context.setOffline(true);await page.reload();
    await expect(runtime.getByRole('button',{name:/还没连上/})).toBeEnabled();
    expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(revealed.runtime);
    await context.setOffline(false);await context.close();
    context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900},locale:'zh-CN'});
    page=context.pages()[0]!;await page.clock.setFixedTime(clock);await page.goto(origin);
    await page.locator('#s-home').getByRole('button',{name:'继续学习',exact:true}).click();
    const reopened=page.locator('#s-lightweight-runtime');await expect(reopened.getByRole('button',{name:/还没连上/})).toBeEnabled();
    expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(revealed.runtime);
    const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());
    await page.evaluate(()=>window.__sensaBrowserSmoke!.loseNextLearningActionResponseForTest());
    await reopened.getByRole('button',{name:/还没连上/}).click();
    await expect(reopened.getByRole('heading',{name:'还需再学习',exact:true})).toBeVisible();
    await expect(reopened.getByRole('heading',{name:'本轮完成',exact:true})).toHaveCount(0);
    await expect(reopened.getByRole('progressbar')).toHaveCount(0);
    const pending=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
    expect(pending.runtime!.runId).toBe(revealed.runtime!.runId);expect(pending.records.filter(record=>record.kind==='relearning')).toHaveLength(0);
    await page.reload();
    await expect(reopened.getByRole('heading',{name:'还需再学习',exact:true})).toBeVisible();
    expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(pending.runtime);
    await reopened.getByRole('button',{name:'再试一次',exact:true}).click();
    await expect(reopened.getByRole('button',{name:/查看表达/})).toBeEnabled();
    const retried=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
    expect(retried.runtime!.runId).not.toBe(pending.runtime!.runId);expect(retried.runtime!.targetId).toBe(review.runtime!.targetId);
    await reopened.getByRole('button',{name:/查看表达/}).click();await reopened.getByRole('button',{name:/已经连上/}).click();
    await expect(reopened.getByRole('heading',{name:'本轮完成',exact:true})).toBeVisible();
    const after=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());expect(after.targets).toEqual(before.targets);
    expect(after.behavioralEvidenceCount).toBe(0);
    const saved=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
    expect(saved.records.map(record=>record.kind).sort()).toEqual(['initial_learning','relearning','retention_review']);
  }finally{await context.setOffline(false);await context.close();await rm(profile,{recursive:true,force:true});}
});

test('closing and reopening Chromium restores the same revealed learning step',async()=>{
  const profile=await mkdtemp(join(tmpdir(),'sensa-book-user-'));
  let context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900},locale:'zh-CN'});
  try{
    let page=context.pages()[0]!;
    await page.goto(origin);
    await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
    // Wait on the primary empty-library action, not the temporary duplicate
    // shortcut shown while the local readiness projection is loading.
    const catalogAction=page.locator('#s-home .sensa-today-start');
    await expect(catalogAction).toHaveAccessibleName('学习包目录');
    await catalogAction.click();
    await page.locator('#s-catalog').last().getByRole('button',{name:/雨天借伞/}).click();
    const book=page.locator('#s-catalog-book').last();
    await book.getByRole('button',{name:'下载学习包',exact:true}).click();
    await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled({timeout:15_000});
    await book.getByRole('button',{name:'加入学习',exact:true}).click();
    await book.getByRole('button',{name:'去学习',exact:true}).click();
    await page.locator('#s-home').getByRole('button',{name:'开始学习',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'学习偏好',exact:true})).toHaveCount(0);
    await page.locator('#s-lightweight-runtime').getByRole('button',{name:/查看表达/}).click();
    const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
    expect(before.runtime!.stepId).toBeTruthy();
    await context.close();
    context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900},locale:'zh-CN'});
    page=context.pages()[0]!;
    await page.goto(origin);
    const home=page.locator('#s-home');
    await expect(home.getByRole('button',{name:'继续学习',exact:true})).toBeVisible({timeout:15_000});
    await home.getByRole('button',{name:'继续学习',exact:true}).click();
    const runtime=page.locator('#s-lightweight-runtime');
    await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
    await expect(runtime.getByRole('button',{name:/查看表达/})).toHaveCount(0);
    expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);
    await runtime.getByRole('button',{name:/已经连上/}).click();
    await runtime.getByRole('button',{name:/完成并回到首页/}).click();
    expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records).toHaveLength(1);
  }finally{
    await context.close();
    await rm(profile,{recursive:true,force:true});
  }
});
