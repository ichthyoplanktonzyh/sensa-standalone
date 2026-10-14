import {test,expect,type Page} from '@playwright/test';
import {createLibraryCloudBrowserFixture,type LibraryCloudBrowserFixture} from '../support/libraryCloudBrowserFixture.mts';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {stableUuid,canonicalJsonDigest} from '@sensa/learning-kernel';
import {encodeLibrarySyncBlock,splitLibrarySyncText} from '@sensa/contracts/sensa/library-sync-blocks';
import {decodeBackupValue,encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';

let fixture:LibraryCloudBrowserFixture;
test.beforeAll(async({browser})=>{fixture=await createLibraryCloudBrowserFixture(browser,resolve('scripts/support/deltaReceiveTestBrowserEntry.ts'),[{name:'delta-test-worker',enforce:'pre',transform(code,id){if(id.endsWith('/apps/web/src/data/library/sqliteAdapter.ts'))return code.replace('new URL("./sqliteWorker.ts", import.meta.url)', 'new URL("../../../../../scripts/support/deltaReceiveTestWorker.ts", import.meta.url)');}}]);});
test.afterAll(async()=>fixture?.close());
test.setTimeout(120000);
const settle=async(page:Page,targetId:string,finish=true)=>{
 const at=await page.evaluate(async id=>{const c=(window as any).core,target=await c.readLibrary((tx:any)=>tx.get('learningTargets',id));return new Date(Math.max(Date.now(),target.memory?.dueAt.getTime()??Date.now())).toISOString();},targetId);
 await page.clock.setFixedTime(new Date(at));
 return page.evaluate(async({targetId,at,finish})=>{const c=(window as any).core,context=(await c.languageRoutesSnapshot()).context;let run=await c.startLearning(crypto.randomUUID(),targetId,context,20,at);run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'reveal'},at);run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'rate',rating:'good'},at);if(finish)await c.finishLearning(crypto.randomUUID(),run.id);return {id:run.id,purpose:run.purpose};},{targetId,at,finish});
};
const setup=async(extra=false)=>{
 const account=await fixture.createAccount(),a=await fixture.createClient(account),b=await fixture.createClient(account);
 await a.clock.setFixedTime(new Date('2026-10-01T08:00:00Z'));
 const source=portablePackageFixture({packageId:crypto.randomUUID(),expression:'borrow',audioByteLength:32});
 const targetId=await a.evaluate(async bytes=>{const c=(window as any).core,data=new Uint8Array(bytes),preview=await c.contentSupplySystem.execute({kind:'preview_portable_package',bytes:data}),pack=await c.contentSupplySystem.execute({kind:'install_portable_package',bytes:data,expectedArchiveDigest:preview.archiveDigest}),context=(await c.languageRoutesSnapshot()).context;await c.confirmLearningQuantity(crypto.randomUUID(),context,20);return (await c.enrollPackage(crypto.randomUUID(),pack.key,context))[0];},[...source.bytes]);
 await settle(a,targetId);
 let extraTargetId:string|undefined;
 if(extra){const pack=portablePackageFixture({packageId:crypto.randomUUID(),expression:'return',audioByteLength:32});extraTargetId=await a.evaluate(async bytes=>{const c=(window as any).core,data=new Uint8Array(bytes),preview=await c.contentSupplySystem.execute({kind:'preview_portable_package',bytes:data}),pack=await c.contentSupplySystem.execute({kind:'install_portable_package',bytes:data,expectedArchiveDigest:preview.archiveDigest});return(await c.enrollPackage(crypto.randomUUID(),pack.key,(await c.languageRoutesSnapshot()).context))[0];},[...pack.bytes]);await settle(a,extraTargetId!);}
 const other=portablePackageFixture({packageId:crypto.randomUUID(),expression:'lend',audioByteLength:32});
 const otherId=await a.evaluate(async bytes=>{const c=(window as any).core,data=new Uint8Array(bytes),preview=await c.contentSupplySystem.execute({kind:'preview_portable_package',bytes:data}),pack=await c.contentSupplySystem.execute({kind:'install_portable_package',bytes:data,expectedArchiveDigest:preview.archiveDigest}),context=(await c.languageRoutesSnapshot()).context;return (await c.enrollPackage(crypto.randomUUID(),pack.key,context))[0];},[...other.bytes]);
 await settle(a,otherId,false);await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
 const restoredSource=await fixture.createClient(account);await restoredSource.clock.setFixedTime(new Date('2026-10-02T08:00:00Z'));await restoredSource.evaluate(()=>(window as any).sync());await a.context().close();
 return {account,a:restoredSource,b,targetId,extraTargetId};
};
const facts=(page:Page)=>page.evaluate(async()=>{const c=(window as any).core,identity=await c.readLibrary((tx:any)=>tx.get('meta','identity'));return c.readLibrary(async(tx:any)=>{const rows:any[]=[];for(const table of c.libraryTables)for(const row of await tx.entries(table)){if(!c.isReplicatedLibraryEntry(table,row.key))continue;const entry=c.normalizeLibraryReplicaEntry({table,key:row.key,value:row.value},identity);rows.push([table,row.key,c.encodeBackupValue(entry.value)]);}return rows.sort((a,b)=>JSON.stringify(a.slice(0,2)).localeCompare(JSON.stringify(b.slice(0,2))));});});

test('a complete nine-key retention review receives through a certified sparse overlay and survives reopen',async()=>{
 const {a,b,targetId}=await setup();
 try{
  const review=await settle(a,targetId);expect(review.purpose).toBe('retention_review');await a.evaluate(()=>(window as any).sync());
  fixture.clearRequests();await b.evaluate(()=>(window as any).sync());
  const state=await b.evaluate(()=>(window as any).core.readCloudSync());
  expect(state.receive.mode).toBe('incremental');expect(state.receive.changedRecords).toBe(9);expect(state.receive.baselineBuildRecords).toBe(0);expect(state.receive.targets).toBe(2);expect(state.receive.runs).toBe(3);expect(state.receive.scopes).toBe(1);expect(state.receive.sessions).toBe(2);
  expect(state.receive.changedEventClosure).toEqual({baselineLookups:2,candidateLookups:2,runLookups:3,indexedRelations:2,edgeVisits:2});
  expect(fixture.requests().some(row=>row.path.includes('/snapshot'))).toBe(false);expect(await facts(b)).toEqual(await facts(a));
  await b.evaluate(async()=>{const c=(window as any).core,rows=await c.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(c.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));rows.operations=rows.operations.filter((row:any)=>!JSON.parse(row.value.input).kind.startsWith('service.'));c.validateBackupRows(rows);});
  await b.reload();const reopened=await b.evaluate(async()=>{const path='/core.js',c=await import(/* @vite-ignore */path);await c.openLibrary();return c.readCloudSync();});expect(reopened.receive.mode).toBe('incremental');expect(reopened.restoreOperationId).toBe(state.restoreOperationId);
 }finally{await a.context().close();await b.context().close();}
});

const testRpc=(page:Page,command:string)=>page.evaluate(command=>(window as any).deltaTest(command),command);
test('private account accounting and a no-change ACK do not invalidate the certified baseline',async()=>{
 const {a,b}=await setup();try{
  const before=await testRpc(b,'snapshot');
  await b.evaluate(async()=>{const c=(window as any).core;await c.command({id:crypto.randomUUID(),kind:'service.installation',input:{}},(tx:any)=>{tx.put('meta','service-installation',crypto.randomUUID());return null;});await c.command({id:crypto.randomUUID(),kind:'service.local-access',input:{}},(tx:any)=>{tx.put('meta','signed-out',false);return null;});});
  await b.evaluate(()=>(window as any).sync());const ack=await testRpc(b,'snapshot');expect(ack.revision).toBe(before.revision+2);expect(ack.base).toEqual(before.base);expect(ack.certificate).toEqual(before.certificate);
  await a.evaluate(async()=>{const c=(window as any).core;await c.confirmLearningQuantity(crypto.randomUUID(),(await c.languageRoutesSnapshot()).context,30);});await a.evaluate(()=>(window as any).sync());fixture.clearRequests();await b.evaluate(()=>(window as any).sync());
  const state=await b.evaluate(()=>(window as any).core.readCloudSync());expect(state.receive.mode).toBe('incremental');expect(state.receive.changedRecords).toBe(1);expect(state.receive.baselineBuildRecords).toBe(0);expect(fixture.requests().some(row=>row.path.includes('/snapshot'))).toBe(false);expect(await facts(b)).toEqual(await facts(a));
 }finally{await a.context().close();await b.context().close();}
});
for(const fault of ['bad-certificate','missing-certificate','lost-edge'] as const)test(`untrusted dependency cache ${fault} falls back to complete admission`,async()=>{
 const {a,b,targetId}=await setup();try{await settle(a,targetId);await a.evaluate(()=>(window as any).sync());await testRpc(b,fault);await b.evaluate(()=>(window as any).sync());const state=await b.evaluate(()=>(window as any).core.readCloudSync());expect(state.receive.mode).toBe('complete');expect(state.receive.fallbackReason).toBe('uncertified_baseline');expect(await facts(b)).toEqual(await facts(a));}finally{await a.context().close();await b.context().close();}
});
for(const fault of ['drift-after-begin','fail-commit'] as const)test(`certified receive ${fault} preserves facts, baseline and cursor then retries`,async()=>{
 const {a,b,targetId}=await setup();try{await settle(a,targetId);await a.evaluate(()=>(window as any).sync());const before=await facts(b),stored=await testRpc(b,'snapshot'),state=await b.evaluate(()=>(window as any).core.readCloudSync());await testRpc(b,fault);await expect(b.evaluate(()=>(window as any).sync())).rejects.toThrow();expect(await facts(b)).toEqual(before);const after=await testRpc(b,'snapshot');expect(after.base).toEqual(stored.base);expect(after.revision).toBe(stored.revision);expect((await b.evaluate(()=>(window as any).core.readCloudSync())).revision).toBe(state.revision);if(fault==='fail-commit')expect(after.certificate).toEqual(stored.certificate);await b.evaluate(()=>(window as any).sync());expect(await facts(b)).toEqual(await facts(a));}finally{await a.context().close();await b.context().close();}
});
test('a lost local commit acknowledgement and duplicate pull retain one atomic increment',async()=>{
 const {a,b,targetId}=await setup();try{await settle(a,targetId);await a.evaluate(()=>(window as any).sync());const before=await testRpc(b,'snapshot');await testRpc(b,'lose-ack');await b.evaluate(()=>(window as any).sync());expect(await b.evaluate(()=>(window as any).deltaLostAck)).toBe(true);expect(await facts(b)).toEqual(await facts(a));const committed=await testRpc(b,'snapshot');expect(committed.revision).toBe(before.revision+1);await b.evaluate(()=>(window as any).sync());expect(await testRpc(b,'snapshot')).toEqual(committed);}finally{await a.context().close();await b.context().close();}
});
test('a real local edit during certified validation retires the candidate and preserves the edit',async()=>{
 const {a,b,targetId}=await setup();try{await settle(a,targetId);await a.evaluate(()=>(window as any).sync());const before=await testRpc(b,'snapshot');await testRpc(b,'pause-validation');const pending=b.evaluate(()=>(window as any).sync());const rejected=expect(pending).rejects.toThrow('library_sync_local_changed');await b.waitForFunction(()=>(window as any).deltaBarrier===true);const draft=await b.evaluate(()=>(window as any).core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Preserved during delta validation.'}));await testRpc(b,'release');await rejected;const after=await testRpc(b,'snapshot');expect(after.base).toEqual(before.base);expect(after.revision).toBe(before.revision+1);expect(await b.evaluate(id=>(window as any).core.readLibrary((tx:any)=>tx.get('drafts',id)),draft.id)).toEqual(draft);}finally{await a.context().close();await b.context().close();}
});
test('a damaged baseline cannot enter source facts through complete fallback',async()=>{
 const {a,b,targetId}=await setup();try{
  await settle(a,targetId);await a.evaluate(()=>(window as any).sync());await testRpc(b,'corrupt-baseline');const before=await facts(b),stored=await testRpc(b,'snapshot');
  await expect(b.evaluate(()=>(window as any).sync())).rejects.toThrow();expect(await facts(b)).toEqual(before);expect(await testRpc(b,'snapshot')).toEqual(stored);
 }finally{await a.context().close();await b.context().close();}
});
for(const change of ['owner','signout','epoch','cancel'] as const)test(`a ${change} during remote-only validation prevents atomic promotion`,async()=>{
 const {a,b,targetId}=await setup();try{
  await settle(a,targetId);await a.evaluate(()=>(window as any).sync());const before=await facts(b),stored=await testRpc(b,'snapshot');await testRpc(b,'pause-validation');
  const pending=b.evaluate(async()=>{const w=window as any;w.deltaAbort=new AbortController();return w.core.synchronizeLibrary(w.request,{signal:w.deltaAbort.signal});});const rejected=expect(pending).rejects.toThrow();
  await b.waitForFunction(()=>(window as any).deltaBarrier===true);
  await b.evaluate(async change=>{const w=window as any,c=w.core;if(change==='cancel'){w.deltaAbort.abort();return;}await c.writeLibraryState(async(tx:any)=>{if(change==='owner')tx.put('meta','service-owner',{...await tx.get('meta','service-owner'),subject:crypto.randomUUID()});else if(change==='epoch')tx.put('meta','service-signout-epoch',crypto.randomUUID());else tx.put('meta','signed-out',true);});},change);
  await testRpc(b,'release');await rejected;expect(await facts(b)).toEqual(before);const after=await testRpc(b,'snapshot');expect(after.base).toEqual(stored.base);expect(after.revision).toBe(stored.revision);
 }finally{await a.context().close();await b.context().close();}
});

type WireRow=[string,string,any];
const restoreOracle=(page:Page,wire:WireRow[])=>page.evaluate(wire=>{const c=(window as any).core,rows=Object.fromEntries(c.libraryTables.map((table:string)=>[table,[]]));for(const [table,key,value]of wire)rows[table].push({key,value:c.decodeBackupValue(value)});c.validateRestoreBackupRows(rows);},wire);
const publishWirePatch=async(account:{token:string},page:Page,wire:WireRow[],extraKeys:Array<[string,string]>=[])=>{
 const changes=await page.evaluate(async()=>{const c=(window as any).core,state=await c.readCloudSync();return c.readLibrary(async(tx:any)=>(await tx.changesSince(state.syncedLocalRevision,c.libraryTables)).filter((row:any)=>c.isReplicatedLibraryEntry(row.table,row.key)).map((row:any)=>[row.table,row.key]));});
 const selected=new Map([...changes,...extraKeys].map(([table,key]:string[])=>[JSON.stringify([table,key]),[table,key]])),byKey=new Map(wire.map(row=>[JSON.stringify(row.slice(0,2)),row]));
 const blocks=new Map<string,string>(),pack=(text:string)=>splitLibrarySyncText(text).map(text=>{const data=encodeLibrarySyncBlock(text),hash=createHash('sha256').update(data).digest('hex');blocks.set(hash,data);return hash;});
 const identity=decodeBackupValue(wire.find(row=>row[0]==='meta'&&row[1]==='identity')![2]),patch=pack(JSON.stringify({version:1,libraryId:identity.id,learnerId:identity.learnerId,changes:[...selected.values()].map(([table,key])=>{const row=byKey.get(JSON.stringify([table,key]));return {table,key,blocks:row?pack(JSON.stringify(row[2])):null};})}));
 const request=async(path:string,body:any)=>{const response=await fetch(fixture.origin+'/sensa/library-sync'+path,{method:'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json'},body:JSON.stringify(body)});const value=await response.json();expect(response.ok,JSON.stringify(value)).toBe(true);return value;};
 const values=[...blocks].map(([hash,data])=>({hash,data}));for(let i=0;i<values.length;i+=16)await request('/blocks/store',{blocks:values.slice(i,i+16)});
 const state=await page.evaluate(()=>(window as any).core.readCloudSync());await request('/commit',{operationId:crypto.randomUUID(),baseRevision:state.revision,patch});
};
const rebindProtocol=(wire:WireRow[],runId:string,protocolId:string)=>{
 const copy=wire.map(row=>[row[0],row[1],encodeBackupValue(decodeBackupValue(row[2]))] as WireRow),runRow=copy.find(row=>row[0]==='learningRuns'&&row[1]===runId)!,run:any=decodeBackupValue(runRow[2]),participant:any=run.participants[run.targetId],target:any=decodeBackupValue(copy.find(row=>row[0]==='learningTargets'&&row[1]===run.targetId)![2]);
 const replace=new Map<string,string>([[participant.protocolRunId,protocolId]]);
 for(const [hash,material]of Object.entries(participant.materializations) as Array<[string,any]>){const provenance=material.snapshot.provenance,sourceId=stableUuid(`sensa-material:${target.identity.learnerUserId}:${provenance.packageKey}:${target.id}${typeof provenance.curriculumMembershipId==='string'?':'+provenance.curriculumMembershipId:''}${typeof provenance.materializationOperationId==='string'?':'+provenance.materializationOperationId:''}`);replace.set(material.snapshot.learningMaterializationId,stableUuid(`local-run-materialization:${protocolId}:${sourceId}`));const changed=structuredClone(material);changed.snapshot.learningMaterializationId=replace.get(material.snapshot.learningMaterializationId);replace.set(hash,canonicalJsonDigest(encodeBackupValue(changed)));}
 const rewrite=(value:any):any=>typeof value==='string'?replace.get(value)??value:value instanceof Date?value:Array.isArray(value)?value.map(rewrite):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,value])=>[replace.get(key)??key,rewrite(value)])):value;
 for(const row of copy){const value:any=decodeBackupValue(row[2]);if(row===runRow||row[0]==='learningEvents'&&value.runId===runId)row[2]=encodeBackupValue(rewrite(value));}return copy;
};
for(const fault of ['cross-target-event','broken-session-switch','old-run-pin','global-protocol-collision'] as const)test(`hash-valid remote ${fault} is rejected against the certified baseline without partial promotion`,async()=>{
 const {account,a,b,targetId,extraTargetId}=await setup(fault==='global-protocol-collision');try{
  const before=await facts(b),stored=await testRpc(b,'snapshot'),state=await b.evaluate(()=>(window as any).core.readCloudSync()),review=await settle(a,targetId);let wire=await facts(a) as WireRow[];const extraKeys:Array<[string,string]>=[];
  if(fault==='global-protocol-collision'){
   await restoreOracle(b,rebindProtocol(wire,review.id,crypto.randomUUID()));
   const foreign:any=decodeBackupValue(wire.find(row=>row[0]==='learningRuns'&&decodeBackupValue(row[2]).targetId===extraTargetId)![2]);wire=rebindProtocol(wire,review.id,foreign.participants[extraTargetId!].protocolRunId);
  }else if(fault==='cross-target-event'){const row=wire.find(row=>row[0]==='learningEvents'&&decodeBackupValue(row[2]).runId===review.id)!,event:any=decodeBackupValue(row[2]);event.targetId=wire.find(row=>row[0]==='learningTargets'&&row[1]!==targetId)![1];row[2]=encodeBackupValue(event);}
  else if(fault==='broken-session-switch'){const row=wire.find(row=>row[0]==='learningSessions'&&decodeBackupValue(row[2]).endReason==='session_switch')!,session:any=decodeBackupValue(row[2]);session.endedByOperationId=crypto.randomUUID();row[2]=encodeBackupValue(session);}
  else{const row=wire.find(row=>row[0]==='learningRuns'&&decodeBackupValue(row[2]).targetId===targetId&&row[1]!==review.id)!,run:any=decodeBackupValue(row[2]);run.participants[targetId].material='f'.repeat(64);row[2]=encodeBackupValue(run);extraKeys.push([row[0],row[1]]);}
  await expect(restoreOracle(b,wire)).rejects.toThrow();await publishWirePatch(account,a,wire,extraKeys);await expect(b.evaluate(()=>(window as any).sync())).rejects.toThrow();expect(await facts(b)).toEqual(before);const after=await testRpc(b,'snapshot');expect(after).toEqual(stored);expect((await b.evaluate(()=>(window as any).core.readCloudSync())).revision).toBe(state.revision);
 }finally{await a.context().close();await b.context().close();}
});

test('ordinary quantity confirmation accompanying a review stays incremental and invalid quantity is rejected',async()=>{
 const {account,a,b,targetId}=await setup();try{
  await a.evaluate(async()=>{const c=(window as any).core;await c.confirmLearningQuantity(crypto.randomUUID(),(await c.languageRoutesSnapshot()).context,20);});await settle(a,targetId);await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());const state=await b.evaluate(()=>(window as any).core.readCloudSync());expect(state.receive.mode).toBe('incremental');expect(state.receive.changedRecords).toBe(10);expect(state.receive.baselineBuildRecords).toBe(0);expect(await facts(b)).toEqual(await facts(a));await restoreOracle(b,await facts(b));
  const before=await facts(b),stored=await testRpc(b,'snapshot');await a.evaluate(async()=>{const c=(window as any).core;await c.confirmLearningQuantity(crypto.randomUUID(),(await c.languageRoutesSnapshot()).context,20);});const wire=await facts(a) as WireRow[],row=wire.find(row=>row[0]==='settings'&&row[1]==='language-route-study-plans')!,plans:any=decodeBackupValue(row[2]);Object.values(plans).forEach((plan:any)=>plan.dailyNewSenseLimit=101);row[2]=encodeBackupValue(plans);await expect(restoreOracle(b,wire)).rejects.toThrow();await publishWirePatch(account,a,wire);await expect(b.evaluate(()=>(window as any).sync())).rejects.toThrow();expect(await facts(b)).toEqual(before);expect(await testRpc(b,'snapshot')).toEqual(stored);
 }finally{await a.context().close();await b.context().close();}
});

test('actual Worker serves a nonempty history projection while cooperative encoding prepares the next atomic state',async()=>{
 const {a,b,targetId}=await setup();try{
  const read=()=>b.evaluate(async()=>{const w=window as any,c=w.core,value=await c.learningSystem.read({kind:'history',languageContext:(await c.languageRoutesSnapshot()).context,filter:{surface:'study',range:'all',start:'',end:'',kind:'all',languageChoice:null},limit:20});return {total:value.total,rows:value.records.length,preparing:!w.deltaPreparationDone};});
  const before=await read();expect(before.rows).toBeGreaterThan(0);await settle(a,targetId);await a.evaluate(()=>(window as any).sync());await testRpc(b,'cooperative-preparation');
  const pending=b.evaluate(()=>(window as any).sync());await b.waitForFunction(()=>(window as any).deltaCooperative?.outsideTransaction);
  const during=await read();expect(during.preparing).toBe(true);expect(during.total).toBe(before.total);expect(during.rows).toBe(before.rows);
  await pending;const after=await read();expect(after.preparing).toBe(false);expect(after.total).toBe(before.total+1);expect(await facts(b)).toEqual(await facts(a));
 }finally{await a.context().close();await b.context().close();}
});


test('ordinary review start, next action and completion during preparation survive rejection and reopen',async()=>{
 const {a,b,targetId}=await setup();try{
  await settle(a,targetId);await a.evaluate(()=>(window as any).sync());const before=await testRpc(b,'snapshot');await testRpc(b,'cooperative-preparation');
  const pending=b.evaluate(()=>(window as any).sync()),rejected=expect(pending).rejects.toThrow();await b.waitForFunction(()=>(window as any).deltaCooperative?.outsideTransaction);
  const local=await settle(b,targetId);expect(local.purpose).toBe('retention_review');await rejected;
  const after=await testRpc(b,'snapshot');expect(after.base).toEqual(before.base);expect(after.revision).toBeGreaterThan(before.revision);
  const retained=await facts(b);expect(retained.filter((row:any)=>row[0]==='learningRuns'&&row[1]===local.id)).toHaveLength(1);
  expect(retained.filter((row:any)=>row[0]==='learningEvents'&&decodeBackupValue(row[2]).runId===local.id)).toHaveLength(2);
  await b.reload();await b.evaluate(async()=>{const path='/core.js',c=await import(/* @vite-ignore */path);(window as any).core=c;await c.openLibrary();});expect(await facts(b)).toEqual(retained);
 }finally{await a.context().close();await b.context().close();}
});
