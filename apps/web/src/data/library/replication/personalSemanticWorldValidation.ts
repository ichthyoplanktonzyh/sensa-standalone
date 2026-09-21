import {
 sensaConfirmExpressionBindingFactSchema,
 sensaConfirmSenseProposalFactSchema,
 sensaExpressionSnapshotSchema,
 sensaExpressionVersionSnapshotSchema,
 sensaIntakeItemSchema,
 sensaMeaningFocusAcceptanceFactSchema,
 sensaMeaningFocusRevisionSnapshotSchema,
 sensaMeaningFocusSnapshotSchema,
 sensaPersonalExpressionAnchorRevisionSnapshotSchema,
 sensaPersonalExpressionAnchorSnapshotSchema,
 sensaPersonalMeaningAlignmentEventSchema,
 sensaPersonalMeaningAlignmentSnapshotSchema,
 sensaPersonalMeaningRevisionSnapshotSchema,
 sensaPersonalMeaningSnapshotSchema,
 sensaPersonalSemanticAnchorRevisionSnapshotSchema,
 sensaPersonalSemanticAnchorSnapshotSchema,
 sensaSemanticAcceptanceFactSchema,
 sensaSenseConstructionSnapshotSchema,
 sensaSenseConstructionTurnSchema,
 sensaSenseExpressionBindingSnapshotSchema,
 sensaSenseExpressionBindingVersionSnapshotSchema,
 sensaSenseProposalSnapshotSchema,
 sensaSenseProposalVersionSnapshotSchema,
 sensaSenseSnapshotSchema,
 sensaSenseVersionSnapshotSchema,
 semanticProposalSchema,
} from '@sensa/contracts/sensa';
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
 const semanticWorld=maps.semanticState.has('root')
  ?journeyStateFromRows(Object.fromEntries(semanticJourneyTables.map(table=>[table,rows[table]])) as Parameters<typeof journeyStateFromRows>[0])
  :null;
 for(const {key,value} of rows.media){const media=parseStoredMedia(value);if(media.mediaId!==key)fail();uuid.parse(key);}
 if(semanticWorld){
  const schemas={
   personalMeaning:sensaPersonalMeaningSnapshotSchema,
   personalMeaningRevisions:sensaPersonalMeaningRevisionSnapshotSchema,
   personalSemanticAnchors:sensaPersonalSemanticAnchorSnapshotSchema,
   personalSemanticAnchorRevisions:sensaPersonalSemanticAnchorRevisionSnapshotSchema,
   personalExpressionAnchors:sensaPersonalExpressionAnchorSnapshotSchema,
   personalExpressionAnchorRevisions:sensaPersonalExpressionAnchorRevisionSnapshotSchema,
   focuses:sensaMeaningFocusSnapshotSchema,
   focusRevisions:sensaMeaningFocusRevisionSnapshotSchema,
   focusAcceptances:sensaMeaningFocusAcceptanceFactSchema,
   constructions:sensaSenseConstructionSnapshotSchema,
   constructionTurns:sensaSenseConstructionTurnSchema,
   proposals:sensaSenseProposalSnapshotSchema,
   proposalVersions:sensaSenseProposalVersionSnapshotSchema,
   senseConfirmations:sensaConfirmSenseProposalFactSchema,
   semanticAcceptances:sensaSemanticAcceptanceFactSchema,
   alignments:sensaPersonalMeaningAlignmentSnapshotSchema,
   alignmentEvents:sensaPersonalMeaningAlignmentEventSchema,
   bindingConfirmations:sensaConfirmExpressionBindingFactSchema,
  } as const;
  const unique=(facts:any[],id:(fact:any)=>string,slot?:(fact:any)=>string)=>{
   const ids=new Set<string>(),slots=new Set<string>();
   for(const fact of facts){const identity=id(fact);if(ids.has(identity))fail();ids.add(identity);if(slot){const position=slot(fact);if(slots.has(position))fail();slots.add(position);}}
  };
  for(const {key,value:meaning} of rows.semanticMeanings){
   if(sensaPersonalMeaningSnapshotSchema.parse(meaning.personalMeaning).personalMeaningId!==key)fail();
   for(const [field,schema] of Object.entries(schemas)){
    const facts=field==='personalMeaning'?[meaning.personalMeaning]:meaning[field];if(!Array.isArray(facts))fail();
    for(const fact of facts)(schema as z.ZodType).parse(fact);
   }
   unique(meaning.personalMeaningRevisions,(fact:any)=>fact.personalMeaningRevisionId,(fact:any)=>`${fact.personalMeaningId}:${fact.revision}`);
   unique(meaning.personalSemanticAnchors,(fact:any)=>fact.personalSemanticAnchorId);
   unique(meaning.personalSemanticAnchorRevisions,(fact:any)=>fact.personalSemanticAnchorRevisionId,(fact:any)=>`${fact.personalSemanticAnchorId}:${fact.revision}`);
   unique(meaning.personalExpressionAnchors,(fact:any)=>fact.personalExpressionAnchorId);
   unique(meaning.personalExpressionAnchorRevisions,(fact:any)=>fact.personalExpressionAnchorRevisionId,(fact:any)=>`${fact.personalExpressionAnchorId}:${fact.revision}`);
   unique(meaning.focuses,(fact:any)=>fact.meaningFocusId);
   unique(meaning.focusRevisions,(fact:any)=>fact.meaningFocusRevisionId,(fact:any)=>`${fact.meaningFocusId}:${fact.revision}`);
   unique(meaning.focusAcceptances,(fact:any)=>fact.meaningFocusAcceptanceId);
   unique(meaning.constructions,(fact:any)=>fact.senseConstructionId);
   unique(meaning.constructionTurns,(fact:any)=>fact.constructionTurnId,(fact:any)=>`${fact.senseConstructionId}:${fact.ordinal}`);
   unique(meaning.proposals,(fact:any)=>fact.senseProposalId);
   unique(meaning.proposalVersions,(fact:any)=>fact.senseProposalVersionId,(fact:any)=>`${fact.senseProposalId}:${fact.version}`);
   unique(meaning.senseConfirmations,(fact:any)=>fact.senseProposalConfirmationId);
   unique(meaning.semanticAcceptances,(fact:any)=>fact.semanticAcceptanceId);
   unique(meaning.alignments,(fact:any)=>fact.personalMeaningAlignmentId);
   unique(meaning.alignmentEvents,(fact:any)=>fact.personalMeaningAlignmentEventId,(fact:any)=>`${fact.personalMeaningAlignmentId}:${fact.ordinal}`);
   unique(meaning.bindingConfirmations,(fact:any)=>fact.expressionBindingConfirmationId);
   if(!meaning.personalMeaningRevisions.some((fact:any)=>fact.personalMeaningId===key&&fact.revision===meaning.personalMeaning.currentRevision))fail();
   for(const anchor of meaning.personalSemanticAnchors)if(!meaning.personalSemanticAnchorRevisions.some((fact:any)=>fact.personalSemanticAnchorId===anchor.personalSemanticAnchorId&&fact.revision===anchor.currentRevision))fail();
   for(const anchor of meaning.personalExpressionAnchors)if(!meaning.personalExpressionAnchorRevisions.some((fact:any)=>fact.personalExpressionAnchorId===anchor.personalExpressionAnchorId&&fact.revision===anchor.currentRevision))fail();
   for(const focus of meaning.focuses)if(!meaning.focusRevisions.some((fact:any)=>fact.meaningFocusId===focus.meaningFocusId&&fact.revision===focus.currentRevision))fail();
   for(const proposal of meaning.proposals)if(!meaning.proposalVersions.some((fact:any)=>fact.senseProposalId===proposal.senseProposalId&&fact.version===proposal.currentVersion))fail();
  }
  const registrySchemas={senses:sensaSenseSnapshotSchema,senseVersions:sensaSenseVersionSnapshotSchema,expressions:sensaExpressionSnapshotSchema,expressionVersions:sensaExpressionVersionSnapshotSchema,bindings:sensaSenseExpressionBindingSnapshotSchema,bindingVersions:sensaSenseExpressionBindingVersionSnapshotSchema} as const;
  const registryIds={senses:'senseId',senseVersions:'senseVersionId',expressions:'expressionId',expressionVersions:'expressionVersionId',bindings:'senseExpressionBindingId',bindingVersions:'bindingVersionId'} as const;
  const registrySlots=new Set<string>();
  for(const {key,value:row} of rows.semanticRegistry){
   const kind=row.kind as keyof typeof registrySchemas,schema=registrySchemas[kind];if(!schema)fail();
   if(!Number.isSafeInteger(row.ordinal)||row.ordinal<0)fail();
   const fact=(schema as z.ZodType).parse(row.value) as Record<string,unknown>,id=key.slice(key.indexOf(':')+1);
   if(!key.startsWith(`${kind}:`)||fact[registryIds[kind]]!==id)fail();
   const parent=kind==='senseVersions'?fact.senseId:kind==='expressionVersions'?fact.expressionId:kind==='bindingVersions'?fact.senseExpressionBindingId:undefined;
   if(parent!==undefined){const slot=`${kind}:${String(parent)}:${String(fact.versionNumber)}`;if(registrySlots.has(slot))fail();registrySlots.add(slot);}
   const pointer=kind==='senses'?{kind:'senseVersions',id:fact.currentSenseVersionId,parentField:'senseId',parentId:fact.senseId}:kind==='expressions'?{kind:'expressionVersions',id:fact.currentExpressionVersionId,parentField:'expressionId',parentId:fact.expressionId}:kind==='bindings'?{kind:'bindingVersions',id:fact.currentBindingVersionId,parentField:'senseExpressionBindingId',parentId:fact.senseExpressionBindingId}:undefined;
   if(pointer){const version=requireRow('semanticRegistry',`${pointer.kind}:${String(pointer.id)}`);if(version.value.versionNumber!==fact.currentVersionNumber||version.value[pointer.parentField]!==pointer.parentId)fail();}
  }
  for(const {value:item} of rows.semanticInbox)sensaIntakeItemSchema.parse(item);
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
