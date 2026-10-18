import {once} from 'node:events';
import {createServer,type Server} from 'node:http';
import {resolve} from 'node:path';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {test,expect,chromium} from '@playwright/test';
import {createServer as createViteServer,type ViteDevServer} from 'vite';
import {sqlitePoolDirectory,sqliteLibrarySchemaVersion,type SqliteWorkerInput,type SqliteWorkerResult} from '../../../apps/web/src/data/library/sqliteProtocol';

for(const schemaVersion of [17,18] as const)test(`unsupported schema ${schemaVersion} is rejected by native OPFS without changing retained files`,async({browser},testInfo)=>{
 test.setTimeout(120_000);
 let vite:ViteDevServer|undefined,http:Server|undefined;
 const context=await browser.newContext(),page=await context.newPage(),entryUrl=`/@fs/${resolve('scripts/support/sqliteRuntimeFailureBrowserEntry.ts')}`;
 const invoke=(input:SqliteWorkerInput|{kind:'close'}|{kind:'test_seed_unsupported_schema';schemaVersion:17|18})=>page.evaluate(async({entryUrl,input})=>{const api=await import(/* @vite-ignore */ entryUrl);return api.request(input);},{entryUrl,input}) as Promise<SqliteWorkerResult>;
 const value=(reply:SqliteWorkerResult)=>{expect(reply.ok,reply.ok?'':reply.error).toBe(true);if(!reply.ok)throw Error(reply.error);return reply.value;};
 const files=()=>page.evaluate(async directory=>{
  let root=await navigator.storage.getDirectory();for(const segment of directory.split('/').filter(Boolean))root=await root.getDirectoryHandle(segment);
  const rows=[];for await(const [name,handle] of (root as FileSystemDirectoryHandle&{entries():AsyncIterable<[string,FileSystemHandle]>}).entries())if(handle.kind==='file'){const file=await (handle as FileSystemFileHandle).getFile(),hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());rows.push({name,size:file.size,sha256:Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')});}
  return rows.sort((a,b)=>a.name.localeCompare(b.name));
 },`${sqlitePoolDirectory}/.opaque`);
 try{
  vite=await createViteServer({configFile:resolve('apps/web/vite.config.ts'),root:resolve('apps/web'),logLevel:'error',server:{middlewareMode:true,hmr:false,fs:{allow:[process.cwd()]}}});
  http=createServer(vite.middlewares);http.listen(0,'127.0.0.1');await once(http,'listening');const address=http.address();if(!address||typeof address==='string')throw Error('unsupported_origin_missing');const origin=`http://127.0.0.1:${address.port}`;
  await page.route('**/*',async route=>{if(new URL(route.request().url()).origin!==origin){await route.abort();return;}if(route.request().resourceType()==='document'){await route.fulfill({contentType:'text/html',body:'<!doctype html><body>Isolated unsupported format rejection</body>'});return;}await route.continue();});
  await page.goto(origin);await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);await api.open();},entryUrl);
  value(await invoke({kind:'initialize'}));const encoded=JSON.stringify(['object',[['opaque',['string','Retained synthetic owner body']]]]),refs=['b'.repeat(64),'a'.repeat(64),'b'.repeat(64)];
  value(await invoke({kind:'commit',mutation:{clears:[],deletes:[],puts:[{table:'meta',key:'sentinel',encodedValue:encoded}],syncBaseReplacement:[{table:'meta',key:'sentinel',valueJson:encoded,blockRefs:refs}]}}));
  const retained=value(await invoke({kind:'test_seed_unsupported_schema',schemaVersion})) as {version:number;facts:unknown[]};expect(retained.version).toBe(schemaVersion);
  value(await invoke({kind:'close'}));const before=await files();expect(before.length).toBeGreaterThan(0);
  for(let attempt=0;attempt<2;attempt++){
   await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);api.terminate();await api.open({unmodified:true});},entryUrl);
   const rejected=await invoke({kind:'initialize'});expect(rejected).toMatchObject({ok:false,error:`sqlite_schema_legacy:${schemaVersion}`});
   expect(await files()).toEqual(before);value(await invoke({kind:'close'}));expect(await files()).toEqual(before);
  }
  await testInfo.attach('unsupported-schema-preservation',{contentType:'application/json',body:JSON.stringify({schemaVersion,supported:sqliteLibrarySchemaVersion,browser:browser.version(),retained,before,after:await files(),paidCalls:0,scope:'Real native OPFS v12 pool; synthetic legacy header and facts; repeated unmodified production Worker rejects without file deletion, migration or byte changes.'})});
 }finally{await context.close();if(http)await new Promise<void>((resolve,reject)=>http!.close(error=>error?reject(error):resolve()));await vite?.close();}
});

test('native OPFS short write quarantines the production connection without deleting committed data',async({browser},testInfo)=>{
  test.setTimeout(120_000);
  let vite:ViteDevServer|undefined,http:Server|undefined;
  const context=await browser.newContext();
  const page=await context.newPage();
  const report:Record<string,unknown>={
    conditions:{browserVersion:browser.version(),profile:'isolated ephemeral context',data:'synthetic meta sentinel',fault:'one native SAH payload write physically writes one byte less than requested',paidCalls:0},
    scope:'runtime failure containment and retained data; does not explain the independent UAT short-write root cause',
  };
  const entryPath=resolve('scripts/support/sqliteRuntimeFailureBrowserEntry.ts');
  const entryUrl=`/@fs/${entryPath}`;
  const invoke=async(input:SqliteWorkerInput|{kind:'close'}|{kind:'test_arm_short_write'|'test_native_write_stats'})=>page.evaluate(async({entryUrl,input})=>{
    const api=await import(/* @vite-ignore */ entryUrl);
    return await api.request(input);
  },{entryUrl,input}) as Promise<SqliteWorkerResult>;
  const value=(response:SqliteWorkerResult)=>{
    expect(response.ok,response.ok?'':response.error).toBe(true);
    if(!response.ok)throw new Error(response.error);
    return response.value;
  };
  const mutation=(key:string,encodedValue:string)=>({clears:[],deletes:[],puts:[{table:'meta' as const,key,encodedValue}]});
  const sentinel=JSON.stringify(['string','previous durable data']);
  try{
    vite=await createViteServer({configFile:resolve('apps/web/vite.config.ts'),root:resolve('apps/web'),logLevel:'error',server:{middlewareMode:true,hmr:false,fs:{allow:[process.cwd()]}}});
    http=createServer(vite.middlewares);http.listen(0,'127.0.0.1');await once(http,'listening');
    const address=http.address();if(!address||typeof address==='string')throw new Error('sqlite_runtime_test_origin_missing');
    const origin=`http://127.0.0.1:${address.port}`;
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin){await route.abort('blockedbyclient');return;}
      if(url.pathname==='/'&&route.request().resourceType()==='document'){
        await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body>Isolated storage regression</body></html>'});return;
      }
      await route.continue();
    });
    await page.goto(origin);
    await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);await api.open();},entryUrl);
    value(await invoke({kind:'initialize'}));
    value(await invoke({kind:'commit',mutation:mutation('sentinel',sentinel)}));
    expect(value(await invoke({kind:'get',table:'meta',key:'sentinel'}))).toBe(sentinel);

    // An ordinary rejected record is not evidence that the connection is bad.
    const invalid=await invoke({kind:'commit',mutation:mutation('invalid','not JSON')});
    expect(invalid.ok).toBe(false);
    expect(value(await invoke({kind:'get',table:'meta',key:'sentinel'}))).toBe(sentinel);
    report.constraintFailureRemainsUsable=true;

    value(await invoke({kind:'test_arm_short_write'}));
    const failed=await invoke({kind:'commit',mutation:mutation('must-not-commit',JSON.stringify(['string','new uncommitted data']))});
    expect(failed.ok).toBe(false);
    if(failed.ok)throw new Error('short_write_unexpectedly_succeeded');
    expect(failed.error).toContain('SQLITE_IOERR');
    const afterFailure=value(await invoke({kind:'test_native_write_stats'})) as {writeCalls:number;fault:{requested:number;returned:number;offset:number}};
    expect(afterFailure.fault.returned).toBe(afterFailure.fault.requested-1);
    report.nativeShortWrite={...afterFailure.fault,error:failed.error};

    for(const input of [
      {kind:'get',table:'meta',key:'sentinel'},
      {kind:'count',table:'meta'},
      {kind:'diagnostics',verifyIntegrity:true},
      {kind:'commit',mutation:mutation('later-write',JSON.stringify(['string','must remain blocked']))},
    ] as const){
      const result=await invoke(input);
      expect(result).toMatchObject({ok:false,error:'sqlite_storage_connection_failed'});
    }
    const afterBlocked=value(await invoke({kind:'test_native_write_stats'})) as {writeCalls:number};
    expect(afterBlocked.writeCalls).toBe(afterFailure.writeCalls);
    report.furtherOperationsBlocked=true;
    value(await invoke({kind:'close'}));
    await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);api.terminate();await api.open();},entryUrl);
    value(await invoke({kind:'initialize'}));
    const diagnostics=value(await invoke({kind:'diagnostics',verifyIntegrity:true})) as {integrityCheck:{status:string}};
    expect(diagnostics.integrityCheck.status).toBe('ok');
    expect(value(await invoke({kind:'get',table:'meta',key:'sentinel'}))).toBe(sentinel);
    expect(value(await invoke({kind:'get',table:'meta',key:'must-not-commit'}))).toBeNull();
    expect(value(await invoke({kind:'get',table:'meta',key:'later-write'}))).toBeNull();
    report.reopen={integrity:'ok',originalSentinelPreserved:true,failedAndSubsequentWritesAbsent:true};
    value(await invoke({kind:'close'}));
  }finally{
    await testInfo.attach('runtime-storage-failure-evidence',{body:JSON.stringify(report,null,2),contentType:'application/json'});
    await context.close();
    if(http)await new Promise<void>((resolve,reject)=>http!.close(error=>error?reject(error):resolve()));
    await vite?.close();
  }
});

test('post-commit native checkpoint failure preserves the success receipt and quarantines subsequent requests',async({browser},testInfo)=>{
  test.setTimeout(120_000);
  let vite:ViteDevServer|undefined,http:Server|undefined;
  const context=await browser.newContext(),page=await context.newPage();
  const entryUrl=`/@fs/${resolve('scripts/support/sqliteRuntimeFailureBrowserEntry.ts')}`;
  const report:Record<string,unknown>={scope:'Synthetic storage records and a native short write during post-COMMIT WAL checkpoint; not learner outcomes or an explanation of independent UAT corruption.',browserVersion:browser.version(),paidCalls:0};
  const invoke=async(input:SqliteWorkerInput|{kind:'close'|'test_arm_checkpoint_short_write'|'test_native_write_stats'})=>page.evaluate(async({entryUrl,input})=>{
    const api=await import(/* @vite-ignore */ entryUrl);return api.request(input);
  },{entryUrl,input}) as Promise<SqliteWorkerResult>;
  const value=(response:SqliteWorkerResult)=>{expect(response.ok,response.ok?'':response.error).toBe(true);if(!response.ok)throw new Error(response.error);return response.value;};
  const rows=Array.from({length:400},(_,index)=>({table:'meta' as const,key:`checkpoint-${index}`,encodedValue:JSON.stringify(['string',`durable checkpoint row ${index}`])}));
  try{
    vite=await createViteServer({configFile:resolve('apps/web/vite.config.ts'),root:resolve('apps/web'),logLevel:'error',server:{middlewareMode:true,hmr:false,fs:{allow:[process.cwd()]}}});
    http=createServer(vite.middlewares);http.listen(0,'127.0.0.1');await once(http,'listening');
    const address=http.address();if(!address||typeof address==='string')throw new Error('checkpoint_failure_origin_missing');
    const origin=`http://127.0.0.1:${address.port}`;
    await page.route('**/*',async route=>{
      if(new URL(route.request().url()).origin!==origin){await route.abort('blockedbyclient');return;}
      if(route.request().resourceType()==='document'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Post-commit checkpoint regression</body></html>'});return;}
      await route.continue();
    });
    await page.goto(origin);await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);await api.open();},entryUrl);
    value(await invoke({kind:'initialize'}));
    value(await invoke({kind:'test_arm_checkpoint_short_write'}));
    // COMMIT already completed before the injected native checkpoint write.
    // Its caller must retain the real success, not retry an accepted command.
    const [committed,queuedRead]=await page.evaluate(async({entryUrl,rows})=>{
      const api=await import(/* @vite-ignore */ entryUrl);
      return Promise.all([
        api.request({kind:'commit',mutation:{clears:[],deletes:[],puts:rows}}),
        api.request({kind:'get',table:'meta',key:rows[0]!.key}),
      ]);
    },{entryUrl,rows}) as [SqliteWorkerResult,SqliteWorkerResult];
    value(committed);
    const fault=value(await invoke({kind:'test_native_write_stats'})) as {writeCalls:number;fault:{phase:string;requested:number;returned:number}};
    expect(fault.fault.phase).toBe('post-commit-checkpoint');expect(fault.fault.returned).toBe(fault.fault.requested-1);
    expect(queuedRead).toMatchObject({ok:false,error:'sqlite_storage_connection_failed'});
    report.commitReceipt='success';report.queuedReadBlocked=true;report.nativeFault=fault.fault;
    const blockedInputs:SqliteWorkerInput[]=[
      {kind:'get',table:'meta',key:rows[0]!.key},
      {kind:'count',table:'meta'},
      {kind:'diagnostics',verifyIntegrity:true},
      {kind:'commit',mutation:{clears:[],deletes:[],puts:[{table:'meta',key:'after-checkpoint-failure',encodedValue:'["string","must not write"]'}]}},
    ];
    for(const input of blockedInputs)expect(await invoke(input)).toMatchObject({ok:false,error:'sqlite_storage_connection_failed'});
    expect((value(await invoke({kind:'test_native_write_stats'})) as {writeCalls:number}).writeCalls).toBe(fault.writeCalls);
    report.subsequentOperationsBlocked=true;
    value(await invoke({kind:'close'}));
    await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);api.terminate();await api.open();},entryUrl);
    value(await invoke({kind:'initialize'}));
    expect(value(await invoke({kind:'count',table:'meta'}))).toBe(rows.length);
    const expectedRows=rows.map(({key,encodedValue})=>({key,encodedValue})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
    expect(value(await invoke({kind:'entries',table:'meta'}))).toEqual(expectedRows);
    expect(value(await invoke({kind:'get',table:'meta',key:'after-checkpoint-failure'}))).toBeNull();
    const diagnostics=value(await invoke({kind:'diagnostics',verifyIntegrity:true})) as {integrityCheck:{status:string}};
    expect(diagnostics.integrityCheck.status).toBe('ok');report.reopen={rows:rows.length,integrity:'ok',committedValuesPreserved:true,subsequentWriteAbsent:true};
    value(await invoke({kind:'close'}));
  }catch(cause){report.failure=cause instanceof Error?cause.message:String(cause);throw cause;}
  finally{
    const path=testInfo.outputPath('post-commit-checkpoint-evidence.json');await writeFile(path,JSON.stringify(report,null,2));
    await testInfo.attach('post-commit-checkpoint-evidence',{path,contentType:'application/json'});
    await context.close();if(http)await new Promise<void>((resolve,reject)=>http!.close(error=>error?reject(error):resolve()));await vite?.close();
  }
});

test('a rollback I/O failure hidden behind an ordinary command or diagnostic-repair error still quarantines the production Worker',async({browser},testInfo)=>{
  test.setTimeout(120_000);
  let vite:ViteDevServer|undefined,http:Server|undefined;
  const context=await browser.newContext(),page=await context.newPage();
  const entryUrl=`/@fs/${resolve('scripts/support/sqliteRuntimeFailureBrowserEntry.ts')}`;
  const invoke=async(input:SqliteWorkerInput|{kind:'close'|'test_arm_rollback_io_failure'|'test_arm_diagnostic_rollback_io_failure'})=>page.evaluate(async({entryUrl,input})=>{
    const api=await import(/* @vite-ignore */ entryUrl);return api.request(input);
  },{entryUrl,input}) as Promise<SqliteWorkerResult>;
  const value=(response:SqliteWorkerResult)=>{expect(response.ok,response.ok?'':response.error).toBe(true);if(!response.ok)throw new Error(response.error);return response.value;};
  try{
    vite=await createViteServer({configFile:resolve('apps/web/vite.config.ts'),root:resolve('apps/web'),logLevel:'error',server:{middlewareMode:true,hmr:false,fs:{allow:[process.cwd()]}}});
    http=createServer(vite.middlewares);http.listen(0,'127.0.0.1');await once(http,'listening');
    const address=http.address();if(!address||typeof address==='string')throw new Error('rollback_failure_origin_missing');
    const origin=`http://127.0.0.1:${address.port}`;
    await page.route('**/*',async route=>{
      if(new URL(route.request().url()).origin!==origin){await route.abort('blockedbyclient');return;}
      if(route.request().resourceType()==='document'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Rollback fault regression</body></html>'});return;}
      await route.continue();
    });
    await page.goto(origin);await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);await api.open();},entryUrl);
    value(await invoke({kind:'initialize'}));
    const sentinel='["string","previous durable value"]';
    value(await invoke({kind:'commit',mutation:{clears:[],deletes:[],puts:[{table:'meta',key:'sentinel',encodedValue:sentinel}]}}));
    for(const phase of ['command','diagnostic-repair'] as const){
      value(await invoke({kind:phase==='command'?'test_arm_rollback_io_failure':'test_arm_diagnostic_rollback_io_failure'}));
      const failed=phase==='command'
        ?await invoke({kind:'commit',mutation:{clears:[],deletes:[],puts:[{table:'meta',key:'uncommitted',encodedValue:'["string","must roll back"]'},{table:'meta',key:'invalid',encodedValue:'not JSON'}]}})
        :await invoke({kind:'diagnostics',verifyIntegrity:true});
      expect(failed.ok).toBe(false);if(failed.ok)throw new Error('failed_operation_unexpectedly_succeeded');
      expect(failed.error).not.toContain('rollback SQLITE_IOERR');
      if(phase==='diagnostic-repair')expect(failed.error).toBe('fixture identity repair failure');
      expect(await invoke({kind:'get',table:'meta',key:'sentinel'})).toMatchObject({ok:false,error:'sqlite_storage_connection_failed'});
      value(await invoke({kind:'close'}));
      await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);api.terminate();await api.open();},entryUrl);
      value(await invoke({kind:'initialize'}));
      expect(value(await invoke({kind:'get',table:'meta',key:'sentinel'}))).toBe(sentinel);
      expect(value(await invoke({kind:'get',table:'meta',key:'uncommitted'}))).toBeNull();
      expect(value(await invoke({kind:'get',table:'meta',key:'invalid'}))).toBeNull();
      expect((value(await invoke({kind:'diagnostics',verifyIntegrity:true})) as {integrityCheck:{status:string}}).integrityCheck.status).toBe('ok');
    }
    value(await invoke({kind:'close'}));
  }finally{
    await testInfo.attach('rollback-failure-scope',{body:'Actual production Worker and OPFS; controlled SQL ROLLBACK error with IOERR result code, not a native short-write or independent UAT root-cause reproduction.',contentType:'text/plain'});
    await context.close();if(http)await new Promise<void>((resolve,reject)=>http!.close(error=>error?reject(error):resolve()));await vite?.close();
  }
});

test('wrapper construction failure closes the opened native database and releases its pool lease without losing data',async({browser})=>{
  test.setTimeout(120_000);
  let vite:ViteDevServer|undefined,http:Server|undefined;
  const context=await browser.newContext(),page=await context.newPage();
  const entryUrl=`/@fs/${resolve('scripts/support/sqliteRuntimeFailureBrowserEntry.ts')}`;
  const invoke=async(input:SqliteWorkerInput|{kind:'close'|'test_arm_constructor_failure'|'test_probe_pool_free'})=>page.evaluate(async({entryUrl,input})=>{
    const api=await import(/* @vite-ignore */ entryUrl);return api.request(input);
  },{entryUrl,input}) as Promise<SqliteWorkerResult>;
  const value=(response:SqliteWorkerResult)=>{expect(response.ok,response.ok?'':response.error).toBe(true);if(!response.ok)throw new Error(response.error);return response.value;};
  try{
    // Test-server-only instrumentation of the constructor entry. The raw
    // production pool DB is already open; no hook ships in product source.
    const databasePath=resolve('apps/web/src/data/library/sqliteDatabase.ts');
    vite=await createViteServer({configFile:resolve('apps/web/vite.config.ts'),root:resolve('apps/web'),logLevel:'error',plugins:[{name:'sqlite-constructor-failure-test',enforce:'pre',transform(source,id){
      if(id.split('?')[0]!==databasePath)return;
      const marker='const field=registryFieldReader();';if(!source.includes(marker))throw new Error('constructor_fault_marker_missing');
      return source.replace(marker,`if(Reflect.get(globalThis,'__sqliteConstructorFailureForTest')){Reflect.set(globalThis,'__sqliteConstructorFailureForTest',false);throw new Error('fixture wrapper construction failure');}${marker}`);
    }}],server:{middlewareMode:true,hmr:false,fs:{allow:[process.cwd()]}}});
    http=createServer(vite.middlewares);http.listen(0,'127.0.0.1');await once(http,'listening');
    const address=http.address();if(!address||typeof address==='string')throw new Error('constructor_failure_origin_missing');
    const origin=`http://127.0.0.1:${address.port}`;
    await page.route('**/*',async route=>{
      if(new URL(route.request().url()).origin!==origin){await route.abort('blockedbyclient');return;}
      if(route.request().resourceType()==='document'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Constructor cleanup regression</body></html>'});return;}
      await route.continue();
    });
    await page.goto(origin);await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);await api.open();},entryUrl);
    value(await invoke({kind:'initialize'}));
    const sentinel='["string","data before failed wrapper construction"]';
    value(await invoke({kind:'commit',mutation:{clears:[],deletes:[],puts:[{table:'meta',key:'sentinel',encodedValue:sentinel}]}}));
    value(await invoke({kind:'close'}));
    await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);api.terminate();await api.open();},entryUrl);
    value(await invoke({kind:'test_arm_constructor_failure'}));
    expect(await invoke({kind:'initialize'})).toMatchObject({ok:false,error:'fixture wrapper construction failure'});
    expect(value(await invoke({kind:'test_probe_pool_free'}))).not.toContain('sensa-sqlite-opfs-pool-v1');
    value(await invoke({kind:'close'}));
    await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);api.terminate();await api.open();},entryUrl);
    value(await invoke({kind:'initialize'}));
    expect(value(await invoke({kind:'get',table:'meta',key:'sentinel'}))).toBe(sentinel);
    expect((value(await invoke({kind:'diagnostics',verifyIntegrity:true})) as {integrityCheck:{status:string}}).integrityCheck.status).toBe('ok');
    value(await invoke({kind:'close'}));
  }finally{await context.close();if(http)await new Promise<void>((resolve,reject)=>http!.close(error=>error?reject(error):resolve()));await vite?.close();}
});

test('bare OPFS retains six native handles and names through explicit idle without SQLite or a fault wrapper',async({browser},testInfo)=>{
  const idleMs=Number(process.env.SENSA_OPFS_IDLE_MS??2000);
  if(!Number.isSafeInteger(idleMs)||idleMs<1||idleMs>30*60_000)throw new Error('invalid_bare_opfs_idle_duration');
  test.setTimeout(idleMs+120_000);
  const http=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><html><body>Bare native OPFS control</body></html>');});
  const context=await browser.newContext(),page=await context.newPage().catch(async error=>{await context.close();throw error;});
  const report:Record<string,unknown>={browserVersion:browser.version(),mode:'isolated',sqlite:false,sdk:false,prototypeOverrides:false,faultInjection:false,paidCalls:0,requestedIdleMs:idleMs};
  const open=()=>page.evaluate(async directory=>{
    const workerFunction=()=>{
      type Handle={getSize():number;read(bytes:Uint8Array,options?:{at:number}):number;write(bytes:Uint8Array):number;flush():void;close():void};
      const handles:Handle[]=[];
      self.onmessage=async event=>{
        const {id,kind,directory,fresh}=event.data;
        try{
          if(kind==='open'){
            let root=await navigator.storage.getDirectory();for(const segment of directory.split('/').filter(Boolean))root=await root.getDirectoryHandle(segment,{create:!!fresh});
            for(let index=0;index<6;index++){
              const file=await root.getFileHandle(`bare-${index}`,{create:!!fresh});
              const handle=await (file as FileSystemFileHandle&{createSyncAccessHandle():Promise<Handle>}).createSyncAccessHandle();handles.push(handle);
              if(fresh){const bytes=Uint8Array.from({length:262144},(_,offset)=>(offset*31+index*17)%251);if(handle.write(bytes)!==bytes.length)throw new Error('bare_opfs_short_write');handle.flush();}
            }
            self.postMessage({id,value:handles.length});
          }else if(kind==='verify'){
            const facts=[];
            for(const handle of handles){const bytes=new Uint8Array(handle.getSize()),read=handle.read(bytes,{at:0}),digest=await crypto.subtle.digest('SHA-256',bytes);facts.push({size:bytes.length,read,sha256:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')});}
            self.postMessage({id,value:facts});
          }else if(kind==='close'){for(const handle of handles)handle.close();handles.length=0;self.postMessage({id,value:null});}
          else throw new Error('bare_opfs_unknown_request');
        }catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
      };
    };
    const url=URL.createObjectURL(new Blob([`(${workerFunction.toString()})()`],{type:'text/javascript'})),worker=new Worker(url);URL.revokeObjectURL(url);
    let nextId=0;const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
    worker.onmessage=event=>{const request=pending.get(event.data.id);if(!request)return;pending.delete(event.data.id);if(event.data.error)request.reject(new Error(event.data.error));else request.resolve(event.data.value);};
    worker.onerror=event=>{for(const request of pending.values())request.reject(new Error(event.message));pending.clear();};
    Reflect.set(window,'__bareOpfsIdle',{request:(kind:string,fresh=false)=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});worker.postMessage({id,kind,directory,fresh});})});
  },`${sqlitePoolDirectory}/.opaque`);
  const request=(kind:'open'|'verify'|'close',fresh=false)=>page.evaluate(async({kind,fresh})=>await Reflect.get(window,'__bareOpfsIdle').request(kind,fresh),{kind,fresh});
  const observe=()=>page.evaluate(async directory=>{
    let root=await navigator.storage.getDirectory();for(const segment of directory.split('/').filter(Boolean))root=await root.getDirectoryHandle(segment);
    const names:string[]=[];for await(const [name,handle] of (root as FileSystemDirectoryHandle&{entries():AsyncIterable<[string,FileSystemHandle]>}).entries())if(handle.kind==='file')names.push(name);
    const lookups=[];for(let index=0;index<6;index++){try{await root.getFileHandle(`bare-${index}`);lookups.push('found');}catch(error){lookups.push(error instanceof DOMException?error.name:String(error));}}
    return {capturedAt:new Date().toISOString(),timeOrigin:performance.timeOrigin,names:names.sort(),lookups,estimate:await navigator.storage.estimate()};
  },`${sqlitePoolDirectory}/.opaque`);
  try{
    http.listen(0,'127.0.0.1');await once(http,'listening');const address=http.address();if(!address||typeof address==='string')throw new Error('bare_opfs_origin_missing');
    await page.goto(`http://127.0.0.1:${address.port}`);await open();expect(await request('open',true)).toBe(6);
    const before=await observe(),bytesBefore=await request('verify');report.before=before;report.bytesBefore=bytesBefore;
    const expectedBytes=Array.from({length:6},(_,index)=>({size:262144,read:262144,sha256:createHash('sha256').update(Uint8Array.from({length:262144},(_,offset)=>(offset*31+index*17)%251)).digest('hex')}));
    expect(bytesBefore).toEqual(expectedBytes);
    expect(before.names).toHaveLength(6);expect(before.lookups).toEqual(Array(6).fill('found'));
    console.info(JSON.stringify({stage:'bare_idle_started',requestedIdleMs:idleMs,capturedAt:before.capturedAt}));
    const begin=performance.now();await new Promise(resolve=>setTimeout(resolve,idleMs));report.actualIdleMs=performance.now()-begin;
    const after=await observe();report.after=after;
    // Record held-handle reads even if name lookup failed: cached bytes do not
    // prove that a fresh handle or a future page can recover the same files.
    let bytesAfter:unknown;try{bytesAfter=await request('verify');report.bytesAfter=bytesAfter;}catch(error){report.heldReadFailure=error instanceof Error?error.message:String(error);}
    expect(after.timeOrigin).toBe(before.timeOrigin);expect(after.names).toEqual(before.names);expect(after.lookups).toEqual(before.lookups);expect(bytesAfter).toEqual(bytesBefore);
    await request('close');await page.reload();await open();expect(await request('open')).toBe(6);expect(await request('verify')).toEqual(bytesBefore);report.reopen='exact bytes preserved';await request('close');
  }catch(error){report.failure=error instanceof Error?error.message:String(error);throw error;}
  finally{
    await testInfo.attach('bare-opfs-idle-evidence',{body:JSON.stringify(report,null,2),contentType:'application/json'});await context.close();
    if(http.listening)await new Promise<void>((resolve,reject)=>http.close(error=>error?reject(error):resolve()));
  }
});

test('fault-free idle retains OPFS names and committed bytes in isolated and persistent contexts',async({browser},testInfo)=>{
  const idleMs=Number(process.env.SENSA_OPFS_IDLE_MS??2000);
  if(!Number.isSafeInteger(idleMs)||idleMs<1||idleMs>30*60_000)throw new Error('invalid_opfs_idle_duration');
  test.setTimeout(idleMs+180_000);
  let vite:ViteDevServer|undefined,http:Server|undefined;
  const entryUrl=`/@fs/${resolve('scripts/support/sqliteRuntimeFailureBrowserEntry.ts')}`,reports:Record<string,unknown>[]=[];
  const bytes=Uint8Array.from({length:262144},(_,index)=>(index*31+17)%251),sha256=createHash('sha256').update(bytes).digest('hex');
  try{
    vite=await createViteServer({configFile:resolve('apps/web/vite.config.ts'),root:resolve('apps/web'),logLevel:'error',server:{middlewareMode:true,hmr:false,fs:{allow:[process.cwd()]}}});
    http=createServer(vite.middlewares);http.listen(0,'127.0.0.1');await once(http,'listening');
    const address=http.address();if(!address||typeof address==='string')throw new Error('sqlite_idle_origin_missing');
    const origin=`http://127.0.0.1:${address.port}`;
    // Independent contexts idle together. No SQL, navigation, CLI storage
    // restore or HMR runs during each explicitly measured idle interval.
    const results=await Promise.allSettled((['isolated','persistent'] as const).map(async mode=>{
      const profile=mode==='persistent'?await mkdtemp(resolve('.tmp/sqlite-idle-profile-')):null;
      const context=profile?await chromium.launchPersistentContext(profile,{headless:testInfo.project.use.headless!==false,executablePath:process.env.SENSA_CHROMIUM_PATH}):await browser.newContext();
      // Keep generated profiles as ignored diagnostic artifacts, but never
      // leave a launched browser alive if Page creation itself fails.
      const page=await context.newPage().catch(async error=>{await context.close();throw error;}),report:Record<string,unknown>={mode,profile,browserVersion:context.browser()!.version(),worker:'unmodified production Worker, without prototype fault wrapper',requestedIdleMs:idleMs,hmr:false,faultInjection:false,paidCalls:0};reports.push(report);
      const request=(input:SqliteWorkerInput|{kind:'close'})=>page.evaluate(async({entryUrl,input})=>{const api=await import(/* @vite-ignore */ entryUrl);return api.request(input);},{entryUrl,input}) as Promise<SqliteWorkerResult>;
      const value=(result:SqliteWorkerResult)=>{expect(result.ok,result.ok?'':result.error).toBe(true);if(!result.ok)throw new Error(result.error);return result.value;};
      const namespace=()=>page.evaluate(async()=>{
        const root=await navigator.storage.getDirectory(),entries:{path:string;kind:string}[]=[];
        const collect=async(directory:FileSystemDirectoryHandle,parent:string):Promise<void>=>{
          for await(const [name,handle] of (directory as FileSystemDirectoryHandle&{entries():AsyncIterable<[string,FileSystemHandle]>}).entries()){
            const path=`${parent}/${name}`;entries.push({path,kind:handle.kind});if(handle.kind==='directory')await collect(handle as FileSystemDirectoryHandle,path);
          }
        };
        await collect(root,'');entries.sort((a,b)=>a.path.localeCompare(b.path));
        return {timeOrigin:performance.timeOrigin,capturedAt:new Date().toISOString(),entries,estimate:await navigator.storage.estimate(),locks:await navigator.locks.query()};
      });
      const mediaDigest=()=>page.evaluate(async({entryUrl,sha256})=>{
        const api=await import(/* @vite-ignore */ entryUrl),result=await api.request({kind:'portableMedia',sha256});if(!result.ok)throw new Error(result.error);if(!result.value)return null;
        const digest=await crypto.subtle.digest('SHA-256',result.value.bytes);return {sha256:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''),size:result.value.sizeBytes};
      },{entryUrl,sha256});
      try{
        await page.route('**/*',async route=>{
          if(new URL(route.request().url()).origin!==origin){await route.abort('blockedbyclient');return;}
          if(route.request().resourceType()==='document'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Native OPFS idle control</body></html>'});return;}
          await route.continue();
        });
        await page.goto(origin);await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);await api.open({unmodified:true});},entryUrl);value(await request({kind:'initialize'}));
        value(await page.evaluate(async({entryUrl,sha256,bytes})=>{
          const api=await import(/* @vite-ignore */ entryUrl);return api.request({kind:'commit',mutation:{clears:[],deletes:[],puts:[{table:'meta',key:'idle-sentinel',encodedValue:'["string","committed before idle"]'}],portablePackages:[{packageKey:'synthetic-idle-media',media:[{mediaId:'blob',sha256,mimeType:'application/octet-stream',kind:'audio',sizeBytes:bytes.length,bytes:new Uint8Array(bytes)}]}]}});
        },{entryUrl,sha256,bytes:Array.from(bytes)}) as SqliteWorkerResult);
        const before=await namespace();report.before=before;
        expect(before.entries.filter(entry=>entry.kind==='file'&&entry.path.includes('/.opaque/'))).toHaveLength(6);
        console.info(JSON.stringify({stage:'idle_started',mode,requestedIdleMs:idleMs,capturedAt:before.capturedAt}));
        const begin=performance.now();await new Promise(resolve=>setTimeout(resolve,idleMs));report.actualIdleMs=performance.now()-begin;
        const after=await namespace();report.after=after;
        const lookups=await page.evaluate(async paths=>{
          const root=await navigator.storage.getDirectory();return Promise.all(paths.map(async path=>{
            try{const segments=path.split('/').filter(Boolean),name=segments.pop()!;let parent=root;for(const segment of segments)parent=await parent.getDirectoryHandle(segment);await parent.getFileHandle(name);return {path,status:'found'};}
            catch(error){return {path,status:error instanceof DOMException?error.name:String(error)};}
          }));
        },before.entries.filter(entry=>entry.kind==='file').map(entry=>entry.path));report.lookups=lookups;
        expect(after.timeOrigin).toBe(before.timeOrigin);expect(after.entries).toEqual(before.entries);expect(lookups.every(lookup=>lookup.status==='found')).toBe(true);
        expect(value(await request({kind:'get',table:'meta',key:'idle-sentinel'}))).toBe('["string","committed before idle"]');expect(await mediaDigest()).toEqual({sha256,size:bytes.length});
        value(await request({kind:'close'}));await page.reload();await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);await api.open({unmodified:true});},entryUrl);value(await request({kind:'initialize'}));
        expect(value(await request({kind:'get',table:'meta',key:'idle-sentinel'}))).toBe('["string","committed before idle"]');expect(await mediaDigest()).toEqual({sha256,size:bytes.length});
        const diagnostics=value(await request({kind:'diagnostics',verifyIntegrity:true})) as {integrityCheck:{status:string}};expect(diagnostics.integrityCheck.status).toBe('ok');report.reopenIntegrity='ok';value(await request({kind:'close'}));
      }catch(error){report.failure=error instanceof Error?error.message:String(error);throw error;}
      finally{await context.close();}
    }));
    const failures=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected');
    if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'opfs_idle_control_failed');
  }finally{
    await testInfo.attach('native-opfs-idle-evidence',{body:JSON.stringify({scope:'Synthetic production Worker storage idle control, not full-app UAT or proof of the independent disappearance root cause; duration is explicit and configurable',contexts:reports},null,2),contentType:'application/json'});
    if(http)await new Promise<void>((resolve,reject)=>http!.close(error=>error?reject(error):resolve()));await vite?.close();
  }
});

test('native media remains exact across repeated commits and abrupt Worker reopen in isolated and persistent contexts',async({browser},testInfo)=>{
  test.setTimeout(180_000);
  let vite:ViteDevServer|undefined,http:Server|undefined;
  const entryUrl=`/@fs/${resolve('scripts/support/sqliteRuntimeFailureBrowserEntry.ts')}`;
  const evidence:Record<string,unknown>[]=[];
  try{
    vite=await createViteServer({configFile:resolve('apps/web/vite.config.ts'),root:resolve('apps/web'),logLevel:'error',server:{middlewareMode:true,hmr:false,fs:{allow:[process.cwd()]}}});
    http=createServer(vite.middlewares);http.listen(0,'127.0.0.1');await once(http,'listening');
    const address=http.address();if(!address||typeof address==='string')throw new Error('sqlite_media_lifecycle_origin_missing');
    const origin=`http://127.0.0.1:${address.port}`;
    for(const mode of ['isolated','persistent'] as const){
      const profile=mode==='persistent'?await mkdtemp(resolve('.tmp/sqlite-media-profile-')):null;
      const headless=testInfo.project.use.headless!==false;
      const context=profile?await chromium.launchPersistentContext(profile,{headless,executablePath:process.env.SENSA_CHROMIUM_PATH}):await browser.newContext();
      const page=await context.newPage(),errors:string[]=[];
      page.on('console',message=>{if(message.type()==='error'||/SQLITE_(?:CORRUPT|IOERR)/u.test(message.text()))errors.push(message.text());});
      const report:Record<string,unknown>={mode,profile,headless,browserVersion:context.browser()!.version(),iterations:0,hmr:false,faultInjection:false,paidCalls:0};evidence.push(report);
      const request=async(input:SqliteWorkerInput|{kind:'close'})=>page.evaluate(async({entryUrl,input})=>{
        const api=await import(/* @vite-ignore */ entryUrl);return api.request(input);
      },{entryUrl,input}) as Promise<SqliteWorkerResult>;
      const value=(result:SqliteWorkerResult)=>{expect(result.ok,result.ok?'':result.error).toBe(true);if(!result.ok)throw new Error(result.error);return result.value;};
      const open=()=>page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);await api.open();},entryUrl);
      const expectedMeta=(round:number)=>JSON.stringify(['number',round]);
      try{
        await page.route('**/*',async route=>{
          const url=new URL(route.request().url());if(url.origin!==origin){await route.abort('blockedbyclient');return;}
          if(url.pathname==='/'&&route.request().resourceType()==='document'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Native media lifecycle</body></html>'});return;}
          await route.continue();
        });
        await page.goto(origin);await open();value(await request({kind:'initialize'}));
        for(let round=0;round<24;round++){
          const bytes=Uint8Array.from({length:[2048,65536,262144][round%3]!},(_,index)=>(index*31+round*17)%251);
          const sha256=createHash('sha256').update(bytes).digest('hex');
          const committed=await page.evaluate(async({entryUrl,round,sha256,bytes,encodedValue})=>{
            const api=await import(/* @vite-ignore */ entryUrl);
            return api.request({kind:'commit',mutation:{clears:[],deletes:[],puts:[{table:'meta',key:'media-lifecycle-sentinel',encodedValue}],portablePackages:[{packageKey:'synthetic-storage-media',media:[{mediaId:'blob',sha256,mimeType:'application/octet-stream',kind:'audio',sizeBytes:bytes.length,bytes:new Uint8Array(bytes)}]}]}});
          },{entryUrl,round,sha256,bytes:Array.from(bytes),encodedValue:expectedMeta(round)}) as SqliteWorkerResult;
          value(committed);
          // Terminate only after the production commit acknowledged success;
          // this is real abrupt reopen, not an injected SQL or native fault.
          if(round%2===0)await page.evaluate(async entryUrl=>{const api=await import(/* @vite-ignore */ entryUrl);api.terminate();await api.open();},entryUrl);
          else{value(await request({kind:'close'}));await page.reload();await open();}
          value(await request({kind:'initialize'}));
          expect(value(await request({kind:'get',table:'meta',key:'media-lifecycle-sentinel'}))).toBe(expectedMeta(round));
          const media=await page.evaluate(async({entryUrl,sha256})=>{
            const api=await import(/* @vite-ignore */ entryUrl),result=await api.request({kind:'portableMedia',sha256});
            if(!result.ok)throw new Error(result.error);const blob=result.value;
            if(!blob)return null;
            const digest=await crypto.subtle.digest('SHA-256',blob.bytes);
            return {sha256:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''),size:blob.sizeBytes};
          },{entryUrl,sha256});
          expect(media).toEqual({sha256,size:bytes.length});report.iterations=round+1;
        }
        const diagnostics=value(await request({kind:'diagnostics',verifyIntegrity:true})) as {integrityCheck:{status:string}};
        expect(diagnostics.integrityCheck.status).toBe('ok');expect(errors).toEqual([]);
        report.integrity='ok';report.consoleErrors=errors;value(await request({kind:'close'}));
      }catch(cause){report.failure=cause instanceof Error?cause.message:String(cause);report.consoleErrors=errors;throw cause;}
      finally{await context.close();}
    }
  }finally{
    await testInfo.attach('native-media-lifecycle-evidence',{body:JSON.stringify({scope:'Synthetic raw storage BLOB/sentinel stress, not learning outcomes, idle-duration proof, HMR or an explanation of the UAT fault',contexts:evidence},null,2),contentType:'application/json'});
    if(http)await new Promise<void>((resolve,reject)=>http!.close(error=>error?reject(error):resolve()));await vite?.close();
  }
});
