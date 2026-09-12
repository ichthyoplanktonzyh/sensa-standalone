import {candidateCsp} from './release/releaseCandidate.mjs';
/** Real production UI, Chromium processes, SW and disk IDB; synthetic HTTP account/catalog only. */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,extname,resolve} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium,expect,type BrowserContext,type Page} from '@playwright/test';
import {runPersonalIntakeBrowserChecks,personalFixtureProposal} from './support/personalIntakeBrowserChecks.mts';
import {createHash} from 'node:crypto';
import {provisionLightweightInitialContent} from '../apps/web/src/experience/learningRuntime/lightweightInitialContent.ts';
const root=await mkdtemp(join(tmpdir(),'sensa-offline-')),output=join(root,'dist'),initialProfile=join(root,'profile');let profile=initialProfile;
const upgradeMode=process.argv.includes('--upgrade');let failUpgradeAssets=false;
const deletionMode=process.argv.includes('--deletion');let deletionReceipt='';
const backupMode=process.argv.includes('--backup');const personalMode=process.argv.includes('--personal-intake')||backupMode;let teacherTurns=0,contentCalls=0,reviewCalls=0,failNextReview=true;
const id=()=>crypto.randomUUID(),subject=id();let context:BrowserContext|undefined;const errors:string[]=[];let requests=0;
const cloudBlocks=new Map<string,string>();let cloudRevision=0,cloudManifest:string[]|null=null;
const result=provisionLightweightInitialContent({learnerUserId:id(),learningTargetId:id(),senseId:id(),senseVersionId:id(),senseExpressionBindingId:id(),resolvedLearningPlanRevisionId:'fixture-v1',expressionSourceVersion:'fixture-v1',senseSourceVersion:'fixture-v1',expression:{surface:'borrow',languageTag:'en',expressionKind:'word'},sense:{meaning:'临时取得他人物品，并预期归还。',familiarLanguageTag:'zh-CN'},originExperience:{source:'other_authoritative_source',sourceVersion:'fixture-v1',personalAnchorUseGrantId:null,experience:{scene:'下雨了，你向同事要一把伞，约好明天归还。',senseFocus:'临时取得他人的物品',featureLabels:[]}},referenceFacts:[],requestedAt:new Date().toISOString()});
if(result.status!=='ready')throw Error('Fixture not ready');
const pack={format:'sensa-learning-package-v1',id:id(),version:'1',title:'离线验收学习包',targetLanguage:'en',familiarLanguage:'zh-CN',entries:[{senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),expression:'borrow',meaning:'临时取得他人物品，并预期归还。',content:result.materialization.content}]};
const bytes=Buffer.from(JSON.stringify(pack));
const token=[{}, {sub:subject,exp:Math.floor(Date.now()/1000)+3600},'fixture'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
const server=createServer(async(req,res)=>{res.setHeader('Content-Security-Policy',candidateCsp);requests++;const path=new URL(req.url!,'http://localhost').pathname;const json=(value:unknown,status=200)=>{res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};const body=async()=>{const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));return JSON.parse(Buffer.concat(parts).toString());};
 if(personalMode&&path==='/sensa/native/agent/turn'){
  const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));const input=JSON.parse(Buffer.concat(parts).toString());
  let message:any,finish_reason='stop';
  if(input.purpose==='teacher'){teacherTurns++;finish_reason='tool_calls';message={content:null,tool_calls:[{id:id(),type:'function',function:teacherTurns===1?{name:'ask_learner',arguments:JSON.stringify({question:'这件物品是否需要归还？'})}:{name:'propose_meaning',arguments:JSON.stringify(personalFixtureProposal)}}]};}
  else if(input.purpose==='content'){contentCalls++;message={content:JSON.stringify({scene:'一个人向同伴临时借用一把雨伞，约好之后归还。',senseFocus:'临时使用并预期归还'})};}
  else{reviewCalls++;if(failNextReview){failNextReview=false;res.statusCode=503;json({code:'fixture_unavailable'});return;}message={content:JSON.stringify({accepted:true,reason:'符合固定含义与来源'})};}
  json({id:input.id,inputDigest:input.inputDigest,response:{model:'fixture',choices:[{finish_reason,message}]}});return;
 }
 if(deletionMode&&path.startsWith('/sensa/account/deletion')){const parts=[];for await(const part of req)parts.push(Buffer.from(part));const input=JSON.parse(Buffer.concat(parts).toString());if(path.endsWith('/status')){assert.equal(input.operationId,deletionReceipt);json({operationId:deletionReceipt,state:'deleted'});}else{assert.equal(input.confirmation,'delete-account');deletionReceipt=input.operationId;json({operationId:deletionReceipt,state:'deletion_pending'});}return;}
 if(path==='/auth/v1/otp'||path==='/auth/v1/logout'){json({});return;}
 if(path==='/auth/v1/verify'){json({access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user:{id:subject,email:'offline@sensa.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}});return;}
 if(path==='/sensa/web/access/session'){json({authorized:true,accountId:subject});return;}
 if(path==='/sensa/service/status'){json({authorized:true,explanationAvailable:false,checkedAt:new Date().toISOString(),windowHours:24,usage:['reading','teacher','content'].map(kind=>({kind,used:0,limit:30}))});return;}
 if(path==='/sensa/library-sync/head'){json({revision:cloudRevision,manifest:cloudManifest});return;}
 if(path==='/sensa/library-sync/blocks/missing'){const input=await body();json({missing:input.hashes.filter((hash:string)=>!cloudBlocks.has(hash))});return;}
 if(path==='/sensa/library-sync/blocks'){const input=await body();assert.equal(createHash('sha256').update(input.data).digest('hex'),input.hash);cloudBlocks.set(input.hash,input.data);json({stored:true});return;}
 if(path.startsWith('/sensa/library-sync/blocks/')){const hash=path.split('/').at(-1)!;const data=cloudBlocks.get(hash);if(data===undefined){json({code:'library_sync_missing_block'},404);return;}json({hash,data});return;}
 if(path==='/sensa/library-sync/commit'){const input=await body();if(input.baseRevision!==cloudRevision){json({code:'library_sync_conflict'},409);return;}cloudRevision++;cloudManifest=input.manifest;json({revision:cloudRevision,manifest:cloudManifest});return;}
 if(path==='/sensa/packages'){json({items:[{id:pack.id,version:'1',title:pack.title,description:'隔离测试资料',entryCount:1,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),url:origin+'/fixture-package.json'}]});return;}
 if(path==='/fixture-package.json'){res.setHeader('content-type','application/json');res.end(bytes);return;}
 if(path.startsWith('/sensa/')||path.startsWith('/auth/')){res.statusCode=503;json({code:'fixture_unavailable'});return;}
 if(failUpgradeAssets&&path.startsWith('/assets/')){res.writeHead(503);res.end();return;}
 try{const file=path==='/sw.js'||path.startsWith('/assets/')?resolve(output,'.'+path):join(output,'index.html');if(!file.startsWith(output+'/'))throw Error();res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2'} as Record<string,string>)[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
async function launch(offline=false){context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH,viewport:{width:1280,height:900},serviceWorkers:'allow'});if(offline)await context.setOffline(true);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;}
async function snapshot(page:Page){return page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('sensa:local-library:v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const names=['packages','learningTargets','learningRuns','learningEvents','drafts','sessions','meanings','identities','providers','settings','personalLearning','contentAttempts'];const tx=db.transaction(names,'readonly');const result=Object.fromEntries(await Promise.all(names.map(name=>new Promise<[string,any[]]>((resolve,reject)=>{const r=tx.objectStore(name).getAll();r.onsuccess=()=>resolve([name,r.result]);r.onerror=()=>reject(r.error);})))) as Record<string,any[]>;db.close();return result;});}
try{
 console.log('Building isolated production app…');await promisify(execFile)('npm',['run','build','-w','@sensa/web','--','--outDir',output],{cwd:process.cwd(),env:{...process.env,VITE_SENSA_MODE:'production',VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-public',VITE_SENSA_API_URL:origin},maxBuffer:8*1024*1024});
 let page=await launch();await page.goto(origin+'/profile');await page.getByLabel('邮箱',{exact:true}).fill('offline@sensa.invalid');await page.getByRole('button',{name:'发送登录邮件',exact:true}).click();await page.getByRole('button',{name:'邮件中有验证码？',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 await expect(page.getByRole('heading',{name:'账号与设置',exact:true})).toBeVisible();await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));await page.reload();await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 if(upgradeMode){
  await page.goto(origin+'/learning-entry');await page.getByRole('button',{name:/离线验收学习包/}).click();await page.getByRole('button',{name:'下载学习包',exact:true}).click();await expect.poll(async()=> (await snapshot(page)).packages.length).toBe(1);
  const saved=await snapshot(page),oldCaches=await page.evaluate(()=>caches.keys());
  const swPath=join(output,'sw.js'),oldWorker=await readFile(swPath,'utf8');
  const htmlPath=join(output,'index.html');await writeFile(htmlPath,(await readFile(htmlPath,'utf8')).replace('</head>','<meta name="sensa-upgrade-fixture" content="v2"></head>'));
  await writeFile(swPath,oldWorker.replace(/sensa-shell-([a-f0-9]+)/,'sensa-shell-$1-failed'));failUpgradeAssets=true;
  const failed=await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration!.update();const worker=registration!.installing;if(!worker)return 'missing';return new Promise<string>(resolve=>{worker.addEventListener('statechange',()=>{if(['installed','redundant'].includes(worker.state))resolve(worker.state);});});});
  assert.equal(failed,'redundant');assert((await page.evaluate(()=>caches.keys())).some(k=>oldCaches.includes(k)));assert.deepEqual(await snapshot(page),saved);
  failUpgradeAssets=false;await writeFile(swPath,oldWorker.replace(/sensa-shell-([a-f0-9]+)/,'sensa-shell-$1-success'));
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration!.update();if(registration!.waiting)return;await new Promise<void>(resolve=>{const w=registration!.installing!;w.addEventListener('statechange',()=>{if(w.state==='installed')resolve();});});});
  assert.deepEqual(await snapshot(page),saved);await context!.close();context=undefined;page=await launch();await page.goto(origin+'/profile');await expect(page.getByRole('heading',{name:'账号与设置',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>caches.keys())).toEqual([oldCaches.find(k=>k.startsWith('sensa-shell-'))+'-success']);assert.deepEqual(await snapshot(page),saved);
  await context!.close();context=undefined;await new Promise<void>(resolve=>server.close(()=>resolve()));page=await launch(true);await page.goto(origin+'/profile');await expect(page.getByRole('heading',{name:'账号与设置',exact:true})).toBeVisible();assert.equal(await page.locator('meta[name="sensa-upgrade-fixture"]').getAttribute('content'),'v2');assert.deepEqual(await snapshot(page),saved);
  console.log('PASS: real service worker failed-update rollback, deferred successful activation, old cache cleanup and offline process restart with unchanged installed library.');
 }
 else if(deletionMode){
  await page.goto(origin+'/learning-entry');await page.getByRole('button',{name:/离线验收学习包/}).click();await page.getByRole('button',{name:'下载学习包',exact:true}).click();await expect.poll(async()=> (await snapshot(page)).packages.length).toBe(1);
  await page.goto(origin+'/profile');await page.locator('select[aria-label="界面语言"]:visible').selectOption('en');
  await page.getByRole('button',{name:/Account & security/}).click();await page.getByRole('button',{name:'Delete account',exact:true}).click();await expect(page.getByRole('button',{name:'Send deletion verification code',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('heading',{name:'Account & settings',exact:true})).toBeVisible();assert.equal((await snapshot(page)).packages.length,1);
  await page.getByRole('button',{name:/Account & security/}).click();await page.getByRole('button',{name:'Delete account',exact:true}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Send deletion verification code',exact:true}).click();
  await page.getByLabel('Email verification code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Verify and delete account',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Account access has stopped');assert.equal((await snapshot(page)).packages.length,0);
  await page.reload();await page.getByRole('button',{name:'Check deletion status',exact:true}).click();await expect(page.getByRole('status')).toContainText('Account deleted and this browser cleared');
  assert.equal(await page.evaluate(()=>localStorage.getItem('sensa:account-deletion')),null);assert.deepEqual(errors,[]);
  console.log('PASS: real full app deletion cancel/confirmation, OTP flow, pending erasure, reload receipt recovery and English feedback. Auth/deletion HTTP is synthetic.');
 }
 else if(personalMode){await runPersonalIntakeBrowserChecks(page,origin);assert.equal(contentCalls,1);assert.equal(reviewCalls,2);const saved=await snapshot(page);
 if(backupMode){
  const password='browser-backup-test-password',backupPath=join(root,'library.sensa-backup');
  const openSettingsHome=async(target:Page)=>{await target.goto(origin+'/profile');await expect(target.getByRole('heading',{name:/^(账号与设置|Account & settings)$/})).toBeVisible();};
  const openData=async(target:Page)=>{await openSettingsHome(target);await target.getByRole('button',{name:/账号与数据|设备与数据|Device & data/}).click();};
  const openBackup=async(target:Page)=>{await openData(target);await target.getByRole('button',{name:/本机库备份与恢复|Backup & restore/}).click();};
  const openStorage=async(target:Page)=>{await openData(target);await target.getByRole('button',{name:/本机数据管理|Local data management/}).click();};
  await openSettingsHome(page);
  await page.locator('select[aria-label="界面语言"]:visible').selectOption('en');
  await openBackup(page);
  await expect(page.getByRole('heading',{name:'Backup & restore',exact:true,level:1})).toBeVisible();
  await page.getByRole('button',{name:'Export encrypted backup',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Use at least 12 characters');
  await expect(page.getByLabel('Backup password',{exact:true})).toBeFocused();
  await page.locator('select[aria-label="Interface language"]:visible').selectOption('zh-CN');
  await expect(page.getByRole('alert')).toContainText('至少 12 个字符');
  await page.locator('select[aria-label="界面语言"]:visible').selectOption('en');await page.reload();
  await openSettingsHome(page);await page.getByRole('button',{name:/Model services/}).click();await expect(page.getByRole('heading',{name:'Model services',exact:true})).toBeVisible();
  let releaseStatus!:()=>void;const statusBarrier=new Promise<void>(resolve=>{releaseStatus=resolve;});
  await page.route('**/sensa/service/status',async route=>{await statusBarrier;await route.continue();});
  await page.getByRole('button',{name:'Refresh service status',exact:true}).click();
  await expect(page.getByRole('button',{name:'Refreshing…',exact:true})).toBeDisabled();releaseStatus();
  await expect(page.getByText('Service status updated.',{exact:true})).toBeVisible();await page.unroute('**/sensa/service/status');
  await page.getByText('Advanced · Custom model services',{exact:true}).click();
  await expect(page.getByLabel('Independent review',{exact:true})).toBeVisible();
  const settingsText=await page.locator('section[aria-label="Sensa services"]').innerText();assert(!/[\u4e00-\u9fff]/u.test(settingsText),'Service settings must not contain hardcoded Chinese');
  await page.locator('select[aria-label="Interface language"]:visible').selectOption('zh-CN');
  await openBackup(page);
  await page.getByLabel('备份密码',{exact:true}).fill(password);
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'导出加密备份',exact:true}).click();await (await downloading).saveAs(backupPath);
  await page.getByLabel('选择备份文件',{exact:true}).setInputFiles(backupPath);await page.getByRole('button',{name:'检查备份',exact:true}).click();await page.getByRole('button',{name:'确认恢复到当前空本机库',exact:true}).click();await expect(page.getByText(/当前本机库已有资料或操作记录/)).toBeVisible();assert.deepEqual(await snapshot(page),saved);
  await context!.close();context=undefined;cloudBlocks.clear();cloudRevision=0;cloudManifest=null;profile=join(root,'restored');page=await launch();await page.goto(origin+'/profile');
  await page.getByLabel('邮箱',{exact:true}).fill('offline@sensa.invalid');await page.getByRole('button',{name:'发送登录邮件',exact:true}).click();await page.getByRole('button',{name:'邮件中有验证码？',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
  await expect(page.getByRole('heading',{name:'账号与设置',exact:true})).toBeVisible();assert.equal((await snapshot(page)).learningTargets.length,0);
  await page.locator('select[aria-label="界面语言"]:visible').selectOption('en');
  await openBackup(page);
  await page.getByLabel('Backup password',{exact:true}).fill('incorrect-password');await page.getByLabel('Choose backup file',{exact:true}).setInputFiles(backupPath);await page.getByRole('button',{name:'Check backup',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect password');assert.equal((await snapshot(page)).learningTargets.length,0);
  await page.getByLabel('Backup password',{exact:true}).fill(password);await page.getByRole('button',{name:'Check backup',exact:true}).click();await page.getByRole('button',{name:'Restore to this empty library',exact:true}).click();await expect(page.getByText('Library restored. Reopen the app to continue learning.',{exact:true})).toBeVisible();
  await page.locator('select[aria-label="Interface language"]:visible').selectOption('zh-CN');

  await page.getByRole('button',{name:'重新打开应用',exact:true}).click();await expect(page.getByRole('heading',{name:'账号与设置',exact:true})).toBeVisible();assert.deepEqual(await snapshot(page),saved);assert.equal(contentCalls,1);assert.equal(reviewCalls,2);await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
  console.log('PASS: full /profile encrypted download, occupied-library refusal, independent fresh browser login/preview/restore/reload; no generation on restore.');
  const stalePage=await context!.newPage();await openStorage(stalePage);await openStorage(page);
  await expect(stalePage.getByRole('button',{name:'检查要清除的资料',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'检查要清除的资料',exact:true}).click();
  await expect(page.getByRole('button',{name:'确认清除本机资料',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(await snapshot(page),saved);
  await page.getByRole('button',{name:'检查要清除的资料',exact:true}).click();
  await page.getByRole('checkbox',{name:'我已保存需要的备份，确认清除以上本机资料。',exact:true}).check();
  await page.getByRole('button',{name:'确认清除本机资料',exact:true}).click();
  await expect(page.getByText('本机资料已清除。重新打开应用可开始使用空资料库。',{exact:true})).toBeVisible();
  assert.equal((await snapshot(page)).learningTargets.length,0);
  await stalePage.getByRole('button',{name:'检查要清除的资料',exact:true}).click();
  await expect(stalePage.getByRole('alert')).toBeVisible();await stalePage.close();
  await page.getByRole('button',{name:'重新打开应用',exact:true}).click();
  await openBackup(page);await expect(page.getByRole('heading',{name:'本机库备份与恢复',exact:true,level:1})).toBeVisible();
  await page.getByLabel('备份密码',{exact:true}).fill(password);await page.getByLabel('选择备份文件',{exact:true}).setInputFiles(backupPath);
  await page.getByRole('button',{name:'检查备份',exact:true}).click();await page.getByRole('button',{name:'确认恢复到当前空本机库',exact:true}).click();
  await page.getByRole('button',{name:'重新打开应用',exact:true}).click();
  await expect(page.getByRole('heading',{name:'账号与设置',exact:true})).toBeVisible();assert.deepEqual(await snapshot(page),saved);
  console.log('PASS: full profile local erase confirmation/cancel, stale tab fencing, empty library reload and backup recovery.');

 }
 await context!.close();context=undefined;await new Promise<void>(resolve=>server.close(()=>resolve()));page=await launch(true);const response=await page.goto(origin+'/?flow=lightweight');assert(response?.fromServiceWorker());await expect(page.getByText('本次首次学习已完成',{exact:true})).toBeVisible({timeout:20000});assert.deepEqual(await snapshot(page),saved);assert.deepEqual(errors,[]);console.log('PASS: full production UI Intake slow/fast paths, clarification, explicit enrollment, interrupted review recovery without regeneration, shared runtime and offline process-restart persistence; synthetic extension bridge and model HTTP, no paid services.');}
 else{
 await page.goto(origin+'/learning-entry');await page.getByRole('button',{name:/离线验收学习包/}).click();await page.getByRole('button',{name:'下载学习包',exact:true}).click();await expect.poll(async()=> (await snapshot(page)).packages.length).toBe(1);assert.equal((await snapshot(page)).learningTargets.length,0);
 await page.getByRole('button',{name:'加入学习',exact:true}).click();await expect(page.locator('#s-learning-entry').getByText('已加入学习',{exact:true})).toBeVisible();await page.getByRole('button',{name:'查看 borrow 的详情',exact:true}).click();await page.getByRole('button',{name:'开始 / 继续学习',exact:true}).click();await page.getByRole('button',{name:'确认数量并开始',exact:true}).click();await page.getByRole('button',{name:'显示表达',exact:true}).click();
 await expect.poll(async()=> (await snapshot(page)).learningRuns[0]?.phase).toBe('reveal');const before=await snapshot(page);assert.equal(before.learningTargets[0].memory,null);
 const cached=await page.evaluate(async()=>{const keys=await caches.keys();return (await Promise.all(keys.map(async key=>(await (await caches.open(key)).keys()).map(r=>new URL(r.url).pathname)))).flat();});assert(cached.includes('/index.html'));assert(!cached.some(p=>p.startsWith('/sensa/')||p.startsWith('/auth/')||p==='/fixture-package.json'));
 // Expire the synthetic auth token in this isolated profile, leaving the real library intact.
 await page.evaluate(()=>{const key=Object.keys(localStorage).find(k=>/^sb-.*-auth-token$/u.test(k));if(!key)throw Error('Missing fixture auth storage');const session=JSON.parse(localStorage.getItem(key)!);session.expires_at=Math.floor(Date.now()/1000)-3600;session.access_token=[btoa('{}'),btoa(JSON.stringify({sub:session.user.id,exp:session.expires_at})),'fixture'].join('.');localStorage.setItem(key,JSON.stringify(session));});
 await context!.close();context=undefined;await new Promise<void>(resolve=>server.close(()=>resolve()));const stoppedRequests=requests;console.log('Preparation saved. Server stopped and browser process closed.');
 page=await launch(true);const coldResponse=await page.goto(origin+'/profile');assert.equal(coldResponse?.fromServiceWorker(),true);await expect(page.getByRole('heading',{name:'账号与设置',exact:true})).toBeVisible({timeout:20000});assert.equal(await page.evaluate(()=>fetch('/offline-network-probe',{cache:'no-store'}).then(()=>false,()=>true)),true);
 await page.goto(origin+'/');await page.getByRole('button',{name:'继续学习',exact:true}).click();await expect(page.locator('#s-lightweight-runtime')).toBeVisible();await expect(page.locator('#s-lightweight-runtime').getByText('borrow',{exact:true})).toBeVisible();assert.deepEqual(await snapshot(page),before);
 await page.getByRole('button',{name:/顺利想起/}).click();await expect(page.getByText('本次首次学习已完成',{exact:true})).toBeVisible();const completed=await snapshot(page);assert.equal(completed.learningTargets[0].memoryRevision,1);assert.equal(completed.learningRuns.length,1);assert.equal(completed.learningEvents.length,2);
 await context!.close();context=undefined;
 page=await launch(true);await page.goto(origin+'/?flow=lightweight');await expect(page.getByText('本次首次学习已完成',{exact:true})).toBeVisible({timeout:20000});assert.deepEqual(await snapshot(page),completed);assert.equal(requests,stoppedRequests);assert.deepEqual(errors,[]);
 await page.goto(origin+'/learning-entry');await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.locator('#s-learning-entry').getByText(/暂时无法更新目录/)).toBeVisible();await expect(page.getByRole('button',{name:/离线验收学习包/})).toBeVisible();
 // A different account in another tab immediately locks the local library offline.
 const other=await context!.newPage();await other.goto(origin+'/profile');
 await other.evaluate(()=>{const key=Object.keys(localStorage).find(k=>/^sb-.*-auth-token$/u.test(k))!;const session=JSON.parse(localStorage.getItem(key)!);session.user.id=crypto.randomUUID();localStorage.setItem(key,JSON.stringify(session));});
 await expect(page.getByText(/此设备的资料属于另一个账号或登录状态无法读取/)).toBeVisible();assert.deepEqual(await snapshot(page),completed);
 await other.evaluate(subject=>{const key=Object.keys(localStorage).find(k=>/^sb-.*-auth-token$/u.test(k))!;const session=JSON.parse(localStorage.getItem(key)!);session.user.id=subject;localStorage.setItem(key,JSON.stringify(session));},subject);await other.close();
 await page.goto(origin+'/profile');await page.getByRole('button',{name:/账号与安全/}).click();await page.getByRole('button',{name:'退出账号',exact:true}).click();await expect(page.getByRole('heading',{name:'欢迎来到 Sensa',exact:true})).toBeVisible();await context!.close();context=undefined;
 page=await launch(true);await page.goto(origin+'/profile');await expect(page.getByRole('heading',{name:'欢迎来到 Sensa',exact:true})).toBeVisible({timeout:5000});assert.deepEqual(await snapshot(page),completed);
 await context!.close();context=undefined;
 // No preparation => no shell; an empty profile must not pass by HTTP disk cache.
 context=await chromium.launchPersistentContext(join(root,'fresh'),{headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH});await context.setOffline(true);const fresh=await context.newPage();await assert.rejects(fresh.goto(origin+'/profile'));await context.close();context=undefined;
 console.log('PASS: actual Chromium process restarts, server unavailable, offline /profile and /, downloaded package and reveal-step recovery, one settlement persisted across another restart, expired-token learning, cached catalog retry, cross-account/signout lock, no account/API/package cache, no-preparation negative control. Synthetic account/catalog; no real email/provider calls.');
}
}finally{await context?.close();server.close();await rm(root,{recursive:true,force:true});}
