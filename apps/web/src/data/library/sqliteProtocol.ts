import type {ContextBrowseQuery,ContextBrowsePage} from '../../experience/personalMeaningJourney/contextRead';
import type {LearningScheduleQuery,LearningSchedulePage} from '../../learning/system/learningScheduleModel';
/** Internal protocol between the local-library module and its SQLite Worker. */

import type {HomeLearningStorageProjection} from './homeLearningRecords';
import type {StoredLearningRecord} from './learningHistoryProjection';
import type {RuntimeLearningCandidateQuery} from './runtimeLearningCandidates';
import type {LearningManagementSummaryQuery} from './runtimeLearningCandidates';
import type {LearningHistoryRequest} from '../../learning/system/learningHistoryModel';
import type {ReplicaCandidateRequest} from './replicaCandidateProtocol';
export type {StoredLearningRecord} from './learningHistoryProjection';
import type {PackageCacheProjectionQuery} from './packageCacheProjection';
import {sqlitePackageCacheProjectionSchema} from './packageCacheProjection';
import {sqliteRegistrySelectionSchema} from './semanticRegistrySchema';
export type {PracticeExpressionQuery,PracticeExpressionPage} from './practiceExpressionProjection';
import type {PracticeExpressionQuery} from './practiceExpressionProjection';
import type {RegistrySelectionQuery,RegistrySelection} from './semanticRegistrySelection';
import type {MeaningLookupResult} from '../../experience/personalMeaningJourney/meaningLookup';
import type {WorldGraphQuery,WorldGraphRead,WorldBrowseQuery,WorldBrowsePage,WorldLearningChoiceQuery,WorldLearningChoicePage} from '../../experience/personalMeaningJourney/worldRead';
import type {
  PortableMediaBlob,
  PortableMediaStorageDiagnostics,
  PortablePackageMediaWrite,
} from './portableMediaCache';

export const sqliteLibraryFile = "/sensa-local-library-v12.sqlite3";
export const sqlitePoolDirectory = "/sensa-local-library-v12";
/** First supported production-user baseline; prototype formats stay unsupported. */
export const sqliteLibraryBaselineVersion = 19;
export const sqliteLibrarySchemaVersion = 19;
/** Durable physical data; every other application table is a derived cache. */
export const sqliteSourceDataTables=new Set(['sensa_records','sensa_record_tombstones','sensa_sync_base','sensa_shared_record_content','sensa_shared_record_content_owners','sensa_portable_media','sensa_portable_package_media']);
/** Cross-tab RPC changes must bump this before adding or changing messages. */
export const sqliteCoordinatorProtocolVersion = 75;

export const sqliteLibraryTables = [
  "meta",
  "drafts",
  "providers",
  "settings",
  "operations",
  "sessions",
  "meanings",
  "identities",
  "packageCache",
  "packageInstallations",
  "curriculumEnrollments",
  "supplementalMembershipStates",
  "studyScopes",
  "learningSessions",
  "learningTargets",
  "learningRuns",
  "learningEvents",
  "learningReconciliations",
  "personalLearning",
  "contentAttempts",
  "annotations",
  "semanticState",
  "semanticMeanings",
  "semanticContexts",
  "semanticRegistry",
  "semanticInbox",
  "semanticDrafts",
  "semanticReceipts",
  "media",
] as const;

export type SqliteLibraryTable = (typeof sqliteLibraryTables)[number];

export type SqliteMutation = {
  initialPublication?:string;
  /** Present only for learner-content transactions. State/probe writes do not
   * enter the incremental synchronization journal. */
  contentRevision?: number;
  clears: SqliteLibraryTable[];
  deletes: Array<{ table: SqliteLibraryTable; key: string }>;
  puts: Array<{ table: SqliteLibraryTable; key: string; encodedValue: string }>;
  /** Private, content-addressed storage writes for Portable Package media. */
  portablePackages?:PortablePackageMediaWrite[];
  /** Atomic replacement of the last server-confirmed checkpoint baseline. */
  syncBaseReplacement?: SqliteSyncBaseEntry[];
  /** Confirmed local publication: replace only the affected baseline records. */
  syncBasePatch?:{puts:SqliteSyncBaseEntry[];deletes:Array<{table:SqliteLibraryTable;key:string}>};
  /** Fresh population or a Worker-prepared update of a confirmed checkpoint.
   * Bodies stay in SQLite; COMMIT rechecks the owner, revision and private plan. */
  replicaCandidateRestore?:{id:string;tables:SqliteLibraryTable[];update?:import('./replicaCandidateProtocol').ReplicaCandidateUpdate};
};

export type SqliteRecordChange = {
  table: SqliteLibraryTable;
  key: string;
  encodedValue: string | null;
  contentRevision: number;
};

export type SqliteSyncBaseEntry = {
  table: SqliteLibraryTable;
  key: string;
  valueJson: string;
  blockRefs: string[];
};
export type SqliteSyncBaseReference=Pick<SqliteSyncBaseEntry,'table'|'key'|'blockRefs'>;

export type SqliteWorkerRequest =
  | {id:number;kind:'snapshotSource';request:import('./sqliteSnapshotSource').SnapshotSourceRequest}
  | { id: number; kind: "initialize"; namespace?:string|null;requireExisting?:boolean;privateFreshRestore?:boolean }
  | {id:number;kind:'initializeSnapshot';namespace:string;snapshot:import('./sqlitePortableSnapshot').LocalPortableSnapshot}
  | {id:number;kind:'exportLocalSnapshot';expectedRevision:number}
  | {id:number;kind:'exportOwnCloudSnapshot';fence:import('./replicaCandidateProtocol').ReplicaCandidateFence}
  | {id:number;kind:'initializeOwnCloudSnapshot';namespace:string;snapshot:import('./sqlitePortableSnapshot').LocalPortableSnapshot;binding:import('./sqlitePortableSnapshot').OwnCloudSnapshotBinding;owner:import('./replicaCandidateProtocol').ReplicaCandidateFence['owner'];reconnectDeviceId?:string}
  | {id:number;kind:'initializeNativeCloudSnapshot';namespace:string;source:File;binding:import('@sensa/contracts/sensa').LibrarySyncNativeSnapshot;owner:import('./replicaCandidateProtocol').ReplicaCandidateFence['owner'];reconnectDeviceId?:string}
  | {id:number;kind:'ownCloudBaselinePage';page:import('@sensa/contracts/sensa').LibrarySyncSnapshotPageResult}
  | {id:number;kind:'installPrivateRestore';mutation:SqliteMutation}
  | { id: number; kind: "close" }
  | { id: number; kind: "get"; table: SqliteLibraryTable; key: string }
  | { id: number; kind: "entries"; table: SqliteLibraryTable }
  | {id:number;kind:'entriesPage';table:SqliteLibraryTable;afterKey:string|null;limit:number}
  | {id:number;kind:'recordKeysPage';table:SqliteLibraryTable;afterKey:string|null;limit:number}
  | {id:number;kind:'existingRecordKeys';table:SqliteLibraryTable;keys:string[]}
  | { id:number;kind:'packageCacheProjection';query:PackageCacheProjectionQuery }
  | {id:number;kind:'meaningLookup';query:string}
  | {id:number;kind:'contextBrowse';query:ContextBrowseQuery}
  | {id:number;kind:'worldGraph';query:WorldGraphQuery}
  | {id:number;kind:'worldBrowse';query:WorldBrowseQuery}
  | {id:number;kind:'worldSceneMeaning';sceneId:string}
  | {id:number;kind:'registrySelection';query:RegistrySelectionQuery}
  | {id:number;kind:'personalEnrollmentIndex'}
  | {id:number;kind:'learningSemanticMemory';targetId?:string}
  | {id:number;kind:'worldLearningChoices';query:WorldLearningChoiceQuery}
  | {id:number;kind:'practiceExpressions';query:PracticeExpressionQuery}
  | {id:number;kind:'existingJourneyIdentities';ids:string[]}
  | { id: number; kind: "changesSince"; contentRevision: number; tables: SqliteLibraryTable[] }
  | { id:number;kind:'hasChangesSince';contentRevision:number;tables:SqliteLibraryTable[] }
  | { id: number; kind: "syncBaseEntries"; keys?: Array<{ table: SqliteLibraryTable; key: string }> }
  | {id:number;kind:'syncBaseReferences'}
  | { id: number; kind: "count"; table: SqliteLibraryTable }
  | { id: number; kind: "estimateRecordBytes"; tables: SqliteLibraryTable[] }
  | { id: number; kind: "homeLearningProjection"; languageRouteId: string;clock:number }
  | { id:number;kind:'learningHistoryPage';query:LearningHistoryRequest }
  | {id:number;kind:'learningSchedulePage';query:LearningScheduleQuery}
  | {id:number;kind:'learningManagementSummary';query:LearningManagementSummaryQuery}
  | {id:number;kind:'runtimeLearningCandidates';query:RuntimeLearningCandidateQuery}
  | {id:number;kind:'studyScopeMember';scopeRevisionId:string;targetId:string}
  | {id:number;kind:'latestLearningActionAt';runId:string}
  | { id: number; kind: "countIntroducedLearningTargets"; languageRouteId: string; startedAfter: string; startedBefore: string }
  | { id: number; kind: "learningRunIdsForTarget"; targetId: string; openOnly: boolean }
  | { id: number; kind: "openLearningRunTargets" }
  | { id: number; kind: "countContentAttemptsSince"; taskId: string; createdAfter: string }
  | { id: number; kind: "learningTargetIdsForBookUpgrade"; languageRouteId: string; targetLanguageTag: string; supportLanguageTag: string; bookId: string; nextBookVersionId: string }
  | { id: number; kind: "isMediaReferenced"; mediaId: string }
  | { id: number; kind: "portableMedia"; sha256: string }
  | { id: number; kind: "portableMediaDiagnostics" }
  | { id: number; kind: "commit"; mutation: SqliteMutation }
  | {id:number;kind:'replicaCandidate';request:ReplicaCandidateRequest;reportProgress?:boolean}
  | { id: number; kind: "diagnostics";verifyIntegrity?:boolean };

export type SqliteWorkerInput = Exclude<SqliteWorkerRequest,{id:number;kind:'close'}> extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id">
    : never
  : never;

export type SqliteWorkerResult =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

export type SqliteWorkerProgress={id:number;kind:'replicaCandidateProgress';progress:import('./replicaCandidateProtocol').ReplicaCandidateProgress};
export type SqliteWorkerResponse=SqliteWorkerResult|SqliteWorkerProgress;

export type {HomeLearningStorageProjection};
export type {MeaningLookupResult};
export type {WorldGraphQuery,WorldGraphRead,WorldBrowseQuery,WorldBrowsePage,WorldLearningChoiceQuery,WorldLearningChoicePage};

export type SqliteStorageDiagnostics = {
  integrityCheck?:Readonly<{status:'ok';checkedAt:string;durationMs:number}>;
  journeyIdentityCheck?:Readonly<{status:'ok'|'rebuilt';checkedAt:string;durationMs:number;recordsChecked:number}>;
  initializationTimingsMs?:Readonly<Record<string,number>>;
  workerStartupTimingsMs?:Readonly<Record<string,number>>;
  walMaintenance?:Readonly<{status:'ok'|'deferred'|'failed';checkedAt:string;durationMs:number;reason?:string}>;
  engine: "sqlite-wasm" | "memory-adapter";
  persistence: "opfs" | "memory";
  sqliteVersion: string;
  schemaVersion: number;
  journalMode: string;
  synchronous: number | null;
  lockingMode: string;
};

const quotedTables = sqliteLibraryTables.map((value) => `'${value}'`).join(",");

/** Body-bearing rows use a table B-tree; a clustered index B-tree can force
 * modest packed values onto sparsely used overflow pages. Keys stay unique. */
export const sqliteSyncBaseSchema=`
CREATE TABLE IF NOT EXISTS sensa_sync_base(
  table_name TEXT NOT NULL CHECK(table_name IN (${quotedTables})),
  record_key TEXT NOT NULL CHECK(length(record_key) BETWEEN 1 AND 2000),
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  block_refs_json TEXT NOT NULL CHECK(json_valid(block_refs_json)),
  PRIMARY KEY(table_name,record_key)
);`;

/** Private representation storage. Keep DDL free of compression/archive imports
 * so importing the Worker protocol does not pull them into the Home closure. */
export const sqliteSharedRecordContentSchema=`
CREATE TABLE IF NOT EXISTS sensa_shared_record_content(
 digest TEXT PRIMARY KEY NOT NULL CHECK(length(digest)=64),value_json TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_shared_record_content_owners(
 owner_kind TEXT NOT NULL CHECK(owner_kind IN ('record','sync')),table_name TEXT NOT NULL,record_key TEXT NOT NULL,digest TEXT NOT NULL,
 PRIMARY KEY(owner_kind,table_name,record_key,digest),
 FOREIGN KEY(digest) REFERENCES sensa_shared_record_content(digest) ON DELETE RESTRICT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_shared_record_content_digest ON sensa_shared_record_content_owners(digest);
`;
export const sqlitePortableMediaSchema=`
CREATE TABLE IF NOT EXISTS sensa_portable_media(
  sha256 TEXT NOT NULL PRIMARY KEY CHECK(length(sha256)=64),
  size_bytes INTEGER NOT NULL CHECK(size_bytes>0),
  bytes BLOB NOT NULL CHECK(length(bytes)=size_bytes)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_portable_package_media(
  package_key TEXT NOT NULL,
  media_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  media_kind TEXT NOT NULL CHECK(media_kind IN ('audio','image')),
  PRIMARY KEY(package_key,media_id),
  FOREIGN KEY(sha256) REFERENCES sensa_portable_media(sha256) ON DELETE RESTRICT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_portable_package_media_digest
  ON sensa_portable_package_media(sha256);
`;

/**
 * Existing callers address logical records by table/key. SQLite owns their
 * durability and atomicity while the application layer continues to own the
 * JSON fact schemas. Keeping that interface stable lets individual domains be
 * normalized behind this module without teaching every caller SQL.
 */
export const sqliteLibrarySchema = `
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
PRAGMA synchronous=FULL;
PRAGMA temp_store=MEMORY;
CREATE TABLE IF NOT EXISTS sensa_records(
  table_name TEXT NOT NULL CHECK(table_name IN (${quotedTables})),
  record_key TEXT NOT NULL CHECK(length(record_key) BETWEEN 1 AND 2000),
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  content_revision INTEGER NOT NULL DEFAULT 0 CHECK(content_revision>=0),
  PRIMARY KEY(table_name,record_key)
);
CREATE INDEX IF NOT EXISTS sensa_records_content_revision
  ON sensa_records(content_revision,table_name,record_key);
CREATE INDEX IF NOT EXISTS sensa_learning_events_clock_v1
  ON sensa_records(sensa_learning_event_field(value_json,'runId'),julianday(sensa_learning_event_field(value_json,'at')) DESC)
  WHERE table_name='learningEvents';
${sqlitePackageCacheProjectionSchema}
${sqliteRegistrySelectionSchema}
CREATE TABLE IF NOT EXISTS sensa_record_tombstones(
  table_name TEXT NOT NULL CHECK(table_name IN (${quotedTables})),
  record_key TEXT NOT NULL CHECK(length(record_key) BETWEEN 1 AND 2000),
  content_revision INTEGER NOT NULL CHECK(content_revision>0),
  PRIMARY KEY(table_name,record_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_record_tombstones_revision
  ON sensa_record_tombstones(content_revision,table_name,record_key);
${sqliteSyncBaseSchema}
CREATE TABLE IF NOT EXISTS sensa_learning_targets(
  record_key TEXT NOT NULL PRIMARY KEY,
  projection_value_json TEXT NOT NULL CHECK(json_valid(projection_value_json)),
  introduced_language_route_id TEXT,
  started_at TEXT
);
CREATE TABLE IF NOT EXISTS sensa_learning_route_targets(
  language_route_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  package_key TEXT,
  source_kind TEXT NOT NULL,
  target_language_tag TEXT NOT NULL,
  support_language_tag TEXT NOT NULL,
  book_id TEXT,
  book_version_id TEXT,
  PRIMARY KEY(language_route_id,target_key,membership_id),
  FOREIGN KEY(target_key) REFERENCES sensa_learning_targets(record_key) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_learning_route_targets_target
  ON sensa_learning_route_targets(target_key);
CREATE INDEX IF NOT EXISTS sensa_learning_route_targets_book
  ON sensa_learning_route_targets(
    language_route_id,book_id,target_language_tag,support_language_tag,book_version_id,target_key
  )
  WHERE source_kind='sense_learning_package' AND book_id IS NOT NULL AND book_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sensa_learning_targets_introduced
  ON sensa_learning_targets(introduced_language_route_id,started_at)
  WHERE introduced_language_route_id IS NOT NULL AND started_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS sensa_learning_runs(
  record_key TEXT NOT NULL PRIMARY KEY,
  completed_at TEXT
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_learning_run_targets(
  target_key TEXT NOT NULL,
  run_key TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY(target_key,run_key),
  FOREIGN KEY(run_key) REFERENCES sensa_learning_runs(record_key) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_learning_run_targets_run
  ON sensa_learning_run_targets(run_key);
CREATE INDEX IF NOT EXISTS sensa_learning_run_targets_open
  ON sensa_learning_run_targets(target_key,run_key)
  WHERE completed_at IS NULL;
CREATE TABLE IF NOT EXISTS sensa_content_attempts(
  record_key TEXT NOT NULL PRIMARY KEY,
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_content_attempts_task_created
  ON sensa_content_attempts(task_id,created_at);
CREATE TABLE IF NOT EXISTS sensa_media_references(
  media_id TEXT NOT NULL,
  owner_table TEXT NOT NULL CHECK(owner_table IN ('semanticContexts','semanticInbox')),
  owner_key TEXT NOT NULL,
  PRIMARY KEY(media_id,owner_table,owner_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_media_references_owner
  ON sensa_media_references(owner_table,owner_key);
${sqlitePortableMediaSchema}
${sqliteSharedRecordContentSchema}
PRAGMA user_version=${sqliteLibrarySchemaVersion};
`;

export type {PortableMediaBlob,PortableMediaStorageDiagnostics};
export type {RegistrySelectionQuery,RegistrySelection};
