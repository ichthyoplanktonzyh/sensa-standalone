import {readMeaningContexts,type ContextRecord} from './contextRecords';
import {contextMaterialBlocks,type ContextBrowseQuery,type ContextDetail} from './contextRead';
/** Purpose-specific learner reads. Browsing never hydrates the command gateway. */
import {assertCurrentLibrary,readLibrary,observeLibrary,readLocalLibraryRevision,type LibraryTransaction} from '../../data/library/store';
import {JOURNEY_STORE_VERSION,StoreCorruptedError,type MeaningJourneyRecord} from './store';
import {type WorldGraphQuery,type WorldGraphRead,worldFactRegistryReferences,worldRegistryClosure,worldItemFromRegistry,type WorldBrowseQuery,type WorldBrowsePage,type WorldLearningChoiceQuery,type WorldLearningChoicePage,type WorldLearningChoice} from './worldRead';
import {isUuid} from './ids';
import type {JourneyDetailView,ClarificationDraftView} from './types';
import {sensaIntakeItemSchema} from '@sensa/contracts/sensa';
import {buildPersonalMeaningLearningSources,hydratePersonalLearningImages} from './learningSource';
import {parseStoredMedia} from '../../data/library/media';
import {indexRegistry} from './registryRead';
import type {PersonalMeaningLearningSource} from '../../contentSupply/system';
import {clarificationSourceWitness,meaningSourceValue,intakeSourceValue,type ClarificationSourceWitness,type ClarificationSourceKind} from './clarificationSource';
import type {JourneyState,SenseRegistryState} from './store';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {meaningCorrectionPayload,currentMeaningContextRevisions,meaningCorrectionContext} from './meaningCorrection';
import {meaningHistoryRecords} from './meaningHistoryRead';
export interface PersonalMeaningCorrectionSeed extends WorldReadStamp{
 personalMeaningId:string;personalMeaningAlignmentId:string;source:ClarificationSourceWitness;
 payload:import('@sensa/contracts/sensa').SensaIntakePayload;reuseSense:{senseId:string;senseVersionId:string};
 personalSenseWording:string|null;published:boolean;contextRevisionIds:string[];
 images:import('@sensa/contracts/sensa').SensaContextImage[];
}

export interface WorldReadStamp{incarnation:string;revision:number}
export type WorldInboxSnapshot=WorldReadStamp&{items:JourneyState['inboxItems'];drafts:Array<{personalMeaningId:string;label:string}>};
export type WorldGraphSnapshot=WorldGraphRead&WorldReadStamp;
export type WorldGraphDetailSnapshot=WorldReadStamp&{detail:JourneyDetailView|null};
export type WorldPageSnapshot=WorldBrowsePage&WorldReadStamp&{inboxCount:number};
export type WorldLearningChoiceSnapshot=WorldLearningChoicePage&WorldReadStamp;
export type WorldDetailSnapshot=WorldReadStamp&{detail:JourneyDetailView|null;draft:ClarificationDraftView|null;sources:PersonalMeaningLearningSource[];source:ClarificationSourceWitness|null};
export async function readWorldFrame(tx:LibraryTransaction):Promise<WorldReadStamp>{
 const incarnation=await assertCurrentLibrary(tx),revision=await readLocalLibraryRevision(tx);
 const root=await tx.get<{version:string}>('semanticState','root');
 if(root&&root.version!==JOURNEY_STORE_VERSION)throw new StoreCorruptedError('本机的个人意义数据版本不匹配。');
 if(!root)for(const table of ['semanticMeanings','semanticContexts','semanticRegistry','semanticInbox','semanticDrafts','semanticReceipts'] as const)
  if(await tx.count(table))throw new StoreCorruptedError('本机的个人意义数据缺少版本记录。');
 return {incarnation,revision};
}
export async function readMeaningRegistry(tx:Pick<LibraryTransaction,'get'>,record:MeaningJourneyRecord):Promise<{registry:SenseRegistryState;records:ReadonlyMap<string,unknown>}>{
 const keys=new Set<string>();
 for(const branch of meaningHistoryRecords(record))for(const rows of Object.values(branch))if(Array.isArray(rows))for(const fact of rows)for(const key of worldFactRegistryReferences(fact))keys.add(key);
 return readRegistryRecords(tx,[...keys],record);
}
/** Command frames reuse the same exact-reference/current-head traversal. */
export async function readRegistryRecords(tx:Pick<LibraryTransaction,'get'>,initialKeys:readonly string[],record?:MeaningJourneyRecord):Promise<{registry:SenseRegistryState;records:ReadonlyMap<string,unknown>}>{
 const records=new Map<string,unknown>(),keys=new Set(initialKeys);
 let pending=[...keys];
 while(pending.length){
  const fetched=await Promise.all(pending.map(async key=>({key,value:await tx.get('semanticRegistry',key)})));pending=[];
  for(const {key,value} of fetched){
   records.set(key,value);
   const wrapped=value as {value?:object}|undefined;
   if(wrapped?.value)for(const dependency of worldFactRegistryReferences(wrapped.value))if(!keys.has(dependency)){keys.add(dependency);pending.push(dependency);}
  }
 }
 if(record)return {records,registry:worldRegistryClosure(record,(_table,key)=>records.get(key))};
 const registry={senses:[],senseVersions:[],expressions:[],expressionVersions:[],bindings:[],bindingVersions:[]} as SenseRegistryState;
 for(const [key,raw] of records){
  const row=raw as {kind:keyof SenseRegistryState;ordinal:number;value:Record<string,any>}|undefined;
  const kind=key.slice(0,key.indexOf(':')) as keyof SenseRegistryState;
  const identities={senses:'senseId',senseVersions:'senseVersionId',expressions:'expressionId',expressionVersions:'expressionVersionId',bindings:'senseExpressionBindingId',bindingVersions:'bindingVersionId'} as const;
  if(!row||row.kind!==kind||!Object.hasOwn(identities,kind)||row.value?.[identities[kind]]!==key.slice(key.indexOf(':')+1)||!Number.isSafeInteger(row.ordinal)||row.ordinal<0)throw new StoreCorruptedError('固定注册表依赖缺失或损坏。');
 }
 for(const kind of Object.keys(registry) as Array<keyof SenseRegistryState>)(registry[kind] as unknown[]).push(...[...records.values()].map(raw=>raw as {kind:string;ordinal:number;value:unknown}).filter(row=>row.kind===kind).sort((a,b)=>a.ordinal-b.ordinal).map(row=>row.value));
 return {records,registry};
}
export const worldReadRepository={
 subscribe(listener:()=>void):()=>void{return observeLibrary(listener,['semanticState','semanticMeanings','semanticContexts','semanticRegistry','semanticInbox','semanticDrafts','annotations','meta'],{meta:['identity','local-incarnation']});},
 contextPage(query:ContextBrowseQuery){return readLibrary(async tx=>({...await readWorldFrame(tx),...await tx.contextBrowse(query)}));},
 contextDetail(contextId:string){return readLibrary(async tx=>{const stamp=await readWorldFrame(tx);if(!isUuid(contextId))throw Error('context_query_invalid');const head=await tx.get<ContextRecord>('semanticContexts',`anchors:${contextId}`);if(!head)return {...stamp,detail:null};if(head.kind!=='anchors')throw Error('semantic_context_invalid');const revision=await tx.get<ContextRecord>('semanticContexts',`anchorRevisions:${head.value.currentRevisionId}`);if(revision?.kind!=='anchorRevisions')throw Error('semantic_context_invalid');let next:string|null=head.value.currentRevisionId,sceneManaged=false;while(next){const row:ContextRecord|undefined=await tx.get<ContextRecord>('semanticContexts',`anchorRevisions:${next}`);if(row?.kind!=='anchorRevisions')throw Error('semantic_context_invalid');sceneManaged ||= !!row.value.structuredPayload.learningScene;next=row.parentRevisionId;}const detail:ContextDetail={sceneManaged,head:head.value,revision:revision.value,blocks:contextMaterialBlocks(revision.value),meaningCount:(await tx.contextBrowse({contextId,query:'',status:'all',offset:0,limit:1})).items[0]?.meaningCount??0};return {...stamp,detail};});},
 draftConfirmation(id:string){return readLibrary(async tx=>{const stamp=await readWorldFrame(tx),record=await readMeaningContexts(tx,id);if(!record||record.personalMeaning.status!=='active'||record.alignments.length)throw Error('localFlow.meaningChanged');const ids=record.personalSemanticAnchors.filter(row=>row.status==='active').map(head=>record.personalSemanticAnchorRevisions.find(row=>row.personalSemanticAnchorId===head.personalSemanticAnchorId&&row.revision===head.currentRevision)!.personalSemanticAnchorRevisionId);const revision=record.personalMeaningRevisions.at(-1)!;return {revision:record.personalMeaning.currentRevision,personalMeaningId:id,source:clarificationSourceWitness(stamp.incarnation,'personal_meaning',id,meaningSourceValue(record)),context:ids.length?meaningCorrectionContext(record,ids):null,contextRevisionIds:ids,meaning:revision.learnerIntentNote??'',expression:revision.draftExpression??null};});},
 inbox():Promise<WorldInboxSnapshot>{return readLibrary(async tx=>{
  const stamp=await readWorldFrame(tx),items:JourneyState['inboxItems']=[],drafts:WorldInboxSnapshot['drafts']=[];
  // One Library snapshot keeps both Inbox categories coherent. Read only
  // pending material and compact pending summaries, never the confirmed World.
  for await(const rows of tx.entryBatches('semanticInbox'))for(const row of rows){
   const item=sensaIntakeItemSchema.parse(row.value);
   if(item.intakeId!==row.key)throw new StoreCorruptedError('待处理材料身份与存储记录不一致。');
   items.push(item);
  }
  const inboxIds=new Set(items.map(item=>item.intakeId));
  for await(const rows of tx.entryBatches('semanticDrafts'))for(const row of rows){
   const hint=row.value as JourneyState['clarificationDrafts'][number]|undefined;
   if(!hint||hint.intakeId!==row.key||!inboxIds.has(row.key)||!['from_expression','from_experience','from_sense',null].includes(hint.startingPoint))throw new StoreCorruptedError('待处理材料的会话记录缺失或不可用。');
  }
  for(let offset=0;;offset+=128){
   const page=await tx.worldBrowse({query:'',filter:'pending',offset,limit:128});
   for(const item of page.items){
    if(item.draftLabel===undefined)throw new StoreCorruptedError('待处理条目的摘要不可用。');
    drafts.push({personalMeaningId:item.personalMeaningId,label:item.draftLabel});
   }
   if(offset+page.items.length>=page.total)break;
   if(!page.items.length)throw new StoreCorruptedError('待处理条目的分页不完整。');
  }
  return {...stamp,items,drafts};
 });},
 graph(query:WorldGraphQuery,signal?:AbortSignal):Promise<WorldGraphSnapshot>{
  const started=performance.now();
  return readLibrary(async tx=>{signal?.throwIfAborted();const stamp=await readWorldFrame(tx),graph=await tx.worldGraph(query);signal?.throwIfAborted();if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.graph.read',{start:started,end:performance.now()});return {...stamp,...graph};});
 },
 graphDetail(id:string):Promise<WorldGraphDetailSnapshot>{
  if(!isUuid(id))return Promise.reject(new Error('world_meaning_id_invalid'));
  return readLibrary(async tx=>{const stamp=await readWorldFrame(tx),record=await readMeaningContexts(tx,id);if(!record)throw new StoreCorruptedError('图谱节点的个人意义缺失。');if(record.personalMeaning.personalMeaningId!==id)throw new StoreCorruptedError('个人意义身份与存储记录不一致。');const {registry}=await readMeaningRegistry(tx,record);return {...stamp,detail:worldItemFromRegistry(record,registry).detail};});
 },
 page(query:WorldBrowseQuery):Promise<WorldPageSnapshot>{return readLibrary(async tx=>({...await readWorldFrame(tx),...await tx.worldBrowse(query),inboxCount:await tx.count('semanticInbox')}));},
 references(senseIds:readonly string[]):Promise<WorldBrowsePage['items']>{return readLibrary(async tx=>{
  await readWorldFrame(tx);
  const ids=[...new Set(senseIds)],items=new Map<string,WorldBrowsePage['items'][number]>();
  for(let at=0;at<ids.length;at+=256)for(let offset=0;;offset+=256){
   const page=await tx.worldBrowse({query:'',filter:'all',offset,limit:256,senseIds:ids.slice(at,at+256)});
   for(const item of page.items)items.set(item.personalMeaningId,item);
   if(offset+page.items.length>=page.total)break;
   if(!page.items.length)throw new StoreCorruptedError('个人意义引用的分页不完整。');
  }
  return [...items.values()];
 });},
 learningChoices(query:WorldLearningChoiceQuery):Promise<WorldLearningChoiceSnapshot>{return readLibrary(async tx=>{
  const stamp=await readWorldFrame(tx),page=await tx.worldLearningChoices(query);
  return {...stamp,...page,items:page.items.map(choice=>({...choice,incarnation:stamp.incarnation}))};
 });},
 async resolveLearningChoice(choice:WorldLearningChoice):Promise<PersonalMeaningLearningSource>{
  const snapshot=await this.detail(choice.reference.personalMeaningId);
  if(choice.incarnation!==undefined&&choice.incarnation!==snapshot.incarnation)throw new Error('localFlow.meaningChanged');
  const source=snapshot.sources.find(source=>canonicalConsumerJson(source.reference)===canonicalConsumerJson(choice.reference)&&source.targetLanguageTag===choice.targetLanguageTag);
  if(!source)throw new Error('localFlow.meaningChanged');
  return source;
 },
 captureSource(kind:ClarificationSourceKind,id:string):Promise<ClarificationSourceWitness>{
  if(!isUuid(id))return Promise.reject(new Error('world_source_id_invalid'));
  return readLibrary(async tx=>{
   const stamp=await readWorldFrame(tx);
   const value=kind==='personal_meaning'?meaningSourceValue(await readMeaningContexts(tx,id))
    :intakeSourceValue(await tx.get<JourneyState['inboxItems'][number]>('semanticInbox',id),await tx.get<JourneyState['clarificationDrafts'][number]>('semanticDrafts',id));
   return clarificationSourceWitness(stamp.incarnation,kind,id,value);
  });
 },
 correction(id:string,alignmentId:string):Promise<PersonalMeaningCorrectionSeed>{
  if(!isUuid(id)||!isUuid(alignmentId))return Promise.reject(Error('world_meaning_id_invalid'));
  return readLibrary(async tx=>{
   const stamp=await readWorldFrame(tx),record=await readMeaningContexts(tx,id);
   if(!record||record.personalMeaning.personalMeaningId!==id)throw Error('localFlow.meaningChanged');
   const {registry}=await readMeaningRegistry(tx,record);worldItemFromRegistry(record,registry);
   const payload=meaningCorrectionPayload(record,indexRegistry(registry),alignmentId),alignment=record.alignments.find(row=>row.personalMeaningAlignmentId===alignmentId)!;
   const locator=payload.expression?.occurrence?.locator??{kind:'personal_meaning' as const,personalMeaningId:id,personalSemanticAnchorRevisionIds:currentMeaningContextRevisions(record).map(row=>row.personalSemanticAnchorRevisionId)};if(locator.kind!=='personal_meaning')throw Error('localFlow.meaningChanged');
   const inline=locator.personalSemanticAnchorRevisionIds.map(id=>record.personalSemanticAnchorRevisions.find(row=>row.personalSemanticAnchorRevisionId===id)!).flatMap(context=>Array.isArray(context.structuredPayload.media)?context.structuredPayload.media:[]);
   const byId=new Map(inline.map((item:any)=>[item.mediaId,{id:item.mediaId,name:item.fileName??'personal-scene',dataUrl:item.dataUrl}]));
   const images=await Promise.all(payload.context!.mediaReferenceIds.map(async mediaId=>{const available=byId.get(mediaId);if(available)return available;const media=parseStoredMedia(await tx.get('media',mediaId));if(media.mediaId!==mediaId)throw Error('localFlow.meaningChanged');return {id:mediaId,name:'personal-context',dataUrl:media.dataUrl};}));
   const senseVersion=registry.senseVersions.find(row=>row.senseVersionId===alignment.senseVersionId)!;
   return {...stamp,contextRevisionIds:locator.personalSemanticAnchorRevisionIds,personalMeaningId:id,personalMeaningAlignmentId:alignmentId,source:clarificationSourceWitness(stamp.incarnation,'personal_meaning',id,meaningSourceValue(record)),payload,images,personalSenseWording:record.personalMeaningRevisions.find(row=>row.personalMeaningRevisionId===alignment.personalMeaningRevisionId)?.personalSenseWording??null,published:senseVersion.origin!=='learner_confirmed'||senseVersion.contentReleaseId!==null,reuseSense:{senseId:alignment.senseId,senseVersionId:alignment.senseVersionId}};
  });
 },
 detail(id:string):Promise<WorldDetailSnapshot>{
  if(!isUuid(id))return Promise.reject(new Error('world_meaning_id_invalid'));
  return readLibrary(async tx=>{
   const stamp=await readWorldFrame(tx),record=await readMeaningContexts(tx,id);
   if(!record){
    const raw=await tx.get('semanticInbox',id);
    const metadata=await tx.get<{intakeId:string;startingPoint:ClarificationDraftView['startingPoint']|null}>('semanticDrafts',id);
    if(!raw){if(metadata)throw new StoreCorruptedError('待处理材料的会话记录缺少材料。');return {...stamp,detail:null,draft:null,sources:[],source:null};}
    const item=sensaIntakeItemSchema.parse(raw);
    if(item.intakeId!==id)throw new StoreCorruptedError('待处理材料身份与存储记录不一致。');
    if(metadata&&(metadata.intakeId!==id||!['from_expression','from_experience','from_sense',null].includes(metadata.startingPoint)))throw new StoreCorruptedError('待处理材料的会话记录不可用。');
    const context=item.payload.context;
    const draft:ClarificationDraftView={intakeId:id,context:context?structuredClone(context):null,
     materialBlocks:[...(context?.textSegment?[{kind:'text' as const,bodyText:context.textSegment}]:[]),...(context?.mediaReferenceIds.map(personalMediaObjectId=>({kind:'image' as const,personalMediaObjectId}))??[])],
     familiarExpression:item.payload.expression?.surfaceForm??null,
     startingPoint:metadata?.startingPoint??(item.status==='pending_context'?item.payload.expression?'from_expression':'from_experience':item.status==='pending_expression'?'from_experience':'from_expression')};
    return {...stamp,detail:null,draft,sources:[],source:clarificationSourceWitness(stamp.incarnation,'intake',id,intakeSourceValue(item,metadata))};
   }
   if(record.personalMeaning.personalMeaningId!==id)throw new StoreCorruptedError('个人意义身份与存储记录不一致。');
   const {registry}=await readMeaningRegistry(tx,record),item=worldItemFromRegistry(record,registry);
   if(record.personalMeaning.status==='deleted')return {...stamp,detail:item.detail,draft:null,sources:[],source:null};
   const sources=await hydratePersonalLearningImages(record,buildPersonalMeaningLearningSources(record,indexRegistry(registry)),async mediaId=>{
    const media=parseStoredMedia(await tx.get('media',mediaId));if(media.mediaId!==mediaId)throw new StoreCorruptedError('Context 图片引用不一致。');
    return {id:mediaId,name:'personal-context-image',dataUrl:media.dataUrl};
   });
   return {...stamp,detail:item.detail,draft:null,sources,source:clarificationSourceWitness(stamp.incarnation,'personal_meaning',id,meaningSourceValue(record))};
  });
 },
};
