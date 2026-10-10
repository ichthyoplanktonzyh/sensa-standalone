import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {offlineBrandFiles} from '../../../apps/web/offlineShell.ts';

test("offline-shell-artifact", async () => {
const listeners=new Map<string,(event:any)=>void>();
const stores=new Map<string,Map<string,Response>>([
 ['sensa-shell-core-ancient',new Map([['/assets/ancient.js',new Response('ancient')]])],
 ['sensa-shell-optional-ancient',new Map()],
 ['sensa-shell-core-previous',new Map([['/assets/previous.js',new Response('previous')]])],
 ['sensa-shell-optional-previous',new Map()],
]),deleted:string[]=[];
const source=await readFile(new URL('../../../apps/web/dist/sw.js',import.meta.url),'utf8');
const manifest=JSON.parse(await readFile(new URL('../../../apps/web/dist/manifest.webmanifest',import.meta.url),'utf8')) as {display?:string;start_url?:string;icons?:unknown[]};
let online=true;
let claimed=0,skipWaiting=0;
const assetNames=await readdir(new URL('../../../apps/web/dist/assets/',import.meta.url));
const lazyAssets=assetNames.filter(name=>!/\.(?:js|css|wasm|map)$/u.test(name));
const failedOptional=offlineBrandFiles[0],failedRequests=new Set<string>();
const failedInstallPaths=new Set<string>();
const cacheFor=(name:string)=>{
 const stored=stores.get(name)??new Map<string,Response>();stores.set(name,stored);
 const add=async(path:string)=>{if(failedInstallPaths.has(path))throw Error('fixture install code unavailable');const bytes=await readFile(new URL('../../../apps/web/dist'+path,import.meta.url));stored.set(path,new Response(bytes));};
 return {add,addAll:async(paths:string[])=>{for(const path of paths)await add(path);},match:async(path:string)=>stored.get(path)?.clone(),put:async(path:string,response:Response)=>{stored.set(path,response.clone());}};
};
runInNewContext(source,{URL,self:{
 location:{origin:'https://sensa.test'},
 clients:{claim:async()=>{claimed+=1;}},
 skipWaiting:async()=>{skipWaiting+=1;},
 addEventListener:(name:string,fn:any)=>listeners.set(name,fn),
},caches:{
 open:async(name:string)=>cacheFor(name),
 keys:async()=>[...stores.keys(),'unrelated-cache'],
 delete:async(key:string)=>{deleted.push(key);stores.delete(key);return true;},
 match:async(request:{url?:string}|string)=>{const path=typeof request==='string'?request:new URL(request.url!).pathname;for(const store of stores.values()){const found=store.get(path);if(found)return found.clone();}},
},fetch:async(request:{url:string})=>{const path=new URL(request.url).pathname;if(!online||failedRequests.has(path))throw Error('offline');return new Response('network');}});
for(const name of ['install','activate']){let work:Promise<unknown>|undefined;listeners.get(name)!({waitUntil:(p:Promise<unknown>)=>work=p});await work;}
listeners.get('message')!({data:{type:'IGNORED'}});listeners.get('message')!({data:{type:'SKIP_WAITING'}});await Promise.resolve();
const cacheEntries=[...stores.values()];
const stored=(path:string)=>[...stores.values()].some(cache=>cache.has(path));
assert(stored('/index.html'));
assert(stored('/manifest.webmanifest'));
assert.equal(manifest.display,'standalone');
assert.equal(manifest.start_url,'/');
assert((manifest.icons?.length??0)>=2);
for(const path of offlineBrandFiles)assert(stored(path),`brand resource ${path} must be cached before offline readiness`);
for(const name of lazyAssets)assert(!stored('/assets/'+name),'compiled media/fonts remain on demand when present');
const codeFiles=(await readdir(new URL('../../../apps/web/dist/assets/',import.meta.url))).filter(name=>/\.(?:js|css|wasm)$/u.test(name)).map(name=>'/assets/'+name);
assert(codeFiles.length>1);for(const path of codeFiles)assert(stored(path),`application code ${path} must be cached before offline readiness`);
assert.equal([...stores.keys()].filter(name=>name.startsWith('sensa-shell-core-')).length,2);
assert.equal([...stores.keys()].filter(name=>name.startsWith('sensa-shell-optional-')).length,2);
assert.deepEqual(deleted,['sensa-shell-core-ancient','sensa-shell-optional-ancient']);
assert.equal(claimed,1);
assert.equal(skipWaiting,1);
for(const path of [codeFiles[0]!,failedOptional]){
 failedInstallPaths.add(path);let failedInstall:Promise<unknown>|undefined;listeners.get('install')!({waitUntil:(work:Promise<unknown>)=>failedInstall=work});
 await assert.rejects(failedInstall!,/fixture install code unavailable/u);assert(stored('/assets/previous.js'),'a failed new install must preserve the previous release');failedInstallPaths.clear();
}
function dispatch(path:string,mode='cors',method='GET'){let response:Promise<Response>|undefined;listeners.get('fetch')!({request:{url:new URL(path,'https://sensa.test').href,mode,method},respondWith:(p:Promise<Response>)=>response=p});return response;}
assert.equal(await (await dispatch('/profile','navigate'))!.text(),'network');online=false;
assert.match(await (await dispatch('/profile','navigate'))!.text(),/<html/);
assert.equal(await (await dispatch('/assets/previous.js'))!.text(),'previous','the previous release asset remains available to an old tab');
for(const cache of cacheEntries)for(const path of cache.keys())assert((await dispatch(path))?.ok);
// Simulate eviction after a successful install, not missing brand assets at readiness.
for(const cache of cacheEntries)cache.delete(failedOptional);
online=true;failedRequests.add(failedOptional);await assert.rejects(dispatch(failedOptional)!);assert(!stored(failedOptional),'a failed optional request must not create a false cache entry');failedRequests.delete(failedOptional);
assert.equal(await (await dispatch(failedOptional))!.text(),'network');assert(stored(failedOptional),'a later request should populate the optional cache');online=false;
assert.equal(await (await dispatch(failedOptional))!.text(),'network','the repaired optional entry should work offline');
for(const path of ['/sensa/packages','/sensa/web/access/session','/sensa/models','https://catalog.test/package.json'])assert.equal(dispatch(path),undefined);
assert.equal(dispatch('/index.html','cors','POST'),undefined);
console.log('PASS: required shell/code/brand install, failed-install preservation, evicted optional asset repair, offline deep-link fallback, version cleanup and private-response exclusion.');

});
