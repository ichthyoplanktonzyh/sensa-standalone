import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";

import {decodeBackupValue,encodeBackupValue} from './backupCodec';
import {learningExpressionForm,learningPackageChoicesSql,validateLearningPackageQuery} from './packageCacheProjection';
import {SqliteMeaningLookupProjection} from './meaningLookupProjection';
import {SqliteWorldBrowseProjection} from './worldBrowseProjection';
import {SqliteJourneyIdentityProjection} from './journeyIdentityProjection';
import {ensureSqliteSchemaIndexes} from './sqliteSchemaIndexes';
import {registryFieldReader,registrySelectionSql,registrySelectionResult,type RegistrySelectionQuery,type RegistrySelection} from './semanticRegistrySelection';
import type {WorldBrowseQuery,WorldBrowsePage,WorldLearningChoiceQuery,WorldLearningChoicePage} from '../../experience/personalMeaningJourney/worldRead';
import type {MeaningLookupResult} from '../../experience/personalMeaningJourney/meaningLookup';
import {createPackageCacheSummary,isPackageCacheProjectionSource,packageCacheKeyPrefix,sqlitePackageCacheProjectionSchema,type PackageCacheProjectionQuery,type PackageCacheProjectionResult} from './packageCacheProjection';
import {
  createHomeLearningTargetRecord,
  createHomeLearningStorageProjection,
  type HomeLearningStorageProjection,
} from './homeLearningRecords';
import type {LocalLearningRun,LocalLearningTarget} from '../../learning/runtime/localProtocol';
import {
  sqliteLibrarySchema,
  sqlitePortableMediaSchema,
  sqliteLibraryBaselineVersion,
  sqliteLibrarySchemaVersion,
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
      WHERE target.introduced_language_route_id=?
        AND target.started_at>=? AND target.started_at<?
      ORDER BY record_key`;

/** Internal SQLite record kernel owned by the OPFS Worker. */
export class SqliteRecordDatabase {
  private nextOptimizeAt = 0;
  private closed=false;
  private initialized=false;
  private initializationTimingsMs:Record<string,number>|undefined;
  private integrityCheck:SqliteStorageDiagnostics['integrityCheck'];
  private integrityFailed=false;
  private meaningLookup:SqliteMeaningLookupProjection;
  private worldBrowseProjection:SqliteWorldBrowseProjection;
  private walMaintenance:SqliteStorageDiagnostics['walMaintenance'];
  private journeyIdentities:SqliteJourneyIdentityProjection;
  private recordGet:ReturnType<Database['prepare']>|undefined;

  constructor(
    private readonly sqlite3: Sqlite3Static,
    private readonly database: Database,
    private readonly persistence: SqliteStorageDiagnostics["persistence"],
  ) {
    const field=registryFieldReader();
    this.database.createFunction({name:'sensa_expression_form',arity:2,deterministic:true,innocuous:true,xFunc:(_context,text,language)=>learningExpressionForm(text,language)});
    this.database.createFunction({name:'sensa_registry_field',arity:2,deterministic:true,innocuous:true,xFunc:(_context,encoded,key)=>field(encoded,key)});
    this.meaningLookup=new SqliteMeaningLookupProjection(database,(table,key)=>this.get(table,key));
    this.worldBrowseProjection=new SqliteWorldBrowseProjection(database,(table,key)=>this.get(table,key));
    this.journeyIdentities=new SqliteJourneyIdentityProjection(database);
  }

  initialize(): SqliteStorageDiagnostics {
    if(this.closed)throw new Error('sqlite_database_closed');
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
        this.database.exec(sqlitePackageCacheProjectionSchema);
        this.rebuildPackageCacheProjection();
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
        this.rebuildPackageCacheProjection();
        this.database.exec(`PRAGMA user_version=${sqliteLibrarySchemaVersion}`);
        this.database.exec('COMMIT');
      }catch(error){
        try{this.database.exec('ROLLBACK');}catch{/* Retain the authoritative cache. */}
        throw error;
      }
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
      worldReady=performance.now();
      this.journeyIdentities.initialize();
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
    try{return statement.step()?String(statement.get(0)):null;}finally{statement.reset(true);}
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
      encodedValue: String(row.value_json),
    }));
  }
  lookupMeanings(query:string):MeaningLookupResult{return this.meaningLookup.query(query);}
  worldBrowse(query:WorldBrowseQuery):WorldBrowsePage{return this.worldBrowseProjection.query(query);}
  registrySelection(query:RegistrySelectionQuery):RegistrySelection{
    const {sql,bind}=registrySelectionSql(query);
    const rows=this.database.exec({sql,bind:bind as import('@sqlite.org/sqlite-wasm').SqlValue[],rowMode:'object',returnValue:'resultRows'}) as Record<string,any>[];
    return registrySelectionResult(query,rows);
  }
  worldLearningChoices(query:WorldLearningChoiceQuery):WorldLearningChoicePage{return this.worldBrowseProjection.learningChoices(query);}
  existingJourneyIdentities(ids:readonly string[]):string[]{return this.journeyIdentities.existing(ids);}

  entriesPage(table:SqliteLibraryTable,afterKey:string|null,limit:number):StoredEntry[]{
    if(!Number.isSafeInteger(limit)||limit<1||limit>256)throw new Error('sqlite_invalid_page_size');
    const rows=this.database.exec({
      sql:`SELECT record_key,value_json FROM sensa_records WHERE table_name=? ${afterKey===null?'':'AND record_key>?'} ORDER BY record_key LIMIT ?`,
      bind:afterKey===null?[table,limit]:[table,afterKey,limit],rowMode:'object',returnValue:'resultRows',
    }) as Array<Record<string,unknown>>;
    return rows.map(row=>({key:String(row.record_key),encodedValue:String(row.value_json)}));
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
      encodedValue: row.value_json === null ? null : String(row.value_json),
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
            valueJson: String(row.value_json),
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
      valueJson: String(row.value_json),
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
    return Number(rows[0]??0);
  }

  homeLearningProjection(languageRouteId: string): HomeLearningStorageProjection {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const targetRows = this.database.exec({
      sql: sqliteHomeLearningTargetsQuery,
      bind: [languageRouteId, languageRouteId, dayStart.toISOString(), dayEnd.toISOString()],
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as Array<Record<string, unknown>>;
    const packageRows = this.database.exec({
      sql: `SELECT DISTINCT package.record_key
            FROM sensa_learning_route_targets AS route
            JOIN sensa_records AS package
              ON package.table_name='packageCache' AND package.record_key=route.package_key
            WHERE route.language_route_id=?
            ORDER BY package.record_key`,
      bind: [languageRouteId],
      rowMode: 0,
      returnValue: 'resultRows',
    }) as unknown[];
    const activeId = this.decoded<string>('meta', 'learning-active');
    return createHomeLearningStorageProjection({
      targets: targetRows.map((row) => this.decode<LocalLearningTarget>(String(row.projection_value_json))),
      availablePackageKeys: packageRows.map(String),
      activeRun: activeId
        ? this.decoded<LocalLearningRun>('learningRuns', activeId) ?? null
        : null,
      studyPlans: this.decoded('settings', 'language-route-study-plans') ?? {},
      languageRouteId,
    });
  }

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
      sql: `SELECT COUNT(*) FROM sensa_learning_targets
            WHERE introduced_language_route_id=?
              AND started_at>=? AND started_at<?`,
      bind: [languageRouteId, startedAfter, startedBefore],
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
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const contentRevision = mutation.contentRevision;
      if (contentRevision !== undefined && (!Number.isSafeInteger(contentRevision) || contentRevision <= 0)) {
        throw new Error('sqlite_content_revision_invalid');
      }
      if (mutation.syncBaseReplacement) {
        this.database.exec('DELETE FROM sensa_sync_base');
        for (const entry of mutation.syncBaseReplacement) {
          const blockRefsJson=JSON.stringify(entry.blockRefs);
          encodedWriteSize+=entry.valueJson.length+blockRefsJson.length;
          this.database.exec({
            sql: 'INSERT INTO sensa_sync_base(table_name,record_key,value_json,block_refs_json) VALUES(?,?,?,?)',
            bind: [entry.table, entry.key, entry.valueJson, blockRefsJson],
          });
        }
      }
      for (const table of mutation.clears) {
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
        if (table === 'learningTargets') this.database.exec('DELETE FROM sensa_learning_targets');
        if (table === 'learningRuns') this.database.exec('DELETE FROM sensa_learning_runs');
        if (table === 'contentAttempts') this.database.exec('DELETE FROM sensa_content_attempts');
        if (table === 'semanticMeanings' || table === 'semanticInbox') {
          this.database.exec({
            sql: 'DELETE FROM sensa_media_references WHERE owner_table=?',
            bind: [table],
          });
        }
      }
      for (const item of mutation.deletes) {
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
          this.database.exec({
            sql: 'DELETE FROM sensa_learning_targets WHERE record_key=?',
            bind: [item.key],
          });
        }
        if (item.table === 'learningRuns') {
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
        if (contentRevision === undefined) {
          this.database.exec({
            sql: `INSERT INTO sensa_records(table_name,record_key,value_json,content_revision) VALUES(?,?,?,0)
                  ON CONFLICT(table_name,record_key) DO UPDATE SET value_json=excluded.value_json`,
            bind: [item.table, item.key, item.encodedValue],
          });
        } else {
          this.database.exec({
            sql: `INSERT INTO sensa_records(table_name,record_key,value_json,content_revision) VALUES(?,?,?,?)
                  ON CONFLICT(table_name,record_key) DO UPDATE SET
                    value_json=excluded.value_json,
                    content_revision=excluded.content_revision`,
            bind: [item.table, item.key, item.encodedValue, contentRevision],
          });
          this.database.exec({
            sql: 'DELETE FROM sensa_record_tombstones WHERE table_name=? AND record_key=?',
            bind: [item.table, item.key],
          });
        }
        if(item.table==='packageCache')this.upsertPackageCacheProjection(item.key,item.encodedValue);
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
      this.journeyIdentities.update(mutation);
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
      try { this.database.exec("ROLLBACK"); } catch { /* Preserve the original failure. */ }
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
    }catch(cause){this.walMaintenance={status:'failed',checkedAt,durationMs:Math.round(performance.now()-started),reason:cause instanceof Error?cause.message:String(cause)};}
  }

  diagnostics(options?:Readonly<{verifyIntegrity?:boolean}>): SqliteStorageDiagnostics {
    if(options?.verifyIntegrity)this.verifyIntegrity();
    const journeyIdentityCheck=options?.verifyIntegrity?this.journeyIdentities.checkAndRepair():undefined;
    if(journeyIdentityCheck?.status==='rebuilt'&&this.persistence==='opfs')this.maintainWal();
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
    if(optimize){
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
      if (membership.status === 'superseded') continue;
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
