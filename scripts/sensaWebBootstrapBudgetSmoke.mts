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
import {build as esbuild} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {librarySyncBlockFetchBytes,librarySyncBlockStoreChars} from '../packages/contracts/src/sensa/librarySync.ts';

const root=process.cwd();
const output=resolve(root,'.tmp/web-bootstrap-budget');
const dist=join(output,'dist');
/** Deliberately slower than a healthy edge request, so a blocked shell is obvious. */
const SERVICE_LATENCY_MS=1500;
const SHELL_BUDGET_MS=6000;
/** An untouched, already-restored tab must not talk to the account service at all. */
const IDLE_WINDOW_MS=9000;
const RESTORE_BUDGET_MS=90000;
/** The fixture library only has to be heavy enough that per-block requests are fatal. */
const MINIMUM_PUBLISHED_BLOCKS=20;
const DRAFTS=8,IMAGES_PER_DRAFT=4;
const SUBJECT='8b1f4c1e-9d5a-4c34-9c3a-9f1d0d1a1c11';
const ACCOUNT='4f2a7b60-1c6e-4a52-8f0b-6d3c2a9e5b21';
const storageKeySuffix='-auth-token';
const failures:string[]=[];
const log=(message:string)=>console.log(message);

function jwt(expSeconds:number){const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');return [encode({alg:'HS256',typ:'JWT'}),encode({sub:SUBJECT,aud:'authenticated',email:'fixture@sensa.invalid',session_id:randomUUID(),exp:Math.floor(Date.now()/1000)+expSeconds,amr:[{method:'otp',timestamp:Math.floor(Date.now()/1000)}]}),'fixture-signature'].join('.');}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');

type Cloud={blocks:Map<string,string>;revision:number;manifest:string[]|null;commits:Map<string,string>;published:number;publishedBytes:number};
const clouds=new Map<string,Cloud>();
const cloudFor=(account:string):Cloud=>{const existing=clouds.get(account);if(existing)return existing;const created:Cloud={blocks:new Map(),revision:0,manifest:null,commits:new Map(),published:0,publishedBytes:0};clouds.set(account,created);return created;};
/** Repack a published library into smaller blocks, the way the previous client stored it.
 *  Restoring it must still cost a byte-bounded number of round trips. */
const repackCloud=(cloud:Cloud,chars:number)=>{
 if(!cloud.manifest)throw Error('nothing to repack');
 const manifest=JSON.parse(cloud.blocks.get(cloud.manifest[0]!)!) as {rows:{table:string;key:string;blocks:string[]}[]};
 const added=new Map<string,string>(),rows:{table:string;key:string;blocks:string[]}[]=[];
 for(const row of manifest.rows){
  const text=row.blocks.map(hash=>cloud.blocks.get(hash)!).join(''),refs:string[]=[];
  for(let at=0;at<text.length;at+=chars){const part=text.slice(at,at+chars),hash=digest(part);added.set(hash,part);refs.push(hash);}
  rows.push({table:row.table,key:row.key,blocks:refs.length?refs:[digest('')]});
  if(!refs.length)added.set(digest(''),'');
 }
 const next=JSON.stringify({...manifest,rows}),nextHash=digest(next);
 added.set(nextHash,next);
 for(const [hash,data] of added)cloud.blocks.set(hash,data);
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

const core=await esbuild({stdin:{contents:["import {z} from 'zod';z.config({jitless:true});","export * from './apps/web/src/data/library/store';","export * from './apps/web/src/data/library/drafts';"].join('\n'),resolveDir:root},bundle:true,format:'esm',write:false,define:{'import.meta.env':'{}'}});
const coreSource=core.outputFiles[0]!.text;
const types:Record<string,string>={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg','.woff2':'font/woff2','.ico':'image/x-icon'};

let origin='';
const served:{path:string;method:string}[]=[],rejected:{path:string;status:number;body:string}[]=[];
const server=createServer(async(request,response)=>{
 const url=new URL(request.url??'/',origin||'http://127.0.0.1');
 const json=(value:unknown,status=200)=>{if(status>=400)rejected.push({path:url.pathname,status,body:JSON.stringify(value)});response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
 const body=async()=>{const parts:Buffer[]=[];for await(const part of request)parts.push(Buffer.from(part));return parts.length?JSON.parse(Buffer.concat(parts).toString('utf8')):{};};
 try{
  // Every application service call is recorded, so an idle tab can assert "no requests".
  if(url.pathname.startsWith('/sensa/')||url.pathname.startsWith('/auth/'))served.push({path:url.pathname,method:request.method??'GET'});
  if(url.pathname==='/core.js'){response.writeHead(200,{'content-type':'text/javascript','cache-control':'no-store'});response.end(coreSource);return;}
  if(url.pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
  if(url.pathname==='/auth/v1/user'){json({id:SUBJECT,aud:'authenticated',email:'fixture@sensa.invalid',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()});return;}
  if(url.pathname==='/sensa/web/access/session'){json({authorized:true,accountId:ACCOUNT});return;}
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
    cloud.revision+=1;cloud.manifest=input.manifest;cloud.commits.set(input.operationId,String(cloud.revision));
    // The committed manifest is the account baseline: it defines the restore cost.
    const committed=JSON.parse(cloud.blocks.get(input.manifest[0]!)??'{"rows":[]}') as {rows:{blocks:string[]}[]};
    const publishedRefs=[...new Set(committed.rows.flatMap(row=>row.blocks))];
    cloud.published=publishedRefs.length;
    cloud.publishedBytes=publishedRefs.reduce((total,hash)=>total+Buffer.byteLength(cloud.blocks.get(hash)??''),0);
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
async function instrument(page:import('@playwright/test').Page){
 const errors:string[]=[];
 page.on('console',message=>{const text=message.text();if(message.type()==='error'&&!text.includes('favicon.ico'))errors.push('console: '+text);});
 page.on('pageerror',error=>errors.push('pageerror: '+error.message));
 await page.addInitScript(({key,value})=>{
  (window as any).__name=(fn:unknown)=>fn;
  localStorage.setItem(key,JSON.stringify(value));
  (window as any).__cspViolations=[];
  document.addEventListener('securitypolicyviolation',event=>{(window as any).__cspViolations.push(JSON.stringify({directive:(event as any).violatedDirective,blocked:(event as any).blockedURI,source:(event as any).sourceFile,line:(event as any).lineNumber,sample:(event as any).sample}));});
 },{key:storageKey,value:session()});
 return errors;
}
async function pageContext(){
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const page=await context.newPage();
 const errors=await instrument(page);
 return {context,page,errors};
}
/** Read the durable restore state the application itself writes. */
const restoreStatus=(page:import('@playwright/test').Page)=>page.evaluate(()=>new Promise<string>(resolve=>{
 const open=indexedDB.open('sensa:local-library:v1');
 open.onerror=()=>resolve('unavailable');
 open.onsuccess=()=>{const db=open.result;if(!db.objectStoreNames.contains('meta')){resolve('empty');return;}const request=db.transaction('meta','readonly').objectStore('meta').get('cloud-sync');request.onerror=()=>resolve('unavailable');request.onsuccess=()=>(request.result as {status?:string}|undefined)?.status?resolve((request.result as {status:string}).status):resolve('none');};
}));

try{
 await rm(output,{recursive:true,force:true});
 await mkdir(dist,{recursive:true});
 log('1/4 building the real Web bundle against the fixture origin');
 execFileSync('npm',['run','build','-w','@sensa/web','--','--outDir',dist,'--emptyOutDir'],{cwd:root,env:{...process.env,VITE_SENSA_MODE:'production',VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable-key',VITE_SENSA_API_URL:origin},stdio:'inherit'});

 log('2/4 creating a durable account library through the local library commands');
 const a=await pageContext();
 const created=await a.page.goto(origin,{waitUntil:'domcontentloaded'});
 assert(created?.ok(),'Web bundle did not serve');
 await expect(a.page.getByRole('navigation').first()).toBeVisible({timeout:SHELL_BUDGET_MS});
 const written=await a.page.evaluate(async({drafts,images})=>{
  const core=await import(/* @vite-ignore */ '/core.js') as any;
  const random=(size:number)=>{const bytes=new Uint8Array(size);for(let at=0;at<size;at+=65536)crypto.getRandomValues(bytes.subarray(at,Math.min(size,at+65536)));let binary='';for(let at=0;at<size;at+=3000)binary+=String.fromCharCode(...bytes.subarray(at,Math.min(size,at+3000)));return btoa(binary);};
  await core.openLibrary();
  for(let index=0;index<drafts;index++){
   await core.saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'fixture context '+index,images:Array.from({length:images},(_,image)=>({id:crypto.randomUUID(),name:`fixture-${index}-${image}.jpg`,dataUrl:'data:image/jpeg;base64,'+random(180000)}))});
  }
  return (await core.listDrafts()).length;
 },{drafts:DRAFTS,images:IMAGES_PER_DRAFT});
 assert.equal(written,DRAFTS,'local library did not persist the fixture content');
 const cloud=cloudFor(ACCOUNT);
 // Uploaded blocks are not a published library: wait for the committed manifest,
 // otherwise the next browser legitimately restores an empty account.
 await expect.poll(()=>cloud.published,{timeout:180000,message:'account library was never published'}).toBeGreaterThanOrEqual(MINIMUM_PUBLISHED_BLOCKS);
 log(`   durable account library: ${cloud.published} published blocks / ${Math.round(cloud.publishedBytes/1024)}KiB, revision ${cloud.revision}`);
 await a.context.close();

 // The account may have been published by the previous client, whose blocks were 32K.
 // Restoring such a library must still be a byte-bounded number of requests.
 repackCloud(cloud,32768);
 log(`   legacy-shaped library: ${cloud.published} blocks / ${Math.round(cloud.publishedBytes/1024)}KiB, revision ${cloud.revision}`);

 log('3/4 measuring the first restore on a new browser');
 const b=await pageContext();
 served.length=0;
 const started=Date.now();
 await b.page.goto(origin,{waitUntil:'domcontentloaded'});
 await expect(b.page.getByRole('navigation').first()).toBeVisible({timeout:SHELL_BUDGET_MS});
 const shellMs=Date.now()-started;
 await expect(b.page.getByText('正在同步你的学习数据…')).toBeVisible({timeout:SHELL_BUDGET_MS});
 await expect.poll(()=>restoreStatus(b.page),{timeout:RESTORE_BUDGET_MS,message:'account restore never finished'}).toBe('synced');
 const restoreMs=Date.now()-started;
 const bootRequests=[...served];
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
 // An idle signed-in tab must not poll the account service. The log is cleared so the
 // quiet window below observes only activity that the untouched application starts.
 served.length=0;
 await b.page.waitForTimeout(IDLE_WINDOW_MS);
 const idleRequests=[...served];
 const requests=bootRequests.filter(entry=>entry.path.startsWith('/sensa/library-sync/'));
 /** Restoring `n` blocks costs the head call, the manifest page and the block pages. */
 /** Restore round trips follow published bytes, not how many blocks hold them. */
 const restoreRequestBudget=Math.ceil(cloud.publishedBytes/librarySyncBlockFetchBytes)+3;
 const restored=await b.page.evaluate(async()=>{const core=await import(/* @vite-ignore */ '/core.js') as any;return (await core.listDrafts()).length;});
 const violations=await b.page.evaluate(()=>(window as any).__cspViolations as string[]);
 await b.context.close();

 log(`   App Shell interactive ${shellMs}ms (budget ${SHELL_BUDGET_MS}ms)`);
 log(`   account restore ${restoreMs}ms over ${requests.length} library requests (budget ${restoreRequestBudget})`);
 log(`   restored drafts ${restored}/${DRAFTS}`);
 log(`   boot service calls: ${JSON.stringify([...new Set(bootRequests.map(entry=>entry.path))])}`);
 log(`   idle ${IDLE_WINDOW_MS}ms service calls: ${idleRequests.length}`);
 const fail=(message:string)=>failures.push(message);
 if(rejected.length)log('   fixture rejected: '+JSON.stringify(rejected.slice(0,8)));
 if(a.errors.length)log('   phase A console: '+JSON.stringify(a.errors.slice(0,5)));
 if(b.errors.length)log('   phase B console: '+JSON.stringify(b.errors.slice(0,5)));
 if(violations.length)log('   CSP: '+JSON.stringify(violations.slice(0,4)));
 if(shellMs>SHELL_BUDGET_MS)fail(`App Shell waited for the account restore: ${shellMs}ms > ${SHELL_BUDGET_MS}ms`);
 if(restoreMs>RESTORE_BUDGET_MS)fail(`account restore exceeded its budget: ${restoreMs}ms > ${RESTORE_BUDGET_MS}ms`);
 if(requests.length>restoreRequestBudget)fail(`account restore used ${requests.length} library requests, budget ${restoreRequestBudget} for ${cloud.published} blocks (${[...new Set(requests.map(entry=>entry.path))].join(', ')})`);
 if(requests.filter(entry=>entry.path.includes('/blocks/')).length>Math.ceil(cloud.publishedBytes/librarySyncBlockFetchBytes)+2)fail('block transfer is not byte-batched: one request per block');
 if(restored!==DRAFTS)fail(`account restore lost content: ${restored}/${DRAFTS} drafts`);
 if(bootRequests.some(entry=>entry.path==='/sensa/service/status'))fail('rolling service counters are read on boot instead of on demand');
 if(!settled)fail('an untouched account never stopped syncing: sync bookkeeping keeps scheduling another pass');
 if(idleRequests.length)fail(`an untouched tab made ${idleRequests.length} service calls: ${[...new Set(idleRequests.map(entry=>entry.path))].join(', ')}`);
 for(const error of [...a.errors,...b.errors])fail(error);
 for(const violation of violations)fail('CSP violation: '+violation);

 log('4/4 result');
 assert.deepEqual(failures,[],'boot budget violations:\n'+failures.join('\n'));
 console.log(`PASS: App Shell stays local-first (${shellMs}ms) while a ${cloud.published}-block account restore completes in ${restoreMs}ms over ${requests.length} requests`);
}finally{
 await browser.close();
 await new Promise<void>(resolve=>server.close(()=>resolve()));
}
