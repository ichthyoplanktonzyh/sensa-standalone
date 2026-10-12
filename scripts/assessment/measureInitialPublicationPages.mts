/** Small representative transport-only views of the retained valid fixture.
 * They are intentionally incomplete Libraries: no validate/publish/restore claim. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createLibraryCloudBrowserFixture} from '../../tests/web/support/libraryCloudBrowserFixture.mts';
const option=(key:string,fallback:string)=>process.argv.find(x=>x.startsWith('--'+key+'='))?.slice(key.length+3)??fallback;
const root=resolve(option('output','output/playwright/initial-publication-structural-59b4960e-20261012/pages')),sourcePath=resolve(option('fixture','.tmp/retention-capacity-facts-pmMaMk'));
await mkdir(root,{recursive:true});const manifestBytes=await readFile(join(sourcePath,'manifest.json')),source=JSON.parse(manifestBytes.toString()),f=await createLibraryCloudBrowserFixture(undefined,resolve('scripts/assessment/capacityBrowserEntry.ts'));
const report:any={fixtureSha256:createHash('sha256').update(manifestBytes).digest('hex'),conditions:'Cold isolated Chromium/OPFS + real SQLite/Wasm; selected valid Run/installation facts form an incomplete transport-only Library view, never admitted or published. No full sync, no model/TTS, no SQL profiling.',pages:[]};
try{
 const account=await f.createAccount(),page=await f.createClient(account),chosen=[...source.batches.filter((b:any)=>b.table==='learningRuns').slice(0,1),...source.batches.filter((b:any)=>b.table==='packageInstallations').slice(0,2)];
 const expected:any={};for(const batch of chosen){const bytes=await readFile(join(sourcePath,batch.file));assert.equal(createHash('sha256').update(bytes).digest('hex'),batch.sha256);await page.evaluate(async({table,text})=>{const c=(window as any).core;await c.restoreLibraryTransaction(async(tx:any)=>{for(const row of c.decodeBackupValue(JSON.parse(text)))tx.put(table,row.key,row.value);});},{table:batch.table,text:bytes.toString()});}
 const begun=await page.evaluate(async()=>{const c=(window as any).core,fence=await c.readLibrary(async(tx:any)=>({owner:await tx.get('meta','service-owner'),identity:await tx.get('meta','identity'),incarnation:await c.assertCurrentLibrary(tx),localRevision:await c.readLocalLibraryRevision(tx)}));return c.requestReplicaCandidate({kind:'beginPublication',fence:{...fence,owner:{subject:fence.owner.subject,accountId:fence.owner.accountId}}});});
 let after:any=null;
 for(let ordinal=0;ordinal<10;ordinal++){
  const result=await page.evaluate(async({id,after})=>{const c=(window as any).core,start=performance.now(),captured=await c.requestReplicaCandidate({kind:'publicationPage',id,after}),elapsedMs=performance.now()-start;const hashes=[...new Set<string>(captured.rows.flatMap((row:any)=>row.blocks))],blocks=new Map<string,string>();let wireBytes=0,windows=0;
   for(let at=0;at<hashes.length;at+=512){let pending=hashes.slice(at,at+512);while(pending.length){const reply=await c.requestReplicaCandidate({kind:'publicationBlocks',id,hashes:pending});wireBytes+=new TextEncoder().encode(JSON.stringify({blocks:reply.blocks})).length;windows++;for(const block of reply.blocks)blocks.set(block.hash,block.data);pending=reply.deferred;}}
   return {captured,elapsedMs,wireBytes,windows,blocks:[...blocks]};
  },{id:begun.id,after});
  // Decode with the same contract in Node outside the timed page capture.
  const {decodeLibrarySyncBlock}=await import('../../packages/contracts/src/sensa/librarySyncBlocks');const blocks=new Map<string,string>(result.blocks),decoded=result.captured.rows.map((row:any)=>({...row,text:row.blocks.map((hash:string)=>decodeLibrarySyncBlock(blocks.get(hash)!)).join('')}));
  const local=await page.evaluate(async(rows:any[])=>{const c=(window as any).core;return c.readLibrary(async(tx:any)=>{const identity=await tx.get('meta','identity');return Promise.all(rows.map(async row=>{const value=await tx.get(row.table,row.key);return {table:row.table,key:row.key,text:JSON.stringify(c.encodeBackupValue(c.normalizeLibraryReplicaEntry({...row,value},identity).value))};}));});},result.captured.rows.map((row:any)=>({table:row.table,key:row.key})));
  assert.deepEqual(decoded.map((row:any)=>({table:row.table,key:row.key,text:row.text})),local);
  const repeated=await page.evaluate(({id,after})=>(window as any).core.requestReplicaCandidate({kind:'publicationPage',id,after}),{id:begun.id,after});assert.deepEqual(repeated,result.captured);
  report.pages.push({ordinal,records:decoded.length,tables:[...new Set(decoded.map((row:any)=>row.table))],logicalBytes:decoded.reduce((n:number,row:any)=>n+Buffer.byteLength(row.text),0),encodedBlockBytes:[...blocks.values()].reduce((n,data)=>n+Buffer.byteLength(data),0),referenceOccurrences:decoded.reduce((n:number,row:any)=>n+row.blocks.length,0),wireBytes:result.wireBytes,blockWindows:result.windows,captureMs:result.elapsedMs,stats:result.captured.stats,exactWire:true,duplicatePageCountersUnchanged:true});after=result.captured.next;if(result.captured.done)break;
 }
 assert(report.pages.some((p:any)=>p.tables.length===1&&p.tables[0]==='learningRuns'&&p.records===64));assert(report.pages.some((p:any)=>p.tables.length===1&&p.tables[0]==='packageInstallations'&&p.records===64));
 if(process.argv.includes('--large-row')){
  const large=await f.createClient(await f.createAccount()),result=await large.evaluate(async()=>{
   const c=(window as any).core;await c.restoreLibraryTransaction((tx:any)=>tx.put('drafts','large-record',{id:'large-record',text:'a'.repeat(65*1048576)}));
   const fence=await c.readLibrary(async(tx:any)=>({owner:await tx.get('meta','service-owner'),identity:await tx.get('meta','identity'),incarnation:await c.assertCurrentLibrary(tx),localRevision:await c.readLocalLibraryRevision(tx)})),begun=await c.requestReplicaCandidate({kind:'beginPublication',fence:{...fence,owner:{subject:fence.owner.subject,accountId:fence.owner.accountId}}});
   const at=performance.now(),captured=await c.requestReplicaCandidate({kind:'publicationPage',id:begun.id,after:null}),elapsedMs=performance.now()-at,row=captured.rows.find((row:any)=>row.table==='drafts'),hashes=[...new Set<string>(row.blocks)],blocks=[];
   let pending=hashes;while(pending.length){const reply=await c.requestReplicaCandidate({kind:'publicationBlocks',id:begun.id,hashes:pending});blocks.push(...reply.blocks);pending=reply.deferred;}
   const expected=await c.readLibrary(async(tx:any)=>JSON.stringify(c.encodeBackupValue(c.normalizeLibraryReplicaEntry({table:'drafts',key:'large-record',value:await tx.get('drafts','large-record')},fence.identity).value))),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(expected));
   return {captured,elapsedMs,row,blocks,expectedHash:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),expectedBytes:new TextEncoder().encode(expected).length};
  });
  const {decodeLibrarySyncBlock}=await import('../../packages/contracts/src/sensa/librarySyncBlocks'),blocks=new Map(result.blocks.map((block:any)=>[block.hash,block.data]));
  const digest=createHash('sha256');for(const hash of result.row.blocks)digest.update(decodeLibrarySyncBlock(blocks.get(hash) as string));assert.equal(digest.digest('hex'),result.expectedHash);assert(result.expectedBytes>64*1048576&&result.expectedBytes<=90*1048576);
  report.largeRow={logicalBytes:result.expectedBytes,uniqueEncodedBytes:result.blocks.reduce((n:number,block:any)=>n+Buffer.byteLength(block.data),0),refs:result.row.blocks.length,captureMs:result.elapsedMs,exactWire:true,stats:result.captured.stats,conditions:'Synthetic 65 MiB transport-only Draft tests retained 90 MiB single-row exception; no domain or publication claim.'};
 }
 await writeFile(join(root,'measurements.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await f.close();}
