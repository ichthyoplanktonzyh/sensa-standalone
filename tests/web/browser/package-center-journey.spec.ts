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
import {cpus,tmpdir} from 'node:os';
import {extname,join,resolve} from 'node:path';
import {chromium,expect,test as base,type Page,type BrowserContext,type TestInfo} from '@playwright/test';
import {unzipSync,zipSync} from 'fflate';
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

/** Controlled Reference payloads only; real UI/OPFS, never live quality evidence. */
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

test('ordinary email login uses a persisted PKCE challenge, preserves local facts and starts real learning after admission',async({page,context})=>{
 cloudManifest=null;cloudRevision=0;cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 let sent=0,exchanged=0,challenge='';
 await page.route('**/auth/v1/otp*',async route=>{
  const body=route.request().postDataJSON();sent++;
  expect(body.email).toBe('package-center@sensa.invalid');expect(body.code_challenge_method).toBe('s256');
  expect(body.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);challenge=body.code_challenge;
  const redirect=new URL(route.request().url()).searchParams.get('redirect_to');expect(redirect).toBe(origin+'/profile');
  await route.fulfill({json:{user:null,session:null}});
 });
 await page.route('**/auth/v1/token*',async route=>{
  exchanged++;expect(new URL(route.request().url()).searchParams.get('grant_type')).toBe('pkce');
  const body=route.request().postDataJSON();expect(body.auth_code).toBe('ordinary-login-code');
  expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(challenge);
  await route.fulfill({json:session()});
 });
 await page.goto(origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'登录 Sensa',exact:true}).click();
 await page.getByLabel('邮箱',{exact:true}).fill('package-center@sensa.invalid');await page.getByRole('button',{name:'发送登录邮件',exact:true}).click();
 await expect(page.getByRole('heading',{name:'查看登录邮件',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'稍后可重新发送',exact:true})).toBeDisabled();
 expect(sent).toBe(1);expect(exchanged).toBe(0);
 // Full navigation discards component memory: the SDK must recover its own
 // browser-stored verifier. The synthetic provider still does not send mail.
 await page.goto(origin+'/profile?code=ordinary-login-code');await expect(page.locator('#s-profile')).toBeVisible();
 await expect(page.getByRole('heading',{name:'当前账号',exact:true})).toBeVisible();await expect(page.getByText('已连接账号',{exact:true})).toBeVisible();expect(exchanged).toBe(1);
 expect(new URL(page.url()).search).toBe('');
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(before);
 await page.reload();await expect(page.getByRole('heading',{name:'当前账号',exact:true})).toBeVisible();expect(exchanged).toBe(1);
 const runtime=await startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
});

test('ordinary email rate limits, invalid codes and missing invitations preserve usable guest content',async({page,context})=>{
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 let sends=0,verifications=0;
 await page.route('**/auth/v1/otp*',async route=>{sends++;await route.fulfill(sends===1?{status:429,json:{msg:'fixture_rate_limit'}}:{json:{user:null,session:null}});});
 await page.route('**/auth/v1/verify*',async route=>{verifications++;const body=route.request().postDataJSON();expect(body.email).toBe('package-center@sensa.invalid');expect(body.type).toBe('email');await route.fulfill(verifications===1?{status:403,json:{msg:'fixture_expired'}}:{json:session()});});
 await page.route('**/sensa/web/access/session',route=>route.fulfill({status:403,json:{code:'invite_required'}}));
 await page.goto(origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'登录 Sensa',exact:true}).click();await page.getByLabel('邮箱',{exact:true}).fill('package-center@sensa.invalid');await page.getByRole('button',{name:'发送登录邮件',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('发送过于频繁');expect(sends).toBe(1);
 await page.getByRole('button',{name:'发送登录邮件',exact:true}).click();await page.getByRole('button',{name:'邮件中有验证码？',exact:true}).click();
 await page.getByLabel('验证码',{exact:true}).fill('000000');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('验证码不正确或已过期');
 await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 await expect(page.locator('#s-profile')).toBeVisible();await expect(page.getByRole('status').filter({hasText:'当前账号尚未获得服务访问权限，请联系 Sensa 支持。'})).toBeVisible();
 await expect(page.getByText('已连接账号',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);expect(verifications).toBe(2);
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'退出账号',exact:true}).click();
 await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),storageKey)).toBeNull();
 await page.reload();await expect(page.locator('#s-profile')).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
});

test('an ordinary mail callback without this browser PKCE verifier fails visibly and keeps local content',async({page,context})=>{
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 let admissions=0;
 await page.route('**/sensa/web/access/session',async route=>{admissions++;await route.fulfill({status:403,json:{code:'invite_required'}});});
 await page.goto(origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.goto(origin+'/profile?code=another-browser-code');await expect(page.locator('#s-profile')).toBeVisible();
 await expect(page.getByRole('status')).toContainText('登录链接已失效，或未在发起登录的浏览器中打开');expect(new URL(page.url()).search).toBe('');
 expect(admissions).toBe(0);expect(await page.evaluate(key=>localStorage.getItem(key),storageKey)).toBeNull();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'登录 Sensa',exact:true}).click();
 await expect(page.getByRole('button',{name:'发送登录邮件',exact:true})).toBeEnabled();
});

test('an empty practice scope offers content selection and return without loading a player or inventing learner facts',async({page})=>{
 let sdkRequests=0;await page.route('https://youglish.com/public/emb/widget.js',route=>{sdkRequests++;return route.abort();});
 await page.goto(origin+'/academy');const practice=page.locator('#s-academy').last(),activities=practice.locator('.sensa-practice-activities').getByRole('button');
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

test('a missing local identity opens recovery without an empty replacement, and explicit backup restore preserves personal facts',async({page})=>{
 test.setTimeout(90_000);
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.locator('#s-home')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
 // Synthetic accepted source setup, not a claim of manual/model authoring.
 expect(await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load())).toBe(1);
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 const password='isolated-recovery-password';
 await page.goto(origin+'/profile');await page.locator('#settings-data').click();await page.locator('#settings-backup').click();
 const originalPanel=page.getByRole('region',{name:'本机库备份与恢复',exact:true});
 await originalPanel.getByLabel('备份密码',{exact:true}).fill(password);
 const pendingDownload=page.waitForEvent('download');await originalPanel.getByRole('button',{name:'导出加密备份',exact:true}).click();
 const downloaded=await pendingDownload,path=await downloaded.path();if(!path)throw new Error('backup_download_missing');
 const backup=await readFile(path);
 // Only this isolated test origin is cleared, after a real recoverable export.
 await page.evaluate(()=>window.__sensaBrowserSmoke!.discardLibraryForRecoveryTest());await page.reload();
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'导出加密备份',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).toEqual({identity:null,creationReceipt:null,settings:0});
 await page.getByRole('button',{name:'登录原账号',exact:true}).click();
 await page.getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).toEqual({identity:null,creationReceipt:null,settings:0});
 await page.getByRole('button',{name:/重新打开/u}).click();
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).toEqual({identity:null,creationReceipt:null,settings:0});
 const panel=page.getByRole('region',{name:'本机库备份与恢复',exact:true});
 await panel.getByLabel('备份密码',{exact:true}).fill('incorrect-test-password');
 await panel.getByLabel('选择备份文件',{exact:true}).setInputFiles({name:'synthetic-personal.sensa-backup',mimeType:'application/octet-stream',buffer:backup});
 await panel.getByRole('button',{name:'检查备份',exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toBeNull();
 await panel.getByLabel('备份密码',{exact:true}).fill(password);await panel.getByRole('button',{name:'检查备份',exact:true}).click();
 await expect(panel.getByRole('button',{name:'确认恢复到当前空本机库',exact:true})).toBeEnabled();
 await expect(panel).toContainText('1 个意思');
 await panel.getByRole('button',{name:'确认恢复到当前空本机库',exact:true}).click();
 await expect(panel.getByRole('button',{name:/重新打开/u})).toBeVisible();
 const after=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 expect(after.identity).toMatchObject({id:(before.identity as {id:string}).id});
 await panel.getByRole('button',{name:/重新打开/u}).click();await expect(page.locator('#s-profile')).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
 await page.goto(origin+'/content');await expect(page.locator('.sensa-world-row').first()).toBeVisible();
 await page.locator('.sensa-world-row').first().click();await expect(page.getByText('Private source: May asked to borrow an umbrella.',{exact:true}).first()).toBeVisible();
});

test('an encrypted backup restores exact personal facts and genuine learning history in a fresh browser without overwriting an occupied library',async({page,browser},testInfo)=>{
 test.setTimeout(120_000);
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 const runtime=await startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
 if(await runtime.getByRole('button',{name:'暂停',exact:true}).isVisible())await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
 await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 // Real owner Draft commands carry a synthetic private image; provider quality
 // and manual authorship are covered separately from the backup transport.
 await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,1));
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 const learning=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 const password='isolated-roundtrip-password';
 const backupPanel=async(target:Page)=>{await target.goto(origin+'/profile');await target.locator('#settings-data').click();await target.locator('#settings-backup').click();return target.getByRole('region',{name:'本机库备份与恢复',exact:true});};
 const sourcePanel=await backupPanel(page);await sourcePanel.getByLabel('备份密码',{exact:true}).fill(password);
 const pendingDownload=page.waitForEvent('download');await sourcePanel.getByRole('button',{name:'导出加密备份',exact:true}).click();
 const downloaded=await pendingDownload,downloadPath=await downloaded.path();if(!downloadPath)throw Error('backup_download_missing');
 const backup=await readFile(downloadPath),file={name:'roundtrip.sensa-backup',mimeType:'application/octet-stream',buffer:backup};
 await sourcePanel.getByLabel('选择备份文件',{exact:true}).setInputFiles(file);await sourcePanel.getByRole('button',{name:'检查备份',exact:true}).click();
 await expect(sourcePanel.getByRole('alert')).toContainText('当前本机库已有资料');await expect(sourcePanel.getByRole('button',{name:'确认恢复到当前空本机库',exact:true})).toHaveCount(0);
 await expect(sourcePanel).toContainText('1 个意思');
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 const receiver=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN'});
 try{
  await receiver.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const restoredPage=await receiver.newPage();await restoredPage.goto(origin);await restoredPage.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await expect(restoredPage.locator('#s-home')).toBeVisible();
  const destination=await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
  const destinationFacts=await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true));
  const destinationPath=testInfo.outputPath('fresh-destination-facts.json');await writeFile(destinationPath,JSON.stringify(destinationFacts));await testInfo.attach('fresh-destination-facts',{path:destinationPath,contentType:'application/json'});
  const panel=await backupPanel(restoredPage);await panel.getByLabel('选择备份文件',{exact:true}).setInputFiles(file);await panel.getByLabel('备份密码',{exact:true}).fill('incorrect-roundtrip-password');
  await panel.getByRole('button',{name:'检查备份',exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();
  expect(await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).toEqual(destination);
  const corrupted=JSON.parse(backup.toString('utf8'));corrupted.data=(corrupted.data[0]==='A'?'B':'A')+corrupted.data.slice(1);
  await panel.getByLabel('备份密码',{exact:true}).fill(password);await panel.getByLabel('选择备份文件',{exact:true}).setInputFiles({...file,buffer:Buffer.from(JSON.stringify(corrupted))});await panel.getByRole('button',{name:'检查备份',exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();
  expect(await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).toEqual(destination);
  await panel.getByLabel('选择备份文件',{exact:true}).setInputFiles(file);
  await panel.getByLabel('备份密码',{exact:true}).fill(password);await panel.getByRole('button',{name:'检查备份',exact:true}).click();
  await expect(panel).toContainText('1 个意思');await expect(panel).toContainText('1 次运行');
  const started=Date.now();await panel.getByRole('button',{name:'确认恢复到当前空本机库',exact:true}).click();await expect(panel.getByRole('button',{name:/重新打开/u})).toBeVisible();
  await testInfo.attach('backup-roundtrip-conditions',{body:JSON.stringify({privateDraftImages:1,personalMeanings:1,learningRecords:1,fileBytes:backup.byteLength,restoreMs:Date.now()-started,viewport:'390x844',cpu:'1x',provider:'synthetic low-media publication; no paid calls'}),contentType:'application/json'});
  await panel.getByRole('button',{name:/重新打开/u}).click();await expect(restoredPage.locator('#s-profile')).toBeVisible();
  const after=await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
  expect(after.identity).toMatchObject({id:(before.identity as {id:string}).id,learnerId:(before.identity as {learnerId:string}).learnerId});
  expect((after.identity as {deviceId:string}).deviceId).not.toBe((before.identity as {deviceId:string}).deviceId);
  expect(await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
  expect(await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(learning);
  await restoredPage.reload();await expect(restoredPage.locator('#s-profile')).toBeVisible();
  expect(await restoredPage.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
  await restoredPage.goto(origin+'/content');await restoredPage.locator('.sensa-world-row').first().click();await expect(restoredPage.getByText('Private source: May asked to borrow an umbrella.',{exact:true}).first()).toBeVisible();
 }finally{await receiver.close();}
 const racing=await browser.newContext({locale:'zh-CN'});
 try{
  await racing.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const restoring=await racing.newPage();await restoring.goto(origin);await restoring.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await expect(restoring.locator('#s-home')).toBeVisible();
  const panel=await backupPanel(restoring);await panel.getByLabel('备份密码',{exact:true}).fill(password);await panel.getByLabel('选择备份文件',{exact:true}).setInputFiles(file);await panel.getByRole('button',{name:'检查备份',exact:true}).click();await expect(panel.getByRole('button',{name:'确认恢复到当前空本机库',exact:true})).toBeEnabled();
  const writer=await racing.newPage();await writer.goto(origin);await expect(writer.locator('#s-home')).toBeVisible();await writer.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0));
  const concurrent=await writer.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
  await panel.getByRole('button',{name:'确认恢复到当前空本机库',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('当前本机库已有资料');
  expect(await writer.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(concurrent);
  await writer.reload();await expect(writer.locator('#s-home')).toBeVisible();expect(await writer.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(concurrent);
 }finally{await racing.close();}
});

test('signout keeps local facts available while the auth service is stalled and reconnecting cannot cancel that intent',async({page,context})=>{
 cloudManifest=null;cloudRevision=0;cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:session()});
 await page.goto(origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 const runtime=await startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 const beforeLearning=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());await page.goto(origin+'/profile');
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 let release!:()=>void,logoutRequests=0;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/auth/v1/logout*',async route=>{logoutRequests++;await held;await route.fulfill({status:503,json:{message:'synthetic unavailable logout'}});});
 try{
  await page.locator('#settings-security').click();await page.getByRole('button',{name:'退出账号',exact:true}).click();await expect.poll(()=>logoutRequests).toBe(1);
  await expect(page.locator('#s-profile')).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.locator('.sensa-world-row').first().click();await expect(page.getByText('Private source: May asked to borrow an umbrella.',{exact:true}).first()).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
  const metadata=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true));expect(metadata.meta!.find(row=>row.key==='signed-out')?.value).toEqual(['boolean',true]);
  await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'今日',exact:true}).click();await page.locator('#s-home').getByRole('button',{name:/继续学习/}).click();
  expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).runtime).toEqual(beforeLearning.runtime);
  await page.locator('#s-lightweight-runtime').getByRole('button',{name:/已经连上/}).click();await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
 }finally{release();}
 await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key)===null,storageKey),{timeout:20_000}).toBe(true);
});

test('a different account cannot open an owned library and can sign out without replacing its facts',async({page,context})=>{
 cloudManifest=null;cloudRevision=0;cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:storageKey,value:session()});
 await page.goto(origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest()),identity=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 // Controlled auth change: real account/runtime/OPFS handling, not provider login.
 await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:session(randomUUID())});await page.reload();
 await page.evaluate(()=>{(window as any).__fixtureExtensionSignouts=[];window.addEventListener('message',event=>{if(event.data?.kind==='web-session-ended')(window as any).__fixtureExtensionSignouts.push(event.data);});});
 await expect(page.locator('.sensa-account-entry')).toBeVisible();await expect(page.locator('#s-profile')).toHaveCount(0);await expect(page.getByText('Private source: May asked to borrow an umbrella.',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 await page.getByRole('button',{name:'退出当前登录，使用原账号重新登录',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__fixtureExtensionSignouts)).toEqual([]);
 await page.locator('#settings-security').click();await expect(page.getByRole('button',{name:'退出账号',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'登录 Sensa',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toEqual(identity.identity);
});

test('a delayed account admission in another tab cannot reopen online services after a committed logout',async({page,context})=>{
 cloudManifest=null;cloudRevision=0;cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:storageKey,value:session()});
 await page.goto(origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.evaluate(()=>window.__sensaBrowserSmoke!.holdNextAccountSignoutForTest());
 const other=await context.newPage();let resume!:()=>void,requests=0;const paused=new Promise<void>(resolve=>{resume=resolve;});
 await other.route('**/sensa/web/access/session',async route=>{requests++;await paused;await route.fulfill({status:200,json:{authorized:true,accountId:account,capabilities:{publishLearningContent:false}}});});
 await other.goto(origin+'/profile');await expect.poll(()=>requests).toBe(1);await expect(other.locator('#s-profile')).toBeVisible();
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'退出账号',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.accountSignoutWaitingForTest())).toBe(true);
 const unwanted=other.waitForRequest(request=>new URL(request.url()).pathname.startsWith('/sensa/intake/'),{timeout:1500}).then(()=>true,()=>false);
 try{
  const response=other.waitForResponse(response=>new URL(response.url()).pathname==='/sensa/web/access/session');resume();await response;
  expect(await unwanted).toBe(false);await expect(other.locator('#s-profile').getByText('本机使用',{exact:true})).toBeVisible();
  const metadata=await other.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true));expect(metadata.meta!.find(row=>row.key==='signed-out')?.value).toEqual(['boolean',true]);
  expect(await other.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 }finally{resume();await page.evaluate(()=>window.__sensaBrowserSmoke!.releaseAccountSignoutForTest());await other.close();}
});

test('a 10000-Meaning local clear uses a bounded preview and leaves an empty reopened library',async({},testInfo)=>{
 const profile=await mkdtemp(join(tmpdir(),'sensa-lj19-clear-'));
 const context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900},locale:'zh-CN'}),page=await context.newPage();
 let completed=false;
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());semanticScaleFixture=syntheticSemanticWorld(await repository.load(),10_000);
 const fixtureBytes=Buffer.byteLength(JSON.stringify(semanticScaleFixture));
 try{
  await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await expect(page.locator('#s-home')).toBeVisible();
  expect(await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await(await fetch('/semantic-scale-fixture')).json()))).toBe(10_000);
  await page.goto(origin+'/profile');await page.locator('#settings-data').click();await page.locator('#settings-storage').click();
  const start=await page.evaluate(()=>performance.now());await page.getByRole('button',{name:'检查要清除的资料',exact:true}).click();await expect(page.getByText(/10000 个意思/)).toBeVisible();
  const previewMs=await page.evaluate(start=>performance.now()-start,start);expect(previewMs).toBeLessThan(1500);
  await page.getByLabel('我已保存需要的备份，确认清除以上本机资料。').check();const clearStart=await page.evaluate(()=>performance.now());
  await page.getByRole('button',{name:'确认清除本机资料',exact:true}).click();await expect(page.getByText('本机资料已清除。重新打开应用可开始使用空资料库。',{exact:true})).toBeVisible({timeout:15_000});
  const clearMs=await page.evaluate(start=>performance.now()-start,clearStart);expect(clearMs).toBeLessThan(15_000);
  await page.getByRole('button',{name:'重新打开应用',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(Object.values(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).every(rows=>rows.length===0)).toBe(true);
  const measurement={meanings:10_000,fixtureJsonBytes:fixtureBytes,media:0,learningHistory:0,previewMs,clearMs,browser:'Chromium OPFS persistent profile',cpu:cpus()[0]?.model,network:'loopback fixture setup; preview/clear are local',scope:'synthetic confirmed text Meaning/Registry facts; one destructive clear, not p95, physical file reclamation or heavy Learning/Media capacity'};
  console.info('LJ19 local clear capacity:',JSON.stringify(measurement));const evidence=testInfo.outputPath('local-clear-capacity.json');await writeFile(evidence,JSON.stringify(measurement));await testInfo.attach('local-clear-capacity',{contentType:'application/json',path:evidence});completed=true;
 }finally{semanticScaleFixture=undefined;await context.close();if(completed)await rm(profile,{recursive:true,force:true});else await testInfo.attach('retained-clear-profile',{contentType:'text/plain',body:profile});}
});

test('the shipped account deletion verifies a magic link without deleting and clears only after explicit confirmation',async({page,context})=>{
 cloudManifest=null;cloudRevision=0;cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(origin);await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:session()});await page.goto(origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());let deletionCalls=0,otpInput:any;
 await context.route('**/auth/v1/otp*',async route=>{otpInput=route.request().postDataJSON();await route.fulfill({json:{}});});
 await context.route('**/auth/v1/token*',route=>route.fulfill({json:session()}));await context.route('**/auth/v1/logout*',route=>route.fulfill({status:204}));
 await context.route('**/sensa/account/deletion',async route=>{deletionCalls++;await route.fulfill({json:{state:'deleted',operationId:route.request().postDataJSON().operationId}});});
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'删除账号',exact:true}).click();await expect(page.getByText(/删除后不能再用原账号恢复备份/)).toBeVisible();
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'发送删除验证邮件',exact:true}).click();await expect(page.getByText(/登录邮件已发送/)).toBeVisible();expect(otpInput.create_user).toBe(false);
 const receipt=await page.evaluate(()=>JSON.parse(localStorage.getItem('sensa:account-deletion')!));expect(receipt.phase).toBe('verifying');expect(otpInput.code_challenge).toBeTruthy();
 await page.goto(origin+'/profile?error=access_denied&error_code=otp_expired&error_description=synthetic');await expect(page.getByRole('alert')).toHaveText(/登录链接已失效/);await expect(page).toHaveURL(origin+'/profile');expect(deletionCalls).toBe(0);
 await page.goto(origin+'/profile?code=synthetic-fresh-deletion-code');await expect(page.getByRole('status')).toHaveText('已验证邮箱。请再次确认后删除账号。');expect(deletionCalls).toBe(0);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(before);
 const erase=page.getByRole('button',{name:'验证并删除账号',exact:true});await expect(erase).toBeDisabled();await page.getByRole('checkbox').check();await erase.click();await expect(page.getByRole('status')).toHaveText('账号已删除，当前浏览器资料已清除。');expect(deletionCalls).toBe(1);
 await page.getByRole('button',{name:'返回登录',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('sensa:account-deletion'))).toBeNull();
 await page.reload();await expect(page.locator('#s-profile')).toBeVisible();expect(Object.values(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).every(rows=>rows.length===0)).toBe(true);
});

test('the shipped deletion recovers a lost response through the same receipt after reload',async({page,context})=>{
 cloudManifest=null;cloudRevision=0;cloudBlocks.clear();await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(origin);await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:session()});await page.goto(origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,1));
 await context.route('**/auth/v1/otp*',route=>route.fulfill({json:{}}));await context.route('**/auth/v1/verify',route=>route.fulfill({json:session()}));await context.route('**/auth/v1/logout*',route=>route.fulfill({status:204}));
 let operationId='',calls=0;await context.route('**/sensa/account/deletion',async route=>{calls++;operationId=route.request().postDataJSON().operationId;await route.abort('failed');});
 await context.route('**/sensa/account/deletion/status',async route=>{expect(route.request().postDataJSON().operationId).toBe(operationId);await route.fulfill({json:{state:'deletion_pending',operationId}});});
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'删除账号',exact:true}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'发送删除验证邮件',exact:true}).click();await page.getByRole('button',{name:'邮件中有验证码？',exact:true}).click();await page.getByLabel('邮箱验证码', {exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();await expect(page.getByRole('status')).toHaveText('已验证邮箱。请再次确认后删除账号。');
 await page.getByRole('button',{name:'验证并删除账号',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'检查删除进度',exact:true})).toBeVisible();await page.getByRole('button',{name:'检查删除进度',exact:true}).click();await expect(page.getByRole('status')).toHaveText(/账号访问已停止/);expect(calls).toBe(1);
 await page.getByRole('button',{name:'暂时离开',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();expect(Object.values(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).every(rows=>rows.length===0)).toBe(true);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sensa:account-deletion')!).operationId)).toBe(operationId);
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'检查删除进度',exact:true}).click();await expect(page.getByRole('button',{name:'检查删除进度',exact:true})).toBeVisible();
 await context.route('**/sensa/account/deletion/status',route=>route.fulfill({json:{state:'deleted',operationId}}));await page.getByRole('button',{name:'检查删除进度',exact:true}).click();await expect(page.getByRole('status')).toContainText('账号已删除');expect(calls).toBe(1);await page.getByRole('button',{name:'返回登录',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('sensa:account-deletion'))).toBeNull();
});

test('the shipped account pages clear only this browser and offline reload stays empty until explicit sync',async({page,context},testInfo)=>{
 cloudManifest=null;cloudRevision=0;cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(origin);await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:session()});
 await page.goto(origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,1));
 const runtime=await startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
 await page.goto(origin+'/profile');await page.locator('#settings-data').click();await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已同步到账号'})).toBeVisible();
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest()),original=(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity;
 expect(original).toBeTruthy();const cloudBefore={revision:cloudRevision,manifest:cloudManifest,blocks:[...cloudBlocks]};
 await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 await page.locator('#settings-storage').click();await page.getByRole('button',{name:'检查要清除的资料',exact:true}).click();
 await expect(page.locator('[data-local-clear-sync]')).toHaveCount(0);await page.getByLabel('我已保存需要的备份，确认清除以上本机资料。').check();
 await page.getByRole('button',{name:'确认清除本机资料',exact:true}).click();await expect(page.getByText('本机资料已清除。重新打开应用可开始使用空资料库。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重新打开应用',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();
 const cleared=(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity as {id:string;deviceId:string};expect(cleared.id).not.toBe((original as {id:string}).id);
 const empty=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());expect(Object.values(empty).every(rows=>rows.length===0)).toBe(true);
 let requests=0;context.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/sensa/library-sync/'))requests++;});
 await context.setOffline(true);
 try{await page.reload();await expect(page.locator('#s-profile')).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(empty);}finally{await context.setOffline(false);}
 await page.reload();await expect(page.locator('#s-profile')).toBeVisible();await page.locator('#settings-data').click();await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();
 expect(requests).toBe(0);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(empty);expect({revision:cloudRevision,manifest:cloudManifest,blocks:[...cloudBlocks]}).toEqual(cloudBefore);
 await page.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
 await page.reload();await expect(page.locator('#s-profile')).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toEqual({...original as object,deviceId:cleared.deviceId});expect(requests).toBeGreaterThan(0);
 await testInfo.attach('local-clear-journey',{contentType:'application/json',body:JSON.stringify({scope:'shipped AccountExperience/ProfileScreen, genuine learning rating, private Draft image, accepted synthetic Meaning, OPFS and native offline reload; controlled Auth/HTTP',original,cleared,paidCalls:0})});
});

test('a signed-out owner can explicitly discard pending local content without reconnecting its account',async({page,context})=>{
 cloudManifest=null;cloudRevision=0;cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(origin);await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:session()});
 await page.goto(origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 const runtime=await startOrdinaryBook(page);await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:/已经连上/}).click();
 await expect.poll(async()=>(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).records.length).toBe(1);
 await page.goto(origin+'/profile');const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 await page.route('**/auth/v1/logout*',route=>route.fulfill({status:204}));
 await page.locator('#settings-security').click();await page.getByRole('button',{name:'退出账号',exact:true}).click();
 await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),storageKey)).toBeNull();await page.goto(origin+'/profile');
 // Completion may checkpoint earlier facts. This genuine local save occurs
 // after logout, so the pending branch cannot depend on scheduler timing.
 await page.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,1));
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.locator('#settings-data').click();await page.locator('#settings-storage').click();
 await page.getByRole('button',{name:'检查要清除的资料',exact:true}).click();await expect(page.locator('[data-local-clear-sync]')).toHaveAttribute('data-local-clear-sync','unavailable');
 await expect(page.getByRole('button',{name:'立即同步',exact:true})).toBeDisabled();
 const erase=page.getByRole('button',{name:'确认清除本机资料',exact:true});await expect(erase).toBeDisabled();
 await page.getByLabel('我已保存需要的备份，确认清除以上本机资料。').check();await expect(erase).toBeDisabled();
 await page.getByLabel(/丢弃这个浏览器中的 .* 项未同步账号修改/).check();await expect(erase).toBeEnabled();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 const cloudBefore={revision:cloudRevision,manifest:cloudManifest,blocks:[...cloudBlocks]};
 const metadata=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true)),epoch=metadata.meta!.find(row=>row.key==='service-signout-epoch');
 await erase.click();await expect(page.getByText('本机资料已清除。重新打开应用可开始使用空资料库。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重新打开应用',exact:true}).click();await expect(page.locator('#s-profile')).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).not.toEqual(before.identity);
 const cleared=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());expect(Object.values(cleared).every(rows=>rows.length===0)).toBe(true);
 const after=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest(true));expect(after.meta!.find(row=>row.key==='signed-out')?.value).toEqual(['boolean',true]);expect(after.meta!.find(row=>row.key==='service-signout-epoch')).toEqual(epoch);
 await page.reload();await expect(page.locator('#s-profile')).toBeVisible();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(cleared);
 expect({revision:cloudRevision,manifest:cloudManifest,blocks:[...cloudBlocks]}).toEqual(cloudBefore);expect(await page.evaluate(key=>localStorage.getItem(key),storageKey)).toBeNull();
});

test('a signed-out library opens locally while an expired cached token is stuck refreshing',async({page,context})=>{
 cloudManifest=null;cloudRevision=0;cloudBlocks.clear();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:storageKey,value:session()});
 await page.goto(origin+'/profile');await expect(page.locator('#s-profile')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load());
 const facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest());
 await page.evaluate(()=>window.__sensaBrowserSmoke!.holdNextAccountSignoutForTest());await page.locator('#settings-security').click();await page.getByRole('button',{name:'退出账号',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.accountSignoutWaitingForTest())).toBe(true);
 let resume!:()=>void,refreshRequests=0;const paused=new Promise<void>(resolve=>{resume=resolve;});
 await context.route('**/auth/v1/token*',async route=>{refreshRequests++;await paused;await route.fulfill({status:400,json:{error:'invalid_grant',error_description:'synthetic expired refresh'}});});
 const expired={...session(),access_token:jwt(-3600),expires_at:Math.floor(Date.now()/1000)-3600};await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:expired});
 const reopened=await context.newPage();
 try{
  await reopened.goto(origin+'/content');await expect.poll(()=>refreshRequests).toBeGreaterThan(0);
  await expect(reopened.locator('.sensa-world-row').first()).toBeVisible();await reopened.locator('.sensa-world-row').first().click();await expect(reopened.getByText('Private source: May asked to borrow an umbrella.',{exact:true}).first()).toBeVisible();
  expect(await reopened.evaluate(()=>window.__sensaBrowserSmoke!.durableBackupFactsForTest())).toEqual(facts);
 }finally{resume();await page.evaluate(()=>window.__sensaBrowserSmoke!.releaseAccountSignoutForTest());await reopened.close();}
});

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
test('an empty signed-in device keeps account data unknown after http-error preflight and explicitly retries',emptySignedInPreflightRetry('http-error'));
test('an empty signed-in device keeps account data unknown after network-error preflight and explicitly retries',emptySignedInPreflightRetry('network-error'));

test('a saved normalized personal Meaning remains usable when optional account preflight fails',async({page,context})=>{
 test.setTimeout(90_000);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.locator('#s-home')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
 expect(await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load())).toBe(1);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.localReplicaContentPresentForTest())).toBe(true);
 const bootstrap=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 expect(bootstrap.identity).not.toBeNull();
 await context.route(apiOrigin+'/sensa/library-sync/head',route=>route.fulfill({status:503,json:{code:'fixture_preflight_unavailable'}}));
 await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:session()});await page.reload();
 await expect.poll(()=>page.evaluate(()=>!!window.__sensaBrowserSmoke)).toBe(true);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).toEqual(bootstrap);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.localReplicaContentPresentForTest())).toBe(true);
 await expect(page.locator('#s-home')).toBeVisible();await expect(page.locator('#s-home').getByRole('button',{name:'重试恢复',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'我的语义世界',exact:true}).first().click();await expect(page.locator('.sensa-world-row')).toHaveCount(1);
 await page.locator('.sensa-world-row').first().click();await expect(page.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
});

test('an annotation-only local library remains usable when optional account preflight fails',async({page,context})=>{
 test.setTimeout(90_000);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();await expect(page.locator('#s-home')).toBeVisible();
 const bookmark=await page.evaluate(()=>window.__sensaBrowserSmoke!.retainExampleForTest(true));
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
 await context.route(apiOrigin+'/sensa/library-sync/head',route=>route.fulfill({status:503,json:{code:'fixture_preflight_unavailable'}}));
 await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:session()});await page.reload();
 await expect(page.locator('#s-home')).toBeVisible();await expect(page.getByRole('button',{name:'重试恢复',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'我的语义世界',exact:true}).first().click();await expect(page.getByRole('button',{name:'重试恢复',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.retainedExampleIdsForTest())).toEqual([bookmark.exampleId]);
});

test('initial sync failure after admission actually reruns sync on the restoration retry',async({page,context})=>{
 test.setTimeout(90_000);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:session()});
 let failSync=true,heads=0;
 await context.route(apiOrigin+'/sensa/library-sync/head',route=>{
  heads++;
  // Admission sees nonempty remote data, but the actual sync fails before fetching it.
  // A later confirmed empty head exercises manual retry, not cloud payload restoration.
  if(heads===1)return route.fulfill({json:{revision:1,manifest:['0'.repeat(64)]}});
  return !failSync?route.fulfill({json:{revision:2,manifest:null}}):route.fulfill({json:{revision:'invalid controlled head',manifest:null}});
 });
 await page.goto(origin);await expect(page.getByRole('button',{name:'重试恢复',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus())).toBe('failed');
 const failedHeads=heads;failSync=false;await page.getByRole('button',{name:'重试恢复',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__sensaBrowserSmoke!.syncStatus())).toBe('synced');
 await expect(page.getByRole('heading',{name:'暂无可开始的学习',exact:true})).toBeVisible();expect(heads).toBeGreaterThan(failedHeads);
});

test('explicit fresh start uses a separate OPFS pool, fences old tabs, and preserves the old files and facts',async({page,context},testInfo)=>{
 test.setTimeout(90_000);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.locator('#s-home')).toBeVisible();
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
 expect(await page.evaluate(state=>window.__sensaBrowserSmoke!.seedSemanticWorld(state),await repository.load())).toBe(1);
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 const oldTab=await context.newPage();await oldTab.goto(origin+'/content');await expect(oldTab.locator('.sensa-world-row').first()).toBeVisible();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.removeLibraryIdentityForRecoveryTest());await page.reload();
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重新开始',exact:true}).click();await expect(page.getByText(/旧文件会保留/u)).toBeVisible();
 await testInfo.attach('explicit-fresh-start-confirmation',{body:await page.screenshot(),contentType:'image/png'});
 await page.getByRole('button',{name:'取消',exact:true}).click();
 expect(await page.evaluate(()=>localStorage.getItem('sensa:local-library-selection:v1'))).toBeNull();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
 await page.getByRole('button',{name:'重新开始',exact:true}).click();
 await page.getByRole('button',{name:'确认创建新本机库',exact:true}).click();await expect(page.locator('#s-home')).toBeVisible();
 const binding=await page.evaluate(()=>JSON.parse(localStorage.getItem('sensa:local-library-selection:v1')!)) as {namespace:string;preservedNamespaces:unknown[]};
 expect(binding.namespace).toMatch(/^[0-9a-f-]{36}$/u);expect(binding.preservedNamespaces).toEqual([null]);
 const after=await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest());
 expect((after.identity as {id:string}).id).not.toBe((before.identity as {id:string}).id);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
 await expect(oldTab.locator('[data-sensa-version-guard="selection"]')).toBeVisible();
 const staleRead=await oldTab.evaluate(async()=>{try{await window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest();return 'unexpected success';}catch(cause){return cause instanceof Error?cause.message:String(cause);}});
 expect(staleRead).toBe('localFlow.libraryReplaced');await oldTab.close();
 const digestOldFiles=()=>page.evaluate(async()=>{
  const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('sensa-local-library-v12'),opaque=await directory.getDirectoryHandle('.opaque');
  const rows:Array<{name:string;bytes:number;sha256:string}>=[];
  for await(const [name,entry] of (opaque as FileSystemDirectoryHandle&{entries:()=>AsyncIterableIterator<[string,FileSystemHandle]>}).entries()){
   if(entry.kind!=='file')continue;const bytes=await (await (entry as FileSystemFileHandle).getFile()).arrayBuffer(),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
   rows.push({name,bytes:bytes.byteLength,sha256:Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('')});
  }
  return rows.sort((a,b)=>a.name.localeCompare(b.name));
 });
 const oldFiles=await digestOldFiles();expect(oldFiles.length).toBeGreaterThan(0);expect(oldFiles.some(row=>row.bytes>4096)).toBe(true);
 const newPool=`sensa-local-library-v12-${binding.namespace}`;
 expect(await page.evaluate(async name=>{await (await navigator.storage.getDirectory()).getDirectoryHandle(name);return true;},newPool)).toBe(true);
 await page.reload();await expect(page.locator('#s-home')).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toEqual(after.identity);
 expect(await digestOldFiles()).toEqual(oldFiles);
 // Only the isolated synthetic profile is pointed back for a retained-fact check.
 await page.evaluate(async()=>{await window.__sensaBrowserSmoke!.closeLibraryStorageForRecoveryTest();localStorage.removeItem('sensa:local-library-selection:v1');});
 await page.reload();await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(1);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).creationReceipt).toEqual(before.creationReceipt);
});

test('a damaged device selection opens recovery and explicit fresh start retains the damaged pointer',async({page})=>{
 test.setTimeout(60_000);
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(origin);
 await page.evaluate(()=>localStorage.setItem('sensa:local-library-selection:v1','{isolated broken pointer'));await page.reload();
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重新开始',exact:true}).click();
 await Promise.all([page.waitForEvent('domcontentloaded'),page.getByRole('button',{name:'确认创建新本机库',exact:true}).click()]);
 await expect(page.locator('#s-home')).toBeVisible();
 const original=await page.evaluate(()=>{const binding=JSON.parse(localStorage.getItem('sensa:local-library-selection:v1')!);return localStorage.getItem(binding.unreadableSelectionKey);});
 expect(original).toBe('{isolated broken pointer');
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toBeTruthy();
});

test.describe('new-pool failure exit',()=>{
test.use({serviceWorkers:'block'});
test('the first new-pool startup failure stays in recovery and reopening retries the same selected pool',async({page,context})=>{
 test.setTimeout(90_000);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.locator('#s-home')).toBeVisible();
 await page.evaluate(()=>window.__sensaBrowserSmoke!.removeLibraryIdentityForRecoveryTest());await page.reload();
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 // Controlled Worker denial tests the UI failure exit, not native OPFS corruption.
 let denyNewPool=true,denials=0;
 await context.route('**/assets/sqliteWorker-*.js',route=>{if(!denyNewPool)return route.continue();denials++;return route.fulfill({contentType:'text/javascript',body:`self.onmessage=event=>{const request=event.data;self.postMessage(request.kind==='close'?{id:request.id,ok:true,value:null}:{id:request.id,ok:false,error:'sqlite_fixture_startup_denied'});};`});});
 await page.getByRole('button',{name:'重新开始',exact:true}).click();
 await Promise.all([page.waitForEvent('domcontentloaded'),page.getByRole('button',{name:'确认创建新本机库',exact:true}).click()]);
 await expect(page.getByRole('heading',{name:'恢复本机资料',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'重新开始',exact:true})).toBeVisible();
 expect(denials).toBeGreaterThan(0);
 const namespace=await page.evaluate(()=>JSON.parse(localStorage.getItem('sensa:local-library-selection:v1')!).namespace) as string;
 expect(await page.evaluate(namespace=>localStorage.getItem('sensa:local-library-present:v1:'+namespace),namespace)).toBeNull();
 denyNewPool=false;await page.getByRole('button',{name:/重新打开/u}).click();await expect(page.locator('#s-home')).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sensa:local-library-selection:v1')!).namespace)).toBe(namespace);
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.libraryBootstrapFactsForTest())).identity).toBeTruthy();
});
});

test('delivered listening preserves learner facts and provider layout after another tab changes Route',async({page,context})=>{
 setRegistry([referenceDelivery.descriptor]);await page.route('**/sensa/model/turn',route=>route.fulfill({status:503,json:{code:'fixture_model_unavailable'}}));
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
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await page.locator('#s-home').getByRole('button',{name:'学习包目录',exact:true}).click();await page.locator('#s-catalog').last().getByRole('button',{name:/只读查词样本/}).click();
 const book=page.locator('#s-catalog-book').last();await book.getByRole('button',{name:'下载学习包',exact:true}).click();await expect(book.getByText('已下载',{exact:true})).toBeVisible();
 expect((await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).targetIds).toEqual([]);
 await page.goto(origin+'/academy');const practice=page.locator('#s-academy');
 const start=practice.locator('.sensa-practice-activities').getByRole('button').first();await expect(start).toBeEnabled();await start.click();
 const listening=page.locator('#s-real-world-listening');await expect(listening.getByRole('button',{name:'播放',exact:true})).toBeEnabled();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest()),checkpoint=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
 const stored=await page.evaluate(()=>window.__sensaBrowserSmoke!.curriculumSourceCheckpointForTest()),arrangement=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest());
 const peer=await context.newPage();await peer.goto(origin+'/profile');await peer.locator('#settings-preferences').click();await peer.locator('#account-languages').click();
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
 const location=page.url(),skip=listening.getByRole('link',{name:'跳到播放控制',exact:true});await skip.focus();await skip.press('Enter');await expect(listening.getByRole('group',{name:'播放',exact:true})).toBeFocused();expect(page.url()).toBe(location);
 await page.keyboard.press('Tab');await expect(listening.getByRole('button',{name:'上一段',exact:true})).toBeFocused();
 await listening.locator('header').getByRole('button').click();await expect(practice).toBeVisible();
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount())).toBe(0);await peer.close();
});

test('reference lookup, manual search and example return preserve the same real learning Step and stored learner facts',async({page})=>{
 setRegistry([referenceDelivery.descriptor]);const sources=await referenceProviders(page),runtime=await startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:/查看表达/}).click();
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
 setRegistry([referenceDelivery.descriptor]);const sources=await referenceProviders(page),runtime=await startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:/查看表达/}).click();
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
 setRegistry([referenceDelivery.descriptor]);const sources=await referenceProviders(page),runtime=await startOrdinaryBook(page,/只读查词样本/);
 await runtime.locator('[data-learning-more]').click();await expect(page.locator('#menu-more').getByRole('button',{name:'内容来源',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');
 await runtime.getByRole('button',{name:/查看表达/}).click();
 await expect(runtime.getByRole('button',{name:'查词：borrow',exact:true})).toBeVisible();const original=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());
 const preferences=await context.newPage();await preferences.goto(origin+'/profile');await preferences.locator('#settings-preferences').click();await preferences.locator('#account-languages').click();
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
 setRegistry([referenceDelivery.descriptor]);const sources=await referenceProviders(page),runtime=await startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:/查看表达/}).click();
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
 setRegistry([referenceDelivery.descriptor]);const runtime=await startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());await page.goto(`${origin}/catalog`);
 await page.locator('#s-catalog').last().getByRole('button',{name:/只读查词样本/}).click();const book=page.locator('#s-catalog-book').last();
 await book.getByRole('button',{name:/borrow/}).click();const target=page.locator('#s-learning-target');
 await expect(target.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();const targetId=new URL(page.url()).searchParams.get('targetId');
 await target.getByRole('button',{name:/内容来源/}).click();const source=page.locator('#s-library-package');
 await expect(source.getByRole('heading',{name:'只读查词样本',exact:true})).toBeVisible();await expect(source.getByRole('button',{name:/borrow/})).toBeVisible();
 await source.getByRole('button',{name:'返回',exact:true}).click();await expect(target.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('targetId')).toBe(targetId);
 expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
});

test('missing source cache stays unavailable offline and returning preserves the revealed learning Step without recovery writes',async({page,context})=>{
 setRegistry([referenceDelivery.descriptor]);const runtime=await startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:/查看表达/}).click();
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
 setRegistry([referenceDelivery.descriptor]);const runtime=await startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:/查看表达/}).click();await expect(runtime.getByRole('button',{name:'查词：borrow',exact:true})).toBeVisible();
 // Native Chromium transport errors rather than synthetic HTTP status errors.
 const transportFailures:string[]=[];page.on('requestfailed',request=>{if(['api.wiktapi.dev','api.dictionaryapi.dev','en.wiktionary.org'].includes(new URL(request.url()).hostname)&&request.failure()?.errorText.includes('ERR_INTERNET_DISCONNECTED'))transportFailures.push(request.url());});
 await page.route('**/sensa/model/turn',route=>route.fulfill({status:503,json:{code:'fixture_model_unavailable'}}));
 const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),facts=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest());await context.setOffline(true);
 try{
  await runtime.getByRole('button',{name:'查词：borrow',exact:true}).click();const quick=page.getByRole('dialog',{name:/borrow/u});await expect(quick.getByRole('status')).toContainText('暂时没有取得');await expect(quick.getByRole('button',{name:'查看详细释义',exact:true})).toBeDisabled();
  await quick.getByRole('button',{name:'关闭快速查词',exact:true}).click();
  await context.setOffline(false);const sources=await referenceProviders(page);
  await runtime.getByRole('button',{name:'查词：borrow',exact:true}).click();await expect(quick.getByText('Fixture definition for borrow.')).toBeVisible();await quick.getByRole('button',{name:'查看详细释义',exact:true}).click();
  const dictionary=page.locator('#s-reference-dictionary');await expect(dictionary.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
  await page.unroute('https://api.wiktapi.dev/**');await page.unroute('https://api.dictionaryapi.dev/**');await page.unroute('https://en.wiktionary.org/**');await context.setOffline(true);
  await dictionary.getByRole('searchbox').fill('anchor');await dictionary.getByRole('button',{name:'搜索',exact:true}).click();await expect(dictionary.getByRole('status')).toContainText('词典服务暂时不可用');await expect(dictionary.getByRole('heading',{name:'anchor',exact:true})).toHaveCount(0);
  expect(transportFailures.some(url=>url.includes('anchor')),'native transport failure reaches the actual dictionary host').toBe(true);
  await context.setOffline(false);await referenceProviders(page);await dictionary.getByRole('button',{name:'搜索',exact:true}).click();await expect(dictionary.getByRole('heading',{name:'anchor',exact:true})).toBeVisible();
  await dictionary.getByRole('button',{name:'返回上一页',exact:true}).click();await expect(runtime.getByRole('button',{name:'查词：borrow',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningSettlementFactsForTest())).toEqual(facts);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);expect(sources.requests.some(url=>url.includes('/word/borrow/definitions'))).toBe(true);
 }finally{await context.setOffline(false);}
});

test('target source lookup keeps its exact publication when another Book shares the member and a newer edition is installed',async({page,context})=>{
 const first=reviewDelivery,files=unzipSync(first.bookBytes);
 const sharedManifest=sensaPortableBookManifestSchema.parse({...first.manifest,book:{...first.manifest.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:'reference-shared-source',title:'另一册来源'},members:[...first.manifest.members].reverse()});
 const nextManifest=sensaPortableBookManifestSchema.parse({...first.manifest,book:{...first.manifest.book,bookVersionId:randomUUID(),versionNumber:2,title:'新版来源'},contentRelease:{...first.manifest.contentRelease,contentReleaseId:randomUUID(),versionNumber:2}});
 const release=(manifest:typeof first.manifest)=>{
  const bytes=zipSync({...files,'book.json':new TextEncoder().encode(JSON.stringify(manifest))}),sha256=createHash('sha256').update(bytes).digest('hex');
  const descriptor={...first.descriptor,book:manifest.book,contentRelease:manifest.contentRelease,sha256,byteLength:bytes.byteLength,url:`${origin}/published/${sha256}.sensa-book`};
  first.responses.set(descriptor.url,bytes);return descriptor;
 };
 const shared=release(sharedManifest),next=release(nextManifest);
 setRegistry([shared,first.descriptor]);
 try{
  const runtime=await startOrdinaryBook(page,/到期复习样本/);await runtime.getByRole('button',{name:'暂停',exact:true}).click();
  const checkpoint=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),targetId=checkpoint.runtime!.targetId;
  await page.goto(`${origin}/catalog`);const catalog=page.locator('#s-catalog').last(),book=page.locator('#s-catalog-book').last();
  await catalog.getByRole('button',{name:/另一册来源/}).click();await book.getByRole('button',{name:'下载学习包',exact:true}).click();await expect(book.getByRole('button',{name:'加入学习',exact:true})).toBeEnabled();
  const verifySource=async(offline=false)=>{
   await page.goto(`${origin}/study/learning-target?targetId=${targetId}`);const target=page.locator('#s-learning-target');
   await expect(target.getByRole('button',{name:/内容来源/})).toBeVisible();const before=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
   if(offline)await context.setOffline(true);
   try{
   await target.getByRole('button',{name:/内容来源/}).click();const source=page.locator('#s-library-package');
   await expect(source.getByRole('heading',{name:first.manifest.book.title,exact:true})).toBeVisible();
   await expect(source.getByText(/v1/u)).toBeVisible();await expect(source.getByRole('button',{name:/加入学习|应用更新|下载更新/u})).toHaveCount(0);
   await source.getByRole('button',{name:'返回',exact:true}).click();await expect(target.getByRole('button',{name:/内容来源/})).toBeVisible();expect(new URL(page.url()).searchParams.get('targetId')).toBe(targetId);
   expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(before);
   }finally{if(offline)await context.setOffline(false);}
  };
  await verifySource();
  setRegistry([shared,next]);await page.goto(`${origin}/catalog`);await catalog.getByRole('button',{name:'刷新',exact:true}).click();await expect(catalog.getByRole('button',{name:/新版来源/})).toBeVisible();
  await catalog.getByRole('button',{name:/新版来源/}).click();await book.getByRole('button',{name:'下载更新',exact:true}).click();await expect(book.getByRole('button',{name:'应用更新',exact:true})).toBeEnabled();
  await verifySource(true);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(checkpoint);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.semanticMeaningCountForTest())).toBe(0);
 }finally{first.responses.delete(shared.url);first.responses.delete(next.url);}
});

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

test('personal learning scene updates remain explicit while stale editors preserve drafts and annotation read retry restores owned scenes',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});
 const providers:string[]=[];page.on('request',request=>{if(/\/model\/|chat\/completions|\/speech\//.test(request.url()))providers.push(request.url());});
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
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

test('practice content selection and listening start stay bounded with 10000 personal Meanings',async({page,context,browser},testInfo)=>{
 // Bulk fixture construction is outside the interaction budget below.
 test.setTimeout(300_000);
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
 semanticScaleFixture=syntheticSemanticWorld(await repository.load(),10_000);setRegistry([referenceDelivery.descriptor]);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.route('https://youglish.com/public/emb/widget.js',route=>route.fulfill({contentType:'text/javascript',body:`
 window.YG={Widget:class{
  constructor(id,options){this.events=options.events;}
  fetch(){queueMicrotask(()=>{this.events.onFetchDone({totalResult:2});this.events.onPlayerReady();this.events.onPlayerStateChange({state:2});});}
  pause(){}close(){}play(){this.events.onPlayerStateChange({state:1});}next(){}previous(){}replay(){}move(){}setSpeed(speed){this.events.onSpeedChange({speed});}
 }};window.onYouglishAPIReady();
 `}));
 await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 await expect(page.locator('#s-home')).toBeVisible();
 expect(await page.evaluate(async()=>window.__sensaBrowserSmoke!.seedSemanticWorld(await(await fetch('/semantic-scale-fixture')).json()))).toBe(10_000);
 const runtime=await startOrdinaryBook(page,/只读查词样本/);await runtime.getByRole('button',{name:'暂停',exact:true}).click();
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
  const report={platform:process.platform,arch:process.arch,cpuModel:cpus()[0]?.model??'unknown',browser:browser.version(),cpuThrottle:1,network:'loopback',provider:'controlled SDK; no online media',personalMeanings:10_000,senses:semanticScaleFixture.registry.senses.length,fixtureBytes:Buffer.byteLength(JSON.stringify(semanticScaleFixture)),media:'text-only personal data; one small compiled Book',budgetMs:1500,timings};
  console.log('LJ-15 practice / synthetic 10k personal Meanings / Chromium+OPFS / 1x CPU / loopback / no model:',JSON.stringify(report));
  await testInfo.attach('practice-capacity-10000.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});
 }
 expect(timings).toHaveLength(7);
 for(const timing of timings){expect(timing.elapsedMs).toBeGreaterThanOrEqual(0);expect(timing.elapsedMs,`${timing.action}: local interaction budget, not provider latency`).toBeLessThan(1500);}
});

test('explicit personal scene acceptance and update stay bounded with 10000 unrelated Meanings',async({preparedScenePage:page},testInfo)=>{
 await page.goto(`${origin}/content`);
 await expect(page.locator('.sensa-world.active').last().locator('.sensa-world-row').first()).toBeVisible();
 const runtime=await startOrdinaryBook(page),editor=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'我的场景',exact:true})});
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
 for(const timing of timings){expect(timing.elapsedMs).toBeLessThan(1500);expect(timing.phases.filter(phase=>['sensa.journey.records','sensa.journey.authority'].includes(phase.name))).toEqual([]);}
});

test('a personal scene and its separate accepted revision survive actual persistent Chromium close and reopen',async({},testInfo)=>{
 const profile=testInfo.outputPath('scene-persistent-profile');await mkdir(profile,{recursive:true});
 const options={headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH,locale:'zh-CN',viewport:{width:390,height:844}};
 let context=await chromium.launchPersistentContext(profile,options);
 try{
  let page=context.pages()[0]!;await page.goto(origin);await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
  let runtime=await startOrdinaryBook(page);
  const first='关闭浏览器之前明确保存的借伞经历。',later='稍后在学习页编辑，但还没有更新到长期意义。';
  const edit=async(body:string)=>{await runtime.getByRole('button',{name:/^(添加|编辑)我的场景$/}).click();const editor=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'我的场景',exact:true})});await editor.getByRole('textbox').fill(body);await editor.getByRole('button',{name:'保存我的场景',exact:true}).click();await expect(editor).toHaveCount(0);};
  await edit(first);await runtime.getByRole('button',{name:/查看表达/}).click();await runtime.getByRole('button',{name:'存入我的语义世界',exact:true}).click();await expect(runtime.getByRole('button',{name:'已存入我的语义世界',exact:true})).toBeVisible();
  await edit(later);await expect(runtime.getByRole('button',{name:'更新到我的语义世界',exact:true})).toBeEnabled();
  const scenes=await page.evaluate(()=>window.__sensaBrowserSmoke!.personalLearningScenesForTest()),learning=await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),meaningId=scenes[0]!.acceptedPersonalMeaningId;
  await context.close();context=await chromium.launchPersistentContext(profile,options);page=context.pages()[0]!;
  await page.goto(origin);await page.locator('#s-home').getByRole('button',{name:'继续学习',exact:true}).click();runtime=page.locator('#s-lightweight-runtime');await expect(runtime.getByRole('heading',{name:'borrow',exact:true})).toBeVisible();
  await expect(runtime.getByRole('button',{name:'更新到我的语义世界',exact:true})).toBeEnabled();expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.personalLearningScenesForTest())).toEqual(scenes);expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toEqual(learning);
  await runtime.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的语义世界',exact:true}).click();await page.getByRole('button',{name:/borrow/}).click();
  expect(new URL(page.url()).searchParams.get('meaningId')).toBe(meaningId);await expect(page.getByText(first,{exact:true}).first()).toBeVisible();await expect(page.getByText(later,{exact:true})).toHaveCount(0);
 }finally{await context.close();}
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
