import {readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import type {Plugin} from 'vite';

export const offlineBrandFiles = [
 '/brand/sensa/v1/svg/lockup/sensa-lockup-horizontal-color.svg',
 '/brand/sensa/v1/svg/lockup/sensa-lockup-horizontal-reverse.svg',
 '/brand/sensa/v1/svg/mark/sensa-mark-ink.svg',
 '/brand/sensa/v1/svg/mark/sensa-mark-reverse.svg',
 '/brand/sensa/v1/icons/favicon-color.ico',
 '/brand/sensa/v1/icons/favicon-color.svg',
 '/brand/sensa/v1/icons/apple-touch-icon.png',
 '/brand/sensa/v1/icons/safari-pinned-tab.svg',
] as const;

function entryAssets(indexHtml:string):string[]{
 return [...indexHtml.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/gu)].map(match=>match[1]!);
}

/** Only immutable application files; account/API responses and packages are never cached here. */
export function offlineShell():Plugin{let output='dist';return {configResolved(config){output=resolve(config.root,config.build.outDir);},name:'sensa-offline-shell',apply:'build',async writeBundle(){
 const assets=(await readdir(resolve(output,'assets'))).filter(n=>!n.endsWith('.map')).map(n=>'/assets/'+n);
 const html=await readFile(resolve(output,'index.html'),'utf8');
 const coreFiles=['/index.html','/manifest.webmanifest',...entryAssets(html)];
 const coreSet=new Set(coreFiles);
 const optionalFiles=[...assets.filter(path=>!coreSet.has(path)),...offlineBrandFiles];
 const paths=[...coreFiles,...optionalFiles];const hash=createHash('sha256');for(const path of paths)hash.update(await readFile(resolve(output,'.'+path)));
 const version=hash.digest('hex').slice(0,20),coreCache='sensa-shell-core-'+version,optionalCache='sensa-shell-optional-'+version;
 await writeFile(resolve(output,'sw.js'),`const VERSION=${JSON.stringify(version)},CORE_CACHE=${JSON.stringify(coreCache)},OPTIONAL_CACHE=${JSON.stringify(optionalCache)},CORE_FILES=${JSON.stringify(coreFiles)},OPTIONAL_FILES=${JSON.stringify(optionalFiles)};
const OFFLINE_CODE_FILES=OPTIONAL_FILES.filter(path=>/\\.(?:js|css|wasm)$/.test(path));
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const core=await caches.open(CORE_CACHE);await core.addAll(CORE_FILES);
 // Code fetched before first control was never intercepted. Cache executable
 // application files before reporting readiness; media/Books stay on demand.
 const optional=await caches.open(OPTIONAL_CACHE);await optional.addAll(OFFLINE_CODE_FILES);
})()));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')void self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys(),shellKeys=keys.filter(key=>key.startsWith('sensa-shell-'));
 const versions=[VERSION,...shellKeys.slice().reverse().map(key=>key.slice(key.lastIndexOf('-')+1)).filter(value=>value!==VERSION)];
 const retained=new Set(versions.slice(0,2));
 await Promise.all(shellKeys.filter(key=>!retained.has(key.slice(key.lastIndexOf('-')+1))).map(key=>caches.delete(key)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(request.mode==='navigate'){event.respondWith(fetch(request).then(response=>response.ok?response:caches.open(CORE_CACHE).then(cache=>cache.match('/index.html'))).catch(()=>caches.open(CORE_CACHE).then(cache=>cache.match('/index.html'))));return;}
 if(CORE_FILES.includes(url.pathname)){event.respondWith(caches.open(CORE_CACHE).then(async cache=>(await cache.match(url.pathname))??fetch(request)));return;}
 if(OPTIONAL_FILES.includes(url.pathname))event.respondWith(caches.open(OPTIONAL_CACHE).then(async cache=>{
  const cached=await cache.match(url.pathname);if(cached)return cached;
  const response=await fetch(request);if(response.ok)await cache.put(url.pathname,response.clone());return response;
 }));
 else if(url.pathname.startsWith('/assets/'))event.respondWith(caches.match(request).then(cached=>cached??fetch(request)));
});`);
}};}
