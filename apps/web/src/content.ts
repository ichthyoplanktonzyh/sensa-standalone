import type {
  SensaPinnedContentManifest,
  SensaPinnedSenseLearningPackageSnapshot,
} from "@sensa/contracts/sensa";
import { sensaApi, type SensaScope } from "./api";
import { sensaStore } from "./store";

export type SensaContentMember = SensaPinnedContentManifest["members"][number];

/**
 * Content is fetched on demand, one Sense at a time.
 *
 * The manifest is the only eager call: it is the whole membership with no
 * assets (~200KB for a 438-member Book), so it can back the Book list, "my
 * content" and search entirely from memory. A package is ~29KB and is pulled
 * only when a Sense is about to be taught or opened, which is what replaced the
 * old cold start that walked every ordinal page before showing anything.
 *
 * A cached package is trusted only while its digest still matches the member
 * digest in the current manifest. That is the same equality the server enforces
 * between the immutable member and the built package, so a re-pinned Book
 * invalidates exactly the entries whose content actually changed.
 */
class SensaContentLibrary {
  #manifests = new Map<string, SensaPinnedContentManifest>();
  #packages = new Map<string, SensaPinnedSenseLearningPackageSnapshot>();
  #inflight = new Map<string, Promise<SensaPinnedSenseLearningPackageSnapshot>>();

  async manifest(
    scope: SensaScope,
    studyPlanId: string,
    options: Readonly<{ refresh?: boolean }> = {},
  ): Promise<SensaPinnedContentManifest> {
    const cached = this.#manifests.get(studyPlanId);
    if (cached !== undefined && options.refresh !== true) return cached;
    if (options.refresh !== true) {
      const stored = await sensaStore.readContentIndex(studyPlanId);
      if (stored !== null) {
        this.#manifests.set(studyPlanId, stored);
        // Refresh behind the learner: a stale index costs a label, never a fact.
        void this.#refreshManifest(scope, studyPlanId);
        return stored;
      }
    }
    return this.#refreshManifest(scope, studyPlanId);
  }

  async #refreshManifest(
    scope: SensaScope,
    studyPlanId: string,
  ): Promise<SensaPinnedContentManifest> {
    const fetched = await sensaApi.contentManifest(scope, studyPlanId);
    this.#manifests.set(studyPlanId, fetched);
    await sensaStore.writeContentIndex(studyPlanId, fetched);
    return fetched;
  }

  /** The manifest already in hand, if any. Never performs a request. */
  cachedManifest(studyPlanId: string): SensaPinnedContentManifest | null {
    return this.#manifests.get(studyPlanId) ?? null;
  }

  cachedPackage(senseId: string): SensaPinnedSenseLearningPackageSnapshot | null {
    return this.#packages.get(senseId) ?? null;
  }

  async package(
    scope: SensaScope,
    studyPlanId: string,
    senseId: string,
  ): Promise<SensaPinnedSenseLearningPackageSnapshot> {
    const live = this.#packages.get(senseId);
    if (live !== undefined) return live;
    const existing = this.#inflight.get(senseId);
    if (existing !== undefined) return existing;
    const request = this.#load(scope, studyPlanId, senseId)
      .finally(() => this.#inflight.delete(senseId));
    this.#inflight.set(senseId, request);
    return request;
  }

  async #load(
    scope: SensaScope,
    studyPlanId: string,
    senseId: string,
  ): Promise<SensaPinnedSenseLearningPackageSnapshot> {
    const expected = this.cachedManifest(studyPlanId)
      ?.members.find((member) => member.senseId === senseId)
      ?.packageDigest ?? null;
    const stored = await sensaStore.readPackage(senseId);
    if (stored !== null && (expected === null || stored.packageDigest === expected)) {
      this.#packages.set(senseId, stored.package);
      void sensaStore.touchPackage(senseId);
      return stored.package;
    }
    const fetched = await sensaApi.contentItem(scope, studyPlanId, senseId);
    this.#packages.set(senseId, fetched.item.package);
    await sensaStore.writePackage(senseId, fetched.item.package);
    return fetched.item.package;
  }

  /** Warms one package without making the caller wait or fail on it. */
  prefetch(scope: SensaScope, studyPlanId: string, senseId: string | null): void {
    if (senseId === null || this.#packages.has(senseId)) return;
    void this.package(scope, studyPlanId, senseId).catch(() => undefined);
  }

  forget(): void {
    this.#manifests.clear();
    this.#packages.clear();
    this.#inflight.clear();
  }
}

export const sensaContent = new SensaContentLibrary();
