import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

import {test} from 'vitest';
import {
  canonicalConsumerJson,
  sensaPortableLearningContentRegistrySchema,
} from '@sensa/contracts/sensa';

import {
  clearLearningContentRegistryCache,
  readLearningContentRegistry,
} from '../../../apps/api/src/sensa/access/learningContentRegistry.ts';

const digest=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');

test('API serves and caches only the Portable Registry v2 contract',async()=>{
  const snapshot={
    format:'sensa-learning-content-registry-v2' as const,
    publishedAt:'2026-09-25T00:00:00.000Z',
    items:[{
      format:'sensa-book-version-manifest-descriptor-v1' as const,
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
      url:'https://content.example.test/releases/books/fixture.json',
    }],
  };
  const registry=sensaPortableLearningContentRegistrySchema.parse({
    ...snapshot,
    revision:digest(canonicalConsumerJson(snapshot)),
  });
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
