import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {offlineBrandFiles} from '../apps/web/offlineShell.ts';
const listeners=new Map<string,(event:any)=>void>();
const stores=new Map<string,Map<string,Response>>(),deleted:string[]=[];
const source=await readFile(new URL('../apps/web/dist/sw.js',import.meta.url),'utf8');
const manifest=JSON.parse(await readFile(new URL('../apps/web/dist/manifest.webmanifest',import.meta.url),'utf8')) as {display?:string;start_url?:string;icons?:unknown[]};
let online=true;
const failedOptional=offlineBrandFiles[0],failedRequests=new Set<string>();
const cacheFor=(name:string)=>{
 const stored=stores.get(name)??new Map<string,Response>();stores.set(name,stored);
 const add=async(path:string)=>{const bytes=await readFile(new URL('../apps/web/dist'+path,import.meta.url));stored.set(path,new Response(bytes));};
 return {add,addAll:async(paths:string[])=>{for(const path of paths)await add(path);},match:async(path:string)=>stored.get(path)?.clone(),put:async(path:string,response:Response)=>{stored.set(path,response.clone());}};
};
runInNewContext(source,{URL,self:{location:{origin:'https://sensa.test'},addEventListener:(name:string,fn:any)=>listeners.set(name,fn)},caches:{open:async(name:string)=>cacheFor(name),keys:async()=>['sensa-shell-old','unrelated-cache'],delete:async(key:string)=>{deleted.push(key);return true;}},fetch:async(request:{url:string})=>{const path=new URL(request.url).pathname;if(!online||failedRequests.has(path))throw Error('offline');return new Response('network');}});
for(const name of ['install','activate']){let work:Promise<unknown>|undefined;listeners.get(name)!({waitUntil:(p:Promise<unknown>)=>work=p});await work;}
const cacheEntries=[...stores.values()];
const stored=(path:string)=>[...stores.values()].some(cache=>cache.has(path));
assert(stored('/index.html'));
assert(stored('/manifest.webmanifest'));
assert.equal(manifest.display,'standalone');
assert.equal(manifest.start_url,'/');
assert((manifest.icons?.length??0)>=2);
for(const path of offlineBrandFiles)assert(!stored(path),`optional resource ${path} should be cached on demand`);
assert.equal([...stores.keys()].filter(name=>name.startsWith('sensa-shell-core-')).length,1);
assert.equal([...stores.keys()].filter(name=>name.startsWith('sensa-shell-optional-')).length,0);
assert.deepEqual(deleted,['sensa-shell-old']);
function dispatch(path:string,mode='cors',method='GET'){let response:Promise<Response>|undefined;listeners.get('fetch')!({request:{url:new URL(path,'https://sensa.test').href,mode,method},respondWith:(p:Promise<Response>)=>response=p});return response;}
assert.equal(await (await dispatch('/profile','navigate'))!.text(),'network');online=false;
assert.match(await (await dispatch('/profile','navigate'))!.text(),/<html/);
for(const cache of cacheEntries)for(const path of cache.keys())assert((await dispatch(path))?.ok);
online=true;failedRequests.add(failedOptional);await assert.rejects(dispatch(failedOptional)!);assert(!stored(failedOptional),'a failed optional request must not create a false cache entry');failedRequests.delete(failedOptional);
assert.equal(await (await dispatch(failedOptional))!.text(),'network');assert(stored(failedOptional),'a later request should populate the optional cache');online=false;
assert.equal(await (await dispatch(failedOptional))!.text(),'network','the repaired optional entry should work offline');
for(const path of ['/sensa/packages','/sensa/web/access/session','/sensa/models','https://catalog.test/package.json'])assert.equal(dispatch(path),undefined);
assert.equal(dispatch('/index.html','cors','POST'),undefined);
console.log('PASS: required shell install, lazy optional cache, isolated optional failure, runtime repair, offline deep-link fallback, version cleanup and private-response exclusion.');
