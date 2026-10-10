import {librarySyncHead,librarySyncBlock,librarySyncBlockChars,librarySyncManifest,type LibrarySyncManifest} from '@sensa/contracts/sensa';
import {decodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
import {sha256} from '@sensa/learning-kernel';
import type {ReplicaCandidateBlock,ReplicaCandidateExpected} from './replicaCandidateProtocol';

export const replicaCandidateProofBatchBytes=4*1024*1024;
const maximumManifestBytes=64*1024*1024;
const utf8=(text:string)=>new TextEncoder().encode(text).length;

/** A raw address proves the exact transport; its decoded digest subsequently
 * checks a row slice without retaining another full copy of shared media. */
export function verifyReplicaCandidateBlock(input:ReplicaCandidateBlock){
 const block=librarySyncBlock.parse(input);
 if(sha256(block.data)!==block.hash)throw Error('library_sync_hash');
 const text=decodeLibrarySyncBlock(block.data);
 return {hash:block.hash,plainDigest:sha256(text),plainChars:text.length,plainBytes:utf8(text),text};
}

export function verifyReplicaCandidateManifest(input:ReplicaCandidateExpected):{head:ReplicaCandidateExpected['head'];manifest:LibrarySyncManifest}{
 const head=librarySyncHead.parse(input.head);if(head.manifest===null)throw Error('library_sync_candidate_invalid');
 if(!Array.isArray(input.manifestBlocks)||input.manifestBlocks.length>2048)throw Error('library_sync_candidate_invalid');
 let storedBytes=0;
 for(const block of input.manifestBlocks){
  if(typeof block?.data!=='string'||block.data.length>librarySyncBlockChars)throw Error('library_sync_candidate_invalid');
  storedBytes+=utf8(block.data);if(storedBytes>maximumManifestBytes)throw Error('library_sync_capacity');
 }
 const requested=new Set(head.manifest),parts=new Map<string,string>();let decodedBytes=0;
 for(const block of input.manifestBlocks){
  if(!requested.has(block.hash)||parts.has(block.hash))throw Error('library_sync_candidate_invalid');
  const verified=verifyReplicaCandidateBlock(block);decodedBytes+=verified.plainBytes;
  if(decodedBytes>maximumManifestBytes)throw Error('library_sync_capacity');
  parts.set(verified.hash,verified.text);
 }
 let bytes=0;const text=head.manifest.map(hash=>{
  const part=parts.get(hash);if(part===undefined)throw Error('library_sync_missing_block');
  bytes+=utf8(part);if(bytes>maximumManifestBytes)throw Error('library_sync_capacity');return part;
 }).join('');
 const manifest=librarySyncManifest.parse(JSON.parse(text));
 if(!manifest.rows.length)throw Error('library_sync_candidate_invalid');
 return {head,manifest};
}
