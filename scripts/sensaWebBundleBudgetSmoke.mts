import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

/**
 * Regression ceilings for the synchronous startup graph. Route-specific chunks
 * are intentionally outside this sum because they load only when opened.
 */
const budgets={
  indexGzip:310*1024,
  appGzip:290*1024,
  combinedGzip:590*1024,
} as const;

const assets=resolve('apps/web/dist/assets');
const files=await readdir(assets);
const findOne=(pattern:RegExp,label:string)=>{
  const matches=files.filter(file=>pattern.test(file));
  assert.equal(matches.length,1,`expected one ${label} chunk, found ${matches.join(', ')||'none'}`);
  return matches[0]!;
};
const gzipBytes=async(file:string)=>gzipSync(await readFile(resolve(assets,file))).byteLength;
const indexFile=findOne(/^index-[^.]+\.js$/u,'entry');
const appFile=findOne(/^App-[^.]+\.js$/u,'App');
const indexGzip=await gzipBytes(indexFile),appGzip=await gzipBytes(appFile);

assert(indexGzip<=budgets.indexGzip,`${indexFile} gzip ${indexGzip} exceeds ${budgets.indexGzip}`);
assert(appGzip<=budgets.appGzip,`${appFile} gzip ${appGzip} exceeds ${budgets.appGzip}`);
assert(indexGzip+appGzip<=budgets.combinedGzip,`startup JS gzip ${indexGzip+appGzip} exceeds ${budgets.combinedGzip}`);
console.log(`PASS: Web bundle regression ceilings (entry ${indexGzip}B gzip, App ${appGzip}B gzip, combined ${indexGzip+appGzip}B).`);
