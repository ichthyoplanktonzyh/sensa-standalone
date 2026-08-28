import type {
  SensaPinnedContentManifest,
  SensaPinnedSenseLearningPackageSnapshot,
  SensaSyncAppendFact,
  SensaSyncCursorPair,
  SensaSyncLearnerDeclaredMasterySnapshot,
  SensaSyncLearnerSemanticStateSnapshot,
  SensaSyncLearningSessionSnapshot,
  SensaSyncSenseEncounterSnapshot,
  SensaSyncSenseMemoryStateSnapshot,
  SensaSyncStudyPlanSnapshot,
  SensaSyncV2BootstrapResult,
  SensaSyncV2Operation,
  SensaSyncV2OperationResult,
  SensaSyncV2PullResult,
} from "@sensa/contracts/sensa";
import {
  sensaScopeSchema,
  sensaSyncCursorsSchema,
  sensaSyncV2OperationSchema,
  sensaTimestampSchema,
} from "@sensa/contracts/sensa";
import { learningActionSchema, type LearningAction } from "@sensa/learning-kernel";
import { z } from "zod";
import type { SensaScope } from "./api";

/*
 * Everything reaching this module has already been validated at the network
 * boundary in `api.ts`. Re-validating it on the way in and again on every read
 * is what made a cold start unusable: 438 packages x 18 assets x four reads per
 * sync run is tens of thousands of deep Zod parses before the first paint.
 *
 * So the projection stores are trusted on read, and their contract is pinned by
 * `projectionEpoch` instead: change a stored shape, bump the epoch, and the
 * projection is discarded and re-bootstrapped from the server, which is the
 * authority anyway. Two stores are exceptions and are still parsed on read --
 * the outbox, because it is unsynchronized learner intent that must survive a
 * contract change as a recoverable record rather than be silently dropped, and
 * `meta.currentAction`, because a malformed Action must never reach a renderer.
 */
const databaseName = "sensa-standalone-v2";
const databaseVersion = 1;
const projectionEpoch = "sensa-web-projection-1";
const metaKey = "meta";
const packageCacheLimit = 320;
const openTimeoutMs = 8_000;

const projectionStores = [
  "studyPlans",
  "learningSessions",
  "senseEncounters",
  "semanticStates",
  "memoryStates",
  "masteries",
  "appendFacts",
] as const;
const contentStores = ["contentIndex", "contentPackages"] as const;

export type SensaLocalAction = Readonly<{
  learningActionId: string;
  encounterId: string;
  ordinal: number;
  /** Next Attempt ordinal for this immutable Action. */
  attemptOrdinal: number;
  action: LearningAction;
}>;

const preferencesSchema = z.object({
  accent: z.enum(["美式", "英式"]),
  pronunciationAutoplay: z.boolean(),
  exampleAutoplay: z.boolean(),
  translationDefault: z.boolean(),
}).strict();

export type SensaLearningPreferences = z.output<typeof preferencesSchema>;

const localActionSchema = z.object({
  learningActionId: z.string().min(1),
  encounterId: z.string().min(1),
  ordinal: z.number().int().positive(),
  attemptOrdinal: z.number().int().positive(),
  action: learningActionSchema,
}).strict();

const metaSchema = z.object({
  id: z.literal(metaKey),
  projectionEpoch: z.string().min(1),
  scope: sensaScopeSchema.nullable(),
  cursors: sensaSyncCursorsSchema.nullable(),
  bootstrapRequired: z.boolean(),
  lastSyncAt: sensaTimestampSchema.nullable(),
  currentAction: localActionSchema.nullable(),
  preferences: preferencesSchema,
}).strict();

export type SensaLocalMeta = z.output<typeof metaSchema>;

const outboxSchema = z.object({
  operationId: z.string().min(1),
  operation: sensaSyncV2OperationSchema,
  status: z.enum(["pending", "failed", "conflict", "rejected"]),
  occurredAt: sensaTimestampSchema,
  scope: sensaScopeSchema,
  error: z.object({
    code: z.string().nullable(),
    message: z.string(),
    at: sensaTimestampSchema,
  }).strict().nullable(),
}).strict();

export type SensaLocalOutbox = z.output<typeof outboxSchema>;

export type SensaUnreadableOutbox = Readonly<{
  operationId: string | null;
  reason: string;
}>;

export type SensaLocalSnapshot = Readonly<{
  meta: SensaLocalMeta;
  plans: readonly SensaSyncStudyPlanSnapshot[];
  sessions: readonly SensaSyncLearningSessionSnapshot[];
  encounters: readonly SensaSyncSenseEncounterSnapshot[];
  semanticStates: readonly SensaSyncLearnerSemanticStateSnapshot[];
  memoryStates: readonly SensaSyncSenseMemoryStateSnapshot[];
  masteries: readonly SensaSyncLearnerDeclaredMasterySnapshot[];
  appendFacts: readonly SensaSyncAppendFact[];
  outbox: readonly SensaLocalOutbox[];
  invalidOutbox: readonly SensaUnreadableOutbox[];
}>;

export type SensaCachedPackage = Readonly<{
  senseId: string;
  packageDigest: string;
  contentReleaseId: string;
  accessedAt: number;
  package: SensaPinnedSenseLearningPackageSnapshot;
}>;

export function createLocalAction(
  action: LearningAction,
  encounterId: string,
  attemptOrdinal = 1,
): SensaLocalAction {
  return {
    learningActionId: action.learningActionId,
    encounterId,
    ordinal: action.ordinal,
    attemptOrdinal,
    action,
  };
}

function defaultMeta(): SensaLocalMeta {
  return {
    id: metaKey,
    projectionEpoch,
    scope: null,
    cursors: null,
    bootstrapRequired: true,
    lastSyncAt: null,
    currentAction: null,
    preferences: {
      accent: "美式",
      pronunciationAutoplay: true,
      exampleAutoplay: false,
      translationDefault: false,
    },
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 请求失败"));
  });
}

function transactionFinished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB 事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB 事务中止"));
  });
}

function upgrade(database: IDBDatabase): void {
  database.createObjectStore("meta", { keyPath: "id" });
  database.createObjectStore("studyPlans", { keyPath: "studyPlanId" });
  database.createObjectStore("learningSessions", { keyPath: "learningSessionId" });
  database.createObjectStore("senseEncounters", { keyPath: "senseEncounterId" });
  database.createObjectStore("semanticStates", { keyPath: "learnerSemanticStateId" });
  database.createObjectStore("memoryStates", { keyPath: "senseMemoryStateId" });
  database.createObjectStore("masteries", { keyPath: "learnerDeclaredMasteryId" });
  database.createObjectStore("appendFacts", { keyPath: "factId" });
  database.createObjectStore("outbox", { keyPath: "operationId" });
  database.createObjectStore("contentIndex", { keyPath: "studyPlanId" });
  const packages = database.createObjectStore("contentPackages", { keyPath: "senseId" });
  packages.createIndex("accessedAt", "accessedAt");
}

class SensaBrowserStore {
  #database: Promise<IDBDatabase> | null = null;

  /*
   * `indexedDB.open` can stall indefinitely -- another tab holding an older
   * version, or a delete request that never completed -- and the `blocked`
   * event is not guaranteed to arrive. Without a deadline the app sits on its
   * boot screen forever with no way out, so a stalled open is reported as a
   * failure the learner can retry instead of an endless spinner.
   */
  #open(): Promise<IDBDatabase> {
    this.#database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      const deadline = setTimeout(() => {
        fail(new Error("本地学习数据库没有响应，可能有另一个 Sensa 标签页正开着。关闭其他标签页后重试。"));
      }, openTimeoutMs);
      const fail = (error: Error): void => {
        clearTimeout(deadline);
        // Drop the cached promise so a retry opens a fresh request rather than
        // replaying this rejection for the rest of the session.
        this.#database = null;
        reject(error);
      };
      request.onupgradeneeded = () => upgrade(request.result);
      request.onsuccess = () => {
        clearTimeout(deadline);
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => fail(request.error ?? new Error("无法打开本地学习数据库。"));
      request.onblocked = () => fail(new Error("另一个 Sensa 标签页正在使用本地数据库，请关闭后重试。"));
    });
    return this.#database;
  }

  async #transaction(
    names: readonly string[],
    mode: IDBTransactionMode,
  ): Promise<IDBTransaction> {
    return (await this.#open()).transaction([...names], mode);
  }

  /**
   * A single read of the whole sync projection. Callers pass the result down
   * rather than re-reading: one sync run used to open this four times.
   */
  async loadSnapshot(): Promise<SensaLocalSnapshot> {
    const transaction = await this.#transaction(["meta", ...projectionStores, "outbox"], "readonly");
    const [
      rawMeta,
      plans,
      sessions,
      encounters,
      semanticStates,
      memoryStates,
      masteries,
      appendFacts,
      rawOutbox,
    ] = await Promise.all([
      requestResult(transaction.objectStore("meta").get(metaKey)),
      requestResult(transaction.objectStore("studyPlans").getAll()),
      requestResult(transaction.objectStore("learningSessions").getAll()),
      requestResult(transaction.objectStore("senseEncounters").getAll()),
      requestResult(transaction.objectStore("semanticStates").getAll()),
      requestResult(transaction.objectStore("memoryStates").getAll()),
      requestResult(transaction.objectStore("masteries").getAll()),
      requestResult(transaction.objectStore("appendFacts").getAll()),
      requestResult(transaction.objectStore("outbox").getAll()),
    ]);

    const parsedMeta = metaSchema.safeParse(rawMeta);
    const meta = parsedMeta.success ? parsedMeta.data : defaultMeta();
    const stale = meta.projectionEpoch !== projectionEpoch;

    const outbox: SensaLocalOutbox[] = [];
    const invalidOutbox: SensaUnreadableOutbox[] = [];
    for (const record of rawOutbox as unknown[]) {
      const parsed = outboxSchema.safeParse(record);
      if (parsed.success) outbox.push(parsed.data);
      else {
        const id = record !== null && typeof record === "object" && "operationId" in record
          ? String((record as { operationId: unknown }).operationId)
          : null;
        invalidOutbox.push({ operationId: id, reason: parsed.error.issues[0]?.message ?? "未知形状" });
      }
    }

    if (stale) {
      // The projection is a cache of server truth; a contract change discards it
      // rather than migrating it. The outbox above is deliberately kept.
      await this.discardProjection();
      return {
        meta: { ...meta, projectionEpoch, cursors: null, bootstrapRequired: true, currentAction: null },
        plans: [],
        sessions: [],
        encounters: [],
        semanticStates: [],
        memoryStates: [],
        masteries: [],
        appendFacts: [],
        outbox,
        invalidOutbox,
      };
    }

    return {
      meta,
      plans: plans as SensaSyncStudyPlanSnapshot[],
      sessions: sessions as SensaSyncLearningSessionSnapshot[],
      encounters: encounters as SensaSyncSenseEncounterSnapshot[],
      semanticStates: semanticStates as SensaSyncLearnerSemanticStateSnapshot[],
      memoryStates: memoryStates as SensaSyncSenseMemoryStateSnapshot[],
      masteries: masteries as SensaSyncLearnerDeclaredMasterySnapshot[],
      appendFacts: appendFacts as SensaSyncAppendFact[],
      outbox,
      invalidOutbox,
    };
  }

  async #readMeta(transaction: IDBTransaction): Promise<SensaLocalMeta> {
    const raw = await requestResult(transaction.objectStore("meta").get(metaKey));
    const parsed = metaSchema.safeParse(raw);
    return parsed.success ? parsed.data : defaultMeta();
  }

  async #patchMeta(patch: Partial<Omit<SensaLocalMeta, "id">>): Promise<SensaLocalMeta> {
    const transaction = await this.#transaction(["meta"], "readwrite");
    const current = await this.#readMeta(transaction);
    const next: SensaLocalMeta = { ...current, ...patch, id: metaKey, projectionEpoch };
    transaction.objectStore("meta").put(metaSchema.parse(next));
    await transactionFinished(transaction);
    return next;
  }

  async discardProjection(): Promise<void> {
    const transaction = await this.#transaction(["meta", ...projectionStores], "readwrite");
    const current = await this.#readMeta(transaction);
    for (const name of projectionStores) transaction.objectStore(name).clear();
    transaction.objectStore("meta").put(metaSchema.parse({
      ...current,
      id: metaKey,
      projectionEpoch,
      cursors: null,
      bootstrapRequired: true,
      currentAction: null,
    }));
    await transactionFinished(transaction);
  }

  /** Wipes everything, including unsynchronized intent. Learner-initiated only. */
  async reset(): Promise<void> {
    const names = ["meta", ...projectionStores, "outbox", ...contentStores];
    const transaction = await this.#transaction(names, "readwrite");
    for (const name of names) transaction.objectStore(name).clear();
    transaction.objectStore("meta").put(defaultMeta());
    await transactionFinished(transaction);
  }

  async savePreferences(preferences: SensaLearningPreferences): Promise<SensaLocalMeta> {
    return this.#patchMeta({ preferences: preferencesSchema.parse(preferences) });
  }

  async setCurrentAction(action: SensaLocalAction | null): Promise<void> {
    await this.#patchMeta({ currentAction: action === null ? null : localActionSchema.parse(action) });
  }

  async applyBootstrap(scope: SensaScope, result: SensaSyncV2BootstrapResult): Promise<void> {
    const names = ["meta", ...projectionStores];
    const transaction = await this.#transaction(names, "readwrite");
    const current = await this.#readMeta(transaction);
    for (const name of projectionStores) transaction.objectStore(name).clear();
    const snapshot = result.snapshot;
    for (const plan of snapshot.studyPlans) transaction.objectStore("studyPlans").put(plan);
    for (const session of snapshot.learningSessions) transaction.objectStore("learningSessions").put(session);
    for (const encounter of snapshot.senseEncounters) transaction.objectStore("senseEncounters").put(encounter);
    for (const state of snapshot.semanticStates) transaction.objectStore("semanticStates").put(state);
    for (const state of snapshot.memoryStates) transaction.objectStore("memoryStates").put(state);
    for (const mastery of snapshot.learnerDeclaredMasteries) transaction.objectStore("masteries").put(mastery);
    transaction.objectStore("meta").put(metaSchema.parse({
      ...current,
      id: metaKey,
      projectionEpoch,
      scope,
      cursors: snapshot.cursors,
      bootstrapRequired: result.bootstrapRequired,
      lastSyncAt: new Date().toISOString(),
      // A bootstrap replaces the projection wholesale, so any Action held from
      // before it is no longer known to belong to a live Encounter.
      currentAction: null,
    }));
    await transactionFinished(transaction);
  }

  async applyPull(result: Extract<SensaSyncV2PullResult, { bootstrapRequired: false }>): Promise<void> {
    const names = ["meta", ...projectionStores];
    const transaction = await this.#transaction(names, "readwrite");
    const current = await this.#readMeta(transaction);
    for (const change of result.mutableChanges) {
      const store = mutableStoreName(change.entityType);
      if (change.action === "tombstone") transaction.objectStore(store).delete(change.entityId);
      else transaction.objectStore(store).put(change.snapshot);
    }
    for (const fact of result.appendFacts) transaction.objectStore("appendFacts").put(fact);
    transaction.objectStore("meta").put(metaSchema.parse({
      ...current,
      id: metaKey,
      projectionEpoch,
      cursors: result.nextCursors,
      bootstrapRequired: false,
      lastSyncAt: new Date().toISOString(),
    }));
    await transactionFinished(transaction);
  }

  /**
   * Applies one push response. The next Action for an Encounter arrives inside
   * the accepted Attempt's result, so this is also where the Action a renderer
   * is allowed to show is set -- and cleared, when the server says there is
   * none left and the Encounter is about to close.
   */
  async applyPushResult(input: Readonly<{
    cursors: SensaSyncCursorPair;
    results: readonly SensaSyncV2OperationResult[];
  }>): Promise<void> {
    const names = ["meta", ...projectionStores, "outbox"];
    const transaction = await this.#transaction(names, "readwrite");
    const current = await this.#readMeta(transaction);
    let currentAction: SensaLocalAction | null = current.currentAction;

    for (const result of input.results) {
      const payload = result.payload;
      if (result.acknowledged) {
        switch (payload.kind) {
          case "study_plan":
            transaction.objectStore("studyPlans").put(payload.snapshot);
            break;
          case "learning_session":
            transaction.objectStore("learningSessions").put(payload.snapshot);
            break;
          case "sense_encounter":
            transaction.objectStore("senseEncounters").put(payload.snapshot);
            if (payload.memoryState !== null) transaction.objectStore("memoryStates").put(payload.memoryState);
            if (currentAction?.encounterId === payload.snapshot.senseEncounterId
              && payload.snapshot.status !== "active") currentAction = null;
            break;
          case "learning_attempt": {
            const fact = payload.fact;
            transaction.objectStore("appendFacts").put({
              factSequence: result.factCursor ?? fact.learningAttemptId,
              factType: "learning_attempt",
              factId: fact.learningAttemptId,
              occurredAt: fact.occurredAt,
              fact,
            });
            currentAction = payload.nextAction === null
              ? null
              : createLocalAction(payload.nextAction, fact.senseEncounterId);
            break;
          }
          case "learner_declared_mastery":
            transaction.objectStore("masteries").put(payload.snapshot);
            if (payload.encounter !== null) {
              transaction.objectStore("senseEncounters").put(payload.encounter);
              if (currentAction?.encounterId === payload.encounter.senseEncounterId) currentAction = null;
            }
            break;
          case "none":
            break;
        }
        transaction.objectStore("outbox").delete(result.operationId);
        continue;
      }
      // A conflict or rejection stays in the outbox: it is immutable learner
      // intent, and hiding it would lose a real response.
      const raw = await requestResult(transaction.objectStore("outbox").get(result.operationId));
      const parsed = outboxSchema.safeParse(raw);
      if (!parsed.success) continue;
      transaction.objectStore("outbox").put({
        ...parsed.data,
        status: result.status === "conflict" ? "conflict" : "rejected",
        error: {
          code: result.errorCode,
          message: result.status === "conflict"
            ? "服务端已有更新的状态，需要先同步。"
            : "这条记录被服务端拒绝。",
          at: new Date().toISOString(),
        },
      });
    }

    transaction.objectStore("meta").put(metaSchema.parse({
      ...current,
      id: metaKey,
      projectionEpoch,
      cursors: input.cursors,
      lastSyncAt: new Date().toISOString(),
      currentAction,
    }));
    await transactionFinished(transaction);
  }

  async addOutbox(record: SensaLocalOutbox): Promise<void> {
    const transaction = await this.#transaction(["outbox"], "readwrite");
    transaction.objectStore("outbox").put(outboxSchema.parse(record));
    await transactionFinished(transaction);
  }

  async markOutboxFailed(
    operationIds: readonly string[],
    error: Readonly<{ code: string | null; message: string }>,
  ): Promise<void> {
    if (operationIds.length === 0) return;
    const transaction = await this.#transaction(["outbox"], "readwrite");
    const store = transaction.objectStore("outbox");
    const at = new Date().toISOString();
    for (const operationId of operationIds) {
      const parsed = outboxSchema.safeParse(await requestResult(store.get(operationId)));
      if (!parsed.success) continue;
      store.put({ ...parsed.data, status: "failed", error: { ...error, at } });
    }
    await transactionFinished(transaction);
  }

  /** Returns a blocked intent to the queue so the next sync run retries it. */
  async retryOutbox(operationId: string): Promise<void> {
    const transaction = await this.#transaction(["outbox"], "readwrite");
    const store = transaction.objectStore("outbox");
    const parsed = outboxSchema.safeParse(await requestResult(store.get(operationId)));
    if (parsed.success) store.put({ ...parsed.data, status: "pending", error: null });
    await transactionFinished(transaction);
  }

  async discardOutbox(operationId: string): Promise<void> {
    const transaction = await this.#transaction(["outbox"], "readwrite");
    transaction.objectStore("outbox").delete(operationId);
    await transactionFinished(transaction);
  }

  async readContentIndex(studyPlanId: string): Promise<SensaPinnedContentManifest | null> {
    const transaction = await this.#transaction(["contentIndex"], "readonly");
    const raw = await requestResult(transaction.objectStore("contentIndex").get(studyPlanId));
    return raw === undefined ? null : (raw as { manifest: SensaPinnedContentManifest }).manifest;
  }

  async writeContentIndex(studyPlanId: string, manifest: SensaPinnedContentManifest): Promise<void> {
    const transaction = await this.#transaction(["contentIndex"], "readwrite");
    transaction.objectStore("contentIndex").put({ studyPlanId, manifest, fetchedAt: Date.now() });
    await transactionFinished(transaction);
  }

  async readPackage(senseId: string): Promise<SensaCachedPackage | null> {
    const transaction = await this.#transaction(["contentPackages"], "readonly");
    const raw = await requestResult(transaction.objectStore("contentPackages").get(senseId));
    return raw === undefined ? null : (raw as SensaCachedPackage);
  }

  /**
   * On-demand packages accumulate as the learner moves through a Book, so the
   * cache is bounded and evicts by last use rather than growing to the whole
   * Book Version.
   */
  async writePackage(
    senseId: string,
    snapshot: SensaPinnedSenseLearningPackageSnapshot,
  ): Promise<void> {
    const transaction = await this.#transaction(["contentPackages"], "readwrite");
    const store = transaction.objectStore("contentPackages");
    store.put({
      senseId,
      packageDigest: snapshot.packageDigest,
      contentReleaseId: snapshot.contentRelease.contentReleaseId,
      accessedAt: Date.now(),
      package: snapshot,
    } satisfies SensaCachedPackage);
    const total = await requestResult(store.count());
    if (total > packageCacheLimit) {
      let remaining = total - packageCacheLimit;
      await new Promise<void>((resolve, reject) => {
        const request = store.index("accessedAt").openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor === null || remaining <= 0) return resolve();
          if (cursor.primaryKey !== senseId) {
            cursor.delete();
            remaining -= 1;
          }
          cursor.continue();
        };
        request.onerror = () => reject(request.error ?? new Error("清理内容缓存失败"));
      });
    }
    await transactionFinished(transaction);
  }

  async touchPackage(senseId: string): Promise<void> {
    const transaction = await this.#transaction(["contentPackages"], "readwrite");
    const store = transaction.objectStore("contentPackages");
    const raw = await requestResult(store.get(senseId));
    if (raw !== undefined) store.put({ ...(raw as SensaCachedPackage), accessedAt: Date.now() });
    await transactionFinished(transaction);
  }
}

function mutableStoreName(entityType: string): string {
  switch (entityType) {
    case "study_plan": return "studyPlans";
    case "learning_session": return "learningSessions";
    case "sense_encounter": return "senseEncounters";
    case "learner_semantic_state": return "semanticStates";
    case "sense_memory_state": return "memoryStates";
    case "learner_declared_mastery": return "masteries";
    default: throw new Error(`未知的同步实体类型：${entityType}`);
  }
}

export function outboxRecord(
  scope: SensaScope,
  operation: SensaSyncV2Operation,
): SensaLocalOutbox {
  return outboxSchema.parse({
    operationId: operation.operationId,
    operation,
    status: "pending",
    occurredAt: operation.occurredAt,
    scope,
    error: null,
  });
}

export const sensaStore = new SensaBrowserStore();
