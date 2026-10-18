/** Real Chromium/OPFS scale measurement. No account, network, model, or TTS calls. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {build as viteBuild} from 'vite';

const built=await viteBuild({
  configFile:false,root:process.cwd(),logLevel:'silent',base:'/',
  worker:{format:'es'},
  build:{write:false,target:'es2022',rollupOptions:{
    preserveEntrySignatures:'strict',
    input:resolve('scripts/support/cloudSyncScaleBrowserEntry.ts'),
    output:{entryFileNames:'core.js',chunkFileNames:'assets/[name]-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'},
  }},
});
if(Array.isArray(built))throw new Error('Expected one browser benchmark bundle');
const files=new Map(built.output.map(file=>[file.fileName,file.type==='chunk'?file.code:file.source]));
const server=createServer((request,response)=>{
  const path=(request.url??'/').split('?')[0]!.replace(/^\//u,'');
  const asset=files.get(path);
  if(asset===undefined){response.setHeader('content-type','text/html');response.end('<!doctype html><title>Cloud sync scale</title>');return;}
  response.setHeader('content-type',path.endsWith('.wasm')?'application/wasm':'text/javascript');
  response.end(typeof asset==='string'?asset:Buffer.from(asset));
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.SENSA_CHROMIUM_PATH,args:['--enable-precise-memory-info']});
try{
  const results=[] as Array<Record<string,number|null>>;
  for(const scenario of [{records:1_000,mediaEvery:100},{records:10_000,mediaEvery:500}]){
    const context=await browser.newContext(),page=await context.newPage();await page.addInitScript('window.__name = fn => fn;');await page.goto(origin);
    const result=await page.evaluate(async input=>(await import(/* @vite-ignore */ '/core.js')).measureCloudSyncScale(input.records,input.mediaEvery),scenario);
    results.push(result);
    assert.equal(result.noChangeBaselineBodies,0,'an unchanged head read baseline bodies');
    assert.equal(result.noChangeBaselineWrites,0,'an unchanged head rewrote baselines');
    assert.equal(result.fullBaselineReads,0,'a single local edit read all baseline bodies');
    assert.equal(result.fullBaselineReplacements,0,'a single local edit replaced the baseline');
    assert.equal(result.sourceTableReads,0,'a single local edit enumerated source tables');
    assert.equal(result.changedBaselineBodies,1,'a single local edit read unrelated baseline bodies');
    assert.equal(result.changedBaselineWrites,1,'a single local edit wrote unrelated baseline bodies');
    assert.equal(result.metadataRows,0,'a single local edit read the entire reference directory');
    assert.equal(result.changedCheckpointRecords,1,`${scenario.records} records did not narrow a single-record edit`);
    assert(result.journalRowsRead<=2,`${scenario.records} records read ${result.journalRowsRead} journal rows for one edit`);
    assert(result.stateBytes<16*1024,`${scenario.records} records leaked the checkpoint baseline back into cloud-sync state`);
    assert(result.uploadedBlocks<=3,`${scenario.records} records uploaded ${result.uploadedBlocks} new blocks for one record change`);
    assert(result.uploadedChars<512*1024,`${scenario.records} records uploaded ${result.uploadedChars} characters for one record change`);
    assert.equal((await page.evaluate(()=>window.__sensaBrowserSmoke)),undefined);
    await context.close();
  }
  console.table(results.map(row=>({
    records:row.records,mediaRecords:row.mediaRecords,logicalMiB:Number((Number(row.logicalBytes)/1048576).toFixed(2)),
    initialSyncMs:Number(Number(row.initialSyncMs).toFixed(1)),noChangeSyncMs:Number(Number(row.noChangeSyncMs).toFixed(1)),singleChangeSyncMs:Number(Number(row.singleChangeSyncMs).toFixed(1)),
    baselineBodies:row.changedBaselineBodies,baselineWrites:row.changedBaselineWrites,metadataRows:row.metadataRows,
    journalRowsRead:row.journalRowsRead,uploadedBlocks:row.uploadedBlocks,uploadedKiB:Number((Number(row.uploadedChars)/1024).toFixed(1)),fetchedBlocks:row.fetchedBlocks,stateKiB:Number((Number(row.stateBytes)/1024).toFixed(1)),
    heapDeltaMiB:row.heapDeltaBytes===null?null:Number((Number(row.heapDeltaBytes)/1048576).toFixed(2)),
  })));
  console.log('PASS: real Chromium/OPFS sync at 1k/10k scale has zero unchanged baseline body reads/writes and one changed baseline body read/write. The cursor patch reads no complete key/block reference directory. Controlled Draft/media/transport, not Sense or Learning-history capacity; timings and end-of-operation heap delta are not CWV or peak memory guarantees.');
}finally{
  await browser.close();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
}
