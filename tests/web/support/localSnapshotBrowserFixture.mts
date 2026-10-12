import {createServer} from 'node:http';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {createServer as viteServer} from 'vite';
import type {Browser} from 'playwright-core';
export async function createLocalSnapshotBrowserFixture(browser:Browser){
 const root=process.cwd(),entry=resolve(root,'scripts/support/localSnapshotBrowserEntry.ts');
 const vite=await viteServer({root:resolve(root,'apps/web'),configFile:resolve(root,'apps/web/vite.config.ts'),logLevel:'error',server:{host:'127.0.0.1',middlewareMode:true,hmr:false,fs:{allow:[root]}}});
 const server=createServer((req,res)=>{if(req.url==='/'){res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end(`<!doctype html><title>Local snapshot fixture</title><script type="module">import * as api from '/@fs/${entry.replace(/^\/+/, '')}';window.snapshotApi=api;</script>`);}else vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});});
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('snapshot_loopback_port_missing');
 const origin='http://127.0.0.1:'+address.port,context=await browser.newContext(),externalRequests:string[]=[];
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){externalRequests.push(url.origin);return route.abort();}return route.continue();});
 const createPage=async()=>{const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!(window as any).snapshotApi);return page;};
 return {origin,context,createPage,externalRequests,async close(){await context.close();await vite.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
