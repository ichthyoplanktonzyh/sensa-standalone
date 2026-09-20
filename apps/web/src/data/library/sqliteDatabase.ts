import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";

import {decodeBackupValue,encodeBackupValue} from './backupCodec';
import {
  createHomeLearningTargetRecord,
  createHomeLearningStorageProjection,
  type HomeLearningStorageProjection,
} from './homeLearningRecords';
import type {LocalLearningRun,LocalLearningTarget} from '../../learning/runtime/localProtocol';
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

  count(table: SqliteLibraryTable): number {
    const rows = this.database.exec({
      sql: "SELECT COUNT(*) FROM sensa_records WHERE table_name=?",
      bind: [table],
      rowMode: 0,
      returnValue: "resultRows",
    }) as unknown[];
    return Number(rows[0] ?? 0);
  }

  homeLearningProjection(languageRouteId: string): HomeLearningStorageProjection {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const targetRows = this.database.exec({
      sql: `SELECT projection_value_json
            FROM sensa_learning_targets AS target
            WHERE EXISTS(
              SELECT 1 FROM sensa_learning_route_targets AS route
              WHERE route.target_key=target.record_key AND route.language_route_id=?
            ) OR (
              target.introduced_language_route_id=?
              AND target.started_at>=? AND target.started_at<?
            )
            ORDER BY record_key`,
      bind: [languageRouteId, languageRouteId, dayStart.toISOString(), dayEnd.toISOString()],
      rowMode: 0,
      returnValue: 'resultRows',
    }) as unknown[];
    const packageRows = this.database.exec({
      sql: `SELECT DISTINCT package.record_key
            FROM sensa_learning_route_targets AS route
            JOIN sensa_records AS package
              ON package.table_name='packages' AND package.record_key=route.package_key
            WHERE route.language_route_id=?
            ORDER BY package.record_key`,
      bind: [languageRouteId],
      rowMode: 0,
      returnValue: 'resultRows',
    }) as unknown[];
    const activeId = this.decoded<string>('meta', 'learning-active');
    return createHomeLearningStorageProjection({
      targets: targetRows.map((row) => this.decode<LocalLearningTarget>(String(row))),
      availablePackageKeys: packageRows.map(String),
      activeRun: activeId
        ? this.decoded<LocalLearningRun>('learningRuns', activeId) ?? null
        : null,
      studyPlans: this.decoded('settings', 'language-route-study-plans') ?? {},
      languageRouteId,
    });
  }

  commit(mutation: SqliteMutation): void {
    if (!mutation.clears.length && !mutation.deletes.length && !mutation.puts.length) return;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const table of mutation.clears) {
        this.database.exec({ sql: "DELETE FROM sensa_records WHERE table_name=?", bind: [table] });
        if (table === 'learningTargets') this.database.exec('DELETE FROM sensa_learning_targets');
      }
      for (const item of mutation.deletes) {
        this.database.exec({
          sql: "DELETE FROM sensa_records WHERE table_name=? AND record_key=?",
          bind: [item.table, item.key],
        });
        if (item.table === 'learningTargets') {
          this.database.exec({
            sql: 'DELETE FROM sensa_learning_targets WHERE record_key=?',
            bind: [item.key],
          });
        }
      }
      for (const item of mutation.puts) {
        this.database.exec({
          sql: `INSERT INTO sensa_records(table_name,record_key,value_json) VALUES(?,?,?)
                ON CONFLICT(table_name,record_key) DO UPDATE SET value_json=excluded.value_json`,
          bind: [item.table, item.key, item.encodedValue],
        });
        if (item.table === 'learningTargets') {
          this.upsertLearningTargetProjection(item.key, item.encodedValue);
        }
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

  private decoded<T>(table: SqliteLibraryTable, key: string): T | undefined {
    const encoded = this.get(table, key);
    return encoded === null ? undefined : this.decode<T>(encoded);
  }

  private decode<T>(encoded: string): T {
    return decodeBackupValue(JSON.parse(encoded)) as T;
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
      this.database.exec({
        sql: `INSERT INTO sensa_learning_route_targets(
                language_route_id,target_key,membership_id,package_key
              ) VALUES(?,?,?,?)`,
        bind: [
          membership.languageContext.languageRouteId,
          key,
          membership.id,
          membership.packageKey,
        ],
      });
    }
  }
}
