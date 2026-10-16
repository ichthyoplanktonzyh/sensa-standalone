/** Real Chromium local library + Hono + disposable Postgres. No model calls or real accounts. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {libraryCloudPackageFixture} from '../../../scripts/support/libraryCloudPackageFixture.mts';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {expect,test,type Browser,type TestInfo} from '@playwright/test';
import {pruneLibraryCloudHistory,purgeExpiredLibraryCloudBlocks} from '../../../apps/api/src/sensa/library/retention.ts';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec.ts';
import {librarySyncBlockChars,librarySyncBlockStoreBatch} from '../../../packages/contracts/src/sensa/librarySync.ts';
import {decodeLibrarySyncBlock,encodeLibrarySyncBlock} from '../../../packages/contracts/src/sensa/librarySyncBlocks.ts';
import {createLibraryCloudBrowserFixture} from '../../../tests/web/support/libraryCloudBrowserFixture.mts';
import {cloudCheckpointSchedule} from '../../../apps/web/src/data/library/cloudSyncPolicy';
import type {LearningHistoryProjection,LearningRuntimeProjection} from '../../../apps/web/src/learning/system';
import {manualMeaningPayload,newManualMeaningDraft} from '../../../apps/web/src/experience/intake/manualMeaning';
test.setTimeout(300_000);
/** Fact collections are identity/ordinal sets, not an ordered text document.
 * Compare every full fact by identity. Nested user materials, pins and ordered
 * provenance references remain untouched; their order has separate oracles. */
const meaningFactIds:Record<string,string>={personalMeaningRevisions:'personalMeaningRevisionId',personalSemanticAnchors:'personalSemanticAnchorId',personalSemanticAnchorRevisions:'personalSemanticAnchorRevisionId',personalExpressionAnchors:'personalExpressionAnchorId',personalExpressionAnchorRevisions:'personalExpressionAnchorRevisionId',focuses:'meaningFocusId',focusRevisions:'meaningFocusRevisionId',focusAcceptances:'meaningFocusAcceptanceId',constructions:'senseConstructionId',constructionTurns:'constructionTurnId',proposals:'senseProposalId',proposalVersions:'senseProposalVersionId',senseConfirmations:'senseProposalConfirmationId',semanticAcceptances:'semanticAcceptanceId',alignments:'personalMeaningAlignmentId',alignmentEvents:'personalMeaningAlignmentEventId',bindingConfirmations:'expressionBindingConfirmationId'};
const retainedMeaningFacts=(record:any)=>Object.fromEntries(Object.entries(record).map(([key,value])=>[key,Array.isArray(value)&&meaningFactIds[key]?[...value].sort((a,b)=>a[meaningFactIds[key]!].localeCompare(b[meaningFactIds[key]!])):value]));

const runSharedContextRecovery=async(browser:Browser,testInfo:TestInfo,withLearning:boolean)=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount(withLearning?'shared-context-learned':'shared-context-stages'),a=await fixture.createClient(account),b=await fixture.createClient(account);
  const created=await a.evaluate(async()=>{const c=(window as any).core,g=c.createJourneyModules().personalMeaningJourney,id=()=>crypto.randomUUID();
   const context=await g.saveContext({operationId:id(),blocks:[{kind:'text',bodyText:'Could I borrow your umbrella? I expect it back tomorrow.'}]});
   const first=await g.createMeaningDraft({operationId:id(),contextReferences:[context],learnerIntentNote:'临时借用并归还。'}),second=await g.createMeaningDraft({operationId:id(),contextReferences:[context],learnerIntentNote:'礼貌提出请求。'});return {context,first,second};
  });
  const learningTables=['curriculumEnrollments','supplementalMembershipStates','studyScopes','learningSessions','learningTargets','learningRuns','learningEvents','learningReconciliations','personalLearning','contentAttempts','media'];
  const inspect=(page:import('@playwright/test').Page)=>page.evaluate(async learningTables=>{const c=(window as any).core;return c.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(['semanticContexts','semanticMeanings','semanticRegistry','semanticReceipts',...learningTables].map(async table=>[table,(await tx.entries(table)).map((row:any)=>({key:row.key,value:c.encodeBackupValue(row.value)})).sort((a:any,b:any)=>a.key.localeCompare(b.key))]))));},learningTables);
  await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());assert.deepEqual(await inspect(b),await inspect(a));
  const originalRevision=(await inspect(a)).semanticContexts.find((row:any)=>row.key===`anchorRevisions:${created.context.revisionId}`);assert.ok(originalRevision,'saved Context has a canonical immutable revision fact');
  const edited=await b.evaluate(async({created,withLearning,learningTables})=>{const c=(window as any).core,g=c.createJourneyModules().personalMeaningJourney,id=()=>crypto.randomUUID(),sense=(meaning:string)=>({senseKey:null,semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:meaning,prototypeScenes:[],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]},wordingSource:'learner_authored',resolutionProvenance:{resolverKind:'learner',provider:'fixture',model:null,policyVersion:null,sourceReferenceIds:[]}});
   const first=await c.worldReadRepository.draftConfirmation(created.first.personalMeaningId),firstOp=id();await g.confirmMeaningDraft({operationId:firstOp,personalMeaningId:created.first.personalMeaningId,source:first.source,payload:{contractVersion:'sensa-intake-v3',operationId:firstOp,capturedAt:new Date().toISOString(),context:first.context,sense:sense(first.meaning),expression:null,acceptance:{mode:'learner_direct'}}});
   const detail=await c.worldReadRepository.detail(created.first.personalMeaningId);if(detail.sources.length)throw Error('Sense-only draft became learnable');
   const senseOnly=detail.detail.directAlignments[0];
   const seed=await c.worldReadRepository.correction(created.first.personalMeaningId,detail.detail.directAlignments[0].personalMeaningAlignmentId),operationId=id();await g.correctPersonalMeaning({operationId,personalMeaningId:created.first.personalMeaningId,personalMeaningAlignmentId:detail.detail.directAlignments[0].personalMeaningAlignmentId,source:seed.source,reuseSense:seed.reuseSense,payload:{...seed.payload,operationId,expression:{surfaceForm:'borrow',languageTag:'en',expressionTypeHint:'word',occurrence:{surfaceForm:'borrow',locator:{kind:'personal_meaning',personalMeaningId:created.first.personalMeaningId,personalSemanticAnchorRevisionIds:seed.contextRevisionIds}}},acceptance:{mode:'learner_direct'}}});
   const withExpression=await c.worldReadRepository.detail(created.first.personalMeaningId);
   const second=await c.worldReadRepository.draftConfirmation(created.second.personalMeaningId),op=id();await g.confirmMeaningDraft({operationId:op,personalMeaningId:created.second.personalMeaningId,source:second.source,payload:{contractVersion:'sensa-intake-v3',operationId:op,capturedAt:new Date().toISOString(),context:second.context,sense:sense(second.meaning),expression:{surfaceForm:'Could I',languageTag:'en',expressionTypeHint:'phrase',occurrence:{surfaceForm:'Could I',locator:{kind:'personal_meaning',personalMeaningId:created.second.personalMeaningId,personalSemanticAnchorRevisionIds:second.contextRevisionIds}}},acceptance:{mode:'learner_direct'}}});
   // Confirmation alone must not manufacture Learning, even in the rated variant.
   const beforeLearning=await c.readLearning();if(beforeLearning.targets.length||beforeLearning.runs.length||beforeLearning.events.length)throw Error('Confirmation created learning outcomes');
   let learned:any=null;
   if(withLearning){
    const provider=await c.saveProvider(id(),{id:id(),expectedRevision:0,name:'Free shared Context fixture',kind:'compatible',endpoint:'https://shared-context-model.invalid/v1',model:'synthetic'},'synthetic-shared-context-secret');await c.assignProvider(id(),'content',provider.id,(await c.providerSnapshot()).settings.revision);
    const languageContext=(await c.languageRoutesSnapshot()).context;await c.confirmLearningQuantity(id(),languageContext,20);
    const restoreSpeech=c.replaceClientSpeechProvider({id:'fixture',revision:1,displayName:'Fixture',synthesize:async(input:any)=>({...input,audioUrl:'data:audio/mpeg;base64,UklGRg==',phoneticNotation:null,accentLabel:'en-US',source:'synthetic shared Context fixture',method:'tts'})}),originalFetch=window.fetch;let providerCalls=0,candidate:any;
    window.fetch=async(url:any,init:any)=>{const address=String(url);if(address.endsWith('/sensa/resource-facts'))return new Response(JSON.stringify({input:JSON.parse(String(init?.body)),references:[]}),{headers:{'content-type':'application/json'}});if(address.startsWith(provider.endpoint)){providerCalls++;return new Response(JSON.stringify({model:'synthetic',choices:[{finish_reason:'stop',message:{content:JSON.stringify(candidate)}}]}),{headers:{'content-type':'application/json'}});}throw Error('Unexpected network in free shared Context preparation: '+address);};
    const tasks:any[]=[];
    try{for(const item of [{meaningId:created.first.personalMeaningId,expression:'borrow',meaning:'临时借用并归还。',example:'May I borrow your umbrella?'},{meaningId:created.second.personalMeaningId,expression:'Could I',meaning:'礼貌提出请求。',example:'Could I borrow your umbrella?'}]){
     const source=(await c.worldReadRepository.detail(item.meaningId)).sources[0];if(!source)throw Error('Missing confirmed learning source');
     if(source.reference.personalMeaningId!==item.meaningId||source.expression.surfaceForm!==item.expression||JSON.stringify(source.context.personalSemanticAnchorRevisionIds)!==JSON.stringify([created.context.revisionId])||source.context.text!=='Could I borrow your umbrella? I expect it back tomorrow.')throw Error('Learning source does not select the exact original shared Context');
     candidate={resources:[{role:'experience_recall_cue',payload:{scene:'向朋友临时借一把雨伞，约好归还。',senseFocus:item.meaning}},{role:'scene_bridge',payload:{text:item.meaning,meaningRendering:{meaning:item.meaning,languageTag:'zh-CN'}}},{role:'scene_realization',payload:{example:item.example,targetStart:item.example.indexOf(item.expression),targetEnd:item.example.indexOf(item.expression)+item.expression.length,experienceResourceKey:'experience_recall_cue:0'}}]};
     const task=await c.enrollPersonal(id(),source,languageContext,true);await c.preparePersonal(task.id,source,provider,null,new AbortController().signal,()=>{});const ready=await c.personalLearningTaskSnapshot(task.id);if(ready.status!=='ready'||JSON.stringify(ready.contextPin)!==JSON.stringify([created.context.revisionId]))throw Error('Preparation did not admit exact original shared Context materials');const attempt=await c.readLibrary((tx:any)=>tx.get('contentAttempts',ready.attemptId));if(!attempt?.readyAt||JSON.stringify(attempt.contextPin)!==JSON.stringify([created.context.revisionId])||attempt.fixedInput.source.personalMeaningId!==item.meaningId)throw Error('Material attempt lost the exact accepted Meaning and Context revision');tasks.push(ready);
     await c.learningSystem.execute({kind:'start',operationId:id(),targetId:task.targetId,languageContext,dailyLimit:20});let runtime=(await c.learningSystem.read({kind:'runtime',languageContext})).runtime;
     await c.learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'reveal'}});runtime=(await c.learningSystem.read({kind:'runtime',languageContext})).runtime;
     await c.learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'rate',rating:'good'}});await c.learningSystem.execute({kind:'finish',operationId:id(),runId:runtime.runId});
    }}finally{restoreSpeech();window.fetch=originalFetch;}
    const state=await c.readLearning();if(state.targets.length!==2||state.targets.some((target:any)=>!target.memory||target.memoryRevision<1)||state.runs.length!==2||state.runs.some((run:any)=>!run.completedAt)||state.events.filter((event:any)=>event.kind==='rate').length!==2||providerCalls!==2)throw Error('Two independent ratings did not create two genuine memories');
    const facts=await c.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(learningTables.map(async(table:string)=>[table,(await tx.entries(table)).map((row:any)=>({key:row.key,value:c.encodeBackupValue(row.value)})).sort((a:any,b:any)=>a.key.localeCompare(b.key))]))));learned={facts,tasks,providerCalls,targetIds:state.targets.map((target:any)=>target.id),memories:state.targets.map((target:any)=>({id:target.id,memory:target.memory,memoryRevision:target.memoryRevision})),runs:state.runs,events:state.events};
   }
   const changed=await g.reviseSavedContext({operationId:id(),contextId:created.context.contextId,expectedRevisionId:created.context.revisionId,blocks:[{kind:'text',bodyText:'Maya returned my umbrella today.'}]});
   const third=await g.createMeaningDraft({operationId:id(),contextReferences:[changed],learnerIntentNote:'归还之后的理解。'});
   for(const item of [created.first,created.second]){const pinned=await c.worldReadRepository.detail(item.personalMeaningId);if(pinned.detail.materialBlocks[0].bodyText!=='Could I borrow your umbrella? I expect it back tomorrow.')throw Error('Shared edit replaced accepted pin');}
   return {changed,third,learned,senseOnly:{senseId:senseOnly.senseId,alignmentId:senseOnly.personalMeaningAlignmentId},withExpression:{senseId:withExpression.detail.directAlignments[0].senseId,alignmentId:withExpression.detail.directAlignments[0].personalMeaningAlignmentId}};
  },{created,withLearning,learningTables});
  assert.equal(edited.withExpression.senseId,edited.senseOnly.senseId,'adding Expression keeps the accepted stable Sense');assert.notEqual(edited.withExpression.alignmentId,edited.senseOnly.alignmentId,'the explicit later acceptance retains a new connection fact');
  const pins=(page:import('@playwright/test').Page)=>page.evaluate(async ids=>{const c=(window as any).core;return c.readLibrary(async(tx:any)=>Promise.all(ids.map(async id=>{const record=await tx.get('semanticMeanings',id);return record.personalSemanticAnchors.filter((row:any)=>row.status==='active').map((row:any)=>({contextId:row.personalSemanticAnchorId,revisionId:row.selectedRevisionId}));})));},[created.first.personalMeaningId,created.second.personalMeaningId,edited.third.personalMeaningId]);
  const expectedPins=[[{contextId:created.context.contextId,revisionId:created.context.revisionId}],[{contextId:created.context.contextId,revisionId:created.context.revisionId}],[{contextId:edited.changed.contextId,revisionId:edited.changed.revisionId}]];assert.deepEqual(await pins(b),expectedPins,'two old pins share one Context; new draft selects its revised head');
  const deleted=await b.evaluate(async changed=>(window as any).core.createJourneyModules().personalMeaningJourney.changeContextLifecycle({operationId:crypto.randomUUID(),contextId:changed.contextId,expectedRevisionId:changed.revisionId,action:'delete'}),edited.changed);
  await b.evaluate(()=>(window as any).sync());await a.evaluate(()=>(window as any).sync());
  const tombstone=await a.evaluate(async id=>(await (window as any).core.worldReadRepository.contextDetail(id)).detail,created.context.contextId);
  assert.equal(tombstone.head.status,'deleted');assert.equal(tombstone.head.currentRevisionId,deleted.revisionId);assert.deepEqual(await pins(a),expectedPins);assert.deepEqual(await pins(b),expectedPins);
  await a.evaluate(async deleted=>(window as any).core.createJourneyModules().personalMeaningJourney.changeContextLifecycle({operationId:crypto.randomUUID(),contextId:deleted.contextId,expectedRevisionId:deleted.revisionId,action:'restore'}),deleted);
  await a.evaluate(()=>(window as any).sync());
  await b.evaluate(()=>(window as any).sync());await a.evaluate(()=>(window as any).sync());const settled=await inspect(b);assert.deepEqual(await inspect(a),settled);for(const table of learningTables)assert.deepEqual(settled[table],withLearning?edited.learned.facts[table]:[],`Context edit/delete/restore must preserve ${table}`);
  for(const page of [a,b]){assert.equal((await page.evaluate(()=>(window as any).core.readCloudSync())).status,'synced');assert.deepEqual(await pins(page),expectedPins);}assert.deepEqual(settled.semanticContexts.find((row:any)=>row.key===originalRevision.key),originalRevision,'edit/delete/restore and synchronization preserve the original revision body');
  const domain=(page:import('@playwright/test').Page)=>page.evaluate(async input=>{const c=(window as any).core;return {context:(await c.worldReadRepository.contextDetail(input.contextId)).detail,meanings:await Promise.all(input.ids.map(async id=>(await c.worldReadRepository.detail(id)).detail.materialBlocks))};},{contextId:created.context.contextId,ids:[created.first.personalMeaningId,created.second.personalMeaningId,edited.third.personalMeaningId]});
  const expectedDomain=await domain(b);assert.equal(expectedDomain.context.head.status,'active');assert.equal(expectedDomain.context.meaningCount,3);assert.equal(expectedDomain.context.blocks[0].bodyText,'Maya returned my umbrella today.');assert.equal(expectedDomain.meanings[2][0].bodyText,'Maya returned my umbrella today.');
  for(const blocks of expectedDomain.meanings.slice(0,2))assert.equal(blocks[0].bodyText,'Could I borrow your umbrella? I expect it back tomorrow.','restored old Meanings still hydrate the original Context body');
  const archive=await b.evaluate(async()=>[...(await (window as any).core.exportLibraryBackup('shared-context-stage-fixture')).file]),fresh=await fixture.createClient(account);
  try{assert.equal(await fresh.evaluate(()=>(window as any).core.isLibraryBackupDestinationEmpty()),true);await fresh.evaluate(bytes=>(window as any).core.restoreLibraryBackup(new Uint8Array(bytes),'shared-context-stage-fixture'),archive);assert.deepEqual(await inspect(fresh),settled);await fresh.reload();await fresh.evaluate(async()=>{const path='/core.js';(window as any).core=await import(/* @vite-ignore */ path);await (window as any).core.openLibrary();});assert.deepEqual(await inspect(fresh),settled);assert.deepEqual(await pins(fresh),await pins(b));assert.deepEqual(await domain(fresh),expectedDomain);await testInfo.attach(withLearning?'learned-shared-context-cloud-evidence':'shared-context-cloud-evidence',{contentType:'application/json',body:JSON.stringify({created,edited,tombstone,restored:expectedDomain,pins:await pins(fresh),paidCalls:0,withLearning,boundary:'gateway/domain + real Chromium/OPFS + disposable Hono/Postgres; rated variant uses controlled free HTTP and synthetic speech, genuine reveal/rate/finish; not rendered UI, provider quality or physical machines'})});}finally{await fresh.context().close();}
 }finally{await fixture.close();}
};
test('independent Context and two staged understandings preserve exact shared pins through Cloud and empty-client backup recovery',async({browser},testInfo)=>runSharedContextRecovery(browser,testInfo,false));
test('two rated understandings sharing one Context retain both memories through Context edits, Cloud and empty-client backup recovery',async({browser},testInfo)=>runSharedContextRecovery(browser,testInfo,true));

test('clearing a device through the UI survives reload until explicit Cloud restoration',async({browser},testInfo)=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('clear-reconnect'),page=await fixture.createClient(account);
  const payload=manualMeaningPayload({...newManualMeaningDraft(),context:'Could I borrow your umbrella?',occurrence:'borrow',languageTag:'en',meaning:'暂时借用对方的物品，之后归还。',usage:'下雨时借朋友的雨伞。'});
  const original=await page.evaluate(async payload=>{const c=(window as any).core;await c.createJourneyModules().semanticIntake.submit(payload);await (window as any).sync();return {identity:await c.openLibrary(),meanings:await c.readLibrary((tx:any)=>tx.entries('semanticMeanings')),state:await c.readCloudSync()};},payload);
  expect(original.meanings).toHaveLength(1);expect(original.state.status).toBe('synced');
  await page.evaluate(async()=>{const path='/local-clear.js';const ui=await import(/* @vite-ignore */ path);ui.mountLocalDataControl();});
  await page.getByRole('button',{name:'Review local content',exact:true}).click();
  await expect(page.getByText(/1 meanings/)).toBeVisible();
  await page.getByRole('checkbox',{name:'I have saved any backup I need and confirm erasing this local content.'}).check();
  await page.getByRole('button',{name:'Erase local content',exact:true}).click();
  await expect(page.getByText('Local content cleared. Reopen the app to use the empty library.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Reopen app',exact:true}).click();
  // Real reload retires the old module incarnation instead of changing JS
  // globals to pretend a newly cleared device is still the old world.
  await page.evaluate(async token=>{const path='/core.js',c=await import(/* @vite-ignore */ path);(window as any).core=c;(window as any).token=token;await c.openLibrary();(window as any).request=async(path:string,body?:unknown)=>{const response=await fetch('/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.code);return value;};},account.token);
  const inspect=()=>page.evaluate(async()=>{const c=(window as any).core;return {identity:await c.openLibrary(),paused:await c.readCloudReconnectRequired(),state:await c.readCloudSync(),meanings:await c.readLibrary((tx:any)=>tx.entries('semanticMeanings')),base:await c.readLibrary((tx:any)=>tx.syncBaseReferences())};});
  const cleared=await inspect();expect(cleared.identity.id).not.toBe(original.identity.id);expect(cleared.paused).toBe(true);expect(cleared.meanings).toEqual([]);expect(cleared.base).toEqual([]);
  fixture.clearRequests();let serviceRequests=0;
  await page.route('https://service.fixture.invalid/**',async route=>{serviceRequests++;const url=new URL(route.request().url());const response=await route.fetch({url:fixture.origin+url.pathname+url.search});await route.fulfill({response});});
  await page.clock.install();
  await page.evaluate(async account=>{(window as any).__fixtureAuthSession={access_token:account.token,user:{id:account.subject}};const path='/local-clear.js',ui=await import(/* @vite-ignore */ path);ui.mountCloudSyncControl();},account);
  await expect(page.getByRole('status')).toHaveText('Saved locally; cloud sync is not enabled');
  await page.clock.fastForward(300000);
  expect(serviceRequests).toBe(0);expect(fixture.requests()).toEqual([]);expect(await inspect()).toEqual(cleared);
  // Failure preserves the user's cleared world and cannot enable auto retry.
  await page.route('**/sensa/library-sync/head',route=>route.fulfill({status:503,json:{code:'fixture_server_unavailable'}}));
  await page.getByRole('button',{name:'Sync now',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Sync did not finish. Your local data is still saved. Check the connection and retry.');
  await page.unroute('**/sensa/library-sync/head');const failed=await inspect();expect(failed.paused).toBe(true);expect(failed.identity).toEqual(cleared.identity);expect(failed.meanings).toEqual([]);expect(failed.base).toEqual([]);
  fixture.clearRequests();const failedRequests=serviceRequests;await page.clock.fastForward(300000);expect(serviceRequests).toBe(failedRequests);expect(fixture.requests()).toEqual([]);
  await page.getByRole('button',{name:'Sync now',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).core.readCloudSync())).toMatchObject({status:'synced'});
  const restored=await inspect();expect(restored.paused).toBe(false);expect(restored.identity).toEqual({...original.identity,deviceId:cleared.identity.deviceId});expect(restored.state.status).toBe('synced');expect(restored.meanings).toEqual(original.meanings);
  await testInfo.attach('clear-reconnect-evidence',{contentType:'application/json',body:JSON.stringify({originalIdentity:original.identity,clearedIdentity:cleared.identity,restoredIdentity:restored.identity,meanings:restored.meanings.length,paidCalls:0,scope:'actual LocalDataControlPanel/CloudSyncPanel/automatic scheduler, OPFS reload and Hono/PostgreSQL; controlled auth, not full AccountExperience login'})});
 }finally{await fixture.close();}
});

const localClearDuringSync=(failure:boolean)=>async({browser}:{browser:Browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount(),page=await fixture.createClient(account);
  await page.evaluate(async()=>{await (window as any).sync();const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Shown before synchronization'});const original=(window as any).sync;(window as any).__syncEntered=false;(window as any).sync=async()=>{(window as any).__syncEntered=true;await new Promise<void>(resolve=>{(window as any).__resumeSync=resolve;});if((window as any).__failClearSync)throw Error('controlled interrupted sync');await original();};});
  await page.evaluate(failure=>{(window as any).__failClearSync=failure;},failure);
  await page.evaluate(async()=>{const path='/local-clear.js';(await import(/* @vite-ignore */ path)).mountLocalDataControl();});
  await page.getByRole('button',{name:'Review local content',exact:true}).click();
  const confirmation=page.getByLabel('I have saved any backup I need and confirm erasing this local content.');await confirmation.check();
  await page.getByRole('button',{name:'Sync now',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__syncEntered)).toBe(true);
  const peer=await page.context().newPage();await peer.goto(fixture.origin);
  const added=await peer.evaluate(async()=>{const path='/core.js',c=await import(/* @vite-ignore */ path);await c.openLibrary();const id=crypto.randomUUID();await c.saveDraft(crypto.randomUUID(),{id,expectedRevision:0,text:'Written in another tab during synchronization'});return id;});
  await page.evaluate(()=>(window as any).__resumeSync());
  if(failure)await expect(page.getByRole('alert')).toContainText('Sync did not finish');
  else await expect(page.locator('[data-local-clear-sync]')).toHaveCount(0);
  await expect(page.getByText(/2 sources/)).toBeVisible();await expect(confirmation).not.toBeChecked();
  await expect(page.getByRole('button',{name:'Erase local content',exact:true})).toBeDisabled();
  expect((await page.evaluate(()=>(window as any).core.listDrafts())).map((row:any)=>row.id)).toContain(added);
  if(failure)await page.getByLabel(/Discard these .* unsynced account changes/).check();
  await confirmation.check();await expect(page.getByRole('button',{name:'Erase local content',exact:true})).toBeEnabled();await peer.close();
 }finally{await fixture.close();}
};
test('local-clear confirmation is retired when sync succeeds after another tab writes',localClearDuringSync(false));
test('local-clear confirmation is retired when sync fails after another tab writes',localClearDuringSync(true));

test('a manual sync queued behind another tab cannot authorize restoration after a later local clear',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('queued-clear'),source=await fixture.createClient(account);
  await source.evaluate(async()=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'This old Cloud material must not return from a queued click.'});await (window as any).sync();});
  const holder=await source.context().newPage();await holder.goto(fixture.origin);
  await holder.evaluate(()=>{(window as any).__held=false;void navigator.locks.request('sensa-account-library-sync',()=>new Promise<void>(resolve=>{(window as any).__release=resolve;(window as any).__held=true;}));});
  await expect.poll(()=>holder.evaluate(()=>(window as any).__held)).toBe(true);
  const waiter=await source.context().newPage();await waiter.goto(fixture.origin);
  let serviceRequests=0;
  await waiter.route('https://service.fixture.invalid/**',async route=>{serviceRequests++;const url=new URL(route.request().url());const response=await route.fetch({url:fixture.origin+url.pathname+url.search});await route.fulfill({response});});
  // Do not open the library through core on this fresh tab. The user's click
  // itself must bind its world before waiting for the cross-tab sync lock.
  await waiter.evaluate(async account=>{(window as any).__fixtureAuthSession={access_token:account.token,user:{id:account.subject}};(window as any).__finished=0;window.addEventListener('sensa-account-library-sync-finished',()=>{(window as any).__finished++;});const path='/local-clear.js',ui=await import(/* @vite-ignore */ path);ui.mountCloudSyncControl({automatic:false});},account);
  await waiter.getByRole('button',{name:'Sync now',exact:true}).click();
  await expect.poll(()=>waiter.evaluate(async()=>{const state=await navigator.locks.query();return (state.pending??[]).filter(lock=>lock.name==='sensa-account-library-sync').length;})).toBe(1);
  await source.evaluate(async()=>{const c=(window as any).core;await c.clearLocalLibrary(await c.inspectLocalClear());});
  const cleared=await source.evaluate(()=>(window as any).core.readLibrary(async(tx:any)=>({identity:await tx.get('meta','identity'),marker:await tx.get('meta','local-reset'),drafts:await tx.entries('drafts'),base:await tx.syncBaseReferences()})));
  expect(cleared.marker).toBe('local-clear');expect(cleared.drafts).toEqual([]);expect(cleared.base).toEqual([]);fixture.clearRequests();
  await holder.evaluate(()=>(window as any).__release());
  await expect.poll(()=>waiter.evaluate(()=>(window as any).__finished)).toBe(1);
  await expect(waiter.getByRole('button',{name:'Sync now',exact:true})).toBeEnabled();
  expect(serviceRequests).toBe(0);expect(fixture.requests()).toEqual([]);
  expect(await source.evaluate(()=>(window as any).core.readLibrary(async(tx:any)=>({identity:await tx.get('meta','identity'),marker:await tx.get('meta','local-reset'),drafts:await tx.entries('drafts'),base:await tx.syncBaseReferences()})))).toEqual(cleared);
 }finally{await fixture.close();}
});

test('local clear releases a live failed restoration gate without an automatic Cloud request',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('live-clear'),page=await fixture.createClient(account);
  await page.evaluate(async()=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Explicitly disposable local material.'});await (window as any).sync();});
  let attempts=0;
  await page.route('https://service.fixture.invalid/**',route=>{attempts++;return route.fulfill({status:503,json:{code:'fixture_server_unavailable'}});});
  // An automatic failure needs an expired checkpoint; a fresh mount reuses
  // its durable confirmation instead of manufacturing a network attempt.
  const checkedAt=await page.evaluate(async()=>(await (window as any).core.readCloudSync()).lastCheckedAt);
  await page.clock.install({time:new Date(Date.parse(checkedAt)+cloudCheckpointSchedule.pullStaleMs+1)});
  await page.evaluate(async account=>{(window as any).__fixtureAuthSession={access_token:account.token,user:{id:account.subject}};const path='/local-clear.js',ui=await import(/* @vite-ignore */ path);ui.mountCloudSyncControl({initialAvailability:'restoring'});},account);
  await expect(page.getByTestId('library-availability')).toHaveText('failed');await expect(page.locator('#restore-fixture')).toBeVisible();
  expect(attempts).toBe(1);
  const beforeClear=attempts;
  await page.evaluate(async()=>{const c=(window as any).core;await c.clearLocalLibrary(await c.inspectLocalClear());});
  await expect(page.getByTestId('library-availability')).toHaveText('authoritative');await expect(page.locator('#restore-fixture')).toHaveCount(0);
  await page.clock.fastForward(300000);expect(attempts).toBe(beforeClear);
  expect(await page.evaluate(()=>(window as any).core.readLibrary(async(tx:any)=>({marker:await tx.get('meta','local-reset'),drafts:await tx.entries('drafts')})))).toEqual({marker:'local-clear',drafts:[]});
 }finally{await fixture.close();}
});

test('a clear after the account lock check still retires the old click before sync header capture',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('capture-clear'),source=await fixture.createClient(account);
  await source.evaluate(async()=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Do not resurrect this from a pre-clear click.'});await (window as any).sync();});
  const waiter=await source.context().newPage();await waiter.goto(fixture.origin);let serviceRequests=0;
  await waiter.route('https://service.fixture.invalid/**',route=>{serviceRequests++;return route.fulfill({status:503,json:{code:'unexpected_sync'}});});
  await waiter.evaluate(async account=>{
   (window as any).__fixtureAuthSession={access_token:account.token,user:{id:account.subject}};
   const path='/core.js',c=await import(/* @vite-ignore */ path);
   const request=navigator.locks.request.bind(navigator.locks) as any;let insideSync=false,reads=0;
   // Hold only the shared Library read immediately before header capture.
   // Every actual acquire still uses native Web Locks; no storage is replaced.
   (navigator.locks as any).request=(name:string,...args:any[])=>{
    const callback=args.pop();
    if(name==='sensa-account-library-sync')return request(name,...args,(lock:Lock)=>{insideSync=true;return callback(lock);});
    if(insideSync&&name.includes('sensa-library-transaction-v1')&&args[0]?.mode==='shared'&&++reads===3){
     (window as any).__beforeHeader=true;
     return new Promise<void>(resolve=>{(window as any).__releaseHeader=resolve;}).then(()=>request(name,...args,callback));
    }
    return request(name,...args,callback);
   };
   (window as any).__outcome=c.syncAccountLibrary({restoreAfterLocalClear:true}).then(()=>true,(cause:Error)=>cause.message);
  },account);
  await expect.poll(()=>waiter.evaluate(()=>(window as any).__beforeHeader)).toBe(true);
  await source.evaluate(async()=>{const c=(window as any).core;await c.clearLocalLibrary(await c.inspectLocalClear());});
  fixture.clearRequests();await waiter.evaluate(()=>(window as any).__releaseHeader());
  expect(await waiter.evaluate(()=>(window as any).__outcome)).toBe('localFlow.libraryReplaced');
  expect(serviceRequests).toBe(0);expect(fixture.requests()).toEqual([]);
  expect(await source.evaluate(()=>(window as any).core.readLibrary(async(tx:any)=>({marker:await tx.get('meta','local-reset'),drafts:await tx.entries('drafts'),state:await tx.get('meta','cloud-sync')})))).toEqual({marker:'local-clear',drafts:[],state:undefined});
 }finally{await fixture.close();}
});

test('a manual restoration retry never bypasses a rejected account admission',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('retry-admission'),page=await fixture.createClient(account);let admissions=0,syncRequests=0;
  await page.route('https://service.fixture.invalid/**',route=>{if(new URL(route.request().url()).pathname==='/sensa/web/access/session'){admissions++;return route.fulfill({status:403,json:{code:'access_rejected'}});}syncRequests++;return route.fulfill({status:503,json:{code:'unexpected_online_request'}});});
  await page.evaluate(async account=>{(window as any).__fixtureAuthSession={access_token:account.token,user:{id:account.subject}};const path='/local-clear.js',ui=await import(/* @vite-ignore */ path);ui.mountAccountConnectionControl();},account);
  await expect(page.getByTestId('connection-online')).toHaveText('false');await expect.poll(()=>admissions).toBe(1);await expect(page.getByTestId('connection-notice')).not.toBeEmpty();
  await page.locator('#account-restore-fixture button').first().click();
  await expect.poll(()=>admissions).toBe(2);await expect(page.locator('#account-restore-fixture button').first()).toBeEnabled();
  expect(syncRequests).toBe(0);await expect(page.getByTestId('connection-online')).toHaveText('false');expect(await page.evaluate(()=>(window as any).core.readCloudSync())).toBeUndefined();
 }finally{await fixture.close();}
});

test('an explicit sync queued behind a failed ordinary attempt retains its own retry intent',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('queued-retry'),page=await fixture.createClient(account);let attempts=0,release:()=>void=()=>{};
  await page.evaluate(async()=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Keep this fact across failed ordinary sync and queued explicit retry.'});await (window as any).sync();});
  const checkedAt=await page.evaluate(async()=>(await (window as any).core.readCloudSync()).lastCheckedAt);
  await page.clock.install({time:new Date(Date.parse(checkedAt)+cloudCheckpointSchedule.pullStaleMs+1)});
  await page.route('https://service.fixture.invalid/**',async route=>{const url=new URL(route.request().url());if(url.pathname.endsWith('/head')&&++attempts===1){await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({status:503,json:{code:'fixture_server_unavailable'}});return;}const response=await route.fetch({url:fixture.origin+url.pathname+url.search});await route.fulfill({response});});
  await page.evaluate(async account=>{(window as any).__fixtureAuthSession={access_token:account.token,user:{id:account.subject}};const path='/local-clear.js',ui=await import(/* @vite-ignore */ path);ui.mountCloudSyncControl();},account);
  await expect.poll(()=>attempts).toBe(1);
  await page.evaluate(()=>{(window as any).__queuedOutcome=(window as any).core.syncAccountLibrary({restoreAfterLocalClear:true}).then(()=>true,(cause:Error)=>cause.message);});release();
  expect(await page.evaluate(()=>(window as any).__queuedOutcome)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as any).core.readCloudSync())).toMatchObject({status:'synced'});expect(attempts).toBe(2);
  expect(await page.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.entries('drafts')))).toHaveLength(1);
 }finally{await fixture.close();}
});

test('personal scenes and original action pins restore while offline first acceptance forks remain explicit',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('personal-scene'),a=await fixture.createClient(account),publication=await libraryCloudPackageFixture();
  const createScene=(page:import('@playwright/test').Page)=>page.evaluate(async({bookBytes,descriptor})=>{
   const c=(window as any).core,id=()=>crypto.randomUUID(),fetch=window.fetch;
   window.fetch=async input=>String(input)===descriptor.url?new Response(new Uint8Array(bookBytes)):new Response(null,{status:404});
   try{await c.contentSupplySystem.execute({kind:'install_catalog_item',descriptor,signal:new AbortController().signal});}finally{window.fetch=fetch;}
   const languageContext=(await c.languageRoutesSnapshot()).context;
   await c.learningSystem.execute({kind:'enroll_book',operationId:id(),languageContext,publicationArchiveSha256:descriptor.sha256});
   const target=(await c.readLearning()).targets[0];await c.learningSystem.execute({kind:'start',operationId:id(),targetId:target.id,languageContext,dailyLimit:20});
   const runtime=(await c.learningSystem.read({kind:'runtime',languageContext})).runtime,t=runtime.target;
   const input={kind:'save_learning_scene',learningTargetId:t.targetId,languageRouteId:languageContext.languageRouteId,curriculumMembershipId:t.curriculumMembershipId,senseId:t.identity.senseId,senseVersionId:t.identity.senseVersionId,bindingVersionId:t.identity.bindingVersionId};
   const media=[{mediaId:id(),kind:'image',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=',mimeType:'image/png',fileName:'private.png',altText:'私有借伞场景'}];
   const {scene}=await c.personalContentSystem.execute({...input,operationId:id(),body:'两台设备共同拥有、尚未接受的借伞场景。',media,expected:null});
   await c.learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'reveal'}});
   const pack=(await c.contentSupplySystem.read({kind:'workspace'})).packages[0],p=pack.portableOrigin.publications[0],entry=pack.content.entries[0];
   const acceptance={existingPersonalMeaningId:null,source:{packageKey:pack.key,bookId:p.book.bookId,bookVersionId:p.book.bookVersionId,contentReleaseId:p.contentRelease.contentReleaseId,publishedAt:p.publishedAt,title:p.book.title},target:{learningTargetId:t.targetId,curriculumMembershipId:t.curriculumMembershipId,senseId:t.identity.senseId,senseVersionId:t.identity.senseVersionId,bindingId:t.identity.bindingId,bindingVersionId:t.identity.bindingVersionId,expression:t.presentation.expression,targetLanguageTag:t.presentation.targetLanguageTag},semantic:entry.semantic};
   return {input,acceptance,scene,languageContext};
  },{bookBytes:Array.from(publication.bookBytes),descriptor:publication.descriptor});
  const seed=await createScene(a);
  await a.evaluate(()=>(window as any).sync());const b=await fixture.createClient(account);await b.evaluate(()=>(window as any).sync());
  const query={kind:'learning_scene',learningTargetId:seed.input.learningTargetId,languageRouteId:seed.input.languageRouteId};
  const inspect=(page:import('@playwright/test').Page)=>page.evaluate(async query=>{const c=(window as any).core;return {scene:await c.personalContentSystem.readScene(query),meanings:await c.readLibrary((tx:any)=>tx.entries('semanticMeanings')),learning:await c.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(['learningTargets','learningRuns','learningEvents','learningSessions','studyScopes'].map(async table=>[table,await tx.entries(table)]))))};},query);
  assert.deepEqual((await inspect(b)).scene,seed.scene);assert.equal((await inspect(b)).meanings.length,0);
  const editAndAccept=(page:import('@playwright/test').Page,body:string)=>page.evaluate(async({seed,body,query})=>{
   const c=(window as any).core,prior=await c.personalContentSystem.readScene(query),old=prior.revisions.find((r:any)=>r.revision===prior.currentRevision);
   const expected=c.personalLearningSceneEditBase(prior);
   const {scene}=await c.personalContentSystem.execute({...seed.input,operationId:crypto.randomUUID(),body,media:old.media,expected});
   const revision=scene.revisions.find((r:any)=>r.revision===scene.currentRevision),operationId=crypto.randomUUID();
   const accepted=await c.createJourneyModules().personalMeaningJourney.acceptPublishedLearningScene({...seed.acceptance,operationId,existingPersonalMeaningId:scene.acceptedPersonalMeaningId,scene:{...revision,sceneId:scene.sceneId,contextCreatedAt:scene.createdAt}});
   await c.personalContentSystem.execute({kind:'mark_learning_scene_accepted',operationId:crypto.randomUUID(),sceneId:scene.sceneId,revisionId:revision.revisionId,personalMeaningId:accepted.personalMeaningId});
   return {accepted,request:{...seed.acceptance,operationId,existingPersonalMeaningId:scene.acceptedPersonalMeaningId,scene:{...revision,sceneId:scene.sceneId,contextCreatedAt:scene.createdAt}}};
  },{seed,body,query});
  const branchA=await editAndAccept(a,'设备 A 明确接受的借伞经历。'),branchB=await editAndAccept(b,'设备 B 离线独立接受的借伞经历。'),acceptedA=branchA.accepted,acceptedB=branchB.accepted;assert.equal(acceptedA.personalMeaningId,acceptedB.personalMeaningId,'the same Scene has one owner identity even before devices meet');
  const beforeB=await inspect(b);await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
  const conflict=await b.evaluate(()=>(window as any).core.readCloudSync());assert.equal(conflict.status,'conflict');
  assert.deepEqual((await inspect(b)).scene,beforeB.scene);assert.equal((await inspect(b)).meanings.length,1,'a conflicting annotation must not auto-merge its two independently accepted Meanings');
  await b.evaluate(async()=>{const c=(window as any).core;await c.resolveCloudSyncConflicts('remote',(await c.readCloudSync()).conflict);await (window as any).sync();});
  await a.evaluate(()=>(window as any).sync());
  const settled=await inspect(b);assert.equal(settled.scene.acceptedPersonalMeaningId,acceptedA.personalMeaningId);assert.equal(settled.meanings.length,1);assert.equal(settled.meanings[0].key,acceptedA.personalMeaningId);
  assert.deepEqual(retainedMeaningFacts(settled.meanings[0].value),retainedMeaningFacts((await inspect(a)).meanings[0].value));
  assert.deepEqual(settled.learning,beforeB.learning,'scene fork decisions cannot invent rating, completion or scheduling');
  assert(settled.learning.learningEvents.some((row:any)=>row.value.detail.personalLearningScene?.revisionId===seed.scene.revisions[0].revisionId),'the original actual reveal still pins the pre-fork Scene');
  const retained=await b.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.entries('semanticReceipts')));assert(retained.some((row:any)=>row.key===branchA.request.operationId));assert(retained.some((row:any)=>row.key===branchB.request.operationId));
  await assert.rejects(b.evaluate(request=>(window as any).core.createJourneyModules().personalMeaningJourney.acceptPublishedLearningScene(request),branchB.request),/meaningChanged/,'a retained but superseded branch receipt cannot replay a nonexistent Anchor as current success');
  assert.deepEqual((await inspect(b)).scene,settled.scene);assert.deepEqual((await inspect(b)).learning,settled.learning);
  await b.reload();await b.evaluate(async()=>{const path='/core.js';(window as any).core=await import(/* @vite-ignore */ path);await (window as any).core.openLibrary();});
  assert.deepEqual((await inspect(b)).scene,settled.scene);
  // A new user intent after choosing a branch is not the discarded operation.
  // Confirming the selected Scene must neither duplicate nor rewrite its facts.
  const confirmed=await b.evaluate(async({request,scene})=>{
   const revision=scene.revisions.find((r:any)=>r.revision===scene.currentRevision);
   return (window as any).core.createJourneyModules().personalMeaningJourney.acceptPublishedLearningScene({...request,operationId:crypto.randomUUID(),existingPersonalMeaningId:scene.acceptedPersonalMeaningId,scene:{...revision,sceneId:scene.sceneId,contextCreatedAt:scene.createdAt}});
  },{request:branchA.request,scene:settled.scene});
  assert.equal(confirmed.personalMeaningId,acceptedA.personalMeaningId);assert.equal(confirmed.personalSemanticAnchorRevisionId,acceptedA.personalSemanticAnchorRevisionId);assert.equal(confirmed.acceptedByOperationId,branchA.request.operationId);
  assert.deepEqual((await inspect(b)).meanings,settled.meanings);assert.deepEqual((await inspect(b)).learning,settled.learning);
  await b.evaluate(()=>(window as any).core.exportLibraryBackup('scene-fixture-backup-password'));
  // A different conflict sharing immutable registry dependencies must not
  // make an untouched Scene's fixed-ID command replay unusable. The UI now
  // creates a fresh ID per intent; these callers deliberately retain their IDs.
  const ghostAccount=await fixture.createAccount('scene-note-closure'),gA=await fixture.createClient(ghostAccount),gSeed=await createScene(gA);
  const note=async(page:import('@playwright/test').Page,body:string)=>page.evaluate(async({senseId,body})=>{const c=(window as any).core;await c.personalContentSystem.execute({kind:'set_sense_note',operationId:crypto.randomUUID(),senseId,body,expected:await c.personalContentSystem.readSenseNote(senseId)});},{senseId:gSeed.input.senseId,body});
  await note(gA,'共同笔记基线');await gA.evaluate(()=>(window as any).sync());const gB=await fixture.createClient(ghostAccount);await gB.evaluate(()=>(window as any).sync());
  await note(gA,'远端笔记分叉');await note(gB,'明确选择保留的本机笔记分叉');
  const fixedRequest=await gA.evaluate(async seed=>{
   const c=(window as any).core,revision=seed.scene.revisions[0],ids=c.learningSceneSemanticOperationIds(revision.revisionId),request={...seed.acceptance,operationId:ids.accept,existingPersonalMeaningId:null,scene:{...revision,sceneId:seed.scene.sceneId,contextCreatedAt:seed.scene.createdAt}};
   const accepted=await c.createJourneyModules().personalMeaningJourney.acceptPublishedLearningScene(request);
   await c.personalContentSystem.execute({kind:'mark_learning_scene_accepted',operationId:ids.link,sceneId:seed.scene.sceneId,revisionId:revision.revisionId,personalMeaningId:accepted.personalMeaningId});return request;
  },gSeed);
  await gA.evaluate(()=>(window as any).sync());await gB.evaluate(()=>(window as any).sync());
  assert.equal((await gB.evaluate(()=>(window as any).core.readCloudSync())).status,'conflict');
  await gB.evaluate(async()=>{const c=(window as any).core;await c.resolveCloudSyncConflicts('local',(await c.readCloudSync()).conflict);await (window as any).sync();});
  const resumed=await gB.evaluate(async({request,seed})=>{
   const c=(window as any).core,result=await c.createJourneyModules().personalMeaningJourney.acceptPublishedLearningScene(request),revision=seed.scene.revisions[0],ids=c.learningSceneSemanticOperationIds(revision.revisionId);
   await c.personalContentSystem.execute({kind:'mark_learning_scene_accepted',operationId:ids.link,sceneId:seed.scene.sceneId,revisionId:revision.revisionId,personalMeaningId:result.personalMeaningId});return {result,note:await c.personalContentSystem.readSenseNote(seed.input.senseId),meanings:await c.readLibrary((tx:any)=>tx.entries('semanticMeanings'))};
  },{request:fixedRequest,seed:gSeed});
  assert.equal(resumed.result.replayed,true);assert.equal(resumed.meanings.length,1);assert.equal(resumed.note.body,'明确选择保留的本机笔记分叉');
  await gB.evaluate(()=>(window as any).sync());await gA.evaluate(()=>(window as any).sync());
  const laterScene=await gB.evaluate(async seed=>{
   const c=(window as any).core,query={kind:'learning_scene',learningTargetId:seed.input.learningTargetId,languageRouteId:seed.input.languageRouteId},prior=await c.personalContentSystem.readScene(query),revision=prior.revisions.find((r:any)=>r.revision===prior.currentRevision);
   return (await c.personalContentSystem.execute({...seed.input,operationId:crypto.randomUUID(),body:'已有意义之后，在两台设备共同保存的新还伞场景。',media:revision.media,expected:c.personalLearningSceneEditBase(prior)})).scene;
  },gSeed);
  await gB.evaluate(()=>(window as any).sync());await gA.evaluate(()=>(window as any).sync());
  await note(gA,'后续更新时的远端笔记分叉');await note(gB,'后续更新时保留的本机笔记分叉');
  const laterRequest=await gA.evaluate(async({seed,scene})=>{
   const c=(window as any).core,revision=scene.revisions.find((r:any)=>r.revision===scene.currentRevision),ids=c.learningSceneSemanticOperationIds(revision.revisionId),request={...seed.acceptance,operationId:ids.accept,existingPersonalMeaningId:scene.acceptedPersonalMeaningId,scene:{...revision,sceneId:scene.sceneId,contextCreatedAt:scene.createdAt}};
   const accepted=await c.createJourneyModules().personalMeaningJourney.acceptPublishedLearningScene(request);await c.personalContentSystem.execute({kind:'mark_learning_scene_accepted',operationId:ids.link,sceneId:scene.sceneId,revisionId:revision.revisionId,personalMeaningId:accepted.personalMeaningId});return request;
  },{seed:gSeed,scene:laterScene});
  await gA.evaluate(()=>(window as any).sync());await gB.evaluate(()=>(window as any).sync());assert.equal((await gB.evaluate(()=>(window as any).core.readCloudSync())).status,'conflict');
  await gB.evaluate(async()=>{const c=(window as any).core;await c.resolveCloudSyncConflicts('local',(await c.readCloudSync()).conflict);await (window as any).sync();});
  const laterReplay=await gB.evaluate(async request=>{const c=(window as any).core,result=await c.createJourneyModules().personalMeaningJourney.acceptPublishedLearningScene(request),ids=c.learningSceneSemanticOperationIds(request.scene.revisionId);await c.personalContentSystem.execute({kind:'mark_learning_scene_accepted',operationId:ids.link,sceneId:request.scene.sceneId,revisionId:request.scene.revisionId,personalMeaningId:result.personalMeaningId});return result;},laterRequest);assert.equal(laterReplay.replayed,true);assert.equal(laterReplay.personalMeaningId,resumed.result.personalMeaningId);
  const latest=await gB.evaluate(async id=>(window as any).core.worldReadRepository.detail(id),resumed.result.personalMeaningId);assert(latest.detail.materialBlocks.some((block:any)=>block.bodyText===laterRequest.scene.body));
  await gB.evaluate(()=>(window as any).core.exportLibraryBackup('scene-note-fixture-backup-password'));
 }finally{await fixture.close();}
});
test('a rated accepted Scene survives public upgrade, private material regeneration, conflict and empty-client backup import',async({browser},testInfo)=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('composed-scene-upgrade'),a=await fixture.createClient(account),first=await libraryCloudPackageFixture();
  const declaration=structuredClone(first.package.semanticDeclaration!),meaning='临时借用他人的物品，并在约定之后归还。';
  declaration.sense={...declaration.sense,senseVersionId:randomUUID(),versionNumber:2,semanticSpec:{...declaration.sense.semanticSpec,coreMeaningFocus:meaning,prototypeScenes:[{summary:'向邻居借一把梯子，用完之后按照约定归还。',participantRoles:[],states:[],directionOrCausality:null}]}};
  declaration.binding={...declaration.binding,bindingVersionId:randomUUID(),versionNumber:2};
  const second=portableBookDeliveryFixture({packageId:first.package.metadata.packageId,version:2,expression:'borrow',meaning,scene:'向邻居借一把梯子，用完之后按照约定归还。',title:first.manifest.book.title,semanticDeclaration:declaration});
  const install=(page:import('@playwright/test').Page,publication:typeof first)=>page.evaluate(async({bytes,descriptor})=>{const c=(window as any).core,original=window.fetch;window.fetch=async input=>String(input)===descriptor.url?new Response(new Uint8Array(bytes)):new Response(null,{status:404});try{return await c.contentSupplySystem.execute({kind:'install_catalog_item',descriptor,signal:new AbortController().signal});}finally{window.fetch=original;}},{bytes:Array.from(publication.bookBytes),descriptor:publication.descriptor});
  const inspect=(page:import('@playwright/test').Page)=>page.evaluate(async()=>{const c=(window as any).core,tables=['annotations','semanticMeanings','semanticContexts','semanticRegistry','semanticReceipts','curriculumEnrollments','studyScopes','learningSessions','learningTargets','learningRuns','learningEvents','learningReconciliations','personalLearning','contentAttempts'];return c.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await tx.entries(table)).map((row:any)=>({key:row.key,value:c.encodeBackupValue(row.value)})).sort((a:any,b:any)=>a.key.localeCompare(b.key))]))));});
  const learning=(page:import('@playwright/test').Page)=>page.evaluate(()=>(window as any).core.readLearning());
  const progress=(target:any)=>Object.fromEntries(['id','retentionId','identity','startedAt','completedAt','memory','memoryRevision','relearnAt','relearningState'].map(key=>[key,target[key]]));
  const acceptScene=(page:import('@playwright/test').Page,body:string,digest=second.descriptor.sha256)=>page.evaluate(async({body,digest})=>{
   const c=(window as any).core,id=()=>crypto.randomUUID(),ctx=(await c.languageRoutesSnapshot()).context,target=(await c.readLearning()).targets[0],member=target.curriculumMemberships.find((row:any)=>row.provenance.publicationArchiveSha256===digest&&row.status!=='superseded');if(!member)throw Error('Current public membership missing');
   const query={kind:'learning_scene',learningTargetId:target.id,languageRouteId:ctx.languageRouteId},prior=await c.personalContentSystem.readScene(query);
   const {scene}=await c.personalContentSystem.execute({kind:'save_learning_scene',operationId:id(),learningTargetId:target.id,languageRouteId:ctx.languageRouteId,curriculumMembershipId:member.id,senseId:member.sourcePin.senseId,senseVersionId:member.sourcePin.senseVersionId,bindingVersionId:member.sourcePin.bindingVersionId,body,media:[],expected:prior?c.personalLearningSceneEditBase(prior):null});
   const pack=(await c.installedPackages()).find((row:any)=>row.key===member.packageKey),publication=pack.portableOrigin.publications.find((row:any)=>row.bookArchiveSha256===digest),entry=pack.content.entries[0],revision=scene.revisions.find((row:any)=>row.revision===scene.currentRevision);
   const accepted=await c.createJourneyModules().personalMeaningJourney.acceptPublishedLearningScene({operationId:id(),existingPersonalMeaningId:scene.acceptedPersonalMeaningId,source:{packageKey:pack.key,bookId:publication.book.bookId,bookVersionId:publication.book.bookVersionId,contentReleaseId:publication.contentRelease.contentReleaseId,publishedAt:publication.publishedAt,title:publication.book.title},target:{learningTargetId:target.id,curriculumMembershipId:member.id,...member.sourcePin,expression:target.expression,targetLanguageTag:target.targetLanguageTag},semantic:entry.semantic,scene:{...revision,sceneId:scene.sceneId,contextCreatedAt:scene.createdAt}});
   await c.personalContentSystem.execute({kind:'mark_learning_scene_accepted',operationId:id(),sceneId:scene.sceneId,revisionId:revision.revisionId,personalMeaningId:accepted.personalMeaningId});return {accepted,sceneId:scene.sceneId,revision};
  },{body,digest});
  await install(a,first);
  await a.evaluate(async digest=>{const c=(window as any).core,id=()=>crypto.randomUUID(),languageContext=(await c.languageRoutesSnapshot()).context;await c.confirmLearningQuantity(id(),languageContext,20);await c.learningSystem.execute({kind:'enroll_book',operationId:id(),languageContext,publicationArchiveSha256:digest});await c.learningSystem.execute({kind:'start',operationId:id(),targetId:(await c.readLearning()).targets[0].id,languageContext,dailyLimit:20});},first.descriptor.sha256);
  const initialScene=await acceptScene(a,'最初明确接受的私人借伞经历。',first.descriptor.sha256);
  await a.evaluate(async()=>{const c=(window as any).core,id=()=>crypto.randomUUID(),languageContext=(await c.languageRoutesSnapshot()).context;let runtime=(await c.learningSystem.read({kind:'runtime',languageContext})).runtime;await c.learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'reveal'}});runtime=(await c.learningSystem.read({kind:'runtime',languageContext})).runtime;await c.learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'rate',rating:'good'}});await c.learningSystem.execute({kind:'finish',operationId:id(),runId:runtime.runId});});
  const rated=await learning(a),ratedFacts=await inspect(a),original=rated.targets[0];assert(original.memory);assert(original.memoryRevision>0);assert.equal(rated.runs.length,1);assert.equal(rated.events.filter((row:any)=>row.kind==='rate').length,1);
  await install(a,second);assert.deepEqual(await learning(a),rated);
  await a.evaluate(async digest=>{const c=(window as any).core;await c.learningSystem.execute({kind:'enroll_book',operationId:crypto.randomUUID(),languageContext:(await c.languageRoutesSnapshot()).context,publicationArchiveSha256:digest});},second.descriptor.sha256);
  const upgraded=await learning(a),target=upgraded.targets[0],old=target.curriculumMemberships.find((row:any)=>row.id===original.curriculumMemberships[0].id),current=target.curriculumMemberships.find((row:any)=>row.provenance.publicationArchiveSha256===second.descriptor.sha256);
  assert.equal(upgraded.targets.length,1);assert.deepEqual(progress(target),progress(original));assert.deepEqual(upgraded.runs,rated.runs);assert.deepEqual(upgraded.events,rated.events);
  assert.equal(old.status,'superseded');const immutable=(member:any)=>{const {status:_,revision:__,updatedAt:___,...facts}=member;return facts;};assert.deepEqual(immutable(old),immutable(original.curriculumMemberships[0]));
  assert.deepEqual(current.sourcePin,{...original.curriculumMemberships[0].sourcePin,senseVersionId:declaration.sense.senseVersionId,bindingVersionId:declaration.binding.bindingVersionId});assert.notEqual(current.material.snapshot.learningMaterializationId,old.material.snapshot.learningMaterializationId);
  for(const table of ['annotations','semanticMeanings','semanticContexts','semanticRegistry','semanticReceipts'])assert.deepEqual((await inspect(a))[table],ratedFacts[table],'public upgrade must not overwrite the learner Scene/understanding');
  const updatedScene=await acceptScene(a,'公开升级之后，我明确补充并接受的私人借伞经历。');assert.equal(updatedScene.accepted.personalMeaningId,initialScene.accepted.personalMeaningId);assert.notEqual(updatedScene.revision.revisionId,initialScene.revision.revisionId);
  const prepared=await a.evaluate(async({meaningId,senseVersionId,meaning})=>{
   const c=(window as any).core,id=()=>crypto.randomUUID(),source=(await c.worldReadRepository.detail(meaningId)).sources.find((row:any)=>row.reference.senseVersionId===senseVersionId);if(!source)throw Error('Updated accepted Scene source missing');
   // The owner explicitly pauses the Book before requesting private materials;
   // ordinary Add correctly reuses an already covered public Target at zero cost.
   const languageContext=(await c.languageRoutesSnapshot()).context,enrollment=await c.readLibrary(async(tx:any)=>(await tx.all('curriculumEnrollments')).find((row:any)=>row.status==='active'&&row.source.kind==='published_book'));
   await c.learningSystem.execute({kind:'change_book_plan',operationId:id(),enrollmentId:enrollment.id,expectedRevision:enrollment.revision,languageContext,mode:'paused',selection:{kind:'all'}});
   const provider=await c.saveProvider(id(),{id:id(),expectedRevision:0,name:'Free composed Scene fixture',kind:'compatible',endpoint:'https://composed-scene-model.invalid/v1',model:'synthetic'},'synthetic-composed-scene-secret');await c.assignProvider(id(),'content',provider.id,(await c.providerSnapshot()).settings.revision);
   const restoreSpeech=c.replaceClientSpeechProvider({id:'fixture',revision:1,displayName:'Fixture',synthesize:async(input:any)=>({...input,audioUrl:'data:audio/mpeg;base64,UklGRg==',phoneticNotation:null,accentLabel:'en-US',source:'synthetic composed Scene fixture',method:'tts'})}),originalFetch=window.fetch;let providerCalls=0;
   window.fetch=async(url:any,init:any)=>{const address=String(url);if(address.endsWith('/sensa/resource-facts'))return new Response(JSON.stringify({input:JSON.parse(String(init?.body)),references:[]}),{headers:{'content-type':'application/json'}});if(address.startsWith(provider.endpoint)){providerCalls++;return new Response(JSON.stringify({model:'synthetic',choices:[{finish_reason:'stop',message:{content:JSON.stringify({resources:[{role:'experience_recall_cue',payload:{scene:'向同事临时借一把雨伞，约定之后归还。',senseFocus:meaning}},{role:'scene_bridge',payload:{text:'回想自己向同事暂借雨伞并约好归还的经历。',meaningRendering:{meaning,languageTag:'zh-CN'}}},{role:'scene_realization',payload:{example:'I asked to borrow an umbrella.',targetStart:11,targetEnd:17,experienceResourceKey:'experience_recall_cue:0'}}]})}}]}),{headers:{'content-type':'application/json'}});}return originalFetch(url,init);};
   let task:any;try{task=await c.enrollPersonal(id(),source,(await c.languageRoutesSnapshot()).context,true);await c.preparePersonal(task.id,source,provider,null,new AbortController().signal,()=>{});}finally{restoreSpeech();window.fetch=originalFetch;}
   const stored=await c.personalLearningTaskSnapshot(task.id);if(stored.status!=='ready')throw Error(`Regenerated private materials were not admitted: ${JSON.stringify(stored)}`);return {task:stored,providerCalls};
  },{meaningId:updatedScene.accepted.personalMeaningId,senseVersionId:declaration.sense.senseVersionId,meaning});
  assert.equal(prepared.providerCalls,1);const regenerated=await learning(a);assert.equal(regenerated.targets.length,1);assert.deepEqual(progress(regenerated.targets[0]),progress(original));assert.deepEqual(regenerated.runs,rated.runs);assert.deepEqual(regenerated.events,rated.events);assert(regenerated.targets[0].curriculumMemberships.some((row:any)=>row.sourceKind==='personal_meaning_alignment'&&row.sourcePin.senseVersionId===declaration.sense.senseVersionId));
  await a.evaluate(()=>(window as any).sync());const firstSync=await a.evaluate(()=>(window as any).core.readCloudSync());assert.equal(firstSync.status,'synced',JSON.stringify(firstSync));const b=await fixture.createClient(account);await b.evaluate(()=>(window as any).sync());assert.equal((await b.evaluate(()=>(window as any).core.readCloudSync())).status,'synced');await install(b,second);
  assert.deepEqual(await learning(b),regenerated);
  const branchA=await acceptScene(a,'设备 A 在公共升级和材料准备之后独立接受的场景。'),branchB=await acceptScene(b,'设备 B 在公共升级和材料准备之后独立接受的场景。');assert.equal(branchA.accepted.personalMeaningId,branchB.accepted.personalMeaningId);
  await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());assert.equal((await b.evaluate(()=>(window as any).core.readCloudSync())).status,'conflict');
  await b.evaluate(async()=>{const c=(window as any).core;await c.resolveCloudSyncConflicts('remote',(await c.readCloudSync()).conflict);await (window as any).sync();});await a.evaluate(()=>(window as any).sync());
  const settled=await inspect(b),settledLearning=await learning(b);assert.deepEqual(settledLearning,regenerated);assert.deepEqual(await inspect(a),settled);
  const selected=await b.evaluate(async id=>{const c=(window as any).core;return {scene:await c.personalContentSystem.readScene({kind:'learning_scene',learningTargetId:(await c.readLearning()).targets[0].id,languageRouteId:(await c.languageRoutesSnapshot()).context.languageRouteId}),detail:await c.worldReadRepository.detail(id)};},branchA.accepted.personalMeaningId);
  assert.equal(selected.scene.acceptedRevisionId,branchA.revision.revisionId);assert(selected.detail.detail.materialBlocks.some((row:any)=>row.bodyText===branchA.revision.body));
  assert(JSON.stringify(settled.semanticContexts).includes(branchB.revision.revisionId),'the discarded Scene branch and its canonical Context must remain immutable recovery history');
  assert(settled.contentAttempts.length>0);assert(prepared.task.contextPin.length>0);
  const archive=await b.evaluate(async()=>[...(await (window as any).core.exportLibraryBackup('composed-scene-upgrade-fixture')).file]);
  const empty=await fixture.createClient(account);assert.equal(await empty.evaluate(()=>(window as any).core.isLibraryBackupDestinationEmpty()),true);
  const restored=await empty.evaluate(async bytes=>(window as any).core.restoreLibraryBackup(new Uint8Array(bytes),'composed-scene-upgrade-fixture'),archive);assert.equal(restored.summary.targets,1);assert.equal(restored.summary.runs,1);
  assert.deepEqual(await inspect(empty),settled);assert.deepEqual(await learning(empty),settledLearning);
  await empty.reload();await empty.evaluate(async()=>{const path='/core.js';(window as any).core=await import(/* @vite-ignore */path);await (window as any).core.openLibrary();});assert.deepEqual(await inspect(empty),settled);assert.deepEqual(await learning(empty),settledLearning);
  await testInfo.attach('composed-scene-upgrade-backup-evidence',{contentType:'application/json',body:JSON.stringify({initialScene,updatedScene,branchA,branchB,oldPin:original.curriculumMemberships[0].sourcePin,newPin:current.sourcePin,originalProgress:progress(original),settledProgress:progress(settledLearning.targets[0]),prepared,selected,settled,paidCalls:0,scope:'real Chromium/OPFS and local Postgres commands; UI upgrade/rating has a separate real-page oracle; synthetic publication and controlled provider/audio'})});
 }finally{await fixture.close();}
});
test('ordered Context paragraphs survive Cloud fact reordering, correction and later material append',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('ordered-context'),sender=await fixture.createClient(account);
  const payload=manualMeaningPayload({...newManualMeaningDraft(),context:'I asked to borrow an umbrella.',occurrence:'borrow',languageTag:'en',meaning:'暂时借用别人的物品，之后归还。',usage:'向同事暂借雨伞。'});
  const identity=await sender.evaluate(async payload=>{const c=(window as any).core,accepted=await c.createJourneyModules().semanticIntake.submit(payload);return {meaningId:accepted.personalMeaningId,alignmentId:(await c.worldReadRepository.detail(accepted.personalMeaningId)).sources[0].reference.personalMeaningAlignmentId};},payload);
  await sender.evaluate(()=>(window as any).sync());const receiver=await fixture.createClient(account);await receiver.evaluate(()=>(window as any).sync());
  const paragraphs=['第一段：出门时下雨，先向同事暂借一把雨伞。','第二段：回家之后，约好次日把伞归还。'];
  await sender.evaluate(async({meaningId,paragraphs})=>{
   const c=(window as any).core,detail=(await c.worldReadRepository.detail(meaningId)).detail,at=new Date().toISOString(),prefix=crypto.randomUUID().slice(0,8);let ordinal=0xffff;
   // Actual commands, controlled identity/clock ports: simultaneous paragraphs
   // have descending UUIDs so the historical Cloud ID sort must reorder them.
   const gateway=c.createJourneyModules({clock:{nowIso:()=>at},ids:{next:()=>`${prefix}-${(ordinal--).toString(16).padStart(4,'0')}-4000-8000-000000000000`}}).personalMeaningJourney;
   await gateway.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:meaningId,expectedRevision:detail.revision,blocks:paragraphs.map(bodyText=>({kind:'text',bodyText}))});
  },{meaningId:identity.meaningId,paragraphs});
  const inspect=(page:import('@playwright/test').Page)=>page.evaluate(async({meaningId,alignmentId})=>{
   const c=(window as any).core,record=await c.readLibrary((tx:any)=>tx.get('semanticMeanings',meaningId)),detail=await c.worldReadRepository.detail(meaningId),seed=await c.worldReadRepository.correction(meaningId,alignmentId);
   return {rawActiveIds:record.personalSemanticAnchors.filter((row:any)=>row.status==='active').map((row:any)=>row.personalSemanticAnchorId),label:record.personalMeaningRevisions.find((row:any)=>row.revision===record.personalMeaning.currentRevision).displayLabel,detailText:detail.detail.materialBlocks.filter((row:any)=>row.kind==='text').map((row:any)=>row.bodyText),learningText:detail.sources[0].context.text,correctionText:seed.payload.context.textSegment};
  },identity);
  const before=await inspect(sender);assert.deepEqual(before.detailText,paragraphs);assert.equal(before.learningText,paragraphs.join('\n\n'));assert.equal(before.correctionText,paragraphs.join('\n\n'));
  const reviewed=await sender.evaluate(async({meaningId,alignmentId})=>(window as any).core.worldReadRepository.correction(meaningId,alignmentId),identity);
  await sender.evaluate(()=>(window as any).sync());await receiver.evaluate(()=>(window as any).sync());
  const restored=await inspect(receiver);assert.deepEqual(restored.rawActiveIds,before.rawActiveIds,'one ordered Context retains its stable ID through transport');
  assert.deepEqual(restored.detailText,paragraphs);assert.equal(restored.learningText,paragraphs.join('\n\n'));assert.equal(restored.correctionText,paragraphs.join('\n\n'));
  // Another device adds only a note. Its canonical fact arrays return to the
  // original device without changing the reviewed Meaning or user Context.
  await receiver.evaluate(async({meaningId})=>{const c=(window as any).core,senseId=(await c.worldReadRepository.detail(meaningId)).sources[0].reference.senseId;await c.personalContentSystem.execute({kind:'set_sense_note',operationId:crypto.randomUUID(),senseId,body:'补充笔记，但没有修改已审阅的情境。',expected:{body:'',revision:0}});},{meaningId:identity.meaningId});
  await receiver.evaluate(()=>(window as any).sync());await sender.evaluate(()=>(window as any).sync());
  assert.deepEqual((await inspect(sender)).rawActiveIds,before.rawActiveIds,'a note update cannot change the independent Context association');
  const newAlignment=await sender.evaluate(async({identity,reviewed})=>{
   const c=(window as any).core,operationId=crypto.randomUUID();
   return c.createJourneyModules().personalMeaningJourney.correctPersonalMeaning({operationId,personalMeaningId:identity.meaningId,personalMeaningAlignmentId:identity.alignmentId,source:reviewed.source,reuseSense:reviewed.reuseSense,payload:{...reviewed.payload,operationId,capturedAt:new Date().toISOString(),acceptance:{mode:'learner_direct'}}});
  },{identity,reviewed});
  await sender.evaluate(()=>(window as any).sync());await receiver.evaluate(()=>(window as any).sync());
  identity.alignmentId=newAlignment.personalMeaningAlignmentId;
  const third='第三段：第二天按约定还伞，并感谢同事。';
  await receiver.evaluate(async({meaningId,bodyText})=>{const c=(window as any).core;await c.createJourneyModules().personalMeaningJourney.addMaterialBlock({operationId:crypto.randomUUID(),personalMeaningId:meaningId,block:{kind:'text',bodyText}});},{meaningId:identity.meaningId,bodyText:third});
  await receiver.evaluate(()=>(window as any).sync());await sender.evaluate(()=>(window as any).sync());
  const fresh=await fixture.createClient(account);await fresh.evaluate(()=>(window as any).sync());
  for(const page of [sender,receiver,fresh]){const value=await inspect(page);assert.deepEqual(value.detailText,[...paragraphs,third]);assert.equal(value.learningText,[...paragraphs,third].join('\n\n'));assert.equal(value.correctionText,[...paragraphs,third].join('\n\n'));const text=[...paragraphs,third].join('\n\n');assert.equal(value.label,text.length>24?text.slice(0,24)+'…':text);}
  await fresh.reload();await fresh.evaluate(async()=>{const path='/core.js';(window as any).core=await import(/* @vite-ignore */ path);await (window as any).core.openLibrary();});assert.deepEqual((await inspect(fresh)).detailText,[...paragraphs,third]);
 }finally{await fixture.close();}
});
test('correcting a learned personal meaning preserves prepared attempts, audio and real learning history across Cloud restore and OPFS reload',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('learned-personal-correction'),sender=await fixture.createClient(account);
  const payload=manualMeaningPayload({...newManualMeaningDraft(),context:'I wore my raincoat in the rain.',occurrence:'raincoat',languageTag:'en',meaning:'防雨时穿在身上的衣服。',usage:'一个人在雨中穿着防水的外衣。'});
  const identity=await sender.evaluate(async payload=>{
   const c=(window as any).core,id=()=>crypto.randomUUID(),at=new Date().toISOString(),prefix=id().slice(0,8);let ordinal=0xffff;
   const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=',mediaIds=[id(),id()];
   // Synthetic uploaded assets, not learning outcomes. Controlled ports make
   // the Context heads/revisions tie so canonical replica order is adversarial.
   await c.writeLibraryState((tx:any)=>{for(const mediaId of mediaIds)tx.put('media',mediaId,{mediaId,mediaKind:'image',mimeType:'image/png',dataUrl:'data:image/png;base64,'+png,sizeBytes:atob(png).length,createdAt:at});});
   const accepted=await c.createJourneyModules({clock:{nowIso:()=>at},ids:{next:()=>`${prefix}-${(ordinal--).toString(16).padStart(4,'0')}-4000-8000-000000000000`}}).semanticIntake.submit({...payload,context:{...payload.context,modality:'mixed',mediaReferenceIds:mediaIds}});
   if(accepted.route!=='fast_track')throw Error('Expected actual accepted Meaning');
   const source=(await c.worldReadRepository.detail(accepted.personalMeaningId)).sources[0];if(!source)throw Error('Missing accepted source');
   const provider=await c.saveProvider(id(),{id:id(),expectedRevision:0,name:'Controlled history fixture',kind:'compatible',endpoint:'https://correction-history-model.invalid/v1',model:'synthetic'},'synthetic-fixture-device-secret');
   await c.assignProvider(id(),'content',provider.id,(await c.providerSnapshot()).settings.revision);
   // Controlled provider/speech validate durability, not paid model quality or
   // real audio playback. Learning facts still come from actual owner commands.
   const restoreSpeech=c.replaceClientSpeechProvider({id:'fixture',revision:1,displayName:'Fixture',synthesize:async(input:any)=>({...input,audioUrl:'data:audio/mpeg;base64,UklGRg==',phoneticNotation:null,accentLabel:'en-US',source:'synthetic history fixture',method:'tts'})});
   const original=window.fetch;window.fetch=async(url:any,init:any)=>{
    const address=String(url);
    if(address.endsWith('/sensa/resource-facts'))return new Response(JSON.stringify({input:JSON.parse(String(init?.body)),references:[]}),{headers:{'content-type':'application/json'}});
    if(address.startsWith(provider.endpoint))return new Response(JSON.stringify({model:'synthetic',choices:[{finish_reason:'stop',message:{content:JSON.stringify({resources:[
     {role:'experience_recall_cue',payload:{scene:'下雨时，一个人穿了防水外衣来挡住雨水。',senseFocus:'防雨时穿在身上的衣服。'}},
     {role:'scene_bridge',payload:{text:'回想雨中穿着防水外衣的体验。',meaningRendering:{meaning:'在下雨时穿在身上、用来挡雨的外衣。',languageTag:'zh-CN'}}},
     {role:'scene_realization',payload:{example:'I wore my raincoat in the rain.',targetStart:10,targetEnd:18,experienceResourceKey:'experience_recall_cue:0'}},
    ]})}}]}),{headers:{'content-type':'application/json'}});
    return original(url,init);
   };
   let task:any;const languageContext=(await c.languageRoutesSnapshot()).context;
   try{task=await c.enrollPersonal(id(),source,languageContext,true);await c.preparePersonal(task.id,source,provider,null,new AbortController().signal,()=>{});}
   finally{restoreSpeech();window.fetch=original;}
   if((await c.personalLearningTaskSnapshot(task.id)).status!=='ready')throw Error('Preparation did not actually become ready');
   await c.learningSystem.execute({kind:'start',operationId:id(),targetId:task.targetId,languageContext,dailyLimit:20});
   let runtime=(await c.learningSystem.read({kind:'runtime',languageContext})).runtime as LearningRuntimeProjection;
   await c.learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'reveal'}});
   runtime=(await c.learningSystem.read({kind:'runtime',languageContext})).runtime;
   await c.learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'rate',rating:'good'}});
   await c.learningSystem.execute({kind:'finish',operationId:id(),runId:runtime.runId});
   return {meaningId:accepted.personalMeaningId,alignmentId:source.reference.personalMeaningAlignmentId,targetId:task.targetId,taskId:task.id};
  },payload);
  const inspect=(page:import('@playwright/test').Page)=>page.evaluate(async identity=>{
   const c=(window as any).core,rows=await c.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(c.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));
   // Raw local rows include service-local receipts that are intentionally not
   // portable. Exercise the real export admission instead of inventing a raw
   // snapshot format that the product does not offer to users.
   const backupSummary=(await c.exportLibraryBackup('learned-personal-correction-fixture-password')).summary;
   const learningTables=['curriculumEnrollments','supplementalMembershipStates','studyScopes','learningSessions','learningTargets','learningRuns','learningEvents','learningReconciliations','personalLearning','contentAttempts','media'];
   const encode=(table:string)=>rows[table].map((row:any)=>({key:row.key,value:c.encodeBackupValue(row.value)})).sort((a:any,b:any)=>a.key.localeCompare(b.key));
   return {learning:Object.fromEntries(learningTables.map(table=>[table,encode(table)])),nonsemantic:Object.fromEntries(c.libraryTables.filter((table:string)=>!table.startsWith('semantic')&&table!=='meta').map((table:string)=>[table,encode(table)])),record:rows.semanticMeanings.find((row:any)=>row.key===identity.meaningId).value,memory:await c.learningSystem.read({kind:'semantic_memory',targetId:identity.targetId}),sources:(await c.worldReadRepository.detail(identity.meaningId)).sources,backupSummary,hasReadyAttempt:rows.contentAttempts.some((row:any)=>row.value.status==='ready'),hasRating:rows.learningEvents.some((row:any)=>row.value.kind==='rate'),hasCompletedRun:rows.learningRuns.some((row:any)=>row.value.completedAt)};
  },identity);
  const learned=await inspect(sender);
  assert(learned.hasReadyAttempt,'not an empty attempts fixture');
  assert.equal(learned.learning.media.length,2,'actual uploaded Context images must remain available for frozen historical grants');
  assert(JSON.stringify(learned.learning.learningTargets).includes('data:audio/mpeg;base64,UklGRg=='),'the actual admitted material must contain the persisted synthetic audio; media-table emptiness alone is not an audio oracle');
  assert.equal(learned.memory.targets[0].targetId,identity.targetId);assert(learned.memory.targets[0].memory,'actual rating must have created Memory');
  assert(learned.hasRating);assert(learned.hasCompletedRun);assert.equal(learned.backupSummary.targets,1);assert.equal(learned.backupSummary.runs,1);
  await sender.evaluate(()=>(window as any).sync());const existing=await fixture.createClient(account);await existing.evaluate(()=>(window as any).sync());assert.deepEqual((await inspect(existing)).learning,learned.learning);
  // Historical attempts must retain their own Context pins, not the Context
  // later reviewed for a new acceptance of the corrected meaning/expression.
  await sender.evaluate(async meaningId=>{const c=(window as any).core,detail=(await c.worldReadRepository.detail(meaningId)).detail;await c.createJourneyModules().personalMeaningJourney.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:meaningId,expectedRevision:detail.revision,blocks:[{kind:'text',bodyText:'现在重新核对：雨天穿的是一件普通外套，并不能保证防水。'}]});},identity.meaningId);
  const before=await inspect(sender);
  assert.deepEqual(before.learning,learned.learning);
  await sender.evaluate(async({meaningId,alignmentId})=>{
   const c=(window as any).core,seed=await c.worldReadRepository.correction(meaningId,alignmentId),operationId=crypto.randomUUID();
   const payload={...seed.payload,operationId,capturedAt:new Date().toISOString(),acceptance:{mode:'learner_direct'},expression:{surfaceForm:'jacket',languageTag:'en',expressionTypeHint:'word',occurrence:{surfaceForm:'jacket',locator:seed.payload.expression.occurrence.locator}},sense:{...seed.payload.sense,senseKey:null,wordingSource:'learner_authored',semanticSpec:{...seed.payload.sense.semanticSpec,coreMeaningFocus:'穿在身上的普通外套，不要求能够防雨。',prototypeScenes:[{summary:'天气转凉时穿上一件普通外套。',participantRoles:[],states:[],directionOrCausality:null}]}}};
   await c.createJourneyModules().personalMeaningJourney.correctPersonalMeaning({operationId,personalMeaningId:meaningId,personalMeaningAlignmentId:alignmentId,source:seed.source,payload});
  },identity);
  const corrected=await inspect(sender);
  assert.deepEqual(corrected.nonsemantic,before.nonsemantic,'correction must not rewrite any independent owner table');
  assert(!corrected.sources.some((source:any)=>source.reference.personalMeaningAlignmentId===identity.alignmentId));
  assert.equal(corrected.sources[0].expression.surfaceForm,'jacket');assert.equal(corrected.memory.targets[0].presentation.expression,'raincoat');assert.deepEqual(corrected.memory,learned.memory);
  assert.deepEqual(corrected.record.semanticAcceptances[0],learned.record.semanticAcceptances[0]);assert.deepEqual(corrected.record.alignments[0],learned.record.alignments[0]);
  await sender.evaluate(()=>(window as any).sync());await existing.evaluate(()=>(window as any).sync());
  const fresh=await fixture.createClient(account);await fresh.evaluate(()=>(window as any).sync());
  for(const page of [existing,fresh]){const restored=await inspect(page);assert.deepEqual(restored.learning,learned.learning);assert.deepEqual(restored.memory,learned.memory);assert.deepEqual(retainedMeaningFacts(restored.record),retainedMeaningFacts(corrected.record));assert.deepEqual(restored.sources,corrected.sources);}
  const backup=await fresh.evaluate(()=>(window as any).core.exportLibraryBackup('learned-personal-correction-fixture-password'));assert(backup.summary);
  await fresh.reload();await fresh.evaluate(async()=>{const path='/core.js';(window as any).core=await import(/* @vite-ignore */ path);await (window as any).core.openLibrary();});
  const reopened=await inspect(fresh);assert.deepEqual(reopened.learning,learned.learning);assert.deepEqual(reopened.memory,learned.memory);assert.deepEqual(retainedMeaningFacts(reopened.record),retainedMeaningFacts(corrected.record));
  // Returning later must use the retained admitted Target, not the corrected
  // current Meaning or an invented new target. Advance only this isolated
  // browser's trusted clock to its actual due instant before normal commands.
  await fresh.clock.setFixedTime(new Date(new Date(learned.memory.targets[0].memory.dueAt).getTime()+60_000));
  await fresh.evaluate(async targetId=>{
   const c=(window as any).core,id=()=>crypto.randomUUID(),languageContext=(await c.languageRoutesSnapshot()).context;
   await c.learningSystem.execute({kind:'start',operationId:id(),targetId,languageContext,dailyLimit:20});
   let runtime=(await c.learningSystem.read({kind:'runtime',languageContext})).runtime as LearningRuntimeProjection;
   if(runtime.currentTargetId!==targetId)throw Error('Review selected another Target');
   await c.learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'reveal'}});
   runtime=(await c.learningSystem.read({kind:'runtime',languageContext})).runtime;
   await c.learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'rate',rating:'good'}});
   await c.learningSystem.execute({kind:'finish',operationId:id(),runId:runtime.runId});
  },identity.targetId);
  const reviewed=await inspect(fresh);assert.equal(reviewed.memory.targets[0].presentation.expression,'raincoat');assert.equal(reviewed.memory.targets[0].memory.reps,learned.memory.targets[0].memory.reps+1);
  assert.equal(reviewed.learning.learningTargets.length,1);assert.equal(reviewed.learning.learningRuns.length,2);
  for(const table of ['contentAttempts','personalLearning','media'])assert.deepEqual(reviewed.learning[table],learned.learning[table],'review must not silently prepare another meaning');
  for(const table of ['learningRuns','learningEvents'])for(const original of learned.learning[table])assert.deepEqual(reviewed.learning[table].find((row:any)=>row.key===original.key),original,'original completed learning remains immutable history');
  assert.deepEqual(retainedMeaningFacts(reviewed.record),retainedMeaningFacts(corrected.record));
 }finally{await fixture.close();}
});
test('personal correction and old Sense annotations survive Cloud restore while an unchanged offline Meaning cannot reactivate the replaced interpretation',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('personal-correction-history'),sender=await fixture.createClient(account);
  const payload=manualMeaningPayload({...newManualMeaningDraft(),context:'Jo asked to borrow my umbrella. I gave it to her.',occurrence:'borrow',languageTag:'en',meaning:'暂时取得他人的物品，之后归还。',usage:'向朋友暂借雨伞。'});
  const identity=await sender.evaluate(async payload=>{
   const c=(window as any).core,accepted=await c.createJourneyModules().semanticIntake.submit(payload),record=await c.readLibrary((tx:any)=>tx.get('semanticMeanings',accepted.personalMeaningId)),alignment=record.alignments[0];
   await c.personalContentSystem.execute({kind:'set_saved_sense',operationId:crypto.randomUUID(),senseId:alignment.senseId,saved:true});
   await c.personalContentSystem.execute({kind:'set_sense_note',operationId:crypto.randomUUID(),senseId:alignment.senseId,body:'旧笔记对应借入。',expected:{body:'',revision:0}});
   return {meaningId:accepted.personalMeaningId,senseId:alignment.senseId,alignmentId:alignment.personalMeaningAlignmentId};
  },payload);
  const inspect=(page:import('@playwright/test').Page)=>page.evaluate(async({meaningId,senseId})=>{
   const c=(window as any).core;await c.personalContentSystem.refresh();
   const personal=c.personalContentSystem.read({kind:'snapshot'});
   return {record:await c.readLibrary((tx:any)=>tx.get('semanticMeanings',meaningId)),references:await c.worldReadRepository.references([senseId]),saved:[...personal.savedSenseIds],note:await c.personalContentSystem.readSenseNote(senseId),receipts:await c.readLibrary((tx:any)=>tx.entries('semanticReceipts')),targets:(await c.readLearning()).targets,runs:await c.readLibrary((tx:any)=>tx.entries('learningRuns'))};
  },identity);
  await sender.evaluate(()=>(window as any).sync());const offline=await fixture.createClient(account);await offline.evaluate(()=>(window as any).sync());const original=await inspect(offline);
  await offline.evaluate(()=>{(window as any).offline=true;});
  const correction=await sender.evaluate(async({meaningId,alignmentId})=>{
   const c=(window as any).core,seed=await c.worldReadRepository.correction(meaningId,alignmentId),operationId=crypto.randomUUID();
   const payload={...seed.payload,operationId,capturedAt:new Date().toISOString(),acceptance:{mode:'learner_direct'},expression:{...seed.payload.expression,surfaceForm:'lend',occurrence:{...seed.payload.expression.occurrence,surfaceForm:'lend'}},sense:{...seed.payload.sense,senseKey:null,wordingSource:'learner_authored',semanticSpec:{...seed.payload.sense.semanticSpec,coreMeaningFocus:'把自己的物品暂时交给别人使用，之后收回。',prototypeScenes:[{summary:'把雨伞暂借给同事，用完后收回。',participantRoles:[],states:[],directionOrCausality:null}]}}};
   return c.createJourneyModules().personalMeaningJourney.correctPersonalMeaning({operationId,personalMeaningId:meaningId,personalMeaningAlignmentId:alignmentId,source:seed.source,payload});
  },identity);
  await sender.evaluate(()=>(window as any).sync());assert.deepEqual((await inspect(offline)).record,original.record,'the old device has not received the correction');
  await offline.evaluate(async senseId=>{const c=(window as any).core;await c.personalContentSystem.execute({kind:'set_sense_note',operationId:crypto.randomUUID(),senseId,body:'离线修改的旧笔记仍对应借入。',expected:await c.personalContentSystem.readSenseNote(senseId)});(window as any).offline=false;await (window as any).sync();},identity.senseId);
  await sender.evaluate(()=>(window as any).sync());const corrected=await inspect(sender);
  const compare=(value:Awaited<ReturnType<typeof inspect>>)=>({...value,record:retainedMeaningFacts(value.record)});
  assert.deepEqual(compare(await inspect(offline)),compare(corrected));
  assert.equal(corrected.record.personalMeaning.personalMeaningId,identity.meaningId);assert.equal(corrected.record.personalMeaning.currentRevision,correction.revision);
  assert.deepEqual(corrected.record.alignments[0],original.record.alignments[0]);assert.deepEqual(corrected.record.semanticAcceptances[0],original.record.semanticAcceptances[0]);assert.deepEqual(corrected.record.personalSemanticAnchorRevisions,original.record.personalSemanticAnchorRevisions);
  assert.equal(corrected.record.alignmentEvents.find((row:any)=>row.personalMeaningAlignmentId===identity.alignmentId&&row.ordinal===2)?.eventType,'withdrawn');
  assert(corrected.references[0].references.some((row:any)=>row.personalMeaningAlignmentId===identity.alignmentId&&row.senseId===identity.senseId&&row.word==='borrow'&&row.historical));
  assert.deepEqual(corrected.saved,[identity.senseId]);assert.deepEqual(corrected.note,{body:'离线修改的旧笔记仍对应借入。',revision:2});assert.deepEqual(corrected.targets,[]);assert.deepEqual(corrected.runs,[]);
  const fresh=await fixture.createClient(account);await fresh.evaluate(()=>(window as any).sync());assert.deepEqual(compare(await inspect(fresh)),compare(corrected));
  const backup=await fresh.evaluate(()=>(window as any).core.exportLibraryBackup('correction-history-fixture-password'));assert(backup.summary);
  await fresh.reload();await fresh.evaluate(async()=>{const path='/core.js';(window as any).core=await import(/* @vite-ignore */ path);await (window as any).core.openLibrary();});assert.deepEqual(compare(await inspect(fresh)),compare(corrected));
 }finally{await fixture.close();}
});
test('personal meaning recycle-bin deletion beats an unchanged offline replica and explicit same-identity restoration survives Cloud reload',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('personal-meaning-recycle-bin'),sender=await fixture.createClient(account);
  const payload=manualMeaningPayload({...newManualMeaningDraft(),context:'I asked to borrow an umbrella and promised to return it.',occurrence:'borrow',canonicalForm:'borrow',languageTag:'en',meaning:'临时借用物品，之后归还。',usage:'下雨时向同伴暂借雨伞。'});
  const accepted=await sender.evaluate(payload=>(window as any).core.createJourneyModules().semanticIntake.submit(payload),payload);
  assert.equal(accepted.route,'fast_track');const meaningId=accepted.personalMeaningId;
  const inspect=(page:import('@playwright/test').Page)=>page.evaluate(async meaningId=>{
   const c=(window as any).core;
   return {record:await c.readLibrary((tx:any)=>tx.get('semanticMeanings',meaningId)),receipts:await c.readLibrary((tx:any)=>tx.entries('semanticReceipts')),active:(await c.worldReadRepository.page({query:'',filter:'all',offset:0,limit:64})).items,trash:(await c.worldReadRepository.page({query:'',filter:'deleted',offset:0,limit:64})).items,targets:(await c.readLearning()).targets,runs:await c.readLibrary((tx:any)=>tx.entries('learningRuns'))};
  },meaningId);
  await sender.evaluate(()=>(window as any).sync());
  const offline=await fixture.createClient(account);await offline.evaluate(()=>(window as any).sync());
  const original=await inspect(offline);assert.equal(original.record.personalMeaning.status,'active');
  await offline.evaluate(async()=>{const c=(window as any).core;(window as any).offline=true;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'unrelated offline material must survive'});});
  const remove=await sender.evaluate(async meaningId=>(window as any).core.createJourneyModules().personalMeaningJourney.changeMeaningLifecycle({operationId:crypto.randomUUID(),personalMeaningId:meaningId,expectedRevision:1,action:'delete'}),meaningId);
  await sender.evaluate(()=>(window as any).sync());
  assert.equal((await inspect(offline)).record.personalMeaning.status,'active','the old device is genuinely still offline');
  await offline.evaluate(async()=>{(window as any).offline=false;return (window as any).sync();});
  const deleted=await inspect(offline);assert.equal(deleted.record.personalMeaning.status,'deleted');assert.equal(deleted.active.length,0);assert.equal(deleted.trash.length,1);assert.deepEqual(deleted.targets,[]);assert.deepEqual(deleted.runs,[]);
  await sender.evaluate(()=>(window as any).sync());
  assert.equal((await sender.evaluate(()=>(window as any).core.listDrafts())).length,1,'merging the tombstone does not discard unrelated offline content');
  const fresh=await fixture.createClient(account);await fresh.evaluate(()=>(window as any).sync());assert.deepEqual((await inspect(fresh)).record,deleted.record);
  const restore=await sender.evaluate(async({meaningId,revision})=>(window as any).core.createJourneyModules().personalMeaningJourney.changeMeaningLifecycle({operationId:crypto.randomUUID(),personalMeaningId:meaningId,expectedRevision:revision,action:'restore'}),{meaningId,revision:remove.revision});
  assert.equal(restore.personalMeaningId,meaningId);await sender.evaluate(()=>(window as any).sync());await offline.evaluate(()=>(window as any).sync());await fresh.evaluate(()=>(window as any).sync());
  const restored=await inspect(fresh);assert.equal(restored.record.personalMeaning.status,'active');assert.equal(restored.record.personalMeaning.lifecycleRevision,3);assert.equal(restored.active.length,1);assert.equal(restored.trash.length,0);
  assert.deepEqual(restored.record.personalMeaningRevisions.slice(0,2),deleted.record.personalMeaningRevisions);assert.deepEqual(restored.record.semanticAcceptances,original.record.semanticAcceptances);
  await fresh.reload();await fresh.evaluate(async()=>{const path='/core.js';(window as any).core=await import(/* @vite-ignore */ path);await (window as any).core.openLibrary();});
  assert.deepEqual((await inspect(fresh)).record,restored.record);assert.deepEqual((await inspect(fresh)).receipts,restored.receipts);
 }finally{await fixture.close();}
});
test('note edits reject a same-revision Cloud fork replacement and an unchanged offline copy cannot resurrect a cleared note',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('personal-note-fork'),a=await fixture.createClient(account);
  const payload=manualMeaningPayload({...newManualMeaningDraft(),context:'I asked to borrow an umbrella and promised to return it.',occurrence:'borrow',canonicalForm:'borrow',languageTag:'en',meaning:'临时借用物品，之后归还。',usage:'下雨时向同伴暂借雨伞。'});
  const senseId=await a.evaluate(async payload=>{
   const c=(window as any).core,accepted=await c.createJourneyModules().semanticIntake.submit(payload);
   const record=await c.readLibrary((tx:any)=>tx.get('semanticMeanings',accepted.personalMeaningId));return record.alignments[0].senseId as string;
  },payload);
  const read=(page:import('@playwright/test').Page)=>page.evaluate(senseId=>(window as any).core.personalContentSystem.readSenseNote(senseId),senseId);
  const save=(page:import('@playwright/test').Page,body:string,expected:{body:string;revision:number})=>page.evaluate(({senseId,body,expected})=>(window as any).core.personalContentSystem.execute({kind:'set_sense_note',operationId:crypto.randomUUID(),senseId,body,expected}),{senseId,body,expected});
  await save(a,'original note',await read(a));await a.evaluate(()=>(window as any).sync());
  const b=await fixture.createClient(account);await b.evaluate(()=>(window as any).sync());assert.deepEqual(await read(b),{body:'original note',revision:1});
  await save(a,'device A branch',await read(a));await save(b,'device B branch',await read(b));
  const staleBase=await read(b);assert.equal(staleBase.revision,2);
  await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
  assert.equal((await b.evaluate(()=>(window as any).core.readCloudSync())).status,'conflict');
  assert.deepEqual(await read(b),staleBase,'unresolved conflict must not silently replace the local note');
  await b.evaluate(async()=>{const c=(window as any).core;await c.resolveCloudSyncConflicts('remote',(await c.readCloudSync()).conflict);await (window as any).sync();});
  assert.deepEqual(await read(b),{body:'device A branch',revision:2},'explicit resolution selects the other legitimate branch without renumbering it');
  const staleOperationId=crypto.randomUUID();
  const rejection=await b.evaluate(async({senseId,expected,operationId})=>{
   const c=(window as any).core;
   try{await c.personalContentSystem.execute({kind:'set_sense_note',operationId,senseId,body:'stale editing draft',expected});return {error:null};}
   catch(error){return {error:(error as Error).message,current:(error as any).current,receipt:await c.readLibrary((tx:any)=>tx.get('operations',operationId))??null};}
  },{senseId,expected:staleBase,operationId:staleOperationId});
  assert.deepEqual(rejection,{error:'personalContent.noteChanged',current:{body:'device A branch',revision:2},receipt:null});
  await save(b,'explicitly reviewed replacement',await read(b));await b.evaluate(()=>(window as any).sync());await a.evaluate(()=>(window as any).sync());assert.deepEqual(await read(a),{body:'explicitly reviewed replacement',revision:3});
  const old=await fixture.createClient(account);await old.evaluate(()=>(window as any).sync());await old.evaluate(()=>{(window as any).offline=true;});
  await save(a,'',await read(a));await a.evaluate(()=>(window as any).sync());
  assert.deepEqual(await read(old),{body:'explicitly reviewed replacement',revision:3},'the old replica is actually still offline');
  await old.evaluate(async()=>{(window as any).offline=false;await (window as any).sync();});assert.deepEqual(await read(old),{body:'',revision:4});
  await a.evaluate(()=>(window as any).sync());assert.deepEqual(await read(a),{body:'',revision:4},'unchanged offline text cannot resurrect the cleared note');
  const fresh=await fixture.createClient(account);await fresh.evaluate(()=>(window as any).sync());assert.deepEqual(await read(fresh),{body:'',revision:4});
  const backup=await fresh.evaluate(()=>(window as any).core.exportLibraryBackup('personal-note-fixture-password'));assert(backup.summary);
  await fresh.reload();await fresh.evaluate(async()=>{const path='/core.js';(window as any).core=await import(/* @vite-ignore */ path);await (window as any).core.openLibrary();});
  assert.deepEqual(await read(fresh),{body:'',revision:4});
 }finally{await fixture.close();}
});

test('direct learning intent and ready membership survive cloud restore without a Personal Meaning or package cache',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('direct-learning'),sender=await fixture.createClient(account);
  const publication=await libraryCloudPackageFixture();
  const intent=await sender.evaluate(async({bookBytes,descriptor})=>{
   const c=(window as any).core,original=window.fetch;
   window.fetch=async input=>String(input)===descriptor.url?new Response(new Uint8Array(bookBytes)):new Response(null,{status:404});
   try{
    await c.contentSupplySystem.execute({kind:'install_catalog_item',descriptor,signal:new AbortController().signal});
    const languageContext=(await c.languageRoutesSnapshot()).context;
    const choices=await c.learningSystem.read({kind:'direct_choices',query:'borrow',targetLanguageTag:languageContext.targetLanguageTag,page:0});
    const reference=choices.items[0].reference,source=await c.learningSystem.read({kind:'direct_source',reference});
    return c.learningSystem.execute({kind:'enroll_direct',operationId:crypto.randomUUID(),reference,expectedDigest:source.sourceDigest,languageContext});
   }finally{window.fetch=original;}
  },{bookBytes:Array.from(publication.bookBytes),descriptor:publication.descriptor});
  await sender.evaluate(()=>(window as any).sync());
  const pendingReceiver=await fixture.createClient(account);await pendingReceiver.evaluate(()=>(window as any).sync());
  const inspect=(page:import('@playwright/test').Page)=>page.evaluate(async(enrollmentId)=>{
   const c=(window as any).core;
   await c.personalContentSystem.refresh();const annotations=c.personalContentSystem.read({kind:'snapshot'});
   return {intent:await c.learningSystem.read({kind:'direct_enrollment',enrollmentId}),targets:(await c.readLearning()).targets,
    semanticMemory:await c.learningSystem.read({kind:'semantic_memory'}),annotations:{savedSenseIds:[...annotations.savedSenseIds],senseNotes:annotations.senseNotes},
    meanings:await c.readLibrary((tx:any)=>tx.entries('semanticMeanings')),packages:await c.installedPackages()};
  },intent.enrollmentId);
  const pending=await inspect(pendingReceiver);assert.deepEqual(pending.intent,intent);assert.deepEqual(pending.targets,[]);assert.deepEqual(pending.meanings,[]);assert.deepEqual(pending.packages,[]);
  const change=async(expectedRevision:number,active:boolean)=>sender.evaluate(async({enrollmentId,expectedRevision,active})=>{const c=(window as any).core;return c.learningSystem.execute({kind:'change_supplemental_membership',operationId:crypto.randomUUID(),source:{kind:'stable_sense',id:enrollmentId},expectedRevision,active,languageContext:(await c.languageRoutesSnapshot()).context});},{enrollmentId:intent.enrollmentId,expectedRevision,active});
  await change(0,false);await sender.evaluate(()=>(window as any).sync());
  await pendingReceiver.evaluate(()=>(window as any).sync());
  assert.equal((await inspect(pendingReceiver)).intent.status,'removed');
  const blocked=await pendingReceiver.evaluate(async enrollmentId=>{try{await (window as any).core.learningSystem.execute({kind:'prepare_direct',operationId:crypto.randomUUID(),enrollmentId});return null;}catch(error){return (error as Error).message;}},intent.enrollmentId);
  assert.equal(blocked,'localFlow.membershipRemoved');assert.deepEqual((await inspect(pendingReceiver)).targets,[]);
  await change(1,true);await sender.evaluate(()=>(window as any).sync());
  await pendingReceiver.evaluate(()=>(window as any).sync());
  assert.equal((await inspect(pendingReceiver)).intent.status,'awaiting_content');
  assert.equal((await inspect(pendingReceiver)).intent.membershipRevision,2);
  assert.equal((await sender.evaluate(enrollmentId=>(window as any).core.learningSystem.execute({kind:'prepare_direct',operationId:crypto.randomUUID(),enrollmentId}),intent.enrollmentId)).status,'ready');
  await sender.evaluate(async()=>{const c=(window as any).core,target=(await c.learningSystem.read({kind:'semantic_memory'})).targets[0];await c.personalContentSystem.execute({kind:'set_saved_sense',operationId:crypto.randomUUID(),senseId:target.senseId,saved:true});await c.personalContentSystem.execute({kind:'set_sense_note',operationId:crypto.randomUUID(),senseId:target.senseId,body:'Saved nonbundled source survives cacheless Cloud restore.',expected:await c.personalContentSystem.readSenseNote(target.senseId)});});
  await sender.evaluate(()=>(window as any).sync());
  const receiver=await fixture.createClient(account);await receiver.evaluate(()=>(window as any).sync());
  const ready=await inspect(receiver),original=await inspect(sender);
  assert.deepEqual(ready.targets,original.targets);assert.equal(ready.targets.length,1);assert.equal(ready.targets[0].curriculumMemberships[0].sourceKind,'stable_sense');
  assert.deepEqual(ready.meanings,[]);assert.deepEqual(ready.packages,[]);
  assert.deepEqual(ready.semanticMemory,original.semanticMemory,'restored Target facts rebuild the compact read projection without package bytes');
  assert.deepEqual(ready.annotations,original.annotations);
  assert.equal(ready.semanticMemory.targets[0].targetId,ready.targets[0].id);assert.equal(ready.semanticMemory.targets[0].memory,null,'bookmarking and notes never fabricate memory');
  assert.deepEqual(ready.annotations.savedSenseIds,[ready.targets[0].identity.senseId]);assert.equal(ready.annotations.senseNotes[ready.targets[0].identity.senseId],'Saved nonbundled source survives cacheless Cloud restore.');
  assert.deepEqual(await receiver.evaluate(targetId=>(window as any).core.learningSystem.read({kind:'semantic_memory',targetId}),ready.targets[0].id),ready.semanticMemory,'an exact restored reference remains readable without public cache');
  const backup=await receiver.evaluate(async()=>{const c=(window as any).core;return (await c.exportLibraryBackup('direct-fixture-backup-password')).summary;});
  assert.equal(backup.targets,1);assert.equal(backup.runs,0,'restoration never fabricates a Run');
  await receiver.reload();await receiver.evaluate(async()=>{const path='/core.js';(window as any).core=await import(/* @vite-ignore */ path);await (window as any).core.openLibrary();});
  const reopened=await inspect(receiver);assert.deepEqual(reopened.targets,ready.targets);assert.deepEqual(reopened.semanticMemory,ready.semanticMemory);assert.deepEqual(reopened.annotations,ready.annotations);
 }finally{await fixture.close();}
});
test('an explicitly ended unfinished Session restores through Cloud without an active pointer, completion or public package bytes',async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await fixture.createAccount('unfinished-session-end'),sender=await fixture.createClient(account),publication=await libraryCloudPackageFixture();
  const ids=await sender.evaluate(async({bookBytes,descriptor})=>{
   const c=(window as any).core,fetch=window.fetch;window.fetch=async input=>String(input)===descriptor.url?new Response(new Uint8Array(bookBytes)):new Response(null,{status:404});
   try{
    await c.contentSupplySystem.execute({kind:'install_catalog_item',descriptor,signal:new AbortController().signal});
    const languageContext=(await c.languageRoutesSnapshot()).context;
    const targetIds=await c.learningSystem.execute({kind:'enroll_book',operationId:crypto.randomUUID(),languageContext,publicationArchiveSha256:descriptor.sha256});
    await c.learningSystem.execute({kind:'confirm_quantity',operationId:crypto.randomUUID(),languageContext,dailyLimit:20});
    await c.learningSystem.execute({kind:'start',operationId:crypto.randomUUID(),targetId:targetIds[0],languageContext,dailyLimit:20});
    let {runtime}=await c.learningSystem.read({kind:'runtime',languageContext});
    await c.learningSystem.execute({kind:'act',operationId:crypto.randomUUID(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'reveal'}});
    ({runtime}=await c.learningSystem.read({kind:'runtime',languageContext}));
    const run=await c.readLibrary((tx:any)=>tx.get('learningRuns',runtime.runId));
    await c.learningSystem.execute({kind:'end_session',operationId:crypto.randomUUID(),runId:run.id,expectedRevision:run.revision});
    return {runId:run.id,sessionId:run.learningSessionId,scopeId:run.studyScopeRevisionId};
   }finally{window.fetch=fetch;}
  },{bookBytes:Array.from(publication.bookBytes),descriptor:publication.descriptor});
  const inspect=(page:import('@playwright/test').Page)=>page.evaluate(async ids=>{
   const c=(window as any).core;return c.readLibrary(async(tx:any)=>({run:await tx.get('learningRuns',ids.runId),session:await tx.get('learningSessions',ids.sessionId),scope:await tx.get('studyScopes',ids.scopeId),activeRun:await tx.get('meta','learning-active')??null,activeSession:await tx.get('meta','learning-session-active')??null,targets:await tx.all('learningTargets'),events:await tx.all('learningEvents')}));
  },ids);
  const original=await inspect(sender);assert.equal(original.session.endReason,'learner_ended');assert.equal(original.run.completedAt,null);assert.equal(original.events.length,1);
  assert(original.targets.every((target:any)=>target.memoryRevision===0&&!target.memory));assert.equal(original.activeRun,null);assert.equal(original.activeSession,null);
  await sender.evaluate(()=>(window as any).sync());
  const receiver=await fixture.createClient(account);await receiver.evaluate(()=>(window as any).sync());
  assert.deepEqual(await inspect(receiver),original);assert.equal((await receiver.evaluate(()=>(window as any).core.installedPackages())).length,0);
  await receiver.reload();await receiver.evaluate(async()=>{const path='/core.js';(window as any).core=await import(/* @vite-ignore */ path);await (window as any).core.openLibrary();});
  assert.deepEqual(await inspect(receiver),original);
 }finally{await fixture.close();}
});

test('Cloud Checkpoint preserves learner facts across real Chromium and Postgres', async({browser})=>{
 const fixture=await createLibraryCloudBrowserFixture(browser);
 const {origin,pool}=fixture;
 try{
 const primary=await fixture.createAccount('first'),secondary=await fixture.createAccount('second'),clearance=await fixture.createAccount('clearance');
 const accountId=primary.accountId,otherId=secondary.accountId;
 const a=await fixture.createClient(primary);const b=await fixture.createClient(primary);const other=await fixture.createClient(secondary);
 await test.step('explicit Agent destination initialization publishes only an empty account identity',async()=>{
  const agentAccount=await fixture.createAccount('agent-empty-identity');
  const sender=await fixture.createClient(agentAccount);
  const originalIdentity=await sender.evaluate(()=>(window as any).core.openLibrary());
  await sender.evaluate(()=>(window as any).sync());
  assert.equal((await pool.query('SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[agentAccount.accountId])).rows[0].revision,0,'ordinary empty boot stays read-only');
  await sender.evaluate(()=>(window as any).core.synchronizeLibrary((window as any).request,{publishEmptyIdentity:true}));
  const initialized=(await pool.query('SELECT revision,library_id FROM sensa_consumer.library_cloud WHERE account_id=$1',[agentAccount.accountId])).rows[0];
  assert.equal(initialized.revision,1);assert(initialized.library_id);
  assert.deepEqual(await sender.evaluate(()=>(window as any).core.listDrafts()),[],'identity initialization cannot invent learner material');
  const receiver=await fixture.createClient(agentAccount);await receiver.evaluate(()=>(window as any).sync());
  const restoredIdentity=await receiver.evaluate(()=>(window as any).core.openLibrary());
  assert.equal(restoredIdentity.id,originalIdentity.id,'another empty device restores the same Agent destination identity');
  await receiver.evaluate(()=>(window as any).core.synchronizeLibrary((window as any).request,{publishEmptyIdentity:true}));
  assert.equal((await pool.query('SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[agentAccount.accountId])).rows[0].revision,1,'initialization is idempotent, not another destination');
  await sender.context().close();await receiver.context().close();
 });
 await test.step('account isolation, local caches, legacy heads and mid-sync writes',async()=>{
 const draft=await a.evaluate(async()=>{const c=(window as any).core;return c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'My raincoat',images:[{id:crypto.randomUUID(),name:'raincoat.jpg',dataUrl:document.createElement('canvas').toDataURL('image/jpeg')}]});});
 await a.evaluate(()=>(window as any).sync());
 await b.evaluate(()=>(window as any).sync());assert.deepEqual(await b.evaluate(()=>(window as any).core.listDrafts()),[draft]);
 // Service package descriptors are device-local caches and must never replace
 // one browser's fresh catalog with another browser's stale copy.
 await a.evaluate(async()=>{const c=(window as any).core;await c.writeLibraryState((tx:any)=>tx.put('meta','package-catalog',{format:'sensa-local-registry-cache-v3',revision:'catalog-a',checkedAt:'2026-09-20T00:00:00.000Z',items:[]}));});
 await b.evaluate(async()=>{const c=(window as any).core;await c.writeLibraryState((tx:any)=>tx.put('meta','package-catalog',{format:'sensa-local-registry-cache-v3',revision:'catalog-b',checkedAt:'2026-09-20T00:00:01.000Z',items:[]}));});
 await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
 assert.equal(await b.evaluate(()=>(window as any).core.readLibrary((tx:any)=>tx.get('meta','package-catalog')).then((catalog:any)=>catalog.revision)),'catalog-b','package catalog cache stays device-local');
 fixture.clearRequests();await b.evaluate(()=>(window as any).sync());assert.equal(fixture.requests().filter(c=>c.path.endsWith('/blocks/fetch')).length,0,'unchanged content is reused locally without a batch fetch');
 await other.evaluate(async()=>{const c=(window as any).core,state=await c.readLibrary(async(tx:any)=>({owner:await tx.get('meta','service-owner'),incarnation:await c.assertCurrentLibrary(tx)}));await c.writeLibraryState((tx:any)=>{tx.put('meta','cloud-sync',{...state,revision:0,status:'failed',error:'legacy_unclassified_failure'});tx.replaceSyncBase([]);});});
 fixture.clearRequests();await other.evaluate(()=>(window as any).sync());assert.deepEqual(await other.evaluate(()=>(window as any).core.listDrafts()),[]);
 const emptyState=await other.evaluate(()=>(window as any).core.readCloudSync());assert.equal(emptyState.status,'synced');assert.equal(emptyState.error,undefined);
 const emptyHead=(await pool.query('SELECT revision,manifest FROM sensa_consumer.library_cloud WHERE account_id=$1',[otherId])).rows[0];assert.equal(emptyHead.revision,0);assert.equal(emptyHead.manifest,null);
 assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[otherId])).rows[0].n,0,'an authoritative empty account must not upload bootstrap identity blocks');
 assert.deepEqual(fixture.requests().map(call=>call.path),['/sensa/library-sync/head'],'legacy failure migration only confirms the empty remote head');
 const hash=(await pool.query('SELECT hash FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 LIMIT 1',[accountId])).rows[0].hash;
 assert.equal((await fetch(origin+'/sensa/library-sync/blocks/'+hash,{headers:{authorization:'Bearer second'}})).status,404,'blocks are account isolated');
 // A legacy Checkpoint is terminal: reject its old head format, preserve the
 // local library, and leave retry scheduling to explicit recovery.
 const legacyRow=JSON.stringify({kind:'legacy-operation',payload:'x'.repeat(32_768)}),legacyRowHash=createHash('sha256').update(legacyRow).digest('hex');
 const legacyManifest=JSON.stringify({version:5,libraryId:crypto.randomUUID(),learnerId:crypto.randomUUID(),rows:[{table:'drafts',key:crypto.randomUUID(),blocks:[legacyRowHash]}]}),legacyManifestHash=createHash('sha256').update(legacyManifest).digest('hex');
 await pool.query('INSERT INTO sensa_consumer.library_cloud_blocks(account_id,hash,data) VALUES($1,$2,$3),($1,$4,$5) ON CONFLICT(account_id,hash) DO UPDATE SET data=EXCLUDED.data',[otherId,legacyRowHash,legacyRow,legacyManifestHash,legacyManifest]);
 await pool.query('UPDATE sensa_consumer.library_cloud SET revision=revision+1,manifest=$2::jsonb,updated_at=now() WHERE account_id=$1',[otherId,JSON.stringify([legacyManifestHash])]);
 const legacy=await fixture.createClient(secondary),localIdentity=await legacy.evaluate(()=>(window as any).core.openLibrary());fixture.clearRequests();
 await assert.rejects(legacy.evaluate(()=>(window as any).sync()),/library_sync_incompatible_checkpoint/);
 const legacyState=await legacy.evaluate(()=>(window as any).core.readCloudSync());
 assert.equal(legacyState.status,'failed');assert.equal(legacyState.error,'library_sync_incompatible_checkpoint');assert.equal(legacyState.failureKind,'terminal');assert.equal(legacyState.retryAt,undefined);
 assert.equal(fixture.requests().filter(c=>c.path.endsWith('/blocks/fetch')).length,0,'legacy blocks must not be downloaded');
 assert.deepEqual(await legacy.evaluate(()=>(window as any).core.openLibrary()),localIdentity,'legacy cloud data must not modify the local library');
 await legacy.context().close();
 // A local write arriving after the sync snapshot is captured is fenced, then retried safely.
 await a.evaluate(()=>{const w=window as any,original=w.request;let once=true;w.request=async(path:string,body?:unknown)=>{const result=await original(path,body);if(path==='/head'&&once){once=false;await w.core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Written during sync'});}return result;};});
 await assert.rejects(a.evaluate(()=>(window as any).sync()),/library_sync_local_changed/);await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());assert((await b.evaluate(()=>(window as any).core.listDrafts())).some((d:any)=>d.text==='Written during sync'));
 });
 await test.step('local clearance checkpoints first and only explicit current discard leaves cloud untouched',async()=>{
  const page=await fixture.createClient(clearance);
  const initialIdentity=await page.evaluate(()=>(window as any).core.openLibrary());
  await page.evaluate(()=>(window as any).sync());
  await page.evaluate(async()=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'checkpoint before local clearance'});});
  let preview=await page.evaluate(()=>(window as any).core.inspectLocalClear());
  assert.equal(preview.pendingSync,1);assert.equal(preview.syncAttempt,'required');
  await assert.rejects(page.evaluate((value)=>(window as any).core.clearLocalLibrary(value),preview),/localFlow\.clearSyncRequired/);
  preview=await page.evaluate((value)=>(window as any).core.attemptLocalClearSync(value,()=>(window as any).sync()),preview);
	  assert.equal(preview.pendingSync,0);assert.equal(preview.syncAttempt,'succeeded');

	  const pendingId=await page.evaluate(async()=>{const c=(window as any).core,id=crypto.randomUUID();await c.saveDraft(crypto.randomUUID(),{id,expectedRevision:0,text:'preserve me when sync fails'});return id;});
	  await page.evaluate(()=>{(window as any).offline=true;});
	  await page.evaluate(async()=>{const path='/local-clear.js',ui=await import(/* @vite-ignore */ path);ui.mountLocalDataControl();});
	  await page.getByRole('button',{name:'Review local content',exact:true}).click();
	  await expect(page.getByText('1 pending changes',{exact:true})).toBeVisible();
	  await page.getByLabel('I have saved any backup I need and confirm erasing this local content.').check();
	  await expect(page.getByRole('button',{name:'Erase local content',exact:true})).toBeDisabled();
	  await page.getByRole('button',{name:'Sync now',exact:true}).click();
	  await expect(page.getByText('Sync did not finish. Your local data is still saved. Check the connection and retry.',{exact:true})).toBeVisible();
	  assert((await page.evaluate(()=>(window as any).core.listDrafts())).some((draft:any)=>draft.id===pendingId),'failed pre-clear sync must preserve local OPFS data');
	  await page.getByLabel(/Discard these 1 unsynced account change/).check();
	  await page.getByLabel('I have saved any backup I need and confirm erasing this local content.').check();
	  await page.evaluate(async()=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'newer than discard confirmation'});});
	  await page.getByRole('button',{name:'Erase local content',exact:true}).click();
	  await expect(page.getByText('The library changed. Check it again before confirming erasure.',{exact:true})).toBeVisible();
	  assert((await page.evaluate(()=>(window as any).core.listDrafts())).some((draft:any)=>draft.id===pendingId),'a stale discard confirmation must not clear newer local data');
	  await page.getByRole('button',{name:'Review local content',exact:true}).click();
	  await expect(page.getByText('2 pending changes',{exact:true})).toBeVisible();
	  await page.getByRole('button',{name:'Sync now',exact:true}).click();
	  await page.getByLabel(/Discard these 2 unsynced account change/).check();
	  await page.getByLabel('I have saved any backup I need and confirm erasing this local content.').check();
	  const cloudBefore=(await pool.query('SELECT revision,manifest FROM sensa_consumer.library_cloud WHERE account_id=$1',[clearance.accountId])).rows[0];
	  await page.getByRole('button',{name:'Erase local content',exact:true}).click();
	  await expect(page.getByText('Local content cleared. Reopen the app to use the empty library.',{exact:true})).toBeVisible();
  const after=await page.evaluate(async()=>{const c=(window as any).core;return {identity:await c.readLibrary((tx:any)=>tx.get('meta','identity')),owner:await c.readLibrary((tx:any)=>tx.get('meta','service-owner')),drafts:await c.listDrafts()};});
  assert.notEqual(after.identity.id,initialIdentity.id);assert.deepEqual(after.owner,{subject:clearance.subject,accountId:clearance.accountId,email:'learner@fixture.invalid'});assert.deepEqual(after.drafts,[]);
  const cloudAfter=(await pool.query('SELECT revision,manifest FROM sensa_consumer.library_cloud WHERE account_id=$1',[clearance.accountId])).rows[0];
  assert.deepEqual(cloudAfter,cloudBefore,'discarding pending local records must not create a cloud tombstone or rewrite the checkpoint');
  await page.context().close();
 });
 const delivery=await libraryCloudPackageFixture(),bookBytes=Array.from(delivery.bookBytes),descriptor=delivery.descriptor;
 let progress='';
 await test.step('canonical Intake and exact package installation facts restore without artifact bytes',async()=>{
 // Canonical v3 Intake -> Personal Semantic World -> generated resources.
 await a.evaluate(async()=>{
  const c=(window as any).core,id=()=>crypto.randomUUID(),library=await c.openLibrary();
  const operationId=id(),modules=c.createJourneyModules(),intake=modules.semanticIntake;
  const text='I wore my raincoat in the rain.';
  const accepted=await intake.submit({contractVersion:'sensa-intake-v3',operationId,capturedAt:new Date().toISOString(),context:{modality:'text',textSegment:text,mediaReferenceIds:[],languageTag:'en',source:{client:'sensa-web',url:'https://example.org',title:'A rainy day',sourceReferenceId:null,domSelector:null,paragraphContext:null}},expression:{surfaceForm:'raincoat',languageTag:'en',occurrence:{surfaceForm:'raincoat',locator:{kind:'text_span',start:10,end:18}},expressionTypeHint:'word'},sense:{senseKey:null,semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'防雨时穿在身上的衣服',prototypeScenes:[{summary:'一个人在雨中穿着防水的外衣。',participantRoles:['穿衣者'],states:['下雨'],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]},wordingSource:'llm_suggested',resolutionProvenance:{resolverKind:'language_model',provider:'fixture',model:'fixture',policyVersion:'fixture-v1',sourceReferenceIds:['cloud-smoke']}},acceptance:{mode:'learner_direct'}});
  if(accepted.route!=='fast_track'||!accepted.personalMeaningId)throw Error('canonical intake not accepted');
  const source=(await c.worldReadRepository.detail(accepted.personalMeaningId)).sources[0];if(!source)throw Error('canonical learning source missing');
  const provider=await c.saveProvider(id(),{id:id(),expectedRevision:0,name:'Test model',kind:'compatible',endpoint:'https://sync-model.invalid/v1',model:'synthetic'},'fixture-device-secret');
  const settings=(await c.providerSnapshot()).settings;await c.assignProvider(id(),'content',provider.id,settings.revision);
  const restoreSpeech=c.replaceClientSpeechProvider({id:'fixture',revision:1,displayName:'Fixture',synthesize:async(input:any)=>({...input,audioUrl:'data:audio/mpeg;base64,UklGRg==',phoneticNotation:null,accentLabel:'en-US',source:'synthetic test fixture',method:'tts'})});
  const original=window.fetch;window.fetch=async(url:any,init:any)=>{const address=String(url);if(address.endsWith('/sensa/resource-facts'))return new Response(JSON.stringify({input:JSON.parse(String(init?.body)),references:[]}),{headers:{'content-type':'application/json'}});if(address.startsWith(provider.endpoint))return new Response(JSON.stringify({model:'synthetic',choices:[{finish_reason:'stop',message:{content:JSON.stringify({resources:[{role:'experience_recall_cue',payload:{scene:'下雨时一个人穿了自己的防水外衣，挡住雨水。',senseFocus:'防雨时穿在身上的衣服'}},{role:'scene_bridge',payload:{text:'回想雨中穿着防水外衣的体验。',meaningRendering:{meaning:'在下雨时穿在身上、用来挡雨的外衣。',languageTag:'zh-CN'}}},{role:'scene_realization',payload:{example:'I wore my raincoat in the rain.',targetStart:10,targetEnd:18,experienceResourceKey:'experience_recall_cue:0'}}]})}}]}),{headers:{'content-type':'application/json'}});return original(url,init);};
  try{const languageContext=(await c.languageRoutesSnapshot()).context,task=await c.enrollPersonal(id(),source,languageContext,true);await c.preparePersonal(task.id,source,provider,null,new AbortController().signal,()=>{});}finally{restoreSpeech();window.fetch=original;}
  if((await c.personalLearningSnapshot())[0].status!=='ready')throw Error('personal resources not ready');
 });
 // Actual learning resources (including audio), runtime records and schedule restore/replay.
 progress=await a.evaluate(async({bookBytes,descriptor})=>{
  const c=(window as any).core,languageContext=(await c.languageRoutesSnapshot()).context,original=window.fetch;
  window.fetch=async input=>{const body=String(input)===descriptor.url?new Uint8Array(bookBytes):null;return body?new Response(body,{headers:{'content-length':String(body.byteLength)}}):new Response(null,{status:404});};
  try{
   const [pack]=await c.contentSupplySystem.execute({kind:'install_catalog_item',descriptor,signal:new AbortController().signal});
   await c.writeLibraryState((tx:any)=>tx.put('meta','package-catalog',{format:'sensa-local-registry-cache-v3',revision:'fixture',checkedAt:new Date().toISOString(),items:[descriptor]}));
   const ids=await c.enrollPackage(crypto.randomUUID(),pack.key,languageContext,descriptor.sha256);
   await c.confirmLearningQuantity(crypto.randomUUID(),languageContext,20);
   const at=new Date().toISOString();
   let run=await c.startLearning(crypto.randomUUID(),ids[0],languageContext,20,at);
   run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'reveal'},at);
   run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'rate',rating:'good'},at);
   if(!run.completedAt)throw Error('runtime incomplete');
   await c.finishLearning(crypto.randomUUID(),run.id);
   return JSON.stringify({...await c.readLearning(),packages:[]});
  }finally{window.fetch=original;}
 },{bookBytes,descriptor});
 await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
 assert.equal((await b.evaluate(()=>(window as any).core.installedPackages())).length,0,'published package bytes must not arrive in a Cloud Checkpoint');
 assert.equal((await b.evaluate(()=>(window as any).core.packageInstallations())).length,1,'the exact package installation fact must synchronize');
 await b.evaluate(async({bookBytes,descriptor})=>{const c=(window as any).core,original=window.fetch;window.fetch=async input=>{const url=String(input);const body=url===descriptor.url?new Uint8Array(bookBytes):null;return body?new Response(body,{headers:{'content-length':String(body.byteLength)}}):new Response(null,{status:404});};try{await c.writeLibraryState((tx:any)=>tx.put('meta','package-catalog',{format:'sensa-local-registry-cache-v3',revision:'fixture',checkedAt:new Date().toISOString(),items:[descriptor]}));const result=await c.contentSupplySystem.execute({kind:'rehydrate'});if(result.ready.length!==1)throw Error(JSON.stringify(result));}finally{window.fetch=original;}},{bookBytes,descriptor});
 assert.deepEqual(JSON.parse(await b.evaluate(async()=>{const learning=await (window as any).core.readLearning();return JSON.stringify({...learning,packages:[]});})),JSON.parse(progress));
 });
 let reconciledProgress='';
 await test.step('concurrent Reviews retain both Runs and converge on one projection',async()=>{
 // Both browsers now complete a due Review for the same synchronized Target
 // without seeing the other branch. The later branch owns the projection, while
 // both Runs and all Events remain durable history.
 const concurrentTargetId=(JSON.parse(progress) as any).targets.find((target:any)=>target.curriculumMemberships.some((membership:any)=>membership.sourceKind==='sense_learning_package')).id;
 const branchRuns=[] as string[];
 // Future fixture dates must advance the trusted browser clock, rather than
 // bypassing due eligibility through a future command timestamp.
 for(const page of [a,b])await page.clock.setFixedTime(new Date('2030-09-21T09:05:00.000Z'));
 for(const [page,at] of [[a,'2030-09-21T09:00:00.000Z'],[b,'2030-09-21T09:05:00.000Z']] as const)branchRuns.push(await page.evaluate(async({targetId,at})=>{const c=(window as any).core,languageContext=(await c.languageRoutesSnapshot()).context,pack=(await c.installedPackages())[0];let run=await c.startLearning(crypto.randomUUID(),targetId,languageContext,20,at),steps=0;while(!run.completedAt&&steps++<60){let action:any;if(run.protocolState.adapterId==='lightweight')action=run.protocolState.value.phase==='recall'?{kind:'reveal'}:{kind:'rate',rating:'good'};else{const session=c.fourStageQueue(run).getCurrentSession();let response:any;if(session.phase==='feedback')response={kind:'continue'};else if(session.mode==='review'||session.mode==='relearning')response={kind:'review',answer:'known'};else if(['meaning_choice','sound_choice'].includes(session.presentation)){const target=(await c.readLearning()).targets.find((candidate:any)=>candidate.id===session.targetId),executable=c.localExecutableTargetForParticipant(target,run.participants[target.id]),content=c.fourStageContent(executable,pack);response={kind:'choice',optionId:content.recognitionAssessment.options.find((option:any)=>option.isCorrect).id};}else response={kind:'self_report',known:true};action={kind:'protocol',response};}run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,action,at);}if(!run.completedAt)throw Error('concurrent runtime incomplete');await c.finishLearning(crypto.randomUUID(),run.id);return run.id;},{targetId:concurrentTargetId,at}));
 await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());await a.evaluate(()=>(window as any).sync());
 for(const page of [a,b]){const reconciled=await page.evaluate(async()=>{const c=(window as any).core;return {state:await c.readCloudSync(),learning:JSON.stringify(await c.readLearning()),decisions:await c.readLibrary((tx:any)=>tx.entries('learningReconciliations')),runs:await c.readLibrary((tx:any)=>tx.entries('learningRuns'))};});assert.equal(reconciled.state.status,'synced');assert(reconciled.decisions.length>0,'concurrent learning must persist a reconciliation decision');assert(branchRuns.every(runId=>reconciled.runs.some((row:any)=>row.key===runId)),'both concurrent Runs must remain in history');}
 reconciledProgress=await a.evaluate(async()=>JSON.stringify(await (window as any).core.readLearning()));
 assert.equal(reconciledProgress,await b.evaluate(async()=>JSON.stringify(await (window as any).core.readLearning())),'reconciled learning projections must converge');
 });
 await test.step('fresh restore, backup, private bytes and signout preserve their contracts',async()=>{
 // New context (fresh local DB) obtains a complete usable library and media.
 const fresh=await fixture.createClient(primary);
 // A new Web bundle may briefly meet the previous API during a rolling release.
 // That API accepts eight hashes and omits the deferred field.
 await fresh.evaluate(()=>{const w=window as any,original=w.request;w.request=async(path:string,body?:any)=>{if(path==='/blocks/fetch'){if(body.hashes.length>8)throw new Error('invalid_request');const value=await original(path,body);delete value.deferred;return value;}return original(path,body);};});
 await fresh.evaluate(()=>(window as any).sync());assert.deepEqual(JSON.parse(await fresh.evaluate(async()=>{const learning=await (window as any).core.readLearning();return JSON.stringify({...learning,packages:[]});})),{...JSON.parse(reconciledProgress),packages:[]});
 const restoredHistory=async(page:typeof fresh)=>page.evaluate(async()=>{
  const c=(window as any).core,languageContext=(await c.languageRoutesSnapshot()).context,filter={surface:'study',range:'all',start:'',end:'',kind:'all',languageChoice:null};
  const records:LearningHistoryProjection['records'][number][]=[];let cursor:LearningHistoryProjection['nextCursor']=null,total=0;
  do{const historyPage:LearningHistoryProjection=await c.learningSystem.read({kind:'history',languageContext,filter,cursor,limit:1});total=historyPage.total;records.push(...historyPage.records);cursor=historyPage.nextCursor;}while(cursor);
  return {records,total};
 });
 assert.deepEqual(await restoredHistory(fresh),await restoredHistory(a),'fresh Cloud restore must rebuild complete paged Study history despite Runs-before-Targets replica ordering');
 const history=await restoredHistory(fresh);assert(history.total>0,'a fresh restored learner must not see a false empty Study history');assert.equal(history.records.length,history.total,'all cursor pages must match the complete-range count');
 assert.deepEqual(await fresh.evaluate(()=>(window as any).core.listDrafts()),await a.evaluate(()=>(window as any).core.listDrafts()));
 assert.equal((await fresh.evaluate(()=>(window as any).core.installedPackages())).length,0,'a new device starts with an empty public artifact cache');
 await fresh.evaluate(async({bookBytes,descriptor})=>{const c=(window as any).core,original=window.fetch;window.fetch=async input=>{const url=String(input);const body=url===descriptor.url?new Uint8Array(bookBytes):null;return body?new Response(body,{headers:{'content-length':String(body.byteLength)}}):new Response(null,{status:404});};try{await c.writeLibraryState((tx:any)=>tx.put('meta','package-catalog',{format:'sensa-local-registry-cache-v3',revision:'fixture',checkedAt:new Date().toISOString(),items:[descriptor]}));const result=await c.contentSupplySystem.execute({kind:'rehydrate'});if(result.ready.length!==1)throw Error(JSON.stringify(result));}finally{window.fetch=original;}},{bookBytes,descriptor});
 assert.equal((await fresh.evaluate(()=>(window as any).core.installedPackages())).length,1,'the Content Supply resolver rehydrates exact package bytes after learner facts converge');
 const backup=await fresh.evaluate(async()=>{const c=(window as any).core;return (await c.exportLibraryBackup('sync-test-backup-password')).summary;});assert.equal(backup.targets,2);assert.equal(backup.packages,1);assert(backup.events>0);
 assert.equal(await fresh.evaluate(async()=>((await (window as any).core.worldReadRepository.page({query:'',filter:'all',offset:0,limit:40})).total)),1);assert.equal((await fresh.evaluate(()=>(window as any).core.personalLearningSnapshot()))[0].status,'ready');
 const checkpointBlocks=(await pool.query('SELECT data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[accountId])).rows;
 assert(!checkpointBlocks.some(r=>r.data.includes('fixture-device-secret')),'BYOK credentials stay device-local');
 assert(!checkpointBlocks.some(r=>r.data.includes(Buffer.from('synthetic-sync-audio:').toString('base64'))),'public package audio bytes stay outside learner Cloud Checkpoints');
 // Signout fences synchronization and cloud metadata never enters exported backups.
 await b.evaluate(async()=>{const c=(window as any).core;await c.command({id:crypto.randomUUID(),kind:'service.signout',input:{}},async(tx:any)=>tx.put('meta','signed-out',true));});await assert.rejects(b.evaluate(()=>(window as any).sync()),/authentication_required/);
 });
 // Optional formal UI integration, with real Supabase SDK and synthetic Auth HTTP only.
 const localWebOrigin=process.env.SENSA_LOCAL_WEB_URL;
 if(localWebOrigin){
  await test.step('formal account UI stays mounted across same-session auth events',async()=>{
  const webOrigin=localWebOrigin;if(new URL(webOrigin).hostname!=='127.0.0.1')throw Error('Use isolated loopback Web');
  const ctx=await browser.newContext({locale:'zh-CN'}),ui=await ctx.newPage();let accountInitializations=0;const errors:string[]=[];ui.on('pageerror',e=>errors.push(e.message));
  const token=[{}, {sub:primary.subject,exp:Math.floor(Date.now()/1000)+3600},'fixture'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  await ctx.route('**/*',async route=>{
   const req=route.request(),address=new URL(req.url());
   if(address.pathname.includes('/auth/v1/otp')){await route.fulfill({json:{}});return;}
   if(address.pathname.includes('/auth/v1/verify')){await route.fulfill({json:{access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user:{id:primary.subject,email:'sync@sensa.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}});return;}
   const at=address.pathname.indexOf('/sensa/');
   if(at>=0&&address.origin!==webOrigin){const path=address.pathname.slice(at);if(path.startsWith('/sensa/library-sync')||path==='/sensa/web/access/session'){
    if(path==='/sensa/web/access/session')accountInitializations++;
    const reply=await fetch(origin+path,{method:req.method(),headers:{authorization:'Bearer first','content-type':'application/json'},...(req.postData()?{body:req.postData()!}: {})});await route.fulfill({status:reply.status,contentType:'application/json',body:await reply.text()});return;
   }await route.fulfill({status:503,json:{code:'fixture_unavailable'}});return;}
   if(address.origin===webOrigin){await route.continue();return;}
   await route.abort();
  });
  // Guest settings remain usable without authentication. Login is an explicit
  // account intent, not an automatic email gate when visiting the profile.
  ui.setDefaultTimeout(15_000);
  await ui.goto(webOrigin+'/profile');
  await expect(ui.getByRole('heading',{name:'账号与设置',exact:true})).toBeVisible();
  await ui.getByRole('button',{name:/账号与安全/u}).click();
  await ui.getByRole('button',{name:'登录 Sensa',exact:true}).click();
  await ui.getByLabel('邮箱',{exact:true}).fill('sync@sensa.invalid');await ui.getByRole('button',{name:'发送登录邮件',exact:true}).click();await ui.getByRole('button',{name:'邮件中有验证码？',exact:true}).click();await ui.getByLabel('验证码',{exact:true}).fill('123456');await ui.getByRole('button',{name:'验证并继续',exact:true}).click();
  await expect(ui.getByRole('heading',{name:'账号与设置',exact:true})).toBeVisible({timeout:60000});
  await ui.getByRole('button',{name:/设备与数据/}).click();await expect(ui.getByRole('heading',{name:'账号云同步'})).toBeVisible();await expect(ui.getByText('已同步到账号',{exact:true})).toBeVisible();
  await expect(ui.getByRole('button',{name:'立即同步',exact:true})).toBeEnabled();await expect(ui.getByText('恢复码',{exact:true})).toHaveCount(0);
  const admittedInitializations=accountInitializations;
  await ui.evaluate(()=>{for(let i=0;i<3;i++)window.dispatchEvent(new Event('visibilitychange'));});
  await ui.waitForTimeout(1200);
  assert.equal(accountInitializations,admittedInitializations,'same-session tab focus must not initialize the account again');
  await expect(ui.getByRole('heading',{name:'账号云同步'})).toBeVisible();
  console.log('PASS: repeated Supabase same-session SIGNED_IN events preserve the mounted app and do not restart account initialization.');
  await ui.screenshot({path:'/tmp/sensa-account-cloud-sync.png',fullPage:true});await ui.locator('select:visible').first().selectOption('en');await expect(ui.getByRole('heading',{name:'Account sync',exact:true})).toBeVisible();await expect(ui.getByRole('button',{name:'Sync now',exact:true})).toBeEnabled();await ui.setViewportSize({width:390,height:844});assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await ui.screenshot({path:'/tmp/sensa-account-cloud-sync-en.png',fullPage:true});assert.deepEqual(errors,[]);
  console.log('PASS: formal AccountExperience login restores cloud library and original Profile shows sync status');await ctx.close();
  });
 }
 await test.step('block leases, immutable history and account deletion survive repacking',async()=>{
 // Repacking published history into different block sizes is a transport detail, not a rewrite.
 const stored=new Map<string,string>();
 const refresh=async()=>{const rows=(await pool.query('SELECT hash,data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[accountId])).rows;stored.clear();for(const row of rows)stored.set(row.hash,row.data);};
 await refresh();
 const post=async(path:string,body:unknown)=>fetch(origin+'/sensa/'+path,{method:'POST',headers:{authorization:'Bearer first','content-type':'application/json','x-sensa-sync-protocol':'sensa-checkpoint-pages-v1'},body:JSON.stringify(body)});
 const corruptPacked=JSON.parse(encodeLibrarySyncBlock('immutable content'.repeat(400)));corruptPacked[1]='0'.repeat(64);
 const corruptData=JSON.stringify(corruptPacked),corruptHash=createHash('sha256').update(corruptData).digest('hex');
 const corruptReply=await post('library-sync/blocks/store',{blocks:[{hash:corruptHash,data:corruptData}]});
 assert.equal(corruptReply.status,400);assert.equal((await corruptReply.json() as any).code,'library_sync_format');
 assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[accountId,corruptHash])).rows[0].n,0,'a correctly addressed but corrupt compressed block is not stored');
 const readHead=async()=>{const row=(await pool.query('SELECT revision,library_id,learner_id FROM sensa_consumer.library_cloud WHERE account_id=$1',[accountId])).rows[0];const rows=(await pool.query('SELECT table_name AS table,record_key AS key,refs AS blocks FROM sensa_consumer.library_cloud_rows WHERE account_id=$1 ORDER BY table_name,record_key',[accountId])).rows;return {revision:Number(row.revision),manifest:{version:8,libraryId:row.library_id,learnerId:row.learner_id,rows}};};
 const publish=async(manifest:any,baseRevision:number,chunk:number)=>{
  const rewritten=new Map<string,string>();
  for(const row of manifest.rows){const text=row.blocks.map((h:string)=>decodeLibrarySyncBlock(stored.get(h)!)).join(''),refs:string[]=[];
   for(let at=0;at<text.length;at+=chunk){const data=text.slice(at,at+chunk),hash=createHash('sha256').update(data).digest('hex');rewritten.set(hash,data);refs.push(hash);}
   if(!refs.length){const hash=createHash('sha256').update('').digest('hex');rewritten.set(hash,'');refs.push(hash);}row.blocks=refs;
  }
  const prior=(await readHead()).manifest.rows,byId=(row:any)=>JSON.stringify([row.table,row.key]),old=new Map(prior.map(row=>[byId(row),row])),next=new Map(manifest.rows.map((row:any)=>[byId(row),row]));
  const changes=[...manifest.rows.filter((row:any)=>JSON.stringify(old.get(byId(row))?.blocks)!==JSON.stringify(row.blocks)),...prior.filter(row=>!next.has(byId(row))).map(row=>({...row,blocks:null}))];
  const text=JSON.stringify({version:1,libraryId:manifest.libraryId,learnerId:manifest.learnerId,changes}),refs:string[]=[];
  for(let at=0;at<text.length;at+=chunk){const data=text.slice(at,at+chunk),hash=createHash('sha256').update(data).digest('hex');rewritten.set(hash,data);refs.push(hash);}
  const blocks=[...rewritten].map(([hash,data])=>({hash,data}));for(let at=0;at<blocks.length;at+=librarySyncBlockStoreBatch)assert.equal((await post('library-sync/blocks/store',{blocks:blocks.slice(at,at+librarySyncBlockStoreBatch)})).status,200);
  return post('library-sync/commit',{operationId:crypto.randomUUID(),baseRevision,patch:refs});
 };
 // A client that observes a missing old-head block rereads head and completes
 // from the advanced revision instead of persisting a terminal failure.
 let head=await readHead();
 const racedDraftId=crypto.randomUUID(),racedAt=new Date().toISOString(),racedRowText=JSON.stringify(encodeBackupValue({id:racedDraftId,revision:1,text:'Committed between head and block fetch',createdAt:racedAt,updatedAt:racedAt})),racedRowRefs:string[]=[],replacementBlocks:{hash:string;data:string}[]=[];
 for(let at=0;at<racedRowText.length;at+=librarySyncBlockChars){const data=racedRowText.slice(at,at+librarySyncBlockChars),hash=createHash('sha256').update(data).digest('hex');replacementBlocks.push({hash,data});racedRowRefs.push(hash);}
 const replacementManifest=JSON.parse(JSON.stringify(head.manifest));replacementManifest.rows.push({table:'drafts',key:racedDraftId,blocks:racedRowRefs});replacementManifest.rows.sort((a:any,b:any)=>JSON.stringify([a.table,a.key]).localeCompare(JSON.stringify([b.table,b.key])));
 const replacementText=JSON.stringify({version:1,libraryId:head.manifest.libraryId,learnerId:head.manifest.learnerId,changes:[{table:'drafts',key:racedDraftId,blocks:racedRowRefs}]}),replacementManifestRefs:string[]=[];
 for(let at=0;at<replacementText.length;at+=librarySyncBlockChars){const data=replacementText.slice(at,at+librarySyncBlockChars),hash=createHash('sha256').update(data).digest('hex');replacementBlocks.push({hash,data});replacementManifestRefs.push(hash);}
 for(let at=0;at<replacementBlocks.length;at+=librarySyncBlockStoreBatch)assert.equal((await post('library-sync/blocks/store',{blocks:replacementBlocks.slice(at,at+librarySyncBlockStoreBatch)})).status,200);
 const racing=await fixture.createClient(primary);await racing.evaluate(({baseRevision,manifest})=>{const w=window as any,original=w.request;w.headReads=0;let raced=false;w.request=async(path:string,body?:any)=>{if(path==='/head')w.headReads++;if(path==='/blocks/fetch'&&!raced){raced=true;await original('/commit',{operationId:crypto.randomUUID(),baseRevision,patch:manifest});return {blocks:[],missing:body.hashes,deferred:[]};}return original(path,body);};},{baseRevision:head.revision,manifest:replacementManifestRefs});
 await racing.evaluate(()=>(window as any).sync());assert.equal(await racing.evaluate(()=>(window as any).headReads),3,'missing binary data reacquires the advanced head and verifies it again before refs activation');const racingState=await racing.evaluate(()=>(window as any).core.readCloudSync());assert.equal(racingState.status,'synced');assert.equal(racingState.storage.capacityBytes,1024*1024*1024);assert(racingState.storage.usedBytes>0,'the account UI receives byte-based cloud capacity usage');await racing.context().close();
 const leaseId=crypto.randomUUID(),leaseAt=new Date().toISOString();
 const leaseRow=(text:string)=>JSON.stringify(encodeBackupValue({id:leaseId,revision:1,text,createdAt:leaseAt,updatedAt:leaseAt}));
 const upload=(text:string)=>{const data=encodeLibrarySyncBlock(text),hash=createHash('sha256').update(data).digest('hex');return {data,hash};};
 const oldLeaseBlock=upload(leaseRow('Old leased exact body')),newLeaseBlock=upload(leaseRow('Current exact body'));
 for(const block of [oldLeaseBlock,newLeaseBlock])assert.equal((await post('library-sync/blocks/store',{blocks:[block]})).status,200);
 const publishLease=async(block:any)=>{const current=await readHead(),patch=upload(JSON.stringify({version:1,libraryId:current.manifest.libraryId,learnerId:current.manifest.learnerId,changes:[{table:'drafts',key:leaseId,blocks:[block.hash]}]}));assert.equal((await post('library-sync/blocks/store',{blocks:[patch]})).status,200);assert.equal((await post('library-sync/commit',{operationId:crypto.randomUUID(),baseRevision:current.revision,patch:[patch.hash]})).status,200);};
 await publishLease(oldLeaseBlock);
 await fetch(origin+'/sensa/library-sync/head',{headers:{authorization:'Bearer first'}});
 const compact=async(baseRevision:number)=>{let r=await post('library-sync/compact',{baseRevision});assert.equal(r.status,200);let value=await r.json();while(value.preparation){const p=value.preparation;r=await post('library-sync/compact',{baseRevision:p.revision,operationId:p.operationId,page:p.page});assert.equal(r.status,200);value=await r.json();}return value;};
 await publishLease(newLeaseBlock);head=await readHead();await compact(head.revision);
 await pool.query("UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=now()-interval '1 minute' WHERE account_id=$1 AND hash=$2",[accountId,oldLeaseBlock.hash]);
 assert.equal(await pruneLibraryCloudHistory(pool,accountId,new Date()),false);await purgeExpiredLibraryCloudBlocks(pool,new Date(),100,accountId);
 assert.equal((await pool.query('SELECT 1 FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[accountId,oldLeaseBlock.hash])).rowCount,1,'a valid fixed-head reader protects old tail bytes');
 await pool.query("UPDATE sensa_consumer.library_cloud_reads SET expires_at=now()-interval '1 minute' WHERE account_id=$1",[accountId]);
 assert.equal(await pruneLibraryCloudHistory(pool,accountId,new Date()),true);await purgeExpiredLibraryCloudBlocks(pool,new Date(),10000,accountId);
 assert.equal((await pool.query('SELECT 1 FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[accountId,oldLeaseBlock.hash])).rowCount,1,'the selected checkpoint conservatively retains intermediate tail refs in its union root');
 await publishLease(newLeaseBlock);head=await readHead();await compact(head.revision);
 await pool.query("UPDATE sensa_consumer.library_cloud_reads SET expires_at=now()-interval '1 minute' WHERE account_id=$1",[accountId]);
 const roots=(await pool.query('SELECT (SELECT count(*) FROM sensa_consumer.library_cloud_snapshots WHERE account_id=$1)::int snapshots,(SELECT count(*) FROM sensa_consumer.library_cloud_membership WHERE account_id=$1)::int pins',[accountId])).rows[0];
 for(let i=0;i<Math.ceil(roots.snapshots/128)+Math.ceil(roots.pins/512)+4;i++)await compact(head.revision);
 await purgeExpiredLibraryCloudBlocks(pool,new Date(),10000,accountId);
 assert.equal((await pool.query('SELECT 1 FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[accountId,oldLeaseBlock.hash])).rowCount,0,'retired intermediate bytes are reclaimed after the next root and old readers retire');
 const currentManifestRefs=[newLeaseBlock.hash];
 const orphanData='interrupted upload '+crypto.randomUUID(),orphanHash=createHash('sha256').update(orphanData).digest('hex');assert.equal((await post('library-sync/blocks/store',{blocks:[{hash:orphanHash,data:orphanData}]})).status,200);
 await pool.query("UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=now()-interval '1 minute' WHERE account_id=$1 AND hash=$2",[accountId,orphanHash]);await purgeExpiredLibraryCloudBlocks(pool,new Date(),100,accountId);assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[accountId,orphanHash])).rows[0].n,0,'an expired interrupted upload is reclaimed');
 await pool.query("UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=now()-interval '1 minute' WHERE account_id=$1 AND hash=ANY($2::text[])",[accountId,currentManifestRefs]);await purgeExpiredLibraryCloudBlocks(pool,new Date(),100,accountId);assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[accountId,currentManifestRefs])).rows[0].n,currentManifestRefs.length,'current head blocks remain protected after their upload lease expires');
 head=await readHead();await refresh();
 const priorRevision=head.revision;
 const repacked=await publish(JSON.parse(JSON.stringify(head.manifest)),priorRevision,8192);assert.equal(repacked.status,200,'repacking published history must be accepted');
 head=await readHead();assert.equal(head.revision,priorRevision+1);await refresh();
 const repackedReceiver=await fixture.createClient(primary);fixture.clearRequests();
 await repackedReceiver.evaluate(()=>(window as any).sync());
 assert.equal((await readHead()).revision,head.revision,'restoring identical facts with a different block layout must not republish');
 assert.equal(fixture.requests().filter(call=>call.path.endsWith('/commit')).length,0);
 assert.equal((await repackedReceiver.evaluate(()=>(window as any).core.readCloudSync())).checkpointVersion,7);
 await repackedReceiver.context().close();
 assert.equal(head.manifest.version,8);assert.equal(head.manifest.rows.some((row:any)=>row.table==='operations'),false,'new Checkpoints must not contain the device ledger');
 assert.equal(head.manifest.rows.some((row:any)=>row.table==='packageCache'),false,'new Checkpoints must not contain public artifact cache bytes');
 assert.equal(head.manifest.rows.some((row:any)=>row.table==='packageInstallations'),true,'new Checkpoints must contain exact package installation facts');
 assert.equal(head.manifest.rows.some((row:any)=>row.table==='meta'&&row.key==='package-catalog'),false,'package catalog cache must not enter account checkpoints');
 assert(head.manifest.rows.some((row:any)=>row.table==='semanticState'),'normalized semantic state was not synchronized');
 // Server rejects a new snapshot that rewrites an already published learning fact.
 const manifest=JSON.parse(JSON.stringify(head.manifest));
 const event=manifest.rows.find((r:any)=>r.table==='learningEvents');event.blocks=manifest.rows.find((r:any)=>r.table==='drafts').blocks;
 const rejected=await publish(manifest,head.revision,librarySyncBlockChars);assert.equal(rejected.status,409);assert.equal((await rejected.json() as any).code,'library_sync_history');
 const decisionManifest=JSON.parse(JSON.stringify(head.manifest)),decision=decisionManifest.rows.find((r:any)=>r.table==='learningReconciliations');assert(decision,'concurrent learning did not publish its reconciliation decision');decision.blocks=decisionManifest.rows.find((r:any)=>r.table==='drafts').blocks;
 const rejectedDecision=await publish(decisionManifest,head.revision,librarySyncBlockChars);assert.equal(rejectedDecision.status,409);assert.equal((await rejectedDecision.json() as any).code,'library_sync_history');
 for(const table of ['studyScopes','learningSessions','learningRuns']){
  assert(head.manifest.rows.some((row:any)=>row.table===table),'actual learning must publish '+table);
  const omitted=JSON.parse(JSON.stringify(head.manifest));omitted.rows=omitted.rows.filter((row:any)=>row.table!==table);
  const denied=await publish(omitted,head.revision,librarySyncBlockChars);assert.equal(denied.status,409);assert.equal((await denied.json() as any).code,'library_sync_history');
 }
 assert.equal((await pool.query('SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[accountId])).rows[0].revision,head.revision);
 const deletion=await post('account/deletion',{operationId:crypto.randomUUID(),confirmation:'delete-account'});assert.equal(deletion.status,200);
 for(const table of ['library_cloud','library_cloud_blocks','library_cloud_commits','library_cloud_snapshot_leases','library_cloud_block_refs','library_cloud_rows','library_cloud_log','library_cloud_snapshots','library_cloud_membership','library_cloud_reads'])assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.'+table+' WHERE account_id=$1',[accountId])).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud WHERE account_id=$1',[otherId])).rows[0].n,1);
 });
 }finally{await fixture.close();}
});
