/** Real Chromium comparison of durable SQLite Wasm OPFS commit profiles. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {test} from '@playwright/test';
import {build as viteBuild} from 'vite';

test.setTimeout(180_000);

test('durable OPFS profiles survive abrupt Worker termination with intact rows',async({page})=>{
const built=await viteBuild({
  configFile:false,
  worker:{format:'es'},
  root:process.cwd(),
  logLevel:'silent',
  base:'/',
  build:{
    write:false,
    target:'es2022',
    rollupOptions:{
      preserveEntrySignatures:'strict',
      input:resolve('scripts/support/sqliteOpfsBenchmarkBrowserEntry.ts'),
      output:{
        entryFileNames:'core.js',
        chunkFileNames:'assets/[name]-[hash].js',
        assetFileNames:'assets/[name]-[hash][extname]',
      },
    },
  },
});
if(Array.isArray(built)||!('output' in built))throw new Error('Expected one browser benchmark bundle');
const files=new Map(built.output.map(file=>[
  file.fileName,
  file.type==='chunk'?file.code:file.source,
]));
const server=createServer((request,response)=>{
  const path=(request.url??'/').split('?')[0]!.replace(/^\//u,'');
  const asset=files.get(path);
  if(asset===undefined){
    response.setHeader('content-type','text/html');
    response.end('<!doctype html><title>SQLite OPFS benchmark</title>');
    return;
  }
  response.setHeader('content-type',path.endsWith('.wasm')?'application/wasm':'text/javascript');
  response.end(typeof asset==='string'?asset:Buffer.from(asset));
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
try{
  await page.goto(origin);
  const result=await page.evaluate(async()=>{
    const modulePath='/core.js';
    const module=await import(/* @vite-ignore */ modulePath);
    return module.benchmarkSqliteOpfs();
  }) as {
    transactions:number;
    measured:Array<{name:string;count:number;integrity:string;journal:string;synchronous:number;locking:string;totalMs:number;p50Ms:number;p95Ms:number}>;
    verified:Array<{name:string;count:number;integrity:string;journal:string;synchronous:number;locking:string}>;
  };
  const expected=(result.transactions+10)*4;
  for(const row of [...result.measured,...result.verified]){
    assert.equal(row.count,expected,`${row.name} lost committed rows`);
    assert.equal(row.integrity,'ok',`${row.name} failed quick_check`);
    assert.equal(row.locking,'exclusive',`${row.name} did not acquire exclusive locking first`);
  }
  assert.equal(result.measured.find(row=>row.name==='persist-full')?.journal,'persist');
  assert.equal(result.measured.find(row=>row.name==='wal-full')?.journal,'wal');
  assert.equal(result.measured.find(row=>row.name==='wal-full')?.synchronous,2);
  console.table(result.measured.map(({name,journal,synchronous,totalMs,p50Ms,p95Ms})=>({
    name,journal,synchronous,
    totalMs:Number(totalMs.toFixed(1)),
    p50Ms:Number(p50Ms.toFixed(2)),
    p95Ms:Number(p95Ms.toFixed(2)),
  })));
}finally{
  await new Promise<void>(resolve=>server.close(()=>resolve()));
}
});
