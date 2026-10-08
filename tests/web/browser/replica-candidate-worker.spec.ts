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
