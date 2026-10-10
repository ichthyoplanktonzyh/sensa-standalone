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
 return expectedFromRefs(records,identity,revision);
}
function expectedFromRefs(records:ReplicaCandidateRecord[],identity:Pick<LibraryIdentity,'id'|'learnerId'>,revision:number):ReplicaCandidateExpected{
 const manifest={version:6,libraryId:identity.id,learnerId:identity.learnerId,rows:records.map(record=>({table:record.table,key:record.key,blocks:record.blockRefs}))};
 const manifestBlocks=blocksForText(JSON.stringify(manifest));
 return {head:{revision,manifest:manifestBlocks.map(block=>block.hash)},manifestBlocks:[...new Map(manifestBlocks.map(block=>[block.hash,block])).values()]};
}
/** Large HTTP fixtures encode each body once; no second complete producer pass. */
export function candidateFixture(records:ReplicaCandidateRecord[],identity:Pick<LibraryIdentity,'id'|'learnerId'>,revision=3){
 const blocks=new Map<string,ReplicaCandidateBlock>();
 for(const record of records){const parts=blocksForText(record.valueJson);record.blockRefs=parts.map(block=>block.hash);for(const block of parts)blocks.set(block.hash,block);}
 return {expected:expectedFromRefs(records,identity,revision),blocks:[...blocks.values()]};
}
