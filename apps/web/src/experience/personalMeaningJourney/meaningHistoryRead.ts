import type {MeaningJourneyRecord,CommandReceipt} from './store';

/** Read-only historical facts; never feed these back into current membership. */
export const meaningHistoryRecords=(record:MeaningJourneyRecord):MeaningJourneyRecord[]=>
 [record,...(record.conflictHistory?.branches.map(branch=>branch.record)??[])];

type MediaSource={personalSemanticAnchorRevisions?:Array<{personalMediaObjectId?:string|null}>;conflictHistory?:{branches:Array<{record:MediaSource}>}};
export const meaningMediaReferences=(record:MediaSource)=>[record,...(record.conflictHistory?.branches.map(branch=>branch.record)??[])]
 .flatMap(branch=>branch.personalSemanticAnchorRevisions??[]).flatMap(revision=>revision.personalMediaObjectId?[revision.personalMediaObjectId]:[]);

export function assertCurrentMeaningReceipt(record:MeaningJourneyRecord|undefined,receipt:{command:string;result:Record<string,unknown>}){
 if(!['CorrectPersonalMeaning','ChangeMeaningLifecycle'].includes(receipt.command))return;
 if(record?.conflictHistory&&!record.personalMeaningRevisions.some(row=>row.personalMeaningRevisionId===receipt.result.personalMeaningRevisionId))throw Error('localFlow.meaningChanged');
}

export function hasSceneReceiptWitness(record:MeaningJourneyRecord|undefined,receipt:CommandReceipt){
 const result=receipt.result;
 return !!record&&record.personalMeaning.personalMeaningId===result.personalMeaningId&&record.personalSemanticAnchorRevisions.some(revision=>hasSceneContextReceiptWitness(revision,receipt));
}
export function hasSceneContextReceiptWitness(revision:MeaningJourneyRecord['personalSemanticAnchorRevisions'][number],receipt:CommandReceipt){
 const result=receipt.result;
 return receipt.command==='AcceptPublishedLearningScene'&&revision.personalSemanticAnchorId===result.personalSemanticAnchorId&&revision.personalSemanticAnchorRevisionId===result.personalSemanticAnchorRevisionId&&revision.provenance.createdByOperationId===(result.acceptedByOperationId??receipt.operationId);
}
export function assertArchivedSceneReceipts(record:MeaningJourneyRecord,read:(id:string)=>CommandReceipt|undefined){
 for(const branch of meaningHistoryRecords(record))for(const revision of branch.personalSemanticAnchorRevisions)if(revision.structuredPayload.learningScene){
  const receipt=read(revision.provenance.createdByOperationId);
  if(!receipt||!hasSceneContextReceiptWitness(revision,receipt))throw Error('meaning_scene_receipt_invalid');
 }
}
