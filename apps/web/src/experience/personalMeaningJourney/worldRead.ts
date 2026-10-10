/** Learner-private World read models. Never use this as an Agent lookup payload. */
import {emptyJourneyState,type MeaningJourneyRecord,type SenseRegistryState} from './store';
import {assertPersonalSemanticWorldRecord} from './authority';
import {buildWorldItemView} from './projection';
import {indexRegistry} from './registryRead';
import {meaningHistoryRecords} from './meaningHistoryRead';
import {confirmedLookupConnections,normalizeMeaningQuery} from './meaningLookupFacts';
import type {JourneyWorldItemView,JourneySenseFormationView,JourneyExpressionBindingView} from './types';
import type {PersonalMeaningLearningSource,PersonalMeaningLearningReference} from '../../contentSupply/provisioning/contracts';
import {personalLearningSourceKey} from '../../contentSupply/provisioning/contracts';

export type WorldFilter='all'|'continue'|'binding'|'complete'|'pending'|'deleted';
export interface WorldBrowseQuery{query:string;filter:WorldFilter;offset:number;limit:number;senseIds?:readonly string[];expressionLanguages?:readonly string[];referenceFilter?:'all'|'saved'|'notes'}
export interface WorldExpressionSummary{expressionId:string;surfaceForm:string;languageTag:string}
export interface WorldBrowseItem{
 personalMeaningId:string;label:string;draftLabel?:string;primaryLabel:string;updatedAt:string;
 status:'active'|'deleted';
 senseIds?:string[];
 references?:WorldMeaningReference[];
 expressions?:WorldExpressionSummary[];
 senseFormation:JourneySenseFormationView;expressionBinding:JourneyExpressionBindingView;
}
export interface WorldBrowsePage{items:WorldBrowseItem[];total:number;pending:number;next:WorldBrowseItem|null;expressionLanguages?:string[];expressionCount?:number}
/** Exact accepted interpretation, without Context, media or learning state. */
export interface WorldMeaningReference{
 personalMeaningAlignmentId:string;senseId:string;word:string;meaning:string;historical:boolean;
}
/** Formal learning selection contains immutable pins, never Context/media or material. */
export interface WorldLearningChoice{key:string;reference:PersonalMeaningLearningReference;targetLanguageTag:string;label:string;incarnation?:string}
export interface WorldLearningChoiceQuery extends WorldBrowseQuery{targetLanguageTag:string}
export interface WorldLearningChoicePage{items:WorldLearningChoice[];total:number}
export const worldLearningChoice=(source:PersonalMeaningLearningSource):WorldLearningChoice=>({key:personalLearningSourceKey(source.reference),reference:source.reference,targetLanguageTag:source.targetLanguageTag,label:source.expression.surfaceForm});
export function validateWorldLearningChoiceQuery(input:WorldLearningChoiceQuery):WorldLearningChoiceQuery{
 if(typeof input.targetLanguageTag!=='string'||!input.targetLanguageTag||input.targetLanguageTag.length>100)throw new Error('world_learning_query_invalid');
 return {...validateWorldQuery(input),targetLanguageTag:input.targetLanguageTag};
}
export type WorldRecordRead=(table:'semanticRegistry'|'semanticMeanings',key:string)=>unknown|undefined;
export class WorldSourceInvalidError extends Error{
 constructor(message:string,options?:ErrorOptions){super(message,options);this.name='WorldSourceInvalidError';}
}
const fields={
 senseId:'senses',senseVersionId:'senseVersions',currentSenseVersionId:'senseVersions',
 expressionId:'expressions',expressionVersionId:'expressionVersions',currentExpressionVersionId:'expressionVersions',
 senseExpressionBindingId:'bindings',bindingId:'bindings',bindingVersionId:'bindingVersions',currentBindingVersionId:'bindingVersions',
} as const;
const ownIds={senses:'senseId',senseVersions:'senseVersionId',expressions:'expressionId',expressionVersions:'expressionVersionId',bindings:'senseExpressionBindingId',bindingVersions:'bindingVersionId'} as const;
export function worldFactRegistryReferences(value:object):string[]{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new WorldSourceInvalidError('world_fact_invalid');
 return Object.entries(value).flatMap(([field,id])=>Object.hasOwn(fields,field)&&typeof id==='string'?[`${fields[field as keyof typeof fields]}:${id}`]:[]);
}

/** Load only explicit semantic references and their current heads. Arbitrary
 * learner strings, Context source payloads and media are not dependency edges. */
export function worldRegistryClosure(record:MeaningJourneyRecord,read:WorldRecordRead,onReference?:(key:string)=>void):SenseRegistryState{
 if(!record||!record.personalMeaning||typeof record.personalMeaning!=='object')throw new WorldSourceInvalidError('world_meaning_invalid');
 const registry=emptyJourneyState().registry,requested=new Set<string>(),pending:string[]=[];
 const references=(value:object)=>{
  for(const key of worldFactRegistryReferences(value)){
   if(!requested.has(key)){requested.add(key);pending.push(key);onReference?.(key);}
  }
 };
 for(const branch of meaningHistoryRecords(record))for(const rows of Object.values(branch))if(Array.isArray(rows))for(const fact of rows)references(fact);
 for(let at=0;at<pending.length;at++){
  const key=pending[at]!,kind=key.slice(0,key.indexOf(':')) as keyof SenseRegistryState,id=key.slice(key.indexOf(':')+1);
  const raw=read('semanticRegistry',key) as {kind?:string;value?:Record<string,unknown>}|undefined;
  if(!raw||raw.kind!==kind||raw.value?.[ownIds[kind]]!==id)throw new WorldSourceInvalidError('world_registry_reference_invalid');
  (registry[kind] as unknown[]).push(raw.value);references(raw.value);
 }
 return registry;
}

/** Same authority and projection as the full gateway, scoped to one aggregate. */
export function worldItemFromRecord(record:MeaningJourneyRecord,read:WorldRecordRead,onReference?:(key:string)=>void):JourneyWorldItemView{
 const registry=worldRegistryClosure(record,read,onReference);
 return worldItemFromRegistry(record,registry);
}
export function worldItemFromRegistry(record:MeaningJourneyRecord,registry:SenseRegistryState):JourneyWorldItemView{
 try{
  assertPersonalSemanticWorldRecord(record,registry);
  return buildWorldItemView(record,indexRegistry(registry));
 }catch(cause){throw new WorldSourceInvalidError('world_source_invalid',{cause});}
}
export function summarizeWorldItem(item:JourneyWorldItemView):WorldBrowseItem{
 const branches=[...item.detail.focuses.map(focus=>focus.alignment),...item.detail.directAlignments];
 const expression=branches.flatMap(branch=>branch?.confirmedBindings??[])[0]?.surfaceForm;
 const references:WorldMeaningReference[]=[...branches.flatMap(branch=>branch?[{branch,historical:false}]:[]),...(item.detail.alignmentHistory??[]).map(branch=>({branch,historical:true}))].flatMap(({branch,historical})=>branch.confirmedBindings[0]?[{personalMeaningAlignmentId:branch.personalMeaningAlignmentId,senseId:branch.senseId,word:branch.confirmedBindings[0].surfaceForm,meaning:branch.coreMeaningFocus,historical}]:[]);
 const expressions=[...new Map(branches.flatMap(branch=>branch?.confirmedBindings??[]).map(binding=>[binding.expressionId,{expressionId:binding.expressionId,surfaceForm:binding.surfaceForm,languageTag:binding.languageTag}])).values()];
 return {personalMeaningId:item.personalMeaningId,status:item.detail.status,senseIds:[...new Set(branches.flatMap(branch=>branch?[branch.senseId]:[]))],references,label:expression||item.experienceAnchors[0]?.surfaceForm||item.familiarAnchors[0]?.surfaceForm||item.primaryLabel,
  expressions,
  ...(item.senseFormation.phase!=='sense_confirmed'||item.expressionBinding.phase!=='bound'?{draftLabel:item.experienceAnchors[0]?.surfaceForm||item.familiarAnchors[0]?.surfaceForm||item.primaryLabel}:{}),
  primaryLabel:item.primaryLabel,updatedAt:item.updatedAt,senseFormation:item.senseFormation,expressionBinding:item.expressionBinding};
}
export function worldSearchText(item:JourneyWorldItemView):string{
 const branches=[...item.detail.focuses.map(focus=>({label:focus.statement,alignment:focus.alignment})),...item.detail.directAlignments.map(alignment=>({label:alignment.coreMeaningFocus||alignment.senseShortId,alignment}))];
 return normalizeMeaningQuery([summarizeWorldItem(item).label,...item.familiarAnchors.map(anchor=>anchor.surfaceForm),...item.experienceAnchors.map(anchor=>anchor.surfaceForm),
  ...item.detail.materialBlocks.flatMap(block=>[block.bodyText??'',block.capturedSource?.text??'']),...(item.detail.capturedSources??[]).map(source=>source.text??''),
  ...branches.flatMap(branch=>[branch.label,...(branch.alignment?.confirmedBindings.map(binding=>binding.surfaceForm)??[])])].join(' '));
}
export function isWorldRecordVisible(record:MeaningJourneyRecord,registry:SenseRegistryState,includeDeleted=false):boolean{
 return (record.personalMeaning.status==='active'||includeDeleted&&record.personalMeaning.status==='deleted')&&confirmedLookupConnections(record,indexRegistry(registry),includeDeleted).length>0;
}
export function matchesWorldFilter(item:Pick<WorldBrowseItem,'senseFormation'|'expressionBinding'>,filter:WorldFilter):boolean{
 return filter==='all'||filter==='deleted'||filter==='pending'&&(item.senseFormation.phase!=='sense_confirmed'||item.expressionBinding.phase!=='bound')||filter==='continue'&&item.senseFormation.phase!=='sense_confirmed'
  ||filter==='binding'&&['pending','partial'].includes(item.expressionBinding.phase)||filter==='complete'&&item.expressionBinding.phase==='bound';
}
export function validateWorldQuery(input:WorldBrowseQuery):WorldBrowseQuery{
 if(typeof input.query!=='string'||input.query.length>200||!['all','continue','binding','complete','pending','deleted'].includes(input.filter)
  ||!Number.isSafeInteger(input.offset)||input.offset<0||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>256)throw new Error('world_query_invalid');
 if(input.senseIds!==undefined&&(!Array.isArray(input.senseIds)||input.senseIds.length>256||input.senseIds.some(id=>typeof id!=='string'||!id||id.length>200)))throw new Error('world_query_invalid');
 if(input.expressionLanguages!==undefined&&(!Array.isArray(input.expressionLanguages)||input.expressionLanguages.length>32||input.expressionLanguages.some(tag=>typeof tag!=='string'||!tag||tag.length>100)))throw new Error('world_query_invalid');
 if(input.referenceFilter!==undefined&&!['all','saved','notes'].includes(input.referenceFilter))throw new Error('world_query_invalid');
 return {...input,query:normalizeMeaningQuery(input.query)};
}
export function worldReferenceSenseIds(rows:readonly unknown[],filter:'saved'|'notes'):string[]{
 const kind=filter==='saved'?'saved_sense':'sense_note';
 return rows.flatMap(raw=>{
  const row=raw as {id?:unknown;kind?:unknown;senseId?:unknown;body?:unknown}|null;
  if(row?.kind!==kind)return [];
  if(typeof row.senseId!=='string'||!row.senseId||row.id!==`${kind}:${encodeURIComponent(row.senseId)}`||filter==='notes'&&typeof row.body!=='string')throw new WorldSourceInvalidError('world_reference_invalid');
  return filter==='notes'&&!row.body?[]:[row.senseId];
 });
}
/** Languages qualify expressions, never the Meaning or its Context. */
export function matchesWorldLanguages(item:Pick<WorldBrowseItem,'expressions'>,languages:readonly string[]|undefined):boolean{
 return !languages?.length||!!item.expressions?.some(expression=>languages.includes(expression.languageTag));
}
