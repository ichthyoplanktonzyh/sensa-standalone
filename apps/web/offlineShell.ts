import {readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import type {Plugin} from 'vite';
/** Only immutable application files; account/API responses and packages are never cached here. */
export function offlineShell():Plugin{let output='dist';return {configResolved(config){output=resolve(config.root,config.build.outDir);},name:'sensa-offline-shell',apply:'build',async writeBundle(){
 const assets=(await readdir(resolve(output,'assets'))).filter(n=>!n.endsWith('.map')).map(n=>'/assets/'+n);
 const paths=['/index.html',...assets];const hash=createHash('sha256');for(const path of paths)hash.update(await readFile(resolve(output,'.'+path)));
 const cache='sensa-shell-'+hash.digest('hex').slice(0,20);
 await writeFile(resolve(output,'sw.js'),`const CACHE=${JSON.stringify(cache)},FILES=${JSON.stringify(paths)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('sensa-shell-')&&key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(request.mode==='navigate'){event.respondWith(fetch(request).then(response=>response.ok?response:caches.open(CACHE).then(cache=>cache.match('/index.html'))).catch(()=>caches.open(CACHE).then(cache=>cache.match('/index.html'))));return;}
 if(FILES.includes(url.pathname))event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.pathname))??fetch(request)));
});`);
}};}
