import {readCloudSync,synchronizeLibrary,type SyncRequest} from '../../apps/web/src/data/library/cloudSync';
import {
  assertCurrentLibrary,
  openLibrary,
  readLibrary,
  readLocalLibraryRevision,
  restoreLibraryTransaction,
  writeLibraryState,
} from '../../apps/web/src/data/library/store';
import {librarySyncTables} from '../../packages/contracts/src/sensa/librarySync';

type ScaleResult={
  records:number;
  mediaRecords:number;
  logicalBytes:number;
  initialSyncMs:number;
  singleChangeSyncMs:number;
  changedCheckpointRecords:number;
  journalRowsRead:number;
  uploadedBlocks:number;
  uploadedChars:number;
  fetchedBlocks:number;
  stateBytes:number;
  heapDeltaBytes:number|null;
};

const owner={subject:'00000000-0000-4000-8000-000000000101',accountId:'00000000-0000-4000-8000-000000000102'};
const id=(index:number)=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const sharedImage=`data:image/jpeg;base64,${'YWJj'.repeat(16_384)}`;

function fakeCloud(){
  const blocks=new Map<string,string>(),commits=new Map<string,{digest:string;revision:number}>();
  let head:{revision:number;manifest:string[]|null}={revision:0,manifest:null};
  const metrics={uploadedBlocks:0,uploadedChars:0,fetchedBlocks:0};
  const request:SyncRequest=async(path,body:any)=>{
    if(path==='/head')return {...head,storage:{usedBytes:[...blocks.values()].reduce((sum,value)=>sum+value.length,0),capacityBytes:256*1024*1024}};
    if(path==='/blocks/missing')return {missing:body.hashes.filter((blockHash:string)=>!blocks.has(blockHash))};
    if(path==='/blocks/store'){
      for(const block of body.blocks){if(!blocks.has(block.hash)){metrics.uploadedBlocks++;metrics.uploadedChars+=block.data.length;}blocks.set(block.hash,block.data);}
      return {stored:true};
    }
    if(path==='/blocks/fetch'){
      const found=body.hashes.filter((blockHash:string)=>blocks.has(blockHash));metrics.fetchedBlocks+=found.length;
      return {blocks:found.map((blockHash:string)=>({hash:blockHash,data:blocks.get(blockHash)!})),missing:body.hashes.filter((blockHash:string)=>!blocks.has(blockHash)),deferred:[]};
    }
    if(path==='/commit'){
      const digest=JSON.stringify(body),prior=commits.get(body.operationId);
      if(prior){if(prior.digest!==digest)throw new Error('operation_conflict');return {...head,revision:prior.revision};}
      if(body.baseRevision!==head.revision)throw new Error('library_sync_conflict');
      if(body.manifest.some((blockHash:string)=>!blocks.has(blockHash)))throw new Error('library_sync_missing_block');
      head={revision:head.revision+1,manifest:[...body.manifest]};commits.set(body.operationId,{digest,revision:head.revision});return {...head};
    }
    throw new Error(`unexpected_request:${path}`);
  };
  return {request,metrics,resetMetrics(){metrics.uploadedBlocks=0;metrics.uploadedChars=0;metrics.fetchedBlocks=0;}};
}

export async function measureCloudSyncScale(records:number,mediaEvery:number):Promise<ScaleResult>{
  await openLibrary();
  await writeLibraryState(async tx=>tx.put('meta','service-owner',owner));
  await restoreLibraryTransaction(async tx=>{
    for(let index=0;index<records;index++){
      const createdAt='2026-09-21T00:00:00.000Z';
      tx.put('drafts',id(index+10),{
        id:id(index+10),revision:1,text:`scale ${index} ${'x'.repeat(256)}`,
        images:mediaEvery>0&&index%mediaEvery===0?[{id:id(index+records+100),name:`fixture-${index}.jpg`,dataUrl:sharedImage}]:[],
        createdAt,updatedAt:createdAt,
      });
    }
  });
  const initial=await readLibrary(async tx=>({
    incarnation:await assertCurrentLibrary(tx),
    revision:await readLocalLibraryRevision(tx),
    drafts:await tx.entries('drafts'),
  }));
  const cloud=fakeCloud(),initialStarted=performance.now();await synchronizeLibrary(cloud.request);const initialSyncMs=performance.now()-initialStarted;
  const target=id(10);
  await restoreLibraryTransaction(async tx=>{
    const draft=await tx.get<any>('drafts',target);
    tx.put('drafts',target,{...draft,revision:draft.revision+1,text:`${draft.text} changed`,updatedAt:'2026-09-21T00:01:00.000Z'});
  });
  const journal=await readLibrary(tx=>tx.changesSince(initial.revision,librarySyncTables));
  cloud.resetMetrics();
  const memory=performance as Performance&{memory?:{usedJSHeapSize:number}};
  const before=memory.memory?.usedJSHeapSize??null,started=performance.now();await synchronizeLibrary(cloud.request);const singleChangeSyncMs=performance.now()-started,after=memory.memory?.usedJSHeapSize??null;
  const state=await readCloudSync();
  return {
    records,
    mediaRecords:initial.drafts.filter(row=>Array.isArray((row.value as {images?:unknown[]}).images)&&(row.value as {images:unknown[]}).images.length>0).length,
    logicalBytes:initial.drafts.reduce((total,row)=>total+JSON.stringify(row.value).length,0),
    initialSyncMs,singleChangeSyncMs,
    changedCheckpointRecords:journal.filter(row=>row.value!==null&&(row.table!=='meta'||['identity','learning-active'].includes(row.key))).length,
    journalRowsRead:journal.length,
    uploadedBlocks:cloud.metrics.uploadedBlocks,
    uploadedChars:cloud.metrics.uploadedChars,
    fetchedBlocks:cloud.metrics.fetchedBlocks,
    stateBytes:JSON.stringify(state).length,
    heapDeltaBytes:before===null||after===null?null:Math.max(0,after-before),
  };
}
