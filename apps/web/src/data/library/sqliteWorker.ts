/// <reference lib="webworker" />

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import sqliteWasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";

import { SqliteRecordDatabase } from "./sqliteDatabase";
import {
  sqliteLibraryFile,
  sqlitePoolDirectory,
  type SqliteWorkerRequest,
  type SqliteWorkerResult,
} from "./sqliteProtocol";

const worker = self as unknown as DedicatedWorkerGlobalScope;
let store: Promise<SqliteRecordDatabase> | undefined;

async function database(): Promise<SqliteRecordDatabase> {
  if (!store) {
    store = (async () => {
      const initialize = sqlite3InitModule as unknown as (options?: {
        locateFile?: (path: string) => string;
      }) => ReturnType<typeof sqlite3InitModule>;
      const sqlite3 = await initialize({
        locateFile: (path) => path.endsWith(".wasm") ? sqliteWasmUrl : path,
      });
      const pool = await sqlite3.installOpfsSAHPoolVfs({
        directory: sqlitePoolDirectory,
        initialCapacity: 6,
      });
      const db = new pool.OpfsSAHPoolDb(sqliteLibraryFile);
      return new SqliteRecordDatabase(sqlite3, db, "opfs");
    })();
    store.catch(() => { store = undefined; });
  }
  return store;
}

const message = async (request: SqliteWorkerRequest): Promise<unknown> => {
  const db = await database();
  switch (request.kind) {
    case "initialize": return db.initialize();
    case "get": return db.get(request.table, request.key);
    case "entries": return db.entries(request.table);
    case "changesSince": return db.changesSince(request.contentRevision, request.tables);
    case "syncBaseEntries": return db.syncBaseEntries(request.keys);
    case "count": return db.count(request.table);
    case "homeLearningProjection": return db.homeLearningProjection(request.languageRouteId);
    case "countIntroducedLearningTargets": return db.countIntroducedLearningTargets(
      request.languageRouteId,
      request.startedAfter,
      request.startedBefore,
    );
    case "learningRunIdsForTarget": return db.learningRunIdsForTarget(request.targetId, request.openOnly);
    case "openLearningRunTargets": return db.openLearningRunTargets();
    case "countContentAttemptsSince": return db.countContentAttemptsSince(request.taskId, request.createdAfter);
    case "learningTargetIdsForBookUpgrade": return db.learningTargetIdsForBookUpgrade(
      request.languageRouteId,
      request.targetLanguageTag,
      request.supportLanguageTag,
      request.bookId,
      request.nextBookVersionId,
    );
    case "isMediaReferenced": return db.isMediaReferenced(request.mediaId);
    case "portableMedia": return db.portableMedia(request.sha256);
    case "portableMediaDiagnostics": return db.portableMediaDiagnostics();
    case "commit": db.commit(request.mutation); return null;
    case "diagnostics": return db.diagnostics();
  }
};

worker.addEventListener("message", (event: MessageEvent<SqliteWorkerRequest>) => {
  void message(event.data).then(
    (value) => worker.postMessage({ id: event.data.id, ok: true, value } satisfies SqliteWorkerResult),
    (cause) => worker.postMessage({
      id: event.data.id,
      ok: false,
      error: cause instanceof Error ? cause.message : "sqlite_worker_failed",
    } satisfies SqliteWorkerResult),
  );
});
