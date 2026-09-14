/** Immutable Book release and Registry build/read smoke. No network or publication. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {bookReleaseBundleSchema,bookReleaseDescriptorSchema,learningContentRegistrySchema,maxPublishedBookReleaseBytes} from '@sensa/contracts/sensa';
import {clearLearningContentRegistryCache,readLearningContentRegistry} from '../apps/api/src/sensa/access/learningContentRegistry.ts';

const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const root=await mkdtemp(join(tmpdir(),'sensa-learning-registry-'));
const releases=join(root,'releases'),catalogPath=join(root,'catalog.json'),base='https://content.example.test/releases/';
const realFetch=globalThis.fetch;
try{
 const build=spawnSync(process.execPath,['--import','tsx',resolve('scripts/release/buildStarterPackage.mts')],{cwd:resolve('.'),encoding:'utf8',env:{...process.env,SENSA_PACKAGE_OUTPUT:releases,SENSA_PACKAGE_CATALOG_OUTPUT:catalogPath,SENSA_PACKAGE_BASE_URL:base,SENSA_WEB_ORIGIN:'https://app.example.test'}});
 assert.equal(build.status,0,build.stderr||build.stdout);
 const catalogBytes=await readFile(catalogPath),registry=learningContentRegistrySchema.parse(JSON.parse(catalogBytes.toString('utf8')));
 assert.equal(registry.items.length,1);
 const {revision,...withoutRevision}=registry;assert.equal(revision,digest(JSON.stringify(withoutRevision)));
 const descriptor=registry.items[0]!,relative=`${descriptor.book.bookId}/${descriptor.book.bookVersionId}/${descriptor.sha256}.json`,bundleBytes=await readFile(join(releases,relative)),bundle=bookReleaseBundleSchema.parse(JSON.parse(bundleBytes.toString('utf8')));
 assert.equal(descriptor.url,new URL(relative,base).href);assert.equal(descriptor.byteLength,bundleBytes.length);assert.equal(descriptor.sha256,digest(bundleBytes));assert.equal(bundle.book.bookId,descriptor.book.bookId);assert.equal(bundle.book.bookVersionId,descriptor.book.bookVersionId);assert.equal(bundle.contentRelease.contentReleaseId,descriptor.contentRelease.contentReleaseId);
 assert.equal(bookReleaseDescriptorSchema.parse({...descriptor,byteLength:maxPublishedBookReleaseBytes}).byteLength,maxPublishedBookReleaseBytes);
 assert.throws(()=>bookReleaseDescriptorSchema.parse({...descriptor,byteLength:maxPublishedBookReleaseBytes+1}),/Too big/);
 const repeatCatalog=join(root,'catalog-repeat.json'),repeatReleases=join(root,'repeat');
 const repeat=spawnSync(process.execPath,['--import','tsx',resolve('scripts/release/buildStarterPackage.mts')],{cwd:resolve('.'),encoding:'utf8',env:{...process.env,SENSA_PACKAGE_OUTPUT:repeatReleases,SENSA_PACKAGE_CATALOG_OUTPUT:repeatCatalog,SENSA_PACKAGE_BASE_URL:base,SENSA_WEB_ORIGIN:'https://app.example.test'}});
 assert.equal(repeat.status,0,repeat.stderr||repeat.stdout);assert.equal((await readFile(repeatCatalog)).toString('utf8'),catalogBytes.toString('utf8'),'the same authored release must rebuild byte-for-byte');
 assert.throws(()=>learningContentRegistrySchema.parse({...registry,items:[descriptor,descriptor]}),/Duplicate public Book version/);

 let requests=0;globalThis.fetch=async()=>{requests++;return new Response(catalogBytes,{headers:{'content-length':String(catalogBytes.length)}});};
 clearLearningContentRegistryCache();const remote=await readLearningContentRegistry({SENSA_PACKAGE_REGISTRY_URL:'https://content.example.test/registries/'+revision+'.json'} as NodeJS.ProcessEnv);assert.deepEqual(remote,registry);await readLearningContentRegistry({SENSA_PACKAGE_REGISTRY_URL:'https://content.example.test/registries/'+revision+'.json'} as NodeJS.ProcessEnv);assert.equal(requests,1,'one immutable Registry is cached in-process');
 clearLearningContentRegistryCache();const invalidRegistry=Buffer.from(JSON.stringify({...registry,revision:'0'.repeat(64)}));globalThis.fetch=async()=>new Response(invalidRegistry,{headers:{'content-length':String(invalidRegistry.length)}});await assert.rejects(readLearningContentRegistry({SENSA_PACKAGE_REGISTRY_URL:'https://content.example.test/registries/invalid.json'} as NodeJS.ProcessEnv),/revision mismatch/);
 await assert.rejects(readLearningContentRegistry({SENSA_PACKAGE_REGISTRY_URL:'http://content.example.test/registry.json'} as NodeJS.ProcessEnv),/Invalid learning content registry URL/);
 console.log('PASS: deterministic immutable Book release, content-addressed artifact, Registry uniqueness/digest, safe remote read and immutable cache; no network/publication.');
}finally{clearLearningContentRegistryCache();globalThis.fetch=realFetch;await rm(root,{recursive:true,force:true});}
