import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {test} from 'vitest';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
// Host-only JavaScript adapter used by the managed local launcher.
// @ts-expect-error The launcher module has no TypeScript declarations.
import {loadPublishedContentCatalog,writeLocalCatalogSnapshot} from '../../../scripts/local/publishedContentCatalog.mjs';
import {createConsumerRoutes} from '../../../apps/api/src/sensa/access/consumer.ts';
import {readLearningContentRegistry} from '../../../apps/api/src/sensa/access/learningContentRegistry.ts';
import {Hono} from 'hono';
import {cors} from 'hono/cors';
import {localSensaCorsOptions} from '../../../scripts/local/localCors.mts';

const snapshot={format:'sensa-learning-content-registry-v3' as const,publishedAt:'2026-09-30T00:00:00Z',items:[portableBookDeliveryFixture().descriptor]};
const catalog={...snapshot,revision:createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex')};

test('local preview preserves the exact published identities and artifact digests',async()=>{
 let options:RequestInit|undefined;
 const result=await loadPublishedContentCatalog('https://content.fixture.invalid/catalog',async(_url:URL,init:RequestInit)=>{
  options=init;return new Response(JSON.stringify(catalog));
 });
 assert.deepEqual(JSON.parse(result),catalog);
 assert.equal(options?.headers,undefined,'public content must not carry learner credentials');
 assert.equal(options?.redirect,'error');
});

test('local cross-origin catalog refresh admits conditional headers but not foreign origins',async()=>{
 const routes=new Hono();
 routes.use('*',cors(localSensaCorsOptions(['http://127.0.0.1:3000'])));
 routes.route('/',createConsumerRoutes({learningContentRegistry:async()=>catalog,telemetry:()=>{}}));
 const preflight=await routes.request('/sensa/packages',{method:'OPTIONS',headers:{origin:'http://127.0.0.1:3000','access-control-request-method':'GET','access-control-request-headers':'if-none-match'}});
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('access-control-allow-origin'),'http://127.0.0.1:3000');
 assert(preflight.headers.get('access-control-allow-headers')?.split(',').includes('if-none-match'));
 const response=await routes.request('/sensa/packages',{headers:{origin:'http://127.0.0.1:3000','if-none-match':`"${catalog.revision}"`}});
 assert.equal(response.status,304);
 assert.equal(response.headers.get('access-control-allow-origin'),'http://127.0.0.1:3000');
 assert.equal((await routes.request('/sensa/packages',{method:'OPTIONS',headers:{origin:'https://foreign.fixture.invalid','access-control-request-method':'GET'}})).headers.get('access-control-allow-origin'),null);
});

test('a changed or truncated snapshot cannot masquerade as the published revision',async()=>{
 const changed={...catalog,items:[{...catalog.items[0],book:{...catalog.items[0]!.book,title:'Unpublished edit'}}]};
 await assert.rejects(loadPublishedContentCatalog('https://content.fixture.invalid/catalog',async()=>new Response(JSON.stringify(changed))),/revision mismatch/u);
 await assert.rejects(loadPublishedContentCatalog('https://content.fixture.invalid/catalog',async()=>new Response(JSON.stringify(catalog).slice(0,-1))));
});

test('catalog opt-in rejects credential-bearing URLs before issuing a request',async()=>{
 for(const url of ['http://remote.fixture.invalid/catalog','https://user:password@content.fixture.invalid/catalog','https://content.fixture.invalid/catalog?token=fixture']){
  await assert.rejects(loadPublishedContentCatalog(url,()=>{throw new Error('unexpected request');}),/public HTTPS/u);
 }
});

test('large catalogs cross the local process boundary by private file, not an environment string',async()=>{
 const runtimeRoot=await mkdtemp(join(tmpdir(),'sensa-local-catalog-'));
 try{
  const largeSnapshot={...snapshot,items:Array.from({length:342},(_,index)=>({
   ...snapshot.items[0]!,
   book:{...snapshot.items[0]!.book,bookId:crypto.randomUUID(),bookKey:`fixture-${index}`,bookVersionId:crypto.randomUUID()},
  }))};
  const largeCatalog={...largeSnapshot,revision:createHash('sha256').update(canonicalConsumerJson(largeSnapshot)).digest('hex')};
  const bytes=canonicalConsumerJson(largeCatalog);
  assert(Buffer.byteLength(bytes)>128*1024,'fixture must cross Linux single-environment-string limit');
  const path=writeLocalCatalogSnapshot(runtimeRoot,bytes);
  assert.equal((await stat(path)).mode&0o777,0o600);
  assert.equal((await stat(dirname(path))).mode&0o777,0o700);
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`
   import {readFileSync} from 'node:fs';
   import {readLearningContentRegistry} from './apps/api/src/sensa/access/learningContentRegistry.ts';
   const catalog=await readLearningContentRegistry({SENSA_PACKAGE_CATALOG_JSON:readFileSync(process.env.SENSA_LOCAL_PACKAGE_CATALOG_PATH,'utf8')});
   console.log(JSON.stringify({revision:catalog.revision,count:catalog.items.length,inlineEnvironment:process.env.SENSA_PACKAGE_CATALOG_JSON??null}));
  `],{cwd:resolve('.'),encoding:'utf8',env:{PATH:process.env.PATH,SENSA_LOCAL_PACKAGE_CATALOG_PATH:path}});
  assert.equal(child.status,0,child.error?.message??child.stderr);
  assert.deepEqual(JSON.parse(child.stdout),{revision:largeCatalog.revision,count:342,inlineEnvironment:null});
  const parsed=await readLearningContentRegistry({SENSA_PACKAGE_CATALOG_JSON:bytes});
  const routes=createConsumerRoutes({learningContentRegistry:async()=>parsed,telemetry:()=>{}});
  const response=await routes.request('/sensa/packages');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),largeCatalog);
  assert.equal(response.headers.get('etag'),`"${largeCatalog.revision}"`);
  assert.equal((await routes.request('/sensa/packages',{headers:{'if-none-match':`"${largeCatalog.revision}"`}})).status,304);
 }finally{await rm(runtimeRoot,{recursive:true,force:true});}
});
