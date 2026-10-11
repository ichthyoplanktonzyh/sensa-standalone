/** Real Chromium/OPFS capacity baselines for structurally large, low-media Books. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {arch,cpus,platform,release} from 'node:os';
import {extname,join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {expect,test} from '@playwright/test';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {cors} from 'hono/cors';
import {canonicalConsumerJson,maxPortableBookArchiveBytes} from '@sensa/contracts/sensa';
import {stableUuid} from '@sensa/learning-kernel';
import {localSensaCorsOptions} from '../../../scripts/local/localCors.mts';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';

const root=process.cwd();
const output=resolve(root,'.tmp/portable-book-capacity');
const dist=join(output,'dist');
const evidenceDirectory=resolve(root,'.tmp/portable-book-capacity-evidence');
const subject='07bb6e9d-cf3c-4b91-9cf1-b50000005001';
const account='07bb6e9d-cf3c-4b91-9cf1-b50000005002';
const defaultStageWaitMs=120_000;
const maxDownloadToWorkerWaitMs=150_000;
const maxWorkerValidationWaitMs=150_000;
// CI's 5k baseline took 86s; the 135s guard cut the 10k sample off while
// still saving. Observe completion within a finite window on slower hosts,
// retaining actual timings/long tasks, not declaring an installation UX pass.
const maxAtomicInstallWaitMs=300_000;
const maxInstalledFactReadMs=180_000;
const maxJourneyMs=15*60_000;
const types:Record<string,string>={
  '.css':'text/css','.html':'text/html','.ico':'image/x-icon','.js':'text/javascript',
  '.json':'application/json','.mjs':'text/javascript','.mp3':'audio/mpeg',
  '.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm','.woff2':'font/woff2',
};

let server:Server;
let apiServer:Server;
let origin='';
let apiOrigin='';
let storageKey='';
let activeDelivery:ReturnType<typeof portableBookDeliveryFixture>|null=null;
let registry:unknown;
let cloudRevision=0;
let cloudManifest:string[]|null=null;
const cloudBlocks=new Map<string,string>();
let deliveredBytes=0;
let deliveryRequests=0;

const setRegistry=(descriptor:ReturnType<typeof portableBookDeliveryFixture>['descriptor'])=>{
  const snapshot={format:'sensa-learning-content-registry-v3' as const,publishedAt:'2026-09-28T00:00:00Z',items:[descriptor]};
  registry={...snapshot,revision:createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex')};
};

const jwt=(expiresInSeconds:number)=>{
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    encode({alg:'HS256',typ:'JWT'}),
    encode({
      sub:subject,aud:'authenticated',email:'capacity@sensa.invalid',
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
    id:subject,aud:'authenticated',role:'authenticated',email:'capacity@sensa.invalid',
    app_metadata:{},user_metadata:{},identities:[],created_at:new Date().toISOString(),
  },
});

test.setTimeout(maxJourneyMs);
test.use({viewport:{width:1280,height:900},locale:'zh-CN',actionTimeout:15_000});

test.beforeAll(async()=>{
  test.setTimeout(maxJourneyMs);
  server=createServer(async(request,response)=>{
    const url=new URL(request.url??'/',origin||'http://127.0.0.1');
    const json=(value:unknown,status=200)=>{
      response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
      response.end(JSON.stringify(value));
    };
    const body=async()=>{
      const parts:Buffer[]=[];
      for await(const part of request)parts.push(Buffer.from(part));
      return parts.length?JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string,unknown>:{};
    };
    try{
      if(url.pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
      if(url.pathname==='/auth/v1/user'){
        json({id:subject,aud:'authenticated',email:'capacity@sensa.invalid',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()});return;
      }
      if(url.pathname==='/sensa/web/access/session'){
        json({authorized:true,accountId:account,capabilities:{publishLearningContent:false}});return;
      }
      if(url.pathname==='/sensa/packages'){
        const revision=(registry as {revision:string}).revision;
        response.setHeader('etag',`"${revision}"`);
        if(request.headers['if-none-match']===`"${revision}"`){response.writeHead(304);response.end();return;}
        json(registry);return;
      }
      if(url.pathname==='/sensa/service/status'){
        json({authorized:true,explanationAvailable:true,checkedAt:new Date().toISOString(),windowHours:24,usage:[]});return;
      }
      if(url.pathname==='/sensa/intake/channel'){json({registered:true,libraryId:'capacity-fixture-library'});return;}
      if(url.pathname==='/sensa/intake/deliveries/pull'){json({deliveries:[]});return;}
      if(url.pathname==='/sensa/library-sync/head'){
        json({revision:cloudRevision,manifest:cloudManifest});return;
      }
      if(url.pathname==='/sensa/library-sync/blocks/missing'){
        const input=await body() as {hashes?:string[]};
        const hashes=input.hashes??[];
        json({missing:hashes.filter(hash=>!cloudBlocks.has(hash))});return;
      }
      if(url.pathname==='/sensa/library-sync/blocks/store'){
        const input=await body() as {blocks?:{hash:string;data:string}[]};
        for(const block of input.blocks??[])cloudBlocks.set(block.hash,block.data);
        json({stored:true});return;
      }
      if(url.pathname==='/sensa/library-sync/blocks/fetch'){
        const input=await body() as {hashes?:string[]};
        const hashes=input.hashes??[];
        json({
          blocks:hashes.flatMap(hash=>cloudBlocks.has(hash)?[{hash,data:cloudBlocks.get(hash)!}]:[]),
          missing:hashes.filter(hash=>!cloudBlocks.has(hash)),
        });return;
      }
      if(url.pathname==='/sensa/library-sync/commit'){
        const input=await body() as {baseRevision?:number;manifest?:string[]};
        if(input.baseRevision!==cloudRevision){json({code:'library_sync_conflict'},409);return;}
        cloudRevision+=1;cloudManifest=input.manifest??[];
        json({revision:cloudRevision,manifest:cloudManifest});return;
      }

      const deliveryUrl=new URL(url.pathname,origin).href;
      const bytes=activeDelivery?.responses.get(deliveryUrl);
      if(bytes){
        deliveryRequests+=1;deliveredBytes+=bytes.byteLength;
        response.writeHead(200,{
          'content-type':'application/vnd.sensa.book+zip',
          'cache-control':'no-store','transfer-encoding':'chunked',
        });
        const chunkSize=Math.max(1,Math.ceil(bytes.byteLength/8));
        for(let start=0;start<bytes.byteLength;start+=chunkSize){
          if(!response.write(Buffer.from(bytes.subarray(start,Math.min(bytes.byteLength,start+chunkSize)))))await once(response,'drain');
        }
        response.end();
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
        response.writeHead(200,{'content-type':'text/html'});
        response.end(await readFile(join(dist,'index.html')));
      }
    }catch(error){
      json({code:'fixture_error',message:error instanceof Error?error.message:'unknown'},500);
    }
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
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
  const emptySnapshot={format:'sensa-learning-content-registry-v3' as const,publishedAt:'2026-09-28T00:00:00Z',items:[]};
  registry={
    ...emptySnapshot,
    revision:createHash('sha256').update(canonicalConsumerJson(emptySnapshot)).digest('hex'),
  };
  storageKey=`sb-${new URL(origin).hostname.split('.')[0]}-auth-token`;

  await rm(output,{recursive:true,force:true});
  await mkdir(dist,{recursive:true});
  execFileSync('npm',['run','build','-w','@sensa/web','--','--outDir',dist,'--emptyOutDir'],{
    cwd:root,
    env:{
      ...process.env,
      VITE_SENSA_MODE:'production',
      VITE_SENSA_BROWSER_SMOKE:'true',
      VITE_SUPABASE_URL:origin,
      VITE_SUPABASE_PUBLISHABLE_KEY:'capacity-fixture-publishable-key',
      VITE_SENSA_API_URL:apiOrigin,
    },
    stdio:'inherit',
  });
});

test.beforeEach(()=>{
  activeDelivery=null;
  deliveredBytes=0;
  deliveryRequests=0;
  cloudRevision=0;
  cloudManifest=null;
  cloudBlocks.clear();
});

test.afterAll(async()=>{
  if(apiServer?.listening)await new Promise<void>(resolve=>apiServer.close(()=>resolve()));
  if(server?.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
  await rm(output,{recursive:true,force:true});
});

const runCapacityJourney=async(count:number,browser:import('@playwright/test').Browser)=>{
  const report:Record<string,unknown>={
    scale:{senseCount:count,dimension:'structured member count; one tiny synthetic audio per member'},
    conditions:{
      browser:'Chromium',browserVersion:browser.version(),cpuThrottle:1,
      origins:{application:origin,api:apiOrigin,initialUrl:origin},browserContext:'new isolated non-persistent Playwright context',
      fixtureNetwork:'loopback chunked transfer without Content-Length',sampleCount:1,
      executionLimits:{
        totalJourneyMs:maxJourneyMs,downloadToWorkerMs:maxDownloadToWorkerWaitMs,
        workerValidationMs:maxWorkerValidationWaitMs,atomicInstallMs:maxAtomicInstallWaitMs,
        installedFactReadMs:maxInstalledFactReadMs,defaultStageMs:defaultStageWaitMs,
        interpretation:'finite stuck-operation guards only; no UX latency threshold is asserted',
      },
      longTaskMeasurement:'PerformanceObserver longtask entries by journey stage and document; this is not INP',
      flowNavigation:'UI back button, UI My Learning navigation, UI Book selection; install, enrollment and study actions are UI-driven',
      realModelCalls:0,ttsCalls:0,device:{platform:platform(),release:release(),architecture:arch(),cpu:cpus()[0]?.model??'unknown'},
    },
    stages:{} as Record<string,unknown>,
  };
  const stages=report.stages as Record<string,{elapsedMs:number;limitMs:number;status:'completed'|'failed';error?:string}>;
  const longTaskObservations:{stage:string;documentId:string;count:number;maximumMs:number;durationsMs:number[];error?:string}[]=[];
  let fixture:ReturnType<typeof portableBookDeliveryFixture>|undefined;
  let context:import('@playwright/test').BrowserContext|undefined;
  let page:import('@playwright/test').Page|undefined;
  const uiPhaseObservations:{atMs:number;phase:string;statusTexts:string[]}[]=[];
  const workerUrls:string[]=[];
  const runtimeErrors:string[]=[];
  const bookRequests:{url:string;startedAtMs:number}[]=[];
  const bookResponses:{url:string;status:number}[]=[];
  const sqliteResourceResponses:{url:string;status:number}[]=[];
  const failedRequests:{url:string;error:string|null}[]=[];
  let lastUiPhase='';
  let journeyStarted=0;
  let lastLongTaskDocumentId='';
  let lastLongTaskCount=0;
  const captureLongTasks=async(name:string)=>{
    if(!page)return;
    let timeout:NodeJS.Timeout|undefined;
    try{
      const current=await Promise.race([
        page.evaluate(()=>{
          const state=window as unknown as {__capacityLongTaskDocumentId:string;__capacityLongTasks:number[]};
          return {documentId:state.__capacityLongTaskDocumentId,tasks:state.__capacityLongTasks??[]};
        }),
        new Promise<never>((_,reject)=>{
          timeout=setTimeout(()=>reject(new Error('long-task snapshot exceeded 10s')),10_000);
        }),
      ]);
      const fresh=current.documentId===lastLongTaskDocumentId
        ?current.tasks.slice(lastLongTaskCount)
        :current.tasks;
      lastLongTaskDocumentId=current.documentId;
      lastLongTaskCount=current.tasks.length;
      longTaskObservations.push({
        stage:name,documentId:current.documentId,count:fresh.length,
        maximumMs:Math.round(Math.max(0,...fresh)),
        durationsMs:fresh.slice().sort((left,right)=>right-left).slice(0,10).map(Math.round),
      });
    }catch(error){
      longTaskObservations.push({stage:name,documentId:lastLongTaskDocumentId,count:0,maximumMs:0,durationsMs:[],error:error instanceof Error?error.message:String(error)});
    }finally{
      if(timeout)clearTimeout(timeout);
    }
  };
  const stage=async<T>(name:string,work:()=>Promise<T>,timeoutMs=defaultStageWaitMs):Promise<T>=>{
    const started=performance.now();
    let timeout:NodeJS.Timeout|undefined;
    console.log(`[portable-book-capacity ${count}] START ${name} (limit ${timeoutMs}ms)`);
    try{
      const result=await Promise.race([
        work(),
        new Promise<never>((_,reject)=>{
          timeout=setTimeout(()=>reject(new Error(`${name} exceeded its ${timeoutMs}ms stage limit`)),timeoutMs);
        }),
      ]);
      stages[name]={elapsedMs:Math.round(performance.now()-started),limitMs:timeoutMs,status:'completed'};
      await captureLongTasks(name);
      console.log(`[portable-book-capacity ${count}] DONE ${name} ${String(stages[name]!.elapsedMs)}ms`);
      return result;
    }catch(error){
      stages[name]={
        elapsedMs:Math.round(performance.now()-started),limitMs:timeoutMs,status:'failed',
        error:error instanceof Error?error.message:String(error),
      };
      await captureLongTasks(name);
      console.log(`[portable-book-capacity ${count}] FAILED ${name} ${String(stages[name]!.elapsedMs)}ms: ${String(stages[name]!.error)}`);
      throw error;
    }finally{
      if(timeout)clearTimeout(timeout);
    }
  };
  const nodeBefore=process.memoryUsage();
  const generationStarted=performance.now();
  try{
    fixture=portableBookDeliveryFixture({
      baseUrl:`${origin}/published/`,
      packageId:stableUuid(`sensa:test:portable-book-capacity:${count}`),
      title:`结构规模 ${count}`,
      memberExpressions:Array.from({length:count},(_,index)=>`fixture-sense-${String(index+1).padStart(5,'0')}`),
      retainBookArchive:false,
    });
    const generationMs=Math.round(performance.now()-generationStarted);
    const nodeAfterGeneration=process.memoryUsage();
    assert.equal(fixture.descriptor.memberCount,count);
    assert.equal(fixture.manifest.members.length,count);
    assert.equal(fixture.fixtureMetrics.uniqueSemanticSenseIds,count);
    assert(fixture.descriptor.byteLength<=maxPortableBookArchiveBytes,'generated Book exceeds the production archive limit');
    assert.equal(createHash('sha256').update(fixture.bookBytes).digest('hex'),fixture.descriptor.sha256);
    report.fixture={
      generationMs,
      manifestMembers:fixture.manifest.members.length,
      descriptorMembers:fixture.descriptor.memberCount,
      archiveBytes:fixture.bookBytes.byteLength,
      memberArchiveBytes:fixture.fixtureMetrics.memberArchiveBytes,
      mediaBytes:fixture.fixtureMetrics.mediaBytes,
      archiveLimitBytes:maxPortableBookArchiveBytes,
      digestMatches:true,
      semanticSenseIds:fixture.fixtureMetrics.uniqueSemanticSenseIds,
      textContent:'unique synthetic sense labels, meanings and scenes; no generated provider output',
      nodeMemoryBytes:{
        rssBefore:nodeBefore.rss,rssAfterGeneration:nodeAfterGeneration.rss,
        heapBefore:nodeBefore.heapUsed,heapAfterGeneration:nodeAfterGeneration.heapUsed,
      },
    };
    console.log(`[portable-book-capacity ${count}] FIXTURE ${JSON.stringify(report.fixture)}`);
    activeDelivery=fixture;
    setRegistry(fixture.descriptor);

    context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});
    page=await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.addInitScript(({key,value})=>{
      const target=window as unknown as {__name?:(value:unknown)=>unknown};
      target.__name=(value:unknown)=>value;
      localStorage.setItem(key,JSON.stringify(value));
      const durations:number[]=[];
      const observerState=window as unknown as {__capacityLongTasks:number[];__capacityLongTaskDocumentId:string};
      observerState.__capacityLongTasks=durations;
      observerState.__capacityLongTaskDocumentId=crypto.randomUUID();
      new PerformanceObserver(list=>durations.push(...list.getEntries().map(entry=>entry.duration)))
        .observe({entryTypes:['longtask']});
    },{key:storageKey,value:session()});
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'
      ?route.continue()
      :route.abort());
    journeyStarted=performance.now();
    const catalog=page.locator('#s-catalog').last();
    const title=`结构规模 ${count}`;
    const detail=page.locator('#s-catalog-book').last();
    const terminalNoticePattern=/下载已取消|学习包下载失败|下载大小与目录不一致|学习资源校验失败|学习包超过当前大小限制|下载结果与目录版本不一致|相同版本的学习包内容发生变化/u;
    const observeDownloadUi=async()=>{
      const statusTexts=await detail.getByRole('status').allTextContents();
      const failure=statusTexts.find(text=>terminalNoticePattern.test(text));
      let phase=failure?'failed'
        :statusTexts.some(text=>text.includes('正在保存'))?'committing'
          :statusTexts.some(text=>text.includes('正在准备'))?'preparing'
            :statusTexts.some(text=>text.includes('正在下载'))?'downloading'
              :await detail.getByText('已下载',{exact:true}).isVisible().catch(()=>false)?'ready'
                :'waiting';
      if(phase!==lastUiPhase){
        uiPhaseObservations.push({atMs:Math.round(performance.now()-journeyStarted),phase,statusTexts});
        lastUiPhase=phase;
      }
      return {phase,statusTexts,failure};
    };
    page.on('worker',worker=>workerUrls.push(worker.url()));
    page.on('console',message=>{
      if(message.type()==='error'&&!message.text().includes('favicon.ico'))runtimeErrors.push(`console: ${message.text()}`);
    });
    page.on('pageerror',error=>runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('request',request=>{
      if(request.url().endsWith('.sensa-book'))bookRequests.push({url:request.url(),startedAtMs:Math.round(performance.now()-journeyStarted)});
    });
    page.on('response',response=>{
      if(response.url().endsWith('.sensa-book'))bookResponses.push({url:response.url(),status:response.status()});
      if(/sqlite|portablePreparationWorker/iu.test(response.url())){
        sqliteResourceResponses.push({url:response.url(),status:response.status()});
      }
    });
    page.on('requestfailed',request=>{
      if(/sqlite|portablePreparationWorker/iu.test(request.url())){
        failedRequests.push({url:request.url(),error:request.failure()?.errorText??null});
      }
    });

    await stage('loadApplicationShell',async()=>{
      await page!.goto(origin);
      await page!.waitForFunction(()=>Boolean((window as unknown as {__sensaBrowserSmoke?:unknown}).__sensaBrowserSmoke),undefined,{timeout:15_000});
    });
    const storageDiagnostics=await stage('confirmOpfsStorage',()=>page!.evaluate(()=>window.__sensaBrowserSmoke!.storageDiagnostics()),20_000);
    assert.equal(storageDiagnostics.persistence,'opfs','capacity results must exercise durable browser OPFS');
    report.sqliteStorage=storageDiagnostics;
    await stage('catalogOpen',async()=>{
      await page!.goto(`${origin}/catalog`);
      await expect(catalog.getByRole('button',{name:title})).toBeVisible({timeout:15_000});
    });
    await stage('openBookDetail',async()=>{
      await catalog.getByRole('button',{name:title}).click();
      await expect(detail.getByRole('heading',{name:title,exact:true})).toBeVisible();
      await expect(detail.getByText(`${new Intl.NumberFormat('zh-CN').format(count)} 个表达`,{exact:true})).toBeVisible();
    });
    let activePreparationWorker:import('@playwright/test').Worker|undefined;
    let preparationWorkerClosed:Promise<void>|undefined;
    await stage('downloadTransferAndWorkerStart',async()=>{
      const workerStarted=page!.waitForEvent('worker',{
        predicate:worker=>worker.url().includes('portablePreparationWorker'),
        timeout:maxDownloadToWorkerWaitMs,
      }).then(worker=>({kind:'worker' as const,worker}))
        .catch(error=>({kind:'timeout' as const,error}));
      await detail.getByRole('button',{name:'下载学习包',exact:true}).click();
      for(;;){
        const ui=await observeDownloadUi();
        if(ui.failure){
          report.productTerminalNotice=ui.failure;
          throw new Error(`Product ended Book download before admission Worker start: ${ui.failure}`);
        }
        const result=await Promise.race([
          workerStarted,
          page!.waitForTimeout(500).then(()=>({kind:'poll' as const})),
        ]);
        if(result.kind==='worker'){activePreparationWorker=result.worker;break;}
        if(result.kind==='timeout')throw result.error;
      }
      preparationWorkerClosed=new Promise<void>(resolve=>activePreparationWorker!.once('close',()=>resolve()));
      const ui=await observeDownloadUi();
      report.uiPhaseAtWorkerStart=ui;
      assert.notEqual(ui.phase,'failed','a terminal download notice must be reported as failure');
    },maxDownloadToWorkerWaitMs);
    await stage('validateAndCompileBookInWorker',async()=>{
      assert(activePreparationWorker,'download must create the production admission Worker');
      assert(preparationWorkerClosed,'the Worker close signal must be observed');
      while(true){
        const ui=await observeDownloadUi();
        if(ui.failure){
          report.productTerminalNotice=ui.failure;
          throw new Error(`Product ended Book validation before Worker completion: ${ui.failure}`);
        }
        const completed=await Promise.race([
          preparationWorkerClosed.then(()=>true),
          page!.waitForTimeout(500).then(()=>false),
        ]);
        if(completed)break;
      }
    },maxWorkerValidationWaitMs);
    await stage('atomicInstallAndReadyState',async()=>{
      const deadline=Date.now()+maxAtomicInstallWaitMs;
      while(Date.now()<deadline){
        const ui=await observeDownloadUi();
        if(ui.failure){
          report.productTerminalNotice=ui.failure;
          throw new Error(`Product refused atomic Book installation: ${ui.failure}`);
        }
        if(await detail.getByText('已下载',{exact:true}).isVisible().catch(()=>false))return;
        await page!.waitForTimeout(500);
      }
      throw new Error(`Product did not expose installed Book state within ${maxAtomicInstallWaitMs}ms`);
    },maxAtomicInstallWaitMs);
    assert.equal(deliveryRequests,1,'the complete Book should transfer exactly once');
    assert.equal(deliveredBytes,fixture.bookBytes.byteLength,'the complete Book bytes should reach Chromium');
    const supplyAfterInstall=await stage('readInstalledFacts',async()=>page!.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint()));
    assert.equal(supplyAfterInstall.length,count,'all validated members must be durably installed');
    assert(supplyAfterInstall.every(item=>item.bookDigests.includes(fixture!.descriptor.sha256)));
    const learningBefore=await stage('readLearningStateBeforeEnrollment',()=>page!.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()));
    assert.deepEqual(learningBefore.targetIds,[],'download must not create learning membership');

    await stage('browseLargeInstalledDirectory',async()=>{
      const contents=detail.getByRole('region',{name:'包内内容',exact:true});
      await expect(contents.locator('li')).toHaveCount(3);
      await contents.getByRole('button',{name:'查看更多',exact:true}).click();
      await expect(contents.locator('li')).toHaveCount(24);
      const pages=Math.ceil(count/24),lastExpression=`fixture-sense-${String(count).padStart(5,'0')}`;
      await contents.getByRole('button',{name:`第 ${new Intl.NumberFormat('zh-CN').format(pages)} 页`,exact:true}).click();
      await expect(contents.locator('li')).toHaveCount(count-(pages-1)*24);
      await expect(contents.getByText(lastExpression,{exact:true})).toBeVisible();
      await contents.getByRole('searchbox',{name:'搜索表达',exact:true}).fill(lastExpression);
      await expect(contents.locator('li')).toHaveCount(1);
      await expect(contents.getByText(lastExpression,{exact:true})).toBeVisible();
      report.directory={pageSize:24,pages,lastPageEntries:count-(pages-1)*24,search:lastExpression,searchResults:1};
      await page!.screenshot({path:test.info().outputPath(`book-${count}-directory-desktop.png`)});
      await page!.setViewportSize({width:390,height:844});
      assert(await detail.evaluate(element=>element.scrollWidth<=element.clientWidth),'large directory must fit a narrow screen');
      await page!.screenshot({path:test.info().outputPath(`book-${count}-directory-narrow.png`)});
      await page!.setViewportSize({width:1280,height:720});
      assert.deepEqual(await page!.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()),learningBefore,'directory browsing does not enroll or create learning facts');
    });

    await stage('explicitEnrollment',async()=>{
      await detail.getByRole('button',{name:'加入学习',exact:true}).click();
      await expect(detail.getByText('已加入学习',{exact:true})).toBeVisible({timeout:180_000});
    });
    const learningAfterEnrollment=await stage('readEnrolledWorkspaceState',()=>page!.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()));
    assert.equal(learningAfterEnrollment.enrollments.length,1);
    assert(learningAfterEnrollment.targetIds.length>0,'explicit enrollment must add real learning targets');
    assert.equal(learningAfterEnrollment.records.length,0,'enrollment must not create learning outcomes');
    report.learningWindowReadyTargetCount=learningAfterEnrollment.targetIds.length;

    await page.addInitScript(()=>{
      const observed=(window as unknown as {__capacityUnexpectedRestoredStates:string[]});
      observed.__capacityUnexpectedRestoredStates=[];
      new MutationObserver(()=>{
        const detail=document.querySelector('#s-catalog-book');
        if(!detail)return;
        const text=detail.textContent??'';
        for(const state of ['未下载','下载后可查看完整的表达与含义。']){
          if(text.includes(state)&&!observed.__capacityUnexpectedRestoredStates.includes(state)){
            observed.__capacityUnexpectedRestoredStates.push(state);
          }
        }
      }).observe(document,{childList:true,subtree:true,characterData:true});
    });
    await stage('restoreBookDetailAfterReload',async()=>{
      const started=performance.now();
      await page!.reload();
      const documentLoaded=performance.now();
      await expect(detail.getByRole('heading',{name:title,exact:true})).toBeVisible({timeout:180_000});
      // This baseline records restoration latency; the surrounding stage is
      // the finite stuck-operation guard, not an implicit 5s UX pass budget.
      await expect(detail.getByText('已加入学习',{exact:true})).toBeVisible({timeout:defaultStageWaitMs});
      report.restoreBreakdown={documentReloadMs:Math.round(documentLoaded-started),afterDocumentLoadedMs:Math.round(performance.now()-documentLoaded)};
    });
    report.unexpectedRestoredStates=await page.evaluate(()=>
      (window as unknown as {__capacityUnexpectedRestoredStates:string[]}).__capacityUnexpectedRestoredStates);
    report.restoredStorage=await page.evaluate(()=>window.__sensaBrowserSmoke!.storageDiagnostics());
    assert.deepEqual(report.unexpectedRestoredStates,[],'pending inventory must not present a known installed Book as undownloaded');
    const restoredSupply=await stage('verifyRestoredInstalledFacts',async()=>page!.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint()));
    assert.equal(restoredSupply.length,count);
    assert(restoredSupply.every(item=>item.bookDigests.includes(fixture!.descriptor.sha256)));
    const restoredLearning=await stage('verifyRestoredLearningState',()=>page!.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()));
    assert.deepEqual(restoredLearning.enrollments,learningAfterEnrollment.enrollments);
    assert.equal(restoredLearning.records.length,0);

    const library=page.locator('#s-library').last();
    await stage('openInstalledBookDetail',async()=>{
      await detail.getByRole('button',{name:'返回',exact:true}).click();
      const navigation=page!.getByRole('navigation',{name:'学习包',exact:true});
      await navigation.getByRole('button',{name:'我的学习包',exact:true}).click();
      await expect(library.getByRole('heading',{name:'我的学习包',exact:true})).toBeVisible({timeout:60_000});
      await library.getByRole('button',{name:title}).click();
      await expect(detail.getByRole('heading',{name:title,exact:true})).toBeVisible();
      await expect(detail.getByText('已加入学习',{exact:true})).toBeVisible();
    });

    await stage('navigateToToday',async()=>{
      await detail.getByRole('button',{name:'去学习',exact:true}).click();
      const home=page!.locator('#s-home');
      await expect(home.getByRole('button',{name:'开始学习',exact:true})).toBeVisible({timeout:120_000});
    });
    const home=page.locator('#s-home');
    await stage('startLearningSession',async()=>{
      await home.getByRole('button',{name:'开始学习',exact:true}).click();
      await expect(page!.getByRole('dialog',{name:'学习偏好',exact:true})).toHaveCount(0);
      await expect(page!.locator('#s-lightweight-runtime').getByRole('button',{name:/查看表达/})).toBeVisible();
    });
    const runtime=page.locator('#s-lightweight-runtime');
    const runtimeBeforeReveal=await stage('readRuntimeBeforeReveal',()=>page!.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint()));
    assert(runtimeBeforeReveal.runtime,'the learning workspace must contain an actual active runtime');
    assert.equal(runtimeBeforeReveal.records.length,0,'starting must not manufacture a learning outcome');
    const firstArrangement=await stage('verifyFirstSessionArrangement',()=>page!.evaluate(()=>window.__sensaBrowserSmoke!.learningArrangementCheckpointForTest()));
    assert.equal(firstArrangement.session?.dailyNewSenseLimit,20,'an unconfigured learner starts with the default daily limit');
    assert(firstArrangement.scope,'the first learning activity must have an actual captured Scope');
    // The queue captures only the actually started target, not a frozen copy of
    // all future candidates. Those candidates remain independently enrolled.
    assert.deepEqual(firstArrangement.scope.members.map(member=>member.targetId),[runtimeBeforeReveal.runtime.targetId]);
    assert(learningAfterEnrollment.targetIds.includes(runtimeBeforeReveal.runtime.targetId));
    await stage('revealSense',async()=>{
      await runtime.getByRole('button',{name:/查看表达/}).click();
      await expect(runtime.getByRole('button',{name:/已经连上/})).toBeVisible();
    });
    const ratingToNextUiStarted=performance.now();
    await stage('submitRating',async()=>{
      await runtime.getByRole('button',{name:/已经连上/}).click();
    });
    await stage('observeNextLearningUI',async()=>{
      const nextRecall=runtime.getByRole('button',{name:/查看表达/});
      const roundComplete=runtime.getByRole('heading',{name:'本轮完成',exact:true});
      await expect.poll(async()=>{
        const [nextCount,completeCount]=await Promise.all([nextRecall.count(),roundComplete.count()]);
        return nextCount>0||completeCount>0;
      },{timeout:180_000}).toBe(true);
    });
    const ratingToNextUiMs=Math.round(performance.now()-ratingToNextUiStarted);
    const afterRating=await stage('verifyPersistedRating',async()=>{
      const after=await page!.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint());
      assert.equal(after.records.length,1,'the learner action must create its actual record');
      assert.equal(after.records[0]!.kind,'initial_learning');
      assert(learningAfterEnrollment.targetIds.includes(after.records[0]!.targetId),
        'the recorded outcome must belong to a target in the actual workspace learning window');
      return after;
    });
    report.learning={
      bookMemberCount:count,
      enrollmentWindowTargetCount:learningAfterEnrollment.targetIds.length,
      firstScopeMemberCount:firstArrangement.scope.members.length,
      firstSessionDailyLimit:firstArrangement.session!.dailyNewSenseLimit,
      capacityAxis:'large Book, bounded admitted learning window; not a fully admitted collection of this size',
      runtimeTargetBeforeReveal:runtimeBeforeReveal.runtime.targetId,
      recordedTarget:afterRating.records[0]!.targetId,
      recordCount:afterRating.records.length,
      runtimeTargetAfterRating:afterRating.runtime?.targetId??null,
      ratingToNextUiMsIncludingStageSnapshots:ratingToNextUiMs,
    };
    report.fullIntegrity=await stage('verifyFullSqliteIntegrity',()=>page!.evaluate(()=>window.__sensaBrowserSmoke!.storageDiagnostics({verifyIntegrity:true})));
    assert.equal((report.fullIntegrity as {integrityCheck?:{status:string}}).integrityCheck?.status,'ok');
  }catch(error){
    report.outcome='failed';
    report.failure=error instanceof Error?{name:error.name,message:error.message,stack:error.stack}:String(error);
    throw error;
  }finally{
    if(page){
      try{
        await captureLongTasks('finalState');
        report.browserState=await Promise.race([
          page.evaluate(async()=>{
            const estimate=await navigator.storage.estimate();
            const memory=(performance as Performance&{memory?:{usedJSHeapSize:number;totalJSHeapSize:number;jsHeapSizeLimit:number}}).memory;
            const longTasks=(window as unknown as {__capacityLongTasks:number[]}).__capacityLongTasks??[];
            return {
              currentUrl:location.href,
              hardwareConcurrency:navigator.hardwareConcurrency,
              storage:{usage:estimate.usage??null,quota:estimate.quota??null},
              javascriptHeap:memory?{
                used:memory.usedJSHeapSize,total:memory.totalJSHeapSize,limit:memory.jsHeapSizeLimit,
              }:null,
              longTaskCountInCurrentDocument:longTasks.length,
              currentDocumentMaximumLongTaskMs:Math.round(Math.max(0,...longTasks)),
              longestTasksMs:longTasks.slice().sort((left,right)=>right-left).slice(0,10).map(Math.round),
              visibleStatusTexts:[...document.querySelectorAll('[role="status"]')]
                .map(node=>node.textContent?.trim()??'').filter(Boolean),
            };
          }),
          new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('browser diagnostics timed out')),15_000)),
        ]);
      }catch(error){report.browserDiagnosticsError=error instanceof Error?error.message:String(error);}
      if(report.outcome==='failed'){
        try{
          const screenshot=await page.screenshot({fullPage:true,timeout:15_000});
          await test.info().attach(`portable-book-capacity-${count}-failure.png`,{body:screenshot,contentType:'image/png'});
        }catch(error){report.failureScreenshotError=error instanceof Error?error.message:String(error);}
      }
      report.workspaceReadMeasures=await page.evaluate(()=>
        performance.getEntries().filter(entry=>entry.name.startsWith('sensa.workspace.')).map(entry=>({name:entry.name,startTime:Math.round(entry.startTime),duration:Math.round(entry.duration)})));
      await context?.close();
    }
    report.uiPhaseObservations=uiPhaseObservations;
    report.workerUrls=workerUrls;
    report.consoleErrors=runtimeErrors;
    report.bookRequests=bookRequests;
    report.bookResponses=bookResponses;
    report.sqliteResourceResponses=sqliteResourceResponses;
    report.failedRequests=failedRequests;
    report.longTaskObservations=longTaskObservations;
    report.longTaskSummary={
      observedStages:longTaskObservations.length,
      observationErrors:longTaskObservations.filter(item=>item.error).map(item=>({stage:item.stage,error:item.error})),
      maximumLongTaskMs:Math.max(0,...longTaskObservations.map(item=>item.maximumMs)),
    };
    report.delivery={requests:deliveryRequests,bytes:deliveredBytes};
    report.nodeMemoryAfter=process.memoryUsage();
    report.outcome??='completed';
    await mkdir(evidenceDirectory,{recursive:true});
    const evidencePath=join(evidenceDirectory,`sense-${count}.json`);
    const serialized=JSON.stringify(report,null,2);
    await writeFile(evidencePath,serialized);
    await test.info().attach(`portable-book-capacity-${count}.json`,{
      body:serialized,contentType:'application/json',
    });
    console.log(`Portable Book capacity ${count}: ${JSON.stringify({fixture:report.fixture,stages:report.stages,browserState:report.browserState,delivery:report.delivery,outcome:report.outcome})}`);
  }
};

test('boot diagnostic: isolated Chromium OPFS startup',async({browser})=>{
  test.setTimeout(35_000);
  const report:Record<string,unknown>={
    kind:'boot-only diagnostic; no Book fixture or learning journey',
    conditions:{browser:'Chromium',browserVersion:browser.version(),origin,apiOrigin,context:'new isolated non-persistent Playwright context'},
    stages:{} as Record<string,unknown>,
  };
  const stages=report.stages as Record<string,{elapsedMs:number;limitMs:number;status:'completed'|'failed';error?:string}>;
  const consoleErrors:string[]=[];
  const pageErrors:string[]=[];
  const workerUrls:string[]=[];
  const resourceResponses:{url:string;status:number}[]=[];
  const failedRequests:{url:string;error:string|null}[]=[];
  let context:import('@playwright/test').BrowserContext|undefined;
  let page:import('@playwright/test').Page|undefined;
  const runStage=async<T>(name:string,work:()=>Promise<T>,limitMs:number)=>{
    const started=performance.now();
    let timeout:NodeJS.Timeout|undefined;
    console.log(`[portable-book-capacity boot] START ${name} limit=${limitMs}ms`);
    try{
      const value=await Promise.race([
        work(),
        new Promise<never>((_,reject)=>{
          timeout=setTimeout(()=>reject(new Error(`${name} exceeded ${limitMs}ms`)),limitMs);
        }),
      ]);
      const elapsedMs=Math.round(performance.now()-started);
      stages[name]={elapsedMs,limitMs,status:'completed'};
      console.log(`[portable-book-capacity boot] DONE ${name} ${elapsedMs}ms`);
      return {value,error:null as string|null};
    }catch(error){
      const elapsedMs=Math.round(performance.now()-started);
      const message=error instanceof Error?error.message:String(error);
      stages[name]={elapsedMs,limitMs,status:'failed',error:message};
      console.log(`[portable-book-capacity boot] FAILED ${name} ${elapsedMs}ms: ${message}`);
      return {value:undefined,error:message};
    }finally{
      if(timeout)clearTimeout(timeout);
    }
  };

  try{
    context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});
    page=await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.addInitScript(({key,value})=>{
      (window as unknown as {__name?:(value:unknown)=>unknown}).__name=(value:unknown)=>value;
      localStorage.setItem(key,JSON.stringify(value));
    },{key:storageKey,value:session()});
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'
      ?route.continue()
      :route.abort());
    page.on('console',message=>{
      if(message.type()==='error'&&!message.text().includes('favicon.ico'))consoleErrors.push(message.text());
    });
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('worker',worker=>workerUrls.push(worker.url()));
    page.on('response',response=>{
      if(/sqlite|portablePreparationWorker|\.wasm(?:\?|$)/iu.test(response.url())){
        resourceResponses.push({url:response.url(),status:response.status()});
      }
    });
    page.on('requestfailed',request=>{
      if(/sqlite|portablePreparationWorker|\.wasm(?:\?|$)/iu.test(request.url())){
        failedRequests.push({url:request.url(),error:request.failure()?.errorText??null});
      }
    });

    const navigation=await runStage('applicationNavigation',()=>page!.goto(origin,{timeout:3_000}),3_000);
    report.initialUrl=origin;
    report.navigationResponseStatus=navigation.value?.status()??null;
    const bridge=await runStage('browserBridgeReady',()=>page!.waitForFunction(
      ()=>Boolean((window as unknown as {__sensaBrowserSmoke?:unknown}).__sensaBrowserSmoke),
      undefined,{timeout:4_000},
    ),4_000);
    report.bridgeReady=bridge.error===null;
    const browserStorage=await runStage('readBrowserStorageCapabilities',()=>page!.evaluate(()=>({
      origin:location.origin,isSecureContext,
      storageEstimateSupported:typeof navigator.storage?.estimate==='function',
      opfsDirectorySupported:typeof navigator.storage?.getDirectory==='function',
      locksSupported:typeof navigator.locks?.request==='function',
    })),1_500);
    report.browserStorageCapabilities=browserStorage.value??null;
    const directOpfs=await runStage('openOpfsDirectoryReadOnly',()=>page!.evaluate(async()=>{
      const directory=await navigator.storage.getDirectory();
      return {opened:true,directoryName:directory.name};
    }),2_500);
    report.directOpfsDirectory=directOpfs.value??null;
    report.directOpfsError=directOpfs.error;
    const sqliteStorage=await runStage('sqliteWorkerDiagnostics',()=>page!.evaluate(() =>
      window.__sensaBrowserSmoke!.storageDiagnostics(),
    ),8_000);
    report.sqliteStorage=sqliteStorage.value??null;
    report.sqliteError=sqliteStorage.error;
    report.outcome=sqliteStorage.value?.persistence==='opfs'?'opfs-ready':'opfs-not-ready';
  }catch(error){
    report.outcome='boot-diagnostic-failed';
    report.failure=error instanceof Error?{name:error.name,message:error.message,stack:error.stack}:String(error);
  }finally{
    if(page){
      try{
        report.visibleStatusTexts=await page.locator('[role="status"]').allTextContents();
        const screenshot=await page.screenshot({fullPage:true,timeout:15_000});
        await test.info().attach('boot-diagnostic.png',{body:screenshot,contentType:'image/png'});
        report.screenshotAttached=true;
      }catch(error){report.screenshotOrStatusError=error instanceof Error?error.message:String(error);}
      await context?.close();
    }
    report.workerUrls=workerUrls;
    report.consoleErrors=consoleErrors;
    report.pageErrors=pageErrors;
    report.workerAndWasmResponses=resourceResponses;
    report.failedWorkerAndWasmRequests=failedRequests;
    await mkdir(evidenceDirectory,{recursive:true});
    const serialized=JSON.stringify(report,null,2);
    await writeFile(join(evidenceDirectory,'boot-diagnostic.json'),serialized);
    await test.info().attach('boot-diagnostic.json',{body:serialized,contentType:'application/json'});
    console.log(`[portable-book-capacity boot] REPORT ${JSON.stringify(report)}`);
  }
  expect(report.outcome).toBe('opfs-ready');
});

test('catalog diagnostic: one-member Book admission on the OPFS harness',async({browser})=>{
  test.setTimeout(60_000);
  const fixture=portableBookDeliveryFixture({
    baseUrl:`${origin}/published/`,
    packageId:stableUuid('sensa:test:portable-book-catalog-boot-diagnostic'),
    title:'目录路径启动诊断',
    memberExpressions:['catalog-boot-diagnostic'],
    retainBookArchive:false,
  });
  activeDelivery=fixture;
  setRegistry(fixture.descriptor);
  deliveredBytes=0;
  deliveryRequests=0;
  const report:Record<string,unknown>={
    kind:'one-member catalog startup, OPFS open and ordinary admission only; no capacity claim',
    conditions:{applicationOrigin:origin,apiOrigin,memberCount:1,archiveBytes:fixture.bookBytes.byteLength,mediaBytes:fixture.fixtureMetrics.mediaBytes},
    stages:{} as Record<string,unknown>,
  };
  const stages=report.stages as Record<string,{elapsedMs:number;limitMs:number;status:'completed'|'failed';error?:string}>;
  const consoleErrors:string[]=[];
  const pageErrors:string[]=[];
  const workers:string[]=[];
  const sqliteResponses:{url:string;status:number}[]=[];
  const failedRequests:{url:string;error:string|null}[]=[];
  let context:import('@playwright/test').BrowserContext|undefined;
  let page:import('@playwright/test').Page|undefined;
  let failure:unknown;
  const stage=async<T>(name:string,work:()=>Promise<T>,limitMs:number):Promise<T>=>{
    const started=performance.now();
    let timeout:NodeJS.Timeout|undefined;
    console.log(`[portable-book-catalog-diagnostic] START ${name} limit=${limitMs}ms`);
    try{
      const value=await Promise.race([
        work(),
        new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error(`${name} exceeded ${limitMs}ms`)),limitMs);}),
      ]);
      const elapsedMs=Math.round(performance.now()-started);
      stages[name]={elapsedMs,limitMs,status:'completed'};
      console.log(`[portable-book-catalog-diagnostic] DONE ${name} ${elapsedMs}ms`);
      return value;
    }catch(error){
      const elapsedMs=Math.round(performance.now()-started);
      stages[name]={elapsedMs,limitMs,status:'failed',error:error instanceof Error?error.message:String(error)};
      console.log(`[portable-book-catalog-diagnostic] FAILED ${name} ${elapsedMs}ms: ${String(stages[name]!.error)}`);
      throw error;
    }finally{if(timeout)clearTimeout(timeout);}
  };
  try{
    context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});
    page=await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.addInitScript(({key,value})=>{
      (window as unknown as {__name?:(value:unknown)=>unknown}).__name=(value:unknown)=>value;
      localStorage.setItem(key,JSON.stringify(value));
    },{key:storageKey,value:session()});
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'
      ?route.continue()
      :route.abort());
    page.on('console',message=>{
      if(message.type()==='error'&&!message.text().includes('favicon.ico'))consoleErrors.push(message.text());
    });
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('worker',worker=>workers.push(worker.url()));
    page.on('response',response=>{
      if(/sqlite|portablePreparationWorker|\.wasm(?:\?|$)/iu.test(response.url())){
        sqliteResponses.push({url:response.url(),status:response.status()});
      }
    });
    page.on('requestfailed',request=>{
      if(/sqlite|portablePreparationWorker|\.wasm(?:\?|$)/iu.test(request.url())){
        failedRequests.push({url:request.url(),error:request.failure()?.errorText??null});
      }
    });

    const catalog=page.locator('#s-catalog').last();
    const title='目录路径启动诊断';
    const detail=page.locator('#s-catalog-book').last();
    await stage('directCatalogNavigation',async()=>{
      await page!.goto(`${origin}/catalog`,{timeout:15_000});
      await expect(catalog.getByRole('button',{name:title})).toBeVisible({timeout:15_000});
    },20_000);
    const storage=await stage('catalogRouteOpfsOpen',()=>page!.evaluate(()=>window.__sensaBrowserSmoke!.storageDiagnostics()),10_000);
    report.sqliteStorage=storage;
    expect(storage.persistence).toBe('opfs');
    await stage('openOneMemberDetail',async()=>{
      await catalog.getByRole('button',{name:title}).click();
      await expect(detail.getByRole('heading',{name:title,exact:true})).toBeVisible();
      await expect(detail.getByText(/1 个表达(?:\s*·|$)/u)).toBeVisible();
    },20_000);
    await stage('oneMemberTransferAndWorkerStart',async()=>{
      const workerStarted=page!.waitForEvent('worker',{
        predicate:worker=>worker.url().includes('portablePreparationWorker'),timeout:20_000,
      });
      await detail.getByRole('button',{name:'下载学习包',exact:true}).click();
      await workerStarted;
    },20_000);
    await stage('oneMemberPreparationAndInstall',async()=>{
      await expect(detail.getByText('已下载',{exact:true})).toBeVisible({timeout:20_000});
    },20_000);
    const installed=await stage('readInstalledFact',()=>page!.evaluate(()=>window.__sensaBrowserSmoke!.supplyCheckpoint()),10_000);
    expect(installed).toHaveLength(1);
    expect(installed[0]!.bookDigests).toContain(fixture.descriptor.sha256);
    expect(await page.evaluate(()=>window.__sensaBrowserSmoke!.learningCheckpoint())).toMatchObject({targetIds:[],enrollments:[],records:[]});
    report.installedFacts=installed.length;
    report.outcome='small-catalog-admission-ready';
  }catch(error){
    failure=error;
    report.outcome='failed';
    report.failure=error instanceof Error?{name:error.name,message:error.message,stack:error.stack}:String(error);
  }finally{
    if(page){
      try{
        report.visibleStatusTexts=await page.locator('[role="status"]').allTextContents();
        const screenshot=await page.screenshot({fullPage:true,timeout:15_000});
        await test.info().attach('catalog-diagnostic.png',{body:screenshot,contentType:'image/png'});
      }catch(error){report.screenshotError=error instanceof Error?error.message:String(error);}
      await context?.close();
    }
    report.workerUrls=workers;
    report.consoleErrors=consoleErrors;
    report.pageErrors=pageErrors;
    report.sqliteResourceResponses=sqliteResponses;
    report.failedRequests=failedRequests;
    report.delivery={requests:deliveryRequests,bytes:deliveredBytes};
    await mkdir(evidenceDirectory,{recursive:true});
    const serialized=JSON.stringify(report,null,2);
    await writeFile(join(evidenceDirectory,'catalog-diagnostic.json'),serialized);
    await test.info().attach('catalog-diagnostic.json',{body:serialized,contentType:'application/json'});
    console.log(`[portable-book-catalog-diagnostic] REPORT ${JSON.stringify(report)}`);
  }
  if(failure)throw failure;
});

test('records a 5000-Sense OPFS journey capacity baseline',async({browser})=>{
  await runCapacityJourney(5000,browser);
});

test('records a 10000-Sense OPFS journey capacity baseline',async({browser})=>{
  await runCapacityJourney(10_000,browser);
});
