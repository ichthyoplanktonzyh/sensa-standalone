import {contextBrowseFacts,validateContextQuery,type ContextBrowseQuery,type ContextBrowsePage} from '../../experience/personalMeaningJourney/contextRead';
import type {ContextRecord} from '../../experience/personalMeaningJourney/contextRecords';
import {learningScenePersonalMeaningId} from './personalSceneIdentity';
import {hydrateMeaningContexts,contextMediaReferences} from '../../experience/personalMeaningJourney/contextRecords';
import type {LearningScheduleQuery,LearningSchedulePage} from '../../learning/system/learningScheduleModel';
import type {SqliteRecordAdapter} from './sqliteAdapter';
import {meaningMediaReferences,meaningHistoryRecords} from '../../experience/personalMeaningJourney/meaningHistoryRead';
import type {HomeLearningStorageProjection,PortableMediaBlob,PortableMediaStorageDiagnostics,SqliteLibraryTable,SqliteMutation,SqliteRecordChange,SqliteSyncBaseEntry,SqliteStorageDiagnostics} from './sqliteProtocol';
import {sqliteLibrarySchemaVersion} from './sqliteProtocol';
import {decodeBackupValue} from './backupCodec';
import type {PackageCacheProjectionQuery,PackageCacheProjectionResult} from './packageCacheProjection';
import {createHomeLearningStorageProjection,createHomeLearningTargetRecord} from './homeLearningRecords';
import {runtimeLearningCandidatesFromRecords,learningManagementSummaryFromRecords,learningScheduleFromRecords,type RuntimeLearningCandidateQuery,type RuntimeLearningCandidates,type LearningManagementSummaryQuery,type LearningManagementStorageSummary} from './runtimeLearningCandidates';
import {learningHistoryPageFromRecords,type StoredLearningHistoryPage} from './learningHistoryProjection';
import type {LearningHistoryRequest} from '../../learning/system/learningHistoryModel';
import type {LocalLearningRun,LocalLearningTarget} from '../../learning/runtime/localProtocol';
import {localLastPresentedMaterial} from '../../learning/runtime/localCurriculum';
import {learningSupportMeaning} from '@sensa/contracts/sensa';
import {emptyJourneyState,type MeaningJourneyRecord,type SenseRegistryState} from '../../experience/personalMeaningJourney/store';
import {createMeaningLookup,type MeaningLookupResult} from '../../experience/personalMeaningJourney/meaningLookup';
import {projectWorldGraphItem,type WorldGraphQuery,type WorldGraphRead,worldRegistryClosure,worldItemFromRecord,summarizeWorldItem,worldSearchText,isWorldRecordVisible,matchesWorldFilter,matchesWorldLanguages,worldReferenceSenseIds,validateWorldQuery,type WorldBrowseQuery,type WorldBrowsePage,type WorldRecordRead} from '../../experience/personalMeaningJourney/worldRead';
import {validateWorldLearningChoiceQuery,worldLearningChoice,type WorldLearningChoiceQuery,type WorldLearningChoicePage} from '../../experience/personalMeaningJourney/worldRead';
import {buildPersonalMeaningLearningSources} from '../../experience/personalMeaningJourney/learningSource';
import {indexRegistry} from '../../experience/personalMeaningJourney/registryRead';
import {practiceExpressionsFromPersonal,practiceExpressionsFromPackage,validatePracticeExpressionQuery,practiceExpressionForm,type PracticeExpressionQuery,type PracticeExpressionPage} from './practiceExpressionProjection';
import {journeyIdentityTables,journeyReservedIdentities} from '../../experience/personalMeaningJourney/reservedIdentities';
import {confirmedLookupConnections} from '../../experience/personalMeaningJourney/meaningLookupFacts';
import {isUuid} from '../../experience/personalMeaningJourney/ids';
import {memoryRegistrySelection,type RegistrySelectionQuery,type RegistrySelection} from './semanticRegistrySelection';

/** Test/non-browser Adapter. Production never selects this path. */
export class MemoryRecordAdapter implements SqliteRecordAdapter {
  async contextBrowse(raw:ContextBrowseQuery):Promise<ContextBrowsePage>{
    const query=validateContextQuery(raw),decode=(table:string,key:string)=>{const value=this.records.get(`${table}\u0000${key}`);return value===undefined?undefined:decodeBackupValue(JSON.parse(value));},counts=new Map<string,number>();
    for(const [key,encoded] of this.records)if(key.startsWith('semanticMeanings\u0000')){const record=decodeBackupValue(JSON.parse(encoded));if(record.personalMeaning.status==='active')for(const ref of record.personalSemanticAnchors)if(ref.status==='active')counts.set(ref.personalSemanticAnchorId,(counts.get(ref.personalSemanticAnchorId)??0)+1);}
    const rows=[...this.records].filter(([key])=>key.startsWith('semanticContexts\u0000anchors:')).flatMap(([,encoded])=>{const head=decodeBackupValue(JSON.parse(encoded)) as ContextRecord;if(head.kind!=='anchors'||(query.status??'active')!=='all'&&head.value.status!==(query.status??'active')||query.contextId!==undefined&&head.value.personalSemanticAnchorId!==query.contextId)return [];const revision=decode('semanticContexts',`anchorRevisions:${head.value.currentRevisionId}`) as ContextRecord|undefined;if(revision?.kind!=='anchorRevisions')throw Error('semantic_context_invalid');return [contextBrowseFacts(head.value,revision.value,counts.get(head.value.personalSemanticAnchorId)??0)];}).filter(row=>row.text.includes(query.query)).sort((a,b)=>b.item.updatedAt.localeCompare(a.item.updatedAt)||a.item.contextId.localeCompare(b.item.contextId));return {items:rows.slice(query.offset,query.offset+query.limit).map(row=>row.item),total:rows.length};
  }
  async replicaCandidate(_request:import('./replicaCandidateProtocol').ReplicaCandidateRequest):Promise<import('./replicaCandidateProtocol').ReplicaCandidateResponse>{throw Error('sqlite_replica_candidate_unavailable');}
  private practiceRevision=0;
  async practiceExpressions(raw:PracticeExpressionQuery):Promise<PracticeExpressionPage>{
    const query=validatePracticeExpressionQuery(raw),table=query.source==='personal'?'semanticMeanings':'packageCache',selected=query.selectedIds?new Set(query.selectedIds):null,excluded=new Set(query.excludedIds??[]);
    const items=new Map<string,import('./practiceExpressionProjection').PracticeExpression>();
    for(const [key,encoded] of this.records)if(key.startsWith(table+'\u0000')){
      const owner=key.slice(table.length+1),value=decodeBackupValue(JSON.parse(encoded));
      const expressionRead=(key:string)=>{const encoded=this.records.get('semanticRegistry\u0000'+key);return encoded===undefined?undefined:decodeBackupValue(JSON.parse(encoded));};
      for(const item of query.source==='personal'?practiceExpressionsFromPersonal(value,owner,expressionRead):practiceExpressionsFromPackage(value,owner))
        if(item.languageTag===query.languageTag&&practiceExpressionForm(item.text,item.languageTag).startsWith(query.query)&&(!selected||selected.has(item.id))&&!excluded.has(item.id)&&!items.has(item.id))items.set(item.id,item);
    }
    const sorted=[...items.values()].sort((a,b)=>{const af=practiceExpressionForm(a.text,a.languageTag),bf=practiceExpressionForm(b.text,b.languageTag);return af<bf?-1:af>bf?1:a.id<b.id?-1:a.id>b.id?1:0;}),page=sorted.slice(query.offset,query.offset+query.limit);
    return {total:sorted.length,revision:this.practiceRevision,ids:page.map(item=>item.id),items:query.idsOnly?[]:page};
  }
  async personalEnrollmentIndex():Promise<import('../../learning/system/learningReadModels').LearningPersonalEnrollmentIndex>{
    const {personalEnrollmentTarget}=await import('./learningSemanticMemoryProjection');
    return {targets:(await this.entries('learningTargets')).map(row=>personalEnrollmentTarget(decodeBackupValue(JSON.parse(row.encodedValue!))))};
  }
  async learningSemanticMemory(targetId?:string):Promise<import('../../learning/system/learningReadModels').LearningSemanticMemoryProjection>{
    const {learningSemanticMemoryTarget}=await import('./learningSemanticMemoryProjection');
    const rows=targetId===undefined?await this.entries('learningTargets'):[{key:targetId,encodedValue:await this.get('learningTargets',targetId)}];
    return {targets:rows.flatMap(row=>row.encodedValue?[learningSemanticMemoryTarget(decodeBackupValue(JSON.parse(row.encodedValue)),targetId!==undefined)]:[])};
  }
  async registrySelection(query:RegistrySelectionQuery):Promise<RegistrySelection>{
    // This test adapter has no SQL planner. Do not call the public source-read
    // interface while emulating a purpose-specific selector internally.
    const rows=[...this.records].filter(([key])=>key.startsWith('semanticRegistry\u0000')).map(([key,encoded])=>({key:key.slice('semanticRegistry\u0000'.length),value:decodeBackupValue(JSON.parse(encoded)) as {kind:string;ordinal:number;value:Record<string,any>}}));
    return memoryRegistrySelection(query,rows);
  }
  async existingJourneyIdentities(ids:readonly string[]):Promise<string[]>{
    if(ids.length>256||ids.some(id=>!isUuid(id)))throw new Error('journey_identity_query_invalid');
    return [...new Set(ids)].filter(id=>this.journeyIdentityCounts.has(id)).sort();
  }
  async worldLearningChoices(raw:WorldLearningChoiceQuery):Promise<WorldLearningChoicePage>{
    const query=validateWorldLearningChoiceQuery(raw);
    const references=query.referenceFilter&&query.referenceFilter!=='all'?worldReferenceSenseIds((await this.entries('annotations')).map(row=>decodeBackupValue(JSON.parse(row.encodedValue))),query.referenceFilter):null;
    const read:WorldRecordRead=(table,key)=>{const encoded=this.records.get(`${table}\u0000${key}`);return encoded===undefined?undefined:decodeBackupValue(JSON.parse(encoded));};
    const choices=(await this.entries('semanticMeanings')).flatMap(row=>{
      const record=hydrateMeaningContexts(decodeBackupValue(JSON.parse(row.encodedValue)),key=>read('semanticContexts',key));
      const registry=worldRegistryClosure(record,read),item=worldItemFromRecord(record,read);
      return query.filter!=='deleted'&&isWorldRecordVisible(record,registry)&&matchesWorldFilter(item,query.filter)&&matchesWorldLanguages(summarizeWorldItem(item),query.expressionLanguages)&&(references===null||summarizeWorldItem(item).senseIds?.some(id=>references.includes(id)))&&worldSearchText(item).includes(query.query)&&(query.senseIds===undefined||summarizeWorldItem(item).senseIds?.some(id=>query.senseIds!.includes(id)))
        ?buildPersonalMeaningLearningSources(record,indexRegistry(registry)).filter(source=>source.targetLanguageTag===query.targetLanguageTag&&(!query.expressionLanguages?.length||query.expressionLanguages.includes(source.targetLanguageTag))).map(source=>({choice:worldLearningChoice(source),updatedAt:item.updatedAt})):[];
    }).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||(a.choice.reference.personalMeaningId<b.choice.reference.personalMeaningId?-1:a.choice.reference.personalMeaningId>b.choice.reference.personalMeaningId?1:a.choice.key<b.choice.key?-1:1));
    return {items:choices.slice(query.offset,query.offset+query.limit).map(row=>row.choice),total:choices.length};
  }
  async worldGraph(raw:WorldGraphQuery):Promise<WorldGraphRead>{
    const query=validateWorldQuery({...raw,offset:0,limit:256});
    const references=query.referenceFilter&&query.referenceFilter!=='all'?worldReferenceSenseIds((await this.entries('annotations')).map(row=>decodeBackupValue(JSON.parse(row.encodedValue))),query.referenceFilter):null;
    const read:WorldRecordRead=(table,key)=>{const encoded=this.records.get(`${table}\u0000${key}`);return encoded===undefined?undefined:decodeBackupValue(JSON.parse(encoded));};
    const rows=(await this.entries('semanticMeanings')).map(row=>{
      const record=hydrateMeaningContexts(decodeBackupValue(JSON.parse(row.encodedValue)),key=>read('semanticContexts',key)),registry=worldRegistryClosure(record,read),item=worldItemFromRecord(record,read);
      return {item,summary:summarizeWorldItem(item),visible:isWorldRecordVisible(record,registry),confirmed:confirmedLookupConnections(record,indexRegistry(registry)).length>0};
    }).sort((a,b)=>b.item.updatedAt.localeCompare(a.item.updatedAt)||a.item.personalMeaningId.localeCompare(b.item.personalMeaningId));
    const selected=rows.filter(row=>row.visible&&row.confirmed&&matchesWorldFilter(row.summary,query.filter)&&matchesWorldLanguages(row.summary,query.expressionLanguages)&&(references===null||row.summary.senseIds?.some(id=>references.includes(id)))&&worldSearchText(row.item).includes(query.query));
    return {items:selected.map(row=>projectWorldGraphItem(row.item)),expressionLanguages:[...new Set(rows.filter(row=>row.visible).flatMap(row=>row.summary.expressions?.map(expression=>expression.languageTag)??[]))].sort(),expressionCount:new Set(selected.flatMap(row=>row.summary.expressions?.filter(expression=>!query.expressionLanguages?.length||query.expressionLanguages.includes(expression.languageTag)).map(expression=>expression.expressionId)??[])).size};
  }
  async worldBrowse(raw:WorldBrowseQuery):Promise<WorldBrowsePage>{
    const query=validateWorldQuery(raw);
    const references=query.referenceFilter&&query.referenceFilter!=='all'?worldReferenceSenseIds((await this.entries('annotations')).map(row=>decodeBackupValue(JSON.parse(row.encodedValue))),query.referenceFilter):null;
    const read:WorldRecordRead=(table,key)=>{const encoded=this.records.get(`${table}\u0000${key}`);return encoded===undefined?undefined:decodeBackupValue(JSON.parse(encoded));};
    const records=(await this.entries('semanticMeanings')).map(row=>{
      const record=hydrateMeaningContexts(decodeBackupValue(JSON.parse(row.encodedValue)),key=>read('semanticContexts',key));
      const registry=worldRegistryClosure(record,read),item=worldItemFromRecord(record,read);
      return {item:summarizeWorldItem(item),search:worldSearchText(item),visible:isWorldRecordVisible(record,registry)};
    }).sort((a,b)=>b.item.updatedAt.localeCompare(a.item.updatedAt)||(a.item.personalMeaningId<b.item.personalMeaningId?-1:1));
    const visible=records.filter(row=>row.visible);
    const partition=query.filter==='deleted'?records.filter(row=>row.item.status==='deleted'):visible;
    const selected=partition.filter(row=>matchesWorldFilter(row.item,query.filter)&&matchesWorldLanguages(row.item,query.expressionLanguages)&&(references===null||row.item.senseIds?.some(id=>references.includes(id)))&&row.search.includes(query.query)&&(query.senseIds===undefined||row.item.references?.some(reference=>query.senseIds!.includes(reference.senseId))));
    return {items:selected.slice(query.offset,query.offset+query.limit).map(row=>row.item),total:selected.length,
      expressionLanguages:[...new Set(visible.flatMap(row=>row.item.expressions?.map(expression=>expression.languageTag)??[]))].sort(),
      expressionCount:new Set(selected.flatMap(row=>row.item.expressions?.filter(expression=>!query.expressionLanguages?.length||query.expressionLanguages.includes(expression.languageTag)).map(expression=>expression.expressionId)??[])).size,
      pending:visible.filter(row=>row.item.senseFormation.phase!=='sense_confirmed'||row.item.expressionBinding.phase!=='bound').length,
      next:visible.find(row=>row.item.senseFormation.phase!=='sense_confirmed'||row.item.expressionBinding.phase!=='bound')?.item??null};
  }
  async worldSceneMeaning(sceneId:string):Promise<string|null>{
    if(!isUuid(sceneId))throw new Error('scene_identity_invalid');
    const owner=learningScenePersonalMeaningId(sceneId),encoded=this.records.get(`semanticMeanings\u0000${owner}`);
    if(encoded===undefined)return null;
    const record=hydrateMeaningContexts(decodeBackupValue(JSON.parse(encoded)),key=>{const encoded=this.records.get(`semanticContexts\u0000${key}`);return encoded===undefined?undefined:decodeBackupValue(JSON.parse(encoded));});
    return meaningHistoryRecords(record).some(branch=>branch.personalSemanticAnchorRevisions.some(revision=>(revision.structuredPayload.learningScene as {sceneId?:string}|undefined)?.sceneId===sceneId))?owner:null;
  }
  async lookupMeanings(query:string):Promise<MeaningLookupResult>{
    const state=emptyJourneyState();
    state.meanings=(await this.entries('semanticMeanings')).map(row=>hydrateMeaningContexts(decodeBackupValue(JSON.parse(row.encodedValue)),key=>{const encoded=this.records.get(`semanticContexts\u0000${key}`);return encoded===undefined?undefined:decodeBackupValue(JSON.parse(encoded));}));
    for(const row of await this.entries('semanticRegistry')){
      const decoded=decodeBackupValue(JSON.parse(row.encodedValue)) as {kind:keyof SenseRegistryState;value:unknown};
      (state.registry[decoded.kind] as unknown[]).push(decoded.value);
    }
    return createMeaningLookup(state).query(query);
  }
  async existingRecordKeys(table:SqliteLibraryTable,keys:readonly string[]):Promise<string[]>{
    return [...new Set(keys)].filter(key=>this.records.has(`${table}\u0000${key}`)).sort();
  }
  async packageCacheProjection<Query extends PackageCacheProjectionQuery>(query:Query):Promise<PackageCacheProjectionResult<Query>>{
    const {createPackageCacheSummary,createPackagePublicationIdentity,isPackageCacheProjectionSource,learningExpressionForm,validateLearningPackageQuery}=await import('./packageCacheProjection');
    if(query.kind==='summaries_by_keys'){
      const values=await Promise.all([...new Set(query.keys)].map(async key=>{
        // Emulate the purpose-specific storage projection, not the public
        // source-record/hydration interface. Production uses its SQL index.
        const encoded=this.records.get(`packageCache\u0000${key}`);
        return encoded===undefined?null:decodeBackupValue(JSON.parse(encoded));
      }));
      return values.filter(isPackageCacheProjectionSource).map(createPackageCacheSummary).sort((a,b)=>a.key.localeCompare(b.key)) as PackageCacheProjectionResult<Query>;
    }
    const values=(await this.entries('packageCache')).map(row=>
      decodeBackupValue(JSON.parse(row.encodedValue))).filter(isPackageCacheProjectionSource);
    if(query.kind==='publication_identities')return values.map(createPackagePublicationIdentity).sort((a,b)=>a.key.localeCompare(b.key)) as PackageCacheProjectionResult<Query>;
    if(query.kind==='learning_choices'){
      validateLearningPackageQuery(query);
      return values.filter(value=>value.content.targetLanguage===query.languageTag&&learningExpressionForm(value.content.entries[0]?.expression,query.languageTag)?.startsWith(query.normalizedPrefix)&&value.portableOrigin.publications.length>0&&value.content.entries[0]?.semantic?.relation==='realizes'&&value.content.entries[0]?.semantic?.semanticCoverage==='exact')
        .sort((a,b)=>{const af=learningExpressionForm(a.content.entries[0]!.expression,query.languageTag)!,bf=learningExpressionForm(b.content.entries[0]!.expression,query.languageTag)!;return af<bf?-1:af>bf?1:a.key<b.key?-1:1;})
        .slice(query.offset,query.offset+query.limit).map(createPackageCacheSummary) as PackageCacheProjectionResult<Query>;
    }
    if(query.kind==='route_counts'){
      const counts=new Map<string,{targetLanguage:string;supportLanguage:string;packageCount:number}>();
      for(const {content} of values){
        const key=JSON.stringify([content.targetLanguage,content.supportLanguage]);
        const row=counts.get(key)??{targetLanguage:content.targetLanguage,supportLanguage:content.supportLanguage,packageCount:0};
        row.packageCount++;counts.set(key,row);
      }
      return [...counts.values()].sort((left,right)=>left.targetLanguage.localeCompare(right.targetLanguage)||left.supportLanguage.localeCompare(right.supportLanguage)) as PackageCacheProjectionResult<Query>;
    }
    return (query.kind==='identities'
      ?values.map(value=>({key:value.key,digest:value.digest}))
      :values.filter(value=>query.packageId===undefined||value.portableOrigin.manifest.metadata.packageId===query.packageId).map(createPackageCacheSummary)) as PackageCacheProjectionResult<Query>;
  }
  private records = new Map<string, string>();
  private journeyIdentityRows=new Map<string,string[]>();
  private journeyIdentityCounts=new Map<string,number>();
  private changes = new Map<string, SqliteRecordChange>();
  private syncBase = new Map<string, SqliteSyncBaseEntry>();
  private portableMediaBlobs=new Map<string,PortableMediaBlob>();
  private portableMediaReferences=new Map<string,string>();

  async get(table: SqliteLibraryTable, key: string): Promise<string | null> {
    return this.records.get(`${table}\u0000${key}`) ?? null;
  }

  async entries(table: SqliteLibraryTable) {
    const prefix = `${table}\u0000`;
    return [...this.records]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, encodedValue]) => ({ key: key.slice(prefix.length), encodedValue }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }
  async entriesPage(table:SqliteLibraryTable,afterKey:string|null,limit:number){
    if(!Number.isSafeInteger(limit)||limit<1||limit>256)throw new Error('sqlite_invalid_page_size');
    const prefix=`${table}\u0000`;
    return [...this.records].filter(([id])=>id.startsWith(prefix)).map(([id,encodedValue])=>({key:id.slice(prefix.length),encodedValue}))
      .filter(row=>afterKey===null||row.key>afterKey).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).slice(0,limit);
  }

  async recordKeysPage(table:SqliteLibraryTable,afterKey:string|null,limit:number):Promise<string[]>{
    if(!Number.isSafeInteger(limit)||limit<1||limit>256)throw new Error('sqlite_invalid_page_size');
    const prefix=`${table}\u0000`;
    return [...this.records.keys()].filter(id=>id.startsWith(prefix)).map(id=>id.slice(prefix.length))
      .filter(key=>afterKey===null||key>afterKey).sort().slice(0,limit);
  }

  async changesSince(contentRevision: number, tables: readonly SqliteLibraryTable[],page?:import('./sqliteProtocol').SqliteChangePage): Promise<SqliteRecordChange[]> {
    const selected = new Set(tables);
    if(page&&(!Number.isSafeInteger(page.limit)||page.limit<1||page.limit>128))throw Error('sqlite_invalid_page_size');
    const after=page?.after;
    return [...this.changes.values()]
      .filter(change=>!after||change.contentRevision>after.contentRevision||change.contentRevision===after.contentRevision&&(change.table>after.table||change.table===after.table&&change.key>after.key))
      .filter((change) => change.contentRevision > contentRevision && selected.has(change.table))
      .sort((left, right) => left.contentRevision - right.contentRevision
        || (left.table<right.table?-1:left.table>right.table?1:0)
        || (left.key<right.key?-1:left.key>right.key?1:0))
      .slice(0,page?.limit)
      .map((change) => ({ ...change }));
  }

  async hasChangesSince(contentRevision:number,tables:readonly SqliteLibraryTable[]):Promise<boolean>{
    const selected=new Set(tables);
    return Number.isSafeInteger(contentRevision)&&contentRevision>=0&&[...this.changes.values()].some(change=>change.contentRevision>contentRevision&&selected.has(change.table));
  }

  async syncBaseEntries(keys?: readonly { table: SqliteLibraryTable; key: string }[]): Promise<SqliteSyncBaseEntry[]> {
    const selected = keys ? new Set(keys.map(({ table, key }) => `${table}\u0000${key}`)) : undefined;
    return [...this.syncBase]
      .filter(([id]) => !selected || selected.has(id))
      .map(([, entry]) => ({ ...entry, blockRefs: [...entry.blockRefs] }))
      .sort((left, right) => left.table.localeCompare(right.table) || left.key.localeCompare(right.key));
  }

  async syncBaseReferences():Promise<import('./sqliteProtocol').SqliteSyncBaseReference[]>{
    return [...this.syncBase.values()].map(({table,key,blockRefs})=>({table,key,blockRefs:[...blockRefs]}))
      .sort((a,b)=>a.table.localeCompare(b.table)||a.key.localeCompare(b.key));
  }
  async count(table: SqliteLibraryTable): Promise<number> {
    const prefix = `${table}\u0000`;
    let count = 0;
    for (const key of this.records.keys()) if (key.startsWith(prefix)) count++;
    return count;
  }

  async estimateRecordBytes(tables: readonly SqliteLibraryTable[]): Promise<number> {
    const selected=new Set(tables);
    const encoder=new TextEncoder();
    let bytes=0;
    for(const [id,encodedValue] of this.records){
      const separator=id.indexOf('\u0000');
      if(separator<0||!selected.has(id.slice(0,separator) as SqliteLibraryTable))continue;
      bytes+=encoder.encode(id.slice(separator+1)).byteLength+encoder.encode(encodedValue).byteLength+16;
    }
    return bytes;
  }

  async homeLearningProjection(languageRouteId: string,clock=Date.now()): Promise<HomeLearningStorageProjection> {
    const decode = <T>(encoded: string | undefined): T | undefined => encoded === undefined
      ? undefined
      : decodeBackupValue(JSON.parse(encoded)) as T;
    const targets = (await this.entries('learningTargets'))
      .map((row) => decode<LocalLearningTarget>(row.encodedValue)!);
    const availablePackageKeys = (await this.entries('packageCache')).map((row) => row.key);
    const activeId = decode<string>(this.records.get('meta\u0000learning-active'));
    const enrollments=(await this.entries('curriculumEnrollments')).map(row=>decode<import('./curriculumEnrollments').LocalCurriculumEnrollment>(row.encodedValue)!);
    const enrollmentMap=new Map(enrollments.map(item=>[item.id,item]));
    const removed=new Set((await this.entries('supplementalMembershipStates')).filter(row=>decode<{status:string}>(row.encodedValue)?.status==='removed').map(row=>row.key));
    const {curriculumSourceEligibility}=await import('../../learning/runtime/curriculumEligibility');
    const sourceEligibility=Object.fromEntries(targets.flatMap(target=>target.curriculumMemberships.map((member,index)=>[member.id??`${target.id}:${index}`,removed.has(member.id??'')?{introduce:false,ongoing:false}:curriculumSourceEligibility(member,enrollmentMap.get(String(member.provenance.curriculumEnrollmentId)),!!target.startedAt)])));
    return {...createHomeLearningStorageProjection({
      clock,
      targets,
      availablePackageKeys,
      activeRun: activeId
        ? decode<LocalLearningRun>(this.records.get(`learningRuns\u0000${activeId}`)) ?? null
        : null,
      studyPlans: decode(this.records.get('settings\u0000language-route-study-plans')) ?? {},
      enrollments,
      languageRouteId,
    }),sourceEligibility};
  }
  async studyScopeMember(scopeRevisionId:string,targetId:string):Promise<import('./studyScopes').LocalStudyScopeMember|null>{
    const encoded=await this.get('studyScopes',scopeRevisionId);
    if(!encoded)throw new Error('localFlow.progressReadFailed');
    const scope=decodeBackupValue(JSON.parse(encoded)) as import('./studyScopes').LocalStudyScope;
    return scope.members.find(member=>member.targetId===targetId)??null;
  }
  async runtimeLearningCandidates(query:RuntimeLearningCandidateQuery):Promise<RuntimeLearningCandidates>{
    const stored=await this.homeLearningProjection(query.languageContext.languageRouteId,query.clock);
    if(!query.scopeRevisionId)return runtimeLearningCandidatesFromRecords(stored,query);
    const encoded=await this.get('studyScopes',query.scopeRevisionId);if(!encoded)throw new Error('localFlow.progressReadFailed');
    const scope=decodeBackupValue(JSON.parse(encoded)) as import('./studyScopes').LocalStudyScope;
    // The oracle must retain frozen members even when current source modes or
    // superseded flags no longer put them in the future Home inventory.
    const ids=new Set(scope.members.map(member=>member.targetId)),today=new Set(stored.targets.map(target=>target.id));
    const targets=(await this.entries('learningTargets')).map(row=>decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningTarget).filter(target=>ids.has(target.id)||today.has(target.id)).map(createHomeLearningTargetRecord);
    return runtimeLearningCandidatesFromRecords({...stored,targets,availablePackageKeys:(await this.entries('packageCache')).map(row=>row.key)},query,scope);
  }
  async learningSchedulePage(query:LearningScheduleQuery):Promise<LearningSchedulePage>{return learningScheduleFromRecords(await this.homeLearningProjection(query.languageContext.languageRouteId,query.clock),query);}
  async learningManagementSummary(query:LearningManagementSummaryQuery):Promise<LearningManagementStorageSummary>{
    const summary={...learningManagementSummaryFromRecords(await this.homeLearningProjection(query.languageContext.languageRouteId,query.clock),query),libraryTargetCount:query.includeInventory===false?null:(await this.entries('learningTargets')).length};
    if(!query.includeLibraryItems)return summary;
    const {learningManagementListRecord,learningManagementListItem}=await import('./learningManagementList');
    const {curriculumSourceEligibility}=await import('../../learning/runtime/curriculumEligibility');
    const enrollments=new Map((await this.entries('curriculumEnrollments')).map(row=>{const item=decodeBackupValue(JSON.parse(row.encodedValue)) as import('./curriculumEnrollments').LocalCurriculumEnrollment;return [item.id,item] as const;}));
    const titles=new Map([...enrollments].map(([id,item])=>[id,{title:item.source.kind==='published_book'?item.source.title??null:null,paused:item.bookPlan?.mode==='paused'}] as const));
    const removed=new Set((await this.entries('supplementalMembershipStates')).filter(row=>(decodeBackupValue(JSON.parse(row.encodedValue)) as {status:string}).status==='removed').map(row=>row.key));
    const available=new Set((await this.entries('packageCache')).map(row=>row.key));
    const items=(await this.entries('learningTargets')).flatMap(row=>{
      const target=decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningTarget;
      const eligibility=Object.fromEntries(target.curriculumMemberships.map((member,index)=>[member.id??`${target.id}:${index}`,removed.has(member.id??'')?{introduce:false,ongoing:false}:curriculumSourceEligibility(member,enrollments.get(String(member.provenance.curriculumEnrollmentId)),!!target.startedAt)]));
      const item=learningManagementListItem(learningManagementListRecord(target),query.languageContext,query.clock,eligibility,titles,available,query.supportedPolicies);
      return item?[item]:[];
    });
    return {...summary,items};
  }
  async learningHistoryPage(query:LearningHistoryRequest):Promise<StoredLearningHistoryPage>{return learningHistoryPageFromRecords(await this.learningHistoryProjection(),query);}

  async learningRunIdsForTarget(targetId: string, openOnly: boolean): Promise<string[]> {
    return (await this.entries('learningRuns'))
      .map((row) => ({ key: row.key, run: decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningRun }))
      .filter(({ run }) => run.targetIds.includes(targetId) && (!openOnly || !run.completedAt))
      .map(({ key }) => key)
      .sort();
  }
  async latestLearningActionAt(runId:string):Promise<string|null>{
    return (await this.entries('learningEvents')).map(row=>decodeBackupValue(JSON.parse(row.encodedValue)) as {runId:string;at:string}).filter(event=>event.runId===runId).sort((left,right)=>Date.parse(right.at)-Date.parse(left.at))[0]?.at??null;
  }
  async learningHistoryProjection():Promise<import('./learningHistoryProjection').StoredLearningRecord[]>{
    const targets=new Map((await this.entries('learningTargets')).map(row=>[row.key,decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningTarget]));
    return (await this.entries('learningRuns')).flatMap(row=>{const run=decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningRun;if(!run.completedAt||run.completionKind==='wait_relearning')return [];
      return run.targetIds.map(targetId=>{const target=targets.get(targetId)!,participant=run.participants[targetId]!,material=localLastPresentedMaterial(participant),meaning=material?learningSupportMeaning(material.content.resources,participant.languageContext.supportLanguageTag):undefined;
        return {recordId:`${run.id}:${targetId}`,targetId,expression:String(material.content.resources.find(resource=>resource.materialRoleKey==='target_expression')?.contentPayload.surface??''),languageTag:target.targetLanguageTag,...(typeof meaning==='string'?{meaning}:{}),occurredAt:run.targetCompletions?.[targetId]?.at??run.completedAt!,kind:run.purpose};});
    }).sort((left,right)=>right.occurredAt.localeCompare(left.occurredAt)||left.recordId.localeCompare(right.recordId));
  }

  async countIntroducedLearningTargets(
    languageRouteId: string,
    startedAfter: string,
    startedBefore: string,
  ): Promise<number> {
    return (await this.entries('learningTargets'))
      .map((row) => decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningTarget)
      .filter((target) => target.introducedLanguageRouteId === languageRouteId
        && target.startedAt !== null
        && Date.parse(target.startedAt) >= Date.parse(startedAfter)
        && Date.parse(target.startedAt) < Date.parse(startedBefore))
      .length;
  }

  async openLearningRunTargets(): Promise<Array<{ runId: string; targetId: string }>> {
    return (await this.entries('learningRuns'))
      .map((row) => ({ key: row.key, run: decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningRun }))
      .filter(({ run }) => !run.completedAt)
      .flatMap(({ key, run }) => run.targetIds.map((targetId) => ({ runId: key, targetId })))
      .sort((left, right) => left.targetId.localeCompare(right.targetId) || left.runId.localeCompare(right.runId));
  }

  async countContentAttemptsSince(taskId: string, createdAfter: string): Promise<number> {
    return (await this.entries('contentAttempts'))
      .map((row) => decodeBackupValue(JSON.parse(row.encodedValue)) as { taskId: string; createdAt: string })
      .filter((attempt) => attempt.taskId === taskId && attempt.createdAt > createdAfter)
      .length;
  }

  async learningTargetIdsForBookUpgrade(
    languageRouteId: string,
    targetLanguageTag: string,
    supportLanguageTag: string,
    bookId: string,
    nextBookVersionId: string,
  ): Promise<string[]> {
    return (await this.entries('learningTargets'))
      .map((row) => ({ key: row.key, target: decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningTarget }))
      .filter(({ target }) => target.curriculumMemberships.some((membership) => (
        membership.status !== 'superseded'
        && membership.sourceKind === 'sense_learning_package'
        && membership.languageContext.languageRouteId === languageRouteId
        && membership.languageContext.targetLanguageTag === targetLanguageTag
        && membership.languageContext.supportLanguageTag === supportLanguageTag
        && membership.provenance.bookId === bookId
        && membership.provenance.bookVersionId !== nextBookVersionId
      )))
      .map(({ key }) => key)
      .sort();
  }

  async isMediaReferenced(mediaId: string): Promise<boolean> {
    const contexts = await this.entries('semanticContexts');
    if (contexts.some(row=>contextMediaReferences(decodeBackupValue(JSON.parse(row.encodedValue))).includes(mediaId))) return true;
    const inbox = await this.entries('semanticInbox');
    return inbox.some((row) => (
      decodeBackupValue(JSON.parse(row.encodedValue)) as {
        payload?: { context?: { mediaReferenceIds?: string[] } | null };
      }
    ).payload?.context?.mediaReferenceIds?.includes(mediaId));
  }

  async portableMedia(sha256:string):Promise<PortableMediaBlob|null>{
    const blob=this.portableMediaBlobs.get(sha256);
    return blob?{...blob,bytes:new Uint8Array(blob.bytes)}:null;
  }

  async portableMediaDiagnostics():Promise<PortableMediaStorageDiagnostics>{
    return {
      blobCount:this.portableMediaBlobs.size,
      totalBytes:[...this.portableMediaBlobs.values()].reduce((total,blob)=>total+blob.sizeBytes,0),
      referenceCount:this.portableMediaReferences.size,
    };
  }

  async commit(mutation: SqliteMutation): Promise<void> {
    const next = new Map(this.records);
    const nextChanges = new Map(this.changes);
    const nextSyncBase = mutation.syncBaseReplacement === undefined
      ? new Map(this.syncBase)
      : new Map(mutation.syncBaseReplacement.map((entry) => [
        `${entry.table}\u0000${entry.key}`,
        { ...entry, blockRefs: [...entry.blockRefs] },
      ]));
    if(mutation.syncBasePatch){
      if(mutation.syncBaseReplacement!==undefined)throw new Error('sqlite_sync_base_mutation_conflict');
      for(const row of mutation.syncBasePatch.deletes)nextSyncBase.delete(`${row.table}\u0000${row.key}`);
      for(const row of mutation.syncBasePatch.puts)nextSyncBase.set(`${row.table}\u0000${row.key}`,{...row,blockRefs:[...row.blockRefs]});
    }
    const nextPortableMedia=new Map([...this.portableMediaBlobs].map(([digest,blob])=>[
      digest,{...blob,bytes:new Uint8Array(blob.bytes)},
    ]));
    const nextPortableReferences=new Map(this.portableMediaReferences);
    const remember = (table: SqliteLibraryTable, key: string, encodedValue: string | null) => {
      if (mutation.contentRevision === undefined) return;
      nextChanges.set(`${table}\u0000${key}`, {
        table,
        key,
        encodedValue,
        contentRevision: mutation.contentRevision,
      });
    };
    for (const table of mutation.clears) {
      const prefix = `${table}\u0000`;
      for (const key of [...next.keys()]) if (key.startsWith(prefix)) {
        next.delete(key);
        remember(table, key.slice(prefix.length), null);
      }
      if(table==='packageCache')nextPortableReferences.clear();
    }
    for (const item of mutation.deletes) {
      next.delete(`${item.table}\u0000${item.key}`);
      remember(item.table, item.key, null);
      if(item.table==='packageCache'){
        const prefix=`${item.key}\u0000`;
        for(const key of nextPortableReferences.keys())if(key.startsWith(prefix))nextPortableReferences.delete(key);
      }
    }
    for(const portable of mutation.portablePackages??[]){
      const prefix=`${portable.packageKey}\u0000`;
      for(const key of nextPortableReferences.keys())if(key.startsWith(prefix))nextPortableReferences.delete(key);
      for(const media of portable.media){
        const existing=nextPortableMedia.get(media.sha256);
        if(existing&&existing.sizeBytes!==media.sizeBytes)throw new Error('portable_media_digest_collision');
        nextPortableMedia.set(media.sha256,{
          sha256:media.sha256,
          sizeBytes:media.sizeBytes,
          bytes:new Uint8Array(media.bytes),
        });
        nextPortableReferences.set(`${portable.packageKey}\u0000${media.mediaId}`,media.sha256);
      }
    }
    for (const item of mutation.puts) {
      next.set(`${item.table}\u0000${item.key}`, item.encodedValue);
      remember(item.table, item.key, item.encodedValue);
    }
    const identityRows=new Map(this.journeyIdentityRows),identityCounts=new Map(this.journeyIdentityCounts);
    const removeIdentityRow=(key:string)=>{for(const id of identityRows.get(key)??[]){const count=identityCounts.get(id)!-1;if(count)identityCounts.set(id,count);else identityCounts.delete(id);}identityRows.delete(key);};
    for(const table of mutation.clears)if(journeyIdentityTables.includes(table as typeof journeyIdentityTables[number]))for(const key of identityRows.keys())if(key.startsWith(`${table}\u0000`))removeIdentityRow(key);
    for(const row of mutation.deletes)removeIdentityRow(`${row.table}\u0000${row.key}`);
    for(const row of mutation.puts)if(journeyIdentityTables.includes(row.table as typeof journeyIdentityTables[number])){
      const key=`${row.table}\u0000${row.key}`;removeIdentityRow(key);
      const ids=journeyReservedIdentities(row.table as typeof journeyIdentityTables[number],decodeBackupValue(JSON.parse(row.encodedValue)));identityRows.set(key,ids);
      for(const id of ids)identityCounts.set(id,(identityCounts.get(id)??0)+1);
    }
    this.journeyIdentityRows=identityRows;this.journeyIdentityCounts=identityCounts;
    this.records = next;
    // This non-browser oracle conservatively retires frames on relevant writes,
    // including repairs/changes of exact Expression dependencies.
    if(mutation.clears.some(table=>['semanticMeanings','semanticRegistry','packageCache'].includes(table))||[...mutation.puts,...mutation.deletes].some(row=>['semanticMeanings','semanticRegistry','packageCache'].includes(row.table)))this.practiceRevision++;
    this.changes = nextChanges;
    this.syncBase = nextSyncBase;
    const referenced=new Set(nextPortableReferences.values());
    for(const digest of nextPortableMedia.keys())if(!referenced.has(digest))nextPortableMedia.delete(digest);
    this.portableMediaBlobs=nextPortableMedia;
    this.portableMediaReferences=nextPortableReferences;
  }

  async diagnostics(): Promise<SqliteStorageDiagnostics> {
    return {
      engine: "memory-adapter",
      persistence: "memory",
      sqliteVersion: "not-applicable",
      schemaVersion: sqliteLibrarySchemaVersion,
      journalMode: "not-applicable",
      synchronous: null,
      lockingMode: "not-applicable",
    };
  }
}
