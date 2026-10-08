/** Real unmodified production Worker/OPFS, synthetic candidate transport.
 * No HTTP checkpoint, promotion, account UI or capacity-equivalence claim. */
import {once} from 'node:events';
import {createServer,type Server} from 'node:http';
import {resolve} from 'node:path';
import {test,expect} from '@playwright/test';
import {createServer as createViteServer,type ViteDevServer} from 'vite';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import type {SqliteWorkerInput,SqliteWorkerResult} from '../../../apps/web/src/data/library/sqliteProtocol';
import type {ReplicaCandidateRecord} from '../../../apps/web/src/data/library/replicaCandidateProtocol';
import {candidateExpected,candidateBlocksFor} from '../support/replicaCandidateFixture.mts';
import {librarySyncBlockFetch} from '@sensa/contracts/sensa';

for(const scenario of ['reads','close','native-failure','crash'] as const)test(`private OPFS candidate lifecycle: ${scenario}`,async({browser},testInfo)=>{
 test.setTimeout(180_000);
 let vite:ViteDevServer|undefined,http:Server|undefined;
 const context=await browser.newContext(),page=await context.newPage();
 const entryUrl=`/@fs/${resolve('scripts/support/sqliteRuntimeFailureBrowserEntry.ts')}`;
 const invoke=(input:SqliteWorkerInput|{kind:'close'|'test_arm_short_write'|'test_native_write_stats'})=>page.evaluate(async({entryUrl,input})=>{const api=await import(/* @vite-ignore */ entryUrl);return api.request(input);},{entryUrl,input}) as Promise<SqliteWorkerResult>;
 const value=(reply:SqliteWorkerResult)=>{expect(reply.ok,reply.ok?'':reply.error).toBe(true);if(!reply.ok)throw Error(reply.error);return reply.value;};
 const identity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:'2026-10-03T00:00:00.000Z',schemaVersion:2 as const},owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()};
 const text=(value:unknown)=>JSON.stringify(encodeBackupValue(value));
 const records:ReplicaCandidateRecord[]=[{table:'meta',key:'identity',valueJson:text(identity),blockRefs:['a'.repeat(64)]}];
 for(let index=0;index<1000;index++){const id=crypto.randomUUID();records.push({table:'drafts',key:id,valueJson:text({id,revision:1,text:`Synthetic candidate ${index}: `+'x'.repeat(15000),createdAt:identity.createdAt,updatedAt:identity.createdAt}),blockRefs:['a'.repeat(64)]});}
 try{
  vite=await createViteServer({configFile:resolve('apps/web/vite.config.ts'),root:resolve('apps/web'),logLevel:'error',server:{middlewareMode:true,hmr:false,fs:{allow:[process.cwd()]}}});
  http=createServer(vite.middlewares);http.listen(0,'127.0.0.1');await once(http,'listening');const address=http.address();if(!address||typeof address==='string')throw Error('candidate_origin_missing');
  const origin=`http://127.0.0.1:${address.port}`;
  await page.route('**/*',async route=>{
   if(new URL(route.request().url()).origin!==origin){await route.abort('blockedbyclient');return;}
   if(route.request().resourceType()==='document'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Isolated candidate regression</body></html>'});return;}
   await route.continue();
  });
  await page.goto(origin);await page.evaluate(async({entryUrl,unmodified})=>{const api=await import(/* @vite-ignore */ entryUrl);await api.open({unmodified});},{entryUrl,unmodified:scenario!=='native-failure'});
  value(await invoke({kind:'initialize'}));
  value(await invoke({kind:'commit',mutation:{clears:[],deletes:[],puts:[
   {table:'meta',key:'identity',encodedValue:text(identity)},
   {table:'meta',key:'service-owner',encodedValue:text(owner)},
   {table:'meta',key:'sentinel',encodedValue:text('Existing local data')},
  ]}}));
  const begun=value(await invoke({kind:'replicaCandidate',request:{kind:'begin',fence:{identity,owner,incarnation:'initial',localRevision:0},expected:candidateExpected(records,identity)}})) as {kind:string;id:string};
  expect(begun.kind).toBe('begun');
  for(let at=0;at<records.length;at+=128){const page=records.slice(at,at+128);value(await invoke({kind:'replicaCandidate',request:{kind:'append',id:begun.id,records:page,blocks:candidateBlocksFor(page)}}));}
  expect(value(await invoke({kind:'count',table:'drafts'}))).toBe(0);
  if(scenario!=='reads'){
   if(scenario!=='crash'){
    const lifecycle=await page.evaluate(async({entryUrl,id,scenario})=>{
     const api=await import(/* @vite-ignore */ entryUrl);let settled=false;
     const pending=api.request({kind:'replicaCandidate',request:{kind:'validate',id}}).then((result:SqliteWorkerResult)=>{settled=true;return result;});
     const probe=await api.request({kind:'get',table:'meta',key:'sentinel'}),during=!settled;
     let interrupted:SqliteWorkerResult,before:unknown,after:unknown;
     if(scenario==='native-failure'){
      await api.request({kind:'test_arm_short_write'});
      interrupted=await api.request({kind:'commit',mutation:{clears:[],deletes:[],puts:[{table:'meta',key:'fault-write',encodedValue:'["string","must not commit"]'}]}});
      before=await api.request({kind:'test_native_write_stats'});
     }else interrupted=await api.request({kind:'close'});
     const result=await pending;
     if(scenario==='native-failure')after=await api.request({kind:'test_native_write_stats'});
     return {probe,during,interrupted,result,before,after};
    },{entryUrl,id:begun.id,scenario});
    expect(lifecycle.during).toBe(true);expect(value(lifecycle.probe)).toBe(text('Existing local data'));
    expect(lifecycle.result.ok).toBe(false);
    if(scenario==='close'){
     value(lifecycle.interrupted);expect(lifecycle.result).toMatchObject({ok:false,error:'sqlite_database_closed'});
    }else{
     expect(lifecycle.interrupted).toMatchObject({ok:false});
     if(lifecycle.interrupted.ok||lifecycle.result.ok)throw Error('Expected physical failure');
     expect(lifecycle.interrupted.error).toContain('SQLITE_IOERR');expect(lifecycle.result.error).toContain('SQLITE_IOERR');
     const before=value(lifecycle.before as SqliteWorkerResult) as {writeCalls:number;fault:{requested:number;returned:number}},after=value(lifecycle.after as SqliteWorkerResult) as {writeCalls:number};
     expect(before.fault.returned).toBe(before.fault.requested-1);expect(after.writeCalls).toBe(before.writeCalls);
     value(await invoke({kind:'close'}));
    }
    await testInfo.attach('candidate-lifecycle-evidence',{contentType:'application/json',body:JSON.stringify({scenario,...lifecycle,paidCalls:0})});
   }
   // crash deliberately terminates a Worker with an undiscarded filling copy.
   await page.evaluate(async({entryUrl,unmodified})=>{const api=await import(/* @vite-ignore */ entryUrl);api.terminate();await api.open({unmodified});},{entryUrl,unmodified:scenario!=='native-failure'});
   value(await invoke({kind:'initialize'}));value(await invoke({kind:'diagnostics',verifyIntegrity:true}));
   expect(value(await invoke({kind:'get',table:'meta',key:'sentinel'}))).toBe(text('Existing local data'));
   expect(value(await invoke({kind:'get',table:'meta',key:'fault-write'}))).toBeNull();
   expect(value(await invoke({kind:'count',table:'drafts'}))).toBe(0);
   expect(await invoke({kind:'replicaCandidate',request:{kind:'validate',id:begun.id}})).toMatchObject({ok:false,error:'library_sync_candidate_invalid'});
   value(await invoke({kind:'close'}));return;
  }
  const measured=await page.evaluate(async({entryUrl,id})=>{
   const api=await import(/* @vite-ignore */ entryUrl);let settled=false;
   const pending=api.request({kind:'replicaCandidate',request:{kind:'validate',id}}).then((result:SqliteWorkerResult)=>{settled=true;return result;});
   const reads:Array<{elapsed:number;during:boolean;reply:SqliteWorkerResult}>=[];
   for(let attempt=0;attempt<30&&!settled;attempt++){
    await new Promise<void>(resolve=>setTimeout(resolve,5));const started=performance.now();
    const reply=await api.request({kind:'get',table:'meta',key:'sentinel'});reads.push({elapsed:performance.now()-started,during:!settled,reply});
   }
   return {reads,result:await pending};
  },{entryUrl,id:begun.id}) as {reads:Array<{elapsed:number;during:boolean;reply:SqliteWorkerResult}>;result:SqliteWorkerResult};
  const validated=value(measured.result) as {kind:string;candidate:{records:number}};expect(validated.kind).toBe('validated');expect(validated.candidate.records).toBe(records.length);
  for(const read of measured.reads)expect(value(read.reply)).toBe(text('Existing local data'));
  expect(measured.reads.some(read=>read.during)).toBe(true);
  expect(value(await invoke({kind:'count',table:'drafts'}))).toBe(0);
  expect((await invoke({kind:'replicaCandidate',request:{kind:'append',id:begun.id,records:[records[0]!],blocks:[]}})).ok).toBe(false);
  value(await invoke({kind:'replicaCandidate',request:{kind:'discard',id:begun.id}}));
  expect(value(await invoke({kind:'get',table:'meta',key:'sentinel'}))).toBe(text('Existing local data'));
  const errorReplies=measured.reads.filter(read=>!read.reply.ok);expect(errorReplies).toEqual([]);
  await testInfo.attach('candidate-worker-evidence',{contentType:'application/json',body:JSON.stringify({browser:browser.version(),fixture:'1000 synthetic Drafts; direct controlled Worker RPC; no HTTP or promotion',readsDuringValidation:measured.reads.filter(read=>read.during).length,maxReadMs:Math.max(...measured.reads.map(read=>read.elapsed)),paidCalls:0})});
  value(await invoke({kind:'close'}));
 }finally{
  await context.close();if(http)await new Promise<void>((resolve,reject)=>http!.close(error=>error?reject(error):resolve()));await vite?.close();
 }
});

for(const scenario of ['restore','write-during-validation'] as const)test(`normal staged OPFS sync over 64 MiB: ${scenario}`,async({browser},testInfo)=>{
 test.setTimeout(240_000);
 let vite:ViteDevServer|undefined,http:Server|undefined;
 const context=await browser.newContext(),page=await context.newPage();
 const id=crypto.randomUUID(),identity={id,learnerId:crypto.randomUUID(),deviceId:id,createdAt:'2026-10-03T00:00:00.000Z',schemaVersion:2 as const},owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()};
 const fixture=(()=>{
  const records:ReplicaCandidateRecord[]=[{table:'meta',key:'identity',valueJson:JSON.stringify(encodeBackupValue(identity)),blockRefs:[]}];
  let first:unknown,last:unknown,logicalBytes=0;
  for(let index=0;index<5000;index++){
   const value={id:crypto.randomUUID(),revision:1,text:`Synthetic remote draft ${index}: `+'x'.repeat(15000),createdAt:identity.createdAt,updatedAt:identity.createdAt};
   first??=value;last=value;const valueJson=JSON.stringify(encodeBackupValue(value));logicalBytes+=Buffer.byteLength(valueJson,'utf8');records.push({table:'drafts',key:value.id,valueJson,blockRefs:[]});
  }
  const expected=candidateExpected(records,identity),wire=new Map([...expected.manifestBlocks,...candidateBlocksFor(records)].map(block=>[block.hash,block.data]));
  return {expected,wire,first,last,logicalBytes};
 })();
 // Use Vite's canonical /src URLs so the synchronizer and the instrumented
 // adapter share one module instance rather than /@fs aliases of that file.
 const storeUrl='/src/data/library/store.ts',syncUrl='/src/data/library/cloudSync.ts',adapterUrl='/src/data/library/sqliteAdapter.ts',draftUrl='/src/data/library/drafts.ts';
 try{
  vite=await createViteServer({configFile:resolve('apps/web/vite.config.ts'),root:resolve('apps/web'),logLevel:'error',server:{middlewareMode:true,hmr:false,fs:{allow:[process.cwd()]}}});
  http=createServer(async(request,response)=>{
   if(request.url==='/candidate/head'){response.setHeader('content-type','application/json');response.end(JSON.stringify(fixture.expected.head));return;}
   if(request.url==='/candidate/blocks/fetch'){
    try{
     const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
     const {hashes}=librarySyncBlockFetch.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
     response.setHeader('content-type','application/json');response.end(JSON.stringify({blocks:hashes.filter(hash=>fixture.wire.has(hash)).map(hash=>({hash,data:fixture.wire.get(hash)!})),missing:hashes.filter(hash=>!fixture.wire.has(hash)),deferred:[]}));
    }catch{response.statusCode=400;response.end('{}');}return;
   }
   vite!.middlewares(request,response);
  });
  http.listen(0,'127.0.0.1');await once(http,'listening');const address=http.address();if(!address||typeof address==='string')throw Error('candidate_origin_missing');const origin=`http://127.0.0.1:${address.port}`;
  await page.route('**/*',async route=>{
   if(new URL(route.request().url()).origin!==origin){await route.abort('blockedbyclient');return;}
   if(route.request().resourceType()==='document'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Isolated normal sync regression</body></html>'});return;}await route.continue();
  });
  await page.goto(origin);
  const measured=await page.evaluate(async({storeUrl,syncUrl,adapterUrl,draftUrl,owner,scenario})=>{
   const store=await import(/* @vite-ignore */ storeUrl),sync=await import(/* @vite-ignore */ syncUrl),adapters=await import(/* @vite-ignore */ adapterUrl),drafts=await import(/* @vite-ignore */ draftUrl);
   const originalIdentity=await store.openLibrary();await store.writeLibraryState(async(tx:any)=>tx.put('meta','service-owner',owner));
   const adapter=await adapters.sqliteRecordAdapter(),original=adapter.replicaCandidate.bind(adapter),originalCommit=adapter.commit.bind(adapter);
   const phaseMs:Record<string,number>={},phaseCalls:Record<string,number>={};
   const timedReplica=async(message:any)=>{const started=performance.now();try{return await original(message);}finally{phaseMs[message.kind]=(phaseMs[message.kind]??0)+performance.now()-started;phaseCalls[message.kind]=(phaseCalls[message.kind]??0)+1;}};
   adapter.commit=async(mutation:any)=>{const started=performance.now();try{return await originalCommit(mutation);}finally{if(mutation.replicaCandidateRestore)phaseMs.promotion=(phaseMs.promotion??0)+performance.now()-started;}};
   let validationRequests=0,writingDuringValidation=false,validationInvalidatedByWrite=false,writeMs=0,localDraftId:string|undefined;
   adapter.replicaCandidate=async(message:any)=>{
    if(scenario!=='write-during-validation'||message.kind!=='validate')return timedReplica(message);
    validationRequests++;
    let settled=false;const validation=timedReplica(message).then((result:any)=>{settled=true;return {result};},(error:Error)=>{settled=true;return {error};});
    localDraftId=crypto.randomUUID();const started=performance.now();
    await drafts.saveDraft(crypto.randomUUID(),{id:localDraftId,expectedRevision:0,text:'A user write while cloud validation runs.'});writeMs=performance.now()-started;writingDuringValidation=!settled;
    const outcome=await validation;validationInvalidatedByWrite=outcome.error?.message==='library_sync_local_changed';if(outcome.error)throw outcome.error;return outcome.result;
   };
   let tick=performance.now(),maxMainThreadGapMs=0;const timer=setInterval(()=>{const now=performance.now();maxMainThreadGapMs=Math.max(maxMainThreadGapMs,now-tick);tick=now;},16),started=performance.now();
   let error:string|undefined;
   try{await sync.synchronizeLibrary(async(path:string,body?:unknown)=>{const response=await fetch('/candidate'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw Error('controlled_transport_failed');return response.json();});}catch(cause){error=cause instanceof Error?cause.message:String(cause);}
   finally{clearInterval(timer);adapter.replicaCandidate=original;adapter.commit=originalCommit;}
   return {originalIdentity,error,validationRequests,writingDuringValidation,validationInvalidatedByWrite,writeMs,localDraftId,phaseMs,phaseCalls,durationMs:performance.now()-started,maxMainThreadGapMs,state:await sync.readCloudSync(),count:await store.readLibrary((tx:any)=>tx.count('drafts')),identity:await store.readLibrary((tx:any)=>tx.get('meta','identity'))};
  },{storeUrl,syncUrl,adapterUrl,draftUrl,owner,scenario});
  expect(fixture.logicalBytes).toBeGreaterThan(64*1024*1024);
  await testInfo.attach('normal-staged-restore-evidence',{contentType:'application/json',body:JSON.stringify({scenario,browser:browser.version(),fixture:'5000 valid synthetic Drafts; controlled loopback HTTP; real normal synchronizer/Worker/OPFS, no PostgreSQL or account UI',logicalBytes:fixture.logicalBytes,...measured,paidCalls:0})});
  if(scenario==='restore'){
   expect(measured.error).toBeUndefined();expect(measured.count).toBe(5000);expect(measured.state.status).toBe('synced');expect(measured.identity).toEqual({...identity,deviceId:measured.originalIdentity.deviceId});
   await page.reload();
   const restored=await page.evaluate(async({storeUrl,syncUrl,first,last})=>{
    const store=await import(/* @vite-ignore */ storeUrl),sync=await import(/* @vite-ignore */ syncUrl);const identity=await store.openLibrary();
    return {identity,state:await sync.readCloudSync(),count:await store.readLibrary((tx:any)=>tx.count('drafts')),first:await store.readLibrary((tx:any)=>tx.get('drafts',(first as any).id)),last:await store.readLibrary((tx:any)=>tx.get('drafts',(last as any).id))};
   },{storeUrl,syncUrl,first:fixture.first,last:fixture.last});
   expect(restored.identity).toEqual(measured.identity);expect(restored.count).toBe(5000);expect(restored.first).toEqual(fixture.first);expect(restored.last).toEqual(fixture.last);expect(restored.state.status).toBe('synced');
  }else{
   // The write can invalidate and finish validation before its own Promise
   // resolves. A rejected fence proves concurrent progress, unlike waiting for
   // a successful validation behind a shared Library Web Lock.
   expect(measured.validationRequests).toBe(1);expect(measured.validationInvalidatedByWrite).toBe(true);expect(measured.error).toBe('library_sync_local_changed');expect(measured.count).toBe(1);expect(measured.identity).toEqual(measured.originalIdentity);expect(measured.state.status).toBe('pending');
   expect(await page.evaluate(async storeUrl=>{const store=await import(/* @vite-ignore */ storeUrl);return store.readLibrary(async(tx:any)=>(await tx.syncBaseReferences()).length);},storeUrl)).toBe(0);
  }
 }finally{await context.close();if(http)await new Promise<void>((resolve,reject)=>http!.close(error=>error?reject(error):resolve()));await vite?.close();}
});
