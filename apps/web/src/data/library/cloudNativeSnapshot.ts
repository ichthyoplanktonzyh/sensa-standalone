import {librarySyncBlockFetchResult,librarySyncBlockMissingResult,librarySyncBlockStoreBatch,librarySyncBlockStoreBytes,librarySyncNativeDescriptorText,librarySyncNativeSnapshot,type LibrarySyncHead,type LibrarySyncNativeSnapshot} from '@sensa/contracts/sensa';
import {sha256} from '@sensa/learning-kernel';
import {encodeLibrarySyncBinaryChunk,decodeLibrarySyncBinaryChunk,librarySyncBinaryChunkBytes} from '@sensa/contracts/sensa/library-sync-blocks';
import {prepareAdmittedSnapshotFile} from './sqliteSnapshotProducer';
import {snapshotFiles,writeSnapshotFile} from './sqliteSnapshotFiles';
import type {SqliteRecordAdapter} from './sqliteAdapter';
import type {SnapshotSourceFence} from './sqliteSnapshotSource';
import type {SyncRequest} from './cloudSync';
import type {CloudSyncDeadline} from './cloudSyncDeadline';

/** Prepare and upload bounded blocks, then attach once at the unchanged H. */
export async function publishNativeCloudSnapshot(adapter:SqliteRecordAdapter,fence:SnapshotSourceFence,head:LibrarySyncHead,request:SyncRequest,deadline:CloudSyncDeadline){
 deadline.beginInitial();const started=performance.now(),prepared=await prepareAdmittedSnapshotFile(adapter,fence,deadline.signal,step=>deadline.progress('snapshot-'+step.stage,Math.floor(step.bytes??step.work?.portableRows??step.wallMs??0)));
 try{
  if(!head.manifest||prepared.metadata.revision!==head.revision||head.manifest.libraryId!==prepared.metadata.libraryId||head.manifest.learnerId!==prepared.metadata.learnerId||head.manifest.records!==prepared.metadata.records)throw Error('library_sync_head_changed');
  const preparedAt=performance.now(),refs:string[]=[],sent=new Set<string>();let batch:Array<{hash:string;data:string}>=[],batchBytes=13,storedBytes=0,storeRequests=0;
  const flush=async()=>{if(!batch.length)return;const missing=new Set(librarySyncBlockMissingResult.parse(await request('/blocks/missing',{hashes:batch.map(block=>block.hash)})).missing);if([...missing].some(ref=>!batch.some(block=>block.hash===ref)))throw Error('library_sync_format');const blocks=batch.filter(block=>missing.has(block.hash));if(blocks.length){await request('/blocks/store',{blocks});storedBytes+=new TextEncoder().encode(JSON.stringify({blocks})).length;storeRequests++;}batch=[];batchBytes=13;};
  for(let at=0;at<prepared.byteLength;at+=librarySyncBinaryChunkBytes){
   deadline.check();const bytes=new Uint8Array(await prepared.file.slice(at,at+librarySyncBinaryChunkBytes).arrayBuffer()),data=await encodeLibrarySyncBinaryChunk(bytes),block={hash:sha256(data),data};refs.push(block.hash);
   if(!sent.has(block.hash)){const cost=new TextEncoder().encode(JSON.stringify(block)).length+1;if(batch.length&&(batch.length>=librarySyncBlockStoreBatch||batchBytes+cost>librarySyncBlockStoreBytes))await flush();batch.push(block);batchBytes+=cost;sent.add(block.hash);}
   deadline.progress('snapshot-upload',Math.min(at+bytes.byteLength,prepared.byteLength));
  }
  await flush();await prepared.verify();
  const descriptor={...prepared.metadata,sha256:prepared.sha256,byteLength:prepared.byteLength,blocks:refs},nativeSnapshot=librarySyncNativeSnapshot.parse({...descriptor,manifestHash:sha256(librarySyncNativeDescriptorText(descriptor as Omit<LibrarySyncNativeSnapshot,'manifestHash'>))});
  const uploadedAt=performance.now();let result:LibrarySyncHead;
  try{result=await request('/compact',{baseRevision:head.revision,nativeSnapshot});}
  catch(error){deadline.check();const latest:LibrarySyncHead=await request('/head');if(latest.revision!==head.revision||latest.nativeSnapshot?.manifestHash!==nativeSnapshot.manifestHash)throw error;result=latest;}
  // A transport may omit negotiated response fields; read the capable head and
  // require the exact descriptor, including after an uncertain retry.
  if(!result.nativeSnapshot)throw Error('library_sync_incompatible_checkpoint');
  const attached=librarySyncNativeSnapshot.parse(result.nativeSnapshot);
  if(JSON.stringify(attached)!==JSON.stringify(nativeSnapshot))throw Error('library_sync_head_changed');
  return {nativeSnapshot,timingsMs:{sourcePreparation:preparedAt-started,upload:uploadedAt-preparedAt,attach:performance.now()-uploadedAt,total:performance.now()-started},work:{rawBytes:prepared.byteLength,orderedBlocks:refs.length,uniqueBlocks:sent.size,storeRequests,storeJsonBytes:storedBytes,sourceTransfer:prepared.sourceTransfer,source:prepared.work}};
 }finally{await prepared.discard();}
}

/** Decode only one bounded response window; never allocate the whole file. */
export async function receiveNativeCloudSnapshot(binding:LibrarySyncNativeSnapshot,request:SyncRequest,deadline:CloudSyncDeadline){
 deadline.beginInitial();if(sha256(librarySyncNativeDescriptorText(binding))!==binding.manifestHash)throw Error('sqlite_snapshot_checkpoint_binding');
 const files=await snapshotFiles(),started=performance.now();let at=0,window:string[]=[],loaded=new Map<string,string>(),offset=0,fetchRequests=0,fetchJsonBytes=0;
 const stream=new ReadableStream<Uint8Array>({async pull(target){try{
  deadline.check();if(at===binding.blocks.length){target.close();return;}
  if(!window.length){window=binding.blocks.slice(at,at+16);let pending=[...new Set(window)];loaded=new Map();
   while(pending.length){const reply=librarySyncBlockFetchResult.parse(await request('/blocks/fetch',{hashes:pending}));fetchRequests++;fetchJsonBytes+=new TextEncoder().encode(JSON.stringify(reply)).length;
    const returned=reply.blocks.map(block=>block.hash),all=[...returned,...reply.deferred];
    if(reply.missing.length||!returned.length||new Set(all).size!==all.length||all.length!==pending.length||all.some(ref=>!pending.includes(ref)))throw Error('library_sync_missing_block');
    for(const block of reply.blocks){if(sha256(block.data)!==block.hash)throw Error('library_sync_hash');loaded.set(block.hash,block.data);}pending=reply.deferred;
   }
  }
  const ref=window.shift()!,bytes=decodeLibrarySyncBinaryChunk(loaded.get(ref)!);at++;offset+=bytes.byteLength;if(offset>binding.byteLength)throw Error('library_sync_hash');target.enqueue(bytes);deadline.progress('snapshot-download',offset);
 }catch(error){target.error(error);}}},{highWaterMark:0});
 try{const result=await writeSnapshotFile(files.directory,'received.sqlite3',stream,binding.byteLength,deadline.signal);if(result.byteLength!==binding.byteLength||result.sha256!==binding.sha256)throw Error('library_sync_hash');return {...result,discard:files.discard,timingsMs:{download:performance.now()-started},work:{fetchRequests,fetchJsonBytes,decodedChunks:at}};}
 catch(error){await files.discard();throw error;}
}

/** Only an artifact rejection can use refs. Cancellation, uncertain cleanup,
 * account changes and local/head races must preserve their original failure. */
export function nativeSnapshotArtifactFailure(error:unknown):boolean{
 return error instanceof Error&&['library_sync_hash','library_sync_format','library_sync_missing_block','sqlite_snapshot_checkpoint_binding','sqlite_snapshot_envelope','sqlite_snapshot_schema_allowlist','sqlite_snapshot_device_storage','sqlite_snapshot_native_relations','sqlite_snapshot_integrity','sqlite_snapshot_identity','sqlite_snapshot_admission'].includes(error.message);
}
