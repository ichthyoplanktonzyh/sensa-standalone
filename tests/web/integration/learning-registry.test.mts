import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

import {test,vi} from 'vitest';
import {
  canonicalConsumerJson,
  sensaPortableBookDescriptorSchema,
  sensaPortableLearningContentRegistrySchema,
} from '@sensa/contracts/sensa';

import {
  clearLearningContentRegistryCache,
  readLearningContentRegistry,
} from '../../../apps/api/src/sensa/access/learningContentRegistry.ts';
import {createConsumerRoutes} from '../../../apps/api/src/sensa/access/consumer.ts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system/index.ts';
import {openLibrary,readLibrary,writeLibraryCache} from '../../../apps/web/src/data/library/store.ts';

const digest=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');

test('API serves and caches only the direct Portable Book Registry v3 contract',async()=>{
  const snapshot={
    format:'sensa-learning-content-registry-v3' as const,
    publishedAt:'2026-09-25T00:00:00.000Z',
    items:[{
      format:'sensa-portable-book-descriptor-v1' as const,
      publisher:{namespace:'sensa.official',name:'Sensa Official'},
      book:{
        bookId:crypto.randomUUID(),
        bookKey:'fixture-book',
        bookVersionId:crypto.randomUUID(),
        versionNumber:1,
        title:'Fixture Book',
        description:'Portable Registry fixture.',
      },
      contentRelease:{
        contentReleaseId:crypto.randomUUID(),
        versionNumber:1,
        schemaVersion:'sensa-portable-lightweight-package-v2',
      },
      route:{targetLanguage:'en',supportLanguage:'zh-CN'},
      publishedAt:'2026-09-25T00:00:00.000Z',
      changeSummary:'Initial release.',
      memberCount:3,
      byteLength:512,
      sha256:'a'.repeat(64),
      url:'https://content.example.test/releases/books/fixture.sensa-book',
    }],
  };
  const registry=sensaPortableLearningContentRegistrySchema.parse({
    ...snapshot,
    revision:digest(canonicalConsumerJson(snapshot)),
  });
  const previewSnapshot={...snapshot,items:snapshot.items.map(item=>({...item,preview:{
    url:'https://content.example.test/releases/previews/fixture.json',sha256:'b'.repeat(64),byteLength:123,
  }}))};
  const withPreview=sensaPortableLearningContentRegistrySchema.parse({
    ...previewSnapshot,revision:digest(canonicalConsumerJson(previewSnapshot)),
  });
  const app=createConsumerRoutes({learningContentRegistry:async()=>withPreview,telemetry:()=>{}});
  const legacy=await app.request('/sensa/packages');
  assert.equal(legacy.status,200);
  assert.deepEqual(await legacy.json(),registry);
  sensaPortableBookDescriptorSchema.omit({preview:true}).parse(registry.items[0]);
  assert.equal(legacy.headers.get('etag'),`"${registry.revision}"`);
  assert.equal((await app.request('/sensa/packages',{headers:{'if-none-match':`"${registry.revision}"`}})).status,304);
  const enhanced=await app.request('/sensa/packages?bookPreview=1',{headers:{'if-none-match':`"${registry.revision}"`}});
  assert.equal(enhanced.status,200);
  assert.deepEqual(await enhanced.json(),withPreview);
  assert.equal(enhanced.headers.get('etag'),`"${withPreview.revision}"`);
  assert.equal((await app.request('/sensa/packages?bookPreview=1',{headers:{'if-none-match':`"${withPreview.revision}"`}})).status,304);
  assert.equal((await app.request('/sensa/packages',{headers:{'if-none-match':`"${withPreview.revision}"`}})).status,200);
  assert.throws(()=>sensaPortableBookDescriptorSchema.omit({preview:true}).parse(withPreview.items[0]));
  const bytes=Buffer.from(canonicalConsumerJson(registry));
  const realFetch=globalThis.fetch;
  try{
    let requests=0;
    globalThis.fetch=async()=>{
      requests++;
      return new Response(bytes,{headers:{'content-length':String(bytes.byteLength)}});
    };
    clearLearningContentRegistryCache();
    const url=`https://content.example.test/registries/${registry.revision}.json`;
    assert.deepEqual(await readLearningContentRegistry({
      SENSA_PACKAGE_REGISTRY_URL:url,
    } as NodeJS.ProcessEnv),registry);
    assert.deepEqual(await readLearningContentRegistry({
      SENSA_PACKAGE_REGISTRY_URL:url,
    } as NodeJS.ProcessEnv),registry);
    assert.equal(requests,1,'one immutable Registry URL is cached in-process');

    clearLearningContentRegistryCache();
    const invalid=Buffer.from(canonicalConsumerJson({...registry,revision:'0'.repeat(64)}));
    globalThis.fetch=async()=>new Response(invalid,{
      headers:{'content-length':String(invalid.byteLength)},
    });
    await assert.rejects(readLearningContentRegistry({
      SENSA_PACKAGE_REGISTRY_URL:'https://content.example.test/registries/invalid.json',
    } as NodeJS.ProcessEnv),/revision mismatch/u);
    await assert.rejects(readLearningContentRegistry({
      SENSA_PACKAGE_REGISTRY_URL:'http://content.example.test/registry.json',
    } as NodeJS.ProcessEnv),/Invalid learning content registry URL/u);
    await assert.rejects(readLearningContentRegistry({
      SENSA_PACKAGE_CATALOG_JSON:JSON.stringify({items:[]}),
    } as NodeJS.ProcessEnv));
  }finally{
    clearLearningContentRegistryCache();
    globalThis.fetch=realFetch;
  }
});

test('new Web negotiates previews once when an older tab left a fresh base catalog cache',async()=>{
  const realFetch=globalThis.fetch;
  vi.stubGlobal('window',new EventTarget());vi.stubGlobal('BroadcastChannel',undefined);
  await openLibrary();
  const prior=await readLibrary(tx=>tx.get<unknown>('meta','package-catalog'));
  const snapshot={format:'sensa-learning-content-registry-v3',publishedAt:'2026-10-01T00:00:00.000Z',items:[]};
  const revision=digest(canonicalConsumerJson(snapshot));
  let requests=0;
  try{
    vi.stubEnv('VITE_SENSA_API_URL','https://catalog.fixture.invalid');
    vi.stubEnv('VITE_SENSA_MODE','production');
    globalThis.fetch=async(input)=>{
      requests++;
      assert.equal(String(input),'https://catalog.fixture.invalid/sensa/packages?bookPreview=1');
      return Response.json({...snapshot,revision});
    };
    await writeLibraryCache(async tx=>tx.put('meta','package-catalog',{
      format:'sensa-local-registry-cache-v3',items:[],revision,checkedAt:new Date().toISOString(),
    }));
    assert.equal((await contentSupplySystem.execute({kind:'refresh_catalog'})).status,'updated');
    assert.equal(requests,1);
    assert.equal((await contentSupplySystem.execute({kind:'refresh_catalog'})).status,'cached');
    assert.equal(requests,1);
  }finally{
    globalThis.fetch=realFetch;vi.unstubAllEnvs();
    await writeLibraryCache(async tx=>{if(prior===null||prior===undefined)tx.delete('meta','package-catalog');else tx.put('meta','package-catalog',prior);});
    vi.unstubAllGlobals();
  }
});
