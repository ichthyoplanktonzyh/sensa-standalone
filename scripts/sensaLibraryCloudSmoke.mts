/** Real Chromium IndexedDB + Hono + disposable Postgres. No model calls or real accounts. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {libraryCloudPackageFixture} from './support/libraryCloudPackageFixture.mts';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import pg from 'pg';
import {createConsumerRoutes} from '../apps/api/src/sensa/access/consumer.ts';
import {librarySyncBlockChars,librarySyncBlockStoreBatch} from '../packages/contracts/src/sensa/librarySync.ts';
const url=process.env.SENSA_ADMIN_TEST_DATABASE_URL??process.env.SENSA_TEST_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||!new URL(url).pathname.startsWith('/sensa_m1a_'))throw Error('Disposable loopback database required');
const pool=new pg.Pool({connectionString:url}),subjects=[crypto.randomUUID(),crypto.randomUUID()],sessions=subjects.map(()=>crypto.randomUUID());
process.env.SENSA_REGISTRATION_POLICY='registered';
const app=createConsumerRoutes({deleteIdentity:async()=>{},telemetry:()=>{},verify:async r=>{const index=r.headers.get('authorization')==='Bearer second'?1:0;return {issuer:'https://fixture.supabase.co/auth/v1',subject:subjects[index],sessionId:sessions[index],email:'sync@sensa.invalid',authenticatedAt:Math.floor(Date.now()/1000)};},transaction:async work=>{const db=await pool.connect();await db.query('BEGIN');try{await db.query('SET LOCAL ROLE backend_app');const value=await work(db);await db.query('COMMIT');return value;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}});
const bundle=await build({stdin:{contents:[...['store','cloudSync','intake','teacher','providers','personalLearning','drafts','packages','learning','language','backup','backupValidation'].map(n=>`export * from './apps/web/src/data/library/${n}';`),`export * from './apps/web/src/learning/protocols/fourStage';`,`export * from './apps/web/src/learning/runtime/localCurriculum';`].join('\n'),resolveDir:process.cwd()},bundle:true,format:'esm',write:false,define:{'import.meta.env':'{}'}});
let calls:{path:string;method:string}[]=[];
const server=createServer(async(req,res)=>{const path=req.url??'/';if(path==='/core.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0]!.text);return;}if(!path.startsWith('/sensa/')){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Library sync integration</title>');return;}const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);calls.push({path,method:req.method??'GET'});const response=await app.request('http://fixture'+path,{method:req.method,headers:{authorization:req.headers.authorization??'Bearer first','content-type':'application/json'},...(body.length?{body}: {})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH});
async function account(token='first'){const response=await fetch(origin+'/sensa/web/access/session',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({installationId:crypto.randomUUID()})});assert.equal(response.status,200);return (await response.json() as any).accountId;}
async function client(accountId:string,subject=subjects[0],token='first'){
 const context=await browser.newContext();await context.addInitScript('window.__name = fn => fn;');const page=await context.newPage();await page.goto(origin);
 await page.evaluate(async({accountId,subject,token})=>{
  const w=window as any,wcore=await import(/* @vite-ignore */ '/core.js');w.core=wcore;w.token=token;w.failAck=false;w.offline=false;
  await wcore.openLibrary();await wcore.command({id:crypto.randomUUID(),kind:'service.connect',input:{}},async(tx:any)=>tx.put('meta','service-owner',{subject,accountId}));
  w.request=async(path:string,body?:unknown)=>{if(w.offline)throw new Error('offline');const response=await fetch('/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+w.token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.code);if(w.failAck&&path==='/commit'){w.failAck=false;throw new Error('lost_ack');}return value;};
  w.sync=()=>wcore.synchronizeLibrary(w.request);
 },{accountId,subject,token});return page;
}
try{
 const accountId=await account(),otherId=await account('second');
 const a=await client(accountId);const b=await client(accountId);const other=await client(otherId,subjects[1],'second');
 const draft=await a.evaluate(async()=>{const c=(window as any).core;return c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'My raincoat',images:[{id:crypto.randomUUID(),name:'raincoat.jpg',dataUrl:document.createElement('canvas').toDataURL('image/jpeg')}]});});
 await a.evaluate(()=>{(window as any).failAck=true;});await assert.rejects(a.evaluate(()=>(window as any).sync()),/lost_ack/);
 assert.equal((await pool.query('SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[accountId])).rows[0].revision,1);
 await a.evaluate(()=>(window as any).sync());assert.equal((await pool.query('SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[accountId])).rows[0].revision,1,'lost ACK is idempotent');
 await b.evaluate(()=>(window as any).sync());assert.deepEqual(await b.evaluate(()=>(window as any).core.listDrafts()),[draft]);
 const identities=await Promise.all([a,b].map(p=>p.evaluate(()=>(window as any).core.openLibrary())));assert.equal(identities[0].id,identities[1].id);assert.notEqual(identities[0].deviceId,identities[1].deviceId);
 calls=[];await b.evaluate(()=>(window as any).sync());assert.equal(calls.filter(c=>c.path.endsWith('/blocks/fetch')).length,0,'unchanged content is reused locally without a batch fetch');
 await other.evaluate(()=>(window as any).sync());assert.deepEqual(await other.evaluate(()=>(window as any).core.listDrafts()),[]);
 const hash=(await pool.query('SELECT hash FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 LIMIT 1',[accountId])).rows[0].hash;
 assert.equal((await fetch(origin+'/sensa/library-sync/blocks/'+hash,{headers:{authorization:'Bearer second'}})).status,404,'blocks are account isolated');
 // Independent offline additions merge; no records are lost.
 for(const [page,text]of [[a,'A offline'],[b,'B offline']] as const)await page.evaluate(async text=>{const w=window as any;w.offline=true;await w.core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text});},text);
 await assert.rejects(a.evaluate(()=>(window as any).sync()),/offline/);await a.evaluate(()=>{(window as any).offline=false;});await b.evaluate(()=>{(window as any).offline=false;});
 await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());await a.evaluate(()=>(window as any).sync());assert.equal((await a.evaluate(()=>(window as any).core.listDrafts())).length,3);
 // A local write arriving after the sync snapshot is captured is fenced, then retried safely.
 await a.evaluate(()=>{const w=window as any,original=w.request;let once=true;w.request=async(path:string,body?:unknown)=>{const result=await original(path,body);if(path==='/head'&&once){once=false;await w.core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Written during sync'});}return result;};});
 await assert.rejects(a.evaluate(()=>(window as any).sync()),/library_sync_local_changed/);await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());assert((await b.evaluate(()=>(window as any).core.listDrafts())).some((d:any)=>d.text==='Written during sync'));
 // Confirmed personal meaning + rich context + generated resources, through original functions.
 await a.evaluate(async({accountId,image})=>{
  const c=(window as any).core,id=()=>crypto.randomUUID(),library=await c.openLibrary();
  const proposal={explanation:'防雨时穿在身上的衣服。',expression:{surface:'raincoat',type:'word',language:'en'},semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'防雨时穿在身上的衣服',prototypeScenes:[{summary:'一个人在雨中穿着防水的外衣。',participantRoles:['穿衣者'],states:['下雨'],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]}};
  await c.receiveWebIntake(accountId,{version:'sensa-intake-v1',libraryId:library.id,clientId:id(),operationId:id(),languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},snapshot:{sentence:'My raincoat',language:'en',languageSource:'detector',languageConfidence:.9,source:{url:'https://example.org',title:'A rainy day',capturedAt:new Date().toISOString()},expression:{text:'raincoat',start:3,end:11}},resolution:{kind:'proposal',proposal},acceptance:{kind:'direct',consent:'accept_context_expression_sense',authorization:'browser:explicit_accept_button'}});
  const meaning=(await c.listMeanings())[0];await c.updateMeaningContext(id(),meaning.id,1,'下雨时我穿了自己的防水外衣。',[image]);
  const provider=await c.saveProvider(id(),{id:id(),expectedRevision:0,name:'Test model',kind:'compatible',endpoint:'https://sync-model.invalid/v1',model:'synthetic'},'fixture-device-secret');
  const settings=(await c.providerSnapshot()).settings;await c.assignProvider(id(),'content',provider.id,settings.revision);
  const original=window.fetch;window.fetch=async(url:any,init:any)=>{if(String(url).startsWith(provider.endpoint))return new Response(JSON.stringify({model:'synthetic',choices:[{finish_reason:'stop',message:{content:JSON.stringify({scene:'下雨时一个人穿了自己的防水外衣，挡住雨水。',senseFocus:'防雨时穿在身上的衣服'})}}]}),{headers:{'content-type':'application/json'}});return original(url,init);};
  try{const languageContext=(await c.languageRoutesSnapshot()).context,task=await c.enrollPersonal(id(),meaning.id,languageContext,true);await c.preparePersonal(task.id,provider,null,new AbortController().signal,()=>{});}finally{window.fetch=original;}
  if((await c.personalLearningSnapshot())[0].status!=='ready')throw Error('personal resources not ready');
 },{accountId,image:draft.images[0]});
 // Actual learning resources (including audio), runtime records and schedule restore/replay.
 const {bytes,descriptor}=await libraryCloudPackageFixture();
 const progress=await a.evaluate(async({bytes,descriptor})=>{const c=(window as any).core,languageContext=(await c.languageRoutesSnapshot()).context;const pack=await c.installPackage(new Uint8Array(bytes),descriptor),ids=await c.enrollPackage(crypto.randomUUID(),pack.key,languageContext);for(const id of ids)await c.selectLocalLearningPolicy(crypto.randomUUID(),id,languageContext,'interleaved_four_stage');await c.confirmLearningQuantity(crypto.randomUUID(),languageContext,20);let run=await c.startLearning(crypto.randomUUID(),ids[0],languageContext,20,'2026-09-11T04:00:00.000Z');let steps=0;while(!run.completedAt&&steps++<60){const session=c.fourStageQueue(run).getCurrentSession();let response:any;if(session.phase==='feedback')response={kind:'continue'};else if(['meaning_choice','sound_choice'].includes(session.presentation)){const target=(await c.readLearning()).targets.find((t:any)=>t.id===session.targetId),executable=c.localExecutableTargetForParticipant(target,run.participants[target.id]);const content=c.fourStageContent(executable,pack);response={kind:'choice',optionId:content.recognitionAssessment.options.find((o:any)=>o.isCorrect).id};}else response={kind:'self_report',known:true};run=await c.actLearning(crypto.randomUUID(),run.id,run.revision,{kind:'protocol',response},'2026-09-11T04:00:00.000Z');}if(!run.completedAt)throw Error('runtime incomplete');await c.finishLearning(crypto.randomUUID(),run.id);return JSON.stringify(await c.readLearning());},{bytes,descriptor});
 await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());assert.deepEqual(JSON.parse(await b.evaluate(async()=>JSON.stringify(await (window as any).core.readLearning()))),JSON.parse(progress));
 // New context (fresh local DB) obtains a complete usable library and media.
 const fresh=await client(accountId);
 // A new Web bundle may briefly meet the previous API during a rolling release.
 // That API accepts eight hashes and omits the deferred field.
 await fresh.evaluate(()=>{const w=window as any,original=w.request;w.request=async(path:string,body?:any)=>{if(path==='/blocks/fetch'){if(body.hashes.length>8)throw new Error('invalid_request');const value=await original(path,body);delete value.deferred;return value;}return original(path,body);};});
 await fresh.evaluate(()=>(window as any).sync());assert.deepEqual(JSON.parse(await fresh.evaluate(async()=>JSON.stringify(await (window as any).core.readLearning()))),JSON.parse(progress));
 assert.deepEqual(await fresh.evaluate(()=>(window as any).core.listDrafts()),await a.evaluate(()=>(window as any).core.listDrafts()));
 assert.deepEqual(await fresh.evaluate(()=>(window as any).core.installedPackages()),await a.evaluate(()=>(window as any).core.installedPackages()),'package resources and embedded audio restore unchanged');
 const backup=await fresh.evaluate(async()=>{const c=(window as any).core;return (await c.exportLibraryBackup('sync-test-backup-password')).summary;});assert.equal(backup.targets,3);assert(backup.events>0);
 assert.equal((await fresh.evaluate(()=>(window as any).core.listMeanings())).length,1);assert.equal((await fresh.evaluate(()=>(window as any).core.personalLearningSnapshot()))[0].status,'ready');
 assert(!(await pool.query('SELECT data FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1',[accountId])).rows.some(r=>r.data.includes('fixture-device-secret')),'BYOK credentials stay device-local');
 // Conflicting edits remain in each browser; cloud still retains its published version.
 for(const [page,text]of [[a,'A edit'],[b,'B edit']] as const)await page.evaluate(async({draft,text})=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:draft.id,expectedRevision:1,text});},{draft,text});
 await b.evaluate(async()=>{const c=(window as any).core;await c.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Independent while conflicted'});});
 await a.evaluate(()=>(window as any).sync());await b.evaluate(()=>(window as any).sync());assert.equal((await b.evaluate(()=>(window as any).core.readCloudSync())).status,'conflict');assert.equal((await b.evaluate(()=>(window as any).core.listDrafts())).find((d:any)=>d.id===draft.id).text,'B edit');
 await fresh.evaluate(()=>(window as any).sync());assert.equal((await fresh.evaluate(()=>(window as any).core.listDrafts())).find((d:any)=>d.id===draft.id).text,'A edit');
 assert((await fresh.evaluate(()=>(window as any).core.listDrafts())).some((d:any)=>d.text==='Independent while conflicted'),'independent records sync while conflicting component is held');
 // Signout fences synchronization and cloud metadata never enters exported backups.
 await b.evaluate(async()=>{const c=(window as any).core;await c.command({id:crypto.randomUUID(),kind:'service.signout',input:{}},async(tx:any)=>tx.put('meta','signed-out',true));});await assert.rejects(b.evaluate(()=>(window as any).sync()),/authentication_required/);
 // Optional formal UI integration, with real Supabase SDK and synthetic Auth HTTP only.
 if(process.env.SENSA_LOCAL_WEB_URL){
  const webOrigin=process.env.SENSA_LOCAL_WEB_URL;if(new URL(webOrigin).hostname!=='127.0.0.1')throw Error('Use isolated loopback Web');
  const ctx=await browser.newContext(),ui=await ctx.newPage();let accountInitializations=0;const errors:string[]=[];ui.on('pageerror',e=>errors.push(e.message));
  const token=[{}, {sub:subjects[0],exp:Math.floor(Date.now()/1000)+3600},'fixture'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  await ctx.route('**/*',async route=>{
   const req=route.request(),address=new URL(req.url());
   if(address.pathname.includes('/auth/v1/otp')){await route.fulfill({json:{}});return;}
   if(address.pathname.includes('/auth/v1/verify')){await route.fulfill({json:{access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user:{id:subjects[0],email:'sync@sensa.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}});return;}
   const at=address.pathname.indexOf('/sensa/');
   if(at>=0&&address.origin!==webOrigin){const path=address.pathname.slice(at);if(path.startsWith('/sensa/library-sync')||path==='/sensa/web/access/session'){
    if(path==='/sensa/web/access/session')accountInitializations++;
    const reply=await app.request('http://fixture'+path,{method:req.method(),headers:{authorization:'Bearer first','content-type':'application/json'},...(req.postData()?{body:req.postData()!}: {})});await route.fulfill({status:reply.status,contentType:'application/json',body:await reply.text()});return;
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
 }
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
 let head=await readHead();
 const priorRevision=head.revision;
 const repacked=await publish(JSON.parse(JSON.stringify(head.manifest)),priorRevision,8192);assert.equal(repacked.status,200,'repacking published history must be accepted');
 head=await readHead();assert.equal(head.revision,priorRevision+1);await refresh();
 // Server rejects a new snapshot that rewrites an already published learning fact.
 const manifest=JSON.parse(JSON.stringify(head.manifest));
 const event=manifest.rows.find((r:any)=>r.table==='learningEvents');event.blocks=manifest.rows.find((r:any)=>r.table==='drafts').blocks;
 const rejected=await publish(manifest,head.revision,librarySyncBlockChars);assert.equal(rejected.status,409);assert.equal((await rejected.json() as any).code,'library_sync_history');
 assert.equal((await pool.query('SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',[accountId])).rows[0].revision,head.revision);
 const deletion=await post('account/deletion',{operationId:crypto.randomUUID(),confirmation:'delete-account'});assert.equal(deletion.status,200);
 for(const table of ['library_cloud','library_cloud_blocks','library_cloud_commits'])assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.'+table+' WHERE account_id=$1',[accountId])).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int n FROM sensa_consumer.library_cloud WHERE account_id=$1',[otherId])).rows[0].n,1);
 console.log('PASS: server rejects history rewrite; account deletion removes cloud state, blocks and receipts without affecting another account');
 console.log('PASS: real browser + Postgres sync, lost ACK, offline merge, conflict preservation, image/audio and full learning restore, account isolation, backup, signout');
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();}
