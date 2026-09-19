import assert from 'node:assert/strict';
import {parse} from '@babel/parser';
import {gzipSync} from 'node:zlib';
import {readdir,readFile} from 'node:fs/promises';
import {basename,resolve} from 'node:path';

/**
 * Regression ceilings for the actual static ESM dependency graph. Looking at
 * named chunks alone misses shared chunks imported synchronously by App.
 */
const budgets={
  indexGzip:310*1024,
  appChunkGzip:100*1024,
  appClosureGzip:450*1024,
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
const indexFile=findOne(/^index-[^.]+\.js$/u,'entry');
const appFile=findOne(/^App-[^.]+\.js$/u,'App');
const runtimeFile=findOne(/^PackageLearningRuntime-[^.]+\.js$/u,'learning Runtime');
const indexClosure=await staticClosure(indexFile);
const appClosure=await staticClosure(appFile);
const runtimeClosure=await staticClosure(runtimeFile);
const runtimeIncremental=new Set([...runtimeClosure].filter(file=>!appClosure.has(file)));
const indexGzip=await closureGzip(indexClosure);
const appChunkGzip=await gzipBytes(appFile);
const appClosureGzip=await closureGzip(appClosure);
const runtimeChunkGzip=await gzipBytes(runtimeFile);
const runtimeIncrementalGzip=await closureGzip(runtimeIncremental);

assert(indexGzip<=budgets.indexGzip,`${indexFile} gzip ${indexGzip} exceeds ${budgets.indexGzip}`);
assert(appChunkGzip<=budgets.appChunkGzip,`${appFile} gzip ${appChunkGzip} exceeds ${budgets.appChunkGzip}`);
assert(appClosureGzip<=budgets.appClosureGzip,`authenticated App static closure gzip ${appClosureGzip} exceeds ${budgets.appClosureGzip}`);
assert(!appClosure.has(runtimeFile),`${runtimeFile} must not enter the authenticated App static closure`);
assert(runtimeChunkGzip<=budgets.runtimeChunkGzip,`${runtimeFile} gzip ${runtimeChunkGzip} exceeds ${budgets.runtimeChunkGzip}`);
assert(runtimeIncrementalGzip<=budgets.runtimeIncrementalGzip,`deferred Runtime incremental static closure gzip ${runtimeIncrementalGzip} exceeds ${budgets.runtimeIncrementalGzip}`);
console.log(`PASS: Web bundle regression ceilings (entry closure ${indexGzip}B gzip; App chunk ${appChunkGzip}B, authenticated closure ${appClosureGzip}B; deferred Runtime chunk ${runtimeChunkGzip}B, incremental closure ${runtimeIncrementalGzip}B).`);
