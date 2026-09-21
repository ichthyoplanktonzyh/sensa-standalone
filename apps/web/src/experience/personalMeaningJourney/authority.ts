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
import type {z} from 'zod';

import {
  JOURNEY_STORE_VERSION,
  type JourneyState,
  type MeaningJourneyRecord,
  type SenseRegistryState,
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
function requireFact<T>(facts:Map<string,T>,id:string,label:string):T{return facts.get(id)??reject(`${label} 引用了不存在的事实。`);}

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
 senses:Map<string,SenseRegistryState['senses'][number]>;
 senseVersions:Map<string,SenseRegistryState['senseVersions'][number]>;
 expressions:Map<string,SenseRegistryState['expressions'][number]>;
 expressionVersions:Map<string,SenseRegistryState['expressionVersions'][number]>;
 bindings:Map<string,SenseRegistryState['bindings'][number]>;
 bindingVersions:Map<string,SenseRegistryState['bindingVersions'][number]>;
};

function indexRegistry(registry:SenseRegistryState):RegistryIndex{return {
 senses:indexed(registry.senses,fact=>fact.senseId),
 senseVersions:indexed(registry.senseVersions,fact=>fact.senseVersionId),
 expressions:indexed(registry.expressions,fact=>fact.expressionId),
 expressionVersions:indexed(registry.expressionVersions,fact=>fact.expressionVersionId),
 bindings:indexed(registry.bindings,fact=>fact.senseExpressionBindingId),
 bindingVersions:indexed(registry.bindingVersions,fact=>fact.bindingVersionId),
};}

function validateRegistry(registry:SenseRegistryState):RegistryIndex{
 const specs=[
  ['senses',sensaSenseSnapshotSchema,'senseId'],
  ['senseVersions',sensaSenseVersionSnapshotSchema,'senseVersionId'],
  ['expressions',sensaExpressionSnapshotSchema,'expressionId'],
  ['expressionVersions',sensaExpressionVersionSnapshotSchema,'expressionVersionId'],
  ['bindings',sensaSenseExpressionBindingSnapshotSchema,'senseExpressionBindingId'],
  ['bindingVersions',sensaSenseExpressionBindingVersionSnapshotSchema,'bindingVersionId'],
 ] as const;
 for(const [field,schema,id] of specs){for(const fact of registry[field])parse(schema,fact,`Semantic Registry ${field}`);unique(registry[field] as Fact[],fact=>fact[id],`Semantic Registry ${field}`);}
 unique(registry.senseVersions,fact=>fact.senseVersionId,'Sense Version',fact=>`${fact.senseId}:${fact.versionNumber}`);
 unique(registry.expressionVersions,fact=>fact.expressionVersionId,'Expression Version',fact=>`${fact.expressionId}:${fact.versionNumber}`);
 unique(registry.bindingVersions,fact=>fact.bindingVersionId,'Binding Version',fact=>`${fact.senseExpressionBindingId}:${fact.versionNumber}`);
 unique(registry.senses,fact=>fact.senseId,'Sense key',fact=>fact.senseKey);
 const result=indexRegistry(registry);
 for(const sense of registry.senses){
  const version=requireFact(result.senseVersions,sense.currentSenseVersionId,'Sense head');
  requireInvariant(version.senseId===sense.senseId&&version.versionNumber===sense.currentVersionNumber,'Sense head 指针无效。');
 }
 for(const version of registry.senseVersions)requireFact(result.senses,version.senseId,'Sense Version');
 for(const expression of registry.expressions){
  const version=requireFact(result.expressionVersions,expression.currentExpressionVersionId,'Expression head');
  requireInvariant(version.expressionId===expression.expressionId&&version.versionNumber===expression.currentVersionNumber,'Expression head 指针无效。');
 }
 for(const version of registry.expressionVersions)requireFact(result.expressions,version.expressionId,'Expression Version');
 for(const binding of registry.bindings){
  requireFact(result.senses,binding.senseId,'Binding');requireFact(result.expressions,binding.expressionId,'Binding');
  const version=requireFact(result.bindingVersions,binding.currentBindingVersionId,'Binding head');
  requireInvariant(version.senseExpressionBindingId===binding.senseExpressionBindingId&&version.versionNumber===binding.currentVersionNumber,'Binding head 指针无效。');
 }
 for(const version of registry.bindingVersions){
  const binding=requireFact(result.bindings,version.senseExpressionBindingId,'Binding Version');
  const senseVersion=requireFact(result.senseVersions,version.senseVersionId,'Binding Version');
  const expressionVersion=requireFact(result.expressionVersions,version.expressionVersionId,'Binding Version');
  requireInvariant(senseVersion.senseId===binding.senseId&&expressionVersion.expressionId===binding.expressionId,'Binding Version 跨越了错误的 Sense 或 Expression。');
 }
 return result;
}

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
  if(revision.contextAnchorRevisionId)requireFact(semanticAnchorRevisions,revision.contextAnchorRevisionId,'Expression Anchor revision');
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
  requireFact(proposalVersions,confirmation.senseProposalVersionId,'Sense confirmation');
  if(confirmation.meaningFocusRevisionId)requireFact(focusRevisions,confirmation.meaningFocusRevisionId,'Sense confirmation');
  const sense=requireFact(registry.senses,confirmation.senseId,'Sense confirmation');
  const version=requireFact(registry.senseVersions,confirmation.senseVersionId,'Sense confirmation');
  requireInvariant(version.senseId===sense.senseId,'Sense confirmation 引用了错误的 Sense Version。');
 }
 for(const acceptance of meaning.semanticAcceptances){
  requireFact(semanticAnchorRevisions,acceptance.personalSemanticAnchorRevisionId,'Semantic Acceptance');
  requireFact(expressionAnchorRevisions,acceptance.personalExpressionAnchorRevisionId,'Semantic Acceptance');
  const sense=requireFact(registry.senses,acceptance.senseId,'Semantic Acceptance');
  const version=requireFact(registry.senseVersions,acceptance.senseVersionId,'Semantic Acceptance');
  requireInvariant(version.senseId===sense.senseId,'Semantic Acceptance 引用了错误的 Sense Version。');
 }
 for(const alignment of meaning.alignments){
  requireInvariant(alignment.personalMeaningId===meaningId,'Alignment 属于错误的 Meaning。');
  requireFact(meaningRevisions,alignment.personalMeaningRevisionId,'Alignment');
  const sense=requireFact(registry.senses,alignment.senseId,'Alignment');
  const version=requireFact(registry.senseVersions,alignment.senseVersionId,'Alignment');
  requireInvariant(version.senseId===sense.senseId,'Alignment 引用了错误的 Sense Version。');
  if(alignment.basis.kind==='contextual_resolution')requireFact(semanticAcceptances,alignment.basis.semanticAcceptanceId,'Alignment basis');
  else{
   requireFact(senseConfirmations,alignment.basis.senseProposalConfirmationId,'Alignment basis');
   if(alignment.basis.meaningFocusId){const focus=requireFact(focuses,alignment.basis.meaningFocusId,'Alignment basis');const focusRevision=requireFact(focusRevisions,alignment.basis.meaningFocusRevisionId!,'Alignment basis');requireInvariant(focusRevision.meaningFocusId===focus.meaningFocusId,'Alignment basis 引用了错误的 Focus revision。');}
  }
  requireInvariant(meaning.alignmentEvents.some(event=>event.personalMeaningAlignmentId===alignment.personalMeaningAlignmentId&&event.ordinal===alignment.revision),'Alignment revision 没有对应事件。');
 }
 for(const event of meaning.alignmentEvents)requireFact(alignments,event.personalMeaningAlignmentId,'Alignment event');
 for(const confirmation of meaning.bindingConfirmations){
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

function validateAuxiliaryState(state:JourneyState){
 for(const item of state.inboxItems)parse(sensaIntakeItemSchema,item,'Intake Item');
 unique(state.inboxItems,item=>item.intakeId,'Intake Item');
 unique(state.clarificationDrafts,draft=>draft.intakeId,'Clarification Draft');
 const inboxIds=new Set(state.inboxItems.map(item=>item.intakeId));
 for(const draft of state.clarificationDrafts){
  requireInvariant(inboxIds.has(draft.intakeId),'Clarification Draft 缺少对应 Inbox Item。');
  requireInvariant(draft.startingPoint===null||['from_experience','from_sense','from_expression'].includes(draft.startingPoint),'Clarification Draft starting point 无效。');
 }
 unique(state.commandReceipts,receipt=>receipt.operationId,'Command receipt');
 for(const receipt of state.commandReceipts){
  requireInvariant(typeof receipt.operationId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(receipt.operationId),'Command receipt operationId 无效。');
  requireInvariant(typeof receipt.command==='string'&&receipt.command.trim().length>0,'Command receipt command 无效。');
  requireInvariant(receipt.requestDigest===undefined||/^[0-9a-f]{64}$/u.test(receipt.requestDigest),'Command receipt digest 无效。');
  const result=record(receipt.result);requireInvariant(result!==undefined&&Object.values(result).every(value=>value===null||['string','number','boolean'].includes(typeof value)),'Command receipt result 无效。');
 }
}

function requireStateShape(state:JourneyState){
 requireInvariant(state.version===JOURNEY_STORE_VERSION,'Personal Semantic World store version 不匹配。');
 requireInvariant(Array.isArray(state.meanings)&&Array.isArray(state.inboxItems)&&Array.isArray(state.clarificationDrafts)&&Array.isArray(state.commandReceipts),'Personal Semantic World store 结构无效。');
}

/** Validate every Personal Semantic World fact and internal reference. */
export function assertPersonalSemanticWorldState(state:JourneyState):void{
 requireStateShape(state);
 const registry=validateRegistry(state.registry);
 unique(state.meanings,meaning=>meaning.personalMeaning.personalMeaningId,'Personal Meaning');
 for(const meaning of state.meanings)validateMeaning(meaning,registry);
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
 assertLifecycleTransition(before.personalMeaning,after.personalMeaning,'Personal Meaning');
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
 for(const change of changed){validateMeaning(change.after,registry!);if(change.before)assertMeaningTransition(change.before,change.after);}
 if(registryChanged)assertRegistryTransition(before.registry,after.registry);
 validateAuxiliaryState(after);
 assertAppendOnly(before.commandReceipts,after.commandReceipts,receipt=>receipt.operationId,'Command receipt');
}
