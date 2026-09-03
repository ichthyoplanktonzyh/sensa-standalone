import { FSRSItem, Rating, initFSRSFromLearn, reviewFSRS } from './fsrs';
import type { Word } from '../types';
import { WORDS } from '../data';
import type { RelearningCycle } from '../engine/types';
import type { ReviewRuntimeEffect } from '../engine/ReviewQueue';
import type { ReviewMemoryOutcome } from '../review/types';

const STORAGE_KEYS = {
  FSRS_ITEMS: 'bubei_fsrs_items_v1',
  REVIEW_RUNTIME: 'sensa_review_runtime_v1',
  SETTINGS: 'bubei_user_settings_v1',
  STATS: 'bubei_user_stats_v1',
  STARRED: 'bubei_starred_words_v1',
  KNOWN: 'bubei_known_words_v1',
};

export interface StoredReviewOutcome {
  outcomeKey: string;
  packageId: string;
  senseId: string;
  actionKey: string;
  memoryOutcome: ReviewMemoryOutcome;
  appliedAt: number;
  /** Immutable snapshot of the FSRS revision created by this outcome. */
  memoryState: FSRSItem;
  relearningCycleId: string | null;
}

export interface ReviewRuntimeStore {
  version: 1;
  settledOutcomes: Record<string, StoredReviewOutcome>;
  relearningCycles: Record<string, RelearningCycle>;
}

export interface ReviewRetentionSettlement {
  outcomeKey: string;
  applied: boolean;
  memoryState: FSRSItem;
  relearningCycle: RelearningCycle | null;
}

export interface ReviewRetentionSettlementInput {
  outcomeKey: string;
  packageId: string;
  senseId: string;
  actionKey: string;
  memoryOutcome: ReviewMemoryOutcome;
  correct: boolean;
  targetCapability: RelearningCycle['targetCapability'];
  now?: number;
}

export interface RelearningProgressInput {
  event: 'repair_completed' | 'retest_failed' | 'retest_passed';
  senseId: string;
  cycle: RelearningCycle;
}

export interface UserSettings {
  dailyNewCount: number; // 每日新学词数 (5, 10, 15, 20, 30)
  pronType: string;      // '美式' | '英式'
  autoPron: string;      // '单词、例句卡片' | '仅单词' | '关闭'
  spellMode: string;     // '全部开启' | '仅新词' | '全部关闭'
  learnPace: string;     // '20 词/组'
  reviewPace: string;    // '20 词/组'
  swAudioChoice: boolean;
  swSplitMnemo: boolean;
  swConfuse: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  dailyNewCount: 5,
  pronType: '美式',
  autoPron: '单词、例句卡片',
  spellMode: '全部开启',
  learnPace: '5 词/组',
  reviewPace: '20 词/组',
  swAudioChoice: true,
  swSplitMnemo: true,
  swConfuse: false,
};

class StorageService {
  private fsrsCache: Record<string, FSRSItem> | null = null;
  private reviewRuntimeCache: ReviewRuntimeStore | null = null;
  private settingsCache: UserSettings | null = null;
  private starredCache: Set<string> | null = null;
  private knownCache: Set<string> | null = null;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.initDefaultFSRSIfEmpty();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    });
  }

  /**
   * Keep an empty local runtime store until the installed Learning Catalog
   * supplies Sense identities. Legacy Word data is not an input to the
   * formal Learn/Review flows.
   */
  private initDefaultFSRSIfEmpty() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.FSRS_ITEMS);
      if (!raw) {
        localStorage.setItem(STORAGE_KEYS.FSRS_ITEMS, JSON.stringify({}));
        this.fsrsCache = {};
      }
    } catch {
      // 降级支持非浏览器/无 localStorage 环境
    }
  }

  public getFSRSItems(): Record<string, FSRSItem> {
    if (this.fsrsCache) return this.fsrsCache;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.FSRS_ITEMS);
      if (raw) {
        this.fsrsCache = JSON.parse(raw);
        return this.fsrsCache || {};
      }
    } catch (e) {
      console.warn('Failed to load FSRS items from localStorage', e);
    }
    return {};
  }

  public saveFSRSItem(item: FSRSItem) {
    const items = this.getFSRSItems();
    items[item.wordId] = item;
    this.fsrsCache = items;
    try {
      localStorage.setItem(STORAGE_KEYS.FSRS_ITEMS, JSON.stringify(items));
    } catch (e) {
      console.warn('Failed to save FSRS item to localStorage', e);
    }
    this.notify();
  }

  /**
   * 新词学习通关毕业：录入 FSRS 复习池
   */
  public graduateWord(wordId: string, mistakeCount: number = 0): FSRSItem {
    const item = initFSRSFromLearn(wordId, mistakeCount);
    this.saveFSRSItem(item);
    return item;
  }

  /**
   * Package/Sense-facing graduation for the local prototype.
   *
   * The first Scheduling Handoff is deliberately compressed to "due now" so
   * the complete Acquisition -> Retention journey can be walked in one QA
   * session. Later Review outcomes still use the normal scheduler.
   */
  public graduateSense(senseId: string, mistakeCount: number = 0): FSRSItem {
    const item = initFSRSFromLearn(senseId, mistakeCount);
    const immediatelyDueItem: FSRSItem = {
      ...item,
      due: Date.now(),
      scheduledDays: 0,
    };
    this.saveFSRSItem(immediatelyDueItem);
    return immediatelyDueItem;
  }

  /**
   * Install deterministic demo FSRS records for the supplied runtime Sense
   * identities. This is a local-first fixture convenience, not content
   * authoring: the caller owns which Package identities are installed.
   */
  public ensureRuntimeSenseIds(senseIds: readonly string[]): void {
    const items = this.getFSRSItems();
    const missingIds = senseIds.filter((senseId) => !items[senseId]);
    if (missingIds.length === 0) return;
    const now = Date.now();
    missingIds.forEach((senseId, index) => {
      items[senseId] = {
        wordId: senseId,
        state: 'review',
        stability: 2.0 + index * 0.5,
        difficulty: 5.0,
        reps: 1 + (index % 3),
        lapses: 0,
        lastReview: now - 3 * 24 * 60 * 60 * 1000,
        due: index === 0 ? now - 1000 : now + 24 * 3600 * 1000,
        scheduledDays: 2,
      };
    });
    this.fsrsCache = items;
    try {
      localStorage.setItem(STORAGE_KEYS.FSRS_ITEMS, JSON.stringify(items));
    } catch (e) {
      console.warn('Failed to seed runtime Sense FSRS items', e);
    }
    this.notify();
  }

  /**
   * 复习完成后更新 FSRS 记忆状态
   */
  public recordReview(wordId: string, rating: Rating): FSRSItem {
    const items = this.getFSRSItems();
    const existing = items[wordId] || initFSRSFromLearn(wordId, 0);
    const updated = reviewFSRS(existing, rating);
    this.saveFSRSItem(updated);
    return updated;
  }

  /**
   * Apply the one Review runtime effect seam. Memory projection and
   * Relearning progress use separate storage records even though the MVP
   * keeps both in localStorage.
   */
  public applyReviewRuntimeEffect<TContent>(effect: ReviewRuntimeEffect<TContent>): void {
    if (effect.type === 'retention_outcome') {
      if (!effect.result.evidenceEligible || effect.action.kind !== 'retention_review') return;
      this.settleRetentionReview({
        outcomeKey: effect.outcomeKey,
        packageId: effect.candidate.package.packageId,
        senseId: effect.candidate.package.senseId,
        actionKey: effect.action.actionKey,
        memoryOutcome: effect.result.memoryOutcome,
        correct: effect.result.correct,
        // 讲解步没有能力可归属；这条记录只在 retention_review 上落，
        // 走到这里的 null 一律按识别记，与交接前一致。
        targetCapability: effect.action.capability ?? 'contextual_recognition',
      });
      return;
    }
    this.applyRelearningProgress({
      event: effect.event,
      senseId: effect.candidate.package.senseId,
      cycle: effect.cycle,
    });
  }

  /**
   * Settle one due retaining Review exactly once. The stable outcomeKey is
   * persisted before the caller can reconstruct a queue, so undo/replay and a
   * page reload cannot apply another FSRS revision for the same due Review.
   */
  public settleRetentionReview(
    input: ReviewRetentionSettlementInput,
  ): ReviewRetentionSettlement {
    const runtime = this.getReviewRuntimeStore();
    const existingOutcome = runtime.settledOutcomes[input.outcomeKey];
    if (existingOutcome) {
      const currentMemory = this.getFSRSItems()[input.senseId] ?? existingOutcome.memoryState;
      return {
        outcomeKey: input.outcomeKey,
        applied: false,
        memoryState: { ...currentMemory },
        relearningCycle: runtime.relearningCycles[input.senseId]
          ? { ...runtime.relearningCycles[input.senseId] }
          : null,
      };
    }

    const items = this.getFSRSItems();
    const previous = items[input.senseId] ?? initFSRSFromLearn(input.senseId, 0);
    const memoryState = reviewFSRS(
      previous,
      input.correct ? Rating.Good : Rating.Again,
      input.now,
    );
    const relearningCycle: RelearningCycle | null = input.correct
      ? null
      : {
          cycleId: input.outcomeKey,
          packageId: input.packageId,
          senseId: input.senseId,
          targetCapability: input.targetCapability,
          failedReviewOutcomeKey: input.outcomeKey,
          failedReviewActionKey: input.actionKey,
          stage: 'repair_pending',
          repairCount: 0,
          lastActionOrdinal: -1,
        };

    items[input.senseId] = memoryState;
    this.fsrsCache = items;
    this.persistFSRSItems(items);

    runtime.settledOutcomes[input.outcomeKey] = {
      outcomeKey: input.outcomeKey,
      packageId: input.packageId,
      senseId: input.senseId,
      actionKey: input.actionKey,
      memoryOutcome: input.memoryOutcome,
      appliedAt: input.now ?? Date.now(),
      memoryState: { ...memoryState },
      relearningCycleId: relearningCycle?.cycleId ?? null,
    };
    if (relearningCycle) {
      runtime.relearningCycles[input.senseId] = { ...relearningCycle };
    }
    this.persistReviewRuntime(runtime);
    return {
      outcomeKey: input.outcomeKey,
      applied: true,
      memoryState: { ...memoryState },
      relearningCycle: relearningCycle ? { ...relearningCycle } : null,
    };
  }

  /** Return a copy so callers cannot mutate persisted recovery progress. */
  public getRelearningCycle(senseId: string): RelearningCycle | null {
    const cycle = this.getReviewRuntimeStore().relearningCycles[senseId];
    return cycle ? { ...cycle } : null;
  }

  public getRelearningSenseIds(): string[] {
    const cycleSenseIds = Object.keys(this.getReviewRuntimeStore().relearningCycles);
    // Before the separated Relearning projection existed, an Again review
    // could leave only the FSRS state label behind. Keep that legacy local
    // state recoverable: the Review queue will infer a targeted Package cycle
    // and the first Relearning effect will materialize it durably.
    const legacySenseIds = Object.values(this.getFSRSItems())
      .filter((item) => item.state === 'relearning')
      .map((item) => item.wordId);
    return [...new Set([...cycleSenseIds, ...legacySenseIds])];
  }

  public getSettledReviewOutcome(outcomeKey: string): StoredReviewOutcome | null {
    const outcome = this.getReviewRuntimeStore().settledOutcomes[outcomeKey];
    return outcome
      ? { ...outcome, memoryState: { ...outcome.memoryState } }
      : null;
  }

  /**
   * Persist repair/retest progress without touching the FSRS projection.
   * Completion only changes the FSRS state label back to review; due, reps,
   * lapses, stability, difficulty and scheduledDays remain byte-for-byte the
   * values produced by the failed retention outcome.
   */
  public applyRelearningProgress(input: RelearningProgressInput): void {
    const runtime = this.getReviewRuntimeStore();
    let stored = runtime.relearningCycles[input.senseId];
    if (!stored) {
      // Compatibility bridge for records written by the pre-cycle MVP. Do
      // not invent a cycle for a normal Review item: only an existing FSRS
      // `relearning` state may be upgraded by a queued Relearning effect.
      const current = this.getFSRSItems()[input.senseId];
      if (!current || current.state !== 'relearning') return;
      stored = {
        ...input.cycle,
        stage: 'repair_pending',
        repairCount: 0,
      };
      runtime.relearningCycles[input.senseId] = stored;
    }
    if (stored.cycleId !== input.cycle.cycleId) return;

    if (input.event === 'retest_passed') {
      const items = this.getFSRSItems();
      const current = items[input.senseId];
      if (current && current.state === 'relearning') {
        items[input.senseId] = { ...current, state: 'review' };
        this.fsrsCache = items;
        this.persistFSRSItems(items);
      }
      delete runtime.relearningCycles[input.senseId];
      this.persistReviewRuntime(runtime);
      return;
    }

    const nextStage = input.event === 'repair_completed'
      ? 'retest_pending'
      : 'repair_pending';
    // Replaying a transition after undo is a no-op once the same stage has
    // already been durably reached. This keeps the local effect seam idempotent.
    if (
      stored.stage === nextStage
      && stored.repairCount === input.cycle.repairCount
    ) return;
    runtime.relearningCycles[input.senseId] = {
      ...stored,
      stage: nextStage,
      repairCount: input.cycle.repairCount,
      lastActionOrdinal: input.cycle.lastActionOrdinal,
    };
    this.persistReviewRuntime(runtime);
  }

  private getReviewRuntimeStore(): ReviewRuntimeStore {
    if (this.reviewRuntimeCache) return this.reviewRuntimeCache;
    const empty: ReviewRuntimeStore = {
      version: 1,
      settledOutcomes: {},
      relearningCycles: {},
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.REVIEW_RUNTIME);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ReviewRuntimeStore>;
        if (
          parsed.version === 1
          && parsed.settledOutcomes
          && typeof parsed.settledOutcomes === 'object'
          && !Array.isArray(parsed.settledOutcomes)
          && parsed.relearningCycles
          && typeof parsed.relearningCycles === 'object'
          && !Array.isArray(parsed.relearningCycles)
        ) {
          this.reviewRuntimeCache = {
            version: 1,
            settledOutcomes: parsed.settledOutcomes as Record<string, StoredReviewOutcome>,
            relearningCycles: parsed.relearningCycles as Record<string, RelearningCycle>,
          };
          return this.reviewRuntimeCache;
        }
      }
    } catch (error) {
      console.warn('Failed to load Review runtime state from localStorage', error);
    }
    this.reviewRuntimeCache = empty;
    return empty;
  }

  private persistReviewRuntime(runtime: ReviewRuntimeStore): void {
    this.reviewRuntimeCache = runtime;
    try {
      localStorage.setItem(STORAGE_KEYS.REVIEW_RUNTIME, JSON.stringify(runtime));
    } catch (error) {
      console.warn('Failed to save Review runtime state', error);
    }
    this.notify();
  }

  private persistFSRSItems(items: Record<string, FSRSItem>): void {
    try {
      localStorage.setItem(STORAGE_KEYS.FSRS_ITEMS, JSON.stringify(items));
    } catch (error) {
      console.warn('Failed to save FSRS items to localStorage', error);
    }
  }

  /**
   * 获取所有今天到期需要复习的单词列表
   */
  public getDueWords(allWords: Word[] = WORDS, now: number = Date.now()): Word[] {
    const items = this.getFSRSItems();
    const endOfToday = new Date(now).setHours(23, 59, 59, 999);

    const dueWordIds = new Set(
      Object.values(items)
        .filter((item) => item.state === 'review' || item.state === 'relearning')
        .filter((item) => item.due <= endOfToday)
        .map((item) => item.wordId)
    );

    return allWords.filter((w) => {
      const id = w.id || `w_${w.w}`;
      return dueWordIds.has(id);
    });
  }

  /** Return due runtime Sense identities without requiring a Word registry. */
  public getDueSenseIds(senseIds: readonly string[], now: number = Date.now()): string[] {
    const items = this.getFSRSItems();
    const endOfToday = new Date(now).setHours(23, 59, 59, 999);
    const due = new Set(
      Object.values(items)
        .filter((item) => item.state === 'review' || item.state === 'relearning')
        .filter((item) => item.due <= endOfToday)
        .map((item) => item.wordId),
    );
    return senseIds.filter((senseId) => due.has(senseId));
  }

  /**
   * 获取所有已经学习掌握过的单词 ID 集合
   */
  public getLearnedWordIds(): Set<string> {
    const items = this.getFSRSItems();
    return new Set(Object.keys(items));
  }

  /* ---------- 收藏/生词本管理 ---------- */
  public getStarredWords(): Set<string> {
    if (this.starredCache) return this.starredCache;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.STARRED);
      if (raw) {
        this.starredCache = new Set(JSON.parse(raw));
        return this.starredCache;
      }
    } catch {
      // ignore
    }
    this.starredCache = new Set<string>();
    return this.starredCache;
  }

  public isStarred(word: string | Word): boolean {
    const wStr = typeof word === 'string' ? word.toLowerCase() : word.w.toLowerCase();
    return this.getStarredWords().has(wStr);
  }

  public toggleStar(word: string | Word): boolean {
    const wStr = typeof word === 'string' ? word.toLowerCase() : word.w.toLowerCase();
    const starred = this.getStarredWords();
    const nextState = !starred.has(wStr);
    if (nextState) {
      starred.add(wStr);
    } else {
      starred.delete(wStr);
    }
    this.starredCache = starred;
    try {
      localStorage.setItem(STORAGE_KEYS.STARRED, JSON.stringify(Array.from(starred)));
    } catch {
      // ignore
    }
    this.notify();
    return nextState;
  }

  /* ---------- 熟词/标熟管理 ---------- */
  public getKnownWords(): Set<string> {
    if (this.knownCache) return this.knownCache;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.KNOWN);
      if (raw) {
        this.knownCache = new Set(JSON.parse(raw));
        return this.knownCache;
      }
    } catch {
      // ignore
    }
    this.knownCache = new Set<string>();
    return this.knownCache;
  }

  public isKnown(word: string | Word): boolean {
    const wStr = typeof word === 'string' ? word.toLowerCase() : word.w.toLowerCase();
    return this.getKnownWords().has(wStr);
  }

  public toggleKnown(word: string | Word): boolean {
    const wStr = typeof word === 'string' ? word.toLowerCase() : word.w.toLowerCase();
    const known = this.getKnownWords();
    const nextState = !known.has(wStr);
    if (nextState) {
      known.add(wStr);
    } else {
      known.delete(wStr);
    }
    this.knownCache = known;
    try {
      localStorage.setItem(STORAGE_KEYS.KNOWN, JSON.stringify(Array.from(known)));
    } catch {
      // ignore
    }
    this.notify();
    return nextState;
  }

  /**
   * 获取单词当前的分类状态：'unlearned' | 'reviewing' | 'completed' | 'mastered'
   */
  public getWordLearningStatus(w: Word): 'unlearned' | 'reviewing' | 'completed' | 'mastered' {
    const id = w.id || `w_${w.w}`;
    const wStr = w.w.toLowerCase();

    if (this.isKnown(wStr) || w.isMastered) {
      return 'mastered';
    }

    const items = this.getFSRSItems();
    const item = items[id];
    if (!item) {
      return 'unlearned';
    }

    const now = Date.now();
    const endOfToday = new Date(now).setHours(23, 59, 59, 999);

    if (item.due <= endOfToday) {
      return 'reviewing';
    }

    return 'completed';
  }

  /**
   * 获取用户设置
   */
  public getSettings(): UserSettings {
    if (this.settingsCache) return this.settingsCache;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (raw) {
        this.settingsCache = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        return this.settingsCache!;
      }
    } catch (e) {
      console.warn('Failed to load settings', e);
    }
    return { ...DEFAULT_SETTINGS };
  }

  /**
   * 保存用户设置
   */
  public saveSettings(settings: Partial<UserSettings>): UserSettings {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    this.settingsCache = updated;
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
    } catch (e) {
      console.warn('Failed to save settings', e);
    }
    this.notify();
    return updated;
  }

  public getDailyNewCount(): number {
    return this.getSettings().dailyNewCount;
  }

  public setDailyNewCount(count: number): void {
    this.saveSettings({
      dailyNewCount: count,
      learnPace: `${count} 词/组`,
    });
  }
}

export const storageService = new StorageService();
