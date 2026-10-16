import {validateContextDelta} from './contextDeltaAdmission';
import {deferReplicaWork,replicaWork} from './replicaWork';
import {requireCloudScratchSpace} from './cloudScratchStorage';
import type {ContextBrowseQuery,ContextBrowsePage} from '../../experience/personalMeaningJourney/contextRead';
import {contextMediaReferences} from '../../experience/personalMeaningJourney/contextRecords';
import type {LearningScheduleQuery,LearningSchedulePage} from '../../learning/system/learningScheduleModel';
import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import {meaningMediaReferences} from '../../experience/personalMeaningJourney/meaningHistoryRead';
import {isFatalSqliteConnectionFailure,sqliteRollbackFailure} from './sqliteConnectionFailure';
import type {LibraryRecordReader} from './libraryRecordReader';
import {SqliteSyncDependencies,syncAdmission,type SyncDependencyCertificate} from './sqliteSyncDependencies';
import {assertDeltaReceiveShape,DeltaReceiveFallback} from './learningDeltaAdmission';
import type {CloudSyncState,DirtyRebaseReceipt} from './cloudSync';
import {validatedCheckpoint} from './cloudSyncCheckpoint';
import {librarySyncTables,librarySyncSnapshotPageResult,librarySyncMetadataPageBytes,librarySyncMetadataPageRefs} from '@sensa/contracts/sensa';
import {isReplicatedLibraryEntry} from './replication/libraryReplica';
import {libraryRestoreValidationVersion} from './replication/libraryReplicaValidation';

import {decodeBackupValue,encodeBackupValue,backupEqual} from './backupCodec';
import type {ReplicaCandidateRequest,ReplicaCandidateResponse,ReplicaCandidateFence} from './replicaCandidateProtocol';
import {externalizeSharedRecordContent,expandSharedRecordContent,packStoredRecord,unpackStoredRecord,sharedRecordTables,StoredRecordMemo,type PreparedStoredRecord} from './sharedRecordContent';
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
  sqliteLibraryBaselineVersion,
  sqliteLibrarySchemaVersion,
  sqliteLibraryTables,
  sqliteSourceDataTables,
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
  conflictHistory?:{branches:Array<{record:SemanticMeaningMediaSource}>};
};
type SemanticInboxMediaSource = {
  payload?: { context?: { mediaReferenceIds?: string[] } | null };
};

const sqliteOptimizeIntervalMs = 24 * 60 * 60 * 1000;
const sqliteRequiredTables=[...sqliteLibrarySchema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gu)].map(match=>match[1]!).filter(name=>name!=='sensa_package_cache_projection');
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
  private replicaCandidates:Promise<import('./sqliteReplicaCandidates').SqliteReplicaCandidates>|undefined;
  private replicaCandidateStore:import('./sqliteReplicaCandidates').SqliteReplicaCandidates|undefined;
  private initialPublication:import('./sqliteInitialPublication').SqliteInitialPublication|undefined;
  private replicaCandidatesClosing=false;
  private activationMemo:StoredRecordMemo|undefined;
  private activationTargetLanguages:Map<string,string>|undefined;
  private activationTargetLanguageBytes=0;
  private activationPreparedBodies:Set<string>|undefined;
  private privateRestoreController:AbortController|undefined;
  private privateRestoreUsed=false;
  private privateRestoreWork:Promise<void>|undefined;
  private snapshotReader:LibraryRecordReader|undefined;
  private snapshotSource:import('./sqliteSnapshotSource').SqliteSnapshotSource|undefined;
  private readonly syncDependencies:SqliteSyncDependencies;

  /** The Worker must stop queued requests even if the durable COMMIT succeeded. */
  get connectionFailed():boolean{return this.integrityFailed||this.fatalStorageFailure!==undefined;}

  async exportLocalSnapshot(pool:import('@sqlite.org/sqlite-wasm').SAHPoolUtil,expectedRevision:number){
    const {createLocalPortableSnapshot}=await import('./sqlitePortableSnapshot');
    return createLocalPortableSnapshot(this.sqlite3,pool,this,expectedRevision);
  }
  async exportOwnCloudSnapshot(pool:import('@sqlite.org/sqlite-wasm').SAHPoolUtil,fence:ReplicaCandidateFence){
    this.assertReplicaCandidateFence(fence);
    const {createOwnCloudPortableSnapshot}=await import('./sqlitePortableSnapshot');
    return createOwnCloudPortableSnapshot(this.sqlite3,pool,this,fence);
  }
  beforeSnapshotRequest(kind:string):void{this.snapshotSource?.beforeRequest(kind);}
  async snapshotSourceRequest(input:import('./sqliteSnapshotSource').SnapshotSourceRequest){
    if(!this.snapshotSource){const {SqliteSnapshotSource}=await import('./sqliteSnapshotSource');this.snapshotSource=new SqliteSnapshotSource(this.sqlite3,this.database,this.syncDependencies,key=>this.get('meta',key),fence=>this.assertReplicaCandidateFence(fence),cause=>this.quarantineConnection(cause));}
    return this.snapshotSource.request(input);
  }
  private ownSnapshot:{binding:import('./sqlitePortableSnapshot').OwnCloudSnapshotBinding;owner:ReplicaCandidateFence['owner'];after:{table:string;key:string}|null;records:number;sealed:boolean}|undefined;
  /** Called only after the distinct authenticated own-cloud import succeeded. */
  bindOwnCloudSnapshot(binding:import('./sqlitePortableSnapshot').OwnCloudSnapshotBinding,owner:ReplicaCandidateFence['owner']){
    if(this.ownSnapshot||binding.accountId!==owner.accountId)throw Error('sqlite_snapshot_checkpoint_binding');
    this.ownSnapshot={binding,owner,after:null,records:0,sealed:false};
    this.commit({clears:[],deletes:[],puts:[{table:'meta',key:'service-owner',encodedValue:JSON.stringify(encodeBackupValue(owner))}]});
  }
  ownCloudBaselinePage(raw:import('@sensa/contracts/sensa').LibrarySyncSnapshotPageResult){
    const input=librarySyncSnapshotPageResult.parse(raw),context=this.ownSnapshot;
    if(!context||context.sealed||input.snapshotRevision!==context.binding.revision||!backupEqual(input.after,context.after)||!input.rows.length&&!input.done||new TextEncoder().encode(JSON.stringify(input)).length>librarySyncMetadataPageBytes||input.rows.reduce((n,row)=>n+row.blocks.length,0)>librarySyncMetadataPageRefs)throw Error('sqlite_snapshot_checkpoint_binding');
    const last=input.rows.at(-1),next=last?{table:last.table,key:last.key}:context.after;
    if(!backupEqual(next,input.next)||context.records+input.rows.length>context.binding.records)throw Error('sqlite_snapshot_checkpoint_binding');
    this.database.exec('BEGIN IMMEDIATE');
    try{
      let previous=context.after;
      for(const row of input.rows){
        if(!isReplicatedLibraryEntry(row.table,row.key))throw Error('sqlite_snapshot_checkpoint_binding');
        if(previous&&(row.table<previous.table||row.table===previous.table&&row.key<=previous.key))throw Error('sqlite_snapshot_checkpoint_binding');previous={table:row.table,key:row.key};
        const encoded=this.storedRecord(row.table,row.key);if(encoded===null)throw Error('sqlite_snapshot_checkpoint_binding');
        const value=row.table==='meta'&&row.key==='identity'?JSON.stringify(encodeBackupValue({...this.decoded<import('./store').LibraryIdentity>('meta','identity')!,deviceId:context.binding.libraryId})):encoded;
        this.database.exec({sql:'INSERT INTO sensa_sync_base VALUES(?,?,?,?)',bind:[row.table,row.key,value,JSON.stringify(row.blocks)]});
        this.database.exec({sql:"INSERT INTO sensa_shared_record_content_owners SELECT 'sync',table_name,record_key,digest FROM sensa_shared_record_content_owners WHERE owner_kind='record' AND table_name=? AND record_key=?",bind:[row.table,row.key]});
      }
      if(input.done&&context.records+input.rows.length!==context.binding.records)throw Error('sqlite_snapshot_checkpoint_binding');
      this.database.exec('COMMIT');
    }catch(error){this.database.exec('ROLLBACK');throw error;}
    context.after=next;context.records+=input.rows.length;
    if(input.done){
      const identity=this.decoded<import('./store').LibraryIdentity>('meta','identity')!,incarnation=this.decoded<string>('meta','local-incarnation')!,at=new Date().toISOString();
      const state:CloudSyncState={owner:context.owner,incarnation,revision:context.binding.revision,checkpointVersion:7,restoreValidationVersion:libraryRestoreValidationVersion,syncedLocalRevision:1,status:'synced',lastSyncedAt:at,lastCheckedAt:at};
      this.commit({clears:[],deletes:[],puts:[{table:'meta',key:'cloud-sync',encodedValue:JSON.stringify(encodeBackupValue(state))}]});
      // Build baseline reverse relations once, in bounded decoded windows.
      // This is source indexing under the approved controlled-writer boundary.
      const admission=syncAdmission();
      for(const table of librarySyncTables){let after:string|null=null;for(;;){const page=this.recordKeysPage(table,after,64);for(const key of page){const row=this.syncBaseEntries([{table,key}])[0];if(row){const text=row.valueJson;this.syncDependencies.observe(admission,table,key,text,decodeBackupValue(JSON.parse(text)),()=>false,new TextEncoder().encode(text).length);}}if(page.length<64)break;after=page.at(-1)!;}}
      this.database.exec('BEGIN IMMEDIATE');try{this.syncDependencies.certify(admission,state,identity,this.decoded<number>('meta','local-artifact-revision')??0);this.database.exec('COMMIT');}catch(error){this.database.exec('ROLLBACK');throw error;}
      context.sealed=true;
    }
    return {done:context.sealed,records:context.records};
  }

  constructor(
    private readonly sqlite3: Sqlite3Static,
    private readonly database: Database,
    private readonly persistence: SqliteStorageDiagnostics["persistence"],
    private readonly portableBuild?: (table:SqliteLibraryTable,key:string)=>boolean,
    private readonly privateFreshRestore=false,
  ) {
    this.syncDependencies=new SqliteSyncDependencies(database);
    const field=registryFieldReader();
    this.database.createFunction({name:'sensa_expression_form',arity:2,deterministic:true,innocuous:true,xFunc:(_context,text,language)=>learningExpressionForm(text,language)});
    this.database.createFunction({name:'sensa_registry_field',arity:2,deterministic:true,innocuous:true,xFunc:(_context,encoded,key)=>field(encoded,key)});
    let previousEvent:string|null=null,eventFields:Map<string,unknown>|null=null;
    this.database.createFunction({name:'sensa_learning_event_field',arity:2,deterministic:true,innocuous:true,xFunc:(_context,encoded,key)=>{
      if(typeof encoded!=='string'||key!=='runId'&&key!=='at')throw Error('learning_event_clock_invalid');
      if(previousEvent!==encoded){const wire=JSON.parse(unpackStoredRecord(encoded));if(wire[0]!=='object'||!Array.isArray(wire[1]))throw Error('learning_event_clock_invalid');eventFields=new Map(wire[1]);previousEvent=encoded;}
      const value=decodeBackupValue(eventFields!.get(key));if(typeof value!=='string'||key==='at'&&!Number.isFinite(Date.parse(value)))throw Error('learning_event_clock_invalid');return value;
    }});
    this.meaningLookup=new SqliteMeaningLookupProjection(database,(table,key)=>this.get(table,key),()=>this.snapshotReader);
    this.worldBrowseProjection=new SqliteWorldBrowseProjection(database,(table,key)=>this.get(table,key),()=>this.snapshotReader);
    this.practiceExpressionProjection=new SqlitePracticeExpressionProjection(database,(table,key)=>this.decoded(table,key));
    this.journeyIdentities=new SqliteJourneyIdentityProjection(database,()=>this.snapshotReader);
    this.semanticMemoryProjection=new SqliteLearningSemanticMemoryProjection(database,encoded=>this.decodedStored<LocalLearningTarget>('learningTargets',encoded),id=>this.decoded<LocalLearningTarget>('learningTargets',id)??null);
    this.learningHistory=new SqliteLearningHistoryProjection(database,id=>this.historyTarget(id),encoded=>this.decodedStored<LocalLearningRun>('learningRuns',encoded));
    this.runtimeCandidates=new SqliteRuntimeLearningCandidates(database,encoded=>this.decodedStored<LocalLearningTarget>('learningTargets',encoded),encoded=>this.decodedStored<import('./curriculumEnrollments').LocalCurriculumEnrollment>('curriculumEnrollments',encoded),(id,target)=>this.writeLearningTargetProjection(id,target),encoded=>this.decodedStored<import('./studyScopes').LocalStudyScope>('studyScopes',encoded));
  }

  /** Only a newly constructed portable build may append source facts before
   * dependent caches. The caller owns the single build transaction. */
  appendPortableSnapshotFacts(puts:SqliteMutation['puts']):void{
    if(!this.portableBuild||this.closed||this.connectionFailed||this.sqlite3.capi.sqlite3_get_autocommit(this.database.pointer!))throw Error('sqlite_snapshot_build_boundary');
    for(const item of puts){
      const stored=this.storedEncoded('record',item.table,item.key,item.encodedValue,new Set(),false);
      this.database.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json) VALUES(?,?,?)',bind:[item.table,item.key,stored]});
    }
  }

  /** Copy only selected portable facts and their direct shared-body closure.
   * No owner file pages, sync owners or unreachable cache bodies enter the new
   * build. Full snapshot admission still verifies digests and exact owners. */
  copyStoredPortableFacts(source:SqliteRecordDatabase,table:SqliteLibraryTable,keys:readonly string[]):void{
    if(!this.portableBuild||this.closed||this.connectionFailed||this.sqlite3.capi.sqlite3_get_autocommit(this.database.pointer!)||source===this||source.closed||source.connectionFailed)throw Error('sqlite_snapshot_build_boundary');
    if(keys.length>64||new Set(keys).size!==keys.length||keys.some(key=>!this.portableBuild!(table,key)))throw Error('sqlite_snapshot_copy_boundary');
    if(!keys.length)return;
    const selected=JSON.stringify(keys);
    const records=source.database.exec({sql:'SELECT record_key,value_json FROM sensa_records WHERE table_name=? AND record_key IN (SELECT value FROM json_each(?)) ORDER BY record_key',bind:[table,selected],rowMode:'object',returnValue:'resultRows'}) as {record_key:string;value_json:string}[];
    if(records.length!==keys.length)throw Error('sqlite_snapshot_source_changed');
    const owners=source.database.exec({sql:"SELECT record_key,digest FROM sensa_shared_record_content_owners WHERE owner_kind='record' AND table_name=? AND record_key IN (SELECT value FROM json_each(?)) ORDER BY record_key,digest",bind:[table,selected],rowMode:'object',returnValue:'resultRows'}) as {record_key:string;digest:string}[];
    const digests=[...new Set(owners.map(row=>row.digest))];
    if(digests.length){
      const selection=JSON.stringify(digests);
      const bodies=source.database.exec({sql:'SELECT digest,value_json FROM sensa_shared_record_content WHERE digest IN (SELECT value FROM json_each(?))',bind:[selection],rowMode:'object',returnValue:'resultRows'}) as {digest:string;value_json:string}[];
      if(bodies.length!==digests.length)throw Error('sqlite_snapshot_shared_body');
      const current=new Map((this.database.exec({sql:'SELECT digest,value_json FROM sensa_shared_record_content WHERE digest IN (SELECT value FROM json_each(?))',bind:[selection],rowMode:'object',returnValue:'resultRows'}) as {digest:string;value_json:string}[]).map(row=>[row.digest,row.value_json]));
      const missing:[string,string][]=[];
      for(const row of bodies){
        const previous=current.get(row.digest);
        if(previous===undefined)missing.push([row.digest,row.value_json]);
        else if(previous!==row.value_json&&unpackStoredRecord(previous)!==unpackStoredRecord(row.value_json))throw Error('sqlite_snapshot_shared_body');
      }
        if(missing.length)this.database.exec({sql:"INSERT INTO sensa_shared_record_content SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)",bind:[JSON.stringify(missing)]});
    }
    this.database.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) SELECT ?,json_extract(value,'$.record_key'),json_extract(value,'$.value_json') FROM json_each(?)",bind:[table,JSON.stringify(records)]});
    if(owners.length)this.database.exec({sql:"INSERT INTO sensa_shared_record_content_owners(owner_kind,table_name,record_key,digest) SELECT 'record',?,json_extract(value,'$.record_key'),json_extract(value,'$.digest') FROM json_each(?)",bind:[table,JSON.stringify(owners)]});
  }

  /** Reuse the shipped projection writers in this isolated generation only.
   * Facts/bodies remain unchanged. The caller compares before/after cache data. */
  rebuildPortableProjections(reader:LibraryRecordReader,compare?:(stage:'before'|'after')=>void):void{
    if(this.closed||this.connectionFailed)throw Error('sqlite_snapshot_connection_failed');
    if(!this.sqlite3.capi.sqlite3_get_autocommit(this.database.pointer!))throw Error('sqlite_snapshot_projection_transaction');
    this.database.exec(sqliteRuntimePragmas);
    if(this.persistence==='opfs'&&(this.scalarText('PRAGMA locking_mode')!=='exclusive'||this.scalarText('PRAGMA journal_mode')!=='wal'||this.scalarNumber('PRAGMA synchronous')!==2))throw Error('sqlite_snapshot_runtime');
    this.meaningLookup.close();this.worldBrowseProjection.close();this.journeyIdentities.close();
    this.database.exec('PRAGMA foreign_keys=OFF');
    this.initialized=false;
    this.snapshotReader=reader;
    let transaction=false;
    try{
      this.database.exec('BEGIN IMMEDIATE');transaction=true;
      compare?.('before');
      const tables=this.database.exec({sql:"SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'",rowMode:'object',returnValue:'resultRows'}) as {name:string;sql:string}[];
      const derived=tables.filter(row=>!sqliteSourceDataTables.has(row.name));
      this.syncDependencies.resetSchema();
      // Removing a virtual root removes its own shadow tables too.
      for(const row of [...derived.filter(row=>row.sql.startsWith('CREATE VIRTUAL TABLE')), ...derived.filter(row=>!row.sql.startsWith('CREATE VIRTUAL TABLE'))]){
        if(!/^\w+$/u.test(row.name))throw Error('sqlite_snapshot_projection_schema');
        this.database.exec(`DROP TABLE IF EXISTS ${row.name}`);
      }
      // Connection pragmas were configured before BEGIN. Keep all trusted
      // schema/cache changes, including user_version, in this one transaction.
      this.database.exec(sqliteLibrarySchema.slice(sqliteLibrarySchema.indexOf('CREATE TABLE')));
      for(const {key,value}of reader.entries('learningTargets'))this.writeLearningTargetProjection(key,value,false);
      for(const {key,value}of reader.entries('learningRuns'))this.writeLearningRunProjection(key,value);
      for(const {key,value}of reader.entries('contentAttempts'))this.writeContentAttemptProjection(key,value);
      for(const table of ['semanticContexts','semanticInbox'] as const)for(const {key,value}of reader.entries(table))this.writeMediaReferences(table,key,value);
      this.initializeProjectionCaches();
      this.syncDependencies.ensure();
      this.database.exec('PRAGMA optimize=0x10002');
      this.verifyIntegrity();
      if(this.database.exec({sql:'PRAGMA foreign_key_check',returnValue:'resultRows'}).length)throw Error('sqlite_snapshot_projection_references');
      compare?.('after');
      this.database.exec('COMMIT');transaction=false;
      this.initialized=true;this.nextOptimizeAt=Date.now()+sqliteOptimizeIntervalMs;
    }catch(cause){
      let failure=cause;
      if(transaction)try{this.database.exec('ROLLBACK');}catch(rollbackCause){failure=sqliteRollbackFailure(cause,rollbackCause);}
      // A builder's committed facts may differ from its rolled-back old
      // caches. Never let their version stamps make this wrapper ready again.
      this.quarantineConnection(failure instanceof Error?failure:new Error('sqlite_snapshot_projection_failed',{cause:failure}));
      this.meaningLookup.close();this.worldBrowseProjection.close();this.journeyIdentities.close();
      throw failure;
    }finally{this.snapshotReader=undefined;this.database.exec('PRAGMA foreign_keys=ON');}
    // Durable commit and checkpoint remain inside the caller's projection time.
    if(this.persistence==='opfs')this.maintainWal();
    if(this.fatalStorageFailure)throw this.fatalStorageFailure;
  }

  /** Caller owns the transaction, for both ordinary initialization and a
   * complete portable-generation cache rebuild. */
  private initializeProjectionCaches():{lookupReady:number;worldReady:number}{
    this.meaningLookup.initialize();const lookupReady=performance.now();
    this.worldBrowseProjection.initialize();this.practiceExpressionProjection.initialize();const worldReady=performance.now();
    this.journeyIdentities.initialize();this.learningHistory.initialize();this.semanticMemoryProjection.initialize();this.runtimeCandidates.initialize();
    const retired=this.database.exec({sql:"SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sensa_study_scope_target_snapshots'",rowMode:0,returnValue:'resultRows'}) as unknown[];
    if(retired.length)this.database.exec('DROP TABLE sensa_study_scope_target_snapshots');
    this.purgeReplicaCandidates();return {lookupReady,worldReady};
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
    if(this.scalarNumber("SELECT count(*) FROM sqlite_schema WHERE name='sensa_private_restore_pending_v1'"))throw Error('sqlite_private_restore_incomplete');
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
      if(!this.scalarNumber("SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='sensa_package_cache_projection'")){
        this.database.exec(sqlitePackageCacheProjectionSchema);this.rebuildPackageCacheProjection();
      }
      ensureSqliteSchemaIndexes(this.database,sqliteLibrarySchema);
    }
    sourceSchemaReady=performance.now();
    this.database.exec('BEGIN IMMEDIATE');
    try{
      ({lookupReady,worldReady}=this.initializeProjectionCaches());
      this.syncDependencies.ensure();
      if(this.scalarNumber("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='sensa_record_validation_keys'"))this.database.exec('DELETE FROM sensa_record_validation_keys;DELETE FROM sensa_record_validation_scenes');
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
    if(this.snapshotReader){const value=this.snapshotReader.get(table,key);return value===undefined?null:JSON.stringify(encodeBackupValue(value));}
    const value=this.storedRecord(table,key);
    return value===null?null:this.logicalEncoded(table,value);
  }

  private storedRecord(table:SqliteLibraryTable,key:string):string|null{
    const statement=this.recordGet??=this.database.prepare('SELECT value_json FROM sensa_records WHERE table_name=? AND record_key=?');
    statement.reset(true);statement.bind([table,key]);
    let value:string|null;try{value=statement.step()?String(statement.get(0)):null;}finally{statement.reset(true);}
    return value;
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
  personalEnrollmentIndex():import('../../learning/system/learningReadModels').LearningPersonalEnrollmentIndex{return this.semanticMemoryProjection.enrollmentIndex();}
  learningSemanticMemory(targetId?:string):import('../../learning/system/learningReadModels').LearningSemanticMemoryProjection{return this.semanticMemoryProjection.read(targetId);}
  lookupMeanings(query:string):MeaningLookupResult{return this.meaningLookup.query(query);}
  contextBrowse(query:ContextBrowseQuery):ContextBrowsePage{return this.worldBrowseProjection.contexts(query);}
  worldGraph(query:import('./sqliteProtocol').WorldGraphQuery):import('./sqliteProtocol').WorldGraphRead{return this.worldBrowseProjection.graph(query);}
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

  changesSince(contentRevision: number, tables: readonly SqliteLibraryTable[],page?:import('./sqliteProtocol').SqliteChangePage): SqliteRecordChange[] {
    if (!Number.isSafeInteger(contentRevision) || contentRevision < 0 || tables.length === 0) return [];
    if(page&&(!Number.isSafeInteger(page.limit)||page.limit<1||page.limit>128))throw Error('sqlite_invalid_page_size');
    const selected = [...new Set(tables)];
    const placeholders = selected.map(() => '?').join(',');
    const rows = this.database.exec({
      sql: `SELECT * FROM(SELECT table_name,record_key,value_json,content_revision
            FROM sensa_records
            WHERE content_revision>? AND table_name IN (${placeholders})
            UNION ALL
            SELECT table_name,record_key,NULL AS value_json,content_revision
            FROM sensa_record_tombstones
            WHERE content_revision>? AND table_name IN (${placeholders})
            ) ${page?.after?'WHERE (content_revision,table_name,record_key)>(?,?,?)':''} ORDER BY content_revision,table_name,record_key ${page?'LIMIT ?':''}`,
      bind: [contentRevision, ...selected, contentRevision, ...selected,...(page?.after?[page.after.contentRevision,page.after.table,page.after.key]:[]),...(page?[page.limit]:[])],
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

  syncBaseReferences():import('./sqliteProtocol').SqliteSyncBaseReference[]{
    return (this.database.exec({sql:'SELECT table_name,record_key,block_refs_json FROM sensa_sync_base ORDER BY table_name,record_key',rowMode:'object',returnValue:'resultRows'}) as Array<Record<string,unknown>>)
      .map(row=>({table:String(row.table_name) as SqliteLibraryTable,key:String(row.record_key),blockRefs:JSON.parse(String(row.block_refs_json)) as string[]}));
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
  learningSchedulePage(query:LearningScheduleQuery):LearningSchedulePage{return this.runtimeCandidates.schedule(query);}
  learningHistoryPage(query:LearningHistoryRequest):StoredLearningHistoryPage{return this.learningHistory.page(query);}
  learningManagementSummary(query:LearningManagementSummaryQuery):LearningManagementStorageSummary{
    const summary=this.runtimeCandidates.management(query);
    if(!query.includeLibraryItems)return summary;
    const enrollments=new Map(this.entries('curriculumEnrollments').map(row=>{const enrollment=this.decode<import('./curriculumEnrollments').LocalCurriculumEnrollment>(row.encodedValue);return [enrollment.id,{title:enrollment.source.kind==='published_book'?enrollment.source.title??null:null,paused:enrollment.bookPlan?.mode==='paused'}] as const;}));
    return {...summary,items:this.semanticMemoryProjection.list(query,this.runtimeCandidates.sourceEligibility(query.languageContext.languageRouteId),enrollments)};
  }
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

  async replicaCandidate(request:ReplicaCandidateRequest,onProgress?:import('./replicaCandidateProtocol').ReplicaCandidateProgressObserver):Promise<ReplicaCandidateResponse>{
    this.assertReplicaCandidateHealthy();
    // Read available origin space before any replacement transaction. The
    // estimate is advisory; private SQL accounting and physical IO still apply.
    if(this.persistence==='opfs'&&request.kind==='beginPublication'){await requireCloudScratchSpace(true);this.assertReplicaCandidateHealthy();}
    if(['beginPublication','publicationPage','publicationIndexPage','publicationBlocks','validatePublication','admitOwnPublication','preparePublication','cancelPublicationPreparation','retirePublication','discardPublication'].includes(request.kind)){
      if(request.kind!=='discardPublication'&&this.decoded('meta','signed-out'))throw Error('account_changed');
      if(!this.initialPublication){const {SqliteInitialPublication}=await import('./sqliteInitialPublication');this.assertReplicaCandidateHealthy();this.initialPublication=new SqliteInitialPublication(this.database,f=>this.assertReplicaCandidateFence(f),(table,key)=>this.get(table,key),f=>this.assertReplicaCandidateFence({...f,localRevision:this.decoded<number>('meta','local-content-revision')??0}),async()=>{if(this.persistence==='opfs')await requireCloudScratchSpace(false);},()=>this.decoded<number>('meta','local-artifact-revision')??0);}
      switch(request.kind){
        case 'beginPublication':return {kind:'begun',id:this.initialPublication.begin(request.fence)};
        case 'publicationPage':return this.initialPublication.page(request.id,request.after);
        case 'publicationIndexPage':return this.initialPublication.indexPage(request.id,request.after);
        case 'publicationBlocks':return this.initialPublication.blocks(request.id,request.hashes);
        case 'validatePublication':return {kind:'publicationValidated',stats:await this.initialPublication.validate(request.id,request.confirmed)};
        case 'admitOwnPublication':return {kind:'publicationValidated',stats:await this.initialPublication.validate(request.id,request.confirmed,true,onProgress)};
        case 'preparePublication':await this.initialPublication.prepare(request.id,onProgress);return {kind:'publicationValidated',stats:this.initialPublication.stats(request.id,true)};
        case 'cancelPublicationPreparation':this.initialPublication.cancelPreparation(request.id);return {kind:'discarded'};
        case 'retirePublication':return {kind:'publicationRetired',done:this.initialPublication.retireConfirmed(request.id,()=>{const state=this.decoded<CloudSyncState&{publicationOperationId?:string;initialUpload?:unknown}>('meta','cloud-sync');if(state?.publicationOperationId!==request.id||state.pending||state.initialUpload)throw Error('library_sync_candidate_invalid');})};
        case 'discardPublication':this.initialPublication.discard(request.id);return {kind:'discarded'};
      }
    }
    this.replicaCandidates??=import('./sqliteReplicaCandidates').then(({SqliteReplicaCandidates})=>{
      this.assertReplicaCandidateHealthy();
      return this.replicaCandidateStore=new SqliteReplicaCandidates(this.database,fence=>this.assertReplicaCandidateFence(fence),()=>this.assertReplicaCandidateHealthy());
    });
    const candidates=await this.replicaCandidates;
    this.assertReplicaCandidateHealthy();
    if(this.persistence==='opfs'&&request.kind!=='discard'&&candidates.needsScratchSpace(request)){await requireCloudScratchSpace(request.kind==='begin'||request.kind==='beginIndex');this.assertReplicaCandidateHealthy();}
    const readBase=(table:SqliteLibraryTable,key:string)=>{const row=this.syncBaseEntries([{table,key}])[0];if(!row)throw Error('library_sync_local_changed');return row.valueJson;};
    const readRebaseBase=(table:SqliteLibraryTable,key:string)=>{const text=readBase(table,key);this.syncDependencies.verify(table,key,text);return text;};
    try{
      switch(request.kind){
        case 'beginIndex':{const id=candidates.beginIndex(request.fence,request.head,request.baseRevision,readBase,request.rebase,(table,key)=>this.get(table,key));return {kind:'begun',id,needsSeed:candidates.needsSeed(id)};}
        case 'seed':return {kind:'seeded',done:candidates.seed(request.id,readBase)};
        case 'indexPage':return {kind:'indexed',needed:candidates.indexPage(request.id,request.page,readRebaseBase)};
        case 'begin':return {kind:'begun',id:candidates.begin(request.fence,request.expected)};
        case 'append':candidates.append(request.id,request.records,request.blocks);return {kind:'appended'};
        case 'prove':candidates.prove(request.id,request.record,request.blocks);return {kind:'proved'};
        case 'validate':return {kind:'validated',candidate:await candidates.validate(request.id,onProgress)};
        case 'reuse':return {kind:'reused',keys:candidates.reuse(request.id,request.baseRevision,request.keys,readBase)};
        case 'prepareUpdate':return {kind:'updatePrepared',update:await candidates.prepareUpdate(request.id,request.baseRevision,readBase)};
        case 'prepareRebase':return {kind:'rebasePrepared',rebase:await candidates.prepareRebase(request.id,readRebaseBase,(table,key)=>this.get(table,key),onProgress)};
        case 'discard':candidates.discard(request.id);return {kind:'discarded'};
        default:throw Error('library_sync_candidate_invalid');
      }
    }catch(cause){if(isFatalSqliteConnectionFailure(cause))this.quarantineConnection(cause as Error);throw cause;}
  }

  private assertReplicaCandidateHealthy():void{
    if(this.closed||this.replicaCandidatesClosing)throw Error('sqlite_database_closed');
    if(this.fatalStorageFailure)throw this.fatalStorageFailure;
    if(this.integrityFailed)throw Error('sqlite_integrity_failed');
  }

  /** The owner Worker drains cooperative reads before releasing native handles. */
  async settleReplicaCandidates():Promise<void>{
    this.replicaCandidatesClosing=true;this.cancelPrivateRestore();await this.privateRestoreWork?.catch(()=>{});
    const candidates=await this.replicaCandidates?.catch(()=>undefined);
    await candidates?.settle();
    await this.initialPublication?.settle();
  }

  quarantineConnection(cause:Error):void{
    this.fatalStorageFailure??=cause;
    this.replicaCandidateStore?.abortAll(this.fatalStorageFailure);
  }

  private purgeReplicaCandidates():void{
    // Privacy reset also clears abandoned copies from an earlier Worker, even
    // if this connection has never loaded the candidate implementation.
    if(this.scalarNumber("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='sensa_replica_candidates_v1'"))this.database.exec('DELETE FROM sensa_replica_candidates_v1');
    if(this.scalarNumber("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='sensa_sync_admission_v1'"))this.database.exec("DELETE FROM sensa_sync_admission_v1 WHERE scope LIKE 'candidate:%'");
  }

  private assertReplicaCandidateFence(fence:ReplicaCandidateFence):void{
    this.assertReplicaCandidateHealthy();
    const owner=this.decoded<{subject:string;accountId:string}>('meta','service-owner');
    if(!owner||owner.subject!==fence.owner.subject||owner.accountId!==fence.owner.accountId||this.decoded('meta','signed-out')||(this.decoded('meta','local-incarnation')??'initial')!==fence.incarnation)throw Error('account_changed');
    if((this.decoded('meta','local-content-revision')??0)!==fence.localRevision||!backupEqual(this.decoded('meta','identity'),fence.identity))throw Error('library_sync_local_changed');
  }

  /** Stops private page work before the next native transaction. */
  cancelPrivateRestore():void{this.privateRestoreController?.abort(Error('library_sync_cancelled'));}

  /** This connection was created for an empty, unselected namespace. Partial
   * work is never an active Library: a cold open rejects the pending marker,
   * and failure/cancellation discards only this owned generation. */
  installPrivateRestore(mutation:SqliteMutation,onProgress?:import('./replicaCandidateProtocol').ReplicaCandidateProgressObserver):Promise<void>{
    if(!this.privateFreshRestore||this.privateRestoreUsed||!this.initialized||!this.replicaCandidateStore||!mutation.replicaCandidateRestore||mutation.replicaCandidateRestore.update)throw Error('sqlite_private_restore_boundary');
    this.privateRestoreUsed=true;const controller=this.privateRestoreController=new AbortController();
    const result=this.installPrivateRestoreRows(mutation,controller.signal,onProgress).finally(()=>{this.privateRestoreController=undefined;this.privateRestoreWork=undefined;});this.privateRestoreWork=result;return result;
  }
  private async installPrivateRestoreRows(mutation:SqliteMutation,signal:AbortSignal,onProgress?:import('./replicaCandidateProtocol').ReplicaCandidateProgressObserver):Promise<void>{
    const candidates=this.replicaCandidateStore!,id=mutation.replicaCandidateRestore!.id,memo=new StoredRecordMemo(),statements=new Map<string,ReturnType<Database['prepare']>>();
    let changes=this.database.changes(true),schema=this.scalarNumber('PRAGMA schema_version'),completed=0,selected=false;
    const query=<T>(sql:string,bind:readonly (string|number)[]=[]):T[]=>{let statement=statements.get(sql);if(!statement){statement=this.database.prepare(sql);statements.set(sql,statement);}statement.reset(true);if(bind.length)statement.bind([...bind]);try{const rows:T[]=[];while(statement.step())rows.push(statement.get({}) as T);return rows;}finally{statement.reset(true);}};
    const run=(sql:string,bind:readonly (string|number)[]=[])=>{query(sql,bind);return this.database.changes();};
    const alive=()=>{this.assertReplicaCandidateHealthy();signal.throwIfAborted();if(this.database.changes(true)!==changes||this.scalarNumber('PRAGMA schema_version')!==schema)throw Error('library_sync_local_changed');if(!selected)candidates.assertPrivateRestore(id);};
    const progress=(records:number)=>{if(records>0){completed+=records;onProgress?.({phase:'restore-installation',completed});}};
    const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
    const batch=<T>(work:()=>T):T=>{alive();const publish=deferReplicaWork();let result:T;
      try{this.database.exec('BEGIN IMMEDIATE');try{alive();result=work();signal.throwIfAborted();this.database.exec('COMMIT');changes=this.database.changes(true);schema=this.scalarNumber('PRAGMA schema_version');}catch(cause){try{this.database.exec('ROLLBACK');}catch(rollback){throw sqliteRollbackFailure(cause,rollback);}throw cause;}}catch(cause){publish(false);throw cause;}
      publish();if(this.database.changes(true)!==changes||this.scalarNumber('PRAGMA schema_version')!==schema)throw Error('library_sync_local_changed');return result;
    };
    this.activationMemo=memo;this.activationTargetLanguages=new Map();this.activationPreparedBodies=new Set();
    try{
      const plan=await candidates.preparePrivateRestore(id,mutation,memo,alive,progress);alive();const admission=candidates.privateRestoreAdmission(id),expectedRecords=plan.records;if(admission.disabled||admission.rows.size!==expectedRecords)throw Error('library_sync_candidate_invalid');
      // An incomplete database cannot be opened through a normal adapter even
      // after a crash; only this still-owned connection may finish it.
      batch(()=>this.database.exec('CREATE TABLE sensa_private_restore_pending_v1(id TEXT PRIMARY KEY);'));
      batch(()=>run('INSERT INTO sensa_private_restore_pending_v1 VALUES(?)',[id]));
      let after:[string,string]=['',''],records=0,identityJson:string|undefined;const priorFacts=this.scalarNumber('SELECT count(*) FROM sensa_records');
      for(;;){alive();const page=plan.page(after);if(!page.length)break;const keys=page.map(row=>[row.table,row.key] as [string,string]);
        batch(()=>{plan.copyOrdinary(keys);const removed=new Set<string>();
          for(const row of page){if(plan.copiedTables.has(row.table))continue;const source=row.source();run('INSERT INTO sensa_sync_base(table_name,record_key,value_json,block_refs_json) VALUES(?,?,?,?)',[row.table,row.key,this.storedEncoded('sync',row.table,row.key,source,removed,false),JSON.stringify(row.blockRefs)]);}
          plan.copySharedBaseline(removed,keys);
          for(const row of page){if(plan.copiedTables.has(row.table)||plan.sharedCopiedTables.has(row.table))continue;const restored=row.restored();if(row.table==='meta'&&row.key==='identity'){identityJson=restored;continue;}run('INSERT INTO sensa_records(table_name,record_key,value_json,content_revision) VALUES(?,?,?,?)',[row.table,row.key,this.storedEncoded('record',row.table,row.key,restored,removed,false),mutation.contentRevision!]);}
          if(removed.size)throw Error('sqlite_private_restore_boundary');
        });records+=page.length;after=[page.at(-1)!.table,page.at(-1)!.key];replicaWork('restore.fact',page.length);progress(page.length);await pause();
      }
      alive();if(records!==expectedRecords||this.scalarNumber('SELECT count(*) FROM sensa_sync_base')!==records||this.scalarNumber('SELECT count(*) FROM sensa_records')!==priorFacts+records-1||!identityJson)throw Error('library_sync_candidate_invalid');
      // Facts are complete before any derived reader runs. Runs are processed
      // last so their targets and fixed materials are all available.
      for(const table of ['packageCache','curriculumEnrollments','supplementalMembershipStates','studyScopes','learningTargets','contentAttempts','semanticContexts','semanticInbox','learningRuns'] as const){let afterKey:string|null=null;
        for(;;){alive();const page=this.recordKeysPage(table,afterKey,16);if(!page.length)break;
          batch(()=>{for(const key of page){const text=this.get(table,key)!;if(table==='packageCache')this.upsertPackageCacheProjection(key,text);
            else if(table==='curriculumEnrollments')this.runtimeCandidates.upsertEnrollment(key,this.decode(text));
            else if(table==='supplementalMembershipStates')this.runtimeCandidates.upsertSupplementalState(key,this.decode(text));
            else if(table==='studyScopes')this.runtimeCandidates.upsertScope(key,this.decode(text));
            else if(table==='learningTargets')this.upsertLearningTargetProjection(key,text);
            else if(table==='contentAttempts')this.upsertContentAttemptProjection(key,text);
            else if(table==='learningRuns'){const value=this.decode<LocalLearningRun>(text);this.writeLearningRunProjection(key,value);this.learningHistory.upsert(key,value);}
            else this.replaceMediaReferences(table,key,text);
          }});afterKey=page.at(-1)!;replicaWork('restore.projectionRecord',page.length);progress(page.length);await pause();
        }
      }
      // All canonical facts are now immutable until final activation. Reuse
      // one bounded component across the four projectors, and give every
      // consumer its own decoded value (including nested Dates).
      const {sealedRecordReader}=await import('./sealedRecordReader');alive();let readingProjection=false;
      const projectionAlive=()=>{this.assertReplicaCandidateHealthy();signal.throwIfAborted();if(!readingProjection)throw Error('sqlite_snapshot_projection_source');};
      const projectionReader=sealedRecordReader({alive:projectionAlive,beforePage:projectionAlive,cloneDecoded:true,
        get:(table,key)=>{const stored=this.storedRecord(table,key);return stored===null?undefined:{record_key:key,value_json:this.logicalEncoded(table,stored)};},
        has:(table,key)=>query('SELECT 1 FROM sensa_records WHERE table_name=? AND record_key=?',[table,key]).length>0,
        keys:(table,after)=>query<{record_key:string;stored_value_bytes:number}>('SELECT fact.record_key,coalesce(admission.logical_bytes,length(CAST(fact.value_json AS BLOB))) AS stored_value_bytes FROM sensa_records fact LEFT JOIN sensa_sync_admission_rows_v1 admission ON admission.scope=? AND admission.table_name=fact.table_name AND admission.record_key=fact.record_key WHERE fact.table_name=? AND fact.record_key>? ORDER BY fact.record_key LIMIT 64',[admission.scope!,table,after??'']),
        rows:(table,keys)=>keys.map(key=>{const stored=this.storedRecord(table,key);if(stored===null)throw Error('sqlite_snapshot_projection_source');return {record_key:key,value_json:this.logicalEncoded(table,stored)};}),
        plain:(_table,row)=>row.value_json,missing:()=>{throw Error('sqlite_snapshot_projection_source');},
      });
      const selectKeys=(table:string,keys:string[])=>{if(!keys.length)return keys;const metadata=new Map(query<{record_key:string;logical_bytes:number}>('SELECT record_key,logical_bytes FROM sensa_sync_admission_rows_v1 WHERE scope=? AND table_name=? AND record_key IN(SELECT value FROM json_each(?))',[admission.scope!,table,JSON.stringify(keys)]).map(row=>[row.record_key,row.logical_bytes]));const selected:string[]=[];let bytes=0;for(const key of keys){const size=metadata.get(key);if(size===undefined)throw Error('sqlite_snapshot_projection_source');if(selected.length&&bytes+size>1024*1024)break;selected.push(key);bytes+=size;}return selected;};
      const pages=[this.meaningLookup,this.worldBrowseProjection,this.practiceExpressionProjection,this.journeyIdentities].map(projection=>projection.rebuildPages(selectKeys)),done=new Set<number>();
      while(done.size<pages.length){const processed=batch(()=>{readingProjection=true;this.snapshotReader=projectionReader;const release=projectionReader.beginWindow();try{let records=0;for(const [index,page]of pages.entries()){if(done.has(index))continue;const next=page.next();if(next.done)done.add(index);else{records+=next.value;replicaWork('restore.projectionRecord',next.value);replicaWork('restore.projection.'+index,next.value);}}return records;}finally{release();this.snapshotReader=undefined;readingProjection=false;}});progress(processed);await pause();}
      let dependencyRecords=0;
      alive();const publishDependencies=deferReplicaWork();let prepared:Awaited<ReturnType<SqliteSyncDependencies['preparePublication']>>;
      try{prepared=await this.syncDependencies.preparePublication(admission.scope!,alive,records=>{progress(records-dependencyRecords);dependencyRecords=records;},()=>{changes=this.database.changes(true);});}catch(cause){publishDependencies(false);throw cause;}
      publishDependencies();alive();
      const statePut=mutation.puts.find(row=>row.table==='meta'&&row.key==='cloud-sync')!,state=this.decode<CloudSyncState>(statePut.encodedValue),identity=this.decode<import('./store').LibraryIdentity>(identityJson),artifactRevision=(this.decoded<number>('meta','local-artifact-revision')??0)+1;
      if(!Number.isSafeInteger(artifactRevision)||artifactRevision<1)throw Error('sqlite_artifact_revision_invalid');
      // No yield, full copy, projector, index rebuild, or scratch deletion in
      // this final source-fenced transaction.
      batch(()=>{for(const row of [...plan.puts,{table:'meta' as const,key:'identity',encodedValue:identityJson!},...mutation.puts,{table:'meta' as const,key:'local-artifact-revision',encodedValue:JSON.stringify(encodeBackupValue(artifactRevision))}])run('INSERT INTO sensa_records(table_name,record_key,value_json,content_revision) VALUES(?,?,?,?) ON CONFLICT(table_name,record_key) DO UPDATE SET value_json=excluded.value_json,content_revision=excluded.content_revision',[row.table,row.key,packStoredRecord(row.encodedValue),mutation.contentRevision!]);
        for(const row of mutation.deletes)run('DELETE FROM sensa_records WHERE table_name=? AND record_key=?',[row.table,row.key]);
        this.syncDependencies.certifyPreparedRestore(admission,prepared,state,identity,artifactRevision);
      });selected=true;progress(1);
      // Still unselected and pending: cleanup is separately bounded. A crash
      // here leaves the old active library selected, never a resumable stamp.
      for(;;){const done=batch(()=>candidates.retirePrivateRestore(id));progress(1);if(done)break;await pause();}
      batch(()=>run('DROP TABLE sensa_private_restore_pending_v1'));alive();
      this.integrityCheck=undefined;if(this.persistence==='opfs')this.maintainWal();if(this.fatalStorageFailure)throw this.fatalStorageFailure;
    }catch(cause){if(isFatalSqliteConnectionFailure(cause))this.quarantineConnection(cause as Error);throw cause;}
    finally{this.snapshotReader=undefined;for(const statement of statements.values())statement.finalize();memo.clear();this.activationMemo=undefined;this.activationTargetLanguages?.clear();this.activationTargetLanguages=undefined;this.activationTargetLanguageBytes=0;this.activationPreparedBodies=undefined;}
  }

  commit(mutation: SqliteMutation): void {
    if(this.privateRestoreController)throw Error('sqlite_private_restore_busy');
    if(this.closed)throw Error('sqlite_database_closed');
    if(this.fatalStorageFailure)throw this.fatalStorageFailure;
    if(this.integrityFailed)throw new Error('sqlite_integrity_failed');
    if(!this.initialized)this.initialize();
    if (
      !mutation.clears.length
      && !mutation.deletes.length
      && !mutation.puts.length
      && !mutation.portablePackages?.length
      && mutation.syncBaseReplacement === undefined
      && mutation.syncBasePatch === undefined
      && mutation.replicaCandidateRestore === undefined
      && mutation.initialPublication === undefined
    ) return;
    if (Date.now() >= this.nextOptimizeAt) {
      this.database.exec("PRAGMA optimize");
      this.nextOptimizeAt = Date.now() + sqliteOptimizeIntervalMs;
    }
    const previousCertificate=this.syncDependencies.certificate();
    const patchAdmission=mutation.syncBaseValidated&&mutation.syncBasePatch&&!mutation.replicaCandidateRestore&&previousCertificate?this.prepareDependencyPatch(mutation,previousCertificate):undefined;
    const changesBefore=this.database.changes(true);
    let encodedWriteSize=0;
    let bulkMaintenance=false;
    const removedContent=new Set<string>();
    let staged:ReturnType<import('./sqliteReplicaCandidates').SqliteReplicaCandidates['prepareFreshRestore']>|undefined;
    let preparedUpdate:ReturnType<import('./sqliteReplicaCandidates').SqliteReplicaCandidates['prepareCheckpointUpdate']>|undefined;
    const ownerKeys=new Set(['identity','service-owner','local-incarnation','signed-out']);
    let discardCandidates=mutation.clears.includes('meta')
      ||mutation.deletes.some(item=>item.table==='meta'&&ownerKeys.has(item.key))
      ||mutation.puts.some(item=>item.table==='meta'&&ownerKeys.has(item.key)&&this.get('meta',item.key)!==item.encodedValue);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if(previousCertificate&&patchAdmission)this.syncDependencies.assert(previousCertificate);
      // A dirty baseline deliberately has no complete certificate. Its receipt
      // still fences every retained row and witness, including untouched ones.
      const dirtyReceipt=this.decoded<{dirtyRebaseReceipt?:DirtyRebaseReceipt}>('meta','cloud-sync')?.dirtyRebaseReceipt;
      const stateWrite=mutation.puts.find(row=>row.table==='meta'&&row.key==='cloud-sync');
      if(dirtyReceipt&&(mutation.replicaCandidateRestore||mutation.syncBasePatch||stateWrite&&this.decode<CloudSyncState>(stateWrite.encodedValue).status==='synced'))this.syncDependencies.assertClock(dirtyReceipt.baseline);
      if(mutation.replicaCandidateRestore){this.activationMemo=new StoredRecordMemo();this.activationTargetLanguages=new Map();this.activationPreparedBodies=new Set();}
      const contentRevision = mutation.contentRevision;
      if (contentRevision !== undefined && (!Number.isSafeInteger(contentRevision) || contentRevision <= 0)) {
        throw new Error('sqlite_content_revision_invalid');
      }
      const wholeReset=sqliteLibraryTables.every(table=>mutation.clears.includes(table));
      if(wholeReset&&mutation.syncBaseReplacement===undefined)mutation={...mutation,syncBaseReplacement:[]};
      // A first checkpoint has no positive baseline witness for a local
      // deletion. Do not silently restore that key from an older Cloud copy.
      // Explicit whole-library/backup resets are a different admitted intent.
      if(!wholeReset&&mutation.syncBaseReplacement!==undefined&&mutation.puts.some(row=>row.table==='meta'&&row.key==='cloud-sync')){
        const imported=mutation.puts.filter(row=>row.table!=='operations'&&!(row.table==='meta'&&['cloud-sync','local-content-revision'].includes(row.key))).map(({table,key})=>[table,key]);
        if(imported.length&&this.database.exec({sql:`SELECT 1 FROM json_each(?) AS incoming
          JOIN sensa_record_tombstones AS deleted ON deleted.table_name=json_extract(incoming.value,'$[0]') AND deleted.record_key=json_extract(incoming.value,'$[1]')
          LEFT JOIN sensa_sync_base AS prior ON prior.table_name=deleted.table_name AND prior.record_key=deleted.record_key
          WHERE prior.record_key IS NULL LIMIT 1`,bind:[JSON.stringify(imported)],rowMode:0,returnValue:'resultRows'}).length)throw Error('library_sync_history');
      }
      if(mutation.replicaCandidateRestore){
        if(!this.replicaCandidateStore)throw Error('library_sync_candidate_invalid');
        if(mutation.replicaCandidateRestore.update){
          const update=preparedUpdate=this.replicaCandidateStore.prepareCheckpointUpdate(mutation.replicaCandidateRestore.id,mutation,this.activationMemo);
          mutation={...mutation,puts:[...update.puts,...mutation.puts],deletes:[...update.deletes,...mutation.deletes],syncBasePatch:update.syncBasePatch};
        }else{
          staged=this.replicaCandidateStore.prepareFreshRestore(mutation.replicaCandidateRestore.id,mutation,this.activationMemo);
          mutation={...mutation,puts:[...staged.puts,...mutation.puts],syncBaseReplacement:staged.syncBaseReplacement};
        }
        discardCandidates=true;
      }
      // Validate the sealed candidate before adding device-only bookkeeping.
      // This durable generation makes cache invalidation authoritative even
      // when a peer's BroadcastChannel notification has not arrived yet.
      if(mutation.replicaCandidateRestore||mutation.clears.some(table=>table==='packageCache'||table==='packageInstallations')||[...mutation.puts,...mutation.deletes].some(row=>row.table==='packageCache'||row.table==='packageInstallations'||row.table==='meta'&&row.key==='package-catalog')){
        const storedGeneration=this.get('meta','local-artifact-revision');
        const priorGeneration=storedGeneration===null?0:decodeBackupValue(JSON.parse(storedGeneration)) as number;
        if(!Number.isSafeInteger(priorGeneration)||priorGeneration<0||priorGeneration===Number.MAX_SAFE_INTEGER)throw Error('sqlite_artifact_revision_invalid');
        mutation={...mutation,puts:[...mutation.puts,{table:'meta',key:'local-artifact-revision',encodedValue:JSON.stringify(encodeBackupValue(priorGeneration+1))}]};
      }
      if (mutation.syncBaseReplacement) {
        this.syncDependencies.clear();
        for(const row of this.database.exec({sql:"SELECT DISTINCT digest FROM sensa_shared_record_content_owners WHERE owner_kind='sync'",rowMode:0,returnValue:'resultRows'}) as string[])removedContent.add(row);
        this.database.exec("DELETE FROM sensa_shared_record_content_owners WHERE owner_kind='sync'");
        this.database.exec('DELETE FROM sensa_sync_base');
        if(staged){staged.copyOrdinary();encodedWriteSize+=staged.logicalBytes;}
        for (const entry of staged?.syncBaseRows??mutation.syncBaseReplacement) {
          if(staged?.copiedTables.has(entry.table))continue;
          const blockRefsJson=JSON.stringify(entry.blockRefs),valueJson=entry.valueJson;
          encodedWriteSize+=valueJson.length+blockRefsJson.length;
          this.database.exec({
            sql: 'INSERT INTO sensa_sync_base(table_name,record_key,value_json,block_refs_json) VALUES(?,?,?,?)',
            bind: [entry.table, entry.key, this.storedEncoded('sync',entry.table,entry.key,valueJson,removedContent,false), blockRefsJson],
          });
        }
      }
      if(mutation.initialPublication){
        if(!this.initialPublication)throw Error('library_sync_candidate_invalid');
        for(const row of this.database.exec({sql:"SELECT DISTINCT digest FROM sensa_shared_record_content_owners WHERE owner_kind='sync'",rowMode:0,returnValue:'resultRows'}) as string[])removedContent.add(row);
        this.database.exec("DELETE FROM sensa_shared_record_content_owners WHERE owner_kind='sync'");
        this.initialPublication.confirm(mutation.initialPublication,mutation);
      }
      if(staged)staged.copySharedBaseline(removedContent);
      if(mutation.syncBasePatch){
        if(mutation.syncBaseReplacement!==undefined)throw new Error('sqlite_sync_base_mutation_conflict');
        for(const entry of mutation.syncBasePatch.deletes){
          this.detachSharedContent('sync',entry.table,entry.key,removedContent);
          this.database.exec({sql:'DELETE FROM sensa_sync_base WHERE table_name=? AND record_key=?',bind:[entry.table,entry.key]});
        }
        for(const entry of mutation.syncBasePatch.puts){
          const refs=JSON.stringify(entry.blockRefs),valueJson=entry.valueJson;encodedWriteSize+=valueJson.length+refs.length;
          this.database.exec({sql:'INSERT INTO sensa_sync_base(table_name,record_key,value_json,block_refs_json) VALUES(?,?,?,?) ON CONFLICT(table_name,record_key) DO UPDATE SET value_json=excluded.value_json,block_refs_json=excluded.block_refs_json',bind:[entry.table,entry.key,this.storedEncoded('sync',entry.table,entry.key,valueJson,removedContent,true,preparedUpdate?.stored('sync',entry.table,entry.key)),refs]});
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
        if (table === 'semanticContexts' || table === 'semanticInbox') {
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
        if (item.table === 'semanticContexts' || item.table === 'semanticInbox') {
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
      const sourcePuts=function*(){if(staged)yield*staged.sourceRows;yield*mutation.puts;};
      for (const item of sourcePuts()) {
        const copied=staged!==undefined&&(staged.copiedTables.has(item.table)||staged.sharedCopiedTables.has(item.table));
        // Copied validated rows already live in this transaction. Read their
        // body only for a derived projection that actually consumes it.
        const needsBody=!copied||['packageCache','curriculumEnrollments','supplementalMembershipStates','studyScopes','learningTargets','contentAttempts','semanticContexts','semanticInbox'].includes(item.table);
        const encodedValue=needsBody?item.encodedValue:undefined;
        if(!copied){
        encodedWriteSize+=encodedValue!.length;
        const stored=this.storedEncoded('record',item.table,item.key,encodedValue!,removedContent,true,preparedUpdate?.stored('record',item.table,item.key));
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
        }
        if(item.table==='packageCache')this.upsertPackageCacheProjection(item.key,encodedValue!);
        if(item.table==='curriculumEnrollments')this.runtimeCandidates.upsertEnrollment(item.key,this.decode<import('./curriculumEnrollments').LocalCurriculumEnrollment>(encodedValue!));
        if(item.table==='supplementalMembershipStates')this.runtimeCandidates.upsertSupplementalState(item.key,this.decode<import('./supplementalMemberships').SupplementalMembershipState>(encodedValue!));
        if(item.table==='studyScopes')this.runtimeCandidates.upsertScope(item.key,this.decode<import('./studyScopes').LocalStudyScope>(encodedValue!));
        if (item.table === 'learningTargets') {
          this.upsertLearningTargetProjection(item.key, encodedValue!);
        }
        if (item.table === 'contentAttempts') {
          this.upsertContentAttemptProjection(item.key, encodedValue!);
        }
        if (item.table === 'semanticContexts' || item.table === 'semanticInbox') {
          this.replaceMediaReferences(item.table, item.key, encodedValue!);
        }
      }
      // Replica mutations are ordered by record identity, not dependency:
      // fresh-device Runs can precede their Targets. Index completed history
      // only after every source row has been staged in this same transaction.
      for(const item of sourcePuts())if(item.table==='learningRuns'){
        replicaWork('activation.runDecode');const run=preparedUpdate?this.decoded<LocalLearningRun>('learningRuns',item.key)!:this.decode<LocalLearningRun>(item.encodedValue);
        this.writeLearningRunProjection(item.key,run);this.learningHistory.upsert(item.key,run);
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
      const projectionMutation=staged?{...mutation,clears:[...new Set([...mutation.clears,...staged.copiedTables,...staged.sharedCopiedTables])]}:mutation;
      this.meaningLookup.update(projectionMutation);
      this.worldBrowseProjection.update(projectionMutation);
      if(staged){this.practiceExpressionProjection.rebuild();this.journeyIdentities.rebuild();}
      else{this.practiceExpressionProjection.update(mutation);this.journeyIdentities.update(mutation);}
      // Only dependencies detached by this mutation can become orphaned. An
      // ordinary rating must not sweep all immutable bodies in the library.
      for(const digest of removedContent)this.database.exec({sql:'DELETE FROM sensa_shared_record_content WHERE digest=? AND NOT EXISTS(SELECT 1 FROM sensa_shared_record_content_owners WHERE digest=?)',bind:[digest,digest]});
      // A new explicit whole-library incarnation inherits neither the old
      // checkpoint's private bodies nor deletion journal. Both reset atomically.
      if(wholeReset)this.database.exec('DELETE FROM sensa_record_tombstones');
      // Rapid bulk growth is a maintenance point. Persist useful statistics
      // with that import instead of making the next page's reopen pay for it.
      // Count actual SQL writes, including sync baselines, normalized media
      // and derived indexes. Large individual encoded values/media also need
      // maintenance even when they occupy only a handful of logical rows.
      bulkMaintenance=this.database.changes(true)-changesBefore>256||encodedWriteSize>1024*1024||mutation.clears.length>0;
      if(bulkMaintenance)this.database.exec('PRAGMA optimize');
      const syncState=this.decoded<CloudSyncState>('meta','cloud-sync'),syncIdentity=this.decoded<import('./store').LibraryIdentity>('meta','identity');
      // Complete array restores already hold their admitted wire values. Keep
      // the same row witnesses as sparse updates, without granting a complete
      // checkpoint certificate to a mixed conflict baseline.
      const admittedBase=syncState?.checkpointVersion===7&&syncIdentity&&mutation.syncBaseValidated&&mutation.puts.some(row=>row.table==='meta'&&row.key==='cloud-sync');
      const uncertifiedBase=admittedBase&&!mutation.replicaCandidateRestore&&mutation.syncBaseReplacement
        ?{puts:mutation.syncBaseReplacement,deletes:[]}
        :(admittedBase||mutation.replicaCandidateRestore&&'kind' in (mutation.replicaCandidateRestore.update??{}))&&mutation.syncBasePatch&&(!patchAdmission||!previousCertificate||!validatedCheckpoint(syncState))?mutation.syncBasePatch:undefined;
      if(uncertifiedBase)this.syncDependencies.refreshUncertifiedPatch(uncertifiedBase,(table,key)=>this.syncBaseEntries([{table,key}])[0]?.valueJson??(()=>{throw Error('library_sync_dependency_corrupt');})());
      if(mutation.replicaCandidateRestore?.update&&'kind' in mutation.replicaCandidateRestore.update){
        const state=syncState as CloudSyncState&{dirtyRebaseReceipt?:DirtyRebaseReceipt};
        if(state.dirtyRebaseReceipt){
          const {generation,epoch}=this.syncDependencies.clock();
          this.database.exec({sql:"UPDATE sensa_records SET value_json=? WHERE table_name='meta' AND record_key='cloud-sync'",bind:[packStoredRecord(JSON.stringify(encodeBackupValue({...state,dirtyRebaseReceipt:{...state.dirtyRebaseReceipt,baseline:{generation,epoch}}})))]});
        }
      }
      if(syncState&&syncIdentity){
        const artifactRevision=this.decoded<number>('meta','local-artifact-revision')??0;
        if(mutation.initialPublication)this.initialPublication?.certify(mutation.initialPublication,syncState,syncIdentity,artifactRevision);
        else if(mutation.replicaCandidateRestore&&!('kind' in (mutation.replicaCandidateRestore.update??{})))this.replicaCandidateStore?.certifyCheckpoint(mutation.replicaCandidateRestore.id,syncState,syncIdentity,artifactRevision);
        else if(patchAdmission&&previousCertificate)this.syncDependencies.certify(patchAdmission,syncState,syncIdentity,artifactRevision,previousCertificate);
      }
      if(discardCandidates){this.purgeReplicaCandidates();
        // An uncertain committed upload is a bounded, owner-fenced recovery
        // witness. Signout/account changes cannot expose it or erase its ACK
        // recovery; an explicit whole-library reset retires that witness.
        const hasInitial=Boolean(this.database.exec({sql:"SELECT 1 FROM sqlite_schema WHERE name='sensa_initial_publication'",rowMode:0,returnValue:'resultRows'}).length);
        if(hasInitial){const pending=this.decoded<any>('meta','cloud-sync');if(wholeReset||!pending?.pending?.staging)this.database.exec('DELETE FROM sensa_initial_publication;DELETE FROM sensa_initial_publication_rows;DELETE FROM sensa_initial_publication_blocks;DELETE FROM sensa_initial_publication_content;DELETE FROM sensa_initial_publication_owners');}
      }
      this.database.exec("COMMIT");
      if(discardCandidates)this.replicaCandidateStore?.abortAll(Error('account_changed'));
      this.integrityCheck=undefined;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch (rollbackCause) {
        const failure=sqliteRollbackFailure(error,rollbackCause);
        if(isFatalSqliteConnectionFailure(failure))this.fatalStorageFailure??=failure;
        throw failure;
      }
      if(isFatalSqliteConnectionFailure(error))this.quarantineConnection(error as Error);
      throw error;
    }finally{this.activationMemo?.clear();this.activationMemo=undefined;this.activationTargetLanguages?.clear();this.activationTargetLanguages=undefined;this.activationTargetLanguageBytes=0;this.activationPreparedBodies=undefined;}
    // A completed large transaction can leave a large reusable WAL. Bound its
    // cold-reopen cost after COMMIT; failure here cannot undo/deny that commit.
    if(this.persistence==='opfs'&&bulkMaintenance)this.maintainWal();
  }

  /** Producer ACKs extend the already admitted baseline with facts accepted
   * by local domain commands. Source/global changes invalidate this cache. */
  private prepareDependencyPatch(mutation:SqliteMutation,certificate:SyncDependencyCertificate){
    const state=this.decoded<CloudSyncState>('meta','cloud-sync'),identity=this.decoded<import('./store').LibraryIdentity>('meta','identity');
    if(!state||!identity||state.revision!==certificate.revision||state.incarnation!==certificate.incarnation||!backupEqual(state.owner,certificate.owner)||identity.id!==certificate.libraryId||identity.learnerId!==certificate.learnerId||(this.decoded<number>('meta','local-artifact-revision')??0)!==certificate.artifactRevision)return;
    const patch=mutation.syncBasePatch!,admission=syncAdmission(),after=new Map(patch.puts.map(row=>[JSON.stringify([row.table,row.key]),row.valueJson]));
    const base:LibraryRecordReader={get:(table,key)=>{const row=this.syncBaseEntries([{table,key}])[0];if(!row)return undefined;this.syncDependencies.verify(table,key,row.valueJson);return decodeBackupValue(JSON.parse(row.valueJson));},has:(table,key)=>this.syncBaseEntries([{table,key}]).length>0,entries:()=>{throw Error('library_sync_delta_enumeration');}};
    const deleted=new Set(patch.deletes.map(row=>JSON.stringify([row.table,row.key])));
    const remote:LibraryRecordReader={...base,get:(table,key)=>{if(deleted.has(JSON.stringify([table,key])))return undefined;const text=after.get(JSON.stringify([table,key]));return text===undefined?base.get(table,key):decodeBackupValue(JSON.parse(text));}};
    try{const changes=[...patch.puts,...patch.deletes.map(row=>({...row,deleted:true}))];if(changes.some(row=>row.table==='semanticContexts'))validateContextDelta({changes,base,remote,alive:()=>this.syncDependencies.assert(certificate),receipts:meaningId=>this.syncDependencies.keys('meaningReceipt',meaningId,65)});else assertDeltaReceiveShape(changes,base,remote);}
    catch(cause){if(cause instanceof DeltaReceiveFallback)return;throw cause;}
    for(const row of patch.puts){const text=after.get(JSON.stringify([row.table,row.key]))!;const size=new TextEncoder().encode(packStoredRecord(text)).length+2*new TextEncoder().encode(JSON.stringify(row.blockRefs)).length+new TextEncoder().encode(row.table+row.key).length+72*row.blockRefs.length;this.syncDependencies.observe(admission,row.table,row.key,text,decodeBackupValue(JSON.parse(text)),undefined,size);}
    admission.deletes=patch.deletes;
    return admission;
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
    this.snapshotSource?.cancel();
    this.replicaCandidatesClosing=true;
    this.replicaCandidateStore?.abortAll(Error('sqlite_database_closed'));
    let optimizeFailed=false;
    let optimizeFailure:unknown;
    if(optimize&&this.initialized&&!this.connectionFailed){
      try{this.database.exec("PRAGMA optimize");}
      catch(cause){if(isFatalSqliteConnectionFailure(cause))this.quarantineConnection(cause as Error);optimizeFailed=true;optimizeFailure=cause;}
    }
    // A cancelled private restore is removed as its owned pool after close.
    // Do not turn cancellation into a whole-candidate SQL delete.
    if(this.initialized&&!this.connectionFailed&&!this.privateFreshRestore){
      try{this.purgeReplicaCandidates();}
      catch(cause){if(isFatalSqliteConnectionFailure(cause))this.quarantineConnection(cause as Error);optimizeFailed=true;optimizeFailure??=cause;}
    }
    this.initialPublication?.close();this.replicaCandidateStore?.close();this.meaningLookup.close();this.worldBrowseProjection.close();this.journeyIdentities.close();this.recordGet?.finalize();this.recordGet=undefined;
    this.syncDependencies.close();this.database.close();
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
    const plain=unpackStoredRecord(encoded,this.activationMemo);
    if(!sharedRecordTables.has(table))return plain;
    if(!plain.includes('sensa-shared-content-v1'))return plain;
    return JSON.stringify(expandSharedRecordContent(JSON.parse(plain),digest=>{
      const rows=this.database.exec({sql:'SELECT value_json FROM sensa_shared_record_content WHERE digest=?',bind:[digest],rowMode:0,returnValue:'resultRows'}) as string[];
      return rows.length?unpackStoredRecord(String(rows[0]),this.activationMemo):undefined;
    },this.activationMemo));
  }

  private detachSharedContent(kind:'record'|'sync',table:SqliteLibraryTable,key:string|undefined,removed:Set<string>):void{
    if(!sharedRecordTables.has(table))return;
    const where=key===undefined?'owner_kind=? AND table_name=?':'owner_kind=? AND table_name=? AND record_key=?',bind=key===undefined?[kind,table]:[kind,table,key];
    for(const digest of this.database.exec({sql:`SELECT digest FROM sensa_shared_record_content_owners WHERE ${where}`,bind,rowMode:0,returnValue:'resultRows'}) as string[])removed.add(digest);
    this.database.exec({sql:`DELETE FROM sensa_shared_record_content_owners WHERE ${where}`,bind});
  }

  private storedEncoded(kind:'record'|'sync',table:SqliteLibraryTable,key:string,encoded:string,removed:Set<string>,detach=true,prepared?:PreparedStoredRecord):string{
    if(prepared){
      if(detach)this.detachSharedContent(kind,table,key,removed);
      for(let offset=0;offset<prepared.bodies.length;offset+=128){
        const batch=prepared.bodies.slice(offset,offset+128),digests=batch.map(body=>body.digest);
        const unchecked=batch.filter(body=>!this.activationPreparedBodies?.has(body.digest));replicaWork('activation.bodyWitness',unchecked.length);
        const current=new Map(((unchecked.length?this.database.exec({sql:'SELECT digest,value_json FROM sensa_shared_record_content WHERE digest IN (SELECT value FROM json_each(?))',bind:[JSON.stringify(unchecked.map(body=>body.digest))],rowMode:'object',returnValue:'resultRows'}) :[] ) as {digest:string;value_json:string}[]).map(row=>[row.digest,row.value_json]));
        const missing:[string,string][]=[];
        for(const body of unchecked){const stored=current.get(body.digest)??null;if(stored!==body.existing&&!(body.existing===null&&stored===body.stored))throw Error('sqlite_shared_content_invalid');if(stored===null)missing.push([body.digest,body.stored]);}
        for(const body of unchecked)this.activationPreparedBodies?.add(body.digest);
        if(missing.length)this.database.exec({sql:"INSERT INTO sensa_shared_record_content SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)",bind:[JSON.stringify(missing)]});
        this.database.exec({sql:'INSERT INTO sensa_shared_record_content_owners(owner_kind,table_name,record_key,digest) SELECT ?,?,?,value FROM json_each(?)',bind:[kind,table,key,JSON.stringify(digests)]});
      }
      return prepared.valueJson;
    }
    if(!sharedRecordTables.has(table))return packStoredRecord(encoded);
    // Full baseline replacement has already detached every sync owner once.
    // Record writes and incremental patches must still detach their exact row.
    if(detach)this.detachSharedContent(kind,table,key,removed);
    const shared=externalizeSharedRecordContent(JSON.parse(encoded),this.activationMemo);
    if(shared.bodies.size){
      const entries=[...shared.bodies];
      for(let offset=0;offset<entries.length;offset+=128){
        const batch=entries.slice(offset,offset+128),digests=batch.map(([digest])=>digest);
        const current=new Map((this.database.exec({sql:'SELECT digest,value_json FROM sensa_shared_record_content WHERE digest IN (SELECT value FROM json_each(?))',bind:[JSON.stringify(digests)],rowMode:'object',returnValue:'resultRows'}) as {digest:string;value_json:string}[]).map(row=>[row.digest,row.value_json]));
        const missing:[string,string][]=[];
        for(const [digest,body] of batch){
          const stored=current.get(digest);
          if(stored!==undefined){if(unpackStoredRecord(stored,this.activationMemo)!==body)throw new Error('sqlite_shared_content_invalid');}
          else missing.push([digest,packStoredRecord(body)]);
        }
        if(missing.length)this.database.exec({sql:"INSERT INTO sensa_shared_record_content SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)",bind:[JSON.stringify(missing)]});
        this.database.exec({sql:'INSERT INTO sensa_shared_record_content_owners(owner_kind,table_name,record_key,digest) SELECT ?,?,?,value FROM json_each(?)',bind:[kind,table,key,JSON.stringify(digests)]});
      }
    }
    return packStoredRecord(JSON.stringify(shared.value));
  }

  private decoded<T>(table: SqliteLibraryTable, key: string): T | undefined {
    if(this.snapshotReader)return this.snapshotReader.get(table,key) as T|undefined;
    const encoded = this.get(table, key);
    return encoded === null ? undefined : this.decode<T>(encoded);
  }

  private decode<T>(encoded: string): T {
    return decodeBackupValue(JSON.parse(encoded)) as T;
  }

  private decodedStored<T>(table:SqliteLibraryTable,stored:string):T{
    if(this.snapshotReader){
      const wire=JSON.parse(unpackStoredRecord(stored));
      const key=decodeBackupValue(wire[1]?.find((pair:unknown[])=>pair[0]==='id')?.[1]);
      if(typeof key!=='string'||!this.snapshotReader.has(table,key))throw Error('sqlite_snapshot_projection_source');
      return this.snapshotReader.get(table,key) as T;
    }
    return this.decode<T>(this.logicalEncoded(table,stored));
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

  private historyTarget(id:string):Pick<LocalLearningTarget,'targetLanguageTag'>|undefined{
    const language=this.activationTargetLanguages?.get(id);if(language!==undefined)return {targetLanguageTag:language};
    if(!this.activationTargetLanguages)return this.decoded<LocalLearningTarget>('learningTargets',id);
    replicaWork('activation.targetLanguageRead');
    const rows=this.database.exec({sql:'SELECT target_language_tag FROM sensa_learning_route_targets WHERE target_key=? LIMIT 1',bind:[id],rowMode:0,returnValue:'resultRows'}) as string[];
    if(!rows.length)return this.decoded<LocalLearningTarget>('learningTargets',id);
    const target={targetLanguageTag:rows[0]!};
    const bytes=new TextEncoder().encode(id+target.targetLanguageTag).length;
    if(this.activationTargetLanguageBytes+bytes<=8*1024*1024){this.activationTargetLanguages.set(id,target.targetLanguageTag);this.activationTargetLanguageBytes+=bytes;}
    return target;
  }

  private upsertLearningTargetProjection(key: string, encodedValue: string): void {
    const target = this.decode<LocalLearningTarget>(encodedValue);
    // This row has already passed complete candidate/domain validation and is
    // being applied in this source transaction. History needs only its language,
    // not another expansion of every pinned material for each completed Run.
    // Bound scalar UTF-8 text; a miss retains the existing exact source read.
    if(this.activationTargetLanguages&&typeof target.targetLanguageTag==='string'){
      const before=this.activationTargetLanguages.get(key);
      if(before!==undefined){this.activationTargetLanguageBytes-=new TextEncoder().encode(key+before).length;this.activationTargetLanguages.delete(key);}
      const bytes=new TextEncoder().encode(key+target.targetLanguageTag).length;
      if(this.activationTargetLanguageBytes+bytes<=8*1024*1024){this.activationTargetLanguages.set(key,target.targetLanguageTag);this.activationTargetLanguageBytes+=bytes;}
    }
    this.runtimeCandidates.upsert(key,target);
    this.writeLearningTargetProjection(key,target);
  }

  private writeLearningTargetProjection(key:string,target:LocalLearningTarget,semantic=true):void{
    if(semantic)this.semanticMemoryProjection.upsert(key,target);
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

  private upsertLearningRunProjection(key: string, encodedValue: string,validatedStored=false): void {
    let run:Pick<LocalLearningRun,'completedAt'|'targetIds'>;
    if(validatedStored){
      // Fresh copy admission and shared-body writes already validated the full
      // Run. Its index uses two unshared fields of the generated storage frame;
      // the subsequent history pass still decodes all exact pinned Run content.
      const wire=JSON.parse(unpackStoredRecord(encodedValue,this.activationMemo));
      if(wire[0]!=='object'||!Array.isArray(wire[1]))throw Error('learning_run_projection_invalid');
      const fields=new Map<string,unknown>();
      for(const pair of wire[1]){if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||fields.has(pair[0]))throw Error('learning_run_projection_invalid');fields.set(pair[0],pair[1]);}
      const completedAt=decodeBackupValue(fields.get('completedAt')),targetIds=decodeBackupValue(fields.get('targetIds'));
      if(completedAt!==null&&typeof completedAt!=='string'||!Array.isArray(targetIds)||targetIds.some(id=>typeof id!=='string'))throw Error('learning_run_projection_invalid');
      run={completedAt,targetIds};
    }else run=this.decode<LocalLearningRun>(encodedValue);
    this.writeLearningRunProjection(key,run);
  }

  private writeLearningRunProjection(key:string,run:Pick<LocalLearningRun,'completedAt'|'targetIds'>):void{
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
    this.writeContentAttemptProjection(key,attempt);
  }

  private writeContentAttemptProjection(key:string,attempt:ContentAttemptProjectionSource):void{
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
    table: 'semanticContexts' | 'semanticInbox',
    key: string,
    encodedValue: string,
  ): void {
    this.writeMediaReferences(table,key,this.decode(encodedValue));
  }

  private writeMediaReferences(table:'semanticContexts'|'semanticInbox',key:string,value:any):void{
    const mediaIds = table === 'semanticContexts'
      ? contextMediaReferences(value)
      : ((value as SemanticInboxMediaSource).payload?.context?.mediaReferenceIds ?? []);
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
