import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";

import {
  sqliteLibrarySchema,
  sqliteLibrarySchemaVersion,
  type SqliteLibraryTable,
  type SqliteMutation,
  type SqliteStorageDiagnostics,
} from "./sqliteProtocol";

type StoredEntry = { key: string; encodedValue: string };

/** Internal SQLite record kernel owned by the OPFS Worker. */
export class SqliteRecordDatabase {
  constructor(
    private readonly sqlite3: Sqlite3Static,
    private readonly database: Database,
    private readonly persistence: SqliteStorageDiagnostics["persistence"],
  ) {}

  initialize(): SqliteStorageDiagnostics {
    const before = this.scalarNumber("PRAGMA user_version");
    if (before !== 0 && before !== sqliteLibrarySchemaVersion) {
      throw new Error(`sqlite_schema_mismatch:${before}`);
    }
    this.database.exec(sqliteLibrarySchema);
    const integrity = this.database.exec({
      sql: "PRAGMA quick_check(1)",
      rowMode: 0,
      returnValue: "resultRows",
    }) as unknown[];
    if (integrity[0] !== "ok") throw new Error("sqlite_integrity_failed");
    return this.diagnostics();
  }

  get(table: SqliteLibraryTable, key: string): string | null {
    const rows = this.database.exec({
      sql: "SELECT value_json FROM sensa_records WHERE table_name=? AND record_key=?",
      bind: [table, key],
      rowMode: 0,
      returnValue: "resultRows",
    }) as unknown[];
    return rows.length === 0 ? null : String(rows[0]);
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

  commit(mutation: SqliteMutation): void {
    if (!mutation.clears.length && !mutation.deletes.length && !mutation.puts.length) return;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const table of mutation.clears) {
        this.database.exec({ sql: "DELETE FROM sensa_records WHERE table_name=?", bind: [table] });
      }
      for (const item of mutation.deletes) {
        this.database.exec({
          sql: "DELETE FROM sensa_records WHERE table_name=? AND record_key=?",
          bind: [item.table, item.key],
        });
      }
      for (const item of mutation.puts) {
        this.database.exec({
          sql: `INSERT INTO sensa_records(table_name,record_key,value_json) VALUES(?,?,?)
                ON CONFLICT(table_name,record_key) DO UPDATE SET value_json=excluded.value_json`,
          bind: [item.table, item.key, item.encodedValue],
        });
      }
      this.database.exec("COMMIT");
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  }

  diagnostics(): SqliteStorageDiagnostics {
    return {
      engine: "sqlite-wasm",
      persistence: this.persistence,
      sqliteVersion: this.sqlite3.version.libVersion,
      schemaVersion: this.scalarNumber("PRAGMA user_version"),
    };
  }

  close(): void {
    this.database.close();
  }

  private scalarNumber(sql: string): number {
    const rows = this.database.exec({
      sql,
      rowMode: 0,
      returnValue: "resultRows",
    }) as unknown[];
    return Number(rows[0] ?? 0);
  }
}
