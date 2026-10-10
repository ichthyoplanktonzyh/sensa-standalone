import {semanticProposalSchema} from '@sensa/contracts/sensa';
import {z} from 'zod';

import {assertPersonalSemanticWorldRecordSteps} from '../../../experience/personalMeaningJourney/authority';
import {backupEqual} from '../backupCodec';
import {findLibraryRow,type LibraryRecordRows,type LibraryRecordLookups} from '../libraryRecordReader';
import {conversationImagesSchema} from '../conversationImages';
import {parseStoredMedia} from '../media';
import {alignmentStatusAt} from '../../../experience/personalMeaningJourney/alignmentLifecycle';
import type {MeaningJourneyRecord} from '../../../experience/personalMeaningJourney/store';
import {meaningHistoryRecords} from '../../../experience/personalMeaningJourney/meaningHistoryRead';
import type {Table} from '../store';
import {runSynchronously} from '../../../experience/personalMeaningJourney/cooperative';

type RequireRow=(table:Table,id:string)=>any;

/** Validate Personal Semantic World objects and return its cross-domain source resolver. */
export function* validatePersonalSemanticWorldReplicaSteps(input:{
 rows:LibraryRecordRows;
 maps:LibraryRecordLookups;
 requireRow:RequireRow;
 fail:()=>never;
}){
 const {rows,maps,requireRow,fail}=input,uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
 try{yield*assertPersonalSemanticWorldRecordSteps({get:(table,key)=>maps[table].get(key),entries:table=>rows[table]});}catch{fail();}
 for(const {key,value} of rows.media){const media=parseStoredMedia(value);if(media.mediaId!==key)fail();uuid.parse(key);yield;}
 for(const {value:meaning} of rows.semanticMeanings){for(const branch of meaningHistoryRecords(meaning))for(const revision of branch.personalSemanticAnchorRevisions)if(revision.personalMediaObjectId&&!maps.media.has(revision.personalMediaObjectId))fail();yield;}
 for(const {value:item} of rows.semanticInbox){for(const mediaId of item.payload.context?.mediaReferenceIds??[])if(!maps.media.has(mediaId))fail();yield;}
 const requirePersonalSource=(source:any)=>{
  if(!maps.semanticState.has('root'))fail();
  for(const field of ['personalMeaningId','personalMeaningRevisionId','personalMeaningAlignmentId','alignmentBasisReferenceId','senseId','senseVersionId','bindingId','bindingVersionId'])uuid.parse(source[field]);
  z.number().int().positive().parse(source.alignmentRevision);if(source.meaningFocusId!==null)uuid.parse(source.meaningFocusId);
  // A durable learning source pins historical facts, not today's World view.
  // Tombstoning the personal origin must not invalidate already accepted learning.
  const current=(maps.semanticMeanings.get(source.personalMeaningId) as MeaningJourneyRecord|undefined)??fail();
  const record=meaningHistoryRecords(current).find(branch=>branch.personalMeaningRevisions.some(row=>row.personalMeaningRevisionId===source.personalMeaningRevisionId)&&branch.alignments.some(row=>row.personalMeaningAlignmentId===source.personalMeaningAlignmentId))??fail();
  if(!record.personalMeaningRevisions.some((candidate:any)=>candidate.personalMeaningRevisionId===source.personalMeaningRevisionId))fail();
  const alignment=record.alignments.find((candidate:any)=>candidate.personalMeaningAlignmentId===source.personalMeaningAlignmentId)??fail();
  if(alignment.personalMeaningRevisionId!==source.personalMeaningRevisionId||alignment.revision!==source.alignmentRevision||alignment.senseId!==source.senseId||alignment.senseVersionId!==source.senseVersionId)fail();
  if(alignmentStatusAt(record.alignmentEvents,alignment.personalMeaningAlignmentId,source.alignmentRevision)!=='active')fail();
  const basisReferenceId=alignment.basis.kind==='contextual_resolution'?alignment.basis.semanticAcceptanceId:alignment.basis.senseProposalConfirmationId;
  if(basisReferenceId!==source.alignmentBasisReferenceId||(alignment.basis.kind==='sense_construction'?alignment.basis.meaningFocusId:null)!==source.meaningFocusId)fail();
  const bindingVersion=maps.semanticRegistry.get(`bindingVersions:${source.bindingVersionId}`)?.value??fail();
  const binding=maps.semanticRegistry.get(`bindings:${source.bindingId}`)?.value??fail();
  if(binding.senseId!==source.senseId||bindingVersion.senseExpressionBindingId!==source.bindingId||bindingVersion.senseVersionId!==source.senseVersionId)fail();
  const basis=alignment.basis;
  const proposalVersionId=basis.kind==='sense_construction'
    ?record.senseConfirmations.find(candidate=>candidate.senseProposalConfirmationId===basis.senseProposalConfirmationId)?.senseProposalVersionId:null;
  const expressionAnchorId=basis.kind==='contextual_resolution'
    ?record.semanticAcceptances.find(candidate=>candidate.semanticAcceptanceId===basis.semanticAcceptanceId)?.personalExpressionAnchorRevisionId:null;
  if(!record.bindingConfirmations.some(confirmation=>confirmation.bindingVersionId===source.bindingVersionId
    &&confirmation.senseVersionId===source.senseVersionId&&confirmation.expressionVersionId===bindingVersion.expressionVersionId
    &&confirmation.learnerUserId===record.personalMeaning.learnerUserId
    &&(alignment.basis.kind==='sense_construction'
      ?proposalVersionId!=null&&confirmation.senseProposalVersionId===proposalVersionId
      :expressionAnchorId!=null&&confirmation.senseProposalVersionId===null&&confirmation.personalExpressionAnchorRevisionId===expressionAnchorId)))fail();
  return {record,alignment};
 };
 for(const {value:draft} of rows.drafts){uuid.parse(draft.id);z.number().int().positive().parse(draft.revision);z.string().max(16000).parse(draft.text);if(draft.images)conversationImagesSchema.parse(draft.images);timestamp.parse(draft.createdAt);timestamp.parse(draft.updatedAt);yield;}
 for(const {value:session} of rows.sessions){const draft=requireRow('drafts',session.draftId);if(session.draftRevision>draft.revision)fail();if(session.candidate)semanticProposalSchema.parse(session.candidate);if(session.inputImages)conversationImagesSchema.parse(session.inputImages);if(session.contextSummary!==undefined)z.string().min(1).max(16000).parse(session.contextSummary);if(Array.isArray(session.messages))conversationImagesSchema.parse([...(session.inputImages??[]),...session.messages.flatMap((message:any)=>message.images??[])]);if(!Array.isArray(session.messages)||!Number.isInteger(session.revision)||session.revision<1)fail();if(!['idle','waiting','proposal','inflight','failed','stopped','accepted'].includes(session.status))fail();if(session.status==='accepted'&&requireRow('meanings',session.meaningId).sessionId!==session.id)fail();yield;}
 for(const {key,value} of rows.identities){z.string().regex(/^[a-f0-9]{64}$/u).parse(key);for(const field of ['senseId','senseVersionId','bindingId','bindingVersionId'])uuid.parse(value[field]);yield;}
 for(const {value:meaning} of rows.meanings){
  z.string().max(16000).parse(meaning.context);const revision=z.number().int().positive().parse(meaning.contextRevision??1);if((meaning.contextHistory?.length??0)!==revision-1)fail();if(meaning.contextImages)conversationImagesSchema.parse(meaning.contextImages);
  if(meaning.contextHistory)for(const [index,history] of meaning.contextHistory.entries()){if(history.revision!==index+1)fail();z.string().max(16000).parse(history.text);conversationImagesSchema.parse(history.images);}
  semanticProposalSchema.parse(meaning.proposal);for(const key of ['id','senseId','senseVersionId','bindingId','bindingVersionId','contextAnchorId','expressionAnchorId','alignmentId','acceptanceId'])uuid.parse(meaning[key]);
  const draft=requireRow('drafts',meaning.draftId),session=requireRow('sessions',meaning.sessionId);
  if(meaning.draftRevision>draft.revision||session.meaningId!==meaning.id||session.status!=='accepted'||!backupEqual(meaning.proposal,session.candidate)||(meaning.contextHistory?.[0]?.text??meaning.context)!==(session.contextSummary??session.input)||!findLibraryRow(rows.identities,({value})=>['senseId','senseVersionId','bindingId','bindingVersionId'].every(key=>value[key]===meaning[key])))fail();
  yield;
 }
 return {requirePersonalSource};
}

export function validatePersonalSemanticWorldReplica(input:Parameters<typeof validatePersonalSemanticWorldReplicaSteps>[0]){
 return runSynchronously(validatePersonalSemanticWorldReplicaSteps(input));
}
