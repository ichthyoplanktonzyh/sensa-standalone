import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {offlineBrandFiles} from '../apps/web/offlineShell.ts';
const listeners=new Map<string,(event:any)=>void>();
const stored=new Map<string,Response>(),deleted:string[]=[];
const source=await readFile(new URL('../apps/web/dist/sw.js',import.meta.url),'utf8');
let online=true;
const cache={addAll:async(paths:string[])=>{for(const path of paths){const bytes=await readFile(new URL('../apps/web/dist'+path,import.meta.url));stored.set(path,new Response(bytes));}},match:async(path:string)=>stored.get(path)?.clone()};
runInNewContext(source,{URL,self:{location:{origin:'https://sensa.test'},addEventListener:(name:string,fn:any)=>listeners.set(name,fn)},caches:{open:async()=>cache,keys:async()=>['sensa-shell-old','unrelated-cache'],delete:async(key:string)=>{deleted.push(key);return true;}},fetch:async()=>{if(!online)throw Error('offline');return new Response('network');}});
for(const name of ['install','activate']){let work:Promise<unknown>|undefined;listeners.get(name)!({waitUntil:(p:Promise<unknown>)=>work=p});await work;}
assert(stored.has('/index.html'));for(const path of offlineBrandFiles)assert(stored.has(path),`offline shell omitted ${path}`);assert.deepEqual(deleted,['sensa-shell-old']);
function dispatch(path:string,mode='cors',method='GET'){let response:Promise<Response>|undefined;listeners.get('fetch')!({request:{url:new URL(path,'https://sensa.test').href,mode,method},respondWith:(p:Promise<Response>)=>response=p});return response;}
assert.equal(await (await dispatch('/profile','navigate'))!.text(),'network');online=false;
assert.match(await (await dispatch('/profile','navigate'))!.text(),/<html/);
for(const path of stored.keys())assert((await dispatch(path))?.ok);
for(const path of ['/sensa/packages','/sensa/web/access/session','/sensa/models','https://catalog.test/package.json'])assert.equal(dispatch(path),undefined);
assert.equal(dispatch('/index.html','cors','POST'),undefined);
console.log('PASS: generated shell precache, offline deep-link fallback, version cleanup and API/private-response exclusion (VM, no browser).');
