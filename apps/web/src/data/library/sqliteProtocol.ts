/** Internal protocol between the local-library module and its SQLite Worker. */

import type {HomeLearningStorageProjection} from './homeLearningRecords';

export const sqliteLibraryFile = "/sensa-local-library-v3.sqlite3";
export const sqlitePoolDirectory = "/sensa-local-library-v3";
export const sqliteLibrarySchemaVersion = 3;

export const sqliteLibraryTables = [
  "meta",
  "drafts",
  "providers",
  "settings",
  "operations",
  "sessions",
  "meanings",
  "identities",
  "packages",
  "learningTargets",
  "learningRuns",
  "learningEvents",
  "personalLearning",
  "contentAttempts",
  "annotations",
  "semanticState",
  "semanticMeanings",
  "semanticRegistry",
  "semanticInbox",
  "semanticDrafts",
  "semanticReceipts",
  "media",
] as const;

export type SqliteLibraryTable = (typeof sqliteLibraryTables)[number];

export type SqliteMutation = {
  clears: SqliteLibraryTable[];
  deletes: Array<{ table: SqliteLibraryTable; key: string }>;
  puts: Array<{ table: SqliteLibraryTable; key: string; encodedValue: string }>;
};

export type SqliteWorkerRequest =
  | { id: number; kind: "initialize" }
  | { id: number; kind: "get"; table: SqliteLibraryTable; key: string }
  | { id: number; kind: "entries"; table: SqliteLibraryTable }
  | { id: number; kind: "count"; table: SqliteLibraryTable }
  | { id: number; kind: "homeLearningProjection"; languageRouteId: string }
  | { id: number; kind: "commit"; mutation: SqliteMutation }
  | { id: number; kind: "diagnostics" };

export type SqliteWorkerInput = SqliteWorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id">
    : never
  : never;

export type SqliteWorkerResult =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

export type {HomeLearningStorageProjection};

export type SqliteStorageDiagnostics = {
  engine: "sqlite-wasm" | "memory-adapter";
  persistence: "opfs" | "memory";
  sqliteVersion: string;
  schemaVersion: number;
};

const quotedTables = sqliteLibraryTables.map((value) => `'${value}'`).join(",");

/**
 * Existing callers address logical records by table/key. SQLite owns their
 * durability and atomicity while the application layer continues to own the
 * JSON fact schemas. Keeping that interface stable lets individual domains be
 * normalized behind this module without teaching every caller SQL.
 */
export const sqliteLibrarySchema = `
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=DELETE;
PRAGMA synchronous=FULL;
PRAGMA temp_store=MEMORY;
CREATE TABLE IF NOT EXISTS sensa_records(
  table_name TEXT NOT NULL CHECK(table_name IN (${quotedTables})),
  record_key TEXT NOT NULL CHECK(length(record_key) BETWEEN 1 AND 2000),
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  PRIMARY KEY(table_name,record_key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_learning_targets(
  record_key TEXT NOT NULL PRIMARY KEY,
  projection_value_json TEXT NOT NULL CHECK(json_valid(projection_value_json)),
  introduced_language_route_id TEXT,
  started_at TEXT
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_learning_route_targets(
  language_route_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  package_key TEXT,
  PRIMARY KEY(language_route_id,target_key,membership_id),
  FOREIGN KEY(target_key) REFERENCES sensa_learning_targets(record_key) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_learning_route_targets_target
  ON sensa_learning_route_targets(target_key);
CREATE INDEX IF NOT EXISTS sensa_learning_targets_introduced
  ON sensa_learning_targets(introduced_language_route_id,started_at)
  WHERE introduced_language_route_id IS NOT NULL AND started_at IS NOT NULL;
PRAGMA user_version=${sqliteLibrarySchemaVersion};
`;
