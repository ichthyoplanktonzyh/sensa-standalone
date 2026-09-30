/** Small real-Chromium proof that an SDK init conflict preserves OPFS data and settles handles. */
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer as createNodeServer,type Server as NodeHttpServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {test,expect} from '@playwright/test';
import {createServer as createViteServer,type ViteDevServer} from 'vite';

type PoolInput=Readonly<{
  directory:string;
  name:string;
  databaseFile:string;
  initialCapacity:number;
}>;

type WorkerResponse=Readonly<{
  requestId:string;
  ok:boolean;
  value?:unknown;
  error?:Readonly<{
    name:string;
    message:string;
    stack?:string;
    diagnostics?:Readonly<Record<string,unknown>>;
  }>;
}>;

type BrowserRecoveryApi=Readonly<{
  createSentinel:(input:PoolInput&Readonly<{sentinelKey:string;sentinelValue:string}>)=>Promise<WorkerResponse>;
  holdSlots:(input:PoolInput&Readonly<{slotCount:number}>)=>Promise<Readonly<{workerId:string;response:WorkerResponse}>>;
  initExpectedConflict:(input:PoolInput)=>Promise<Readonly<{workerId:string;response:WorkerResponse}>>;
  openAndRead:(input:PoolInput&Readonly<{sentinelKey:string}>)=>Promise<WorkerResponse>;
  openAbruptly:(input:PoolInput&Readonly<{sentinelKey:string}>)=>Promise<Readonly<{
    workerId:string;
    response:WorkerResponse;
  }>>;
  probeSlots:(input:PoolInput)=>Promise<WorkerResponse>;
  releaseSlots:(input:Readonly<{workerId:string;pool:PoolInput}>)=>Promise<WorkerResponse>;
  terminateWorker:(input:Readonly<{workerId:string}>)=>Readonly<{terminated:boolean}>;
  terminateAll:(input:Readonly<Record<string,never>>)=>Readonly<{terminated:number}>;
}>;

type StageResult=Readonly<{elapsedMs:number;status:'passed'|'failed';error?:string}>;
type SentinelResult=Readonly<{
  sqliteVersion:string;
  capacity:number;
  sentinelValue:string;
  integrity:string;
  workerStorageLeftOpen?:boolean;
  pauseState?:Readonly<{pausedAfterClose:boolean;unpauseApiStillAvailable:boolean}>;
}>;
type SlotProbe=Readonly<{
  slotCount:number;
  openedNames:string[];
  busySlots:Array<Readonly<{name:string;errorName:string}>>;
}>;

const operationTimeoutMs=30_000;
const stageTimeoutMs=35_000;
const preservationMarker='data was preserved but VFS pause could not be confirmed:';
const workerAcquisitionMarker='__sensaSettleSahPoolAcquisitions';

test('real OPFS pool init conflict retains sentinel and releases every acquired slot',async({browser},testInfo)=>{
  test.setTimeout(180_000);
  const workspaceRoot=process.cwd();
  const webRoot=resolve(workspaceRoot,'apps/web');
  const viteConfigPath=resolve(webRoot,'vite.config.ts');
  const supportEntryPath=resolve(workspaceRoot,'scripts/support/sqliteSahPoolRecoveryBrowserEntry.ts');
  const supportWorkerName='sqliteSahPoolRecoveryWorker.ts';
  const supportEntryUrl=`/@fs/${supportEntryPath.replaceAll('\\','/').replace(/^\/+/, '')}`;
  const sdkPackage=JSON.parse(await readFile(resolve(workspaceRoot,'node_modules/@sqlite.org/sqlite-wasm/package.json'),'utf8')) as {version:string};
  const token=crypto.randomUUID().replaceAll('-','');
  const options:PoolInput={
    directory:`sensa-sahpool-recovery/${token}`,
    name:`sensa_recovery_${token}`,
    databaseFile:`/sensa-recovery-${token}.sqlite3`,
    initialCapacity:3,
  };
  const sentinelKey=`synthetic-${token}`;
  const sentinelValue=`sensa-sahpool-sentinel:${token}`;
  const stages:Record<string,StageResult>={};
  const report:Record<string,unknown>={
    kind:'small durable-browser recovery regression; not a capacity or latency claim',
    conditions:{
      browser:'Chromium',
      browserVersion:browser.version(),
      browserContext:'fresh non-persistent context',
      origin:'assigned from an OS-selected ephemeral loopback port',
      portSelection:'Node HTTP server directly binds port 0 and serves the Vite middleware',
      sdkPackageVersion:sdkPackage.version,
      appViteConfig:'apps/web/vite.config.ts',
      appProtectionPlugin:'sqliteSahPoolInitPreserver() from apps/web Vite top-level plugins; dev-source transform path',
      poolDirectory:options.directory,
      databaseFile:options.databaseFile,
      initialCapacity:options.initialCapacity,
      data:'one synthetic key/value sentinel only; no account or product pool data',
      cleanup:'close the isolated BrowserContext; no pool remove/delete call',
      realModelCalls:0,
      ttsCalls:0,
    },
    stages,
  };

  let vite:ViteDevServer|undefined;
  let httpServer:NodeHttpServer|undefined;
  let context:import('@playwright/test').BrowserContext|undefined;
  let page:import('@playwright/test').Page|undefined;
  let origin='';
  let heldWorkerId:string|undefined;
  let failedSdkWorkerId:string|undefined;
  let abruptWorkerId:string|undefined;
  const workerResponses:Array<{url:string;status:number}> = [];
  const pageErrors:string[]=[];
  let sdkModuleSourceResponse:Promise<Readonly<{url:string;status:number;source:string}>>|undefined;
  const stage=async<T>(name:string,work:()=>Promise<T>,timeoutMs=stageTimeoutMs):Promise<T>=>{
    const started=performance.now();
    let timeout:ReturnType<typeof setTimeout>|undefined;
    console.log(`[sqlite-sahpool-recovery] START ${name} (limit ${timeoutMs}ms)`);
    try{
      const value=await Promise.race([
        work(),
        new Promise<never>((_,reject)=>{
          timeout=setTimeout(()=>reject(new Error(`${name} exceeded ${timeoutMs}ms`)),timeoutMs);
        }),
      ]);
      stages[name]={elapsedMs:Math.round(performance.now()-started),status:'passed'};
      console.log(`[sqlite-sahpool-recovery] DONE ${name} ${stages[name]!.elapsedMs}ms`);
      return value;
    }catch(error){
      stages[name]={
        elapsedMs:Math.round(performance.now()-started),
        status:'failed',
        error:error instanceof Error?error.message:String(error),
      };
      console.log(`[sqlite-sahpool-recovery] FAILED ${name} ${stages[name]!.elapsedMs}ms: ${stages[name]!.error}`);
      throw error;
    }finally{if(timeout)clearTimeout(timeout);}
  };
  const invoke=async<Arguments,Result>(method:keyof BrowserRecoveryApi,args:Arguments):Promise<Result>=>{
    assert(page,'browser page has not been initialized');
    return page.evaluate(async({method,args})=>{
      const api=(window as unknown as {__sqliteSahPoolRecovery?:Record<string,(input:unknown)=>unknown>})
        .__sqliteSahPoolRecovery;
      const action=api?.[method];
      if(!action)throw new Error('sqlite_sahpool_browser_api_missing');
      return await action(args);
    },{method,args}) as Promise<Result>;
  };
  try{
    vite=await stage('startProtectedAppsWebViteServer',()=>createViteServer({
      configFile:viteConfigPath,
      root:webRoot,
      mode:'development',
      logLevel:'error',
      server:{
        host:'127.0.0.1',
        middlewareMode:true,
        hmr:false,
        fs:{allow:[workspaceRoot]},
      },
    }),15_000);
    await stage('bindOSRandomLoopbackPort',async()=>{
      httpServer=createNodeServer(vite!.middlewares);
      httpServer.listen(0,'127.0.0.1');
      await once(httpServer,'listening');
      const address=httpServer.address();
      if(!address||typeof address==='string')throw new Error('vite_random_port_unavailable');
      if([3000,4319,5173].includes(address.port))throw new Error('recovery_harness_used_a_reserved_dev_port');
      origin=`http://127.0.0.1:${address.port}`;
      (report.conditions as Record<string,unknown>).origin=origin;
      return address.port;
    },15_000);

    context=await browser.newContext({viewport:{width:1000,height:700},locale:'en-US'});
    page=await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('response',response=>{
      if(response.url().includes(supportWorkerName)&&response.url().includes('worker_file')){
        workerResponses.push({url:response.url(),status:response.status()});
      }
    });
    context.on('response',response=>{
      const responseUrl=new URL(response.url());
      if(responseUrl.origin===origin&&/@sqlite\.org\/sqlite-wasm\/dist\/index\.mjs$/u.test(responseUrl.pathname)){
        sdkModuleSourceResponse=response.text().then(source=>({
          url:response.url(),
          status:response.status(),
          source,
        }));
      }
    });
    await stage('loadBrowserRecoveryModuleOnIsolatedOrigin',async()=>{
      await page!.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.origin!==origin){await route.abort('blockedbyclient');return;}
        if(url.pathname==='/'&&route.request().resourceType()==='document'){
          await route.fulfill({
            status:200,
            contentType:'text/html; charset=utf-8',
            body:`<!doctype html><html><head><meta charset="utf-8"><title>SQLite recovery fixture</title></head><body><script type="module">import ${JSON.stringify(supportEntryUrl)};</script></body></html>`,
          });
          return;
        }
        await route.continue();
      });
      await page!.goto(origin,{waitUntil:'load',timeout:15_000});
      await page!.waitForFunction(()=>Boolean(
        (window as unknown as {__sqliteSahPoolRecovery?:unknown}).__sqliteSahPoolRecovery,
      ),undefined,{timeout:15_000});
    },20_000);

    const seedResponse=await stage('createWriteAndNormallyCloseSentinel',()=>invoke<
      PoolInput&Readonly<{sentinelKey:string;sentinelValue:string}>,WorkerResponse
    >('createSentinel',{...options,sentinelKey,sentinelValue}));
    expect(seedResponse.ok,seedResponse.error?.message).toBe(true);
    const seeded=seedResponse.value as SentinelResult;
    expect(seeded.sentinelValue).toBe(sentinelValue);
    expect(seeded.integrity).toBe('ok');
    expect(seeded.capacity).toBe(options.initialCapacity);
    expect(seeded.pauseState).toEqual({pausedAfterClose:true,unpauseApiStillAvailable:true});
    expect(sdkModuleSourceResponse,'the SDK source must be served through the app Vite transform').toBeDefined();
    const protectedSdkModule=await stage('inspectProtectedSDKDevSourceTransform',()=>sdkModuleSourceResponse!,operationTimeoutMs);
    expect(protectedSdkModule.status).toBe(200);
    expect(protectedSdkModule.source).toContain(workerAcquisitionMarker);
    expect(protectedSdkModule.source).toContain(preservationMarker);
    report.protectionProof={
      source:'SDK index.mjs served by the actual apps/web/vite.config.ts top-level Vite dev transform',
      sdkModuleUrl:protectedSdkModule.url,
      sdkModuleResponseStatus:protectedSdkModule.status,
      preservedFailureMarkerFound:protectedSdkModule.source.includes(preservationMarker),
      settleAllAcquisitionsMarkerFound:protectedSdkModule.source.includes(workerAcquisitionMarker),
      packageVersion:sdkPackage.version,
      runtimeSqliteVersion:seeded.sqliteVersion,
    };
    report.seed={capacity:seeded.capacity,integrity:seeded.integrity,pauseState:seeded.pauseState};

    const holder=await stage('holdAnExistingNativeAccessHandle',()=>invoke<
      PoolInput&Readonly<{slotCount:number}>,Readonly<{workerId:string;response:WorkerResponse}>
    >('holdSlots',{...options,slotCount:1}));
    heldWorkerId=holder.workerId;
    expect(holder.response.ok,holder.response.error?.message).toBe(true);
    const held=holder.response.value as Readonly<{slotCount:number;heldNames:string[]}>;
    expect(held.slotCount).toBe(options.initialCapacity);
    expect(held.heldNames).toHaveLength(1);
    report.heldSlots=held;

    const failedInit=await stage('rejectThirdSDKInitializationWithoutDeletingPool',()=>invoke<
      PoolInput,Readonly<{workerId:string;response:WorkerResponse}>
    >('initExpectedConflict',options));
    failedSdkWorkerId=failedInit.workerId;
    const conflict=failedInit.response;
    expect(conflict.ok).toBe(false);
    expect(conflict.error?.name).toBe('NoModificationAllowedError');
    expect(conflict.error?.message).toMatch(/Access Handles|NoModificationAllowedError/u);
    expect(conflict.error?.diagnostics).toMatchObject({vfsRegistered:false});
    report.conflictError={...conflict.error,vfsUnregisteredAfterFailure:true};

    const probeWhileHeld=async(name:string)=>{
      const response=await stage(name,()=>invoke<PoolInput,WorkerResponse>('probeSlots',options));
      expect(response.ok,response.error?.message).toBe(true);
      const value=response.value as SlotProbe;
      expect(value.slotCount).toBe(options.initialCapacity);
      expect(value.busySlots).toEqual([{name:held.heldNames[0]!,errorName:'NoModificationAllowedError'}]);
      expect(value.openedNames).toHaveLength(options.initialCapacity-1);
      return value;
    };
    const firstHandleProbe=await probeWhileHeld('verifyNoLateHandlesAfterFailedInit');
    await page.waitForTimeout(100);
    const stableHandleProbe=await probeWhileHeld('recheckNoLateHandlesAfterSettlingWindow');
    report.handleSettlement={
      expectedBusySlot:held.heldNames[0],
      firstProbeOpenCount:firstHandleProbe.openedNames.length,
      secondProbeOpenCount:stableHandleProbe.openedNames.length,
      unexpectedBusySlots:0,
      settlingWindowMs:100,
    };

    const released=await stage('releaseNativeSlotOwner',()=>invoke<
      Readonly<{workerId:string;pool:PoolInput}>,WorkerResponse
    >('releaseSlots',{workerId:holder.workerId,pool:options}));
    expect(released.ok,released.error?.message).toBe(true);
    heldWorkerId=undefined;
    const allSlotsFree=await stage('verifyEverySlotIsFreeAfterRelease',async()=>{
      const response=await invoke<PoolInput,WorkerResponse>('probeSlots',options);
      expect(response.ok,response.error?.message).toBe(true);
      const value=response.value as SlotProbe;
      expect(value.slotCount).toBe(options.initialCapacity);
      expect(value.busySlots).toEqual([]);
      expect(value.openedNames).toHaveLength(options.initialCapacity);
      return value;
    });
    report.releasedPoolSlots={slotCount:allSlotsFree.slotCount,allOpenable:true};

    const recoveredResponse=await stage('recoverSamePoolAndReadSentinelInFreshSDKWorker',()=>invoke<
      PoolInput&Readonly<{sentinelKey:string}>,WorkerResponse
    >('openAndRead',{...options,sentinelKey}));
    expect(recoveredResponse.ok,recoveredResponse.error?.message).toBe(true);
    const recovered=recoveredResponse.value as SentinelResult;
    expect(recovered).toMatchObject({
      sqliteVersion:seeded.sqliteVersion,
      capacity:options.initialCapacity,
      sentinelValue,
      integrity:'ok',
      workerStorageLeftOpen:false,
      pauseState:{pausedAfterClose:true,unpauseApiStillAvailable:true},
    });
    const failedWorkerTerminatedAfterProof=await stage('terminateFailedInitWorkerOnlyAfterRecoveryProof',async()=>{
      assert(failedSdkWorkerId,'failed SDK initialization Worker must remain alive through recovery proof');
      const result=await invoke<Readonly<{workerId:string}>,Readonly<{terminated:boolean}>>(
        'terminateWorker',{workerId:failedSdkWorkerId},
      );
      expect(result.terminated).toBe(true);
      failedSdkWorkerId=undefined;
      return result;
    });
    report.recovery={
      sentinelPreserved:recovered.sentinelValue===sentinelValue,
      integrity:recovered.integrity,
      pauseState:recovered.pauseState,
      sqliteVersion:recovered.sqliteVersion,
      failedInitWorkerKeptAliveThroughProof:true,
      failedInitWorkerTerminatedAfterProof:failedWorkerTerminatedAfterProof.terminated,
    };

    const abrupt=await stage('openSameSentinelAndAbruptlyTerminateWorker',()=>invoke<
      PoolInput&Readonly<{sentinelKey:string}>,Readonly<{workerId:string;response:WorkerResponse}>
    >('openAbruptly',{...options,sentinelKey}));
    abruptWorkerId=abrupt.workerId;
    expect(abrupt.response.ok,abrupt.response.error?.message).toBe(true);
    expect(abrupt.response.value).toMatchObject({sentinelValue,workerStorageLeftOpen:true});
    const terminated=await stage('abruptlyTerminateRecoveryWorker',async()=>{
      const result=await invoke<Readonly<{workerId:string}>,Readonly<{terminated:boolean}>>(
        'terminateWorker',{workerId:abrupt.workerId},
      );
      expect(result.terminated).toBe(true);
      abruptWorkerId=undefined;
      return result;
    });
    const afterAbruptResponse=await stage('recoverSentinelAfterAbruptWorkerTermination',()=>invoke<
      PoolInput&Readonly<{sentinelKey:string}>,WorkerResponse
    >('openAndRead',{...options,sentinelKey}));
    expect(afterAbruptResponse.ok,afterAbruptResponse.error?.message).toBe(true);
    const afterAbrupt=afterAbruptResponse.value as SentinelResult;
    expect(afterAbrupt).toMatchObject({
      sentinelValue,
      integrity:'ok',
      workerStorageLeftOpen:false,
      pauseState:{pausedAfterClose:true,unpauseApiStillAvailable:true},
    });
    report.abruptTermination={
      terminated:terminated.terminated,
      sentinelPreserved:afterAbrupt.sentinelValue===sentinelValue,
      integrity:afterAbrupt.integrity,
      pauseState:afterAbrupt.pauseState,
    };
    report.outcome='passed';
  }catch(error){
    report.outcome='failed';
    report.failure=error instanceof Error?{name:error.name,message:error.message,stack:error.stack}:String(error);
    throw error;
  }finally{
    if(page){
      try{
        await page.evaluate(async({held,failed,abrupt,options})=>{
          const api=(window as unknown as {__sqliteSahPoolRecovery?:BrowserRecoveryApi}).__sqliteSahPoolRecovery;
          if(!api)return;
          if(held){
            await api.releaseSlots({workerId:held,pool:options}).catch(()=>{});
          }
          if(failed)api.terminateWorker({workerId:failed});
          if(abrupt)api.terminateWorker({workerId:abrupt});
          api.terminateAll({});
        },{held:heldWorkerId,failed:failedSdkWorkerId,abrupt:abruptWorkerId,options});
      }catch(error){report.cleanupError=error instanceof Error?error.message:String(error);}
      report.pageErrors=pageErrors;
    }
    report.workerRequests=workerResponses;
    report.origin=origin||null;
    try{
      const serialized=JSON.stringify(report,null,2);
      await testInfo.attach('sqlite-sahpool-recovery.json',{body:serialized,contentType:'application/json'});
      console.log(`[sqlite-sahpool-recovery] REPORT ${JSON.stringify(report)}`);
    }finally{
      await context?.close();
      if(httpServer?.listening){
        await new Promise<void>((resolveClose,rejectClose)=>{
          httpServer!.close(error=>error?rejectClose(error):resolveClose());
        });
      }
      await vite?.close();
    }
  }
});
