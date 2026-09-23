/** Real Chromium local library + Hono + disposable Postgres. No model calls or real accounts. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {libraryCloudPackageFixture} from '../../../scripts/support/libraryCloudPackageFixture.mts';
import {expect} from '@playwright/test';
import {purgeExpiredLibraryCloudBlocks} from '../../../apps/api/src/sensa/library/retention.ts';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec.ts';
import {librarySyncBlockChars,librarySyncBlockStoreBatch} from '../../../packages/contracts/src/sensa/librarySync.ts';
import {createLibraryCloudBrowserFixture} from '../../../tests/web/support/libraryCloudBrowserFixture.mts';
test('Cloud Checkpoint preserves learner facts across real Chromium and Postgres', async(t)=>{
 const fixture=await createLibraryCloudBrowserFixture();
 const {browser,origin,pool}=fixture;
 try{
 const primary=await fixture.createAccount('first'),secondary=await fixture.createAccount('second');
 const accountId=primary.accountId,otherId=secondary.accountId;
 const a=await fixture.createClient(primary);const b=await fixture.createClient(primary);const other=await fixture.createClient(secondary);
 await t.test('account isolation, local caches, legacy heads and mid-sync writes',async()=>{
 const draft=await a.evaluate(async()=>{const c=(window as any).core;return c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'My raincoat',images:[{id:crypto.randomUUID(),name:'raincoat.jpg',dataUrl:document.createElement('canvas').toDataURL('image/jpeg')}]});});
 await a.evaluate(()=>(window as any).sync());
 await b.evaluate(()=>(window as any).sync());assert.deepEqual(await b.evaluate(()=>(window as any).core.listDrafts()),[draft]);
 // Service package descriptors are device-local caches and must never replace
 // one browser's fresh catalog with another browser's stale copy.
 await a.evaluate(async()=>{const c=(window as any).core;await c.writeLibraryState((tx:any)=>tx.put('meta','package-catalog',{format:'sensa-local-registry-cache-v1',revision:'catalog-a',checkedAt:'2026-09-20T00:00:00.000Z',items:[]}));});
 await b.evaluate(async()=>{const c=(window as any).core;await c.writeLibraryState((tx:any)=>tx.put('meta','package-catalog',{format:'sensa-local-registry-cache-v1',revision:'catalog-b',checkedAt:'2026-09-20T00:00:01.000Z',items:[]}));});
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
 // A legacy Checkpoint is terminal: fetch only its small manifest, preserve the
 // local library, and leave retry scheduling to explicit recovery.
 const legacyRow=JSON.stringify({kind:'legacy-operation',payload:'x'.repeat(32_768)}),legacyRowHash=createHash('sha256').update(legacyRow).digest('hex');
 const legacyManifest=JSON.stringify({version:1,libraryId:crypto.randomUUID(),learnerId:crypto.randomUUID(),rows:[{table:'operations',key:crypto.randomUUID(),blocks:[legacyRowHash]}]}),legacyManifestHash=createHash('sha256').update(legacyManifest).digest('hex');
 await pool.query('INSERT INTO sensa_consumer.library_cloud_blocks(account_id,hash,data) VALUES($1,$2,$3),($1,$4,$5) ON CONFLICT(account_id,hash) DO UPDATE SET data=EXCLUDED.data',[otherId,legacyRowHash,legacyRow,legacyManifestHash,legacyManifest]);
 await pool.query('UPDATE sensa_consumer.library_cloud SET revision=revision+1,manifest=$2::jsonb,updated_at=now() WHERE account_id=$1',[otherId,JSON.stringify([legacyManifestHash])]);
 const legacy=await fixture.createClient(secondary),localIdentity=await legacy.evaluate(()=>(window as any).core.openLibrary());fixture.clearRequests();
 await assert.rejects(legacy.evaluate(()=>(window as any).sync()),/library_sync_incompatible_checkpoint/);
 const legacyState=await legacy.evaluate(()=>(window as any).core.readCloudSync());
 assert.equal(legacyState.status,'failed');assert.equal(legacyState.error,'library_sync_incompatible_checkpoint');assert.equal(legacyState.failureKind,'terminal');assert.equal(legacyState.retryAt,undefined);
 assert.equal(fixture.requests().filter(c=>c.path.endsWith('/blocks/fetch')).length,1,'legacy row blocks must not be downloaded');
 assert.deepEqual(await legacy.evaluate(()=>(window as any).core.openLibrary()),localIdentity,'legacy cloud data must not modify the local library');
 await legacy.context().close();
 // A local write arriving after the sync snapshot is captured is fenced, then retried safely.
 await a.evaluate(()=>{const w=window as any,original=w.request;let once=true;w.request=async(path:string,body?:unknown)=>{const result=await original(path,body);if(path==='/head'&&once){once=false;await w.core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Written during sync'});}return result;};});
 await assert.rejects(a.evaluate(()=>(window as any).sync()),/library_sync_local_changed/);await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());assert((await b.evaluate(()=>(window as any).core.listDrafts())).some((d:any)=>d.text==='Written during sync'));
 });
 const {bytes,descriptor}=await libraryCloudPackageFixture();
 let progress='';
 await t.test('canonical Intake and exact package installation facts restore without artifact bytes',async()=>{
 // Canonical v3 Intake -> Personal Semantic World -> generated resources.
 await a.evaluate(async()=>{
  const c=(window as any).core,id=()=>crypto.randomUUID(),library=await c.openLibrary();
  const operationId=id(),modules=c.createJourneyModules(),gateway=modules.personalMeaningJourney,intake=modules.semanticIntake;
  const text='I wore my raincoat in the rain.';
  const accepted=await intake.submit({contractVersion:'sensa-intake-v3',operationId,capturedAt:new Date().toISOString(),context:{modality:'text',textSegment:text,mediaReferenceIds:[],languageTag:'en',source:{client:'sensa-web',url:'https://example.org',title:'A rainy day',sourceReferenceId:null,domSelector:null,paragraphContext:null}},expression:{surfaceForm:'raincoat',languageTag:'en',occurrence:{surfaceForm:'raincoat',locator:{kind:'text_span',start:10,end:18}},expressionTypeHint:'word'},sense:{senseKey:null,semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'防雨时穿在身上的衣服',prototypeScenes:[{summary:'一个人在雨中穿着防水的外衣。',participantRoles:['穿衣者'],states:['下雨'],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]},wordingSource:'llm_suggested',resolutionProvenance:{resolverKind:'language_model',provider:'fixture',model:'fixture',policyVersion:'fixture-v1',sourceReferenceIds:['cloud-smoke']}},acceptance:{mode:'learner_direct'}});
  if(accepted.route!=='fast_track'||!accepted.personalMeaningId)throw Error('canonical intake not accepted');
  const source=gateway.getLearningSources(accepted.personalMeaningId)[0];if(!source)throw Error('canonical learning source missing');
  const provider=await c.saveProvider(id(),{id:id(),expectedRevision:0,name:'Test model',kind:'compatible',endpoint:'https://sync-model.invalid/v1',model:'synthetic'},'fixture-device-secret');
  const settings=(await c.providerSnapshot()).settings;await c.assignProvider(id(),'content',provider.id,settings.revision);
  const restoreSpeech=c.replaceClientSpeechProvider({id:'fixture',revision:1,displayName:'Fixture',synthesize:async(input:any)=>({...input,audioUrl:'data:audio/mpeg;base64,UklGRg==',phoneticNotation:null,accentLabel:'en-US',source:'synthetic test fixture',method:'tts'})});
  const original=window.fetch;window.fetch=async(url:any,init:any)=>{const address=String(url);if(address.endsWith('/sensa/resource-facts'))return new Response(JSON.stringify({input:JSON.parse(String(init?.body)),references:[]}),{headers:{'content-type':'application/json'}});if(address.startsWith(provider.endpoint))return new Response(JSON.stringify({model:'synthetic',choices:[{finish_reason:'stop',message:{content:JSON.stringify({resources:[{role:'experience_recall_cue',payload:{scene:'下雨时一个人穿了自己的防水外衣，挡住雨水。',senseFocus:'防雨时穿在身上的衣服'}},{role:'scene_bridge',payload:{text:'回想雨中穿着防水外衣的体验。'}},{role:'scene_realization',payload:{example:'I wore my raincoat in the rain.',targetStart:10,targetEnd:18,experienceResourceKey:'experience_recall_cue:0'}}]})}}]}),{headers:{'content-type':'application/json'}});return original(url,init);};
  try{const languageContext=(await c.languageRoutesSnapshot()).context,task=await c.enrollPersonal(id(),source,languageContext,true);await c.preparePersonal(task.id,source,provider,null,new AbortController().signal,()=>{});}finally{restoreSpeech();window.fetch=original;}
  if((await c.personalLearningSnapshot())[0].status!=='ready')throw Error('personal resources not ready');
 });
 // Actual learning resources (including audio), runtime records and schedule restore/replay.
 progress=await a.evaluate(async({bytes,descriptor})=>{const c=(window as any).core,languageContext=(await c.languageRoutesSnapshot()).context;const pack=await c.installPackage(new Uint8Array(bytes),descriptor),ids=await c.enrollPackage(crypto.randomUUID(),pack.key,languageContext);for(const id of ids)await c.selectLocalLearningPolicy(crypto.randomUUID(),id,languageContext,'interleaved_four_stage');await c.confirmLearningQuantity(crypto.randomUUID(),languageContext,20);let run=await c.startLearning(crypto.randomUUID(),ids[0],languageContext,20,'2026-09-11T04:00:00.000Z');let steps=0;while(!run.completedAt&&steps++<60){const session=c.fourStageQueue(run).getCurrentSession();let response:any;if(session.phase==='feedback')response={kind:'continue'};else if(['meaning_choice','sound_choice'].includes(session.presentation)){const target=(await c.readLearning()).targets.find((t:any)=>t.id===session.targetId),executable=c.localExecutableTargetForParticipant(target,run.participants[target.id]);const content=c.fourStageContent(executable,pack);response={kind:'choice',optionId:content.recognitionAssessment.options.find((o:any)=>o.isCorrect).id};}else response={kind:'self_report',known:true};run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'protocol',response},'2026-09-11T04:00:00.000Z');}if(!run.completedAt)throw Error('runtime incomplete');await c.finishLearning(crypto.randomUUID(),run.id);const learning=await c.readLearning();return JSON.stringify({...learning,packages:[]});},{bytes,descriptor});
 await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());
 assert.equal((await b.evaluate(()=>(window as any).core.installedPackages())).length,0,'published package bytes must not arrive in a Cloud Checkpoint');
 assert.equal((await b.evaluate(()=>(window as any).core.packageInstallations())).length,1,'the exact package installation fact must synchronize');
 await b.evaluate(async({bytes,descriptor})=>{const c=(window as any).core,original=window.fetch;window.fetch=async()=>new Response(new Uint8Array(bytes));try{const result=await c.rehydratePackageInstallations([descriptor]);if(result.ready.length!==1)throw Error(JSON.stringify(result));}finally{window.fetch=original;}},{bytes,descriptor});
 assert.deepEqual(JSON.parse(await b.evaluate(async()=>{const learning=await (window as any).core.readLearning();return JSON.stringify({...learning,packages:[]});})),JSON.parse(progress));
 });
 let reconciledProgress='';
 await t.test('concurrent Reviews retain both Runs and converge on one projection',async()=>{
 // Both browsers now complete a due Review for the same synchronized Target
 // without seeing the other branch. The later branch owns the projection, while
 // both Runs and all Events remain durable history.
 const concurrentTargetId=(JSON.parse(progress) as any).targets.find((target:any)=>target.curriculumMemberships.some((membership:any)=>membership.sourceKind==='sense_learning_package')).id;
 const branchRuns=[] as string[];
 for(const [page,at] of [[a,'2030-09-21T09:00:00.000Z'],[b,'2030-09-21T09:05:00.000Z']] as const)branchRuns.push(await page.evaluate(async({targetId,at})=>{const c=(window as any).core,languageContext=(await c.languageRoutesSnapshot()).context,pack=(await c.installedPackages())[0];let run=await c.startLearning(crypto.randomUUID(),targetId,languageContext,20,at),steps=0;while(!run.completedAt&&steps++<60){const session=c.fourStageQueue(run).getCurrentSession();let response:any;if(session.phase==='feedback')response={kind:'continue'};else if(session.mode==='review'||session.mode==='relearning')response={kind:'review',answer:'known'};else if(['meaning_choice','sound_choice'].includes(session.presentation)){const target=(await c.readLearning()).targets.find((candidate:any)=>candidate.id===session.targetId),executable=c.localExecutableTargetForParticipant(target,run.participants[target.id]),content=c.fourStageContent(executable,pack);response={kind:'choice',optionId:content.recognitionAssessment.options.find((option:any)=>option.isCorrect).id};}else response={kind:'self_report',known:true};run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'protocol',response},at);}if(!run.completedAt)throw Error('concurrent runtime incomplete');await c.finishLearning(crypto.randomUUID(),run.id);return run.id;},{targetId:concurrentTargetId,at}));
 await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());await a.evaluate(()=>(window as any).sync());
 for(const page of [a,b]){const reconciled=await page.evaluate(async()=>{const c=(window as any).core;return {state:await c.readCloudSync(),learning:JSON.stringify(await c.readLearning()),decisions:await c.readLibrary((tx:any)=>tx.entries('learningReconciliations')),runs:await c.readLibrary((tx:any)=>tx.entries('learningRuns'))};});assert.equal(reconciled.state.status,'synced');assert(reconciled.decisions.length>0,'concurrent learning must persist a reconciliation decision');assert(branchRuns.every(runId=>reconciled.runs.some((row:any)=>row.key===runId)),'both concurrent Runs must remain in history');}
 reconciledProgress=await a.evaluate(async()=>JSON.stringify(await (window as any).core.readLearning()));
 assert.equal(reconciledProgress,await b.evaluate(async()=>JSON.stringify(await (window as any).core.readLearning())),'reconciled learning projections must converge');
 });
 await t.test('fresh restore, backup, private bytes and signout preserve their contracts',async()=>{
 // New context (fresh local DB) obtains a complete usable library and media.
 const fresh=await fixture.createClient(primary);
 // A new Web bundle may briefly meet the previous API during a rolling release.
 // That API accepts eight hashes and omits the deferred field.
 await fresh.evaluate(()=>{const w=window as any,original=w.request;w.request=async(path:string,body?:any)=>{if(path==='/blocks/fetch'){if(body.hashes.length>8)throw new Error('invalid_request');const value=await original(path,body);delete value.deferred;return value;}return original(path,body);};});
 await fresh.evaluate(()=>(window as any).sync());assert.deepEqual(JSON.parse(await fresh.evaluate(async()=>{const learning=await (window as any).core.readLearning();return JSON.stringify({...learning,packages:[]});})),{...JSON.parse(reconciledProgress),packages:[]});
 assert.deepEqual(await fresh.evaluate(()=>(window as any).core.listDrafts()),await a.evaluate(()=>(window as any).core.listDrafts()));
 assert.equal((await fresh.evaluate(()=>(window as any).core.installedPackages())).length,0,'a new device starts with an empty public artifact cache');
 await fresh.evaluate(async({bytes,descriptor})=>{const c=(window as any).core,original=window.fetch;window.fetch=async()=>new Response(new Uint8Array(bytes));try{const result=await c.rehydratePackageInstallations([descriptor]);if(result.ready.length!==1)throw Error(JSON.stringify(result));}finally{window.fetch=original;}},{bytes,descriptor});
 assert.equal((await fresh.evaluate(()=>(window as any).core.installedPackages())).length,1,'the Content Supply resolver rehydrates exact package bytes after learner facts converge');
 const backup=await fresh.evaluate(async()=>{const c=(window as any).core;return (await c.exportLibraryBackup('sync-test-backup-password')).summary;});assert.equal(backup.targets,3);assert.equal(backup.packages,1);assert(backup.events>0);
 assert.equal(await fresh.evaluate(async()=>{const gateway=(window as any).core.createJourneyGateway();for(let attempt=0;attempt<50;attempt++){const count=gateway.getWorldItems().length;if(count)return count;await new Promise(resolve=>setTimeout(resolve,10));}return 0;}),1);assert.equal((await fresh.evaluate(()=>(window as any).core.personalLearningSnapshot()))[0].status,'ready');
 const checkpointBlocks=(await pool.query('SELECT data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[accountId])).rows;
 assert(!checkpointBlocks.some(r=>r.data.includes('fixture-device-secret')),'BYOK credentials stay device-local');
 assert(!checkpointBlocks.some(r=>r.data.includes(Buffer.from('synthetic-sync-audio:').toString('base64'))),'public package audio bytes stay outside learner Cloud Checkpoints');
 // Signout fences synchronization and cloud metadata never enters exported backups.
 await b.evaluate(async()=>{const c=(window as any).core;await c.command({id:crypto.randomUUID(),kind:'service.signout',input:{}},async(tx:any)=>tx.put('meta','signed-out',true));});await assert.rejects(b.evaluate(()=>(window as any).sync()),/authentication_required/);
 });
 // Optional formal UI integration, with real Supabase SDK and synthetic Auth HTTP only.
 const localWebOrigin=process.env.SENSA_LOCAL_WEB_URL;
 if(localWebOrigin){
  await t.test('formal account UI stays mounted across same-session auth events',async()=>{
  const webOrigin=localWebOrigin;if(new URL(webOrigin).hostname!=='127.0.0.1')throw Error('Use isolated loopback Web');
  const ctx=await browser.newContext(),ui=await ctx.newPage();let accountInitializations=0;const errors:string[]=[];ui.on('pageerror',e=>errors.push(e.message));
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
  await ui.goto(webOrigin+'/profile');await ui.getByLabel('邮箱',{exact:true}).fill('sync@sensa.invalid');await ui.getByRole('button',{name:'发送登录邮件',exact:true}).click();await ui.getByRole('button',{name:'邮件中有验证码？',exact:true}).click();await ui.getByLabel('验证码',{exact:true}).fill('123456');await ui.getByRole('button',{name:'验证并继续',exact:true}).click();
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
 await t.test('block leases, immutable history and account deletion survive repacking',async()=>{
 // Repacking published history into different block sizes is a transport detail, not a rewrite.
 const stored=new Map<string,string>();
 const refresh=async()=>{const rows=(await pool.query('SELECT hash,data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[accountId])).rows;stored.clear();for(const row of rows)stored.set(row.hash,row.data);};
 await refresh();
 const post=async(path:string,body:unknown)=>fetch(origin+'/sensa/'+path,{method:'POST',headers:{authorization:'Bearer first','content-type':'application/json'},body:JSON.stringify(body)});
 const readHead=async()=>{const row=(await pool.query('SELECT revision,manifest FROM sensa_consumer.library_cloud WHERE account_id=$1',[accountId])).rows[0];const refs=row.manifest as string[];const blocks=new Map((await pool.query('SELECT hash,data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[accountId,refs])).rows.map(r=>[r.hash,r.data]));if(refs.some(h=>!blocks.has(h)))throw Error('head manifest references a missing block');return {revision:Number(row.revision),manifest:JSON.parse(refs.map(h=>blocks.get(h)).join(''))};};
 const publish=async(manifest:any,baseRevision:number,chunk:number)=>{
  const rewritten=new Map<string,string>();
  for(const row of manifest.rows){const text=row.blocks.map((h:string)=>stored.get(h)).join(''),refs:string[]=[];
   for(let at=0;at<text.length;at+=chunk){const data=text.slice(at,at+chunk),hash=createHash('sha256').update(data).digest('hex');rewritten.set(hash,data);refs.push(hash);}
   if(!refs.length){const hash=createHash('sha256').update('').digest('hex');rewritten.set(hash,'');refs.push(hash);}
   row.blocks=refs;}
  const text=JSON.stringify(manifest),refs:string[]=[];
  for(let at=0;at<text.length;at+=chunk){const data=text.slice(at,at+chunk),hash=createHash('sha256').update(data).digest('hex');rewritten.set(hash,data);refs.push(hash);}
  const blocks=[...rewritten].map(([hash,data])=>({hash,data}));
  for(let at=0;at<blocks.length;at+=librarySyncBlockStoreBatch)assert.equal((await post('library-sync/blocks/store',{blocks:blocks.slice(at,at+librarySyncBlockStoreBatch)})).status,200);
  return post('library-sync/commit',{operationId:crypto.randomUUID(),baseRevision,manifest:refs});};
 // A client that observes a missing old-head block rereads head and completes
 // from the advanced revision instead of persisting a terminal failure.
 let head=await readHead();
 const oldHeadRow=(await pool.query('SELECT manifest FROM sensa_consumer.library_cloud WHERE account_id=$1',[accountId])).rows[0],oldManifestRefs=oldHeadRow.manifest as string[];
 const racedDraftId=crypto.randomUUID(),racedAt=new Date().toISOString(),racedRowText=JSON.stringify(encodeBackupValue({id:racedDraftId,revision:1,text:'Committed between head and block fetch',createdAt:racedAt,updatedAt:racedAt})),racedRowRefs:string[]=[],replacementBlocks:{hash:string;data:string}[]=[];
 for(let at=0;at<racedRowText.length;at+=librarySyncBlockChars){const data=racedRowText.slice(at,at+librarySyncBlockChars),hash=createHash('sha256').update(data).digest('hex');replacementBlocks.push({hash,data});racedRowRefs.push(hash);}
 const replacementManifest=JSON.parse(JSON.stringify(head.manifest));replacementManifest.rows.push({table:'drafts',key:racedDraftId,blocks:racedRowRefs});replacementManifest.rows.sort((a:any,b:any)=>JSON.stringify([a.table,a.key]).localeCompare(JSON.stringify([b.table,b.key])));
 const replacementText=JSON.stringify(replacementManifest),replacementManifestRefs:string[]=[];
 for(let at=0;at<replacementText.length;at+=librarySyncBlockChars){const data=replacementText.slice(at,at+librarySyncBlockChars),hash=createHash('sha256').update(data).digest('hex');replacementBlocks.push({hash,data});replacementManifestRefs.push(hash);}
 for(let at=0;at<replacementBlocks.length;at+=librarySyncBlockStoreBatch)assert.equal((await post('library-sync/blocks/store',{blocks:replacementBlocks.slice(at,at+librarySyncBlockStoreBatch)})).status,200);
 const racing=await fixture.createClient(primary);await racing.evaluate(({baseRevision,manifest})=>{const w=window as any,original=w.request;w.headReads=0;let raced=false;w.request=async(path:string,body?:any)=>{if(path==='/head')w.headReads++;if(path==='/blocks/fetch'&&!raced){raced=true;await original('/commit',{operationId:crypto.randomUUID(),baseRevision,manifest});return {blocks:[],missing:body.hashes,deferred:[]};}return original(path,body);};},{baseRevision:head.revision,manifest:replacementManifestRefs});
 await racing.evaluate(()=>(window as any).sync());assert.equal(await racing.evaluate(()=>(window as any).headReads),2,'a changed head is reread once after the old block disappears');const racingState=await racing.evaluate(()=>(window as any).core.readCloudSync());assert.equal(racingState.status,'synced');assert.equal(racingState.storage.capacityBytes,256*1024*1024);assert(racingState.storage.usedBytes>0,'the account UI receives byte-based cloud capacity usage');await racing.context().close();
 const racedHeadRow=(await pool.query('SELECT revision,manifest FROM sensa_consumer.library_cloud WHERE account_id=$1',[accountId])).rows[0],currentManifestRefs=racedHeadRow.manifest as string[];
 await pool.query("UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=now()-interval '1 minute' WHERE account_id=$1 AND hash=ANY($2::text[])",[accountId,oldManifestRefs]);
 await purgeExpiredLibraryCloudBlocks(pool,new Date(),100,accountId);
 assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[accountId,oldManifestRefs])).rows[0].n,oldManifestRefs.length,'a valid old-head read lease protects retired blocks');
 await pool.query("UPDATE sensa_consumer.library_cloud_block_refs SET expires_at=now()-interval '1 minute' WHERE account_id=$1 AND reference_kind='retired'",[accountId]);
 await pool.query("UPDATE sensa_consumer.library_cloud_snapshot_leases SET expires_at=now()-interval '1 minute' WHERE account_id=$1",[accountId]);
 await purgeExpiredLibraryCloudBlocks(pool,new Date(),100,accountId);
 assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[accountId,oldManifestRefs])).rows[0].n,0,'expired retired snapshot blocks are reclaimed');
 const orphanData='interrupted upload '+crypto.randomUUID(),orphanHash=createHash('sha256').update(orphanData).digest('hex');assert.equal((await post('library-sync/blocks/store',{blocks:[{hash:orphanHash,data:orphanData}]})).status,200);
 await pool.query("UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=now()-interval '1 minute' WHERE account_id=$1 AND hash=$2",[accountId,orphanHash]);await purgeExpiredLibraryCloudBlocks(pool,new Date(),100,accountId);assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[accountId,orphanHash])).rows[0].n,0,'an expired interrupted upload is reclaimed');
 await pool.query("UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at=now()-interval '1 minute' WHERE account_id=$1 AND hash=ANY($2::text[])",[accountId,currentManifestRefs]);await purgeExpiredLibraryCloudBlocks(pool,new Date(),100,accountId);assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[accountId,currentManifestRefs])).rows[0].n,currentManifestRefs.length,'current head blocks remain protected after their upload lease expires');
 head=await readHead();await refresh();
 const priorRevision=head.revision;
 const repacked=await publish(JSON.parse(JSON.stringify(head.manifest)),priorRevision,8192);assert.equal(repacked.status,200,'repacking published history must be accepted');
 head=await readHead();assert.equal(head.revision,priorRevision+1);await refresh();
 assert.equal(head.manifest.version,5);assert.equal(head.manifest.rows.some((row:any)=>row.table==='operations'),false,'new Checkpoints must not contain the device ledger');
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
 assert.equal((await pool.query('SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[accountId])).rows[0].revision,head.revision);
 const deletion=await post('account/deletion',{operationId:crypto.randomUUID(),confirmation:'delete-account'});assert.equal(deletion.status,200);
 for(const table of ['library_cloud','library_cloud_blocks','library_cloud_commits','library_cloud_snapshot_leases','library_cloud_block_refs'])assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.'+table+' WHERE account_id=$1',[accountId])).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud WHERE account_id=$1',[otherId])).rows[0].n,1);
 });
 }finally{await fixture.close();}
});
