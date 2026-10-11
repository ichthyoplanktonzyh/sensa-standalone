/** The eligibility rule shared by in-memory and durable search projections. */
import type {MeaningJourneyRecord,SenseRegistryState} from './store';
import type {MeaningLookupMatch} from './meaningLookup';
import {isAlignmentActive} from './alignmentLifecycle';
type Fact<K extends keyof MeaningJourneyRecord>=MeaningJourneyRecord[K] extends Array<infer T>?T:never;
export type MeaningLookupFacts={
 personalMeaning:Pick<MeaningJourneyRecord['personalMeaning'],'personalMeaningId'|'learnerUserId'|'status'>;
 personalMeaningRevisions:Array<Pick<Fact<'personalMeaningRevisions'>,'personalMeaningRevisionId'|'personalMeaningId'>>;
 personalSemanticAnchors:Array<Pick<Fact<'personalSemanticAnchors'>,'personalSemanticAnchorId'|'personalMeaningId'>>;
 personalSemanticAnchorRevisions:Array<Pick<Fact<'personalSemanticAnchorRevisions'>,'personalSemanticAnchorRevisionId'|'personalSemanticAnchorId'>>;
 personalExpressionAnchors:Array<Pick<Fact<'personalExpressionAnchors'>,'personalExpressionAnchorId'|'personalMeaningId'>>;
 personalExpressionAnchorRevisions:Array<Pick<Fact<'personalExpressionAnchorRevisions'>,'personalExpressionAnchorRevisionId'|'personalExpressionAnchorId'>>;
 focuses:Array<Pick<Fact<'focuses'>,'meaningFocusId'|'personalMeaningId'>>;
 focusRevisions:Array<Pick<Fact<'focusRevisions'>,'meaningFocusRevisionId'|'meaningFocusId'>>;
 constructions:Array<Pick<Fact<'constructions'>,'senseConstructionId'|'personalMeaningId'|'personalMeaningRevisionId'|'meaningFocusId'|'meaningFocusRevisionId'>>;
 proposals:Array<Pick<Fact<'proposals'>,'senseProposalId'|'senseConstructionId'>>;
 proposalVersions:Array<Pick<Fact<'proposalVersions'>,'senseProposalVersionId'|'senseProposalId'|'meaningFocusRevisionId'>>;
 senseConfirmations:Array<Pick<Fact<'senseConfirmations'>,'senseProposalConfirmationId'|'senseProposalVersionId'|'learnerUserId'|'senseId'|'senseVersionId'>>;
 semanticAcceptances:Array<Pick<Fact<'semanticAcceptances'>,'semanticAcceptanceId'|'learnerUserId'|'senseId'|'senseVersionId'|'personalSemanticAnchorRevisionId'|'personalExpressionAnchorRevisionId'>>;
 alignments:Array<Pick<Fact<'alignments'>,'personalMeaningAlignmentId'|'personalMeaningId'|'personalMeaningRevisionId'|'learnerUserId'|'senseId'|'senseVersionId'|'status'|'basis'>>;
 alignmentEvents:Array<Pick<Fact<'alignmentEvents'>,'personalMeaningAlignmentId'|'ordinal'|'eventType'>>;
 bindingConfirmations:Array<Pick<Fact<'bindingConfirmations'>,'senseVersionId'|'learnerUserId'|'senseProposalVersionId'|'personalExpressionAnchorRevisionId'|'bindingVersionId'|'expressionVersionId'>>;
};
/** Metadata witnesses only: no learner prose, original material, media or provenance. */
export const meaningLookupFactFields:Record<keyof MeaningLookupFacts,readonly string[]>={
 personalMeaning:['personalMeaningId','learnerUserId','status'],personalMeaningRevisions:['personalMeaningRevisionId','personalMeaningId'],
 personalSemanticAnchors:['personalSemanticAnchorId','personalMeaningId'],personalSemanticAnchorRevisions:['personalSemanticAnchorRevisionId','personalSemanticAnchorId'],
 personalExpressionAnchors:['personalExpressionAnchorId','personalMeaningId'],personalExpressionAnchorRevisions:['personalExpressionAnchorRevisionId','personalExpressionAnchorId'],
 focuses:['meaningFocusId','personalMeaningId'],focusRevisions:['meaningFocusRevisionId','meaningFocusId'],
 constructions:['senseConstructionId','personalMeaningId','personalMeaningRevisionId','meaningFocusId','meaningFocusRevisionId'],proposals:['senseProposalId','senseConstructionId'],
 proposalVersions:['senseProposalVersionId','senseProposalId','meaningFocusRevisionId'],senseConfirmations:['senseProposalConfirmationId','senseProposalVersionId','learnerUserId','senseId','senseVersionId'],
 semanticAcceptances:['semanticAcceptanceId','learnerUserId','senseId','senseVersionId','personalSemanticAnchorRevisionId','personalExpressionAnchorRevisionId'],
 alignments:['personalMeaningAlignmentId','personalMeaningId','personalMeaningRevisionId','learnerUserId','senseId','senseVersionId','status','basis'],
 alignmentEvents:['personalMeaningAlignmentId','ordinal','eventType'],
 bindingConfirmations:['senseVersionId','learnerUserId','senseProposalVersionId','personalExpressionAnchorRevisionId','bindingVersionId','expressionVersionId'],
};
export type LookupRegistryRead=<K extends keyof SenseRegistryState>(kind:K,id:string)=>SenseRegistryState[K][number]|undefined;
export type ConfirmedLookupConnection=Omit<MeaningLookupMatch,'expressions'|'expressionsTruncated'>&{
  expressionVersionId:string;expression:string;languageTag:string;
};
export const normalizeMeaningQuery=(text:string)=>text.normalize('NFKC').toLowerCase().trim();
export function validateMeaningQuery(raw:string):string{
  if(typeof raw!=='string'||!raw.trim()||raw.length>200)throw new Error('invalid_tool_arguments');
  const normalized=normalizeMeaningQuery(raw);if(!normalized)throw new Error('invalid_tool_arguments');return normalized;
}
export function confirmedLookupConnections(record:MeaningLookupFacts,read:LookupRegistryRead,includeDeleted=false):ConfirmedLookupConnection[]{
  if(record.personalMeaning?.status!=='active'&&!(includeDeleted&&record.personalMeaning?.status==='deleted'))return [];
  const meaningId=record.personalMeaning.personalMeaningId;
  const revisions=new Set(record.personalMeaningRevisions.filter(row=>row.personalMeaningId===meaningId).map(row=>row.personalMeaningRevisionId));
  const contexts=new Set(record.personalSemanticAnchors.filter(row=>row.personalMeaningId===undefined||row.personalMeaningId===meaningId).map(row=>row.personalSemanticAnchorId));
  const contextRevisions=new Set(record.personalSemanticAnchorRevisions.filter(row=>contexts.has(row.personalSemanticAnchorId)).map(row=>row.personalSemanticAnchorRevisionId));
  const expressions=new Set(record.personalExpressionAnchors.filter(row=>row.personalMeaningId===meaningId).map(row=>row.personalExpressionAnchorId));
  const expressionRevisions=new Set(record.personalExpressionAnchorRevisions.filter(row=>expressions.has(row.personalExpressionAnchorId)).map(row=>row.personalExpressionAnchorRevisionId));
  const focuses=new Set(record.focuses.filter(row=>row.personalMeaningId===meaningId).map(row=>row.meaningFocusId));
  const focusRevisions=new Map(record.focusRevisions.filter(row=>focuses.has(row.meaningFocusId)).map(row=>[row.meaningFocusRevisionId,row.meaningFocusId]));
  const constructions=new Set(record.constructions.filter(row=>row.personalMeaningId===meaningId&&revisions.has(row.personalMeaningRevisionId)
    &&(row.meaningFocusId===null?row.meaningFocusRevisionId===null:focusRevisions.get(row.meaningFocusRevisionId!)===row.meaningFocusId)).map(row=>row.senseConstructionId));
  const proposalIds=new Set(record.proposals.filter(row=>constructions.has(row.senseConstructionId)).map(row=>row.senseProposalId));
  const proposals=new Set(record.proposalVersions.filter(row=>proposalIds.has(row.senseProposalId)
    &&(row.meaningFocusRevisionId===null||focusRevisions.has(row.meaningFocusRevisionId))).map(row=>row.senseProposalVersionId));
  const confirmations=new Map(record.senseConfirmations.map(row=>[row.senseProposalConfirmationId,row]));
  const acceptances=new Map(record.semanticAcceptances.map(row=>[row.semanticAcceptanceId,row]));
  const byVersion=new Map<string,typeof record.bindingConfirmations>();
  for(const confirmation of record.bindingConfirmations){const group=byVersion.get(confirmation.senseVersionId)??[];group.push(confirmation);byVersion.set(confirmation.senseVersionId,group);}
  const result:ConfirmedLookupConnection[]=[],seen=new Set<string>();
  for(const alignment of record.alignments){
    const sense=read('senses',alignment.senseId),version=read('senseVersions',alignment.senseVersionId);
    if(!isAlignmentActive(record,alignment)||alignment.personalMeaningId!==meaningId||alignment.learnerUserId!==record.personalMeaning.learnerUserId
      ||!revisions.has(alignment.personalMeaningRevisionId)||!sense||!version||version.senseId!==sense.senseId)continue;
    const basis=alignment.basis;
    const construction=basis.kind==='sense_construction'?confirmations.get(basis.senseProposalConfirmationId):null;
    const acceptance=basis.kind==='contextual_resolution'?acceptances.get(basis.semanticAcceptanceId):null;
    const accepted=construction??acceptance;
    if(!accepted||accepted.learnerUserId!==alignment.learnerUserId||accepted.senseId!==alignment.senseId||accepted.senseVersionId!==alignment.senseVersionId)continue;
    if(construction&&!proposals.has(construction.senseProposalVersionId))continue;
    if(acceptance&&(!contextRevisions.has(acceptance.personalSemanticAnchorRevisionId)||acceptance.personalExpressionAnchorRevisionId!==null&&!expressionRevisions.has(acceptance.personalExpressionAnchorRevisionId)))continue;
    for(const confirmation of byVersion.get(version.senseVersionId)??[]){
      if(confirmation.learnerUserId!==alignment.learnerUserId||!expressionRevisions.has(confirmation.personalExpressionAnchorRevisionId)
        ||confirmation.senseProposalVersionId!==null&&!proposals.has(confirmation.senseProposalVersionId))continue;
      const belongs=basis.kind==='sense_construction'?construction!=null&&construction.senseProposalVersionId===confirmation.senseProposalVersionId
        :acceptance!=null&&confirmation.senseProposalVersionId===null&&confirmation.personalExpressionAnchorRevisionId===acceptance.personalExpressionAnchorRevisionId;
      if(!belongs)continue;
      const bindingVersion=read('bindingVersions',confirmation.bindingVersionId);
      const binding=bindingVersion&&read('bindings',bindingVersion.senseExpressionBindingId);
      const expressionVersion=read('expressionVersions',confirmation.expressionVersionId);
      const expression=expressionVersion&&read('expressions',expressionVersion.expressionId);
      if(!binding||!bindingVersion||!expression||!expressionVersion||binding.senseId!==sense.senseId||binding.expressionId!==expression.expressionId
        ||bindingVersion.senseVersionId!==version.senseVersionId||bindingVersion.expressionVersionId!==expressionVersion.expressionVersionId)continue;
      const key=`${version.senseVersionId}:${expressionVersion.expressionVersionId}`;if(seen.has(key))continue;seen.add(key);
      result.push({senseId:sense.senseId,senseVersionId:version.senseVersionId,senseKey:sense.senseKey,semanticSpec:version.semanticSpec,
        expressionVersionId:expressionVersion.expressionVersionId,expression:expressionVersion.surfaceForm,languageTag:expression.languageTag});
    }
  }
  return result;
}
