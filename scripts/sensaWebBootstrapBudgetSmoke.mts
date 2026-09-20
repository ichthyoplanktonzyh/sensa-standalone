/** Production boot budget for the real Web bundle. No paid service, no real account.
 *
 * The local library is the product authority, so an account cloud restore may never
 * hold the App Shell closed. This serves the built Web application against a
 * same-origin fixture account service whose library calls carry injected latency,
 * then measures the contract the release depends on:
 *
 *   App Shell interactive  -> must not wait for the account restore
 *   restore completion     -> bounded time
 *   block request count    -> bounded round trips, not one request per block
 *   console / CSP          -> no runtime error and no blocked dynamic code
 */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,rm} from 'node:fs/promises';
import {extname,join,resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {librarySyncBlockFetchBytes,librarySyncBlockStoreChars} from '../packages/contracts/src/sensa/librarySync.ts';
import {pageLayoutFamilyContract} from '../apps/web/src/experience/appearance/pageLayoutContract.ts';

const root=process.cwd();
const output=resolve(root,'.tmp/web-bootstrap-budget');
const dist=join(output,'dist');
/** Deliberately slower than a healthy edge request, so a blocked shell is obvious. */
const SERVICE_LATENCY_MS=1500;
const ACCESS_LATENCY_MS=12000;
const SHELL_BUDGET_MS=6000;
/** An untouched, already-restored tab must not talk to the account service at all. */
const IDLE_WINDOW_MS=9000;
const RESTORE_BUDGET_MS=90000;
/** The fixture library only has to be heavy enough that per-block requests are fatal. */
const MINIMUM_PUBLISHED_BLOCKS=8;
const DRAFTS=14,IMAGES_PER_DRAFT=2;
const TOTAL_DRAFTS=DRAFTS+1;
const MINIMUM_LEGACY_BYTES=4*1024*1024;
const SUBJECT='8b1f4c1e-9d5a-4c34-9c3a-9f1d0d1a1c11';
const ACCOUNT='4f2a7b60-1c6e-4a52-8f0b-6d3c2a9e5b21';
const REMOTE_OPERATION='45466b13-66db-4d57-a393-bc2946873152';
const REMOTE_INCOMPLETE_OPERATION='c9e23ca7-d84d-4d7c-bd7a-2327b80f7860';
const REMOTE_QUEUED_AT='2026-09-13T08:00:00.000Z';
const storageKeySuffix='-auth-token';
const failures:string[]=[];
const log=(message:string)=>console.log(message);

function jwt(expSeconds:number){const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');return [encode({alg:'HS256',typ:'JWT'}),encode({sub:SUBJECT,aud:'authenticated',email:'fixture@sensa.invalid',session_id:randomUUID(),exp:Math.floor(Date.now()/1000)+expSeconds,amr:[{method:'otp',timestamp:Math.floor(Date.now()/1000)}]}),'fixture-signature'].join('.');}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');

type Cloud={blocks:Map<string,string>;revision:number;manifest:string[]|null;commits:Map<string,string>;published:number;publishedBytes:number};
const clouds=new Map<string,Cloud>();
let intakeLibraryId:string|null=null;
let remoteDeliveryAvailable=false,remoteIncompleteAvailable=false,remoteAcknowledgement:any=null,remoteIncompleteAcknowledgement:any=null;
let extensionAuthorization:any=null;
const remoteSubmission={contractVersion:'sensa-intake-delivery-v1',client:{clientId:'19ba48d1-03af-489e-a352-a16f05a03d5c',kind:'agent',label:'Codex'},intake:{contractVersion:'sensa-intake-v3',operationId:REMOTE_OPERATION,capturedAt:REMOTE_QUEUED_AT,context:{modality:'text',textSegment:'I backed out.',mediaReferenceIds:[],languageTag:'en',source:{client:'codex',url:null,title:'GPT Live conversation',sourceReferenceId:'conversation-1',domSelector:null,paragraphContext:null}},expression:{surfaceForm:'back out',languageTag:'en',occurrence:{surfaceForm:'backed out',locator:{kind:'text_span',start:2,end:12}},expressionTypeHint:'phrase'},sense:{senseKey:null,semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'原本准备做某事，后来决定退出或取消',prototypeScenes:[{summary:'I backed out.',participantRoles:[],states:[],directionOrCausality:null}],includedCases:['I backed out.'],excludedCases:[],neighborContrasts:[],openQuestions:[]},wordingSource:'llm_suggested',resolutionProvenance:{resolverKind:'language_model',provider:'codex',model:'fixture',policyVersion:'sensa-agent-intake-v1',sourceReferenceIds:['conversation-1']}},acceptance:{mode:'delegated_agent',actorId:'codex',basis:'explicit_user_request',authorizationReference:null}}};
const remoteIncompleteSubmission={...remoteSubmission,intake:{...remoteSubmission.intake,operationId:REMOTE_INCOMPLETE_OPERATION,sense:null}};
const cloudFor=(account:string):Cloud=>{const existing=clouds.get(account);if(existing)return existing;const created:Cloud={blocks:new Map(),revision:0,manifest:null,commits:new Map(),published:0,publishedBytes:0};clouds.set(account,created);return created;};
/** Repack a published library into smaller blocks, the way the previous client stored it.
 *  Restoring it must still cost a byte-bounded number of round trips. */
const repackCloud=(cloud:Cloud,chars:number)=>{
 if(!cloud.manifest)throw Error('nothing to repack');
 const manifest=JSON.parse(cloud.blocks.get(cloud.manifest[0]!)!) as {version:number;rows:{table:string;key:string;blocks:string[]}[]};
 if(manifest.version!==3||manifest.rows.some(row=>row.table==='operations'))throw Error('current Checkpoint carried the device operation ledger');
 const added=new Map<string,string>(),rows:{table:string;key:string;blocks:string[]}[]=[];
 for(const [rowIndex,row] of manifest.rows.entries()){
  const text=row.blocks.map(hash=>cloud.blocks.get(hash)!).join(''),refs:string[]=[];
  // Historical row-by-row layouts placed the same embedded media after different
  // amounts of JSON, so their fixed-size chunk alignment drifted from row to row.
  const rowChars=chars-(rowIndex%29)*211;
  for(let at=0;at<text.length;at+=rowChars){const part=text.slice(at,at+rowChars),hash=digest(part);added.set(hash,part);refs.push(hash);}
  rows.push({table:row.table,key:row.key,blocks:refs.length?refs:[digest('')]});
  if(!refs.length)added.set(digest(''),'');
 }
 const next=JSON.stringify({...manifest,rows}),nextHash=digest(next);
 added.set(nextHash,next);
 // Model a genuinely old account: canonical 256K blocks are not already present
 // on the server and must be uploaded once during layout normalization.
 cloud.blocks=added;
 cloud.revision+=1;cloud.manifest=[nextHash];
 const refs=[...new Set(rows.flatMap(row=>row.blocks))];
 cloud.published=refs.length;
 cloud.publishedBytes=refs.reduce((total,hash)=>total+Buffer.byteLength(cloud.blocks.get(hash)??''),0);
};

/** The production security policy, so a blocked dynamic-code path fails here. */
const productionCsp=await (async()=>{
 const headers=await readFile(join(root,'apps/web/public/_headers'),'utf8');
 const section=headers.split(/\n\s*\n/u).find(part=>part.trimStart().startsWith('/*'));
 const line=section?.split('\n').find(candidate=>candidate.trimStart().toLowerCase().startsWith('content-security-policy:'));
 assert(line,'Production CSP header not found in apps/web/public/_headers');
 return line.slice(line.indexOf(':')+1).trim();
})();

const types:Record<string,string>={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.html':'text/html','.json':'application/json','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg','.woff2':'font/woff2','.ico':'image/x-icon'};

let origin='';
const served:{path:string;method:string}[]=[],rejected:{path:string;status:number;body:string}[]=[];
const server=createServer(async(request,response)=>{
 const url=new URL(request.url??'/',origin||'http://127.0.0.1');
 const json=(value:unknown,status=200)=>{if(status>=400)rejected.push({path:url.pathname,status,body:JSON.stringify(value)});response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
 const body=async()=>{const parts:Buffer[]=[];for await(const part of request)parts.push(Buffer.from(part));return parts.length?JSON.parse(Buffer.concat(parts).toString('utf8')):{};};
 try{
  // Every application service call is recorded, so an idle tab can assert "no requests".
  if(url.pathname.startsWith('/sensa/')||url.pathname.startsWith('/auth/'))served.push({path:url.pathname,method:request.method??'GET'});
  if(url.pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
  if(url.pathname==='/auth/v1/user'){json({id:SUBJECT,aud:'authenticated',email:'fixture@sensa.invalid',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()});return;}
  if(url.pathname==='/sensa/web/access/session'){await delay(ACCESS_LATENCY_MS);json({authorized:true,accountId:ACCOUNT});return;}
  if(url.pathname==='/sensa/extension/authorize'){
   extensionAuthorization=await body();const redirect=new URL(extensionAuthorization.redirectUri);redirect.searchParams.set('code','fb9709a8-7ba7-4bbf-aef0-2c036d94b86c');redirect.searchParams.set('state',extensionAuthorization.state);json({redirectUri:redirect.href});return;
  }
  if(url.pathname==='/sensa/intake/channel'){
   const input=await body() as {libraryId:string};
   if(intakeLibraryId&&intakeLibraryId!==input.libraryId){json({code:'intake_destination_conflict'},409);return;}
   intakeLibraryId=input.libraryId;
   json({registered:true,libraryId:input.libraryId});return;
  }
  if(url.pathname==='/sensa/intake/deliveries/pull'){
   const input=await body() as {libraryId:string};
   if(input.libraryId!==intakeLibraryId){json({code:'library_mismatch'},409);return;}
   const deliveries=[];
   if(remoteDeliveryAvailable&&!remoteAcknowledgement)deliveries.push({deliveryId:REMOTE_OPERATION,libraryId:input.libraryId,queuedAt:REMOTE_QUEUED_AT,submission:remoteSubmission});
   if(remoteIncompleteAvailable&&!remoteIncompleteAcknowledgement)deliveries.push({deliveryId:REMOTE_INCOMPLETE_OPERATION,libraryId:input.libraryId,queuedAt:REMOTE_QUEUED_AT,submission:remoteIncompleteSubmission});
   json({deliveries});return;
  }
  if(url.pathname==='/sensa/intake/deliveries/ack'){
   const input=await body() as any;
   if(input.libraryId!==intakeLibraryId||![REMOTE_OPERATION,REMOTE_INCOMPLETE_OPERATION].includes(input.deliveryId)){json({code:'library_mismatch'},409);return;}
   if(input.deliveryId===REMOTE_OPERATION)remoteAcknowledgement=input;else remoteIncompleteAcknowledgement=input;
   json({contractVersion:'sensa-intake-delivery-v1',deliveryId:input.deliveryId,operationId:input.deliveryId,deliveryState:'applied',queuedAt:REMOTE_QUEUED_AT,appliedAt:input.appliedAt,result:input.result});return;
  }
  if(url.pathname==='/sensa/library-sync'||url.pathname.startsWith('/sensa/library-sync/')){
   await delay(SERVICE_LATENCY_MS);
   const cloud=cloudFor(ACCOUNT);
   if(url.pathname==='/sensa/library-sync/head'){json({revision:cloud.revision,manifest:cloud.manifest});return;}
   if(url.pathname==='/sensa/library-sync/blocks/missing'){
    const input=await body() as {hashes:string[]};
    json({missing:input.hashes.filter(hash=>!cloud.blocks.has(hash))});return;
   }
   if(url.pathname==='/sensa/library-sync/blocks/fetch'){
    const input=await body() as {hashes:string[]};
    const blocks:{hash:string;data:string}[]=[],missing:string[]=[],deferred:string[]=[];let bytes=0;
    for(const hash of input.hashes){const data=cloud.blocks.get(hash);if(data===undefined){missing.push(hash);continue;}const size=Buffer.byteLength(data);if(blocks.length&&bytes+size>librarySyncBlockFetchBytes){deferred.push(hash);continue;}blocks.push({hash,data});bytes+=size;}
    json(deferred.length?{blocks,missing,deferred}:{blocks,missing});return;
   }
   if(url.pathname==='/sensa/library-sync/blocks/store'){
    const input=await body() as {blocks:{hash:string;data:string}[]};
    const chars=input.blocks.reduce((total,block)=>total+block.data.length,0);
    if(chars>librarySyncBlockStoreChars){json({code:'body_too_large'},413);return;}
    for(const block of input.blocks)if(digest(block.data)!==block.hash){json({code:'library_sync_hash'},400);return;}
    for(const block of input.blocks)cloud.blocks.set(block.hash,block.data);
    json({stored:true});return;
   }
   if(url.pathname.startsWith('/sensa/library-sync/blocks/')){
    const hash=url.pathname.slice('/sensa/library-sync/blocks/'.length);
    if(!cloud.blocks.has(hash)){json({code:'library_sync_missing_block'},404);return;}
    json({hash,data:cloud.blocks.get(hash)});return;
   }
   if(url.pathname==='/sensa/library-sync/commit'){
    const input=await body() as {operationId:string;baseRevision:number;manifest:string[]};
    const prior=cloud.commits.get(input.operationId);
    if(prior){json({revision:Number(prior),manifest:input.manifest});return;}
    if(cloud.revision!==input.baseRevision){json({code:'library_sync_conflict'},409);return;}
   if(input.manifest.some(hash=>!cloud.blocks.has(hash))){json({code:'library_sync_missing_block'},409);return;}
    const priorManifest=cloud.manifest?[...cloud.manifest]:[],priorRows=priorManifest.length?(JSON.parse(priorManifest.map(hash=>cloud.blocks.get(hash)!).join('')) as {rows:{blocks:string[]}[]}).rows:[];
    cloud.revision+=1;cloud.manifest=input.manifest;cloud.commits.set(input.operationId,String(cloud.revision));
    // The committed manifest is the account baseline: it defines the restore cost.
    const committed=JSON.parse(cloud.blocks.get(input.manifest[0]!)??'{"rows":[]}') as {rows:{blocks:string[]}[]};
    const publishedRefs=[...new Set(committed.rows.flatMap(row=>row.blocks))];
    cloud.published=publishedRefs.length;
    cloud.publishedBytes=publishedRefs.reduce((total,hash)=>total+Buffer.byteLength(cloud.blocks.get(hash)??''),0);
    const keep=new Set([...input.manifest,...publishedRefs]);for(const hash of [...new Set([...priorManifest,...priorRows.flatMap(row=>row.blocks)])])if(!keep.has(hash))cloud.blocks.delete(hash);
    json({revision:cloud.revision,manifest:cloud.manifest});return;
   }
   json({code:'not_found'},404);return;
  }
  if(url.pathname==='/sensa/service/status'){json({authorized:true,explanationAvailable:true,checkedAt:new Date().toISOString(),windowHours:24,usage:[{kind:'reading',used:0,limit:null},{kind:'teacher',used:0,limit:null},{kind:'content',used:0,limit:null}]});return;}
 if(url.pathname==='/sensa/packages'){json({items:[]});return;}
  if(url.pathname.startsWith('/sensa/')){json({code:'not_found'},404);return;}
  const path=join(dist,url.pathname);
  const file=path.startsWith(dist)&&extname(path)?path:join(dist,'index.html');
  try{
   const bytes=await readFile(file);
   response.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream','content-security-policy':productionCsp});
   response.end(bytes);
  }catch{
   const bytes=await readFile(join(dist,'index.html'));
   response.writeHead(200,{'content-type':'text/html','content-security-policy':productionCsp});
   response.end(bytes);
  }
 }catch(error){json({code:'fixture_error',message:error instanceof Error?error.message:'unknown'},500);}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const storageKey=`sb-${new URL(origin).hostname.split('.')[0]}${storageKeySuffix}`;

const browser=await chromium.launch({headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH});
/** Seed the Supabase session exactly where the production client reads it. */
const session=()=>({access_token:jwt(3600),token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'fixture-refresh-token',user:{id:SUBJECT,aud:'authenticated',role:'authenticated',email:'fixture@sensa.invalid',app_metadata:{},user_metadata:{},identities:[],created_at:new Date().toISOString()}});
async function instrument(page:import('@playwright/test').Page,authenticated:boolean){
 const errors:string[]=[];
 page.on('console',message=>{const text=message.text();if(message.type()==='error'&&!text.includes('favicon.ico'))errors.push('console: '+text);});
 page.on('pageerror',error=>errors.push('pageerror: '+error.message));
 await page.addInitScript(({key,value,authenticated})=>{
  (window as any).__name=(fn:unknown)=>fn;
  if(authenticated)localStorage.setItem(key,JSON.stringify(value));
  (window as any).__cspViolations=[];
  document.addEventListener('securitypolicyviolation',event=>{(window as any).__cspViolations.push(JSON.stringify({directive:(event as any).violatedDirective,blocked:(event as any).blockedURI,source:(event as any).sourceFile,line:(event as any).lineNumber,sample:(event as any).sample}));});
 },{key:storageKey,value:session(),authenticated});
 return errors;
}
async function pageContext(authenticated=true){
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const page=await context.newPage();
 const errors=await instrument(page,authenticated);
 return {context,page,errors};
}
const assertApplicationShell=async(page:import('@playwright/test').Page)=>{
 const shell=page.locator('[data-sensa-page-layout="application-shell"][data-sensa-layout-mode="viewport"]');
 await expect(shell).toBeVisible({timeout:SHELL_BUDGET_MS});
 const regions=await shell.locator(':scope > [data-sensa-page-region]').evaluateAll(
  elements=>elements.map(element=>element.getAttribute('data-sensa-page-region')),
 );
 assert.deepEqual(regions,[...pageLayoutFamilyContract['application-shell'].logicalOrder],'production WebShell changed application-shell region order');
 assert.equal(await shell.locator(':scope > [data-sensa-page-region="navigation"] nav').count(),1,'production WebShell duplicated primary navigation');
};
/** Read the durable restore state through the production LibraryTransaction seam. */
const restoreStatus=(page:import('@playwright/test').Page)=>page.evaluate(
 ()=>window.__sensaBrowserSmoke?.syncStatus()??Promise.resolve('unavailable'),
);
const finishCheckpoint=async(page:import('@playwright/test').Page,message:string)=>{
 for(let attempt=0;attempt<3;attempt++){
  if(await restoreStatus(page)==='synced')return;
  const completed=await page.evaluate(()=>new Promise<boolean>(resolve=>{let timer:ReturnType<typeof setTimeout>;const done=()=>{clearTimeout(timer);resolve(true);};window.addEventListener('sensa-account-library-sync-finished',done,{once:true});window.dispatchEvent(new Event('sensa-cloud-checkpoint-requested'));timer=setTimeout(()=>{window.removeEventListener('sensa-account-library-sync-finished',done);resolve(false);},90000);}));
  assert(completed,message+' did not finish a sync pass');
 }
 assert.equal(await restoreStatus(page),'synced',message);
};

try{
 await rm(output,{recursive:true,force:true});
 await mkdir(dist,{recursive:true});
 log('1/4 building the real Web bundle against the fixture origin');
 execFileSync('npm',['run','build','-w','@sensa/web','--','--outDir',dist,'--emptyOutDir'],{cwd:root,env:{...process.env,VITE_SENSA_MODE:'production',VITE_SENSA_BROWSER_SMOKE:'true',VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable-key',VITE_SENSA_API_URL:origin},stdio:'inherit'});
 for(const name of ['SKILL.md','request-example.json']){
  assert.deepEqual(
   await readFile(join(dist,'integrations',name)),
   await readFile(join(root,'integrations/codex/sensa-intake',name)),
   `the Web release drifted from the reviewed Agent integration ${name}`,
  );
 }
 assert.match(await readFile(join(dist,'integrations','sensa-mcp.mjs'),'utf8'),/^#!\/usr\/bin\/env node/u,'the Web release does not contain the executable MCP adapter');

 const landing=await pageContext(false);
 await landing.page.goto(origin+'/welcome',{waitUntil:'domcontentloaded'});
 await expect(landing.page.locator('#landing-title')).toBeVisible({timeout:SHELL_BUDGET_MS});
 assert.deepEqual(landing.errors,[],'the explicit welcome route emitted a browser error');
 await landing.context.close();

 const missing=await pageContext(false);
 await missing.page.goto(origin+'/not-a-screen',{waitUntil:'domcontentloaded'});
 await expect(missing.page.locator('[data-sensa-product-recovery="not_found"]')).toBeVisible({timeout:SHELL_BUDGET_MS});
 await expect(missing.page.getByLabel('邮箱',{exact:true})).toHaveCount(0);
 assert.deepEqual(missing.errors,[],'the product not-found route emitted a browser error');
 await missing.context.close();

 log('2/4 creating a durable account library through the local library commands');
 const a=await pageContext(false);
 const created=await a.page.goto(origin,{waitUntil:'domcontentloaded'});
 assert(created?.ok(),'Web bundle did not serve');
 await expect.poll(()=>a.page.evaluate(()=>!!window.__sensaBrowserSmoke),{timeout:SHELL_BUDGET_MS}).toBe(true);
 assert.deepEqual(
  await a.page.evaluate(()=>window.__sensaBrowserSmoke!.transactionConcurrency()),
  {readersOverlap:true,writerWaited:true},
  'local read transactions did not share the Web Lock or a writer crossed an active reader',
 );
 const written=await a.page.evaluate(
  ({drafts,images})=>window.__sensaBrowserSmoke!.seedDrafts(drafts,images),
  {drafts:DRAFTS,images:IMAGES_PER_DRAFT},
 );
 assert.equal(written,DRAFTS,'local library did not persist the fixture content');
 await a.page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:session()});
 await a.page.reload({waitUntil:'domcontentloaded'});
 try{await expect(a.page.getByRole('navigation').first()).toBeVisible({timeout:SHELL_BUDGET_MS});}
 catch(error){log('   phase A startup calls: '+JSON.stringify(served));log('   phase A startup rejected: '+JSON.stringify(rejected));log('   phase A startup console: '+JSON.stringify(a.errors));throw error;}
 await assertApplicationShell(a.page);
 assert.equal(await a.page.locator('.screen').count(),1,'unrelated product screens mounted behind Home');
 await a.page.setViewportSize({width:1280,height:480});
 const homeScroll=await a.page.locator('#s-home').evaluate(element=>{
  element.scrollTop=Math.min(160,element.scrollHeight-element.clientHeight);
  return element.scrollTop;
 });
 assert(homeScroll>0,'Home fixture must be scrollable to exercise explicit restoration');
 await a.page.locator('[data-sensa-shell-utility-action]').click();
 await expect(a.page.locator('#s-profile')).toBeVisible({timeout:SHELL_BUDGET_MS});
 assert((await a.page.locator('.screen').count())<=2,'ScreenHost mounted more than current plus outgoing');
 await expect.poll(()=>a.page.locator('.screen').count(),{timeout:SHELL_BUDGET_MS,message:'the outgoing Home screen did not unmount'}).toBe(1);
 await a.page.locator('[data-sensa-shell-brand-action]').click();
 await expect(a.page.locator('#s-profile')).toHaveCount(0);
 await expect(a.page.locator('#s-home')).toBeVisible({timeout:SHELL_BUDGET_MS});
 assert.equal(await a.page.locator('.screen').count(),1,'leaving a sheet should unmount its effects');
 const restoredHomeScroll=await a.page.locator('#s-home').evaluate(element=>({
  actual:element.scrollTop,
  maximum:element.scrollHeight-element.clientHeight,
 }));
 const expectedHomeScroll=Math.min(homeScroll,restoredHomeScroll.maximum);
 // A live sync-status row may settle during the round trip and move the clamp
 // by one text line; the restored page must still remain at the same region.
 assert(restoredHomeScroll.actual>0&&expectedHomeScroll-restoredHomeScroll.actual<=32,'back navigation did not restore the Home scroll position');
 await a.page.setViewportSize({width:1280,height:900});
 const cloud=cloudFor(ACCOUNT);
 // Uploaded blocks are not a published library: wait for the committed manifest,
 // otherwise the next browser legitimately restores an empty account.
 await expect.poll(()=>cloud.published,{timeout:180000,message:'account library was never published'}).toBeGreaterThanOrEqual(MINIMUM_PUBLISHED_BLOCKS);
 await expect.poll(()=>restoreStatus(a.page),{timeout:30000,message:'source account library never converged'}).toBe('synced');
 const competing=await a.context.newPage();
 await competing.addInitScript(()=>{(window as any).__name=(fn:unknown)=>fn;});
 await competing.goto(origin,{waitUntil:'domcontentloaded'});
 await expect.poll(()=>competing.evaluate(()=>!!window.__sensaBrowserSmoke),{timeout:SHELL_BUDGET_MS}).toBe(true);
 assert.equal(await competing.evaluate(()=>window.__sensaBrowserSmoke!.draftCount()),DRAFTS,'a follower tab did not read through the OPFS owner');
 const crossTabBaseRevision=cloud.revision;
 assert.equal(await competing.evaluate(()=>window.__sensaBrowserSmoke!.seedDrafts(1,0)),TOTAL_DRAFTS,'a follower tab did not commit through the OPFS owner');
 await expect.poll(()=>a.page.evaluate(()=>window.__sensaBrowserSmoke!.draftCount()),{timeout:SHELL_BUDGET_MS,message:'the owner tab did not observe the follower commit'}).toBe(TOTAL_DRAFTS);
 await expect.poll(()=>cloud.revision,{timeout:30000,message:'the cross-tab commit was not checkpointed'}).toBeGreaterThan(crossTabBaseRevision);
 await expect.poll(()=>restoreStatus(a.page),{timeout:30000,message:'the cross-tab commit never converged'}).toBe('synced');
 await a.page.close();
 assert.equal(await competing.evaluate(()=>window.__sensaBrowserSmoke!.draftCount()),TOTAL_DRAFTS,'the follower did not take ownership after the leader closed');
 await competing.close();
 log(`   durable account library: ${cloud.published} published blocks / ${Math.round(cloud.publishedBytes/1024)}KiB, revision ${cloud.revision}`);
 await a.context.close();

 // Clicking login in the extension is already an explicit authorization intent.
 // A Web session that exists must exchange it automatically after account admission;
 // the 12-second admission delay may show progress, but never another login form.
 const authorizationPage=await pageContext();
 const redirectUri='https://'+'a'.repeat(32)+'.chromiumapp.org/sensa',state='s'.repeat(64),challenge='c'.repeat(43);
 const authorizationUrl=new URL('/profile',origin);authorizationUrl.searchParams.set('extension','connect');authorizationUrl.searchParams.set('installationId','7df2fd62-cfd9-4708-a696-2f20e8246671');authorizationUrl.searchParams.set('state',state);authorizationUrl.searchParams.set('challenge',challenge);authorizationUrl.searchParams.set('redirectUri',redirectUri);
 await authorizationPage.page.goto(authorizationUrl.href,{waitUntil:'domcontentloaded'});
 await expect(authorizationPage.page.getByRole('status')).toContainText('正在连接',{timeout:SHELL_BUDGET_MS});
 await expect(authorizationPage.page.getByLabel('邮箱',{exact:true})).toHaveCount(0);
 await expect.poll(()=>extensionAuthorization,{timeout:30000,message:'an existing Web session did not authorize the extension'}).toMatchObject({state,challenge,redirectUri});
 await authorizationPage.context.close();extensionAuthorization=null;

 // The account may have been published by the previous client, whose blocks were 32K.
 // Restoring such a library must still be a byte-bounded number of requests.
 repackCloud(cloud,32768);
 const legacyPublished=cloud.published,legacyPublishedBytes=cloud.publishedBytes,legacyRevision=cloud.revision;
 assert(legacyPublishedBytes>=MINIMUM_LEGACY_BYTES,`legacy fixture is only ${legacyPublishedBytes} bytes`);
 log(`   legacy-shaped library: ${legacyPublished} blocks / ${Math.round(legacyPublishedBytes/1024)}KiB, revision ${legacyRevision}`);

 log('3/4 measuring the first restore on a new browser');
 // The complete Agent save exists before any Sensa Web page is open. It must
 // remain queued until this new page restores the local authority and applies it.
 remoteDeliveryAvailable=true;
 assert.equal(remoteAcknowledgement,null,'a closed Web application cannot claim an Agent delivery was applied');
 const b=await pageContext();
 served.length=0;
 const started=Date.now();
 await b.page.goto(origin,{waitUntil:'domcontentloaded'});
 await expect(b.page.getByRole('navigation').first()).toBeVisible({timeout:SHELL_BUDGET_MS});
 await assertApplicationShell(b.page);
 const shellMs=Date.now()-started;
 await expect(b.page.getByText('正在同步你的学习数据…')).toHaveCount(0);
 await expect(b.page.getByText('远程投递暂未送达本机。内容仍保留在投递队列中；联网后重新聚焦应用即可重试。')).toHaveCount(0);
 await expect(b.page.getByText('正在恢复账号资料…')).toBeVisible();
 assert.deepEqual(await b.page.locator('.sensa-today-counts strong').allTextContents(),['—','—'],'a new device must not present local zeroes as account truth while restore is pending');
 await expect(b.page.locator('.sensa-today-empty')).toHaveCount(0);
 try{await expect.poll(async()=>({drafts:await b.page.evaluate(()=>window.__sensaBrowserSmoke!.draftCount()),normalized:cloud.revision>legacyRevision}),{timeout:RESTORE_BUDGET_MS,message:'account restore never finished'}).toEqual({drafts:TOTAL_DRAFTS,normalized:true});}
 catch(error){log('   restore calls before timeout: '+JSON.stringify(served));log('   restore rejected: '+JSON.stringify(rejected));log('   phase B console: '+JSON.stringify(b.errors.slice(0,12)));throw error;}
 await expect(b.page.getByText('正在恢复账号资料…')).toHaveCount(0);
 const restoreMs=Date.now()-started;
 const normalizedRevision=cloud.revision,normalizedPublished=cloud.published,normalizedPhysicalBytes=[...cloud.blocks.values()].reduce((total,data)=>total+Buffer.byteLength(data),0);
 await finishCheckpoint(b.page,'post-restore local facts never reached a Checkpoint');
 const restoreSettledRevision=cloud.revision;
 await b.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect.poll(()=>remoteAcknowledgement?.result?.route,{timeout:30000,message:'remote Intake was not applied and acknowledged'}).toBe('fast_track');
 await finishCheckpoint(b.page,'Agent Intake was not published after its local commit');
 remoteIncompleteAvailable=true;
 await b.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect.poll(()=>remoteIncompleteAcknowledgement?.result?.route,{timeout:30000,message:'incomplete remote Intake was not routed to the Inbox'}).toBe('inbox');
 assert.equal(remoteIncompleteAcknowledgement.result.status,'pending_sense');
 await finishCheckpoint(b.page,'incomplete Agent Intake was not published after its Inbox commit');
 /** Wait until the application stops talking to the account service on its own. */
 const settle=async():Promise<boolean>=>{
  const limit=Date.now()+30000;
  for(let quiet=0;quiet<3;){
   if(Date.now()>limit)return false;
   const before=served.length;
   await b.page.waitForTimeout(1000);
   if(served.length===before)quiet+=1;else quiet=0;
  }
  return true;
 };
 const settled=await settle();
 const remotePublishedRevision=cloud.revision;
 const bootRequests=[...served];
 // A later focus may check the independent Intake mailbox, but a fresh account
 // Checkpoint must not read the entire cloud library again.
 served.length=0;
 await b.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await b.page.waitForTimeout(2500);
 const repeatSettled=await settle();
 const repeatRequests=[...served],repeatFetches=repeatRequests.filter(entry=>entry.path==='/sensa/library-sync/blocks/fetch');
 // An idle signed-in tab must not poll the account service. The log is cleared so the
 // quiet window below observes only activity that the untouched application starts.
 served.length=0;
 await b.page.waitForTimeout(IDLE_WINDOW_MS);
 const idleRequests=[...served];
 const requests=bootRequests.filter(entry=>entry.path.startsWith('/sensa/library-sync/'));
 const fetchRequests=requests.filter(entry=>entry.path==='/sensa/library-sync/blocks/fetch');
 /** Restore fetch round trips follow legacy bytes, not how many blocks hold them. */
 const fetchRequestBudget=Math.ceil(legacyPublishedBytes/librarySyncBlockFetchBytes)+2;
 const restored=await b.page.evaluate(()=>window.__sensaBrowserSmoke!.draftCount());
 const remoteMeaning=await b.page.evaluate(
  ()=>window.__sensaBrowserSmoke!.semanticWorldContainsExpression('back out'),
 );
 const remoteInboxCount=await b.page.evaluate(()=>window.__sensaBrowserSmoke!.intakeInboxCount());
 const storageDiagnostics=await b.page.evaluate(
  ()=>window.__sensaBrowserSmoke!.storageDiagnostics(),
 );
 const violations=await b.page.evaluate(()=>(window as any).__cspViolations as string[]);
 await b.context.close();

 log(`   App Shell interactive ${shellMs}ms (budget ${SHELL_BUDGET_MS}ms)`);
 log(`   account restore ${restoreMs}ms over ${requests.length} library requests / ${fetchRequests.length} block fetches (fetch budget ${fetchRequestBudget})`);
 log(`   canonicalized library: ${cloud.published} blocks / ${Math.round(normalizedPhysicalBytes/1024)}KiB physical, revision ${cloud.revision}`);
 log(`   next focus: ${repeatRequests.length} account requests / ${repeatFetches.length} library block fetches`);
 log(`   restored drafts ${restored}/${TOTAL_DRAFTS}`);
 log(`   local storage ${storageDiagnostics.engine}/${storageDiagnostics.persistence} SQLite ${storageDiagnostics.sqliteVersion}`);
 log(`   remote Intake ${remoteAcknowledgement?.result?.route??'missing'} / ${remoteMeaning?'stored':'missing'}; incomplete ${remoteIncompleteAcknowledgement?.result?.route??'missing'} / Inbox ${remoteInboxCount}`);
 log(`   boot service calls: ${JSON.stringify([...new Set(bootRequests.map(entry=>entry.path))])}`);
 log(`   idle ${IDLE_WINDOW_MS}ms service calls: ${idleRequests.length}`);
 const fail=(message:string)=>failures.push(message);
 if(rejected.length)log('   fixture rejected: '+JSON.stringify(rejected.slice(0,8)));
 if(a.errors.length)log('   phase A console: '+JSON.stringify(a.errors.slice(0,5)));
 if(b.errors.length)log('   phase B console: '+JSON.stringify(b.errors.slice(0,5)));
 if(violations.length)log('   CSP: '+JSON.stringify(violations.slice(0,4)));
 if(shellMs>SHELL_BUDGET_MS)fail(`App Shell waited for the account restore: ${shellMs}ms > ${SHELL_BUDGET_MS}ms`);
 if(restoreMs>RESTORE_BUDGET_MS)fail(`account restore exceeded its budget: ${restoreMs}ms > ${RESTORE_BUDGET_MS}ms`);
 if(fetchRequests.length>fetchRequestBudget)fail(`account restore used ${fetchRequests.length} block fetches, budget ${fetchRequestBudget} for ${legacyPublished} legacy blocks (${[...new Set(requests.map(entry=>entry.path))].join(', ')})`);
 if(normalizedRevision!==legacyRevision+1)fail(`legacy layout was not normalized exactly once: revision ${legacyRevision} -> ${normalizedRevision}`);
 if(normalizedPublished>=legacyPublished)fail(`legacy ${legacyPublished}-block layout was not replaced by the canonical layout (${normalizedPublished} blocks)`);
 if(normalizedPhysicalBytes>=legacyPublishedBytes/4)fail(`retired legacy blocks still occupy ${normalizedPhysicalBytes} bytes after canonicalization`);
 if(remotePublishedRevision<=restoreSettledRevision)fail(`remote Agent Intake was not published: revision ${restoreSettledRevision} -> ${remotePublishedRevision}`);
 if(!repeatSettled)fail('the focus-triggered verification sync never settled');
 if(repeatFetches.length)fail(`a later focus re-fetched canonicalized account blocks ${repeatFetches.length} time(s)`);
 if(repeatRequests.some(entry=>entry.path.startsWith('/sensa/library-sync/')))fail('a fresh foreground return started an unnecessary whole-library sync');
 if(restored!==TOTAL_DRAFTS)fail(`account restore lost content: ${restored}/${TOTAL_DRAFTS} drafts`);
 if(storageDiagnostics.engine!=='sqlite-wasm'||storageDiagnostics.persistence!=='opfs')fail(`production browser did not use SQLite OPFS: ${JSON.stringify(storageDiagnostics)}`);
 if(storageDiagnostics.journalMode!=='wal'||storageDiagnostics.synchronous!==2||storageDiagnostics.lockingMode!=='exclusive')fail(`production browser did not use the reviewed WAL/FULL/EXCLUSIVE profile: ${JSON.stringify(storageDiagnostics)}`);
 if(!remoteMeaning)fail('the remote Agent Intake was acknowledged without a local Personal Meaning');
 if(remoteIncompleteAcknowledgement?.result?.route!=='inbox'||remoteInboxCount<1)fail('an incomplete Agent Intake did not remain in the local Inbox');
 if(bootRequests.some(entry=>entry.path==='/sensa/service/status'))fail('rolling service counters are read on boot instead of on demand');
 if(!settled)fail('an untouched account never stopped syncing: sync bookkeeping keeps scheduling another pass');
 if(idleRequests.length)fail(`an untouched tab made ${idleRequests.length} service calls: ${[...new Set(idleRequests.map(entry=>entry.path))].join(', ')}`);
 for(const error of [...a.errors,...b.errors])fail(error);
 for(const violation of violations)fail('CSP violation: '+violation);

 log('4/4 result');
 assert.deepEqual(failures,[],'boot budget violations:\n'+failures.join('\n'));
 console.log(`PASS: App Shell stays local-first (${shellMs}ms) while a ${legacyPublished}-block legacy account restores in ${restoreMs}ms; the next focus performs ${repeatFetches.length} block fetches`);
}finally{
 await browser.close();
 await new Promise<void>(resolve=>server.close(()=>resolve()));
}
