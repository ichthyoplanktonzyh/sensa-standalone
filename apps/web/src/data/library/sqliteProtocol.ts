/** Internal protocol between the local-library module and its SQLite Worker. */

export const sqliteLibraryFile = "/sensa-local-library-v1.sqlite3";
export const sqlitePoolDirectory = "/sensa-local-library-v1";
export const sqliteLibrarySchemaVersion = 1;

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
  "semanticWorld",
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
PRAGMA user_version=${sqliteLibrarySchemaVersion};
`;
