/** Real Chromium + Supabase client + IndexedDB; synthetic HTTP contracts, no DB/providers. */
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {chromium,expect} from '@playwright/test';

const server=createServer();
server.listen(0,'127.0.0.1');await once(server,'listening');
const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const bundle=await build({stdin:{contents:"export * from './apps/web/src/data/consumer/client'; export * from './apps/web/src/data/replica/accountStore';",resolveDir:process.cwd()},bundle:true,format:'esm',write:false,define:{'import.meta.env':JSON.stringify({VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:'synthetic-test-key',VITE_SENSA_API_URL:origin})}});
server.on('request',(req,res)=>{res.setHeader('content-type',req.url==='/client.js'?'text/javascript':'text/html');res.end(req.url==='/client.js'?bundle.outputFiles[0]!.text:'<!doctype html><title>Account isolation integration</title>');});
const browser=await chromium.launch({headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH});
const context=await browser.newContext();const page=await context.newPage();
const ids={a:crypto.randomUUID(),b:crypto.randomUUID()},replicaId=crypto.randomUUID();
const calls:Array<{path:string;subject:string}>=[];
let heldPath:string|null=null,release:(()=>void)|undefined,arrived:(()=>void)|undefined;
const token=(subject:string)=>[{}, {sub:subject,exp:Math.floor(Date.now()/1000)+3600},'synthetic'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
try{
 await context.route(origin+'/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/auth/v1/verify'){
   const subject=req.postDataJSON().email==='a@sensa.invalid'?ids.a:ids.b;
   await route.fulfill({json:{access_token:token(subject),refresh_token:'synthetic-'+subject,token_type:'bearer',expires_in:3600,user:{id:subject,email:subject===ids.a?'a@sensa.invalid':'b@sensa.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}});return;
  }
  if(!path.startsWith('/sensa/')){await route.continue();return;}
  const subject=JSON.parse(Buffer.from(req.headers().authorization!.slice(7).split('.')[1]!,'base64url').toString()).sub;
  calls.push({path,subject});
  if(heldPath===path){heldPath=null;await new Promise<void>(resolve=>{release=resolve;arrived?.();});}
  const body=req.postDataJSON();
  const empty={plan:null,targets:[],runs:[],activity:null,checkins:[],intakes:[],meanings:[]};
  let value:unknown;
  if(path==='/sensa/account/session')value={contractVersion:'sensa-consumer-v1',scopeEpoch:'1',serverTime:new Date().toISOString(),data:{accountId:subject,learnerUserId:subject,accountSessionId:crypto.randomUUID(),installationId:body.installationId,accessStatus:'invited',timeZone:'Asia/Shanghai',timeZoneRevision:'1',quantityConfirmed:false,plan:null,clockGrant:null,supportedWireVersions:['sensa-sync-v3'],minClientVersion:'1'}};
  else if(path==='/sensa/sync/bootstrap')value={...empty,scopeEpoch:'1',replicaId,syncCursor:'cursor'};
  else if(path==='/sensa/sync/pull')value={scopeEpoch:'1',changes:[],nextCursor:'cursor',hasMore:false};
  else if(path==='/sensa/home')value={contractVersion:'sensa-consumer-v1',data:{...empty,summary:null,counts:{newAvailable:0,initialContinuations:0,dueReviews:0,relearningReady:0,relearningWaiting:0,distinctExecutableTargets:0},emptyReason:'no_targets'}};
  else if(path==='/sensa/sync/push')value={serverTime:new Date().toISOString(),results:body.operations.map((op:{operationId:string})=>({operationId:op.operationId,status:'retryable',error:{code:'temporarily_unavailable',retryable:true,retryAfterMs:null,latest:null,field:null,messageKey:'retry'}}))};
  else {await route.fulfill({status:500,json:{code:'unexpected_test_request'}});return;}
  await route.fulfill({json:value});
 });
 await page.goto(origin);
 await page.evaluate(async()=>{(window as any).client=await import('/client.js');});
 const login=async(who:'a'|'b')=>page.evaluate(async email=>{const {error}=await (window as any).client.auth.verifyOtp({email,token:'123456',type:'email'});if(error)throw error;},who+'@sensa.invalid');
 await login('a');
 await page.evaluate(async subject=>{const w=window as any;w.a=await w.client.initializeAccount(subject);},ids.a);
 // Hold an A response, replace auth in another tab, then resume the old drain.
 heldPath='/sensa/sync/bootstrap';const held=new Promise<void>(resolve=>{arrived=resolve;});
 await page.evaluate(()=>{const w=window as any;w.result=w.client.syncAccount(w.a).then(()=> 'unexpected_success',(e:any)=>e.code);});
 await held;
 const other=await context.newPage();await other.goto(origin);
 await other.evaluate(async()=>{const c=await import('/client.js');await c.auth.verifyOtp({email:'b@sensa.invalid',token:'123456',type:'email'});});
 await expect.poll(()=>page.evaluate(async()=> (await (window as any).client.auth.getSession()).data.session.user.email)).toBe('b@sensa.invalid');
 release!();expect(await page.evaluate(()=>(window as any).result)).toBe('account_changed');
 expect(calls.filter(x=>x.subject===ids.b&&x.path!=='/sensa/account/session')).toEqual([]);
 await page.evaluate(async()=>{const w=window as any;await w.client.queueQuantity(w.a,10);});
 const before=calls.length;
 const rejected=await page.evaluate(async()=>{
  const w=window as any,c=w.client;
  const actions=[()=>c.syncAccount(w.a),()=>c.readCatalog(w.a),()=>c.checkMaterial(w.a,'unused'),()=>c.readMaterialAudio(w.a,'unused','unused'),()=>c.connectExtension(w.a,{}),()=>c.lookupSemantic(w.a,{},'unused'),()=>c.checkSemanticLookup(w.a,'unused'),()=>c.intakeSemanticLookup(w.a,'unused'),()=>c.preparePersonalTarget(w.a,'unused'),()=>c.revokeSession(w.a)];
  return Promise.all(actions.map(f=>f().then(()=> 'unexpected_success',(e:any)=>e.code)));
 });
 expect(rejected).toEqual(Array(10).fill('account_changed'));expect(calls.length).toBe(before);
 expect(await page.evaluate(async()=>{const w=window as any;return (await w.client.loadAccountReplica(w.a)).outbox.length;})).toBe(1);
 // Reload: metadata binds back to A; B still cannot drain it. Return to A and retry.
 await page.reload();await page.evaluate(async subject=>{const w=window as any;w.client=await import('/client.js');w.a=w.client.cachedAccount(subject);},ids.a);
 expect(await page.evaluate(async()=>{const w=window as any;return w.client.syncAccount(w.a).then(()=> 'unexpected_success',(e:any)=>e.code);})).toBe('account_changed');
 await login('a');
 const recovered=await page.evaluate(async()=>{const w=window as any;return w.client.syncAccount(w.a);});
 expect(recovered.accountId).toBe(ids.a);expect(recovered.outbox).toHaveLength(1);
 expect(calls.filter(x=>x.path==='/sensa/sync/push').every(x=>x.subject===ids.a)).toBe(true);
 // Late initialization must not persist A metadata under B's subject key.
 await page.evaluate(subject=>localStorage.removeItem('sensa:account:v3:'+subject),ids.a);
 heldPath='/sensa/account/session';const initHeld=new Promise<void>(resolve=>{arrived=resolve;});
 await page.evaluate(subject=>{const w=window as any;w.result=w.client.initializeAccount(subject).then(()=> 'unexpected_success',(e:any)=>e.code);},ids.a);
 await initHeld;await login('b');release!();expect(await page.evaluate(()=>(window as any).result)).toBe('account_changed');
 expect(await page.evaluate(subject=>localStorage.getItem('sensa:account:v3:'+subject),ids.a)).toBeNull();
 console.log('PASS: cross-tab auth switch, delayed bootstrap/initialization, all scoped endpoints, durable pending queue, reload and original-account recovery. Real browser/Auth SDK/IndexedDB; synthetic HTTP only.');
}finally{release?.();await browser.close();server.close();}
