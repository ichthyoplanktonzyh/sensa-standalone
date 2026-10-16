import {test,expect,type Page} from '@playwright/test';
import {createLibraryCloudBrowserFixture} from '../support/libraryCloudBrowserFixture.mts';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {mergeLibraryReplicas,isReplicatedLibraryEntry,normalizeLibraryReplicaEntry,replicaEntryId,type LibraryReplicaEntry} from '../../../apps/web/src/data/library/replication/libraryReplica';
import {semanticLookupPayload} from '../support/semanticLookupFixtures';
import {decodeBackupValue,encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';

for(const pendingKind of ['draft','context'] as const)test(`below-floor dirty recovery preserves two real learning branches and pending ${pendingKind} through lost ACK and reload`,async({browser})=>{
 test.setTimeout(180000);const f=await createLibraryCloudBrowserFixture(browser);
 const bodies=(entries:LibraryReplicaEntry[])=>entries.map(({table,key,value})=>({table,key,value})).sort((a,b)=>replicaEntryId(a).localeCompare(replicaEntryId(b)));
 const snapshot=async(page:Page)=>{
  const rows=await page.evaluate(async()=>{const c=(window as any).core;return c.readLibrary(async(tx:any)=>{const rows=[];for(const table of c.libraryTables)for(const row of await tx.entries(table))rows.push({table,key:row.key,value:c.encodeBackupValue(row.value)});return rows;});});
  const identity=decodeBackupValue(rows.find((row:any)=>row.table==='meta'&&row.key==='identity').value);
  return rows.filter((row:any)=>isReplicatedLibraryEntry(row.table,row.key)).map((row:any)=>({...row,value:encodeBackupValue(normalizeLibraryReplicaEntry({...row,value:decodeBackupValue(row.value)},identity).value)})) as LibraryReplicaEntry[];
 };
 const settle=async(page:Page,targetId:string,rating:string,offset=0)=>{
  const at=await page.evaluate(async({targetId,offset})=>{const target=(await (window as any).core.readLearning()).targets.find((row:any)=>row.id===targetId);return new Date((target.memory?.dueAt.getTime()??Date.now())+offset).toISOString();},{targetId,offset});await page.clock.setFixedTime(new Date(at));
  return page.evaluate(async({targetId,at,rating})=>{const c=(window as any).core,ctx=(await c.languageRoutesSnapshot()).context;let run=await c.startLearning(crypto.randomUUID(),targetId,ctx,20,at);run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'reveal'},at);run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'rate',rating},at);await c.finishLearning(crypto.randomUUID(),run.id);return run.id;},{targetId,at,rating});
 };
 try{
  const account=await f.createAccount(),a=await f.createClient(account),b=await f.createClient(account);await a.clock.setFixedTime(new Date('2026-10-01T08:00:00Z'));
  const source=portablePackageFixture({packageId:crypto.randomUUID(),expression:'borrow',audioByteLength:32});
  const pack=await a.evaluate(async bytes=>{const c=(window as any).core,data=new Uint8Array(bytes),preview=await c.contentSupplySystem.execute({kind:'preview_portable_package',bytes:data});return c.contentSupplySystem.execute({kind:'install_portable_package',bytes:data,expectedArchiveDigest:preview.archiveDigest});},[...source.bytes]);
  const targetId=await a.evaluate(async pack=>{const c=(window as any).core,ctx=(await c.languageRoutesSnapshot()).context;await c.confirmLearningQuantity(crypto.randomUUID(),ctx,20);return (await c.enrollPackage(crypto.randomUUID(),pack.key,ctx))[0];},pack);
  const meaningId=pendingKind==='context'?await a.evaluate(async payload=>(await (window as any).core.semanticIntakeModule.submit(payload)).personalMeaningId,semanticLookupPayload()):undefined;
  const initial=await settle(a,targetId,'good');await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());await b.evaluate(pack=>(window as any).core.writeLibraryCache((tx:any)=>tx.put('packageCache',pack.key,pack)),pack);
  const baseline=await a.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.syncBaseEntries())),cursor=(await a.evaluate(()=>(window as any).core.readCloudSync())).revision;
  const runA=await settle(a,targetId,'good'),runB=await settle(b,targetId,'hard',60000);
  const pending=pendingKind==='draft'?await a.evaluate(()=>(window as any).core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Unpublished context kept through floor recovery'})):await a.evaluate(async personalMeaningId=>{const c=(window as any).core;await c.journeyGateway.reviseContext({operationId:crypto.randomUUID(),personalMeaningId,expectedRevision:1,blocks:[{kind:'text',bodyText:'Unpublished personal Context kept through floor recovery'}]});return {id:personalMeaningId};},meaningId);
  const ours=await snapshot(a),theirs=await snapshot(b),oracle=mergeLibraryReplicas({base:baseline,local:ours,remote:theirs});expect(oracle.conflicts).toEqual([]);
  await b.evaluate(()=>(window as any).sync());const head=await b.evaluate(async()=>{const w=window as any,head=await w.request('/head');let response=await w.request('/compact',{baseRevision:head.revision});while(response.preparation){const p=response.preparation;response=await w.request('/compact',{baseRevision:p.revision,operationId:p.operationId,page:p.page});}return response;});expect(cursor).toBeLessThan(head.manifest.floor);
  await a.evaluate(async()=>{const w=window as any,adapter=await w.core.sqliteRecordAdapter(),call=adapter.replicaCandidate.bind(adapter);adapter.replicaCandidate=async(...args:any[])=>{const result=await call(...args);if(result.kind==='validated')w.dirtyReceive=result.candidate.receive;return result;};w.failAck=true;});await expect(a.evaluate(()=>(window as any).sync())).rejects.toThrow('lost_ack');const committed=(await a.evaluate(()=>(window as any).request('/head'))).revision;if(pendingKind==='context')expect(await a.evaluate(()=>(window as any).dirtyReceive?.mode)).toBe('incremental');
  await a.reload();await a.evaluate(async account=>{const w=window as any,path='/core.js',c=await import(/* @vite-ignore */path);w.core=c;await c.openLibrary();w.request=async(path:string,body?:unknown)=>{const response=await fetch('/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json','x-sensa-sync-protocol':'sensa-checkpoint-pages-v1'},body:body===undefined?undefined:JSON.stringify(body)}),value=await response.json();if(!response.ok)throw Error(value.code);return value;};w.sync=()=>c.synchronizeLibrary(w.request);},account);
  await a.evaluate(()=>(window as any).sync());expect((await a.evaluate(()=>(window as any).request('/head'))).revision).toBe(committed);await b.evaluate(()=>(window as any).sync());
  expect(bodies(await snapshot(a))).toEqual(bodies(oracle.entries));expect(bodies(await snapshot(b))).toEqual(bodies(oracle.entries));
  const state=await a.evaluate(()=>(window as any).core.readCloudSync());expect(state.status).toBe('synced');expect(state.pending).toBeUndefined();
  const retained=await snapshot(a);expect(retained.filter(row=>row.table==='learningRuns').map(row=>row.key).sort()).toEqual([initial,runA,runB].sort());expect(retained.filter(row=>row.table==='learningEvents')).toHaveLength(6);expect(retained.filter(row=>row.table==='learningReconciliations')).toHaveLength(1);expect(retained.some(row=>row.key===pending.id)).toBe(true);
  for(const row of [...ours,...theirs].filter(row=>row.table==='learningEvents'))expect(retained.find(candidate=>candidate.table===row.table&&candidate.key===row.key)?.value).toEqual(row.value);
  expect(bodies(await a.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.syncBaseEntries())))).toEqual(bodies(retained));
 }finally{await f.close();}
});
