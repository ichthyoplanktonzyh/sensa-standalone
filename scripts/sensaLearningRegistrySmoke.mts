import {syntheticSound} from './support/lightweightMaterialFixture.mts';
/** Immutable Book release and Registry build/read smoke. No network or publication. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {bookReleaseBundleSchema,bookReleaseDescriptorSchema,learningContentRegistrySchema,maxPublishedBookReleaseBytes} from '@sensa/contracts/sensa';
import {clearLearningContentRegistryCache,readLearningContentRegistry} from '../apps/api/src/sensa/access/learningContentRegistry.ts';
import {createAuthoredMediaPackager} from './release/authoredMedia.mts';

const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const root=await mkdtemp(join(tmpdir(),'sensa-learning-registry-'));
const releases=join(root,'releases'),catalogPath=join(root,'catalog.json'),base='https://content.example.test/releases/',mediaRoot=join(root,'media'),mediaPackPath=join(root,'authored-media-pack.json');
const realFetch=globalThis.fetch;
try{
 const source=JSON.parse(await readFile('content/authored/web-starter.json','utf8'));
 const sourcePath=join(root,'synthetic-source.json');
 const audioBytes=Buffer.from([0xff,0xfb,0x90,0x64,0,0,0,0]),audioSha256=digest(audioBytes),audio={sha256:audioSha256,mimeType:'audio/mpeg'};
 const imageBytes=Buffer.from([0xff,0xd8,0xff,0xe0,0,0,0xff,0xd9]),imageSha256=digest(imageBytes),image={sha256:imageSha256,mimeType:'image/jpeg'};
 await mkdir(join(mediaRoot,'audio'),{recursive:true});await mkdir(join(mediaRoot,'images'),{recursive:true});
 await writeFile(join(mediaRoot,'audio',audioSha256+'.mp3'),audioBytes);await writeFile(join(mediaRoot,'images',imageSha256+'.jpg'),imageBytes);
 const media=await createAuthoredMediaPackager({mediaRoot});
 assert.equal(await media.embed(audio,'synthetic-audio'),'data:audio/mpeg;base64,'+audioBytes.toString('base64'));
 assert.equal(await media.embed(image,'synthetic-image'),'data:image/jpeg;base64,'+imageBytes.toString('base64'));
 await assert.rejects(media.embed('https://upload.wikimedia.org/example.mp3','remote-media'),/must be content-addressed/);
 await writeFile(join(mediaRoot,'images',audioSha256+'.jpg'),audioBytes);
 await assert.rejects(media.embed({sha256:audioSha256,mimeType:'image/jpeg'},'wrong-media-type'),/type does not match/);
 const wrongDigest='0'.repeat(64);await writeFile(join(mediaRoot,'audio',wrongDigest+'.mp3'),audioBytes);
 await assert.rejects(media.embed({sha256:wrongDigest,mimeType:'audio/mpeg'},'wrong-digest'),/digest mismatch/);
 await writeFile(mediaPackPath,JSON.stringify({format:'sensa-authored-media-pack-v1',objects:[{...audio,base64:audioBytes.toString('base64')},{...image,base64:imageBytes.toString('base64')}]})+'\n');
 for(const [index,entry] of source.entries.entries()){
  const {audioUrl:discarded,...sound}=syntheticSound(entry.expression,source.targetLanguage);void discarded;
  entry.pronunciation={...sound,audio};entry.sceneBridge='Synthetic binding for release validation';entry.sceneExample={example:entry.expression,targetStart:0,targetEnd:entry.expression.length,audio};
  entry.usageExamples=(entry.usageExamples??[]).map((example:any)=>{const {audioUrl:discardedAudio,audio:discardedReference,...authored}=example;void discardedAudio;void discardedReference;return {...authored,audio};});
  entry.images=index===0?[{name:'synthetic-context.jpg',media:image}]:[];
 }
 await writeFile(sourcePath,JSON.stringify(source));
 const build=spawnSync(process.execPath,['--import','tsx',resolve('scripts/release/buildStarterPackage.mts')],{cwd:resolve('.'),encoding:'utf8',env:{...process.env,SENSA_BOOK_RELEASE_SOURCES:sourcePath,SENSA_AUTHORED_MEDIA_ROOT:join(root,'absent-media'),SENSA_AUTHORED_MEDIA_PACK:mediaPackPath,SENSA_PACKAGE_OUTPUT:releases,SENSA_PACKAGE_CATALOG_OUTPUT:catalogPath,SENSA_PACKAGE_BASE_URL:base,SENSA_WEB_ORIGIN:'https://app.example.test'}});
 assert.equal(build.status,0,build.stderr||build.stdout);
 const catalogBytes=await readFile(catalogPath),registry=learningContentRegistrySchema.parse(JSON.parse(catalogBytes.toString('utf8')));
 assert.equal(registry.items.length,1);
 const {revision,...withoutRevision}=registry;assert.equal(revision,digest(JSON.stringify(withoutRevision)));
 const descriptor=registry.items[0]!,relative=`${descriptor.book.bookId}/${descriptor.book.bookVersionId}/${descriptor.sha256}.json`,bundleBytes=await readFile(join(releases,relative)),bundle=bookReleaseBundleSchema.parse(JSON.parse(bundleBytes.toString('utf8')));
 assert.equal(descriptor.url,new URL(relative,base).href);assert.equal(descriptor.byteLength,bundleBytes.length);assert.equal(descriptor.sha256,digest(bundleBytes));assert.equal(bundle.book.bookId,descriptor.book.bookId);assert.equal(bundle.book.bookVersionId,descriptor.book.bookVersionId);assert.equal(bundle.contentRelease.contentReleaseId,descriptor.contentRelease.contentReleaseId);
 assert.equal(bundle.entries.length,3,'the authored release is the current three-expression Book');
 const resources=bundle.entries[0]!.content.resources;
 assert(resources.find(resource=>resource.materialRoleKey==='pronunciation')?.contentPayload.audioUrl.toString().startsWith('data:audio/mpeg;base64,'),'content-addressed audio must be embedded');
 assert.equal((resources.find(resource=>resource.materialRoleKey==='experience_recall_cue')?.contentPayload.images as unknown[])?.length,1,'content-addressed images must survive materialization');
 assert.equal(bookReleaseDescriptorSchema.parse({...descriptor,byteLength:maxPublishedBookReleaseBytes}).byteLength,maxPublishedBookReleaseBytes);
 assert.throws(()=>bookReleaseDescriptorSchema.parse({...descriptor,byteLength:maxPublishedBookReleaseBytes+1}),/Too big/);
 const repeatCatalog=join(root,'catalog-repeat.json'),repeatReleases=join(root,'repeat');
 const repeat=spawnSync(process.execPath,['--import','tsx',resolve('scripts/release/buildStarterPackage.mts')],{cwd:resolve('.'),encoding:'utf8',env:{...process.env,SENSA_BOOK_RELEASE_SOURCES:sourcePath,SENSA_AUTHORED_MEDIA_ROOT:join(root,'absent-media'),SENSA_AUTHORED_MEDIA_PACK:mediaPackPath,SENSA_PACKAGE_OUTPUT:repeatReleases,SENSA_PACKAGE_CATALOG_OUTPUT:repeatCatalog,SENSA_PACKAGE_BASE_URL:base,SENSA_WEB_ORIGIN:'https://app.example.test'}});
 assert.equal(repeat.status,0,repeat.stderr||repeat.stdout);assert.equal((await readFile(repeatCatalog)).toString('utf8'),catalogBytes.toString('utf8'),'the same authored release must rebuild byte-for-byte');
 assert.throws(()=>learningContentRegistrySchema.parse({...registry,items:[descriptor,descriptor]}),/Duplicate public Book version/);

 let requests=0;globalThis.fetch=async()=>{requests++;return new Response(catalogBytes,{headers:{'content-length':String(catalogBytes.length)}});};
 clearLearningContentRegistryCache();const remote=await readLearningContentRegistry({SENSA_PACKAGE_REGISTRY_URL:'https://content.example.test/registries/'+revision+'.json'} as NodeJS.ProcessEnv);assert.deepEqual(remote,registry);await readLearningContentRegistry({SENSA_PACKAGE_REGISTRY_URL:'https://content.example.test/registries/'+revision+'.json'} as NodeJS.ProcessEnv);assert.equal(requests,1,'one immutable Registry is cached in-process');
 clearLearningContentRegistryCache();const invalidRegistry=Buffer.from(JSON.stringify({...registry,revision:'0'.repeat(64)}));globalThis.fetch=async()=>new Response(invalidRegistry,{headers:{'content-length':String(invalidRegistry.length)}});await assert.rejects(readLearningContentRegistry({SENSA_PACKAGE_REGISTRY_URL:'https://content.example.test/registries/invalid.json'} as NodeJS.ProcessEnv),/revision mismatch/);
 await assert.rejects(readLearningContentRegistry({SENSA_PACKAGE_REGISTRY_URL:'http://content.example.test/registry.json'} as NodeJS.ProcessEnv),/Invalid learning content registry URL/);
 console.log('PASS: deterministic immutable Book release, content-addressed artifact, Registry uniqueness/digest, safe remote read and immutable cache; no network/publication.');
}finally{clearLearningContentRegistryCache();globalThis.fetch=realFetch;await rm(root,{recursive:true,force:true});}
