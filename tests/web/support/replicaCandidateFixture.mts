/** Genuine content-addressed v6 wire for controlled candidate storage tests. */
import {sha256} from '@sensa/learning-kernel';
import {splitLibrarySyncText,encodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
import type {LibraryIdentity} from '../../../apps/web/src/data/library/store';
import type {ReplicaCandidateBlock,ReplicaCandidateExpected,ReplicaCandidateRecord} from '../../../apps/web/src/data/library/replicaCandidateProtocol';

const blocksForText=(text:string):ReplicaCandidateBlock[]=>splitLibrarySyncText(text).map(part=>{const data=encodeLibrarySyncBlock(part);return {hash:sha256(data),data};});
export function candidateBlocksFor(records:readonly ReplicaCandidateRecord[]):ReplicaCandidateBlock[]{
 return [...new Map(records.flatMap(record=>blocksForText(record.valueJson)).map(block=>[block.hash,block])).values()];
}
/** Fixture construction assigns the real refs to its owned mutable records. */
export function candidateExpected(records:ReplicaCandidateRecord[],identity:Pick<LibraryIdentity,'id'|'learnerId'>,revision=3):ReplicaCandidateExpected{
 for(const record of records)record.blockRefs=blocksForText(record.valueJson).map(block=>block.hash);
 const manifest={version:6,libraryId:identity.id,learnerId:identity.learnerId,rows:records.map(record=>({table:record.table,key:record.key,blocks:record.blockRefs}))};
 const manifestBlocks=blocksForText(JSON.stringify(manifest));
 return {head:{revision,manifest:manifestBlocks.map(block=>block.hash)},manifestBlocks:[...new Map(manifestBlocks.map(block=>[block.hash,block])).values()]};
}
