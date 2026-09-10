import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {Plugin} from 'vite';
/** Only immutable application files; account/API responses and packages are never cached here. */
export function offlineShell():Plugin{return {name:'sensa-offline-shell',apply:'build',async closeBundle(){
 const assets=(await readdir('dist/assets')).filter(n=>!n.endsWith('.map')).map(n=>'/assets/'+n);
 const paths=['/index.html',...assets];const hash=createHash('sha256');for(const path of paths)hash.update(await readFile('dist'+path));
 const cache='sensa-shell-'+hash.digest('hex').slice(0,20);
 await writeFile('dist/sw.js',`const CACHE=${JSON.stringify(cache)},FILES=${JSON.stringify(paths)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('sensa-shell-')&&key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(request.mode==='navigate'){event.respondWith(fetch(request).then(response=>response.ok?response:caches.open(CACHE).then(cache=>cache.match('/index.html'))).catch(()=>caches.open(CACHE).then(cache=>cache.match('/index.html'))));return;}
 if(FILES.includes(url.pathname))event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.pathname))??fetch(request)));
});`);
}};}
