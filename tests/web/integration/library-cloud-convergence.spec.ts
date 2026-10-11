import assert from 'node:assert/strict';
import { test,expect } from '@playwright/test';

import {
  createLibraryCloudBrowserFixture,
  type LibraryCloudBrowserFixture,
} from '../support/libraryCloudBrowserFixture.mts';
import { createRealLibraryConvergenceWorld } from '../support/realLibraryConvergenceWorld.mts';
import {manualMeaningPayload,newManualMeaningDraft} from '../../../apps/web/src/experience/intake/manualMeaning';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';

let fixture: LibraryCloudBrowserFixture;
const worlds = new Set<Awaited<ReturnType<typeof createRealLibraryConvergenceWorld>>>();
test.setTimeout(180_000);

test.beforeAll(async ({browser}) => {
  fixture = await createLibraryCloudBrowserFixture(browser);
});

test.afterEach(async () => {
  await Promise.all([...worlds].map((world) => world.close()));
  worlds.clear();
});

test.afterAll(async () => {
  await fixture?.close();
});

const draftTexts = (drafts: readonly Readonly<{ text: string }>[]): string[] => (
  drafts.map(({ text }) => text).sort((left, right) => left.localeCompare(right))
);

for(const scenario of [
 {name:'equal projections A first',first:'a',rating:'good',extraRun:false,offset:0,stale:false,thirdOffset:0},
 {name:'equal projections B first',first:'b',rating:'good',extraRun:false,offset:0,stale:false,thirdOffset:0},
 {name:'different rating and time',first:'a',rating:'hard',extraRun:false,offset:60_000,stale:false,thirdOffset:0},
 {name:'one branch has two serial Runs',first:'b',rating:'good',extraRun:true,offset:0,stale:false,thirdOffset:0},
 {name:'previous winner survives a third stale client',first:'a',rating:'good',extraRun:false,offset:60_000,stale:true,thirdOffset:30_000},
 {name:'third stale client wins and supersedes the previous decision',first:'b',rating:'good',extraRun:false,offset:60_000,stale:true,thirdOffset:120_000},
] as const)test(`[integration][durability][convergence] completed review branches survive retry and restore: ${scenario.name}`,async()=>{
 const account=await fixture.createAccount(),a=await fixture.createClient(account),b=await fixture.createClient(account);
 let stale:import('@playwright/test').Page|null=null;
 const settle=async(page:import('@playwright/test').Page,targetId:string,rating:string,offset=0)=>{
  const at=await page.evaluate(async({targetId,offset})=>{const t=(await (window as any).core.readLearning()).targets.find((t:any)=>t.id===targetId);return new Date((t.memory?.dueAt.getTime()??Date.now())+offset).toISOString();},{targetId,offset});
  await page.clock.setFixedTime(new Date(at));
  return page.evaluate(async({targetId,at,rating})=>{const c=(window as any).core,ctx=(await c.languageRoutesSnapshot()).context;let run=await c.startLearning(crypto.randomUUID(),targetId,ctx,20,at);const runtime=(await c.learningSystem.read({kind:'runtime',languageContext:ctx})).runtime;if(runtime.kind!=='lightweight')throw Error('Expected ordinary lightweight protocol');run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'reveal'},at);run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'rate',rating},at);await c.finishLearning(crypto.randomUUID(),run.id);return run.id;},{targetId,at,rating});
 };
 const snapshot=(page:import('@playwright/test').Page)=>page.evaluate(async()=>{const c=(window as any).core,s=await c.readLearning();return JSON.parse(JSON.stringify({targets:s.targets,runs:s.runs,events:s.events,decisions:await c.readLibrary((tx:any)=>tx.all('learningReconciliations'))}));});
 try{
  await a.clock.setFixedTime(new Date('2026-10-01T08:00:00Z'));
  const source=portablePackageFixture({packageId:crypto.randomUUID(),expression:'borrow',audioByteLength:32});
  const pack=await a.evaluate(async bytes=>{const c=(window as any).core,data=new Uint8Array(bytes),preview=await c.contentSupplySystem.execute({kind:'preview_portable_package',bytes:data});return c.contentSupplySystem.execute({kind:'install_portable_package',bytes:data,expectedArchiveDigest:preview.archiveDigest});},[...source.bytes]);
  const targetId=await a.evaluate(async pack=>{const c=(window as any).core,ctx=(await c.languageRoutesSnapshot()).context;await c.confirmLearningQuantity(crypto.randomUUID(),ctx,20);const [targetId]=await c.enrollPackage(crypto.randomUUID(),pack.key,ctx),t=(await c.readLearning()).targets.find((t:any)=>t.id===targetId);await c.personalContentSystem.execute({kind:'save_learning_scene',operationId:crypto.randomUUID(),learningTargetId:targetId,languageRouteId:ctx.languageRouteId,curriculumMembershipId:t.curriculumMemberships[0].id,senseId:t.identity.senseId,senseVersionId:t.curriculumMemberships[0].sourcePin.senseVersionId,bindingVersionId:t.curriculumMemberships[0].sourcePin.bindingVersionId,body:'I borrowed an umbrella and returned it the next day.',media:[],expected:null});return targetId;},pack);
  const initial=await settle(a,targetId,'good');await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
  if(scenario.stale){stale=await fixture.createClient(account);await stale.evaluate(()=>(window as any).sync());await stale.evaluate(pack=>(window as any).core.writeLibraryCache((tx:any)=>tx.put('packageCache',pack.key,pack)),pack);}
  // Public material acquisition is a separate boundary. Copy the exact
  // already-validated device cache; learner facts still use real cloud sync.
  await b.evaluate(pack=>(window as any).core.writeLibraryCache((tx:any)=>tx.put('packageCache',pack.key,pack)),pack);
  const runA=await settle(a,targetId,'good'),runB=await settle(b,targetId,scenario.rating,scenario.offset),extra=scenario.extraRun?await settle(b,targetId,'good'):null;
  const branchA=await snapshot(a),branchB=await snapshot(b);
  if(scenario.offset===0&&!scenario.extraRun&&scenario.rating==='good')expect(branchA.targets).toEqual(branchB.targets);
  const first=scenario.first==='a'?a:b,second=scenario.first==='a'?b:a;
  await first.evaluate(()=>(window as any).sync());
  await second.evaluate(()=>{(window as any).failAck=true;});
  await expect(second.evaluate(()=>(window as any).sync())).rejects.toThrow('lost_ack');
  const revision=(await second.evaluate(()=>(window as any).request('/head'))).revision;
  await second.evaluate(()=>(window as any).sync());
  expect((await second.evaluate(()=>(window as any).request('/head'))).revision).toBe(revision);
  await first.evaluate(()=>(window as any).sync());
  let converged=await snapshot(first);
  expect(await snapshot(second)).toEqual(converged);
  expect(converged.runs.map((r:any)=>r.id).sort()).toEqual([initial,runA,runB,...extra?[extra]:[]].sort());
  expect(converged.events).toHaveLength(converged.runs.length*2);
  expect(converged.decisions).toHaveLength(1);
  const decision=converged.decisions[0],winner=decision.appliedRunIds.includes(runA)?branchA:branchB;
  // Preserve the selected device projection instead of serializing reviews.
  expect(converged.targets).toEqual(winner.targets);
  expect(new Set([...decision.appliedRunIds,...decision.historyOnlyRunIds])).toEqual(new Set([runA,runB,...extra?[extra]:[]]));
  for(const before of [...branchA.events,...branchB.events])expect(converged.events.find((e:any)=>e.id===before.id)).toEqual(before);
  expect(await second.evaluate(async()=>{const c=(window as any).core,rows=await c.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(c.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));const decision=rows.learningReconciliations[0].value,event=rows.learningEvents.find((row:any)=>decision.historyOnlyEventIds.includes(row.key));event.value.detail.personalLearningScene.revisionId=crypto.randomUUID();try{c.validateBackupRows(rows);return null;}catch(error){return (error as Error).message;}})).toBe('libraryBackup.errors.inconsistent');
  const fresh=await fixture.createClient(account);
  try{await fresh.evaluate(()=>(window as any).sync());expect(await snapshot(fresh)).toEqual(converged);const backup=await fresh.evaluate(()=>(window as any).core.exportLibraryBackup('review-branch-backup-fixture'));expect(backup.summary.events).toBe(converged.events.length);}finally{await fresh.context().close();}
  if(stale){
   const runC=await settle(stale,targetId,'good',scenario.thirdOffset),branchC=await snapshot(stale),originalDecision=structuredClone(decision);
   await stale.evaluate(()=>(window as any).sync());await first.evaluate(()=>(window as any).sync());await second.evaluate(()=>(window as any).sync());
   converged=await snapshot(first);expect(await snapshot(stale)).toEqual(converged);expect(await snapshot(second)).toEqual(converged);
   expect(converged.decisions).toHaveLength(2);expect(converged.decisions.find((row:any)=>row.id===originalDecision.id)).toEqual(originalDecision);
   const next=converged.decisions.find((row:any)=>row.id!==originalDecision.id);expect(next.supersededDecisionIds).toEqual([originalDecision.id]);
   expect(next.appliedRunIds).toContain(scenario.thirdOffset>scenario.offset?runC:runB);expect(next.historyOnlyRunIds).toContain(runA);
   expect(converged.targets).toEqual(scenario.thirdOffset>scenario.offset?branchC.targets:branchB.targets);
   for(const before of [...branchA.events,...branchB.events,...branchC.events])expect(converged.events.find((e:any)=>e.id===before.id)).toEqual(before);
   const restored=await fixture.createClient(account);try{await restored.evaluate(()=>(window as any).sync());expect(await snapshot(restored)).toEqual(converged);expect((await restored.evaluate(()=>(window as any).core.exportLibraryBackup('third-branch-backup-fixture'))).summary.events).toBe(converged.events.length);}finally{await restored.context().close();}
  }
  await second.reload();
  const reopened=await second.evaluate(async()=>{const path='/core.js',c=await import(/* @vite-ignore */path);await c.openLibrary();return JSON.parse(JSON.stringify(await c.readLearning()));});
  expect(reopened.targets).toEqual(converged.targets);expect(reopened.events).toEqual(converged.events);
 }finally{await stale?.context().close();await a.context().close();await b.context().close();}
});

for(const choice of ['local','remote'] as const)test(`[integration][durability][convergence] a Scene ${choice} choice preserves both original learning histories through edit, retry and restore`,async()=>{
 const account=await fixture.createAccount(),a=await fixture.createClient(account),b=await fixture.createClient(account);
 const facts=(page:import('@playwright/test').Page)=>page.evaluate(async()=>{const c=(window as any).core;return JSON.parse(JSON.stringify({learning:await c.readLearning(),scenes:await c.readLibrary((tx:any)=>tx.entries('annotations'))}));});
 try{
  await a.clock.setFixedTime(new Date('2026-10-01T08:00:00Z'));await b.clock.setFixedTime(new Date('2026-10-01T08:00:00Z'));
  const source=portablePackageFixture({packageId:crypto.randomUUID(),expression:'borrow',audioByteLength:32});
  const pack=await a.evaluate(async bytes=>{const c=(window as any).core,data=new Uint8Array(bytes),preview=await c.contentSupplySystem.execute({kind:'preview_portable_package',bytes:data});return c.contentSupplySystem.execute({kind:'install_portable_package',bytes:data,expectedArchiveDigest:preview.archiveDigest});},[...source.bytes]);
  const seed=await a.evaluate(async pack=>{const c=(window as any).core,ctx=(await c.languageRoutesSnapshot()).context;await c.confirmLearningQuantity(crypto.randomUUID(),ctx,20);const [targetId]=await c.enrollPackage(crypto.randomUUID(),pack.key,ctx),t=(await c.readLearning()).targets.find((t:any)=>t.id===targetId);return {targetId,input:{kind:'save_learning_scene',learningTargetId:targetId,languageRouteId:ctx.languageRouteId,curriculumMembershipId:t.curriculumMemberships[0].id,senseId:t.identity.senseId,senseVersionId:t.curriculumMemberships[0].sourcePin.senseVersionId,bindingVersionId:t.curriculumMemberships[0].sourcePin.bindingVersionId}};},pack);
  await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());await b.evaluate(pack=>(window as any).core.writeLibraryCache((tx:any)=>tx.put('packageCache',pack.key,pack)),pack);
  await a.clock.setFixedTime(new Date('2026-10-01T08:01:00Z'));
  for(const [page,body] of [[a,'The original red umbrella scene'],[b,'The original blue umbrella scene']] as const)await page.evaluate(async({seed,body})=>{const c=(window as any).core,at=new Date().toISOString(),ctx=(await c.languageRoutesSnapshot()).context;let run=await c.startLearning(crypto.randomUUID(),seed.targetId,ctx,20,at);const runtime=(await c.learningSystem.read({kind:'runtime',languageContext:ctx})).runtime;if(runtime.kind!=='lightweight'||runtime.purpose!=='initial_learning')throw Error('Expected shipped initial Scene editor boundary');await c.personalContentSystem.execute({...seed.input,operationId:crypto.randomUUID(),body,media:[],expected:null});run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'reveal'},at);run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'rate',rating:'good'},at);await c.finishLearning(crypto.randomUUID(),run.id);},{seed,body});
  const originalA=await facts(a),originalB=await facts(b);
  await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
  expect((await b.evaluate(()=>(window as any).core.readCloudSync())).status).toBe('conflict');
  await b.evaluate(async choice=>{const c=(window as any).core;await c.resolveCloudSyncConflicts(choice,(await c.readCloudSync()).conflict);},choice);
  await b.evaluate(()=>{(window as any).failAck=true;});await expect(b.evaluate(()=>(window as any).sync())).rejects.toThrow('lost_ack');
  const committedHead=(await b.evaluate(()=>(window as any).request('/head'))).revision;await b.evaluate(()=>(window as any).sync());expect((await b.evaluate(()=>(window as any).request('/head'))).revision).toBe(committedHead);
  await a.evaluate(()=>(window as any).sync());const chosen=await facts(b);expect(await facts(a)).toEqual(chosen);
  const selected=choice==='local'?originalB:originalA,scene=chosen.scenes[0].value;
  expect(scene.sceneId).toBe(selected.scenes[0].value.sceneId);expect(scene.revisions).toEqual(selected.scenes[0].value.revisions);expect(scene.conflictHistory.decisions).toHaveLength(1);expect(scene.conflictHistory.branches).toHaveLength(2);
  for(const before of [originalA,originalB])for(const event of before.learning.events)expect(chosen.learning.events.find((row:any)=>row.id===event.id)).toEqual(event);
  expect(chosen.learning.events).toHaveLength(4);expect(chosen.learning.runs).toHaveLength(2);
  await b.clock.setFixedTime(new Date('2026-10-01T08:02:00Z'));
  await b.evaluate(async seed=>{const c=(window as any).core,scene=await c.personalContentSystem.readScene({kind:'learning_scene',learningTargetId:seed.targetId,languageRouteId:seed.input.languageRouteId});await c.personalContentSystem.execute({...seed.input,operationId:crypto.randomUUID(),body:'Chosen timeline edited after convergence',media:[],expected:c.personalLearningSceneEditBase(scene)});},{...seed});
  await b.evaluate(()=>(window as any).sync());await a.evaluate(()=>(window as any).sync());const edited=await facts(b);expect(await facts(a)).toEqual(edited);expect(edited.scenes[0].value.sceneId).toBe(scene.sceneId);expect(edited.scenes[0].value.revisions[0]).toEqual(scene.revisions[0]);expect(edited.scenes[0].value.conflictHistory).toEqual(scene.conflictHistory);
  expect((await b.evaluate(()=>(window as any).core.exportLibraryBackup('scene-branch-backup-fixture'))).summary.events).toBe(4);
  const fresh=await fixture.createClient(account);try{await fresh.evaluate(()=>(window as any).sync());expect(await facts(fresh)).toEqual(edited);expect((await fresh.evaluate(()=>(window as any).core.exportLibraryBackup('scene-restored-backup-fixture'))).summary.events).toBe(4);}finally{await fresh.context().close();}
  for(const [page,body] of [[a,'Second red branch'],[b,'Second blue branch']] as const){await page.clock.setFixedTime(new Date('2026-10-01T08:03:00Z'));await page.evaluate(async({seed,body})=>{const c=(window as any).core,scene=await c.personalContentSystem.readScene({kind:'learning_scene',learningTargetId:seed.targetId,languageRouteId:seed.input.languageRouteId});await c.personalContentSystem.execute({...seed.input,operationId:crypto.randomUUID(),body,media:[],expected:c.personalLearningSceneEditBase(scene)});},{seed,body});}
  await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());expect((await b.evaluate(()=>(window as any).core.readCloudSync())).status).toBe('conflict');
  await b.evaluate(async choice=>{const c=(window as any).core;await c.resolveCloudSyncConflicts(choice,(await c.readCloudSync()).conflict);await (window as any).sync();},choice);await a.evaluate(()=>(window as any).sync());const twice=await facts(b);expect(await facts(a)).toEqual(twice);expect(twice.scenes[0].value.conflictHistory.decisions).toHaveLength(2);expect(twice.learning.events).toEqual(edited.learning.events);
  const archive=await b.evaluate(async()=>[...(await (window as any).core.exportLibraryBackup('second-scene-choice-backup-fixture')).file]);
  const imported=await fixture.createClient(account);try{expect(await imported.evaluate(()=>(window as any).core.isLibraryBackupDestinationEmpty())).toBe(true);const restored=await imported.evaluate(async bytes=>(window as any).core.restoreLibraryBackup(new Uint8Array(bytes),'second-scene-choice-backup-fixture'),archive);expect(restored.summary.events).toBe(4);expect(await facts(imported)).toEqual(twice);}finally{await imported.context().close();}
  const freshAgain=await fixture.createClient(account);try{await freshAgain.evaluate(()=>(window as any).sync());expect(await facts(freshAgain)).toEqual(twice);await freshAgain.evaluate(()=>(window as any).core.exportLibraryBackup('second-scene-choice-backup-fixture'));}finally{await freshAgain.context().close();}
 }finally{await a.context().close();await b.context().close();}
});

test('[integration][durability][convergence] a Meaning correction decision reaches the other device without discarding either history',async()=>{
 const account=await fixture.createAccount(),a=await fixture.createClient(account),b=await fixture.createClient(account);
 try{
  const payload=manualMeaningPayload({...newManualMeaningDraft(),context:'She asked to borrow my umbrella.',occurrence:'borrow',languageTag:'en',meaning:'暂时借用，随后归还。',usage:'借朋友的伞。'});
  const saved=await a.evaluate(async payload=>{const c=(window as any).core,result=await c.createJourneyModules().semanticIntake.submit(payload);await (window as any).sync();return result;},payload);
  await b.evaluate(()=>(window as any).sync());
  const archivedMedia=await a.evaluate(async id=>{
   const c=(window as any).core,mediaId=crypto.randomUUID(),png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=';
   await c.command({id:crypto.randomUUID(),kind:'fixture.media-upload',input:{mediaId}},(tx:any)=>tx.put('media',mediaId,{mediaId,mediaKind:'image',mimeType:'image/png',dataUrl:'data:image/png;base64,'+png,sizeBytes:atob(png).length,createdAt:new Date().toISOString()}));
   const record=await c.readLibrary((tx:any)=>tx.get('semanticMeanings',id));
   await c.createJourneyModules().personalMeaningJourney.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:id,expectedRevision:record.personalMeaning.currentRevision,blocks:[{kind:'text',bodyText:'She asked to borrow my umbrella.'},{kind:'image',personalMediaObjectId:mediaId}]});return mediaId;
  },saved.personalMeaningId);
  const edit=(page:import('@playwright/test').Page,text:string)=>page.evaluate(async({id,text})=>{
   const c=(window as any).core,detail=await c.worldReadRepository.detail(id),alignment=detail.detail.directAlignments[0],seed=await c.worldReadRepository.correction(id,alignment.personalMeaningAlignmentId),operationId=crypto.randomUUID();
   const request={operationId,personalMeaningId:id,personalMeaningAlignmentId:alignment.personalMeaningAlignmentId,source:seed.source,payload:{...seed.payload,operationId,sense:{...seed.payload.sense,senseKey:crypto.randomUUID(),semanticSpec:{...seed.payload.sense.semanticSpec,coreMeaningFocus:text}},acceptance:{mode:'learner_direct'}}};
   const result=await c.createJourneyModules().personalMeaningJourney.correctPersonalMeaning(request);return {request,result};
  },{id:saved.personalMeaningId,text});
  const branchA=await edit(a,'A: 明天归还雨伞。'),branchB=await edit(b,'B: 周末归还雨伞。');
  const pendingTask=await a.evaluate(async id=>{const c=(window as any).core,source=(await c.worldReadRepository.detail(id)).sources[0],languageContext=(await c.languageRoutesSnapshot()).context,task=await c.enrollPersonal(crypto.randomUUID(),source,languageContext,true);return c.personalLearningTaskSnapshot(task.id);},saved.personalMeaningId);
  await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
  expect((await b.evaluate(()=>(window as any).core.readCloudSync())).status).toBe('conflict');
  await b.evaluate(async()=>{const c=(window as any).core;await c.resolveCloudSyncConflicts('local',(await c.readCloudSync()).conflict);await (window as any).sync();});
  await a.evaluate(()=>(window as any).sync());
  for(const page of [a,b]){
   const result=await page.evaluate(async id=>{const c=(window as any).core;return {sync:await c.readCloudSync(),detail:await c.worldReadRepository.detail(id),record:await c.readLibrary((tx:any)=>tx.get('semanticMeanings',id)),receipts:await c.readLibrary((tx:any)=>tx.entries('semanticReceipts'))};},saved.personalMeaningId);
   if(result.sync.status==='conflict')console.log('Meaning convergence conflict IDs',result.sync.conflict?.records.map((row:any)=>row.id));expect(result.sync.status).toBe('synced');expect(result.detail.detail.directAlignments[0].coreMeaningFocus).toBe('B: 周末归还雨伞。');
   expect(result.record.conflictHistory.branches).toHaveLength(3);
   expect(await page.evaluate(id=>(window as any).core.readLibrary((tx:any)=>tx.isMediaReferenced(id)),archivedMedia)).toBe(true);
   expect(await page.evaluate(id=>(window as any).core.personalLearningTaskSnapshot(id),pendingTask.id)).toEqual(pendingTask);
   const pinned=await page.evaluate(taskId=>(window as any).core.contentSupplySystem.read({kind:'personal_provisioning_source',taskId}),pendingTask.id);
   expect(pinned.reference).toEqual(pendingTask.source);expect(pinned.context.images.some((row:any)=>row.id===archivedMedia)).toBe(true);
   expect(result.detail.detail.alignmentHistory.some((row:any)=>row.personalMeaningAlignmentId===branchA.result.personalMeaningAlignmentId)).toBe(true);
   await expect(page.evaluate(async source=>{const c=(window as any).core;await c.enrollPersonal(crypto.randomUUID(),source,(await c.languageRoutesSnapshot()).context,true);},pinned)).rejects.toThrow('meaningChanged');
   for(const branch of [branchA,branchB]){expect(result.receipts.some((row:any)=>row.key===branch.request.operationId)).toBe(true);expect(result.record.conflictHistory.branches.some((row:any)=>row.record.personalMeaningRevisions.some((revision:any)=>revision.personalMeaningRevisionId===branch.result.personalMeaningRevisionId))).toBe(true);}
  }
  const resumed=await a.evaluate(async taskId=>{
   const c=(window as any).core,source=await c.contentSupplySystem.read({kind:'personal_provisioning_source',taskId});
   await c.stopPersonalPreparation(crypto.randomUUID(),taskId);
   const stopped=(await c.personalLearningTaskSnapshot(taskId)).status;
   const provider=await c.saveProvider(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,name:'No-cost interrupted fixture',kind:'compatible',endpoint:'https://fixture.invalid/v1',model:'fixture'},'fixture-secret');
   const {settings}=await c.providerSnapshot();await c.assignProvider(crypto.randomUUID(),'content',provider.id,settings.revision);
   const controller=new AbortController();let saved=0,error='';
   try{await c.preparePersonal(taskId,source,provider,await c.selectedReviewProvider(),controller.signal,()=>{saved++;controller.abort();});}catch(reason){error=String(reason);}
   return {stopped,saved,error,task:await c.personalLearningTaskSnapshot(taskId)};
  },pendingTask.id);
  expect(resumed.stopped).toBe('stopped');expect(resumed.saved).toBeGreaterThanOrEqual(2);expect(resumed.error).toContain('requestStopped');
  expect(resumed.task.status).toBe('failed');expect(resumed.task.attemptId).toBeTruthy();expect(resumed.task.source).toEqual(pendingTask.source);
  await expect(a.evaluate(request=>(window as any).core.createJourneyModules().personalMeaningJourney.correctPersonalMeaning(request),branchA.request)).rejects.toThrow('meaningChanged');
  await edit(a,'A: 在已选结果之上继续明确修改。');await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
  expect((await b.evaluate(()=>(window as any).core.readCloudSync())).status).toBe('synced');
  await b.evaluate(()=>(window as any).core.exportLibraryBackup('conflict-branch-backup-fixture'));
  await b.reload();
  const reopened=await b.evaluate(async id=>{const path='/core.js',c=await import(/* @vite-ignore */ path);await c.openLibrary();return {detail:await c.worldReadRepository.detail(id),state:await c.readCloudSync()};},saved.personalMeaningId);
  expect(reopened.detail.detail.directAlignments[0].coreMeaningFocus).toBe('A: 在已选结果之上继续明确修改。');expect(reopened.state.status).toBe('synced');
 }finally{await a.context().close();await b.context().close();}
});

test('[integration][local-correctness][convergence] conflict UI compares versions and refuses a stale local choice',async()=>{
 const account=await fixture.createAccount(),a=await fixture.createClient(account),b=await fixture.createClient(account);
 try{
  const shared=await a.evaluate(async()=>{const c=(window as any).core;const row=await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'The original context'});await (window as any).sync();return row;});
  await b.evaluate(()=>(window as any).sync());
  for(const [page,text] of [[a,'The cloud context'],[b,'The device context']] as const)await page.evaluate(async({id,text})=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id,expectedRevision:1,text});},{id:shared.id,text});
  await b.evaluate(()=>(window as any).core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Unrelated new context'}));
  await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
  const shown=await b.evaluate(()=>(window as any).core.readCloudSync());
  expect(shown.status).toBe('conflict');expect(shown.conflict.comparison.records[0].local.fields).toContainEqual({label:'content',text:'The device context'});
  expect(shown.conflict.remoteRevision).toBe(shown.revision);
  expect(shown.conflict.remoteRevision).toBe((await b.evaluate(()=>(window as any).request('/head'))).revision);
  await b.route('https://service.fixture.invalid/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:fixture.origin+url.pathname+url.search});await route.fulfill({response});});
  await b.evaluate(async account=>{(window as any).__fixtureAuthSession={access_token:account.token,user:{id:account.subject}};const path='/local-clear.js',ui=await import(/* @vite-ignore */ path);ui.mountCloudSyncControl({automatic:false});},account);
  await expect(b.getByText('The device context',{exact:true})).toBeVisible();await expect(b.getByText('The cloud context',{exact:true})).toBeVisible();
  await b.locator('summary').filter({hasText:/^Before these changes$|^这些修改之前$/u}).click();await expect(b.getByText('The original context',{exact:true})).toBeVisible();
  await expect(b.getByText(shared.id,{exact:false})).toHaveCount(0);
  await b.evaluate(async id=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id,expectedRevision:2,text:'A newer device context'});},shared.id);
  const rejection=await b.evaluate(async conflict=>{try{await (window as any).core.resolveCloudSyncConflicts('remote',conflict);return null;}catch(e){return (e as Error).message;}},shown.conflict);
  expect(rejection).toBe('library_sync_conflict_changed');
  await b.evaluate(()=>(window as any).sync());
  await expect(b.getByText('A newer device context',{exact:true})).toBeVisible();
  // A valid decision also cannot cover a new edit made after the click but
  // before the synchronizer captures facts.
  await b.evaluate(async id=>{const c=(window as any).core;await c.resolveCloudSyncConflicts('remote',(await c.readCloudSync()).conflict);await c.saveDraft(crypto.randomUUID(),{id,expectedRevision:3,text:'Written after choosing'});await (window as any).sync();},shared.id);
  expect((await b.evaluate(()=>(window as any).core.readCloudSync())).status).toBe('conflict');
  await expect(b.getByText('Written after choosing',{exact:true})).toBeVisible();
  await b.getByRole('button',{name:/Use cloud version|使用云端版本/}).click();
  await expect.poll(()=>b.evaluate(async()=> (await (window as any).core.readCloudSync()).status)).toBe('synced');
  expect(await b.evaluate(async id=>(await (window as any).core.listDrafts()).find((row:any)=>row.id===id).text,shared.id)).toBe('The cloud context');
  await b.reload();
  expect(await b.evaluate(async id=>{const path='/core.js',c=await import(/* @vite-ignore */ path);await c.openLibrary();return (await c.listDrafts()).find((row:any)=>row.id===id).text;},shared.id)).toBe('The cloud context');
 }finally{await a.context().close();await b.context().close();}
});

test('[integration][durability][convergence] real cloud retry after a lost acknowledgement is idempotent', async () => {
  const world = await createRealLibraryConvergenceWorld(fixture, ['device-a', 'device-b']);
  worlds.add(world);

  const draft = await world.add('device-a', 'My raincoat');
  await assert.rejects(world.sync('device-a', { fault: 'lost-ack' }), /lost_ack/u);
  assert.equal(await world.cloudRevision(), 1, 'the server commits before its acknowledgement is lost');

  await world.sync('device-a');
  assert.equal(await world.cloudRevision(), 1, 'retrying the same publication does not create a second revision');
  await world.sync('device-b');

  const [deviceA, deviceB] = await Promise.all([
    world.snapshot('device-a'),
    world.snapshot('device-b'),
  ]);
  assert.deepEqual(deviceB.drafts, [draft]);
  assert.equal(deviceA.identity.id, deviceB.identity.id, 'account replicas share one library identity');
  assert.notEqual(deviceA.identity.deviceId, deviceB.identity.deviceId, 'each browser keeps its own device identity');
});

test('[integration][durability][convergence] real offline independent writes eventually converge', async () => {
  const world = await createRealLibraryConvergenceWorld(fixture, ['device-a', 'device-b']);
  worlds.add(world);

  await world.add('device-a', 'shared base');
  await world.sync('device-a');
  await world.sync('device-b');
  await world.add('device-a', 'A offline');
  await world.add('device-b', 'B offline');
  await assert.rejects(world.sync('device-a', { fault: 'offline' }), /offline/u);

  await world.sync('device-a');
  await world.sync('device-b');
  await world.sync('device-a');
  const [deviceA, deviceB] = await Promise.all([
    world.snapshot('device-a'),
    world.snapshot('device-b'),
  ]);
  assert.deepEqual(draftTexts(deviceA.drafts), ['A offline', 'B offline', 'shared base']);
  assert.deepEqual(deviceB.drafts, deviceA.drafts);
  assert.equal(deviceA.sync.status, 'synced');
  assert.equal(deviceB.sync.status, 'synced');
});

test('[integration][durability][convergence] a confirmed device receives a Worker-prepared update and reopens exact facts',async()=>{
 const account=await fixture.createAccount(),left=await fixture.createClient(account),right=await fixture.createClient(account);
 try{
  const saved=await left.evaluate(async()=>{
   const core=(window as any).core,rows=[];
   for(let index=0;index<32;index++)rows.push(await core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:`Shared context ${index}`}));
   await (window as any).sync();return rows;
  });
  await right.evaluate(()=>(window as any).sync());
  const before=await right.evaluate(async()=>{const core=(window as any).core;return {state:await core.readCloudSync(),revision:await core.readLibrary(core.readLocalLibraryRevision)};});
  const edited=await left.evaluate(async(id)=>{const core=(window as any).core,value=await core.saveDraft(crypto.randomUUID(),{id,expectedRevision:1,text:'Changed on the first device.'});await (window as any).sync();return value;},saved[0].id);
  await right.evaluate(()=>{(window as any).changes=[];window.addEventListener('sensa-library-changed',event=>(window as any).changes.push((event as CustomEvent).detail));});
  await right.evaluate(()=>(window as any).sync());
  const applied=await right.evaluate(async()=>{const core=(window as any).core;return {state:await core.readCloudSync(),revision:await core.readLibrary(core.readLocalLibraryRevision),changes:(window as any).changes};});
  assert.equal(applied.state.status,'synced');assert.notEqual(applied.state.restoreOperationId,before.state.restoreOperationId,'the new head uses a new Worker-prepared application receipt');
  assert.equal(applied.revision,before.revision+1);
  assert(applied.changes.some((change:any)=>change.records.some((row:any)=>row.table==='drafts'&&row.key===edited.id)),'the exact changed record is announced');
  assert(applied.changes.every((change:any)=>!change.clears.includes('drafts')),'an incremental update does not announce a whole-table clear');
  await right.reload();
  const reopened=await right.evaluate(async()=>{const path='/core.js',core=await import(/* @vite-ignore */ path);await core.openLibrary();return {drafts:await core.listDrafts(),state:await core.readCloudSync()};});
  assert.deepEqual(reopened.drafts.find((row:any)=>row.id===edited.id),edited);
  for(const original of saved.slice(1))assert.deepEqual(reopened.drafts.find((row:any)=>row.id===original.id),original);
  assert.equal(reopened.state.status,'synced');assert.equal(reopened.state.restoreOperationId,applied.state.restoreOperationId);
 }finally{await left.context().close();await right.context().close();}
});

test('[integration][local-correctness][convergence] real conflicts preserve both branches until an explicit decision', async () => {
  const world = await createRealLibraryConvergenceWorld(fixture, ['device-a', 'device-b', 'observer']);
  worlds.add(world);

  const shared = await world.add('device-a', 'base');
  await world.sync('device-a');
  await world.sync('device-b');
  await world.sync('observer');

  await world.edit('device-a', shared.id, 'A edit');
  await world.edit('device-b', shared.id, 'B edit');
  await world.add('device-b', 'Independent while conflicted');
  await world.sync('device-a');
  await world.sync('device-b');

  const firstConflict = await world.snapshot('device-b');
  assert.equal(firstConflict.sync.status, 'conflict');
  assert.equal(firstConflict.sync.conflictRecords, 1);
  assert(firstConflict.sync.completeConflictRecords, 'persistent conflicts keep base, local and remote branches');
  assert.equal(firstConflict.drafts.find(({ id }) => id === shared.id)?.text, 'B edit');
  await world.sync('observer');
  const observer = await world.snapshot('observer');
  assert.equal(observer.drafts.find(({ id }) => id === shared.id)?.text, 'A edit');
  assert(draftTexts(observer.drafts).includes('Independent while conflicted'));

  await world.resolve('device-b', 'local');
  await world.edit('device-a', shared.id, 'A newer edit');
  await world.sync('device-a');
  await world.sync('device-b');
  const revalidated = await world.snapshot('device-b');
  assert.equal(revalidated.sync.status, 'conflict');
  assert(
    revalidated.sync.remoteRevision !== null
      && firstConflict.sync.remoteRevision !== null
      && revalidated.sync.remoteRevision > firstConflict.sync.remoteRevision,
    'a changed remote head requires a new decision',
  );
  assert.equal(revalidated.drafts.find(({ id }) => id === shared.id)?.text, 'B edit');

  await world.resolve('device-b', 'local');
  await world.sync('device-b');
  await world.sync('observer');
  assert.equal((await world.snapshot('observer')).drafts.find(({ id }) => id === shared.id)?.text, 'B edit');
  assert.equal((await world.snapshot('device-b')).sync.status, 'synced');

  await world.sync('device-a');
  await world.edit('device-a', shared.id, 'A final');
  await world.edit('device-b', shared.id, 'B final');
  await world.sync('device-a');
  await world.sync('device-b');
  assert.equal((await world.snapshot('device-b')).sync.status, 'conflict');
  await world.resolve('device-b', 'remote');
  await world.sync('device-b');
  const resolved = await world.snapshot('device-b');
  assert.equal(resolved.drafts.find(({ id }) => id === shared.id)?.text, 'A final');
  assert.equal(resolved.sync.status, 'synced');
});
