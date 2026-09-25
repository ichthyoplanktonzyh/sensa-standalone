import {test} from 'vitest';
import assert from 'node:assert/strict';
import {parse} from '@babel/parser';
import {gzipSync} from 'node:zlib';
import {readdir,readFile} from 'node:fs/promises';
import {basename,resolve} from 'node:path';

test("web-bundle-budget", async () => {

/**
 * Regression ceilings for the actual static ESM dependency graph. Looking at
 * named chunks alone misses shared chunks imported synchronously by App.
 */
const budgets={
  indexGzip:200*1024,
  appChunkGzip:24*1024,
  appClosureGzip:155*1024,
  homeChunkGzip:8*1024,
  // Guest-to-account preflight adds a small admission path to the interactive
  // shell. Keep less than 1 KiB of headroom around the measured closure.
  homeClosureGzip:205*1024,
  workspaceChunkGzip:25*1024,
  workspaceIncrementalGzip:300*1024,
  runtimeChunkGzip:40*1024,
  runtimeIncrementalGzip:200*1024,
} as const;

const assets=resolve('apps/web/dist/assets');
const files=await readdir(assets);
const findOne=(pattern:RegExp,label:string)=>{
  const matches=files.filter(file=>pattern.test(file));
  assert.equal(matches.length,1,`expected one ${label} chunk, found ${matches.join(', ')||'none'}`);
  return matches[0]!;
};
const sourceCache=new Map<string,string>();
const gzipCache=new Map<string,number>();
const sourceFor=async(file:string)=>{
 const cached=sourceCache.get(file);
 if(cached!==undefined)return cached;
 const source=await readFile(resolve(assets,file),'utf8');
 sourceCache.set(file,source);
 return source;
};
const gzipBytes=async(file:string)=>{
 const cached=gzipCache.get(file);
 if(cached!==undefined)return cached;
 const bytes=gzipSync(await readFile(resolve(assets,file))).byteLength;
 gzipCache.set(file,bytes);
 return bytes;
};
const staticDependencies=async(file:string)=>{
 const program=parse(await sourceFor(file),{sourceType:'module'}).program;
 return program.body.flatMap(node=>{
  if(!('source' in node)||!node.source||typeof node.source.value!=='string')return [];
  if(!node.source.value.startsWith('./')||!node.source.value.endsWith('.js'))return [];
  const dependency=basename(node.source.value);
  assert(files.includes(dependency),`${file} imports missing asset ${dependency}`);
  return [dependency];
 });
};
const staticClosure=async(root:string)=>{
 const visited=new Set<string>();
 const visit=async(file:string)=>{
  if(visited.has(file))return;
  visited.add(file);
  for(const dependency of await staticDependencies(file))await visit(dependency);
 };
 await visit(root);
 return visited;
};
const closureGzip=async(closure:ReadonlySet<string>)=>{
 let bytes=0;
 for(const file of closure)bytes+=await gzipBytes(file);
 return bytes;
};
const union=(...closures:ReadonlySet<string>[])=>new Set(closures.flatMap(closure=>[...closure]));
const difference=(closure:ReadonlySet<string>,loaded:ReadonlySet<string>)=>new Set([...closure].filter(file=>!loaded.has(file)));
const indexFile=findOne(/^index-[^.]+\.js$/u,'entry');
const appFile=findOne(/^App-[^.]+\.js$/u,'App');
const homeFile=findOne(/^HomeLearningController-[^.]+\.js$/u,'Home controller');
const workspaceFile=findOne(/^LearningWorkspace-[^.]+\.js$/u,'learning workspace');
const workspaceResourcesFile=findOne(/^workspaceResources-[^.]+\.js$/u,'workspace translations');
const runtimeFile=findOne(/^PackageLearningRuntime-[^.]+\.js$/u,'learning Runtime');
const accountFile=findOne(/^AccountExperience-[^.]+\.js$/u,'account experience');
const storeFile=findOne(/^store-[^.]+\.js$/u,'local library store');
const portablePackageFile=findOne(/^portablePackage-[^.]+\.js$/u,'Portable Package installer');
const installedContentFile=findOne(/^installedLearningContent-[^.]+\.js$/u,'installed content validator');
const lemmaFile=findOne(/^resolveClickedLemma-[^.]+\.js$/u,'clicked-lemma resolver');
const deferredResourceFiles=[
 findOne(/^contentResources-[^.]+\.js$/u,'content translations'),
 findOne(/^learningResources-[^.]+\.js$/u,'learning translations'),
 findOne(/^profileResources-[^.]+\.js$/u,'profile translations'),
 findOne(/^referenceResources-[^.]+\.js$/u,'reference translations'),
];
const indexClosure=await staticClosure(indexFile);
const appClosure=await staticClosure(appFile);
const homeClosure=await staticClosure(homeFile);
const workspaceClosure=union(await staticClosure(workspaceFile),await staticClosure(workspaceResourcesFile));
const runtimeClosure=await staticClosure(runtimeFile);
const homeInteractiveClosure=union(appClosure,homeClosure);
const workspaceLoadedClosure=union(homeInteractiveClosure,workspaceClosure);
const workspaceIncremental=difference(workspaceLoadedClosure,homeInteractiveClosure);
const runtimeIncremental=difference(union(workspaceLoadedClosure,runtimeClosure),workspaceLoadedClosure);
const indexGzip=await closureGzip(indexClosure);
const appChunkGzip=await gzipBytes(appFile);
const appClosureGzip=await closureGzip(appClosure);
const homeChunkGzip=await gzipBytes(homeFile);
const homeClosureGzip=await closureGzip(homeInteractiveClosure);
const workspaceChunkGzip=await gzipBytes(workspaceFile);
const workspaceIncrementalGzip=await closureGzip(workspaceIncremental);
const runtimeChunkGzip=await gzipBytes(runtimeFile);
const runtimeIncrementalGzip=await closureGzip(runtimeIncremental);

const summary=`entry ${indexGzip}B; App ${appChunkGzip}B/${appClosureGzip}B closure; Home ${homeChunkGzip}B/${homeClosureGzip}B interactive closure; workspace +${workspaceIncrementalGzip}B; Runtime ${runtimeChunkGzip}B/+${runtimeIncrementalGzip}B`;

assert(indexGzip<=budgets.indexGzip,`${indexFile} gzip ${indexGzip} exceeds ${budgets.indexGzip}`);
assert(appChunkGzip<=budgets.appChunkGzip,`${appFile} gzip ${appChunkGzip} exceeds ${budgets.appChunkGzip}`);
assert(appClosureGzip<=budgets.appClosureGzip,`authenticated App static closure gzip ${appClosureGzip} exceeds ${budgets.appClosureGzip}`);
assert(homeChunkGzip<=budgets.homeChunkGzip,`${homeFile} gzip ${homeChunkGzip} exceeds ${budgets.homeChunkGzip}`);
assert(homeClosureGzip<=budgets.homeClosureGzip,`interactive Home static closure gzip ${homeClosureGzip} exceeds ${budgets.homeClosureGzip}`);
assert(workspaceChunkGzip<=budgets.workspaceChunkGzip,`${workspaceFile} gzip ${workspaceChunkGzip} exceeds ${budgets.workspaceChunkGzip}`);
assert(workspaceIncrementalGzip<=budgets.workspaceIncrementalGzip,`full workspace incremental static closure gzip ${workspaceIncrementalGzip} exceeds ${budgets.workspaceIncrementalGzip}`);
assert(!appClosure.has(homeFile)&&!appClosure.has(workspaceFile),`Home and full workspace controllers must not enter the App static closure`);
assert(!homeInteractiveClosure.has(workspaceFile),`${workspaceFile} must not enter the interactive Home static closure`);
assert(!appClosure.has(runtimeFile),`${runtimeFile} must not enter the authenticated App static closure`);
assert(!workspaceLoadedClosure.has(runtimeFile),`${runtimeFile} must not enter the full workspace static closure`);
assert(!indexClosure.has(accountFile),`${accountFile} must remain behind the explicit account boundary`);
assert(!indexClosure.has(storeFile),`${storeFile} must not initialize SQLite for the signed-out Landing`);
for(const installerFile of [portablePackageFile,installedContentFile]){
 assert(!indexClosure.has(installerFile)&&!appClosure.has(installerFile)&&!homeInteractiveClosure.has(installerFile)&&!workspaceLoadedClosure.has(installerFile),`${installerFile} must load only for Portable Package installation`);
}
assert(!indexClosure.has(lemmaFile)&&!appClosure.has(lemmaFile)&&!homeInteractiveClosure.has(lemmaFile)&&!workspaceLoadedClosure.has(lemmaFile),`${lemmaFile} and compromise must load only after a dictionary interaction`);
for(const resourceFile of deferredResourceFiles)assert(!indexClosure.has(resourceFile)&&!appClosure.has(resourceFile)&&!homeInteractiveClosure.has(resourceFile),`${resourceFile} must stay paired with its lazy feature surface`);
assert(runtimeChunkGzip<=budgets.runtimeChunkGzip,`${runtimeFile} gzip ${runtimeChunkGzip} exceeds ${budgets.runtimeChunkGzip}`);
assert(runtimeIncrementalGzip<=budgets.runtimeIncrementalGzip,`deferred Runtime incremental static closure gzip ${runtimeIncrementalGzip} exceeds ${budgets.runtimeIncrementalGzip}`);
console.log(`PASS: Web bundle regression ceilings (${summary}).`);

});
