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

  constructor(
    private readonly sqlite3: Sqlite3Static,
    private readonly database: Database,
    private readonly persistence: SqliteStorageDiagnostics["persistence"],
  ) {}

  initialize(): SqliteStorageDiagnostics {
    // SQLite Wasm has no shared-memory API. Its documented WAL contract
    // requires exclusive locking to be the first operation after open.
    const lockingMode = this.scalarText("PRAGMA locking_mode=EXCLUSIVE");
    if (this.persistence === "opfs" && lockingMode !== "exclusive") {
      throw new Error(`sqlite_locking_mode_failed:${lockingMode}`);
    }
    const before = this.scalarNumber("PRAGMA user_version");
    if (before !== 0 && before !== sqliteLibrarySchemaVersion) {
      throw new Error(`sqlite_schema_mismatch:${before}`);
    }
    this.database.exec(sqliteLibrarySchema);
    // This OPFS connection normally lives for the owning tab's lifetime. Let
    // SQLite refresh planner statistics after schema changes and on every open.
    this.database.exec("PRAGMA optimize=0x10002");
    this.nextOptimizeAt = Date.now() + sqliteOptimizeIntervalMs;
    const integrity = this.database.exec({
      sql: "PRAGMA quick_check(1)",
      rowMode: 0,
      returnValue: "resultRows",
    }) as unknown[];
    if (integrity[0] !== "ok") throw new Error("sqlite_integrity_failed");
    if (this.persistence === "opfs") {
      const journalMode = this.scalarText("PRAGMA journal_mode");
      const synchronous = this.scalarNumber("PRAGMA synchronous");
      if (journalMode !== "wal") throw new Error(`sqlite_journal_mode_failed:${journalMode}`);
      if (synchronous !== 2) throw new Error(`sqlite_synchronous_failed:${synchronous}`);
    }
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
      sql: sqliteHomeLearningTargetsQuery,
      bind: [languageRouteId, languageRouteId, dayStart.toISOString(), dayEnd.toISOString()],
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as Array<Record<string, unknown>>;
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

  commit(mutation: SqliteMutation): void {
    if (!mutation.clears.length && !mutation.deletes.length && !mutation.puts.length) return;
    if (Date.now() >= this.nextOptimizeAt) {
      this.database.exec("PRAGMA optimize");
      this.nextOptimizeAt = Date.now() + sqliteOptimizeIntervalMs;
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const table of mutation.clears) {
        this.database.exec({ sql: "DELETE FROM sensa_records WHERE table_name=?", bind: [table] });
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
      for (const item of mutation.puts) {
        this.database.exec({
          sql: `INSERT INTO sensa_records(table_name,record_key,value_json) VALUES(?,?,?)
                ON CONFLICT(table_name,record_key) DO UPDATE SET value_json=excluded.value_json`,
          bind: [item.table, item.key, item.encodedValue],
        });
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
      journalMode: this.scalarText("PRAGMA journal_mode"),
      synchronous: this.scalarNumber("PRAGMA synchronous"),
      lockingMode: this.scalarText("PRAGMA locking_mode"),
    };
  }

  close(): void {
    this.database.exec("PRAGMA optimize");
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
