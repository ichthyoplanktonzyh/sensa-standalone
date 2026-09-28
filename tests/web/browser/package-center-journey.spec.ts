/**
 * Package Center acceptance journey in the shipped Web application.
 *
 * This deliberately crosses the network, Book Manifest, `.sensa` admission,
 * OPFS SQLite, Content Supply System and Learning System boundaries. The
 * fixture responses are chunked and omit Content-Length, matching compressed
 * production object delivery rather than an in-memory happy path.
 */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {mkdir,readFile,rm} from 'node:fs/promises';
import {extname,join,resolve} from 'node:path';
import {expect,test} from '@playwright/test';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';

const root=process.cwd();
const output=resolve(root,'.tmp/package-center-journey');
const dist=join(output,'dist');
const subject='4c59833b-a0e2-4bd0-9d27-908ffcd81cf8';
const account='f10b0c0c-0f03-40cb-b989-3dfc2c74d490';
const types:Record<string,string>={
  '.css':'text/css','.html':'text/html','.ico':'image/x-icon','.js':'text/javascript',
  '.json':'application/json','.mjs':'text/javascript','.mp3':'audio/mpeg',
  '.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm','.woff2':'font/woff2',
};

let server:Server;
let origin='';
let storageKey='';
let delivery:ReturnType<typeof portableBookDeliveryFixture>;
let registry:unknown;
const delivered:string[]=[];
const cloudBlocks=new Map<string,string>();
let cloudRevision=0;
let cloudManifest:string[]|null=null;

const jwt=(expiresInSeconds:number)=>{
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    encode({alg:'HS256',typ:'JWT'}),
    encode({
      sub:subject,aud:'authenticated',email:'package-center@sensa.invalid',
      session_id:randomUUID(),exp:Math.floor(Date.now()/1000)+expiresInSeconds,
      amr:[{method:'otp',timestamp:Math.floor(Date.now()/1000)}],
    }),
    'fixture-signature',
  ].join('.');
};

const session=()=>({
  access_token:jwt(3600),token_type:'bearer',expires_in:3600,
  expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'fixture-refresh-token',
  user:{
    id:subject,aud:'authenticated',role:'authenticated',
    email:'package-center@sensa.invalid',app_metadata:{},user_metadata:{},
    identities:[],created_at:new Date().toISOString(),
  },
});

test.setTimeout(180_000);
test.use({viewport:{width:1280,height:900},locale:'zh-CN'});

test.beforeAll(async()=>{
  server=createServer(async(request,response)=>{
    const url=new URL(request.url??'/',origin||'http://127.0.0.1');
    const json=(value:unknown,status=200)=>{
      response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
      response.end(JSON.stringify(value));
    };
    const body=async()=>{
      const parts:Buffer[]=[];
      for await(const part of request)parts.push(Buffer.from(part));
      return parts.length?JSON.parse(Buffer.concat(parts).toString('utf8')):{};
    };
    try{
      if(url.pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
      if(url.pathname==='/auth/v1/user'){
        json({id:subject,aud:'authenticated',email:'package-center@sensa.invalid',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()});return;
      }
      if(url.pathname==='/sensa/web/access/session'){json({authorized:true,accountId:account});return;}
      if(url.pathname==='/sensa/library-sync/head'){
        json({revision:cloudRevision,manifest:cloudManifest});return;
      }
      if(url.pathname==='/sensa/library-sync/blocks/missing'){
        const input=await body() as {hashes:string[]};
        json({missing:input.hashes.filter(hash=>!cloudBlocks.has(hash))});return;
      }
      if(url.pathname==='/sensa/library-sync/blocks/store'){
        const input=await body() as {blocks:{hash:string;data:string}[]};
        for(const block of input.blocks)cloudBlocks.set(block.hash,block.data);
        json({stored:true});return;
      }
      if(url.pathname==='/sensa/library-sync/blocks/fetch'){
        const input=await body() as {hashes:string[]};
        json({
          blocks:input.hashes.flatMap(hash=>cloudBlocks.has(hash)?[{hash,data:cloudBlocks.get(hash)!}]:[]),
          missing:input.hashes.filter(hash=>!cloudBlocks.has(hash)),
        });return;
      }
      if(url.pathname.startsWith('/sensa/library-sync/blocks/')){
        const hash=url.pathname.slice('/sensa/library-sync/blocks/'.length);
        if(!cloudBlocks.has(hash)){json({code:'missing'},404);return;}
        json({hash,data:cloudBlocks.get(hash)});return;
      }
      if(url.pathname==='/sensa/library-sync/commit'){
        const input=await body() as {baseRevision:number;manifest:string[]};
        if(input.baseRevision!==cloudRevision){json({code:'library_sync_conflict'},409);return;}
        cloudRevision+=1;cloudManifest=input.manifest;
        json({revision:cloudRevision,manifest:cloudManifest});return;
      }
      if(url.pathname==='/sensa/intake/channel'){
        json({registered:true,libraryId:'package-center-fixture-library'});return;
      }
      if(url.pathname==='/sensa/intake/deliveries/pull'){json({deliveries:[]});return;}
      if(url.pathname==='/sensa/service/status'){
        json({authorized:true,explanationAvailable:true,checkedAt:new Date().toISOString(),windowHours:24,usage:[]});return;
      }
      if(url.pathname==='/sensa/packages'){json(registry);return;}

      const deliveryUrl=new URL(url.pathname,origin).href;
      const bytes=delivery.responses.get(deliveryUrl);
      if(bytes){
        delivered.push(url.pathname);
        // Force chunked transfer so this acceptance path has no Content-Length.
        response.writeHead(200,{
          'content-type':url.pathname.endsWith('.json')?'application/json':'application/octet-stream',
          'cache-control':'no-store','transfer-encoding':'chunked',
        });
        const middle=Math.max(1,Math.floor(bytes.byteLength/2));
        response.write(Buffer.from(bytes.subarray(0,middle)));
        response.end(Buffer.from(bytes.subarray(middle)));
        return;
      }
      if(url.pathname.startsWith('/sensa/')){json({code:'not_found'},404);return;}

      const path=join(dist,url.pathname);
      const file=path.startsWith(dist)&&extname(path)?path:join(dist,'index.html');
      try{
        const bytes=await readFile(file);
        response.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream'});
        response.end(bytes);
      }catch{
        const bytes=await readFile(join(dist,'index.html'));
        response.writeHead(200,{'content-type':'text/html'});
        response.end(bytes);
      }
    }catch(error){
      json({code:'fixture_error',message:error instanceof Error?error.message:'unknown'},500);
    }
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  storageKey=`sb-${new URL(origin).hostname.split('.')[0]}-auth-token`;
  delivery=portableBookDeliveryFixture({
    baseUrl:`${origin}/published/`,
    expression:'borrow',
    title:'English route essentials',
  });
  const snapshot={
    format:'sensa-learning-content-registry-v2' as const,
    publishedAt:'2026-09-28T00:00:00Z',
    items:[delivery.descriptor],
  };
  registry={
    ...snapshot,
    revision:createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex'),
  };

  await rm(output,{recursive:true,force:true});
  await mkdir(dist,{recursive:true});
  execFileSync('npm',['run','build','-w','@sensa/web','--','--outDir',dist,'--emptyOutDir'],{
    cwd:root,
    env:{
      ...process.env,
      VITE_SENSA_MODE:'production',
      VITE_SENSA_BROWSER_SMOKE:'true',
      VITE_SUPABASE_URL:origin,
      VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable-key',
      VITE_SENSA_API_URL:origin,
    },
    stdio:'inherit',
  });
});

test.afterAll(async()=>{
  if(server?.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
  await rm(output,{recursive:true,force:true});
});

test('discovers, downloads and enrolls a Book with durable local state',async({page})=>{
  const runtimeErrors:string[]=[];
  page.on('console',message=>{
    if(message.type()==='error'&&!message.text().includes('favicon.ico'))runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror',error=>runtimeErrors.push(`pageerror: ${error.message}`));
  await page.addInitScript(({key,value})=>{
    (window as unknown as {__name:(value:unknown)=>unknown}).__name=(value:unknown)=>value;
    localStorage.setItem(key,JSON.stringify(value));
  },{key:storageKey,value:session()});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'
    ?route.continue()
    :route.abort());

  await page.goto(origin);
  await expect(page.locator('[data-sensa-page-layout="application-shell"]')).toBeVisible({timeout:15_000});
  await page.evaluate(()=>window.__sensaBrowserSmoke!.navigate('/learning-entry'));
  const entry=page.locator('#s-learning-entry').last();
  await expect(entry.getByRole('heading',{name:'学习包',exact:true})).toBeVisible({timeout:15_000});

  await expect(entry.getByRole('button',{name:/English route essentials/})).toBeVisible();
  await entry.getByRole('button',{name:/English route essentials/}).click();
  await expect(entry.getByRole('heading',{name:'English route essentials'})).toBeVisible();
  await expect(entry.getByText('未下载',{exact:true})).toBeVisible();
  await expect(entry.getByText('1 个表达',{exact:true})).toBeVisible();

  await entry.getByRole('button',{name:'下载学习包',exact:true}).click();
  await expect(entry.getByText('已下载',{exact:true})).toBeVisible({timeout:15_000});
  await expect(entry.getByText('borrow',{exact:true})).toBeVisible();
  await expect(entry.getByRole('button',{name:'加入学习',exact:true})).toBeVisible();
  assert.equal(delivered.filter(path=>path.endsWith('.json')).length,1,'Book Manifest was not downloaded exactly once');
  assert.equal(delivered.filter(path=>path.endsWith('.sensa')).length,1,'portable member was not downloaded exactly once');

  await entry.getByRole('button',{name:'加入学习',exact:true}).click();
  await expect(entry.getByText('已加入学习',{exact:true})).toBeVisible({timeout:15_000});
  await expect(entry.getByRole('button',{name:'去学习',exact:true})).toBeVisible();

  await page.reload();
  await expect(page.locator('[data-sensa-page-layout="application-shell"]')).toBeVisible({timeout:15_000});
  await page.evaluate(()=>window.__sensaBrowserSmoke!.navigate('/learning-entry'));
  const restored=page.locator('#s-learning-entry').last();
  await expect(restored.getByRole('button',{name:/English route essentials/})).toBeVisible({timeout:15_000});
  await restored.getByRole('button',{name:/English route essentials/}).click();
  await expect(restored.getByText('已加入学习',{exact:true})).toBeVisible();
  await expect(restored.getByText('borrow',{exact:true})).toBeVisible();
  assert.deepEqual(runtimeErrors,[]);
});
