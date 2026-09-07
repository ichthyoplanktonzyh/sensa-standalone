import { previewStorage } from "../services/previewStorage";
import type { JourneyState } from "../learningJourney/journeyState";
import type { RuntimeSessionState } from "./runtimeSession";
import type { LightweightInitialOutcomeKey } from "./lightweightInitialProtocol";
import type { RuntimeLaunchForTargets } from "./runtimeSurfaces";
import type { ReviewState } from "./lightweightReviewState";

export type ResumableFlow = "lightweight" | "lightweightReview" | "study";
export interface RuntimeCheckpoint {
  structuredGeneration?: number;
  structuredMode?: "learn" | "review";
  learnQueue?: string;
  reviewQueue?: string;
  cardDraft?: { key: string; value: unknown };
  learningStorage?: Record<string, string>;
  journey?: Omit<JourneyState, "declaredMasteryRetentionTargetIds"> & {
    declaredMasteryRetentionTargetIds: string[];
  };
  session?: RuntimeSessionState;
  protocols?: Record<
    string,
    { materializationId: string; outcomes: LightweightInitialOutcomeKey[] }
  >;
  reviewGeneration?: number;
  review?: { key: string; state: ReviewState };
  retentionPlan?: readonly RuntimeLaunchForTargets[];
  pendingMixed?: string[] | null;
  pausedFlow?: ResumableFlow | null;
  lastFlow?: ResumableFlow | null;
}
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const KEY = "learning-checkpoint:v1";
const checksum = (text: string) => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
};
/** Single local record commits learner facts and the UI cursor together. */
export class RuntimeCheckpointStore {
  private loaded = false;
  private data: RuntimeCheckpoint = {};
  private revision = 0;
  private broken = false;
  private depth = 0;
  private deferred: (() => void)[] = [];
  private rollbacks: (() => void)[] = [];
  private listeners = new Set<() => void>();
  private error: string | null = null;
  constructor(private storage: Store) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getError = () => this.error;
  private report(error: string | null) {
    this.error = error;
    this.listeners.forEach((fn) => fn());
  }
  read(): RuntimeCheckpoint {
    if (this.loaded) return this.data;
    this.loaded = true;
    try {
      const raw = this.storage.getItem(KEY);
      if (raw) {
        const envelope = JSON.parse(raw);
        if (
          envelope.version !== 1 ||
          typeof envelope.payload !== "string" ||
          checksum(envelope.payload) !== envelope.checksum ||
          !Number.isInteger(envelope.revision)
        )
          throw Error("invalid");
        const data = JSON.parse(envelope.payload);
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw Error("invalid");
        this.data = data;
        this.revision = envelope.revision;
      }
    } catch {
      this.broken = true;
      this.report("checkpointUnreadable");
    }
    return this.data;
  }
  afterRollback(fn: () => void) {
    if (this.depth) this.rollbacks.push(fn);
  }
  afterCommit(fn: () => void) {
    if (this.depth) this.deferred.push(fn);
    else fn();
  }
  update(patch: Partial<RuntimeCheckpoint>) {
    if (!this.depth) {
      this.atomic(() => this.update(patch));
      return;
    }
    this.data = { ...this.data, ...patch };
  }
  atomic<T>(work: () => T): T {
    this.read();
    if (this.broken) throw Error("checkpointUnreadable");
    if (this.depth) {
      this.depth++;
      try {
        return work();
      } finally {
        this.depth--;
      }
    }
    const before = this.data;
    this.depth = 1;
    this.deferred = [];
    this.rollbacks = [];
    let result: T;
    try {
      result = work();
      const raw = this.storage.getItem(KEY);
      const revision = raw ? JSON.parse(raw).revision : 0;
      if (revision !== this.revision) throw Error("checkpointConflict");
      const payload = JSON.stringify(this.data);
      this.storage.setItem(
        KEY,
        JSON.stringify({
          version: 1,
          revision: this.revision + 1,
          payload,
          checksum: checksum(payload),
        }),
      );
      this.revision++;
      this.depth = 0;
    } catch (error) {
      this.data = before;
      this.rollbacks.reverse().forEach((fn) => fn());
      this.rollbacks = [];
      this.depth = 0;
      this.deferred = [];
      this.report(
        error instanceof Error && error.message === "checkpointConflict"
          ? "checkpointConflict"
          : "checkpointSaveError",
      );
      throw error;
    }
    this.rollbacks = [];
    const commits = this.deferred;
    this.deferred = [];
    this.report(null);
    commits.forEach((fn) => fn());
    return result;
  }
}
export const runtimeCheckpoint = new RuntimeCheckpointStore(previewStorage);
