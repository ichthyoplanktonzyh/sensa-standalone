import {semanticProposalSchema} from '@sensa/contracts/sensa';
import {z} from 'zod';

import {journeyStateFromRows,semanticJourneyTables} from '../../../experience/personalMeaningJourney/repository';
import {backupEqual} from '../backupCodec';
import type {BackupRows} from '../backupValidation';
import {conversationImagesSchema} from '../conversationImages';
import {parseStoredMedia} from '../media';
import type {Table} from '../store';

type RequireRow=(table:Table,id:string)=>any;

/** Validate Personal Semantic World objects and return its cross-domain source resolver. */
export function validatePersonalSemanticWorldReplica(input:{
 rows:BackupRows;
 maps:Record<Table,Map<string,any>>;
 requireRow:RequireRow;
 fail:()=>never;
}){
 const {rows,maps,requireRow,fail}=input,uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
 let semanticWorld:ReturnType<typeof journeyStateFromRows>|null=null;
 if(maps.semanticState.has('root'))try{
  semanticWorld=journeyStateFromRows(Object.fromEntries(semanticJourneyTables.map(table=>[table,rows[table]])) as Parameters<typeof journeyStateFromRows>[0]);
 }catch{fail();}
 for(const {key,value} of rows.media){const media=parseStoredMedia(value);if(media.mediaId!==key)fail();uuid.parse(key);}
 if(semanticWorld){
  for(const {key,value:meaning} of rows.semanticMeanings){
   if(meaning.personalMeaning.personalMeaningId!==key)fail();
  }
  for(const {key,value:row} of rows.semanticRegistry){
   const ids={senses:'senseId',senseVersions:'senseVersionId',expressions:'expressionId',expressionVersions:'expressionVersionId',bindings:'senseExpressionBindingId',bindingVersions:'bindingVersionId'} as const;
   const idField=ids[row.kind as keyof typeof ids],id=key.slice(key.indexOf(':')+1);
   if(!idField||!Number.isSafeInteger(row.ordinal)||row.ordinal<0||!key.startsWith(`${row.kind}:`)||row.value[idField]!==id)fail();
  }
  for(const {key,value:item} of rows.semanticInbox)if(item.intakeId!==key)fail();
  for(const {key,value:draft} of rows.semanticDrafts)if(draft.intakeId!==key)fail();
  for(const {key,value:receipt} of rows.semanticReceipts)if(receipt.operationId!==key)fail();
  for(const meaning of semanticWorld.meanings)for(const revision of meaning.personalSemanticAnchorRevisions)if(revision.personalMediaObjectId&&!maps.media.has(revision.personalMediaObjectId))fail();
  for(const item of semanticWorld.inboxItems)for(const mediaId of item.payload.context?.mediaReferenceIds??[])if(!maps.media.has(mediaId))fail();
 }
 const requirePersonalSource=(source:any)=>{
  const semantic=semanticWorld??fail();if(semantic.version!=='sensa-personal-meaning-journey-store-v5')fail();
  for(const field of ['personalMeaningId','personalMeaningRevisionId','personalMeaningAlignmentId','alignmentBasisReferenceId','senseId','senseVersionId','bindingId','bindingVersionId'])uuid.parse(source[field]);
  z.number().int().positive().parse(source.alignmentRevision);if(source.meaningFocusId!==null)uuid.parse(source.meaningFocusId);
  const record=semantic.meanings?.find((candidate:any)=>candidate.personalMeaning?.personalMeaningId===source.personalMeaningId&&candidate.personalMeaning?.status==='active')??fail();
  if(!record.personalMeaningRevisions.some((candidate:any)=>candidate.personalMeaningRevisionId===source.personalMeaningRevisionId))fail();
  const alignment=record.alignments.find((candidate:any)=>candidate.personalMeaningAlignmentId===source.personalMeaningAlignmentId&&candidate.status==='active')??fail();
  if(alignment.personalMeaningRevisionId!==source.personalMeaningRevisionId||alignment.revision!==source.alignmentRevision||alignment.senseId!==source.senseId||alignment.senseVersionId!==source.senseVersionId)fail();
  const basisReferenceId=alignment.basis.kind==='contextual_resolution'?alignment.basis.semanticAcceptanceId:alignment.basis.senseProposalConfirmationId;
  if(basisReferenceId!==source.alignmentBasisReferenceId||(alignment.basis.kind==='sense_construction'?alignment.basis.meaningFocusId:null)!==source.meaningFocusId)fail();
  const bindingVersion=semantic.registry?.bindingVersions?.find((candidate:any)=>candidate.bindingVersionId===source.bindingVersionId)??fail();
  const binding=semantic.registry?.bindings?.find((candidate:any)=>candidate.senseExpressionBindingId===source.bindingId)??fail();
  if(binding.currentBindingVersionId!==source.bindingVersionId||binding.senseId!==source.senseId||bindingVersion.senseExpressionBindingId!==source.bindingId||bindingVersion.senseVersionId!==source.senseVersionId)fail();
  return {record,alignment};
 };
 for(const {value:draft} of rows.drafts){uuid.parse(draft.id);z.number().int().positive().parse(draft.revision);z.string().max(16000).parse(draft.text);if(draft.images)conversationImagesSchema.parse(draft.images);timestamp.parse(draft.createdAt);timestamp.parse(draft.updatedAt);}
 for(const {value:session} of rows.sessions){const draft=requireRow('drafts',session.draftId);if(session.draftRevision>draft.revision)fail();if(session.candidate)semanticProposalSchema.parse(session.candidate);if(session.inputImages)conversationImagesSchema.parse(session.inputImages);if(session.contextSummary!==undefined)z.string().min(1).max(16000).parse(session.contextSummary);if(Array.isArray(session.messages))conversationImagesSchema.parse([...(session.inputImages??[]),...session.messages.flatMap((message:any)=>message.images??[])]);if(!Array.isArray(session.messages)||!Number.isInteger(session.revision)||session.revision<1)fail();if(!['idle','waiting','proposal','inflight','failed','stopped','accepted'].includes(session.status))fail();if(session.status==='accepted'&&requireRow('meanings',session.meaningId).sessionId!==session.id)fail();}
 for(const {key,value} of rows.identities){z.string().regex(/^[a-f0-9]{64}$/u).parse(key);for(const field of ['senseId','senseVersionId','bindingId','bindingVersionId'])uuid.parse(value[field]);}
 for(const {value:meaning} of rows.meanings){
  z.string().max(16000).parse(meaning.context);const revision=z.number().int().positive().parse(meaning.contextRevision??1);if((meaning.contextHistory?.length??0)!==revision-1)fail();if(meaning.contextImages)conversationImagesSchema.parse(meaning.contextImages);
  if(meaning.contextHistory)for(const [index,history] of meaning.contextHistory.entries()){if(history.revision!==index+1)fail();z.string().max(16000).parse(history.text);conversationImagesSchema.parse(history.images);}
  semanticProposalSchema.parse(meaning.proposal);for(const key of ['id','senseId','senseVersionId','bindingId','bindingVersionId','contextAnchorId','expressionAnchorId','alignmentId','acceptanceId'])uuid.parse(meaning[key]);
  const draft=requireRow('drafts',meaning.draftId),session=requireRow('sessions',meaning.sessionId);
  if(meaning.draftRevision>draft.revision||session.meaningId!==meaning.id||session.status!=='accepted'||!backupEqual(meaning.proposal,session.candidate)||(meaning.contextHistory?.[0]?.text??meaning.context)!==(session.contextSummary??session.input)||!rows.identities.some(({value})=>['senseId','senseVersionId','bindingId','bindingVersionId'].every(key=>value[key]===meaning[key])))fail();
 }
 return {requirePersonalSource};
}
