import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
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
import {webTestBuild,loopbackTestPort,rememberLoopbackTestPort} from '../support/webTestBuild';

/** Isolated server and mutable delivery state per spec; exact builds are read-only. */
export function createPackageCenterFixture(group:'book'|'account'|'reference'|'runtime'|'workspace'){
const root=process.cwd();

const output=resolve(root,'.tmp/package-center-journey',group);

let dist:string;

const subject='4c59833b-a0e2-4bd0-9d27-908ffcd81cf8';

const account='f10b0c0c-0f03-40cb-b989-3dfc2c74d490';

const types:Record<string,string>={
  '.css':'text/css','.html':'text/html','.ico':'image/x-icon','.js':'text/javascript',
  '.json':'application/json','.mjs':'text/javascript','.mp3':'audio/mpeg',
  '.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm','.woff2':'font/woff2',
};

let server:Server;

let apiServer:ReturnType<typeof serve>;

let apiOrigin='';

let origin='';

let storageKey='';

let delivery:ReturnType<typeof portableBookDeliveryFixture>;

let learningDelivery:ReturnType<typeof portableBookDeliveryFixture>;

let referenceDelivery:ReturnType<typeof portableBookDeliveryFixture>;

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

let semanticScaleFixture:JourneyState|undefined;

function setRegistry(items:typeof delivery.descriptor[]){
 const snapshot={format:'sensa-learning-content-registry-v3' as const,publishedAt:'2026-09-28T00:00:00Z',items};
 registry={...snapshot,revision:createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex')};
}

const jwt=(expiresInSeconds:number,userId=subject)=>{
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    encode({alg:'HS256',typ:'JWT'}),
    encode({
      sub:userId,aud:'authenticated',email:'package-center@sensa.invalid',
      session_id:randomUUID(),exp:Math.floor(Date.now()/1000)+expiresInSeconds,
      amr:[{method:'otp',timestamp:Math.floor(Date.now()/1000)}],
    }),
    'fixture-signature',
  ].join('.');
};

const session=(userId=subject)=>({
  access_token:jwt(3600,userId),token_type:'bearer',expires_in:3600,
  expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'fixture-refresh-token',
  user:{
    id:userId,aud:'authenticated',role:'authenticated',
    email:'package-center@sensa.invalid',app_metadata:{},user_metadata:{},
    identities:[],created_at:new Date().toISOString(),
  },
});

const test=base.extend<{preparedScenePage:Page}>({
 preparedScenePage:[async({page,context},use)=>{
  const started=performance.now(),repository=new MemoryJourneyRepository();
  await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
  semanticScaleFixture=syntheticSemanticWorld(await repository.load(),10_000);
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
  await expect(page.locator('#s-home')).toBeVisible();
  expect(await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await(await fetch('/semantic-scale-fixture')).json()))).toBe(10_000);
  console.log('Personal Scene 10k fixture preparation (not interaction):',JSON.stringify({preparedMs:performance.now()-started}));
  await use(page);
 },{timeout:300_000}],
});

test.setTimeout(180_000);

test.use({viewport:{width:1280,height:900},locale:'zh-CN',actionTimeout:15_000});

test.beforeAll(async()=>{
  test.setTimeout(180_000);
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
      if(url.pathname==='/semantic-scale-fixture'){json(semanticScaleFixture);return;}
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
      const bytes=delivery.responses.get(deliveryUrl)??learningDelivery.responses.get(deliveryUrl)??referenceDelivery.responses.get(deliveryUrl)??reviewDelivery.responses.get(deliveryUrl)
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
  server.listen(loopbackTestPort('package-web'),'127.0.0.1');
  await once(server,'listening');
  origin=rememberLoopbackTestPort('package-web',server);
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
  apiServer=serve({fetch:api.fetch,hostname:'127.0.0.1',port:loopbackTestPort('package-api')});
  if(!apiServer.listening)await once(apiServer,'listening');
  apiOrigin=rememberLoopbackTestPort('package-api',apiServer);
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
  referenceDelivery=portableBookDeliveryFixture({baseUrl:`${origin}/published/`,packageId:randomUUID(),expression:'borrow',example:'May asked to borrow an umbrella.',title:'只读查词样本'});
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
  await mkdir(output,{recursive:true});
  dist=await webTestBuild({
      VITE_SENSA_MODE:'production',
      VITE_SENSA_BROWSER_SMOKE:'true',
      VITE_SUPABASE_URL:origin,
      VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable-key',
      VITE_SENSA_API_URL:apiOrigin,
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

async function referenceProviders(page:Page){
 const state={mode:'ready' as 'ready'|'missing'|'error',requests:[] as string[],holdWord:null as string|null,pending:[] as Array<()=>void>,aborted:[] as string[]};
 // Reference resolution stays no-cost even if fixture authentication changes.
 await page.route('**/sensa/model/turn',route=>route.fulfill({status:503,json:{code:'fixture_model_unavailable'}}));
 page.on('requestfailed',request=>{if(new URL(request.url()).hostname==='api.wiktapi.dev'&&request.failure()?.errorText.includes('ERR_ABORTED'))state.aborted.push(request.url());});
 for(const host of ['api.wiktapi.dev','api.dictionaryapi.dev','en.wiktionary.org'])await page.route(`https://${host}/**`,async route=>{
  const url=new URL(route.request().url());state.requests.push(url.href);
  if(state.mode!=='ready'||host!=='api.wiktapi.dev'||!url.pathname.endsWith('/definitions')){await route.fulfill({status:state.mode==='error'?503:404,json:{}});return;}
  const word=decodeURIComponent(url.pathname.match(/\/word\/([^/]+)/u)![1]!);
  if(state.holdWord===word)await new Promise<void>(resolve=>state.pending.push(resolve));
  try{await route.fulfill({json:{word,edition:'en',definitions:[{pos:'verb',lang_code:url.searchParams.get('lang'),senses:[{glosses:[`Fixture definition for ${word}.`],examples:[{text:`May asked to ${word} an umbrella.`,ref:'Controlled reference fixture'}]}]}]}});}
  catch(error){if(!route.request().failure())throw error;}
 });
 return state;
}

const emptySignedInPreflightRetry=(failure:'http-error'|'network-error')=>async({page,context}:{page:Page;context:BrowserContext},testInfo:TestInfo)=>{
 test.setTimeout(90_000);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:session()});
 let fail=true,heads=0,writes=0;
 context.on('request',request=>{if(/\/sensa\/library-sync\/(?:commit|blocks\/store)$/u.test(new URL(request.url()).pathname))writes++;});
 await context.route(apiOrigin+'/sensa/library-sync/head',route=>{heads++;return fail?(failure==='network-error'?route.abort():route.fulfill({status:503,json:{code:'fixture_preflight_unavailable'}})):route.fulfill({json:{revision:0,manifest:null}});});
 await page.goto(origin);await expect(page.locator('#s-home').getByRole('button',{name:'重试恢复',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'暂无可开始的学习',exact:true})).toHaveCount(0);
 await expect(page.locator('#s-home').getByText('正在加载 Sensa…',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(writes).toBe(0);
 for(const label of ['我的语义世界','我的学习','练习']){
  await page.getByRole('button',{name:label,exact:true}).first().click();
  await expect(page.getByRole('button',{name:'重试恢复',exact:true})).toBeVisible();
  await expect(page.locator('.sensa-world-row')).toHaveCount(0);await expect(page.getByRole('button',{name:'开始聆听',exact:true})).toHaveCount(0);
 }
 const screenshot=testInfo.outputPath('unverified-account-data.png');await page.screenshot({path:screenshot});await testInfo.attach('unverified-account-data',{path:screenshot,contentType:'image/png'});
 // Settings stays reachable. Merely viewing it cannot claim account restoration.
 await page.locator('#s-academy').getByRole('button',{name:'账号与设置',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();
 await page.getByRole('button',{name:'今日',exact:true}).first().click();await expect(page.getByRole('button',{name:'重试恢复',exact:true})).toBeVisible();
 fail=false;await page.getByRole('button',{name:'重试恢复',exact:true}).click();
 await expect(page.getByRole('heading',{name:'暂无可开始的学习',exact:true})).toBeVisible();
 expect(heads).toBeGreaterThan(1);expect(writes).toBe(0);
 await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus())).toBe('synced');
};

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

return {test,
get account(){return account},
get apiOrigin(){return apiOrigin}, set apiOrigin(value:typeof apiOrigin){apiOrigin=value},
get artifactLatencyMs(){return artifactLatencyMs}, set artifactLatencyMs(value:typeof artifactLatencyMs){artifactLatencyMs=value},
get catalogAuthorizationHeaders(){return catalogAuthorizationHeaders},
get catalogLatencyMs(){return catalogLatencyMs}, set catalogLatencyMs(value:typeof catalogLatencyMs){catalogLatencyMs=value},
get catalogValidators(){return catalogValidators},
get cloudBlocks(){return cloudBlocks},
get cloudManifest(){return cloudManifest}, set cloudManifest(value:typeof cloudManifest){cloudManifest=value},
get cloudRevision(){return cloudRevision}, set cloudRevision(value:typeof cloudRevision){cloudRevision=value},
get delivered(){return delivered},
get delivery(){return delivery}, set delivery(value:typeof delivery){delivery=value},
get emptySignedInPreflightRetry(){return emptySignedInPreflightRetry},
get heldArchivePath(){return heldArchivePath}, set heldArchivePath(value:typeof heldArchivePath){heldArchivePath=value},
get invalidMemberDelivery(){return invalidMemberDelivery}, set invalidMemberDelivery(value:typeof invalidMemberDelivery){invalidMemberDelivery=value},
get jwt(){return jwt},
get learningDelivery(){return learningDelivery}, set learningDelivery(value:typeof learningDelivery){learningDelivery=value},
get openLearningManagement(){return openLearningManagement},
get origin(){return origin}, set origin(value:typeof origin){origin=value},
get publisherAccess(){return publisherAccess}, set publisherAccess(value:typeof publisherAccess){publisherAccess=value},
get referenceDelivery(){return referenceDelivery}, set referenceDelivery(value:typeof referenceDelivery){referenceDelivery=value},
get referenceProviders(){return referenceProviders},
get registry(){return registry}, set registry(value:typeof registry){registry=value},
get reviewDelivery(){return reviewDelivery}, set reviewDelivery(value:typeof reviewDelivery){reviewDelivery=value},
get scaleDelivery(){return scaleDelivery}, set scaleDelivery(value:typeof scaleDelivery){scaleDelivery=value},
get semanticScaleFixture(){return semanticScaleFixture}, set semanticScaleFixture(value:typeof semanticScaleFixture){semanticScaleFixture=value},
get session(){return session},
get setRegistry(){return setRegistry},
get startDueReviewWithPausedInitial(){return startDueReviewWithPausedInitial},
get startOrdinaryBook(){return startOrdinaryBook},
get storageKey(){return storageKey}, set storageKey(value:typeof storageKey){storageKey=value},
get updateDelivery(){return updateDelivery}, set updateDelivery(value:typeof updateDelivery){updateDelivery=value},
};
}
