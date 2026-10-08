import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import {isFatalSqliteConnectionFailure,sqliteRollbackFailure} from './sqliteConnectionFailure';

import {decodeBackupValue,encodeBackupValue} from './backupCodec';
import {externalizeSharedRecordContent,expandSharedRecordContent,packStoredRecord,unpackStoredRecord,sharedRecordTables} from './sharedRecordContent';
import {learningExpressionForm,learningPackageChoicesSql,validateLearningPackageQuery} from './packageCacheProjection';
import {SqliteMeaningLookupProjection} from './meaningLookupProjection';
import {SqliteWorldBrowseProjection} from './worldBrowseProjection';
import {SqlitePracticeExpressionProjection,type PracticeExpressionQuery,type PracticeExpressionPage} from './practiceExpressionProjection';
import {SqliteJourneyIdentityProjection} from './journeyIdentityProjection';
import {SqliteLearningHistoryProjection,type StoredLearningRecord,type StoredLearningHistoryPage} from './learningHistoryProjection';
import type {LearningHistoryRequest} from '../../learning/system/learningHistoryModel';
import {SqliteRuntimeLearningCandidates,type RuntimeLearningCandidateQuery,type RuntimeLearningCandidates,type LearningManagementSummaryQuery,type LearningManagementStorageSummary} from './runtimeLearningCandidates';
import {ensureSqliteSchemaIndexes} from './sqliteSchemaIndexes';
import {SqliteLearningSemanticMemoryProjection} from './learningSemanticMemoryProjection';
import {registryFieldReader,registrySelectionSql,registrySelectionResult,type RegistrySelectionQuery,type RegistrySelection} from './semanticRegistrySelection';
import type {WorldBrowseQuery,WorldBrowsePage,WorldLearningChoiceQuery,WorldLearningChoicePage} from '../../experience/personalMeaningJourney/worldRead';
import type {MeaningLookupResult} from '../../experience/personalMeaningJourney/meaningLookup';
import {createPackageCacheSummary,isPackageCacheProjectionSource,packageCacheKeyPrefix,sqlitePackageCacheProjectionSchema,type PackageCacheProjectionQuery,type PackageCacheProjectionResult,type PackagePublicationIdentity} from './packageCacheProjection';
import {
  createHomeLearningTargetRecord,
  type HomeLearningStorageProjection,
} from './homeLearningRecords';
import type {LocalLearningRun,LocalLearningTarget} from '../../learning/runtime/localProtocol';
import type {PackageBookMembership} from './packageRecords';
import {
  sqliteLibrarySchema,
  sqlitePortableMediaSchema,
  sqliteSharedRecordContentSchema,
  sqliteLibraryBaselineVersion,
  sqliteLibrarySchemaVersion,
  sqliteLibraryTables,
  type SqliteLibraryTable,
  type SqliteMutation,
  type PortableMediaBlob,
  type PortableMediaStorageDiagnostics,
  type SqliteRecordChange,
  type SqliteSyncBaseEntry,
  type SqliteStorageDiagnostics,
} from "./sqliteProtocol";

type StoredEntry = { key: string; encodedValue: string };
type ContentAttemptProjectionSource = {
  taskId: string;
  createdAt: string;
};
type SemanticMeaningMediaSource = {
  personalSemanticAnchorRevisions?: Array<{ personalMediaObjectId?: string | null }>;
};
type SemanticInboxMediaSource = {
  payload?: { context?: { mediaReferenceIds?: string[] } | null };
};

const sqliteOptimizeIntervalMs = 24 * 60 * 60 * 1000;
const sqliteRequiredTables=[...sqliteLibrarySchema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gu)].map(match=>match[1]!);
const sqliteRuntimePragmas=sqliteLibrarySchema.slice(0,sqliteLibrarySchema.indexOf('CREATE TABLE'));

/** Kept beside the storage kernel so diagnostics exercise the exact shipped query. */
export const sqliteHomeLearningTargetsQuery = `SELECT
        target.record_key AS record_key,
        target.projection_value_json AS projection_value_json
      FROM sensa_learning_targets AS target
      JOIN sensa_learning_route_targets AS route
        ON route.target_key=target.record_key
      WHERE route.language_route_id=?
      UNION
      SELECT
        target.record_key AS record_key,
        target.projection_value_json AS projection_value_json
      FROM sensa_learning_targets AS target
      JOIN sensa_runtime_learning_introductions AS introduced
        ON introduced.target_key=target.record_key
      WHERE introduced.language_route_id=?
        AND introduced.started_at>=? AND introduced.started_at<?
      UNION
      SELECT target.record_key AS record_key,target.projection_value_json AS projection_value_json
      FROM sensa_learning_targets AS target
      JOIN sensa_runtime_learning_candidate_sources AS historical ON historical.target_key=target.record_key
      JOIN sensa_runtime_learning_enrollments AS enrollment ON enrollment.enrollment_key=historical.enrollment_key
      WHERE historical.language_route_id=?1 AND historical.started=1 AND historical.superseded=1
        AND enrollment.kind='published_book' AND enrollment.status='active' AND enrollment.mode<>'paused'
      ORDER BY record_key`;

/** Internal SQLite record kernel owned by the OPFS Worker. */
export class SqliteRecordDatabase {
  private nextOptimizeAt = 0;
  private closed=false;
  private initialized=false;
  private initializationTimingsMs:Record<string,number>|undefined;
  private integrityCheck:SqliteStorageDiagnostics['integrityCheck'];
  private integrityFailed=false;
  private fatalStorageFailure:Error|undefined;
  private meaningLookup:SqliteMeaningLookupProjection;
  private worldBrowseProjection:SqliteWorldBrowseProjection;
  private practiceExpressionProjection:SqlitePracticeExpressionProjection;
  private walMaintenance:SqliteStorageDiagnostics['walMaintenance'];
  private journeyIdentities:SqliteJourneyIdentityProjection;
  private learningHistory:SqliteLearningHistoryProjection;
  private runtimeCandidates:SqliteRuntimeLearningCandidates;
  private semanticMemoryProjection:SqliteLearningSemanticMemoryProjection;
  private recordGet:ReturnType<Database['prepare']>|undefined;

  /** The Worker must stop queued requests even if the durable COMMIT succeeded. */
  get connectionFailed():boolean{return this.integrityFailed||this.fatalStorageFailure!==undefined;}

  constructor(
    private readonly sqlite3: Sqlite3Static,
    private readonly database: Database,
    private readonly persistence: SqliteStorageDiagnostics["persistence"],
  ) {
    const field=registryFieldReader();
    this.database.createFunction({name:'sensa_expression_form',arity:2,deterministic:true,innocuous:true,xFunc:(_context,text,language)=>learningExpressionForm(text,language)});
    this.database.createFunction({name:'sensa_registry_field',arity:2,deterministic:true,innocuous:true,xFunc:(_context,encoded,key)=>field(encoded,key)});
    let previousEvent:string|null=null,eventFields:Map<string,unknown>|null=null;
    this.database.createFunction({name:'sensa_learning_event_field',arity:2,deterministic:true,innocuous:true,xFunc:(_context,encoded,key)=>{
      if(typeof encoded!=='string'||key!=='runId'&&key!=='at')throw Error('learning_event_clock_invalid');
      if(previousEvent!==encoded){const wire=JSON.parse(unpackStoredRecord(encoded));if(wire[0]!=='object'||!Array.isArray(wire[1]))throw Error('learning_event_clock_invalid');eventFields=new Map(wire[1]);previousEvent=encoded;}
      const value=decodeBackupValue(eventFields!.get(key));if(typeof value!=='string'||key==='at'&&!Number.isFinite(Date.parse(value)))throw Error('learning_event_clock_invalid');return value;
    }});
    this.meaningLookup=new SqliteMeaningLookupProjection(database,(table,key)=>this.get(table,key));
    this.worldBrowseProjection=new SqliteWorldBrowseProjection(database,(table,key)=>this.get(table,key));
    this.practiceExpressionProjection=new SqlitePracticeExpressionProjection(database,(table,key)=>this.decoded(table,key));
    this.journeyIdentities=new SqliteJourneyIdentityProjection(database);
    this.semanticMemoryProjection=new SqliteLearningSemanticMemoryProjection(database,encoded=>this.decode<LocalLearningTarget>(this.logicalEncoded('learningTargets',encoded)),id=>{const encoded=this.get('learningTargets',id);return encoded===null?null:this.decode<LocalLearningTarget>(encoded);});
    this.learningHistory=new SqliteLearningHistoryProjection(database,id=>this.decoded<LocalLearningTarget>('learningTargets',id),encoded=>this.decode<LocalLearningRun>(this.logicalEncoded('learningRuns',encoded)));
    this.runtimeCandidates=new SqliteRuntimeLearningCandidates(database,encoded=>this.decode<LocalLearningTarget>(this.logicalEncoded('learningTargets',encoded)),encoded=>this.decode<import('./curriculumEnrollments').LocalCurriculumEnrollment>(this.logicalEncoded('curriculumEnrollments',encoded)),(id,target)=>this.writeLearningTargetProjection(id,target),encoded=>this.decode<import('./studyScopes').LocalStudyScope>(this.logicalEncoded('studyScopes',encoded)));
  }

  initialize(): SqliteStorageDiagnostics {
    if(this.closed)throw new Error('sqlite_database_closed');
    if(this.fatalStorageFailure)throw this.fatalStorageFailure;
    if(this.integrityFailed)throw new Error('sqlite_integrity_failed');
    if(this.initialized)return this.diagnostics();
    const started=performance.now();
    // SQLite Wasm has no shared-memory API. Its documented WAL contract
    // requires exclusive locking to be the first operation after open.
    const lockingMode = this.scalarText("PRAGMA locking_mode=EXCLUSIVE");
    if (this.persistence === "opfs" && lockingMode !== "exclusive") {
      throw new Error(`sqlite_locking_mode_failed:${lockingMode}`);
    }
    const before = this.scalarNumber("PRAGMA user_version");
    const schemaCookie=this.scalarNumber('PRAGMA schema_version');
    const headerReady=performance.now();
    let runtimeReady=headerReady,sourceSchemaReady=headerReady,lookupReady=headerReady,worldReady=headerReady;
    if (before !== 0 && before < sqliteLibraryBaselineVersion) {
      throw new Error(`sqlite_schema_legacy:${before}`);
    }
    if (before > sqliteLibrarySchemaVersion) {
      throw new Error(`sqlite_schema_future:${before}`);
    }
    // New databases are created at the supported baseline. Future forward
    // migrations belong here as ordered, transactional version steps; older
    // prototype formats are intentionally not imported.
    if(before===0)this.database.exec(sqliteLibrarySchema);
    else if(before===10){
      this.database.exec('BEGIN IMMEDIATE');
      try{
        this.database.exec(sqlitePortableMediaSchema);
        this.database.exec(sqliteSharedRecordContentSchema);
        this.database.exec(sqlitePackageCacheProjectionSchema);
        this.rebuildPackageCacheProjection();
        this.allowStudyScopeRecords();
        this.database.exec(`PRAGMA user_version=${sqliteLibrarySchemaVersion}`);
        this.database.exec('COMMIT');
      }catch(error){
        try{this.database.exec('ROLLBACK');}catch{/* Preserve the migration failure. */}
        throw error;
      }
      this.database.exec(sqliteLibrarySchema);
    }
    else if(before===12){
      this.database.exec('BEGIN IMMEDIATE');
      try{
        this.database.exec(sqlitePackageCacheProjectionSchema);
        this.database.exec(sqliteSharedRecordContentSchema);
        this.rebuildPackageCacheProjection();
        this.allowStudyScopeRecords();
        this.database.exec(`PRAGMA user_version=${sqliteLibrarySchemaVersion}`);
        this.database.exec('COMMIT');
      }catch(error){
        try{this.database.exec('ROLLBACK');}catch{/* Retain the authoritative cache. */}
        throw error;
      }
      this.database.exec(sqliteLibrarySchema);
    }
    else if(before===13){
      // Add private representation storage only. Existing facts are neither
      // decoded nor rewritten; ordinary future writes may use shared bodies.
      this.database.exec('BEGIN IMMEDIATE');
      try{this.database.exec(sqliteSharedRecordContentSchema);this.allowStudyScopeRecords();this.database.exec(`PRAGMA user_version=${sqliteLibrarySchemaVersion}`);this.database.exec('COMMIT');}
      catch(error){try{this.database.exec('ROLLBACK');}catch{/* Preserve the migration failure. */}throw error;}
      this.database.exec(sqliteLibrarySchema);
    }
    else if(before===14||before===15){
      this.database.exec('BEGIN IMMEDIATE');
      try{this.allowStudyScopeRecords();this.database.exec(`PRAGMA user_version=${sqliteLibrarySchemaVersion}`);this.database.exec('COMMIT');}
      catch(error){try{this.database.exec('ROLLBACK');}catch{/* Preserve the original records and constraint. */}throw error;}
      this.database.exec(sqliteLibrarySchema);
    }
    else if (before !== sqliteLibrarySchemaVersion) {
      throw new Error(`sqlite_schema_migration_missing:${before}`);
    } else {
      // A supported unchanged source schema must already be complete. Do not
      // replay DDL or rewrite user_version on every reconnect, and do not
      // manufacture empty source tables when an existing library is damaged.
      this.database.exec(sqliteRuntimePragmas);
      runtimeReady=performance.now();
      const present=this.database.exec({sql:"SELECT name FROM sqlite_schema WHERE type='table' AND name IN (SELECT value FROM json_each(?))",bind:[JSON.stringify(sqliteRequiredTables)],rowMode:'object',returnValue:'resultRows'}) as unknown[];
      if(present.length!==sqliteRequiredTables.length)throw new Error('sqlite_source_schema_incomplete');
      ensureSqliteSchemaIndexes(this.database,sqliteLibrarySchema);
    }
    sourceSchemaReady=performance.now();
    this.database.exec('BEGIN IMMEDIATE');
    try{
      this.meaningLookup.initialize();
      lookupReady=performance.now();
      this.worldBrowseProjection.initialize();
      this.practiceExpressionProjection.initialize();
      worldReady=performance.now();
      this.journeyIdentities.initialize();
      this.learningHistory.initialize();
      this.semanticMemoryProjection.initialize();
      this.runtimeCandidates.initialize();
      // Retire only the obsolete device-local full-inventory admission cache.
      // Source facts, shared bodies and their ownership are untouched.
      const retired=this.database.exec({sql:"SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sensa_study_scope_target_snapshots'",rowMode:0,returnValue:'resultRows'}) as unknown[];
      if(retired.length)this.database.exec('DROP TABLE sensa_study_scope_target_snapshots');
      this.database.exec('COMMIT');
    }catch(error){try{this.database.exec('ROLLBACK');}catch{/* Preserve initialization failure. */}throw error;}
    const schemaReady=performance.now();
    // Consider every table after a schema change. Ordinary reconnects reuse
    // persisted statistics and let actual query history guide maintenance;
    // reopening one page must not inspect every large derived index.
    const schemaChanged=before===0||before!==sqliteLibrarySchemaVersion||schemaCookie!==this.scalarNumber('PRAGMA schema_version');
    this.database.exec(schemaChanged?"PRAGMA optimize=0x10002":"PRAGMA optimize");
    this.nextOptimizeAt = Date.now() + sqliteOptimizeIntervalMs;
    const plannerReady=performance.now();
    // A whole-file health scan grows with the entire collection. Run it for
    // new/changed structures and explicit diagnostics, not each normal open.
    if(schemaChanged)this.verifyIntegrity();
    const integrityReady=performance.now();
    if (this.persistence === "opfs") {
      const journalMode = this.scalarText("PRAGMA journal_mode");
      const synchronous = this.scalarNumber("PRAGMA synchronous");
      if (journalMode !== "wal") throw new Error(`sqlite_journal_mode_failed:${journalMode}`);
      if (synchronous !== 2) throw new Error(`sqlite_synchronous_failed:${synchronous}`);
      // Cache creation/version replacement can be a large transaction even
      // though it changes no learner revision. Ordinary unchanged opens do
      // not checkpoint, and maintenance cannot invalidate successful rebuilds.
      if(schemaChanged)this.maintainWal();
    }
    this.initialized=true;
    this.initializationTimingsMs={header:Math.round(headerReady-started),runtime:Math.round(runtimeReady-headerReady),sourceSchema:Math.round(sourceSchemaReady-runtimeReady),lookupCache:Math.round(lookupReady-sourceSchemaReady),worldCache:Math.round(worldReady-lookupReady),identityCache:Math.round(schemaReady-worldReady),schema:Math.round(schemaReady-started),planner:Math.round(plannerReady-schemaReady),integrity:Math.round(integrityReady-plannerReady),total:Math.round(performance.now()-started)};
    return this.diagnostics();
  }

  get(table: SqliteLibraryTable, key: string): string | null {
    const statement=this.recordGet??=this.database.prepare('SELECT value_json FROM sensa_records WHERE table_name=? AND record_key=?');
    statement.reset(true);statement.bind([table,key]);
    let value:string|null;try{value=statement.step()?String(statement.get(0)):null;}finally{statement.reset(true);}
    return value===null?null:this.logicalEncoded(table,value);
  }

  /** SQLite cannot ALTER a CHECK allow-list. Copy encoded rows byte-for-byte,
   * preserve rowids and indexes, then replace the physical table atomically.
   * No learner fact, content revision or shared-body ownership is rewritten. */
  private allowStudyScopeRecords():void{
    const exists=this.database.exec({sql:"SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sensa_records'",rowMode:0,returnValue:'resultRows'}) as unknown[];
    if(!exists.length){if(this.scalarNumber('PRAGMA user_version')===10)return;throw new Error('sqlite_source_schema_incomplete');}
    const allowed=sqliteLibraryTables.map(table=>`'${table}'`).join(',');
    const keyColumns=`table_name TEXT NOT NULL CHECK(table_name IN (${allowed})),record_key TEXT NOT NULL CHECK(length(record_key) BETWEEN 1 AND 2000)`;
    const tables=[
      {name:'sensa_records',columns:'rowid,table_name,record_key,value_json,content_revision',definition:`${keyColumns},value_json TEXT NOT NULL CHECK(json_valid(value_json)),content_revision INTEGER NOT NULL DEFAULT 0 CHECK(content_revision>=0),PRIMARY KEY(table_name,record_key)`,suffix:''},
      {name:'sensa_record_tombstones',columns:'table_name,record_key,content_revision',definition:`${keyColumns},content_revision INTEGER NOT NULL CHECK(content_revision>0),PRIMARY KEY(table_name,record_key)`,suffix:' WITHOUT ROWID'},
      {name:'sensa_sync_base',columns:'table_name,record_key,value_json,block_refs_json',definition:`${keyColumns},value_json TEXT NOT NULL CHECK(json_valid(value_json)),block_refs_json TEXT NOT NULL CHECK(json_valid(block_refs_json)),PRIMARY KEY(table_name,record_key)`,suffix:' WITHOUT ROWID'},
    ];
    for(const table of tables){
      const present=this.database.exec({sql:"SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?",bind:[table.name],rowMode:0,returnValue:'resultRows'}) as unknown[];
      if(!present.length){if(this.scalarNumber('PRAGMA user_version')===10)continue;throw new Error('sqlite_source_schema_incomplete');}
      const indexes=this.database.exec({sql:"SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name",bind:[table.name],rowMode:0,returnValue:'resultRows'}) as string[];
      const replacement=`${table.name}_v15_upgrade`;
      this.database.exec(`CREATE TABLE ${replacement}(${table.definition})${table.suffix}`);
      this.database.exec(`INSERT INTO ${replacement}(${table.columns}) SELECT ${table.columns} FROM ${table.name}`);
      this.database.exec(`DROP TABLE ${table.name}`);
      this.database.exec(`ALTER TABLE ${replacement} RENAME TO ${table.name}`);
      for(const sql of indexes)this.database.exec(sql);
    }
  }

  entries(table: SqliteLibraryTable): StoredEntry[] {
    const rows = this.database.exec({
      sql: "SELECT record_key,value_json FROM sensa_records WHERE table_name=? ORDER BY record_key",
      bind: [table],
      rowMode: "object",
      returnValue: "resultRows",
    }) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      key: String(row.record_key),
      encodedValue: this.logicalEncoded(table,String(row.value_json)),
    }));
  }
  learningSemanticMemory(targetId?:string):import('../../learning/system/learningReadModels').LearningSemanticMemoryProjection{return this.semanticMemoryProjection.read(targetId);}
  lookupMeanings(query:string):MeaningLookupResult{return this.meaningLookup.query(query);}
  worldBrowse(query:WorldBrowseQuery):WorldBrowsePage{return this.worldBrowseProjection.query(query);}
  worldSceneMeaning(sceneId:string):string|null{return this.worldBrowseProjection.sceneMeaning(sceneId);}
  registrySelection(query:RegistrySelectionQuery):RegistrySelection{
    const {sql,bind}=registrySelectionSql(query);
    const rows=this.database.exec({sql,bind:bind as import('@sqlite.org/sqlite-wasm').SqlValue[],rowMode:'object',returnValue:'resultRows'}) as Record<string,any>[];
    return registrySelectionResult(query,rows);
  }
  worldLearningChoices(query:WorldLearningChoiceQuery):WorldLearningChoicePage{return this.worldBrowseProjection.learningChoices(query);}
  practiceExpressions(query:PracticeExpressionQuery):PracticeExpressionPage{return this.practiceExpressionProjection.query(query);}
  existingJourneyIdentities(ids:readonly string[]):string[]{return this.journeyIdentities.existing(ids);}

  entriesPage(table:SqliteLibraryTable,afterKey:string|null,limit:number):StoredEntry[]{
    if(!Number.isSafeInteger(limit)||limit<1||limit>256)throw new Error('sqlite_invalid_page_size');
    const rows=this.database.exec({
      sql:`SELECT record_key,value_json FROM sensa_records WHERE table_name=? ${afterKey===null?'':'AND record_key>?'} ORDER BY record_key LIMIT ?`,
      bind:afterKey===null?[table,limit]:[table,afterKey,limit],rowMode:'object',returnValue:'resultRows',
    }) as Array<Record<string,unknown>>;
    return rows.map(row=>({key:String(row.record_key),encodedValue:this.logicalEncoded(table,String(row.value_json))}));
  }

  /** Presence/ownership checks only need indexed keys, never decoded fact bodies. */
  recordKeysPage(table:SqliteLibraryTable,afterKey:string|null,limit:number):string[]{
    if(!Number.isSafeInteger(limit)||limit<1||limit>256)throw new Error('sqlite_invalid_page_size');
    return this.database.exec({
      sql:`SELECT record_key FROM sensa_records WHERE table_name=? ${afterKey===null?'':'AND record_key>?'} ORDER BY record_key LIMIT ?`,
      bind:afterKey===null?[table,limit]:[table,afterKey,limit],rowMode:0,returnValue:'resultRows',
    }) as string[];
  }

  existingRecordKeys(table:SqliteLibraryTable,keys:readonly string[]):string[]{
    if(!keys.length)return [];
    return this.database.exec({
      sql:`SELECT record_key FROM sensa_records WHERE table_name=?
           AND record_key IN (SELECT value FROM json_each(?)) ORDER BY record_key`,
      bind:[table,JSON.stringify(keys)],rowMode:0,returnValue:'resultRows',
    }) as string[];
  }

  packageCacheProjection<Query extends PackageCacheProjectionQuery>(query:Query):PackageCacheProjectionResult<Query>{
    if(query.kind==='summaries_by_keys'){
      const rows=this.database.exec({sql:'SELECT summary_json FROM sensa_package_cache_projection WHERE package_key IN (SELECT value FROM json_each(?)) ORDER BY package_key',bind:[JSON.stringify([...new Set(query.keys)])],rowMode:'object',returnValue:'resultRows'}) as {summary_json:string}[];
      return rows.map(row=>JSON.parse(row.summary_json)) as PackageCacheProjectionResult<Query>;
    }
    if(query.kind==='publication_identities'){
      const rows=this.database.exec({sql:`SELECT package_key,digest,
        (SELECT json_group_array(json_extract(publication.value,'$.bookArchiveSha256')) FROM json_each(summary_json,'$.portableOrigin.publications') AS publication) AS publications,
        (SELECT json_group_array(json_object(
          'archiveSha256',json_extract(publication.value,'$.bookArchiveSha256'),
          'bookId',json_extract(publication.value,'$.book.bookId'),
          'bookVersionId',json_extract(publication.value,'$.book.bookVersionId'),
          'memberIndex',json_extract(publication.value,'$.memberIndex'),
          'memberCount',json_extract(publication.value,'$.memberCount')))
          FROM json_each(summary_json,'$.portableOrigin.publications') AS publication
          WHERE json_extract(publication.value,'$.memberIndex') IS NOT NULL) AS memberships
        FROM sensa_package_cache_projection ORDER BY package_key`,rowMode:'object',returnValue:'resultRows'}) as {package_key:string;digest:string;publications:string;memberships:string}[];
      const identities:PackagePublicationIdentity[]=rows.map(row=>({key:row.package_key,digest:row.digest,bookArchiveSha256s:(JSON.parse(row.publications) as string[]).sort(),bookMemberships:(JSON.parse(row.memberships) as PackageBookMembership[]).sort((a,b)=>a.archiveSha256.localeCompare(b.archiveSha256))}));
      return identities as PackageCacheProjectionResult<Query>;
    }
    if(query.kind==='learning_choices'){
      validateLearningPackageQuery(query);
      const rows=this.database.exec({sql:learningPackageChoicesSql,bind:[query.languageTag,query.normalizedPrefix,query.normalizedPrefix+'\u{10ffff}',query.limit,query.offset],rowMode:'object',returnValue:'resultRows'}) as Array<{summary_json:string}>;
      return rows.map(row=>JSON.parse(row.summary_json)) as PackageCacheProjectionResult<Query>;
    }
    if(query.kind==='route_counts'){
      const rows=this.database.exec({
        sql:`SELECT json_extract(summary_json,'$.content.targetLanguage') AS target_language,
                    json_extract(summary_json,'$.content.supportLanguage') AS support_language,COUNT(*) AS package_count
             FROM sensa_package_cache_projection GROUP BY target_language,support_language`,
        rowMode:'object',returnValue:'resultRows',
      }) as Array<Record<string,unknown>>;
      return rows.map(row=>({targetLanguage:String(row.target_language),supportLanguage:String(row.support_language),packageCount:Number(row.package_count)})) as PackageCacheProjectionResult<Query>;
    }
    const prefix=query.kind==='summaries'&&query.packageId!==undefined?packageCacheKeyPrefix(query.packageId):undefined;
    const rows=this.database.exec({
      sql:query.kind==='identities'
        ?'SELECT package_key,digest FROM sensa_package_cache_projection ORDER BY package_key'
        :`SELECT summary_json FROM sensa_package_cache_projection ${prefix===undefined?'':'WHERE package_key>=? AND package_key<?'} ORDER BY package_key`,
      ...(prefix===undefined?{}:{bind:[prefix,`${prefix}\uffff`]}),
      rowMode:'object',returnValue:'resultRows',
    }) as Array<Record<string,unknown>>;
    return (query.kind==='identities'
      ?rows.map(row=>({key:String(row.package_key),digest:String(row.digest)}))
      :rows.map(row=>JSON.parse(String(row.summary_json)))) as PackageCacheProjectionResult<Query>;
  }

  /** Covering revision-index probe: never hydrate rows just to invalidate a cache. */
  hasChangesSince(contentRevision:number,tables:readonly SqliteLibraryTable[]):boolean{
    if(!Number.isSafeInteger(contentRevision)||contentRevision<0||!tables.length)return false;
    const selected=[...new Set(tables)],placeholders=selected.map(()=>'?').join(',');
    const rows=this.database.exec({
      sql:`SELECT EXISTS(SELECT 1 FROM sensa_records WHERE content_revision>? AND table_name IN (${placeholders}))
        OR EXISTS(SELECT 1 FROM sensa_record_tombstones WHERE content_revision>? AND table_name IN (${placeholders}))`,
      bind:[contentRevision,...selected,contentRevision,...selected],rowMode:0,returnValue:'resultRows',
    }) as unknown[];
    return Number(rows[0])===1;
  }

  changesSince(contentRevision: number, tables: readonly SqliteLibraryTable[]): SqliteRecordChange[] {
    if (!Number.isSafeInteger(contentRevision) || contentRevision < 0 || tables.length === 0) return [];
    const selected = [...new Set(tables)];
    const placeholders = selected.map(() => '?').join(',');
    const rows = this.database.exec({
      sql: `SELECT table_name,record_key,value_json,content_revision
            FROM sensa_records
            WHERE content_revision>? AND table_name IN (${placeholders})
            UNION ALL
            SELECT table_name,record_key,NULL AS value_json,content_revision
            FROM sensa_record_tombstones
            WHERE content_revision>? AND table_name IN (${placeholders})
            ORDER BY content_revision,table_name,record_key`,
      bind: [contentRevision, ...selected, contentRevision, ...selected],
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      table: String(row.table_name) as SqliteLibraryTable,
      key: String(row.record_key),
      encodedValue: row.value_json === null ? null : this.logicalEncoded(String(row.table_name) as SqliteLibraryTable,String(row.value_json)),
      contentRevision: Number(row.content_revision),
    }));
  }

  syncBaseEntries(keys?: readonly { table: SqliteLibraryTable; key: string }[]): SqliteSyncBaseEntry[] {
    if (keys?.length === 0) return [];
    if (keys) {
      const entries: SqliteSyncBaseEntry[] = [];
      for (const key of keys) {
        const rows = this.database.exec({
          sql: 'SELECT value_json,block_refs_json FROM sensa_sync_base WHERE table_name=? AND record_key=?',
          bind: [key.table, key.key],
          rowMode: 'object',
          returnValue: 'resultRows',
        }) as unknown[];
        if (rows.length) {
          const row = rows[0] as Record<string, unknown>;
          entries.push({
            table: key.table,
            key: key.key,
            valueJson: this.logicalEncoded(key.table,String(row.value_json)),
            blockRefs: JSON.parse(String(row.block_refs_json)) as string[],
          });
        }
      }
      return entries;
    }
    const rows = this.database.exec({
      sql: 'SELECT table_name,record_key,value_json,block_refs_json FROM sensa_sync_base ORDER BY table_name,record_key',
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      table: String(row.table_name) as SqliteLibraryTable,
      key: String(row.record_key),
      valueJson: this.logicalEncoded(String(row.table_name) as SqliteLibraryTable,String(row.value_json)),
      blockRefs: JSON.parse(String(row.block_refs_json)) as string[],
    }));
  }

  count(table: SqliteLibraryTable): number {
    const rows = this.database.exec({
      sql: "SELECT COUNT(*) FROM sensa_records WHERE table_name=?",
      bind: [table],
      rowMode: 0,
      returnValue: "resultRows",
    }) as unknown[];
    return Number(rows[0] ?? 0);
  }

  estimateRecordBytes(tables: readonly SqliteLibraryTable[]): number {
    if(!tables.length)return 0;
    const placeholders=tables.map(()=>'?').join(',');
    const rows=this.database.exec({
      sql:`SELECT COALESCE(SUM(length(CAST(record_key AS BLOB))+length(CAST(value_json AS BLOB))+16),0) FROM sensa_records WHERE table_name IN (${placeholders})`,
      bind:[...tables],
      rowMode:0,
      returnValue:'resultRows',
    }) as unknown[];
    const bodies=this.database.exec({sql:`SELECT COALESCE(SUM(length(CAST(value_json AS BLOB))+length(CAST(digest AS BLOB))+32),0)
      FROM sensa_shared_record_content WHERE digest IN(SELECT digest FROM sensa_shared_record_content_owners WHERE owner_kind='record' AND table_name IN (${placeholders}))`,bind:[...tables],rowMode:0,returnValue:'resultRows'}) as unknown[];
    return Number(rows[0]??0)+Number(bodies[0]??0);
  }

  homeLearningProjection(languageRouteId: string,clock=Date.now()): HomeLearningStorageProjection {
    if(!Number.isFinite(clock))throw new Error('localFlow.clockChanged');
    const now = new Date(clock);
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const targetRows = this.database.exec({
      sql: sqliteHomeLearningTargetsQuery,
      bind: [languageRouteId, languageRouteId, dayStart.getTime(), dayEnd.getTime()],
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as Array<Record<string, unknown>>;
    const packageRows = this.database.exec({
      sql: `SELECT DISTINCT package.record_key
            FROM sensa_learning_route_targets AS route
            JOIN sensa_records AS package
              ON package.table_name='packageCache' AND package.record_key=route.package_key
            WHERE route.language_route_id=?
            UNION
            SELECT DISTINCT package.record_key
            FROM sensa_runtime_learning_candidate_sources AS historical
            JOIN sensa_runtime_learning_enrollments AS enrollment ON enrollment.enrollment_key=historical.enrollment_key
            JOIN sensa_records AS package ON package.table_name='packageCache' AND package.record_key=historical.package_key
            WHERE historical.language_route_id=?1 AND historical.started=1 AND historical.superseded=1
              AND enrollment.kind='published_book' AND enrollment.status='active' AND enrollment.mode<>'paused'
            ORDER BY package.record_key`,
      bind: [languageRouteId],
      rowMode: 0,
      returnValue: 'resultRows',
    }) as unknown[];
    const activeId = this.decoded<string>('meta', 'learning-active');
    const active=activeId?this.decoded<LocalLearningRun>('learningRuns',activeId):undefined;
    const plans=this.decoded<Record<string,{dailyNewSenseLimit?:number}>>('settings','language-route-study-plans');
    // These rows already contain the compact projection and the SQL query
    // already selected active Route membership plus today's introductions.
    // Do not reconstruct and filter the whole collection a second time.
    return {targets:targetRows.map(row=>this.decode<HomeLearningStorageProjection['targets'][number]>(String(row.projection_value_json))),availablePackageKeys:packageRows.map(String),activeRun:active?{id:active.id,targetId:active.targetId}:null,dailyLimit:plans?.[languageRouteId]?.dailyNewSenseLimit,sourceEligibility:this.runtimeCandidates.sourceEligibility(languageRouteId)};
  }

  studyScopeMember(scopeRevisionId:string,targetId:string):import('./studyScopes').LocalStudyScopeMember|null{return this.runtimeCandidates.scopeMember(scopeRevisionId,targetId);}
  latestLearningActionAt(runId:string):string|null{
    const rows=this.database.exec({sql:"SELECT sensa_learning_event_field(value_json,'at') AS at FROM sensa_records WHERE table_name='learningEvents' AND sensa_learning_event_field(value_json,'runId')=? ORDER BY julianday(sensa_learning_event_field(value_json,'at')) DESC LIMIT 1",bind:[runId],rowMode:'object',returnValue:'resultRows'}) as Array<{at:string}>;
    return rows[0]?.at??null;
  }

  learningHistoryProjection():StoredLearningRecord[]{return this.learningHistory.records();}
  learningHistoryPage(query:LearningHistoryRequest):StoredLearningHistoryPage{return this.learningHistory.page(query);}
  learningManagementSummary(query:LearningManagementSummaryQuery):LearningManagementStorageSummary{return this.runtimeCandidates.management(query);}
  runtimeLearningCandidates(query:RuntimeLearningCandidateQuery):RuntimeLearningCandidates{return this.runtimeCandidates.read(query);}

  learningRunIdsForTarget(targetId: string, openOnly: boolean): string[] {
    const rows = this.database.exec({
      sql: `SELECT run_key FROM sensa_learning_run_targets
            WHERE target_key=?${openOnly ? ' AND completed_at IS NULL' : ''}
            ORDER BY run_key`,
      bind: [targetId],
      rowMode: 0,
      returnValue: 'resultRows',
    }) as unknown[];
    return rows.map(String);
  }

  countIntroducedLearningTargets(
    languageRouteId: string,
    startedAfter: string,
    startedBefore: string,
  ): number {
    const rows = this.database.exec({
      sql: `SELECT COUNT(*) FROM sensa_runtime_learning_introductions
            WHERE language_route_id=?
              AND started_at>=? AND started_at<?`,
      bind: [languageRouteId, Date.parse(startedAfter), Date.parse(startedBefore)],
      rowMode: 0,
      returnValue: 'resultRows',
    }) as unknown[];
    return Number(rows[0] ?? 0);
  }

  openLearningRunTargets(): Array<{ runId: string; targetId: string }> {
    const rows = this.database.exec({
      sql: `SELECT run_key,target_key FROM sensa_learning_run_targets
            WHERE completed_at IS NULL ORDER BY target_key,run_key`,
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ runId: String(row.run_key), targetId: String(row.target_key) }));
  }

  countContentAttemptsSince(taskId: string, createdAfter: string): number {
    const rows = this.database.exec({
      sql: `SELECT COUNT(*) FROM sensa_content_attempts
            WHERE task_id=? AND created_at>?`,
      bind: [taskId, createdAfter],
      rowMode: 0,
      returnValue: 'resultRows',
    }) as unknown[];
    return Number(rows[0] ?? 0);
  }

  learningTargetIdsForBookUpgrade(
    languageRouteId: string,
    targetLanguageTag: string,
    supportLanguageTag: string,
    bookId: string,
    nextBookVersionId: string,
  ): string[] {
    const rows = this.database.exec({
      sql: `SELECT DISTINCT target_key FROM sensa_learning_route_targets
            WHERE language_route_id=?
              AND source_kind='sense_learning_package'
              AND target_language_tag=? AND support_language_tag=?
              AND book_id=? AND book_version_id<>?
            ORDER BY target_key`,
      bind: [languageRouteId, targetLanguageTag, supportLanguageTag, bookId, nextBookVersionId],
      rowMode: 0,
      returnValue: 'resultRows',
    }) as unknown[];
    return rows.map(String);
  }

  isMediaReferenced(mediaId: string): boolean {
    const rows = this.database.exec({
      sql: 'SELECT EXISTS(SELECT 1 FROM sensa_media_references WHERE media_id=?)',
      bind: [mediaId],
      rowMode: 0,
      returnValue: 'resultRows',
    }) as unknown[];
    return Number(rows[0] ?? 0) === 1;
  }

  portableMedia(sha256: string): PortableMediaBlob|null {
    const rows=this.database.exec({
      sql:'SELECT size_bytes,bytes FROM sensa_portable_media WHERE sha256=?',
      bind:[sha256],
      rowMode:'object',
      returnValue:'resultRows',
    }) as Array<Record<string,unknown>>;
    if(!rows.length)return null;
    const row=rows[0]!;
    const raw=row.bytes;
    const bytes=raw instanceof Uint8Array
      ?new Uint8Array(raw)
      :raw instanceof ArrayBuffer
        ?new Uint8Array(raw)
        :new Uint8Array(raw as ArrayLike<number>);
    return {sha256,sizeBytes:Number(row.size_bytes),bytes};
  }

  portableMediaDiagnostics():PortableMediaStorageDiagnostics{
    const rows=this.database.exec({
      sql:`SELECT
            (SELECT COUNT(*) FROM sensa_portable_media) AS blob_count,
            (SELECT COALESCE(SUM(size_bytes),0) FROM sensa_portable_media) AS total_bytes,
            (SELECT COUNT(*) FROM sensa_portable_package_media) AS reference_count`,
      rowMode:'object',
      returnValue:'resultRows',
    }) as Array<Record<string,unknown>>;
    const row=rows[0]??{};
    return {
      blobCount:Number(row.blob_count??0),
      totalBytes:Number(row.total_bytes??0),
      referenceCount:Number(row.reference_count??0),
    };
  }

  commit(mutation: SqliteMutation): void {
    if(this.fatalStorageFailure)throw this.fatalStorageFailure;
    if(this.integrityFailed)throw new Error('sqlite_integrity_failed');
    if (
      !mutation.clears.length
      && !mutation.deletes.length
      && !mutation.puts.length
      && !mutation.portablePackages?.length
      && mutation.syncBaseReplacement === undefined
    ) return;
    if (Date.now() >= this.nextOptimizeAt) {
      this.database.exec("PRAGMA optimize");
      this.nextOptimizeAt = Date.now() + sqliteOptimizeIntervalMs;
    }
    const changesBefore=this.database.changes(true);
    let encodedWriteSize=0;
    let bulkMaintenance=false;
    const removedContent=new Set<string>();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const contentRevision = mutation.contentRevision;
      if (contentRevision !== undefined && (!Number.isSafeInteger(contentRevision) || contentRevision <= 0)) {
        throw new Error('sqlite_content_revision_invalid');
      }
      if (mutation.syncBaseReplacement) {
        for(const row of this.database.exec({sql:"SELECT DISTINCT digest FROM sensa_shared_record_content_owners WHERE owner_kind='sync'",rowMode:0,returnValue:'resultRows'}) as string[])removedContent.add(row);
        this.database.exec("DELETE FROM sensa_shared_record_content_owners WHERE owner_kind='sync'");
        this.database.exec('DELETE FROM sensa_sync_base');
        for (const entry of mutation.syncBaseReplacement) {
          const blockRefsJson=JSON.stringify(entry.blockRefs);
          encodedWriteSize+=entry.valueJson.length+blockRefsJson.length;
          this.database.exec({
            sql: 'INSERT INTO sensa_sync_base(table_name,record_key,value_json,block_refs_json) VALUES(?,?,?,?)',
            bind: [entry.table, entry.key, this.storedEncoded('sync',entry.table,entry.key,entry.valueJson,removedContent), blockRefsJson],
          });
        }
      }
      for (const table of mutation.clears) {
        this.detachSharedContent('record',table,undefined,removedContent);
        if (contentRevision !== undefined) {
          this.database.exec({
            sql: `INSERT INTO sensa_record_tombstones(table_name,record_key,content_revision)
                  SELECT table_name,record_key,? FROM sensa_records WHERE table_name=?
                  ON CONFLICT(table_name,record_key) DO UPDATE SET content_revision=excluded.content_revision`,
            bind: [contentRevision, table],
          });
        }
        this.database.exec({ sql: "DELETE FROM sensa_records WHERE table_name=?", bind: [table] });
        if(table==='packageCache'){
          this.database.exec('DELETE FROM sensa_portable_package_media');
          this.database.exec('DELETE FROM sensa_package_cache_projection');
        }
        if (table === 'learningTargets'){this.database.exec('DELETE FROM sensa_learning_targets');this.runtimeCandidates.clear();this.semanticMemoryProjection.clear();}
        if(table==='curriculumEnrollments')this.runtimeCandidates.clearEnrollments();
        if(table==='supplementalMembershipStates')this.runtimeCandidates.clearSupplementalStates();
        if(table==='studyScopes')this.runtimeCandidates.clearScopes();
        if (table === 'learningRuns'){this.database.exec('DELETE FROM sensa_learning_runs');this.learningHistory.clear();}
        if (table === 'contentAttempts') this.database.exec('DELETE FROM sensa_content_attempts');
        if (table === 'semanticMeanings' || table === 'semanticInbox') {
          this.database.exec({
            sql: 'DELETE FROM sensa_media_references WHERE owner_table=?',
            bind: [table],
          });
        }
      }
      for (const item of mutation.deletes) {
        this.detachSharedContent('record',item.table,item.key,removedContent);
        if (contentRevision !== undefined) {
          this.database.exec({
            sql: `INSERT INTO sensa_record_tombstones(table_name,record_key,content_revision)
                  VALUES(?,?,?)
                  ON CONFLICT(table_name,record_key) DO UPDATE SET content_revision=excluded.content_revision`,
            bind: [item.table, item.key, contentRevision],
          });
        }
        this.database.exec({
          sql: "DELETE FROM sensa_records WHERE table_name=? AND record_key=?",
          bind: [item.table, item.key],
        });
        if(item.table==='packageCache'){
          this.database.exec({sql:'DELETE FROM sensa_portable_package_media WHERE package_key=?',bind:[item.key]});
          this.database.exec({sql:'DELETE FROM sensa_package_cache_projection WHERE package_key=?',bind:[item.key]});
        }
        if (item.table === 'learningTargets') {
          this.semanticMemoryProjection.delete(item.key);
          this.runtimeCandidates.delete(item.key);
          this.database.exec({
            sql: 'DELETE FROM sensa_learning_targets WHERE record_key=?',
            bind: [item.key],
          });
        }
        if(item.table==='curriculumEnrollments')this.runtimeCandidates.deleteEnrollment(item.key);
        if(item.table==='supplementalMembershipStates')this.runtimeCandidates.deleteSupplementalState(item.key);
        if(item.table==='studyScopes')this.runtimeCandidates.deleteScope(item.key);
        if (item.table === 'learningRuns') {
          this.learningHistory.delete(item.key);
          this.database.exec({
            sql: 'DELETE FROM sensa_learning_runs WHERE record_key=?',
            bind: [item.key],
          });
        }
        if (item.table === 'contentAttempts') {
          this.database.exec({
            sql: 'DELETE FROM sensa_content_attempts WHERE record_key=?',
            bind: [item.key],
          });
        }
        if (item.table === 'semanticMeanings' || item.table === 'semanticInbox') {
          this.database.exec({
            sql: 'DELETE FROM sensa_media_references WHERE owner_table=? AND owner_key=?',
            bind: [item.table, item.key],
          });
        }
      }
      for(const portable of mutation.portablePackages??[]){
        this.database.exec({
          sql:'DELETE FROM sensa_portable_package_media WHERE package_key=?',
          bind:[portable.packageKey],
        });
        for(const media of portable.media){
          encodedWriteSize+=media.bytes.byteLength;
          this.database.exec({
            sql:`INSERT INTO sensa_portable_media(sha256,size_bytes,bytes) VALUES(?,?,?)
                  ON CONFLICT(sha256) DO NOTHING`,
            bind:[media.sha256,media.sizeBytes,media.bytes],
          });
          const existing=this.database.exec({
            sql:'SELECT size_bytes FROM sensa_portable_media WHERE sha256=?',
            bind:[media.sha256],
            rowMode:0,
            returnValue:'resultRows',
          }) as unknown[];
          if(Number(existing[0]??0)!==media.sizeBytes)throw new Error('portable_media_digest_collision');
          this.database.exec({
            sql:`INSERT INTO sensa_portable_package_media(
                   package_key,media_id,sha256,mime_type,media_kind
                 ) VALUES(?,?,?,?,?)`,
            bind:[portable.packageKey,media.mediaId,media.sha256,media.mimeType,media.kind],
          });
        }
      }
      for (const item of mutation.puts) {
        encodedWriteSize+=item.encodedValue.length;
        const stored=this.storedEncoded('record',item.table,item.key,item.encodedValue,removedContent);
        if (contentRevision === undefined) {
          this.database.exec({
            sql: `INSERT INTO sensa_records(table_name,record_key,value_json,content_revision) VALUES(?,?,?,0)
                  ON CONFLICT(table_name,record_key) DO UPDATE SET value_json=excluded.value_json`,
            bind: [item.table, item.key, stored],
          });
        } else {
          this.database.exec({
            sql: `INSERT INTO sensa_records(table_name,record_key,value_json,content_revision) VALUES(?,?,?,?)
                  ON CONFLICT(table_name,record_key) DO UPDATE SET
                    value_json=excluded.value_json,
                    content_revision=excluded.content_revision`,
            bind: [item.table, item.key, stored, contentRevision],
          });
          this.database.exec({
            sql: 'DELETE FROM sensa_record_tombstones WHERE table_name=? AND record_key=?',
            bind: [item.table, item.key],
          });
        }
        if(item.table==='packageCache')this.upsertPackageCacheProjection(item.key,item.encodedValue);
        if(item.table==='curriculumEnrollments')this.runtimeCandidates.upsertEnrollment(item.key,this.decode<import('./curriculumEnrollments').LocalCurriculumEnrollment>(item.encodedValue));
        if(item.table==='supplementalMembershipStates')this.runtimeCandidates.upsertSupplementalState(item.key,this.decode<import('./supplementalMemberships').SupplementalMembershipState>(item.encodedValue));
        if(item.table==='studyScopes')this.runtimeCandidates.upsertScope(item.key,this.decode<import('./studyScopes').LocalStudyScope>(item.encodedValue));
        if (item.table === 'learningTargets') {
          this.upsertLearningTargetProjection(item.key, item.encodedValue);
        }
        if (item.table === 'learningRuns') {
          this.upsertLearningRunProjection(item.key, item.encodedValue);
        }
        if (item.table === 'contentAttempts') {
          this.upsertContentAttemptProjection(item.key, item.encodedValue);
        }
        if (item.table === 'semanticMeanings' || item.table === 'semanticInbox') {
          this.replaceMediaReferences(item.table, item.key, item.encodedValue);
        }
      }
      // Replica mutations are ordered by record identity, not dependency:
      // fresh-device Runs can precede their Targets. Index completed history
      // only after every source row has been staged in this same transaction.
      for(const item of mutation.puts)if(item.table==='learningRuns')this.learningHistory.upsert(item.key,this.decode<LocalLearningRun>(item.encodedValue));
      if(
        mutation.clears.includes('packageCache')
        ||mutation.deletes.some(item=>item.table==='packageCache')
        ||(mutation.portablePackages?.length??0)>0
      )this.database.exec(`DELETE FROM sensa_portable_media
                            WHERE NOT EXISTS(
                              SELECT 1 FROM sensa_portable_package_media AS reference
                              WHERE reference.sha256=sensa_portable_media.sha256
                            )`);
      this.meaningLookup.update(mutation);
      this.worldBrowseProjection.update(mutation);
      this.practiceExpressionProjection.update(mutation);
      this.journeyIdentities.update(mutation);
      // Only dependencies detached by this mutation can become orphaned. An
      // ordinary rating must not sweep all immutable bodies in the library.
      for(const digest of removedContent)this.database.exec({sql:'DELETE FROM sensa_shared_record_content WHERE digest=? AND NOT EXISTS(SELECT 1 FROM sensa_shared_record_content_owners WHERE digest=?)',bind:[digest,digest]});
      // Rapid bulk growth is a maintenance point. Persist useful statistics
      // with that import instead of making the next page's reopen pay for it.
      // Count actual SQL writes, including sync baselines, normalized media
      // and derived indexes. Large individual encoded values/media also need
      // maintenance even when they occupy only a handful of logical rows.
      bulkMaintenance=this.database.changes(true)-changesBefore>256||encodedWriteSize>1024*1024||mutation.clears.length>0;
      if(bulkMaintenance)this.database.exec('PRAGMA optimize');
      this.database.exec("COMMIT");
      this.integrityCheck=undefined;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch (rollbackCause) {
        const failure=sqliteRollbackFailure(error,rollbackCause);
        if(isFatalSqliteConnectionFailure(failure))this.fatalStorageFailure??=failure;
        throw failure;
      }
      throw error;
    }
    // A completed large transaction can leave a large reusable WAL. Bound its
    // cold-reopen cost after COMMIT; failure here cannot undo/deny that commit.
    if(this.persistence==='opfs'&&bulkMaintenance)this.maintainWal();
  }

  private maintainWal():void{
    const started=performance.now(),checkedAt=new Date().toISOString();
    try{
      const result=this.database.exec({sql:'PRAGMA wal_checkpoint(TRUNCATE)',rowMode:'object',returnValue:'resultRows'}) as Array<{busy:number}>;
      this.walMaintenance={status:result[0]?.busy===0?'ok':'deferred',checkedAt,durationMs:Math.round(performance.now()-started)};
    }catch(cause){
      this.walMaintenance={status:'failed',checkedAt,durationMs:Math.round(performance.now()-started),reason:cause instanceof Error?cause.message:String(cause)};
      // A maintenance failure cannot deny an already durable COMMIT, but a
      // physical I/O/corruption failure cannot leave this connection usable.
      if(isFatalSqliteConnectionFailure(cause))this.fatalStorageFailure??=cause as Error;
    }
  }

  diagnostics(options?:Readonly<{verifyIntegrity?:boolean}>): SqliteStorageDiagnostics {
    if(this.fatalStorageFailure)throw this.fatalStorageFailure;
    if(options?.verifyIntegrity)this.verifyIntegrity();
    let journeyIdentityCheck:ReturnType<SqliteJourneyIdentityProjection['checkAndRepair']>|undefined;
    try{journeyIdentityCheck=options?.verifyIntegrity?this.journeyIdentities.checkAndRepair():undefined;}
    catch(cause){if(isFatalSqliteConnectionFailure(cause))this.fatalStorageFailure??=cause as Error;throw cause;}
    if(journeyIdentityCheck?.status==='rebuilt'&&this.persistence==='opfs')this.maintainWal();
    if(this.fatalStorageFailure)throw this.fatalStorageFailure;
    return {
      ...(this.walMaintenance?{walMaintenance:this.walMaintenance}:{}),
      ...(journeyIdentityCheck?{journeyIdentityCheck}:{}),
      ...(this.integrityCheck?{integrityCheck:this.integrityCheck}:{}),
      ...(this.initializationTimingsMs?{initializationTimingsMs:this.initializationTimingsMs}:{}),
      engine: "sqlite-wasm",
      persistence: this.persistence,
      sqliteVersion: this.sqlite3.version.libVersion,
      schemaVersion: this.scalarNumber("PRAGMA user_version"),
      journalMode: this.scalarText("PRAGMA journal_mode"),
      synchronous: this.scalarNumber("PRAGMA synchronous"),
      lockingMode: this.scalarText("PRAGMA locking_mode"),
    };
  }

  private verifyIntegrity():void{
    const started=performance.now();
    const rows=this.database.exec({sql:'PRAGMA quick_check(1)',rowMode:0,returnValue:'resultRows'}) as unknown[];
    if(rows.length!==1||rows[0]!=='ok'){
      this.integrityCheck=undefined;
      this.integrityFailed=true;
      throw new Error('sqlite_integrity_failed');
    }
    this.integrityFailed=false;
    this.integrityCheck={status:'ok',checkedAt:new Date().toISOString(),durationMs:Math.round(performance.now()-started)};
  }

  close(optimize=true): void {
    if(this.closed)return;
    let optimizeFailed=false;
    let optimizeFailure:unknown;
    if(optimize&&!this.connectionFailed){
      try{this.database.exec("PRAGMA optimize");}
      catch(cause){optimizeFailed=true;optimizeFailure=cause;}
    }
    this.meaningLookup.close();this.worldBrowseProjection.close();this.journeyIdentities.close();this.recordGet?.finalize();this.recordGet=undefined;
    this.database.close();
    this.closed=true;
    if(optimizeFailed)throw optimizeFailure;
  }

  private scalarNumber(sql: string): number {
    const rows = this.database.exec({
      sql,
      rowMode: 0,
      returnValue: "resultRows",
    }) as unknown[];
    return Number(rows[0] ?? 0);
  }

  private scalarText(sql: string): string {
    const rows = this.database.exec({
      sql,
      rowMode: 0,
      returnValue: "resultRows",
    }) as unknown[];
    return String(rows[0] ?? "").toLowerCase();
  }

  private logicalEncoded(table:SqliteLibraryTable,encoded:string):string{
    if(!sharedRecordTables.has(table))return encoded;
    const plain=unpackStoredRecord(encoded);
    if(!plain.includes('sensa-shared-content-v1'))return plain;
    return JSON.stringify(expandSharedRecordContent(JSON.parse(plain),digest=>{
      const rows=this.database.exec({sql:'SELECT value_json FROM sensa_shared_record_content WHERE digest=?',bind:[digest],rowMode:0,returnValue:'resultRows'}) as string[];
      return rows.length?unpackStoredRecord(String(rows[0])):undefined;
    }));
  }

  private detachSharedContent(kind:'record'|'sync',table:SqliteLibraryTable,key:string|undefined,removed:Set<string>):void{
    if(!sharedRecordTables.has(table))return;
    const where=key===undefined?'owner_kind=? AND table_name=?':'owner_kind=? AND table_name=? AND record_key=?',bind=key===undefined?[kind,table]:[kind,table,key];
    for(const digest of this.database.exec({sql:`SELECT digest FROM sensa_shared_record_content_owners WHERE ${where}`,bind,rowMode:0,returnValue:'resultRows'}) as string[])removed.add(digest);
    this.database.exec({sql:`DELETE FROM sensa_shared_record_content_owners WHERE ${where}`,bind});
  }

  private storedEncoded(kind:'record'|'sync',table:SqliteLibraryTable,key:string,encoded:string,removed:Set<string>):string{
    if(!sharedRecordTables.has(table))return encoded;
    this.detachSharedContent(kind,table,key,removed);
    const shared=externalizeSharedRecordContent(JSON.parse(encoded));
    if(shared.bodies.size>32){
      const entries=[...shared.bodies];
      for(let offset=0;offset<entries.length;offset+=128){
        const batch=entries.slice(offset,offset+128),digests=batch.map(([digest])=>digest);
        const current=new Map((this.database.exec({sql:'SELECT digest,value_json FROM sensa_shared_record_content WHERE digest IN (SELECT value FROM json_each(?))',bind:[JSON.stringify(digests)],rowMode:'object',returnValue:'resultRows'}) as {digest:string;value_json:string}[]).map(row=>[row.digest,row.value_json]));
        const missing:[string,string][]=[];
        for(const [digest,body] of batch){
          const stored=current.get(digest);
          if(stored!==undefined){if(unpackStoredRecord(stored)!==body)throw new Error('sqlite_shared_content_invalid');}
          else missing.push([digest,packStoredRecord(body)]);
        }
        if(missing.length)this.database.exec({sql:"INSERT INTO sensa_shared_record_content SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)",bind:[JSON.stringify(missing)]});
        this.database.exec({sql:'INSERT INTO sensa_shared_record_content_owners(owner_kind,table_name,record_key,digest) SELECT ?,?,?,value FROM json_each(?)',bind:[kind,table,key,JSON.stringify(digests)]});
      }
      return packStoredRecord(JSON.stringify(shared.value));
    }
    for(const [digest,body] of shared.bodies){
      const current=this.database.exec({sql:'SELECT value_json FROM sensa_shared_record_content WHERE digest=?',bind:[digest],rowMode:0,returnValue:'resultRows'}) as string[];
      if(current.length){if(unpackStoredRecord(String(current[0]))!==body)throw new Error('sqlite_shared_content_invalid');}
      else this.database.exec({sql:'INSERT INTO sensa_shared_record_content(digest,value_json) VALUES(?,?)',bind:[digest,packStoredRecord(body)]});
      this.database.exec({sql:'INSERT INTO sensa_shared_record_content_owners(owner_kind,table_name,record_key,digest) VALUES(?,?,?,?)',bind:[kind,table,key,digest]});
    }
    return packStoredRecord(JSON.stringify(shared.value));
  }

  private decoded<T>(table: SqliteLibraryTable, key: string): T | undefined {
    const encoded = this.get(table, key);
    return encoded === null ? undefined : this.decode<T>(encoded);
  }

  private decode<T>(encoded: string): T {
    return decodeBackupValue(JSON.parse(encoded)) as T;
  }

  private upsertPackageCacheProjection(key:string,encodedValue:string):void{
    const value=this.decode<unknown>(encodedValue);
    if(!isPackageCacheProjectionSource(value)){
      this.database.exec({sql:'DELETE FROM sensa_package_cache_projection WHERE package_key=?',bind:[key]});
      return;
    }
    const summary=createPackageCacheSummary(value);
    if(value.key!==key)throw new Error('sqlite_package_cache_key_mismatch');
    this.database.exec({
      sql:`INSERT INTO sensa_package_cache_projection(package_key,digest,summary_json) VALUES(?,?,?)
           ON CONFLICT(package_key) DO UPDATE SET digest=excluded.digest,summary_json=excluded.summary_json`,
      bind:[key,summary.digest,JSON.stringify(summary)],
    });
  }

  private rebuildPackageCacheProjection():void{
    if(!this.scalarNumber("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sensa_records'"))return;
    for(const row of this.entries('packageCache'))this.upsertPackageCacheProjection(row.key,row.encodedValue);
  }

  private upsertLearningTargetProjection(key: string, encodedValue: string): void {
    const target = this.decode<LocalLearningTarget>(encodedValue);
    this.runtimeCandidates.upsert(key,target);
    this.writeLearningTargetProjection(key,target);
  }

  private writeLearningTargetProjection(key:string,target:LocalLearningTarget):void{
    this.semanticMemoryProjection.upsert(key,target);
    const projection = createHomeLearningTargetRecord(target);
    this.database.exec({
      sql: `INSERT INTO sensa_learning_targets(
              record_key,projection_value_json,introduced_language_route_id,started_at
            ) VALUES(?,?,?,?)
            ON CONFLICT(record_key) DO UPDATE SET
              projection_value_json=excluded.projection_value_json,
              introduced_language_route_id=excluded.introduced_language_route_id,
              started_at=excluded.started_at`,
      bind: [
        key,
        JSON.stringify(encodeBackupValue(projection)),
        target.introducedLanguageRouteId,
        target.startedAt,
      ],
    });
    this.database.exec({
      sql: 'DELETE FROM sensa_learning_route_targets WHERE target_key=?',
      bind: [key],
    });
    for (const membership of target.curriculumMemberships) {
      if(membership.status==='superseded')continue;
      const provenance = membership.provenance;
      const bookId = typeof provenance.bookId === 'string' ? provenance.bookId : null;
      const bookVersionId = typeof provenance.bookVersionId === 'string' ? provenance.bookVersionId : null;
      this.database.exec({
        sql: `INSERT INTO sensa_learning_route_targets(
                language_route_id,target_key,membership_id,package_key,source_kind,
                target_language_tag,support_language_tag,book_id,book_version_id
              ) VALUES(?,?,?,?,?,?,?,?,?)`,
        bind: [
          membership.languageContext.languageRouteId,
          key,
          membership.id,
          membership.packageKey,
          membership.sourceKind,
          membership.languageContext.targetLanguageTag,
          membership.languageContext.supportLanguageTag,
          bookId,
          bookVersionId,
        ],
      });
    }
  }

  private upsertLearningRunProjection(key: string, encodedValue: string): void {
    const run = this.decode<LocalLearningRun>(encodedValue);
    this.database.exec({
      sql: `INSERT INTO sensa_learning_runs(record_key,completed_at) VALUES(?,?)
            ON CONFLICT(record_key) DO UPDATE SET completed_at=excluded.completed_at`,
      bind: [key, run.completedAt],
    });
    this.database.exec({
      sql: 'DELETE FROM sensa_learning_run_targets WHERE run_key=?',
      bind: [key],
    });
    for (const targetId of run.targetIds) {
      this.database.exec({
        sql: `INSERT INTO sensa_learning_run_targets(target_key,run_key,completed_at)
              VALUES(?,?,?)`,
        bind: [targetId, key, run.completedAt],
      });
    }
  }

  private upsertContentAttemptProjection(key: string, encodedValue: string): void {
    const attempt = this.decode<ContentAttemptProjectionSource>(encodedValue);
    this.database.exec({
      sql: `INSERT INTO sensa_content_attempts(record_key,task_id,created_at)
            VALUES(?,?,?)
            ON CONFLICT(record_key) DO UPDATE SET
              task_id=excluded.task_id,
              created_at=excluded.created_at`,
      bind: [key, attempt.taskId, attempt.createdAt],
    });
  }

  private replaceMediaReferences(
    table: 'semanticMeanings' | 'semanticInbox',
    key: string,
    encodedValue: string,
  ): void {
    const mediaIds = table === 'semanticMeanings'
      ? (this.decode<SemanticMeaningMediaSource>(encodedValue).personalSemanticAnchorRevisions ?? [])
        .map((revision) => revision.personalMediaObjectId)
      : (this.decode<SemanticInboxMediaSource>(encodedValue).payload?.context?.mediaReferenceIds ?? []);
    this.database.exec({
      sql: 'DELETE FROM sensa_media_references WHERE owner_table=? AND owner_key=?',
      bind: [table, key],
    });
    for (const mediaId of new Set(mediaIds)) {
      if (!mediaId) continue;
      this.database.exec({
        sql: `INSERT INTO sensa_media_references(media_id,owner_table,owner_key)
              VALUES(?,?,?)`,
        bind: [mediaId, table, key],
      });
    }
  }
}
