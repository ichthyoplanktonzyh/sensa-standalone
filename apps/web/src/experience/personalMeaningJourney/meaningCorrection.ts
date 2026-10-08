/** Explicit correction of one accepted connection. No model, IO or learning writes. */
import {sensaIntakeContextSchema,sensaIntakePayloadSchema,type SensaIntakeContext,type SensaIntakePayload} from '@sensa/contracts/sensa';
import type {MeaningJourneyRecord,CommandReceipt} from './store';
import {isAlignmentActive} from './alignmentLifecycle';
import {readRegistry,type RegistryRead} from './registryRead';
import {digestOf} from './digest';
import type {CorrectPersonalMeaningResult} from './types';
import {currentMeaningContextRevisions} from './meaningRecords';
export {currentMeaningContextRevisions} from './meaningRecords';

export const correctionReason='personal_meaning_correction';
export function meaningCorrectionContext(record:MeaningJourneyRecord,revisionIds:readonly string[]):SensaIntakeContext{
 const revisions=currentMeaningContextRevisions(record),ids=revisions.map(row=>row.personalSemanticAnchorRevisionId);
 if(record.personalMeaning.status!=='active'||!ids.length||digestOf(ids)!==digestOf(revisionIds))throw Error('localFlow.meaningChanged');
 const text=revisions.flatMap(row=>row.bodyText?[row.bodyText]:[]).join('\n\n')||null;
 const mediaReferenceIds=[...new Set(revisions.flatMap(row=>[...(row.personalMediaObjectId?[row.personalMediaObjectId]:[]),...(Array.isArray(row.structuredPayload.media)?row.structuredPayload.media.map((item:any)=>item.mediaId):[])]))];
 const languageTags=[...new Set(revisions.map(row=>row.languageTag))],sources=revisions.map(row=>row.structuredPayload.source??null);
 return sensaIntakeContextSchema.parse({modality:text?mediaReferenceIds.length?'mixed':'text':revisions.every(row=>row.anchorKind==='audio')?'audio':'image',textSegment:text,mediaReferenceIds,languageTag:languageTags.length===1?languageTags[0]:null,languageObservation:revisions.length===1?revisions[0]!.structuredPayload.languageObservation??null:null,source:sources.every(source=>digestOf(source)===digestOf(sources[0]))?sources[0]:null});
}

/** Presentation-only editing seed; null acceptance is intentional until Save. */
export function meaningCorrectionPayload(record:MeaningJourneyRecord,registry:RegistryRead,alignmentId:string):SensaIntakePayload{
 const alignment=record.alignments.find(row=>row.personalMeaningAlignmentId===alignmentId&&isAlignmentActive(record,row));
 if(!alignment||record.personalMeaning.status!=='active')throw Error('localFlow.meaningChanged');
 const basis=alignment.basis;
 const acceptance=basis.kind==='contextual_resolution'?record.semanticAcceptances.find(row=>row.semanticAcceptanceId===basis.semanticAcceptanceId):null;
 const contextRevisions=currentMeaningContextRevisions(record),contextIds=contextRevisions.map(row=>row.personalSemanticAnchorRevisionId);
 const confirmation=meaningCorrectionBinding(record,alignment);
 const expressionVersion=confirmation&&readRegistry(registry,'expressionVersions',confirmation.expressionVersionId),expression=expressionVersion&&readRegistry(registry,'expressions',expressionVersion.expressionId);
 const sense=readRegistry(registry,'senses',alignment.senseId),senseVersion=readRegistry(registry,'senseVersions',alignment.senseVersionId);
 if(!contextIds.length||!expression||!expressionVersion||!sense||!senseVersion)throw Error('localFlow.meaningChanged');
 return sensaIntakePayloadSchema.parse({contractVersion:'sensa-intake-v3',operationId:record.alignmentEvents.find(row=>row.personalMeaningAlignmentId===alignmentId&&row.ordinal===1)!.operationId,capturedAt:record.personalMeaning.updatedAt,
  context:meaningCorrectionContext(record,contextIds),
  expression:{surfaceForm:expressionVersion.surfaceForm,languageTag:expression.languageTag,expressionTypeHint:expression.expressionType,occurrence:{surfaceForm:expressionVersion.surfaceForm,locator:{kind:'personal_meaning',personalMeaningId:record.personalMeaning.personalMeaningId,personalSemanticAnchorRevisionIds:contextIds}}},
  sense:{senseKey:sense.senseKey,semanticSpec:senseVersion.semanticSpec,wordingSource:acceptance?record.personalMeaningRevisions.find(row=>row.personalMeaningRevisionId===alignment.personalMeaningRevisionId)?.provenance.kind??'imported':'imported',resolutionProvenance:{resolverKind:'learner',provider:'sensa-web-correction',model:null,policyVersion:null,sourceReferenceIds:[senseVersion.senseVersionId]}},acceptance:null,
 });
}
export function meaningCorrectionBinding(record:MeaningJourneyRecord,alignment:MeaningJourneyRecord['alignments'][number]){
 const basis=alignment.basis;
 const acceptance=basis.kind==='contextual_resolution'?record.semanticAcceptances.find(row=>row.semanticAcceptanceId===basis.semanticAcceptanceId):null;
 const proposal=basis.kind==='sense_construction'?record.senseConfirmations.find(row=>row.senseProposalConfirmationId===basis.senseProposalConfirmationId):null;
 return record.bindingConfirmations.find(row=>row.senseVersionId===alignment.senseVersionId&&(basis.kind==='contextual_resolution'?row.senseProposalVersionId===null&&row.personalExpressionAnchorRevisionId===acceptance?.personalExpressionAnchorRevisionId:row.senseProposalVersionId===proposal?.senseProposalVersionId));
}

/** Structural source validation is also used by the read-only World index. */
export function meaningCorrectionFacts(record:MeaningJourneyRecord){
 const facts:Array<{operationId:string;result:Omit<CorrectPersonalMeaningResult,'replayed'>}>=[];
 for(const event of record.alignmentEvents)if(event.ordinal>1){
  if(event.eventType!=='withdrawn'||event.reason!==correctionReason)throw Error('meaning_correction_invalid');
  const confirmations=record.alignmentEvents.filter(row=>row.ordinal===1&&row.operationId===event.operationId);
  if(confirmations.length!==1)throw Error('meaning_correction_invalid');
  const confirmed=confirmations[0]!,replacement=record.alignments.find(row=>row.personalMeaningAlignmentId===confirmed.personalMeaningAlignmentId),revision=record.personalMeaningRevisions.find(row=>row.personalMeaningRevisionId===replacement?.personalMeaningRevisionId);
  if(!replacement||replacement.basis.kind!=='contextual_resolution'||replacement.personalMeaningAlignmentId===event.personalMeaningAlignmentId||!revision||revision.provenance.createdByOperationId!==event.operationId||confirmed.occurredAt!==event.occurredAt||confirmed.reason!==null)throw Error('meaning_correction_invalid');
  const acceptance=record.semanticAcceptances.find(row=>replacement.basis.kind==='contextual_resolution'&&row.semanticAcceptanceId===replacement.basis.semanticAcceptanceId);
  if(!acceptance||acceptance.operationId!==event.operationId||acceptance.acceptedAt!==event.occurredAt||!record.bindingConfirmations.some(row=>row.senseProposalVersionId===null&&row.personalExpressionAnchorRevisionId===acceptance.personalExpressionAnchorRevisionId&&row.senseVersionId===acceptance.senseVersionId))throw Error('meaning_correction_invalid');
  facts.push({operationId:event.operationId,result:{personalMeaningId:record.personalMeaning.personalMeaningId,personalMeaningRevisionId:revision.personalMeaningRevisionId,revision:revision.revision,replacedAlignmentId:event.personalMeaningAlignmentId,personalMeaningAlignmentId:replacement.personalMeaningAlignmentId}});
 }
 return facts;
}
/** Tie every structural replacement to its exact durable operation receipt. */
export function assertMeaningCorrectionReceiptFacts(record:MeaningJourneyRecord,read:(operationId:string)=>CommandReceipt|undefined){
 for(const fact of meaningCorrectionFacts(record)){
  const receipt=read(fact.operationId);if(receipt?.command!=='CorrectPersonalMeaning'||digestOf(receipt.result)!==digestOf(fact.result))throw Error('meaning_correction_invalid');
 }
}
/** Reverse witness check also rejects an orphan receipt in a streamed replica. */
export function assertMeaningCorrectionOperationReceipt(record:MeaningJourneyRecord|undefined,receipt:CommandReceipt){
 if(receipt.command!=='CorrectPersonalMeaning')return;
 const fact=record&&meaningCorrectionFacts(record).find(fact=>fact.operationId===receipt.operationId);
 if(!fact||receipt.result.personalMeaningId!==record!.personalMeaning.personalMeaningId||digestOf(receipt.result)!==digestOf(fact.result))throw Error('meaning_correction_invalid');
}
export function assertMeaningCorrectionReceipts(record:MeaningJourneyRecord,receipts:readonly CommandReceipt[]){
 const byId=new Map(receipts.map(row=>[row.operationId,row]));
 assertMeaningCorrectionReceiptFacts(record,id=>byId.get(id));
 for(const receipt of receipts)if(receipt.command==='CorrectPersonalMeaning'&&receipt.result.personalMeaningId===record.personalMeaning.personalMeaningId)assertMeaningCorrectionOperationReceipt(record,receipt);
}
