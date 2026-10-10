import {
  canonicalConsumerJson,
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
} from '@sensa/contracts/sensa';
import {assertMeaningLifecycle,assertMeaningLifecycleReceipt,assertMeaningLifecycleOperationReceipt,validMeaningLifecycleDescendant} from './meaningLifecycle';
import {assertAlignmentHistory} from './alignmentLifecycle';
import {assertMeaningConflictHistory,assertUnchangedMeaningConflictHistory} from './meaningConflictHistory';
import {meaningHistoryRecords,assertArchivedSceneReceipts,hasSceneReceiptWitness} from './meaningHistoryRead';
import {assertMeaningCorrectionReceipts,assertMeaningCorrectionReceiptFacts,assertMeaningCorrectionOperationReceipt,meaningCorrectionFacts} from './meaningCorrection';
import type {z} from 'zod';
import {runCooperatively,runSynchronously} from './cooperative';

import {
  JOURNEY_STORE_VERSION,
  type JourneyState,
  type MeaningJourneyRecord,
  type SenseRegistryState,
  type CommandReceipt,
} from './store';

type Fact=Record<string,any>;
type Schema=z.ZodType;

export class PersonalSemanticWorldInvariantError extends Error{
  constructor(message:string){super(message);this.name='PersonalSemanticWorldInvariantError';}
}

const reject=(message:string):never=>{throw new PersonalSemanticWorldInvariantError(message);};
function requireInvariant(condition:unknown,message:string):asserts condition{if(!condition)reject(message);}
const equal=(left:unknown,right:unknown)=>canonicalConsumerJson(left)===canonicalConsumerJson(right);
const record=(value:unknown):Fact|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Fact:undefined;

function parse(schema:Schema,value:unknown,label:string){
 const result=schema.safeParse(value);if(!result.success)reject(`${label} 不符合领域契约。`);
}

function unique<T>(items:readonly T[],id:(item:T)=>string,label:string,slot?:(item:T)=>string){
 const ids=new Set<string>(),slots=new Set<string>();
 for(const item of items){
  const identity=id(item);requireInvariant(identity.length>0&&!ids.has(identity),`${label} identity 重复。`);ids.add(identity);
  if(slot){const position=slot(item);requireInvariant(!slots.has(position),`${label} revision 槽重复。`);slots.add(position);}
 }
}

function indexed<T>(items:readonly T[],id:(item:T)=>string){return new Map(items.map(item=>[id(item),item]));}
type FactLookup<T>=Pick<ReadonlyMap<string,T>,'get'>;
function requireFact<T>(facts:FactLookup<T>,id:string,label:string):T{return facts.get(id)??reject(`${label} 引用了不存在的事实。`);}

function requireRevisionSeries<T extends Fact>(input:{
 facts:readonly T[];
 parentField:keyof T;
 parentId:string;
 revisionField:keyof T;
 current:number;
 label:string;
}){
 const revisions=input.facts.filter(fact=>fact[input.parentField]===input.parentId).map(fact=>Number(fact[input.revisionField]));
 requireInvariant(revisions.length===input.current,`${input.label} revision 历史不连续。`);
 const slots=new Set(revisions);
 for(let revision=1;revision<=input.current;revision++)requireInvariant(slots.has(revision),`${input.label} 缺少 revision ${revision}。`);
}

type RegistryIndex={
 [Kind in keyof SenseRegistryState]:FactLookup<SenseRegistryState[Kind][number]>;
};

function indexRegistry(registry:SenseRegistryState):RegistryIndex{return {
 senses:indexed(registry.senses,fact=>fact.senseId),
 senseVersions:indexed(registry.senseVersions,fact=>fact.senseVersionId),
 expressions:indexed(registry.expressions,fact=>fact.expressionId),
 expressionVersions:indexed(registry.expressionVersions,fact=>fact.expressionVersionId),
 bindings:indexed(registry.bindings,fact=>fact.senseExpressionBindingId),
 bindingVersions:indexed(registry.bindingVersions,fact=>fact.bindingVersionId),
};}

const registrySpecs=[
  ['senses',sensaSenseSnapshotSchema,'senseId'],
  ['senseVersions',sensaSenseVersionSnapshotSchema,'senseVersionId'],
  ['expressions',sensaExpressionSnapshotSchema,'expressionId'],
  ['expressionVersions',sensaExpressionVersionSnapshotSchema,'expressionVersionId'],
  ['bindings',sensaSenseExpressionBindingSnapshotSchema,'senseExpressionBindingId'],
  ['bindingVersions',sensaSenseExpressionBindingVersionSnapshotSchema,'bindingVersionId'],
 ] as const;

/** Shared reference rules for in-memory snapshots and indexed restore readers. */
function validateRegistryReference(kind:keyof SenseRegistryState,fact:Fact,registry:RegistryIndex):void{
 switch(kind){
  case 'senses':{
   const version=requireFact(registry.senseVersions,fact.currentSenseVersionId,'Sense head');
   requireInvariant(version.senseId===fact.senseId&&version.versionNumber===fact.currentVersionNumber,'Sense head 指针无效。');break;
  }
  case 'senseVersions':requireFact(registry.senses,fact.senseId,'Sense Version');break;
  case 'expressions':{
   const version=requireFact(registry.expressionVersions,fact.currentExpressionVersionId,'Expression head');
   requireInvariant(version.expressionId===fact.expressionId&&version.versionNumber===fact.currentVersionNumber,'Expression head 指针无效。');break;
  }
  case 'expressionVersions':requireFact(registry.expressions,fact.expressionId,'Expression Version');break;
  case 'bindings':{
   requireFact(registry.senses,fact.senseId,'Binding');requireFact(registry.expressions,fact.expressionId,'Binding');
   const version=requireFact(registry.bindingVersions,fact.currentBindingVersionId,'Binding head');
   requireInvariant(version.senseExpressionBindingId===fact.senseExpressionBindingId&&version.versionNumber===fact.currentVersionNumber,'Binding head 指针无效。');break;
  }
  case 'bindingVersions':{
   const binding=requireFact(registry.bindings,fact.senseExpressionBindingId,'Binding Version');
   const senseVersion=requireFact(registry.senseVersions,fact.senseVersionId,'Binding Version');
   const expressionVersion=requireFact(registry.expressionVersions,fact.expressionVersionId,'Binding Version');
   requireInvariant(senseVersion.senseId===binding.senseId&&expressionVersion.expressionId===binding.expressionId,'Binding Version 跨越了错误的 Sense 或 Expression。');break;
  }
 }
}

function* validateRegistrySteps(registry:SenseRegistryState):Generator<void,RegistryIndex>{
 for(const [field,schema,id] of registrySpecs){for(const fact of registry[field]){parse(schema,fact,`Semantic Registry ${field}`);yield;}unique(registry[field] as Fact[],fact=>fact[id],`Semantic Registry ${field}`);yield;}
 unique(registry.senseVersions,fact=>fact.senseVersionId,'Sense Version',fact=>`${fact.senseId}:${fact.versionNumber}`);
 unique(registry.expressionVersions,fact=>fact.expressionVersionId,'Expression Version',fact=>`${fact.expressionId}:${fact.versionNumber}`);
 unique(registry.bindingVersions,fact=>fact.bindingVersionId,'Binding Version',fact=>`${fact.senseExpressionBindingId}:${fact.versionNumber}`);
 unique(registry.senses,fact=>fact.senseId,'Sense key',fact=>fact.senseKey);
 const result=indexRegistry(registry);
 for(const [kind] of registrySpecs)for(const fact of registry[kind]){validateRegistryReference(kind,fact,result);yield;}
 return result;
}
const validateRegistry=(registry:SenseRegistryState):RegistryIndex=>runSynchronously(validateRegistrySteps(registry));

const meaningSchemas={
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

const meaningIds={
 personalMeaningRevisions:'personalMeaningRevisionId',
 personalSemanticAnchors:'personalSemanticAnchorId',
 personalSemanticAnchorRevisions:'personalSemanticAnchorRevisionId',
 personalExpressionAnchors:'personalExpressionAnchorId',
 personalExpressionAnchorRevisions:'personalExpressionAnchorRevisionId',
 focuses:'meaningFocusId',
 focusRevisions:'meaningFocusRevisionId',
 focusAcceptances:'meaningFocusAcceptanceId',
 constructions:'senseConstructionId',
 constructionTurns:'constructionTurnId',
 proposals:'senseProposalId',
 proposalVersions:'senseProposalVersionId',
 senseConfirmations:'senseProposalConfirmationId',
 semanticAcceptances:'semanticAcceptanceId',
 alignments:'personalMeaningAlignmentId',
 alignmentEvents:'personalMeaningAlignmentEventId',
 bindingConfirmations:'expressionBindingConfirmationId',
} as const;

function validateMeaning(meaning:MeaningJourneyRecord,registry:RegistryIndex){
 assertMeaningConflictHistory(meaning);
 for(const branch of meaning.conflictHistory?.branches??[])validateMeaning(branch.record,registry);
 parse(sensaPersonalMeaningSnapshotSchema,meaning.personalMeaning,'Personal Meaning');
 const meaningId=meaning.personalMeaning.personalMeaningId;
 for(const field of Object.keys(meaningSchemas) as Array<keyof typeof meaningSchemas>){
  const facts=meaning[field] as Fact[];requireInvariant(Array.isArray(facts),`Personal Meaning ${field} 必须是数组。`);
  for(const fact of facts)parse(meaningSchemas[field],fact,`Personal Meaning ${field}`);
  unique(facts,fact=>fact[meaningIds[field]],`Personal Meaning ${field}`);
 }
 unique(meaning.personalMeaningRevisions,fact=>fact.personalMeaningRevisionId,'Personal Meaning revision',fact=>`${fact.personalMeaningId}:${fact.revision}`);
 unique(meaning.personalSemanticAnchorRevisions,fact=>fact.personalSemanticAnchorRevisionId,'Semantic Anchor revision',fact=>`${fact.personalSemanticAnchorId}:${fact.revision}`);
 unique(meaning.personalExpressionAnchorRevisions,fact=>fact.personalExpressionAnchorRevisionId,'Expression Anchor revision',fact=>`${fact.personalExpressionAnchorId}:${fact.revision}`);
 unique(meaning.focusRevisions,fact=>fact.meaningFocusRevisionId,'Meaning Focus revision',fact=>`${fact.meaningFocusId}:${fact.revision}`);
 unique(meaning.constructionTurns,fact=>fact.constructionTurnId,'Construction turn',fact=>`${fact.senseConstructionId}:${fact.ordinal}`);
 unique(meaning.proposalVersions,fact=>fact.senseProposalVersionId,'Sense Proposal version',fact=>`${fact.senseProposalId}:${fact.version}`);
 unique(meaning.alignmentEvents,fact=>fact.personalMeaningAlignmentEventId,'Alignment event',fact=>`${fact.personalMeaningAlignmentId}:${fact.ordinal}`);

 const meaningRevisions=indexed(meaning.personalMeaningRevisions,fact=>fact.personalMeaningRevisionId);
 const semanticAnchors=indexed(meaning.personalSemanticAnchors,fact=>fact.personalSemanticAnchorId);
 const semanticAnchorRevisions=indexed(meaning.personalSemanticAnchorRevisions,fact=>fact.personalSemanticAnchorRevisionId);
 const expressionAnchors=indexed(meaning.personalExpressionAnchors,fact=>fact.personalExpressionAnchorId);
 const expressionAnchorRevisions=indexed(meaning.personalExpressionAnchorRevisions,fact=>fact.personalExpressionAnchorRevisionId);
 const focuses=indexed(meaning.focuses,fact=>fact.meaningFocusId);
 const focusRevisions=indexed(meaning.focusRevisions,fact=>fact.meaningFocusRevisionId);
 const constructions=indexed(meaning.constructions,fact=>fact.senseConstructionId);
 const proposals=indexed(meaning.proposals,fact=>fact.senseProposalId);
 const proposalVersions=indexed(meaning.proposalVersions,fact=>fact.senseProposalVersionId);
 const senseConfirmations=indexed(meaning.senseConfirmations,fact=>fact.senseProposalConfirmationId);
 const semanticAcceptances=indexed(meaning.semanticAcceptances,fact=>fact.semanticAcceptanceId);
 const alignments=indexed(meaning.alignments,fact=>fact.personalMeaningAlignmentId);

 requireRevisionSeries({facts:meaning.personalMeaningRevisions,parentField:'personalMeaningId',parentId:meaningId,revisionField:'revision',current:meaning.personalMeaning.currentRevision,label:'Personal Meaning'});
 for(const revision of meaning.personalMeaningRevisions)requireInvariant(revision.personalMeaningId===meaningId,'Personal Meaning revision 属于错误的 Meaning。');
 try{assertMeaningLifecycle(meaning);}catch{requireInvariant(false,'Personal Meaning lifecycle 缺少有效的删除／恢复事实。');}
 for(const anchor of meaning.personalSemanticAnchors){
  requireInvariant(anchor.personalMeaningId===meaningId,'Semantic Anchor 属于错误的 Meaning。');
  requireRevisionSeries({facts:meaning.personalSemanticAnchorRevisions,parentField:'personalSemanticAnchorId',parentId:anchor.personalSemanticAnchorId,revisionField:'revision',current:anchor.currentRevision,label:'Semantic Anchor'});
 }
 for(const revision of meaning.personalSemanticAnchorRevisions)requireFact(semanticAnchors,revision.personalSemanticAnchorId,'Semantic Anchor revision');
 for(const anchor of meaning.personalExpressionAnchors){
  requireInvariant(anchor.personalMeaningId===meaningId,'Expression Anchor 属于错误的 Meaning。');
  requireRevisionSeries({facts:meaning.personalExpressionAnchorRevisions,parentField:'personalExpressionAnchorId',parentId:anchor.personalExpressionAnchorId,revisionField:'revision',current:anchor.currentRevision,label:'Expression Anchor'});
 }
 for(const revision of meaning.personalExpressionAnchorRevisions){
  requireFact(expressionAnchors,revision.personalExpressionAnchorId,'Expression Anchor revision');
  if(revision.contextAnchorRevisionId){
   const context=requireFact(semanticAnchorRevisions,revision.contextAnchorRevisionId,'Expression Anchor revision');
   const locator=revision.occurrence;
   if(locator?.kind==='personal_meaning'){
    requireInvariant(locator.personalMeaningId===meaningId&&locator.personalSemanticAnchorRevisionIds[0]===context.personalSemanticAnchorRevisionId&&new Set(locator.personalSemanticAnchorRevisionIds).size===locator.personalSemanticAnchorRevisionIds.length,'个人表达必须引用同一 Meaning 的真实 Context。');
    for(const id of locator.personalSemanticAnchorRevisionIds)requireFact(semanticAnchorRevisions,id,'个人表达 Context');
   }
   if(locator?.kind==='text_span'){
    requireInvariant(typeof context.bodyText==='string'&&locator.end<=context.bodyText.length,'Expression occurrence 越出了原始 Context。');
    const intake=context.structuredPayload.intake as {expression?:{occurrence?:{surfaceForm?:unknown}}}|undefined;
    const expected=intake?.expression?.occurrence?.surfaceForm??context.structuredPayload.occurrenceSurfaceForm;
    if(typeof expected==='string')requireInvariant(context.bodyText!.slice(locator.start,locator.end)===expected,'Expression occurrence 与原始 Context 不一致。');
   }
   if(locator?.kind==='media_region')requireInvariant(context.personalMediaObjectId===locator.mediaReferenceId
    ||(Array.isArray(context.structuredPayload.mediaReferenceIds)&&context.structuredPayload.mediaReferenceIds.includes(locator.mediaReferenceId)),
    'Expression occurrence 引用了错误的媒体 Context。');
  }
 }
 for(const focus of meaning.focuses){
  requireInvariant(focus.personalMeaningId===meaningId,'Meaning Focus 属于错误的 Meaning。');
  requireRevisionSeries({facts:meaning.focusRevisions,parentField:'meaningFocusId',parentId:focus.meaningFocusId,revisionField:'revision',current:focus.currentRevision,label:'Meaning Focus'});
  if(focus.acceptedRevision!==null)requireInvariant(meaning.focusRevisions.some(revision=>revision.meaningFocusId===focus.meaningFocusId&&revision.revision===focus.acceptedRevision),'Meaning Focus accepted revision 不存在。');
  if(focus.splitFromMeaningFocusId)requireFact(focuses,focus.splitFromMeaningFocusId,'Meaning Focus split');
 }
 for(const revision of meaning.focusRevisions)requireFact(focuses,revision.meaningFocusId,'Meaning Focus revision');
 for(const acceptance of meaning.focusAcceptances){
  const focus=requireFact(focuses,acceptance.meaningFocusId,'Meaning Focus acceptance');
  const revision=requireFact(focusRevisions,acceptance.meaningFocusRevisionId,'Meaning Focus acceptance');
  requireInvariant(revision.meaningFocusId===focus.meaningFocusId,'Meaning Focus acceptance 跨越了错误的 revision。');
 }
 for(const construction of meaning.constructions){
  requireInvariant(construction.personalMeaningId===meaningId,'Sense Construction 属于错误的 Meaning。');
  const revision=requireFact(meaningRevisions,construction.personalMeaningRevisionId,'Sense Construction');
  requireInvariant(revision.personalMeaningId===meaningId,'Sense Construction 引用了错误的 Meaning revision。');
  if(construction.meaningFocusId){const focus=requireFact(focuses,construction.meaningFocusId,'Sense Construction');const focusRevision=requireFact(focusRevisions,construction.meaningFocusRevisionId!,'Sense Construction');requireInvariant(focusRevision.meaningFocusId===focus.meaningFocusId,'Sense Construction 引用了错误的 Focus revision。');}
 }
 for(const turn of meaning.constructionTurns)requireFact(constructions,turn.senseConstructionId,'Construction turn');
 for(const proposal of meaning.proposals){
  requireFact(constructions,proposal.senseConstructionId,'Sense Proposal');
  requireInvariant(meaning.proposalVersions.some(version=>version.senseProposalId===proposal.senseProposalId&&version.version===proposal.currentVersion),'Sense Proposal current version 不存在。');
 }
 for(const version of meaning.proposalVersions){
  requireFact(proposals,version.senseProposalId,'Sense Proposal version');
  if(version.meaningFocusRevisionId)requireFact(focusRevisions,version.meaningFocusRevisionId,'Sense Proposal version');
  unique(version.expressionCandidates,candidate=>candidate.candidateId,'Sense Proposal expression candidate');
  for(const candidate of version.expressionCandidates)if(candidate.personalExpressionAnchorRevisionId)requireFact(expressionAnchorRevisions,candidate.personalExpressionAnchorRevisionId,'Sense Proposal expression candidate');
 }
 for(const confirmation of meaning.senseConfirmations){
  requireInvariant(confirmation.learnerUserId===meaning.personalMeaning.learnerUserId,'Sense confirmation 属于错误的 learner。');
  requireFact(proposalVersions,confirmation.senseProposalVersionId,'Sense confirmation');
  if(confirmation.meaningFocusRevisionId)requireFact(focusRevisions,confirmation.meaningFocusRevisionId,'Sense confirmation');
  const sense=requireFact(registry.senses,confirmation.senseId,'Sense confirmation');
  const version=requireFact(registry.senseVersions,confirmation.senseVersionId,'Sense confirmation');
  requireInvariant(version.senseId===sense.senseId,'Sense confirmation 引用了错误的 Sense Version。');
 }
 for(const acceptance of meaning.semanticAcceptances){
  requireInvariant(acceptance.learnerUserId===meaning.personalMeaning.learnerUserId,'Semantic Acceptance 属于错误的 learner。');
  requireFact(semanticAnchorRevisions,acceptance.personalSemanticAnchorRevisionId,'Semantic Acceptance');
  requireFact(expressionAnchorRevisions,acceptance.personalExpressionAnchorRevisionId,'Semantic Acceptance');
  const sense=requireFact(registry.senses,acceptance.senseId,'Semantic Acceptance');
  const version=requireFact(registry.senseVersions,acceptance.senseVersionId,'Semantic Acceptance');
  requireInvariant(version.senseId===sense.senseId,'Semantic Acceptance 引用了错误的 Sense Version。');
 }
 for(const alignment of meaning.alignments){
  requireInvariant(alignment.personalMeaningId===meaningId,'Alignment 属于错误的 Meaning。');
  requireInvariant(alignment.learnerUserId===meaning.personalMeaning.learnerUserId,'Alignment 属于错误的 learner。');
  requireFact(meaningRevisions,alignment.personalMeaningRevisionId,'Alignment');
  const sense=requireFact(registry.senses,alignment.senseId,'Alignment');
  const version=requireFact(registry.senseVersions,alignment.senseVersionId,'Alignment');
  requireInvariant(version.senseId===sense.senseId,'Alignment 引用了错误的 Sense Version。');
  if(alignment.basis.kind==='contextual_resolution'){
   const acceptance=requireFact(semanticAcceptances,alignment.basis.semanticAcceptanceId,'Alignment basis');
   requireInvariant(acceptance.senseId===alignment.senseId&&acceptance.senseVersionId===alignment.senseVersionId,'Alignment 与 Semantic Acceptance 的 Sense Version 不一致。');
  }
  else{
   const confirmation=requireFact(senseConfirmations,alignment.basis.senseProposalConfirmationId,'Alignment basis');
   requireInvariant(confirmation.senseId===alignment.senseId&&confirmation.senseVersionId===alignment.senseVersionId,'Alignment 与 Sense confirmation 的 Sense Version 不一致。');
   if(alignment.basis.meaningFocusId){const focus=requireFact(focuses,alignment.basis.meaningFocusId,'Alignment basis');const focusRevision=requireFact(focusRevisions,alignment.basis.meaningFocusRevisionId!,'Alignment basis');requireInvariant(focusRevision.meaningFocusId===focus.meaningFocusId,'Alignment basis 引用了错误的 Focus revision。');}
  }
  assertAlignmentHistory(meaning,alignment);
 }
 for(const event of meaning.alignmentEvents)requireFact(alignments,event.personalMeaningAlignmentId,'Alignment event');
 meaningCorrectionFacts(meaning);
 for(const confirmation of meaning.bindingConfirmations){
  requireInvariant(confirmation.learnerUserId===meaning.personalMeaning.learnerUserId,'Binding confirmation 属于错误的 learner。');
  if(confirmation.senseProposalVersionId)requireFact(proposalVersions,confirmation.senseProposalVersionId,'Binding confirmation');
  requireFact(expressionAnchorRevisions,confirmation.personalExpressionAnchorRevisionId,'Binding confirmation');
  const senseVersion=requireFact(registry.senseVersions,confirmation.senseVersionId,'Binding confirmation');
  const expressionVersion=requireFact(registry.expressionVersions,confirmation.expressionVersionId,'Binding confirmation');
  const bindingVersion=requireFact(registry.bindingVersions,confirmation.bindingVersionId,'Binding confirmation');
  requireInvariant(bindingVersion.senseVersionId===senseVersion.senseVersionId&&bindingVersion.expressionVersionId===expressionVersion.expressionVersionId,'Binding confirmation 引用了不一致的版本。');
 }
 const mock=record(meaning.mockState);requireInvariant(mock!==undefined&&record(mock.focusAspectLabels)!==undefined,'Meaning mock state 无效。');
 for(const [focusId,label] of Object.entries(mock.focusAspectLabels)){requireFact(focuses,focusId,'Focus label');requireInvariant(typeof label==='string'&&label.trim().length>0,'Focus label 不能为空。');}
 requireInvariant(mock.startingPoint===undefined||mock.startingPoint===null||['from_experience','from_sense','from_expression'].includes(mock.startingPoint),'Meaning starting point 无效。');
}

function validateClarificationDraft(draft:JourneyState['clarificationDrafts'][number],hasInbox:(id:string)=>boolean){
 requireInvariant(hasInbox(draft.intakeId),'Clarification Draft 缺少对应 Inbox Item。');
 requireInvariant(draft.startingPoint===null||['from_experience','from_sense','from_expression'].includes(draft.startingPoint),'Clarification Draft starting point 无效。');
}
function validateReceipt(receipt:CommandReceipt){
 requireInvariant(typeof receipt.operationId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(receipt.operationId),'Command receipt operationId 无效。');
 requireInvariant(typeof receipt.command==='string'&&receipt.command.trim().length>0,'Command receipt command 无效。');
 requireInvariant(receipt.requestDigest===undefined||/^[0-9a-f]{64}$/u.test(receipt.requestDigest),'Command receipt digest 无效。');
 const result=record(receipt.result);requireInvariant(result!==undefined&&Object.values(result).every(value=>value===null||['string','number','boolean'].includes(typeof value)),'Command receipt result 无效。');
}
function validateAuxiliaryState(state:JourneyState){
 for(const item of state.inboxItems)parse(sensaIntakeItemSchema,item,'Intake Item');
 unique(state.inboxItems,item=>item.intakeId,'Intake Item');
 unique(state.clarificationDrafts,draft=>draft.intakeId,'Clarification Draft');
 const inboxIds=new Set(state.inboxItems.map(item=>item.intakeId));
 for(const draft of state.clarificationDrafts)validateClarificationDraft(draft,id=>inboxIds.has(id));
 unique(state.commandReceipts,receipt=>receipt.operationId,'Command receipt');
 for(const receipt of state.commandReceipts)validateReceipt(receipt);
 const byOperation=new Map(state.commandReceipts.map(receipt=>[receipt.operationId,receipt]));
 for(const meaning of state.meanings)assertArchivedSceneReceipts(meaning,id=>byOperation.get(id));
 for(const receipt of state.commandReceipts)if(receipt.command==='AcceptPublishedLearningScene'){
  const meaning=state.meanings.find(row=>row.personalMeaning.personalMeaningId===receipt.result.personalMeaningId);
  if(meaning?.conflictHistory)requireInvariant(meaningHistoryRecords(meaning).some(branch=>hasSceneReceiptWitness(branch,receipt)),'Archived Scene receipt 缺少分支见证。');
 }
 const corrections=new Map<string,JourneyState['commandReceipts']>();
 for(const receipt of state.commandReceipts)if(receipt.command==='CorrectPersonalMeaning'){
  const id=String(receipt.result.personalMeaningId),group=corrections.get(id)??[];group.push(receipt);corrections.set(id,group);
 }
 for(const meaning of state.meanings){const id=meaning.personalMeaning.personalMeaningId;assertMeaningCorrectionReceipts(meaning,corrections.get(id)??[]);corrections.delete(id);}
 requireInvariant(corrections.size===0,'纠正操作缺少对应个人意义。');
}

function requireStateShape(state:JourneyState){
 requireInvariant(state.version===JOURNEY_STORE_VERSION,'Personal Semantic World store version 不匹配。');
 requireInvariant(Array.isArray(state.meanings)&&Array.isArray(state.inboxItems)&&Array.isArray(state.clarificationDrafts)&&Array.isArray(state.commandReceipts),'Personal Semantic World store 结构无效。');
}

function assertSceneOwner(meaning:MeaningJourneyRecord,owners:Map<string,string>){
 const meaningId=meaning.personalMeaning.personalMeaningId;
 for(const revision of meaningHistoryRecords(meaning).flatMap(branch=>branch.personalSemanticAnchorRevisions)){
  const scene=record(revision.structuredPayload.learningScene);if(!scene)continue;
  const sceneId=scene.sceneId;
  requireInvariant(typeof sceneId==='string'&&sceneId.length>0,'Personal Learning Scene identity 缺失。');
  requireInvariant(!owners.has(sceneId)||owners.get(sceneId)===meaningId,'同一 Personal Learning Scene 不能属于多个 Personal Meanings。');
  owners.set(sceneId,meaningId);
 }
}

export const semanticWorldRecordTables=['semanticState','semanticMeanings','semanticRegistry','semanticInbox','semanticDrafts','semanticReceipts'] as const;
export type SemanticWorldRecordTable=typeof semanticWorldRecordTables[number];
/** Complete, immutable validation snapshot. Iterate every stored row exactly
 * once (including its key); get resolves the exact key in the same snapshot.
 * Access is synchronous: a future SQLite Worker candidate must run validation
 * locally, not make one asynchronous RPC per reference. Current cloud callers
 * adapt immutable in-memory wire references. */
export interface SemanticWorldRecordReader{
 get(table:SemanticWorldRecordTable,key:string):unknown|undefined;
 entries(table:SemanticWorldRecordTable):Iterable<{key:string;value:unknown}>;
}

function* checkedWorldRecords(reader:SemanticWorldRecordReader,table:SemanticWorldRecordTable){
 const keys=new Set<string>();
 for(const row of reader.entries(table)){
  requireInvariant(typeof row.key==='string'&&row.key.length>0&&!keys.has(row.key),`${table} storage key 重复或缺失。`);keys.add(row.key);
  yield row;
 }
}

/** Same domain rules as complete World validation, without constructing a
 * JourneyState or retaining Meaning/Registry/Inbox/receipt bodies. Only compact
 * uniqueness and scene-owner metadata survives each row. Restore also checks
 * lifecycle and correction witnesses in both directions. */
export function* assertPersonalSemanticWorldRecordSteps(reader:SemanticWorldRecordReader):Generator<void,void>{
 const root=record(reader.get('semanticState','root'));
 if(!root){
  for(const table of semanticWorldRecordTables){
   const iterator=reader.entries(table)[Symbol.iterator]();
   try{requireInvariant(iterator.next().done,'Personal Semantic World 缺少版本记录。');}finally{iterator.return?.();}yield;
  }
  return;
 }
 requireInvariant(root.version===JOURNEY_STORE_VERSION,'Personal Semantic World store version 不匹配。');
 for(const _row of checkedWorldRecords(reader,'semanticState'))yield;
 // One aggregate may reference the same immutable version several times.
 // Reuse those point reads only within this row, never across a World refresh.
 const references=new Map<string,Fact|undefined>();
 const registry=Object.fromEntries(registrySpecs.map(([kind])=>[kind,{get:(id:string)=>{
  const key=`${kind}:${id}`;if(references.has(key))return references.get(key);
  const row=record(reader.get('semanticRegistry',key)),fact=row?.kind===kind?record(row.value):undefined;
  references.set(key,fact);return fact;
 }}])) as RegistryIndex;
 const ids=new Set<string>(),slots=new Set<string>(),senseKeys=new Set<string>();
 for(const {key,value} of checkedWorldRecords(reader,'semanticRegistry')){
  references.clear();
  const row=record(value),spec=registrySpecs.find(([kind])=>kind===row?.kind);
  requireInvariant(row&&spec,'Semantic Registry row kind 无效。');
  const [kind,schema,idField]=spec,fact=record(row.value);parse(schema,fact,`Semantic Registry ${kind}`);
  const id=fact![idField],identity=`${kind}:${id}`;
  requireInvariant(key===identity&&!ids.has(identity),'Semantic Registry identity 与 storage key 不一致。');ids.add(identity);
  requireInvariant(Number.isSafeInteger(row.ordinal)&&row.ordinal>=0,'Semantic Registry ordinal 无效。');
  if(kind==='senses'){requireInvariant(!senseKeys.has(fact!.senseKey),'Sense key 重复。');senseKeys.add(fact!.senseKey);}
  const parent=kind==='senseVersions'?'senseId':kind==='expressionVersions'?'expressionId':kind==='bindingVersions'?'senseExpressionBindingId':null;
  if(parent){const slot=JSON.stringify([kind,fact![parent],fact!.versionNumber]);requireInvariant(!slots.has(slot),'Semantic Registry version 槽重复。');slots.add(slot);}
  validateRegistryReference(kind,fact!,registry);
  yield;
 }
 const owners=new Map<string,string>(),readReceipt=(id:string)=>reader.get('semanticReceipts',id) as CommandReceipt|undefined;
 for(const {key,value} of checkedWorldRecords(reader,'semanticMeanings')){
  references.clear();
  const meaning=value as MeaningJourneyRecord;validateMeaning(meaning,registry);
  requireInvariant(key===meaning.personalMeaning.personalMeaningId,'Personal Meaning identity 与 storage key 不一致。');assertSceneOwner(meaning,owners);
  for(const branch of meaningHistoryRecords(meaning))for(const stamp of branch.personalMeaningRevisions)assertMeaningLifecycleReceipt(key,stamp,{get:readReceipt});
  assertMeaningCorrectionReceiptFacts(meaning,readReceipt);
  assertArchivedSceneReceipts(meaning,readReceipt);
  yield;
 }
 references.clear();
 for(const {key,value} of checkedWorldRecords(reader,'semanticInbox')){
  const item=value as JourneyState['inboxItems'][number];parse(sensaIntakeItemSchema,item,'Intake Item');
  requireInvariant(key===item.intakeId,'Inbox identity 与 storage key 不一致。');
  yield;
 }
 for(const {key,value} of checkedWorldRecords(reader,'semanticDrafts')){
  const draft=value as JourneyState['clarificationDrafts'][number];
  requireInvariant(key===draft?.intakeId,'Clarification Draft identity 与 storage key 不一致。');
  validateClarificationDraft(draft,id=>reader.get('semanticInbox',id)!==undefined);
  yield;
 }
 for(const {key,value} of checkedWorldRecords(reader,'semanticReceipts')){
  const receipt=value as CommandReceipt;validateReceipt(receipt);
  requireInvariant(key===receipt.operationId,'Command receipt identity 与 storage key 不一致。');
  if(['ChangeMeaningLifecycle','CorrectPersonalMeaning'].includes(receipt.command)){
   const id=receipt.result.personalMeaningId,meaning=typeof id==='string'?reader.get('semanticMeanings',id) as MeaningJourneyRecord|undefined:undefined;
   assertMeaningLifecycleOperationReceipt(meaning,receipt);assertMeaningCorrectionOperationReceipt(meaning,receipt);
  }
  if(receipt.command==='AcceptPublishedLearningScene'){
   const meaning=reader.get('semanticMeanings',String(receipt.result.personalMeaningId)) as MeaningJourneyRecord|undefined;
   if(meaning?.conflictHistory)requireInvariant(meaningHistoryRecords(meaning).some(branch=>hasSceneReceiptWitness(branch,receipt)),'Archived Scene receipt 缺少分支见证。');
  }
  yield;
 }
}

export function assertPersonalSemanticWorldRecords(reader:SemanticWorldRecordReader):void{
 runSynchronously(assertPersonalSemanticWorldRecordSteps(reader));
}

/** Validate every Personal Semantic World fact and internal reference. */
export function assertPersonalSemanticWorldState(state:JourneyState):void{
 requireStateShape(state);
 const registry=validateRegistry(state.registry);
 unique(state.meanings,meaning=>meaning.personalMeaning.personalMeaningId,'Personal Meaning');
 const owners=new Map<string,string>();
 for(const meaning of state.meanings){validateMeaning(meaning,registry);assertSceneOwner(meaning,owners);}
 validateAuxiliaryState(state);
}

/** Read-only aggregate validation; commit/restore also verify operation witnesses. */
export function assertPersonalSemanticWorldRecord(meaning:MeaningJourneyRecord,registry:SenseRegistryState):void{
 validateMeaning(meaning,validateRegistry(registry));
}

/** Same authority checks, cooperatively scheduled during a large browser read. */
export async function assertPersonalSemanticWorldStateCooperatively(state:JourneyState):Promise<void>{
 requireStateShape(state);
 const registry=await runCooperatively(validateRegistrySteps(state.registry));
 unique(state.meanings,meaning=>meaning.personalMeaning.personalMeaningId,'Personal Meaning');
 const owners=new Map<string,string>();
 await runCooperatively((function*(){for(const meaning of state.meanings){validateMeaning(meaning,registry);assertSceneOwner(meaning,owners);yield;}})());
 validateAuxiliaryState(state);
}

const lifecycleFields=new Set(['currentRevision','acceptedRevision','lifecycleRevision','status','updatedAt','deletedAt','deletedByOperationId']);
const tombstoneFields=new Set(['lifecycleRevision','status','updatedAt','deletedAt','deletedByOperationId']);
const without=(value:Fact,fields:Set<string>)=>Object.fromEntries(Object.entries(value).filter(([key])=>!fields.has(key)));

function assertLifecycleTransition(before:Fact,after:Fact,label:string){
 if(equal(before,after))return;
 requireInvariant(equal(without(before,lifecycleFields),without(after,lifecycleFields)),`${label} stable identity 被改写。`);
 requireInvariant(before.status==='active',`${label} tombstone 不允许复活或改写。`);
 if(after.status==='deleted'){
  requireInvariant(after.lifecycleRevision===before.lifecycleRevision+1,`${label} tombstone lifecycle revision 无效。`);
  requireInvariant(equal(without(before,tombstoneFields),without(after,tombstoneFields)),`${label} 删除同时改写了内容。`);
  return;
 }
 requireInvariant(after.status==='active'&&after.lifecycleRevision===before.lifecycleRevision&&after.deletedAt===null&&after.deletedByOperationId===null,`${label} lifecycle transition 无效。`);
 requireInvariant(after.currentRevision===before.currentRevision||after.currentRevision===before.currentRevision+1,`${label} current revision 必须保持或前进一位。`);
 if('acceptedRevision' in before){
  const prior=before.acceptedRevision??0,next=after.acceptedRevision??0;
  requireInvariant(next>=prior&&next<=after.currentRevision,`${label} accepted revision 无效。`);
 }
}

function assertAppendOnly<T>(before:readonly T[],after:readonly T[],id:(item:T)=>string,label:string){
 const next=indexed(after,id);
 for(const fact of before){const candidate=next.get(id(fact));requireInvariant(candidate!==undefined,`${label} 不允许物理删除。`);requireInvariant(equal(fact,candidate),`${label} 已存在事实不可改写。`);}
}

function assertLifecycleCollection<T extends Fact>(before:readonly T[],after:readonly T[],id:(item:T)=>string,label:string){
 const next=indexed(after,id);
 for(const fact of before){const candidate=next.get(id(fact));requireInvariant(candidate!==undefined,`${label} 不允许物理删除。`);assertLifecycleTransition(fact,candidate as Fact,label);}
}

function assertRegistryHeadTransition(before:Fact,after:Fact,pointer:string,revision:string,label:string){
 const fields=new Set([pointer,revision]);
 requireInvariant(equal(without(before,fields),without(after,fields)),`${label} stable identity 被改写。`);
 requireInvariant(after[revision]>=before[revision],`${label} current version 不允许后退。`);
 if(after[revision]===before[revision])requireInvariant(after[pointer]===before[pointer],`${label} 同一版本不能切换 identity。`);
}

function assertMeaningTransition(before:MeaningJourneyRecord,after:MeaningJourneyRecord){
 assertUnchangedMeaningConflictHistory(before,after);
 const prior=before.personalMeaning,next=after.personalMeaning;
 if(next.lifecycleRevision!==prior.lifecycleRevision){
  requireInvariant(validMeaningLifecycleDescendant(before,after)&&next.lifecycleRevision===prior.lifecycleRevision+1&&next.currentRevision===prior.currentRevision+1,'Personal Meaning lifecycle 必须以一个明确操作前进一位。');
  const stamp=after.personalMeaningRevisions.find(row=>row.revision===next.currentRevision);
  requireInvariant(stamp?.lifecycle?.revision===next.lifecycleRevision&&stamp.createdAt===next.updatedAt,'Personal Meaning lifecycle head 与新 revision 不一致。');
  for(const key of Object.keys(before) as Array<keyof MeaningJourneyRecord>)if(key!=='personalMeaning'&&key!=='personalMeaningRevisions')requireInvariant(equal(before[key],after[key]),'删除／恢复不能同时改写个人意义内容。');
 }else{
  if(prior.status==='deleted')requireInvariant(equal(before,after),'已删除的个人意义只能明确恢复，不能继续修改。');
  assertLifecycleTransition(prior,next,'Personal Meaning');
 }
 assertAppendOnly(before.personalMeaningRevisions,after.personalMeaningRevisions,fact=>fact.personalMeaningRevisionId,'Personal Meaning revision');
 assertLifecycleCollection(before.personalSemanticAnchors,after.personalSemanticAnchors,fact=>fact.personalSemanticAnchorId,'Semantic Anchor');
 assertAppendOnly(before.personalSemanticAnchorRevisions,after.personalSemanticAnchorRevisions,fact=>fact.personalSemanticAnchorRevisionId,'Semantic Anchor revision');
 assertLifecycleCollection(before.personalExpressionAnchors,after.personalExpressionAnchors,fact=>fact.personalExpressionAnchorId,'Expression Anchor');
 assertAppendOnly(before.personalExpressionAnchorRevisions,after.personalExpressionAnchorRevisions,fact=>fact.personalExpressionAnchorRevisionId,'Expression Anchor revision');
 assertLifecycleCollection(before.focuses,after.focuses,fact=>fact.meaningFocusId,'Meaning Focus');
 for(const field of ['focusRevisions','focusAcceptances','constructions','constructionTurns','proposals','proposalVersions','senseConfirmations','semanticAcceptances','alignments','alignmentEvents','bindingConfirmations'] as const){
  assertAppendOnly(before[field] as Fact[],after[field] as Fact[],fact=>fact[meaningIds[field]],`Personal Meaning ${field}`);
 }
 requireInvariant(equal(before.mockState.startingPoint,after.mockState.startingPoint),'Meaning starting point 不可改写。');
 for(const [focusId,label] of Object.entries(before.mockState.focusAspectLabels))requireInvariant(after.mockState.focusAspectLabels[focusId]===label,'Focus label 不可改写或删除。');
}

function assertRegistryTransition(before:SenseRegistryState,after:SenseRegistryState){
 assertAppendOnly(before.senseVersions,after.senseVersions,fact=>fact.senseVersionId,'Sense Version');
 assertAppendOnly(before.expressionVersions,after.expressionVersions,fact=>fact.expressionVersionId,'Expression Version');
 assertAppendOnly(before.bindingVersions,after.bindingVersions,fact=>fact.bindingVersionId,'Binding Version');
 for(const [field,id,pointer,revision,label] of [
  ['senses','senseId','currentSenseVersionId','currentVersionNumber','Sense'],
  ['expressions','expressionId','currentExpressionVersionId','currentVersionNumber','Expression'],
  ['bindings','senseExpressionBindingId','currentBindingVersionId','currentVersionNumber','Binding'],
 ] as const){
  const next=indexed(after[field] as Fact[],fact=>fact[id]);
  for(const fact of before[field] as Fact[]){const candidate=next.get(fact[id]);requireInvariant(candidate!==undefined,`${label} 不允许物理删除。`);assertRegistryHeadTransition(fact,candidate!,pointer,revision,label);}
 }
}

function sameRegistryReferences(before:SenseRegistryState,after:SenseRegistryState){
 return (Object.keys(before) as Array<keyof SenseRegistryState>).every(field=>before[field].length===after[field].length&&before[field].every((fact,index)=>fact===after[field][index]));
}

/** Admit one local command only when it preserves PSW history and lifecycle rules.
 * `before` must be a state previously admitted by `assertPersonalSemanticWorldState`.
 * Unchanged aggregates retain object identity, so ordinary commands validate
 * only their changed facts instead of rescanning the whole semantic world. */
export function assertPersonalSemanticWorldTransition(before:JourneyState,after:JourneyState):void{
 requireStateShape(after);
 unique(after.meanings,meaning=>meaning.personalMeaning.personalMeaningId,'Personal Meaning');
 const meanings=indexed(after.meanings,meaning=>meaning.personalMeaning.personalMeaningId);
 const changed:Array<{before?:MeaningJourneyRecord;after:MeaningJourneyRecord}>=[];
 for(const meaning of before.meanings){
  const candidate=meanings.get(meaning.personalMeaning.personalMeaningId);requireInvariant(candidate!==undefined,'Personal Meaning 不允许物理删除。');
  if(candidate!==meaning)changed.push({before:meaning,after:candidate!});
 }
 const previousIds=new Set(before.meanings.map(meaning=>meaning.personalMeaning.personalMeaningId));
 for(const meaning of after.meanings)if(!previousIds.has(meaning.personalMeaning.personalMeaningId))changed.push({after:meaning});
 const registryChanged=!sameRegistryReferences(before.registry,after.registry);
 const registry=registryChanged?validateRegistry(after.registry):changed.length?indexRegistry(after.registry):undefined;
 for(const change of changed){
  validateMeaning(change.after,registry!);if(change.before)assertMeaningTransition(change.before,change.after);
  const oldRevision=change.before?.personalMeaning.currentRevision??0;
  for(const stamp of change.after.personalMeaningRevisions)if(stamp.revision>oldRevision&&stamp.lifecycle){
   requireInvariant(!before.commandReceipts.some(receipt=>receipt.operationId===stamp.provenance.createdByOperationId),'Lifecycle 必须使用本次新增的操作凭据。');
   assertMeaningLifecycleReceipt(change.after.personalMeaning.personalMeaningId,stamp,new Map(after.commandReceipts.map(receipt=>[receipt.operationId,receipt])));
  }
 }
 if(registryChanged)assertRegistryTransition(before.registry,after.registry);
 validateAuxiliaryState(after);
 assertAppendOnly(before.commandReceipts,after.commandReceipts,receipt=>receipt.operationId,'Command receipt');
 const previousReceipts=new Set(before.commandReceipts.map(receipt=>receipt.operationId));
 for(const receipt of after.commandReceipts)if(!previousReceipts.has(receipt.operationId)&&receipt.command==='ChangeMeaningLifecycle')assertMeaningLifecycleOperationReceipt(meanings.get(String(receipt.result.personalMeaningId)),receipt);
}
